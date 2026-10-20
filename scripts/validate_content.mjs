// Validates public/content/*.json.
//
// Usage: npm run validate   (or: node scripts/validate_content.mjs)
//
// Checks, in order:
//   1. Each file against its JSON Schema in public/content/schema/.
//   2. Cross-references: asset ids and files, furniture and props (through
//      the game's own lib/level.js and lib/furniture.js), characters on
//      walkable tiles or on chair and sofa tiles (lib/seating.js), unique ids,
//      a talk tile in reach for every character, look-alikes (two characters
//      with the same model and colours),
//      material names that exist in the GLB, character clips (idle and walk
//      required) that exist in the GLB's animations, portraits on disk.
//      Every walkable tile stays reachable from playerStart with the
//      furniture and the characters in place.
//   3. ui.json keys: every key used in public/js exists, and every key is
//      used. Keys built at run time are declared in DYNAMIC_KEYS below.
//      Every literal in the first argument of t() / this.t() must be a key.
//   4. No user-facing string literals in public/js outside debug code.
//   5. instructions.json is short enough to fit its window (INSTRUCTIONS_MAX_LINES).
// Before the schemas: no key twice in the same JSON object (JSON.parse would
// silently keep the last one).
// [PLADSHOLDER] markers are counted and reported as a warning.
//
// Exit code 0 when there are no errors (warnings allowed), 1 otherwise.
// Every message names the file and the entry, so it can be found and fixed.
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import Ajv2020 from 'ajv/dist/2020.js';
import { parseLevel } from '../public/js/lib/level.js';
import { layoutFurniture } from '../public/js/lib/furniture.js';
import { placeCharacter, occupiedTile } from '../public/js/lib/seating.js';
import { createGrid, reachableFrom, tileKey } from '../public/js/lib/grid.js';
import { chooseTalkTile } from '../public/js/lib/talk.js';
import { splitNameRole } from '../public/js/lib/characters.js';
import { AXES } from '../public/js/lib/axes.js';
import { MISSING_REASONS } from '../public/js/lib/session.js';
import { THEME } from '../public/js/render/theme.js';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
export const PLACEHOLDER = '[PLADSHOLDER]';
const CONTENT_FILES = ['level', 'assets', 'characters', 'ui', 'instructions'];
/**
 * The instructions window must fit a 1280 x 600 browser window (a 1280 x 720
 * laptop screen minus the browser's bars) without scrolling. Its height is
 * estimated in text lines: every point and the intro take
 * ceil(length / INSTRUCTIONS_LINE_CHARS) lines (a line holds about 100
 * characters; 80 leaves room for long words and wider fonts), a heading 1.6
 * lines, and the gap between points 0.15 lines. The title is one line (the
 * schema keeps it to 45 characters). INSTRUCTIONS_MAX_LINES is what the
 * window has room for, with about a line and a half to spare;
 * tests/e2e/instructions.spec.mjs loads the longest texts this allows (short
 * and long points, long compound words, a title in capitals) and checks
 * that they fit.
 */
export const INSTRUCTIONS_LINE_CHARS = 80;
export const INSTRUCTIONS_MAX_LINES = 22;

/**
 * ui.json keys that code builds at run time from a template literal, such
 * as t(`finish.missing.${reason}`). A literal scan cannot see these keys, so
 * each template is declared here with the full list of keys it can produce.
 * The lists come from the same constants the code uses, so they cannot
 * drift apart. The check fails when a key template in code is not declared
 * here, and when a declared template no longer occurs in code.
 *
 * Every literal in the first argument of a t() or this.t() call must be a
 * ui.json key, whatever its namespace, and every template there must be
 * declared here. So t('newns.x'), t(x ? 'a' : 'b') with a missing key, and
 * t(['menu', x].join('.')) (the 'menu' piece is not a key) all fail.
 * Keys built by string concatenation (t('notice.' + reason)) or from a
 * key-prefix literal kept in a variable (const p = 'notice.') are not
 * accepted either: the check asks for a template literal declared here.
 * A key-shaped literal elsewhere (a map such as ERROR_KEYS, an option like
 * titleKey) must exist when its namespace is one ui.json already uses.
 * Limit: t(variable) where the variable gets its key with no literal in
 * public/js at all (read from a JSON file, joined from non-literal parts,
 * or a literal in a new namespace kept outside the t() call) is invisible
 * to this check; the code has no such key today. At run time such a key
 * shows as the raw key on screen and a console warning.
 */
