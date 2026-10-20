import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTextLookup, formatText } from '../../public/js/lib/text.js';

test('formatText fills {name} placeholders and keeps unknown ones visible', () => {
  assert.equal(formatText('{n} par har svaret', { n: 3 }), '3 par har svaret');
  assert.equal(formatText('Hej {who}, {missing}', { who: 'Søren' }), 'Hej Søren, {missing}');
  assert.equal(formatText('ingen pladsholdere'), 'ingen pladsholdere');
});

test('t looks up Danish strings with æ, ø and å intact', () => {
  const t = createTextLookup({ 'menu.finish': 'Færdig', 'x.y': 'Gå til {sted}' });
  assert.equal(t('menu.finish'), 'Færdig');
  assert.equal(t('x.y', { sted: 'køkkenet' }), 'Gå til køkkenet');
});

test('t returns the key for a missing string and reports it once', () => {
  const missing = [];
  const t = createTextLookup({}, { onMissing: (k) => missing.push(k) });
  assert.equal(t('nope'), 'nope');
  assert.equal(t('nope'), 'nope');
  assert.deepEqual(missing, ['nope']);
});

test('t ignores inherited properties and non-string values', () => {
  const t = createTextLookup({ bad: 42 });
  assert.equal(t('toString'), 'toString');
  assert.equal(t('bad'), 'bad');
});

test('createTextLookup rejects a non-object', () => {
  assert.throws(() => createTextLookup(null), TypeError);
  assert.throws(() => createTextLookup(['a']), TypeError);
});
