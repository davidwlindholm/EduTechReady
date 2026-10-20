import { readFileSync } from 'node:fs';
import { test, expect } from './fixtures.mjs';
import { WALK_TIMEOUT } from './helpers.mjs';
import { parseLevel } from '../../public/js/lib/level.js';
import { createGrid } from '../../public/js/lib/grid.js';
import { layoutFurniture } from '../../public/js/lib/furniture.js';
import { occupiedTiles, placeCharacter } from '../../public/js/lib/seating.js';
import { chooseTalkTile, TALK_RANGE } from '../../public/js/lib/talk.js';

// Walk-then-talk within 1.5 m, nameplates on hover or in range,
// label clicks, the dialogue (asked marks, cap, keys) and its persistence.

const read = (path) => JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8'));
const content = read('../../public/content/characters.json');
const level = parseLevel(read('../../public/content/level.json'));
const layout = layoutFurniture(level, read('../../public/content/assets.json'));
const grid = createGrid(level, [...layout.blocked, ...occupiedTiles(content, layout)]);
const CAST = content.characters.map((c) => c.id);
const byId = (id) => content.characters.find((c) => c.id === id);
const place = (id) => placeCharacter(byId(id), layout);

async function openGame(page) {
  await page.setViewportSize({ width: 1376, height: 768 });
  await page.goto('/index.html?debug=1');
  await page.waitForFunction(() => window.__game !== undefined && document.body.classList.contains('is-ready'), null, { timeout: 30000 });
}

const label = (page, id) => page.locator(`.npc-label[data-npc-id="${id}"]`);
const dialogueOf = (page, id) => page.getByRole('dialog', { name: byId(id).name });
const playerTile = (page) => page.evaluate(() => window.__game.getPlayerTile());
const waitIdle = (page) => page.waitForFunction(() => window.__game.isIdle(), null, { timeout: WALK_TIMEOUT, polling: 100 });

/** Park the mouse over grass in the top-left corner, away from everyone. */
async function mouseAway(page) {
  await page.mouse.move(8, 60);
}

/**
 * Talk to `id` (walk-then-talk), close the dialogue, and check that its
 * nameplate shows and does not cover the player's head and chest, 1.0 to
 * 1.6 m above the player's tile centre (screen up per metre from the
 * true-isometric axes, as in room.spec.mjs).
 */
async function expectLabelClearOfPlayer(page, id) {
  await clickNpc(page, id);
  const dialogue = dialogueOf(page, id);
  await expect(dialogue).toBeVisible({ timeout: WALK_TIMEOUT });
  await page.keyboard.press('Escape');
  await expect(dialogue).toBeHidden();
  await waitIdle(page);
  await mouseAway(page);
  await expect(label(page, id)).toBeVisible();
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(r)))));
  const tile = await playerTile(page);
  const [o, ex, ez] = await page.evaluate(({ col, row }) => [[col, row], [col + 1, row], [col, row + 1]]
    .map(([c, r]) => window.__game.tileToScreen(c, r)), tile);
  const up = { x: -((ex.x - o.x) + (ez.x - o.x)), y: -((ex.y - o.y) + (ez.y - o.y)) };
  const box = await label(page, id).boundingBox();
  for (const h of [1.0, 1.3, 1.6]) {
    const q = { x: o.x + h * up.x, y: o.y + h * up.y };
    const covers = q.x >= box.x && q.x <= box.x + box.width && q.y >= box.y && q.y <= box.y + box.height;
    expect(covers, `${id}'s label covers the player at ${h} m`).toBe(false);
  }
}

async function clickNpc(page, id) {
  const p = await page.evaluate((i) => window.__game.npcToScreen(i), id);
  await page.mouse.click(p.x, p.y);
}

