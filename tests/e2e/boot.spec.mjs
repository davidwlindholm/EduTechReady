import { test, expect } from './fixtures.mjs';

test('the game canvas renders with a clean console', async ({ page }) => {
  await page.goto('/index.html');
  await expect(page.locator('#scene')).toBeVisible();
  await page.waitForTimeout(800);
  // Only the canvas and a clean console are checked here; later specs cover the scene.
});
