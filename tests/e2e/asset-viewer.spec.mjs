import { test, expect } from './fixtures.mjs';

test('asset viewer loads every model with a clean console', async ({ page }) => {
  // public/dev/ is never deployed, so the upload package has no viewer
  // (E2E_BASE_URL runs; see README.md). php -S answers a missing file with
  // index.html, so look for the viewer's script rather than a 404.
  const viewer = await page.request.get('/dev/assets.html');
  const hasViewer = viewer.ok() && (await viewer.text()).includes('assets.js');
  test.skip(Boolean(process.env.E2E_BASE_URL) && !hasViewer, 'dev pages are not in the upload package');
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.goto('/dev/assets.html');
  await page.waitForFunction(() => window.__assetViewer?.done === true, null, { timeout: 60000 });
  const state = await page.evaluate(() => window.__assetViewer);
  expect(state.errors).toEqual([]);
  expect(state.loaded).toBe(state.total);
  const manifest = await (await page.request.get('/content/assets.json')).json();
  expect(state.total).toBe(Object.keys(manifest.models).length);
  expect(state.total).toBeGreaterThanOrEqual(29);
  // Characters are scaled to 1.7 m in their idle pose (within 5 cm).
  for (const [id, height] of Object.entries(state.characterHeights)) {
    expect(Math.abs(height - 1.7), `${id} height ${height}`).toBeLessThan(0.05);
  }
  expect(Object.keys(state.characterHeights)).toHaveLength(8);
  await page.waitForTimeout(1000);
  await page.screenshot({ path: 'docs/screenshots/asset-viewer-assets.png' });
});
