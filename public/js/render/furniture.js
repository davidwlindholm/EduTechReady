// Furniture and props from level.json, placed with the assets.json scale,
// rotationOffsetDeg and the level's facings.
//
// Everything here is static, so it is baked into world space and merged:
// one mesh per distinct material look across all furniture and props, which
// keeps the draw calls near the number of materials, not the number of items.
import { THREE, mergeGeometries } from './three.js';
import { facingToRotation } from '../lib/movement.js';
import { backsOntoWall, tuckOffset } from '../lib/furniture.js';
import { THEME } from './theme.js';
import { WALL_THICKNESS } from './room.js';

// A model whose back is against a solid wall is pushed back to the wall face
// (the slab is centred on the wall tile), less this gap against z-fighting.
const WALL_GAP = 0.01;
const WALL_FACE_INSET = 0.5 - WALL_THICKNESS / 2;

const tmpMatrix = new THREE.Matrix4();

/**
 * Geometries of a glTF scene, baked by `matrix`, with their materials.
 * @param {THREE.Object3D} scene the cached glTF scene (left untouched)
 * @param {THREE.Matrix4} matrix model-to-world, applied after the node transforms
 * @returns {{ geometry: THREE.BufferGeometry, material: THREE.Material }[]}
 */
function bakeParts(scene, matrix) {
  scene.updateMatrixWorld(true);
  const parts = [];
  scene.traverse((node) => {
    if (!node.isMesh) return;
    const materials = Array.isArray(node.material) ? node.material : [node.material];
    tmpMatrix.multiplyMatrices(matrix, node.matrixWorld);
    const groups = Array.isArray(node.material) && node.geometry.groups.length
      ? node.geometry.groups
      : [{ start: 0, count: Infinity, materialIndex: 0 }];
    const base = plainFloats(node.geometry.index ? node.geometry.toNonIndexed() : node.geometry.clone());
    base.applyMatrix4(tmpMatrix);
    for (const group of groups) {
      const material = materials[group.materialIndex ?? 0];
      const geometry = groups.length === 1 ? base : sliceGeometry(base, group);
      parts.push({ geometry, material });
    }
    if (groups.length > 1) base.dispose();
  });
  return parts;
}

/**
 * Replace interleaved, quantised or normalised attributes (all common in
 * glTF) with plain float arrays, so geometries from different files merge
 * and can be sliced by vertex range.
 */
function plainFloats(geometry) {
  for (const [name, attr] of Object.entries(geometry.attributes)) {
    if (attr.isInterleavedBufferAttribute || !(attr.array instanceof Float32Array) || attr.normalized) {
      const floats = new Float32Array(attr.count * attr.itemSize);
      for (let i = 0; i < attr.count; i++) {
        for (let c = 0; c < attr.itemSize; c++) floats[i * attr.itemSize + c] = attr.getComponent(i, c);
      }
      geometry.setAttribute(name, new THREE.BufferAttribute(floats, attr.itemSize));
    }
  }
  return geometry;
}

/** A non-indexed geometry's vertex range [start, start + count) as its own geometry. */
function sliceGeometry(geometry, { start, count }) {
  const out = new THREE.BufferGeometry();
  const end = Math.min(start + count, geometry.getAttribute('position').count);
  for (const [name, attr] of Object.entries(geometry.attributes)) {
    const size = attr.itemSize;
    out.setAttribute(name, new THREE.BufferAttribute(attr.array.slice(start * size, end * size), size, attr.normalized));
  }
  return out;
}

/** Union bounding box of baked parts. */
function boundsOf(parts) {
  const box = new THREE.Box3();
  for (const { geometry } of parts) {
    geometry.computeBoundingBox();
    box.union(geometry.boundingBox);
  }
  return box;
}

/**
 * Materials that look the same share a batch, so the same colour from
 * different source files (or the same file reused) costs one draw call.
 */
function materialKey(m) {
  return [
    m.type, m.color?.getHexString(), m.map?.uuid ?? '-', m.roughness, m.metalness,
    m.transparent, m.opacity, m.side, m.vertexColors, m.emissive?.getHexString(),
  ].join('|');
}

/** Keep only the attributes the material uses, so geometries from different files merge. */
function normaliseAttributes(geometry, material) {
  if (!geometry.getAttribute('normal')) geometry.computeVertexNormals();
  const keep = new Set(['position', 'normal']);
  if (material.map) keep.add('uv');
  if (material.vertexColors) keep.add('color');
  for (const name of Object.keys(geometry.attributes)) {
    if (!keep.has(name)) geometry.deleteAttribute(name);
  }
  geometry.morphAttributes = {};
  geometry.clearGroups();
  return geometry;
}

/**
 * @typedef {object} FurnitureView
 * @property {THREE.Group} group add to the scene
 * @property {number} meshCount merged meshes (one draw call each, plus the shadow pass)
 * @property {() => void} dispose frees the merged geometries and the theme's
 *   recoloured material clones; the source materials and textures belong to
 *   the cached glTFs (ModelLibrary.dispose)
 */

