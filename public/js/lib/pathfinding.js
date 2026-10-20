// A* on the walkable grid. Pure: no three.js, no DOM.
import { tileKey } from './grid.js';
//
// - 8 directions with the octile heuristic: orthogonal steps cost 1, diagonal
//   steps cost √2.
// - A diagonal step may not cut a blocked corner: both orthogonal neighbours
//   it passes between must be walkable.
// - An unreachable target (blocked, outside the map or walled off) sends the
//   walker to the reachable tile closest to it in straight-line distance
//   between tile centres; ties go to the shorter path, then to the lower row,
//   then to the lower column, so the result is deterministic.
// - The returned path excludes the start tile. Start equals goal gives an
//   empty path.

const SQRT2 = Math.SQRT2;
const EPSILON = 1e-9;

/** The eight neighbour offsets: orthogonal first, then diagonal. */
const DIRECTIONS = Object.freeze([
  [1, 0], [-1, 0], [0, 1], [0, -1],
  [1, 1], [1, -1], [-1, 1], [-1, -1],
]);

/**
 * @typedef {object} PathResult
 * @property {{ col: number, row: number }[]} path tiles to walk, start excluded, goal last;
 *   empty when the walker already stands on the goal
 * @property {{ col: number, row: number }} goal the tile the path ends on: the
 *   target itself when reachable, otherwise the closest reachable tile
 * @property {boolean} reached true when the goal is the requested target
 * @property {number} length path length in tiles (diagonals count √2)
 */

/** Octile distance between two tiles: the exact cost of a free 8-direction path. */
export function octile(a, b) {
  const dx = Math.abs(a.col - b.col);
  const dz = Math.abs(a.row - b.row);
  return Math.max(dx, dz) + (SQRT2 - 1) * Math.min(dx, dz);
}

/**
 * Whether a single step from (col, row) by (dc, dr) is allowed: the
 * destination is walkable and, for a diagonal, no blocked corner is cut.
 * @param {Pick<import('./grid.js').Grid, 'isWalkable'>} grid
 */
export function canStep(grid, col, row, dc, dr) {
  if (!grid.isWalkable(col + dc, row + dr)) return false;
  if (dc !== 0 && dr !== 0) {
    return grid.isWalkable(col + dc, row) && grid.isWalkable(col, row + dr);
  }
  return true;
}

/**
 * @param {Pick<import('./grid.js').Grid, 'cols' | 'rows' | 'isWalkable'>} grid
 * @param {{ col: number, row: number }} start the walker's tile; it need not be walkable itself
 * @param {{ col: number, row: number }} target any tile, inside the map or not
 * @returns {PathResult}
 */
export function findPath(grid, start, target) {
  const s = { col: start.col, row: start.row };
  const t = { col: target.col, row: target.row };
  if (s.col === t.col && s.row === t.row) return { path: [], goal: s, reached: true, length: 0 };
  if (grid.isWalkable(t.col, t.row)) {
    const search = runSearch(grid, s, t);
    const node = search.nodes.get(tileKey(t.col, t.row));
    if (node?.closed) return result(search, node, true);
    // Walkable but cut off: the full search already holds every reachable tile.
    return closest(search, t);
  }
  return closest(runSearch(grid, s, null), t);
}

/**
 * A* toward `target`, or Dijkstra over every reachable tile when `target` is
 * null (or turns out to be unreachable, in which case the search exhausts).
 */
function runSearch(grid, start, target) {
  /** @type {Map<string, { col: number, row: number, g: number, parent: object | null, closed: boolean }>} */
  const nodes = new Map();
  const heap = new MinHeap();
  const startNode = { col: start.col, row: start.row, g: 0, parent: null, closed: false };
  nodes.set(tileKey(start.col, start.row), startNode);
  heap.push(startNode, target ? octile(start, target) : 0);
  while (heap.size) {
    const node = heap.pop();
    if (node.closed) continue; // a stale heap entry, superseded by a cheaper one
    node.closed = true;
    if (target && node.col === target.col && node.row === target.row) break;
    for (const [dc, dr] of DIRECTIONS) {
      if (!canStep(grid, node.col, node.row, dc, dr)) continue;
      const col = node.col + dc;
      const row = node.row + dr;
      const g = node.g + (dc !== 0 && dr !== 0 ? SQRT2 : 1);
      const k = tileKey(col, row);
      let next = nodes.get(k);
      if (next?.closed) continue;
      if (next && next.g <= g + EPSILON) continue;
      if (!next) {
        next = { col, row, g, parent: node, closed: false };
        nodes.set(k, next);
      } else {
        next.g = g;
        next.parent = node;
      }
      heap.push(next, g + (target ? octile(next, target) : 0));
    }
  }
  return { nodes };
}

/** The settled tile nearest the target: straight-line distance, then path length, then row, then col. */
function closest(search, target) {
  let best = null;
  let bestD2 = Infinity;
  for (const node of search.nodes.values()) {
    if (!node.closed) continue;
    const d2 = (node.col - target.col) ** 2 + (node.row - target.row) ** 2; // exact in integers
    if (d2 < bestD2 || (d2 === bestD2 && better(node, best))) {
      best = node;
      bestD2 = d2;
    }
  }
  return result(search, best, false);
}

/** Tie-break between two tiles at the same distance from the target. */
function better(a, b) {
  if (Math.abs(a.g - b.g) > EPSILON) return a.g < b.g;
  if (a.row !== b.row) return a.row < b.row;
  return a.col < b.col;
}

function result(search, node, reached) {
  const path = [];
  for (let n = node; n.parent; n = n.parent) path.push({ col: n.col, row: n.row });
  path.reverse();
  return { path, goal: { col: node.col, row: node.row }, reached, length: node.g };
}

/** Binary min-heap of nodes keyed by priority; insertion order breaks ties. */
class MinHeap {
  constructor() {
    this.items = [];
    this.counter = 0;
  }

  get size() {
    return this.items.length;
  }

  push(node, priority) {
    const items = this.items;
    items.push({ node, priority, order: this.counter++ });
    let i = items.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (!less(items[i], items[parent])) break;
      [items[i], items[parent]] = [items[parent], items[i]];
      i = parent;
    }
  }

  pop() {
    const items = this.items;
    const top = items[0];
    const last = items.pop();
    if (items.length) {
      items[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < items.length && less(items[l], items[m])) m = l;
        if (r < items.length && less(items[r], items[m])) m = r;
        if (m === i) break;
        [items[i], items[m]] = [items[m], items[i]];
        i = m;
      }
    }
    return top.node;
  }
}

function less(a, b) {
  if (Math.abs(a.priority - b.priority) > EPSILON) return a.priority < b.priority;
  return a.order < b.order;
}
