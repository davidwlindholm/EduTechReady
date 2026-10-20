// scripts/validate_content.mjs (schemas, cross-references, ui.json
// key usage, user-facing literals, placeholder count).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  scanLiterals, checkUiKeys, findDuplicateKeys, checkUserFacingLiterals, checkCrossReferences, createSchemaValidators,
  countPlaceholders, validateProject, DYNAMIC_KEYS, questionCountWarnings, EXPECTED_QUESTIONS,
  instructionsLengthErrors, instructionsLines, INSTRUCTIONS_MAX_LINES,
} from '../../scripts/validate_content.mjs';

const read = (name) => JSON.parse(readFileSync(new URL(`../../public/content/${name}.json`, import.meta.url), 'utf8'));
const clone = (v) => structuredClone(v);
const content = () => ({ level: read('level'), assets: read('assets'), characters: read('characters'), ui: read('ui'), instructions: read('instructions') });
// Cross-reference tests skip the GLB reads unless they test materials.
const anyMaterial = { materialNames: () => ({ has: () => true }) };

test('the real content passes every check', () => {
  const { errors, placeholders } = validateProject();
  assert.deepEqual(errors, []);
  // The count, whatever it is: writing the last placeholder must not fail a test.
  assert.equal(placeholders.total, countPlaceholders(content()).total);
});

test('scanLiterals finds strings and templates, skips comments and regexes, and records the call', () => {
  const src = [
    "// t('not.a.key')",
    "/* 'nor.this' */",
    "const re = /['\"`]/g;",
    "const a = t('menu.samr');",
    "const b = t(`finish.missing.${reason}`, { x: `in ${'nested.key'}` });",
    "console.warn('Some developer text');",
    "const c = 10 / 2; const d = 'after.division';",
  ].join('\n');
  const lits = scanLiterals(src);
  const plain = lits.filter((l) => l.parts.length === 1).map((l) => l.parts[0]);
  assert.deepEqual(plain.sort(), ['Some developer text', 'after.division', 'menu.samr', 'nested.key'].sort());
  const tpl = lits.find((l) => l.kind === 'template' && l.parts[0] === 'finish.missing.');
  assert.deepEqual(tpl.parts, ['finish.missing.', '']);
  assert.equal(tpl.line, 5);
  assert.deepEqual(lits.find((l) => l.parts[0] === 'Some developer text').calls, ['console.warn']);
});

const source = (file, src) => ({ file, literals: scanLiterals(src) });

test('checkUiKeys: missing keys, unused keys and undeclared dynamic keys fail', () => {
  const ui = { 'menu.samr': 'SAMR', 'menu.rogers': 'Rogers', 'menu.unused': 'x' };
  const { errors } = checkUiKeys(ui, [source('public/js/a.js', "t('menu.samr'); t('menu.rogers'); t('menu.typo'); t(`menu.${x}`); load('menu.html');")], []);
  assert.ok(errors.some((e) => e.includes('"menu.typo"') && e.includes('not a ui.json key')));
  assert.ok(errors.some((e) => e.includes('"menu.unused" is not used')));
  assert.ok(errors.some((e) => e.includes('built at run time') && e.includes('DYNAMIC_KEYS')));
  assert.ok(!errors.some((e) => e.includes('menu.html')), 'file names are not keys');
});

test('checkUiKeys: a declared dynamic key counts its keys as used and needs each to exist', () => {
  const ui = { 'menu.samr': 'SAMR', 'menu.rogers': 'Rogers' };
  const declared = [{ file: 'public/js/a.js', template: 'menu.${}', keys: ['menu.samr', 'menu.rogers', 'menu.gone'], why: 'test' }];
  const { errors } = checkUiKeys(ui, [source('public/js/a.js', 't(`menu.${axis}`);')], declared);
  assert.deepEqual(errors, ['public/js/a.js: builds the ui.json key "menu.gone" (test), but ui.json has no such key']);
  const stale = checkUiKeys(ui, [source('public/js/a.js', "t('menu.samr'); t('menu.rogers');")], declared.slice(0, 1));
  assert.ok(stale.errors.some((e) => e.includes('no longer occurs')));
});

