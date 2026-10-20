// Copies the pinned three.js build and the addons we use into public/vendor/three/.
// Follows relative imports recursively and rewrites bare 'three' imports to relative paths.
import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import { dirname, join, relative, resolve, posix } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const pkgDir = join(root, 'node_modules', 'three');
const outDir = join(root, 'public', 'vendor', 'three');

const entries = [
  'build/three.module.js',
  'examples/jsm/loaders/GLTFLoader.js',
  'examples/jsm/renderers/CSS2DRenderer.js',
  'examples/jsm/utils/SkeletonUtils.js',
  // also reached through GLTFLoader, but render/three.js imports it directly
  'examples/jsm/utils/BufferGeometryUtils.js',
];

const version = JSON.parse(readFileSync(join(pkgDir, 'package.json'), 'utf8')).version;
if (existsSync(outDir)) rmSync(outDir, { recursive: true });

// Output layout mirrors the package: build/ and examples/jsm/.
const seen = new Set();
const queue = [...entries];
const importRe = /(\bfrom\s*|\bimport\s*\(?\s*)(['"])([^'"]+)\2/g;

function rewrite(src, fromRel) {
  return src.replace(importRe, (m, pre, q, spec) => {
    if (spec === 'three') {
      let rel = posix.relative(posix.dirname(fromRel), 'build/three.module.js');
      if (!rel.startsWith('.')) rel = './' + rel;
      return `${pre}${q}${rel}${q}`;
    }
    if (spec.startsWith('three/addons/')) {
      let rel = posix.relative(posix.dirname(fromRel), 'examples/jsm/' + spec.slice('three/addons/'.length));
      if (!rel.startsWith('.')) rel = './' + rel;
      return `${pre}${q}${rel}${q}`;
    }
    return m;
  });
}

while (queue.length) {
  const rel = queue.shift();
  if (seen.has(rel)) continue;
  seen.add(rel);
  const src = readFileSync(join(pkgDir, rel), 'utf8');
  const out = rewrite(src, rel);
  const dest = join(outDir, rel);
  mkdirSync(dirname(dest), { recursive: true });
  writeFileSync(dest, out);
  for (const m of out.matchAll(importRe)) {
    const spec = m[3];
    if (spec.startsWith('.')) queue.push(posix.normalize(posix.join(posix.dirname(rel), spec)));
  }
  for (const m of out.matchAll(/^(?:import|export)\b[^;]*?\bfrom\s*['"]([^.'"][^'"]*)['"]/gm)) {
    console.warn(`warning: unresolved bare import '${m[1]}' in ${rel}`);
  }
}
writeFileSync(join(outDir, 'VERSION.txt'), `three ${version}\nMIT licence, https://github.com/mrdoob/three.js\n`);
try { writeFileSync(join(outDir, 'LICENSE'), readFileSync(join(pkgDir, 'LICENSE'), 'utf8')); } catch {}
console.log(`vendored three ${version}: ${[...seen].join(', ')}`);
