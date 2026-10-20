import { readFileSync } from 'node:fs';
import { test, expect } from './fixtures.mjs';
import { WALK_TIMEOUT } from './helpers.mjs';
import { parseLevel } from '../../public/js/lib/level.js';
import { createGrid } from '../../public/js/lib/grid.js';
import { layoutFurniture } from '../../public/js/lib/furniture.js';
import { occupiedTiles, placeCharacter } from '../../public/js/lib/seating.js';

// Clicks near characters. A click on
// a character's visible body talks; a click on the floor beside or behind it
// walks there. Picking tests the skinned meshes, not the old pick cylinders.

const read = (path) => JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8'));
const content = read('../../public/content/characters.json');
const level = parseLevel(read('../../public/content/level.json'));
const layout = layoutFurniture(level, read('../../public/content/assets.json'));
const grid = createGrid(level, [...layout.blocked, ...occupiedTiles(content, layout)]);
const byId = (id) => content.characters.find((c) => c.id === id);

// Share of a neighbouring tile that must pick the floor (not a character).
// The tile diagonally behind a character on screen (north-west, away from the
// camera) is partly hidden by the body itself, so it needs less.
const FLOOR_SHARE = 0.9;
const FLOOR_SHARE_HIDDEN = 0.4;
// Samples per tile side: offsets -0.4, -0.2, 0, 0.2, 0.4 m from the centre.
const STEPS = [-0.4, -0.2, 0, 0.2, 0.4];

async function openGame(page) {
  await page.setViewportSize({ width: 1376, height: 768 });
  await page.goto('/index.html?debug=1');
  await page.waitForFunction(() => window.__game !== undefined && document.body.classList.contains('is-ready'), null, { timeout: 30000 });
}

const playerTile = (page) => page.evaluate(() => window.__game.getPlayerTile());

/**
 * Screen position of a floor point (metres): the camera is orthographic, so
 * the floor maps to the screen affinely; three tile centres fix the map.
 */
async function floorToScreen(page) {
  const [o, ex, ez] = await page.evaluate(() => [[0, 0], [1, 0], [0, 1]]
    .map(([c, r]) => window.__game.tileToScreen(c, r)));
  return (x, z) => ({
    x: o.x + (x - 0.5) * (ex.x - o.x) + (z - 0.5) * (ez.x - o.x),
    y: o.y + (x - 0.5) * (ex.y - o.y) + (z - 0.5) * (ez.y - o.y),
  });
}

/**
 * What the pointer picks at each screen point, as the hover shows it: the
 * canvas class is-over-npc (set from the same pick a click uses, once per
 * frame), and whether the canvas is the element there (a visible nameplate
 * takes the click otherwise). True means the floor.
 */
function floorAt(page, points) {
  return page.evaluate(async (pts) => {
    const canvas = document.getElementById('scene');
    const frame = () => new Promise((resolve) => requestAnimationFrame(() => resolve()));
    const out = [];
    for (const { x, y } of pts) {
      canvas.dispatchEvent(new PointerEvent('pointermove', { clientX: x, clientY: y, bubbles: true }));
      await frame();
      out.push(document.elementFromPoint(x, y) === canvas && !canvas.classList.contains('is-over-npc'));
    }
    return out;
  }, points);
}

/**
 * Click a screen point and wait until the player stands still on `tile`.
 * The mouse rests on the grass first, so a nameplate shown by an earlier
 * hover (floorAt passes over bodies) has hidden again, as for a real pointer.
 */
async function clickAndArrive(page, p, tile) {
  await page.mouse.move(8, 60); // grass, away from everyone: hover nameplates hide
  await floorAt(page, [{ x: 8, y: 60 }]);
  await page.mouse.move(p.x, p.y);
  expect(await floorAt(page, [p]), `(${Math.round(p.x)}, ${Math.round(p.y)}) picks the floor`).toEqual([true]);
  await page.mouse.click(p.x, p.y);
  await expect.poll(() => page.evaluate(() => window.__game.isIdle() && window.__game.getPlayerTile()), {
    message: `the click at (${Math.round(p.x)}, ${Math.round(p.y)}) walks to (${tile.col}, ${tile.row})`,
    timeout: WALK_TIMEOUT,
  }).toEqual({ col: tile.col, row: tile.row });
  await expect(page.getByRole('dialog')).toHaveCount(0);
}

/** Walkable tiles around a character's own tile (its own tile too, if free: Lars's). */
function neighbourTiles(c) {
  const tiles = [];
  for (let dr = -1; dr <= 1; dr++) {
    for (let dc = -1; dc <= 1; dc++) {
      if (grid.isWalkable(c.col + dc, c.row + dr)) tiles.push({ col: c.col + dc, row: c.row + dr, dc, dr });
    }
  }
  // Walk round the character, so each walk is a short one.
  const angle = (t) => Math.atan2(t.dr, t.dc);
  return tiles.sort((a, b) => angle(a) - angle(b));
}

