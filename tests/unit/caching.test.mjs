// Without Cache-Control, browsers cache the game's files by
// heuristic for days, so an upload or a content edit does not reach them.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const PUBLIC = fileURLToPath(new URL('../../public/', import.meta.url));
const read = (rel) => readFileSync(join(PUBLIC, rel), 'utf8');

function walk(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) walk(path, out);
    else out.push(path);
  }
  return out;
}

test('.htaccess sends Cache-Control: no-cache for every static file type, guarded by mod_headers', () => {
  const htaccess = read('.htaccess');
  const block = htaccess.match(
    /<IfModule mod_headers\.c>\s*<FilesMatch "([^"]+)">\s*Header set Cache-Control "no-cache"\s*<\/FilesMatch>\s*<\/IfModule>/,
  );
  assert.ok(block, 'guarded no-cache block missing from public/.htaccess');
  const pattern = new RegExp(block[1]);
  const served = walk(PUBLIC).filter((p) => !/(\.(php|md|ini|txt)|LICENSE)$/.test(p) && !/(^|[\\/])\./.test(p.slice(PUBLIC.length)));
  const types = new Set(served.map((p) => extname(p)));
  for (const ext of ['.html', '.js', '.css', '.json', '.glb']) assert.ok(types.has(ext), `no ${ext} files found`);
  for (const p of served) assert.match(p, pattern, `${p} would be cached by heuristic`);
  assert.doesNotMatch('api/submit.php', pattern, 'the API sets its own no-store');
});

test('the content JSON is fetched with cache: no-cache on every page', () => {
  for (const file of ['js/main.js', 'js/projector.js', 'js/ui/facilitator.js']) {
    const src = read(file);
    const fetches = src.match(/\bfetch\([^)]*\)/g) ?? [];
    assert.ok(fetches.length > 0, `${file}: no fetch found`);
    for (const call of fetches) assert.match(call, /cache: 'no-cache'/, `${file}: ${call}`);
  }
});
