import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createTextLookup, formatText } from '../../public/js/lib/text.js';
import { middleHalf } from '../../public/js/lib/stats.js';
import { chartLabel } from '../../public/js/ui/results.js';

// The chart's text alternative must carry what the dots show (WCAG 1.1.1),
// not just the count: counts per band, and the values while there are few.
const strings = JSON.parse(readFileSync(new URL('../../public/content/ui.json', import.meta.url), 'utf8'));
const t = createTextLookup(strings, { onMissing: (key) => { throw new Error(`missing ${key}`); } });
const label = (axis, values, own = null) => chartLabel(t, axis, values, middleHalf(values), own);
// Every sentence is built from ui.json (the results.chart.* templates, the
// axis, band and category names), so the wording can change or names
// be renamed (docs/CONTENT.md) without breaking these tests. Only the
// Danish list joining ("1, 2 og 3") and the decimal comma come from Intl.
const f = (key, params) => formatText(strings[key], params);
const SAMR = strings['results.axis.samr'];
const ROGERS = strings['results.axis.rogers'];
const [S0, S1, S2, S3] = [0, 1, 2, 3].map((i) => strings[`samr.band.${i}`]);
const [R0, R1, R2, R3, R4] = [0, 1, 2, 3, 4].map((i) => strings[`rogers.category.${i}`]);
const bandCount = (band, n) => f('results.chart.bandCount', { band, n });
const re = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

test('chartLabel: no answers', () => {
  assert.equal(label('samr', []), f('results.chart.none', { axis: SAMR }));
  assert.equal(label('rogers', [], 40),
    `${f('results.chart.none', { axis: ROGERS })} ${f('results.chart.own', { value: 40, band: R2 })}`);
});

test('chartLabel: three answers give the distribution and the values, no band', () => {
  assert.equal(label('samr', [70, 12, 55]), [
    f('results.chart.count', { axis: SAMR, n: 3 }),
    f('results.chart.bands', { list: `${bandCount(S0, 1)}, ${bandCount(S1, 0)}, ${bandCount(S2, 2)} og ${bandCount(S3, 0)}` }),
    f('results.chart.values', { list: '12, 55 og 70' }),
  ].join(' '));
  assert.equal(label('rogers', [10, 40, 90], 40), [
    f('results.chart.count', { axis: ROGERS, n: 3 }),
    f('results.chart.bands', {
      list: `${bandCount(R0, 1)}, ${bandCount(R1, 0)}, ${bandCount(R2, 1)}, ${bandCount(R3, 0)} og ${bandCount(R4, 1)}`,
    }),
    f('results.chart.values', { list: '10, 40 og 90' }),
    f('results.chart.own', { value: 40, band: R2 }),
  ].join(' '));
});

test('chartLabel: seven answers add the middle half', () => {
  const text = label('samr', [12, 30, 41, 44, 44, 63, 85], 41);
  assert.equal(text, [
    f('results.chart.count', { axis: SAMR, n: 7 }),
    f('results.chart.bands', { list: `${bandCount(S0, 1)}, ${bandCount(S1, 4)}, ${bandCount(S2, 1)} og ${bandCount(S3, 1)}` }),
    f('results.chart.values', { list: '12, 30, 41, 44, 44, 63 og 85' }),
    f('results.chart.band', { from: '35,5', to: '53,5' }),
    f('results.chart.own', { value: 41, band: S1 }),
  ].join(' '));
});

test('chartLabel: many answers leave out the list of values', () => {
  const values = Array.from({ length: 12 }, (_, i) => i * 8);
  const text = label('samr', values);
  const start = [
    f('results.chart.count', { axis: SAMR, n: 12 }),
    f('results.chart.bands', { list: `${bandCount(S0, 4)}, ${bandCount(S1, 3)}, ${bandCount(S2, 3)} og ${bandCount(S3, 2)}` }),
  ].join(' ');
  assert.match(text, new RegExp(`^${re(start)} `));
  assert.ok(!text.includes(strings['results.chart.values'].split('{list}')[0]), 'no list of values');
});
