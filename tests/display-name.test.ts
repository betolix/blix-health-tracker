import assert from 'node:assert/strict';
import test from 'node:test';
import {
  MAX_DISPLAY_NAME_LENGTH, loadDisplayName, resolveDisplayName, saveDisplayName,
  type ProfileAuth, type UserAttributes,
} from '../src/display-name';

function account(initial: UserAttributes) {
  const attributes = { ...initial };
  const updates: unknown[] = [];
  let fail = false;
  const auth: ProfileAuth = {
    async fetchUserAttributes() {
      if (fail) throw new Error('unavailable');
      return { ...attributes };
    },
    async updateUserAttributes(input) {
      updates.push(input);
      if (fail) return { name: { isUpdated: false } };
      attributes.name = input.userAttributes.name;
      return { name: { isUpdated: true } };
    },
  };
  return { auth, attributes, updates, failRequests: () => { fail = true; } };
}

test('a saved name is shown in preference to the email', () => {
  assert.equal(resolveDisplayName({ name: 'Maria  Lopez ', email: 'maria@example.com' }), 'Maria Lopez');
  assert.equal(resolveDisplayName({ given_name: 'Sam', email: 'sam@example.com' }), 'Sam');
});

test('accounts without a name fall back to the email local part', () => {
  assert.equal(resolveDisplayName({ email: 'pat.doe@example.com' }), 'pat.doe');
  assert.equal(resolveDisplayName({ name: '   ', email: 'pat@example.com' }), 'pat');
  assert.equal(resolveDisplayName({}), null);
  assert.equal(resolveDisplayName({ email: '@example.com' }), null);
});

test('two accounts resolve to their own names', async () => {
  const first = await loadDisplayName(account({ name: 'Ana', email: 'ana@example.com' }).auth);
  const second = await loadDisplayName(account({ email: 'luis@example.com' }).auth);
  assert.deepEqual(first, { display: 'Ana', saved: 'Ana' });
  assert.deepEqual(second, { display: 'luis', saved: '' });
});

test('saving stores a normalized name on the account', async () => {
  const { auth, attributes, updates } = account({ email: 'kim@example.com' });
  assert.equal(await saveDisplayName(auth, '  Kim   Park '), 'Kim Park');
  assert.deepEqual(updates, [{ userAttributes: { name: 'Kim Park' } }]);
  assert.equal(attributes.name, 'Kim Park');
  assert.equal((await loadDisplayName(auth)).display, 'Kim Park');
});

test('empty, too long or unsaved names are rejected', async () => {
  const { auth, updates, failRequests } = account({ email: 'kim@example.com' });
  await assert.rejects(saveDisplayName(auth, '   '));
  await assert.rejects(saveDisplayName(auth, 'x'.repeat(MAX_DISPLAY_NAME_LENGTH + 1)));
  assert.equal(updates.length, 0);
  failRequests();
  await assert.rejects(saveDisplayName(auth, 'Kim'));
  await assert.rejects(loadDisplayName(auth));
});
