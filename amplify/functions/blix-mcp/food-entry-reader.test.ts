import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  FOOD_ENTRY_READ_INDEX_NAME,
  MAX_FOOD_ENTRY_READ_RESULTS,
  readFoodEntries,
} from './food-entry-reader.ts';

const UUID_A = '11111111-1111-4111-8111-111111111111';
const UUID_B = '22222222-2222-4222-8222-222222222222';

const SUBJECT_A = `oidc|blix-cognito|${UUID_A}`;
const SUBJECT_B = `oidc|blix-cognito|${UUID_B}`;

const TABLE_NAME = 'FoodEntry-test';

function makeSend(items: unknown[] = []) {
  const calls: any[] = [];

  return {
    calls,
    send: async (command: any) => {
      calls.push(command.input);
      return { Items: items };
    },
  };
}

test('FoodEntry read is owner-derived, date-bounded, index-scoped, and minimally projected', async () => {
  const db = makeSend([
    {
      date: { S: '2026-10-10' },
      name: { S: 'Apple' },
      calories: { N: '95' },
      owner: { S: 'must-not-leak' },
      protein: { N: '1' },
      notes: { S: 'must-not-leak' },
    },
  ]);

  const result = await readFoodEntries(
    {
      verifiedSubject: SUBJECT_A,
      from: '2026-10-01',
      to: '2026-10-15',
    },
    {
      tableName: TABLE_NAME,
      send: db.send,
    },
  );

  assert.equal(FOOD_ENTRY_READ_INDEX_NAME, 'byOwnerAndDate');
  assert.equal(MAX_FOOD_ENTRY_READ_RESULTS, 100);
  assert.equal(db.calls.length, 1);

  const query = db.calls[0];

  assert.equal(query.TableName, TABLE_NAME);
  assert.equal(query.IndexName, 'byOwnerAndDate');
  assert.equal(
    query.KeyConditionExpression,
    '#owner = :owner AND #date BETWEEN :from AND :to',
  );
  assert.deepEqual(
    query.ExpressionAttributeValues[':owner'],
    { S: `${UUID_A}::${UUID_A}` },
  );
  assert.deepEqual(
    query.ExpressionAttributeValues[':from'],
    { S: '2026-10-01' },
  );
  assert.deepEqual(
    query.ExpressionAttributeValues[':to'],
    { S: '2026-10-15' },
  );

  assert.equal(query.ProjectionExpression, '#date, #name, calories');
  assert.deepEqual(query.ExpressionAttributeNames, {
    '#owner': 'owner',
    '#date': 'date',
    '#name': 'name',
  });
  assert.equal(query.Limit, 100);

  assert.deepEqual(result, [
    {
      date: '2026-10-10',
      name: 'Apple',
      calories: 95,
    },
  ]);
});

test('different verified identities always produce different server-derived owners', async () => {
  const dbA = makeSend();
  const dbB = makeSend();

  await readFoodEntries(
    {
      verifiedSubject: SUBJECT_A,
      from: '2026-10-01',
      to: '2026-10-02',
    },
    { tableName: TABLE_NAME, send: dbA.send },
  );

  await readFoodEntries(
    {
      verifiedSubject: SUBJECT_B,
      from: '2026-10-01',
      to: '2026-10-02',
    },
    { tableName: TABLE_NAME, send: dbB.send },
  );

  const ownerA = dbA.calls[0].ExpressionAttributeValues[':owner'];
  const ownerB = dbB.calls[0].ExpressionAttributeValues[':owner'];

  assert.deepEqual(ownerA, { S: `${UUID_A}::${UUID_A}` });
  assert.deepEqual(ownerB, { S: `${UUID_B}::${UUID_B}` });
  assert.notDeepEqual(ownerA, ownerB);
});

test('invalid identity fails before DynamoDB access', async () => {
  const db = makeSend();

  await assert.rejects(
    () =>
      readFoodEntries(
        {
          verifiedSubject: 'attacker-controlled',
          from: '2026-10-01',
          to: '2026-10-02',
        },
        { tableName: TABLE_NAME, send: db.send },
      ),
    /identity|subject/i,
  );

  assert.equal(db.calls.length, 0);
});

