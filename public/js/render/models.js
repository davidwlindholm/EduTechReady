// Model loading through assets.json. Each GLB is fetched once;
// instances are clones with their own materials.
import { THREE, GLTFLoader, cloneSkinned, mergeGeometries } from './three.js';
import { disposeObject, disposeMaterial } from './dispose.js';

/**
 * @typedef {object} ModelInstance
 * @property {THREE.Group} root     position and facing go here (facing is rotation.y)
 * @property {THREE.Object3D} model the cloned scene, the AnimationMixer root
 * @property {THREE.AnimationClip[]} animations
 * @property {object} entry          the assets.json entry
 * @property {() => void} dispose    frees this instance's cloned materials; the
 *   geometry and textures are shared with the cached glTF (ModelLibrary.dispose)
 */

const SKIN_ATTRIBUTES = ['position', 'normal', 'skinIndex', 'skinWeight'];

/**
 * Everything about a plain material except its colour, so parts that differ
 * only in colour can share one draw call (the colour goes into the vertices).
 * @param {THREE.MeshStandardMaterial} m
 */
function surfaceKey(m) {
  return [m.roughness, m.metalness, m.emissive.getHexString(), m.emissiveIntensity, m.side,
    m.transparent, m.opacity, m.flatShading, m.alphaTest].join('|');
}

/**
 * Merge a skinned clone's meshes into one mesh with vertex colours, so a
 * character costs one draw call per surface look (roughness, metalness and
 * so on; two for the Quaternius characters: skin and the rest) instead of
 * one per material. Only for untextured models whose meshes share one
 * skeleton and bind matrix (every character GLB: its parts are primitives of
 * one mesh). Colours come from the per-instance material copies, so
 * `materialColors` still apply by material name; each merged
 * material is a copy of the first part's material with that look.
 * @param {THREE.Object3D} model the clone (changed in place)
 * @returns {{ geometry: THREE.BufferGeometry, materials: THREE.Material[] } | null}
 *   the resources the merged mesh owns, or null when the model cannot be merged
 */
function mergeSkinnedParts(model) {
  const meshes = [];
  model.traverse((node) => { if (node.isSkinnedMesh) meshes.push(node); });
  if (meshes.length < 2) return null;
  const [first] = meshes;
  const sameRig = meshes.every((m) => m.parent === first.parent
    && m.bindMatrix.equals(first.bindMatrix)
    && m.skeleton.bones.length === first.skeleton.bones.length
    && m.skeleton.bones.every((b, i) => b === first.skeleton.bones[i]));
  const plain = meshes.every((m) => !Array.isArray(m.material) && !m.material.map && m.material.isMeshStandardMaterial
    && SKIN_ATTRIBUTES.every((a) => m.geometry.getAttribute(a)));
  if (!sameRig || !plain) return null;

  /** @type {Map<string, THREE.SkinnedMesh[]>} surface key -> parts, in first-seen order */
  const looks = new Map();
  for (const m of meshes) {
    const key = surfaceKey(m.material);
    if (!looks.has(key)) looks.set(key, []);
    looks.get(key).push(m);
  }
  const groups = [];
  const materials = [];
  for (const parts of looks.values()) {
    const geometries = parts.map((m) => {
      const g = new THREE.BufferGeometry();
      for (const name of SKIN_ATTRIBUTES) g.setAttribute(name, m.geometry.getAttribute(name));
      if (m.geometry.index) g.setIndex(m.geometry.index);
      const count = g.getAttribute('position').count;
      const colors = new Float32Array(count * 3);
      const c = m.material.color;
      for (let i = 0; i < count; i++) colors.set([c.r, c.g, c.b], i * 3);
      g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
      return g;
    });
    const merged = mergeGeometries(geometries, false);
    if (!merged) {
      // Free what earlier looks made; the model keeps its separate parts.
      groups.forEach((g) => g.dispose());
      materials.forEach((m) => m.dispose());
      return null;
    }
    groups.push(merged);
    const material = parts[0].material.clone();
    material.color.set(0xffffff);
    material.vertexColors = true;
    material.name = `${parts[0].material.name}_merged`;
    materials.push(material);
  }
  const geometry = groups.length === 1 ? groups[0] : mergeGeometries(groups, true);
  if (groups.length > 1) groups.forEach((g) => g.dispose());
  if (!geometry) {
    materials.forEach((m) => m.dispose());
    return null;
  }
  const merged = new THREE.SkinnedMesh(geometry, materials.length === 1 ? materials[0] : materials);
  merged.name = `${first.name}_merged`;
  merged.castShadow = true;
  merged.receiveShadow = true;
  merged.frustumCulled = first.frustumCulled;
  merged.bind(first.skeleton, first.bindMatrix);
  first.parent.add(merged);
  meshes.forEach((m) => m.removeFromParent());
  return { geometry, materials };
}

