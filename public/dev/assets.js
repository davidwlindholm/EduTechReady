// Developer page: every model from content/assets.json in a labelled grid.
// Not deployed. Characters play their idle clip (or ?clip=walk / ?clip=sit).
import * as THREE from '../vendor/three/build/three.module.js';
import { GLTFLoader } from '../vendor/three/examples/jsm/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from '../vendor/three/examples/jsm/utils/SkeletonUtils.js';
import { CSS2DRenderer, CSS2DObject } from '../vendor/three/examples/jsm/renderers/CSS2DRenderer.js';
import { layoutModels } from '../js/lib/asset_grid.js';

const MANIFEST_URL = '../content/assets.json';
const ASSET_BASE = '../';
const CAMERA_DISTANCE = 40;
const FIT_MARGIN = 1.06;
const LABEL_HEIGHT_OFFSET = 0.15;

const canvas = document.getElementById('scene');
const statusEl = document.getElementById('status');
const query = new URLSearchParams(location.search);
const requestedClip = query.get('clip') || 'idle';
// ?ids=a,b shows only those models (for close-up orientation checks)
const onlyIds = query.get('ids') ? query.get('ids').split(',') : null;

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
const labelRenderer = new CSS2DRenderer();
labelRenderer.domElement.style.position = 'fixed';
labelRenderer.domElement.style.top = '0';
labelRenderer.domElement.style.left = '0';
labelRenderer.domElement.style.pointerEvents = 'none';
document.body.appendChild(labelRenderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0xdfe6ee);
scene.add(new THREE.HemisphereLight(0xffffff, 0x8a7a66, 1.6));
const sun = new THREE.DirectionalLight(0xffffff, 2.2);
sun.position.set(4, 8, 6);
scene.add(sun);

const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 200);
const mixers = [];
const clock = new THREE.Clock();
const loader = new GLTFLoader();
const loadErrors = [];
const characterHeights = {};

function addLabel(parent, text, y) {
  const el = document.createElement('div');
  el.className = 'model-label';
  el.textContent = text;
  const label = new CSS2DObject(el);
  label.position.set(0, y, 0);
  parent.add(label);
}

function footprintOutline(footprint) {
  const hw = footprint.w / 2;
  const hd = footprint.d / 2;
  const points = [[-hw, -hd], [hw, -hd], [hw, hd], [-hw, hd]].map(([x, z]) => new THREE.Vector3(x, 0.01, z));
  return new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(points), new THREE.LineBasicMaterial({ color: 0x3a6ea5 }));
}

function playClip(model, gltf, entry) {
  const clipName = entry.clips[requestedClip] ?? entry.clips.idle;
  const clip = gltf.animations.find((c) => c.name === clipName);
  if (!clip) throw new Error(`clip ${clipName} not found`);
  const mixer = new THREE.AnimationMixer(model);
  mixer.clipAction(clip).play();
  mixer.update(0.5);
  mixers.push(mixer);
}

async function placeModel(id, entry, spot) {
  const gltf = await loader.loadAsync(ASSET_BASE + entry.file);
  const model = cloneSkinned(gltf.scene);
  const holder = new THREE.Group();
  holder.position.set(spot.x, 0, spot.z);
  const pivot = new THREE.Group();
  pivot.rotation.y = THREE.MathUtils.degToRad(entry.rotationOffsetDeg);
  pivot.scale.setScalar(entry.scale);
  pivot.add(model);
  holder.add(pivot);
  if (entry.kind === 'character') playClip(model, gltf, entry);
  if (entry.footprint) holder.add(footprintOutline(entry.footprint));
  scene.add(holder);
  holder.updateMatrixWorld(true);
  const height = new THREE.Box3().setFromObject(holder, true).max.y;
  if (entry.kind === 'character') characterHeights[id] = Math.round(height * 100) / 100;
  addLabel(holder, id, height + LABEL_HEIGHT_OFFSET);
}

function fitCamera() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  renderer.setSize(w, h, false);
  labelRenderer.setSize(w, h);
  const box = new THREE.Box3().setFromObject(scene);
  const target = box.getCenter(new THREE.Vector3());
  camera.position.copy(target).add(new THREE.Vector3(CAMERA_DISTANCE, CAMERA_DISTANCE, CAMERA_DISTANCE));
  camera.lookAt(target);
  camera.updateMatrixWorld(true);
  let maxX = 0;
  let maxY = 0;
  for (const x of [box.min.x, box.max.x]) {
    for (const y of [box.min.y, box.max.y]) {
      for (const z of [box.min.z, box.max.z]) {
        const p = new THREE.Vector3(x, y, z).applyMatrix4(camera.matrixWorldInverse);
        maxX = Math.max(maxX, Math.abs(p.x));
        maxY = Math.max(maxY, Math.abs(p.y));
      }
    }
  }
  const aspect = w / h;
  const halfH = Math.max(maxY, maxX / aspect) * FIT_MARGIN;
  camera.left = -halfH * aspect;
  camera.right = halfH * aspect;
  camera.top = halfH;
  camera.bottom = -halfH;
  camera.updateProjectionMatrix();
}

async function main() {
  const manifest = await (await fetch(MANIFEST_URL)).json();
  const shown = onlyIds
    ? Object.fromEntries(Object.entries(manifest.models).filter(([id]) => onlyIds.includes(id)))
    : manifest.models;
  const spots = layoutModels(shown);
  const state = { total: spots.length, loaded: 0, errors: loadErrors, characterHeights, done: false };
  window.__assetViewer = state;
  await Promise.all(spots.map(async (spot) => {
    try {
      await placeModel(spot.id, manifest.models[spot.id], spot);
      state.loaded += 1;
    } catch (err) {
      loadErrors.push(`${spot.id}: ${err.message}`);
    }
  }));
  fitCamera();
  window.addEventListener('resize', fitCamera);
  statusEl.textContent = `${state.loaded}/${state.total} models loaded (clip: ${requestedClip})`;
  state.done = true;
  renderer.setAnimationLoop(() => {
    const dt = clock.getDelta();
    mixers.forEach((m) => m.update(dt));
    renderer.render(scene, camera);
    labelRenderer.render(scene, camera);
  });
  if (loadErrors.length) throw new Error(`failed to load: ${loadErrors.join('; ')}`);
}

main().catch((err) => {
  console.error(err);
  statusEl.textContent = String(err);
});
