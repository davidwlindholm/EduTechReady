import { test, expect } from './fixtures.mjs';

async function openGame(page) {
  await page.setViewportSize({ width: 1376, height: 768 });
  await page.goto('/index.html?debug=1');
  await page.waitForFunction(() => window.__game !== undefined && document.body.classList.contains('is-ready'), null, { timeout: 30000 });
}

const playerTile = (page) => page.evaluate(() => window.__game.getPlayerTile());

/** Click a tile centre and wait until the player has started and then stopped walking. */
async function walkTo(page, col, row) {
  const p = await page.evaluate(([c, r]) => window.__game.tileToScreen(c, r), [col, row]);
  await page.mouse.click(p.x, p.y);
  await page.waitForFunction(() => !window.__game.isIdle(), null, { timeout: 5000 });
  // Long walks at 1.4 m/s on top of slow SwiftShader frames.
  await page.waitForFunction(() => window.__game.isIdle(), null, { timeout: 30000, polling: 100 });
}

test('walk through the open door into the hallway and back', async ({ page }) => {
  test.setTimeout(90000);
  await openGame(page);
  const start = await playerTile(page);
  expect(start).toEqual({ col: 8, row: 7 }); // playerStart

  // The hallway is only reachable through the open door at (5, 3); a straight
  // line would cross the glass wall. Record the tiles on the way.
  const p = await page.evaluate(() => window.__game.tileToScreen(3, 1));
  await page.mouse.click(p.x, p.y);
  await page.waitForFunction(() => !window.__game.isIdle(), null, { timeout: 5000 });
  const visited = await page.evaluate(() => new Promise((resolve) => {
    const tiles = new Set();
    const tick = () => {
      const t = window.__game.getPlayerTile();
      tiles.add(`${t.col},${t.row}`);
      if (window.__game.isIdle()) resolve([...tiles]);
      else requestAnimationFrame(tick);
    };
    tick();
  }));
  expect(await playerTile(page)).toEqual({ col: 3, row: 1 });
  expect(visited).toContain('5,3'); // the open door
  // Never on a glass tile (row 3 other than the door).
  expect(visited.filter((k) => k.endsWith(',3') && k !== '5,3')).toEqual([]);

  // And back into the lounge.
  await walkTo(page, 8, 7);
  expect(await playerTile(page)).toEqual(start);
  await page.screenshot({ path: 'docs/screenshots/walking-walk.png' });
});

test('clicking the closed door stops at the nearest reachable tile', async ({ page }) => {
  test.setTimeout(90000);
  await openGame(page);
  // The closed door is the west end of the hallway, (0, 1); (1, 1) is the
  // hallway tile next to it.
  await walkTo(page, 0, 1);
  expect(await playerTile(page)).toEqual({ col: 1, row: 1 });
});

test('a new click during a walk re-paths from where the player is', async ({ page }) => {
  test.setTimeout(60000);
  await openGame(page);
  const far = await page.evaluate(() => window.__game.tileToScreen(11, 10));
  await page.mouse.click(far.x, far.y);
  await page.waitForFunction(() => !window.__game.isIdle(), null, { timeout: 5000 });
  // Let it get under way, then send it elsewhere.
  await page.waitForFunction(() => {
    const t = window.__game.getPlayerTile();
    return t.row >= 8;
  }, null, { timeout: 15000, polling: 50 });
  const before = await playerTile(page);
  await walkTo(page, 10, 6);
  expect(await playerTile(page)).toEqual({ col: 10, row: 6 });
  expect(before.row).toBeGreaterThanOrEqual(8);
});

test('scene clicks are ignored while a panel is open', async ({ page }) => {
  await openGame(page);
  const start = await playerTile(page);
  await page.getByRole('button', { name: 'SAMR', exact: true }).click();
  const panel = page.getByRole('dialog', { name: /SAMR/ });
  await expect(panel).toBeVisible();
  // The modal backdrop covers the canvas; dispatch straight on the canvas to
  // check the click handler itself refuses to walk.
  const p = await page.evaluate(() => window.__game.tileToScreen(10, 9));
  await page.evaluate(({ x, y }) => {
    document.getElementById('scene').dispatchEvent(new MouseEvent('click', { clientX: x, clientY: y, bubbles: true }));
  }, p);
  await page.waitForTimeout(300);
  expect(await page.evaluate(() => window.__game.isIdle())).toBe(true);
  expect(await playerTile(page)).toEqual(start);
  await page.keyboard.press('Escape');
  await expect(panel).toBeHidden();
});
