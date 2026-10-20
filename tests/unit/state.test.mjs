import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createInitialState, createStore, normalizeState, storageKey } from '../../public/js/lib/state.js';

// The store keeps its keyed maps without a prototype; getState() hands out
// plain copies. Compare plain copies so deepStrictEqual ignores prototypes.
const plain = (value) => structuredClone(value);
const UUID_A = '6f1c2a7e-3b4d-4c5e-8f90-a1b2c3d4e5f6';
const UUID_B = '0e6a3f52-9c1b-4d7e-a2f4-5b6c7d8e9f01';

function fakeStorage(initial = {}) {
  const data = new Map(Object.entries(initial));
  return {
    data,
    getItem: (k) => (data.has(k) ? data.get(k) : null),
    setItem: (k, v) => data.set(k, String(v)),
  };
}

const throwingStorage = {
  getItem() { throw new Error('SecurityError'); },
  setItem() { throw new Error('QuotaExceededError'); },
};

test('storage keys are lounge:v1:<code>, practice without a code', () => {
  assert.equal(storageKey(null), 'lounge:v1:practice');
  assert.equal(storageKey('K7MP3Q'), 'lounge:v1:K7MP3Q');
});

test('a fresh store has the expected shape and is persisted', () => {
  const storage = fakeStorage();
  const store = createStore({ storage, key: 'lounge:v1:practice' });
  assert.deepEqual(store.getState(), plain(createInitialState()));
  assert.deepEqual(JSON.parse(storage.data.get('lounge:v1:practice')), plain(createInitialState()));
});

test('createClientId is used only when no clientId is stored', () => {
  const storage = fakeStorage();
  const a = createStore({ storage, key: 'k', createClientId: () => UUID_A });
  assert.equal(a.getState().clientId, UUID_A);
  const b = createStore({ storage, key: 'k', createClientId: () => UUID_B });
  assert.equal(b.getState().clientId, UUID_A);
});

test('met, asked and placements persist across store instances', () => {
  const storage = fakeStorage();
  const a = createStore({ storage, key: 'k' });
  a.markMet('mette');
  a.markMet('mette');
  a.markAsked('mette', 'q1');
  a.markAsked('mette', 'q1');
  a.setPlacement('mette', 'samr', 49.6);
  const b = createStore({ storage, key: 'k' });
  assert.deepEqual(b.getState().met, ['mette']);
  assert.deepEqual(b.getState().asked, { mette: ['q1'] });
  assert.deepEqual(b.getState().placements, { mette: { samr: 50, rogers: null } });
});

test('setPlacement clamps, accepts null and rejects bad input', () => {
  const store = createStore({ storage: null, key: 'k' });
  store.setPlacement('a', 'rogers', 140);
  assert.equal(store.getState().placements.a.rogers, 100);
  store.setPlacement('a', 'rogers', null);
  assert.equal(store.getState().placements.a.rogers, null);
  assert.throws(() => store.setPlacement('a', 'other', 5), RangeError);
  assert.throws(() => store.setPlacement('', 'samr', 5), TypeError);
  assert.throws(() => store.setPlacement('a', 'samr', '5'), TypeError);
});

test('getState returns a copy the caller cannot use to mutate the store', () => {
  const store = createStore({ storage: null, key: 'k' });
  store.getState().met.push('x');
  assert.deepEqual(store.getState().met, []);
});

test('subscribers hear each change once', () => {
  const store = createStore({ storage: null, key: 'k' });
  const seen = [];
  const off = store.subscribe((s) => seen.push(s.met.length));
  store.markMet('a');
  store.markMet('a');
  off();
  store.markMet('b');
  assert.deepEqual(seen, [1]);
});

test('a throwing storage falls back to memory and reports the errors', () => {
  const errors = [];
  const store = createStore({ storage: throwingStorage, key: 'k', onStorageError: (e) => errors.push(e.message) });
  store.markMet('a');
  assert.deepEqual(store.getState().met, ['a']);
  assert.ok(errors.includes('SecurityError'));
  assert.ok(errors.includes('QuotaExceededError'));
});

