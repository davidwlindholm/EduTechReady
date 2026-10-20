// Client state and storage. Pure: the storage object is injected,
// so Node tests use a fake and the browser passes window.localStorage (or null).

import { AXES, clampValue, isAxis } from './axes.js';
import { isValidClientId } from './session.js';

export const STORAGE_PREFIX = 'lounge:v1:';
export const PRACTICE_KEY = 'practice';

/**
 * Storage key for a session code, or the practice key when there is none.
 * Code validation lives in lib/session.js; this only builds the key.
 * @param {string|null} code
 */
export function storageKey(code) {
  return STORAGE_PREFIX + (code || PRACTICE_KEY);
}

/**
 * The keyed maps (`asked`, `placements`) have no prototype, so an id such as
 * `__proto__` or `constructor` from tampered storage is just a key.
 * getState() returns plain copies.
 * @param {string|null} clientId
 */
export function createInitialState(clientId = null) {
  return {
    clientId, met: [], asked: Object.create(null), placements: Object.create(null), submitted: false, submittedAt: null,
  };
}

function isStringArray(value) {
  return Array.isArray(value) && value.every((v) => typeof v === 'string');
}

function normalizePlacement(raw) {
  const out = {};
  for (const axis of AXES) {
    const v = raw?.[axis];
    out[axis] = typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= 100 ? v : null;
  }
  return out;
}

/**
 * Accept anything parsed from storage and return a well-formed state.
 * Malformed parts are dropped, never trusted.
 *
 * A stored clientId is kept only when it is a lowercase UUID v4 (the form
 * submit.php accepts), so an invalid one is replaced
 * instead of failing every submit. After submission it is kept as stored:
 * it identifies the pair's submission.
 * @param {unknown} raw
 * @param {string|null} [clientId] used when the stored value has no usable one
 * @param {{ knownIds?: Iterable<string>|null }} [options] when given, ids
 *   outside this set (characters no longer in characters.json) are dropped
 */
export function normalizeState(raw, clientId = null, { knownIds = null } = {}) {
  const state = createInitialState(clientId);
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return state;
  const known = knownIds ? new Set(knownIds) : null;
  const keep = (id) => !known || known.has(id);
  state.submitted = raw.submitted === true;
  state.submittedAt = typeof raw.submittedAt === 'string' ? raw.submittedAt : null;
  if (isValidClientId(raw.clientId) || (state.submitted && typeof raw.clientId === 'string' && raw.clientId)) {
    state.clientId = raw.clientId;
  }
  if (isStringArray(raw.met)) state.met = [...new Set(raw.met)].filter(keep);
  if (raw.asked && typeof raw.asked === 'object') {
    for (const [id, list] of Object.entries(raw.asked)) {
      if (keep(id) && isStringArray(list)) state.asked[id] = [...new Set(list)];
    }
  }
  if (raw.placements && typeof raw.placements === 'object') {
    for (const [id, placement] of Object.entries(raw.placements)) {
      if (keep(id) && placement && typeof placement === 'object') state.placements[id] = normalizePlacement(placement);
    }
  }
  return state;
}

/**
 * Create the state store. Every storage access is wrapped in try/catch;
 * when storage fails, state lives on in memory.
 * @param {object} options
 * @param {{getItem(k: string): string|null, setItem(k: string, v: string): void}|null} options.storage
 * @param {string} options.key
 * @param {() => string|null} [options.createClientId] called when no usable stored clientId exists
 * @param {Iterable<string>|null} [options.knownIds] character ids from characters.json; others are dropped on load
 * @param {(err: unknown) => void} [options.onStorageError]
 */
export function createStore({
  storage, key, createClientId = () => null, knownIds = null, onStorageError = () => {},
}) {
  let state = createInitialState();
  const listeners = new Set();

  function read() {
    if (!storage) return null;
    try {
      const text = storage.getItem(key);
      return text === null ? null : JSON.parse(text);
    } catch (err) {
      onStorageError(err);
      return null;
    }
  }

  function write() {
    if (!storage) return;
    try {
      storage.setItem(key, JSON.stringify(state));
    } catch (err) {
      onStorageError(err);
    }
  }

  function commit() {
    write();
    const snapshot = getState();
    listeners.forEach((fn) => fn(snapshot));
  }

  /** A deep copy, so callers cannot mutate the store. */
  function getState() {
    return structuredClone(state);
  }

  state = normalizeState(read(), null, { knownIds });
  if (!state.clientId) state.clientId = createClientId();
  write();

  return {
    getState,

    /** @param {(state: object) => void} fn @returns {() => void} unsubscribe */
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },

    /** @param {string} id character id */
    markMet(id) {
      if (state.met.includes(id)) return;
      state.met.push(id);
      commit();
    },

    /** @param {string} id character id @param {string} questionId */
    markAsked(id, questionId) {
      const list = state.asked[id] ?? (state.asked[id] = []); // asked has no prototype
      if (list.includes(questionId)) return;
      list.push(questionId);
      commit();
    },

    /**
     * @param {string} id character id
     * @param {'samr'|'rogers'} axis
     * @param {number|null} value null removes the placement; numbers are rounded and clamped to 0..100
     */
    setPlacement(id, axis, value) {
      if (typeof id !== 'string' || !id) throw new TypeError('character id must be a non-empty string');
      if (!isAxis(axis)) throw new RangeError(`unknown axis ${axis}`);
      const next = value === null ? null : clampValue(value);
      // placements has no prototype, so only stored ids are found here.
      if (next === null && !state.placements[id]) return; // nothing to remove
      const placement = state.placements[id] ?? (state.placements[id] = normalizePlacement(null));
      if (placement[axis] === next) return;
      placement[axis] = next;
      commit();
    },

    /**
     * Record a successful submission: the panels become read-only.
     * @param {string} at ISO 8601 timestamp
     */
    markSubmitted(at) {
      if (state.submitted) return;
      state.submitted = true;
      state.submittedAt = at;
      commit();
    },
  };
}