export const DYNAMIC_KEYS = [
  {
    file: 'public/js/ui/finish.js',
    template: 'finish.missing.${}',
    keys: MISSING_REASONS.map((reason) => `finish.missing.${reason}`),
    why: 'reason comes from missingPlacements() in lib/session.js (MISSING_REASONS)',
  },
  {
    file: 'public/js/ui/results.js',
    template: 'results.axis.${}',
    keys: AXES.map((axis) => `results.axis.${axis}`),
    why: 'axis is one of AXES in lib/axes.js',
  },
];

/**
 * String literals that look like ui.json keys (a known namespace, dotted)
 * but are not keys. File names are excluded by their extension already.
 */
const NOT_KEYS = new Set([]);
const FILE_EXTENSION = /\.(html|js|mjs|json|php|css|svg|png|webp|glb)$/;
const KEY_SHAPE = /^[a-z][a-zA-Z0-9]*(\.[a-zA-Z0-9]+)+$/;
/** The static start of a run-time key, e.g. "finish.missing." or "notice.". */
const KEY_HEAD = /^[a-z][a-zA-Z0-9]*\.[a-zA-Z0-9.]*$/;

/** Files under public/js that only run with debug=1; exempt from the literal check. */
export const DEBUG_FILES = new Set(['public/js/debug.js', 'public/js/ui/debugHud.js', 'public/js/render/gridOverlay.js']);

// ---------------------------------------------------------------------------
// A small JavaScript tokenizer: enough to find string and template literals,
// skip comments and regular expressions, and know which call a literal sits in.

const REGEX_BEFORE_KEYWORDS = new Set(['return', 'typeof', 'case', 'do', 'else', 'in', 'of', 'new', 'delete', 'void', 'throw', 'yield', 'await', 'instanceof']);

/**
 * @typedef {object} Literal
 * @property {'string'|'template'} kind
 * @property {string[]} parts static text; a plain string has one part,
 *   a template has one more part than it has ${} expressions
 * @property {number} line 1-based
 * @property {string[]} calls the enclosing calls, outermost first, e.g. ['console.warn']
 * @property {boolean} concat a "+" sits directly before or after the literal
 * @property {boolean} keyArg the literal sits in the first argument of a
 *   t(...) or this.t(...) call (the ui.json lookup), at any depth inside it
 *   except in a nested call: t('a'), t(x ? 'a' : 'b'), t(['a', x].join('.'))
 */

/** The ui.json lookup: every text the game shows goes through t() or this.t(). */
const LOOKUP_CALL = /^(this\.)?t$/;

/**
 * Find every string and template literal in JavaScript source.
 * @param {string} src
 * @returns {Literal[]}
 */
