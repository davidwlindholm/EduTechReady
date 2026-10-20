// Session mode, the Færdig checks and the HTTP API client. Pure: no DOM and
// no three.js. The network calls take the fetch function as a parameter, so
// Node tests pass a fake.

import { AXES } from './axes.js';

/** Session codes: six characters, no I, O, 0 or 1. */
export const SESSION_CODE_PATTERN = /^[A-HJ-NP-Z2-9]{6}$/;
/** A lowercase UUID v4 (version nibble 4, variant 8, 9, a or b), as submit.php requires. */
export const CLIENT_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export const SUBMIT_URL = 'api/submit.php';
export const RESULTS_URL = 'api/results.php';
/** Default limit for one API request, in ms. A request that takes longer is aborted and reported as a network error. */
export const REQUEST_TIMEOUT_MS = 15000;

/**
 * Mode detection. `?session=` is uppercased; a valid code gives session
 * mode, anything else practice mode. `invalidCode` is true when a code was
 * given but is not valid (the game shows a notice). An empty `?session=`
 * counts as no code.
 * @param {string} search `location.search`, with or without the leading `?`
 * @returns {{ mode: 'session'|'practice', code: string|null, invalidCode: boolean }}
 */
export function detectMode(search) {
  const raw = new URLSearchParams(search).get('session');
  if (raw === null || raw === '') return { mode: 'practice', code: null, invalidCode: false };
  const code = raw.toUpperCase();
  if (SESSION_CODE_PATTERN.test(code)) return { mode: 'session', code, invalidCode: false };
  return { mode: 'practice', code: null, invalidCode: true };
}

/** @param {unknown} id */
export function isValidClientId(id) {
  return typeof id === 'string' && CLIENT_ID_PATTERN.test(id);
}

/**
 * A lowercase UUID v4. Uses `crypto.randomUUID` and falls back to
 * `crypto.getRandomValues` where randomUUID is missing (older Safari).
 * @param {{ randomUUID?: () => string, getRandomValues: (a: Uint8Array) => Uint8Array }} cryptoImpl
 */
export function createClientId(cryptoImpl) {
  if (typeof cryptoImpl.randomUUID === 'function') {
    const id = cryptoImpl.randomUUID().toLowerCase();
    if (isValidClientId(id)) return id;
  }
  const bytes = cryptoImpl.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40; // version 4
  bytes[8] = (bytes[8] & 0x3f) | 0x80; // variant 10xx
  const hex = [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function placementOf(placements, id) {
  return placements && Object.hasOwn(placements, id) ? placements[id] : null;
}

function isAxisValue(v) {
  return Number.isInteger(v) && v >= 0 && v <= 100;
}

/** Every `reason` missingPlacements() can give (each has a finish.missing.<reason> text in ui.json). */
export const MISSING_REASONS = Object.freeze(['notMet', ...AXES, 'both']);

/**
 * Characters that still lack a placement on either axis, in content order.
 * `reason` is `notMet` when the pair has not talked to the character yet (only
 * met characters can be placed), otherwise the missing axes: `samr`,
 * `rogers` or `both`.
 * @param {Array<{id: string, name: string}>} characters from characters.json
 * @param {{ met: string[], placements: Record<string, Record<string, number|null>> }} state
 * @returns {Array<{ id: string, name: string, reason: 'notMet'|'samr'|'rogers'|'both' }>}
 */
export function missingPlacements(characters, state) {
  const met = new Set(state.met);
  const missing = [];
  for (const character of characters) {
    const placement = placementOf(state.placements, character.id);
    const lacking = AXES.filter((axis) => !isAxisValue(placement?.[axis]));
    if (lacking.length === 0) continue;
    let reason;
    if (!met.has(character.id)) reason = 'notMet';
    else reason = lacking.length === AXES.length ? 'both' : lacking[0];
    missing.push({ id: character.id, name: character.name, reason });
  }
  return missing;
}

/**
 * The submit.php body: every character from characters.json and
 * nothing else, so stale ids in storage never reach the server.
 * @throws {Error} when a placement is missing (check missingPlacements first)
 */
export function buildSubmission(code, clientId, characters, placements) {
  const out = {};
  for (const { id } of characters) {
    const p = placementOf(placements, id);
    if (!isAxisValue(p?.samr) || !isAxisValue(p?.rogers)) throw new Error(`no complete placement for ${id}`);
    out[id] = { samr: p.samr, rogers: p.rogers };
  }
  return { session: code, clientId, placements: out };
}

/**
 * Send a request and read a JSON body. Never throws: a network failure or
 * timeout gives `{ status: 0 }`, a body that is not JSON gives `body: null`.
 * @returns {Promise<{ status: number, body: any }>}
 */
export async function requestJson(fetchImpl, url, init = {}, timeoutMs = REQUEST_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url, {
      ...init,
      cache: 'no-store',
      credentials: 'same-origin',
      signal: controller.signal,
      headers: { Accept: 'application/json', ...(init.headers ?? {}) },
    });
    let body = null;
    try {
      body = await response.json();
    } catch {
      body = null;
    }
    return { status: response.status, body };
  } catch {
    return { status: 0, body: null };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * POST the placements and classify the answer:
 * `submitted` (201), `already` (409 `already_submitted`, treated as
 * submitted), `closed` (503 `closed`) or `error` with a code: the API's error code, `network` (no answer or a
 * timeout) or `http_<status>` when the body has no code.
 * @returns {Promise<{ kind: 'submitted'|'already'|'closed'|'error', error?: string }>}
 */
export async function submitPlacements(fetchImpl, payload, { timeoutMs = REQUEST_TIMEOUT_MS } = {}) {
  const { status, body } = await requestJson(fetchImpl, SUBMIT_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  }, timeoutMs);
  if (status === 201 && body?.ok === true) return { kind: 'submitted' };
  if (status === 409 && body?.error === 'already_submitted') return { kind: 'already' };
  if (isClosed(status, body)) return { kind: 'closed' };
  return { kind: 'error', error: errorCode(status, body) };
}

