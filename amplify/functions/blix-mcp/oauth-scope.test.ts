import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  DAILY_TARGET_CREATE_SCOPE,
  DAILY_TARGET_DELETE_SCOPE,
  DAILY_TARGET_READ_SCOPE,
  DAILY_TARGET_UPDATE_SCOPE,
  FOOD_CREATE_SCOPE,
  FOOD_DELETE_SCOPE,
  FOOD_READ_SCOPE,
  FOOD_UPDATE_SCOPE,
  PROBE_SCOPE,
  VITAL_CREATE_SCOPE,
  VITAL_DELETE_SCOPE,
  VITAL_READ_SCOPE,
  VITAL_UPDATE_SCOPE,
  InsufficientOAuthScopeError,
  requireOAuthScope,
} from './oauth-scope.ts';

test('probe and FoodEntry scopes are distinct least-privilege capabilities', () => {
  assert.equal(PROBE_SCOPE, 'probe:identity');
  assert.equal(FOOD_READ_SCOPE, 'food:read');
  assert.equal(VITAL_READ_SCOPE, 'vitals:read');
  assert.equal(DAILY_TARGET_READ_SCOPE, 'targets:read');
  assert.notEqual(PROBE_SCOPE, FOOD_READ_SCOPE);
  assert.notEqual(PROBE_SCOPE, VITAL_READ_SCOPE);
  assert.notEqual(FOOD_READ_SCOPE, VITAL_READ_SCOPE);
  assert.notEqual(PROBE_SCOPE, DAILY_TARGET_READ_SCOPE);
  assert.notEqual(FOOD_READ_SCOPE, DAILY_TARGET_READ_SCOPE);
  assert.notEqual(VITAL_READ_SCOPE, DAILY_TARGET_READ_SCOPE);
});

test('probe-only scope cannot authorize a real FoodEntry read', () => {
  assert.throws(
    () => requireOAuthScope(PROBE_SCOPE, FOOD_READ_SCOPE),
    InsufficientOAuthScopeError,
  );
});

test('vitals-only scope cannot authorize FoodEntry reads', () => {
  assert.throws(
    () => requireOAuthScope(VITAL_READ_SCOPE, FOOD_READ_SCOPE),
    InsufficientOAuthScopeError,
  );
});

test('food-only scope cannot authorize Vital reads', () => {
  assert.throws(
    () => requireOAuthScope(FOOD_READ_SCOPE, VITAL_READ_SCOPE),
    InsufficientOAuthScopeError,
  );
});

test('other scopes cannot authorize DailyTarget reads', () => {
  for (const granted of [
    PROBE_SCOPE,
    FOOD_READ_SCOPE,
    VITAL_READ_SCOPE,
  ]) {
    assert.throws(
      () => requireOAuthScope(granted, DAILY_TARGET_READ_SCOPE),
      InsufficientOAuthScopeError,
    );
  }
});

test('targets-only scope cannot authorize other real reads', () => {
  for (const required of [
    FOOD_READ_SCOPE,
    VITAL_READ_SCOPE,
    PROBE_SCOPE,
  ]) {
    assert.throws(
      () => requireOAuthScope(DAILY_TARGET_READ_SCOPE, required),
      InsufficientOAuthScopeError,
    );
  }
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

  assert.doesNotThrow(() =>
    requireOAuthScope(VITAL_READ_SCOPE, VITAL_READ_SCOPE),
  );

  assert.doesNotThrow(() =>
    requireOAuthScope(DAILY_TARGET_READ_SCOPE, DAILY_TARGET_READ_SCOPE),
  );
});

