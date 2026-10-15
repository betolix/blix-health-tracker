import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  createVital,
  deleteVital,
  updateVital,
} from './vital-writer.ts';

const UUID =
  '11111111-1111-4111-8111-111111111111';

const SUBJECT = `oidc|blix-cognito|${UUID}`;
const OWNER = `${UUID}::${UUID}`;
const TABLE = 'Vital-test';

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
        new Date('2026-10-15T16:00:00.000Z'),

      randomId: () => 'server-generated-id',
    },
  };
}

test('createVital derives owner and generates id/timestamps server-side', async () => {
  const { calls, dependencies } = deps();

  const result = await createVital(
    {
      verifiedSubject: SUBJECT,
      recordedAt: '2026-10-15T12:30:00-04:00',
      weightKg: 90.5,
      systolic: 120,
      diastolic: 80,
      notes: 'test',
    },
    dependencies,
  );

  assert.deepEqual(
    result,
    { id: 'server-generated-id' },
  );

  assert.equal(calls.length, 1);

  const input = calls[0].input;

  assert.equal(input.TableName, TABLE);
  assert.equal(
    input.Item.id.S,
    'server-generated-id',
  );
  assert.equal(input.Item.owner.S, OWNER);
  assert.equal(
    input.Item.recordedAt.S,
    '2026-10-15T12:30:00-04:00',
  );
  assert.equal(
    input.Item.createdAt.S,
    '2026-10-15T16:00:00.000Z',
  );
  assert.equal(
    input.Item.updatedAt.S,
    '2026-10-15T16:00:00.000Z',
  );

  assert.equal(
    input.ConditionExpression,
    'attribute_not_exists(#id)',
  );
});

test('updateVital is owner-conditional and cannot replace protected fields', async () => {
  const { calls, dependencies } = deps();

  const result = await updateVital(
    {
      verifiedSubject: SUBJECT,
      id: 'vital-1',
      weightKg: 89.8,
      systolic: 118,
      notes: null,
    },
    dependencies,
  );

  assert.deepEqual(result, { id: 'vital-1' });

  const input = calls[0].input;

  assert.equal(input.Key.id.S, 'vital-1');

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

test('deleteVital requires matching server-derived owner', async () => {
  const { calls, dependencies } = deps();

  const result = await deleteVital(
    {
      verifiedSubject: SUBJECT,
      id: 'vital-1',
    },
    dependencies,
  );

  assert.deepEqual(result, { id: 'vital-1' });

  const input = calls[0].input;

  assert.equal(input.Key.id.S, 'vital-1');

  assert.equal(
    input.ConditionExpression,
    'attribute_exists(#id) AND #owner = :owner',
  );

  assert.deepEqual(
    input.ExpressionAttributeValues[':owner'],
    { S: OWNER },
  );
});

test('invalid identity or Vital input fails before DynamoDB', async () => {
  const cases = [
    () => createVital(
      {
        verifiedSubject: 'forged',
        recordedAt: '2026-10-15T16:00:00Z',
      },
      deps().dependencies,
    ),

    () => createVital(
      {
        verifiedSubject: SUBJECT,
        recordedAt: 'not-a-date',
      },
      deps().dependencies,
    ),

    () => createVital(
      {
        verifiedSubject: SUBJECT,
        recordedAt: '2026-10-15T16:00:00Z',
        weightKg: -1,
      },
      deps().dependencies,
    ),

    () => createVital(
      {
        verifiedSubject: SUBJECT,
        recordedAt: '2026-10-15T16:00:00Z',
        systolic: 120.5,
      },
      deps().dependencies,
    ),

    () => updateVital(
      {
        verifiedSubject: SUBJECT,
        id: 'vital-1',
      },
      deps().dependencies,
    ),
  ];

  for (const run of cases) {
    await assert.rejects(run);
  }
});

test('optional Vital fields may be explicitly removed during update', async () => {
  const { calls, dependencies } = deps();

  await updateVital(
    {
      verifiedSubject: SUBJECT,
      id: 'vital-1',
      weightKg: null,
      systolic: null,
      diastolic: null,
      notes: null,
    },
    dependencies,
  );

  const expression =
    calls[0].input.UpdateExpression;

  assert.ok(expression.includes('REMOVE'));
  assert.ok(expression.includes('#weightKg'));
  assert.ok(expression.includes('#systolic'));
  assert.ok(expression.includes('#diastolic'));
  assert.ok(expression.includes('#notes'));
});

test('caller cannot supply owner, timestamps or create id through typed contract', () => {
  const input = {
    verifiedSubject: SUBJECT,
    recordedAt: '2026-10-15T16:00:00Z',
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
