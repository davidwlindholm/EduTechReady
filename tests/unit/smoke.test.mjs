import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('package pins three exactly', () => {
  const pkg = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'));
  assert.match(pkg.devDependencies.three, /^\d+\.\d+\.\d+$/);
});

test('index.html carries the expected CSP', () => {
  const html = readFileSync(new URL('../../public/index.html', import.meta.url), 'utf8');
  assert.ok(html.includes("default-src 'self'; img-src 'self' data: blob:; style-src 'self'; script-src 'self'; connect-src 'self' blob: data:; object-src 'none'; base-uri 'self'"));
  assert.ok(!/<style|style=|onclick=/i.test(html));
});
