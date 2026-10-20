import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseLevel, LEGEND } from '../../public/js/lib/level.js';
import { createGrid, reachableFrom, tileKey } from '../../public/js/lib/grid.js';
import { placeCharacter, occupiedTiles } from '../../public/js/lib/seating.js';
import {
  FurnitureError, rotateFootprint, footprintTiles, layoutFurniture, backsOntoWall, tuckOffset, TUCK_DISTANCE,
} from '../../public/js/lib/furniture.js';

const read = (path) => JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8'));
const levelJson = read('../../public/content/level.json');
const assets = read('../../public/content/assets.json');
const characters = read('../../public/content/characters.json');

// A 6 x 5 room: walls round a 4 x 3 floor (cols 1-4, rows 1-3).
const MANIFEST = {
  models: {
    table: { kind: 'furniture', footprint: { w: 2, d: 1 } },
    chair: { kind: 'furniture', footprint: { w: 1, d: 1 } },
    cup: { kind: 'prop' },
    hero: { kind: 'character' },
  },
};

function room(furniture = [], props = []) {
  return parseLevel({
    legend: { ...LEGEND },
    rows: ['######', '#....#', '#....#', '#....#', '######'],
    playerStart: { col: 4, row: 3, facing: 'N' },
    furniture,
    props,
  });
}

const tilesOf = (item) => item.tiles.map((t) => [t.col, t.row]);

test('furniture: footprint rotation swaps w and d for E and W only', () => {
  const fp = { w: 3, d: 2 };
  assert.deepEqual(rotateFootprint(fp, 'S'), { w: 3, d: 2 });
  assert.deepEqual(rotateFootprint(fp, 'N'), { w: 3, d: 2 });
  assert.deepEqual(rotateFootprint(fp, 'E'), { w: 2, d: 3 });
  assert.deepEqual(rotateFootprint(fp, 'W'), { w: 2, d: 3 });
  assert.throws(() => rotateFootprint(fp, 'X'), RangeError);
});

test('furniture: footprint tiles start at the north-west tile', () => {
  assert.deepEqual(footprintTiles(2, 5, { w: 3, d: 2 }), [
    { col: 2, row: 5 }, { col: 3, row: 5 }, { col: 4, row: 5 },
    { col: 2, row: 6 }, { col: 3, row: 6 }, { col: 4, row: 6 },
  ]);
});

test('furniture: a rotated footprint blocks the rotated tiles', () => {
  const south = layoutFurniture(room([{ id: 't', asset: 'table', col: 1, row: 1, facing: 'S' }]), MANIFEST);
  assert.deepEqual(tilesOf(south.items[0]), [[1, 1], [2, 1]]);
  const east = layoutFurniture(room([{ id: 't', asset: 'table', col: 1, row: 1, facing: 'E' }]), MANIFEST);
  assert.deepEqual(tilesOf(east.items[0]), [[1, 1], [1, 2]]);
  assert.deepEqual(east.blocked.map((t) => [t.col, t.row]), [[1, 1], [1, 2]]);
  assert.deepEqual(east.items[0].center, { x: 1.5, z: 2 });
  assert.equal(east.itemAt(1, 2).id, 't');
  assert.equal(east.itemAt(2, 1), null);
  const grid = createGrid(room(), east.blocked);
  assert.ok(!grid.isWalkable(1, 2));
  assert.ok(grid.isWalkable(2, 1));
});

test('furniture: overlapping furniture is rejected, adjacent furniture is fine', () => {
  const table = { id: 't', asset: 'table', col: 1, row: 1, facing: 'S' };
  assert.throws(
    () => layoutFurniture(room([table, { id: 'c', asset: 'chair', col: 2, row: 1, facing: 'S' }]), MANIFEST),
    (err) => err instanceof FurnitureError && /"c": tile \(2, 1\) overlaps furniture "t"/.test(err.message),
  );
  // A W-facing table at (2, 1) covers (2, 1) and (2, 2): overlap only after rotation.
  assert.throws(
    () => layoutFurniture(room([{ ...table, row: 2 }, { id: 'u', asset: 'table', col: 2, row: 1, facing: 'W' }]), MANIFEST),
    /overlaps furniture "t"/,
  );
  const ok = layoutFurniture(room([table, { id: 'c', asset: 'chair', col: 1, row: 2, facing: 'N' }]), MANIFEST);
  assert.equal(ok.blocked.length, 3);
});

