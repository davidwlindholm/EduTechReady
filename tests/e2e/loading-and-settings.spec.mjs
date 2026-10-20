import { existsSync, readFileSync } from 'node:fs';
import { test, expect } from './fixtures.mjs';
import { UI, WALK_TIMEOUT, talkTo } from './helpers.mjs';

// Loading screen with real progress, the WebGL 2 message, the
// shadows setting (own storage key), and the side-by-side comparison with
// the mockup (docs/screenshots/loading-and-settings-compare.png).

// The design mockup is not part of the public repository; the comparison
// test skips when it is missing.
const MOCKUP = new URL('../../notes/reference/mockup.jpeg', import.meta.url);
const SETTINGS_KEY = 'lounge:settings:v1';

async function openGame(page, query = 'debug=1') {
  await page.setViewportSize({ width: 1376, height: 768 });
  await page.goto(`/index.html?${query}`);
  await page.waitForFunction(() => document.body.classList.contains('is-ready'), null, { timeout: 60000 });
}

/** The debug HUD's numbers, once it has measured (debug=1). */
async function hudNumbers(page) {
  const hud = page.locator('.debug-hud');
  await expect(hud).toHaveText(/FPS \d+ \| draw calls \d+/, { timeout: 10000 });
  const [, fps, calls] = (await hud.textContent()).match(/FPS (\d+) \| draw calls (\d+)/);
  return { fps: Number(fps), calls: Number(calls) };
}

test('the loading screen shows real progress from the model downloads', async ({ page }) => {
  test.setTimeout(90000);
  // Record every progress value the bar takes.
  await page.addInitScript(() => {
    window.__progress = [];
    document.addEventListener('DOMContentLoaded', () => {
      const bar = document.getElementById('loading-bar');
      new MutationObserver(() => window.__progress.push(Number(bar.getAttribute('aria-valuenow'))))
        .observe(bar, { attributes: true, attributeFilter: ['aria-valuenow'] });
    });
  });
  // Slow the GLBs down a little, so the bar is seen moving.
  await page.route('**/assets/models/*.glb', async (route) => {
    await new Promise((r) => setTimeout(r, 150));
    await route.continue();
  });
  await page.setViewportSize({ width: 1376, height: 768 });
  await page.goto('/index.html');
  await expect(page.locator('#loading-text')).toHaveText(UI['app.loading']);
  await page.waitForFunction(() => document.body.classList.contains('is-ready'), null, { timeout: 60000 });
  await expect(page.locator('#loading')).toBeHidden();
  const values = await page.evaluate(() => window.__progress);
  expect(values.length, `progress steps: ${values}`).toBeGreaterThan(5);
  expect(values.some((v) => v > 0 && v < 100), 'intermediate values').toBe(true);
  expect(values.at(-1)).toBe(100);
  // Never backwards.
  values.slice(1).forEach((v, i) => expect(v).toBeGreaterThanOrEqual(values[i]));
});

test('without WebGL 2 the game says so in Danish', async ({ page }) => {
  test.setTimeout(30000);
  await page.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function getContext(type, ...rest) {
      return type === 'webgl2' ? null : original.call(this, type, ...rest);
    };
  });
  await page.setViewportSize({ width: 1376, height: 768 });
  await page.goto('/index.html');
  const alert = page.getByRole('alert');
  await expect(alert).toHaveText(UI['app.noWebgl']);
  await expect(page.locator('#loading')).toBeHidden();
  await expect(page.locator('body')).not.toHaveClass(/is-ready/);
  await page.screenshot({ path: 'docs/screenshots/loading-and-settings-no-webgl.png' });
});

test('the shadows setting switches shadows and persists under its own key', async ({ page }) => {
  test.setTimeout(90000);
  await openGame(page);
  const toggle = page.getByRole('button', { name: UI['menu.shadows'] });
  await expect(toggle).toHaveAttribute('aria-pressed', 'true');
  const on = await hudNumbers(page);

  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-pressed', 'false');
  // The shadow pass is gone, so the frame needs fewer draw calls.
  await expect.poll(async () => (await hudNumbers(page)).calls, { timeout: 15000 }).toBeLessThan(on.calls);
  const stored = await page.evaluate((key) => JSON.parse(localStorage.getItem(key)), SETTINGS_KEY);
  expect(stored).toEqual({ shadows: false });
  // The game state is untouched: no settings inside it.
  const state = await page.evaluate(() => window.__game.getState());
  expect(Object.keys(state).sort()).toEqual(['asked', 'clientId', 'met', 'placements', 'submitted', 'submittedAt']);

  await page.reload();
  await page.waitForFunction(() => document.body.classList.contains('is-ready'), null, { timeout: 60000 });
  await expect(page.getByRole('button', { name: UI['menu.shadows'] })).toHaveAttribute('aria-pressed', 'false');
  await page.getByRole('button', { name: UI['menu.shadows'] }).click();
  await expect(page.getByRole('button', { name: UI['menu.shadows'] })).toHaveAttribute('aria-pressed', 'true');
  expect(await page.evaluate((key) => JSON.parse(localStorage.getItem(key)), SETTINGS_KEY)).toEqual({ shadows: true });
});

test('Færdig, SAMR and Rogers announce their dialogs', async ({ page }) => {
  test.setTimeout(60000);
  await openGame(page);
  for (const key of ['menu.samr', 'menu.rogers', 'menu.instructions', 'menu.finish']) {
    await expect(page.getByRole('button', { name: UI[key], exact: true })).toHaveAttribute('aria-haspopup', 'dialog');
  }
});

test('the game next to the mockup', async ({ page, browser }) => {
  test.skip(!existsSync(MOCKUP), 'the design mockup (notes/reference/mockup.jpeg) is not in this checkout');
  test.setTimeout(120000);
  await openGame(page);
  // The mockup has no notice and no debug counter.
  await page.getByRole('button', { name: UI['notice.close'] }).click();
  await page.evaluate(() => document.querySelector('.debug-hud')?.classList.add('visually-hidden'));
  // As in the mockup: Mette's dialogue open.
  await talkTo(page, 'mette', 'Mette (Underviser)');
  await page.waitForFunction(() => window.__game.isIdle(), null, { timeout: WALK_TIMEOUT, polling: 100 });
  await page.mouse.move(1370, 400);
  const game = (await page.screenshot()).toString('base64');
  const mockup = readFileSync(MOCKUP).toString('base64');

  // Side by side on a blank page (no CSP there), each at its own 1376 x 768.
  const sheet = await browser.newPage({ viewport: { width: 2 * 1376 + 48, height: 768 + 72 } });
  await sheet.setContent(`<!doctype html><html><body style="margin:0;background:#1d1b18;color:#fff;font:600 18px system-ui">
    <div style="display:flex;gap:16px;padding:12px 16px">
      <figure style="margin:0"><figcaption style="margin-bottom:8px">Spillet</figcaption>
        <img src="data:image/png;base64,${game}" width="1376" height="768"></figure>
      <figure style="margin:0"><figcaption style="margin-bottom:8px">Mockup</figcaption>
        <img src="data:image/jpeg;base64,${mockup}" width="1376" height="768"></figure>
    </div></body></html>`);
  await sheet.evaluate(() => Promise.all([...document.images].map((img) => img.decode())));
  await sheet.screenshot({ path: 'docs/screenshots/loading-and-settings-compare.png' });
  await sheet.close();
});
