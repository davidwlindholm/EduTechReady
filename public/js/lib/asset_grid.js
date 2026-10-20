// Pure layout helpers for the developer asset viewer. No three.js or DOM here.

export const GROUP_ORDER = ['character', 'furniture', 'prop'];

// Cell size (metres) and columns per kind, chosen so models at real size do not overlap.
export const GROUP_LAYOUT = {
  character: { cell: 1.6, columns: 8 },
  furniture: { cell: 3.6, columns: 5 },
  prop: { cell: 1.2, columns: 5 },
};

const GROUP_GAP = 1.2;

/**
 * Lay the models out in one block per kind, blocks stacked along +Z.
 * @param {Record<string, {kind: string}>} models manifest `models` object
 * @returns {{id: string, kind: string, x: number, z: number}[]} cell centres in metres
 */
export function layoutModels(models) {
  const placements = [];
  let zStart = 0;
  for (const kind of GROUP_ORDER) {
    const ids = Object.keys(models).filter((id) => models[id].kind === kind);
    if (ids.length === 0) continue;
    const { cell, columns } = GROUP_LAYOUT[kind];
    const rows = Math.ceil(ids.length / columns);
    ids.forEach((id, index) => {
      const col = index % columns;
      const row = Math.floor(index / columns);
      placements.push({ id, kind, x: col * cell, z: zStart + row * cell });
    });
    zStart += rows * cell + GROUP_GAP;
  }
  return placements;
}