export function scanLiterals(src) {
  const literals = [];
  // One frame per open "(": the callee, the argument index and how many
  // [ and { are open inside the current argument.
  const calls = [];
  const callNames = () => calls.map((f) => f.name);
  const inKeyArg = () => {
    const f = calls[calls.length - 1];
    return f !== undefined && f.arg === 0 && LOOKUP_CALL.test(f.name);
  };
  let i = 0;
  let line = 1;
  let prev = null; // previous significant token: { type, value }
  let lastLiteral = null; // the literal pushed most recently, while it is prev
  const afterPlus = () => prev !== null && prev.type === 'punct' && prev.value === '+';

  const lineAt = (from, to) => {
    for (let k = from; k < to; k++) if (src[k] === '\n') line += 1;
  };

  function calleeName() {
    // The identifier chain just before "(", e.g. console.warn or new Error.
    let k = i - 1;
    while (k >= 0 && /\s/.test(src[k])) k--;
    let end = k + 1;
    while (k >= 0 && /[\w$.]/.test(src[k])) k--;
    return src.slice(k + 1, end);
  }

  function readQuoted(quote) {
    const start = i;
    i += 1;
    let value = '';
    while (i < src.length && src[i] !== quote) {
      if (src[i] === '\\') {
        const next = src[i + 1];
        value += next === 'n' ? '\n' : next === 't' ? '\t' : next;
        i += 2;
      } else {
        value += src[i];
        i += 1;
      }
    }
    i += 1;
    const startLine = line;
    lineAt(start, i);
    lastLiteral = { kind: 'string', parts: [value], line: startLine, calls: callNames(), concat: afterPlus(), keyArg: inKeyArg() };
    literals.push(lastLiteral);
  }

  function readTemplate() {
    const startLine = line;
    const concat = afterPlus();
    const keyArg = inKeyArg();
    const literalCalls = callNames();
    const parts = [''];
    i += 1;
    while (i < src.length && src[i] !== '`') {
      if (src[i] === '\\') {
        parts[parts.length - 1] += src[i + 1];
        if (src[i + 1] === '\n') line += 1;
        i += 2;
      } else if (src[i] === '$' && src[i + 1] === '{') {
        i += 2;
        scan(true);
        parts.push('');
      } else {
        if (src[i] === '\n') line += 1;
        parts[parts.length - 1] += src[i];
        i += 1;
      }
    }
    i += 1;
    lastLiteral = { kind: 'template', parts, line: startLine, calls: literalCalls, concat, keyArg };
    literals.push(lastLiteral);
  }

  function readRegex() {
    i += 1;
    let inClass = false;
    while (i < src.length) {
      const c = src[i];
      if (c === '\\') { i += 2; continue; }
      if (c === '\n') break; // not a regex after all; stop at the line end
      if (inClass) { if (c === ']') inClass = false; } else if (c === '[') inClass = true; else if (c === '/') break;
      i += 1;
    }
    i += 1;
    while (i < src.length && /[a-z]/.test(src[i])) i += 1;
  }

  function regexAllowed() {
    if (!prev) return true;
    if (prev.type === 'punct') return !')]}'.includes(prev.value);
    if (prev.type === 'word') return REGEX_BEFORE_KEYWORDS.has(prev.value);
    return false;
  }

  /** Scan until the end, or (inside a template expression) the matching "}". */
  function scan(inExpression) {
    let depth = 0;
    while (i < src.length) {
      const c = src[i];
      const d = src[i + 1];
      if (c === '\n') { line += 1; i += 1; continue; }
      if (/\s/.test(c)) { i += 1; continue; }
      if (c === '/' && d === '/') { while (i < src.length && src[i] !== '\n') i += 1; continue; }
      if (c === '/' && d === '*') {
        const end = src.indexOf('*/', i + 2);
        const stop = end < 0 ? src.length : end + 2;
        lineAt(i, stop);
        i = stop;
        continue;
      }
      if (c === '\'' || c === '"') { readQuoted(c); prev = { type: 'literal' }; continue; }
      if (c === '`') { readTemplate(); prev = { type: 'literal' }; continue; }
      if (c === '/' && regexAllowed()) { readRegex(); prev = { type: 'literal' }; continue; }
      if (/[\w$]/.test(c)) {
        const start = i;
        while (i < src.length && /[\w$]/.test(src[i])) i += 1;
        prev = { type: 'word', value: src.slice(start, i) };
        continue;
      }
      if (c === '+' && prev && prev.type === 'literal' && lastLiteral) lastLiteral.concat = true;
      const frame = calls[calls.length - 1];
      if (c === '(') calls.push({ name: calleeName(), arg: 0, nest: 0 });
      else if (c === ')') calls.pop();
      else if (c === ',' && frame && frame.nest === 0) frame.arg += 1;
      else if (c === '[' && frame) frame.nest += 1;
      else if (c === ']' && frame) frame.nest -= 1;
      else if (c === '{') {
        depth += 1;
        if (frame) frame.nest += 1;
      } else if (c === '}') {
        if (inExpression && depth === 0) { i += 1; return; }
        depth -= 1;
        if (frame) frame.nest -= 1;
      }
      prev = { type: 'punct', value: c };
      i += 1;
    }
  }

  scan(false);
  return literals;
}

