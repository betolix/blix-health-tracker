import assert from 'node:assert/strict';
import { test } from 'node:test';
import { dailyTargetWritePolicy } from './daily-target-write-policy.ts';

const TABLE_ARN =
  'arn:aws:dynamodb:us-east-1:111111111111:table/DailyTarget-test';

test('DailyTarget write policy grants only create/update/delete item actions on exact table', () => {
  const statement = dailyTargetWritePolicy(TABLE_ARN).toStatementJson();

  const actions = Array.isArray(statement.Action)
    ? statement.Action
    : [statement.Action];

  const resources = Array.isArray(statement.Resource)
    ? statement.Resource
    : [statement.Resource];

  assert.deepEqual(
    new Set(actions),
    new Set([
      'dynamodb:PutItem',
      'dynamodb:UpdateItem',
      'dynamodb:DeleteItem',
    ]),
  );

  assert.deepEqual(resources, [TABLE_ARN]);
});

test('DailyTarget write policy grants no read, scan, query, batch or wildcard access', () => {
  const statement = dailyTargetWritePolicy(TABLE_ARN).toStatementJson();

  const actions = Array.isArray(statement.Action)
    ? statement.Action
    : [statement.Action];

  const resources = Array.isArray(statement.Resource)
    ? statement.Resource
    : [statement.Resource];

  assert.equal(
    resources.some((resource) => resource.includes('*')),
    false,
  );

  for (const forbidden of [
    'dynamodb:GetItem',
    'dynamodb:BatchGetItem',
    'dynamodb:Query',
    'dynamodb:Scan',
    'dynamodb:BatchWriteItem',
  ]) {
    assert.equal(actions.includes(forbidden), false);
  }
});
