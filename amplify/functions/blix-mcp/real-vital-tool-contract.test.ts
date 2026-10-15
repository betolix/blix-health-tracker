import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Client, InMemoryTransport } from '@modelcontextprotocol/client';
import { createIdentityProbeServer } from './identity-probe-server';

const SUBJECT =
  'oidc|blix-cognito|11111111-2222-3333-4444-555555555555';

async function connected(
  reader?: (input: any) => Promise<any[]>,
) {
  const server = createIdentityProbeServer(
    undefined,
    SUBJECT,
    async () => [],
    undefined,
    reader,
  );

  const client = new Client({
    name: 'vital-contract-test',
    version: '1.0.0',
  });

  const [ct, st] = InMemoryTransport.createLinkedPair();
  await server.connect(st);
  await client.connect(ct);

  return { server, client };
}

test('tools/list exposes read_vitals with vitals-only OAuth metadata', async () => {
  const { server, client } = await connected(async () => []);

  try {
    const listed = await client.listTools();
    const tool = listed.tools.find(
      (candidate) => candidate.name === 'read_vitals',
    );

    assert.ok(tool);

    assert.deepEqual(
      (tool._meta as any)?.securitySchemes,
      [{ type: 'oauth2', scopes: ['vitals:read'] }],
    );

    assert.deepEqual(tool.inputSchema, {
      type: 'object',
      properties: {
        from: { type: 'string' },
        to: { type: 'string' },
      },
      required: ['from', 'to'],
      additionalProperties: false,
    });
  } finally {
    await client.close();
    await server.close();
  }
});

test('read_vitals passes only verified identity and date range', async () => {
  const calls: any[] = [];

  const { server, client } = await connected(async (input) => {
    calls.push(input);

    return [{
      recordedAt: '2026-10-10T12:00:00.000Z',
      weightKg: 86,
    }];
  });

  try {
    const result = await client.callTool({
      name: 'read_vitals',
      arguments: {
        from: '2026-10-01',
        to: '2026-10-15',
      },
    });

    assert.equal(result.isError, undefined);

    assert.deepEqual(calls, [{
      verifiedSubject: SUBJECT,
      from: '2026-10-01',
      to: '2026-10-15',
    }]);
  } finally {
    await client.close();
    await server.close();
  }
});

test('read_vitals rejects caller-controlled identity or infrastructure', async () => {
  let calls = 0;

  const { server, client } = await connected(async () => {
    calls += 1;
    return [];
  });

  try {
    for (const forbidden of [
      { owner: 'forged' },
      { verifiedSubject: 'forged' },
      { tableName: 'forged' },
      { indexName: 'forged' },
      { scope: 'food:read' },
    ]) {
      const result = await client.callTool({
        name: 'read_vitals',
        arguments: {
          from: '2026-10-01',
          to: '2026-10-15',
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
