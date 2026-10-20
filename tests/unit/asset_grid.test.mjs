import { test } from 'node:test';
import assert from 'node:assert/strict';
import { layoutModels, GROUP_LAYOUT } from '../../public/js/lib/asset_grid.js';

test('layoutModels places every model once, grouped by kind along +Z', () => {
  const models = {
    a: { kind: 'prop' },
    b: { kind: 'character' },
    c: { kind: 'furniture' },
    d: { kind: 'character' },
  };
  const placed = layoutModels(models);
  assert.deepEqual(placed.map((p) => p.id).sort(), ['a', 'b', 'c', 'd']);
  const z = Object.fromEntries(placed.map((p) => [p.id, p.z]));
  assert.ok(z.b === z.d && z.b < z.c && z.c < z.a);
});

test('layoutModels wraps rows at the configured column count', () => {
  const models = {};
  const columns = GROUP_LAYOUT.character.columns;
  for (let i = 0; i <= columns; i += 1) models[`c${i}`] = { kind: 'character' };
  const placed = layoutModels(models);
  const last = placed.find((p) => p.id === `c${columns}`);
  assert.equal(last.x, 0);
  assert.equal(last.z, GROUP_LAYOUT.character.cell);
});