test('multiple OAuth scopes are parsed as space-delimited capabilities', () => {
  const granted =
    `openid ${PROBE_SCOPE} ${FOOD_READ_SCOPE} ${VITAL_READ_SCOPE} ${DAILY_TARGET_READ_SCOPE}`;

  assert.doesNotThrow(() =>
    requireOAuthScope(granted, PROBE_SCOPE),
  );

  assert.doesNotThrow(() =>
    requireOAuthScope(granted, FOOD_READ_SCOPE),
  );

  assert.doesNotThrow(() =>
    requireOAuthScope(granted, VITAL_READ_SCOPE),
  );

  assert.doesNotThrow(() =>
    requireOAuthScope(granted, DAILY_TARGET_READ_SCOPE),
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


test('FoodEntry write scopes are distinct least-privilege capabilities', () => {
  assert.equal(FOOD_CREATE_SCOPE, 'food:create');
  assert.equal(FOOD_UPDATE_SCOPE, 'food:update');
  assert.equal(FOOD_DELETE_SCOPE, 'food:delete');

  const scopes = [
    PROBE_SCOPE,
    FOOD_READ_SCOPE,
    FOOD_CREATE_SCOPE,
    FOOD_UPDATE_SCOPE,
    FOOD_DELETE_SCOPE,
    VITAL_READ_SCOPE,
    DAILY_TARGET_READ_SCOPE,
  ];

  assert.equal(new Set(scopes).size, scopes.length);
});

test('FoodEntry write scopes cannot authorize one another', () => {
  const writes = [
    FOOD_CREATE_SCOPE,
    FOOD_UPDATE_SCOPE,
    FOOD_DELETE_SCOPE,
  ];

  for (const granted of writes) {
    for (const required of writes) {
      if (granted === required) {
        assert.doesNotThrow(() =>
          requireOAuthScope(granted, required)
        );
      } else {
        assert.throws(
          () => requireOAuthScope(granted, required),
          InsufficientOAuthScopeError,
        );
      }
    }
  }
});

test('FoodEntry read scope cannot authorize writes and write scopes cannot authorize reads', () => {
  for (const writeScope of [
    FOOD_CREATE_SCOPE,
    FOOD_UPDATE_SCOPE,
    FOOD_DELETE_SCOPE,
  ]) {
    assert.throws(
      () => requireOAuthScope(FOOD_READ_SCOPE, writeScope),
      InsufficientOAuthScopeError,
    );

    assert.throws(
      () => requireOAuthScope(writeScope, FOOD_READ_SCOPE),
      InsufficientOAuthScopeError,
    );
  }
});


test('Vital write scopes are distinct least-privilege capabilities', () => {
  assert.equal(VITAL_CREATE_SCOPE, 'vitals:create');
  assert.equal(VITAL_UPDATE_SCOPE, 'vitals:update');
  assert.equal(VITAL_DELETE_SCOPE, 'vitals:delete');

  const scopes = [
    PROBE_SCOPE,
    FOOD_READ_SCOPE,
    FOOD_CREATE_SCOPE,
    FOOD_UPDATE_SCOPE,
    FOOD_DELETE_SCOPE,
    VITAL_READ_SCOPE,
    VITAL_CREATE_SCOPE,
    VITAL_UPDATE_SCOPE,
    VITAL_DELETE_SCOPE,
    DAILY_TARGET_READ_SCOPE,
  ];

  assert.equal(new Set(scopes).size, scopes.length);
});

test('Vital write scopes cannot authorize one another', () => {
  const writes = [
    VITAL_CREATE_SCOPE,
    VITAL_UPDATE_SCOPE,
    VITAL_DELETE_SCOPE,
  ];

  for (const granted of writes) {
    for (const required of writes) {
      if (granted === required) {
        assert.doesNotThrow(() =>
          requireOAuthScope(granted, required)
        );
      } else {
        assert.throws(
          () => requireOAuthScope(granted, required),
          InsufficientOAuthScopeError,
        );
      }
    }
  }
});

test('Vital read scope cannot authorize writes and write scopes cannot authorize reads', () => {
  for (const writeScope of [
    VITAL_CREATE_SCOPE,
    VITAL_UPDATE_SCOPE,
    VITAL_DELETE_SCOPE,
  ]) {
    assert.throws(
      () => requireOAuthScope(VITAL_READ_SCOPE, writeScope),
      InsufficientOAuthScopeError,
    );

    assert.throws(
      () => requireOAuthScope(writeScope, VITAL_READ_SCOPE),
      InsufficientOAuthScopeError,
    );
  }
});


test('DailyTarget write scopes are distinct least-privilege capabilities', () => {
  assert.equal(DAILY_TARGET_CREATE_SCOPE, 'targets:create');
  assert.equal(DAILY_TARGET_UPDATE_SCOPE, 'targets:update');
  assert.equal(DAILY_TARGET_DELETE_SCOPE, 'targets:delete');

  const scopes = [
    PROBE_SCOPE,
    FOOD_READ_SCOPE,
    FOOD_CREATE_SCOPE,
    FOOD_UPDATE_SCOPE,
    FOOD_DELETE_SCOPE,
    VITAL_READ_SCOPE,
    VITAL_CREATE_SCOPE,
    VITAL_UPDATE_SCOPE,
    VITAL_DELETE_SCOPE,
    DAILY_TARGET_READ_SCOPE,
    DAILY_TARGET_CREATE_SCOPE,
    DAILY_TARGET_UPDATE_SCOPE,
    DAILY_TARGET_DELETE_SCOPE,
  ];

  assert.equal(new Set(scopes).size, scopes.length);
});

test('DailyTarget write scopes cannot authorize one another', () => {
  const writes = [
    DAILY_TARGET_CREATE_SCOPE,
    DAILY_TARGET_UPDATE_SCOPE,
    DAILY_TARGET_DELETE_SCOPE,
  ];

  for (const granted of writes) {
    for (const required of writes) {
      if (granted === required) {
        assert.doesNotThrow(() =>
          requireOAuthScope(granted, required)
        );
      } else {
        assert.throws(
          () => requireOAuthScope(granted, required),
          InsufficientOAuthScopeError,
        );
      }
    }
  }
});

test('DailyTarget read scope cannot authorize writes and write scopes cannot authorize reads', () => {
  for (const writeScope of [
    DAILY_TARGET_CREATE_SCOPE,
    DAILY_TARGET_UPDATE_SCOPE,
    DAILY_TARGET_DELETE_SCOPE,
  ]) {
    assert.throws(
      () => requireOAuthScope(DAILY_TARGET_READ_SCOPE, writeScope),
      InsufficientOAuthScopeError,
    );

    assert.throws(
      () => requireOAuthScope(writeScope, DAILY_TARGET_READ_SCOPE),
      InsufficientOAuthScopeError,
    );
  }
});
