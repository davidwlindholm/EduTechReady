import { test, expect } from './fixtures.mjs';
import { meet, WALK_TIMEOUT } from './helpers.mjs';

// A standing character: Birgitte in the hallway.
const NPC_ID = 'birgitte';

async function openGame(page) {
  await page.setViewportSize({ width: 1376, height: 768 });
  await page.goto('/index.html?debug=1');
  await page.waitForFunction(() => window.__game !== undefined && document.body.classList.contains('is-ready'), null, { timeout: 30000 });
}

async function waitIdle(page) {
  await page.waitForFunction(() => window.__game.isIdle(), null, { timeout: 15000 });
}

test('walk, talk and place on SAMR', async ({ page }) => {
  test.setTimeout(90000);
  await openGame(page);
  const label = page.locator(`.npc-label[data-npc-id="${NPC_ID}"]`);
  await expect(label.locator('.npc-label__name')).toHaveText('Birgitte');
  await expect(label.locator('.npc-label__role')).toHaveText('(Uddannelsesleder)');
  await expect(page.locator('.debug-hud')).toContainText('FPS');

  // Walk: click a floor tile and wait for the player to arrive there.
  const start = await page.evaluate(() => window.__game.getPlayerTile());
  // A lounge floor tile on the real level (level.json); the start is playerStart (8, 7).
  const target = { col: 6, row: 6 };
  expect(start).not.toEqual(target);
  const p = await page.evaluate(({ col, row }) => window.__game.tileToScreen(col, row), target);
  await page.mouse.click(p.x, p.y);
  await page.waitForFunction(() => !window.__game.isIdle(), null, { timeout: 5000 });
  await waitIdle(page);
  expect(await page.evaluate(() => window.__game.getPlayerTile())).toEqual(target);
  await page.screenshot({ path: 'docs/screenshots/core-loop-scene.png' });

  // Talk: clicking the NPC walks over and opens the dialogue;
  // question 1 shows its answer.
  const n = await page.evaluate((id) => window.__game.npcToScreen(id), NPC_ID);
  await page.mouse.click(n.x, n.y);
  const dialogue = page.getByRole('dialog', { name: 'Birgitte (Uddannelsesleder)' });
  await expect(dialogue).toBeVisible({ timeout: WALK_TIMEOUT });
  const characters = await (await page.request.get('/content/characters.json')).json();
  const npc = characters.characters.find((c) => c.id === NPC_ID);
  await expect(dialogue.locator('.dialogue__line')).toHaveText(npc.greeting);
  // The greeting is written while the dialog is hidden, so it is exposed as the description.
  await expect(dialogue).toHaveAccessibleDescription(npc.greeting);
  await expect(dialogue.locator('.dialogue__option').first()).toBeFocused();
  await dialogue.getByRole('button', { name: npc.questions[0].text }).click();
  await expect(dialogue.locator('.dialogue__line')).toHaveText(npc.questions[0].answer);
  const state = await page.evaluate(() => window.__game.getState());
  expect(state.met).toContain(NPC_ID);
  expect(state.asked[NPC_ID]).toEqual(['q1']);
  await page.screenshot({ path: 'docs/screenshots/core-loop-dialogue.png' });

  // Esc closes the dialogue and returns focus to the canvas.
  await page.keyboard.press('Escape');
  await expect(dialogue).toBeHidden();
  await expect(page.locator('#scene')).toBeFocused();

  // Farvel also closes it (the player is in range now, so it opens at once).
  await page.mouse.click(n.x, n.y);
  await expect(dialogue).toBeVisible();
  await dialogue.getByRole('button', { name: 'Farvel' }).click();
  await expect(dialogue).toBeHidden();

  // SAMR: drag the token to the axis midpoint.
  await page.getByRole('button', { name: 'SAMR' }).click();
  const panel = page.getByRole('dialog', { name: /SAMR/ });
  await expect(panel).toBeVisible();
  const token = panel.locator(`.token[data-id="${NPC_ID}"]`);
  const tokenBox = await token.boundingBox();
  const axisBox = await panel.locator('.placement__axis').boundingBox();
  await page.mouse.move(tokenBox.x + tokenBox.width / 2, tokenBox.y + tokenBox.height / 2);
  await page.mouse.down();
  // Each pointer move costs a rendered frame, and SwiftShader frames are slow
  // (about 70 ms, several hundred under load); a few steps exercise the drag.
  await page.mouse.move(axisBox.x + axisBox.width / 2, axisBox.y + axisBox.height / 2, { steps: 4 });
  await page.mouse.up();
  const value = await page.evaluate((id) => window.__game.getState().placements[id].samr, NPC_ID);
  expect(Math.abs(value - 50)).toBeLessThanOrEqual(2);
  await expect(panel.locator(`.placement__axis .token[data-id="${NPC_ID}"]`)).toBeVisible();
  await page.screenshot({ path: 'docs/screenshots/core-loop-samr.png' });

  // The placement survives a reload (localStorage).
  await page.reload();
  await page.waitForFunction(() => window.__game !== undefined, null, { timeout: 30000 });
  expect(await page.evaluate((id) => window.__game.getState().placements[id].samr, NPC_ID)).toBe(value);
});

