import { test, expect } from './fixtures.mjs';
import { talkTo } from './helpers.mjs';

// The config's SwiftShader flags, plus window.gc() for the memory test below.
test.use({ launchOptions: { args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--js-flags=--expose-gc'] } });

// Regression: switching from one character to another showed the
// previous character's portrait for a moment. The new portrait is held back
// here until the test releases it; meanwhile the portrait frame must not
// show the previous face (checked on the screen's pixels, since a browser
// keeps painting the old image while the new one loads), and then the new one.
// Two things prevent the flash: the dialogue hides an image until it has
// decoded, and it loads every portrait at start and keeps them
// (ui/dialogue.js, preloadPortraits). With the start-up loading taken out,
// this test fails on the old dialogue code and passes with the hiding
// (checked 2026-10-19).

/** How many pixels in the portrait frame are close to a colour. */
async function framePixels(page, [tr, tg, tb]) {
  const png = (await page.locator('.dialogue__portrait').screenshot()).toString('base64');
  return page.evaluate(async ([b64, t]) => {
    const img = new Image();
    img.src = `data:image/png;base64,${b64}`;
    await img.decode();
    const c = document.createElement('canvas');
    c.width = img.width;
    c.height = img.height;
    const ctx = c.getContext('2d');
    ctx.drawImage(img, 0, 0);
    const { data } = ctx.getImageData(0, 0, c.width, c.height);
    let n = 0;
    for (let i = 0; i < data.length; i += 4) {
      if (Math.abs(data[i] - t[0]) + Math.abs(data[i + 1] - t[1]) + Math.abs(data[i + 2] - t[2]) < 30) n++;
    }
    return n;
  }, [png, [tr, tg, tb]]);
}

// The shirt colours in the two portraits (assets/portraits/*.webp, sampled
// at the bottom of each image). Sample again if a portrait is replaced.
const METTE = [77, 112, 156];
const JONAS = [91, 140, 84];

test('portrait: switching characters never shows the previous portrait', async ({ page }) => {
  test.setTimeout(120000);
  let release;
  const held = new Promise((resolve) => { release = resolve; });
  await page.route('**/assets/portraits/jonas.*', async (route) => {
    await held;
    await route.continue();
  });
  await page.goto('/index.html?debug=1');
  await page.waitForFunction(() => window.__game !== undefined && document.body.classList.contains('is-ready'), null, { timeout: 30000 });

  await talkTo(page, 'mette');
  await expect.poll(() => framePixels(page, METTE)).toBeGreaterThan(300);

  // Jonas replaces Mette; his portrait has not arrived yet.
  await talkTo(page, 'jonas');
  await page.waitForTimeout(300);
  expect(await framePixels(page, METTE), 'Mette\'s face while Jonas talks').toBe(0);
  release();
  await expect.poll(() => framePixels(page, JONAS)).toBeGreaterThan(300);
  expect(await framePixels(page, METTE)).toBe(0);
});

// Regression: in Vivaldi, which frees memory aggressively, a portrait
// took about half a second to appear. The browser had dropped the preloaded
// image, so the dialogue loaded it again, and Cache-Control: no-cache made
// that a round trip to the server. The dialogue now keeps every portrait's
// image element. Here the browser is made to free memory (garbage collection
// and a critical memory-pressure signal), and every portrait request is slow:
// opening a dialogue must still request nothing and show the face at once.
test.describe('portraits survive the browser freeing memory', () => {
  test('portrait: shown at once after the browser frees memory, with no new request', async ({ page }) => {
    test.setTimeout(120000);
    const requests = [];
    await page.route('**/assets/portraits/*', async (route) => {
      requests.push(route.request().url());
      await new Promise((resolve) => { setTimeout(resolve, 400); });
      await route.continue();
    });
    await page.goto('/index.html?debug=1');
    await page.waitForFunction(() => window.__game !== undefined && document.body.classList.contains('is-ready'), null, { timeout: 30000 });
    await expect.poll(() => requests.length).toBe(8);
    await page.waitForTimeout(1500);
    const cdp = await page.context().newCDPSession(page);
    for (let i = 0; i < 5; i++) {
      await page.evaluate(() => window.gc());
      await cdp.send('Memory.simulatePressureNotification', { level: 'critical' });
      await page.waitForTimeout(200);
    }
    const before = requests.length;
    // Time from the dialogue appearing to its portrait showing, in frames.
    const delay = await page.evaluate(async () => {
      const n = window.__game.npcToScreen('mette');
      document.getElementById('scene').dispatchEvent(new MouseEvent('click', { clientX: n.x, clientY: n.y, bubbles: true }));
      const frame = (test) => new Promise((resolve) => {
        const tick = () => (test() ? resolve(performance.now()) : requestAnimationFrame(tick));
        tick();
      });
      const opened = await frame(() => document.querySelector('.dialogue:not([hidden])'));
      const shown = await frame(() => {
        const img = document.querySelector('.dialogue__portrait-img');
        return img && img.complete && img.naturalWidth > 0 && !img.classList.contains('is-loading');
      });
      return shown - opened;
    });
    expect(requests.length - before, 'portrait requests when the dialogue opened').toBe(0);
    expect(delay).toBeLessThan(100);
  });
});
