import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { findCharacter, initialsOf, splitNameRole } from '../../public/js/lib/characters.js';

test('splitNameRole separates the name and the parenthesised role', () => {
  assert.deepEqual(splitNameRole('Mette (Underviser)'), { name: 'Mette', role: 'Underviser' });
  assert.deepEqual(splitNameRole('Søren (Pædagogisk IT-rådgiver)'), { name: 'Søren', role: 'Pædagogisk IT-rådgiver' });
  assert.deepEqual(splitNameRole('Lars'), { name: 'Lars', role: '' });
});

test('initialsOf uses the name part only', () => {
  assert.equal(initialsOf('Søren (Pædagogisk IT-rådgiver)'), 'S');
  assert.equal(initialsOf('Anne Marie (Studievejleder)'), 'AM');
});

test('findCharacter returns the entry or null', () => {
  const content = { characters: [{ id: 'mette' }] };
  assert.equal(findCharacter(content, 'mette').id, 'mette');
  assert.equal(findCharacter(content, 'x'), null);
});

const content = JSON.parse(readFileSync(new URL('../../public/content/characters.json', import.meta.url), 'utf8'));
const assets = JSON.parse(readFileSync(new URL('../../public/content/assets.json', import.meta.url), 'utf8'));
// render/theme.js imports nothing, so Node can read the alien's look from it.
const { THEME } = await import('../../public/js/render/theme.js');
const THEME_ALIEN = { model: THEME.alien.model, materialColors: THEME.alien.materialColors };

/** Material names stored in a GLB (its JSON chunk). */
function glbMaterials(file) {
  const buf = readFileSync(new URL(`../../public/${file}`, import.meta.url));
  const length = buf.readUInt32LE(12);
  const json = JSON.parse(buf.subarray(20, 20 + length).toString('utf8'));
  return new Set((json.materials ?? []).map((m) => m.name));
}

// The eight characters: id, name and pose.
const CAST = [
  ['mette', 'Mette (Underviser)', 'sit'],
  ['jonas', 'Jonas (Underviser)', 'sit'],
  ['karim', 'Karim (Administration)', 'sit'],
  ['anne', 'Anne (Studievejleder)', 'sit'],
  ['sofie', 'Sofie (Underviser)', 'sit'],
  ['lars', 'Lars (IT)', 'stand'],
  ['birgitte', 'Birgitte (Uddannelsesleder)', 'stand'],
  ['henrik', 'Henrik (Pædagogisk konsulent)', 'stand'],
];
const WOMEN = new Set(['mette', 'anne', 'sofie', 'birgitte']);

test('characters.json: exactly the eight characters, player char_m4', () => {
  assert.deepEqual(content.characters.map((c) => [c.id, c.name, c.pose]), CAST);
  assert.equal(content.player.model, 'char_m4');
});

test('characters.json: has the expected shape', () => {
  for (const c of content.characters) {
    assert.match(c.id, /^[a-z][a-z0-9-]{0,39}$/);
    assert.equal(assets.models[c.model]?.kind, 'character', `${c.id} model`);
    assert.ok(['N', 'E', 'S', 'W'].includes(c.facing));
    assert.ok(Number.isInteger(c.col) && Number.isInteger(c.row));
    assert.match(c.portrait, /^assets\/portraits\/[a-z0-9_-]+\.(svg|png|webp)$/);
    assert.ok(existsSync(new URL(`../../public/${c.portrait}`, import.meta.url)), `${c.id} portrait exists`);
    // Text, question count and the cap are content to change (docs/CONTENT.md);
    // these checks hold whether or not a text is still a [PLADSHOLDER].
    assert.ok(c.maxQuestions === null || (Number.isInteger(c.maxQuestions) && c.maxQuestions <= c.questions.length), `${c.id} maxQuestions`);
    assert.ok(c.summary.length > 0 && c.greeting.length > 0, `${c.id} summary and greeting`);
    assert.ok(c.questions.length >= 1, `${c.id} has questions`);
    assert.equal(new Set(c.questions.map((q) => q.id)).size, c.questions.length, `${c.id} question ids are unique`);
    for (const q of c.questions) assert.ok(q.text.length > 0 && q.answer.length > 0, `${c.id} ${q.id}`);
  }
});

// No test pins the dialogue text: writing a greeting or a question, or the
// last [PLADSHOLDER], is a content change (npm run validate counts the markers).

test('characters.json: women use char_w1-4, men char_m1-3, and no two visible characters share model and colours', () => {
  for (const c of content.characters) {
    assert.match(c.model, WOMEN.has(c.id) ? /^char_w[1-4]$/ : /^char_m[1-3]$/, `${c.id} model`);
  }
  // The player, every character and the alien behind the closed door.
  const looks = [content.player, ...content.characters, THEME_ALIEN].map((c) => `${c.model}|${JSON.stringify(Object.entries(c.materialColors).sort())}`);
  assert.equal(new Set(looks).size, looks.length);
});

test('characters.json: Henrik reuses a man\'s model in colours no one else wears', () => {
  const henrik = findCharacter(content, 'henrik');
  assert.match(henrik.model, /^char_m[1-3]$/);
  const sameModel = [content.player, ...content.characters].filter((c) => c !== henrik && c.model === henrik.model);
  assert.ok(sameModel.length >= 1, 'he shares a model (there are only four men)');
  for (const other of sameModel) {
    // Clearly distinct: his shirt colour differs from the other wearer's (or its default).
    assert.notEqual(henrik.materialColors.Shirt, other.materialColors.Shirt, `${other.id ?? 'player'} shirt`);
  }
  assert.equal(henrik.pose, 'stand');
  assert.equal(henrik.facing, 'W');
});

test('characters.json: materialColors name real materials and hold hex colours', () => {
  for (const c of [content.player, ...content.characters]) {
    const materials = glbMaterials(assets.models[c.model].file);
    for (const [name, hex] of Object.entries(c.materialColors)) {
      assert.ok(materials.has(name), `${c.id ?? 'player'}: ${c.model} has no material "${name}"`);
      assert.match(hex, /^#[0-9a-f]{6}$/i);
    }
  }
});
