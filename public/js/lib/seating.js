// Where characters stand or sit. Pure: no three.js, no DOM.
import { tileAt, tileCenter } from './movement.js';
import { tuckOffset } from './furniture.js';

/**
 * Seat geometry per furniture asset, in metres after the manifest scale,
 * measured from the GLBs (docs/ASSETS.md bounds; seat heights from sampled
 * vertex heights). The renderer centres each model's
 * bounding box on its footprint, so offsets are relative to that centre.
 *
 * - `height`: top of the seat cushion.
 * - `forward`: how far ahead of the footprint centre (along the seat's facing)
 *   the sitter's origin goes, so the back of the seated pose meets the backrest.
 * - `feetForward`: how far ahead of the clip's own foot position the feet are
 *   put down, so they clear the seat front (the sofa has a solid base).
 * - `cushions`: offsets across the seat of each cushion centre; a sitter takes
 *   the cushion nearest its tile. The sofa is symmetric, so facing does not
 *   change these.
 */
export const SEATS = Object.freeze({
  chair: Object.freeze({ height: 0.519, forward: 0.2, feetForward: 0.08, cushions: Object.freeze([0]) }),
  sofa: Object.freeze({ height: 0.405, forward: 0.27, feetForward: 0.15, cushions: Object.freeze([-0.73, 0, 0.73]) }),
});

/**
 * A standing character who faces furniture on the next tile steps this far
 * toward it, so Lars stands right at the counter (as in the mockup), not a
 * metre from it: counters are pushed back against the wall (backsOntoWall),
 * so their front is 0.84 m past the tile edge and Lars's origin ends 0.39 m
 * in front of it. Only wall-backed furniture suits this distance; the only
 * standing character facing furniture is Lars. His characters.json tile
 * stays (9, 5), but he occupies the counter's tile (occupiedTiles), so (9, 5),
 * right behind him, is free; (8, 5) and (8, 4) are within
 * talking range (tests/unit/talk.test.mjs).
 */
export const STAND_CLOSER = 0.95;

const FORWARD = Object.freeze({ N: [0, -1], S: [0, 1], E: [1, 0], W: [-1, 0] });

/** Thrown for a character whose place breaks the characters.json rules. */
export class SeatingError extends Error {
  constructor(message) {
    super(`characters.json: ${message}`);
    this.name = 'SeatingError';
  }
}

/**
 * @typedef {object} Placement
 * @property {number} x world position of the character's origin (feet for standing)
 * @property {number} z
 * @property {string} facing N, E, S or W
 * @property {null | { asset: string, height: number, feetForward: number }} seat
 *   the seat for a seated character, null for a standing one
 */

/**
 * World placement of a character from its characters.json entry. A seated
 * character's tile must hold a seat (chair or sofa) facing the same way.
 * @param {{ id: string, col: number, row: number, facing: string, pose: string }} def
 * @param {import('./furniture.js').FurnitureLayout} layout
 * @returns {Placement}
 * @throws {SeatingError}
 */
export function placeCharacter(def, layout) {
  const name = `character "${def.id}"`;
  if (!Object.prototype.hasOwnProperty.call(FORWARD, def.facing)) throw new SeatingError(`${name}: facing "${def.facing}" must be N, E, S or W`);
  const centre = tileCenter(def.col, def.row);
  if (def.pose === 'stand') {
    if (layout.itemAt(def.col, def.row)) throw new SeatingError(`${name} stands on furniture at (${def.col}, ${def.row})`);
    const [fx, fz] = FORWARD[def.facing];
    const step = layout.itemAt(def.col + fx, def.row + fz) ? STAND_CLOSER : 0;
    return Object.freeze({ x: centre.x + fx * step, z: centre.z + fz * step, facing: def.facing, seat: null });
  }
  if (def.pose !== 'sit') throw new SeatingError(`${name}: pose "${def.pose}" must be stand or sit`);
  const item = layout.itemAt(def.col, def.row);
  const spec = item && Object.prototype.hasOwnProperty.call(SEATS, item.asset) ? SEATS[item.asset] : null;
  if (!spec) throw new SeatingError(`${name} sits at (${def.col}, ${def.row}), which holds no chair or sofa`);
  if (item.facing !== def.facing) throw new SeatingError(`${name} faces ${def.facing}, but "${item.id}" faces ${item.facing}`);

  const [fx, fz] = FORWARD[def.facing];
  const tuck = tuckOffset(layout, item);
  // Across the seat: snap the tile centre to the nearest cushion.
  const acrossX = fz !== 0; // seats facing N or S run along X
  const tileAcross = acrossX ? centre.x - item.center.x : centre.z - item.center.z;
  const cushion = spec.cushions.reduce((best, c) => (Math.abs(c - tileAcross) < Math.abs(best - tileAcross) ? c : best));
  return Object.freeze({
    x: item.center.x + tuck.x + fx * spec.forward + (acrossX ? cushion : 0),
    z: item.center.z + tuck.z + fz * spec.forward + (acrossX ? 0 : cushion),
    facing: def.facing,
    seat: Object.freeze({ asset: item.asset, height: spec.height, feetForward: spec.feetForward }),
  });
}

/**
 * Tiles characters occupy, for createGrid: the tile under where each one
 * actually is. For most that is its own tile. A standing character who
 * steps up to furniture (STAND_CLOSER: Lars at the counter) occupies the
 * tile it stepped onto, which the furniture already blocks, so the tile it
 * stepped away from stays free and the player can stand right behind it
 * Seated characters share their tile with the seat,
 * which already blocks it; listing them too keeps the grid correct if a
 * seat is ever moved.
 * @param {{ characters: Array<{ id: string, col: number, row: number, facing: string, pose: string }> }} content
 * @param {import('./furniture.js').FurnitureLayout} layout
 * @returns {Array<{ col: number, row: number }>}
 * @throws {SeatingError} for a character whose place breaks the characters.json rules
 */
export function occupiedTiles(content, layout) {
  return content.characters.map((def) => occupiedTile(def, def.pose === 'stand' ? placeCharacter(def, layout) : null));
}

/**
 * The tile one character occupies (see occupiedTiles).
 * @param {{ col: number, row: number, pose: string }} def
 * @param {Placement | null} placement from placeCharacter; needed for a standing character
 * @returns {{ col: number, row: number }}
 */
export function occupiedTile(def, placement) {
  return def.pose === 'stand' && placement ? tileAt(placement.x, placement.z) : { col: def.col, row: def.row };
}
