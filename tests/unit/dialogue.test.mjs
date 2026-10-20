// Dialogue rules: asked state and the maxQuestions cap.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { askedCount, askedIds, canAsk, capReached, isMet, questionOptions } from '../../public/js/lib/dialogue.js';
import { createStore } from '../../public/js/lib/state.js';

const character = (maxQuestions) => ({
  id: 'mette',
  maxQuestions,
  questions: [
    { id: 'q1', text: 'Et', answer: 'A1' },
    { id: 'q2', text: 'To', answer: 'A2' },
    { id: 'q3', text: 'Tre', answer: 'A3' },
  ],
});

function fakeStorage() {
  const data = new Map();
  return { data, getItem: (k) => (data.has(k) ? data.get(k) : null), setItem: (k, v) => data.set(k, String(v)) };
}

test('no cap (maxQuestions null): every question stays available', () => {
  const c = character(null);
  assert.equal(capReached(c, ['q1', 'q2', 'q3']), false);
  const { options, capReached: full } = questionOptions(c, ['q1', 'q2', 'q3']);
  assert.equal(full, false);
  assert.deepEqual(options.map((o) => [o.id, o.asked, o.disabled]), [['q1', true, false], ['q2', true, false], ['q3', true, false]]);
});

test('the cap disables the unasked questions once reached, asked ones stay open', () => {
  const c = character(2);
  assert.equal(capReached(c, []), false);
  assert.equal(capReached(c, ['q1']), false);
  assert.equal(canAsk(c, ['q1'], 'q3'), true);
  assert.equal(capReached(c, ['q1', 'q3']), true);
  const { options, capReached: full } = questionOptions(c, ['q3', 'q1']);
  assert.equal(full, true);
  assert.deepEqual(options.map((o) => [o.id, o.asked, o.disabled]), [['q1', true, false], ['q2', false, true], ['q3', true, false]]);
  assert.equal(canAsk(c, ['q1', 'q3'], 'q2'), false);
  assert.equal(canAsk(c, ['q1', 'q3'], 'q1'), true, 'asking again costs nothing');
  assert.equal(canAsk(c, [], 'q9'), false, 'unknown question');
});

test('a cap of 0 disables every question; a cap above the count never bites', () => {
  assert.ok(questionOptions(character(0), []).options.every((o) => o.disabled));
  assert.equal(capReached(character(5), ['q1', 'q2', 'q3']), false);
});

test('asked ids that are no longer in the content do not count toward the cap', () => {
  const c = character(1);
  assert.equal(askedCount(c, ['gone', 'q1', 'q1']), 1);
  assert.equal(capReached(c, ['gone']), false);
});

test('met and asked are read per character from the stored state', () => {
  const store = createStore({ storage: fakeStorage(), key: 'k' });
  assert.equal(isMet(store.getState(), 'mette'), false);
  assert.deepEqual(askedIds(store.getState(), 'mette'), []);
  store.markMet('mette');
  store.markAsked('mette', 'q2');
  store.markAsked('mette', 'q1');
  store.markAsked('mette', 'q2');
  store.markAsked('jonas', 'q1');
  const state = store.getState();
  assert.equal(isMet(state, 'mette'), true);
  assert.equal(isMet(state, 'jonas'), false);
  assert.deepEqual(askedIds(state, 'mette'), ['q2', 'q1']);
  assert.deepEqual(askedIds(state, 'jonas'), ['q1']);
  assert.deepEqual(askedIds(state, 'constructor'), [], 'no prototype keys');
});

test('asked state and the cap survive a reload of the store', () => {
  const storage = fakeStorage();
  const first = createStore({ storage, key: 'k' });
  first.markMet('mette');
  first.markAsked('mette', 'q1');
  first.markAsked('mette', 'q3');
  const second = createStore({ storage, key: 'k' });
  const asked = askedIds(second.getState(), 'mette');
  assert.deepEqual(asked, ['q1', 'q3']);
  assert.equal(capReached(character(2), asked), true);
});
