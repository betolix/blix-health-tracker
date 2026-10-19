import { test } from 'node:test';
import assert from 'node:assert/strict';
import { english, spanish, translate, readLanguage, persistLanguage, formatDate, LANGUAGE_STORAGE_KEY } from '../src/i18n';

test('first visit and invalid stored values default to English', () => {
  for (const value of [null, '', 'fr', 'ES', '<script>']) {
    assert.equal(readLanguage({ getItem: () => value }), 'en');
  }
});

test('explicit choice survives reload in either direction', () => {
  const saved = new Map<string, string>();
  const storage = { getItem: (key: string) => saved.get(key) ?? null,
    setItem: (key: string, value: string) => { saved.set(key, value); } };
  for (const language of ['es', 'en'] as const) {
    persistLanguage(language, storage);
    assert.equal(saved.get(LANGUAGE_STORAGE_KEY), language);
    assert.equal(readLanguage(storage), language);
  }
});

test('unavailable storage does not break initialization or switching', () => {
  assert.equal(readLanguage({ getItem: () => { throw new Error('blocked'); } }), 'en');
  assert.doesNotThrow(() => persistLanguage('es', { setItem: () => { throw new Error('quota'); } }));
});

test('missing Spanish copy falls back to English', () => {
  const original = spanish.foodSaveError;
  try {
    spanish.foodSaveError = '';
    assert.equal(translate('es', 'foodSaveError'), english.foodSaveError);
  } finally { spanish.foodSaveError = original; }
});

test('every UI message has nonempty English and Spanish copy', () => {
  assert.deepEqual(Object.keys(spanish).sort(), Object.keys(english).sort());
  for (const key of Object.keys(english) as (keyof typeof english)[]) {
    assert.ok(translate('en', key).trim(), key);
    assert.ok(translate('es', key).trim(), key);
  }
});

test('dates use the selected language and preserve the calendar day', () => {
  assert.match(formatDate('2026-10-18', 'en'), /Oct.*18/);
  assert.match(formatDate('2026-10-18', 'es'), /18.*oct/i);
});
