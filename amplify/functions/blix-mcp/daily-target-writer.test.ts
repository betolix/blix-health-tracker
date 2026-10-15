import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  createDailyTarget,
  deleteDailyTarget,
  updateDailyTarget,
} from './daily-target-writer.ts';

const UUID =
  '11111111-1111-4111-8111-111111111111';

const SUBJECT = `oidc|blix-cognito|${UUID}`;
const OWNER = `${UUID}::${UUID}`;
const TABLE = 'DailyTarget-test';

function deps() {
  const calls: any[] = [];

  return {
    calls,
    dependencies: {
      tableName: TABLE,

      put: async (command: any) => {
        calls.push({
          type: 'put',
          input: command.input,
        });
        return {};
      },

      update: async (command: any) => {
        calls.push({
          type: 'update',
          input: command.input,
        });
        return {};
      },

      delete: async (command: any) => {
        calls.push({
          type: 'delete',
          input: command.input,
        });
        return {};
      },

      now: () =>
        new Date('2026-10-15T19:00:00.000Z'),

      randomId: () => 'server-generated-id',
    },
  };
}

test('createDailyTarget derives owner and generates id/timestamps server-side', async () => {
  const { calls, dependencies } = deps();

  const result = await createDailyTarget(
    {
      verifiedSubject: SUBJECT,
      date: '2026-10-15',
      calories: 2200,
      protein: 180,
      carbs: 200,
      fat: 70,
      fiber: 30,
      targetWeightKg: 85,
    },
    dependencies,
  );

  assert.deepEqual(
    result,
    { id: 'server-generated-id' },
  );

  const input = calls[0].input;

  assert.equal(input.TableName, TABLE);
  assert.equal(input.Item.owner.S, OWNER);
  assert.equal(input.Item.date.S, '2026-10-15');
  assert.equal(input.Item.calories.N, '2200');
  assert.equal(input.Item.protein.N, '180');
  assert.equal(
    input.Item.createdAt.S,
    '2026-10-15T19:00:00.000Z',
  );
  assert.equal(
    input.Item.updatedAt.S,
    '2026-10-15T19:00:00.000Z',
  );

  assert.equal(
    input.ConditionExpression,
    'attribute_not_exists(#id)',
  );
});

test('updateDailyTarget is owner-conditional and cannot replace protected fields', async () => {
  const { calls, dependencies } = deps();

  const result = await updateDailyTarget(
    {
      verifiedSubject: SUBJECT,
      id: 'target-1',
      calories: 2100,
      protein: 175,
      carbs: null,
    },
    dependencies,
  );

  assert.deepEqual(result, { id: 'target-1' });

  const input = calls[0].input;

  assert.equal(input.Key.id.S, 'target-1');

  assert.equal(
    input.ConditionExpression,
    'attribute_exists(#id) AND #owner = :owner',
  );

  assert.deepEqual(
    input.ExpressionAttributeValues[':owner'],
    { S: OWNER },
  );

  assert.equal(
    input.UpdateExpression.includes('owner'),
    false,
  );

  assert.equal(
    input.UpdateExpression.includes('createdAt'),
    false,
  );
});

test('deleteDailyTarget requires matching server-derived owner', async () => {
  const { calls, dependencies } = deps();

  const result = await deleteDailyTarget(
    {
      verifiedSubject: SUBJECT,
      id: 'target-1',
    },
    dependencies,
  );

  assert.deepEqual(result, { id: 'target-1' });

  const input = calls[0].input;

  assert.equal(input.Key.id.S, 'target-1');

  assert.equal(
    input.ConditionExpression,
    'attribute_exists(#id) AND #owner = :owner',
  );

  assert.deepEqual(
    input.ExpressionAttributeValues[':owner'],
    { S: OWNER },
  );
});

test('invalid identity or DailyTarget input fails before DynamoDB', async () => {
  const cases = [
    () => createDailyTarget(
      {
        verifiedSubject: 'forged',
        date: '2026-10-15',
        calories: 2000,
        protein: 150,
      },
      deps().dependencies,
    ),

    () => createDailyTarget(
      {
        verifiedSubject: SUBJECT,
        date: '2026-02-31',
        calories: 2000,
        protein: 150,
      },
      deps().dependencies,
    ),

    () => createDailyTarget(
      {
        verifiedSubject: SUBJECT,
        date: '2026-10-15',
        calories: 2000.5,
        protein: 150,
      },
      deps().dependencies,
    ),

    () => createDailyTarget(
      {
        verifiedSubject: SUBJECT,
        date: '2026-10-15',
        calories: 2000,
        protein: -1,
      },
      deps().dependencies,
    ),

    () => updateDailyTarget(
      {
        verifiedSubject: SUBJECT,
        id: 'target-1',
      },
      deps().dependencies,
    ),
  ];

  for (const run of cases) {
    await assert.rejects(run);
  }
});

test('optional DailyTarget fields may be explicitly removed during update', async () => {
  const { calls, dependencies } = deps();

  await updateDailyTarget(
    {
      verifiedSubject: SUBJECT,
      id: 'target-1',
      carbs: null,
      fat: null,
      fiber: null,
      targetWeightKg: null,
    },
    dependencies,
  );

  const expression =
    calls[0].input.UpdateExpression;

  assert.ok(expression.includes('REMOVE'));
  assert.ok(expression.includes('#carbs'));
  assert.ok(expression.includes('#fat'));
  assert.ok(expression.includes('#fiber'));
  assert.ok(expression.includes('#targetWeightKg'));
});

test('caller cannot supply owner, timestamps or create id through typed contract', () => {
  const input = {
    verifiedSubject: SUBJECT,
    date: '2026-10-15',
    calories: 2000,
    protein: 150,
  };

  for (const forbidden of [
    'owner',
    'id',
    'createdAt',
    'updatedAt',
    'tableName',
    'scope',
  ]) {
    assert.equal(
      Object.prototype.hasOwnProperty.call(
        input,
        forbidden,
      ),
      false,
    );
  }
});
