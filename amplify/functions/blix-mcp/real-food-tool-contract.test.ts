import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Client, InMemoryTransport } from '@modelcontextprotocol/client';
import { createIdentityProbeServer } from './identity-probe-server';

type CapturedInput = {
  verifiedSubject: unknown;
  from: string;
  to: string;
};

const VERIFIED_SUBJECT =
  'oidc|blix-cognito|11111111-2222-3333-4444-555555555555';

async function connectedServer(
  readRealFood?: (input: CapturedInput) => Promise<Array<{
    date: string;
    name: string;
    calories: number;
  }>>,
) {
  const server = createIdentityProbeServer(
    undefined,
    VERIFIED_SUBJECT,
    async () => [],
    readRealFood,
  );

  const client = new Client({
    name: 'blix-real-food-contract-test',
    version: '1.0.0',
  });

  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();

  await server.connect(serverTransport);
  await client.connect(clientTransport);

  return { server, client };
}

test('tools/list exposes real FoodEntry read with food-only OAuth metadata', async () => {
  const { server, client } = await connectedServer(async () => []);

  try {
    const listed = await client.listTools();

    assert.deepEqual(
      listed.tools.map((tool) => tool.name),
      [
        'identity_probe',
        'ownership_probe',
        'food_entries_probe',
        'read_food_entries',
        'create_food_entry',
        'update_food_entry',
        'delete_food_entry',
        'read_vitals',
    'create_vital',
    'update_vital',
    'delete_vital',
      'read_daily_targets',
      ],
    );

    const realFood = listed.tools.find(
      (tool) => tool.name === 'read_food_entries',
    );

    assert.ok(realFood);
    // The MCP Client normalizes tool metadata and exposes the OAuth
    // declaration through _meta. The HTTP representation is tested
    // separately and retains the top-level securitySchemes field.
    assert.deepEqual(
      (realFood._meta as any)?.securitySchemes,
      [{ type: 'oauth2', scopes: ['food:read'] }],
    );

    assert.deepEqual(realFood.inputSchema, {
      type: 'object',
      properties: {
        from: { type: 'string' },
        to: { type: 'string' },
      },
      required: ['from', 'to'],
      additionalProperties: false,
    });

    for (const name of [
      'identity_probe',
      'ownership_probe',
      'food_entries_probe',
    ]) {
      const probe = listed.tools.find((tool) => tool.name === name);
      assert.deepEqual(
        (probe?._meta as any)?.securitySchemes,
        [{ type: 'oauth2', scopes: ['probe:identity'] }],
      );
    }
  } finally {
    await client.close();
    await server.close();
  }
});

test('real FoodEntry tool passes only verified identity and date range to reader', async () => {
  const calls: CapturedInput[] = [];

  const { server, client } = await connectedServer(async (input) => {
    calls.push(input);
    return [{
      date: '2026-10-14',
      name: 'Synthetic contract result',
      calories: 123,
    }];
  });

  try {
    const result = await client.callTool({
      name: 'read_food_entries',
      arguments: {
        from: '2026-10-01',
        to: '2026-10-15',
      },
    });

    assert.equal(result.isError, undefined);
    assert.deepEqual(calls, [{
      verifiedSubject: VERIFIED_SUBJECT,
      from: '2026-10-01',
      to: '2026-10-15',
    }]);

    const text = (result.content as Array<{
      type: string;
      text?: string;
    }>).find((item) => item.type === 'text')?.text;

    assert.equal(typeof text, 'string');

    const parsed = JSON.parse(text as string);

    assert.deepEqual(parsed, {
      entries: [{
        date: '2026-10-14',
        name: 'Synthetic contract result',
        calories: 123,
      }],
    });
  } finally {
    await client.close();
    await server.close();
  }
});

test('caller-controlled identity, scope, and infrastructure arguments are rejected before reader', async () => {
  let calls = 0;

  const { server, client } = await connectedServer(async () => {
    calls += 1;
    return [];
  });

  try {
    for (const forbidden of [
      { owner: 'forged' },
      { verifiedSubject: 'forged' },
      { subject: 'forged' },
      { identityKey: 'forged' },
      { tableName: 'forged' },
      { indexName: 'forged' },
      { scope: 'probe:identity' },
    ]) {
      const result = await client.callTool({
        name: 'read_food_entries',
        arguments: {
          from: '2026-10-01',
          to: '2026-10-15',
          ...forbidden,
        },
      });

      assert.equal(
        result.isError,
        true,
        `Forbidden argument was accepted: ${Object.keys(forbidden)[0]}`,
      );
    }

    assert.equal(calls, 0);
  } finally {
    await client.close();
    await server.close();
  }
});

test('missing or malformed date arguments fail before reader', async () => {
  let calls = 0;

  const { server, client } = await connectedServer(async () => {
    calls += 1;
    return [];
  });

  try {
    const invalidArguments = [
      {},
      { from: '2026-10-01' },
      { to: '2026-10-15' },
      { from: 123, to: '2026-10-15' },
      { from: '2026-10-01', to: false },
    ];

    for (const argumentsValue of invalidArguments) {
      const result = await client.callTool({
        name: 'read_food_entries',
        arguments: argumentsValue,
      });

      assert.equal(result.isError, true);
    }

    assert.equal(calls, 0);
  } finally {
    await client.close();
    await server.close();
  }
});

test('real FoodEntry tool fails closed when no real reader is configured', async () => {
  const { server, client } = await connectedServer();

  try {
    const result = await client.callTool({
      name: 'read_food_entries',
      arguments: {
        from: '2026-10-01',
        to: '2026-10-15',
      },
    });

    assert.equal(result.isError, true);

    const text = (result.content as Array<{
      type: string;
      text?: string;
    }>).find((item) => item.type === 'text')?.text;

    assert.equal(text, 'FoodEntry read unavailable');
  } finally {
    await client.close();
    await server.close();
  }
});