test('furniture: validation errors name the entry and the problem', () => {
  const bad = (entry, pattern) => assert.throws(() => layoutFurniture(room([entry]), MANIFEST), (err) => {
    assert.ok(err instanceof FurnitureError, err.message);
    assert.match(err.message, pattern);
    return true;
  });
  bad({ id: 'w', asset: 'table', col: 4, row: 1, facing: 'S' }, /"w": tile \(5, 1\) is wall, not floor/);
  bad({ id: 'w', asset: 'chair', col: 0, row: 2, facing: 'S' }, /tile \(0, 2\) is wall/);
  bad({ id: 'v', asset: 'chair', col: 9, row: 9, facing: 'S' }, /tile \(9, 9\) is void/);
  bad({ id: 's', asset: 'chair', col: 4, row: 3, facing: 'S' }, /"s": covers playerStart \(4, 3\)/);
  bad({ id: 'u', asset: 'sofa', col: 1, row: 1, facing: 'S' }, /asset "sofa" is not in assets.json/);
  bad({ id: 'p', asset: 'cup', col: 1, row: 1, facing: 'S' }, /asset "cup" is a prop, not furniture/);
  bad({ id: 'f', asset: 'chair', col: 1, row: 1, facing: 'NE' }, /facing "NE"/);
  bad({ id: 'i', asset: 'chair', col: 1.5, row: 1, facing: 'S' }, /col and row must be integers/);
  bad({ id: 'Bad Id', asset: 'chair', col: 1, row: 1, facing: 'S' }, /id "Bad Id"/);
  bad({ id: 'toString', asset: 'chair', col: 1, row: 1, facing: 'S' }, /id "toString"/);
  bad({ id: 'h', asset: 'toString', col: 1, row: 1, facing: 'S' }, /asset "toString" is not in assets.json/);
  assert.throws(
    () => layoutFurniture(room([
      { id: 'a', asset: 'chair', col: 1, row: 1, facing: 'S' },
      { id: 'a', asset: 'chair', col: 2, row: 1, facing: 'S' },
    ]), MANIFEST),
    /"a": duplicate id/,
  );
  assert.throws(
    () => layoutFurniture(room([{ id: 'n', asset: 'table', col: 1, row: 1, facing: 'S' }]), { models: { table: { kind: 'furniture' } } }),
    /has no valid footprint/,
  );
});

test('furniture: props need a prop asset and a position inside the level', () => {
  const props = (list) => layoutFurniture(room([], list), MANIFEST);
  assert.deepEqual(props([{ asset: 'cup', x: 1.5, y: 0.75, z: 1.5 }]).props, [{ asset: 'cup', x: 1.5, y: 0.75, z: 1.5, rotationDeg: 0 }]);
  assert.throws(() => props([{ asset: 'chair', x: 1, y: 0, z: 1 }]), /props\[0\]: asset "chair" is a furniture, not a prop/);
  assert.throws(() => props([{ asset: 'mug', x: 1, y: 0, z: 1 }]), /asset "mug" is not in assets.json/);
  assert.throws(() => props([{ asset: 'cup', x: '1', y: 0, z: 1 }]), /x must be a number/);
  assert.throws(() => props([{ asset: 'cup', x: 1, y: 0, z: 1, rotationDeg: null }]), /rotationDeg must be a number/);
  assert.throws(() => props([{ asset: 'cup', x: 7, y: 0, z: 1 }]), /outside the level/);
  assert.throws(() => props([{ asset: 'cup', x: 1, y: -0.1, z: 1 }]), /outside the level/);
});

test('furniture: backsOntoWall checks every tile behind the footprint', () => {
  const layout = layoutFurniture(room([
    { id: 'n', asset: 'table', col: 1, row: 1, facing: 'S' }, // back to the north wall
    { id: 'e', asset: 'table', col: 4, row: 1, facing: 'W' }, // back to the east wall
    { id: 'm', asset: 'chair', col: 2, row: 3, facing: 'S' }, // back to a floor tile
  ]), MANIFEST);
  const level = room();
  const [n, e, m] = layout.items;
  assert.ok(backsOntoWall(level, n));
  assert.ok(backsOntoWall(level, e));
  assert.ok(!backsOntoWall(level, m));
});

test('furniture: chairs facing a table are tucked toward it; others are not', () => {
  const layout = layoutFurniture(room([
    { id: 't', asset: 'table', col: 2, row: 2, facing: 'S' },
    { id: 'north', asset: 'chair', col: 2, row: 1, facing: 'S' },
    { id: 'west', asset: 'chair', col: 1, row: 2, facing: 'E' },
    { id: 'away', asset: 'chair', col: 3, row: 1, facing: 'N' },
    { id: 'pair', asset: 'chair', col: 1, row: 1, facing: 'E' }, // faces another chair
  ]), MANIFEST);
  const offset = (id) => tuckOffset(layout, layout.items.find((i) => i.id === id));
  assert.deepEqual(offset('north'), { x: 0, z: TUCK_DISTANCE });
  assert.deepEqual(offset('west'), { x: TUCK_DISTANCE, z: 0 });
  assert.deepEqual(offset('away'), { x: 0, z: 0 });
  assert.deepEqual(offset('pair'), { x: 0, z: 0 });
  assert.deepEqual(offset('t'), { x: 0, z: 0 });
});

