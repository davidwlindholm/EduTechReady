import { test, expect } from './fixtures.mjs';
import { WALK_TIMEOUT } from './helpers.mjs';

// Grass and a path outside, Henrik at
// the hallway's east end, the closed door's alien easter egg, and idle life.
// The debug API is kept unchanged, so the door's state is read from the body's
// data-door-phase attribute and everything visual from screenshot pixels.

async function openGame(page, size = { width: 1376, height: 768 }) {
  await page.setViewportSize(size);
  await page.goto('/index.html?debug=1');
  await page.waitForFunction(() => window.__game !== undefined && document.body.classList.contains('is-ready'), null, { timeout: 30000 });
}

/** Hide the HTML layers (menu, debug HUD, labels), so pixels come from the canvas alone. */
async function hideOverlays(page, hidden = true) {
  await page.evaluate((h) => {
    for (const id of ['overlays', 'labels']) document.getElementById(id).style.visibility = h ? 'hidden' : '';
  }, hidden);
}

/**
 * RGBA pixels of a screenshot region, decoded in the page (a data: image is
 * allowed by the CSP's img-src). Returns { width, height, data }.
 */
async function pixels(page, clip) {
  const png = (await page.screenshot({ clip })).toString('base64');
  return page.evaluate(async (b64) => {
    const img = new Image();
    img.src = `data:image/png;base64,${b64}`;
    await img.decode();
    const c = document.createElement('canvas');
    c.width = img.width;
    c.height = img.height;
    const ctx = c.getContext('2d');
    ctx.drawImage(img, 0, 0);
    return { width: c.width, height: c.height, data: [...ctx.getImageData(0, 0, c.width, c.height).data] };
  }, png);
}

/**
 * Screen projection of any world point, built from three tile centres (the
 * camera is orthographic and true isometric; see room.spec.mjs).
 */
async function projector(page, col, row) {
  const tile = (c, r) => page.evaluate(([cc, rr]) => window.__game.tileToScreen(cc, rr), [c, r]);
  const o = await tile(col, row);
  const ex = await tile(col + 1, row);
  const ez = await tile(col, row + 1);
  const vx = { x: ex.x - o.x, y: ex.y - o.y };
  const vz = { x: ez.x - o.x, y: ez.y - o.y };
  const vy = { x: -(vx.x + vz.x), y: -(vx.y + vz.y) };
  return (x, y, z) => ({
    x: o.x + (x - col - 0.5) * vx.x + y * vy.x + (z - row - 0.5) * vz.x,
    y: o.y + (x - col - 0.5) * vx.y + y * vy.y + (z - row - 0.5) * vz.y,
  });
}

const isGrass = ([r, g, b]) => g > r + 8 && g > b + 25 && g > 120 && g < 230;
// The alien's neon green (THEME.alien), far brighter than the grass outside.
const isNeonGreen = ([r, g, b]) => g > 150 && g > r + 70 && g > b + 70;

function countPixels({ data }, predicate) {
  let n = 0;
  for (let i = 0; i < data.length; i += 4) if (predicate([data[i], data[i + 1], data[i + 2]])) n++;
  return n;
}

