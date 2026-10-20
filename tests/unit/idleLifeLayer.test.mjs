// render/idleLife.js on a stand-in rig: the bone layer moves the head bone
// over time, turns it toward a close target in front, and restores the clip's
// values before each mixer update. The bones get odd local rotations, since
// the layer must not depend on the rig's bone axes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { THREE } from '../../public/js/render/three.js';
import { createIdleLifeLayer, EYE_HEIGHT } from '../../public/js/render/idleLife.js';

const CHAIN = ['Hips', 'Abdomen', 'Torso', 'Neck', 'Head'];
const DT = 1 / 30;

/** A character root at (2, 0, 3) turned a quarter to face +X, holding the chain. */
function rig() {
  const root = new THREE.Group();
  root.name = 'char_test';
  root.position.set(2, 0, 3);
  root.rotation.y = Math.PI / 2;
  const model = new THREE.Group();
  root.add(model);
  let parent = model;
  const bones = CHAIN.map((name, i) => {
    const bone = new THREE.Bone();
    bone.name = name;
    bone.position.set(0, i === 0 ? 1 : 0.2, 0);
    bone.quaternion.setFromEuler(new THREE.Euler(0.3 * i - 0.5, 0.7 * i, -0.2 * i));
    parent.add(bone);
    parent = bone;
    return bone;
  });
  root.updateMatrixWorld(true);
  return { root, model, bones, head: bones[4] };
}

function headWorld(root, head) {
  root.updateMatrixWorld(true);
  return head.getWorldQuaternion(new THREE.Quaternion());
}

/** One frame as render/actor.js runs it: restore, (mixer), apply. */
function frames(layer, seconds) {
  for (let t = 0; t < seconds; t += DT) {
    layer.restore();
    layer.apply(DT);
  }
}

test('the head bone moves over 2 s with nobody in sight (breathing)', () => {
  const { root, model, head } = rig();
  // random() = 0: the first head move is 3 s away, so only breathing acts.
  const layer = createIdleLifeLayer(root, model, { seated: false, getLookTarget: () => null, random: () => 0 });
  layer.apply(DT);
  const start = headWorld(root, head);
  frames(layer, 2);
  const angle = start.angleTo(headWorld(root, head));
  assert.ok(angle > 0.005 && angle < 0.1, `head turned ${angle} rad`);
});

test('the head turns toward a close target in front, within its limits', () => {
  const { root, model, head } = rig();
  const rest = headWorld(root, head);
  // The character faces +X (world). Target 1.5 m ahead and 1 m to its left
  // (world -Z), at eye height: a yaw of atan2(1, 1.5), no pitch.
  const target = new THREE.Vector3(2 + 1.5, EYE_HEIGHT.stand, 3 - 1);
  const layer = createIdleLifeLayer(root, model, { seated: false, getLookTarget: () => target, random: () => 0 });
  frames(layer, 3);
  const now = headWorld(root, head);
  // World rotation the layer added to the head, applied to the facing direction.
  const delta = now.clone().multiply(rest.clone().invert());
  const facing = new THREE.Vector3(1, 0, 0).applyQuaternion(delta);
  const turned = Math.atan2(-facing.z, facing.x);
  const wanted = Math.atan2(1, 1.5);
  assert.ok(Math.abs(turned - wanted) < 0.08, `turned ${turned}, wanted ${wanted}`);
  assert.ok(Math.abs(facing.y) < 0.1, `little pitch, got ${facing.y}`);

  // Behind the character: the head turns back to the front (breathing,
  // weight shift and nods aside).
  target.set(2 - 1.5, EYE_HEIGHT.stand, 3 - 1);
  frames(layer, 4);
  const back = new THREE.Vector3(1, 0, 0).applyQuaternion(headWorld(root, head).multiply(rest.clone().invert()));
  assert.ok(Math.abs(Math.atan2(-back.z, back.x)) < 0.05, `yaw back near 0, got ${Math.atan2(-back.z, back.x)}`);
});

test('restore puts back the values the mixer wrote, so offsets never compound', () => {
  const { root, model, bones } = rig();
  const clip = bones.map((b) => b.quaternion.clone());
  const target = new THREE.Vector3(3.5, EYE_HEIGHT.stand, 3);
  const layer = createIdleLifeLayer(root, model, { seated: false, getLookTarget: () => target });
  layer.restore(); // before the first apply: a no-op
  frames(layer, 1);
  assert.ok(bones.some((b, i) => b.quaternion.angleTo(clip[i]) > 1e-4), 'the layer changed the pose');
  layer.restore();
  bones.forEach((b, i) => assert.ok(b.quaternion.angleTo(clip[i]) < 1e-6, `${b.name} restored`));
});

test('a rig without the expected bones is rejected by name', () => {
  const { root, model, bones } = rig();
  bones[3].name = 'Neck_01';
  assert.throws(() => createIdleLifeLayer(root, model, { seated: true, getLookTarget: () => null }), /bone "Neck" missing/);
});
