// Applies lib/idleLife.js to a Quaternius rig after each mixer update:
// breathing on the chest, a weight shift on the hips (standing), and head
// turns split over the neck and head. Bone names as three.js loads them from
// the GLBs (GLTFLoader drops the dots: "Upper.L" becomes "UpperL"); the
// chain is Body > Hips > Abdomen > Torso > Neck > Head in every character.
//
// Rotations are built in the character's own space (it faces +Z) and turned
// into each bone's local space through its parent's world rotation, so the
// bones' own axes do not matter. Like the seated leg fix, the layer restores
// the clip's values before each mixer update (the mixer only writes values
// that change, so offsets would otherwise compound on still frames).
import { THREE } from './three.js';
import { IdleLife, canSee, lookAngles } from '../lib/idleLife.js';

const CHAIN = Object.freeze(['Hips', 'Abdomen', 'Torso', 'Neck', 'Head']);
// Share of the head turn taken by the neck; the head takes the rest.
const NECK_SHARE = 0.4;
// Hip roll is partly undone in the chest, so the head stays over the feet.
const SWAY_COUNTER = 0.6;
/** Eye height above the character's origin, in metres. */
export const EYE_HEIGHT = Object.freeze({ stand: 1.58, sit: 1.25 });

// Shared scratch objects: layers update one after another, never at once.
const tmp = {
  parent: new THREE.Quaternion(),
  parentInv: new THREE.Quaternion(),
  delta: new THREE.Quaternion(),
  rootQ: new THREE.Quaternion(),
  rootInv: new THREE.Quaternion(),
  local: new THREE.Quaternion(),
  euler: new THREE.Euler(0, 0, 0, 'YXZ'),
  look: { yaw: 0, pitch: 0 },
};

/**
 * Direction from a character's eyes to a world point, in the character's
 * space (it faces +Z and only turns about Y).
 */
function toLocal(root, eyeHeight, point, out) {
  const dx = point.x - root.position.x;
  const dy = point.y - (root.position.y + eyeHeight);
  const dz = point.z - root.position.z;
  const a = -root.rotation.y;
  out.x = dx * Math.cos(a) + dz * Math.sin(a);
  out.y = dy;
  out.z = -dx * Math.sin(a) + dz * Math.cos(a);
  return out;
}

/**
 * @typedef {object} IdleLifeLayer
 * @property {() => void} restore call before each mixer update
 * @property {(dt: number) => void} apply call after each mixer update
 * @property {IdleLife} life the state (tests and tuning)
 */

/**
 * @param {THREE.Object3D} root the instance root, placed and turned
 * @param {THREE.Object3D} model the cloned scene holding the skeleton
 * @param {object} options
 * @param {boolean} options.seated
 * @param {() => THREE.Vector3 | null} options.getLookTarget world point to look at
 *   when close and in front (the player's eyes), or null
 * @param {THREE.Vector3 | null} [options.neighbour] a neighbour's eyes, glanced at now and then (seated)
 * @param {() => number} [options.random]
 * @param {number | null} [options.eyeHeight] eye height above the root in
 *   metres, for a model scaled away from 1.7 m (the alien); default EYE_HEIGHT
 * @returns {IdleLifeLayer}
 */
export function createIdleLifeLayer(root, model, {
  seated, getLookTarget, neighbour = null, random = Math.random, eyeHeight: eyeOverride = null,
}) {
  const bones = CHAIN.map((name) => {
    const bone = model.getObjectByName(name);
    if (!bone) throw new Error(`idle life: bone "${name}" missing in "${root.name}"`);
    return bone;
  });
  const hips = bones[0];
  const saved = bones.map((bone) => bone.quaternion.clone());
  const eyeHeight = eyeOverride ?? (seated ? EYE_HEIGHT.sit : EYE_HEIGHT.stand);
  const dir = { x: 0, y: 0, z: 0 };
  let neighbourLook = null;
  if (neighbour) {
    toLocal(root, eyeHeight, neighbour, dir);
    neighbourLook = lookAngles(dir.x, dir.y, dir.z, { yaw: 0, pitch: 0 });
  }
  const life = new IdleLife({ random, seated, neighbour: neighbourLook });
  /** Root-space rotation per bone, rebuilt each frame. */
  const deltas = bones.map(() => new THREE.Quaternion());
  let applied = false;

  function setDelta(q, pitch, yaw, roll) {
    tmp.euler.set(pitch, yaw, roll, 'YXZ');
    return q.setFromEuler(tmp.euler);
  }

  return {
    life,
    restore() {
      if (!applied) return;
      for (let i = 0; i < bones.length; i++) bones[i].quaternion.copy(saved[i]);
    },
    apply(dt) {
      for (let i = 0; i < bones.length; i++) saved[i].copy(bones[i].quaternion);
      applied = true;

      const target = getLookTarget();
      let sees = false;
      if (target !== null) {
        toLocal(root, eyeHeight, target, dir);
        sees = canSee(dir.x, dir.y, dir.z, tmp.look);
      }
      const s = life.update(dt, sees ? tmp.look : null);

      setDelta(deltas[0], 0, 0, s.sway);
      deltas[1].identity();
      setDelta(deltas[2], -s.breath, 0, -s.sway * SWAY_COUNTER);
      setDelta(deltas[3], (s.pitch + s.nod) * NECK_SHARE, s.yaw * NECK_SHARE, 0);
      setDelta(deltas[4], (s.pitch + s.nod) * (1 - NECK_SHARE), s.yaw * (1 - NECK_SHARE), 0);

      // Root-space rotation d becomes world R d R^-1, then bone-local
      // P^-1 (R d R^-1) P, with P the parent's world rotation.
      root.getWorldQuaternion(tmp.rootQ);
      tmp.rootInv.copy(tmp.rootQ).invert();
      hips.parent.getWorldQuaternion(tmp.parent);
      // Plain loops, not forEach: no closures are created per frame.
      for (let i = 0; i < bones.length; i++) {
        const bone = bones[i];
        tmp.delta.copy(tmp.rootQ).multiply(deltas[i]).multiply(tmp.rootInv);
        tmp.parentInv.copy(tmp.parent).invert();
        tmp.local.copy(tmp.parent).multiply(bone.quaternion).premultiply(tmp.delta).premultiply(tmp.parentInv);
        bone.quaternion.copy(tmp.local);
        tmp.parent.multiply(bone.quaternion);
      }
    },
  };
}
