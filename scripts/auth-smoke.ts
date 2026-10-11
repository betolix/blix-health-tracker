import { verifyBlixToken } from '../amplify/functions/blix-mcp/auth';

process.env.BLIX_COGNITO_POOL_ID = 'us-east-1_ZnipNlQCR';
process.env.BLIX_OAUTH_CLIENT_ID = 'test-client-id';
process.env.BLIX_OAUTH_SCOPE = 'blix/food.write';
process.env.BLIX_MCP_RESOURCE = 'https://example.invalid/mcp';

try {
  await verifyBlixToken('this-is-not-a-valid-jwt');

  throw new Error('SECURITY FAILURE: invalid token was accepted');
} catch (error) {
  const message =
    error instanceof Error ? error.message : String(error);

  if (message.startsWith('SECURITY FAILURE')) {
    throw error;
  }

  console.log('Invalid token rejected:', message);
  console.log('PASS: JWT verifier fails closed.');
}
