import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseLevel, LevelError, LEGEND } from '../../public/js/lib/level.js';

const levelJson = JSON.parse(readFileSync(new URL('../../public/content/level.json', import.meta.url), 'utf8'));

/** A minimal valid level; `overrides` replace top-level fields. */
function small(overrides = {}) {
  return {
    legend: { ...LEGEND },
    rows: ['####', '#..#', '####'],
    playerStart: { col: 1, row: 1, facing: 'N' },
    furniture: [],
    props: [],
    ...overrides,
  };
}

test('level: parses the starting map', () => {
  const level = parseLevel(levelJson);
  assert.equal(level.cols, 14);
  assert.equal(level.rows, 12);
  assert.deepEqual(level.playerStart, { col: 8, row: 7, facing: 'N' });
  // Furniture and props are validated by lib/furniture.js (tests/unit/furniture.test.mjs).
  assert.ok(Array.isArray(level.furniture) && level.furniture.length > 0);
  assert.ok(Array.isArray(level.props) && level.props.length > 0);
  assert.equal(level.typeAt(0, 1), 'door_closed');
  assert.equal(level.typeAt(5, 3), 'door_open');
  assert.equal(level.typeAt(1, 3), 'glass');
  assert.equal(level.typeAt(0, 4), 'window');
  assert.equal(level.typeAt(1, 1), 'floor_hallway');
  assert.equal(level.typeAt(6, 6), 'floor');
  assert.equal(level.typeAt(11, 0), 'void');
  assert.equal(level.typeAt(-1, 0), 'void');
  assert.equal(level.typeAt(14, 0), 'void');
  assert.equal(level.typeAt(0, 12), 'void');
});

test('level: the starting map has the exact expected rows', () => {
  assert.deepEqual(levelJson.rows, [
    '##########____',
    'dhhhhhhhh#____',
    '#hhhhhhhh#____',
    '#GGGGDGGG#####',
    'W............#',
    'W............#',
    'W............#',
    'W............#',
    'W............#',
    'W............#',
    'W............#',
    '##############',
  ]);
});

test('level: walkable tiles are floor, hallway and the open door only', () => {
  const level = parseLevel(levelJson);
  assert.ok(level.isWalkable(1, 1), 'hallway');
  assert.ok(level.isWalkable(8, 2), 'hallway east end');
  assert.ok(level.isWalkable(5, 3), 'open door');
  assert.ok(level.isWalkable(1, 4), 'lounge north-west');
  assert.ok(level.isWalkable(12, 10), 'lounge south-east');
  assert.ok(!level.isWalkable(0, 1), 'closed door');
  assert.ok(!level.isWalkable(4, 3), 'glass');
  assert.ok(!level.isWalkable(0, 5), 'window');
  assert.ok(!level.isWalkable(9, 3), 'wall');
  assert.ok(!level.isWalkable(12, 1), 'void');
  assert.ok(!level.isWalkable(-1, 5), 'outside');
  assert.ok(!level.isWalkable(1.5, 4), 'non-integer');
  // Count: 8 x 2 hallway + 1 door + 12 x 7 lounge.
  let count = 0;
  for (let row = 0; row < level.rows; row++) {
    for (let col = 0; col < level.cols; col++) if (level.isWalkable(col, row)) count++;
  }
  assert.equal(count, 16 + 1 + 84);
});

// Expected wall heights for the starting map, worked out by hand from the
// cutaway rule: F = full, N = near, - = not a wall-type tile.
// Row 0 east end (col 9) and the hallway's east wall (col 9, rows 1-2) have no
// walkable tile to their S, E or SE, so they are near walls; so are the east
// wall (col 13) and the whole south wall (row 11).
const EXPECTED_HEIGHTS = [
  'FFFFFFFFFN----',
  'F--------N----',
  'F--------N----',
  'FFFFFFFFFFFFFN',
  'F------------N',
  'F------------N',
  'F------------N',
  'F------------N',
  'F------------N',
  'F------------N',
  'F------------N',
  'NNNNNNNNNNNNNN',
];

