// The player: walks A* paths (lib/pathfinding.js) along tile centres with
// smoothed corners, turning toward the direction of travel.
import { findPath } from '../lib/pathfinding.js';
import {
  WALK_SPEED, TURN_SPEED, facingToRotation, followRoute, headingOf, smoothCorners, tileAt, tileCenter, turnToward,
  wrapAngle,
} from '../lib/movement.js';

// Turns closer than this (radians) count as done.
const TURN_EPSILON = 1e-4;

export class Player {
  /**
   * @param {import('./actor.js').Actor} actor
   * @param {{ col: number, row: number, facing: string }} start
   * @param {Pick<import('../lib/grid.js').Grid, 'cols' | 'rows' | 'isWalkable'>} grid
   */
  constructor(actor, start, grid) {
    this.actor = actor;
    this.root = actor.root;
    this.grid = grid;
    const c = tileCenter(start.col, start.row);
    this.root.position.set(c.x, 0, c.z);
    this.root.rotation.y = facingToRotation(start.facing);
    this.heading = this.root.rotation.y;
    /** @type {{ x: number, z: number }[] | null} points still to walk; null at rest */
    this.route = null;
    this.routeIndex = 0;
    /** @type {{ col: number, row: number } | null} */
    this.goal = null;
    /** @type {((arrived: boolean) => void) | null} settles the current walk */
    this.settle = null;
    /** @type {((turned: boolean) => void) | null} settles the current faceToward */
    this.settleTurn = null;
    actor.play('idle', { fade: 0 });
  }

  get isMoving() {
    return this.route !== null;
  }

  /** Still turning toward the heading it was given. */
  get isTurning() {
    return Math.abs(wrapAngle(this.root.rotation.y - this.heading)) > TURN_EPSILON;
  }

  /**
   * At rest: not walking, not turning, and no animation cross-fade running
   * (what the debug API's isIdle() reports).
   */
  get isSettled() {
    return !this.isMoving && !this.isTurning && !this.actor.isFading;
  }

  /** @returns {{ x: number, z: number }} where the player stands, in metres */
  get position() {
    return { x: this.root.position.x, z: this.root.position.z };
  }

  /** @returns {{ col: number, row: number }} */
  get tile() {
    return tileAt(this.root.position.x, this.root.position.z);
  }

  /**
   * Walk to a tile along an A* path from the current position. During a walk
   * this re-paths from the tile the player is on, without first returning to
   * its centre. An unreachable target sends the player to the closest
   * reachable tile instead (see findPath).
   *
   * @param {number} col
   * @param {number} row
   * @param {{ onArrive?: () => void }} [options] onArrive runs once on arrival
   *   (at once if the player already stands on its centre); it does not run
   *   if a newer moveTo or stop() cancels this walk.
   * @returns {{ goal: { col: number, row: number }, reached: boolean, arrived: Promise<boolean> }}
   *   goal is the tile the player walks to and reached says whether it is the
   *   requested tile. `arrived` resolves true on arrival, or false if a newer
   *   moveTo or stop() cancels the walk first. It never rejects.
   */
  moveTo(col, row, { onArrive } = {}) {
    this.cancel();
    const pos = this.root.position;
    const { path, goal, reached } = findPath(this.grid, this.tile, { col, row });
    const centre = tileCenter(goal.col, goal.row);
    if (!path.length && Math.hypot(centre.x - pos.x, centre.z - pos.z) < 1e-6) {
      this.actor.play('idle');
      onArrive?.();
      return { goal, reached, arrived: Promise.resolve(true) };
    }
    // From where the player stands, through the remaining tile centres. An
    // empty path (already on the goal tile) still walks to its centre.
    const centres = (path.length ? path : [goal]).map((t) => tileCenter(t.col, t.row));
    this.route = smoothCorners([{ x: pos.x, z: pos.z }, ...centres]);
    this.routeIndex = 1;
    this.goal = goal;
    const arrived = new Promise((resolve) => {
      this.settle = (ok) => {
        if (ok) onArrive?.();
        resolve(ok);
      };
    });
    this.actor.play('walk');
    return { goal, reached, arrived };
  }

  /**
   * Turn on the spot toward a world point.
   * @param {number} x
   * @param {number} z
   * @returns {Promise<boolean>} true once facing it; false if a moveTo, stop()
   *   or another faceToward interrupts the turn. Never rejects.
   */
  faceToward(x, z) {
    this.cancelTurn();
    const pos = this.root.position;
    const dx = x - pos.x;
    const dz = z - pos.z;
    if (Math.hypot(dx, dz) > 1e-6) this.heading = headingOf(dx, dz);
    if (!this.isTurning) return Promise.resolve(true);
    return new Promise((resolve) => {
      this.settleTurn = resolve;
    });
  }

  cancelTurn() {
    const settle = this.settleTurn;
    this.settleTurn = null;
    settle?.(false);
  }

  /** Stop where the player stands; a pending walk settles as cancelled. */
  stop() {
    this.cancel();
    this.actor.play('idle');
  }

  /** Drop the current route without changing the animation. */
  cancel() {
    this.cancelTurn();
    const settle = this.settle;
    this.settle = null;
    this.route = null;
    this.goal = null;
    settle?.(false);
  }

  update(dt) {
    if (this.route) {
      const pos = this.root.position;
      const step = followRoute(this.route, this.routeIndex, pos, WALK_SPEED * dt);
      pos.x = step.x;
      pos.z = step.z;
      this.routeIndex = step.index;
      if (step.dx !== 0 || step.dz !== 0) this.heading = headingOf(step.dx, step.dz);
      if (step.arrived) {
        const settle = this.settle;
        this.settle = null;
        this.route = null;
        this.goal = null;
        this.actor.play('idle');
        settle?.(true);
      }
    }
    this.root.rotation.y = turnToward(this.root.rotation.y, this.heading, TURN_SPEED * dt);
    if (this.settleTurn && !this.isTurning) {
      const settle = this.settleTurn;
      this.settleTurn = null;
      settle(true);
    }
    this.actor.update(dt);
  }
}
