import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MAX_LISTED_VALUES, MIN_BAND_COUNT, distribution, dotLayout, levelStep, middleHalf, quantile, quartiles } from '../../public/js/lib/stats.js';

const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} != ${expected}`);

// Expected values are what Excel's QUARTILE.INC (and numpy's default
// "linear" percentile) give for the same lists.
test('quartiles match QUARTILE.INC for 1..10', () => {
  const q = quartiles([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  close(q.q1, 3.25);
  close(q.median, 5.5);
  close(q.q3, 7.75);
});

test('quartiles match QUARTILE.INC for an uneven list in any order', () => {
  const values = [41, 7, 39, 15, 40, 36];
  const q = quartiles(values);
  close(q.q1, 20.25);
  close(q.median, 37.5);
  close(q.q3, 39.75);
  assert.deepEqual(values, [41, 7, 39, 15, 40, 36], 'input not changed');
});

test('quartiles of seven placements (the e2e seed shape)', () => {
  // sorted: 10 20 30 40 50 60 70 -> positions 1.5, 3, 4.5
  const q = quartiles([70, 10, 50, 30, 20, 60, 40]);
  close(q.q1, 25);
  close(q.median, 40);
  close(q.q3, 55);
});

test('quartiles at the edges: one value, two values, ties', () => {
  assert.deepEqual(quartiles([42]), { q1: 42, median: 42, q3: 42 });
  const two = quartiles([0, 100]);
  close(two.q1, 25);
  close(two.median, 50);
  close(two.q3, 75);
  assert.deepEqual(quartiles([5, 5, 5, 5, 5, 5]), { q1: 5, median: 5, q3: 5 });
  assert.equal(quartiles([]), null);
});

test('quantile covers 0 and 1 and rejects bad input', () => {
  assert.equal(quantile([3, 1, 2], 0), 1);
  assert.equal(quantile([3, 1, 2], 1), 3);
  assert.equal(quantile([], 0.5), null);
  assert.throws(() => quantile([1], 1.5), RangeError);
  assert.throws(() => quantile([1], Number.NaN), RangeError);
  assert.throws(() => quantile([1, '2'], 0.5), TypeError);
  assert.throws(() => quantile([1, Number.NaN], 0.5), TypeError);
  assert.throws(() => quantile('12', 0.5), TypeError);
});

test('middle-half band appears from 6 answers on', () => {
  assert.equal(MIN_BAND_COUNT, 6);
  assert.equal(middleHalf([]), null);
  assert.equal(middleHalf([10, 20, 30]), null);
  assert.equal(middleHalf([10, 20, 30, 40, 50]), null);
  const band = middleHalf([7, 15, 36, 39, 40, 41]);
  close(band.from, 20.25);
  close(band.to, 39.75);
  const seven = middleHalf([10, 20, 30, 40, 50, 60, 70]);
  close(seven.from, 25);
  close(seven.to, 55);
});

test('dotLayout: one dot per answer, sorted, overlapping dots stack', () => {
  const { dots, levels } = dotLayout([50, 10, 51, 52, 90], { diameter: 3 });
  assert.deepEqual(dots.map((d) => d.value), [10, 50, 51, 52, 90]);
  assert.deepEqual(dots.map((d) => d.level), [0, 0, 1, 2, 0]);
  assert.equal(levels, 3);
  assert.ok(dots.every((d) => d.own === false));
});

test('dotLayout: dots exactly one diameter apart share a level; equal values stack', () => {
  assert.deepEqual(dotLayout([10, 13, 16], { diameter: 3 }).dots.map((d) => d.level), [0, 0, 0]);
  assert.deepEqual(dotLayout([40, 40, 40], { diameter: 3 }).dots.map((d) => d.level), [0, 1, 2]);
  // A level frees up again once the dot left of it is far enough away.
  assert.deepEqual(dotLayout([40, 41, 44], { diameter: 3 }).dots.map((d) => d.level), [0, 1, 0]);
});

test('dotLayout: the own value marks exactly one matching dot', () => {
  const { dots } = dotLayout([30, 30, 60], { diameter: 3, own: 30 });
  assert.equal(dots.length, 3);
  assert.deepEqual(dots.map((d) => d.own), [true, false, false]);
});

test('dotLayout: an own value missing from the answers is added as an extra dot', () => {
  const { dots, levels } = dotLayout([20, 80], { diameter: 3, own: 21 });
  assert.deepEqual(dots.map((d) => [d.value, d.own, d.level]), [[20, false, 0], [21, true, 1], [80, false, 0]]);
  assert.equal(levels, 2);
});

test('dotLayout: practice mode (no answers, own only) and empty input', () => {
  assert.deepEqual(dotLayout([], { diameter: 3, own: 64 }), { dots: [{ value: 64, own: true, level: 0 }], levels: 1 });
  assert.deepEqual(dotLayout([], { diameter: 3 }), { dots: [], levels: 0 });
  assert.deepEqual(dotLayout([5], { diameter: 3, own: null }).dots, [{ value: 5, own: false, level: 0 }]);
  assert.throws(() => dotLayout([5], { diameter: 0 }), RangeError);
  assert.throws(() => dotLayout([5], { diameter: 3, own: 'x' }), TypeError);
});

test('levelStep keeps the diameter while the stack fits, then shrinks', () => {
  assert.equal(levelStep(0, 40, 10), 10);
  assert.equal(levelStep(1, 40, 10), 10);
  assert.equal(levelStep(5, 40, 10), 10);
  assert.equal(levelStep(9, 40, 10), 5);
});

test('distribution: no answers gives zero counts and an empty list', () => {
  assert.deepEqual(distribution('samr', []), { counts: [0, 0, 0, 0], values: [] });
  assert.deepEqual(distribution('rogers', []), { counts: [0, 0, 0, 0, 0], values: [] });
});

test('distribution: three answers are counted per band and listed sorted', () => {
  const input = [70, 12, 55];
  assert.deepEqual(distribution('samr', input), { counts: [1, 0, 2, 0], values: [12, 55, 70] });
  assert.deepEqual(input, [70, 12, 55], 'input unchanged');
});

test('distribution: seven answers on both axes, band edges included', () => {
  // SAMR edges 25, 50, 75; Rogers thresholds 16.67, 33.33, 50, 66.67.
  assert.deepEqual(distribution('samr', [0, 24, 25, 49, 50, 75, 100]).counts, [2, 2, 1, 2]);
  assert.deepEqual(distribution('rogers', [0, 16, 17, 33, 34, 50, 100]).counts, [2, 2, 1, 1, 1]);
  assert.equal(distribution('rogers', [0, 16, 17, 33, 34, 50, 100]).values.length, 7);
});

test('distribution: above MAX_LISTED_VALUES answers the values are not listed', () => {
  const many = Array.from({ length: MAX_LISTED_VALUES + 1 }, (_, i) => i * 9);
  const d = distribution('samr', many);
  assert.equal(d.values, null);
  assert.equal(d.counts.reduce((a, b) => a + b, 0), MAX_LISTED_VALUES + 1);
  assert.equal(distribution('samr', many.slice(0, MAX_LISTED_VALUES)).values.length, MAX_LISTED_VALUES);
  assert.throws(() => distribution('nope', [1]), RangeError);
  assert.throws(() => distribution('samr', [1, 'x']), TypeError);
});
