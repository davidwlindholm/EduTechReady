// Talking range: a conversation opens only when the player
// is within 1.5 m of where the character actually is (the tucked seat for a
// seated character, see placeCharacter in lib/seating.js). Facing them is not
// required. Pure: no three.js, no DOM.
import { canStep } from './pathfinding.js';
import { tileKey } from './grid.js';
import { tileCenter } from './movement.js';

/** Metres between the player and a character's position for a conversation. */
export const TALK_RANGE = 1.5;

// Rounding slack for distances and path costs.
const EPSILON = 1e-9;
const DIRECTIONS = Object.freeze([
  [1, 0], [-1, 0], [0, 1], [0, -1],
  [1, 1], [1, -1], [-1, 1], [-1, -1],
]);

/**
 * @param {{ x: number, z: number }} a
 * @param {{ x: number, z: number }} b
 */
export function distance(a, b) {
  return Math.hypot(a.x - b.x, a.z - b.z);
}

/**
 * Whether the player at `player` may talk to a character at `character`.
 * @param {{ x: number, z: number }} player
 * @param {{ x: number, z: number }} character
 * @param {number} [range]
 */
export function inTalkRange(player, character, range = TALK_RANGE) {
  return distance(player, character) <= range + EPSILON;
}

/**
 * Walking cost (tiles, diagonals √2) from `start` to every tile reachable
 * from it, with the same moves as A* in lib/pathfinding.js (8 directions,
 * no cut corners), so a cost here is the length findPath walks.
 * @param {Pick<import('./grid.js').Grid, 'cols' | 'rows' | 'isWalkable'>} grid
 * @param {{ col: number, row: number }} start
 * @returns {Map<string, number>} tileKey -> cost; the start costs 0
 */
export function walkCosts(grid, start) {
  const costs = new Map([[tileKey(start.col, start.row), 0]]);
  const open = [{ col: start.col, row: start.row, cost: 0 }];
  while (open.length) {
    // The grid is small (a few hundred tiles), so a linear minimum is enough.
    let best = 0;
    for (let i = 1; i < open.length; i++) if (open[i].cost < open[best].cost) best = i;
    const node = open[best];
    open[best] = open[open.length - 1];
    open.pop();
    if (node.cost > costs.get(tileKey(node.col, node.row)) + EPSILON) continue; // stale entry
    for (const [dc, dr] of DIRECTIONS) {
      if (!canStep(grid, node.col, node.row, dc, dr)) continue;
      const col = node.col + dc;
      const row = node.row + dr;
      const cost = node.cost + (dc !== 0 && dr !== 0 ? Math.SQRT2 : 1);
      const key = tileKey(col, row);
      if (costs.has(key) && costs.get(key) <= cost + EPSILON) continue;
      costs.set(key, cost);
      open.push({ col, row, cost });
    }
  }
  return costs;
}

// Unit vector each facing points along (N = -Z, S = +Z, E = +X, W = -X).
const FACING_VECTORS = Object.freeze({ N: [0, -1], S: [0, 1], E: [1, 0], W: [-1, 0] });
// A tile whose direction from the character is within this angle of straight
// behind it is "at its back" (a 90 degree sector).
const BACK_HALF_ANGLE = Math.PI / 4;

/**
 * Whether a point lies in the sector behind a character facing `facing`.
 * @param {{ x: number, z: number }} point
 * @param {{ x: number, z: number }} character
 * @param {'N' | 'S' | 'E' | 'W'} facing
 */
export function isBehind(point, character, facing) {
  const vector = FACING_VECTORS[facing];
  if (!vector) return false;
  const dx = point.x - character.x;
  const dz = point.z - character.z;
  const d = Math.hypot(dx, dz);
  if (d < EPSILON) return false;
  // Dot product with the back direction (minus the facing), over the distance.
  return -(dx * vector[0] + dz * vector[1]) / d > Math.cos(BACK_HALF_ANGLE) + EPSILON;
}

/**
 * The tile the player walks to before talking to a character: among the
 * tiles reachable from `start` whose centre is within `range` of the
 * character, the one with the shortest walk; ties go to the tile nearest the
 * character, then the lower row, then the lower column (deterministic).
 * With the character's `facing`, tiles at its back (isBehind) count only
 * when no other tile in range is reachable, so the player does not talk to
 * someone's back when it can stand beside them (the tile right behind Lars
 * is walkable).
 * @param {Pick<import('./grid.js').Grid, 'cols' | 'rows' | 'isWalkable'>} grid
 * @param {{ col: number, row: number }} start the player's tile
 * @param {{ x: number, z: number, facing?: 'N' | 'S' | 'E' | 'W' }} character where the character is, in metres, and which way it faces
 * @param {number} [range]
 * @returns {{ col: number, row: number, cost: number } | null} null when no such tile is reachable
 */
export function chooseTalkTile(grid, start, character, range = TALK_RANGE) {
  const costs = walkCosts(grid, start);
  let best = null;
  const reach = Math.ceil(range) + 1;
  const col0 = Math.floor(character.x);
  const row0 = Math.floor(character.z);
  for (let row = row0 - reach; row <= row0 + reach; row++) {
    for (let col = col0 - reach; col <= col0 + reach; col++) {
      const cost = costs.get(tileKey(col, row));
      if (cost === undefined) continue;
      const d = distance(tileCenter(col, row), character);
      if (d > range + EPSILON) continue;
      const back = character.facing ? isBehind(tileCenter(col, row), character, character.facing) : false;
      const candidate = { col, row, cost, d, back };
      if (!best || isBetter(candidate, best)) best = candidate;
    }
  }
  return best && { col: best.col, row: best.row, cost: best.cost };
}

function isBetter(a, b) {
  if (a.back !== b.back) return !a.back;
  if (Math.abs(a.cost - b.cost) > EPSILON) return a.cost < b.cost;
  if (Math.abs(a.d - b.d) > EPSILON) return a.d < b.d;
  return a.row !== b.row ? a.row < b.row : a.col < b.col;
}

/**
 * Which nameplates show: a character's nameplate shows while
 * the mouse hovers that character (or its visible nameplate), and while the
 * player is within talking range, so a nameplate that shows without hovering
 * means "you can talk now".
 * @param {Map<string, { x: number, z: number }>} places character id -> position in metres
 * @param {{ x: number, z: number }} player the player's position in metres
 * @param {readonly string[]} [hovered] ids under the mouse
 * @param {number} [range]
 * @param {Set<string>} [out] filled in place (cleared first), so a caller
 *   running this every frame need not allocate a new set
 * @returns {Set<string>} ids whose nameplate shows (`out` when given)
 */
export function visibleNameplates(places, player, hovered = [], range = TALK_RANGE, out = new Set()) {
  out.clear();
  for (const [id, place] of places) {
    if (hovered.includes(id) || inTalkRange(player, place, range)) out.add(id);
  }
  return out;
}
