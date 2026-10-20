// Tile and movement maths. Pure.

export const WALK_SPEED = 1.4; // metres per second
export const TURN_SPEED = 12; // radians per second

/** rotation.y for a model facing +Z (N = -Z, S = +Z, E = +X, W = -X) */
export const FACING_ROTATION = Object.freeze({ S: 0, E: Math.PI / 2, N: Math.PI, W: -Math.PI / 2 });

/**
 * @param {string} facing N, E, S or W
 * @returns {number}
 */
export function facingToRotation(facing) {
  if (!Object.prototype.hasOwnProperty.call(FACING_ROTATION, facing)) {
    throw new RangeError(`unknown facing ${facing}`);
  }
  return FACING_ROTATION[facing];
}

/** World position of a tile centre on the floor. */
export function tileCenter(col, row) {
  return { x: col + 0.5, z: row + 0.5 };
}

/** The tile containing a world point. */
export function tileAt(x, z) {
  return { col: Math.floor(x), row: Math.floor(z) };
}

/** rotation.y that makes a +Z-facing model face along (dx, dz). */
export function headingOf(dx, dz) {
  return Math.atan2(dx, dz);
}

/** Wrap an angle to (-π, π]. */
export function wrapAngle(angle) {
  let a = angle % (2 * Math.PI);
  if (a > Math.PI) a -= 2 * Math.PI;
  if (a <= -Math.PI) a += 2 * Math.PI;
  return a;
}

/**
 * Turn from `current` toward `target` the short way round by at most `maxStep`.
 * @returns {number} the new angle, wrapped
 */
export function turnToward(current, target, maxStep) {
  const delta = wrapAngle(target - current);
  if (Math.abs(delta) <= maxStep) return wrapAngle(target);
  return wrapAngle(current + Math.sign(delta) * maxStep);
}

// Corner smoothing: each bend in a tile-centre path becomes a short
// quadratic curve. The curve stays inside the bend's own tile (radius below
// half a tile), so it never cuts into a blocked neighbour.
export const CORNER_RADIUS = 0.35; // metres
const CORNER_SEGMENTS = 6;
const COLLINEAR = 1e-6;

/**
 * Replace every bend of a polyline with a quadratic curve through sampled points.
 * The first and last points are kept exactly.
 * @param {{ x: number, z: number }[]} points
 * @param {number} [radius] how far before and after each bend the curve starts,
 *   capped at half of either adjacent segment
 * @returns {{ x: number, z: number }[]}
 */
export function smoothCorners(points, radius = CORNER_RADIUS) {
  if (points.length < 3) return points.map((p) => ({ x: p.x, z: p.z }));
  const out = [{ x: points[0].x, z: points[0].z }];
  for (let i = 1; i < points.length - 1; i++) {
    const prev = points[i - 1];
    const cur = points[i];
    const next = points[i + 1];
    const inLen = Math.hypot(cur.x - prev.x, cur.z - prev.z);
    const outLen = Math.hypot(next.x - cur.x, next.z - cur.z);
    if (inLen < COLLINEAR || outLen < COLLINEAR) continue; // duplicate point
    const ix = (cur.x - prev.x) / inLen;
    const iz = (cur.z - prev.z) / inLen;
    const ox = (next.x - cur.x) / outLen;
    const oz = (next.z - cur.z) / outLen;
    if (Math.abs(ix * oz - iz * ox) < COLLINEAR && ix * ox + iz * oz > 0) {
      out.push({ x: cur.x, z: cur.z }); // straight on
      continue;
    }
    const r = Math.min(radius, inLen / 2, outLen / 2);
    const a = { x: cur.x - ix * r, z: cur.z - iz * r };
    const b = { x: cur.x + ox * r, z: cur.z + oz * r };
    for (let s = 0; s <= CORNER_SEGMENTS; s++) {
      const t = s / CORNER_SEGMENTS;
      const u = 1 - t;
      out.push({
        x: u * u * a.x + 2 * u * t * cur.x + t * t * b.x,
        z: u * u * a.z + 2 * u * t * cur.z + t * t * b.z,
      });
    }
  }
  const last = points[points.length - 1];
  out.push({ x: last.x, z: last.z });
  return out;
}

/**
 * Move along a polyline by `distance`.
 * @param {{ x: number, z: number }[]} route
 * @param {number} index the route point currently walked toward
 * @param {{ x: number, z: number }} pos current position
 * @param {number} distance metres to cover this frame
 * @returns {{ x: number, z: number, index: number, arrived: boolean, dx: number, dz: number }}
 *   the new position, the next point index, whether the last point was reached,
 *   and the direction of the last stretch moved (zero if none)
 */
export function followRoute(route, index, pos, distance) {
  let x = pos.x;
  let z = pos.z;
  let dx = 0;
  let dz = 0;
  let i = index;
  let left = distance;
  while (i < route.length) {
    const p = route[i];
    const ex = p.x - x;
    const ez = p.z - z;
    const d = Math.hypot(ex, ez);
    if (d > 1e-9) {
      dx = ex;
      dz = ez;
    }
    if (d > left) {
      x += (ex / d) * left;
      z += (ez / d) * left;
      return { x, z, index: i, arrived: false, dx, dz };
    }
    x = p.x;
    z = p.z;
    left -= d;
    i++;
  }
  return { x, z, index: i, arrived: true, dx, dz };
}
