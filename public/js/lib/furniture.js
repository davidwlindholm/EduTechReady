// Furniture and props from level.json: footprint rotation,
// blocked tiles and validation. Pure: no three.js, no DOM.
import { tileKey } from './grid.js';

const FACINGS = new Set(['N', 'E', 'S', 'W']);
// Furniture stands on floor tiles only (not on walls, void or the open door).
const FLOOR_TYPES = new Set(['floor', 'floor_hallway']);
const ID_PATTERN = /^[a-z][a-z0-9-]{0,39}$/;

/** Thrown for furniture or props that break the level.json rules. */
export class FurnitureError extends Error {
  constructor(message) {
    super(`level.json: ${message}`);
    this.name = 'FurnitureError';
  }
}

/**
 * Footprint after rotation: `w` runs along X and `d` along Z. The manifest
 * footprint is for facing S (and N); E and W swap the two.
 * @param {{ w: number, d: number }} footprint from assets.json
 * @param {string} facing N, E, S or W
 * @returns {{ w: number, d: number }}
 */
export function rotateFootprint(footprint, facing) {
  if (!FACINGS.has(facing)) throw new RangeError(`unknown facing ${facing}`);
  return facing === 'E' || facing === 'W'
    ? { w: footprint.d, d: footprint.w }
    : { w: footprint.w, d: footprint.d };
}

/**
 * Tiles covered by a footprint whose north-west tile is (col, row).
 * @returns {{ col: number, row: number }[]}
 */
export function footprintTiles(col, row, { w, d }) {
  const tiles = [];
  for (let r = row; r < row + d; r++) {
    for (let c = col; c < col + w; c++) tiles.push({ col: c, row: r });
  }
  return tiles;
}

/**
 * @typedef {object} PlacedFurniture
 * @property {string} id
 * @property {string} asset
 * @property {number} col north-west tile of the rotated footprint
 * @property {number} row
 * @property {string} facing
 * @property {number} w rotated footprint along X (tiles)
 * @property {number} d rotated footprint along Z (tiles)
 * @property {{ col: number, row: number }[]} tiles
 * @property {{ x: number, z: number }} center world centre of the footprint
 */

/**
 * @typedef {object} PlacedProp
 * @property {string} asset
 * @property {number} x
 * @property {number} y
 * @property {number} z
 * @property {number} rotationDeg
 */

/**
 * @typedef {object} FurnitureLayout
 * @property {PlacedFurniture[]} items
 * @property {PlacedProp[]} props
 * @property {{ col: number, row: number }[]} blocked every footprint tile, for createGrid
 * @property {(col: number, row: number) => PlacedFurniture | null} itemAt
 */

/**
 * Validate and place the level's furniture and props. Every error names
 * the entry so a content author can find it.
 * @param {import('./level.js').Level} level
 * @param {{ models: Record<string, object> }} manifest parsed assets.json
 * @returns {FurnitureLayout}
 * @throws {FurnitureError}
 */
