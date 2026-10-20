import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { findPath, octile } from '../../public/js/lib/pathfinding.js';
import { parseLevel } from '../../public/js/lib/level.js';
import { createGrid } from '../../public/js/lib/grid.js';
import { layoutFurniture } from '../../public/js/lib/furniture.js';

/** A grid from rows of text: '.' walkable, anything else blocked. */
function gridOf(rows) {
  return {
    cols: rows[0].length,
    rows: rows.length,
    isWalkable: (col, row) => row >= 0 && row < rows.length && col >= 0 && col < rows[0].length && rows[row][col] === '.',
  };
}

const t = (col, row) => ({ col, row });
const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} != ${b}`);

/** Every step is to an 8-neighbour, lands on a walkable tile and cuts no corner. */
function assertValid(grid, start, path) {
  let prev = start;
  for (const tile of path) {
    const dc = tile.col - prev.col;
    const dr = tile.row - prev.row;
    assert.ok(Math.max(Math.abs(dc), Math.abs(dr)) === 1, `jump from ${JSON.stringify(prev)} to ${JSON.stringify(tile)}`);
    assert.ok(grid.isWalkable(tile.col, tile.row), `blocked tile ${JSON.stringify(tile)}`);
    if (dc && dr) {
      assert.ok(grid.isWalkable(prev.col + dc, prev.row) && grid.isWalkable(prev.col, prev.row + dr),
        `corner cut between ${JSON.stringify(prev)} and ${JSON.stringify(tile)}`);
    }
    prev = tile;
  }
}

test('pathfinding: a straight path', () => {
  const grid = gridOf(['......']);
  const r = findPath(grid, t(0, 0), t(5, 0));
  assert.deepEqual(r.path, [t(1, 0), t(2, 0), t(3, 0), t(4, 0), t(5, 0)]);
  assert.deepEqual(r.goal, t(5, 0));
  assert.equal(r.reached, true);
  close(r.length, 5);

  // A free diagonal is one straight run too.
  const open = gridOf(['....', '....', '....', '....']);
  const d = findPath(open, t(0, 0), t(3, 3));
  assert.deepEqual(d.path, [t(1, 1), t(2, 2), t(3, 3)]);
  close(d.length, 3 * Math.SQRT2);
});

test('pathfinding: a path around an obstacle is the shortest octile path', () => {
  const grid = gridOf([
    '.......',
    '...#...',
    '...#...',
    '...#...',
    '.......',
  ]);
  const start = t(1, 2);
  const r = findPath(grid, start, t(5, 2));
  assertValid(grid, start, r.path);
  assert.deepEqual(r.goal, t(5, 2));
  assert.equal(r.reached, true);
  // Round an end of the wall. The diagonals onto and off the wall-end row would
  // cut the wall's corner, so the cheapest route is diagonal, four straight
  // steps past the wall end, diagonal: 4 + 2√2.
  close(r.length, 4 + 2 * Math.SQRT2);
  assert.equal(r.path.length, 6);
  assert.ok(r.path.every((p) => p.col !== 3 || p.row === 0 || p.row === 4), 'goes round the wall end');
});

test('pathfinding: diagonal moves do not cut blocked corners', () => {
  // The only diagonal from (0,1) to (1,0) passes between (0,0) and (1,1).
  const grid = gridOf([
    '#..',
    '.#.',
    '...',
  ]);
  const start = t(0, 1);
  const r = findPath(grid, start, t(1, 0));
  assertValid(grid, start, r.path);
  // Every diagonal on the way round passes the blocked centre (1,1), so the
  // path goes the long way round with orthogonal steps only.
  assert.deepEqual(r.path, [t(0, 2), t(1, 2), t(2, 2), t(2, 1), t(2, 0), t(1, 0)]);
  close(r.length, 6);

  // With one corner blocked, a diagonal is refused even though both ends are free.
  const one = gridOf(['.#', '..']);
  const s = findPath(one, t(0, 0), t(1, 1));
  assert.deepEqual(s.path, [t(0, 1), t(1, 1)]);
});

test('pathfinding: start equals target gives an empty path', () => {
  const grid = gridOf(['...', '...']);
  const r = findPath(grid, t(1, 1), t(1, 1));
  assert.deepEqual(r, { path: [], goal: t(1, 1), reached: true, length: 0 });
});

test('pathfinding: an unreachable target goes to the closest reachable tile', () => {
  // Target (4,1) inside a closed box (cols 3 to 5). (2,1) is 2 away; (6,1) is
  // as close but on the far side of the box, so not reachable.
  const grid = gridOf([
    '...###.',
    '...#.#.',
    '...###.',
  ]);
  const r = findPath(grid, t(0, 1), t(4, 1));
  assert.deepEqual(r.goal, t(2, 1));
  assert.equal(r.reached, false);
  assert.deepEqual(r.path, [t(1, 1), t(2, 1)]);

  // A blocked target and a target outside the map work the same way.
  assert.deepEqual(findPath(grid, t(0, 1), t(3, 1)).goal, t(2, 1));
  assert.deepEqual(findPath(grid, t(0, 1), t(-3, 1)).goal, t(0, 1));
  assert.deepEqual(findPath(grid, t(0, 1), t(-3, 1)).path, []);
});

test('pathfinding: equally close tiles are decided by path length', () => {
  // Target (2,1) is blocked. (1,1), (3,1) and (2,0) are all 1 away. (1,1) is
  // two steps from the start (the diagonal would cut (1,0)); the other two
  // are only reachable round the bottom row. Row order alone would pick
  // (2,0), so this checks that path length decides.
  const rows = [
    '.#...',
    '..#..',
    '.###.',
    '.....',
  ];
  const r = findPath(gridOf(rows), t(0, 0), t(2, 1));
  assert.deepEqual(r.goal, t(1, 1));
  assert.equal(r.reached, false);
  assert.deepEqual(r.path, [t(0, 1), t(1, 1)]);
  close(r.length, 2);

  // Mirrored left to right, the nearer tile is now on the right: (3,1).
  const mirrored = rows.map((row) => [...row].reverse().join(''));
  const m = findPath(gridOf(mirrored), t(4, 0), t(2, 1));
  assert.deepEqual(m.goal, t(3, 1));
  close(m.length, 2);
});

test('pathfinding: the octile heuristic is the free-grid path length', () => {
  close(octile(t(0, 0), t(3, 1)), 2 + Math.SQRT2);
  close(octile(t(2, 2), t(2, 2)), 0);
  const open = gridOf(['.....', '.....', '.....']);
  close(findPath(open, t(0, 0), t(4, 2)).length, octile(t(0, 0), t(4, 2)));
});

// The real level: the closed door at the west end of the hallway and the
// open door between hallway and lounge (the e2e test walks these too).
const read = (name) => JSON.parse(readFileSync(new URL(`../../public/content/${name}`, import.meta.url), 'utf8'));
const level = parseLevel(read('level.json'));
const standing = read('characters.json').characters.filter((c) => c.pose === 'stand');
const levelGrid = createGrid(level, [...layoutFurniture(level, read('assets.json')).blocked, ...standing]);

test('pathfinding: on the level, the player walks through the open door to the hallway', () => {
  const start = t(level.playerStart.col, level.playerStart.row);
  const r = findPath(levelGrid, start, t(3, 1));
  assert.equal(r.reached, true);
  assertValid(levelGrid, start, r.path);
  assert.ok(r.path.some((p) => p.col === 5 && p.row === 3), 'passes the open door (5, 3)');
});

test('pathfinding: on the level, the closed door sends the player to the hallway end', () => {
  const r = findPath(levelGrid, t(level.playerStart.col, level.playerStart.row), t(0, 1));
  assert.equal(level.typeAt(0, 1), 'door_closed');
  assert.equal(r.reached, false);
  assert.deepEqual(r.goal, t(1, 1));
});
