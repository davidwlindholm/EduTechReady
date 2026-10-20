// An animated character instance: AnimationMixer with logical clips
// (idle, walk, sit) mapped through assets.json, and cross-fades between them.
import { THREE } from './three.js';

export const CROSS_FADE_SECONDS = 0.2;

/**
 * The Sitting clips (Female_Sitting, Man_Sitting) hold a standing pose on
 * their first and last keyframes and the seated pose in between, so looping
 * them would flash a standing character every 8 seconds. The logical `sit`
 * clip keeps only the settled part (seconds into the clip) and ping-pongs
 * through it, so the loop has no seam.
 */
const SIT_WINDOW = Object.freeze({ start: 0.75, end: 7.9 });
// Shortest settled window worth trimming to (seconds).
const MIN_SIT_WINDOW = 0.1;

/**
 * A copy of `clip` limited to [start, end] seconds, starting at 0. Tracks
 * get their interpolated values at both ends, so tracks with keys only
 * outside the window (constant two-key tracks) keep their value.
 * @param {THREE.AnimationClip} clip
 * @param {number} start
 * @param {number} end
 */
export function trimClip(clip, start, end) {
  if (!(end > start)) throw new RangeError(`trimClip: empty window [${start}, ${end}] for clip "${clip.name}"`);
  const tracks = clip.tracks.map((track) => {
    const size = track.getValueSize();
    const interpolant = track.createInterpolant();
    const times = [start];
    const values = [...interpolant.evaluate(start)];
    track.times.forEach((t, i) => {
      if (t > start && t < end) {
        times.push(t);
        values.push(...track.values.slice(i * size, (i + 1) * size));
      }
    });
    times.push(end);
    values.push(...interpolant.evaluate(end));
    const TrackType = track.constructor;
    return new TrackType(track.name, times.map((t) => t - start), values, track.getInterpolation());
  });
  return new THREE.AnimationClip(`${clip.name}_trimmed`, end - start, tracks);
}

export class Actor {
  /** @param {import('./models.js').ModelInstance} instance */
  constructor(instance) {
    this.root = instance.root;
    this.mixer = new THREE.AnimationMixer(instance.model);
    /** @type {Record<string, THREE.AnimationAction>} */
    this.actions = {};
    for (const [logical, clipName] of Object.entries(instance.entry.clips ?? {})) {
      if (!clipName) continue;
      const clip = instance.animations.find((c) => c.name === clipName);
      if (!clip) throw new Error(`clip "${clipName}" missing in model "${instance.root.name}"`);
      if (logical === 'sit') {
        // A clip too short for the settled window (another pack's sit clip)
        // plays whole rather than as an empty trim.
        const end = Math.min(SIT_WINDOW.end, clip.duration);
        const start = Math.min(SIT_WINDOW.start, end);
        const usable = end - start >= MIN_SIT_WINDOW ? trimClip(clip, start, end) : clip;
        this.actions.sit = this.mixer.clipAction(usable);
        this.actions.sit.setLoop(THREE.LoopPingPong, Infinity);
      } else {
        this.actions[logical] = this.mixer.clipAction(clip);
      }
    }
    this.current = null;
    /** Seconds of the running cross-fade (0: switch at once). */
    this.fadeSeconds = 0;
    /**
     * Pose layers around each mixer update, in order: the seated leg fix,
     * then idle life. Each restores the clip's values before the update
     * and adds its change after it.
     * @type {Array<{ restore: () => void, apply: (dt: number) => void }>}
     */
    this.layers = [];
  }

  /** @param {string} name logical clip name */
  has(name) {
    return Boolean(this.actions[name]);
  }

  /** @param {{ restore: () => void, apply: (dt: number) => void }} layer */
  addLayer(layer) {
    this.layers.push(layer);
  }

  /**
   * Switch to a logical clip, cross-fading from the current one. Weights are
   * blended by `update` from wherever they stand, so switching back to a
   * clip that is still fading out (walk, idle, walk within the fade) carries
   * on from its current weight and time instead of restarting it (no pop).
   * @param {string} name idle, walk or sit
   * @param {{ fade?: number, startAt?: number }} [options] startAt in seconds,
   *   used only when the clip is not already playing
   */
  play(name, { fade = CROSS_FADE_SECONDS, startAt = 0 } = {}) {
    const next = this.actions[name];
    if (!next) throw new Error(`no "${name}" clip for model "${this.root.name}"`);
    if (this.current === next) return;
    const blending = fade > 0 && this.current !== null;
    if (!next.isRunning() || next.getEffectiveWeight() <= 0) {
      next.reset().setEffectiveTimeScale(1);
      next.time = startAt % next.getClip().duration;
      next.setEffectiveWeight(blending ? 0 : 1);
      next.play();
    }
    this.fadeSeconds = blending ? fade : 0;
    this.current = next;
    if (!blending) this.settleWeights(Infinity);
  }

  /** True while a cross-fade is still running. */
  get isFading() {
    for (const action of Object.values(this.actions)) {
      const target = action === this.current ? 1 : 0;
      if (action.isRunning() && action.getEffectiveWeight() !== target) return true;
    }
    return false;
  }

  /**
   * Move every running action's weight toward 1 (current) or 0 (the rest)
   * by `step`; actions that reach 0 stop.
   * @param {number} step
   */
  settleWeights(step) {
    for (const action of Object.values(this.actions)) {
      if (!action.isRunning()) continue;
      const target = action === this.current ? 1 : 0;
      const w = action.getEffectiveWeight();
      if (w === target) continue;
      const next = w < target ? Math.min(target, w + step) : Math.max(target, w - step);
      if (next === 0) action.stop();
      else action.setEffectiveWeight(next);
    }
  }

  update(dt) {
    this.settleWeights(this.fadeSeconds > 0 ? dt / this.fadeSeconds : Infinity);
    for (let i = this.layers.length - 1; i >= 0; i--) this.layers[i].restore();
    this.mixer.update(dt);
    for (const layer of this.layers) layer.apply(dt);
  }

  dispose() {
    this.mixer.stopAllAction();
    this.mixer.uncacheRoot(this.mixer.getRoot());
  }
}