export class ModelLibrary {
  /**
   * @param {{ models: Record<string, object> }} manifest parsed assets.json
   * @param {string} [baseUrl] prefix for `file` paths, relative to the page
   * @param {{ onProgress?: (fraction: number) => void }} [options] download
   *   progress of the models declared with `expect` (plus any others started),
   *   0 to 1, for the loading screen
   */
  constructor(manifest, baseUrl = '', { onProgress = null } = {}) {
    this.manifest = manifest;
    this.baseUrl = baseUrl;
    this.loader = new GLTFLoader();
    /** @type {Map<string, Promise<object>>} */
    this.cache = new Map();
    this.onProgress = onProgress;
    /** @type {Map<string, number>} model id -> downloaded fraction (1 when parsed) */
    this.fractions = new Map();
  }

  /**
   * Declare the models about to load, so progress counts them from the start
   * instead of growing its total as loads begin.
   * @param {Iterable<string>} ids
   */
  expect(ids) {
    for (const id of ids) if (!this.fractions.has(id)) this.fractions.set(id, 0);
    this.reportProgress();
  }

  /** Every model weighs the same: their sizes are unknown until each download starts. */
  reportProgress() {
    if (!this.onProgress || this.fractions.size === 0) return;
    let sum = 0;
    this.fractions.forEach((f) => { sum += f; });
    this.onProgress(sum / this.fractions.size);
  }

  setFraction(id, fraction) {
    this.fractions.set(id, Math.max(this.fractions.get(id) ?? 0, fraction));
    this.reportProgress();
  }

  entry(id) {
    const entry = this.manifest.models[id];
    if (!entry) throw new Error(`unknown model id "${id}" (not in assets.json)`);
    return entry;
  }

  /** Load (once) and return the parsed glTF for a model id. */
  load(id) {
    if (!this.cache.has(id)) {
      const entry = this.entry(id);
      // Downloads count up to 95 % of a model's share; parsing finishes it.
      const onDownload = (event) => {
        if (event.lengthComputable && event.total > 0) this.setFraction(id, 0.95 * (event.loaded / event.total));
      };
      this.setFraction(id, 0);
      const promise = this.loader.loadAsync(this.baseUrl + entry.file, onDownload).then((gltf) => {
        this.setFraction(id, 1);
        return gltf;
      }, (err) => {
        this.cache.delete(id);
        throw new Error(`could not load model "${id}" from ${entry.file}: ${err.message}`);
      });
      this.cache.set(id, promise);
    }
    return this.cache.get(id);
  }

  /**
   * A new instance: root (facing) > pivot (rotationOffsetDeg, scale) > model clone.
   * Materials are cloned per instance before `materialColors` are applied.
   * @param {string} id
   * @param {{ materialColors?: Record<string, string>, merge?: boolean }} [options]
   *   merge: combine a skinned model's parts into one draw call (mergeSkinnedParts)
   * @returns {Promise<ModelInstance>}
   */
  async instantiate(id, { materialColors = {}, merge = false } = {}) {
    const entry = this.entry(id);
    const gltf = await this.load(id);
    const model = cloneSkinned(gltf.scene);
    const materialCopies = new Map();
    model.traverse((node) => {
      if (!node.isMesh) return;
      node.castShadow = true;
      node.receiveShadow = true;
      const copy = (m) => {
        if (!materialCopies.has(m)) {
          const c = m.clone();
          const hex = materialColors[m.name];
          if (hex) c.color.set(hex);
          materialCopies.set(m, c);
        }
        return materialCopies.get(m);
      };
      node.material = Array.isArray(node.material) ? node.material.map(copy) : copy(node.material);
    });
    const merged = merge ? mergeSkinnedParts(model) : null;
    if (merged) {
      // The merged mesh has its own materials; the coloured copies were only
      // read for their colours, so free them now rather than at dispose.
      materialCopies.forEach((m) => disposeMaterial(m, { textures: false }));
      materialCopies.clear();
    }
    const pivot = new THREE.Group();
    pivot.rotation.y = THREE.MathUtils.degToRad(entry.rotationOffsetDeg ?? 0);
    pivot.scale.setScalar(entry.scale ?? 1);
    pivot.add(model);
    const root = new THREE.Group();
    root.name = id;
    root.add(pivot);
    return {
      root,
      model,
      animations: gltf.animations,
      entry,
      dispose() {
        root.removeFromParent();
        // Each skinned clone has its own skeleton, whose bone texture lives
        // on the GPU until the skeleton is disposed.
        const skeletons = new Set();
        model.traverse((node) => { if (node.isSkinnedMesh) skeletons.add(node.skeleton); });
        skeletons.forEach((skeleton) => skeleton.dispose());
        materialCopies.forEach((m) => disposeMaterial(m, { textures: false }));
        materialCopies.clear();
        if (merged) {
          merged.geometry.dispose(); // its attribute arrays are copies; the glTF's stay with the library
          merged.materials.forEach((m) => m.dispose());
        }
      },
    };
  }

  /**
   * Free every loaded glTF (geometry, original materials, textures). Dispose
   * the instances first; their clones share this geometry and these textures.
   */
  async dispose() {
    const loaded = await Promise.allSettled([...this.cache.values()]);
    this.cache.clear();
    loaded.forEach((result) => {
      if (result.status === 'fulfilled') disposeObject(result.value.scene);
    });
  }
}
