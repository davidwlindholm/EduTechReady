import { test } from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import {
  CLIENT_ID_PATTERN, MISSING_REASONS, SUBMIT_URL, buildSubmission, createClientId, detectMode, fetchResults, isRetryableError,
  isValidClientId, missingPlacements, parseResults, requestJson, submitPlacements,
} from '../../public/js/lib/session.js';

const CHARACTERS = [
  { id: 'mette', name: 'Mette (Underviser)' },
  { id: 'jonas', name: 'Jonas (Underviser)' },
  { id: 'henrik', name: 'Henrik (Pædagogisk konsulent)' },
];
const IDS = CHARACTERS.map((c) => c.id);
const FULL = { mette: { samr: 0, rogers: 100 }, jonas: { samr: 42, rogers: 18 }, henrik: { samr: 75, rogers: 50 } };
const CLIENT = '6f1c2a7e-3b4d-4c5e-8f90-a1b2c3d4e5f6';

/** A fake fetch that records calls and answers with a status and body (or throws). */
function fakeFetch(status, body, { throwError = null, rawText = null } = {}) {
  const calls = [];
  const fn = async (url, init) => {
    calls.push({ url, init });
    if (throwError) throw throwError;
    return {
      status,
      json: async () => (rawText !== null ? JSON.parse(rawText) : body),
    };
  };
  fn.calls = calls;
  return fn;
}

test('detectMode: valid codes give session mode, uppercased', () => {
  assert.deepEqual(detectMode('?session=K7MP3Q'), { mode: 'session', code: 'K7MP3Q', invalidCode: false });
  assert.deepEqual(detectMode('session=k7mp3q&debug=1'), { mode: 'session', code: 'K7MP3Q', invalidCode: false });
  assert.deepEqual(detectMode('?session=ABCDEF'), { mode: 'session', code: 'ABCDEF', invalidCode: false });
});

test('detectMode: no code gives practice mode without a notice', () => {
  assert.deepEqual(detectMode(''), { mode: 'practice', code: null, invalidCode: false });
  assert.deepEqual(detectMode('?debug=1'), { mode: 'practice', code: null, invalidCode: false });
  assert.deepEqual(detectMode('?session='), { mode: 'practice', code: null, invalidCode: false });
});

test('detectMode: invalid codes give practice mode with a notice', () => {
  // I, O, 0 and 1 are excluded; length must be exactly 6; no padding.
  for (const bad of ['K7MP3', 'K7MP3QQ', 'K7MP3I', 'K7MPOQ', 'K7MP0Q', 'K7MP1Q', 'K7MP3Q ', ' K7MP3Q', 'K7-P3Q', 'K7MP3Q\n']) {
    assert.deepEqual(detectMode(`?session=${encodeURIComponent(bad)}`), { mode: 'practice', code: null, invalidCode: true }, bad);
  }
});

test('isValidClientId accepts lowercase UUID v4 only', () => {
  assert.equal(isValidClientId(CLIENT), true);
  assert.equal(isValidClientId(CLIENT.toUpperCase()), false);
  assert.equal(isValidClientId('6f1c2a7e-3b4d-3c5e-8f90-a1b2c3d4e5f6'), false); // version 3
  assert.equal(isValidClientId('6f1c2a7e-3b4d-4c5e-cf90-a1b2c3d4e5f6'), false); // variant c
  assert.equal(isValidClientId(`${CLIENT}\n`), false);
  assert.equal(isValidClientId(null), false);
  assert.equal(isValidClientId(42), false);
});

test('createClientId gives valid v4 ids with randomUUID and with the fallback', () => {
  for (let i = 0; i < 200; i += 1) {
    assert.match(createClientId(webcrypto), CLIENT_ID_PATTERN);
    assert.match(createClientId({ getRandomValues: (a) => webcrypto.getRandomValues(a) }), CLIENT_ID_PATTERN);
  }
  // Fallback with all-ones and all-zero bytes still sets version and variant.
  assert.equal(createClientId({ getRandomValues: (a) => a.fill(0xff) }), 'ffffffff-ffff-4fff-bfff-ffffffffffff');
  assert.equal(createClientId({ getRandomValues: (a) => a.fill(0) }), '00000000-0000-4000-8000-000000000000');
});

