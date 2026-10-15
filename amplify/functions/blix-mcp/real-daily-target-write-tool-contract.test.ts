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
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    creator,
    updater,
    deleter,
  );

  const client = new Client({
    name: 'daily-target-write-contract-test',
    version: '1.0.0',
  });

  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();

  await server.connect(serverTransport);
  await client.connect(clientTransport);

  return { server, client };
}

test('tools/list exposes DailyTarget write tools with exact OAuth scopes', async () => {
  const { server, client } = await connected();

  try {
    const listed = await client.listTools();

    for (const [name, scope] of [
      ['create_daily_target', 'targets:create'],
      ['update_daily_target', 'targets:update'],
      ['delete_daily_target', 'targets:delete'],
    ]) {
      const tool = listed.tools.find(
        (candidate) => candidate.name === name,
      );

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

test('create_daily_target passes only verified subject and allowed business fields', async () => {
  const calls: any[] = [];

  const { server, client } = await connected(async (input) => {
    calls.push(input);
    return { id: 'server-id' };
  });

  try {
    const result = await client.callTool({
      name: 'create_daily_target',
      arguments: {
        date: '2026-10-15',
        calories: 2200,
        protein: 180,
        carbs: 200,
        fat: 70,
        fiber: 30,
        targetWeightKg: 85,
      },
    });

    assert.equal(result.isError, undefined);

    assert.deepEqual(calls, [{
      verifiedSubject: SUBJECT,
      date: '2026-10-15',
      calories: 2200,
      protein: 180,
      carbs: 200,
      fat: 70,
      fiber: 30,
      targetWeightKg: 85,
    }]);
  } finally {
    await client.close();
    await server.close();
  }
});

test('DailyTarget write tools reject caller-controlled identity and infrastructure', async () => {
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
      { scope: 'targets:create' },
      { createdAt: 'forged' },
      { updatedAt: 'forged' },
      { id: 'caller-id' },
    ]) {
      const result = await client.callTool({
        name: 'create_daily_target',
        arguments: {
          date: '2026-10-15',
          calories: 2200,
          protein: 180,
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

test('update and delete DailyTarget tools receive only verified subject plus id/business fields', async () => {
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
      name: 'update_daily_target',
      arguments: {
        id: 'target-1',
        calories: 2100,
        carbs: null,
      },
    });

    await client.callTool({
      name: 'delete_daily_target',
      arguments: {
        id: 'target-1',
      },
    });

    assert.deepEqual(updates, [{
      verifiedSubject: SUBJECT,
      id: 'target-1',
      calories: 2100,
      carbs: null,
    }]);

    assert.deepEqual(deletes, [{
      verifiedSubject: SUBJECT,
      id: 'target-1',
    }]);
  } finally {
    await client.close();
    await server.close();
  }
});