/**
 * @param {import('./models.js').ModelLibrary} library
 * @param {import('../lib/level.js').Level} level
 * @param {import('../lib/furniture.js').FurnitureLayout} layout
 * @returns {Promise<FurnitureView>}
 */
export async function createFurniture(library, level, layout) {
  const assetIds = [...new Set([...layout.items.map((i) => i.asset), ...layout.props.map((p) => p.asset)])];
  const gltfs = new Map(await Promise.all(assetIds.map(async (id) => [id, await library.load(id)])));

  /** @type {Map<string, { material: THREE.Material, geometries: THREE.BufferGeometry[] }>} */
  const batches = new Map();
  // Theme recolours: one clone per (asset, source material), owned and disposed here.
  /** @type {Map<string, THREE.Material>} */
  const recoloured = new Map();
  const themed = (assetId, material) => {
    const hex = THEME.furniture[assetId]?.[material.name];
    if (hex === undefined) return material;
    const k = `${assetId}|${material.uuid}`;
    if (!recoloured.has(k)) {
      const copy = material.clone();
      copy.color.set(hex);
      recoloured.set(k, copy);
    }
    return recoloured.get(k);
  };
  const add = (assetId, parts) => {
    for (const { geometry, material: source } of parts) {
      const material = themed(assetId, source);
      const k = materialKey(material);
      if (!batches.has(k)) batches.set(k, { material, geometries: [] });
      batches.get(k).geometries.push(normaliseAttributes(geometry, material));
    }
  };

  for (const item of layout.items) {
    const entry = library.entry(item.asset);
    // Facing, then the manifest's own rotation and scale; translation follows.
    const matrix = new THREE.Matrix4().compose(
      new THREE.Vector3(),
      new THREE.Quaternion().setFromAxisAngle(
        new THREE.Vector3(0, 1, 0),
        facingToRotation(item.facing) + THREE.MathUtils.degToRad(entry.rotationOffsetDeg ?? 0),
      ),
      new THREE.Vector3().setScalar(entry.scale ?? 1),
    );
    const parts = bakeParts(gltfs.get(item.asset).scene, matrix);
    // Centre the model on its footprint and stand it on the floor; the source
    // origins are not reliably centred (the chair's is near its back legs).
    const box = boundsOf(parts);
    const offset = new THREE.Vector3(
      item.center.x - (box.min.x + box.max.x) / 2,
      -box.min.y,
      item.center.z - (box.min.z + box.max.z) / 2,
    );
    if (backsOntoWall(level, item)) pushToWall(offset, box, item);
    const tuck = tuckOffset(layout, item);
    offset.x += tuck.x;
    offset.z += tuck.z;
    parts.forEach(({ geometry }) => geometry.translate(offset.x, offset.y, offset.z));
    add(item.asset, parts);
  }

  for (const prop of layout.props) {
    const entry = library.entry(prop.asset);
    // Props sit by their origin (bottom centre) at the given point.
    const matrix = new THREE.Matrix4().compose(
      new THREE.Vector3(prop.x, prop.y, prop.z),
      new THREE.Quaternion().setFromAxisAngle(
        new THREE.Vector3(0, 1, 0),
        THREE.MathUtils.degToRad(prop.rotationDeg + (entry.rotationOffsetDeg ?? 0)),
      ),
      new THREE.Vector3().setScalar(entry.scale ?? 1),
    );
    add(prop.asset, bakeParts(gltfs.get(prop.asset).scene, matrix));
  }

  const group = new THREE.Group();
  group.name = 'furniture';
  for (const { material, geometries } of batches.values()) {
    for (const mesh of mergeBatch(material, geometries)) group.add(mesh);
  }
  group.traverse((node) => { node.matrixAutoUpdate = false; });
  group.updateMatrixWorld(true);

  return {
    group,
    meshCount: group.children.length,
    dispose() {
      group.removeFromParent();
      group.children.forEach((mesh) => mesh.geometry.dispose());
      group.clear();
      recoloured.forEach((m) => m.dispose()); // clones share the source textures
      recoloured.clear();
    },
  };
}

/** Shift the footprint-centred offset so the model's back touches the wall face. */
function pushToWall(offset, box, item) {
  const reach = WALL_FACE_INSET - WALL_GAP;
  if (item.facing === 'S') offset.z = item.row - reach - box.min.z;
  if (item.facing === 'N') offset.z = item.row + item.d + reach - box.max.z;
  if (item.facing === 'E') offset.x = item.col - reach - box.min.x;
  if (item.facing === 'W') offset.x = item.col + item.w + reach - box.max.x;
}

/**
 * One mesh for the batch; if the attributes still differ (they should not
 * after normalising), fall back to one mesh per geometry rather than fail.
 */
function mergeBatch(material, geometries) {
  const merged = geometries.length === 1 ? geometries[0] : mergeGeometries(geometries, false);
  const list = merged ? [merged] : geometries;
  if (merged && geometries.length > 1) geometries.forEach((g) => g.dispose());
  return list.map((geometry) => {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    return mesh;
  });
}
