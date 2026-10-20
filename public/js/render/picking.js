// Pointer picking: the characters' visible bodies and the closed door first,
// then the y = 0 floor plane.
//
// Characters are picked against their skinned meshes in the current pose
// (three's SkinnedMesh.raycast applies the bones), so a click on the floor
// beside or behind a character walks there instead of talking. A tight world box per character (npcs.js) is tested first, so
// the triangle test runs only for the one or two characters under the pointer.
// Only the visible body counts: when furniture or a wall is nearer along the
// ray than the body (the table over a seated character's legs, the kitchen
// wall in front of Henrik), the click goes to the floor instead.
import { THREE } from './three.js';
import { tileAt } from '../lib/movement.js';

/**
 * @typedef {object} PickNpc
 * @property {string} id
 * @property {THREE.Object3D} root
 * @property {{ proxies: SkinnedPickProxy[], box: THREE.Box3 }} pick
 */

/**
 * @typedef {{ kind: 'npc', id: string } | { kind: 'door' } | { kind: 'floor', col: number, row: number, x: number, z: number }} PickHit
 *   a floor hit carries its tile and the exact point (metres)
 */

/**
 * A ray target for one skinned mesh in its current pose. three's
 * SkinnedMesh.raycast skins each vertex again for every triangle that uses
 * it and rebuilds each bone's matrix per vertex. This proxy combines the
 * bone matrices once per pick (bindMatrixInverse x bone x bindMatrix, the
 * same transform three applies), skins every vertex once into a plain
 * geometry that shares the mesh's index, and tests that. Same triangles, a
 * fraction of the cost.
 */
export class SkinnedPickProxy {
  /** @param {THREE.SkinnedMesh} mesh */
  constructor(mesh) {
    this.mesh = mesh;
    const source = mesh.geometry;
    this.base = source.getAttribute('position');
    this.skinIndex = source.getAttribute('skinIndex');
    this.skinWeight = source.getAttribute('skinWeight');
    const geometry = new THREE.BufferGeometry();
    this.positions = new THREE.BufferAttribute(new Float32Array(this.base.count * 3), 3);
    geometry.setAttribute('position', this.positions);
    if (source.index) geometry.setIndex(source.index);
    // Front faces only, as drawn. The mesh's own bounding sphere (with the
    // pick margin, npcs.js) stays the cheap first test.
    this.proxy = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial());
    this.proxy.matrixAutoUpdate = false;
    this.combined = new Float32Array(mesh.skeleton.bones.length * 16);
    this.matrix = new THREE.Matrix4();
  }

  /** Fill the proxy's positions with the vertices in the current pose. */
  skin() {
    const { mesh, combined, matrix, base, skinIndex, skinWeight } = this;
    const { skeleton } = mesh;
    skeleton.update(); // boneMatrices from the bones' current world matrices
    for (let b = 0; b < skeleton.bones.length; b++) {
      matrix.fromArray(skeleton.boneMatrices, b * 16)
        .premultiply(mesh.bindMatrixInverse)
        .multiply(mesh.bindMatrix);
      matrix.toArray(combined, b * 16);
    }
    const out = this.positions.array;
    for (let i = 0, n = base.count; i < n; i++) {
      const x = base.getX(i);
      const y = base.getY(i);
      const z = base.getZ(i);
      let sx = 0;
      let sy = 0;
      let sz = 0;
      for (let k = 0; k < 4; k++) {
        const w = skinWeight.getComponent(i, k);
        if (w === 0) continue;
        const m = skinIndex.getComponent(i, k) * 16;
        sx += w * (combined[m] * x + combined[m + 4] * y + combined[m + 8] * z + combined[m + 12]);
        sy += w * (combined[m + 1] * x + combined[m + 5] * y + combined[m + 9] * z + combined[m + 13]);
        sz += w * (combined[m + 2] * x + combined[m + 6] * y + combined[m + 10] * z + combined[m + 14]);
      }
      out[i * 3] = sx;
      out[i * 3 + 1] = sy;
      out[i * 3 + 2] = sz;
    }
  }

  /**
   * @param {THREE.Raycaster} raycaster
   * @param {THREE.Intersection[]} hits appended to
   */
  raycast(raycaster, hits) {
    const { mesh, proxy } = this;
    this.skin();
    proxy.geometry.boundingSphere = mesh.boundingSphere;
    proxy.geometry.boundingBox = null;
    proxy.matrixWorld.copy(mesh.matrixWorld);
    proxy.raycast(raycaster, hits);
  }

  dispose() {
    // The index belongs to the mesh's own geometry; only the copy is freed.
    this.proxy.geometry.index = null;
    this.proxy.geometry.dispose();
    this.proxy.material.dispose();
  }
}

export class Picker {
  /**
   * @param {THREE.Camera} camera
   * @param {HTMLElement} element the canvas
   * @param {THREE.Object3D[]} [occluders] static meshes that hide characters
   *   (furniture, opaque walls); tested only when the ray hits a character
   */
  constructor(camera, element, occluders = []) {
    this.camera = camera;
    this.element = element;
    this.occluders = occluders;
    this.raycaster = new THREE.Raycaster();
    this.floor = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    this.ndc = new THREE.Vector2();
    this.hitPoint = new THREE.Vector3();
    /** @type {THREE.Intersection[]} reused between picks */
    this.hits = [];
  }

  /**
   * @param {number} clientX
   * @param {number} clientY
   * @param {PickNpc[]} npcs
   * @param {THREE.Object3D | null} door the door's invisible hit box, or null while it cannot be clicked
   * @returns {PickHit | null}
   */
  pick(clientX, clientY, npcs, door) {
    const rect = this.element.getBoundingClientRect();
    this.ndc.set(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    this.raycaster.setFromCamera(this.ndc, this.camera);
    const { ray } = this.raycaster;

    let best = null;
    let bestDistance = Infinity;
    for (const npc of npcs) {
      if (!ray.intersectsBox(npc.pick.box)) continue;
      // World matrices are otherwise only refreshed by the renderer. A click
      // that arrives before the first frame would test stale bone matrices.
      npc.root.updateMatrixWorld(true);
      this.hits.length = 0;
      for (const proxy of npc.pick.proxies) proxy.raycast(this.raycaster, this.hits);
      for (const hit of this.hits) {
        if (hit.distance < bestDistance) {
          bestDistance = hit.distance;
          best = { kind: 'npc', id: npc.id };
        }
      }
    }
    if (best && this.occluded(bestDistance)) {
      best = null;
      bestDistance = Infinity;
    }
    if (door) {
      door.updateWorldMatrix(true, false);
      this.hits.length = 0;
      door.raycast(this.raycaster, this.hits);
      if (this.hits.some((hit) => hit.distance < bestDistance)) best = { kind: 'door' };
    }
    if (best) return best;
    if (!ray.intersectPlane(this.floor, this.hitPoint)) return null;
    const { x, z } = this.hitPoint;
    return { kind: 'floor', ...tileAt(x, z), x, z };
  }

  /**
   * Whether an occluder lies on the current ray nearer than `distance`.
   * @param {number} distance along the ray to the character hit
   */
  occluded(distance) {
    const { raycaster } = this;
    const far = raycaster.far;
    raycaster.far = distance;
    let hidden = false;
    for (const mesh of this.occluders) {
      this.hits.length = 0;
      mesh.raycast(raycaster, this.hits);
      if (this.hits.some((hit) => hit.distance < distance)) {
        hidden = true;
        break;
      }
    }
    raycaster.far = far;
    return hidden;
  }
}
