// The logical sit clip is trimmed to its settled part and ping-ponged, and
// play() starts a clip at a given offset (npcs.js passes a random one).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { THREE } from '../../public/js/render/three.js';
import { Actor, trimClip } from '../../public/js/render/actor.js';

const STAND = 1.0; // hips height in the standing first and last keyframes
const SEAT = 0.4; // hips height while seated

/** A sitting clip shaped like Female_Sitting: standing at 0 and 8.33 s, seated between. */
function sittingClip() {
  const hips = new THREE.NumberKeyframeTrack('Hips.position[y]',
    [0, 0.5, 1, 4, 7.5, 8.33], [STAND, SEAT, SEAT, SEAT, SEAT, STAND]);
  // A constant track with keys only outside the trim window.
  const spine = new THREE.NumberKeyframeTrack('Spine.position[x]', [0, 8.33], [0.25, 0.25]);
  return new THREE.AnimationClip('Female_Sitting', 8.33, [hips, spine]);
}

function fakeInstance() {
  const model = new THREE.Group();
  const hips = new THREE.Object3D();
  hips.name = 'Hips';
  const spine = new THREE.Object3D();
  spine.name = 'Spine';
  model.add(hips, spine);
  const root = new THREE.Group();
  root.name = 'char_w1';
  root.add(model);
  const idle = new THREE.AnimationClip('Idle', 2, [
    new THREE.NumberKeyframeTrack('Hips.position[x]', [0, 2], [0, 2]),
  ]);
  return {
    root,
    model,
    hips,
    animations: [idle, sittingClip()],
    entry: { clips: { idle: 'Idle', walk: null, sit: 'Female_Sitting' } },
  };
}

test('trimClip keeps only the window, shifted to start at 0', () => {
  const trimmed = trimClip(sittingClip(), 0.75, 7.9);
  assert.ok(Math.abs(trimmed.duration - 7.15) < 1e-9);
  const [hips, spine] = trimmed.tracks;
  assert.equal(hips.times[0], 0);
  assert.ok(Math.abs(hips.times[hips.times.length - 1] - 7.15) < 1e-6);
  assert.ok(hips.times.every((t) => t >= 0 && t <= 7.15 + 1e-6));
  // The ends are interpolated: seated at 0.75 s, a little way up at 7.9 s.
  assert.ok(Math.abs(hips.values[0] - SEAT) < 1e-6);
  const last = hips.values[hips.values.length - 1];
  assert.ok(last > SEAT && last < STAND, `hips at 7.9 s: ${last}`);
  // Keys inside the window are kept: 1, 4 and 7.5 s plus both ends.
  assert.deepEqual([...hips.times].map((t) => Math.round((t + 0.75) * 100) / 100), [0.75, 1, 4, 7.5, 7.9]);
  // A track with keys only outside the window keeps its value.
  assert.deepEqual([...spine.values], [0.25, 0.25]);
});

test('the sit action is trimmed and ping-pongs, so it never reaches the standing keys', () => {
  const instance = fakeInstance();
  const actor = new Actor(instance);
  const sit = actor.actions.sit;
  assert.equal(sit.loop, THREE.LoopPingPong);
  assert.equal(sit.repetitions, Infinity);
  assert.ok(Math.abs(sit.getClip().duration - 7.15) < 1e-9);
  actor.play('sit', { fade: 0 });
  let highest = -Infinity;
  for (let i = 0; i < 400; i++) { // 20 s in 0.05 s steps, past several turns
    actor.update(0.05);
    highest = Math.max(highest, instance.hips.position.y);
  }
  assert.ok(highest < STAND - 0.1, `hips reached ${highest}`);
  assert.ok(sit.isRunning());
});

test('play starts a clip at the given offset, wrapped to its duration', () => {
  const a = new Actor(fakeInstance());
  const b = new Actor(fakeInstance());
  a.play('idle', { fade: 0, startAt: 0.5 });
  b.play('idle', { fade: 0, startAt: 3.25 });
  assert.equal(a.actions.idle.time, 0.5);
  assert.ok(Math.abs(b.actions.idle.time - 1.25) < 1e-9);
  a.update(0);
  b.update(0);
  // Different offsets give different poses on the same frame.
  assert.notEqual(a.root.getObjectByName('Hips').position.x, b.root.getObjectByName('Hips').position.x);
});

function walkerInstance() {
  const instance = fakeInstance();
  instance.animations.push(new THREE.AnimationClip('Walk', 1, [
    new THREE.NumberKeyframeTrack('Hips.position[x]', [0, 1], [5, 6]),
  ]));
  instance.entry.clips.walk = 'Walk';
  return instance;
}

test('cross-fades blend weights linearly and report isFading until settled', () => {
  const actor = new Actor(walkerInstance());
  actor.play('idle', { fade: 0 });
  assert.equal(actor.isFading, false);
  actor.play('walk', { fade: 0.2 });
  assert.equal(actor.isFading, true);
  actor.update(0.05);
  const { idle, walk } = actor.actions;
  assert.ok(Math.abs(walk.getEffectiveWeight() - 0.25) < 1e-9);
  assert.ok(Math.abs(idle.getEffectiveWeight() - 0.75) < 1e-9);
  for (let i = 0; i < 4; i++) actor.update(0.05);
  assert.equal(walk.getEffectiveWeight(), 1);
  assert.equal(idle.isRunning(), false, 'the faded-out clip stops');
  assert.equal(actor.isFading, false);
});

test('switching back during a fade continues from the current weight and time (no pop)', () => {
  const actor = new Actor(walkerInstance());
  const { idle, walk } = actor.actions;
  actor.play('idle', { fade: 0 });
  actor.play('walk');
  for (let i = 0; i < 6; i++) actor.update(0.05); // walk fully in
  const walkTime = walk.time;
  actor.play('idle'); // arrived
  actor.update(0.05); // walk 0.75, idle 0.25
  const before = walk.getEffectiveWeight();
  assert.ok(Math.abs(before - 0.75) < 1e-9);
  actor.play('walk'); // clicked again straight away
  assert.equal(walk.getEffectiveWeight(), before, 'weight is not reset');
  assert.ok(walk.time >= walkTime, 'time is not reset');
  actor.update(0.05);
  assert.ok(Math.abs(walk.getEffectiveWeight() - 1) < 1e-9);
  assert.ok(Math.abs(idle.getEffectiveWeight()) < 1e-9 || !idle.isRunning());
  assert.equal(actor.isFading, false);
});
