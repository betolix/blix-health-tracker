import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  MAX_VITAL_READ_RESULTS,
  VITAL_READ_INDEX_NAME,
  readVitals,
} from './vital-reader.ts';

const UUID =
  '11111111-1111-4111-8111-111111111111';

const SUBJECT = `oidc|blix-cognito|${UUID}`;
const TABLE = 'Vital-test';

test('Vital read is owner-derived, bounded and minimally projected', async () => {
  const calls: any[] = [];

  const result = await readVitals(
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
            recordedAt: { S: '2026-10-10T15:30:00.000Z' },
            weightKg: { N: '86.9' },
            systolic: { N: '135' },
            diastolic: { N: '90' },
            owner: { S: 'must-not-leak' },
            notes: { S: 'must-not-leak' },
          }],
        };
      },
    },
  );

  assert.equal(VITAL_READ_INDEX_NAME, 'byOwnerAndRecordedAt');
  assert.equal(MAX_VITAL_READ_RESULTS, 100);

  const query = calls[0];

  assert.equal(query.TableName, TABLE);
  assert.equal(query.IndexName, 'byOwnerAndRecordedAt');
  assert.deepEqual(
    query.ExpressionAttributeValues[':owner'],
    { S: `${UUID}::${UUID}` },
  );
  assert.deepEqual(
    query.ExpressionAttributeValues[':from'],
    { S: '2026-10-01T00:00:00.000Z' },
  );
  assert.deepEqual(
    query.ExpressionAttributeValues[':to'],
    { S: '2026-10-15T23:59:59.999Z' },
  );

  assert.equal(
    query.ProjectionExpression,
    '#recordedAt, weightKg, systolic, diastolic',
  );

  assert.deepEqual(result, [{
    recordedAt: '2026-10-10T15:30:00.000Z',
    weightKg: 86.9,
    systolic: 135,
    diastolic: 90,
  }]);

  assert.equal('owner' in result[0], false);
  assert.equal('notes' in result[0], false);
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
      from: 'not-a-date',
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
      readVitals(input, {
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

test('Vital reader enforces hard 100-result cap', async () => {
  const calls: any[] = [];

  const rows = (count: number) =>
    Array.from({ length: count }, (_, i) => ({
      recordedAt: { S: `2026-10-10T12:${String(i % 60).padStart(2, '0')}:00.000Z` },
      weightKg: { N: '86' },
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

  const result = await readVitals(
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

test('runtime Vital index matches IAM policy index', async () => {
  const { VITAL_READ_INDEX_NAME: IAM_INDEX } =
    await import('./vital-read-policy.ts');

  assert.equal(VITAL_READ_INDEX_NAME, IAM_INDEX);
});
