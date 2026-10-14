import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  listSyntheticFoodEntries,
  syntheticFoodIdentityKeyFromVerifiedAuth0Subject,
} from './synthetic-food-entry-probe.ts';

const A = '11111111-2222-3333-4444-555555555555';
const B = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
const subject = (sub: string) => `oidc|blix-cognito|${sub}`;

test('A and B derive different opaque synthetic identity keys', () => {
  const a = syntheticFoodIdentityKeyFromVerifiedAuth0Subject(subject(A));
  const b = syntheticFoodIdentityKeyFromVerifiedAuth0Subject(subject(B));

  assert.match(a, /^[0-9a-f]{64}$/);
  assert.match(b, /^[0-9a-f]{64}$/);
  assert.notEqual(a, b);

  // Never expose the Cognito subject inside the synthetic key.
  assert.equal(a.includes(A), false);
  assert.equal(b.includes(B), false);
});

test('identity is server-derived and query is key-scoped with minimal projection', async () => {
  const expected =
    syntheticFoodIdentityKeyFromVerifiedAuth0Subject(subject(A));

  const calls: any[] = [];
  const query = async (input: any) => {
    calls.push(input);

    assert.equal(input.KeyConditionExpression, '#identityKey = :identityKey');
    assert.equal(input.ExpressionAttributeValues[':identityKey'].S, expected);
    assert.equal(input.ProjectionExpression, '#id, #date, #name, #calories');
    assert.equal(input.ConsistentRead, false);

    return {
      Items: [{
        id: { S: 'synthetic-a-1' },
        date: { S: '2099-01-01' },
        name: { S: 'Synthetic meal A' },
        calories: { N: '500' },
        secretUnexpectedField: { S: 'must-not-be-returned' },
      }],
    };
  };

  const result = await listSyntheticFoodEntries(
    subject(A),
    'synthetic-food-table',
    'byIdentityKey',
    query,
  );

  assert.deepEqual(result, [{
    id: 'synthetic-a-1',
    date: '2099-01-01',
    name: 'Synthetic meal A',
    calories: 500,
  }]);
  assert.equal(calls.length, 1);
});

test('A and B always produce separate server-side query keys', async () => {
  const seen: string[] = [];
  const query = async (input: any) => {
    seen.push(input.ExpressionAttributeValues[':identityKey'].S);
    return { Items: [] };
  };

  await listSyntheticFoodEntries(
    subject(A), 'synthetic-food-table', 'byIdentityKey', query,
  );
  await listSyntheticFoodEntries(
    subject(B), 'synthetic-food-table', 'byIdentityKey', query,
  );

  assert.deepEqual(seen, [
    syntheticFoodIdentityKeyFromVerifiedAuth0Subject(subject(A)),
    syntheticFoodIdentityKeyFromVerifiedAuth0Subject(subject(B)),
  ]);
  assert.notEqual(seen[0], seen[1]);
});

test('handles pagination without changing the identity constraint', async () => {
  const expected =
    syntheticFoodIdentityKeyFromVerifiedAuth0Subject(subject(A));
  let calls = 0;

  const query = async (input: any) => {
    calls += 1;
    assert.equal(input.ExpressionAttributeValues[':identityKey'].S, expected);

    if (calls === 1) {
      return {
        Items: [{
          id: { S: 'synthetic-a-1' },
          date: { S: '2099-01-01' },
          name: { S: 'Synthetic A1' },
          calories: { N: '100' },
        }],
        LastEvaluatedKey: { id: { S: 'cursor' } },
      };
    }

    assert.deepEqual(input.ExclusiveStartKey, { id: { S: 'cursor' } });
    return {
      Items: [{
        id: { S: 'synthetic-a-2' },
        date: { S: '2099-01-02' },
        name: { S: 'Synthetic A2' },
        calories: { N: '200' },
      }],
    };
  };

  const result = await listSyntheticFoodEntries(
    subject(A), 'synthetic-food-table', 'byIdentityKey', query,
  );

  assert.equal(calls, 2);
  assert.deepEqual(result.map((x) => x.id), [
    'synthetic-a-1',
    'synthetic-a-2',
  ]);
});

test('rejects invalid identity/config before DynamoDB access', async () => {
  let called = false;
  const query = async () => {
    called = true;
    return { Items: [] };
  };

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
      listSyntheticFoodEntries(
        badIdentity,
        'synthetic-food-table',
        'byIdentityKey',
        query,
      ),
    );
  }

  await assert.rejects(
    listSyntheticFoodEntries(subject(A), '', 'byIdentityKey', query),
  );
  await assert.rejects(
    listSyntheticFoodEntries(subject(A), 'synthetic-food-table', '', query),
  );

  assert.equal(called, false);
});

test('malformed DynamoDB rows fail closed and do not leak extra attributes', async () => {
  const malformed = async () => ({
    Items: [{
      id: { S: 'synthetic-a-1' },
      date: { S: '2099-01-01' },
      name: { S: 'Synthetic A1' },
      // calories intentionally absent
      internal: { S: 'do-not-return' },
    }],
  });

  await assert.rejects(
    listSyntheticFoodEntries(
      subject(A),
      'synthetic-food-table',
      'byIdentityKey',
      malformed,
    ),
    /Malformed synthetic food entry/,
  );
});
