import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  requiredOAuthScopeForTool,
  UnknownProtectedToolError,
} from './mcp-tool-scope.ts';
import {
  DAILY_TARGET_READ_SCOPE,
  FOOD_CREATE_SCOPE,
  FOOD_DELETE_SCOPE,
  FOOD_READ_SCOPE,
  FOOD_UPDATE_SCOPE,
  PROBE_SCOPE,
  VITAL_READ_SCOPE,
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


test('FoodEntry write tools require distinct exact scopes', () => {
  assert.equal(
    requiredOAuthScopeForTool('create_food_entry'),
    FOOD_CREATE_SCOPE,
  );
  assert.equal(
    requiredOAuthScopeForTool('update_food_entry'),
    FOOD_UPDATE_SCOPE,
  );
  assert.equal(
    requiredOAuthScopeForTool('delete_food_entry'),
    FOOD_DELETE_SCOPE,
  );
});

test('real Vital read requires only vitals:read', () => {
  assert.equal(
    requiredOAuthScopeForTool('read_vitals'),
    VITAL_READ_SCOPE,
  );
});

test('real DailyTarget read requires only targets:read', () => {
  assert.equal(
    requiredOAuthScopeForTool('read_daily_targets'),
    DAILY_TARGET_READ_SCOPE,
  );
});

test('real DailyTarget read cannot fall back to other scopes', () => {
  assert.notEqual(
    requiredOAuthScopeForTool('read_daily_targets'),
    PROBE_SCOPE,
  );
  assert.notEqual(
    requiredOAuthScopeForTool('read_daily_targets'),
    FOOD_READ_SCOPE,
  );
  assert.notEqual(
    requiredOAuthScopeForTool('read_daily_targets'),
    VITAL_READ_SCOPE,
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

test('real Vital read cannot fall back to probe or food scope', () => {
  assert.notEqual(
    requiredOAuthScopeForTool('read_vitals'),
    PROBE_SCOPE,
  );
  assert.notEqual(
    requiredOAuthScopeForTool('read_vitals'),
    FOOD_READ_SCOPE,
  );
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
    VITAL_READ_SCOPE,
    DAILY_TARGET_READ_SCOPE,
    `${PROBE_SCOPE} ${FOOD_READ_SCOPE} ${VITAL_READ_SCOPE} ${DAILY_TARGET_READ_SCOPE}`,
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
