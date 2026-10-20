import { readFileSync } from 'node:fs';
import { test, expect } from './fixtures.mjs';

// The facilitator page makes a session code, shows full participant
// and projector links with copy buttons, and never calls the API.
const UI = JSON.parse(readFileSync(new URL('../../public/content/ui.json', import.meta.url), 'utf8'));
const CODE = /^[A-HJ-NP-Z2-9]{6}$/;
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

/** Record every request to api/ made by a page. */
function trackApi(page) {
  const calls = [];
  page.on('request', (req) => {
    if (new URL(req.url()).pathname.includes('/api/')) calls.push(req.url());
  });
  return calls;
}

/** "Lav en ny kode", confirmed (the button asks first). */
async function makeNewCode(page) {
  await page.getByRole('button', { name: UI['facilitator.newCode'] }).click();
  await page.getByRole('button', { name: UI['facilitator.newCodeYes'] }).click();
}

async function openFacilitator(page, query = '') {
  await page.setViewportSize({ width: 1100, height: 820 });
  await page.goto(`/facilitator.html${query}`);
  const code = page.locator('[data-code]');
  await expect(code).toHaveText(CODE);
  return (await code.textContent()).trim();
}

test('shows a valid code and full links built from the page location', async ({ page, baseURL }) => {
  test.setTimeout(30000);
  const api = trackApi(page);
  const code = await openFacilitator(page);

  await expect(page).toHaveTitle(UI['facilitator.title']);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(UI['facilitator.heading']);
  const participant = page.getByRole('textbox', { name: UI['facilitator.participant.heading'] });
  const projector = page.getByRole('textbox', { name: UI['facilitator.projector.heading'] });
  await expect(participant).toHaveValue(new URL(`/index.html?session=${code}`, baseURL).href);
  await expect(projector).toHaveValue(new URL(`/results.html?session=${code}`, baseURL).href);
  await expect(page.locator('[data-open="participant"]')).toHaveAttribute('href', new URL(`/index.html?session=${code}`, baseURL).href);

  // The code goes into the address bar, so a reload keeps it.
  expect(new URL(page.url()).searchParams.get('session')).toBe(code);
  await page.reload();
  await expect(page.locator('[data-code]')).toHaveText(code);

  // "Lav en ny kode" replaces the code and both links.
  await makeNewCode(page);
  await expect(page.locator('[data-code]')).not.toHaveText(code);
  const fresh = (await page.locator('[data-code]').textContent()).trim();
  expect(fresh).toMatch(CODE);
  await expect(participant).toHaveValue(new URL(`/index.html?session=${fresh}`, baseURL).href);
  await expect(projector).toHaveValue(new URL(`/results.html?session=${fresh}`, baseURL).href);
  expect(new URL(page.url()).searchParams.get('session')).toBe(fresh);

  // An invalid code in the address bar is replaced by a new one.
  const replaced = await openFacilitator(page, '?session=BAD0O1');
  expect(replaced).not.toBe('BAD0O1');
  // A lowercase valid code is accepted and normalised.
  expect(await openFacilitator(page, '?session=k7mp3q')).toBe('K7MP3Q');

  expect(api).toEqual([]);
});

test('copy buttons copy the full link and say "Kopieret"', async ({ page, context }) => {
  test.setTimeout(30000);
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await openFacilitator(page);

  for (const id of ['participant', 'projector']) {
    const button = page.locator(`[data-copy="${id}"]`);
    await expect(button).toHaveText(UI['facilitator.copy']);
    await button.click();
    await expect(button).toHaveText(UI['facilitator.copied']);
    await expect(page.getByRole('status')).toHaveText(UI['facilitator.copiedStatus']);
    const copied = await page.evaluate(() => navigator.clipboard.readText());
    expect(copied).toBe(await page.locator(`[data-link="${id}"]`).inputValue());
    // The label reverts after a moment.
    await expect(button).toHaveText(UI['facilitator.copy'], { timeout: 5000 });
  }

  // A new code right after a copy: the button must not keep saying "Kopieret".
  const projector = page.locator('[data-copy="projector"]');
  await projector.click();
  await expect(projector).toHaveText(UI['facilitator.copied']);
  await makeNewCode(page);
  await expect(projector).toHaveText(UI['facilitator.copy'], { timeout: 1000 });
  await expect(projector).not.toHaveClass(/is-copied/);
});

