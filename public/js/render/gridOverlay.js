// Debug grid overlay: one translucent square per tile, coloured
// walkable, occupied or wall. Loaded only with debug=1; hidden until G.
import { THREE, mergeGeometries } from './three.js';
import { THEME } from './theme.js';

const INSET = 0.06; // gap between squares, so tile edges read
const LIFT = 0.02; // above the floor planks

/**
 * @param {import('../lib/level.js').Level} level
 * @param {import('../lib/grid.js').Grid} grid
 * @returns {{ group: THREE.Group, dispose: () => void }}
 */
export function createGridOverlay(level, grid) {
  const colors = THEME.debugGrid;
  const parts = [];
  const color = new THREE.Color();
  for (let row = 0; row < level.rows; row++) {
    for (let col = 0; col < level.cols; col++) {
      let hex;
      if (grid.isWalkable(col, row)) hex = colors.walkable;
      else if (grid.isBlocked(col, row)) hex = colors.occupied;
      else if (level.isWall(col, row)) hex = colors.wall;
      else continue; // void: no floor, no square
      const plane = new THREE.PlaneGeometry(1 - INSET * 2, 1 - INSET * 2);
      plane.rotateX(-Math.PI / 2);
      plane.translate(col + 0.5, LIFT, row + 0.5);
      color.set(hex);
      const count = plane.getAttribute('position').count;
      const rgb = new Float32Array(count * 3);
      for (let i = 0; i < count; i++) rgb.set([color.r, color.g, color.b], i * 3);
      plane.setAttribute('color', new THREE.BufferAttribute(rgb, 3));
      parts.push(plane);
    }
  }
  const geometry = mergeGeometries(parts, false);
  parts.forEach((g) => g.dispose());
  const material = new THREE.MeshBasicMaterial({
    vertexColors: true, transparent: true, opacity: colors.opacity, depthTest: false, depthWrite: false,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.renderOrder = 10; // drawn over furniture so blocked tiles stay visible
  mesh.name = 'grid-overlay';
  const group = new THREE.Group();
  group.name = 'grid-overlay';
  group.add(mesh);
  group.visible = false;
  return {
    group,
    dispose() {
      group.removeFromParent();
      geometry.dispose();
      material.dispose();
    },
  };
}
