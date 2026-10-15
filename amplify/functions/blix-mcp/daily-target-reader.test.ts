import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  DAILY_TARGET_READ_INDEX_NAME,
  MAX_DAILY_TARGET_READ_RESULTS,
  readDailyTargets,
} from './daily-target-reader.ts';

const UUID =
  '11111111-1111-4111-8111-111111111111';
const SUBJECT = `oidc|blix-cognito|${UUID}`;
const TABLE = 'DailyTarget-test';

test('DailyTarget read is owner-derived, bounded and minimally projected', async () => {
  const calls: any[] = [];

  const result = await readDailyTargets(
    {
      verifiedSubject: SUBJECT,
      from: '2026-10-01',
      to: '2026-10-15',
    },
    {
      tableName: TABLE,
      send: async (command: any) => {
        calls.push(command.input);
        return {
          Items: [{
            date: { S: '2026-10-10' },
            calories: { N: '2200' },
            protein: { N: '160' },
            carbs: { N: '210' },
            fat: { N: '70' },
            fiber: { N: '30' },
            targetWeightKg: { N: '85' },
            owner: { S: 'must-not-leak' },
          }],
        };
      },
    },
  );

  assert.equal(DAILY_TARGET_READ_INDEX_NAME, 'byOwnerAndDate');
  assert.equal(MAX_DAILY_TARGET_READ_RESULTS, 100);

  const query = calls[0];

  assert.equal(query.TableName, TABLE);
  assert.equal(query.IndexName, 'byOwnerAndDate');

  assert.deepEqual(
    query.ExpressionAttributeValues[':owner'],
    { S: `${UUID}::${UUID}` },
  );

  assert.deepEqual(
    query.ExpressionAttributeValues[':from'],
    { S: '2026-10-01' },
  );

  assert.deepEqual(
    query.ExpressionAttributeValues[':to'],
    { S: '2026-10-15' },
  );

  assert.equal(
    query.ProjectionExpression,
    '#date, calories, protein, carbs, fat, fiber, targetWeightKg',
  );

  assert.deepEqual(result, [{
    date: '2026-10-10',
    calories: 2200,
    protein: 160,
    carbs: 210,
    fat: 70,
    fiber: 30,
    targetWeightKg: 85,
  }]);

  assert.equal('owner' in result[0], false);
});

test('invalid identity or date range fails before DynamoDB', async () => {
  for (const input of [
    {
      verifiedSubject: 'forged',
      from: '2026-10-01',
      to: '2026-10-02',
    },
    {
      verifiedSubject: SUBJECT,
      from: 'invalid',
      to: '2026-10-02',
    },
    {
      verifiedSubject: SUBJECT,
      from: '2026-01-01',
      to: '2026-12-31',
    },
  ]) {
    let calls = 0;

    await assert.rejects(() =>
      readDailyTargets(input, {
        tableName: TABLE,
        send: async () => {
          calls += 1;
          return {};
        },
      }),
    );

    assert.equal(calls, 0);
  }
});

test('DailyTarget reader rejects malformed required fields', async () => {
  for (const row of [
    {
      date: { S: 'invalid' },
      calories: { N: '2200' },
      protein: { N: '160' },
    },
    {
      date: { S: '2026-10-10' },
      calories: { N: '2200.5' },
      protein: { N: '160' },
    },
    {
      date: { S: '2026-10-10' },
      calories: { N: '2200' },
    },
  ]) {
    await assert.rejects(() =>
      readDailyTargets(
        {
          verifiedSubject: SUBJECT,
          from: '2026-10-01',
          to: '2026-10-15',
        },
        {
          tableName: TABLE,
          send: async () => ({ Items: [row] }),
        },
      ),
    );
  }
});

test('DailyTarget reader enforces hard 100-result cap', async () => {
  const calls: any[] = [];

  const rows = (count: number) =>
    Array.from({ length: count }, (_, i) => ({
      date: {
        S: `2026-10-${String((i % 15) + 1).padStart(2, '0')}`,
      },
      calories: { N: '2200' },
      protein: { N: '160' },
    }));

  const pages = [
    {
      Items: rows(60),
      LastEvaluatedKey: { id: { S: 'page-2' } },
    },
    {
      Items: rows(40),
      LastEvaluatedKey: { id: { S: 'never-read' } },
    },
  ];

  const result = await readDailyTargets(
    {
      verifiedSubject: SUBJECT,
      from: '2026-10-01',
      to: '2026-10-15',
    },
    {
      tableName: TABLE,
      send: async (command: any) => {
        calls.push(command.input);
        return pages.shift()!;
      },
    },
  );

  assert.equal(result.length, 100);
  assert.equal(calls.length, 2);
  assert.equal(calls[0].Limit, 100);
  assert.equal(calls[1].Limit, 40);
});

test('runtime DailyTarget index matches IAM policy index', async () => {
  const { DAILY_TARGET_READ_INDEX_NAME: IAM_INDEX } =
    await import('./daily-target-read-policy.ts');

  assert.equal(DAILY_TARGET_READ_INDEX_NAME, IAM_INDEX);
});
