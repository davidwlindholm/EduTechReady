// Walkability grid: the level's walkable tiles minus tiles occupied by
// furniture or characters. Pure.

/**
 * @typedef {object} Grid
 * @property {number} cols
 * @property {number} rows
 * @property {(col: number, row: number) => boolean} isWalkable
 * @property {(col: number, row: number) => boolean} isBlocked true for an occupied tile
 */

/**
 * @param {Pick<import('./level.js').Level, 'cols' | 'rows' | 'isWalkable'>} level
 * @param {Iterable<{ col: number, row: number }>} [blocked] occupied tiles (furniture footprints, standing characters)
 * @returns {Grid}
 */
export function createGrid(level, blocked = []) {
  const occupied = new Set();
  for (const { col, row } of blocked) occupied.add(tileKey(col, row));
  const isBlocked = (col, row) => occupied.has(tileKey(col, row));
  return Object.freeze({
    cols: level.cols,
    rows: level.rows,
    isBlocked,
    isWalkable: (col, row) => level.isWalkable(col, row) && !isBlocked(col, row),
  });
}

/**
 * Tiles reachable on foot from `start`, as "col,row" keys (start included if walkable).
 *
 * Orthogonal flood fill. Pathfinding forbids diagonal moves that cut a blocked
 * corner, so a diagonal step is only possible when both orthogonal routes
 * around it are open: this reaches exactly the tiles 8-direction A* can reach.
 * @param {Pick<Grid, 'isWalkable'>} grid
 * @param {{ col: number, row: number }} start
 * @returns {Set<string>}
 */
export function reachableFrom(grid, start) {
  const seen = new Set();
  if (!grid.isWalkable(start.col, start.row)) return seen;
  seen.add(tileKey(start.col, start.row));
  const queue = [start];
  for (let i = 0; i < queue.length; i++) {
    const { col, row } = queue[i];
    for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const c = col + dc;
      const r = row + dr;
      const k = tileKey(c, r);
      if (!seen.has(k) && grid.isWalkable(c, r)) {
        seen.add(k);
        queue.push({ col: c, row: r });
      }
    }
  }
  return seen;
}

/** The key format used by reachableFrom. */
export function tileKey(col, row) {
  return `${col},${row}`;
}
