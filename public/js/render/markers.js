// Floor markers: the ring under the player and the short-lived
// marker at a click target. Both lie flat just above the floor planks.
import { THREE, mergeGeometries } from './three.js';
import { THEME } from './theme.js';

const LIFT = 0.015; // above the floor, below the grid overlay
const RING_INNER = 0.34;
const RING_OUTER = 0.44;
const RING_DASHES = 4; // arcs, as in the mockup's broken ring
const RING_GAP = 0.35; // radians between arcs
const CLICK_SECONDS = 0.6;
const CLICK_START = 0.12; // inner radius at the start; grows while it fades
const CLICK_GROWTH = 0.28;
const CLICK_WIDTH = 0.06;

function flatMaterial(color, opacity) {
  return new THREE.MeshBasicMaterial({
    color, transparent: true, opacity, depthWrite: false,
    // Pushed toward the camera so the floor never hides it.
    polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
  });
}

/**
 * The ring under the player. Add `group` as a child of the player root.
 * @returns {{ group: THREE.Group, dispose: () => void }}
 */
export function createPlayerRing() {
  const arc = (2 * Math.PI) / RING_DASHES - RING_GAP;
  const parts = [];
  for (let i = 0; i < RING_DASHES; i++) {
    const g = new THREE.RingGeometry(RING_INNER, RING_OUTER, 16, 1, i * (2 * Math.PI / RING_DASHES) + RING_GAP / 2, arc);
    g.deleteAttribute('uv'); // the arcs differ only in angle; merging needs equal attributes anyway
    parts.push(g);
  }
  const geometry = mergeGeometries(parts, false);
  parts.forEach((g) => g.dispose());
  geometry.rotateX(-Math.PI / 2);
  const material = flatMaterial(THEME.markers.ring, THEME.markers.ringOpacity);
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = 'player-ring';
  mesh.position.y = LIFT;
  mesh.renderOrder = 1;
  const group = new THREE.Group();
  group.name = 'player-ring';
  group.add(mesh);
  return {
    group,
    dispose() {
      group.removeFromParent();
      geometry.dispose();
      material.dispose();
    },
  };
}

/**
 * The click marker: a ring that grows and fades out at the walk goal.
 * @returns {{ group: THREE.Group, show: (x: number, z: number) => void, update: (dt: number) => void, dispose: () => void }}
 */
export function createClickMarker() {
  const geometry = new THREE.RingGeometry(1, 1 + CLICK_WIDTH / CLICK_START, 24);
  geometry.rotateX(-Math.PI / 2);
  const material = flatMaterial(THEME.markers.click, THEME.markers.clickOpacity);
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = 'click-marker';
  mesh.renderOrder = 1;
  const group = new THREE.Group();
  group.name = 'click-marker';
  group.add(mesh);
  group.visible = false;
  let age = Infinity;

  function apply() {
    const t = Math.min(age / CLICK_SECONDS, 1);
    const radius = CLICK_START + CLICK_GROWTH * t;
    mesh.scale.set(radius, 1, radius);
    material.opacity = THEME.markers.clickOpacity * (1 - t);
  }

  return {
    group,
    show(x, z) {
      group.position.set(x, LIFT, z);
      age = 0;
      apply();
      group.visible = true;
    },
    update(dt) {
      if (!group.visible) return;
      age += dt;
      if (age >= CLICK_SECONDS) {
        group.visible = false;
        return;
      }
      apply();
    },
    dispose() {
      group.removeFromParent();
      geometry.dispose();
      material.dispose();
    },
  };
}
