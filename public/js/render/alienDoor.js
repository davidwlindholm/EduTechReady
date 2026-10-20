// Easter egg: click the closed door at the west end
// of the hallway and the player walks up to it, the door swings open on a
// dark closet with a friendly neon-green alien in it, and closes again after a
// moment. Once only (until reload). The alien is not a character: it is not
// in characters.json, has no label and cannot be clicked.
import { THREE } from './three.js';
import { THEME } from './theme.js';
import { Actor } from './actor.js';
import { BoxBatch, WALL_THICKNESS } from './room.js';
import { disposeObject } from './dispose.js';
import { EYE_HEIGHT } from './idleLife.js';
import { tileCenter } from '../lib/movement.js';

export const DOOR_SWING_SECONDS = 0.5;
export const DOOR_HOLD_SECONDS = 1.8;
// The closet behind the door, in metres from the wall's centre line (depth)
// and from the door tile's edges (along the wall).
const CLOSET = Object.freeze({ depth: 0.8, back: 0.1, before: 0.5, after: 0, height: 2.2, roof: 0.2 });
// Where the alien stands: this far behind the wall's centre line, and this
// far along the wall from the door tile's start (the diagonal view sees the
// start side of the opening best).
const ALIEN_SPOT = Object.freeze({ depth: 0.45, along: 0.1 });
const HIT_DEPTH = 0.3;
const HIT_HEIGHT = 2.05;
// Character height after scaling.
const CHARACTER_HEIGHT = 1.7;

/** @typedef {'ready' | 'walking' | 'opening' | 'open' | 'closing' | 'done'} DoorPhase */

const ease = (t) => t * t * (3 - 2 * t);

/**
 * Bounds in world space from wall-relative coordinates: `a` across the wall
 * (0 = the wall's centre line, positive toward the walkable side), `u` along
 * it (0 = the door tile's start edge).
 */
function bounds(door, side, a0, a1, u0, u1, y0, y1) {
  const centre = door.axis === 'z' ? door.col + 0.5 : door.row + 0.5;
  const start = door.axis === 'z' ? door.row : door.col;
  const [p, q] = [centre + side * a0, centre + side * a1].sort((m, n) => m - n);
  return door.axis === 'z'
    ? { x0: p, x1: q, y0, y1, z0: start + u0, z1: start + u1 }
    : { x0: start + u0, x1: start + u1, y0, y1, z0: p, z1: q };
}

/** The dark closet: interior faces seen through the door are dark, the outside matches the walls. */
function buildCloset(door, side) {
  const dark = THEME.alien.closet;
  const room = THEME.room;
  const outer = -WALL_THICKNESS / 2;
  const { depth, back, before, after, height, roof } = CLOSET;
  const batch = new BoxBatch();
  // Floor, back wall, the wall seen from inside (start side) and the far side
  // (outside faces the camera's way, so wall coloured), then the roof.
  batch.add(bounds(door, side, outer, -depth, -before, 1 + after, 0, 0.01), dark);
  // Walls meet without overlapping, so no two faces share a plane.
  batch.add(bounds(door, side, -depth + back, -depth, -before + back, 1 + after - back, 0, height), dark);
  batch.add(bounds(door, side, outer, -depth, -before, -before + back, 0, height), dark);
  // The far side runs up to the roof top, so its outside face has no seam.
  batch.add(bounds(door, side, outer, -depth, 1 + after - back, 1 + after, 0, height + roof), room.wall, room.wallTop);
  batch.add(bounds(door, side, outer, -depth, -before, 1 + after - back, height, height + roof), room.wall, room.wallTop);
  const mesh = new THREE.Mesh(batch.build(), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1 }));
  mesh.name = 'closet';
  mesh.receiveShadow = true;
  return mesh;
}

/**
 * @param {object} options
 * @param {import('./models.js').ModelLibrary} options.library
 * @param {import('./room.js').DoorPanel} options.door the closed door
 * @param {import('../lib/level.js').Level} options.level
 * @param {import('./player.js').Player} options.player
 * @param {(npcRoot: THREE.Object3D, model: THREE.Object3D, options: { seated: boolean, eyeHeight: number }) => object} options.idleLife
 *   makes the idle-life layer for the alien (looks at the player)
 */
