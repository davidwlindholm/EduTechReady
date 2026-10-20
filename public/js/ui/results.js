// Results views.
//
// - createAxisChart: one small SVG axis that looks like a placement panel (SAMR
//   bands under the Forbedring and Transformation brackets, or the Rogers bell
//   curve with its five regions and shares), with one dot per answer, the
//   pair's own dot as a gold diamond, and the middle-half band (Q1 to Q3) once
//   an axis has 6 answers or more.
// - ResultsList: one row per character (characters.json order) with portrait,
//   name, summary and both charts. Shared by the in-game view and the
//   projector page (results.html).
// - ResultsModal: the in-game view after Færdig. Count of pairs, last update,
//   a refresh button, and a refresh every 30 seconds while it is open.
// - loadResults: results.php with a few retries for transient failures.
import { h, uniqueId } from './dom.js';
import { Modal, button } from './finish.js';
import { AXIS_EDGES, ROGERS_SHARES, axisBand, rogersCurve, rogersCurveHeight } from '../lib/axes.js';
import { distribution, dotLayout, levelStep, middleHalf } from '../lib/stats.js';
import { fetchResults } from '../lib/session.js';

/** Results refresh every 30 seconds. */
export const REFRESH_MS = 30000;
/** Waits before the automatic retries of a failed results request. */
const RETRY_DELAYS_MS = [1000, 3000];

const SVG_NS = 'http://www.w3.org/2000/svg';
const AXIS_LABEL_KEYS = {
  samr: ['samr.band.0', 'samr.band.1', 'samr.band.2', 'samr.band.3'],
  rogers: ['rogers.category.0', 'rogers.category.1', 'rogers.category.2', 'rogers.category.3', 'rogers.category.4'],
};
// The brackets over the SAMR bands, as in the placement panel.
const SAMR_BRACKETS = [
  { key: 'placement.bracket.enhancement', from: 0, to: 50 },
  { key: 'placement.bracket.transformation', from: 50, to: 100 },
];
const SHARE_FORMAT = new Intl.NumberFormat('da-DK', { maximumFractionDigits: 1 });
const VALUE_FORMAT = new Intl.NumberFormat('da-DK', { maximumFractionDigits: 1 });
// "a, b og c": the locale's own list punctuation, no string literals.
const LIST_FORMAT = new Intl.ListFormat('da-DK', { style: 'long', type: 'conjunction' });
const TIME_FORMAT = new Intl.DateTimeFormat('da-DK', { hour: '2-digit', minute: '2-digit', second: '2-digit' });

// Chart geometry in viewBox units. The SVG scales with its width, so text,
// dots and lines grow together on the projector.
const W = 400;
const PAD_X = 12; // room for a dot or diamond at 0 and 100
const PLOT_W = W - 2 * PAD_X;
const BANDS_TOP = 24; // SAMR: brackets above, bands below
const DOTS_TOP = 46; // the highest dot centre stays below this line plus a radius
const AXIS_Y = 112;
const HEIGHT = AXIS_Y + 18; // tick labels under the axis
const DOT_R = 5;
const OWN_R = 7; // half diagonal of the own diamond
/** Dot diameter in value units, plus a hair of space, for stacking. */
const DOT_DIAMETER_V = ((2 * DOT_R + 1) / PLOT_W) * 100;
const TICKS = [0, 25, 50, 75, 100];
const CURVE_SAMPLES = 80;

const x = (v) => PAD_X + (v / 100) * PLOT_W;
const fmt = (n) => n.toFixed(2);

function svg(tag, attrs = {}, children = []) {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
  children.forEach((c) => el.appendChild(c));
  return el;
}

function svgText(text, attrs) {
  const el = svg('text', attrs);
  el.textContent = text;
  return el;
}

