import assert from 'node:assert/strict';
import test from 'node:test';
import { loadWeightGoal, saveWeightGoal, weightChartBounds, type WeightGoal, type WeightGoalModel } from '../src/weight-goal';

function cloud() {
  const records = new Map<string, WeightGoal>();
  const calls: { method: string; value: unknown; options: unknown }[] = [];
  let fail = false;
  const model: WeightGoalModel = {
    async get(key, options) {
      calls.push({ method: 'get', value: key, options });
      return fail ? { data: null, errors: ['unavailable'] } : { data: records.get(key.userId) ?? null };
    },
    async create(goal, options) {
      calls.push({ method: 'create', value: goal, options });
      if (fail || records.has(goal.userId)) return { data: null, errors: ['write failed'] };
      records.set(goal.userId, { ...goal });
      return { data: goal };
    },
    async update(goal, options) {
      calls.push({ method: 'update', value: goal, options });
      if (fail || !records.has(goal.userId)) return { data: null, errors: ['write failed'] };
      records.set(goal.userId, { ...goal });
      return { data: goal };
    },
  };
  return { model, records, calls, failRequests: () => { fail = true; } };
}

test('new accounts have no goal; saving requires only a user and weight', async () => {
  const c = cloud();
  assert.equal(await loadWeightGoal(c.model, 'alice'), null);
  assert.deepEqual(await saveWeightGoal(c.model, 'alice', 77.5), { userId: 'alice', targetWeightKg: 77.5 });
  assert.deepEqual(c.calls.at(-1)?.value, { userId: 'alice', targetWeightKg: 77.5 });
  assert.ok(c.calls.every(call => (call.options as { authMode: string }).authMode === 'userPool'));
});

test('separate user keys survive a new client load without changing other goals', async () => {
  const c = cloud();
  await saveWeightGoal(c.model, 'alice', 77.5);
  await saveWeightGoal(c.model, 'bob', 85);
  await saveWeightGoal(c.model, 'alice', 78);
  assert.deepEqual(await loadWeightGoal(c.model, 'alice'), { userId: 'alice', targetWeightKg: 78 });
  assert.deepEqual(await loadWeightGoal(c.model, 'bob'), { userId: 'bob', targetWeightKg: 85 });
  assert.equal(c.records.size, 2);
  assert.equal(c.calls.at(-3)?.method, 'update');
});

test('absent identity and invalid weights fail before cloud access', async () => {
  const c = cloud();
  await assert.rejects(loadWeightGoal(c.model, ''));
  for (const value of [0, -1, NaN, Infinity, -Infinity]) {
    await assert.rejects(saveWeightGoal(c.model, 'alice', value));
  }
  assert.equal(c.calls.length, 0);
});

test('read errors never become an unset goal or trigger a write', async () => {
  const c = cloud();
  c.failRequests();
  await assert.rejects(loadWeightGoal(c.model, 'alice'));
  await assert.rejects(saveWeightGoal(c.model, 'alice', 77.5));
  assert.ok(c.calls.every(call => call.method === 'get'));
});

test('failed create/update responses cannot be reported as a saved goal', async () => {
  const c = cloud();
  const denied = async () => ({ data: null, errors: ['denied'] });
  c.model.create = denied;
  await assert.rejects(saveWeightGoal(c.model, 'alice', 77.5));
  c.records.set('alice', { userId: 'alice', targetWeightKg: 80 });
  c.model.update = denied;
  await assert.rejects(saveWeightGoal(c.model, 'alice', 77.5));
  assert.equal(c.records.get('alice')?.targetWeightKg, 80);
});

test('a response for a different identity is rejected', async () => {
  const c = cloud();
  c.model.get = async () => ({ data: { userId: 'bob', targetWeightKg: 85 } });
  await assert.rejects(loadWeightGoal(c.model, 'alice'));
  await assert.rejects(saveWeightGoal(c.model, 'alice', 77.5));
  assert.equal(c.records.size, 0);
});

test('chart scale includes targets above or below measured weights, and handles unset', () => {
  assert.deepEqual(weightChartBounds([90, 91], 77.5), [76.5, 92]);
  assert.deepEqual(weightChartBounds([90, 91], 100), [89, 101]);
  assert.deepEqual(weightChartBounds([90, 91], null), [89, 92]);
});
