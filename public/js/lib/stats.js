// Statistics for the results views. Pure: no DOM, no three.js.
//
// - Quartiles use linear interpolation between order statistics, the method
//   behind Excel's QUARTILE.INC: position (n - 1) * p in the sorted values.
// - The middle-half band (Q1 to Q3) appears only once an axis has
//   MIN_BAND_COUNT answers or more.
// - Dots stack upward where they would overlap, like the placement pins (stackLevels).

import { AXIS_EDGES, axisBand, stackLevels } from './axes.js';

/** The band appears from this many answers on (6 or more). */
export const MIN_BAND_COUNT = 6;

/** Up to this many answers, a chart's text alternative lists every value. */
export const MAX_LISTED_VALUES = 10;

function sortedNumbers(values) {
  if (!Array.isArray(values)) throw new TypeError('values must be an array');
  for (const v of values) {
    if (typeof v !== 'number' || !Number.isFinite(v)) throw new TypeError(`not a finite number: ${v}`);
  }
  return [...values].sort((a, b) => a - b);
}

/**
 * The p-quantile of a list of numbers by linear interpolation (QUARTILE.INC,
 * PERCENTILE.INC): with the values sorted, position (n - 1) * p, interpolated
 * between its neighbours.
 * @param {number[]} values any order; not changed
 * @param {number} p 0..1
 * @returns {number|null} null for an empty list
 */
export function quantile(values, p) {
  if (typeof p !== 'number' || !(p >= 0 && p <= 1)) throw new RangeError(`p must be within 0..1, got ${p}`);
  const sorted = sortedNumbers(values);
  if (sorted.length === 0) return null;
  const position = (sorted.length - 1) * p;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (position - lower);
}

/**
 * Q1, median and Q3.
 * @param {number[]} values
 * @returns {{ q1: number, median: number, q3: number }|null} null for an empty list
 */
export function quartiles(values) {
  if (sortedNumbers(values).length === 0) return null;
  return { q1: quantile(values, 0.25), median: quantile(values, 0.5), q3: quantile(values, 0.75) };
}

/**
 * The middle-half band, Q1 to Q3, or null while there are fewer than
 * MIN_BAND_COUNT answers.
 * @param {number[]} values
 * @returns {{ from: number, to: number }|null}
 */
export function middleHalf(values) {
  if (sortedNumbers(values).length < MIN_BAND_COUNT) return null;
  const q = quartiles(values);
  return { from: q.q1, to: q.q3 };
}

/**
 * Dot positions for one axis. Every answer is one dot at its value; dots
 * closer than `diameter` (in value units) stack upward. The pair's own value,
 * when given, is the first dot with that value and gets `own: true`. If no
 * answer has that value (the results do not include the pair yet), an extra
 * own dot is added, so the pair always sees their placement.
 * @param {number[]} values answers on the axis, any order
 * @param {{ diameter: number, own?: number|null }} options
 * @returns {{ dots: Array<{ value: number, level: number, own: boolean }>, levels: number }}
 *   dots in ascending value order; `levels` is the number of stack levels used (0 when empty)
 */
export function dotLayout(values, { diameter, own = null }) {
  if (!(typeof diameter === 'number' && diameter > 0)) throw new RangeError('diameter must be positive');
  const sorted = sortedNumbers(values);
  const items = sorted.map((value) => ({ value, own: false }));
  if (own !== null && own !== undefined) {
    if (typeof own !== 'number' || !Number.isFinite(own)) throw new TypeError(`own must be a finite number, got ${own}`);
    const match = items.find((item) => item.value === own);
    if (match) match.own = true;
    else items.push({ value: own, own: true });
    items.sort((a, b) => a.value - b.value);
  }
  const levels = stackLevels(items.map((item, i) => ({ id: String(i), x: item.value, width: diameter })));
  const dots = items.map((item, i) => ({ ...item, level: levels.get(String(i)) }));
  const used = dots.reduce((max, d) => Math.max(max, d.level + 1), 0);
  return { dots, levels: used };
}

/**
 * Vertical spacing between stack levels that fits `levels` levels into
 * `available` units: the dot diameter while it fits, less once it does not
 * (dots then overlap a little but stay inside the plot).
 * @param {number} levels
 * @param {number} available height for the stack above the lowest dot centre
 * @param {number} diameter
 */
export function levelStep(levels, available, diameter) {
  if (levels <= 1) return diameter;
  return Math.min(diameter, available / (levels - 1));
}

/**
 * What a chart's dots show, for its text alternative (WCAG 1.1.1): the
 * number of answers in each SAMR band or Rogers category, and the
 * sorted values themselves while there are at most MAX_LISTED_VALUES.
 * @param {'samr'|'rogers'} axis
 * @param {number[]} values any order; not changed
 * @returns {{ counts: number[], values: number[]|null }} counts per band in
 *   axis order; values null when there are too many to list
 */
export function distribution(axis, values) {
  const edges = AXIS_EDGES[axis];
  if (!edges) throw new RangeError(`unknown axis ${axis}`);
  const sorted = sortedNumbers(values);
  const counts = new Array(edges.length - 1).fill(0);
  for (const v of sorted) counts[axisBand(axis, v)] += 1;
  return { counts, values: sorted.length <= MAX_LISTED_VALUES ? sorted : null };
}