/** Bell curve path between two values; closed along the axis for a filled region. */
function curvePath(from, to, closed) {
  const top = DOTS_TOP - 6;
  const y = (hgt) => fmt(AXIS_Y - hgt * (AXIS_Y - top));
  const points = [{ v: from, h: rogersCurveHeight(from) },
    ...rogersCurve(CURVE_SAMPLES).filter((p) => p.v > from && p.v < to),
    { v: to, h: rogersCurveHeight(to) }];
  const line = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${fmt(x(p.v))} ${y(p.h)}`).join(' ');
  return closed ? `${line} L${fmt(x(to))} ${AXIS_Y} L${fmt(x(from))} ${AXIS_Y} Z` : line;
}

/** SAMR: brackets, four bands with their names (as in the placement panel). */
function samrBackground(t) {
  const edges = AXIS_EDGES.samr;
  const parts = [];
  for (const { key, from, to } of SAMR_BRACKETS) {
    const left = x(from) + 5;
    const right = x(to) - 5;
    parts.push(svgText(t(key), { x: fmt((x(from) + x(to)) / 2), y: 11, class: 'results-chart__bracket-label' }));
    parts.push(svg('path', { d: `M${fmt(left)} 21.5 V15.5 H${fmt(right)} V21.5`, class: 'results-chart__bracket' }));
  }
  AXIS_LABEL_KEYS.samr.forEach((key, i) => {
    const from = x(edges[i]);
    const to = x(edges[i + 1]);
    parts.push(svg('rect', {
      x: fmt(from), y: BANDS_TOP, width: fmt(to - from), height: AXIS_Y - BANDS_TOP,
      class: `results-chart__band-bg results-chart__band-bg--${i % 2 === 0 ? 'odd' : 'even'}`,
    }));
    if (i > 0) parts.push(svg('line', { x1: fmt(from), x2: fmt(from), y1: BANDS_TOP, y2: AXIS_Y, class: 'results-chart__divider' }));
    parts.push(svgText(t(key), { x: fmt((from + to) / 2), y: BANDS_TOP + 14, class: 'results-chart__band-label' }));
  });
  return parts;
}

/** Rogers: the bell curve with five filled regions, names and shares above. */
function rogersBackground(t) {
  const edges = AXIS_EDGES.rogers;
  const parts = [];
  AXIS_LABEL_KEYS.rogers.forEach((key, i) => {
    parts.push(svg('path', { d: curvePath(edges[i], edges[i + 1], true), class: `results-chart__region results-chart__region--${i}` }));
  });
  parts.push(svg('path', { d: curvePath(0, 100, false), class: 'results-chart__curve' }));
  AXIS_LABEL_KEYS.rogers.forEach((key, i) => {
    const from = x(edges[i]);
    const to = x(edges[i + 1]);
    if (i > 0) parts.push(svg('line', { x1: fmt(from), x2: fmt(from), y1: 2, y2: AXIS_Y, class: 'results-chart__divider' }));
    const centre = fmt((from + to) / 2);
    // Two-word names ("Tidlig majoritet") take two lines, so they fit the narrow regions.
    const words = t(key).split(' ');
    const lines = words.length > 1 ? [words[0], words.slice(1).join(' ')] : [words[0]];
    lines.forEach((line, j) => {
      parts.push(svgText(line, { x: centre, y: 10 + (j + 2 - lines.length) * 10.5, class: 'results-chart__band-label results-chart__band-label--rogers' }));
    });
    parts.push(svgText(t('rogers.share', { share: SHARE_FORMAT.format(ROGERS_SHARES[i]) }), {
      x: centre, y: 32, class: 'results-chart__share',
    }));
  });
  return parts;
}

function axisLine() {
  const parts = [svg('line', { x1: PAD_X, x2: W - PAD_X, y1: AXIS_Y, y2: AXIS_Y, class: 'results-chart__axis' })];
  for (const v of TICKS) {
    parts.push(svg('line', { x1: fmt(x(v)), x2: fmt(x(v)), y1: AXIS_Y + 1.5, y2: AXIS_Y + 5, class: 'results-chart__tick' }));
    parts.push(svgText(String(v), { x: fmt(x(v)), y: AXIS_Y + 14, class: 'results-chart__tick-label' }));
  }
  return parts;
}

function dotShape({ value, own }, cy) {
  const cx = x(value);
  if (!own) return svg('circle', { cx: fmt(cx), cy: fmt(cy), r: DOT_R, class: 'results-chart__dot' });
  const r = OWN_R;
  return svg('path', {
    d: `M${fmt(cx)} ${fmt(cy - r)} L${fmt(cx + r)} ${fmt(cy)} L${fmt(cx)} ${fmt(cy + r)} L${fmt(cx - r)} ${fmt(cy)} Z`,
    class: 'results-chart__dot results-chart__dot--own',
  });
}

/**
 * The accessible description of one chart: what the dots show, e.g. "SAMR:
 * 4 svar. Fordeling: Substitution 1, Augmentation 0, Modification 3 og
 * Redefinition 0. Svarene: 20, 55, 60 og 70. Jeres placering: 60,
 * Modification." With 6 answers or more it also gives the middle half; above
 * MAX_LISTED_VALUES answers it leaves out the list of values.
 */
export function chartLabel(t, axis, values, band, own, { ownOnly = false } = {}) {
  const name = t(`results.axis.${axis}`);
  if (ownOnly) {
    // Practice mode: only the pair's own placement exists, so the count and
    // distribution ("ingen svar endnu") would describe nothing on screen.
    return own === null
      ? t('results.chart.notPlaced', { axis: name })
      : t('results.chart.ownOnly', { axis: name, value: own, band: t(AXIS_LABEL_KEYS[axis][axisBand(axis, own)]) });
  }
  const parts = [values.length > 0 ? t('results.chart.count', { axis: name, n: values.length }) : t('results.chart.none', { axis: name })];
  if (values.length > 0) {
    const { counts, values: listed } = distribution(axis, values);
    const bands = counts.map((n, i) => t('results.chart.bandCount', { band: t(AXIS_LABEL_KEYS[axis][i]), n }));
    parts.push(t('results.chart.bands', { list: LIST_FORMAT.format(bands) }));
    if (listed) parts.push(t('results.chart.values', { list: LIST_FORMAT.format(listed.map((v) => VALUE_FORMAT.format(v))) }));
  }
  if (band) parts.push(t('results.chart.band', { from: VALUE_FORMAT.format(band.from), to: VALUE_FORMAT.format(band.to) }));
  if (own !== null) parts.push(t('results.chart.own', { value: own, band: t(AXIS_LABEL_KEYS[axis][axisBand(axis, own)]) }));
  return parts.join(' ');
}

/**
 * One small axis as SVG.
 * @param {object} options
 * @param {(key: string, params?: object) => string} options.t
 * @param {'samr'|'rogers'} options.axis
 * @param {number[]} options.values every answer on this axis (may include the pair's own)
 * @param {number|null} [options.own] the pair's own value, or null (projector, or not placed)
 * @param {boolean} [options.ownOnly] practice mode: no answers exist, only the own placement
 * @returns {SVGSVGElement}
 */
export function createAxisChart({ t, axis, values, own = null, ownOnly = false }) {
  const band = middleHalf(values);
  const { dots, levels } = dotLayout(values, { diameter: DOT_DIAMETER_V, own });
  const lowest = AXIS_Y - DOT_R - 2;
  const step = levelStep(levels, lowest - (DOTS_TOP + DOT_R), 2 * DOT_R);

  const chart = svg('svg', {
    class: `results-chart results-chart--${axis}`,
    viewBox: `0 0 ${W} ${HEIGHT}`,
    role: 'img',
    'aria-label': chartLabel(t, axis, values, band, own, { ownOnly }),
    'data-axis': axis,
    'data-count': values.length,
    focusable: 'false',
  });
  chart.append(...(axis === 'samr' ? samrBackground(t) : rogersBackground(t)));
  if (band) {
    const left = x(band.from);
    const width = Math.max(2, x(band.to) - left);
    const top = DOTS_TOP - 4; // below the band names, so they stay readable
    const box = { x: fmt(left - (width === 2 ? 1 : 0)), y: top, width: fmt(width), height: AXIS_Y - top };
    // A wide dark edge under the light one keeps the band's outline at 3:1
    // or more against both the light and the dark Rogers regions.
    chart.append(
      svg('rect', { ...box, class: 'results-chart__middle-edge', 'aria-hidden': 'true' }),
      svg('rect', { ...box, class: 'results-chart__middle', 'data-from': band.from, 'data-to': band.to }),
    );
  }
  chart.append(...axisLine());
  // Own dot last, so it is never hidden under another one.
  const ordered = [...dots.filter((d) => !d.own), ...dots.filter((d) => d.own)];
  for (const dot of ordered) chart.append(dotShape(dot, lowest - dot.level * step));
  return chart;
}

/**
 * The legend: what a dot, the own diamond and the band mean. `others` false
 * (practice mode) leaves out the other pairs' dots and the band, which never
 * appear there.
 */
export function createLegend(t, { own, others = true }) {
  const icon = (shape) => {
    const s = svg('svg', { class: 'results-legend__icon', viewBox: '0 0 20 14', 'aria-hidden': 'true', focusable: 'false' });
    s.append(shape);
    return s;
  };
  const item = (shape, key) => h('li', { className: 'results-legend__item' }, [icon(shape), h('span', { text: t(key) })]);
  const items = [];
  if (own) items.push(item(svg('path', { d: 'M10 1 L16 7 L10 13 L4 7 Z', class: 'results-chart__dot results-chart__dot--own' }), 'results.legend.own'));
  if (others) {
    items.push(item(svg('circle', { cx: 10, cy: 7, r: 5, class: 'results-chart__dot' }), 'results.legend.pair'));
    const box = { x: 1.5, y: 1.5, width: 17, height: 11 };
    const icon = svg('g', {}, [svg('rect', { ...box, class: 'results-chart__middle-edge' }), svg('rect', { ...box, class: 'results-chart__middle' })]);
    items.push(item(icon, 'results.legend.band'));
  }
  return h('ul', { className: 'results-legend', attrs: { 'aria-label': t('results.legend') } }, items);
}

/**
 * The rows: one per character, in characters.json order.
 */
export class ResultsList {
  /**
   * @param {object} options
   * @param {(key: string, params?: object) => string} options.t
   * @param {Array<{id: string, name: string, portrait: string, summary: string}>} options.characters
   * @param {'h2'|'h3'} [options.nameHeading] heading level of the names: h3 under the
   *   modal's h2 title, h2 on the projector page under its h1
   */
  constructor({ t, characters, nameHeading = 'h3' }) {
    this.t = t;
    this.characters = characters;
    this.nameHeading = nameHeading;
    this.element = h('ol', { className: 'results-list', attrs: { 'aria-label': t('results.list') } });
  }

  /**
   * @param {{ characters: Record<string, {samr: number[], rogers: number[]}> }|null} results null: no answers to show (practice)
   * @param {Record<string, {samr?: number|null, rogers?: number|null}>|null} own the pair's placements, or null (projector)
   */
  render(results, own) {
    const t = this.t;
    const ownOnly = results === null && own !== null;
    this.element.replaceChildren(...this.characters.map((c) => {
      const values = results?.characters[c.id] ?? { samr: [], rogers: [] };
      const ownValue = (axis) => {
        const v = own?.[c.id]?.[axis];
        return Number.isInteger(v) ? v : null;
      };
      const nameId = uniqueId('results-name');
      const chart = (axis) => h('figure', { className: 'results-row__chart' }, [
        // The chart's own label starts with the axis name, so screen readers skip the caption.
        h('figcaption', { className: 'results-row__axis', text: t(`results.axis.${axis}`), attrs: { 'aria-hidden': 'true' } }),
        createAxisChart({ t, axis, values: values[axis], own: ownValue(axis), ownOnly }),
      ]);
      return h('li', { className: 'results-row', attrs: { 'data-id': c.id, 'aria-labelledby': nameId } }, [
        h('div', { className: 'results-row__who' }, [
          h('img', { className: 'results-row__portrait', attrs: { src: c.portrait, alt: '', width: '64', height: '64' } }),
          h('div', { className: 'results-row__text' }, [
            h(this.nameHeading, { className: 'results-row__name', text: c.name, attrs: { id: nameId } }),
            h('p', { className: 'results-row__summary', text: c.summary }),
          ]),
        ]),
        chart('samr'),
        chart('rogers'),
      ]);
    }));
  }
}

/**
 * results.php with retries: a transient failure (busy server, network
 * hiccup) is tried again after 1 s and 3 s before it counts; "closed" is an
 * answer, not a failure. `stillWanted()` false stops early (returns null).
 */
export async function loadResults(fetchImpl, code, ids, stillWanted = () => true) {
  let answer = await fetchResults(fetchImpl, code, ids);
  for (const delay of RETRY_DELAYS_MS) {
    if (answer.kind !== 'error' || !stillWanted()) break;
    await new Promise((resolve) => setTimeout(resolve, delay));
    if (!stillWanted()) return null;
    answer = await fetchResults(fetchImpl, code, ids);
  }
  return stillWanted() ? answer : null;
}

/** Set text only when it differs, so a live region is not re-announced for nothing. */
export function setText(element, text) {
  if (element.textContent !== text) element.textContent = text;
}

/** "Senest opdateret kl. 14.03.27" */
export function updatedText(t, date) {
  return t('results.updated', { time: TIME_FORMAT.format(date) });
}

/**
 * The in-game results view, opened after Færdig. Session mode:
 * every pair's dots, the own diamond, the band, the count and the last
 * update; refresh button and a refresh every 30 s while open. Practice mode:
 * only the pair's own placements, no request.
 */
export class ResultsModal {
  /**
   * @param {object} options
   * @param {HTMLElement} options.host
   * @param {(key: string, params?: object) => string} options.t
   * @param {HTMLElement} options.focusFallback
   * @param {Array<{id: string, name: string, portrait: string, summary: string}>} options.characters
   * @param {ReturnType<typeof import('../lib/state.js').createStore>} options.store
   * @param {{ mode: 'session'|'practice', code: string|null }} options.session
   * @param {typeof fetch} options.fetchImpl
   */
  constructor({ host, t, focusFallback, characters, store, session, fetchImpl }) {
    this.t = t;
    this.characters = characters;
    this.store = store;
    this.session = session;
    this.fetchImpl = fetchImpl;
    this.requestSeq = 0;
    this.timer = 0;
    this.results = null;
    this.inFlight = false;
    /** JSON of the last answer shown, to skip redrawing an unchanged one. */
    this.shownKey = null;
    // The body (every row and chart) is far too long to read on open; the
    // dialog is described by the count line, or the practice note.
    this.modal = new Modal({
      host, focusFallback, className: 'results', titleText: t('results.title'), onClose: () => this.stopTimer(), describeBody: false,
    });
    this.status = h('p', { className: 'results__count', attrs: { role: 'status' } });
    this.updated = h('p', { className: 'results__updated' });
    this.problem = h('p', { className: 'results__problem', attrs: { hidden: '' } });
    this.practiceNote = h('p', { className: 'modal__text results__practice', text: t('results.practice') });
    this.list = new ResultsList({ t, characters });
    // Only the list scrolls inside the modal, and it holds nothing focusable.
    // A tab stop lets keyboard users scroll it (arrows, Page Down, End);
    // trapTab includes it because it matches [tabindex]. The projector page
    // scrolls as a whole, so it does not get one.
    this.list.element.tabIndex = 0;
  }

  get isOpen() {
    return this.modal.isOpen;
  }

  refocus() {
    this.modal.refocus();
  }

  close() {
    this.modal.close();
  }

  stopTimer() {
    window.clearInterval(this.timer);
    this.timer = 0;
    this.requestSeq += 1; // drop answers still in flight
    this.inFlight = false;
  }

  ownPlacements() {
    return this.store.getState().placements;
  }

  open() {
    const t = this.t;
    const session = this.session.mode === 'session';
    this.results = null;
    this.shownKey = null;
    this.inFlight = false;
    const buttons = [button(t('results.close'), () => this.close(), { primary: !session })];
    if (session) buttons.unshift(button(t('results.refresh'), () => this.refresh()));
    const header = h('div', { className: 'results__header' }, session
      ? [this.status, this.updated, this.problem, createLegend(t, { own: true })]
      : [this.practiceNote, createLegend(t, { own: true, others: false })]);
    this.list.render(null, this.ownPlacements());
    this.modal.setContent([header, this.list.element], buttons);
    this.modal.dialog.dataset.mode = session ? 'session' : 'practice';
    this.modal.describeWith(session ? this.status : this.practiceNote);
    this.problem.hidden = true;
    this.updated.textContent = '';
    this.modal.show();
    if (!session) return;
    this.refresh();
    window.clearInterval(this.timer);
    this.timer = window.setInterval(() => this.refresh({ auto: true }), REFRESH_MS);
  }

  /**
   * @param {{ auto?: boolean }} [options] auto: the 30 s timer. It skips a
   *   tick while a request (with its retries) is still running, so on a
   *   hanging server the retries can finish and the error shows; otherwise
   *   each tick would supersede the last and the error would never appear.
   */
  async refresh({ auto = false } = {}) {
    if (this.session.mode !== 'session') return;
    if (auto && this.inFlight) return;
    const seq = ++this.requestSeq;
    this.inFlight = true;
    if (!this.results) {
      this.status.textContent = this.t('results.loading');
      delete this.status.dataset.n;
    }
    const ids = this.characters.map((c) => c.id);
    const answer = await loadResults(this.fetchImpl, this.session.code, ids, () => seq === this.requestSeq && this.modal.isOpen);
    if (!answer || seq !== this.requestSeq) return; // closed, or a newer refresh is running
    this.inFlight = false;
    if (answer.kind === 'ok') {
      this.results = answer.results;
      this.updated.textContent = updatedText(this.t, new Date());
      this.problem.hidden = true;
      // Unchanged answers keep the rows and the count as they are, so the
      // live count is not re-announced every 30 s.
      const key = JSON.stringify(answer.results);
      if (key === this.shownKey) return;
      this.shownKey = key;
      setText(this.status, this.t('results.count', { n: answer.results.n }));
      this.status.dataset.n = String(answer.results.n);
      this.list.render(this.results, this.ownPlacements());
      return;
    }
    const key = answer.kind === 'closed' ? 'results.closed' : 'results.error';
    if (this.results) {
      // Keep the last good answer on screen and say the update failed.
      this.problem.textContent = this.t(key);
      this.problem.hidden = false;
    } else {
      this.status.textContent = this.t(key);
    }
  }
}