test('checkUiKeys: keys built by string concatenation or kept as a prefix fail instead of being skipped', () => {
  const ui = { 'notice.practice': 'x', 'notice.closed': 'y' };
  const used = "t('notice.practice'); t('notice.closed');";
  const concat = checkUiKeys(ui, [source('public/js/a.js', `${used} export const w = (r) => t('notice.' + r);`)], []).errors;
  assert.ok(concat.some((e) => e.includes('"notice."') && e.includes('string concatenation') && e.includes('DYNAMIC_KEYS')), concat.join('\n'));
  const before = checkUiKeys(ui, [source('public/js/a.js', `${used} t(prefix + 'notice.closed');`)], []).errors;
  assert.ok(before.some((e) => e.includes('"notice.closed"') && e.includes('string concatenation')), 'a full key glued onto something is still a run-time key');
  const prefix = checkUiKeys(ui, [source('public/js/a.js', `${used} const p = 'notice.'; t(p + r);`)], []).errors;
  assert.ok(prefix.some((e) => e.includes('"notice."') && e.includes('run time')));
  const tplConcat = checkUiKeys(ui, [source('public/js/a.js', `${used} t(\`notice.\` + r);`)], []).errors;
  assert.ok(tplConcat.some((e) => e.includes('"notice."')), 'a template without expressions is a plain string');
  // Ordinary string arithmetic is not a key.
  assert.deepEqual(checkUiKeys(ui, [source('public/js/a.js', `${used} const s = 'Fejl: ' + code; const f = name + '.png';`)], []).errors, []);
});

test('checkUiKeys: every literal in t()\'s first argument must be a key, in any namespace', () => {
  const ui = { 'menu.finish': 'Færdig', 'menu.samr': 'SAMR' };
  const used = "t('menu.finish'); this.t('menu.samr');";
  const check = (src) => checkUiKeys(ui, [source('public/js/a.js', `${used} ${src}`)], []).errors;
  // A namespace ui.json does not have yet is still checked.
  assert.ok(check("export const zz = () => t('newns.doesNotExist');").some((e) => e.includes('"newns.doesNotExist"') && e.includes('not a ui.json key')));
  assert.ok(check("this.t(x ? 'menu.finish' : 'nope');").some((e) => e.includes('"nope"')));
  // Pieces joined into a key are not keys themselves.
  assert.ok(check("t(['menu', x].join('.'));").some((e) => e.includes('"menu"')));
  // A template in t() is a run-time key whatever its start.
  assert.ok(check('t(`newns.${x}`);').some((e) => e.includes('built at run time')));
  // Parameters, other calls' arguments and t passed as a value are not keys.
  assert.deepEqual(check("t('menu.finish', { name: 'Ida', n: f('x') }); g('y', t('menu.samr')); h(t, 'z');"), []);
});

test('findDuplicateKeys finds a key twice in the same object, at any depth', () => {
  assert.deepEqual(findDuplicateKeys('{\n  "menu.finish": "X",\n  "menu.samr": "S",\n  "menu.finish": "Færdig"\n}'),
    [{ key: 'menu.finish', path: 'menu.finish', line: 4 }]);
  assert.deepEqual(findDuplicateKeys('{"models":{"desk":{"clips":[{"a":1,"a":2}]},"chair":{},"desk":{}}}').map((d) => d.path),
    ['models.desk.clips.a', 'models.desk']);
  assert.deepEqual(findDuplicateKeys('{"a":{"x":1},"b":{"x":1},"c":["a","a"],"d":"\\"a\\""}'), [], 'same key in sibling objects, and strings as values, are fine');
});

test('DYNAMIC_KEYS lists the keys the code can build', () => {
  const byTemplate = Object.fromEntries(DYNAMIC_KEYS.map((d) => [d.template, d.keys]));
  assert.deepEqual(byTemplate['finish.missing.${}'], ['finish.missing.notMet', 'finish.missing.samr', 'finish.missing.rogers', 'finish.missing.both']);
  assert.deepEqual(byTemplate['results.axis.${}'], ['results.axis.samr', 'results.axis.rogers']);
});

