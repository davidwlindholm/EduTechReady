// Where a click on the floor sends the player. Pure: no three.js, no DOM.
//
// A click on a reachable tile walks to it. A click on a tile the player
// cannot stand on (furniture, a wall, a character's tile) walks to the
// reachable tile whose centre is nearest the clicked point, not the clicked
// tile's centre: a click on the floor just behind Karim's chair goes to the
// tile behind him, not to one beside him.
import { tileKey } from './grid.js';
import { tileAt, tileCenter } from './movement.js';
import { walkCosts } from './talk.js';

// Rounding slack for distances and path costs.
const EPSILON = 1e-9;

/**
 * @param {Pick<import('./grid.js').Grid, 'cols' | 'rows' | 'isWalkable'>} grid
 * @param {{ col: number, row: number }} start the player's tile
 * @param {{ x: number, z: number }} point the clicked floor point, in metres
 * @returns {{ col: number, row: number }} the tile to walk to; ties go to the
 *   shorter walk, then the lower row, then the lower column (the same order as
 *   findPath's closest tile, so a click on a tile centre picks what it did before)
 */
export function floorClickTarget(grid, start, point) {
  const costs = walkCosts(grid, start);
  const clicked = tileAt(point.x, point.z);
  if (costs.has(tileKey(clicked.col, clicked.row))) return clicked;
  let best = null;
  for (const [key, cost] of costs) {
    const [col, row] = key.split(',').map(Number);
    const d = Math.hypot(tileCenter(col, row).x - point.x, tileCenter(col, row).z - point.z);
    const candidate = { col, row, cost, d };
    if (!best || isBetter(candidate, best)) best = candidate;
  }
  return { col: best.col, row: best.row };
}

function isBetter(a, b) {
  if (Math.abs(a.d - b.d) > EPSILON) return a.d < b.d;
  if (Math.abs(a.cost - b.cost) > EPSILON) return a.cost < b.cost;
  return a.row !== b.row ? a.row < b.row : a.col < b.col;
}
