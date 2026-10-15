import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  createFoodEntry,
  deleteFoodEntry,
  updateFoodEntry,
} from './food-entry-writer.ts';

const UUID =
  '11111111-1111-4111-8111-111111111111';
const SUBJECT = `oidc|blix-cognito|${UUID}`;
const OWNER = `${UUID}::${UUID}`;
const TABLE = 'FoodEntry-test';

function deps() {
  const calls: any[] = [];

  return {
    calls,
    dependencies: {
      tableName: TABLE,
      put: async (command: any) => {
        calls.push({ type: 'put', input: command.input });
        return {};
      },
      update: async (command: any) => {
        calls.push({ type: 'update', input: command.input });
        return {};
      },
      delete: async (command: any) => {
        calls.push({ type: 'delete', input: command.input });
        return {};
      },
      now: () => new Date('2026-10-15T16:00:00.000Z'),
      randomId: () => 'server-generated-id',
    },
  };
}

test('createFoodEntry derives owner and generates id/timestamps server-side', async () => {
  const { calls, dependencies } = deps();

  const result = await createFoodEntry(
    {
      verifiedSubject: SUBJECT,
      date: '2026-10-15',
      name: 'Chicken bowl',
      calories: 620,
      protein: 45,
      carbs: 70,
      fat: 18,
      fiber: 10,
      quantity: '1 bowl',
      notes: 'test',
      source: 'estimated',
    },
    dependencies,
  );

  assert.deepEqual(result, { id: 'server-generated-id' });
  assert.equal(calls.length, 1);

  const input = calls[0].input;

  assert.equal(input.TableName, TABLE);
  assert.equal(input.Item.id.S, 'server-generated-id');
  assert.equal(input.Item.owner.S, OWNER);
  assert.equal(input.Item.createdAt.S, '2026-10-15T16:00:00.000Z');
  assert.equal(input.Item.updatedAt.S, '2026-10-15T16:00:00.000Z');
  assert.equal(input.ConditionExpression, 'attribute_not_exists(#id)');
});

test('updateFoodEntry is owner-conditional and cannot replace protected fields', async () => {
  const { calls, dependencies } = deps();

  const result = await updateFoodEntry(
    {
      verifiedSubject: SUBJECT,
      id: 'entry-1',
      name: 'Updated meal',
      calories: 700,
      notes: null,
    },
    dependencies,
  );

  assert.deepEqual(result, { id: 'entry-1' });

  const input = calls[0].input;

  assert.equal(input.Key.id.S, 'entry-1');
  assert.equal(
    input.ConditionExpression,
    'attribute_exists(#id) AND #owner = :owner',
  );
  assert.deepEqual(
    input.ExpressionAttributeValues[':owner'],
    { S: OWNER },
  );

  assert.equal(
    Object.values(input.ExpressionAttributeNames).includes('id'),
    true,
  );
  assert.equal(
    Object.values(input.ExpressionAttributeNames).includes('owner'),
    true,
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

test('deleteFoodEntry requires matching server-derived owner', async () => {
  const { calls, dependencies } = deps();

  const result = await deleteFoodEntry(
    {
      verifiedSubject: SUBJECT,
      id: 'entry-1',
    },
    dependencies,
  );

  assert.deepEqual(result, { id: 'entry-1' });

  const input = calls[0].input;

  assert.equal(input.Key.id.S, 'entry-1');
  assert.equal(
    input.ConditionExpression,
    'attribute_exists(#id) AND #owner = :owner',
  );
  assert.deepEqual(
    input.ExpressionAttributeValues[':owner'],
    { S: OWNER },
  );
});

test('invalid identity or write input fails before DynamoDB', async () => {
  const cases = [
    () => createFoodEntry(
      {
        verifiedSubject: 'forged',
        date: '2026-10-15',
        name: 'Meal',
        calories: 100,
      },
      deps().dependencies,
    ),
    () => createFoodEntry(
      {
        verifiedSubject: SUBJECT,
        date: 'bad-date',
        name: 'Meal',
        calories: 100,
      },
      deps().dependencies,
    ),
    () => createFoodEntry(
      {
        verifiedSubject: SUBJECT,
        date: '2026-10-15',
        name: '',
        calories: 100,
      },
      deps().dependencies,
    ),
    () => createFoodEntry(
      {
        verifiedSubject: SUBJECT,
        date: '2026-10-15',
        name: 'Meal',
        calories: -1,
      },
      deps().dependencies,
    ),
    () => updateFoodEntry(
      {
        verifiedSubject: SUBJECT,
        id: 'entry-1',
      },
      deps().dependencies,
    ),
  ];

  for (const run of cases) {
    await assert.rejects(run);
  }
});

test('caller cannot supply owner, timestamps or id for create through typed contract', () => {
  const forbidden = [
    'owner',
    'id',
    'createdAt',
    'updatedAt',
    'tableName',
    'scope',
  ];

  for (const field of forbidden) {
    assert.equal(
      Object.prototype.hasOwnProperty.call(
        {
          verifiedSubject: SUBJECT,
          date: '2026-10-15',
          name: 'Meal',
          calories: 100,
        },
        field,
      ),
      false,
    );
  }
});
