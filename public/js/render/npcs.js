// Non-player characters from characters.json: model with
// its own materials and colours, idle or seated animation, CSS2D label and
// a pick shape: the skinned meshes themselves, behind a tight world box
// (render/picking.js).
import { THREE, CSS2DObject } from './three.js';
import { Actor } from './actor.js';
import { createSeatedLegFix, seatLift } from './seatedPose.js';
import { createIdleLifeLayer, EYE_HEIGHT } from './idleLife.js';
import { SkinnedPickProxy } from './picking.js';
import { facingToRotation } from '../lib/movement.js';
import { splitNameRole } from '../lib/characters.js';

// Heights above the character's own origin (the feet when standing, the
// lifted seat origin when seated). A seated character is about 1.4 m tall.
// Labels keep off the head and torso: from `hip` up to `top`, `width` wide
// on screen (metres). Legs and feet may be covered; a seated character's
// are mostly under the table anyway.
// `chest` is the fallback npcToScreen point (debug API) for a rig without
// CHEST_BONE: height above the origin and how far back (local -Z) it sits.
const POSE = Object.freeze({
  stand: { top: 1.7, hip: 0.8, width: 0.5, chest: { y: 1.2, back: 0 } },
  // The seated body leans back over the seat.
  sit: { top: 1.4, hip: 0.35, width: 0.6, chest: { y: 0.85, back: 0.1 } },
});
// The Quaternius rigs' chest bone (render/idleLife.js uses the same chain).
const CHEST_BONE = 'Torso';
// Space between the top of the head and the bottom edge of the label.
const LABEL_GAP = 0.15;
// Slack around the clip's posed meshes (box and bounding spheres), so idle
// life's head turns and the seated sway, which the clip does not contain,
// stay inside them.
const PICK_MARGIN = 0.12;
// Poses sampled across the whole clip for the pick box and bounding spheres.
const PICK_POSE_SAMPLES = 24;
// Clips play from a random point within this many seconds.
const RANDOM_START_SECONDS = 10;

function createLabel(text, height) {
  const { name, role } = splitNameRole(text);
  const el = document.createElement('div');
  el.className = 'npc-label';
  const nameEl = document.createElement('span');
  nameEl.className = 'npc-label__name';
  nameEl.textContent = name;
  el.appendChild(nameEl);
  if (role) {
    const roleEl = document.createElement('span');
    roleEl.className = 'npc-label__role';
    roleEl.textContent = `(${role})`;
    el.appendChild(roleEl);
  }
  // Labels are a visual aid; the dialogue heading carries the same text for screen readers.
  el.setAttribute('aria-hidden', 'true');
  const label = new CSS2DObject(el);
  // Anchor the label's bottom centre (not its middle) above the head, so the
  // tag never hangs over the face.
  label.center.set(0.5, 1);
  label.position.set(0, height, 0);
  return label;
}

/**
 * The pick shape: the skinned meshes in their current pose (through
 * SkinnedPickProxy), and a world box around them for a cheap first test.
 * Characters never move, so the box is computed once, but over every pose
 * of the clip, not only the random starting one: `actor`'s current action is
 * sampled across its whole duration (the ping-pong sit clip covers its poses
 * in one duration too) and then put back where it was. The meshes' own
 * bounding spheres cover the same poses and get the same slack.
 * @param {THREE.Object3D} model posed, with current world matrices
 * @param {Actor} actor plays the model's clip; layers already added apply too
 * @param {THREE.Object3D} root updated after each sampled pose
 * @returns {{ proxies: SkinnedPickProxy[], box: THREE.Box3 }}
 */
function createPickShape(model, actor, root) {
  const meshes = [];
  model.traverse((node) => { if (node.isSkinnedMesh) meshes.push(node); });
  const proxies = meshes.map((mesh) => new SkinnedPickProxy(mesh));
  const box = new THREE.Box3();
  const spheres = meshes.map(() => new THREE.Sphere());
  const meshBox = new THREE.Box3();
  const sphere = new THREE.Sphere();
  const action = actor.current;
  const startTime = action ? action.time : 0;
  const duration = action ? action.getClip().duration : 0;
  const samples = action && duration > 0 ? PICK_POSE_SAMPLES : 1;
  for (let s = 0; s < samples; s++) {
    if (action) {
      action.time = (startTime + (s / samples) * duration) % duration;
      actor.update(0);
      root.updateMatrixWorld(true);
    }
    proxies.forEach((proxy, i) => {
      proxy.skin(); // the mesh's vertices in this pose, in mesh space
      const geometry = proxy.proxy.geometry;
      geometry.computeBoundingBox();
      meshBox.copy(geometry.boundingBox);
      meshBox.getBoundingSphere(sphere);
      if (s === 0) spheres[i].copy(sphere);
      else spheres[i].union(sphere);
      box.union(meshBox.applyMatrix4(meshes[i].matrixWorld));
    });
  }
  if (action) {
    action.time = startTime;
    actor.update(0);
    root.updateMatrixWorld(true);
  }
  meshes.forEach((mesh, i) => {
    const scale = mesh.matrixWorld.getMaxScaleOnAxis() || 1;
    mesh.boundingSphere = spheres[i];
    mesh.boundingSphere.radius += PICK_MARGIN / scale;
  });
  box.expandByScalar(PICK_MARGIN);
  return { proxies, box };
}