test('grass all round the building at any window size, with the path and Henrik', async ({ page }) => {
  test.setTimeout(90000);
  await openGame(page);
  await hideOverlays(page);
  for (const size of [{ width: 1376, height: 768 }, { width: 600, height: 900 }, { width: 1920, height: 1080 }, { width: 1600, height: 400 }]) {
    await page.setViewportSize(size);
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
    // The renderer's clear colour is grey (THEME.background), so green here
    // comes from the ground mesh, fitted to this view. Corners and edge middles.
    const inset = 6;
    const xs = [inset, Math.round(size.width / 2), size.width - inset];
    const ys = [inset, Math.round(size.height / 2), size.height - inset];
    for (const x of xs) {
      for (const y of ys) {
        if (x === xs[1] && y === ys[1]) continue; // the building
        const px = await pixels(page, { x: x - 2, y: y - 2, width: 4, height: 4 });
        const rgb = px.data.slice(0, 3);
        expect(isGrass(rgb), `${size.width}x${size.height} edge point (${x}, ${y}) is grass green, got ${rgb}`).toBe(true);
      }
    }
  }

  // The path: west of the window wall, beside the middle of the room, it is
  // gravel coloured (not green); further out it is grass again.
  await page.setViewportSize({ width: 1376, height: 768 });
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  const project = await projector(page, 0, 6);
  const onPath = project(-1.35, 0, 6.5);
  const beyond = project(-3.5, 0, 9.5);
  const pathPx = (await pixels(page, { x: Math.round(onPath.x) - 2, y: Math.round(onPath.y) - 2, width: 4, height: 4 })).data.slice(0, 3);
  const grassPx = (await pixels(page, { x: Math.round(beyond.x) - 2, y: Math.round(beyond.y) - 2, width: 4, height: 4 })).data.slice(0, 3);
  expect(isGrass(pathPx), `path pixel ${pathPx}`).toBe(false);
  expect(pathPx[0], 'the path is lighter than the grass').toBeGreaterThan(grassPx[0] + 30);
  expect(isGrass(grassPx), `grass beyond the path ${grassPx}`).toBe(true);

  // It runs past both ends of the building to the edges of the view: along
  // its centre line, the last on-screen points north and south are still path.
  const margin = 8;
  const onScreen = ({ x, y }) => x >= margin && y >= margin && x <= 1376 - margin && y <= 768 - margin;
  let north = null;
  let south = null;
  for (let z = -40; z <= 60; z += 0.1) {
    const p = project(-1.35, 0, z);
    if (!onScreen(p)) continue;
    north ??= { z, p };
    south = { z, p };
  }
  const rows = (await (await page.request.get('/content/level.json')).json()).rows.length;
  expect(north.z, 'the path is seen north of the building').toBeLessThan(-1);
  expect(south.z, 'the path is seen south of the building').toBeGreaterThan(rows + 1);
  for (const [name, end] of [['north', north], ['south', south]]) {
    // Leaving the screen just beyond this point, so the path reaches the edge.
    expect(onScreen(project(-1.35, 0, end.z + (name === 'north' ? -0.2 : 0.2))), `${name} end is at the view's edge`).toBe(false);
    const rgb = (await pixels(page, { x: Math.round(end.p.x) - 2, y: Math.round(end.p.y) - 2, width: 4, height: 4 })).data.slice(0, 3);
    expect(isGrass(rgb), `${name} end of the path at z ${end.z.toFixed(1)}, got ${rgb}`).toBe(false);
    expect(rgb[0], `${name} end of the path is lighter than the grass`).toBeGreaterThan(grassPx[0] + 30);
  }

  await hideOverlays(page, false);
  await expect(page.locator('.npc-label[data-npc-id="henrik"] .npc-label__name')).toHaveText('Henrik');
  await page.waitForFunction(() => window.__game.isIdle());
  await page.waitForTimeout(500); // labels and shadows settle
  await page.screenshot({ path: 'docs/screenshots/scene-extras-scene.png' });
});

test('Henrik is a character like the others and blocks his tile', async ({ page }) => {
  test.setTimeout(90000);
  await openGame(page);
  const content = await (await page.request.get('/content/characters.json')).json();
  const henrik = content.characters.find((c) => c.id === 'henrik');
  expect(henrik).toMatchObject({ name: 'Henrik (Pædagogisk konsulent)', pose: 'stand', facing: 'W' });
  expect([1, 2]).toContain(henrik.row);
  expect(henrik.col).toBe(8);

  // A click on the floor of his tile, at its corner nearest the camera (the
  // ray there misses his body), stops the player beside him.
  const project = await projector(page, henrik.col, henrik.row);
  const corner = project(henrik.col + 0.92, 0, henrik.row + 0.92);
  await page.mouse.click(corner.x, corner.y);
  await page.waitForFunction(() => !window.__game.isIdle(), null, { timeout: 5000 });
  await page.waitForFunction(() => window.__game.isIdle(), null, { timeout: 60000, polling: 100 });
  const tile = await page.evaluate(() => window.__game.getPlayerTile());
  expect(tile).not.toEqual({ col: henrik.col, row: henrik.row });
  expect(Math.max(Math.abs(tile.col - henrik.col), Math.abs(tile.row - henrik.row))).toBe(1);

  // Hover shows the pointer; a click opens his dialogue (the player is
  // already in talking range) and marks him as met.
  const p = await page.evaluate(() => window.__game.npcToScreen('henrik'));
  await page.mouse.move(p.x, p.y);
  await expect(page.locator('#scene')).toHaveClass(/is-over-npc/);
  await page.mouse.click(p.x, p.y);
  const dialogue = page.getByRole('dialog', { name: henrik.name });
  await expect(dialogue).toBeVisible({ timeout: WALK_TIMEOUT });
  await expect(dialogue.locator('.dialogue__line')).toHaveText(henrik.greeting);
  expect(await page.evaluate(() => window.__game.getState().met)).toContain('henrik');
  await page.keyboard.press('Escape');
  await expect(dialogue).toBeHidden();
});

