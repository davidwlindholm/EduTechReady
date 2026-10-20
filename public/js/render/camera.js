// Isometric orthographic camera.
import { THREE } from './three.js';

export const CAMERA_DISTANCE = 30;
export const FRAME_MARGIN = 0.05;
// Metres of view depth kept beyond the ground under the view's top edge.
const GROUND_CLEARANCE = 5;

/**
 * @typedef {object} LevelBounds
 * @property {number} minX
 * @property {number} maxX
 * @property {number} minZ
 * @property {number} maxZ
 * @property {number} height tallest thing that must stay in frame (walls, heads, labels)
 */

export function createIsoCamera() {
  return new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, CAMERA_DISTANCE * 4);
}

/**
 * Place the camera at target + (d, d, d), looking at the level centre, with a
 * frustum that fits the whole level plus a margin at the given aspect ratio.
 * @param {THREE.OrthographicCamera} camera
 * @param {LevelBounds} bounds
 * @param {number} aspect width / height
 */
export function frameLevel(camera, bounds, aspect, margin = FRAME_MARGIN) {
  const target = new THREE.Vector3((bounds.minX + bounds.maxX) / 2, 0, (bounds.minZ + bounds.maxZ) / 2);
  camera.position.copy(target).addScalar(CAMERA_DISTANCE);
  camera.lookAt(target);
  camera.updateMatrixWorld(true);

  let halfX = 0;
  let halfY = 0;
  const corner = new THREE.Vector3();
  for (const x of [bounds.minX, bounds.maxX]) {
    for (const y of [0, bounds.height]) {
      for (const z of [bounds.minZ, bounds.maxZ]) {
        corner.set(x, y, z).applyMatrix4(camera.matrixWorldInverse);
        halfX = Math.max(halfX, Math.abs(corner.x));
        halfY = Math.max(halfY, Math.abs(corner.y));
      }
    }
  }
  const halfHeight = Math.max(halfY, halfX / aspect) * (1 + margin);
  camera.left = -halfHeight * aspect;
  camera.right = halfHeight * aspect;
  camera.top = halfHeight;
  camera.bottom = -halfHeight;
  // The ground around the building fills the whole view (render/outside.js).
  // Along the view axis, the ground under the top and bottom edges lies
  // sqrt(2) * halfHeight beyond and before the target. Move the camera back
  // (same view, it is orthographic) and push the far plane out so all of it
  // stays between the clipping planes at any aspect ratio.
  const groundReach = Math.SQRT2 * halfHeight + GROUND_CLEARANCE;
  const distance = Math.max(CAMERA_DISTANCE * Math.sqrt(3), groundReach + 1);
  camera.position.copy(target).addScalar(distance / Math.sqrt(3));
  camera.updateMatrixWorld(true);
  camera.near = 0.1;
  camera.far = distance + groundReach;
  camera.updateProjectionMatrix();
  return target;
}
