// Axis values and pixel mapping. Pure: no DOM, no three.js.
// Bands and categories are for display only; stored values stay raw.

export const AXES = Object.freeze(['samr', 'rogers']);
export const VALUE_MIN = 0;
export const VALUE_MAX = 100;

/** @param {unknown} axis */
export function isAxis(axis) {
  return AXES.includes(axis);
}

/**
 * Round and clamp any finite number to an integer placement value.
 * @param {number} value
 * @returns {number}
 */
export function clampValue(value) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new TypeError(`placement value must be a finite number, got ${value}`);
  }
  return Math.min(VALUE_MAX, Math.max(VALUE_MIN, Math.round(value)));
}

/**
 * Map a pixel offset along an axis to a placement value.
 * @param {number} offset pixels from the axis start (may be outside the axis)
 * @param {number} length axis length in pixels, > 0
 * @returns {number} integer 0..100
 */
export function valueFromPixel(offset, length) {
  if (!(length > 0)) throw new RangeError('axis length must be positive');
  return clampValue((offset / length) * VALUE_MAX);
}

/**
 * Map a placement value to a pixel offset along an axis.
 * @param {number} value 0..100 (clamped)
 * @param {number} length axis length in pixels
 * @returns {number}
 */
export function pixelFromValue(value, length) {
  return (clampValue(value) / VALUE_MAX) * length;
}

/** SAMR band edges on v: four equal bands. */
export const SAMR_BAND_EDGES = Object.freeze([0, 25, 50, 75, 100]);

/** Rogers category edges on v: innovators .. laggards. */
export const ROGERS_CATEGORY_EDGES = Object.freeze([0, 16.67, 33.33, 50, 66.67, 100]);

/** Band edges per axis, for display only. */
export const AXIS_EDGES = Object.freeze({ samr: SAMR_BAND_EDGES, rogers: ROGERS_CATEGORY_EDGES });

/**
 * Index of the band a value falls in: the last band whose lower edge is <= value.
 * Each band includes its lower edge and excludes its upper edge; the last band includes 100.
 * @param {number} value 0..100 (clamped)
 * @param {readonly number[]} edges ascending, from 0 to 100
 * @returns {number} 0 .. edges.length - 2
 */
export function bandIndex(value, edges) {
  const v = clampValue(value);
  let index = 0;
  for (let i = 1; i < edges.length - 1; i += 1) if (v >= edges[i]) index = i;
  return index;
}

/**
 * SAMR band for a value: min(3, floor(v / 25)).
 * @param {number} value 0..100
 * @returns {0|1|2|3} Substitution, Augmentation, Modification, Redefinition
 */
export function samrBand(value) {
  return /** @type {0|1|2|3} */ (bandIndex(value, SAMR_BAND_EDGES));
}

/**
 * Rogers category for a value (thresholds 16.67, 33.33, 50, 66.67).
 * @param {number} value 0..100
 * @returns {0|1|2|3|4} innovators, early adopters, early majority, late majority, laggards
 */
export function rogersCategory(value) {
  return /** @type {0|1|2|3|4} */ (bandIndex(value, ROGERS_CATEGORY_EDGES));
}

/** Band or category index for a value on either axis. */
export function axisBand(axis, value) {
  if (!isAxis(axis)) throw new RangeError(`unknown axis ${axis}`);
  return bandIndex(value, AXIS_EDGES[axis]);
}

/** Share of adopters per Rogers category, in percent. */
export const ROGERS_SHARES = Object.freeze([2.5, 13.5, 34, 34, 16]);

/**
 * Standard deviations from the mean for a Rogers value: z = v * 6 / 100 - 3.
 * @param {number} value 0..100 (not rounded, so the curve can be sampled finely)
 */
export function rogersZ(value) {
  return (value * 6) / VALUE_MAX - 3;
}

/**
 * Relative height of the Rogers bell curve at a value: exp(-z^2 / 2), 1 at v = 50.
 * @param {number} value 0..100
 */
export function rogersCurveHeight(value) {
  const z = rogersZ(value);
  return Math.exp(-(z * z) / 2);
}

/**
 * Sample the bell curve evenly over 0..100, both ends included.
 * @param {number} samples number of intervals, >= 1
 * @returns {Array<{ v: number, h: number }>}
 */
export function rogersCurve(samples) {
  if (!Number.isInteger(samples) || samples < 1) throw new RangeError('samples must be a positive integer');
  const points = [];
  for (let i = 0; i <= samples; i += 1) {
    const v = (i / samples) * VALUE_MAX;
    points.push({ v, h: rogersCurveHeight(v) });
  }
  return points;
}

/**
 * Stack overlapping pins. Each item is a horizontal span
 * centred on x; an item goes on the lowest level where it overlaps no item
 * already placed there. Items are taken in order of x (ties keep input order),
 * so the result does not depend on the input order otherwise.
 * @param {Array<{ id: string, x: number, width: number }>} items
 * @param {number} [gap] minimum horizontal space between spans on one level
 * @returns {Map<string, number>} level per id, 0 = lowest
 */
export function stackLevels(items, gap = 0) {
  const sorted = items.map((item, i) => ({ ...item, i })).sort((a, b) => a.x - b.x || a.i - b.i);
  /** @type {number[]} right edge of the last span on each level */
  const rightEdges = [];
  const levels = new Map();
  for (const item of sorted) {
    const left = item.x - item.width / 2;
    let level = rightEdges.findIndex((right) => right + gap <= left);
    if (level === -1) level = rightEdges.length;
    rightEdges[level] = item.x + item.width / 2;
    levels.set(item.id, level);
  }
  return levels;
}
