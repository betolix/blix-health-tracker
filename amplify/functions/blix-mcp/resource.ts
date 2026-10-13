import { defineFunction } from '@aws-amplify/backend';

export const blixMcp = defineFunction({
  name: 'blix-mcp',
  entry: './identity-probe-handler.ts',
  timeoutSeconds: 15,
  environment: {
    BLIX_AUTH0_CIMD_CLIENT_ID: 'tpc_8pF4aen3v8xA78toqhwpxX',
  },
});
