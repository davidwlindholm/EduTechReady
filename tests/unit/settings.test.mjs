// Display settings: own storage key, defaults, validation and
// in-memory fallback when storage fails.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SETTINGS_KEY, createSettings, normalizeSettings } from '../../public/js/lib/settings.js';

function memoryStorage(initial = {}) {
  const data = new Map(Object.entries(initial));
  return {
    data,
    getItem: (k) => (data.has(k) ? data.get(k) : null),
    setItem: (k, v) => data.set(k, String(v)),
  };
}

test('the settings key is separate from the game state keys', () => {
  assert.equal(SETTINGS_KEY, 'lounge:settings:v1');
  assert.ok(!SETTINGS_KEY.startsWith('lounge:v1:'));
});

test('shadows default to on and persist when turned off', () => {
  const storage = memoryStorage();
  const settings = createSettings({ storage });
  assert.deepEqual(settings.get(), { shadows: true });
  settings.set({ shadows: false });
  assert.deepEqual(JSON.parse(storage.data.get(SETTINGS_KEY)), { shadows: false });
  assert.deepEqual(createSettings({ storage }).get(), { shadows: false });
});

test('stored junk falls back to the defaults', () => {
  assert.deepEqual(normalizeSettings(null), { shadows: true });
  assert.deepEqual(normalizeSettings([false]), { shadows: true });
  assert.deepEqual(normalizeSettings({ shadows: 'no', extra: 1 }), { shadows: true });
  const storage = memoryStorage({ [SETTINGS_KEY]: '{not json' });
  const errors = [];
  assert.deepEqual(createSettings({ storage, onStorageError: (e) => errors.push(e) }).get(), { shadows: true });
  assert.equal(errors.length, 1);
});

test('without working storage the settings live in memory', () => {
  const failing = {
    getItem() { throw new Error('denied'); },
    setItem() { throw new Error('denied'); },
  };
  const errors = [];
  const settings = createSettings({ storage: failing, onStorageError: (e) => errors.push(e) });
  settings.set({ shadows: false });
  assert.deepEqual(settings.get(), { shadows: false });
  assert.equal(errors.length, 2);
  const none = createSettings({ storage: null });
  none.set({ shadows: false });
  assert.deepEqual(none.get(), { shadows: false });
});