test('the floor right behind Lars is a tile the player walks to', async ({ page }) => {
  test.setTimeout(90000);
  await openGame(page);
  const lars = byId('lars');
  const at = await floorToScreen(page);
  // Lars stands at the counter, at the north edge of his tile; the floor at
  // his back (just south of his heels) is that tile.
  const place = placeCharacter(lars, layout);
  const behind = at(place.x, place.z + 0.6);
  expect(await floorAt(page, [behind])).toEqual([true]);
  await clickAndArrive(page, behind, { col: lars.col, row: lars.row });
  // The floor at his side, half a metre from his feet, on the tile beside
  // the counter (the old pick cylinder covered it; his body does not).
  const side = at(place.x - 0.6, place.z - 0.15);
  await clickAndArrive(page, side, { col: lars.col - 1, row: lars.row - 1 });
  // His body still talks.
  const body = await page.evaluate(() => window.__game.npcToScreen('lars'));
  expect(await floorAt(page, [body])).toEqual([false]);
  await expect(page.locator('#scene')).toHaveClass(/is-over-npc/);
});

test('walk-then-talk from behind Lars stops beside him, not at his back', async ({ page }) => {
  test.setTimeout(90000);
  await openGame(page);
  const at = await floorToScreen(page);
  // South of Lars: the tile right behind him, (9, 5), is the shortest walk,
  // but a tile at his back is used only when no other is reachable.
  await clickAndArrive(page, at(9.5, 8.5), { col: 9, row: 8 });
  const body = await page.evaluate(() => window.__game.npcToScreen('lars'));
  await page.mouse.click(body.x, body.y);
  await expect(page.getByRole('dialog')).toBeVisible({ timeout: WALK_TIMEOUT });
  expect(await playerTile(page)).toEqual({ col: 8, row: 5 });
});

test('furniture and walls in front of a body hide it from the pointer', async ({ page }) => {
  test.setTimeout(60000);
  await openGame(page);
  const at = await floorToScreen(page);
  // A world point at height y projects where the floor point (x - y, z - y)
  // does: the camera looks along (-1, -1, -1) (true isometric).
  const point = (x, y, z) => at(x - y, z - y);
  const F = { N: [0, -1], S: [0, 1], E: [1, 0], W: [-1, 0] };
  // forward (f) and to the side (s) of where the character is, in metres.
  const onBody = (id, f, s, y) => {
    const def = byId(id);
    const p = placeCharacter(def, layout);
    const [fx, fz] = F[def.facing];
    return point(p.x + fx * f - fz * s, y, p.z + fz * f + fx * s);
  };
  // Jonas's knee under the table top, and Henrik's legs behind the kitchen
  // wall: parts of their bodies, but the pointer is on the table or the
  // wall. (Without the occlusion test these picked the character.)
  const hidden = [onBody('jonas', 0.5, 0.12, 0.6), onBody('henrik', 0, -0.12, 0.3), onBody('henrik', 0, -0.12, 0.45)];
  expect(await floorAt(page, hidden)).toEqual([true, true, true]);
  // Their visible bodies still talk.
  for (const id of ['jonas', 'henrik']) {
    const body = await page.evaluate((i) => window.__game.npcToScreen(i), id);
    expect(await floorAt(page, [body]), `${id}'s chest`).toEqual([false]);
  }
});

test('the floor right behind Karim walks to the tile behind him, not beside him', async ({ page }) => {
  test.setTimeout(90000);
  await openGame(page);
  const karim = byId('karim');
  const at = await floorToScreen(page);
  // Start west of the table, where the tiles beside Karim are the shorter walk.
  await clickAndArrive(page, at(1.5, 9.5), { col: 1, row: 9 });
  // The floor just behind his chair back (his chair's tile, which blocks) ...
  const chairBack = at(karim.col + 0.85, karim.row + 0.5);
  expect(await floorAt(page, [chairBack])).toEqual([true]);
  await clickAndArrive(page, chairBack, { col: karim.col + 1, row: karim.row });
  // ... and the near edge of the tile behind him.
  await clickAndArrive(page, at(1.5, 9.5), { col: 1, row: 9 });
  const nearEdge = at(karim.col + 1.1, karim.row + 0.5);
  expect(await floorAt(page, [nearEdge])).toEqual([true]);
  await clickAndArrive(page, nearEdge, { col: karim.col + 1, row: karim.row });
});

