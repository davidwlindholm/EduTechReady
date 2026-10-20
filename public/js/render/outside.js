// The ground around the building: grass up to the edges of the
// view, a gravel footpath along the window wall, and a few low bushes.
//
// The camera is fixed but the view's size changes with the window, so
// `fit(camera)` resizes the grass and the path to the camera's footprint on
// the ground after every resize. Three meshes in all (grass, path, bushes),
// textures from small canvases.
import { THREE, mergeGeometries } from './three.js';
import { THEME } from './theme.js';
import { disposeObject } from './dispose.js';

const COLORS = THEME.outside;

// Just below the floor (y = 0), so the floor and its plinth stay on top.
const GRASS_Y = -0.02;
const PATH_Y = -0.01;
// Ground kept beyond the view's footprint, in metres.
const FIT_MARGIN = 2;
/**
 * The footpath runs north-south along the west (window) wall, outside the
 * plinth and the closet behind the closed door (which reaches x -0.3).
 * x is metres; the building's west wall face is at x 0.4.
 */
export const PATH = Object.freeze({ x0: -2.05, x1: -0.65 });
const GRASS_TEXTURE_METRES = 6;
const PATH_TEXTURE_METRES = 1.4;
const TEXTURE_SIZE = 256;

/**
 * Low bushes on the grass, as [x, z, radius]: beside the path and in the
 * open corner north-east of the hallway. Kept clear of the path and the walls.
 */
const BUSHES = Object.freeze([
  [-3.0, -1.6, 0.55], [-2.7, -0.9, 0.4],
  [-3.1, 6.2, 0.5],
  [-2.9, 13.4, 0.6], [-3.4, 14.0, 0.42],
  [12.2, 1.4, 0.5], [12.9, 1.1, 0.38],
  [15.3, 6.5, 0.5],
]);

/** Deterministic pseudo-random numbers, so the textures are the same on every load. */
function seededRandom(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/** A near-white canvas with soft blotches (grass) or specks (gravel); the material colour tints it. */
function speckleTexture({ seed, blotches, radius, shade, edges = false }) {
  const canvas = document.createElement('canvas');
  canvas.width = TEXTURE_SIZE;
  canvas.height = TEXTURE_SIZE;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, TEXTURE_SIZE, TEXTURE_SIZE);
  const random = seededRandom(seed);
  for (let i = 0; i < blotches; i++) {
    // Darker or lighter than the base, fading out at the rim (soft patches).
    const v = Math.round(255 * (1 - random() * shade));
    const x = random() * TEXTURE_SIZE;
    const y = random() * TEXTURE_SIZE;
    const r = radius * (0.4 + random());
    // Drawn at every wrapped position, so the texture tiles without seams.
    for (const dx of [-TEXTURE_SIZE, 0, TEXTURE_SIZE]) {
      for (const dy of [-TEXTURE_SIZE, 0, TEXTURE_SIZE]) {
        const gradient = ctx.createRadialGradient(x + dx, y + dy, 0, x + dx, y + dy, r);
        gradient.addColorStop(0, `rgba(${v}, ${v}, ${v}, 0.6)`);
        gradient.addColorStop(1, `rgba(${v}, ${v}, ${v}, 0)`);
        ctx.fillStyle = gradient;
        ctx.fillRect(x + dx - r, y + dy - r, r * 2, r * 2);
      }
    }
  }
  if (edges) {
    // Darker edging along both long sides of the path (u = 0 and u = 1).
    const base = new THREE.Color(COLORS.path);
    const tint = new THREE.Color(COLORS.pathEdge);
    const edge = new THREE.Color(tint.r / base.r, tint.g / base.g, tint.b / base.b);
    ctx.fillStyle = `#${edge.getHexString()}`;
    const w = Math.round(TEXTURE_SIZE * 0.05);
    ctx.fillRect(0, 0, w, TEXTURE_SIZE);
    ctx.fillRect(TEXTURE_SIZE - w, 0, w, TEXTURE_SIZE);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.anisotropy = 4;
  return texture;
}

/** A unit quad on the ground, x and z from 0 to 1, facing up; uv = (x, z). */
function unitQuad() {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 0, 0, 1, 1, 0, 1, 1, 0, 0], 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute([0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0], 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 0, 1, 1, 1, 1, 0], 2));
  geometry.setIndex([0, 1, 2, 0, 2, 3]);
  return geometry;
}

