// Idle life for characters: breathing, a slow weight shift,
// occasional head turns and nods at random intervals, seated characters
// glancing at a neighbour, and every character turning its head toward the
// player when the player is close and in front. Pure maths: no three.js, no
// DOM. render/idleLife.js turns the angles into bone rotations.
//
// Angles are radians in the character's own space (it faces +Z):
// yaw > 0 turns the face toward +X, pitch > 0 tips it down (a nod).

export const IDLE_LIFE = Object.freeze({
  breathPeriod: Object.freeze([3.4, 4.6]), // seconds per breath
  breathAmplitude: 0.025, // chest pitch
  swayPeriod: Object.freeze([7, 11]), // seconds per weight shift, standing only
  swayAmplitude: 0.022, // hip roll
  glanceGap: Object.freeze([3, 8]), // seconds between head moves
  glanceHold: Object.freeze([1.2, 2.8]), // seconds a turned head stays turned
  turnYaw: 0.5, // largest random head turn
  turnPitch: 0.1, // largest random up or down tilt during a turn
  nodPitch: 0.16, // depth of a nod
  nodSeconds: 0.9, // down and back up
  nodChance: 0.3, // share of head moves that are nods
  neighbourChance: 0.5, // share of a seated character's head moves toward its neighbour
  lookRange: 2.5, // metres: the player is looked at within this distance
  frontYaw: 1.75, // ... and within this yaw (about 100 degrees each side)
  maxYaw: 1.2, // head turn limit (about 70 degrees)
  maxPitchUp: 0.35,
  maxPitchDown: 0.3,
  smoothRate: 3.5, // 1/s: how quickly the head closes the gap to its target
  maxSpeed: 1.6, // rad/s: never faster than this
});

const TAU = Math.PI * 2;

/** A uniform value in [range[0], range[1]). */
export function randomBetween(random, [min, max]) {
  return min + random() * (max - min);
}

export function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

/**
 * Move `current` toward `target`: exponential approach at `rate` per second,
 * capped at `maxSpeed` per second, so the head never snaps.
 * @returns {number}
 */
export function smoothToward(current, target, dt, rate, maxSpeed) {
  if (dt <= 0) return current;
  const gap = target - current;
  const step = gap * (1 - Math.exp(-rate * dt));
  const cap = maxSpeed * dt;
  return current + clamp(step, -cap, cap);
}

/**
 * Yaw and pitch toward a direction given in the character's space.
 * @param {number} x
 * @param {number} y up
 * @param {number} z forward
 * @param {{ yaw: number, pitch: number }} out written and returned
 */
export function lookAngles(x, y, z, out) {
  out.yaw = Math.atan2(x, z);
  out.pitch = -Math.atan2(y, Math.hypot(x, z));
  return out;
}

/**
 * Clamp a look to the head's limits (in place).
 * @param {{ yaw: number, pitch: number }} look
 * @param {typeof IDLE_LIFE} [limits]
 */
export function clampLook(look, limits = IDLE_LIFE) {
  look.yaw = clamp(look.yaw, -limits.maxYaw, limits.maxYaw);
  look.pitch = clamp(look.pitch, -limits.maxPitchUp, limits.maxPitchDown);
  return look;
}

/**
 * Whether a point at (x, y, z) in the character's space is close enough and
 * in front, so the character looks at it. Writes the clamped look into `out`.
 * @returns {boolean}
 */
export function canSee(x, y, z, out, limits = IDLE_LIFE) {
  if (Math.hypot(x, z) > limits.lookRange) return false;
  lookAngles(x, y, z, out);
  if (Math.abs(out.yaw) > limits.frontYaw) return false;
  clampLook(out, limits);
  return true;
}

/**
 * Per-character idle state. Call `update` once a frame; it returns the same
 * `out` object every time (no per-frame allocations).
 */