/** All .js files under a directory, as paths relative to ROOT. */
export function listJsFiles(dir, root = ROOT) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listJsFiles(full, root));
    else if (entry.name.endsWith('.js')) out.push(relative(root, full).split('\\').join('/'));
  }
  return out.sort();
}

// ---------------------------------------------------------------------------
// ui.json key usage

/**
 * @param {Record<string, string>} ui
 * @param {Array<{ file: string, literals: Literal[] }>} sources public/js files, vendor excluded
 * @param {typeof DYNAMIC_KEYS} [dynamicKeys]
 * @returns {{ errors: string[], used: Set<string> }}
 */
export function checkUiKeys(ui, sources, dynamicKeys = DYNAMIC_KEYS) {
  const errors = [];
  const keys = new Set(Object.keys(ui));
  const namespaces = new Set([...keys].map((k) => k.split('.')[0]));
  const used = new Set();
  const foundTemplates = new Set();
  const looksLikeKey = (s) => KEY_SHAPE.test(s) && namespaces.has(s.split('.')[0]) && !FILE_EXTENSION.test(s) && !NOT_KEYS.has(s);
  const looksLikeKeyHead = (s) => KEY_HEAD.test(s) && namespaces.has(s.split('.')[0]) && !FILE_EXTENSION.test(s) && !NOT_KEYS.has(s);

  for (const { file, literals } of sources) {
    for (const lit of literals) {
      if (lit.parts.length === 1) {
        const value = lit.parts[0];
        // A key built by concatenation, or a key prefix kept for later use.
        if (looksLikeKeyHead(value) && (lit.concat || value.endsWith('.'))) {
          errors.push(`${file}:${lit.line}: "${value}" builds a ui.json key at run time${lit.concat ? ' by string concatenation' : ''}; write the key as a template literal and declare it with its possible keys in DYNAMIC_KEYS (scripts/validate_content.mjs)`);
          continue;
        }
        if (keys.has(value)) used.add(value);
        else if (lit.keyArg) errors.push(`${file}:${lit.line}: t() is called with "${value}", which is not a ui.json key; add the key to ui.json, or build a run-time key as a template literal declared in DYNAMIC_KEYS (scripts/validate_content.mjs)`);
        else if (looksLikeKey(value)) errors.push(`${file}:${lit.line}: "${value}" looks like a ui.json key but ui.json has no such key`);
        continue;
      }
      // A template with expressions: a run-time key if its start is key-shaped.
      // In t()'s first argument every template is a run-time key, whatever
      // its namespace; elsewhere only a key-shaped start marks one.
      const head = lit.parts[0];
      if (!lit.keyArg && !looksLikeKeyHead(head)) continue;
      const template = lit.parts.join('${}');
      const declared = dynamicKeys.find((d) => d.file === file && d.template === template);
      if (!declared) {
        errors.push(`${file}:${lit.line}: the ui.json key \`${template}\` is built at run time; declare it with its possible keys in DYNAMIC_KEYS (scripts/validate_content.mjs)`);
        continue;
      }
      foundTemplates.add(`${file}|${template}`);
    }
  }
  for (const d of dynamicKeys) {
    if (!foundTemplates.has(`${d.file}|${d.template}`)) {
      errors.push(`DYNAMIC_KEYS: \`${d.template}\` no longer occurs in ${d.file}; remove or update the entry`);
      continue;
    }
    for (const key of d.keys) {
      if (keys.has(key)) used.add(key);
      else errors.push(`${d.file}: builds the ui.json key "${key}" (${d.why}), but ui.json has no such key`);
    }
  }
  for (const key of keys) {
    if (!used.has(key)) errors.push(`ui.json: key "${key}" is not used anywhere in public/js`);
  }
  return { errors, used };
}

// ---------------------------------------------------------------------------
// User-facing string literals

const DANISH = /[æøåÆØÅ]/;
const PROSE = [
  /[A-ZÆØÅ][a-zæøå]+ [A-Za-zæøåÆØÅ]/, // "Indlæser spillet", "Results page"
  /[a-zæøå]{2,} [a-zæøå]{2,}[.!?…:]$/, // a lowercase sentence ending in punctuation
  /(^|[\s,:])[a-zæøå]{2,}( [a-zæøå]{2,}){2,}([\s,.:]|$)/, // three or more plain words ("mangler på samr")
];
/** Calls whose string arguments are developer messages, never shown to the pair. */
const DEVELOPER_CALL = /^(console\.\w+|(new\s*)?\w*Error)$/;