export function layoutFurniture(level, manifest) {
  const models = manifest?.models ?? {};
  const owner = new Map(); // "col,row" -> item
  const ids = new Set();
  const start = level.playerStart;

  const items = level.furniture.map((entry, index) => {
    const where = `furniture[${index}]`;
    if (!entry || typeof entry !== 'object') throw new FurnitureError(`${where} must be an object`);
    const { id, asset, col, row, facing } = entry;
    if (typeof id !== 'string' || !ID_PATTERN.test(id)) throw new FurnitureError(`${where}: id "${id}" must match ${ID_PATTERN}`);
    const name = `furniture "${id}"`;
    if (ids.has(id)) throw new FurnitureError(`${name}: duplicate id`);
    ids.add(id);
    const model = Object.prototype.hasOwnProperty.call(models, asset) ? models[asset] : null;
    if (!model) throw new FurnitureError(`${name}: asset "${asset}" is not in assets.json`);
    if (model.kind !== 'furniture') throw new FurnitureError(`${name}: asset "${asset}" is a ${model.kind}, not furniture`);
    const fp = model.footprint;
    if (!fp || !Number.isInteger(fp.w) || !Number.isInteger(fp.d) || fp.w < 1 || fp.d < 1) {
      throw new FurnitureError(`${name}: asset "${asset}" has no valid footprint`);
    }
    if (!Number.isInteger(col) || !Number.isInteger(row)) throw new FurnitureError(`${name}: col and row must be integers`);
    if (!FACINGS.has(facing)) throw new FurnitureError(`${name}: facing "${facing}" must be N, E, S or W`);

    const { w, d } = rotateFootprint(fp, facing);
    const tiles = footprintTiles(col, row, { w, d });
    const item = Object.freeze({
      id, asset, col, row, facing, w, d,
      tiles: Object.freeze(tiles.map((t) => Object.freeze(t))),
      center: Object.freeze({ x: col + w / 2, z: row + d / 2 }),
    });
    for (const t of tiles) {
      const type = level.typeAt(t.col, t.row);
      if (!FLOOR_TYPES.has(type)) throw new FurnitureError(`${name}: tile (${t.col}, ${t.row}) is ${type}, not floor`);
      if (t.col === start.col && t.row === start.row) throw new FurnitureError(`${name}: covers playerStart (${t.col}, ${t.row})`);
      const k = tileKey(t.col, t.row);
      if (owner.has(k)) throw new FurnitureError(`${name}: tile (${t.col}, ${t.row}) overlaps furniture "${owner.get(k).id}"`);
      owner.set(k, item);
    }
    return item;
  });

  const props = level.props.map((entry, index) => {
    const where = `props[${index}]`;
    if (!entry || typeof entry !== 'object') throw new FurnitureError(`${where} must be an object`);
    const { asset, x, y, z, rotationDeg = 0 } = entry;
    const model = Object.prototype.hasOwnProperty.call(models, asset) ? models[asset] : null;
    if (!model) throw new FurnitureError(`${where}: asset "${asset}" is not in assets.json`);
    if (model.kind !== 'prop') throw new FurnitureError(`${where}: asset "${asset}" is a ${model.kind}, not a prop`);
    for (const [key, value] of Object.entries({ x, y, z, rotationDeg })) {
      if (typeof value !== 'number' || !Number.isFinite(value)) throw new FurnitureError(`${where} (${asset}): ${key} must be a number`);
    }
    if (x < 0 || z < 0 || x > level.cols || z > level.rows || y < 0) {
      throw new FurnitureError(`${where} (${asset}): (${x}, ${y}, ${z}) is outside the level`);
    }
    return Object.freeze({ asset, x, y, z, rotationDeg });
  });

  const blocked = Object.freeze(items.flatMap((item) => item.tiles));
  return Object.freeze({
    items: Object.freeze(items),
    props: Object.freeze(props),
    blocked,
    itemAt: (col, row) => owner.get(tileKey(col, row)) ?? null,
  });
}

/**
 * True when every tile directly behind the footprint (opposite its facing)
 * is a solid wall, so the renderer may push the model back against it.
 * @param {import('./level.js').Level} level
 * @param {PlacedFurniture} item
 */
export function backsOntoWall(level, item) {
  const behind = [];
  if (item.facing === 'S') for (let c = item.col; c < item.col + item.w; c++) behind.push([c, item.row - 1]);
  if (item.facing === 'N') for (let c = item.col; c < item.col + item.w; c++) behind.push([c, item.row + item.d]);
  if (item.facing === 'E') for (let r = item.row; r < item.row + item.d; r++) behind.push([item.col - 1, r]);
  if (item.facing === 'W') for (let r = item.row; r < item.row + item.d; r++) behind.push([item.col + item.w, r]);
  return behind.every(([c, r]) => level.typeAt(c, r) === 'wall');
}

/** How far a seat is pulled toward the table it faces (metres). */
export const TUCK_DISTANCE = 0.25;

const FACING_STEP = Object.freeze({ N: [0, -1], S: [0, 1], E: [1, 0], W: [-1, 0] });

/**
 * World offset that tucks a one-tile item (a chair) toward the larger item
 * on the tile it faces (a table), as chairs stand in the mockup. Zero for
 * anything else. lib/seating.js seats characters with the same offset.
 * @param {FurnitureLayout} layout
 * @param {PlacedFurniture} item
 * @returns {{ x: number, z: number }}
 */
export function tuckOffset(layout, item) {
  const none = { x: 0, z: 0 };
  if (item.w !== 1 || item.d !== 1) return none;
  const [dc, dr] = FACING_STEP[item.facing];
  const front = layout.itemAt(item.col + dc, item.row + dr);
  if (!front || front === item || front.tiles.length <= 1) return none;
  return { x: dc * TUCK_DISTANCE, z: dr * TUCK_DISTANCE };
}
