// Room geometry from the level model: floor, wall slabs at full or
// near height (cutaway rule), windows, glass walls and doors.
//
// Draw calls are kept low by merging: one floor mesh, one mesh for every
// opaque wall part (colours per vertex) and one mesh for all glass.
import { THREE, mergeGeometries } from './three.js';
import { THEME } from './theme.js';
import { FULL_WALL_HEIGHT, NEAR_WALL_HEIGHT } from '../lib/level.js';
import { disposeObject } from './dispose.js';

const COLORS = THEME.room;

// Dimensions in metres.
export const WALL_THICKNESS = 0.2;
const HALF = WALL_THICKNESS / 2;
const SILL_HEIGHT = 0.9;
const SILL_BOARD = { thickness: 0.06, depth: 0.28 };
const WINDOW_TOP = 2.15; // underside of the wall above a window
const FRAME_WIDTH = 0.06; // posts and rails seen face-on
const FRAME_DEPTH = 0.1;
const GLASS_THICKNESS = 0.02;
const GLASS_RAIL = 0.08; // bottom and top rails of a glass wall
const TRANSOM_HEIGHT = 2.1;
const DOOR = { height: 2.05, post: 0.08, panelThickness: 0.04, panelWidth: 0.82, panelFrame: 0.05 };

// Floor texture: one canvas covers PLANK_TILE_METRES square; planks run along Z.
const PLANK_TILE_METRES = 2;
const PLANKS_PER_TILE = 10;
const TEXTURE_SIZE = 512;
const FLOOR_Y = 0; // floor top sits at y = 0

/**
 * Collects axis-aligned boxes with per-vertex colours and merges them.
 * Top faces can get their own colour (the cut tops of walls).
 */
export class BoxBatch {
  constructor() {
    /** @type {THREE.BufferGeometry[]} */
    this.parts = [];
    this.color = new THREE.Color();
    this.top = new THREE.Color();
  }

