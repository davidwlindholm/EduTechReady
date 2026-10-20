// Generates public/assets/models/papers.glb: a small stack of thin off-white A4 sheets.
// Usage: node scripts/make_papers.mjs [output.glb]
// Origin is the bottom centre of the stack; no textures; real-world size in metres.
import { Document, NodeIO } from '@gltf-transform/core';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = process.argv[2] ?? join(ROOT, 'public', 'assets', 'models', 'papers.glb');

const WIDTH = 0.21;
const LENGTH = 0.297;
const THICKNESS = 0.002;
// x offset (m), z offset (m), rotation about Y (degrees) per sheet, bottom to top.
const SHEETS = [
  [0, 0, 0],
  [0.006, -0.004, 4],
  [-0.005, 0.005, -3],
  [0.004, 0.003, 7],
];

// Box with the base at y = 0, returns { positions, normals, indices } (24 vertices, 12 triangles).
function box(w, h, d) {
  const hw = w / 2;
  const hd = d / 2;
  const faces = [
    { n: [0, 1, 0], v: [[-hw, h, hd], [hw, h, hd], [hw, h, -hd], [-hw, h, -hd]] },
    { n: [0, -1, 0], v: [[-hw, 0, -hd], [hw, 0, -hd], [hw, 0, hd], [-hw, 0, hd]] },
    { n: [0, 0, 1], v: [[-hw, 0, hd], [hw, 0, hd], [hw, h, hd], [-hw, h, hd]] },
    { n: [0, 0, -1], v: [[hw, 0, -hd], [-hw, 0, -hd], [-hw, h, -hd], [hw, h, -hd]] },
    { n: [1, 0, 0], v: [[hw, 0, hd], [hw, 0, -hd], [hw, h, -hd], [hw, h, hd]] },
    { n: [-1, 0, 0], v: [[-hw, 0, -hd], [-hw, 0, hd], [-hw, h, hd], [-hw, h, -hd]] },
  ];
  const positions = [];
  const normals = [];
  const indices = [];
  faces.forEach((f, i) => {
    for (const v of f.v) { positions.push(...v); normals.push(...f.n); }
    const o = i * 4;
    indices.push(o, o + 1, o + 2, o, o + 2, o + 3);
  });
  return { positions, normals, indices };
}

const doc = new Document();
const buffer = doc.createBuffer();
const material = doc.createMaterial('paper')
  .setBaseColorFactor([0.96, 0.95, 0.91, 1])
  .setRoughnessFactor(0.9)
  .setMetallicFactor(0);
const g = box(WIDTH, THICKNESS, LENGTH);
const mesh = doc.createMesh('sheet').addPrimitive(doc.createPrimitive()
  .setMaterial(material)
  .setIndices(doc.createAccessor().setType('SCALAR').setArray(new Uint16Array(g.indices)).setBuffer(buffer))
  .setAttribute('POSITION', doc.createAccessor().setType('VEC3').setArray(new Float32Array(g.positions)).setBuffer(buffer))
  .setAttribute('NORMAL', doc.createAccessor().setType('VEC3').setArray(new Float32Array(g.normals)).setBuffer(buffer)));

const scene = doc.createScene('papers');
SHEETS.forEach(([x, z, deg], i) => {
  const half = (deg * Math.PI) / 360;
  scene.addChild(doc.createNode(`sheet_${i}`)
    .setMesh(mesh)
    .setTranslation([x, i * THICKNESS, z])
    .setRotation([0, Math.sin(half), 0, Math.cos(half)]));
});

await new NodeIO().write(OUT, doc);
console.log(`wrote ${OUT}`);
