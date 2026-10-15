import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Client, InMemoryTransport } from '@modelcontextprotocol/client';
import { createIdentityProbeServer } from './identity-probe-server';

const SUBJECT =
  'oidc|blix-cognito|11111111-2222-3333-4444-555555555555';

async function connected(
  creator?: (input: any) => Promise<any>,
  updater?: (input: any) => Promise<any>,
  deleter?: (input: any) => Promise<any>,
) {
  const server = createIdentityProbeServer(
    undefined,
    SUBJECT,
    async () => [],
    undefined,
    undefined,
    undefined,
    creator,
    updater,
    deleter,
  );

  const client = new Client({
    name: 'food-write-contract-test',
    version: '1.0.0',
  });

  const [ct, st] = InMemoryTransport.createLinkedPair();
  await server.connect(st);
  await client.connect(ct);

  return { server, client };
}

test('tools/list exposes FoodEntry write tools with exact OAuth scopes', async () => {
  const { server, client } = await connected();

  try {
    const listed = await client.listTools();

    for (const [name, scope] of [
      ['create_food_entry', 'food:create'],
      ['update_food_entry', 'food:update'],
      ['delete_food_entry', 'food:delete'],
    ]) {
      const tool = listed.tools.find((x) => x.name === name);
      assert.ok(tool);
      assert.deepEqual(
        (tool._meta as any)?.securitySchemes,
        [{ type: 'oauth2', scopes: [scope] }],
      );
    }
  } finally {
    await client.close();
    await server.close();
  }
});

test('create_food_entry passes only verified subject and allowed business fields', async () => {
  const calls: any[] = [];

  const { server, client } = await connected(async (input) => {
    calls.push(input);
    return { id: 'server-id' };
  });

  try {
    const result = await client.callTool({
      name: 'create_food_entry',
      arguments: {
        date: '2026-10-15',
        name: 'Meal',
        calories: 500,
        protein: 40,
        source: 'estimated',
      },
    });

    assert.equal(result.isError, undefined);
    assert.deepEqual(calls, [{
      verifiedSubject: SUBJECT,
      date: '2026-10-15',
      name: 'Meal',
      calories: 500,
      protein: 40,
      source: 'estimated',
    }]);
  } finally {
    await client.close();
    await server.close();
  }
});

test('write tools reject caller-controlled identity and infrastructure', async () => {
  let calls = 0;

  const fn = async () => {
    calls += 1;
    return { id: 'x' };
  };

  const { server, client } = await connected(fn, fn, fn);

  try {
    for (const forbidden of [
      { owner: 'forged' },
      { verifiedSubject: 'forged' },
      { tableName: 'forged' },
      { scope: 'food:create' },
      { createdAt: 'forged' },
      { updatedAt: 'forged' },
    ]) {
      const result = await client.callTool({
        name: 'create_food_entry',
        arguments: {
          date: '2026-10-15',
          name: 'Meal',
          calories: 100,
          ...forbidden,
        },
      });

      assert.equal(result.isError, true);
    }

    assert.equal(calls, 0);
  } finally {
    await client.close();
    await server.close();
  }
});

test('update and delete receive only verified subject plus id/business fields', async () => {
  const updates: any[] = [];
  const deletes: any[] = [];

  const { server, client } = await connected(
    undefined,
    async (input) => {
      updates.push(input);
      return { id: input.id };
    },
    async (input) => {
      deletes.push(input);
      return { id: input.id };
    },
  );

  try {
    await client.callTool({
      name: 'update_food_entry',
      arguments: {
        id: 'entry-1',
        calories: 600,
        notes: null,
      },
    });

    await client.callTool({
      name: 'delete_food_entry',
      arguments: {
        id: 'entry-1',
      },
    });

    assert.deepEqual(updates, [{
      verifiedSubject: SUBJECT,
      id: 'entry-1',
      calories: 600,
      notes: null,
    }]);

    assert.deepEqual(deletes, [{
      verifiedSubject: SUBJECT,
      id: 'entry-1',
    }]);
  } finally {
    await client.close();
    await server.close();
  }
});
