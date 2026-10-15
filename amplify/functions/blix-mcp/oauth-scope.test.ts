import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  FOOD_READ_SCOPE,
  PROBE_SCOPE,
  InsufficientOAuthScopeError,
  requireOAuthScope,
} from './oauth-scope.ts';

test('probe and FoodEntry scopes are distinct least-privilege capabilities', () => {
  assert.equal(PROBE_SCOPE, 'probe:identity');
  assert.equal(FOOD_READ_SCOPE, 'food:read');
  assert.notEqual(PROBE_SCOPE, FOOD_READ_SCOPE);
});

test('probe-only scope cannot authorize a real FoodEntry read', () => {
  assert.throws(
    () => requireOAuthScope(PROBE_SCOPE, FOOD_READ_SCOPE),
    InsufficientOAuthScopeError,
  );
});

test('food-only scope cannot authorize synthetic identity probes', () => {
  assert.throws(
    () => requireOAuthScope(FOOD_READ_SCOPE, PROBE_SCOPE),
    InsufficientOAuthScopeError,
  );
});

test('the exact required scope is accepted', () => {
  assert.doesNotThrow(() =>
    requireOAuthScope(PROBE_SCOPE, PROBE_SCOPE),
  );

  assert.doesNotThrow(() =>
    requireOAuthScope(FOOD_READ_SCOPE, FOOD_READ_SCOPE),
  );
});

test('multiple OAuth scopes are parsed as space-delimited capabilities', () => {
  const granted = `openid ${PROBE_SCOPE} ${FOOD_READ_SCOPE}`;

  assert.doesNotThrow(() =>
    requireOAuthScope(granted, PROBE_SCOPE),
  );

  assert.doesNotThrow(() =>
    requireOAuthScope(granted, FOOD_READ_SCOPE),
  );
});

test('scope matching is exact and fails closed for malformed input', () => {
  for (const granted of [
    undefined,
    null,
    '',
    'food:read-extra',
    'prefix-food:read',
    'FOOD:READ',
  ]) {
    assert.throws(
      () => requireOAuthScope(granted, FOOD_READ_SCOPE),
      InsufficientOAuthScopeError,
    );
  }
});

test('scope errors never expose granted scope contents', () => {
  const supplied = 'attacker-controlled-sensitive-scope';

  assert.throws(
    () => requireOAuthScope(supplied, FOOD_READ_SCOPE),
    (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.equal(error.message.includes(supplied), false);
      return true;
    },
  );
});
