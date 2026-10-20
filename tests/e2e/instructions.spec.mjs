import { readFileSync } from 'node:fs';
import { test, expect } from './fixtures.mjs';
import { UI } from './helpers.mjs';
import { instructionsLines, INSTRUCTIONS_MAX_LINES } from '../../scripts/validate_content.mjs';

// The instructions window: it opens when the game has
// loaded, closes with its button, and the Instruktioner button in the menu,
// left of Færdig, opens it again. Its text comes from instructions.json.
const INSTRUCTIONS = JSON.parse(readFileSync(new URL('../../public/content/instructions.json', import.meta.url), 'utf8'));

test.use({ keepInstructions: true });

async function openGame(page) {
  await page.goto('/index.html?debug=1');
  await page.waitForFunction(() => window.__game !== undefined && document.body.classList.contains('is-ready'), null, { timeout: 30000 });
}

const windowLocator = (page) => page.getByRole('dialog', { name: INSTRUCTIONS.title });

/** The whole window (close button included) is in a 1280 x 600 browser window, with no scrolling. */
async function expectFits(page, dialog) {
  const box = await dialog.boundingBox();
  expect(box.y).toBeGreaterThanOrEqual(0);
  expect(box.y + box.height).toBeLessThanOrEqual(600);
  expect(await page.evaluate(() => {
    const backdrop = document.querySelector('.modal.instructions').parentElement;
    return backdrop.scrollHeight <= backdrop.clientHeight;
  })).toBe(true);
}

/**
 * The longest instructions.json the validator allows, made of points of
 * `itemLength` characters (Danish words) spread over `sections` sections.
 */
function longestAllowed(itemLength, introLength, sections, long = false) {
  const words = (long
    ? 'Undervisningsforløbene teknologianvendelsen pædagogikonsulenterne læringsplatformene skoleudviklingsprojekterne'
    : 'Placér personen efter hvordan vedkommende bruger teknologi i undervisningen og snak sammen om det').split(' ');
  const text = (n) => {
    let s = '';
    for (let i = 0; s.length < n; i++) s += (s ? ' ' : '') + words[i % words.length];
    return s.slice(0, n).trimEnd();
  };
  const c = { title: long ? text(45).toUpperCase() : text(45), intro: text(introLength), sections: [], close: 'Luk' };
  for (let k = 0; k < sections; k++) c.sections.push({ heading: text(40), items: [text(itemLength)] });
  for (let added = true; added;) {
    added = false;
    for (const s of c.sections) {
      if (s.items.length >= 6) continue;
      s.items.push(text(itemLength));
      if (instructionsLines(c) > INSTRUCTIONS_MAX_LINES) s.items.pop();
      else added = true;
    }
  }
  return c;
}

test('instructions: open at the start with the text from instructions.json, and fit a 1280 x 600 window', async ({ page }) => {
  test.setTimeout(60000);
  await page.setViewportSize({ width: 1280, height: 600 });
  await openGame(page);
  const dialog = windowLocator(page);
  await expect(dialog).toBeVisible();
  if (INSTRUCTIONS.intro) await expect(dialog).toContainText(INSTRUCTIONS.intro);
  for (const section of INSTRUCTIONS.sections) {
    await expect(dialog.getByRole('heading', { name: section.heading })).toBeVisible();
    for (const item of section.items) await expect(dialog.getByRole('listitem').filter({ hasText: item })).toHaveCount(1);
  }
  const close = dialog.getByRole('button', { name: INSTRUCTIONS.close, exact: true });
  await expect(close).toBeFocused();
  await expectFits(page, dialog);
  await page.screenshot({ path: 'docs/screenshots/instructions.png' });

  // While it is open, a click that reaches the scene does not walk (the
  // canvas is under the backdrop, so the click is sent to it directly).
  const start = await page.evaluate(() => window.__game.getPlayerTile());
  const target = await page.evaluate(([c, r]) => window.__game.tileToScreen(c, r), [start.col, start.row - 2]);
  await page.locator('#scene').dispatchEvent('click', { clientX: target.x, clientY: target.y });
  await page.waitForTimeout(500);
  expect(await page.evaluate(() => window.__game.getPlayerTile())).toEqual(start);
  await expect(dialog).toBeVisible();
  await expect(close).toBeFocused();

  await close.click();
  await expect(dialog).toBeHidden();
  await expect(page.locator('#scene')).toBeFocused();
});

test('instructions: the menu button, left of Færdig, opens the window again; Esc closes it', async ({ page }) => {
  test.setTimeout(60000);
  await openGame(page);
  await windowLocator(page).getByRole('button', { name: INSTRUCTIONS.close, exact: true }).click();
  await expect(windowLocator(page)).toBeHidden();

  const menu = page.getByRole('navigation', { name: UI['menu.label'] });
  const labels = await menu.locator('.menu__button').allTextContents();
  expect(labels).toEqual([UI['menu.samr'], UI['menu.rogers'], UI['menu.instructions'], UI['menu.finish']]);

  const button = menu.getByRole('button', { name: UI['menu.instructions'], exact: true });
  await expect(button).toHaveAttribute('aria-haspopup', 'dialog');
  await button.click();
  await expect(windowLocator(page)).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(windowLocator(page)).toBeHidden();
  await expect(page.locator('#scene')).toBeFocused();
});

// The validator's limit (INSTRUCTIONS_MAX_LINES) is what makes a text fit:
// the longest texts it allows, of short and of long points, fit too.
for (const [itemLength, introLength, sections, long] of [[80, 240, 4, false], [160, 240, 4, false], [300, 80, 1, false], [160, 240, 4, true], [240, 240, 3, true]]) {
  test(`instructions: the longest allowed text fits (points of ${itemLength} characters, ${sections} section(s)${long ? ', long words, capitals' : ''})`, async ({ page }) => {
    test.setTimeout(60000);
    const content = longestAllowed(itemLength, introLength, sections, long);
    // Within one more point of the limit (a point of 300 characters is 4 lines).
    expect(instructionsLines(content)).toBeGreaterThan(INSTRUCTIONS_MAX_LINES - 4);
    await page.route('**/content/instructions.json', (route) => route.fulfill({ json: content }));
    await page.setViewportSize({ width: 1280, height: 600 });
    await page.goto('/index.html');
    await page.waitForFunction(() => document.body.classList.contains('is-ready'), null, { timeout: 30000 });
    const dialog = page.getByRole('dialog', { name: content.title });
    await expect(dialog).toBeVisible();
    await expectFits(page, dialog);
  });
}

test('instructions: in a window too small for it, it opens scrolled to the top', async ({ page }) => {
  test.setTimeout(60000);
  await page.setViewportSize({ width: 1024, height: 400 });
  await openGame(page);
  const dialog = windowLocator(page);
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('button', { name: INSTRUCTIONS.close, exact: true })).toBeFocused();
  expect(await page.evaluate(() => document.querySelector('.modal.instructions').parentElement.scrollTop)).toBe(0);
  const title = await dialog.getByRole('heading', { name: INSTRUCTIONS.title }).boundingBox();
  expect(title.y).toBeGreaterThanOrEqual(0);
});