export class IdleLife {
  /**
   * @param {object} options
   * @param {() => number} [options.random] values in [0, 1)
   * @param {boolean} [options.seated] seated characters do not shift their weight
   * @param {{ yaw: number, pitch: number } | null} [options.neighbour] the look toward a
   *   neighbour (seated characters glance at it now and then)
   * @param {typeof IDLE_LIFE} [options.limits]
   */
  constructor({ random = Math.random, seated = false, neighbour = null, limits = IDLE_LIFE } = {}) {
    this.random = random;
    this.limits = limits;
    this.seated = seated;
    this.neighbour = neighbour ? clampLook({ ...neighbour }, limits) : null;
    // Random periods and phases, so characters never move in sync.
    this.breathPeriod = randomBetween(random, limits.breathPeriod);
    this.breathPhase = random() * TAU;
    this.swayPeriod = randomBetween(random, limits.swayPeriod);
    this.swayPhase = random() * TAU;
    this.untilNext = randomBetween(random, limits.glanceGap);
    /** Head target from a glance; held for `holdLeft` seconds, then back to rest. */
    this.glance = { yaw: 0, pitch: 0 };
    this.holdLeft = 0;
    this.nodTime = -1; // seconds into a nod, or -1
    this.out = { yaw: 0, pitch: 0, breath: 0, sway: 0, nod: 0, lookingAtPlayer: false };
  }

  /** Pick the next head move: a nod, a turn, or (seated) a glance at the neighbour. */
  startGlance() {
    const { random, limits } = this;
    const r = random();
    if (r < limits.nodChance) {
      this.nodTime = 0;
      return;
    }
    if (this.neighbour && random() < limits.neighbourChance) {
      this.glance.yaw = this.neighbour.yaw;
      this.glance.pitch = this.neighbour.pitch;
    } else {
      this.glance.yaw = (random() * 2 - 1) * limits.turnYaw;
      this.glance.pitch = (random() * 2 - 1) * limits.turnPitch;
    }
    this.holdLeft = randomBetween(random, limits.glanceHold);
  }

  /**
   * @param {number} dt seconds
   * @param {{ yaw: number, pitch: number } | null} player the clamped look toward
   *   the player when the player can be seen (canSee), otherwise null
   */
  update(dt, player = null) {
    const { limits, out } = this;
    this.breathPhase = (this.breathPhase + (TAU * dt) / this.breathPeriod) % TAU;
    this.swayPhase = (this.swayPhase + (TAU * dt) / this.swayPeriod) % TAU;
    out.breath = Math.sin(this.breathPhase) * limits.breathAmplitude;
    out.sway = this.seated ? 0 : Math.sin(this.swayPhase) * limits.swayAmplitude;

    // Random head moves keep their own clock; looking at the player wins.
    if (this.holdLeft > 0) {
      this.holdLeft -= dt;
    } else if (this.nodTime < 0) {
      this.untilNext -= dt;
      if (this.untilNext <= 0) {
        this.untilNext = randomBetween(this.random, limits.glanceGap);
        this.startGlance();
      }
    }
    if (this.nodTime >= 0) {
      this.nodTime += dt;
      if (this.nodTime >= limits.nodSeconds) this.nodTime = -1;
    }
    out.nod = this.nodTime >= 0 ? Math.sin((Math.PI * this.nodTime) / limits.nodSeconds) * limits.nodPitch : 0;

    let yaw = 0;
    let pitch = 0;
    out.lookingAtPlayer = player !== null;
    if (player) {
      yaw = player.yaw;
      pitch = player.pitch;
    } else if (this.holdLeft > 0) {
      yaw = this.glance.yaw;
      pitch = this.glance.pitch;
    }
    out.yaw = smoothToward(out.yaw, yaw, dt, limits.smoothRate, limits.maxSpeed);
    out.pitch = smoothToward(out.pitch, pitch, dt, limits.smoothRate, limits.maxSpeed);
    return out;
  }
}

/**
 * Index of the point nearest to `points[index]` (on the floor plane, x and
 * z) within `range`, or -1. Seated characters glance at that neighbour.
 * @param {Array<{ x: number, z: number }>} points
 * @param {number} index
 * @param {number} range metres
 * @returns {number}
 */
export function nearestWithin(points, index, range) {
  const self = points[index];
  let best = -1;
  let bestDistance = range;
  points.forEach((p, i) => {
    if (i === index) return;
    const d = Math.hypot(p.x - self.x, p.z - self.z);
    if (d <= bestDistance) {
      best = i;
      bestDistance = d;
    }
  });
  return best;
}