  /**
   * @param {{ x0: number, x1: number, y0: number, y1: number, z0: number, z1: number }} b world bounds
   * @param {number} color hex colour for side and bottom faces
   * @param {number} [topColor] hex colour for the top face
   */
  add(b, color, topColor = color) {
    const w = b.x1 - b.x0;
    const h = b.y1 - b.y0;
    const d = b.z1 - b.z0;
    if (w <= 0 || h <= 0 || d <= 0) return;
    const geometry = new THREE.BoxGeometry(w, h, d);
    geometry.translate((b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2, (b.z0 + b.z1) / 2);
    this.color.set(color);
    this.top.set(topColor);
    const normals = geometry.getAttribute('normal');
    const colors = new Float32Array(normals.count * 3);
    for (let i = 0; i < normals.count; i++) {
      const c = normals.getY(i) > 0.5 ? this.top : this.color;
      colors.set([c.r, c.g, c.b], i * 3);
    }
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    this.parts.push(geometry);
  }

  /** @returns {THREE.BufferGeometry | null} the merged geometry (inputs are disposed) */
  build() {
    if (!this.parts.length) return null;
    const merged = mergeGeometries(this.parts, false);
    this.parts.forEach((g) => g.dispose());
    this.parts = [];
    if (!merged) throw new Error('room: could not merge wall geometry');
    return merged;
  }
}

/**
 * Bounds of a box running along a tile's wall axis.
 * u0..u1 run across the tile along the axis (0 = west or north edge),
 * the thickness is centred on the tile's centre line (shifted by `offset`).
 */
function along(axis, col, row, u0, u1, y0, y1, thickness, offset = 0) {
  const centreX = col + 0.5 + offset;
  const centreZ = row + 0.5 + offset;
  return axis === 'x'
    ? { x0: col + u0, x1: col + u1, y0, y1, z0: centreZ - thickness / 2, z1: centreZ + thickness / 2 }
    : { x0: centreX - thickness / 2, x1: centreX + thickness / 2, y0, y1, z0: row + u0, z1: row + u1 };
}

/** Neighbour tiles before and after a tile along an axis. */
function axisNeighbours(axis, col, row) {
  return axis === 'x'
    ? { before: [col - 1, row], after: [col + 1, row] }
    : { before: [col, row - 1], after: [col, row + 1] };
}

/**
 * A plain wall slab (or the low version of any wall-type tile): slabs along
 * each axis with a wall-type neighbour, with a corner piece where axes meet.
 */
function addSlab(batch, level, col, row, height, color, topColor) {
  const axes = level.wallAxes(col, row);
  const wall = (c, r) => level.isWall(c, r);
  const corner = 0.5 - HALF;
  if (axes.x && axes.z) {
    batch.add(along('x', col, row, corner, 1 - corner, 0, height, WALL_THICKNESS), color, topColor);
    if (wall(col - 1, row)) batch.add(along('x', col, row, 0, corner, 0, height, WALL_THICKNESS), color, topColor);
    if (wall(col + 1, row)) batch.add(along('x', col, row, 1 - corner, 1, 0, height, WALL_THICKNESS), color, topColor);
    if (wall(col, row - 1)) batch.add(along('z', col, row, 0, corner, 0, height, WALL_THICKNESS), color, topColor);
    if (wall(col, row + 1)) batch.add(along('z', col, row, 1 - corner, 1, 0, height, WALL_THICKNESS), color, topColor);
    return;
  }
  if (!axes.x && !axes.z) {
    // A lone wall tile: a square post.
    batch.add(along('x', col, row, corner, 1 - corner, 0, height, WALL_THICKNESS), color, topColor);
    return;
  }
  const axis = axes.x ? 'x' : 'z';
  const { before, after } = axisNeighbours(axis, col, row);
  const u0 = wall(...before) ? 0 : corner;
  const u1 = wall(...after) ? 1 : 1 - corner;
  batch.add(along(axis, col, row, u0, u1, 0, height, WALL_THICKNESS), color, topColor);
}

/** Vertical frame posts at the start edge, and at the end edge when the next tile is a different type. */
function addPosts(batch, level, axis, col, row, y0, y1, width = FRAME_WIDTH) {
  batch.add(along(axis, col, row, 0, width, y0, y1, FRAME_DEPTH), COLORS.frame);
  const { after } = axisNeighbours(axis, col, row);
  if (level.typeAt(...after) !== level.typeAt(col, row)) {
    batch.add(along(axis, col, row, 1 - width, 1, y0, y1, FRAME_DEPTH), COLORS.frame);
  }
}

function addWindow(solid, glass, level, axis, col, row) {
  const H = FULL_WALL_HEIGHT;
  // The wall below stops under the sill board, so no two top faces share y = SILL_HEIGHT (z-fighting).
  const sillBottom = SILL_HEIGHT - SILL_BOARD.thickness;
  solid.add(along(axis, col, row, 0, 1, 0, sillBottom, WALL_THICKNESS), COLORS.wall);
  solid.add(along(axis, col, row, 0, 1, sillBottom, SILL_HEIGHT, SILL_BOARD.depth), COLORS.sill);
  solid.add(along(axis, col, row, 0, 1, WINDOW_TOP, H, WALL_THICKNESS), COLORS.wall, COLORS.wallTop);
  solid.add(along(axis, col, row, 0, 1, SILL_HEIGHT, SILL_HEIGHT + FRAME_WIDTH, FRAME_DEPTH), COLORS.frame);
  solid.add(along(axis, col, row, 0, 1, WINDOW_TOP - FRAME_WIDTH, WINDOW_TOP, FRAME_DEPTH), COLORS.frame);
  addPosts(solid, level, axis, col, row, SILL_HEIGHT, WINDOW_TOP);
  glass.add(along(axis, col, row, 0, 1, SILL_HEIGHT + FRAME_WIDTH, WINDOW_TOP - FRAME_WIDTH, GLASS_THICKNESS), COLORS.glass);
}

function addGlassWall(solid, glass, level, axis, col, row) {
  const H = FULL_WALL_HEIGHT;
  solid.add(along(axis, col, row, 0, 1, 0, GLASS_RAIL, FRAME_DEPTH), COLORS.frame);
  solid.add(along(axis, col, row, 0, 1, H - GLASS_RAIL, H, FRAME_DEPTH), COLORS.frame);
  solid.add(along(axis, col, row, 0, 1, TRANSOM_HEIGHT - FRAME_WIDTH / 2, TRANSOM_HEIGHT + FRAME_WIDTH / 2, FRAME_DEPTH), COLORS.frame);
  addPosts(solid, level, axis, col, row, 0, H);
  glass.add(along(axis, col, row, 0, 1, GLASS_RAIL, H - GLASS_RAIL, GLASS_THICKNESS), COLORS.glass);
}

/** Door frame: two posts, plus the wall or glass above the door. */
function addDoorFrame(solid, glass, level, axis, col, row) {
  const H = FULL_WALL_HEIGHT;
  solid.add(along(axis, col, row, 0, DOOR.post, 0, DOOR.height, FRAME_DEPTH + 0.02), COLORS.frame);
  solid.add(along(axis, col, row, 1 - DOOR.post, 1, 0, DOOR.height, FRAME_DEPTH + 0.02), COLORS.frame);
  solid.add(along(axis, col, row, 0, 1, DOOR.height, DOOR.height + FRAME_WIDTH, FRAME_DEPTH + 0.02), COLORS.frame);
  const { before, after } = axisNeighbours(axis, col, row);
  const inGlass = level.typeAt(...before) === 'glass' || level.typeAt(...after) === 'glass';
  if (inGlass) {
    solid.add(along(axis, col, row, 0, 1, H - GLASS_RAIL, H, FRAME_DEPTH), COLORS.frame);
    glass.add(along(axis, col, row, 0, 1, DOOR.height + FRAME_WIDTH, H - GLASS_RAIL, GLASS_THICKNESS), COLORS.glass);
  } else {
    solid.add(along(axis, col, row, 0, 1, DOOR.height + FRAME_WIDTH, H, WALL_THICKNESS), COLORS.wall, COLORS.wallTop);
  }
}

/** Side of a door tile (+1 or -1 across the axis) that faces the lounge floor. */
function loungeSide(level, axis, col, row) {
  const [c1, r1] = axis === 'x' ? [col, row + 1] : [col + 1, row];
  const [c0, r0] = axis === 'x' ? [col, row - 1] : [col - 1, row];
  if (level.typeAt(c1, r1) === 'floor') return 1;
  if (level.typeAt(c0, r0) === 'floor') return -1;
  return level.isWalkable(c1, r1) ? 1 : -1;
}

/**
 * Open door: a glazed panel turned 90 degrees on its hinge (the end post) so
 * that it stands across the axis, swung into the lounge.
 */
function addOpenDoor(solid, glass, level, axis, col, row) {
  addDoorFrame(solid, glass, level, axis, col, row);
  const side = loungeSide(level, axis, col, row);
  const hinge = 1 - DOOR.post - DOOR.panelThickness / 2; // u of the panel's plane, beside the end post
  const across = axis === 'x' ? 'z' : 'x';
  // In the turned panel, "u" runs across the original axis from the wall centre line outward.
  const reach = (from, to) => {
    const a = 0.5 + side * from;
    const b = 0.5 + side * to;
    return [Math.min(a, b), Math.max(a, b)];
  };
  // Offset moves the panel's thin plane to the hinge position along the original axis.
  const offset = hinge - 0.5;
  const part = (from, to, y0, y1, thickness) => {
    const [u0, u1] = reach(from, to);
    return along(across, col, row, u0, u1, y0, y1, thickness, offset);
  };
  const w = DOOR.panelWidth;
  const f = DOOR.panelFrame;
  const t = DOOR.panelThickness;
  solid.add(part(HALF, HALF + f, 0, DOOR.height, t), COLORS.frame);
  solid.add(part(HALF + w - f, HALF + w, 0, DOOR.height, t), COLORS.frame);
  solid.add(part(HALF, HALF + w, 0, f * 2, t), COLORS.frame);
  solid.add(part(HALF, HALF + w, DOOR.height - f, DOOR.height, t), COLORS.frame);
  solid.add(part(HALF + w - f * 0.4, HALF + w - f * 0.1, 0.95, 1.1, t + 0.06), COLORS.doorPanel); // handle
  glass.add(part(HALF + f, HALF + w - f, f * 2, DOOR.height - f, GLASS_THICKNESS), COLORS.glass);
}

/**
 * Closed door: the frame joins the wall mesh; the panel and its handle get
 * their own mesh on a hinge (`doors`), so the panel can swing open (the
 * easter egg in alienDoor.js). The hinge is the start post; the panel opens 90
 * degrees toward the walkable side.
 */
function addClosedDoor(solid, glass, level, axis, col, row, doors) {
  addDoorFrame(solid, glass, level, axis, col, row);
  const panel = new BoxBatch();
  panel.add(along(axis, col, row, DOOR.post, 1 - DOOR.post, 0, DOOR.height, DOOR.panelThickness), COLORS.doorPanel);
  panel.add(along(axis, col, row, 1 - DOOR.post - 0.12, 1 - DOOR.post - 0.04, 0.95, 1.1, DOOR.panelThickness + 0.08), COLORS.frame);
  const hinge = axis === 'x' ? { x: col + DOOR.post, z: row + 0.5 } : { x: col + 0.5, z: row + DOOR.post };
  const geometry = panel.build();
  geometry.translate(-hinge.x, 0, -hinge.z);
  // Which side is walkable: the panel swings that way.
  const side = axis === 'x'
    ? (level.isWalkable(col, row + 1) ? 1 : -1)
    : (level.isWalkable(col + 1, row) ? 1 : -1);
  // The panel runs along +X (axis x) or +Z (axis z) from the hinge;
  // rotation.y = a turns +Z toward +X and +X toward -Z.
  doors.push({ col, row, axis, hinge, geometry, openAngle: axis === 'x' ? -side * Math.PI / 2 : side * Math.PI / 2 });
}

const OPENINGS = {
  window: addWindow,
  glass: addGlassWall,
  door_open: addOpenDoor,
  door_closed: addClosedDoor,
};

/** Colour of a near (low) wall by tile type: doors and glass become low frames. */
function nearColor(type) {
  return type === 'wall' || type === 'window' ? COLORS.wall : COLORS.frame;
}

/**
 * Opaque wall parts go to the drawn batch and, except the thin frames (posts,
 * rails and door frames, COLORS.frame), to a batch that is only used for
 * picking: a character seen through a glass wall or a doorway stays
 * clickable across the frame bars, while a solid wall in front of a body
 * hides it from the pointer (render/picking.js).
 */
function splitBatch() {
  const drawn = new BoxBatch();
  const occluding = new BoxBatch();
  return {
    drawn,
    occluding,
    add(b, color, topColor = color) {
      drawn.add(b, color, topColor);
      if (color !== COLORS.frame) occluding.add(b, color, topColor);
    },
  };
}

function buildWalls(level) {
  const solid = splitBatch();
  const glass = new BoxBatch();
  const doors = [];
  for (let row = 0; row < level.rows; row++) {
    for (let col = 0; col < level.cols; col++) {
      const height = level.wallHeight(col, row);
      if (!height) continue;
      const type = level.typeAt(col, row);
      if (height === 'near') {
        addSlab(solid, level, col, row, NEAR_WALL_HEIGHT, nearColor(type), COLORS.wallTop);
        continue;
      }
      const axes = level.wallAxes(col, row);
      const opening = OPENINGS[type];
      if (opening && axes.x !== axes.z) {
        opening(solid, glass, level, axes.x ? 'x' : 'z', col, row, doors);
      } else {
        // Plain walls, and openings at corners or standing alone, are solid slabs.
        addSlab(solid, level, col, row, FULL_WALL_HEIGHT, COLORS.wall, COLORS.wallTop);
      }
    }
  }
  return { solid: solid.drawn.build(), occluding: solid.occluding.build(), glass: glass.build(), doors };
}

/** Deterministic pseudo-random numbers, so the texture is the same on every load. */
function seededRandom(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/** Near-white plank texture; the floor's vertex colours tint it. */
function createPlankTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = TEXTURE_SIZE;
  canvas.height = TEXTURE_SIZE;
  const ctx = canvas.getContext('2d');
  const random = seededRandom(7);
  const plank = TEXTURE_SIZE / PLANKS_PER_TILE;
  const base = new THREE.Color(COLORS.plankBase);
  ctx.fillStyle = `#${new THREE.Color(COLORS.plankGap).getHexString()}`;
  ctx.fillRect(0, 0, TEXTURE_SIZE, TEXTURE_SIZE);
  for (let i = 0; i < PLANKS_PER_TILE; i++) {
    // Each plank is one texture tile long, with its end joint at a random offset.
    const shade = 1 - random() * COLORS.plankShade;
    ctx.fillStyle = `#${base.clone().multiplyScalar(shade).getHexString()}`;
    const x = i * plank;
    const joint = Math.floor(random() * TEXTURE_SIZE);
    ctx.fillRect(x + 1, joint + 1, plank - 2, TEXTURE_SIZE - 2);
    ctx.fillRect(x + 1, joint + 1 - TEXTURE_SIZE, plank - 2, TEXTURE_SIZE - 2);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.anisotropy = 4;
  return texture;
}

/**
 * Floor colour for a quarter of a wall tile: the floor type of the nearest
 * walkable tile on that side, or the outside plinth colour.
 */
function quarterColor(level, col, row, dx, dz) {
  for (const [c, r] of [[col, row + dz], [col + dx, row], [col + dx, row + dz]]) {
    const type = level.typeAt(c, r);
    if (type === 'floor' || type === 'door_open') return COLORS.floor;
    if (type === 'floor_hallway') return COLORS.floorHallway;
  }
  return COLORS.floorOutside;
}

/** One merged floor mesh over every non-void tile, wall tiles included. */
function buildFloor(level) {
  const positions = [];
  const colors = [];
  const color = new THREE.Color();
  const quad = (x0, z0, x1, z1, hex) => {
    color.set(hex);
    // Two triangles, counter-clockwise seen from above (+Y).
    for (const [x, z] of [[x0, z0], [x0, z1], [x1, z1], [x0, z0], [x1, z1], [x1, z0]]) {
      positions.push(x, FLOOR_Y, z);
      colors.push(color.r, color.g, color.b);
    }
  };
  for (let row = 0; row < level.rows; row++) {
    for (let col = 0; col < level.cols; col++) {
      const type = level.typeAt(col, row);
      if (type === 'void') continue;
      if (level.isWall(col, row)) {
        // Quarters, so each side of a wall shows the floor of the room it faces.
        for (const [dx, dz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
          const x0 = col + (dx < 0 ? 0 : 0.5);
          const z0 = row + (dz < 0 ? 0 : 0.5);
          quad(x0, z0, x0 + 0.5, z0 + 0.5, quarterColor(level, col, row, dx, dz));
        }
      } else {
        quad(col, row, col + 1, row + 1, type === 'floor_hallway' ? COLORS.floorHallway : COLORS.floor);
      }
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  // World-space UVs: one texture repeat per PLANK_TILE_METRES, planks along Z.
  const uvs = [];
  for (let i = 0; i < positions.length; i += 3) uvs.push(positions[i] / PLANK_TILE_METRES, positions[i + 2] / PLANK_TILE_METRES);
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.computeVertexNormals();
  const material = new THREE.MeshStandardMaterial({
    map: createPlankTexture(), vertexColors: true, roughness: COLORS.floorRoughness,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = 'floor';
  mesh.receiveShadow = true;
  return mesh;
}

/**
 * @typedef {object} DoorPanel
 * @property {number} col
 * @property {number} row
 * @property {'x' | 'z'} axis the wall line the door sits in
 * @property {THREE.Object3D} pivot at the hinge; turn `rotation.y` to swing the panel
 * @property {number} openAngle `rotation.y` of the fully open panel (90 degrees toward the walkable side)
 */

/**
 * @typedef {object} Room
 * @property {THREE.Group} group add to the scene
 * @property {DoorPanel[]} doors the closed doors' panels
 * @property {THREE.Mesh[]} occluders the opaque walls without their thin frames,
 *   for picking only (never drawn; glass, frames and the floor are left out)
 * @property {() => void} dispose frees every geometry, material and texture of the room
 */

/**
 * @param {import('../lib/level.js').Level} level
 * @returns {Room}
 */
export function createRoom(level) {
  const group = new THREE.Group();
  group.name = 'room';
  group.add(buildFloor(level));
  const { solid, occluding, glass, doors: doorParts } = buildWalls(level);
  const wallMaterial = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: COLORS.wallRoughness });
  // Picking only: not in the scene, already in world space (identity matrices).
  const occluders = occluding ? [new THREE.Mesh(occluding, wallMaterial)] : [];
  if (solid) {
    const walls = new THREE.Mesh(solid, wallMaterial);
    walls.name = 'walls';
    walls.castShadow = true;
    walls.receiveShadow = true;
    group.add(walls);
  }
  if (glass) {
    const panes = new THREE.Mesh(glass, new THREE.MeshStandardMaterial({
      vertexColors: true,
      transparent: true,
      opacity: COLORS.glassOpacity,
      roughness: 0.05,
      metalness: 0.1,
      depthWrite: false,
    }));
    panes.name = 'glass';
    group.add(panes);
  }
  // Static geometry: compute matrices once. Door pivots move, so they keep
  // updating their own matrices.
  group.traverse((node) => { node.matrixAutoUpdate = false; });
  const doors = doorParts.map(({ col, row, axis, hinge, geometry, openAngle }) => {
    const pivot = new THREE.Group();
    pivot.name = `door-${col}-${row}`;
    pivot.position.set(hinge.x, 0, hinge.z);
    const panel = new THREE.Mesh(geometry, wallMaterial);
    panel.name = 'door-panel';
    panel.castShadow = true;
    panel.receiveShadow = true;
    pivot.add(panel);
    group.add(pivot);
    return { col, row, axis, pivot, openAngle };
  });
  group.updateMatrixWorld(true);
  if (!solid && !doors.length) wallMaterial.dispose();
  return {
    group,
    doors,
    occluders,
    dispose() {
      group.removeFromParent();
      disposeObject(group);
      occluders.forEach((mesh) => mesh.geometry.dispose());
    },
  };
}
