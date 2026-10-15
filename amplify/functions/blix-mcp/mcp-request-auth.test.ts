import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  classifyMcpRequestAuth,
  InvalidProtectedMcpRequestError,
} from './mcp-request-auth.ts';
import {
  DAILY_TARGET_READ_SCOPE,
  FOOD_CREATE_SCOPE,
  FOOD_DELETE_SCOPE,
  FOOD_READ_SCOPE,
  FOOD_UPDATE_SCOPE,
  PROBE_SCOPE,
  VITAL_READ_SCOPE,
} from './oauth-scope.ts';

function call(name: unknown): string {
  return JSON.stringify({
    jsonrpc: '2.0',
    id: 1,
    method: 'tools/call',
    params: { name },
  });
}

test('public discovery requires no OAuth scope', () => {
  for (const method of [
    'server/discover',
    'initialize',
    'tools/list',
    'notifications/initialized',
  ]) {
    assert.deepEqual(
      classifyMcpRequestAuth(JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method,
      })),
      {
        kind: 'discovery',
        requiredScope: undefined,
      },
    );
  }
});

test('synthetic probe calls are classified as probe:identity', () => {
  for (const name of [
    'identity_probe',
    'ownership_probe',
    'food_entries_probe',
  ]) {
    assert.deepEqual(
      classifyMcpRequestAuth(call(name)),
      {
        kind: 'protected-tool',
        toolName: name,
        requiredScope: PROBE_SCOPE,
      },
    );
  }
});

test('real FoodEntry read is classified as food:read', () => {
  assert.deepEqual(
    classifyMcpRequestAuth(call('read_food_entries')),
    {
      kind: 'protected-tool',
      toolName: 'read_food_entries',
      requiredScope: FOOD_READ_SCOPE,
    },
  );
});


test('FoodEntry writes are classified with operation-specific scopes', () => {
  for (const [toolName, requiredScope] of [
    ['create_food_entry', FOOD_CREATE_SCOPE],
    ['update_food_entry', FOOD_UPDATE_SCOPE],
    ['delete_food_entry', FOOD_DELETE_SCOPE],
  ] as const) {
    assert.deepEqual(
      classifyMcpRequestAuth(call(toolName)),
      {
        kind: 'protected-tool',
        toolName,
        requiredScope,
      },
    );
  }
});

test('real Vital read is classified as vitals:read', () => {
  assert.deepEqual(
    classifyMcpRequestAuth(call('read_vitals')),
    {
      kind: 'protected-tool',
      toolName: 'read_vitals',
      requiredScope: VITAL_READ_SCOPE,
    },
  );
});

test('real DailyTarget read is classified as targets:read', () => {
  assert.deepEqual(
    classifyMcpRequestAuth(call('read_daily_targets')),
    {
      kind: 'protected-tool',
      toolName: 'read_daily_targets',
      requiredScope: DAILY_TARGET_READ_SCOPE,
    },
  );
});

test('unknown protected tools fail closed instead of receiving a fallback scope', () => {
  for (const name of [
    'health_read',
    '',
    null,
  ]) {
    assert.throws(
      () => classifyMcpRequestAuth(call(name)),
      InvalidProtectedMcpRequestError,
    );
  }
});

test('malformed JSON-RPC fails closed', () => {
  for (const body of [
    undefined,
    '',
    '{',
    '{}',
    '[]',
    JSON.stringify({ jsonrpc: '1.0', method: 'tools/list' }),
    JSON.stringify({ jsonrpc: '2.0', method: 'tools/call' }),
    JSON.stringify({
      jsonrpc: '2.0',
      method: 'tools/call',
      params: {},
    }),
  ]) {
    assert.throws(
      () => classifyMcpRequestAuth(body),
      InvalidProtectedMcpRequestError,
    );
  }
});

test('caller-supplied arguments cannot change the server-selected scope', () => {
  const body = JSON.stringify({
    jsonrpc: '2.0',
    id: 1,
    method: 'tools/call',
    params: {
      name: 'read_food_entries',
      arguments: {
        scope: PROBE_SCOPE,
        requiredScope: PROBE_SCOPE,
        owner: 'attacker-controlled-owner',
      },
    },
  });

  assert.deepEqual(
    classifyMcpRequestAuth(body),
    {
      kind: 'protected-tool',
      toolName: 'read_food_entries',
      requiredScope: FOOD_READ_SCOPE,
    },
  );
});

test('classification errors never expose request contents', () => {
  const supplied = 'attacker-controlled-sensitive-tool-name';

  assert.throws(
    () => classifyMcpRequestAuth(call(supplied)),
    (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.equal(error.message.includes(supplied), false);
      return true;
    },
  );
});