test.describe('walk-then-talk reaches every character', () => {
  for (const id of CAST) {
    test(`${id}: a click from a distance walks into range, then opens the dialogue`, async ({ page }) => {
      test.setTimeout(60000);
      await openGame(page);
      const where = place(id);
      const start = level.playerStart;
      expect(Math.hypot(start.col + 0.5 - where.x, start.row + 0.5 - where.z), 'starts out of range').toBeGreaterThan(TALK_RANGE);
      const expected = chooseTalkTile(grid, start, where);
      expect(expected, `${id} has a talk tile`).not.toBeNull();

      await clickNpc(page, id);
      const dialogue = dialogueOf(page, id);
      // Not at once: the player walks first.
      expect(await page.evaluate(() => window.__game.isIdle())).toBe(false);
      await expect(dialogue).toBeHidden();
      await expect(dialogue).toBeVisible({ timeout: WALK_TIMEOUT });
      expect(await playerTile(page)).toEqual({ col: expected.col, row: expected.row });
      await expect(dialogue.locator('.dialogue__line')).toHaveText(byId(id).greeting);
      expect(await page.evaluate(() => window.__game.getState().met)).toEqual([id]);
      // In range, so the nameplate shows without hovering.
      await expect(label(page, id)).toHaveClass(/is-visible/);
      await waitIdle(page);

      // Already in range: a second click opens it again without walking.
      await page.keyboard.press('Escape');
      await expect(dialogue).toBeHidden();
      await clickNpc(page, id);
      await expect(dialogue).toBeVisible();
      expect(await playerTile(page)).toEqual({ col: expected.col, row: expected.row });
    });
  }
});

test('a click elsewhere during the walk cancels the conversation', async ({ page }) => {
  test.setTimeout(60000);
  await openGame(page);
  await clickNpc(page, 'henrik'); // the longest walk, through the door
  await page.waitForFunction(() => window.__game.getPlayerTile().row <= 5, null, { timeout: WALK_TIMEOUT, polling: 50 });
  const floor = await page.evaluate(() => window.__game.tileToScreen(10, 7));
  await page.mouse.click(floor.x, floor.y);
  await waitIdle(page);
  expect(await playerTile(page)).toEqual({ col: 10, row: 7 });
  // A few frames later still no dialogue, and Henrik is not met.
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(await page.evaluate(() => window.__game.getState().met)).toEqual([]);

  // Clicking another character mid-walk talks to that one instead.
  await clickNpc(page, 'henrik');
  await page.waitForFunction(() => window.__game.getPlayerTile().row <= 5, null, { timeout: WALK_TIMEOUT, polling: 50 });
  await clickNpc(page, 'lars');
  await expect(dialogueOf(page, 'lars')).toBeVisible({ timeout: WALK_TIMEOUT });
  expect(await page.evaluate(() => window.__game.getState().met)).toEqual(['lars']);
});

test('a click on a character in range during a walk stops the walk', async ({ page }) => {
  test.setTimeout(60000);
  await openGame(page);
  // Walk from playerStart to (1, 8); the route passes (5, 7), within 1.5 m
  // of Karim. Click him there: the dialogue opens and the old walk stops.
  const floor = await page.evaluate(() => window.__game.tileToScreen(1, 8));
  await page.mouse.click(floor.x, floor.y);
  await page.waitForFunction(() => window.__game.getPlayerTile().col <= 5, null, { timeout: WALK_TIMEOUT, polling: 20 });
  const from = await playerTile(page);
  await clickNpc(page, 'karim');
  const dialogue = dialogueOf(page, 'karim');
  await expect(dialogue).toBeVisible({ timeout: WALK_TIMEOUT });
  await waitIdle(page);
  // The earlier walk to (1, 8) did not carry on behind the dialogue.
  const where = place('karim');
  const t = await playerTile(page);
  expect(Math.abs(t.col - from.col) + Math.abs(t.row - from.row), 'stopped where clicked').toBeLessThanOrEqual(1);
  expect(Math.hypot(t.col + 0.5 - where.x, t.row + 0.5 - where.z)).toBeLessThanOrEqual(TALK_RANGE);
  await expect(dialogue).toBeVisible();
});

