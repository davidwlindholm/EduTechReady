import { test, expect } from './fixtures.mjs';
import { MAX_SIDE_SHIFT } from '../../public/js/lib/labels.js';
import { talkTo, CHARACTERS } from './helpers.mjs';

const CAST = ['mette', 'jonas', 'karim', 'anne', 'sofie', 'lars', 'birgitte', 'henrik'];

async function openGame(page) {
  await page.setViewportSize({ width: 1376, height: 768 });
  await page.goto('/index.html?debug=1');
  await page.waitForFunction(() => window.__game !== undefined && document.body.classList.contains('is-ready'), null, { timeout: 30000 });
}

async function characters(page) {
  return (await (await page.request.get('/content/characters.json')).json()).characters;
}

/**
 * Wait four frames: a resize is handled in one frame, the labels are laid
 * out after that frame's render, and the CSS2D renderer only writes the new
 * offsets on the next render, which may run after this page's own callback.
 */
async function nextFrames(page) {
  await page.evaluate(() => new Promise((resolve) => {
    let n = 4;
    const tick = () => (--n === 0 ? resolve() : requestAnimationFrame(tick));
    requestAnimationFrame(tick);
  }));
}

// How far a label may be pushed up above its own anchor, in label heights.
// Stacking over one neighbour costs about one height; the worst case in the
// tested window sizes is about two (Mette at 600x900).
const MAX_RISE_HEIGHTS = 2.5;

/**
 * Show every nameplate (debug key L; they are otherwise hidden until
 * hovered or in talking range), so the layout of all eight can be checked.
 */
async function showAllLabels(page) {
  await page.locator('#scene').focus();
  await page.keyboard.press('l');
  await expect(page.locator('body')).toHaveClass(/is-all-nameplates/);
}

/**
 * No two labels cover each other, no label covers another character's
 * body (its click point, the middle of the body), and every label stays
 * near its own character: never below its anchor (0.15 m above the head),
 * at most MAX_RISE_HEIGHTS label heights above it, and slid sideways by at
 * most MAX_SIDE_SHIFT of its width. Labels are moved after a rendered frame.
 */
async function expectLabelsClear(page, where = '') {
  await nextFrames(page);
  const labels = await page.locator('.npc-label.is-visible').evaluateAll((els) => els.map((el) => {
    // CSS2DRenderer writes "translate(<center>%) translate(<anchor>px)"; the
    // second translate is the anchor's screen point inside the label host.
    const anchor = el.style.transform.match(/translate\(\s*(-?[\d.e+-]+)px,\s*(-?[\d.e+-]+)px\s*\)/);
    const host = el.parentElement.getBoundingClientRect();
    return {
      id: el.dataset.npcId,
      ...el.getBoundingClientRect().toJSON(),
      anchor: anchor && { x: Number(anchor[1]) + host.left, y: Number(anchor[2]) + host.top },
    };
  }));
  const points = await page.evaluate((ids) => ids.map((id) => ({ id, ...window.__game.npcToScreen(id) })), CAST);
  for (let i = 0; i < labels.length; i++) {
    const a = labels[i];
    expect(a.anchor, `${where}label ${a.id} has no CSS2D anchor`).not.toBeNull();
    const side = Math.abs((a.left + a.right) / 2 - a.anchor.x);
    const rise = a.anchor.y - a.bottom;
    expect(side, `${where}label ${a.id} slides ${side} px sideways`).toBeLessThanOrEqual(a.width * MAX_SIDE_SHIFT + 1);
    expect(rise, `${where}label ${a.id} sits below its anchor`).toBeGreaterThanOrEqual(-1);
    expect(rise, `${where}label ${a.id} rises ${rise} px above its anchor`).toBeLessThanOrEqual(a.height * MAX_RISE_HEIGHTS);
    for (let j = i + 1; j < labels.length; j++) {
      const b = labels[j];
      const overlap = a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
      expect(overlap, `${where}labels ${a.id} and ${b.id} overlap`).toBe(false);
    }
    for (const p of points) {
      if (p.id === a.id) continue;
      const covers = p.x >= a.left && p.x <= a.right && p.y >= a.top && p.y <= a.bottom;
      expect(covers, `${where}label ${a.id} covers ${p.id}`).toBe(false);
    }
  }
}