test('level: every wall-type tile in the starting map has the expected height', () => {
  const level = parseLevel(levelJson);
  const code = { full: 'F', near: 'N' };
  let walls = 0;
  for (let row = 0; row < level.rows; row++) {
    for (let col = 0; col < level.cols; col++) {
      const expected = EXPECTED_HEIGHTS[row][col];
      const actual = level.wallHeight(col, row);
      assert.equal(actual === null ? '-' : code[actual], expected, `tile (${col}, ${row})`);
      if (actual !== null) walls++;
    }
  }
  assert.equal(walls, 10 + 2 * 2 + 14 + 7 * 2 + 14);
});

test('level: wall slab axes follow wall-type neighbours', () => {
  const level = parseLevel(levelJson);
  assert.deepEqual(level.wallAxes(0, 0), { x: true, z: true }, 'north-west corner');
  assert.deepEqual(level.wallAxes(4, 0), { x: true, z: false }, 'north wall');
  assert.deepEqual(level.wallAxes(0, 6), { x: false, z: true }, 'window wall');
  assert.deepEqual(level.wallAxes(5, 3), { x: true, z: false }, 'open door in glass wall');
  assert.deepEqual(level.wallAxes(9, 3), { x: true, z: true }, 'T junction');
  assert.deepEqual(level.wallAxes(5, 5), { x: false, z: false }, 'floor');
});

test('level: rows of unequal length are rejected', () => {
  assert.throws(() => parseLevel(small({ rows: ['####', '#..', '####'] })), (err) => {
    assert.ok(err instanceof LevelError);
    assert.match(err.message, /row 1 has 3 tiles/);
    return true;
  });
});

test('level: a character missing from the legend is rejected', () => {
  assert.throws(() => parseLevel(small({ rows: ['####', '#.x#', '####'] })), /character "x" is not in the legend/);
});

test('level: a legend that differs from the fixed one is rejected', () => {
  assert.throws(() => parseLevel(small({ legend: { ...LEGEND, '#': 'floor' } })), LevelError);
  assert.throws(() => parseLevel(small({ legend: { ...LEGEND, x: 'floor' } })), LevelError);
  // A key missing from the legend is rejected even when the rows never use it.
  const legend = { ...LEGEND };
  delete legend.h;
  assert.throws(() => parseLevel(small({ legend })), /legend is missing "h"/);
});

test('level: playerStart must be on a walkable tile', () => {
  assert.throws(() => parseLevel(small({ playerStart: { col: 0, row: 0, facing: 'N' } })), /not a walkable tile/);
  assert.throws(() => parseLevel(small({ playerStart: { col: 9, row: 9, facing: 'N' } })), /not a walkable tile/);
  assert.throws(() => parseLevel(small({ playerStart: { col: 1, row: 1, facing: 'X' } })), /facing/);
  assert.throws(() => parseLevel(small({ playerStart: undefined })), /playerStart/);
  // The starting map's glass wall and closed door are not walkable either.
  assert.throws(() => parseLevel({ ...levelJson, playerStart: { col: 3, row: 3, facing: 'N' } }), /not a walkable tile/);
  assert.throws(() => parseLevel({ ...levelJson, playerStart: { col: 0, row: 1, facing: 'N' } }), /not a walkable tile/);
});

test('level: malformed input is rejected', () => {
  assert.throws(() => parseLevel(null), LevelError);
  assert.throws(() => parseLevel(small({ rows: [] })), LevelError);
  assert.throws(() => parseLevel(small({ rows: ['', ''] })), LevelError);
  assert.throws(() => parseLevel(small({ furniture: {} })), /"furniture" must be an array/);
  assert.deepEqual(parseLevel(small({ furniture: undefined, props: undefined })).furniture, []);
});

test('level: a near-wall door and corners in a small map follow the cutaway rule', () => {
  // South wall door (row 2): nothing walkable to its S, E or SE.
  const level = parseLevel(small({ rows: ['#D##', '#..#', '#d##'] }));
  assert.equal(level.wallHeight(1, 0), 'full');
  assert.equal(level.wallHeight(1, 2), 'near');
  assert.equal(level.wallHeight(0, 0), 'full', 'SE of (0,0) is walkable');
  assert.equal(level.wallHeight(3, 0), 'near');
  assert.equal(level.wallHeight(0, 1), 'full');
  assert.equal(level.wallHeight(1, 1), null);
});