test('a click elsewhere during a conversation walks there; the dialogue closes out of range', async ({ page }) => {
  // The dialogue does not lock the scene.
  test.setTimeout(90000);
  await openGame(page);
  await clickNpc(page, 'lars');
  const dialogue = dialogueOf(page, 'lars');
  await expect(dialogue).toBeVisible({ timeout: WALK_TIMEOUT });
  await waitIdle(page);
  const where = place('lars');
  const from = await playerTile(page);

  // A step that stays within talking range keeps the conversation open.
  const near = [[0, 1], [1, 1], [-1, 1], [0, -1], [1, 0], [-1, 0], [1, -1], [-1, -1]]
    .map(([dc, dr]) => ({ col: from.col + dc, row: from.row + dr }))
    .find((t) => grid.isWalkable(t.col, t.row)
      && Math.hypot(t.col + 0.5 - where.x, t.row + 0.5 - where.z) <= TALK_RANGE);
  expect(near, 'a walkable tile in range next to the talk tile').toBeTruthy();
  let p = await page.evaluate(({ col, row }) => window.__game.tileToScreen(col, row), near);
  await page.mouse.click(p.x, p.y);
  await page.waitForFunction((t) => {
    const at = window.__game.getPlayerTile();
    return at.col === t.col && at.row === t.row && window.__game.isIdle();
  }, near, { timeout: WALK_TIMEOUT, polling: 100 });
  await expect(dialogue).toBeVisible();
  await expect(dialogue.locator('.dialogue__option').first()).toBeFocused();

  // A click further away walks there and closes the dialogue on the way.
  p = await page.evaluate(() => window.__game.tileToScreen(2, 9));
  await page.mouse.click(p.x, p.y);
  await expect(dialogue).toBeHidden({ timeout: WALK_TIMEOUT });
  await waitIdle(page);
  expect(await playerTile(page)).toEqual({ col: 2, row: 9 });
  await expect(page.locator('#scene')).toBeFocused();

  // With a dialogue open, a click on another character talks to that one.
  await clickNpc(page, 'mette');
  await expect(dialogueOf(page, 'mette')).toBeVisible({ timeout: WALK_TIMEOUT });
  await clickNpc(page, 'karim');
  await expect(dialogueOf(page, 'karim')).toBeVisible({ timeout: WALK_TIMEOUT });
  await expect(page.getByRole('dialog')).toHaveCount(1);
  expect(await page.evaluate(() => window.__game.getState().met)).toEqual(['lars', 'mette', 'karim']);
});

test('a dialogue that closes out of range leaves focus the pair put elsewhere', async ({ page }) => {
  test.setTimeout(90000);
  await openGame(page);
  await clickNpc(page, 'lars');
  const dialogue = dialogueOf(page, 'lars');
  await expect(dialogue).toBeVisible({ timeout: WALK_TIMEOUT });
  await waitIdle(page);
  // Ask the first question, so there is an asked state to keep.
  const lars = byId('lars');
  await page.keyboard.press('1');
  await expect(dialogue.locator('.dialogue__line')).toHaveText(lars.questions[0].answer);
  // Walk away, and move focus to the shadows toggle while walking. The scene
  // click (handled synchronously), the focus move and the dialogue check run
  // in one step in the page, before any frame moves the player: Lars's talk
  // tile is only about 0.1 m inside the range, so a separate step can lose
  // the race on a slow machine.
  const ui = await (await page.request.get('/content/ui.json')).json();
  const toggle = page.getByRole('button', { name: ui['menu.shadows'] });
  const atFocus = await toggle.evaluate((button) => {
    const p = window.__game.tileToScreen(2, 9);
    document.querySelector('#scene').dispatchEvent(new MouseEvent('click', { clientX: p.x, clientY: p.y, bubbles: true }));
    button.focus();
    return { open: !document.querySelector('section.dialogue').hidden, focused: document.activeElement === button };
  });
  expect(atFocus, 'the dialogue is still open when focus moves to the toggle').toEqual({ open: true, focused: true });
  await expect(dialogue).toBeHidden({ timeout: WALK_TIMEOUT });
  await expect(toggle).toBeFocused();
  // Its met and asked state is kept, as after Farvel.
  const state = await page.evaluate(() => window.__game.getState());
  expect(state.met).toEqual(['lars']);
  expect(state.asked).toEqual({ lars: [lars.questions[0].id] });
  // Esc is different: the pair closed it, so focus returns to the scene,
  // even from the toggle (keys reach an open dialogue).
  await waitIdle(page);
  await clickNpc(page, 'lars');
  await expect(dialogue).toBeVisible({ timeout: WALK_TIMEOUT });
  await expect(dialogue.locator('.dialogue__option').first()).toHaveClass(/is-asked/);
  await expect(dialogue.locator('.dialogue__option').nth(1)).not.toHaveClass(/is-asked/);
  await waitIdle(page);
  await toggle.focus();
  await page.keyboard.press('Escape');
  await expect(dialogue).toBeHidden();
  await expect(page.locator('#scene')).toBeFocused();
});