/**
 * @typedef {object} Npc
 * @property {string} id
 * @property {object} def characters.json entry
 * @property {Actor} actor
 * @property {THREE.Group} root
 * @property {{ proxies: SkinnedPickProxy[], box: THREE.Box3 }} pick the skinned meshes
 *   (precise picking) and a world box around them (the cheap first test)
 * @property {THREE.Vector3} clickPoint world point for npcToScreen, on the chest
 * @property {CSS2DObject} label
 * @property {number} labelHeight height of the label's bottom edge above the root
 * @property {{ top: number, hip: number, width: number }} body head top and
 *   hip height above the root and on-screen width, in metres (labels keep off it)
 * @property {boolean} seated
 * @property {THREE.Vector3} eyes world point between the eyes (others glance at it)
 * @property {(options: { getLookTarget: () => THREE.Vector3 | null, neighbour?: THREE.Vector3 | null }) => void} addIdleLife
 *   adds the idle-life layer (render/idleLife.js); call once, after every character is placed
 * @property {() => void} dispose stops the animation and frees the instance's own resources
 */

/**
 * @param {import('./models.js').ModelLibrary} library
 * @param {object} def characters.json entry
 * @param {import('../lib/seating.js').Placement} placement from placeCharacter
 * @returns {Promise<Npc>}
 */
export async function createNpc(library, def, placement) {
  const instance = await library.instantiate(def.model, { materialColors: def.materialColors, merge: true });
  const actor = new Actor(instance);
  const root = instance.root;
  // A seated character whose model has no sit clip (assets.json allows
  // `sit: null`) stands at its seat instead of failing the boot. The
  // validator flags this content; the game stays playable.
  const seated = placement.seat !== null && actor.has('sit');
  if (placement.seat !== null && !seated) {
    console.warn(`character "${def.id}": model "${def.model}" has no sit clip, so it stands at its seat`);
  }
  const pose = seated ? POSE.sit : POSE.stand;
  const lift = seated ? seatLift(instance.entry.clips.sit, placement.seat.height) : 0;
  root.position.set(placement.x, lift, placement.z);
  root.rotation.y = facingToRotation(placement.facing);
  if (seated) {
    actor.addLayer(createSeatedLegFix(root, instance.model, { lift, feetForward: placement.seat.feetForward }));
  }
  // Random start so characters sharing a clip do not move in sync.
  actor.play(seated ? 'sit' : 'idle', { fade: 0, startAt: Math.random() * RANDOM_START_SECONDS });
  actor.update(0); // pose (and seat) the model before the first frame

  const label = createLabel(def.name, pose.top + LABEL_GAP);
  label.element.dataset.npcId = def.id;
  root.add(label);
  root.updateMatrixWorld(true);
  const pick = createPickShape(instance.model, actor, root);
  // The chest bone lies inside the torso in any pose, so its projection is
  // on the body, not near an edge (a seated pose has gaps by the arms).
  const chestBone = instance.model.getObjectByName(CHEST_BONE);
  const clickPoint = chestBone
    ? chestBone.getWorldPosition(new THREE.Vector3())
    : root.localToWorld(new THREE.Vector3(0, pose.chest.y, -pose.chest.back));
  return {
    id: def.id,
    def,
    actor,
    root,
    pick,
    clickPoint,
    label,
    labelHeight: pose.top + LABEL_GAP,
    body: { top: pose.top, hip: pose.hip, width: pose.width },
    seated,
    eyes: new THREE.Vector3(placement.x, lift + (seated ? EYE_HEIGHT.sit : EYE_HEIGHT.stand), placement.z),
    addIdleLife({ getLookTarget, neighbour = null }) {
      actor.addLayer(createIdleLifeLayer(root, instance.model, { seated, getLookTarget, neighbour }));
    },
    dispose() {
      actor.dispose();
      // A CSS2DObject removes its element only when it is itself detached.
      label.removeFromParent();
      instance.dispose();
      pick.proxies.forEach((proxy) => proxy.dispose());
    },
  };
}