/**
 * Flags literals that read like text for people (Danish letters, or prose)
 * outside console calls and Error messages. Heuristic by design: CSS class
 * lists and SVG paths are not prose; anything flagged belongs in ui.json.
 * @param {Array<{ file: string, literals: Literal[] }>} sources
 * @returns {string[]}
 */
export function checkUserFacingLiterals(sources) {
  const errors = [];
  for (const { file, literals } of sources) {
    if (DEBUG_FILES.has(file)) continue;
    for (const lit of literals) {
      if (lit.calls.some((c) => DEVELOPER_CALL.test(c))) continue;
      const text = lit.parts.join(' ');
      if (DANISH.test(text) || PROSE.some((re) => re.test(text))) {
        errors.push(`${file}:${lit.line}: user-facing text "${text.slice(0, 60)}" belongs in ui.json`);
      }
    }
  }
  return errors;
}

// ---------------------------------------------------------------------------
// Duplicate keys

/**
 * Keys that occur twice in the same JSON object. JSON.parse keeps the last
 * one without a word, so a key pasted twice into ui.json (or a model id
 * twice in assets.json) would otherwise go unnoticed. Expects text that
 * JSON.parse accepts.
 * @param {string} text
 * @returns {Array<{ key: string, path: string, line: number }>}
 */
export function findDuplicateKeys(text) {
  const found = [];
  const stack = []; // { keys: Set, expectKey, current } for objects, null for arrays
  let line = 1;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '\n') line += 1;
    else if (c === '{') stack.push({ keys: new Set(), expectKey: true, current: null });
    else if (c === '[') stack.push(null);
    else if (c === '}' || c === ']') stack.pop();
    else if (c === ',') { const top = stack[stack.length - 1]; if (top) top.expectKey = true; }
    else if (c === '"') {
      const start = i;
      i += 1;
      while (text[i] !== '"') i += text[i] === '\\' ? 2 : 1;
      const top = stack[stack.length - 1];
      if (top && top.expectKey) {
        const key = JSON.parse(text.slice(start, i + 1));
        if (top.keys.has(key)) {
          const path = stack.filter((f) => f && f.current !== null && f !== top).map((f) => f.current);
          found.push({ key, path: [...path, key].join('.'), line });
        }
        top.keys.add(key);
        top.current = key;
        top.expectKey = false;
      }
    }
  }
  return found;
}

// ---------------------------------------------------------------------------
// Schemas

export function createSchemaValidators(schemaDir = join(ROOT, 'public/content/schema')) {
  // strictRequired is off: it rejects `required` inside if/then even when the
  // property is defined in the parent schema (assets.schema.json uses that).
  const ajv = new Ajv2020({ allErrors: true, strict: true, strictRequired: false });
  const validators = {};
  for (const name of CONTENT_FILES) {
    const schema = JSON.parse(readFileSync(join(schemaDir, `${name}.schema.json`), 'utf8'));
    validators[name] = ajv.compile(schema);
  }
  return validators;
}

function schemaErrors(validate, data, file) {
  if (validate(data)) return [];
  return validate.errors.map((e) => {
    const where = e.instancePath || '(top level)';
    const extra = e.keyword === 'additionalProperties' ? ` ("${e.params.additionalProperty}")`
      : e.keyword === 'enum' ? ` (${e.params.allowedValues.join(', ')})` : '';
    return `${file}: ${where} ${e.message}${extra}`;
  });
}

// ---------------------------------------------------------------------------
// Cross-references

/** A GLB's JSON chunk. */
function glbJson(path) {
  const buf = readFileSync(path);
  if (buf.readUInt32LE(0) !== 0x46546c67) throw new Error(`${path} is not a GLB file`);
  const length = buf.readUInt32LE(12);
  return JSON.parse(buf.subarray(20, 20 + length).toString('utf8'));
}

/** Material names stored in a GLB (its JSON chunk). */
export function glbMaterialNames(path) {
  return new Set((glbJson(path).materials ?? []).map((m) => m.name));
}