/** Low-poly bushes: flattened icosahedra, two shades, merged into one mesh. */
function buildBushes() {
  const parts = [];
  const color = new THREE.Color();
  const random = seededRandom(11);
  BUSHES.forEach(([x, z, r], i) => {
    const blobs = [[0, 0, 1], [r * 0.6, r * 0.3, 0.7], [-r * 0.5, -r * 0.4, 0.65]];
    blobs.forEach(([dx, dz, s], j) => {
      const g = new THREE.IcosahedronGeometry(r * s, 0);
      g.scale(1, 0.75, 1);
      g.rotateY(random() * Math.PI);
      g.translate(x + dx, r * s * 0.55, z + dz);
      color.set((i + j) % 2 ? COLORS.bushDark : COLORS.bush);
      const count = g.getAttribute('position').count;
      const colors = new Float32Array(count * 3);
      for (let k = 0; k < count; k++) colors.set([color.r, color.g, color.b], k * 3);
      g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
      parts.push(g);
    });
  });
  const merged = mergeGeometries(parts, false);
  parts.forEach((g) => g.dispose());
  const mesh = new THREE.Mesh(merged, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, flatShading: true }));
  mesh.name = 'bushes';
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

/**
 * @typedef {object} Outside
 * @property {THREE.Group} group add to the scene
 * @property {(camera: THREE.OrthographicCamera) => void} fit resize the grass and
 *   path to cover what the camera sees (call after each camera change)
 * @property {() => void} dispose
 */

/** @returns {Outside} */
export function createOutside() {
  const group = new THREE.Group();
  group.name = 'outside';

  const grassMap = speckleTexture({ seed: 3, blotches: 220, radius: 30, shade: COLORS.grassShade });
  const grass = new THREE.Mesh(unitQuad(), new THREE.MeshStandardMaterial({
    color: COLORS.grass, map: grassMap, roughness: COLORS.grassRoughness,
  }));
  grass.name = 'grass';
  grass.receiveShadow = true;

  const pathMap = speckleTexture({ seed: 5, blotches: 700, radius: 4, shade: COLORS.pathShade, edges: true });
  const path = new THREE.Mesh(unitQuad(), new THREE.MeshStandardMaterial({
    color: COLORS.path, map: pathMap, roughness: 0.95,
  }));
  path.name = 'path';
  path.receiveShadow = true;

  group.add(grass, path, buildBushes());

  const corner = new THREE.Vector3();
  const forward = new THREE.Vector3();
  return {
    group,
    fit(camera) {
      camera.updateMatrixWorld(true);
      camera.getWorldDirection(forward);
      let minX = Infinity;
      let maxX = -Infinity;
      let minZ = Infinity;
      let maxZ = -Infinity;
      // Where the view's corner rays meet the ground (orthographic: parallel rays).
      for (const nx of [-1, 1]) {
        for (const ny of [-1, 1]) {
          corner.set(nx, ny, -1).unproject(camera);
          const t = (GRASS_Y - corner.y) / forward.y;
          corner.addScaledVector(forward, t);
          minX = Math.min(minX, corner.x);
          maxX = Math.max(maxX, corner.x);
          minZ = Math.min(minZ, corner.z);
          maxZ = Math.max(maxZ, corner.z);
        }
      }
      minX -= FIT_MARGIN;
      minZ -= FIT_MARGIN;
      maxX += FIT_MARGIN;
      maxZ += FIT_MARGIN;
      const w = maxX - minX;
      const d = maxZ - minZ;
      grass.position.set(minX, GRASS_Y, minZ);
      grass.scale.set(w, 1, d);
      // World-anchored texture: uv * repeat + offset = world position / tile size.
      grassMap.repeat.set(w / GRASS_TEXTURE_METRES, d / GRASS_TEXTURE_METRES);
      grassMap.offset.set(minX / GRASS_TEXTURE_METRES, minZ / GRASS_TEXTURE_METRES);
      path.position.set(PATH.x0, PATH_Y, minZ);
      path.scale.set(PATH.x1 - PATH.x0, 1, d);
      pathMap.repeat.set(1, d / PATH_TEXTURE_METRES);
      pathMap.offset.set(0, minZ / PATH_TEXTURE_METRES);
    },
    dispose() {
      group.removeFromParent();
      disposeObject(group);
    },
  };
}