test('nameplates show on hover and in talking range only', async ({ page }) => {
  test.setTimeout(60000);
  await openGame(page);
  await mouseAway(page);
  // Nobody is within range of playerStart: every nameplate is hidden, and
  // hidden ones take no clicks.
  for (const id of CAST) await expect(label(page, id)).toBeHidden();
  const hidden = await label(page, 'karim').evaluate((el) => {
    const s = getComputedStyle(el);
    return { pointer: s.pointerEvents, visibility: s.visibility, tabIndex: el.tabIndex };
  });
  expect(hidden).toEqual({ pointer: 'none', visibility: 'hidden', tabIndex: -1 });

  // Hovering Karim shows his nameplate (and only his).
  const k = await page.evaluate(() => window.__game.npcToScreen('karim'));
  await page.mouse.move(k.x, k.y);
  await expect(label(page, 'karim')).toBeVisible();
  await expect(page.locator('.npc-label.is-visible')).toHaveCount(1);
  await mouseAway(page);
  await expect(label(page, 'karim')).toBeHidden();

  // Walking within 1.5 m of Sofie shows hers without hovering; Anne's
  // (1.9 m from (8, 8)) stays hidden.
  const tile = await page.evaluate(() => window.__game.tileToScreen(8, 8));
  await page.mouse.click(tile.x, tile.y);
  await waitIdle(page);
  await mouseAway(page);
  await expect(label(page, 'sofie')).toBeVisible();
  await expect(page.locator('.npc-label.is-visible')).toHaveCount(1);
  await page.screenshot({ path: 'docs/screenshots/dialogue-nameplates.png' });

  // Walking away hides it again.
  const away = await page.evaluate(() => window.__game.tileToScreen(11, 6));
  await page.mouse.click(away.x, away.y);
  await waitIdle(page);
  await mouseAway(page);
  await expect(label(page, 'sofie')).toBeHidden();
});

test('a visible nameplate keeps clear of the player', async ({ page }) => {
  test.setTimeout(60000);
  await openGame(page);
  // On Anne's talk tile from playerStart, (5, 8), the player stands just
  // behind her, where her nameplate would cover the player's head and chest
  // if the player were not an obstacle for the layout (checked: it fails then).
  await expectLabelClearOfPlayer(page, 'anne');
});

test('clicking a visible nameplate starts that conversation', async ({ page }) => {
  test.setTimeout(60000);
  await openGame(page);
  // Hover Jonas to show his nameplate, move onto it (it stays while hovered), click it.
  const j = await page.evaluate(() => window.__game.npcToScreen('jonas'));
  await page.mouse.move(j.x, j.y);
  await expect(label(page, 'jonas')).toBeVisible();
  const box = await label(page, 'jonas').boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await expect(label(page, 'jonas')).toBeVisible();
  // The nameplate itself is under the pointer, not the canvas.
  expect(await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.closest('.npc-label')?.dataset.npcId, { x: box.x + box.width / 2, y: box.y + box.height / 2 })).toBe('jonas');
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await expect(dialogueOf(page, 'jonas')).toBeVisible({ timeout: WALK_TIMEOUT });
  const where = place('jonas');
  const t = await playerTile(page);
  expect(Math.hypot(t.col + 0.5 - where.x, t.row + 0.5 - where.z)).toBeLessThanOrEqual(TALK_RANGE);
});

