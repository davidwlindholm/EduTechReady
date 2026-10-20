// Keeps character labels from covering each other, and from covering the
// characters, on screen. Pure.

/**
 * @typedef {object} LabelBox
 * @property {string} id
 * @property {number} x centre, CSS pixels
 * @property {number} y centre, CSS pixels (down is positive)
 * @property {number} w width
 * @property {number} h height
 */

/** Share of its own width a label may slide sideways, so it stays over its character. */
export const MAX_SIDE_SHIFT = 0.4;

// Boxes that only touch at the gap do not overlap (EPSILON absorbs rounding).
const EPSILON = 1e-6;
const overlaps = (a, b, gap) => Math.abs(a.x - b.x) < (a.w + b.w) / 2 + gap - EPSILON
  && Math.abs(a.y - b.y) < (a.h + b.h) / 2 + gap - EPSILON;

/**
 * Offsets (in pixels) that move labels clear of each other and of the
 * characters' bodies. Labels nearest the viewer (lowest on screen) are
 * placed first. Each label takes the free position closest to where it
 * wants to be (sum of the horizontal and vertical move): it may slide
 * sideways by up to MAX_SIDE_SHIFT of its width, or move up, never down.
 * Moving up past the highest blocker is always free, so every label finds
 * a place. Ties are broken by id and by preferring the smaller upward move,
 * so the result is deterministic.
 * @param {LabelBox[]} boxes the labels where they want to be
 * @param {number} [gap] pixels kept between a label and anything else
 * @param {LabelBox[]} [obstacles] character bodies; an obstacle whose id
 *   matches a label's id is that label's own character and is not avoided
 * @returns {Map<string, { dx: number, dy: number }>} id -> offset (dy zero or negative)
 */
export function declutterLabels(boxes, gap = 2, obstacles = []) {
  const order = [...boxes].sort((a, b) => b.y - a.y || a.id.localeCompare(b.id));
  /** @type {LabelBox[]} */
  const placed = [];
  const shifts = new Map();
  for (const box of order) {
    const blockers = [...placed, ...obstacles.filter((o) => o.id !== box.id)];
    const maxDx = box.w * MAX_SIDE_SHIFT;
    // Candidate positions: where the label wants to be, or flush against a
    // side or the top of some blocker.
    const xs = [box.x];
    const ys = [box.y];
    for (const b of blockers) {
      const side = (b.w + box.w) / 2 + gap;
      for (const x of [b.x - side, b.x + side]) if (Math.abs(x - box.x) <= maxDx) xs.push(x);
      const above = b.y - (b.h + box.h) / 2 - gap;
      if (above < box.y) ys.push(above);
    }
    let best = null;
    for (const y of ys) {
      for (const x of xs) {
        const cost = Math.abs(x - box.x) + (box.y - y);
        if (best && (cost > best.cost || (cost === best.cost && y <= best.y))) continue;
        const candidate = { ...box, x, y };
        if (blockers.some((b) => overlaps(candidate, b, gap))) continue;
        best = { x, y, cost };
      }
    }
    // Unreachable: the candidate above the highest blocker is always free.
    if (!best) throw new Error(`no free place for label "${box.id}"`);
    placed.push({ ...box, x: best.x, y: best.y });
    shifts.set(box.id, { dx: best.x - box.x, dy: best.y - box.y });
  }
  return shifts;
}