test('missingPlacements lists unmet characters and missing axes in content order', () => {
  const state = {
    met: ['mette', 'jonas'],
    placements: { mette: { samr: 10, rogers: null }, jonas: { samr: null, rogers: null } },
  };
  assert.deepEqual(missingPlacements(CHARACTERS, state), [
    { id: 'mette', name: 'Mette (Underviser)', reason: 'rogers' },
    { id: 'jonas', name: 'Jonas (Underviser)', reason: 'both' },
    { id: 'henrik', name: 'Henrik (Pædagogisk konsulent)', reason: 'notMet' },
  ]);
  const onlyRogers = { met: ['mette'], placements: { mette: { samr: null, rogers: 3 } } };
  assert.equal(missingPlacements(CHARACTERS.slice(0, 1), onlyRogers)[0].reason, 'samr');
  assert.deepEqual(missingPlacements(CHARACTERS, { met: [], placements: FULL }), []);
});

test('missingPlacements ignores inherited keys and out-of-range values', () => {
  const placements = Object.create({ mette: { samr: 1, rogers: 1 } });
  placements.jonas = { samr: 101, rogers: 5 };
  placements.henrik = { samr: 5.5, rogers: 5 };
  const missing = missingPlacements(CHARACTERS, { met: IDS, placements });
  assert.deepEqual(missing.map((m) => [m.id, m.reason]), [['mette', 'both'], ['jonas', 'samr'], ['henrik', 'samr']]);
});

test('buildSubmission sends every character and nothing else', () => {
  const placements = { ...FULL, ghost: { samr: 1, rogers: 1 } };
  assert.deepEqual(buildSubmission('K7MP3Q', CLIENT, CHARACTERS, placements), {
    session: 'K7MP3Q', clientId: CLIENT, placements: FULL,
  });
  assert.throws(() => buildSubmission('K7MP3Q', CLIENT, CHARACTERS, { mette: FULL.mette }), /jonas/);
});

test('submitPlacements posts JSON to submit.php', async () => {
  const fetch = fakeFetch(201, { ok: true });
  const payload = buildSubmission('K7MP3Q', CLIENT, CHARACTERS, FULL);
  assert.deepEqual(await submitPlacements(fetch, payload), { kind: 'submitted' });
  assert.equal(fetch.calls.length, 1);
  const { url, init } = fetch.calls[0];
  assert.equal(url, SUBMIT_URL);
  assert.equal(init.method, 'POST');
  assert.equal(init.headers['Content-Type'], 'application/json');
  assert.equal(init.cache, 'no-store');
  assert.deepEqual(JSON.parse(init.body), payload);
});

test('submitPlacements classifies the API answers', async () => {
  const cases = [
    [409, { ok: false, error: 'already_submitted' }, { kind: 'already' }],
    [503, { ok: false, error: 'closed' }, { kind: 'closed' }],
    [400, { ok: false, error: 'incomplete' }, { kind: 'error', error: 'incomplete' }],
    [429, { ok: false, error: 'session_full' }, { kind: 'error', error: 'session_full' }],
    [500, { ok: false, error: 'server' }, { kind: 'error', error: 'server' }],
    [502, null, { kind: 'error', error: 'http_502' }],
    [500, { ok: false, error: '<b>x</b>' }, { kind: 'error', error: 'http_500' }],
    [201, { ok: false }, { kind: 'error', error: 'http_201' }],
    // A 503 or 409 from the host (overload, maintenance page, proxy) is not
    // the API's own answer: retryable error, never closed or already.
    [503, null, { kind: 'error', error: 'http_503' }],
    [503, { ok: false, error: 'server' }, { kind: 'error', error: 'server' }],
    [409, null, { kind: 'error', error: 'http_409' }],
    [409, { ok: false, error: 'conflict' }, { kind: 'error', error: 'conflict' }],
  ];
  for (const [status, body, expected] of cases) {
    assert.deepEqual(await submitPlacements(fakeFetch(status, body), {}), expected, `${status}`);
  }
  assert.deepEqual(await submitPlacements(fakeFetch(500, null, { rawText: '<html>' }), {}), { kind: 'error', error: 'http_500' });
  assert.deepEqual(await submitPlacements(fakeFetch(503, null, { rawText: '<html>Service Unavailable</html>' }), {}),
    { kind: 'error', error: 'http_503' });
  assert.deepEqual(await submitPlacements(fakeFetch(0, null, { throwError: new TypeError('offline') }), {}),
    { kind: 'error', error: 'network' });
});