/** Animation (clip) names stored in a GLB (its JSON chunk). */
export function glbAnimationNames(path) {
  return new Set((glbJson(path).animations ?? []).map((a) => a.name));
}

const lookKey = (model, colours) => `${model}|${JSON.stringify(Object.entries(colours ?? {}).sort(([a], [b]) => a.localeCompare(b)))}`;

/**
 * Cross-reference checks over schema-valid content.
 * @param {{ level: object, assets: object, characters: object }} content
 * @param {{ publicDir?: string, materialNames?: (file: string) => Set<string>,
 *   animationNames?: (file: string) => Set<string> }} [options]
 * @returns {string[]} errors
 */
export function checkCrossReferences(content, { publicDir = join(ROOT, 'public'), materialNames, animationNames } = {}) {
  const errors = [];
  const models = content.assets.models;
  const fileExists = (rel) => existsSync(join(publicDir, rel)) && statSync(join(publicDir, rel)).isFile();
  const readMaterials = materialNames ?? ((file) => glbMaterialNames(join(publicDir, file)));
  const readAnimations = animationNames ?? ((file) => glbAnimationNames(join(publicDir, file)));

  for (const [id, model] of Object.entries(models)) {
    if (!fileExists(model.file)) {
      errors.push(`assets.json: model "${id}": file ${model.file} does not exist`);
      continue;
    }
    if (model.kind !== 'character') continue;
    // Every clip named in assets.json must be in the file; a character needs
    // idle and walk (sit may be null: such a model cannot sit).
    for (const required of ['idle', 'walk']) {
      if (!model.clips?.[required]) errors.push(`assets.json: model "${id}": a character needs a clip for "${required}"`);
    }
    let clips;
    try {
      clips = readAnimations(model.file);
    } catch (err) {
      errors.push(`assets.json: model "${id}": cannot read ${model.file} (${err.message})`);
      continue;
    }
    for (const [name, clip] of Object.entries(model.clips ?? {})) {
      if (clip !== null && !clips.has(clip)) {
        errors.push(`assets.json: model "${id}": clips.${name} "${clip}" is not an animation in ${model.file} (it has: ${[...clips].join(', ') || 'none'})`);
      }
    }
  }

  let level;
  let layout;
  try {
    level = parseLevel(content.level);
    layout = layoutFurniture(level, content.assets);
  } catch (err) {
    errors.push(err.message);
    return errors; // the rest needs a valid level
  }
  // layoutFurniture has checked furniture and props against assets.json.

  const materialCache = new Map();
  const materialsOf = (assetId) => {
    if (!materialCache.has(assetId)) {
      let names = null;
      try {
        names = readMaterials(models[assetId].file);
      } catch {
        names = null; // a missing file is reported above
      }
      materialCache.set(assetId, names);
    }
    return materialCache.get(assetId);
  };
  const checkLook = (who, modelId, colours) => {
    const model = models[modelId];
    if (!model) {
      errors.push(`${who}: model "${modelId}" is not in assets.json`);
      return false;
    }
    if (model.kind !== 'character') {
      errors.push(`${who}: model "${modelId}" is a ${model.kind}, not a character`);
      return false;
    }
    const names = materialsOf(modelId);
    if (names) {
      for (const name of Object.keys(colours ?? {})) {
        if (!names.has(name)) errors.push(`${who}: materialColors "${name}" is not a material of ${modelId} (see docs/ASSETS.md)`);
      }
    }
    return true;
  };

  const { player, characters } = content.characters;
  checkLook('characters.json: player', player.model, player.materialColors);
  checkLook('render/theme.js: THEME.alien', THEME.alien.model, THEME.alien.materialColors);

  const ids = new Set();
  const tiles = new Map();
  const looks = new Map([
    [lookKey(player.model, player.materialColors), 'the player'],
    [lookKey(THEME.alien.model, THEME.alien.materialColors), 'the alien behind the hallway door (THEME.alien)'],
  ]);
  const start = level.playerStart;
  const places = [];
  for (const c of characters) {
    const who = `characters.json: character "${c.id}"`;
    if (ids.has(c.id)) errors.push(`${who}: duplicate id`);
    ids.add(c.id);
    if (!splitNameRole(c.name).role) errors.push(`${who}: name "${c.name}" should be "Name (Role)"`);

    const modelOk = checkLook(who, c.model, c.materialColors);
    if (modelOk && c.pose === 'sit' && !models[c.model].clips.sit) {
      errors.push(`${who}: sits, but model "${c.model}" has no sit clip`);
    }
    const look = lookKey(c.model, c.materialColors);
    if (looks.has(look)) errors.push(`${who}: same model and colours as ${looks.get(look)}; characters must look different`);
    else looks.set(look, `"${c.id}"`);

    const key = tileKey(c.col, c.row);
    if (tiles.has(key)) errors.push(`${who}: tile (${c.col}, ${c.row}) is taken by "${tiles.get(key)}"`);
    tiles.set(key, c.id);
    if (c.col === start.col && c.row === start.row) errors.push(`${who}: stands on playerStart (${c.col}, ${c.row})`);
    if (c.pose === 'stand' && !level.isWalkable(c.col, c.row)) {
      errors.push(`${who}: stands on (${c.col}, ${c.row}), which is ${level.typeAt(c.col, c.row)}, not a walkable tile`);
    } else {
      try {
        places.push({ c, place: placeCharacter(c, layout) });
      } catch (err) {
        errors.push(err.message);
      }
    }

    const qids = new Set();
    for (const q of c.questions) {
      if (qids.has(q.id)) errors.push(`${who}: duplicate question id "${q.id}"`);
      qids.add(q.id);
    }
    if (c.maxQuestions !== null && c.maxQuestions > c.questions.length) {
      errors.push(`${who}: maxQuestions ${c.maxQuestions} is more than its ${c.questions.length} questions`);
    }
    if (!fileExists(c.portrait)) errors.push(`${who}: portrait ${c.portrait} does not exist`);
  }

  // Every walkable tile stays reachable once furniture and characters stand
  // (a standing character can close off a corridor).
  // Standing characters occupy the tile under where they actually stand
  // (occupiedTile); one whose place failed above keeps its own tile.
  const placeOf = new Map(places.map(({ c, place }) => [c, place]));
  const occupied = characters.map((c) => occupiedTile(c, placeOf.get(c) ?? null));
  const grid = createGrid(level, [...layout.blocked, ...occupied]);
  const reached = reachableFrom(grid, start);
  for (let row = 0; row < grid.rows; row++) {
    for (let col = 0; col < grid.cols; col++) {
      if (grid.isWalkable(col, row) && !reached.has(tileKey(col, row))) {
        errors.push(`level.json/characters.json: walkable tile (${col}, ${row}) cannot be reached from playerStart with the furniture and characters in place`);
      }
    }
  }

  // Every character can be talked to: a reachable tile within talking range.
  for (const { c, place } of places) {
    if (!chooseTalkTile(grid, start, place)) {
      errors.push(`characters.json: character "${c.id}": no tile within talking range can be reached from playerStart`);
    }
  }
  return errors;
}

