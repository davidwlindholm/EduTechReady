// Hemisphere fill, one shadow-casting sun sized to the level, and a soft front fill.
import { THREE } from './three.js';
import { THEME } from './theme.js';

const SHADOW_PADDING = 2;

/**
 * @param {THREE.Scene} scene
 * @param {import('./camera.js').LevelBounds} bounds
 */
export function addLights(scene, bounds) {
  const hemi = new THREE.HemisphereLight(THEME.hemisphereSky, THEME.hemisphereGround, THEME.hemisphereIntensity);
  scene.add(hemi);

  const centre = new THREE.Vector3((bounds.minX + bounds.maxX) / 2, 0, (bounds.minZ + bounds.maxZ) / 2);
  const sun = new THREE.DirectionalLight(THEME.sunColor, THEME.sunIntensity);
  sun.position.copy(centre).add(new THREE.Vector3(THEME.sunOffset.x, THEME.sunOffset.y, THEME.sunOffset.z));
  sun.target.position.copy(centre);
  sun.castShadow = true;
  sun.shadow.mapSize.set(THEME.shadowMapSize, THEME.shadowMapSize);
  sun.shadow.radius = THEME.shadowRadius;
  sun.shadow.bias = -0.0005;
  sun.shadow.normalBias = 0.02;
  const half = Math.max(bounds.maxX - bounds.minX, bounds.maxZ - bounds.minZ) / 2 + SHADOW_PADDING;
  const cam = sun.shadow.camera;
  cam.left = -half;
  cam.right = half;
  cam.top = half;
  cam.bottom = -half;
  cam.near = 0.5;
  cam.far = sun.position.distanceTo(centre) + half * 2;
  cam.updateProjectionMatrix();
  scene.add(sun, sun.target);

  // Shadowless fill from the camera side: the sun comes from the back left,
  // so without it the wall faces the camera sees would sit in deep shade.
  const fill = new THREE.DirectionalLight(THEME.fillColor, THEME.fillIntensity);
  fill.position.copy(centre).add(new THREE.Vector3(THEME.fillOffset.x, THEME.fillOffset.y, THEME.fillOffset.z));
  fill.target.position.copy(centre);
  scene.add(fill, fill.target);
  return { hemi, sun, fill };
}
