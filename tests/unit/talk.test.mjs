// Talking range, the walk-then-talk tile and the nameplate rule.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseLevel, LEGEND } from '../../public/js/lib/level.js';
import { createGrid, reachableFrom } from '../../public/js/lib/grid.js';
import { layoutFurniture } from '../../public/js/lib/furniture.js';
import { placeCharacter, occupiedTiles } from '../../public/js/lib/seating.js';
import { findPath } from '../../public/js/lib/pathfinding.js';
import {
  TALK_RANGE, chooseTalkTile, distance, inTalkRange, isBehind, visibleNameplates, walkCosts,
} from '../../public/js/lib/talk.js';

const read = (path) => JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8'));
const level = parseLevel(read('../../public/content/level.json'));
const assets = read('../../public/content/assets.json');
const characters = read('../../public/content/characters.json');
const layout = layoutFurniture(level, assets);
const grid = createGrid(level, [...layout.blocked, ...occupiedTiles(characters, layout)]);
const centre = ({ col, row }) => ({ x: col + 0.5, z: row + 0.5 });

/** An open room of '.' tiles inside walls, with some tiles blocked. */
function openGrid(rows, blocked = []) {
  const lvl = parseLevel({ legend: { ...LEGEND }, rows, playerStart: { col: 1, row: 1, facing: 'N' }, furniture: [], props: [] });
  return createGrid(lvl, blocked);
}

test('talking range is 1.5 m, inclusive', () => {
  assert.equal(TALK_RANGE, 1.5);
  assert.equal(inTalkRange({ x: 0, z: 0 }, { x: 1.5, z: 0 }), true);
  assert.equal(inTalkRange({ x: 0, z: 0 }, { x: 0.9, z: 1.2 }), true); // exactly 1.5
  assert.equal(inTalkRange({ x: 0, z: 0 }, { x: 1.51, z: 0 }), false);
});

test('walk costs match the A* path lengths on the real level', () => {
  const costs = walkCosts(grid, level.playerStart);
  for (const key of reachableFrom(grid, level.playerStart)) {
    const [col, row] = key.split(',').map(Number);
    const { length, reached } = findPath(grid, level.playerStart, { col, row });
    assert.ok(reached);
    assert.ok(Math.abs(costs.get(key) - length) < 1e-9, `${key}: ${costs.get(key)} vs ${length}`);
  }
  assert.equal(costs.size, reachableFrom(grid, level.playerStart).size);
});

test('the talk tile is the reachable in-range tile with the shortest walk', () => {
  // Character on (3, 2), its tile blocked; player in the corner (1, 1).
  const rows = ['#######', '#.....#', '#.....#', '#.....#', '#######'];
  const g = openGrid(rows, [{ col: 3, row: 2 }]);
  const who = { x: 3.5, z: 2.5 };
  const tile = chooseTalkTile(g, { col: 1, row: 1 }, who);
  // (2, 1) is one step away and 1.41 m from the character.
  assert.deepEqual(tile, { col: 2, row: 1, cost: 1 });
  // Already on an in-range tile: stay there (cost 0).
  assert.deepEqual(chooseTalkTile(g, { col: 4, row: 3 }, who), { col: 4, row: 3, cost: 0 });
});

test('equal walks go to the tile nearest the character', () => {
  const rows = ['#######', '#.....#', '#.....#', '#.....#', '#######'];
  // Character on (3, 3), a little east of its tile centre; (3, 2) is blocked
  // too, so from (3, 1) both (2, 2) and (4, 2) cost 2 (no corner cutting).
  const g = openGrid(rows, [{ col: 3, row: 3 }, { col: 3, row: 2 }]);
  const who = { x: 3.6, z: 3.5 };
  // (2, 2) is 1.49 m away, (4, 2) 1.35 m: the nearer one wins over the lower column.
  assert.deepEqual(chooseTalkTile(g, { col: 3, row: 1 }, who), { col: 4, row: 2, cost: 2 });
  // Without the block, (3, 2) is a single step and wins on the walk alone.
  const open = openGrid(rows, [{ col: 3, row: 3 }]);
  assert.deepEqual(chooseTalkTile(open, { col: 3, row: 1 }, who), { col: 3, row: 2, cost: 1 });
});