test('all eight characters are in place with their labels', async ({ page }) => {
  test.setTimeout(60000);
  await openGame(page);
  const cast = await characters(page);
  expect(cast.map((c) => c.id)).toEqual(CAST);
  const canvas = await page.locator('#scene').boundingBox();
  for (const c of cast) {
    const p = await page.evaluate((id) => window.__game.npcToScreen(id), c.id);
    expect(p, c.id).not.toBeNull();
    expect(p.x).toBeGreaterThan(canvas.x);
    expect(p.x).toBeLessThan(canvas.x + canvas.width);
    expect(p.y).toBeGreaterThan(canvas.y);
    expect(p.y).toBeLessThan(canvas.y + canvas.height);
    // Two-line label: the name in bold, the role in brackets below.
    const [name, role] = c.name.split(/\s*\(/);
    const label = page.locator(`.npc-label[data-npc-id="${c.id}"]`);
    // Hidden until hovered or in talking range.
    await expect(label).toBeHidden();
    await expect(label.locator('.npc-label__name')).toHaveText(name);
    await expect(label.locator('.npc-label__role')).toHaveText(`(${role}`);
  }
  await expect(page.locator('.npc-label')).toHaveCount(CAST.length);
  await showAllLabels(page);
  await expect(page.locator('.npc-label.is-visible')).toHaveCount(CAST.length);
  await expectLabelsClear(page);
  await page.waitForFunction(() => window.__game.isIdle());
  await page.screenshot({ path: 'docs/screenshots/characters-npcs.png' });
});

test('clicking a seated and a standing character opens their dialogue', async ({ page }) => {
  test.setTimeout(90000);
  await openGame(page);
  const cast = await characters(page);
  for (const id of ['mette', 'lars']) {
    const c = cast.find((x) => x.id === id);
    const p = await page.evaluate((i) => window.__game.npcToScreen(i), id);
    // Hovering a character shows the pointer cursor.
    await page.mouse.move(p.x, p.y);
    await expect(page.locator('#scene')).toHaveClass(/is-over-npc/);
    // Walk-then-talk: the dialogue opens once the player is in range.
    const dialogue = await talkTo(page, id, c.name);
    await expect(dialogue.locator('.dialogue__line')).toHaveText(c.greeting);
    expect(await page.evaluate(() => window.__game.getState().met)).toContain(id);
    await page.keyboard.press('Escape');
    await expect(dialogue).toBeHidden();
  }
  // A floor tile away from everyone shows the default cursor.
  const floor = await page.evaluate(() => window.__game.tileToScreen(10, 9));
  await page.mouse.move(floor.x, floor.y);
  await expect(page.locator('#scene')).not.toHaveClass(/is-over-npc/);
});

test('labels keep clear of each other and of the characters at other window sizes', async ({ page }) => {
  test.setTimeout(60000);
  await openGame(page);
  // The player is an obstacle for labels too. Park it in the empty
  // south-east corner, so this checks the labels against each other and
  // the characters only (dialogue.spec.mjs covers the player).
  const corner = await page.evaluate(() => window.__game.tileToScreen(11, 10));
  await page.mouse.click(corner.x, corner.y);
  await page.waitForFunction(() => window.__game.isIdle() && window.__game.getPlayerTile().row === 10, null, { timeout: 45000, polling: 100 });
  await showAllLabels(page);
  for (const [width, height] of [[800, 600], [600, 900], [1920, 1080]]) {
    await page.setViewportSize({ width, height });
    await expectLabelsClear(page, `${width}x${height}: `);
  }
});

// Fixed test text, so the check does not depend on placeholder content that
// will be replaced. It goes through the real server response (headers kept).
const DANISH = 'Prøv blåbærgrød: æ ø å Æ Ø Å.';

test('Danish text keeps æ, ø and å in the dialogue', async ({ page }) => {
  test.setTimeout(90000);
  await page.route('**/content/characters.json', async (route) => {
    const response = await route.fetch();
    const content = JSON.parse((await response.body()).toString('utf8'));
    content.characters.find((c) => c.id === 'birgitte').greeting = DANISH;
    await route.fulfill({ response, body: Buffer.from(JSON.stringify(content), 'utf8') });
  });
  await openGame(page);
  const birgitte = (await characters(page)).find((c) => c.id === 'birgitte');
  const dialogue = await talkTo(page, 'birgitte', birgitte.name);
  await expect(dialogue.locator('.dialogue__line')).toHaveText(DANISH);
  // Mette's questions are served unchanged from characters.json (today with
  // æ in "ændrede" and å in "måde"); read from the file so the content can be reworded.
  await page.keyboard.press('Escape');
  const metteContent = CHARACTERS.characters.find((c) => c.id === 'mette');
  const mette = await talkTo(page, 'mette', metteContent.name);
  for (const q of metteContent.questions) {
    await expect(mette.getByRole('button', { name: q.text, exact: true })).toBeVisible();
  }
});