// ---- The real level.json --------------------------------------------------

const level = parseLevel(levelJson);
const layout = layoutFurniture(level, assets);
const occupied = occupiedTiles(characters, layout);
const TALK_RANGE = 1.5; // metres, the talking range

function assertAllReachable(grid) {
  const seen = reachableFrom(grid, level.playerStart);
  for (let row = 0; row < grid.rows; row++) {
    for (let col = 0; col < grid.cols; col++) {
      if (grid.isWalkable(col, row)) assert.ok(seen.has(tileKey(col, row)), `tile ${col},${row} is unreachable`);
    }
  }
  return seen;
}

test('level.json: furniture and props validate', () => {
  assert.ok(layout.items.length >= 15);
  assert.ok(layout.props.length >= 10);
  const assetsUsed = new Set(layout.items.map((i) => i.asset));
  for (const id of ['table_long', 'chair', 'sofa', 'coffee_table', 'counter_drawers', 'counter_sink', 'counter_cabinet', 'fridge', 'drawer_cabinet', 'plant_1', 'plant_2', 'plant_3']) {
    assert.ok(assetsUsed.has(id), `${id} is placed`);
  }
});

test('level.json: every walkable tile is reachable from playerStart with the characters in place (flood fill)', () => {
  assertAllReachable(createGrid(level, [...layout.blocked, ...occupied]));
});

test('level.json: the character tiles work', () => {
  const grid = createGrid(level, [...layout.blocked, ...occupied]);
  const seen = reachableFrom(grid, level.playerStart);
  // Birgitte must leave the door's only hallway neighbour free.
  assert.ok(grid.isWalkable(5, 2));
  // Henrik blocks his own tile at the hallway's east end.
  const henrik = characters.characters.find((c) => c.id === 'henrik');
  assert.equal(grid.isWalkable(henrik.col, henrik.row), false);
  // Lars stands in front of the coffee machine, facing north.
  const lars = characters.characters.find((c) => c.id === 'lars');
  const machine = layout.props.find((p) => p.asset === 'coffee_machine');
  assert.equal(Math.floor(machine.x), lars.col);
  assert.ok(machine.z < lars.row);
  assert.equal(lars.facing, 'N');
  // ...right at the counter: the counter is pushed back to the wall
  // face at z 3.6 and is 0.56 m deep (docs/ASSETS.md, 1.12 x 0.5), so its
  // front is at z 4.16. Lars's origin stands 0.3 to 0.45 m in front of it
  // (about a body's depth), and still in line with the machine.
  const larsAt = placeCharacter(lars, layout);
  const counterFront = 3.6 + 1.12 * assets.models.counter_drawers.scale;
  assert.ok(larsAt.z - counterFront >= 0.3 && larsAt.z - counterFront <= 0.45, `Lars ${(larsAt.z - counterFront).toFixed(2)} m from the counter front`);
  assert.ok(Math.abs(larsAt.x - machine.x) < 0.3);
  for (const def of characters.characters) {
    const where = placeCharacter(def, layout);
    // Every character can be reached: a reachable tile within talking range,
    // measured from where the character actually is.
    const near = [...seen].some((k) => {
      const [c, r] = k.split(',').map(Number);
      return Math.hypot(c + 0.5 - where.x, r + 0.5 - where.z) <= TALK_RANGE;
    });
    assert.ok(near, `${def.id} has a reachable tile within ${TALK_RANGE} m`);
  }
});

test('level.json: props rest on the surface below them', () => {
  // Surface heights: docs/ASSETS.md bounding-box tops times the manifest scale.
  const top = {
    table_long: 0.83 * assets.models.table_long.scale,
    coffee_table: 0.28 * assets.models.coffee_table.scale,
    counter_drawers: 1.62 * assets.models.counter_drawers.scale,
    counter_sink: 1.61 * assets.models.counter_sink.scale,
    counter_cabinet: 1.57 * assets.models.counter_cabinet.scale,
  };
  for (const prop of layout.props) {
    const item = layout.itemAt(Math.floor(prop.x), Math.floor(prop.z))
      // counter props stand on the part pushed back against the wall (row 3)
      ?? layout.itemAt(Math.floor(prop.x), Math.floor(prop.z) + 1);
    assert.ok(item, `${prop.asset} at (${prop.x}, ${prop.z}) is over furniture`);
    assert.ok(Math.abs(prop.y - top[item.asset]) < 0.01, `${prop.asset} y ${prop.y} matches the ${item.asset} top ${top[item.asset].toFixed(3)}`);
  }
});
