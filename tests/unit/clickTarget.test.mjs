// Where a floor click sends the player.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseLevel } from '../../public/js/lib/level.js';
import { createGrid } from '../../public/js/lib/grid.js';
import { layoutFurniture } from '../../public/js/lib/furniture.js';
import { occupiedTiles, placeCharacter } from '../../public/js/lib/seating.js';
import { findPath } from '../../public/js/lib/pathfinding.js';
import { floorClickTarget } from '../../public/js/lib/clickTarget.js';

const read = (path) => JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8'));
const level = parseLevel(read('../../public/content/level.json'));
const characters = read('../../public/content/characters.json');
const layout = layoutFurniture(level, read('../../public/content/assets.json'));
const grid = createGrid(level, [...layout.blocked, ...occupiedTiles(characters, layout)]);
const start = level.playerStart;
const byId = (id) => characters.characters.find((c) => c.id === id);

test('clickTarget: a click on a reachable tile walks to that tile, wherever on it', () => {
  for (const [x, z] of [[2.5, 9.5], [2.05, 9.95], [9.9, 6.01]]) {
    assert.deepEqual(floorClickTarget(grid, start, { x, z }), { col: Math.floor(x), row: Math.floor(z) });
  }
});

test('clickTarget: a click on a tile centre goes where findPath would (blocked tiles included)', () => {
  for (let row = 0; row < level.rows; row++) {
    for (let col = 0; col < level.cols; col++) {
      if (level.typeAt(col, row) === 'void') continue;
      const expected = findPath(grid, start, { col, row }).goal;
      assert.deepEqual(floorClickTarget(grid, start, { x: col + 0.5, z: row + 0.5 }), expected, `tile ${col},${row}`);
    }
  }
});

test('clickTarget: the floor just behind Karim\'s chair goes to the tile behind him', () => {
  const karim = byId('karim');
  assert.equal(grid.isWalkable(karim.col, karim.row), false, 'his chair blocks his tile');
  // From the west side of the room the tiles beside him are the shorter
  // walk, so a tile-centre rule would send the player beside him.
  const from = { col: 1, row: 9 };
  assert.notDeepEqual(findPath(grid, from, { col: karim.col, row: karim.row }).goal, { col: 6, row: 6 });
  assert.deepEqual(floorClickTarget(grid, from, { x: 5.85, z: 6.5 }), { col: 6, row: 6 });
});

test('clickTarget: the tile right behind Lars is free and walkable (he stands at the counter)', () => {
  const lars = byId('lars');
  const place = placeCharacter(lars, layout);
  assert.ok(place.z < lars.row, 'he stands at the north edge of his tile');
  assert.equal(grid.isWalkable(lars.col, lars.row), true);
  assert.deepEqual(floorClickTarget(grid, start, { x: 9.5, z: 5.6 }), { col: 9, row: 5 });
});
