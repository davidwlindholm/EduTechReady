// Reports clips, materials, triangle count, bounding box and file size for every GLB
// in public/assets/models/. Usage:
//   node scripts/inspect_assets.mjs            prints a Markdown table
//   node scripts/inspect_assets.mjs --json     prints JSON
import { NodeIO, getBounds } from '@gltf-transform/core';
import { readdirSync, statSync } from 'node:fs';
import { join, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const MODELS_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'assets', 'models');
const BYTES_PER_MB = 1024 * 1024;
const round = (n) => Math.round(n * 100) / 100;

export async function inspectModel(io, file) {
  const doc = await io.read(file);
  const root = doc.getRoot();
  let triangles = 0;
  for (const mesh of root.listMeshes()) {
    for (const prim of mesh.listPrimitives()) {
      const indices = prim.getIndices();
      const count = indices ? indices.getCount() : prim.getAttribute('POSITION').getCount();
      triangles += Math.floor(count / 3);
    }
  }
  const bounds = getBounds(root.getDefaultScene() ?? root.listScenes()[0]);
  const size = bounds.max.map((v, i) => v - bounds.min[i]);
  return {
    id: basename(file, '.glb'),
    bytes: statSync(file).size,
    clips: root.listAnimations().map((a) => a.getName()),
    materials: root.listMaterials().map((m) => m.getName()),
    textures: root.listTextures().length,
    triangles,
    bboxMin: bounds.min.map(round),
    bboxMax: bounds.max.map(round),
    size: size.map(round),
  };
}

export async function inspectAll() {
  const io = new NodeIO();
  const files = readdirSync(MODELS_DIR).filter((f) => f.endsWith('.glb')).sort();
  const rows = [];
  for (const f of files) rows.push(await inspectModel(io, join(MODELS_DIR, f)));
  return rows;
}

function toMarkdown(rows) {
  const lines = [
    '| Id | Size (KB) | Triangles | Bbox size x,y,z (m) | Bbox min | Bbox max | Clips | Materials |',
    '|---|---|---|---|---|---|---|---|',
  ];
  for (const r of rows) {
    lines.push(`| ${r.id} | ${Math.round(r.bytes / 1024)} | ${r.triangles} | ${r.size.join(', ')} | ${r.bboxMin.join(', ')} | ${r.bboxMax.join(', ')} | ${r.clips.join(', ') || '-'} | ${r.materials.join(', ') || '-'} |`);
  }
  const total = rows.reduce((s, r) => s + r.bytes, 0);
  lines.push('', `Total: ${rows.length} GLB files, ${(total / BYTES_PER_MB).toFixed(2)} MB.`);
  return lines.join('\n');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const rows = await inspectAll();
  console.log(process.argv.includes('--json') ? JSON.stringify(rows, null, 2) : toMarkdown(rows));
}
