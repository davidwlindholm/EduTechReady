import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  IDLE_LIFE, IdleLife, canSee, clamp, clampLook, lookAngles, nearestWithin, randomBetween, smoothToward,
} from '../../public/js/lib/idleLife.js';

const close = (a, b, eps = 1e-9) => Math.abs(a - b) < eps;

/** Deterministic random numbers in [0, 1). */
function seeded(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/** A random source that replays the given values, then repeats the last one. */
function replay(...values) {
  let i = 0;
  return () => values[Math.min(i++, values.length - 1)];
}

test('randomBetween maps [0, 1) onto the range', () => {
  assert.equal(randomBetween(() => 0, [3, 8]), 3);
  assert.equal(randomBetween(() => 0.5, [3, 8]), 5.5);
  assert.ok(randomBetween(() => 0.999, [3, 8]) < 8);
});

test('clamp keeps a value inside its limits', () => {
  assert.equal(clamp(5, 0, 1), 1);
  assert.equal(clamp(-5, 0, 1), 0);
  assert.equal(clamp(0.3, 0, 1), 0.3);
});

test('smoothToward approaches without overshooting, capped in speed, still at dt 0', () => {
  let v = 0;
  let last = 0;
  for (let i = 0; i < 300; i++) {
    v = smoothToward(v, 1, 1 / 60, 3.5, 1.6);
    assert.ok(v >= last && v <= 1, 'monotonic, never past the target');
    assert.ok(v - last <= 1.6 / 60 + 1e-12, 'never faster than maxSpeed');
    last = v;
  }
  assert.ok(v > 0.99);
  // A big jump in the target is taken at the speed cap, not snapped.
  assert.ok(close(smoothToward(0, 10, 0.1, 100, 1.6), 0.16));
  assert.equal(smoothToward(0.4, 1, 0, 3.5, 1.6), 0.4);
  // Works downward too.
  assert.ok(smoothToward(0, -1, 0.1, 3.5, 1.6) < 0);
});

test('lookAngles: forward is 0, +X turns right, above tips the head up', () => {
  const out = { yaw: 0, pitch: 0 };
  lookAngles(0, 0, 1, out);
  assert.ok(close(out.yaw, 0) && close(out.pitch, 0));
  lookAngles(1, 0, 0, out);
  assert.ok(close(out.yaw, Math.PI / 2));
  lookAngles(0, 1, 1, out);
  assert.ok(close(out.pitch, -Math.PI / 4), 'looking up is a negative pitch');
  lookAngles(0, -1, 1, out);
  assert.ok(close(out.pitch, Math.PI / 4));
  assert.equal(lookAngles(0, 0, 1, out), out, 'writes into and returns out');
});

test('clampLook limits yaw and pitch to the head limits', () => {
  const look = clampLook({ yaw: 3, pitch: -2 });
  assert.equal(look.yaw, IDLE_LIFE.maxYaw);
  assert.equal(look.pitch, -IDLE_LIFE.maxPitchUp);
  const other = clampLook({ yaw: -3, pitch: 2 });
  assert.equal(other.yaw, -IDLE_LIFE.maxYaw);
  assert.equal(other.pitch, IDLE_LIFE.maxPitchDown);
});

test('canSee: within range and in front only, and the look is clamped', () => {
  const out = { yaw: 0, pitch: 0 };
  assert.equal(canSee(0, 0, 2, out), true);
  assert.equal(canSee(0, 0, IDLE_LIFE.lookRange + 0.1, out), false, 'too far');
  assert.equal(canSee(0, 0, -1, out), false, 'behind');
  assert.equal(canSee(2, 0, 0.3, out), true, 'to the side but in front');
  assert.equal(out.yaw, IDLE_LIFE.maxYaw, 'clamped to the head limit');
  // Height does not count toward the range (a tall player close by is seen).
  assert.equal(canSee(0, 2, 1, out), true);
  assert.equal(out.pitch, -IDLE_LIFE.maxPitchUp);
});

test('IdleLife: breathing and weight shift run continuously; seated characters do not shift', () => {
  const standing = new IdleLife({ random: seeded(1) });
  const seated = new IdleLife({ random: seeded(1), seated: true });
  const breaths = new Set();
  for (let i = 0; i < 120; i++) {
    const s = standing.update(1 / 30);
    breaths.add(s.breath.toFixed(4));
    assert.ok(Math.abs(s.breath) <= IDLE_LIFE.breathAmplitude);
    assert.ok(Math.abs(s.sway) <= IDLE_LIFE.swayAmplitude);
    assert.equal(seated.update(1 / 30).sway, 0);
  }
  assert.ok(breaths.size > 50, 'the chest keeps moving');
});

test('IdleLife: characters are desynchronised by their random source', () => {
  const a = new IdleLife({ random: seeded(1) });
  const b = new IdleLife({ random: seeded(2) });
  assert.notEqual(a.breathPeriod, b.breathPeriod);
  assert.notEqual(a.update(0.5).breath, b.update(0.5).breath);
});

test('IdleLife: head moves start at random intervals inside glanceGap', () => {
  const life = new IdleLife({ random: seeded(7) });
  const dt = 1 / 30;
  const starts = [];
  let wasStill = true;
  let t = 0;
  for (let i = 0; i < 30 * 120; i++) {
    t += dt;
    const before = life.holdLeft > 0 || life.nodTime >= 0;
    life.update(dt);
    const busy = life.holdLeft > 0 || life.nodTime >= 0;
    if (!before && busy && wasStill) starts.push(t);
    wasStill = !busy;
  }
  assert.ok(starts.length >= 8, `several head moves in two minutes (${starts.length})`);
  assert.ok(starts[0] <= IDLE_LIFE.glanceGap[1] + dt);
  const [minGap, maxGap] = IDLE_LIFE.glanceGap;
  const longest = Math.max(IDLE_LIFE.glanceHold[1], IDLE_LIFE.nodSeconds);
  for (let i = 1; i < starts.length; i++) {
    const gap = starts[i] - starts[i - 1];
    assert.ok(gap >= minGap - dt, `gap ${gap} >= ${minGap}`);
    assert.ok(gap <= maxGap + longest + 2 * dt, `gap ${gap} within the schedule`);
  }
});

test('IdleLife: a turn is held, then the head returns to rest, never snapping', () => {
  // random: periods and phases (4 values), first gap (0 -> 3 s); at the first
  // move the next gap (0.99 -> about 8 s), then a turn (0.9 > nodChance), its
  // yaw (1 -> +turnYaw), pitch (0.5 -> 0) and hold (0 -> 1.2 s).
  const life = new IdleLife({ random: replay(0, 0, 0, 0, 0, 0.99, 0.9, 1, 0.5, 0, 0.99) });
  const dt = 1 / 30;
  let last = 0;
  let peak = 0;
  for (let i = 0; i < 30 * 10; i++) {
    const s = life.update(dt);
    assert.ok(Math.abs(s.yaw - last) <= IDLE_LIFE.maxSpeed * dt + 1e-12, 'no snap');
    last = s.yaw;
    peak = Math.max(peak, s.yaw);
  }
  assert.ok(peak > IDLE_LIFE.turnYaw * 0.8, `turned toward the glance (${peak})`);
  assert.ok(Math.abs(last) < 0.05, `back at rest (${last})`);
});

test('IdleLife: a nod dips the head and comes back within nodSeconds', () => {
  const life = new IdleLife({ random: replay(0, 0, 0, 0, 0, 0.99, 0) }); // gap 3 s, next gap 8 s, a nod
  const dt = 1 / 60;
  let deepest = 0;
  for (let t = 0; t < 3 + IDLE_LIFE.nodSeconds + 0.1; t += dt) deepest = Math.max(deepest, life.update(dt).nod);
  assert.ok(deepest > IDLE_LIFE.nodPitch * 0.9);
  assert.equal(life.update(dt).nod, 0);
});

test('IdleLife: a seated character glances at its neighbour, clamped to the head limit', () => {
  // gap 3 s, next gap 8 s, a turn (0.9), toward the neighbour (0 < neighbourChance), hold 1.2 s.
  const life = new IdleLife({ random: replay(0, 0, 0, 0, 0, 0.99, 0.9, 0, 0), seated: true, neighbour: { yaw: 2, pitch: 0.1 } });
  let peak = 0;
  for (let t = 0; t < 4.2; t += 1 / 30) peak = Math.max(peak, life.update(1 / 30).yaw);
  assert.ok(peak > IDLE_LIFE.maxYaw * 0.8 && peak <= IDLE_LIFE.maxYaw + 1e-9, `peak ${peak}`);
});

test('IdleLife: looking at the player wins over glances, smoothly, and lets go afterwards', () => {
  const life = new IdleLife({ random: seeded(3) });
  const player = { yaw: -0.8, pitch: 0.2 };
  const dt = 1 / 30;
  let last = 0;
  for (let i = 0; i < 90; i++) {
    const s = life.update(dt, player);
    assert.ok(Math.abs(s.yaw - last) <= IDLE_LIFE.maxSpeed * dt + 1e-12);
    assert.equal(s.lookingAtPlayer, true);
    last = s.yaw;
  }
  assert.ok(Math.abs(last - player.yaw) < 0.02, 'facing the player after 3 s');
  const s = life.update(dt, null);
  assert.equal(s.lookingAtPlayer, false);
  assert.ok(s.yaw > last, 'turns back toward rest');
});

test('IdleLife.update returns the same object every frame (no per-frame allocation)', () => {
  const life = new IdleLife({ random: seeded(5) });
  const out = life.update(0.016);
  assert.equal(life.update(0.016, { yaw: 0.1, pitch: 0 }), out);
});

test('nearestWithin picks the closest other point inside the range', () => {
  const points = [{ x: 0, z: 0 }, { x: 3, z: 0 }, { x: 1, z: 1 }, { x: 0.5, z: 0 }];
  assert.equal(nearestWithin(points, 0, 2.5), 3);
  assert.equal(nearestWithin(points, 1, 1), -1, 'nobody within 1 m');
  assert.equal(nearestWithin(points, 1, 2.5), 2);
});