/**
 * Submission errors a retry cannot fix: the API's validation codes (400),
 * `method` (405), `too_large` (413), `session_full` (429), and `client` (the
 * submission could not be built in the browser). Everything else (`network`,
 * `server`, `bad_response`, `http_5xx`, a host's 408 or 429) may pass on a
 * later try.
 */
const FINAL_ERRORS = new Set([
  'bad_json', 'invalid_session', 'invalid_client', 'invalid_placements', 'unknown_character', 'incomplete',
  'method', 'too_large', 'session_full', 'client',
]);
const RETRYABLE_HTTP = new Set([408, 425, 429]);

/**
 * Whether trying the same submission again can succeed (a failed submission
 * keeps the data; a retry is offered only where it can help).
 * An `http_4xx` without an API code (a missing or blocked endpoint) is final.
 * @param {string} code from submitPlacements: an API error code, `network` or `http_<status>`
 */
export function isRetryableError(code) {
  if (FINAL_ERRORS.has(code)) return false;
  const http = /^http_(\d{3})$/.exec(code);
  if (http) {
    const status = Number(http[1]);
    return status >= 500 || RETRYABLE_HTTP.has(status);
  }
  return true;
}

/**
 * Only the API's own 503 body means "collection closed". A 503 from
 * the host (overload, maintenance page, proxy) is a retryable error.
 */
function isClosed(status, body) {
  return status === 503 && body?.error === 'closed';
}

function errorCode(status, body) {
  if (status === 0) return 'network';
  const code = body?.error;
  return typeof code === 'string' && /^[a-z_]{1,40}$/.test(code) ? code : `http_${status}`;
}

/**
 * Check a results.php body and keep only characters from characters.json.
 * Returns null when the body does not have the documented results shape.
 * @param {unknown} body
 * @param {string[]} characterIds
 * @returns {{ n: number, characters: Record<string, {samr: number[], rogers: number[]}> }|null}
 */
export function parseResults(body, characterIds) {
  if (!body || typeof body !== 'object' || body.ok !== true) return null;
  if (!Number.isInteger(body.n) || body.n < 0) return null;
  const source = body.characters;
  if (!source || typeof source !== 'object' || Array.isArray(source)) return null;
  const characters = Object.create(null);
  for (const id of characterIds) {
    const entry = Object.hasOwn(source, id) ? source[id] : null;
    const values = (axis) => (Array.isArray(entry?.[axis]) ? entry[axis].filter(isAxisValue) : []);
    characters[id] = { samr: values('samr'), rogers: values('rogers') };
  }
  return { n: body.n, characters };
}

/**
 * GET the aggregate results for a session.
 * @returns {Promise<{ kind: 'ok', results: ReturnType<typeof parseResults> } | { kind: 'closed' } | { kind: 'error', error: string }>}
 */
export async function fetchResults(fetchImpl, code, characterIds, { timeoutMs = REQUEST_TIMEOUT_MS } = {}) {
  const url = `${RESULTS_URL}?session=${encodeURIComponent(code)}`;
  const { status, body } = await requestJson(fetchImpl, url, { method: 'GET' }, timeoutMs);
  if (isClosed(status, body)) return { kind: 'closed' };
  if (status === 200) {
    const results = parseResults(body, characterIds);
    if (results) return { kind: 'ok', results };
    return { kind: 'error', error: 'bad_response' };
  }
  return { kind: 'error', error: errorCode(status, body) };
}
