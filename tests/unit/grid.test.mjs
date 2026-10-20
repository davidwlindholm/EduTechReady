import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseLevel } from '../../public/js/lib/level.js';
import { createGrid, reachableFrom } from '../../public/js/lib/grid.js';
import { layoutFurniture } from '../../public/js/lib/furniture.js';

const level = parseLevel(JSON.parse(readFileSync(new URL('../../public/content/level.json', import.meta.url), 'utf8')));

test('grid: follows level walkability', () => {
  const g = createGrid(level);
  assert.equal(g.cols, 14);
  assert.equal(g.rows, 12);
  assert.ok(g.isWalkable(8, 7));
  assert.ok(g.isWalkable(5, 3));
  assert.ok(!g.isWalkable(0, 0));
  assert.ok(!g.isWalkable(14, 0));
});

test('grid: occupied tiles are blocked', () => {
  const g = createGrid(level, [{ col: 5, row: 2 }]);
  assert.ok(!g.isWalkable(5, 2));
  assert.ok(g.isBlocked(5, 2));
  assert.ok(g.isWalkable(4, 2));
  assert.ok(!g.isBlocked(4, 2));
});

test('grid: reachableFrom fills orthogonally and stops at blocked tiles', () => {
  // A wall of occupied tiles across the lounge (col 7, rows 4 to 10) splits it in two.
  const wall = [4, 5, 6, 7, 8, 9, 10].map((row) => ({ col: 7, row }));
  const g = createGrid(level, wall);
  const seen = reachableFrom(g, { col: 10, row: 8 });
  assert.ok(seen.has('12,10'));
  assert.ok(!seen.has('3,8'));
  assert.ok(!seen.has('7,8'));
  assert.equal(reachableFrom(g, { col: 7, row: 8 }).size, 0, 'a blocked start reaches nothing');
});

test('grid: furniture and standing characters leave every walkable tile reachable from playerStart', () => {
  const characters = JSON.parse(readFileSync(new URL('../../public/content/characters.json', import.meta.url), 'utf8'));
  const assets = JSON.parse(readFileSync(new URL('../../public/content/assets.json', import.meta.url), 'utf8'));
  const standing = characters.characters.filter((c) => c.pose === 'stand');
  const g = createGrid(level, [...layoutFurniture(level, assets).blocked, ...standing]);
  const seen = reachableFrom(g, level.playerStart);
  for (let row = 0; row < g.rows; row++) {
    for (let col = 0; col < g.cols; col++) {
      if (g.isWalkable(col, row)) assert.ok(seen.has(`${col},${row}`), `tile ${col},${row} is unreachable`);
    }
  }
});
