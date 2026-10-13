import assert from 'node:assert/strict';
import { InsufficientProbeScopeError } from './auth0-probe';
import { createIdentityProbeHandler } from './identity-probe-handler';

const fingerprint = 'synthetic-mixed-auth-fingerprint';
let verifications = 0;
const handler = createIdentityProbeHandler(async (token) => {
  verifications += 1;
  if (token === 'synthetic-insufficient-scope') {
    throw new InsufficientProbeScopeError();
  }
  if (token !== 'synthetic-valid-token') {
    throw new Error('Invalid synthetic token');
  }
  return { fingerprint };
});

async function post(body: unknown, headers: Record<string, string> = {}) {
  return handler({
    rawPath: '/mcp',
    requestContext: { http: { method: 'POST' } },
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
      ...headers,
    },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

const initialize = {
  jsonrpc: '2.0',
  id: 1,
  method: 'initialize',
  params: {
    protocolVersion: '2025-06-18',
    capabilities: {},
    clientInfo: { name: 'mixed-auth-synthetic', version: '1.0' },
  },
};
const list = { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} };
const call = {
  jsonrpc: '2.0', id: 3, method: 'tools/call',
  params: { name: 'identity_probe', arguments: {} },
};

async function run() {
  const anonymousInitialize = await post(initialize);
  assert.equal(anonymousInitialize.statusCode, 200);
  assert.equal(
    JSON.parse(anonymousInitialize.body).result.serverInfo.name,
    'blix-identity-probe'
  );

  const anonymousList = await post(list);
  assert.equal(anonymousList.statusCode, 200);
  const tools = JSON.parse(anonymousList.body).result.tools;
  assert.deepEqual(tools.map((tool: { name: string }) => tool.name), [
    'identity_probe',
  ]);
  assert.deepEqual(tools[0]._meta.securitySchemes, [
    { type: 'oauth2', scopes: ['probe:identity'] },
  ]);
  assert.equal(verifications, 0, 'Discovery must not require a token');
  console.log('PASS: anonymous initialize and tools/list expose only identity_probe');

  const base64Discovery = await handler({
    rawPath: '/mcp',
    requestContext: { http: { method: 'POST' } },
    headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' },
    isBase64Encoded: true,
    body: Buffer.from(JSON.stringify(list)).toString('base64'),
  });
  assert.equal(base64Discovery.statusCode, 200);
  assert.equal(verifications, 0);
  console.log('PASS: base64-encoded anonymous discovery');

  const notification = await post({
    jsonrpc: '2.0', method: 'notifications/initialized',
  });
  assert.equal(notification.statusCode, 202);
  assert.equal(verifications, 0);
  console.log('PASS: anonymous initialization notification accepted');

  const anonymousCall = await post(call);
  assert.equal(anonymousCall.statusCode, 200);
  const challenge = JSON.parse(anonymousCall.body).result;
  assert.equal(challenge.isError, true);
  assert.match(
    challenge._meta['mcp/www_authenticate'][0],
    /scope|resource_metadata=/
  );
  assert.doesNotMatch(anonymousCall.body, /identity_fingerprint/);
  assert.equal(verifications, 0);
  console.log('PASS: anonymous tool invocation returns only MCP auth challenge');

  for (const body of [
    '{}',
    '{not-json',
    [list],
    { jsonrpc: '2.0', id: 4, method: 'tools/call',
      params: { name: 'add_food', arguments: {} } },
    { jsonrpc: '2.0', id: 5, method: 'resources/list' },
  ]) {
    const rejected = await post(body);
    assert.equal(rejected.statusCode, 401);
    assert.doesNotMatch(rejected.body, /identity_fingerprint/);
  }
  console.log('PASS: malformed, batch, unknown and health requests fail closed');

  const malformedAuth = await post(list, { Authorization: 'Basic not-a-token' });
  assert.equal(malformedAuth.statusCode, 401);
  const duplicateAuth = await post(list, {
    Authorization: 'Bearer synthetic-valid-token',
    authorization: 'Bearer synthetic-valid-token',
  });
  assert.equal(duplicateAuth.statusCode, 401);
  const invalidToken = await post(call, {
    Authorization: 'Bearer synthetic-invalid-token',
  });
  assert.equal(invalidToken.statusCode, 401);
  const insufficientScope = await post(call, {
    Authorization: 'Bearer synthetic-insufficient-scope',
  });
  assert.equal(insufficientScope.statusCode, 403);
  console.log('PASS: supplied invalid or insufficient credentials are rejected');

  const authenticatedCall = await post(call, {
    Authorization: 'Bearer synthetic-valid-token',
  });
  assert.equal(authenticatedCall.statusCode, 200);
  const result = JSON.parse(authenticatedCall.body).result;
  assert.equal(result.isError, undefined);
  assert.deepEqual(JSON.parse(result.content[0].text), {
    authenticated: true,
    identity_fingerprint: fingerprint,
  });
  console.log('PASS: authenticated probe returns only synthetic fingerprint');
}

run().catch((error) => {
  console.error('FAIL:', error);
  process.exitCode = 1;
});