test('isBehind: the 90 degree sector at a character\'s back', () => {
  const who = { x: 0, z: 0 };
  // Facing N (-Z): straight behind is +Z.
  assert.equal(isBehind({ x: 0, z: 1 }, who, 'N'), true);
  assert.equal(isBehind({ x: 0.9, z: 1 }, who, 'N'), true); // 42 degrees off
  assert.equal(isBehind({ x: 1, z: 1 }, who, 'N'), false); // 45 degrees: beside
  assert.equal(isBehind({ x: 1, z: 0 }, who, 'N'), false);
  assert.equal(isBehind({ x: 0, z: -1 }, who, 'N'), false);
  assert.equal(isBehind({ x: -1, z: 0 }, who, 'E'), true);
  assert.equal(isBehind({ x: 0, z: -1 }, who, 'S'), true);
  assert.equal(isBehind({ x: 1, z: 0 }, who, 'W'), true);
  assert.equal(isBehind(who, who, 'N'), false);
});

test('a tile at the character\'s back is used only when nothing else in range is reachable', () => {
  const rows = ['#######', '#.....#', '#.....#', '#.....#', '#######'];
  // Character on (3, 2) facing N; the player comes from (3, 3), right behind it.
  const g = openGrid(rows, [{ col: 3, row: 2 }]);
  const who = { x: 3.5, z: 2.5, facing: 'N' };
  // Without facing: stay where it is (cost 0, at its back).
  assert.deepEqual(chooseTalkTile(g, { col: 3, row: 3 }, { x: 3.5, z: 2.5 }), { col: 3, row: 3, cost: 0 });
  // With facing: step beside it instead ((2, 3) and (4, 3) are 45 degrees off; the lower column wins).
  assert.deepEqual(chooseTalkTile(g, { col: 3, row: 3 }, who), { col: 2, row: 3, cost: 1 });
  // Only the back tile reachable: it is still used.
  // (A corridor running south from the character's tile at (3, 1).)
  const walled = openGrid(['#######', '#.#####', '###.###', '###.###', '#######']);
  assert.deepEqual(chooseTalkTile(walled, { col: 3, row: 3 }, { x: 3.5, z: 1.5, facing: 'N' }), { col: 3, row: 2, cost: 1 });
});

test('no reachable tile in range gives null', () => {
  const rows = ['#######', '#..#..#', '#..#..#', '#######'];
  const g = openGrid(rows);
  assert.equal(chooseTalkTile(g, { col: 1, row: 1 }, { x: 5.5, z: 1.5 }), null);
});

test('all eight characters have a valid talk tile in the real level, from the start and from elsewhere', () => {
  assert.equal(characters.characters.length, 8);
  const starts = [level.playerStart, { col: 1, row: 1 }, { col: 11, row: 10 }, { col: 1, row: 9 }];
  for (const def of characters.characters) {
    const place = placeCharacter(def, layout);
    for (const start of starts) {
      const tile = chooseTalkTile(grid, start, place);
      assert.ok(tile, `${def.id} from (${start.col}, ${start.row})`);
      assert.ok(grid.isWalkable(tile.col, tile.row), `${def.id}: talk tile walkable`);
      assert.ok(distance(centre(tile), place) <= TALK_RANGE + 1e-9, `${def.id}: talk tile in range`);
      const path = findPath(grid, start, tile);
      assert.ok(path.reached, `${def.id}: talk tile reachable`);
      // Not at the character's back when another tile in range is
      // reachable, and no such tile is a shorter walk.
      const costs = walkCosts(grid, start);
      const inRange = [...costs].map(([key, cost]) => {
        const [col, row] = key.split(',').map(Number);
        return { key, cost, at: centre({ col, row }) };
      }).filter(({ at }) => distance(at, place) <= TALK_RANGE + 1e-9);
      const front = inRange.filter(({ at }) => !isBehind(at, place, def.facing));
      if (front.length) assert.ok(!isBehind(centre(tile), place, def.facing), `${def.id}: talk tile at the back`);
      for (const { key, cost } of front.length ? front : inRange) {
        assert.ok(cost >= tile.cost - 1e-9, `${def.id}: ${key} is shorter`);
      }
    }
  }
});

test('nameplates show on hover or within talking range, and only then', () => {
  const places = new Map([['a', { x: 1, z: 1 }], ['b', { x: 5, z: 5 }], ['c', { x: 2, z: 2 }]]);
  assert.deepEqual([...visibleNameplates(places, { x: 10, z: 10 })], []);
  assert.deepEqual([...visibleNameplates(places, { x: 10, z: 10 }, ['b'])], ['b']);
  assert.deepEqual([...visibleNameplates(places, { x: 1.5, z: 1.5 })].sort(), ['a', 'c']);
  assert.deepEqual([...visibleNameplates(places, { x: 1.5, z: 1.5 }, ['b', 'unknown'])].sort(), ['a', 'b', 'c']);
  // The same rule as the talking range: 1.5 m in, 1.51 m out.
  assert.deepEqual([...visibleNameplates(places, { x: 6.5, z: 5 })], ['b']);
  assert.deepEqual([...visibleNameplates(places, { x: 6.51, z: 5 })], []);
});
