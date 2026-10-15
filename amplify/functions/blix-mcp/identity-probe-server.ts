import { Server } from "@modelcontextprotocol/server";
import { MCP_RESOURCE, PROBE_SCOPE } from './auth0-probe';
import {
  DAILY_TARGET_READ_SCOPE,
  FOOD_CREATE_SCOPE,
  FOOD_DELETE_SCOPE,
  FOOD_READ_SCOPE,
  FOOD_UPDATE_SCOPE,
  VITAL_READ_SCOPE,
} from './oauth-scope';
import type {
  FoodEntryReadInput,
  FoodEntryReadResult,
} from './food-entry-reader';
import type {
  VitalReadInput,
  VitalReadResult,
} from './vital-reader';
import type {
  DailyTargetReadInput,
  DailyTargetReadResult,
} from './daily-target-reader';
import type {
  CreateFoodEntryInput,
  DeleteFoodEntryInput,
  FoodEntryWriteResult,
  UpdateFoodEntryInput,
} from './food-entry-writer';
import { syntheticProbeOwnerFromVerifiedAuth0Subject } from './cognito-owner';
import { countMatchingSyntheticProbeRows } from './ownership-probe';
import { listSyntheticFoodEntries } from './synthetic-food-entry-probe';

const probeSecuritySchemes = [
  { type: 'oauth2', scopes: [PROBE_SCOPE] },
];

const foodReadSecuritySchemes = [
  { type: 'oauth2', scopes: [FOOD_READ_SCOPE] },
];

const foodCreateSecuritySchemes = [
  { type: 'oauth2', scopes: [FOOD_CREATE_SCOPE] },
];

const foodUpdateSecuritySchemes = [
  { type: 'oauth2', scopes: [FOOD_UPDATE_SCOPE] },
];

const foodDeleteSecuritySchemes = [
  { type: 'oauth2', scopes: [FOOD_DELETE_SCOPE] },
];

const vitalReadSecuritySchemes = [
  { type: 'oauth2', scopes: [VITAL_READ_SCOPE] },
];

const dailyTargetReadSecuritySchemes = [
  { type: 'oauth2', scopes: [DAILY_TARGET_READ_SCOPE] },
];

type RealFoodReader = (
  input: FoodEntryReadInput,
) => Promise<FoodEntryReadResult[]>;

type RealFoodCreator = (
  input: CreateFoodEntryInput,
) => Promise<FoodEntryWriteResult>;

type RealFoodUpdater = (
  input: UpdateFoodEntryInput,
) => Promise<FoodEntryWriteResult>;

type RealFoodDeleter = (
  input: DeleteFoodEntryInput,
) => Promise<FoodEntryWriteResult>;

type RealVitalReader = (
  input: VitalReadInput,
) => Promise<VitalReadResult[]>;

