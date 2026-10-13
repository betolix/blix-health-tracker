import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

/** A test-only server. It must never register health tools. */
export function createIdentityProbeServer(fingerprint: string) {
  const server = new McpServer({
    name: 'blix-identity-probe',
    version: '0.1.0',
  });

  server.registerTool(
    'identity_probe',
    {
      title: 'Verify Blix identity (test only)',
      description:
        'Return a pseudonymous identifier for the authenticated account. ' +
        'Does not read or write health records.',
      inputSchema: {},
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async () => ({
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            authenticated: true,
            identity_fingerprint: fingerprint,
          }),
        },
      ],
    })
  );

  return server;
}
