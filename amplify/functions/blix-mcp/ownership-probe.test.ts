import assert from 'node:assert/strict';
import { test } from 'node:test';
import { countMatchingSyntheticProbeRows } from './ownership-probe.ts';

const A = '11111111-2222-3333-4444-555555555555';
const B = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
const owner = (sub: string) => `${sub}::${sub}`;

test('filters by owner, returns only count and handles pagination', async () => {
  const calls: unknown[] = [];
  const scan = async (input: any) => {
    calls.push(input);
    assert.equal(input.Select, 'COUNT');
    assert.equal(input.ExpressionAttributeValues[':expectedOwner'].S, owner(A));
    return calls.length === 1
      ? { Count: 0, LastEvaluatedKey: { id: { S: 'cursor' } } }
      : { Count: 1 };
  };
  assert.equal(await countMatchingSyntheticProbeRows(owner(A), 'synthetic-table', scan), 1);
  assert.equal(calls.length, 2);
});

test('two identities receive separate server-side filters', async () => {
  const seen: string[] = [];
  const scan = async (input: any) => {
    seen.push(input.ExpressionAttributeValues[':expectedOwner'].S);
    return { Count: 1 };
  };
  await countMatchingSyntheticProbeRows(owner(A), 'synthetic-table', scan);
  await countMatchingSyntheticProbeRows(owner(B), 'synthetic-table', scan);
  assert.deepEqual(seen, [owner(A), owner(B)]);
});

test('rejects invalid owner before accessing DynamoDB', async () => {
  let called = false;
  const scan = async () => { called = true; return { Count: 0 }; };
  await assert.rejects(countMatchingSyntheticProbeRows(A, 'synthetic-table', scan));
  await assert.rejects(countMatchingSyntheticProbeRows(owner(A), '', scan));
  assert.equal(called, false);
});