test('no debug API or HUD without debug=1', async ({ page }) => {
  await page.goto('/index.html');
  await page.waitForFunction(() => document.body.classList.contains('is-ready'), null, { timeout: 30000 });
  expect(await page.evaluate(() => typeof window.__game)).toBe('undefined');
  await expect(page.locator('.debug-hud')).toHaveCount(0);
  // Nor the door easter egg's test attribute, a few frames in.
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  await expect(page.locator('body')).not.toHaveAttribute('data-door-phase');
  await expect(page.getByRole('navigation', { name: 'Spilmenu' })).toBeVisible();
});

test('Esc closes the dialogue after a click on the scene', async ({ page }) => {
  test.setTimeout(60000);
  await openGame(page);
  const n = await page.evaluate((id) => window.__game.npcToScreen(id), NPC_ID);
  await page.mouse.click(n.x, n.y);
  const dialogue = page.getByRole('dialog', { name: /Birgitte/ });
  await expect(dialogue).toBeVisible({ timeout: WALK_TIMEOUT });
  // A click on the player's own tile walks nowhere, so the dialogue stays
  // open (it closes only out of talking range) and keeps focus.
  const p = await page.evaluate(() => {
    const t = window.__game.getPlayerTile();
    return window.__game.tileToScreen(t.col, t.row);
  });
  await page.mouse.click(p.x, p.y);
  await expect(dialogue).toBeVisible();
  await expect(dialogue.locator('.dialogue__option').first()).toBeFocused();
  // Even with focus moved outside by other means, Esc still closes it.
  await page.evaluate(() => document.getElementById('scene').focus());
  await page.keyboard.press('Escape');
  await expect(dialogue).toBeHidden();
  await expect(page.locator('#scene')).toBeFocused();
});

test('placed tokens at 0 and 100 stay inside the panel', async ({ page }) => {
  // A placed token is a pin centred on its needle; the chart's
  // side margins keep the heads at 0 and 100 inside the panel.
  test.setTimeout(60000);
  await page.setViewportSize({ width: 700, height: 600 });
  await page.goto('/index.html?debug=1');
  await page.waitForFunction(() => window.__game !== undefined && document.body.classList.contains('is-ready'), null, { timeout: 30000 });
  await meet(page, NPC_ID);
  for (const value of [0, 100]) {
    await page.evaluate(([id, v]) => window.__game.setPlacement(id, 'samr', v), [NPC_ID, value]);
    await page.getByRole('button', { name: 'SAMR' }).click();
    const panel = page.getByRole('dialog', { name: /SAMR/ });
    const token = panel.locator(`.placement__axis .token[data-id="${NPC_ID}"]`);
    const axisBox = await panel.locator('.placement__axis').boundingBox();
    const panelBox = await panel.boundingBox();
    const headBox = await token.locator('.pin__head').boundingBox();
    expect(headBox.x).toBeGreaterThanOrEqual(panelBox.x);
    expect(headBox.x + headBox.width).toBeLessThanOrEqual(panelBox.x + panelBox.width);
    // The needle tip marks the value.
    const tip = await token.locator('.pin__tip').boundingBox();
    expect(Math.abs(tip.x + tip.width / 2 - (axisBox.x + (axisBox.width * value) / 100))).toBeLessThanOrEqual(1.5);
    // Grabbing and releasing the pin in place keeps its value.
    await page.mouse.move(headBox.x + headBox.width / 2, headBox.y + headBox.height / 2);
    await page.mouse.down();
    await page.mouse.up();
    expect(await page.evaluate((id) => window.__game.getState().placements[id].samr, NPC_ID)).toBe(value);
    await page.keyboard.press('Escape');
    await expect(panel).toBeHidden();
  }
});

test('Esc closes a placement panel after focus has left it', async ({ page }) => {
  test.setTimeout(60000);
  await openGame(page);
  await meet(page, NPC_ID);
  for (const name of ['SAMR', 'Rogers']) {
    await page.getByRole('button', { name, exact: true }).click();
    const panel = page.getByRole('dialog', { name: new RegExp(name) });
    await expect(panel).toBeVisible();
    // A click on non-focusable text inside the panel moves focus to <body>.
    await panel.locator('.placement__title').click();
    expect(await page.evaluate(() => document.activeElement === document.body)).toBe(true);
    // Tab returns focus into the panel.
    await page.keyboard.press('Tab');
    expect(await panel.evaluate((el) => el.contains(document.activeElement))).toBe(true);
    await panel.locator('.placement__instructions').click();
    await page.keyboard.press('Escape');
    await expect(panel).toBeHidden();
    // Focus returns to the canvas.
    await expect(page.locator('#scene')).toBeFocused();
  }
});

