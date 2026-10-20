import { test, expect } from './fixtures.mjs';

async function openGame(page) {
  await page.setViewportSize({ width: 1376, height: 768 });
  await page.goto('/index.html?debug=1');
  await page.waitForFunction(() => window.__game !== undefined && document.body.classList.contains('is-ready'), null, { timeout: 30000 });
}

async function drawCalls(page) {
  const hud = page.locator('.debug-hud');
  await expect(hud).toContainText('draw calls');
  return Number(/draw calls (\d+)/.exec(await hud.textContent())[1]);
}

test('furniture, props and the debug grid overlay', async ({ page }) => {
  await openGame(page);
  await page.waitForTimeout(500); // a few frames so shadows and labels settle

  // Merged static furniture keeps the scene inside the 150 draw-call budget
  // (furniture and NPCs included; shadow passes count too).
  const calls = await drawCalls(page);
  expect(calls).toBeLessThan(150);
  await page.screenshot({ path: 'docs/screenshots/furniture-room.png' });

  // G shows the overlay: it adds draw calls and marks the body.
  await page.keyboard.press('g');
  await expect(page.locator('body')).toHaveClass(/is-grid-overlay/);
  // The HUD refreshes twice a second; poll until it shows the overlay's draw call.
  await expect.poll(() => drawCalls(page), { timeout: 5000 }).toBeGreaterThan(calls);
  await page.screenshot({ path: 'docs/screenshots/furniture-grid.png' });

  // G again hides it.
  await page.keyboard.press('G');
  await expect(page.locator('body')).not.toHaveClass(/is-grid-overlay/);
});

test('no grid overlay without debug=1', async ({ page }) => {
  await page.setViewportSize({ width: 1376, height: 768 });
  await page.goto('/index.html');
  await page.waitForFunction(() => document.body.classList.contains('is-ready'), null, { timeout: 30000 });
  await page.keyboard.press('g');
  await page.waitForTimeout(200);
  await expect(page.locator('body')).not.toHaveClass(/is-grid-overlay/);
});
