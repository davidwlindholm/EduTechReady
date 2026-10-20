// Session codes and facilitator links. Pure: the random
// source is injected, so Node tests can drive it; no DOM, no three.js.

/** The code alphabet: A to Z without I and O, digits 2 to 9 (32 symbols). */
export const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const CODE_LENGTH = 6;
export const CODE_PATTERN = /^[A-HJ-NP-Z2-9]{6}$/;

/** Bytes requested per call to the random source. */
const BATCH = 16;

/**
 * Generate a code with rejection sampling: a random byte is used only if it
 * falls below the largest multiple of the alphabet size that fits in 256, so
 * every symbol is equally likely (no modulo bias, whatever the alphabet size).
 * @param {(bytes: Uint8Array) => Uint8Array} fillRandom fills the array in place,
 *   e.g. `(a) => crypto.getRandomValues(a)`
 * @param {{ length?: number, alphabet?: string }} [options]
 * @returns {string}
 */
export function generateSessionCode(fillRandom, { length = CODE_LENGTH, alphabet = CODE_ALPHABET } = {}) {
  const size = alphabet.length;
  if (size < 2 || size > 256) throw new RangeError('alphabet must have 2 to 256 symbols');
  const limit = 256 - (256 % size);
  const bytes = new Uint8Array(BATCH);
  let code = '';
  // A rejection is at most (256 - limit) / 256 < 1/2 likely, so this ends quickly;
  // the round cap only guards against a broken random source.
  for (let round = 0; code.length < length; round += 1) {
    if (round > 1000) throw new Error('random source returned too many rejected bytes');
    fillRandom(bytes);
    for (const byte of bytes) {
      if (byte < limit) code += alphabet[byte % size];
      if (code.length === length) break;
    }
  }
  return code;
}

/**
 * Normalise a code from a URL: uppercase it (as the game does). Returns
 * null if it is not a valid session code.
 * @param {string|null|undefined} raw
 * @returns {string|null}
 */
export function parseSessionCode(raw) {
  if (typeof raw !== 'string') return null;
  const code = raw.toUpperCase();
  return CODE_PATTERN.test(code) ? code : null;
}

/**
 * Full participant and projector URLs for a code, resolved against the
 * facilitator page's own address, so they work wherever the site is deployed
 * (e.g. under /edutechready/). The page's own query and hash are dropped.
 * @param {string} pageHref the facilitator page's `location.href`
 * @param {string} code a valid session code
 * @returns {{ participant: string, projector: string }}
 */
export function sessionLinks(pageHref, code) {
  if (!CODE_PATTERN.test(code)) throw new RangeError(`invalid session code: ${code}`);
  const link = (file) => {
    const url = new URL(file, pageHref);
    url.search = '';
    url.hash = '';
    url.searchParams.set('session', code);
    return url.href;
  };
  return { participant: link('index.html'), projector: link('results.html') };
}
