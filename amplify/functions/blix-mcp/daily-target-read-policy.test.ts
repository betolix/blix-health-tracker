import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  DAILY_TARGET_READ_INDEX_NAME,
  dailyTargetReadPolicy,
} from './daily-target-read-policy.ts';

const TABLE_ARN =
  'arn:aws:dynamodb:us-east-1:111111111111:table/DailyTarget-test';

test('DailyTarget read policy grants Query only on owner-date index', () => {
  const statement = dailyTargetReadPolicy(TABLE_ARN).toStatementJson();

  assert.equal(DAILY_TARGET_READ_INDEX_NAME, 'byOwnerAndDate');

  const actions = Array.isArray(statement.Action)
    ? statement.Action
    : [statement.Action];

  const resources = Array.isArray(statement.Resource)
    ? statement.Resource
    : [statement.Resource];

  assert.deepEqual(actions, ['dynamodb:Query']);
  assert.deepEqual(resources, [
    `${TABLE_ARN}/index/byOwnerAndDate`,
  ]);
});

test('DailyTarget read policy grants no table, wildcard, writes, Scan or GetItem', () => {
  const statement = dailyTargetReadPolicy(TABLE_ARN).toStatementJson();

  const actions = Array.isArray(statement.Action)
    ? statement.Action
    : [statement.Action];

  const resources = Array.isArray(statement.Resource)
    ? statement.Resource
    : [statement.Resource];

  assert.equal(resources.includes(TABLE_ARN), false);
  assert.equal(resources.some((r) => r.includes('*')), false);

  for (const forbidden of [
    'dynamodb:Scan',
    'dynamodb:GetItem',
    'dynamodb:BatchGetItem',
    'dynamodb:PutItem',
    'dynamodb:UpdateItem',
    'dynamodb:DeleteItem',
  ]) {
    assert.equal(actions.includes(forbidden), false);
  }
});
