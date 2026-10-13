import assert from 'node:assert/strict';
import { handler } from './identity-probe-handler';

const RESOURCE =
  'https://xa2eims733qub3334xn6yky7re0ytosu.lambda-url.us-east-1.on.aws/';

const RESOURCE_METADATA =
  `${RESOURCE}.well-known/oauth-protected-resource`;

async function run() {
  // OAuth protected-resource metadata remains available.
  {
    const response = await handler({
      rawPath: '/.well-known/oauth-protected-resource',
      requestContext: { http: { method: 'GET' } },
      headers: {},
    });

    assert.equal(response.statusCode, 200);
    assert.equal(response.headers?.['Cache-Control'], 'no-store');

    const body = JSON.parse(response.body ?? '{}');

    assert.equal(body.resource, RESOURCE);
    assert.deepEqual(body.authorization_servers, [
      'https://dev-0nvmmicnskv1kx50.us.auth0.com/',
    ]);

    console.log('PASS: OAuth protected-resource metadata preserved');
  }

  // Unknown paths remain disabled.
  {
    const response = await handler({
      rawPath: '/anything-else',
      requestContext: { http: { method: 'GET' } },
      headers: {},
    });

    assert.equal(response.statusCode, 503);
    assert.equal(response.headers?.['Cache-Control'], 'no-store');

    const body = JSON.parse(response.body ?? '{}');

    assert.equal(body.error, 'service_unavailable');
    assert.equal(body.message, 'Blix MCP is not enabled.');

    console.log('PASS: unknown path remains disabled');
  }

  // /mcp accepts POST only.
  {
    const response = await handler({
      rawPath: '/mcp',
      requestContext: { http: { method: 'GET' } },
      headers: {},
    });

    assert.equal(response.statusCode, 405);
    assert.equal((response.headers as Record<string, string | undefined>).Allow, 'POST');
    assert.equal(response.headers?.['Cache-Control'], 'no-store');
    assert.equal(response.body, '');

    console.log('PASS: GET /mcp rejected');
  }

  // Missing Authorization must fail closed.
  {
    const response = await handler({
      rawPath: '/mcp',
      requestContext: { http: { method: 'POST' } },
      headers: {
        'content-type': 'application/json',
      },
      body: '{}',
    });

    assert.equal(response.statusCode, 401);
    assert.equal(response.body, '{"error":"unauthorized"}');
    assert.equal(
      (response.headers as Record<string, string | undefined>)['WWW-Authenticate'],
      `Bearer resource_metadata="${RESOURCE_METADATA}", scope="probe:identity"`,
    );

    console.log('PASS: missing Authorization rejected');
  }

  // Non-Bearer authentication must fail closed.
  {
    const response = await handler({
      rawPath: '/mcp',
      requestContext: { http: { method: 'POST' } },
      headers: {
        authorization: 'Basic synthetic-not-a-secret',
        'content-type': 'application/json',
      },
      body: '{}',
    });

    assert.equal(response.statusCode, 401);
    assert.equal(response.body, '{"error":"unauthorized"}');

    console.log('PASS: non-Bearer Authorization rejected');
  }

  // Ambiguous duplicate Authorization headers must fail closed.
  {
    const response = await handler({
      rawPath: '/mcp',
      requestContext: { http: { method: 'POST' } },
      headers: {
        Authorization: 'Bearer synthetic-one',
        authorization: 'Bearer synthetic-two',
        'content-type': 'application/json',
      },
      body: '{}',
    });

    assert.equal(response.statusCode, 401);
    assert.equal(response.body, '{"error":"unauthorized"}');

    console.log('PASS: ambiguous Authorization headers rejected');
  }

  console.log('PASS: all synthetic identity-probe HTTP tests passed');
}

await run();