test('requestJson aborts after the timeout and reports a network error', async () => {
  const hanging = (url, init) => new Promise((resolve, reject) => {
    init.signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
  });
  assert.deepEqual(await requestJson(hanging, 'x', {}, 20), { status: 0, body: null });
});

test('parseResults keeps known characters and checks the shape', () => {
  const body = {
    ok: true, session: 'K7MP3Q', n: 2,
    characters: { mette: { samr: [42, 55], rogers: [18, 30] }, ghost: { samr: [1], rogers: [1] }, jonas: { samr: [3, 'x', 200] } },
  };
  const parsed = parseResults(body, IDS);
  assert.equal(parsed.n, 2);
  assert.deepEqual(Object.keys(parsed.characters), IDS);
  assert.deepEqual(parsed.characters.mette, { samr: [42, 55], rogers: [18, 30] });
  assert.deepEqual(parsed.characters.jonas, { samr: [3], rogers: [] });
  assert.deepEqual(parsed.characters.henrik, { samr: [], rogers: [] });
  assert.equal(parseResults({ ...body, ok: false }, IDS), null);
  assert.equal(parseResults({ ...body, n: -1 }, IDS), null);
  assert.equal(parseResults({ ...body, n: '2' }, IDS), null);
  assert.equal(parseResults({ ...body, characters: [] }, IDS), null);
  assert.equal(parseResults(null, IDS), null);
});

test('fetchResults asks results.php for the session and classifies the answer', async () => {
  const fetch = fakeFetch(200, { ok: true, session: 'K7MP3Q', n: 0, characters: {} });
  const ok = await fetchResults(fetch, 'K7MP3Q', IDS);
  assert.equal(ok.kind, 'ok');
  assert.equal(ok.results.n, 0);
  assert.equal(fetch.calls[0].url, 'api/results.php?session=K7MP3Q');
  assert.equal(fetch.calls[0].init.method, 'GET');
  assert.deepEqual(await fetchResults(fakeFetch(503, { ok: false, error: 'closed' }), 'K7MP3Q', IDS), { kind: 'closed' });
  assert.deepEqual(await fetchResults(fakeFetch(503, null, { rawText: '<html>Service Unavailable</html>' }), 'K7MP3Q', IDS),
    { kind: 'error', error: 'http_503' });
  assert.deepEqual(await fetchResults(fakeFetch(503, null), 'K7MP3Q', IDS), { kind: 'error', error: 'http_503' });
  assert.deepEqual(await fetchResults(fakeFetch(200, { ok: true }), 'K7MP3Q', IDS), { kind: 'error', error: 'bad_response' });
  assert.deepEqual(await fetchResults(fakeFetch(400, { ok: false, error: 'invalid_session' }), 'K7MP3Q', IDS),
    { kind: 'error', error: 'invalid_session' });
});

test('MISSING_REASONS lists every reason missingPlacements gives', () => {
  assert.deepEqual([...MISSING_REASONS], ['notMet', 'samr', 'rogers', 'both']);
});

test('isRetryableError: only errors a later try can fix are retryable', () => {
  for (const code of ['network', 'server', 'bad_response', 'http_500', 'http_502', 'http_503', 'http_408', 'http_429', 'something_new']) {
    assert.equal(isRetryableError(code), true, code);
  }
  for (const code of ['bad_json', 'invalid_session', 'invalid_client', 'invalid_placements', 'unknown_character', 'incomplete',
    'method', 'too_large', 'session_full', 'client', 'http_400', 'http_403', 'http_404']) {
    assert.equal(isRetryableError(code), false, code);
  }
});
