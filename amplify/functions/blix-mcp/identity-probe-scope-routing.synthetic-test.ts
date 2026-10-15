import assert from 'node:assert/strict';
import {
  InsufficientProbeScopeError,
} from './auth0-probe.ts';
import {
  InsufficientOAuthScopeError,
} from './oauth-scope.ts';
import {
  createIdentityProbeHandler,
} from './identity-probe-handler.ts';

const RESOURCE =
  'https://xa2eims733qub3334xn6yky7re0ytosu.lambda-url.us-east-1.on.aws/';

const RESOURCE_METADATA =
  `${RESOURCE}.well-known/oauth-protected-resource`;

let probeVerifierCalls = 0;
let foodVerifierCalls = 0;
let syntheticReaderCalls = 0;

const probeVerifier = async (token: string) => {
  probeVerifierCalls += 1;

  if (token === 'synthetic-probe-token') {
    return {
      fingerprint: 'synthetic-fingerprint',
      verifiedSubject: 'synthetic-probe-subject',
    };
  }

  if (token === 'synthetic-food-token') {
    throw new InsufficientProbeScopeError();
  }

  throw new Error('Synthetic invalid token');
};

const foodVerifier = async (token: string) => {
  foodVerifierCalls += 1;

  if (token === 'synthetic-food-token') {
    return {
      verifiedSubject: 'synthetic-food-subject',
    };
  }

  if (token === 'synthetic-probe-token') {
    throw new InsufficientOAuthScopeError();
  }

  throw new Error('Synthetic invalid token');
};

const syntheticReader = (async () => {
  syntheticReaderCalls += 1;
  return [];
}) as any;

const handler = createIdentityProbeHandler(
  probeVerifier,
  syntheticReader,
  foodVerifier,
);

function resetCalls() {
  probeVerifierCalls = 0;
  foodVerifierCalls = 0;
  syntheticReaderCalls = 0;
}

async function call(
  toolName: string,
  token?: string,
  args: Record<string, unknown> = {},
) {
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    accept: 'application/json, text/event-stream',
  };

  if (token) {
    headers.authorization = `Bearer ${token}`;
  }

  return handler({
    rawPath: '/mcp',
    requestContext: { http: { method: 'POST' } },
    headers,
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: {
        name: toolName,
        arguments: args,
      },
    }),
  });
}

async function discovery(token: string) {
  return handler({
    rawPath: '/mcp',
    requestContext: { http: { method: 'POST' } },
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/list',
      params: {},
    }),
  });
}

function parseMcpBody(body: string) {
  try {
    return JSON.parse(body);
  } catch {
    const dataLines = body
      .split(/\r?\n/)
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.slice('data:'.length).trim())
      .filter(Boolean);

    for (const data of dataLines) {
      try {
        return JSON.parse(data);
      } catch {
        // Continue until a JSON MCP event is found.
      }
    }

    throw new Error('Expected JSON or SSE-wrapped JSON MCP response');
  }
}

async function main() {
  resetCalls();

  const probe = await call(
    'identity_probe',
    'synthetic-probe-token',
  );

  assert.equal(probe.statusCode, 200);
  assert.equal(probeVerifierCalls, 1);
  assert.equal(foodVerifierCalls, 0);
  console.log('PASS: synthetic probe selects only probe verifier');

  resetCalls();

  const wrongProbeScope = await call(
    'identity_probe',
    'synthetic-food-token',
  );

  assert.equal(wrongProbeScope.statusCode, 403);
  assert.equal(probeVerifierCalls, 1);
  assert.equal(foodVerifierCalls, 0);
  assert.equal(
    wrongProbeScope.headers?.['WWW-Authenticate'],
    `Bearer resource_metadata="${RESOURCE_METADATA}", scope="probe:identity", error="insufficient_scope"`,
  );
  console.log('PASS: food-only token cannot authorize synthetic probe');

  resetCalls();

  const anonymousFood = await call('read_food_entries');

  assert.equal(anonymousFood.statusCode, 401);
  assert.equal(probeVerifierCalls, 0);
  assert.equal(foodVerifierCalls, 0);
  assert.equal(syntheticReaderCalls, 0);
  assert.equal(
    anonymousFood.headers?.['WWW-Authenticate'],
    `Bearer resource_metadata="${RESOURCE_METADATA}", scope="food:read"`,
  );
  console.log('PASS: anonymous real FoodEntry read challenges for food:read');

  resetCalls();

  const wrongFoodScope = await call(
    'read_food_entries',
    'synthetic-probe-token',
  );

  assert.equal(wrongFoodScope.statusCode, 403);
  assert.equal(probeVerifierCalls, 0);
  assert.equal(foodVerifierCalls, 1);
  assert.equal(syntheticReaderCalls, 0);
  assert.equal(
    wrongFoodScope.headers?.['WWW-Authenticate'],
    `Bearer resource_metadata="${RESOURCE_METADATA}", scope="food:read", error="insufficient_scope"`,
  );
  console.log('PASS: probe-only token cannot authorize real FoodEntry read');

  resetCalls();

  const authorizedFood = await call(
    'read_food_entries',
    'synthetic-food-token',
    {
      from: '2099-01-01',
      to: '2099-01-02',
    },
  );

  assert.equal(foodVerifierCalls, 1);
  assert.equal(probeVerifierCalls, 0);
  assert.equal(syntheticReaderCalls, 0);

  // The tool contract is registered, but no real reader is injected yet.
  // Authentication may succeed; real FoodEntry access must still fail closed.
  assert.equal(authorizedFood.statusCode, 200);

  const authorizedFoodBody = parseMcpBody(authorizedFood.body);
  assert.equal(authorizedFoodBody.result?.isError, true);
  assert.equal(
    authorizedFoodBody.result?.content?.[0]?.text,
    'FoodEntry read unavailable',
  );

  console.log('PASS: food:read routes correctly while real reader remains disabled');

  resetCalls();

  const invalidDiscovery = await discovery(
    'synthetic-invalid-token',
  );

  assert.equal(invalidDiscovery.statusCode, 401);
  assert.equal(probeVerifierCalls, 1);
  assert.equal(foodVerifierCalls, 0);
  console.log('PASS: supplied invalid token is never ignored during discovery');

  assert.equal(
    syntheticReaderCalls,
    0,
    'No synthetic or real data reader may run in routing-only tests',
  );

  console.log('PASS: all operation-specific OAuth routing tests');
}

main().catch((error) => {
  console.error('FAIL:', error.message);
  process.exitCode = 1;
});
