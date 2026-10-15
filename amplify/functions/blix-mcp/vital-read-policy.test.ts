import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  VITAL_READ_INDEX_NAME,
  vitalReadPolicy,
} from './vital-read-policy.ts';

const TABLE_ARN =
  'arn:aws:dynamodb:us-east-1:111111111111:table/Vital-test';

test('Vital read policy grants Query only on owner-time index', () => {
  const statement = vitalReadPolicy(TABLE_ARN).toStatementJson();

  assert.equal(VITAL_READ_INDEX_NAME, 'byOwnerAndRecordedAt');

  const actions = Array.isArray(statement.Action)
    ? statement.Action
    : [statement.Action];

  const resources = Array.isArray(statement.Resource)
    ? statement.Resource
    : [statement.Resource];

  assert.deepEqual(actions, ['dynamodb:Query']);
  assert.deepEqual(resources, [
    `${TABLE_ARN}/index/byOwnerAndRecordedAt`,
  ]);
});

test('Vital read policy grants no table, wildcard, writes, Scan or GetItem', () => {
  const statement = vitalReadPolicy(TABLE_ARN).toStatementJson();

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