// ---------------------------------------------------------------------------
// Question count

/** Every character should have exactly three questions. */
export const EXPECTED_QUESTIONS = 3;

/**
 * Warnings (not errors) for characters with fewer than EXPECTED_QUESTIONS
 * questions: the game works with any number, but the content is written for three each.
 * @param {{ characters: Array<{ id: string, questions: unknown[] }> }} characters parsed characters.json
 * @returns {string[]}
 */
export function questionCountWarnings(characters) {
  return characters.characters
    .filter((c) => c.questions.length < EXPECTED_QUESTIONS)
    .map((c) => `characters.json: character "${c.id}" has ${c.questions.length} question(s); every character should have ${EXPECTED_QUESTIONS}`);
}

// ---------------------------------------------------------------------------
// Instructions window

/**
 * Estimated height of the instructions text in lines (see INSTRUCTIONS_MAX_LINES).
 * @param {{ intro?: string, sections: Array<{ heading: string, items: string[] }> }} instructions
 * @returns {number}
 */
export function instructionsLines(instructions) {
  const lines = (text) => Math.ceil(text.length / INSTRUCTIONS_LINE_CHARS);
  let total = instructions.intro ? lines(instructions.intro) : 0;
  for (const section of instructions.sections) {
    total += 1.6 + section.items.reduce((sum, item) => sum + lines(item), 0) + 0.15 * (section.items.length - 1);
  }
  return Math.round(total * 100) / 100;
}