test('questions, keys, and the asked state survives a reload', async ({ page }) => {
  test.setTimeout(120000);
  await openGame(page);
  const mette = byId('mette');
  const jonas = byId('jonas');

  // Mette: the number key 1 asks her first question.
  await clickNpc(page, 'mette');
  const d1 = dialogueOf(page, 'mette');
  await expect(d1).toBeVisible({ timeout: WALK_TIMEOUT });
  const options = d1.locator('.dialogue__option');
  await expect(options).toHaveCount(mette.questions.length + 1);
  await expect(options.last()).toHaveText(/Farvel/);
  await expect(options.first()).toBeFocused();
  await page.keyboard.press('1');
  await expect(d1.locator('.dialogue__line')).toHaveText(mette.questions[0].answer);
  await expect(options.first()).toHaveClass(/is-asked/);
  await expect(options.nth(1)).not.toHaveClass(/is-asked/);
  await waitIdle(page);
  await mouseAway(page);
  await page.screenshot({ path: 'docs/screenshots/dialogue-dialogue.png' });
  // No cap (maxQuestions null for everyone): an asked
  // question stays marked but clickable and shows its answer again, and
  // asking every question disables none.
  expect(mette.maxQuestions).toBeNull();
  await page.keyboard.press('2');
  await expect(d1.locator('.dialogue__line')).toHaveText(mette.questions[1].answer);
  await expect(options.first()).toBeEnabled();
  await options.first().click();
  await expect(d1.locator('.dialogue__line')).toHaveText(mette.questions[0].answer);
  await expect(options.first()).toHaveClass(/is-asked/);
  for (let i = 3; i <= mette.questions.length; i++) await page.keyboard.press(String(i));
  for (let i = 0; i < mette.questions.length; i++) {
    await expect(options.nth(i)).toBeEnabled();
    await expect(options.nth(i)).toHaveClass(/is-asked/);
  }
  await expect(d1.locator('.dialogue__cap')).toBeHidden();
  await page.keyboard.press('Escape');
  await expect(d1).toBeHidden();
  await expect(page.locator('#scene')).toBeFocused();

  // Jonas: a click asks his second question; Farvel closes.
  await clickNpc(page, 'jonas');
  const d2 = dialogueOf(page, 'jonas');
  await expect(d2).toBeVisible({ timeout: WALK_TIMEOUT });
  await d2.getByRole('button', { name: jonas.questions[1].text }).click();
  await expect(d2.locator('.dialogue__line')).toHaveText(jonas.questions[1].answer);
  await d2.getByRole('button', { name: 'Farvel' }).click();
  await expect(d2).toBeHidden();
  await expect(page.locator('#scene')).toBeFocused();

  const state = await page.evaluate(() => window.__game.getState());
  expect(state.met).toEqual(['mette', 'jonas']);
  expect(state.asked).toEqual({ mette: mette.questions.map((q) => q.id), jonas: ['q2'] });

  // Reload: the asked state is still there and the marks come back.
  await page.reload();
  await page.waitForFunction(() => window.__game !== undefined && document.body.classList.contains('is-ready'), null, { timeout: 30000 });
  const after = await page.evaluate(() => window.__game.getState());
  expect(after.met).toEqual(['mette', 'jonas']);
  expect(after.asked).toEqual({ mette: mette.questions.map((q) => q.id), jonas: ['q2'] });
  await clickNpc(page, 'jonas');
  const again = dialogueOf(page, 'jonas');
  await expect(again).toBeVisible({ timeout: WALK_TIMEOUT });
  // The greeting comes first again; question 2 is marked.
  await expect(again.locator('.dialogue__line')).toHaveText(jonas.greeting);
  await expect(again.locator('.dialogue__option').nth(1)).toHaveClass(/is-asked/);
  await expect(again.locator('.dialogue__option').first()).not.toHaveClass(/is-asked/);
});

test('the question cap disables the rest, Farvel stays last', async ({ page }) => {
  test.setTimeout(60000);
  // Content with a cap of 2 for Mette, through the real server response.
  await page.route('**/content/characters.json', async (route) => {
    const response = await route.fetch();
    const json = JSON.parse((await response.body()).toString('utf8'));
    json.characters.find((c) => c.id === 'mette').maxQuestions = 2;
    await route.fulfill({ response, body: Buffer.from(JSON.stringify(json), 'utf8') });
  });
  const ui = await (await page.request.get('/content/ui.json')).json();
  await openGame(page);
  const mette = byId('mette');
  await clickNpc(page, 'mette');
  const d = dialogueOf(page, 'mette');
  await expect(d).toBeVisible({ timeout: WALK_TIMEOUT });
  const cap = d.getByText(ui['dialogue.capReached']);
  await expect(cap).toBeHidden();
  await page.keyboard.press('1');
  await page.keyboard.press('3');
  const options = d.locator('.dialogue__option');
  await expect(options.nth(1)).toBeDisabled();
  await expect(options.nth(1)).toHaveAccessibleDescription(ui['dialogue.capReached']);
  await expect(cap).toBeVisible();
  await expect(options.first()).toBeEnabled();
  await expect(options.nth(2)).toBeEnabled();
  await expect(options.last()).toHaveText(/Farvel/);
  await expect(options.last()).toBeEnabled();
  // Key 2 on the disabled question does nothing.
  await page.keyboard.press('2');
  await expect(d.locator('.dialogue__line')).toHaveText(mette.questions[2].answer);
  expect(await page.evaluate(() => window.__game.getState().asked.mette)).toEqual(['q1', 'q3']);
  // Asking an asked question again repeats its answer.
  await page.keyboard.press('1');
  await expect(d.locator('.dialogue__line')).toHaveText(mette.questions[0].answer);
  await page.keyboard.press(String(mette.questions.length + 1)); // Farvel
  await expect(d).toBeHidden();
  // Reopened, the cap still holds.
  await clickNpc(page, 'mette');
  await expect(d).toBeVisible();
  await expect(d.locator('.dialogue__option').nth(1)).toBeDisabled();
});

