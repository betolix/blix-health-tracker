import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  FOOD_ENTRY_READ_INDEX_NAME,
  foodEntryReadPolicy,
} from './food-entry-read-policy.ts';

const TABLE_ARN =
  'arn:aws:dynamodb:us-east-1:111111111111:table/FoodEntry-test';

test('FoodEntry read policy grants Query only on the owner-date index', () => {
  const statement = foodEntryReadPolicy(TABLE_ARN).toStatementJson();

  assert.equal(FOOD_ENTRY_READ_INDEX_NAME, 'byOwnerAndDate');

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

test('FoodEntry read policy grants no table, wildcard, write, scan, or item-read access', () => {
  const statement = foodEntryReadPolicy(TABLE_ARN).toStatementJson();

  const actions = Array.isArray(statement.Action)
    ? statement.Action
    : [statement.Action];
  const resources = Array.isArray(statement.Resource)
    ? statement.Resource
    : [statement.Resource];

  assert.equal(resources.includes(TABLE_ARN), false);
  assert.equal(resources.some((resource) => resource.includes('*')), false);

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
