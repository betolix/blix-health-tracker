import { defineFunction } from '@aws-amplify/backend';

export const blixMcp = defineFunction({
  name: 'blix-mcp',
  entry: './handler.ts',
  timeoutSeconds: 15,
});
