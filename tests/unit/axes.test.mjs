import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  AXES, AXIS_EDGES, ROGERS_CATEGORY_EDGES, ROGERS_SHARES, SAMR_BAND_EDGES, axisBand, bandIndex, clampValue, isAxis,
  pixelFromValue, rogersCategory, rogersCurve, rogersCurveHeight, rogersZ, samrBand, stackLevels, valueFromPixel,
} from '../../public/js/lib/axes.js';

test('isAxis accepts only samr and rogers', () => {
  assert.ok(isAxis('samr'));
  assert.ok(isAxis('rogers'));
  assert.ok(!isAxis('SAMR'));
  assert.ok(!isAxis(undefined));
});

test('clampValue rounds and clamps to 0..100', () => {
  assert.equal(clampValue(49.5), 50);
  assert.equal(clampValue(-3), 0);
  assert.equal(clampValue(140), 100);
  assert.throws(() => clampValue(NaN), TypeError);
  assert.throws(() => clampValue('50'), TypeError);
});

test('valueFromPixel maps the axis ends and midpoint', () => {
  assert.equal(valueFromPixel(0, 400), 0);
  assert.equal(valueFromPixel(200, 400), 50);
  assert.equal(valueFromPixel(400, 400), 100);
  assert.equal(valueFromPixel(-20, 400), 0);
  assert.equal(valueFromPixel(999, 400), 100);
  assert.throws(() => valueFromPixel(10, 0), RangeError);
});

test('pixelFromValue and valueFromPixel round-trip every integer value', () => {
  for (let v = 0; v <= 100; v += 1) assert.equal(valueFromPixel(pixelFromValue(v, 437), 437), v);
});

test('SAMR bands follow min(3, floor(v / 25))', () => {
  for (let v = 0; v <= 100; v += 1) assert.equal(bandIndex(v, SAMR_BAND_EDGES), Math.min(3, Math.floor(v / 25)), `v=${v}`);
});

test('Rogers categories use the 16.67/33.33/50/66.67 thresholds', () => {
  const expected = (v) => (v < 16.67 ? 0 : v < 33.33 ? 1 : v < 50 ? 2 : v < 66.67 ? 3 : 4);
  for (let v = 0; v <= 100; v += 1) assert.equal(bandIndex(v, ROGERS_CATEGORY_EDGES), expected(v), `v=${v}`);
  assert.equal(bandIndex(16, ROGERS_CATEGORY_EDGES), 0);
  assert.equal(bandIndex(17, ROGERS_CATEGORY_EDGES), 1);
  assert.equal(bandIndex(18, ROGERS_CATEGORY_EDGES), 1);
  assert.equal(bandIndex(66, ROGERS_CATEGORY_EDGES), 3);
  assert.equal(bandIndex(67, ROGERS_CATEGORY_EDGES), 4);
  assert.equal(bandIndex(100, ROGERS_CATEGORY_EDGES), 4);
});

test('AXIS_EDGES covers both axes from 0 to 100', () => {
  for (const axis of AXES) {
    const edges = AXIS_EDGES[axis];
    assert.equal(edges[0], 0);
    assert.equal(edges.at(-1), 100);
  }
});

// The exact boundary values.
test('samrBand: 0, 24, 25, 74, 75, 100 give bands 0, 0, 1, 2, 3, 3', () => {
  const cases = [[0, 0], [24, 0], [25, 1], [74, 2], [75, 3], [100, 3]];
  for (const [v, band] of cases) {
    assert.equal(samrBand(v), band, `v=${v}`);
    assert.equal(axisBand('samr', v), band, `v=${v}`);
  }
});

test('rogersCategory: 16 .. 67 give the expected categories', () => {
  const [INNOVATORS, EARLY_ADOPTERS, EARLY_MAJORITY, LATE_MAJORITY, LAGGARDS] = [0, 1, 2, 3, 4];
  const cases = [
    [16, INNOVATORS], [17, EARLY_ADOPTERS], [33, EARLY_ADOPTERS], [34, EARLY_MAJORITY],
    [49, EARLY_MAJORITY], [50, LATE_MAJORITY], [66, LATE_MAJORITY], [67, LAGGARDS],
  ];
  for (const [v, category] of cases) {
    assert.equal(rogersCategory(v), category, `v=${v}`);
    assert.equal(axisBand('rogers', v), category, `v=${v}`);
  }
  assert.throws(() => axisBand('bloom', 50), RangeError);
});

