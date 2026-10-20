import { test } from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import {
  CODE_ALPHABET, CODE_PATTERN, generateSessionCode, parseSessionCode, sessionLinks,
} from '../../public/js/lib/sessionCode.js';

const cryptoFill = (bytes) => webcrypto.getRandomValues(bytes);

/** A random source that replays the given bytes, cycling. */
function scripted(values) {
  let i = 0;
  return (bytes) => {
    for (let k = 0; k < bytes.length; k += 1) {
      bytes[k] = values[i % values.length];
      i += 1;
    }
    return bytes;
  };
}

test('alphabet: 32 symbols, no I, O, 0 or 1', () => {
  assert.equal(CODE_ALPHABET.length, 32);
  assert.equal(new Set(CODE_ALPHABET).size, 32);
  for (const c of 'IO01') assert.ok(!CODE_ALPHABET.includes(c), c);
  for (const c of CODE_ALPHABET) assert.match(c, /^[A-HJ-NP-Z2-9]$/);
});

test('1,000 generated codes all match the session pattern', () => {
  const seen = new Set();
  for (let i = 0; i < 1000; i += 1) {
    const code = generateSessionCode(cryptoFill);
    assert.match(code, /^[A-HJ-NP-Z2-9]{6}$/);
    assert.ok(CODE_PATTERN.test(code));
    seen.add(code);
  }
  // 32^6 is about a billion codes; a handful of collisions would mean a broken source.
  assert.ok(seen.size >= 995, `only ${seen.size} distinct codes`);
});

test('every symbol turns up with crypto randomness', () => {
  const counts = new Map();
  for (let i = 0; i < 1000; i += 1) {
    for (const c of generateSessionCode(cryptoFill)) counts.set(c, (counts.get(c) ?? 0) + 1);
  }
  assert.equal(counts.size, 32);
  // 6,000 symbols, 187.5 expected each; a fair source stays far inside these bounds.
  for (const [c, n] of counts) assert.ok(n > 100 && n < 300, `${c}: ${n}`);
});

test('bytes map straight onto the 32-symbol alphabet', () => {
  assert.equal(generateSessionCode(scripted([0, 1, 2, 31, 32, 255])), 'ABC9A9');
});

test('rejection sampling skips bytes at or above the largest multiple', () => {
  // Alphabet of 3: limit is 255, so byte 255 is rejected rather than folded onto "A".
  const code = generateSessionCode(scripted([255, 255, 0, 255, 1, 2, 254]), { length: 4, alphabet: 'ABC' });
  assert.equal(code, 'ABCC');
  // A source that only returns rejected bytes fails loudly instead of looping forever.
  assert.throws(() => generateSessionCode(scripted([255]), { alphabet: 'ABC' }), /rejected/);
});

test('rejection sampling gives a uniform distribution for an awkward alphabet', () => {
  // Cycle through every byte value four times (1,024 bytes). Rejection drops the
  // four 255s and leaves 1,020 symbols, 340 each. Plain modulo would take the
  // first 1,020 bytes (three full cycles plus 0..251) and give A 342, B 339, C 339.
  const all = Array.from({ length: 256 }, (_, i) => i);
  const code = generateSessionCode(scripted(all), { length: 1020, alphabet: 'ABC' });
  const counts = { A: 0, B: 0, C: 0 };
  for (const c of code) counts[c] += 1;
  assert.deepEqual(counts, { A: 340, B: 340, C: 340 });
});

test('parseSessionCode uppercases and rejects invalid codes', () => {
  assert.equal(parseSessionCode('k7mp3q'), 'K7MP3Q');
  for (const bad of [null, undefined, '', ' K7MP3Q', 'K7MP3', 'K7MP3QQ', 'K7MP3O', 'K7MP31', 'K7MP3I', 'K7MP30', 'K7-P3Q', 42]) {
    assert.equal(parseSessionCode(bad), null, String(bad));
  }
});

test('links resolve against the page location, including a subdirectory', () => {
  const links = sessionLinks('https://experiments.davidlindholm.info/edutechready/facilitator.html?session=AAAAAA#x', 'K7MP3Q');
  assert.deepEqual(links, {
    participant: 'https://experiments.davidlindholm.info/edutechready/index.html?session=K7MP3Q',
    projector: 'https://experiments.davidlindholm.info/edutechready/results.html?session=K7MP3Q',
  });
  assert.deepEqual(sessionLinks('http://127.0.0.1:8080/facilitator.html', 'ABC234'), {
    participant: 'http://127.0.0.1:8080/index.html?session=ABC234',
    projector: 'http://127.0.0.1:8080/results.html?session=ABC234',
  });
  // A directory URL (index served for "/edutechready/") resolves the same way.
  assert.equal(sessionLinks('https://example.org/a/b/', 'ABC234').participant, 'https://example.org/a/b/index.html?session=ABC234');
});

test('sessionLinks refuses invalid codes', () => {
  assert.throws(() => sessionLinks('http://127.0.0.1:8080/facilitator.html', 'abc'), RangeError);
});