test.describe('every walkable tile next to a character can be clicked and walked to', () => {
  for (const c of content.characters) {
    test(`${c.id}`, async ({ page }) => {
      test.setTimeout(180000);
      await openGame(page);
      const at = await floorToScreen(page);
      // The body picks the character, as the hover cursor shows.
      const body = await page.evaluate((id) => window.__game.npcToScreen(id), c.id);
      expect(await floorAt(page, [body]), `${c.id}'s body picks the character`).toEqual([false]);
      const centre = await page.evaluate((id) => window.__game.npcToScreen(id), c.id);
      const tiles = neighbourTiles(c);
      expect(tiles.length).toBeGreaterThan(0);
      for (const tile of tiles) {
        const samples = [];
        for (const v of STEPS) for (const u of STEPS) samples.push({ u, v, ...at(tile.col + 0.5 + u, tile.row + 0.5 + v) });
        const floor = await floorAt(page, samples);
        const share = floor.filter(Boolean).length / floor.length;
        const hidden = tile.dc === -1 && tile.dr === -1;
        expect(share, `share of (${tile.col}, ${tile.row}) that picks the floor`)
          .toBeGreaterThanOrEqual(hidden ? FLOOR_SHARE_HIDDEN : FLOOR_SHARE);
        // Click the floor sample nearest the character on screen whose four
        // grid neighbours are floor too, so it is not on the edge of a body
        // (this one's or another's) that breathes and turns its head.
        const isFloor = (u, v) => {
          const i = samples.findIndex((s) => Math.abs(s.u - u) < 1e-9 && Math.abs(s.v - v) < 1e-9);
          return i >= 0 && floor[i];
        };
        // The partly hidden tile may only show its edge: there, neighbours
        // off the tile do not count.
        const around = (s) => [[-0.2, 0], [0.2, 0], [0, -0.2], [0, 0.2]]
          .map(([du, dv]) => [s.u + du, s.v + dv])
          .filter(([u, v]) => !hidden || (Math.abs(u) < 0.41 && Math.abs(v) < 0.41));
        const clear = samples.filter((s, i) => floor[i] && around(s).every(([u, v]) => isFloor(u, v)));
        expect(clear.length, `(${tile.col}, ${tile.row}) has clear floor`).toBeGreaterThan(0);
        const nearest = clear.reduce((a, b) => (Math.hypot(a.x - centre.x, a.y - centre.y) <= Math.hypot(b.x - centre.x, b.y - centre.y) ? a : b));
        await clickAndArrive(page, nearest, { col: tile.col, row: tile.row });
        expect(await playerTile(page)).toEqual({ col: tile.col, row: tile.row });
      }
    });
  }
});

test('every pose of the clip and idle life stays inside the pick box and bounding spheres', async ({ page }) => {
  // The pick box and the meshes' bounding spheres are computed once per
  // character (npcs.js). Any body part outside them would drop out of
  // picking, so play each character's clip and idle life for 40 seconds,
  // with the look target circling it (head turns), and check every pose.
  test.setTimeout(120000);
  await openGame(page);
  const excess = await page.evaluate(async () => {
    const { THREE } = await import('/js/render/three.js');
    const { ModelLibrary } = await import('/js/render/models.js');
    const { createNpc } = await import('/js/render/npcs.js');
    const { parseLevel } = await import('/js/lib/level.js');
    const { layoutFurniture } = await import('/js/lib/furniture.js');
    const { placeCharacter } = await import('/js/lib/seating.js');
    const json = async (path) => (await fetch(path)).json();
    const [assets, characters, rawLevel] = await Promise.all(
      ['/content/assets.json', '/content/characters.json', '/content/level.json'].map(json));
    const layout = layoutFurniture(parseLevel(rawLevel), assets);
    const library = new ModelLibrary(assets);
    const target = new THREE.Vector3();
    const box = new THREE.Box3();
    const v = new THREE.Vector3();
    const out = {};
    for (const def of characters.characters) {
      const npc = await createNpc(library, def, placeCharacter(def, layout));
      npc.addIdleLife({ getLookTarget: () => target, neighbour: null });
      const pickBox = npc.pick.box;
      let worst = -Infinity;
      for (let step = 0; step < 1200; step++) {
        const t = step / 30;
        target.set(npc.eyes.x + 1.2 * Math.cos(t * 0.7), npc.eyes.y + 0.4 * Math.sin(t * 1.3), npc.eyes.z + 1.2 * Math.sin(t * 0.7));
        npc.actor.update(1 / 30);
        if (step % 4 !== 0) continue;
        npc.root.updateMatrixWorld(true);
        for (const proxy of npc.pick.proxies) {
          proxy.skin();
          const pos = proxy.positions;
          const sphere = proxy.mesh.boundingSphere;
          box.makeEmpty();
          for (let i = 0; i < pos.count; i++) {
            v.fromBufferAttribute(pos, i);
            worst = Math.max(worst, v.distanceTo(sphere.center) - sphere.radius);
            box.expandByPoint(v.applyMatrix4(proxy.mesh.matrixWorld));
          }
          worst = Math.max(worst,
            pickBox.min.x - box.min.x, pickBox.min.y - box.min.y, pickBox.min.z - box.min.z,
            box.max.x - pickBox.max.x, box.max.y - pickBox.max.y, box.max.z - pickBox.max.z);
        }
      }
      out[def.id] = worst;
      npc.dispose();
    }
    return out;
  });
  for (const [id, worst] of Object.entries(excess)) {
    expect(worst, `${id}: metres outside the pick box or a bounding sphere`).toBeLessThanOrEqual(0);
  }
});
