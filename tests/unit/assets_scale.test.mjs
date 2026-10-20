// Real-world size check: assets.json scales applied to the measured GLB bounds.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { NodeIO, getBounds } from '@gltf-transform/core';

const PUBLIC = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'public');
const manifest = JSON.parse(readFileSync(join(PUBLIC, 'content', 'assets.json'), 'utf8')).models;
const io = new NodeIO();

// Default range for small props (cups, food). Per-id overrides for props that are larger by nature.
const DEFAULT_PROP_RANGE = [0.05, 0.2];
const PROP_RANGES = {
  coffee_machine: [0.15, 0.6],
  microwave: [0.15, 0.6],
  toaster: [0.15, 0.6],
  papers: [0.2, 0.4], // A4 sheet, 0.297 m long
};

async function scaledSize(entry) {
  const doc = await io.read(join(PUBLIC, entry.file));
  const bounds = getBounds(doc.getRoot().getDefaultScene() ?? doc.getRoot().listScenes()[0]);
  return bounds.max.map((v, i) => (v - bounds.min[i]) * entry.scale);
}

for (const [id, entry] of Object.entries(manifest)) {
  if (entry.kind === 'prop') {
    const [min, max] = PROP_RANGES[id] ?? DEFAULT_PROP_RANGE;
    test(`${id}: scaled max dimension is between ${min} and ${max} m`, async () => {
      const largest = Math.max(...(await scaledSize(entry)));
      assert.ok(largest >= min && largest <= max, `${id} is ${largest.toFixed(3)} m`);
    });
  } else if (entry.kind === 'character') {
    test(`${id}: scaled height is 1.7 m +/- 0.05`, async () => {
      const height = (await scaledSize(entry))[1];
      assert.ok(Math.abs(height - 1.7) <= 0.05, `${id} is ${height.toFixed(3)} m`);
    });
  }
}
