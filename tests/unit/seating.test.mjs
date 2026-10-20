import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseLevel, LEGEND } from '../../public/js/lib/level.js';
import { layoutFurniture, TUCK_DISTANCE } from '../../public/js/lib/furniture.js';
import { placeCharacter, occupiedTile, occupiedTiles, SEATS, STAND_CLOSER, SeatingError } from '../../public/js/lib/seating.js';

const read = (path) => JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8'));

// A 7 x 6 room: walls round a 5 x 4 floor (cols 1-5, rows 1-4).
const MANIFEST = {
  models: {
    table: { kind: 'furniture', footprint: { w: 2, d: 1 } },
    chair: { kind: 'furniture', footprint: { w: 1, d: 1 } },
    sofa: { kind: 'furniture', footprint: { w: 2, d: 1 } },
  },
};
const level = parseLevel({
  legend: { ...LEGEND },
  rows: ['#######', '#.....#', '#.....#', '#.....#', '#.....#', '#######'],
  playerStart: { col: 5, row: 4, facing: 'N' },
  furniture: [
    { id: 't', asset: 'table', col: 1, row: 1, facing: 'S' },
    { id: 'c', asset: 'chair', col: 1, row: 2, facing: 'N' }, // faces the table: tucked
    { id: 'free', asset: 'chair', col: 4, row: 1, facing: 'E' }, // faces nothing
    { id: 's', asset: 'sofa', col: 2, row: 4, facing: 'N' },
  ],
  props: [],
});
const layout = layoutFurniture(level, MANIFEST);
const def = (over) => ({ id: 'x', col: 3, row: 2, facing: 'S', pose: 'stand', ...over });
const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} vs ${b}`);

test('seating: a standing character stands on its tile centre', () => {
  const p = placeCharacter(def(), layout);
  assert.deepEqual(p, { x: 3.5, z: 2.5, facing: 'S', seat: null });
});

test('seating: a standing character steps up to furniture it faces', () => {
  const p = placeCharacter(def({ col: 4, row: 2, facing: 'N' }), layout); // chair "free" at (4, 1)
  close(p.x, 4.5);
  close(p.z, 2.5 - STAND_CLOSER);
});

test('seating: a chair sitter sits at the tucked chair, moved forward onto the seat', () => {
  const p = placeCharacter(def({ col: 1, row: 2, facing: 'N', pose: 'sit' }), layout);
  close(p.x, 1.5);
  close(p.z, 2.5 - TUCK_DISTANCE - SEATS.chair.forward);
  assert.deepEqual(p.seat, { asset: 'chair', height: SEATS.chair.height, feetForward: SEATS.chair.feetForward });
  // An untucked chair facing E moves the sitter along +X only.
  const q = placeCharacter(def({ col: 4, row: 1, facing: 'E', pose: 'sit' }), layout);
  close(q.x, 4.5 + SEATS.chair.forward);
  close(q.z, 1.5);
});

test('seating: sofa sitters take the cushion nearest their tile', () => {
  const [left, , right] = SEATS.sofa.cushions;
  const a = placeCharacter(def({ col: 2, row: 4, facing: 'N', pose: 'sit' }), layout);
  const b = placeCharacter(def({ col: 3, row: 4, facing: 'N', pose: 'sit' }), layout);
  close(a.x, 3 + left);
  close(b.x, 3 + right);
  close(a.z, 4.5 - SEATS.sofa.forward);
  assert.equal(a.seat.height, SEATS.sofa.height);
});

test('seating: bad seats and poses are rejected with the character named', () => {
  assert.throws(() => placeCharacter(def({ pose: 'sit' }), layout), (e) => e instanceof SeatingError && /"x".*no chair or sofa/.test(e.message));
  assert.throws(() => placeCharacter(def({ col: 1, row: 2, facing: 'S', pose: 'sit' }), layout), /faces S, but "c" faces N/);
  assert.throws(() => placeCharacter(def({ col: 1, row: 1, facing: 'S', pose: 'sit' }), layout), /no chair or sofa/); // a table
  assert.throws(() => placeCharacter(def({ col: 1, row: 2 }), layout), /stands on furniture/);
  assert.throws(() => placeCharacter(def({ pose: 'lie' }), layout), /pose "lie"/);
  assert.throws(() => placeCharacter(def({ facing: 'Q' }), layout), /facing "Q"/);
});

test('seating: occupiedTiles lists the tile under each character', () => {
  const characters = [
    def(), // stands on its tile centre
    def({ col: 1, row: 2, facing: 'N', pose: 'sit' }), // sits on its chair's tile
    def({ col: 4, row: 2, facing: 'N' }), // steps up to the chair at (4, 1): occupies that tile, frees its own
  ];
  assert.deepEqual(occupiedTiles({ characters }, layout), [{ col: 3, row: 2 }, { col: 1, row: 2 }, { col: 4, row: 1 }]);
  assert.deepEqual(occupiedTile(characters[2], null), { col: 4, row: 2 }, 'without a placement: its own tile');
});

test('seating: every character in characters.json has a valid place in level.json', () => {
  const realLevel = parseLevel(read('../../public/content/level.json'));
  const realLayout = layoutFurniture(realLevel, read('../../public/content/assets.json'));
  const content = read('../../public/content/characters.json');
  const seats = { mette: 'chair', jonas: 'chair', karim: 'chair', anne: 'sofa', sofie: 'sofa' };
  for (const c of content.characters) {
    const p = placeCharacter(c, realLayout);
    assert.equal(p.seat?.asset ?? null, seats[c.id] ?? null, `${c.id} seat`);
    if (!p.seat) assert.ok(realLevel.isWalkable(c.col, c.row), `${c.id} stands on a walkable tile`);
  }
  // Anne and Sofie do not share a cushion.
  const [anne, sofie] = ['anne', 'sofie'].map((id) => placeCharacter(content.characters.find((c) => c.id === id), realLayout));
  assert.ok(Math.abs(anne.x - sofie.x) > 0.5);
});

test('seating: characters.json puts each character in its intended area', () => {
  const realLevel = parseLevel(read('../../public/content/level.json'));
  const realLayout = layoutFurniture(realLevel, read('../../public/content/assets.json'));
  const cast = new Map(read('../../public/content/characters.json').characters.map((c) => [c.id, c]));
  const tables = realLayout.items.filter((i) => i.asset === 'table_long');
  assert.equal(tables.length, 1, 'one long table');
  const [table] = tables;
  const cols = table.tiles.map((t) => t.col);
  const rows = table.tiles.map((t) => t.row);
  const [minCol, maxCol, minRow, maxRow] = [Math.min(...cols), Math.max(...cols), Math.min(...rows), Math.max(...rows)];
  const inside = (v, lo, hi) => v >= lo && v <= hi;

  // A chair beside the table, the sitter facing it.
  const sides = {
    mette: { facing: 'N', ok: (c) => c.row === maxRow + 1 && inside(c.col, minCol, maxCol) }, // south side
    jonas: { facing: 'S', ok: (c) => c.row === minRow - 1 && inside(c.col, minCol, maxCol) }, // north side
    karim: { facing: 'W', ok: (c) => c.col === maxCol + 1 && inside(c.row, minRow, maxRow) }, // east end
  };
  for (const [id, side] of Object.entries(sides)) {
    const c = cast.get(id);
    assert.equal(realLayout.itemAt(c.col, c.row)?.asset, 'chair', `${id} sits on a chair`);
    assert.ok(side.ok(c), `${id} at (${c.col}, ${c.row}) is on the right side of the table`);
    assert.equal(c.facing, side.facing, `${id} faces the table`);
  }
  for (const id of ['anne', 'sofie']) {
    const c = cast.get(id);
    assert.equal(realLayout.itemAt(c.col, c.row)?.asset, 'sofa', `${id} sits on the sofa`);
  }

  // Birgitte stands in the hallway, next to the open door (orthogonally or diagonally).
  const b = cast.get('birgitte');
  assert.equal(b.pose, 'stand');
  assert.equal(realLevel.typeAt(b.col, b.row), 'floor_hallway');
  const nearDoor = [-1, 0, 1].some((dc) => [-1, 0, 1].some((dr) => realLevel.typeAt(b.col + dc, b.row + dr) === 'door_open'));
  assert.ok(nearDoor, `birgitte at (${b.col}, ${b.row}) is next to the open door`);

  // Henrik stands at the hallway's east end, facing west down it.
  const h = cast.get('henrik');
  assert.equal(h.pose, 'stand');
  assert.equal(realLevel.typeAt(h.col, h.row), 'floor_hallway');
  assert.notEqual(realLevel.typeAt(h.col + 1, h.row), 'floor_hallway', 'nothing further east in the hallway');
  assert.equal(h.facing, 'W');
});
