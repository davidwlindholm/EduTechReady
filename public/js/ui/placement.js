// Placement panel: one modal per axis (SAMR or Rogers).
//
// Met characters start as chips (portrait and full name) in the tray. On the
// axis each one is a pin: a small portrait with a compact name label on a thin
// needle whose tip touches the axis at the exact value. Only the needle tip
// sets the value. Pins whose heads would overlap stack upward, with longer
// needles, so every tip still touches the axis.
//
// While a token is dragged (or a pin has keyboard focus), a guide line runs
// through the bands at the value, the band under it is highlighted, and a
// readout ("Modification · 62") sits above the token.
import { h, trapTab, uniqueId } from './dom.js';
import {
  AXIS_EDGES, ROGERS_SHARES, axisBand, pixelFromValue, rogersCurve, rogersCurveHeight, stackLevels, valueFromPixel,
} from '../lib/axes.js';
import { splitNameRole } from '../lib/characters.js';

// Pointer slack (px) around the axis field that still counts as a drop on it.
// Horizontally, drops past the ends clamp to 0 or 100.
const DROP_SLACK_X = 48;
const DROP_SLACK_TOP = 16;
const DROP_SLACK_BOTTOM = 40;
const TRAY_SLACK = 24;
const KEY_STEP = 1;
const KEY_STEP_LARGE = 5;
const DEFAULT_VALUE = 50;
// Pin geometry (px). A level-0 needle is NEEDLE_BASE long; each stack level adds LEVEL_HEIGHT.
const NEEDLE_BASE = 26;
const LEVEL_HEIGHT = 48;
const STACK_GAP = 6;
// Room at the top of the field for the band labels (Rogers adds the share line).
const LABEL_AREA = { samr: 34, rogers: 50 };
const MIN_FIELD_HEIGHT = { samr: 170, rogers: 200 };
const FIELD_TOP_PADDING = 6;
const CURVE_SAMPLES = 120;
const SVG_NS = 'http://www.w3.org/2000/svg';
const SCALE_TICKS = [0, 25, 50, 75, 100];
const SHARE_FORMAT = new Intl.NumberFormat('da-DK', { maximumFractionDigits: 1 });

function within(rect, x, y, { left = 0, right = 0, top = 0, bottom = 0 }) {
  return x >= rect.left - left && x <= rect.right + right && y >= rect.top - top && y <= rect.bottom + bottom;
}

function svg(tag, attrs = {}) {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  return el;
}

