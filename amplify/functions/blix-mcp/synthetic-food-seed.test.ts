import assert from 'node:assert/strict';
import { test } from 'node:test';
import { seedSyntheticFoodEntries } from './synthetic-food-seed.ts';
import { syntheticFoodIdentityKeyFromVerifiedAuth0Subject } from './synthetic-food-entry-probe.ts';

const A = '11111111-2222-3333-4444-555555555555';
const B = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
const subject = (sub: string) => `oidc|blix-cognito|${sub}`;

test('seeder derives identity server-side and writes only predefined synthetic rows', async () => {
  const writes: any[] = [];
  let id = 0;

  const count = await seedSyntheticFoodEntries(
    subject(A),
    'synthetic-food-table',
    async (input) => { writes.push(input); return {}; },
    () => `synthetic-id-${++id}`,
  );

  const expectedKey =
    syntheticFoodIdentityKeyFromVerifiedAuth0Subject(subject(A));

  assert.equal(count, 3);
  assert.equal(writes.length, 3);
  assert.deepEqual(writes.map((x) => x.TableName), [
    'synthetic-food-table',
    'synthetic-food-table',
    'synthetic-food-table',
  ]);
  assert.deepEqual(writes.map((x) => x.Item.identityKey.S), [
    expectedKey, expectedKey, expectedKey,
  ]);
  assert.deepEqual(writes.map((x) => x.Item.name.S), [
    '[SYNTHETIC] Apple',
    '[SYNTHETIC] Sandwich',
    '[SYNTHETIC] Coffee',
  ]);
  assert.deepEqual(writes.map((x) => x.Item.calories.N), ['95', '420', '5']);
  assert.deepEqual(writes.map((x) => x.Item.id.S), [
    'synthetic-id-1', 'synthetic-id-2', 'synthetic-id-3',
  ]);
  assert.ok(writes.every((x) => x.ConditionExpression === 'attribute_not_exists(#id)'));
});

test('different identities produce different server-side seed keys', async () => {
  const seen: string[] = [];
  const put = async (input: any) => { seen.push(input.Item.identityKey.S); return {}; };

  await seedSyntheticFoodEntries(subject(A), 'synthetic-food-table', put, () => 'a');
  const aKey = seen[0];
  seen.length = 0;

  await seedSyntheticFoodEntries(subject(B), 'synthetic-food-table', put, () => 'b');
  const bKey = seen[0];

  assert.notEqual(aKey, bKey);
  assert.equal(aKey, syntheticFoodIdentityKeyFromVerifiedAuth0Subject(subject(A)));
  assert.equal(bKey, syntheticFoodIdentityKeyFromVerifiedAuth0Subject(subject(B)));
});

test('invalid identity or configuration fails before any write', async () => {
  let writes = 0;
  const put = async () => { writes += 1; return {}; };

  for (const badIdentity of [
    undefined,
    null,
    '',
    A,
    `auth0|${A}`,
    `oidc|other-connection|${A}`,
    `oidc|blix-cognito|${A}|extra`,
  ]) {
    await assert.rejects(
      seedSyntheticFoodEntries(badIdentity, 'synthetic-food-table', put),
    );
  }

  await assert.rejects(
    seedSyntheticFoodEntries(subject(A), '', put),
  );

  assert.equal(writes, 0);
});