test('checkUserFacingLiterals flags Danish and prose outside console and Error calls and debug files', () => {
  const errors = checkUserFacingLiterals([
    source('public/js/ui/x.js', [
      "el.textContent = 'Luk vinduet';",
      "el.textContent = 'spurgt på gangen';",
      "el.textContent = 'mangler i alt for mange';",
      "h('div', { className: 'button button--primary' });",
      "h('div', { className: 'menu panel' });",
      "throw new Error('Something went wrong here');",
      "console.warn('Kunne ikke gemme');",
    ].join('\n')),
    source('public/js/debug.js', "el.textContent = 'Fejl i debug';"),
  ]);
  assert.equal(errors.length, 3, errors.join('\n'));
  assert.ok(errors[0].startsWith('public/js/ui/x.js:1:'));
});

test('schemas reject broken shapes and accept the real files', () => {
  const v = createSchemaValidators();
  const c = content();
  for (const name of ['level', 'assets', 'characters', 'ui']) assert.equal(v[name](c[name]), true, name);
  const ch = clone(c.characters);
  ch.characters[0].pose = 'lie';
  ch.characters[1].materialColors.Shirt = 'blue';
  ch.characters[2].extra = 1;
  assert.equal(v.characters(ch), false);
  assert.equal(v.characters.errors.length, 3);
  const assets = clone(c.assets);
  delete assets.models.chair.footprint;
  assets.models.mug.clips = { idle: 'a', walk: 'b', sit: null };
  assert.equal(v.assets(assets), false);
  const level = clone(c.level);
  level.legend.x = 'floor';
  level.rows[0] += 'x';
  assert.equal(v.level(level), false);
  assert.equal(v.ui({ 'menu.samr': 'Bad {brace' }), false);
  assert.equal(v.ui({ Menu: 'x' }), false);
  assert.equal(v.ui({ 'menu.count': '{n} par' }), true);
});

test('cross-references: tiles, seats, ids, look-alikes, assets and portraits', () => {
  const c = content();
  assert.deepEqual(checkCrossReferences(c, anyMaterial), []);

  const broken = clone(c);
  const [mette, jonas, , , , lars, birgitte, henrik] = broken.characters.characters;
  jonas.id = 'mette'; // duplicate id
  lars.col = 9; lars.row = 4; // stands on the counter
  birgitte.col = 0; birgitte.row = 1; // on the closed door
  henrik.model = 'char_m1'; henrik.materialColors = clone(jonas.materialColors); // looks like Jonas
  mette.portrait = 'assets/portraits/nobody.svg';
  mette.maxQuestions = 9;
  const errors = checkCrossReferences(broken, anyMaterial).join('\n');
  for (const expected of ['duplicate id', 'stands on furniture', 'door_closed, not a walkable tile', '"henrik": same model and colours as',
    'nobody.svg does not exist', 'maxQuestions 9']) {
    assert.ok(errors.includes(expected), `expected "${expected}" in:\n${errors}`);
  }

  const props = clone(c);
  props.level.props.push({ asset: 'chair', x: 1, y: 0, z: 1, rotationDeg: 0 });
  assert.match(checkCrossReferences(props, anyMaterial).join('\n'), /chair.*not a prop/);

  const seated = clone(c);
  seated.characters.characters[0].col = 8; // Mette away from her chair
  assert.match(checkCrossReferences(seated, anyMaterial).join('\n'), /holds no chair or sofa/);
});

test('cross-references: a standing character must not cut off walkable tiles', () => {
  const c = clone(content());
  const lars = c.characters.characters.find((x) => x.id === 'lars');
  c.characters.characters.push({
    ...clone(lars), id: 'eva', name: 'Eva (Underviser)', model: 'char_w2', col: 11, row: 9, facing: 'W', pose: 'stand',
    materialColors: { Shirt: '#123456' },
  });
  const errors = checkCrossReferences(c, anyMaterial);
  assert.ok(errors.includes('level.json/characters.json: walkable tile (12, 9) cannot be reached from playerStart with the furniture and characters in place'), errors.join('\n'));
});

