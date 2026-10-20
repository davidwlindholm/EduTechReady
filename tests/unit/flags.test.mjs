import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseFlags } from '../../public/js/lib/flags.js';

test('debug is on only for debug=1', () => {
  assert.equal(parseFlags('?debug=1').debug, true);
  assert.equal(parseFlags('debug=1&session=K7MP3Q').debug, true);
  assert.equal(parseFlags('').debug, false);
  assert.equal(parseFlags('?debug=true').debug, false);
  assert.equal(parseFlags('?debug=0').debug, false);
});