test('invalid or excessive date ranges fail before DynamoDB access', async () => {
  for (const [from, to] of [
    ['not-a-date', '2026-10-02'],
    ['2026-10-02', 'not-a-date'],
    ['2026-10-10', '2026-10-01'],
    ['2026-01-01', '2026-12-31'],
  ]) {
    const db = makeSend();

    await assert.rejects(
      () =>
        readFoodEntries(
          {
            verifiedSubject: SUBJECT_A,
            from,
            to,
          },
          { tableName: TABLE_NAME, send: db.send },
        ),
      /date|range/i,
    );

    assert.equal(db.calls.length, 0);
  }
});

test('missing server configuration fails before DynamoDB access', async () => {
  const db = makeSend();

  await assert.rejects(
    () =>
      readFoodEntries(
        {
          verifiedSubject: SUBJECT_A,
          from: '2026-10-01',
          to: '2026-10-02',
        },
        { tableName: '', send: db.send },
      ),
    /config/i,
  );

  assert.equal(db.calls.length, 0);
});

test('malformed DynamoDB rows fail closed and do not expose extra attributes', async () => {
  const malformedRows = [
    { date: { S: '2026-10-01' }, name: { S: 'Apple' } },
    {
      date: { S: '2026-10-01' },
      name: { S: 'Apple' },
      calories: { S: '95' },
    },
    {
      date: { S: 'bad-date' },
      name: { S: 'Apple' },
      calories: { N: '95' },
    },
    {
      date: { S: '2026-10-01' },
      name: { S: '' },
      calories: { N: '95' },
    },
  ];

  for (const row of malformedRows) {
    const db = makeSend([row]);

    await assert.rejects(
      () =>
        readFoodEntries(
          {
            verifiedSubject: SUBJECT_A,
            from: '2026-10-01',
            to: '2026-10-02',
          },
          { tableName: TABLE_NAME, send: db.send },
        ),
      /row|data/i,
    );
  }
});

test('pagination preserves the owner constraint and enforces a hard 100-result cap', async () => {
  const calls: any[] = [];

  const makeRows = (count: number, offset: number) =>
    Array.from({ length: count }, (_, index) => ({
      date: { S: '2026-10-10' },
      name: { S: `Food ${offset + index}` },
      calories: { N: '100' },
    }));

  const pages = [
    {
      Items: makeRows(60, 0),
      LastEvaluatedKey: {
        id: { S: 'page-2' },
      },
    },
    {
      Items: makeRows(40, 60),
      LastEvaluatedKey: {
        id: { S: 'page-3-must-not-be-read' },
      },
    },
  ];

  const send = async (command: any) => {
    calls.push(command.input);

    const page = pages.shift();

    if (!page) {
      throw new Error('Unexpected third DynamoDB query');
    }

    return page;
  };

  const result = await readFoodEntries(
    {
      verifiedSubject: SUBJECT_A,
      from: '2026-10-01',
      to: '2026-10-15',
    },
    {
      tableName: TABLE_NAME,
      send,
    },
  );

  assert.equal(result.length, 100);
  assert.equal(calls.length, 2);

  assert.equal(calls[0].Limit, 100);
  assert.equal(calls[1].Limit, 40);

  assert.equal(calls[0].ExclusiveStartKey, undefined);
  assert.deepEqual(calls[1].ExclusiveStartKey, {
    id: { S: 'page-2' },
  });

  for (const call of calls) {
    assert.equal(
      call.KeyConditionExpression,
      '#owner = :owner AND #date BETWEEN :from AND :to',
    );

    assert.deepEqual(
      call.ExpressionAttributeValues[':owner'],
      { S: `${UUID_A}::${UUID_A}` },
    );

    assert.deepEqual(
      call.ExpressionAttributeValues[':from'],
      { S: '2026-10-01' },
    );

    assert.deepEqual(
      call.ExpressionAttributeValues[':to'],
      { S: '2026-10-15' },
    );
  }
});

test('runtime index name matches the IAM-authorized index exactly', async () => {
  const { FOOD_ENTRY_READ_INDEX_NAME: IAM_INDEX_NAME } =
    await import('./food-entry-read-policy.ts');

  assert.equal(
    FOOD_ENTRY_READ_INDEX_NAME,
    IAM_INDEX_NAME,
  );
});