/**
 * The instructions window should fit the screen without scrolling.
 * @param {Parameters<typeof instructionsLines>[0]} instructions
 * @returns {string[]}
 */
export function instructionsLengthErrors(instructions) {
  const total = instructionsLines(instructions);
  if (total <= INSTRUCTIONS_MAX_LINES) return [];
  return [`instructions.json: the text needs about ${Math.ceil(total)} lines, but the window only has room for ${INSTRUCTIONS_MAX_LINES} without scrolling; shorten the points or remove some (a line holds about ${INSTRUCTIONS_LINE_CHARS} characters, and each heading counts as 1.6 lines)`];
}

// ---------------------------------------------------------------------------
// Placeholders

/** Count [PLADSHOLDER] markers per file and, for characters.json, per character. */
export function countPlaceholders(content) {
  const count = (value) => (JSON.stringify(value).match(/\[PLADSHOLDER\]/g) ?? []).length;
  const perCharacter = content.characters.characters.map((c) => ({ id: c.id, n: count(c) })).filter((x) => x.n > 0);
  return {
    total: count(content.characters) + count(content.ui) + count(content.level) + count(content.assets) + count(content.instructions),
    characters: count(content.characters),
    ui: count(content.ui),
    instructions: count(content.instructions),
    perCharacter,
  };
}

// ---------------------------------------------------------------------------

/**
 * Run every check over the project.
 * @returns {{ errors: string[], warnings: string[], placeholders: ReturnType<typeof countPlaceholders> | null }}
 */
export function validateProject(root = ROOT) {
  const errors = [];
  const warnings = [];
  const content = {};
  const validators = createSchemaValidators(join(root, 'public/content/schema'));
  for (const name of CONTENT_FILES) {
    const file = `${name}.json`;
    let text;
    try {
      text = readFileSync(join(root, 'public/content', file), 'utf8');
      content[name] = JSON.parse(text);
    } catch (err) {
      errors.push(`${file}: cannot be read as JSON (${err.message})`);
      continue;
    }
    for (const d of findDuplicateKeys(text)) {
      errors.push(`${file}:${d.line}: "${d.path}" occurs twice in the same object; JSON keeps only the last one, so delete or rename one`);
    }
    errors.push(...schemaErrors(validators[name], content[name], file));
  }
  if (errors.length > 0) return { errors, warnings, placeholders: null }; // cross-checks assume valid shapes

  errors.push(...checkCrossReferences(content, { publicDir: join(root, 'public') }));
  const sources = listJsFiles(join(root, 'public/js'), root)
    .map((file) => ({ file, literals: scanLiterals(readFileSync(join(root, file), 'utf8')) }));
  errors.push(...checkUiKeys(content.ui, sources).errors);
  errors.push(...checkUserFacingLiterals(sources));

  errors.push(...instructionsLengthErrors(content.instructions));

  warnings.push(...questionCountWarnings(content.characters));
  const placeholders = countPlaceholders(content);
  if (placeholders.total > 0) {
    const list = placeholders.perCharacter.map((x) => `${x.id} ${x.n}`).join(', ');
    warnings.push(`${placeholders.total} ${PLACEHOLDER} markers still to write (characters.json ${placeholders.characters}: ${list}; ui.json ${placeholders.ui}; instructions.json ${placeholders.instructions})`);
  }
  return { errors, warnings, placeholders };
}

function main() {
  const { errors, warnings } = validateProject();
  for (const w of warnings) console.warn(`warning: ${w}`);
  for (const e of errors) console.error(`error: ${e}`);
  if (errors.length > 0) {
    console.error(`\nContent is NOT valid: ${errors.length} error(s).`);
    process.exitCode = 1;
  } else {
    console.log(`Content is valid (${CONTENT_FILES.map((n) => `${n}.json`).join(', ')}).${warnings.length ? ` ${warnings.length} warning(s).` : ''}`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
