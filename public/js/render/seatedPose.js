// Fits the Sitting clip to a real seat. The clip sits on a seat about
// 0.32 to 0.34 m high with its feet on the floor at the origin; the chairs
// (0.52 m) and the sofa (0.41 m) are higher. The character is lifted so its
// seat meets the cushion, and each frame a two-bone leg solve puts the feet
// back on the floor (the feet are their own bones, children of the armature
// root, so the lift would otherwise raise them too).
import { THREE } from './three.js';

/**
 * Height of the seated pose's lowest point under the hips (the seat it
 * assumes), per clip, in metres after scaling. Measured from the skinned
 * vertices in the settled part of the clip.
 */
const CLIP_SEAT_HEIGHT = Object.freeze({ Female_Sitting: 0.32, Man_Sitting: 0.34 });
const DEFAULT_CLIP_SEAT = 0.33;
// Cushions give a little; the hips sink this far into the seat top.
const CUSHION_SINK = 0.015;
// Keeps the leg solve away from a fully straight knee.
const MAX_REACH = 0.995;

const LEGS = Object.freeze([
  { upper: 'UpperLegL', lower: 'LowerLegL', foot: 'FootL' },
  { upper: 'UpperLegR', lower: 'LowerLegR', foot: 'FootR' },
]);

/**
 * How far to lift a model playing `clipName` so it sits on a seat of `seatHeight`.
 * @param {string} clipName
 * @param {number} seatHeight
 */
export function seatLift(clipName, seatHeight) {
  let clipSeat = CLIP_SEAT_HEIGHT[clipName];
  if (clipSeat === undefined) {
    // A sit clip nobody measured yet: assume the Quaternius average rather
    // than fail the boot (measure its lowest point under the hips from the skinned vertices).
    console.warn(`no seat height measured for clip "${clipName}"; assuming ${DEFAULT_CLIP_SEAT} m`);
    clipSeat = DEFAULT_CLIP_SEAT;
  }
  return Math.max(0, seatHeight - CUSHION_SINK - clipSeat);
}

const v = {
  hip: new THREE.Vector3(), knee: new THREE.Vector3(), foot: new THREE.Vector3(), target: new THREE.Vector3(),
  ankleLocal: new THREE.Vector3(), ankle: new THREE.Vector3(), u: new THREE.Vector3(), bend: new THREE.Vector3(),
  newKnee: new THREE.Vector3(), local: new THREE.Vector3(), from: new THREE.Vector3(), to: new THREE.Vector3(), forward: new THREE.Vector3(),
};
const q = { delta: new THREE.Quaternion(), parent: new THREE.Quaternion() };

/** Rotate `bone` in world space so the direction `from` turns into `to`. */
function aimBone(bone, from, to) {
  q.delta.setFromUnitVectors(from.normalize(), to.normalize());
  bone.parent.getWorldQuaternion(q.parent);
  // local' = parent^-1 * delta * parent * local
  bone.quaternion.premultiply(q.parent).premultiply(q.delta).premultiply(q.parent.invert());
  bone.updateMatrixWorld(true);
}

/**
 * @typedef {object} PoseFix
 * @property {() => void} restore call before each mixer update: puts back the
 *   clip's own values. The mixer only writes a property when its value
 *   changes, so without this the fix would compound on still frames.
 * @property {() => void} apply call after each mixer update
 */

/**
 * A per-frame pose fix for a seated model. It works in world space, so
 * `root` must already be lifted and placed.
 * @param {THREE.Object3D} root the instance root (lifted by `lift`)
 * @param {THREE.Object3D} model the cloned scene holding the skeleton
 * @param {{ lift: number, feetForward: number }} options metres
 * @returns {PoseFix}
 */
export function createSeatedLegFix(root, model, { lift, feetForward }) {
  const legs = LEGS.map((names) => {
    const bones = Object.fromEntries(Object.entries(names).map(([k, name]) => {
      const bone = model.getObjectByName(name);
      if (!bone) throw new Error(`seated pose: bone "${name}" missing in "${root.name}"`);
      return [k, bone];
    }));
    return bones;
  });
  const touched = legs.flatMap(({ upper, lower, foot }) => [upper, lower, foot]);
  const saved = touched.map((bone) => ({ position: bone.position.clone(), quaternion: bone.quaternion.clone() }));
  let applied = false;
  if (lift <= 0 && feetForward <= 0) return { restore() {}, apply() {} };

  return {
    restore() {
      if (!applied) return;
      touched.forEach((bone, i) => {
        bone.position.copy(saved[i].position);
        bone.quaternion.copy(saved[i].quaternion);
      });
    },
    apply() {
      touched.forEach((bone, i) => {
        saved[i].position.copy(bone.position);
        saved[i].quaternion.copy(bone.quaternion);
      });
      applied = true;
      fixLegs();
    },
  };

  function fixLegs() {
    root.updateMatrixWorld(true);
    // The model faces +Z in root space; feet move forward along that axis.
    v.forward.set(0, 0, 1).transformDirection(root.matrixWorld);
    for (const { upper, lower, foot } of legs) {
      upper.getWorldPosition(v.hip);
      lower.getWorldPosition(v.knee);
      foot.getWorldPosition(v.foot);
      // Where the shin ends, in the shin's own space, before anything moves.
      v.ankleLocal.copy(v.foot);
      lower.worldToLocal(v.ankleLocal);
      const thigh = v.hip.distanceTo(v.knee);
      const shin = v.knee.distanceTo(v.foot);

      // Put the foot back down by the lift (and a little forward).
      v.target.copy(v.foot).addScaledVector(v.forward, feetForward);
      v.target.y -= lift;
      foot.position.copy(foot.parent.worldToLocal(v.local.copy(v.target)));
      foot.updateMatrixWorld(true);

      // Two-bone solve: the knee stays in the plane of hip, foot and the clip's knee bend.
      v.u.subVectors(v.target, v.hip);
      const dist = Math.min(v.u.length(), (thigh + shin) * MAX_REACH);
      v.u.normalize();
      v.bend.subVectors(v.knee, v.hip);
      v.bend.addScaledVector(v.u, -v.bend.dot(v.u));
      if (v.bend.lengthSq() < 1e-8) v.bend.copy(v.forward);
      v.bend.normalize();
      const along = (thigh * thigh - shin * shin + dist * dist) / (2 * dist);
      const across = Math.sqrt(Math.max(0, thigh * thigh - along * along));
      v.newKnee.copy(v.hip).addScaledVector(v.u, along).addScaledVector(v.bend, across);

      aimBone(upper, v.from.subVectors(v.knee, v.hip), v.to.subVectors(v.newKnee, v.hip));
      lower.getWorldPosition(v.knee);
      v.ankle.copy(v.ankleLocal);
      lower.localToWorld(v.ankle);
      aimBone(lower, v.from.subVectors(v.ankle, v.knee), v.to.subVectors(v.target, v.knee));
    }
  }
}