test('corrupt or hostile stored values are normalised', () => {
  const storage = fakeStorage({ k: '{not json' });
  assert.deepEqual(createStore({ storage, key: 'k' }).getState(), plain(createInitialState()));
  const raw = {
    clientId: 7,
    met: ['a', 3],
    asked: { a: ['q1', 'q1'], b: 'q2' },
    placements: { a: { samr: 101, rogers: 20 }, b: { samr: 2.5 }, c: null },
    submitted: 'yes',
  };
  assert.deepEqual(plain(normalizeState(raw)), {
    clientId: null,
    met: [],
    asked: { a: ['q1'] },
    placements: { a: { samr: null, rogers: 20 }, b: { samr: null, rogers: null } },
    submitted: false,
    submittedAt: null,
  });
});

test('an invalid stored clientId is replaced, unless the pair has submitted', () => {
  const stored = (state) => fakeStorage({ k: JSON.stringify({ met: [], ...state }) });
  for (const bad of ['id-1', UUID_A.toUpperCase(), '6f1c2a7e-3b4d-1c5e-8f90-a1b2c3d4e5f6', `${UUID_A}\n`, 42]) {
    const store = createStore({ storage: stored({ clientId: bad }), key: 'k', createClientId: () => UUID_B });
    assert.equal(store.getState().clientId, UUID_B, String(bad));
  }
  const kept = createStore({ storage: stored({ clientId: UUID_A }), key: 'k', createClientId: () => UUID_B });
  assert.equal(kept.getState().clientId, UUID_A);
  const submitted = createStore({
    storage: stored({ clientId: 'id-1', submitted: true, submittedAt: 'x' }), key: 'k', createClientId: () => UUID_B,
  });
  assert.equal(submitted.getState().clientId, 'id-1');
});

test('hostile ids are plain keys and unknown ids are dropped', () => {
  const text = '{"met":["mette","__proto__","ghost"],"asked":{"__proto__":["q1"],"constructor":["q2"],"mette":["q1"]},'
    + '"placements":{"__proto__":{"samr":5,"rogers":5},"constructor":{"samr":1,"rogers":2},"mette":{"samr":3,"rogers":4}}}';
  const loose = normalizeState(JSON.parse(text));
  assert.equal(Object.getPrototypeOf(loose.placements), null);
  assert.deepEqual(Object.keys(loose.placements).sort(), ['__proto__', 'constructor', 'mette']);
  assert.equal(({}).polluted, undefined);

  const store = createStore({ storage: fakeStorage({ k: text }), key: 'k', knownIds: ['mette', 'jonas'] });
  const state = store.getState();
  assert.deepEqual(state.met, ['mette']);
  assert.deepEqual(Object.keys(state.asked), ['mette']);
  assert.deepEqual(state.placements, { mette: { samr: 3, rogers: 4 } });
  // A fresh store finds nothing inherited under these names.
  const fresh = createStore({ storage: null, key: 'k' });
  fresh.markAsked('constructor', 'q1');
  fresh.setPlacement('constructor', 'samr', 10);
  assert.deepEqual(fresh.getState().asked, { constructor: ['q1'] });
  assert.deepEqual(fresh.getState().placements, { constructor: { samr: 10, rogers: null } });
});

test('removing a placement that does not exist stores nothing', () => {
  const storage = fakeStorage();
  const store = createStore({ storage, key: 'k' });
  const before = storage.data.get('k');
  store.setPlacement('mette', 'samr', null);
  assert.equal(storage.data.get('k'), before);
  assert.deepEqual(store.getState().placements, {});
});

test('markSubmitted sets submitted and submittedAt once and persists them', () => {
  const storage = fakeStorage();
  const a = createStore({ storage, key: 'k' });
  const seen = [];
  a.subscribe((s) => seen.push(s.submitted));
  a.markSubmitted('2026-10-15T10:00:00.000Z');
  a.markSubmitted('2026-10-15T11:00:00.000Z');
  assert.deepEqual(seen, [true]);
  const b = createStore({ storage, key: 'k' });
  assert.equal(b.getState().submitted, true);
  assert.equal(b.getState().submittedAt, '2026-10-15T10:00:00.000Z');
});
