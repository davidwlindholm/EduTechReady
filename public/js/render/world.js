// The 3D world: scene, camera, lights, room, player and NPCs, plus the
// projections the UI and the debug API need. No DOM overlays here.
import { THREE } from './three.js';
import { THEME } from './theme.js';
import { createRenderers } from './renderer.js';
import { createIsoCamera, frameLevel } from './camera.js';
import { addLights } from './lights.js';
import { createRoom } from './room.js';
import { createOutside } from './outside.js';
import { createAlienDoor } from './alienDoor.js';
import { createIdleLifeLayer, EYE_HEIGHT } from './idleLife.js';
import { createFurniture } from './furniture.js';
import { ModelLibrary } from './models.js';
import { Actor } from './actor.js';
import { Player } from './player.js';
import { createNpc } from './npcs.js';
import { Picker } from './picking.js';
import { createPlayerRing, createClickMarker } from './markers.js';
import { tileCenter } from '../lib/movement.js';
import { placeCharacter } from '../lib/seating.js';
import { declutterLabels } from '../lib/labels.js';
import { FULL_WALL_HEIGHT } from '../lib/level.js';
import { IDLE_LIFE, nearestWithin } from '../lib/idleLife.js';

// Tallest point kept in frame: the full walls, which also clears
// the label tops above standing characters.
const FRAME_HEIGHT = FULL_WALL_HEIGHT;
// Longest frame step fed to animation, so a background tab does not teleport the player.
const MAX_FRAME_SECONDS = 0.1;
// One metre along the screen's horizontal axis: the camera looks from
// target + (d, d, d), so screen right is (1, 0, -1) / sqrt(2).
const SCREEN_RIGHT = Object.freeze({ x: Math.SQRT1_2, z: -Math.SQRT1_2 });
// Pixels kept between a label and other labels or characters.
const LABEL_SPACING = 2;
// The player's head and torso, as an obstacle for labels (as a standing NPC, npcs.js).
const PLAYER_BODY = Object.freeze({ top: 1.7, hip: 0.8, width: 0.5 });
// Obstacle id for the player: never a character id (those have no spaces), so no label skips it.
const PLAYER_OBSTACLE_ID = ' player';
// Player movement (metres) that re-runs the label layout while a label shows.
const RELAYOUT_DISTANCE = 0.02;

/**
 * @param {object} options
 * @param {HTMLCanvasElement} options.canvas
 * @param {HTMLElement} options.labelHost
 * @param {object} options.assets parsed assets.json
 * @param {object} options.characters parsed characters.json
 * @param {import('../lib/level.js').Level} options.level
 * @param {import('../lib/grid.js').Grid} options.grid
 * @param {import('../lib/furniture.js').FurnitureLayout} options.furniture validated furniture and props
 * @param {(fraction: number) => void} [options.onProgress] model download progress, 0 to 1 (loading screen)
 */
