import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  requiredOAuthScopeForTool,
  UnknownProtectedToolError,
} from './mcp-tool-scope.ts';
import {
  FOOD_READ_SCOPE,
  PROBE_SCOPE,
} from './oauth-scope.ts';

test('each synthetic probe requires only probe:identity', () => {
  for (const tool of [
    'identity_probe',
    'ownership_probe',
    'food_entries_probe',
  ]) {
    assert.equal(
      requiredOAuthScopeForTool(tool),
      PROBE_SCOPE,
    );
  }
});

test('real FoodEntry read requires only food:read', () => {
  assert.equal(
    requiredOAuthScopeForTool('read_food_entries'),
    FOOD_READ_SCOPE,
  );
});

test('probe tool names can never select food:read', () => {
  for (const tool of [
    'identity_probe',
    'ownership_probe',
    'food_entries_probe',
  ]) {
    assert.notEqual(
      requiredOAuthScopeForTool(tool),
      FOOD_READ_SCOPE,
    );
  }
});

test('real FoodEntry read can never fall back to probe:identity', () => {
  assert.notEqual(
    requiredOAuthScopeForTool('read_food_entries'),
    PROBE_SCOPE,
  );
});

test('unknown or malformed protected tool names fail closed', () => {
  for (const tool of [
    undefined,
    null,
    '',
    'read_food_entry',
    'read_food_entries ',
    'READ_FOOD_ENTRIES',
    'vital_read',
    'daily_target_read',
    'health_read',
  ]) {
    assert.throws(
      () => requiredOAuthScopeForTool(tool),
      UnknownProtectedToolError,
    );
  }
});

test('caller-controlled scope strings are not interpreted as tool names', () => {
  for (const supplied of [
    PROBE_SCOPE,
    FOOD_READ_SCOPE,
    `${PROBE_SCOPE} ${FOOD_READ_SCOPE}`,
  ]) {
    assert.throws(
      () => requiredOAuthScopeForTool(supplied),
      UnknownProtectedToolError,
    );
  }
});

test('unknown-tool errors never expose caller-supplied names', () => {
  const supplied = 'attacker-controlled-sensitive-tool-name';

  assert.throws(
    () => requiredOAuthScopeForTool(supplied),
    (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.equal(error.message.includes(supplied), false);
      return true;
    },
  );
});
