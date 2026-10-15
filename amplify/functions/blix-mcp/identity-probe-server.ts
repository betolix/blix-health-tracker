import { Server } from "@modelcontextprotocol/server";
import { MCP_RESOURCE, PROBE_SCOPE } from './auth0-probe';
import { FOOD_READ_SCOPE } from './oauth-scope';
import type {
  FoodEntryReadInput,
  FoodEntryReadResult,
} from './food-entry-reader';
import { syntheticProbeOwnerFromVerifiedAuth0Subject } from './cognito-owner';
import { countMatchingSyntheticProbeRows } from './ownership-probe';
import { listSyntheticFoodEntries } from './synthetic-food-entry-probe';

const probeSecuritySchemes = [
  { type: 'oauth2', scopes: [PROBE_SCOPE] },
];

const foodReadSecuritySchemes = [
  { type: 'oauth2', scopes: [FOOD_READ_SCOPE] },
];

type RealFoodReader = (
  input: FoodEntryReadInput,
) => Promise<FoodEntryReadResult[]>;

const challenge =
  `Bearer resource_metadata="${MCP_RESOURCE}.well-known/oauth-protected-resource", ` +
  'error="invalid_token", error_description="Authentication required"';

/**
 * MCP server for isolated probes plus the gated FoodEntry read contract.
 * Real FoodEntry access remains unavailable unless a reader is explicitly injected.
 */
export function createIdentityProbeServer(
  fingerprint?: string,
  verifiedAuth0Subject?: string,
  readSyntheticFood: typeof listSyntheticFoodEntries = listSyntheticFoodEntries,
  readRealFood?: RealFoodReader,
) {
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
        securitySchemes: probeSecuritySchemes,
        _meta: { securitySchemes: probeSecuritySchemes },
        annotations: {
          readOnlyHint: true,
          destructiveHint: false,
          idempotentHint: true,
          openWorldHint: false,
        },
      },
      {
        name: 'ownership_probe',
        title: 'Verify synthetic ownership isolation (test only)',
        description: 'Count matching synthetic OwnershipProbe rows for the authenticated Cognito identity. No health data.',
        inputSchema: { type: 'object' as const, properties: {}, additionalProperties: false },
        securitySchemes: probeSecuritySchemes,
        _meta: { securitySchemes: probeSecuritySchemes },
        annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      },
      {
        name: 'food_entries_probe',
        title: 'Read isolated synthetic food entries (test only)',
        description: 'Query only fake synthetic food entries scoped to the authenticated identity. No health data.',
        inputSchema: { type: 'object' as const, properties: {}, additionalProperties: false },
        securitySchemes: probeSecuritySchemes,
        _meta: { securitySchemes: probeSecuritySchemes },
        annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      },
      {
        name: 'read_food_entries',
        title: 'Read food entries',
        description:
          'Read the authenticated user’s food entries for a bounded date range.',
        inputSchema: {
          type: 'object' as const,
          properties: {
            from: { type: 'string' as const },
            to: { type: 'string' as const },
          },
          required: ['from', 'to'],
          additionalProperties: false,
        },
        securitySchemes: foodReadSecuritySchemes,
        _meta: { securitySchemes: foodReadSecuritySchemes },
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
    if (
      request.params.name !== 'identity_probe' &&
      request.params.name !== 'ownership_probe' &&
      request.params.name !== 'food_entries_probe' &&
      request.params.name !== 'read_food_entries'
    ) {
      throw new Error('Unknown tool');
    }

    if (request.params.name === 'read_food_entries') {
      const args = request.params.arguments;

      if (
        !args ||
        typeof args !== 'object' ||
        Array.isArray(args) ||
        Object.keys(args).length !== 2 ||
        !Object.prototype.hasOwnProperty.call(args, 'from') ||
        !Object.prototype.hasOwnProperty.call(args, 'to') ||
        typeof (args as { from?: unknown }).from !== 'string' ||
        typeof (args as { to?: unknown }).to !== 'string'
      ) {
        return {
          isError: true,
          content: [
            { type: 'text' as const, text: 'Invalid arguments' },
          ],
        };
      }

      if (!verifiedAuth0Subject) {
        return {
          isError: true,
          content: [
            { type: 'text' as const, text: 'Authentication required' },
          ],
        };
      }

      if (!readRealFood) {
        return {
          isError: true,
          content: [
            { type: 'text' as const, text: 'FoodEntry read unavailable' },
          ],
        };
      }

      try {
        const entries = await readRealFood({
          verifiedSubject: verifiedAuth0Subject,
          from: (args as { from: string }).from,
          to: (args as { to: string }).to,
        });

        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify({ entries }),
            },
          ],
        };
      } catch {
        // Fail closed. Never echo identity, query, records, or backend details.
        return {
          isError: true,
          content: [
            { type: 'text' as const, text: 'FoodEntry read unavailable' },
          ],
        };
      }
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

    if (request.params.name === 'food_entries_probe') {
      const args = request.params.arguments;
      // Never accept owner, identity, table, or arbitrary user parameters.
      if (args && (typeof args !== 'object' || Array.isArray(args) || Object.keys(args).length !== 0)) {
        return { isError: true, content: [{ type: 'text' as const, text: 'Invalid arguments' }] };
      }
      if (!verifiedAuth0Subject) {
        return { isError: true, content: [{ type: 'text' as const, text: 'Authentication required' }],
          _meta: { 'mcp/www_authenticate': [challenge] } };
      }
      try {
        const tableName = process.env.SYNTHETIC_FOOD_TABLE_NAME;
        const indexName = process.env.SYNTHETIC_FOOD_INDEX_NAME;
        if (!tableName || !indexName) throw new Error('Probe not configured');
        const entries = await readSyntheticFood(verifiedAuth0Subject, tableName, indexName);
        return { content: [{ type: 'text' as const,
          text: JSON.stringify({ synthetic: true, entries }) }] };
      } catch {
        // Fail closed. Never echo identity, query, records, or AWS error details.
        return { isError: true, content: [{ type: 'text' as const, text: 'Synthetic food probe unavailable' }] };
      }
    }

    if (request.params.name === 'ownership_probe') {
      if (!verifiedAuth0Subject) {
        return { isError: true, content: [{ type: 'text' as const, text: 'Authentication required' }],
          _meta: { 'mcp/www_authenticate': [challenge] } };
      }
      try {
        const owner = syntheticProbeOwnerFromVerifiedAuth0Subject(verifiedAuth0Subject);
        const tableName = process.env.OWNERSHIP_PROBE_TABLE_NAME;
        if (!tableName) throw new Error('Probe not configured');
        const count = await countMatchingSyntheticProbeRows(owner, tableName);
        return { content: [{ type: 'text' as const,
          text: JSON.stringify({ matching_records: count, exactly_one_match: count === 1 }) }] };
      } catch {
        // Fail closed, never echo owner, token, sub, DynamoDB details or records.
        return { isError: true, content: [{ type: 'text' as const, text: 'Ownership probe unavailable' }] };
      }
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