test('cross-references: material names must exist in the GLB', () => {
  const c = clone(content());
  c.characters.characters[0].materialColors.Shrit = '#123456';
  const errors = checkCrossReferences(c);
  assert.deepEqual(errors, ['characters.json: character "mette": materialColors "Shrit" is not a material of char_w1 (see docs/ASSETS.md)']);
});

test('cross-references: character clips must exist in the GLB, idle and walk are required', () => {
  const c = clone(content());
  c.assets.models.char_w1.clips.walk = 'Female_Wlak';
  c.assets.models.char_m2.clips.sit = 'Man_Sit';
  assert.deepEqual(checkCrossReferences(c, anyMaterial), [
    'assets.json: model "char_w1": clips.walk "Female_Wlak" is not an animation in assets/models/char_w1.glb (it has: Female_Idle, Female_Sitting, Female_Walk)',
    'assets.json: model "char_m2": clips.sit "Man_Sit" is not an animation in assets/models/char_m2.glb (it has: Man_Idle, Man_Sitting, Man_Walk)',
  ]);
  // A null sit clip is allowed (the model just cannot sit); idle is not optional.
  const noIdle = clone(content());
  noIdle.assets.models.char_m4.clips.sit = null;
  delete noIdle.assets.models.char_m4.clips.idle;
  const allClips = () => new Set(['Female_Idle', 'Female_Walk', 'Female_Sitting', 'Man_Idle', 'Man_Walk', 'Man_Sitting']);
  assert.deepEqual(checkCrossReferences(noIdle, { ...anyMaterial, animationNames: allClips }),
    ['assets.json: model "char_m4": a character needs a clip for "idle"']);
});

test('fewer than three questions is a warning, not an error', () => {
  const c = content();
  assert.equal(EXPECTED_QUESTIONS, 3);
  assert.deepEqual(questionCountWarnings(c.characters), [], 'every character has three questions now');
  const fewer = clone(c.characters);
  fewer.characters[0].questions.pop();
  const warnings = questionCountWarnings(fewer);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], new RegExp(`"${fewer.characters[0].id}" has 2 question`));
  // Still valid content: the check never adds an error.
  assert.deepEqual(checkCrossReferences({ ...c, characters: fewer }, anyMaterial), []);
});

test('countPlaceholders counts per file and per character', () => {
  const c = content();
  const n = countPlaceholders(c);
  assert.equal(n.ui, 0);
  assert.equal(n.characters, n.perCharacter.reduce((s, x) => s + x.n, 0));
  const none = clone(c);
  none.characters = JSON.parse(JSON.stringify(c.characters).replaceAll('[PLADSHOLDER]', 'Tekst'));
  assert.equal(countPlaceholders(none).total, 0);
});

test('instructions.json: the schema limits the shape, the validator the total length', () => {
  const validate = createSchemaValidators().instructions;
  const real = read('instructions');
  assert.ok(validate(real));
  assert.deepEqual(instructionsLengthErrors(real), []);
  const noClose = clone(real);
  delete noClose.close;
  assert.ok(!validate(noClose));
  const extra = clone(real);
  extra.footer = 'x';
  assert.ok(!validate(extra));
  const tooMany = clone(real);
  tooMany.sections = Array.from({ length: 5 }, () => ({ heading: 'H', items: ['x'] }));
  assert.ok(!validate(tooMany));
  // Within every per-string limit, but too long as a whole.
  const long = clone(real);
  long.sections = Array.from({ length: 4 }, () => ({ heading: 'H', items: Array.from({ length: 6 }, () => 'x'.repeat(300)) }));
  assert.ok(validate(long));
  const errors = instructionsLengthErrors(long);
  assert.equal(errors.length, 1);
  assert.match(errors[0], new RegExp(`room for ${INSTRUCTIONS_MAX_LINES} `));
  // The estimate: intro 1 line, heading 1.6, two points of 1 and 2 lines, one gap.
  assert.equal(instructionsLines({ intro: 'x', sections: [{ heading: 'H', items: ['x'.repeat(80), 'x'.repeat(81)] }] }), 1 + 1.6 + 3 + 0.15);
  // Placeholders there are counted too.
  const marked = { ...content(), instructions: { ...real, title: '[PLADSHOLDER]' } };
  assert.equal(countPlaceholders(marked).instructions, 1);
});