/** SVG path for the bell curve between two values, closed along the base (viewBox 0..100 square). */
function curvePath(points, from, to, closed) {
  const inside = points.filter((p) => p.v >= from && p.v <= to);
  const y = (hgt) => (100 - hgt * 100).toFixed(3);
  const line = inside.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.v.toFixed(3)} ${y(p.h)}`).join(' ');
  if (!closed) return line;
  return `${line} L${to} 100 L${from} 100 Z`;
}

/** Head (compact name label and portrait), needle and tip of a pin. */
function pinParts(character) {
  return [
    h('span', { className: 'pin__head' }, [
      h('span', { className: 'pin__name', text: splitNameRole(character.name).name, attrs: { 'aria-hidden': 'true' } }),
      h('img', { className: 'pin__portrait', attrs: { src: character.portrait, alt: '', width: '30', height: '30', draggable: 'false' } }),
    ]),
    h('span', { className: 'pin__needle', attrs: { 'aria-hidden': 'true' } }),
    h('span', { className: 'pin__tip', attrs: { 'aria-hidden': 'true' } }),
  ];
}

export class PlacementPanel {
  /**
   * @param {object} options
   * @param {HTMLElement} options.host
   * @param {(key: string, params?: object) => string} options.t
   * @param {'samr'|'rogers'} options.axis
   * @param {string} options.titleKey
   * @param {string[]} options.labelKeys band or category names, one per band in AXIS_EDGES[axis]
   * @param {Array<{key: string, from: number, to: number}>} [options.brackets] labelled brackets over value ranges (SAMR)
   * @param {HTMLElement} options.focusFallback where focus goes when the panel closes (the canvas)
   * @param {() => Array<{id: string, name: string, portrait: string}>} options.getCharacters characters to show (met ones)
   * @param {() => Record<string, {samr: number|null, rogers: number|null}>} options.getPlacements
   * @param {() => boolean} options.isLocked true after submission: read-only
   * @param {(id: string, value: number|null) => void} options.onChange
   * @param {() => void} [options.onClose]
   */
  constructor(options) {
    this.host = options.host;
    this.t = options.t;
    this.axis = options.axis;
    this.labelKeys = options.labelKeys;
    this.brackets = options.brackets ?? [];
    this.focusFallback = options.focusFallback;
    this.getCharacters = options.getCharacters;
    this.getPlacements = options.getPlacements;
    this.isLocked = options.isLocked;
    this.onChange = options.onChange;
    this.onClose = options.onClose ?? (() => {});
    this.isOpen = false;
    this.locked = false;
    this.drag = null;
    this.lastFocused = null;
    /** @type {Map<string, {chip: HTMLButtonElement, pin: HTMLButtonElement}>} */
    this.tokenElements = new Map();

    this.edges = AXIS_EDGES[this.axis];
    if (this.edges.length - 1 !== this.labelKeys.length) {
      throw new Error(`${this.axis}: ${this.labelKeys.length} labels for ${this.edges.length - 1} bands`);
    }

    const titleId = uniqueId('placement-title');
    const noteId = uniqueId('placement-note');
    const lockedId = uniqueId('placement-locked');
    this.bands = this.labelKeys.map((key, i) => this.createBand(key, i));
    this.guide = h('div', { className: 'placement__guide', attrs: { 'aria-hidden': 'true', hidden: '' } });
    this.axisEl = h('div', {
      className: `placement__axis placement__axis--${this.axis}`,
      attrs: { role: 'group', 'aria-label': this.t('placement.axis') },
    }, [...(this.axis === 'rogers' ? [this.createCurve()] : []), ...this.bands, this.guide]);
    this.axisEl.style.setProperty('--label-area', `${LABEL_AREA[this.axis]}px`);

    const scale = h('div', { className: 'placement__scale', attrs: { 'aria-hidden': 'true' } },
      SCALE_TICKS.map((v) => {
        const tick = h('span', { className: 'placement__tick', text: String(v) });
        tick.style.left = `${v}%`;
        return tick;
      }));
    const chart = h('div', { className: 'placement__chart' }, [
      ...(this.brackets.length ? [this.createBrackets()] : []),
      this.axisEl,
      scale,
    ]);

    this.tray = h('div', { className: 'placement__tray' });
    this.empty = h('p', { className: 'placement__empty', text: this.t('placement.empty') });
    this.instructions = h('p', { className: 'placement__instructions', text: this.t('placement.instructions'), attrs: { id: noteId } });
    this.lockedNote = h('p', { className: 'placement__locked', text: this.t('placement.locked'), attrs: { id: lockedId, hidden: '' } });
    this.readout = h('div', { className: 'placement__readout', attrs: { 'aria-hidden': 'true', hidden: '' } });
    this.closeButton = h('button', { className: 'button', text: this.t('placement.close'), attrs: { type: 'button' } });
    this.closeButton.addEventListener('click', () => this.close());

    this.dialog = h('section', {
      className: `placement placement--${this.axis} panel`,
      attrs: { role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': titleId, 'aria-describedby': noteId },
    }, [
      h('h2', { className: 'placement__title', text: this.t(options.titleKey), attrs: { id: titleId } }),
      this.instructions,
      this.lockedNote,
      chart,
      h('h3', { className: 'placement__tray-title', text: this.t('placement.tray') }),
      this.tray,
      this.empty,
      h('div', { className: 'placement__actions' }, [this.closeButton]),
      this.readout,
    ]);
    this.root = h('div', { className: 'backdrop', attrs: { hidden: '' } }, [this.dialog]);
    this.root.addEventListener('keydown', (e) => this.handlePanelKey(e));
    // Focus can leave the dialog while it is open (a click on a non-focusable
    // part of it moves focus to <body>). Keys pressed there must still reach it.
    document.addEventListener('keydown', (e) => {
      if (this.isOpen && !e.defaultPrevented && !this.root.contains(e.target)) this.handleOutsideKey(e);
    });
    this.root.addEventListener('focusin', (e) => {
      this.lastFocused = e.target;
      if (!this.drag) this.showFocusIndicator(e.target);
    });
    this.root.addEventListener('focusout', () => {
      if (!this.drag) this.hideIndicator();
    });
    this.root.addEventListener('pointerdown', (e) => {
      if (e.target !== this.root) return;
      // A press on the backdrop's own scrollbar scrolls; it does not close.
      if (e.offsetX >= this.root.clientWidth || e.offsetY >= this.root.clientHeight) return;
      // Without preventDefault the press would move focus to <body> after
      // close() has put it on the canvas.
      e.preventDefault();
      this.close();
    });
    // A tall panel (deep stacks on a small screen) scrolls inside the
    // backdrop; the fixed readout must follow its pin.
    this.root.addEventListener('scroll', () => {
      if (!this.drag && !this.readout.hidden) this.showFocusIndicator(document.activeElement);
    });
    window.addEventListener('resize', () => {
      if (!this.isOpen) return;
      this.cancelDrag();
      this.render();
    });
    this.host.appendChild(this.root);
  }

  // --- static parts ---------------------------------------------------------

  createBand(key, i) {
    const band = h('div', { className: 'placement__band' }, [
      h('span', { className: 'placement__band-label', text: this.t(key) }),
    ]);
    if (this.axis === 'rogers') {
      const share = this.t('rogers.share', { share: SHARE_FORMAT.format(ROGERS_SHARES[i]) });
      band.appendChild(h('span', { className: 'placement__band-share', text: share }));
    }
    // Bands are sized from the axis edges (AXIS_EDGES), never drawn equal.
    band.style.left = `${this.edges[i]}%`;
    band.style.width = `${this.edges[i + 1] - this.edges[i]}%`;
    return band;
  }

  /** The Rogers bell curve, one filled region per category, behind the bands. */
  createCurve() {
    const points = rogersCurve(CURVE_SAMPLES);
    const regions = this.labelKeys.map((_, i) => {
      const from = this.edges[i];
      const to = this.edges[i + 1];
      // Include the exact edge heights so neighbouring regions meet without gaps.
      const pts = [{ v: from, h: rogersCurveHeight(from) }, ...points, { v: to, h: rogersCurveHeight(to) }]
        .sort((a, b) => a.v - b.v);
      return svg('path', { d: curvePath(pts, from, to, true), class: `placement__region placement__region--${i}` });
    });
    const outline = svg('path', { d: curvePath(points, 0, 100, false), class: 'placement__curve-line', 'vector-effect': 'non-scaling-stroke' });
    const curve = svg('svg', {
      class: 'placement__curve', viewBox: '0 0 100 100', preserveAspectRatio: 'none', 'aria-hidden': 'true', focusable: 'false',
    });
    curve.append(...regions, outline);
    return curve;
  }

  createBrackets() {
    return h('div', { className: 'placement__brackets', attrs: { 'aria-hidden': 'true' } }, this.brackets.map(({ key, from, to }) => {
      const bracket = h('div', { className: 'placement__bracket' }, [
        h('span', { className: 'placement__bracket-label', text: this.t(key) }),
      ]);
      bracket.style.left = `${from}%`;
      bracket.style.width = `${to - from}%`;
      return bracket;
    }));
  }

  // --- open, close, render --------------------------------------------------

  open() {
    if (this.isOpen) return;
    this.isOpen = true;
    this.root.hidden = false;
    this.render();
    (this.dialog.querySelector('.token') ?? this.closeButton).focus();
  }

  /** Move focus back into the open dialog, to the element that had it last. */
  refocus() {
    if (!this.isOpen) return;
    const target = this.lastFocused?.isConnected && this.dialog.contains(this.lastFocused)
      ? this.lastFocused
      : this.dialog.querySelector('.token') ?? this.closeButton;
    target.focus({ preventScroll: true });
  }

  /** Close the panel; focus returns to the canvas. */
  close() {
    if (!this.isOpen) return;
    this.cancelDrag();
    this.hideIndicator();
    this.isOpen = false;
    this.root.hidden = true;
    this.lastFocused = null;
    this.focusFallback.focus({ preventScroll: true });
    this.onClose();
  }

  valueOf(id) {
    return this.getPlacements()[id]?.[this.axis] ?? null;
  }

  bandName(value) {
    return this.t(this.labelKeys[axisBand(this.axis, value)]);
  }

  render(focusId = null) {
    // Moving a token between the tray and the axis drops focus to <body>; keep it on the same character.
    const active = document.activeElement;
    const keepId = focusId ?? (this.dialog.contains(active) && active.classList.contains('token') ? active.dataset.id : null);
    this.locked = this.isLocked();
    this.dialog.classList.toggle('is-locked', this.locked);
    this.instructions.hidden = this.locked;
    this.lockedNote.hidden = !this.locked;
    this.dialog.setAttribute('aria-describedby', this.locked ? this.lockedNote.id : this.instructions.id);

    // Token elements are made once per character and updated in place, so
    // portraits never reload (no flicker) and a moved pin keeps its focus.
    const characters = this.getCharacters();
    const pins = [];
    const chips = [];
    for (const c of characters) {
      const value = this.valueOf(c.id);
      const { chip, pin } = this.tokensFor(c);
      const token = value === null ? chip : pin;
      (value === null ? pin : chip).remove();
      this.updateToken(token, c, value);
      (value === null ? chips : pins).push(token);
    }
    const shown = new Set([...pins, ...chips]);
    this.dialog.querySelectorAll('.token').forEach((el) => !shown.has(el) && el.remove());
    // Pins follow their values in the DOM, so Tab moves left to right as they appear.
    pins.sort((a, b) => Number(a.dataset.value) - Number(b.dataset.value));
    const axisNow = [...this.axisEl.querySelectorAll(':scope > .token')];
    if (axisNow.length !== pins.length || pins.some((pin, i) => axisNow[i] !== pin)) this.axisEl.append(...pins);
    const trayNow = [...this.tray.children];
    if (trayNow.length !== chips.length || chips.some((chip, i) => trayNow[i] !== chip)) this.tray.replaceChildren(...chips);
    this.layoutPins(pins);
    this.empty.hidden = characters.length > 0;
    if (keepId && document.activeElement?.dataset?.id !== keepId) {
      this.dialog.querySelector(`.token[data-id="${CSS.escape(keepId)}"]`)?.focus();
    } else if (keepId) {
      this.showFocusIndicator(document.activeElement); // its value may have changed
    }
  }

  /** Stack pins whose heads overlap and size the field to the tallest stack. */
  layoutPins(pins) {
    const width = this.axisEl.clientWidth;
    const items = pins.map((pin) => ({
      id: pin.dataset.id,
      x: pixelFromValue(Number(pin.dataset.value), width),
      width: pin.querySelector('.pin__head').offsetWidth,
    }));
    const levels = stackLevels(items, STACK_GAP);
    for (const pin of pins) {
      const level = levels.get(pin.dataset.id);
      pin.style.setProperty('--needle', `${NEEDLE_BASE + level * LEVEL_HEIGHT}px`);
      // A stacked pin's needle may pass a head below it; draw the lower head
      // on top so its name stays readable (the needle shows again under it).
      pin.style.zIndex = String(10 + pins.length - level);
      pin.dataset.level = String(level);
    }
    // The field (border-box) holds the band labels, the tallest pin and the axis line.
    const tallest = Math.max(0, ...pins.map((pin) => pin.offsetHeight));
    const axisLine = this.axisEl.offsetHeight - this.axisEl.clientHeight;
    const needed = LABEL_AREA[this.axis] + FIELD_TOP_PADDING + tallest + axisLine;
    this.axisEl.style.height = `${Math.max(MIN_FIELD_HEIGHT[this.axis], needed)}px`;
  }

  tokenLabel(character, value) {
    if (value === null) {
      return this.t(this.locked ? 'placement.tokenUnplacedLocked' : 'placement.tokenUnplaced', { name: character.name });
    }
    return this.t(this.locked ? 'placement.tokenLocked' : 'placement.tokenPlaced', {
      name: character.name, band: this.bandName(value), value,
    });
  }

  /** The chip and pin elements for a character, made on first use. */
  tokensFor(character) {
    let pair = this.tokenElements.get(character.id);
    if (!pair) {
      pair = { chip: this.createChip(character), pin: this.createPin(character) };
      this.tokenElements.set(character.id, pair);
    }
    return pair;
  }

  updateToken(token, character, value) {
    token.setAttribute('aria-label', this.tokenLabel(character, value));
    if (this.locked) token.setAttribute('aria-disabled', 'true');
    else token.removeAttribute('aria-disabled');
    if (value !== null) {
      token.dataset.value = String(value);
      token.style.setProperty('--v', String(value));
    }
  }

  baseToken(character, className, children) {
    const token = h('button', { className: `token ${className}`, attrs: { type: 'button', 'data-id': character.id } }, children);
    token.addEventListener('pointerdown', (e) => this.startDrag(e, token));
    token.addEventListener('keydown', (e) => this.handleTokenKey(e, character.id));
    return token;
  }

  /** An unplaced token in the tray: portrait and full name. */
  createChip(character) {
    return this.baseToken(character, 'token--chip', [
      h('img', { className: 'token__portrait', attrs: { src: character.portrait, alt: '', width: '32', height: '32', draggable: 'false' } }),
      h('span', { className: 'token__name', text: character.name, attrs: { 'aria-hidden': 'true' } }),
    ]);
  }

  /** A placed token: name label and portrait on a needle whose tip marks the value. */
  createPin(character) {
    return this.baseToken(character, 'token--placed', pinParts(character));
  }

  set(id, value) {
    if (this.locked) return;
    this.onChange(id, value);
    this.render(id);
  }

  // --- guide line, band highlight and readout ------------------------------

  /** Show the guide at a value, highlight its band and put the readout above `anchor`. */
  showIndicator(value, anchor) {
    const band = axisBand(this.axis, value);
    this.guide.hidden = false;
    this.guide.style.left = `${value}%`;
    this.bands.forEach((el, i) => el.classList.toggle('is-active', i === band));
    this.readout.textContent = this.t('placement.readout', { band: this.t(this.labelKeys[band]), value });
    this.readout.hidden = false;
    const rect = (anchor.querySelector('.pin__head') ?? anchor).getBoundingClientRect();
    this.readout.style.left = `${rect.left + rect.width / 2}px`;
    this.readout.style.top = `${rect.top}px`;
  }

  hideIndicator() {
    this.guide.hidden = true;
    this.readout.hidden = true;
    this.bands.forEach((el) => el.classList.remove('is-active'));
  }

  /** While a pin has keyboard focus, show where it points. */
  showFocusIndicator(target) {
    if (!(target instanceof HTMLElement) || !target.classList.contains('token--placed') || !target.matches(':focus-visible')) {
      this.hideIndicator();
      return;
    }
    this.showIndicator(Number(target.dataset.value), target);
  }

  // --- pointer dragging -----------------------------------------------------

  startDrag(event, token) {
    if (event.button !== 0 || this.drag || this.locked) return;
    event.preventDefault();
    const rect = token.getBoundingClientRect();
    const value = this.valueOf(token.dataset.id);
    const axisRect = this.axisEl.getBoundingClientRect();
    const placed = value !== null;
    // The value follows the needle, never the token's edge. A pin keeps the
    // offset from where it was grabbed to its needle, so grabbing it anywhere
    // and letting go in place keeps its value. A chip centres under the pointer.
    const grabX = placed ? axisRect.left + pixelFromValue(value, axisRect.width) - event.clientX : 0;
    const shiftX = placed ? 0 : event.clientX - (rect.left + rect.width / 2);
    // A chip dragged over the axis shows as a pin preview (a ghost) at the
    // value it would drop on, so the needle, not the wide chip, shows where.
    let ghost = null;
    if (!placed) {
      const character = this.getCharacters().find((c) => c.id === token.dataset.id);
      ghost = h('span', { className: 'token--placed pin--ghost', attrs: { 'aria-hidden': 'true', hidden: '' } }, pinParts(character));
      ghost.style.setProperty('--needle', `${NEEDLE_BASE}px`);
      this.axisEl.appendChild(ghost);
    }
    token.setPointerCapture(event.pointerId);
    token.classList.add('is-dragging');
    this.dialog.classList.add('is-dragging');
    const move = (e) => this.moveDrag(e);
    const end = (e) => this.endDrag(e, true);
    const cancel = (e) => this.endDrag(e, false);
    token.addEventListener('pointermove', move);
    token.addEventListener('pointerup', end);
    token.addEventListener('pointercancel', cancel);
    // A capture lost without pointerup (alt-tab or a system dialog mid-drag)
    // puts the token back, so the panel never stays in drag mode. After a
    // normal pointerup the drag is already over and this does nothing.
    token.addEventListener('lostpointercapture', cancel);
    this.drag = {
      token,
      placed,
      id: token.dataset.id,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      grabX,
      shiftX,
      startValue: value,
      ghost,
      detach: () => {
        token.removeEventListener('pointermove', move);
        token.removeEventListener('pointerup', end);
        token.removeEventListener('pointercancel', cancel);
        token.removeEventListener('lostpointercapture', cancel);
      },
    };
    this.hideIndicator();
    this.moveDrag(event);
  }

  /** Where a pointer position would drop: { onAxis, value } or { onTray }. */
  dropTarget(event) {
    const d = this.drag;
    const x = event.clientX + d.grabX;
    const axisRect = this.axisEl.getBoundingClientRect();
    if (within(axisRect, x, event.clientY, { left: DROP_SLACK_X, right: DROP_SLACK_X, top: DROP_SLACK_TOP, bottom: DROP_SLACK_BOTTOM })) {
      return { onAxis: true, value: valueFromPixel(x - axisRect.left, axisRect.width) };
    }
    const trayRect = this.tray.getBoundingClientRect();
    const all = TRAY_SLACK;
    return { onTray: d.placed && within(trayRect, event.clientX, event.clientY, { left: all, right: all, top: all, bottom: all }) };
  }

  moveDrag(event) {
    const d = this.drag;
    if (!d || event.pointerId !== d.pointerId) return;
    const target = this.dropTarget(event);
    const dx = event.clientX - d.startX + d.shiftX;
    const dy = event.clientY - d.startY;
    if (target.onAxis && d.placed) {
      // Over the axis a pin slides sideways only and snaps to the value it
      // would drop on, so its needle always sits where the guide and readout say.
      const width = this.axisEl.getBoundingClientRect().width;
      const shift = pixelFromValue(target.value, width) - pixelFromValue(d.startValue, width);
      d.token.style.translate = `${shift}px 0px`;
    } else {
      d.token.style.translate = `${dx}px ${dy}px`;
    }
    this.axisEl.classList.toggle('is-drop-target', Boolean(target.onAxis));
    this.tray.classList.toggle('is-drop-target', Boolean(target.onTray));
    if (d.ghost) {
      d.ghost.hidden = !target.onAxis;
      d.token.classList.toggle('is-previewed', Boolean(target.onAxis));
      if (target.onAxis) d.ghost.style.setProperty('--v', String(target.value));
    }
    if (target.onAxis) this.showIndicator(target.value, d.ghost ?? d.token);
    else this.hideIndicator();
  }

  endDrag(event, commit) {
    const d = this.drag;
    if (!d || event.pointerId !== d.pointerId) return;
    const target = commit ? this.dropTarget(event) : {};
    this.cancelDrag();
    if (target.onAxis) this.set(d.id, target.value);
    else if (target.onTray) this.set(d.id, null);
  }

  /** Put a dragged token back where it was, without changing anything. */
  cancelDrag() {
    const d = this.drag;
    if (!d) return;
    d.detach();
    if (d.token.hasPointerCapture(d.pointerId)) d.token.releasePointerCapture(d.pointerId);
    d.token.classList.remove('is-dragging', 'is-previewed');
    d.token.style.translate = '';
    d.ghost?.remove();
    this.dialog.classList.remove('is-dragging');
    this.axisEl.classList.remove('is-drop-target');
    this.tray.classList.remove('is-drop-target');
    this.hideIndicator();
    this.drag = null;
  }

  // --- keyboard -------------------------------------------------------------

  handleTokenKey(event, id) {
    if (this.locked || this.drag) return;
    const value = this.valueOf(id);
    const step = event.shiftKey ? KEY_STEP_LARGE : KEY_STEP;
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      if (value === null) return;
      event.preventDefault();
      this.set(id, value + (event.key === 'ArrowRight' ? step : -step));
    } else if (event.key === 'Enter' && value === null) {
      event.preventDefault();
      this.set(id, DEFAULT_VALUE);
    } else if ((event.key === 'Delete' || event.key === 'Backspace') && value !== null) {
      event.preventDefault();
      this.set(id, null);
    }
  }

  handleOutsideKey(event) {
    if (event.key === 'Tab') {
      event.preventDefault();
      this.refocus();
      return;
    }
    this.handlePanelKey(event);
  }

  handlePanelKey(event) {
    if (event.key === 'Escape') {
      event.preventDefault();
      if (this.drag) this.cancelDrag();
      else this.close();
      return;
    }
    trapTab(this.dialog, event);
  }
}