type RealDailyTargetReader = (
  input: DailyTargetReadInput,
) => Promise<DailyTargetReadResult[]>;

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
  readRealVitals?: RealVitalReader,
  readRealDailyTargets?: RealDailyTargetReader,
  createRealFood?: RealFoodCreator,
  updateRealFood?: RealFoodUpdater,
  deleteRealFood?: RealFoodDeleter,
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
      {
        name: 'create_food_entry',
        title: 'Create food entry',
        description:
          'Create a food entry for the authenticated user.',
        inputSchema: {
          type: 'object' as const,
          properties: {
            date: { type: 'string' as const },
            name: { type: 'string' as const },
            calories: { type: 'number' as const },
            protein: { type: 'number' as const },
            carbs: { type: 'number' as const },
            fat: { type: 'number' as const },
            fiber: { type: 'number' as const },
            quantity: { type: 'string' as const },
            notes: { type: 'string' as const },
            source: {
              type: 'string' as const,
              enum: ['measured', 'label', 'estimated'],
            },
          },
          required: ['date', 'name', 'calories'],
          additionalProperties: false,
        },
        securitySchemes: foodCreateSecuritySchemes,
        _meta: { securitySchemes: foodCreateSecuritySchemes },
        annotations: {
          readOnlyHint: false,
          destructiveHint: false,
          idempotentHint: false,
          openWorldHint: false,
        },
      },
      {
        name: 'update_food_entry',
        title: 'Update food entry',
        description:
          'Update an existing food entry owned by the authenticated user.',
        inputSchema: {
          type: 'object' as const,
          properties: {
            id: { type: 'string' as const },
            date: { type: 'string' as const },
            name: { type: 'string' as const },
            calories: { type: 'number' as const },
            protein: { type: ['number', 'null'] as const },
            carbs: { type: ['number', 'null'] as const },
            fat: { type: ['number', 'null'] as const },
            fiber: { type: ['number', 'null'] as const },
            quantity: { type: ['string', 'null'] as const },
            notes: { type: ['string', 'null'] as const },
            source: {
              anyOf: [
                {
                  type: 'string' as const,
                  enum: ['measured', 'label', 'estimated'],
                },
                { type: 'null' as const },
              ],
            },
          },
          required: ['id'],
          additionalProperties: false,
        },
        securitySchemes: foodUpdateSecuritySchemes,
        _meta: { securitySchemes: foodUpdateSecuritySchemes },
        annotations: {
          readOnlyHint: false,
          destructiveHint: false,
          idempotentHint: false,
          openWorldHint: false,
        },
      },
      {
        name: 'delete_food_entry',
        title: 'Delete food entry',
        description:
          'Delete a food entry owned by the authenticated user.',
        inputSchema: {
          type: 'object' as const,
          properties: {
            id: { type: 'string' as const },
          },
          required: ['id'],
          additionalProperties: false,
        },
        securitySchemes: foodDeleteSecuritySchemes,
        _meta: { securitySchemes: foodDeleteSecuritySchemes },
        annotations: {
          readOnlyHint: false,
          destructiveHint: true,
          idempotentHint: false,
          openWorldHint: false,
        },
      },
      {
        name: 'read_vitals',
        title: 'Read vitals',
        description:
          'Read the authenticated user’s vitals for a bounded date range.',
        inputSchema: {
          type: 'object' as const,
          properties: {
            from: { type: 'string' as const },
            to: { type: 'string' as const },
          },
          required: ['from', 'to'],
          additionalProperties: false,
        },
        securitySchemes: vitalReadSecuritySchemes,
        _meta: { securitySchemes: vitalReadSecuritySchemes },
        annotations: {
          readOnlyHint: true,
          destructiveHint: false,
          idempotentHint: true,
          openWorldHint: false,
        },
      },
      {
        name: 'read_daily_targets',
        title: 'Read daily targets',
        description:
          'Read the authenticated user’s daily nutrition targets for a bounded date range.',
        inputSchema: {
          type: 'object' as const,
          properties: {
            from: { type: 'string' as const },
            to: { type: 'string' as const },
          },
          required: ['from', 'to'],
          additionalProperties: false,
        },
        securitySchemes: dailyTargetReadSecuritySchemes,
        _meta: { securitySchemes: dailyTargetReadSecuritySchemes },
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
      request.params.name !== 'read_food_entries' &&
      request.params.name !== 'create_food_entry' &&
      request.params.name !== 'update_food_entry' &&
      request.params.name !== 'delete_food_entry' &&
      request.params.name !== 'read_vitals' &&
      request.params.name !== 'read_daily_targets'
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

    if (request.params.name === 'create_food_entry') {
      const args = request.params.arguments;

      if (
        !args ||
        typeof args !== 'object' ||
        Array.isArray(args) ||
        !verifiedAuth0Subject ||
        !createRealFood
      ) {
        return {
          isError: true,
          content: [{ type: 'text' as const, text: 'FoodEntry create unavailable' }],
        };
      }

      const allowed = new Set([
        'date',
        'name',
        'calories',
        'protein',
        'carbs',
        'fat',
        'fiber',
        'quantity',
        'notes',
        'source',
      ]);

      if (
        Object.keys(args).some((key) => !allowed.has(key)) ||
        typeof (args as any).date !== 'string' ||
        typeof (args as any).name !== 'string' ||
        typeof (args as any).calories !== 'number'
      ) {
        return {
          isError: true,
          content: [{ type: 'text' as const, text: 'Invalid arguments' }],
        };
      }

      try {
        const result = await createRealFood({
          verifiedSubject: verifiedAuth0Subject,
          ...(args as Omit<CreateFoodEntryInput, 'verifiedSubject'>),
        });

        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify(result),
          }],
        };
      } catch {
        return {
          isError: true,
          content: [{ type: 'text' as const, text: 'FoodEntry create unavailable' }],
        };
      }
    }

    if (request.params.name === 'update_food_entry') {
      const args = request.params.arguments;

      if (
        !args ||
        typeof args !== 'object' ||
        Array.isArray(args) ||
        !verifiedAuth0Subject ||
        !updateRealFood
      ) {
        return {
          isError: true,
          content: [{ type: 'text' as const, text: 'FoodEntry update unavailable' }],
        };
      }

      const allowed = new Set([
        'id',
        'date',
        'name',
        'calories',
        'protein',
        'carbs',
        'fat',
        'fiber',
        'quantity',
        'notes',
        'source',
      ]);

      if (
        Object.keys(args).some((key) => !allowed.has(key)) ||
        typeof (args as any).id !== 'string' ||
        Object.keys(args).length < 2
      ) {
        return {
          isError: true,
          content: [{ type: 'text' as const, text: 'Invalid arguments' }],
        };
      }

      try {
        const result = await updateRealFood({
          verifiedSubject: verifiedAuth0Subject,
          ...(args as Omit<UpdateFoodEntryInput, 'verifiedSubject'>),
        });

        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify(result),
          }],
        };
      } catch {
        return {
          isError: true,
          content: [{ type: 'text' as const, text: 'FoodEntry update unavailable' }],
        };
      }
    }

    if (request.params.name === 'delete_food_entry') {
      const args = request.params.arguments;

      if (
        !args ||
        typeof args !== 'object' ||
        Array.isArray(args) ||
        Object.keys(args).length !== 1 ||
        typeof (args as any).id !== 'string' ||
        !verifiedAuth0Subject ||
        !deleteRealFood
      ) {
        return {
          isError: true,
          content: [{ type: 'text' as const, text: 'Invalid arguments' }],
        };
      }

      try {
        const result = await deleteRealFood({
          verifiedSubject: verifiedAuth0Subject,
          id: (args as { id: string }).id,
        });

        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify(result),
          }],
        };
      } catch {
        return {
          isError: true,
          content: [{ type: 'text' as const, text: 'FoodEntry delete unavailable' }],
        };
      }
    }

    if (request.params.name === 'read_vitals') {
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

      if (!readRealVitals) {
        return {
          isError: true,
          content: [
            { type: 'text' as const, text: 'Vital read unavailable' },
          ],
        };
      }

      try {
        const vitals = await readRealVitals({
          verifiedSubject: verifiedAuth0Subject,
          from: (args as { from: string }).from,
          to: (args as { to: string }).to,
        });

        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify({ vitals }),
            },
          ],
        };
      } catch {
        return {
          isError: true,
          content: [
            { type: 'text' as const, text: 'Vital read unavailable' },
          ],
        };
      }
    }

    if (request.params.name === 'read_daily_targets') {
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

      if (!readRealDailyTargets) {
        return {
          isError: true,
          content: [
            { type: 'text' as const, text: 'DailyTarget read unavailable' },
          ],
        };
      }

      try {
        const targets = await readRealDailyTargets({
          verifiedSubject: verifiedAuth0Subject,
          from: (args as { from: string }).from,
          to: (args as { to: string }).to,
        });

        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify({ targets }),
            },
          ],
        };
      } catch {
        return {
          isError: true,
          content: [
            { type: 'text' as const, text: 'DailyTarget read unavailable' },
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
