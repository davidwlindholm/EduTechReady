// GPU resource disposal. three.js frees geometries, materials and textures
// only when told to, so everything the world builds is released through here.

const TEXTURE_KEYS = ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap', 'emissiveMap', 'alphaMap', 'bumpMap', 'lightMap'];

/**
 * Dispose a material and, optionally, the textures it references.
 * @param {import('three').Material} material
 * @param {{ textures?: boolean }} [options] textures: false for material clones that share textures
 */
export function disposeMaterial(material, { textures = true } = {}) {
  if (textures) {
    for (const key of TEXTURE_KEYS) material[key]?.dispose?.();
  }
  material.dispose();
}

/**
 * Dispose every geometry, material and texture under `root`, each once.
 * Only use this for objects that own their resources. Skinned model clones
 * share geometry with the cached glTF, so they release only their own
 * materials (ModelInstance.dispose) and the library disposes the rest.
 * @param {import('three').Object3D} root
 * @param {{ geometries?: boolean, materials?: boolean, textures?: boolean }} [options]
 */
export function disposeObject(root, { geometries = true, materials = true, textures = true } = {}) {
  const seenGeometries = new Set();
  const seenMaterials = new Set();
  root.traverse((node) => {
    if (geometries && node.geometry) seenGeometries.add(node.geometry);
    if (materials && node.material) {
      (Array.isArray(node.material) ? node.material : [node.material]).forEach((m) => seenMaterials.add(m));
    }
  });
  seenGeometries.forEach((g) => g.dispose());
  seenMaterials.forEach((m) => disposeMaterial(m, { textures }));
}