test('a failed copy selects the link and shows a warning, not success', async ({ page }) => {
  test.setTimeout(30000);
  await page.addInitScript(() => {
    navigator.clipboard.writeText = () => Promise.reject(new DOMException('denied', 'NotAllowedError'));
  });
  await openFacilitator(page);
  const status = page.getByRole('status');
  await page.locator('[data-copy="participant"]').click();
  await expect(status).toHaveText(UI['facilitator.copyFailed']);
  await expect(status).toHaveClass(/is-warning/);
  await expect(page.locator('[data-copy="participant"]')).toHaveText(UI['facilitator.copy']);
  await expect(page.locator('[data-link="participant"]')).toBeFocused();
  const color = await status.evaluate((el) => getComputedStyle(el).color);
  expect(color).not.toBe('rgb(155, 210, 122)'); // --green
  // A later success message drops the warning colour again.
  await makeNewCode(page);
  await expect(status).not.toHaveClass(/is-warning/);
});

test('a new code needs confirmation and can be undone', async ({ page }) => {
  test.setTimeout(30000);
  const code = await openFacilitator(page, '?session=K7MP3Q');
  const newCode = page.getByRole('button', { name: UI['facilitator.newCode'] });
  // Asking first: "Behold koden" (focused) and Esc both keep the code.
  await newCode.click();
  const keep = page.getByRole('button', { name: UI['facilitator.newCodeNo'] });
  await expect(keep).toBeFocused();
  await expect(page.getByText(UI['facilitator.newCodeConfirm'].replace('{code}', code))).toBeVisible();
  await keep.click();
  await expect(page.locator('[data-code]')).toHaveText(code);
  await expect(newCode).toBeFocused();
  await newCode.click();
  await page.keyboard.press('Escape');
  await expect(page.locator('[data-code]')).toHaveText(code);
  await expect(newCode).toBeFocused();
  // Confirmed: a new code, and a way back to the old one.
  await makeNewCode(page);
  await expect(page.locator('[data-code]')).not.toHaveText(code);
  const undo = page.getByRole('button', { name: UI['facilitator.undo'].replace('{code}', code) });
  await undo.click();
  await expect(page.locator('[data-code]')).toHaveText(code);
  await expect(page.getByRole('status')).toHaveText(UI['facilitator.undoStatus'].replace('{code}', code));
  expect(new URL(page.url()).searchParams.get('session')).toBe(code);
  await expect(undo).toBeHidden();
});

test('screenshot', async ({ page }) => {
  test.setTimeout(30000);
  await openFacilitator(page, '?session=K7MP3Q');
  await page.locator('[data-copy="participant"]').evaluate((b) => b.blur());
  await page.screenshot({ path: 'docs/screenshots/facilitator-facilitator.png', fullPage: true });
});

test('the participant link starts the game in session mode', async ({ page, context }) => {
  test.setTimeout(90000);
  const code = await openFacilitator(page);
  const popupPromise = context.waitForEvent('page');
  await page.locator('[data-open="participant"]').click();
  const game = await popupPromise;
  // The fixture only watches `page`; watch the game tab here.
  const problems = [];
  game.on('console', (msg) => { if (msg.type() === 'error') problems.push(msg.text()); });
  game.on('pageerror', (err) => problems.push(err.message));

  await game.waitForLoadState('domcontentloaded');
  const url = new URL(game.url());
  expect(url.pathname).toBe('/index.html');
  expect(url.searchParams.get('session')).toBe(code);
  await game.waitForFunction(() => document.body.classList.contains('is-ready'), null, { timeout: 45000 });

  // Same address plus debug=1, for the debug API: in session mode the
  // stored state has a UUID v4 clientId under lounge:v1:<CODE>.
  await game.goto(`${url.href}&debug=1`);
  await game.waitForFunction(() => window.__game !== undefined && document.body.classList.contains('is-ready'), null, { timeout: 45000 });
  const state = await game.evaluate(() => window.__game.getState());
  expect(state.clientId).toMatch(UUID_V4);
  const stored = await game.evaluate((k) => localStorage.getItem(k), `lounge:v1:${code}`);
  expect(stored, `localStorage lounge:v1:${code}`).not.toBeNull();
  expect(JSON.parse(stored).clientId).toBe(state.clientId);
  expect(await game.evaluate(() => localStorage.getItem('lounge:v1:practice'))).toBeNull();

  expect(problems).toEqual([]);
});