export async function createAlienDoor({ library, door, level, player, idleLife }) {
  const side = door.axis === 'z'
    ? (level.isWalkable(door.col + 1, door.row) ? 1 : -1)
    : (level.isWalkable(door.col, door.row + 1) ? 1 : -1);
  const front = door.axis === 'z' ? { col: door.col + side, row: door.row } : { col: door.col, row: door.row + side };

  const group = new THREE.Group();
  group.name = 'alien-door';
  const closet = buildCloset(door, side);
  group.add(closet);

  const instance = await library.instantiate(THEME.alien.model, { materialColors: THEME.alien.materialColors, merge: true });
  const actor = new Actor(instance);
  const alien = instance.root;
  alien.name = 'alien';
  const spot = bounds(door, side, -ALIEN_SPOT.depth, -ALIEN_SPOT.depth, ALIEN_SPOT.along, ALIEN_SPOT.along, 0, 0);
  alien.position.set(spot.x0, 0, spot.z0); // on the closet floor
  // Characters are 1.7 m after scaling; the alien is smaller.
  const scale = THEME.alien.height / CHARACTER_HEIGHT;
  alien.scale.setScalar(scale);
  const f = tileCenter(front.col, front.row);
  alien.rotation.y = Math.atan2(f.x - spot.x0, f.z - spot.z0);
  alien.visible = false;
  // Its eyes are lower too, so it still looks straight at the player.
  actor.addLayer(idleLife(alien, instance.model, { seated: false, eyeHeight: EYE_HEIGHT.stand * scale }));
  actor.play('idle', { fade: 0, startAt: Math.random() * 5 });
  actor.update(0);
  group.add(alien);

  // An invisible box over the door opening, for picking.
  const hit = bounds(door, side, -HIT_DEPTH / 2, HIT_DEPTH / 2, 0, 1, 0, HIT_HEIGHT);
  const hitTarget = new THREE.Mesh(
    new THREE.BoxGeometry(hit.x1 - hit.x0, hit.y1 - hit.y0, hit.z1 - hit.z0),
    new THREE.MeshBasicMaterial({ visible: false }),
  );
  hitTarget.position.set((hit.x0 + hit.x1) / 2, (hit.y0 + hit.y1) / 2, (hit.z0 + hit.z1) / 2);
  hitTarget.userData.door = true;
  group.add(hitTarget);

  /** @type {DoorPhase} */
  let phase = 'ready';
  let time = 0;
  let walkToken = 0;

  function setAngle(t) {
    door.pivot.rotation.y = door.openAngle * ease(Math.min(1, Math.max(0, t)));
  }

  return {
    group,
    hitTarget,
    /** @returns {DoorPhase} */
    get phase() {
      return phase;
    },
    /** True while a click on the door starts (or restarts) the walk to it. */
    get clickable() {
      return phase === 'ready' || phase === 'walking';
    },

    /** Walk to the tile in front of the door; open it on arrival. */
    trigger() {
      if (phase !== 'ready' && phase !== 'walking') return;
      phase = 'walking';
      const token = ++walkToken;
      const walk = player.moveTo(front.col, front.row);
      walk.arrived.then((arrived) => {
        if (token !== walkToken || phase !== 'walking') return;
        if (!arrived || !walk.reached) {
          phase = 'ready'; // walked away (another click) before arriving
          return;
        }
        // Face the door, then open it. From here the sequence always finishes.
        const c = tileCenter(door.col, door.row);
        player.heading = Math.atan2(c.x - f.x, c.z - f.z);
        phase = 'opening';
        time = 0;
        alien.visible = true;
      });
    },

    update(dt) {
      if (phase === 'opening' || phase === 'open' || phase === 'closing') {
        time += dt;
        actor.update(dt);
      }
      if (phase === 'opening') {
        setAngle(time / DOOR_SWING_SECONDS);
        if (time >= DOOR_SWING_SECONDS) {
          phase = 'open';
          time = 0;
        }
      } else if (phase === 'open' && time >= DOOR_HOLD_SECONDS) {
        phase = 'closing';
        time = 0;
      } else if (phase === 'closing') {
        setAngle(1 - time / DOOR_SWING_SECONDS);
        if (time >= DOOR_SWING_SECONDS) {
          setAngle(0);
          alien.visible = false;
          phase = 'done';
        }
      }
    },

    dispose() {
      actor.dispose();
      instance.dispose();
      group.removeFromParent();
      disposeObject(closet);
      disposeObject(hitTarget);
    },
  };
}