test('pixel to value: known pixels on a 600 px axis', () => {
  const cases = [[0, 0], [6, 1], [150, 25], [149, 25], [147, 25], [146, 24], [372, 62], [597, 100], [600, 100]];
  for (const [px, v] of cases) assert.equal(valueFromPixel(px, 600), v, `px=${px}`);
});

test('value to pixel: known values on a 600 px axis', () => {
  const cases = [[0, 0], [1, 6], [25, 150], [62, 372], [100, 600]];
  for (const [v, px] of cases) assert.equal(pixelFromValue(v, 600), px, `v=${v}`);
  // Values outside 0..100 clamp to the axis ends.
  assert.equal(pixelFromValue(-5, 600), 0);
  assert.equal(pixelFromValue(130, 600), 600);
});

test('value -> pixel -> value round-trips on odd axis lengths', () => {
  for (const length of [101, 333, 731.5, 1200]) {
    for (let v = 0; v <= 100; v += 1) assert.equal(valueFromPixel(pixelFromValue(v, length), length), v, `${length}/${v}`);
  }
});

test('pixel -> value -> pixel stays within half a value step', () => {
  const length = 640;
  for (let px = 0; px <= length; px += 0.5) {
    const back = pixelFromValue(valueFromPixel(px, length), length);
    assert.ok(Math.abs(back - px) <= length / 200 + 1e-9, `px=${px} back=${back}`);
  }
});

test('Rogers curve: z, height and shares', () => {
  assert.equal(rogersZ(0), -3);
  assert.equal(rogersZ(50), 0);
  assert.equal(rogersZ(100), 3);
  assert.equal(rogersCurveHeight(50), 1);
  assert.ok(Math.abs(rogersCurveHeight(100 / 6 * 2) - Math.exp(-0.5)) < 1e-12); // z = -1
  assert.ok(Math.abs(rogersCurveHeight(25) - rogersCurveHeight(75)) < 1e-12); // symmetric
  const points = rogersCurve(60);
  assert.equal(points.length, 61);
  assert.equal(points[0].v, 0);
  assert.equal(points.at(-1).v, 100);
  assert.equal(Math.max(...points.map((p) => p.h)), 1);
  assert.throws(() => rogersCurve(0), RangeError);
  assert.deepEqual([...ROGERS_SHARES], [2.5, 13.5, 34, 34, 16]);
  assert.equal(ROGERS_SHARES.reduce((a, b) => a + b, 0), 100);
});

test('stackLevels: apart stays on level 0, overlaps stack upward', () => {
  const levels = stackLevels([
    { id: 'a', x: 100, width: 60 },
    { id: 'b', x: 300, width: 60 },
    { id: 'c', x: 120, width: 60 }, // overlaps a
    { id: 'd', x: 110, width: 60 }, // overlaps a and c
    { id: 'e', x: 400, width: 60 }, // clears b by 40
  ], 4);
  assert.equal(levels.get('a'), 0);
  assert.equal(levels.get('d'), 1);
  assert.equal(levels.get('c'), 2);
  assert.equal(levels.get('b'), 0);
  assert.equal(levels.get('e'), 0);
});

test('stackLevels: a later pin drops back to a free lower level', () => {
  const levels = stackLevels([
    { id: 'a', x: 0, width: 50 },
    { id: 'b', x: 30, width: 50 },
    { id: 'c', x: 60, width: 50 }, // clears a (gap 10), overlaps b
  ]);
  assert.deepEqual([...levels.entries()].sort(), [['a', 0], ['b', 1], ['c', 0]]);
});

test('stackLevels: the gap counts as overlap, and same x keeps input order', () => {
  assert.equal(stackLevels([{ id: 'a', x: 0, width: 10 }, { id: 'b', x: 12, width: 10 }], 3).get('b'), 1);
  assert.equal(stackLevels([{ id: 'a', x: 0, width: 10 }, { id: 'b', x: 13, width: 10 }], 3).get('b'), 0);
  const same = stackLevels([{ id: 'x', x: 5, width: 10 }, { id: 'y', x: 5, width: 10 }, { id: 'z', x: 5, width: 10 }]);
  assert.deepEqual([same.get('x'), same.get('y'), same.get('z')], [0, 1, 2]);
  assert.equal(stackLevels([]).size, 0);
});