export async function createWorld({ canvas, labelHost, assets, characters, level, grid, furniture: layout, onProgress = null }) {
  const renderers = createRenderers(canvas, labelHost);
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(THEME.background);
  // The whole level, so framing uses its centre.
  const bounds = { minX: 0, maxX: level.cols, minZ: 0, maxZ: level.rows, height: FRAME_HEIGHT };
  const lights = addLights(scene, bounds);
  const room = createRoom(level);
  scene.add(room.group);
  const outside = createOutside();
  scene.add(outside.group);
  const camera = createIsoCamera();

  const library = new ModelLibrary(assets, '', { onProgress });
  // Every model this world loads, so the progress bar knows the total up front.
  library.expect(new Set([
    ...layout.items.map((i) => i.asset), ...layout.props.map((p) => p.asset),
    characters.player.model, ...characters.characters.map((c) => c.model),
    ...(THEME.alien.enabled && room.doors.length > 0 ? [THEME.alien.model] : []),
  ]));
  // Every character, standing or seated on its chair or sofa (placeCharacter
  // throws for a seat that is missing or faces the wrong way).
  const placements = characters.characters.map((def) => placeCharacter(def, layout));
  const [furniture, playerInstance, ...npcList] = await Promise.all([
    createFurniture(library, level, layout),
    library.instantiate(characters.player.model, { materialColors: characters.player.materialColors, merge: true }),
    ...characters.characters.map((def, i) => createNpc(library, def, placements[i])),
  ]);
  scene.add(furniture.group);
  /** Extra scene parts (the debug grid overlay) released with the world. */
  const adopted = [];
  const player = new Player(new Actor(playerInstance), level.playerStart, grid);
  const ring = createPlayerRing();
  player.root.add(ring.group);
  scene.add(player.root);
  const clickMarker = createClickMarker();
  scene.add(clickMarker.group);
  /** @type {Map<string, import('./npcs.js').Npc>} */
  const npcs = new Map(npcList.map((npc) => [npc.id, npc]));
  npcList.forEach((npc) => scene.add(npc.root));

  // Idle life: everyone looks at the player when close and in
  // front of them; seated characters now and then glance at their nearest neighbour.
  const playerEyes = new THREE.Vector3();
  const getLookTarget = () => playerEyes;
  const eyes = npcList.map((npc) => npc.eyes);
  npcList.forEach((npc, i) => {
    const near = npc.seated ? nearestWithin(eyes, i, IDLE_LIFE.lookRange) : -1;
    npc.addIdleLife({ getLookTarget, neighbour: near >= 0 ? eyes[near] : null });
  });

  // The closed door's easter egg (one closed door in the starting map);
  // THEME.alien.enabled switches it off.
  const closedDoor = THEME.alien.enabled ? room.doors[0] ?? null : null;
  const alienDoor = closedDoor && await createAlienDoor({
    library, door: closedDoor, level, player,
    idleLife: (root, model, options) => createIdleLifeLayer(root, model, { ...options, getLookTarget }),
  });
  if (alienDoor) scene.add(alienDoor.group);
  // Furniture and opaque walls hide characters from the pointer (picking.js).
  const picker = new Picker(camera, canvas, [...room.occluders, ...furniture.group.children]);

  // Labels are hidden until hovered or the player comes into talking range
  // (see setNameplates). Visible labels are re-stacked when the set changes,
  // after a resize, and while the player (an obstacle) moves.
  let labelsDirty = true;
  /** @type {Set<string>} ids whose label shows */
  let shownLabels = new Set();
  const laidOutAt = { x: NaN, z: NaN };
  function resize() {
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    if (!width || !height) return;
    renderers.setSize(width, height);
    frameLevel(camera, bounds, width / height);
    outside.fit(camera);
    labelsDirty = true;
  }

  /** Screen box of a body's head and torso (hips to head top), for declutter. */
  function bodyBox(id, p, body) {
    const hip = worldToScreen(p.x, p.y + body.hip, p.z);
    const head = worldToScreen(p.x, p.y + body.top, p.z);
    const side = worldToScreen(p.x + SCREEN_RIGHT.x, p.y + body.top, p.z + SCREEN_RIGHT.z);
    return {
      id,
      x: head.x,
      y: (hip.y + head.y) / 2,
      w: Math.abs(side.x - head.x) * body.width,
      h: hip.y - head.y,
    };
  }

  /**
   * Move visible labels that would cover each other, another character or
   * the player (lib/labels.js). Hidden labels are left out. Needs rendered
   * labels for their sizes. The offsets go into the CSS2D anchor point
   * (`center`), so they are plain pixels.
   * @returns {boolean} false when some label is not laid out yet (try again next frame)
   */
  function declutter() {
    const boxes = [];
    const bodies = [];
    for (const npc of npcList) {
      const p = npc.root.position;
      bodies.push(bodyBox(npc.id, p, npc.body));
      if (!shownLabels.has(npc.id)) continue;
      const el = npc.label.element;
      if (!el.offsetWidth) return false; // not laid out yet (hidden canvas, first frame)
      // The label's bottom centre sits at the anchor (npcs.js).
      const anchor = worldToScreen(p.x, p.y + npc.labelHeight, p.z);
      boxes.push({ id: npc.id, x: anchor.x, y: anchor.y - el.offsetHeight / 2, w: el.offsetWidth, h: el.offsetHeight });
    }
    const pp = player.root.position;
    bodies.push(bodyBox(PLAYER_OBSTACLE_ID, pp, PLAYER_BODY));
    laidOutAt.x = pp.x;
    laidOutAt.z = pp.z;
    declutterLabels(boxes, LABEL_SPACING, bodies).forEach(({ dx, dy }, id) => {
      const { label } = npcs.get(id);
      const el = label.element;
      label.center.set(0.5 - dx / el.offsetWidth, 1 - dy / el.offsetHeight);
    });
    return true;
  }

  /** While a label shows, a moving player is a moving obstacle. */
  function playerMovedSinceLayout() {
    const p = player.root.position;
    return shownLabels.size > 0
      && !(Math.hypot(p.x - laidOutAt.x, p.z - laidOutAt.z) < RELAYOUT_DISTANCE);
  }

  // Each character's position in metres (the tucked seat for a seated one),
  // for the talking range (lib/talk.js).
  /** @type {Map<string, { x: number, z: number, facing: string }>} (facing: chooseTalkTile avoids their backs) */
  const places = new Map(characters.characters.map((def, i) => [def.id, Object.freeze({ x: placements[i].x, z: placements[i].z, facing: def.facing })]));

  const projected = new THREE.Vector3();
  /** CSS pixel coordinates (viewport) of a world point. */
  function worldToScreen(x, y, z) {
    const rect = canvas.getBoundingClientRect();
    projected.set(x, y, z).project(camera);
    return {
      x: rect.left + ((projected.x + 1) / 2) * rect.width,
      y: rect.top + ((1 - projected.y) / 2) * rect.height,
    };
  }

  return {
    scene,
    camera,
    player,
    npcs,
    grid,
    renderer: renderers.renderer,
    resize,
    /** Character id -> position in metres (seat position for seated characters). */
    places,

    /**
     * Show exactly these characters' labels (with a short CSS fade); the
     * rest hide and stop taking pointer events.
     * @param {Set<string>} ids
     */
    setNameplates(ids) {
      let changed = false;
      for (const npc of npcList) {
        const show = ids.has(npc.id);
        if (show === shownLabels.has(npc.id)) continue;
        npc.label.element.classList.toggle('is-visible', show);
        changed = true;
      }
      if (!changed) return;
      shownLabels = new Set(ids);
      labelsDirty = true;
    },

    /**
     * Turn the sun's shadows on or off (the settings toggle). Both
     * the light and the renderer's shadow pass switch, so off saves the
     * whole shadow-map render; three.js recompiles the lit materials once.
     * @param {boolean} on
     */
    setShadows(on) {
      lights.sun.castShadow = on;
      renderers.renderer.shadowMap.enabled = on;
      renderers.renderer.shadowMap.needsUpdate = true;
    },

    /** @returns {boolean} whether shadows are on */
    get shadows() {
      return lights.sun.castShadow;
    },

    /**
     * Add a part to the scene and dispose it with the world.
     * @param {{ group: THREE.Object3D, dispose: () => void }} part
     */
    adopt(part) {
      scene.add(part.group);
      adopted.push(part);
    },

    /** @param {(seconds: number) => void} [onFrame] called after each render */
    start(onFrame) {
      let last = null;
      // three.js schedules the next frame only after the callback returns, so
      // an uncaught exception would stop rendering for good. Each stage runs
      // on its own: a failing update cannot stop the render, and the first
      // failure is logged once instead of every frame.
      let reported = false;
      const guard = (stage) => {
        try {
          stage();
        } catch (err) {
          if (reported) return;
          reported = true;
          console.error('Frame update failed; the game keeps rendering', err);
        }
      };
      let dt = 0;
      const animate = () => {
        player.update(dt);
        playerEyes.copy(player.root.position);
        playerEyes.y += EYE_HEIGHT.stand;
        clickMarker.update(dt);
        alienDoor?.update(dt);
        npcs.forEach((npc) => npc.actor.update(dt));
      };
      const draw = () => renderers.render(scene, camera);
      const afterDraw = () => {
        if (labelsDirty || playerMovedSinceLayout()) labelsDirty = !declutter();
        onFrame?.(dt);
      };
      renderers.renderer.setAnimationLoop((now) => {
        dt = last === null ? 0 : Math.min((now - last) / 1000, MAX_FRAME_SECONDS);
        last = now;
        guard(animate);
        guard(draw);
        guard(afterDraw);
      });
    },

    /** Stop rendering and free every GPU resource and label the world created. */
    async dispose() {
      renderers.renderer.setAnimationLoop(null);
      player.cancel();
      player.actor.dispose();
      ring.dispose();
      clickMarker.dispose();
      playerInstance.dispose();
      npcs.forEach((npc) => npc.dispose());
      npcs.clear();
      adopted.splice(0).forEach((part) => part.dispose());
      alienDoor?.dispose();
      furniture.dispose();
      outside.dispose();
      room.dispose();
      lights.sun.dispose(); // frees the shadow map
      lights.hemi.dispose();
      lights.fill.dispose();
      await library.dispose();
      scene.clear();
      renderers.dispose();
    },

    /**
     * Walk the player to a clicked tile (or the closest reachable one) and
     * flash the click marker on the tile it walks to.
     * @returns {ReturnType<Player['moveTo']>}
     */
    walkTo(col, row) {
      const walk = player.moveTo(col, row);
      const c = tileCenter(walk.goal.col, walk.goal.row);
      clickMarker.show(c.x, c.z);
      return walk;
    },

    /** @returns {ReturnType<Picker['pick']>} */
    pick(clientX, clientY) {
      return picker.pick(clientX, clientY, npcList, alienDoor?.clickable ? alienDoor.hitTarget : null);
    },

    /** Phase of the closed door's easter egg ('ready' to 'done'), or null without one. */
    get doorPhase() {
      return alienDoor ? alienDoor.phase : null;
    },

    /** Walk to the closed door and open it (once; see render/alienDoor.js). */
    openDoor() {
      alienDoor?.trigger();
    },

    tileToScreen(col, row) {
      const c = tileCenter(col, row);
      return worldToScreen(c.x, 0, c.z);
    },

    npcToScreen(id) {
      const npc = npcs.get(id);
      if (!npc) return null;
      const p = npc.clickPoint;
      return worldToScreen(p.x, p.y, p.z);
    },
  };
}