test('setPlacement keeps focus on the rebuilt token', async ({ page }) => {
  test.setTimeout(60000);
  await openGame(page);
  await meet(page, NPC_ID);
  await page.getByRole('button', { name: 'SAMR', exact: true }).click();
  const panel = page.getByRole('dialog', { name: /SAMR/ });
  const token = panel.locator(`.token[data-id="${NPC_ID}"]`);
  await expect(token).toBeFocused();
  await page.evaluate((id) => window.__game.setPlacement(id, 'samr', 30), NPC_ID);
  await expect(token).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(panel).toBeHidden();
});

test('Rogers categories follow the fixed thresholds', async ({ page }) => {
  test.setTimeout(60000);
  await openGame(page);
  await meet(page, NPC_ID);
  const ui = await (await page.request.get('/content/ui.json')).json();
  const names = [0, 1, 2, 3, 4].map((i) => ui[`rogers.category.${i}`]);
  const panel = page.getByRole('dialog', { name: /Rogers/ });
  // value -> expected category index (thresholds 16.67, 33.33, 50, 66.67)
  // Band edges in value units match the contract (exact edges are checked in the unit tests).
  await page.evaluate((id) => window.__game.setPlacement(id, 'rogers', 18), NPC_ID);
  await page.getByRole('button', { name: 'Rogers', exact: true }).click();
  await page.screenshot({ path: 'docs/screenshots/core-loop-rogers.png' });
  const edges = await panel.locator('.placement__band').evaluateAll((bands) => {
    const axis = bands[0].parentElement.getBoundingClientRect();
    return [0, ...bands.map((b) => ((b.getBoundingClientRect().right - axis.left) / axis.width) * 100)];
  });
  [0, 16.67, 33.33, 50, 66.67, 100].forEach((e, i) => expect(Math.abs(edges[i] - e), `edge ${i}`).toBeLessThan(0.2));
  await page.keyboard.press('Escape');
  const cases = [[16, 0], [17, 1], [18, 1], [33, 1], [34, 2], [49, 2], [51, 3], [66, 3], [67, 4], [79, 4], [100, 4]];
  for (const [value, expected] of cases) {
    await page.evaluate(([id, v]) => window.__game.setPlacement(id, 'rogers', v), [NPC_ID, value]);
    await page.getByRole('button', { name: 'Rogers', exact: true }).click();
    await expect(panel).toBeVisible();
    const axisBox = await panel.locator('.placement__axis').boundingBox();
    const pinX = axisBox.x + (axisBox.width * value) / 100;
    const under = await panel.locator('.placement__band').evaluateAll((bands, x) => {
      const i = bands.findIndex((b) => {
        const r = b.getBoundingClientRect();
        return x >= r.left && x < r.right;
      });
      return i === -1 ? bands.length - 1 : i; // x at the right edge belongs to the last band
    }, pinX);
    expect(under, `value ${value}`).toBe(expected);
    await expect(panel.locator('.placement__band-label').nth(under)).toHaveText(names[expected]);
    await page.keyboard.press('Escape');
    await expect(panel).toBeHidden();
  }
});

test('an NPC click straight after is-ready opens the dialogue', async ({ page }) => {
  // Regression: before the first frame the pick shapes (hit cylinders
  // then, skinned meshes now) had identity world matrices, so an early click missed the NPC and walked the player instead.
  // The click walks the player into talking range first; the
  // dialogue (not a floor walk) must follow.
  test.setTimeout(60000);
  await page.setViewportSize({ width: 1376, height: 768 });
  await page.goto('/index.html?debug=1');
  const result = await page.evaluate((id) => new Promise((resolve) => {
    const click = () => {
      const n = window.__game.npcToScreen(id);
      document.getElementById('scene').dispatchEvent(new MouseEvent('click', { clientX: n.x, clientY: n.y, bubbles: true }));
      resolve({ met: window.__game.getState().met, walking: !window.__game.isIdle() });
    };
    if (document.body.classList.contains('is-ready')) {
      click();
      return;
    }
    // Click in the same task that sets is-ready, before any frame can render.
    new MutationObserver((_, observer) => {
      if (!document.body.classList.contains('is-ready')) return;
      observer.disconnect();
      click();
    }).observe(document.body, { attributes: true, attributeFilter: ['class'] });
  }), NPC_ID);
  expect(result).toEqual({ met: [], walking: true });
  await expect(page.getByRole('dialog', { name: /Birgitte/ })).toBeVisible({ timeout: WALK_TIMEOUT });
  expect(await page.evaluate(() => window.__game.getState().met)).toEqual([NPC_ID]);
});
