// Level model: parses and validates level.json into tile types,
// walkability and wall heights per the cutaway rule. Pure.

/** The fixed legend: every level.json must use exactly these keys. */
export const LEGEND = Object.freeze({
  '#': 'wall',
  W: 'window',
  G: 'glass',
  D: 'door_open',
  d: 'door_closed',
  '.': 'floor',
  h: 'floor_hallway',
  _: 'void',
});

export const TILE_TYPES = Object.freeze([...new Set(Object.values(LEGEND))]);
const WALKABLE_TYPES = new Set(['floor', 'floor_hallway', 'door_open']);
const WALL_TYPES = new Set(['wall', 'window', 'glass', 'door_open', 'door_closed']);
const FACINGS = new Set(['N', 'E', 'S', 'W']);

export const FULL_WALL_HEIGHT = 2.4;
export const NEAR_WALL_HEIGHT = 0.3;

/** Thrown for any level.json that breaks the level rules. */
export class LevelError extends Error {
  constructor(message) {
    super(`level.json: ${message}`);
    this.name = 'LevelError';
  }
}

export function isWalkableType(type) {
  return WALKABLE_TYPES.has(type);
}

export function isWallType(type) {
  return WALL_TYPES.has(type);
}

/**
 * @typedef {object} Level
 * @property {number} cols
 * @property {number} rows
 * @property {{ col: number, row: number, facing: string }} playerStart
 * @property {object[]} furniture raw entries (validated in lib/furniture.js)
 * @property {object[]} props raw entries
 * @property {(col: number, row: number) => string} typeAt tile type; 'void' outside the map
 * @property {(col: number, row: number) => boolean} isWalkable from the tile type only
 * @property {(col: number, row: number) => boolean} isWall
 * @property {(col: number, row: number) => ('full' | 'near' | null)} wallHeight cutaway rule; null for non-wall tiles
 * @property {(col: number, row: number) => { x: boolean, z: boolean }} wallAxes axes on which a wall tile has a wall-type neighbour
 */

/**
 * @param {unknown} data parsed level.json
 * @returns {Level}
 * @throws {LevelError}
 */
export function parseLevel(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new LevelError('must be an object');
  const legend = parseLegend(data.legend);
  const { rows: rowStrings } = data;
  if (!Array.isArray(rowStrings) || rowStrings.length === 0) throw new LevelError('"rows" must be a non-empty array');
  if (rowStrings.some((r) => typeof r !== 'string')) throw new LevelError('every row must be a string');
  const cols = [...rowStrings[0]].length;
  if (cols === 0) throw new LevelError('rows must not be empty');

  const tiles = rowStrings.map((line, row) => {
    const chars = [...line];
    if (chars.length !== cols) {
      throw new LevelError(`row ${row} has ${chars.length} tiles, row 0 has ${cols}`);
    }
    return chars.map((ch, col) => {
      if (!Object.prototype.hasOwnProperty.call(legend, ch)) {
        throw new LevelError(`row ${row}, col ${col}: character "${ch}" is not in the legend`);
      }
      return legend[ch];
    });
  });
  const rows = tiles.length;

  const typeAt = (col, row) => {
    if (!Number.isInteger(col) || !Number.isInteger(row) || col < 0 || row < 0 || col >= cols || row >= rows) {
      return 'void';
    }
    return tiles[row][col];
  };
  const isWalkable = (col, row) => isWalkableType(typeAt(col, row));
  const isWall = (col, row) => isWallType(typeAt(col, row));

  // Cutaway rule: full height if the tile to the south, east or
  // south-east is walkable; otherwise a near wall.
  const wallHeight = (col, row) => {
    if (!isWall(col, row)) return null;
    const full = isWalkable(col, row + 1) || isWalkable(col + 1, row) || isWalkable(col + 1, row + 1);
    return full ? 'full' : 'near';
  };
  const wallAxes = (col, row) => ({
    x: isWall(col, row) && (isWall(col - 1, row) || isWall(col + 1, row)),
    z: isWall(col, row) && (isWall(col, row - 1) || isWall(col, row + 1)),
  });

  const playerStart = parsePlayerStart(data.playerStart, isWalkable);
  const furniture = optionalArray(data.furniture, 'furniture');
  const props = optionalArray(data.props, 'props');

  return Object.freeze({
    cols, rows, playerStart, furniture, props, typeAt, isWalkable, isWall, wallHeight, wallAxes,
  });
}

function parseLegend(legend) {
  if (!legend || typeof legend !== 'object' || Array.isArray(legend)) throw new LevelError('"legend" must be an object');
  for (const [ch, type] of Object.entries(legend)) {
    if ([...ch].length !== 1) throw new LevelError(`legend key "${ch}" must be one character`);
    if (LEGEND[ch] !== type) throw new LevelError(`legend "${ch}": "${type}" differs from the fixed legend`);
  }
  // The legend is fixed: every key must be present, not just the ones used.
  for (const ch of Object.keys(LEGEND)) {
    if (!Object.prototype.hasOwnProperty.call(legend, ch)) throw new LevelError(`legend is missing "${ch}" (${LEGEND[ch]}) from the fixed legend`);
  }
  return legend;
}

function parsePlayerStart(start, isWalkable) {
  if (!start || typeof start !== 'object') throw new LevelError('"playerStart" is missing');
  const { col, row, facing } = start;
  if (!Number.isInteger(col) || !Number.isInteger(row)) throw new LevelError('playerStart col and row must be integers');
  if (!FACINGS.has(facing)) throw new LevelError(`playerStart facing "${facing}" must be N, E, S or W`);
  if (!isWalkable(col, row)) throw new LevelError(`playerStart (${col}, ${row}) is not a walkable tile`);
  return Object.freeze({ col, row, facing });
}

function optionalArray(value, name) {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new LevelError(`"${name}" must be an array`);
  return value;
}