// Twice the pixels, so the close-up screenshot of the alien is sharp.
test.describe('door easter egg', () => {
  test.use({ deviceScaleFactor: 2 });

  test('the closed door opens on a green alien once, then stays shut', async ({ page }) => {
    test.setTimeout(120000);
    await openGame(page);
    const phase = () => page.evaluate(() => document.body.dataset.doorPhase);
    await expect.poll(phase).toBe('ready');
    const project = await projector(page, 0, 1);
    const door = project(0.5, 1.0, 1.5);
    const alienBox = (() => {
      const top = project(0.05, 1.8, 1.1);
      const bottom = project(0.05, 0.2, 1.1);
      const half = Math.abs(top.y - bottom.y) * 0.35;
      return { x: Math.round(top.x - half), y: Math.round(top.y), width: Math.round(half * 2), height: Math.round(bottom.y - top.y) };
    })();
    const greenPixels = async () => {
      await hideOverlays(page);
      const n = countPixels(await pixels(page, alienBox), isNeonGreen);
      await hideOverlays(page, false);
      return n;
    };
    expect(await greenPixels(), 'no alien before the door opens').toBe(0);

    // Hover: pointer cursor. A click elsewhere before arriving cancels the walk.
    await page.mouse.move(door.x, door.y);
    await expect(page.locator('#scene')).toHaveClass(/is-over-door/);
    await page.mouse.click(door.x, door.y);
    await expect.poll(phase).toBe('walking');
    const away = await page.evaluate(() => window.__game.tileToScreen(10, 9));
    await page.mouse.click(away.x, away.y);
    await expect.poll(phase).toBe('ready');
    await page.waitForFunction(() => window.__game.isIdle(), null, { timeout: 60000, polling: 100 });

    // Click the door again and let the player arrive: it opens on the alien.
    await page.mouse.click(door.x, door.y);
    await page.waitForFunction(() => document.body.dataset.doorPhase === 'open', null, { timeout: 90000 });
    expect(await page.evaluate(() => window.__game.getPlayerTile())).toEqual({ col: 1, row: 1 });
    // The pointer has stayed on the door since the click: once the door can
    // no longer be clicked, its pointer cursor goes without a pointer move.
    await expect(page.locator('#scene')).not.toHaveClass(/is-over-door/);
    // A transition runs while the door is open (debug API isIdle).
    expect(await page.evaluate(() => window.__game.isIdle())).toBe(false);
    expect(await greenPixels(), 'the alien stands in the open doorway').toBeGreaterThan(40);
    const shot = project(0.6, 1.2, 1.6);
    await page.screenshot({ path: 'docs/screenshots/scene-extras-alien.png', clip: { x: Math.round(shot.x - 230), y: Math.max(0, Math.round(shot.y - 150)), width: 460, height: 300 } });

    // A click elsewhere once it is open does not stop the sequence.
    const hallway = await page.evaluate(() => window.__game.tileToScreen(3, 2));
    await page.mouse.click(hallway.x, hallway.y);
    await page.waitForFunction(() => document.body.dataset.doorPhase === 'done', null, { timeout: 30000 });
    expect(await greenPixels(), 'the alien is gone once the door is shut').toBe(0);

    // Done for good: no pointer, and a click on the door is a plain floor click.
    await page.waitForFunction(() => window.__game.isIdle(), null, { timeout: 60000, polling: 100 });
    await page.mouse.move(door.x, door.y);
    await expect(page.locator('#scene')).not.toHaveClass(/is-over-door/);
    await page.mouse.click(door.x, door.y);
    await page.waitForFunction(() => window.__game.isIdle(), null, { timeout: 60000, polling: 100 });
    expect(await phase()).toBe('done');
    expect(await greenPixels()).toBe(0);
  });
});

test('a seated character turns its head toward the player', async ({ page }) => {
  test.setTimeout(90000);
  await openGame(page);
  const walk = async (col, row) => {
    const p = await page.evaluate(([c, r]) => window.__game.tileToScreen(c, r), [col, row]);
    await page.mouse.click(p.x, p.y);
    await page.waitForFunction(() => !window.__game.isIdle(), null, { timeout: 5000 });
    await page.waitForFunction(() => window.__game.isIdle(), null, { timeout: 60000, polling: 100 });
  };
  // Sofie sits on the sofa facing north. Her head, from her click point
  // (her chest) half a metre up.
  const project = await projector(page, 7, 9);
  const mid = await page.evaluate(() => window.__game.npcToScreen('sofie'));
  const up = project(7.5, 0.5, 9.5);
  const base = project(7.5, 0, 9.5);
  const head = { x: mid.x + (up.x - base.x), y: mid.y + (up.y - base.y) };
  const clip = { x: Math.round(head.x - 14), y: Math.round(head.y - 14), width: 28, height: 28 };

  const changedPixels = (a, b) => {
    let n = 0;
    for (let i = 0; i < a.data.length; i += 4) {
      const d = Math.abs(a.data[i] - b.data[i]) + Math.abs(a.data[i + 1] - b.data[i + 1]) + Math.abs(a.data[i + 2] - b.data[i + 2]);
      if (d > 40) n++;
    }
    return n;
  };
  const headPixels = async () => {
    await hideOverlays(page);
    const px = await pixels(page, clip);
    await hideOverlays(page, false);
    return px;
  };

  // Out of her sight first (behind her table, more than 2.5 m away), then in
  // front of her and to her right, within 2.5 m.
  await walk(11, 6);
  const before = await headPixels();
  await walk(9, 8);
  await page.waitForTimeout(2000);
  const changed = changedPixels(before, await headPixels());
  // Measured: about 80 pixels change with the look, about 13 without idle life
  // (the sit clip's own slight motion). Her random glances can move the head
  // as much (one run measured 74 over 2 s with the player out of sight), so
  // this pixel check shows the layer is live on the real rig, not the look's
  // direction; the bone maths (head motion over 2 s, turning toward a target,
  // restoring) is tested directly in tests/unit/idleLifeLayer.test.mjs.
  expect(changed, 'pixels of her head that changed').toBeGreaterThan(40);
});
