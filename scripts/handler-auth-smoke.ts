import { handler } from '../amplify/functions/blix-mcp/handler';

// Fake configuration is sufficient for negative-path tests.
// No real credentials or secrets are used.
process.env.BLIX_COGNITO_POOL_ID = 'us-east-1_ZnipNlQCR';
process.env.BLIX_OAUTH_CLIENT_ID = 'test-client-id';
process.env.BLIX_OAUTH_SCOPE = 'blix/food.write';
process.env.BLIX_MCP_RESOURCE = 'https://example.invalid/mcp';

const cases = [
  {
    name: 'No Authorization header',
    headers: {},
  },
  {
    name: 'Malformed Bearer token',
    headers: {
      authorization: 'Bearer definitely-not-a-jwt',
    },
  },
  {
    name: 'Fake JWT',
    headers: {
      authorization: 'Bearer aaa.bbb.ccc',
    },
  },
];

for (const test of cases) {
  const response = await handler({
    headers: test.headers,
    requestContext: {
      http: {
        method: 'POST',
      },
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2025-06-18',
        capabilities: {},
        clientInfo: {
          name: 'security-test',
          version: '0.1.0',
        },
      },
    }),
  });

  console.log(`${test.name}: HTTP ${response.statusCode}`);

  if (response.statusCode !== 401) {
    throw new Error(
      `SECURITY FAILURE: ${test.name} returned ${response.statusCode}`
    );
  }
}

console.log('PASS: unauthenticated requests cannot reach Blix MCP.');
