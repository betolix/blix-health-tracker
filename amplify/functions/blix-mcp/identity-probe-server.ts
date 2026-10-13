import { Server } from "@modelcontextprotocol/server";
import { MCP_RESOURCE, PROBE_SCOPE } from './auth0-probe';

const securitySchemes = [
  { type: 'oauth2', scopes: [PROBE_SCOPE] },
];

const challenge =
  `Bearer resource_metadata="${MCP_RESOURCE}.well-known/oauth-protected-resource", ` +
  'error="invalid_token", error_description="Authentication required"';

/**
 * Test-only identity probe.
 * Never registers health tools or accesses health records.
 */
export function createIdentityProbeServer(fingerprint?: string) {
  const server = new Server(
    {
      name: 'blix-identity-probe',
      version: '0.1.0',
    },
    {
      capabilities: { tools: {} },
    }
  );

  server.setRequestHandler('tools/list', async () => ({
    tools: [
      {
        name: 'identity_probe',
        title: 'Verify Blix identity (test only)',
        description:
          'Return a pseudonymous identifier for the authenticated account. ' +
          'Does not read or write health records.',
        inputSchema: {
          type: 'object' as const,
          properties: {},
          additionalProperties: false,
        },
        securitySchemes,
        _meta: { securitySchemes },
        annotations: {
          readOnlyHint: true,
          destructiveHint: false,
          idempotentHint: true,
          openWorldHint: false,
        },
      },
    ],
  }));

  server.setRequestHandler('tools/call', async (request) => {
    if (request.params.name !== 'identity_probe') {
      throw new Error('Unknown tool');
    }

    if (!fingerprint) {
      return {
        isError: true,
        content: [
          { type: 'text' as const, text: 'Authentication required' },
        ],
        _meta: {
          'mcp/www_authenticate': [challenge],
        },
      };
    }

    return {
      content: [
        {
          type: 'text' as const,
          text: JSON.stringify({
            authenticated: true,
            identity_fingerprint: fingerprint,
          }),
        },
      ],
    };
  });

  return server;
}
