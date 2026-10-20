import { test, expect } from './fixtures.mjs';

test('room shell from level.json', async ({ page }) => {
  await page.setViewportSize({ width: 1376, height: 768 });
  await page.goto('/index.html?debug=1');
  await page.waitForFunction(() => window.__game !== undefined && document.body.classList.contains('is-ready'), null, { timeout: 30000 });

  // The player starts on playerStart from level.json.
  const level = await (await page.request.get('/content/level.json')).json();
  expect(await page.evaluate(() => window.__game.getPlayerTile())).toEqual({ col: level.playerStart.col, row: level.playerStart.row });

  // The whole level box (every tile edge, from the floor to the 2.4 m wall tops)
  // fits the canvas with a 5% margin. The debug API only
  // projects tile centres at y = 0, so build the projection from three of them:
  // an orthographic camera is affine, and for the true isometric camera at
  // target + (d, d, d) a unit step up (+Y) projects to minus the sum of a unit
  // step along +X and a unit step along +Z.
  const cols = level.rows[0].length;
  const rows = level.rows.length;
  const tile = (c, r) => page.evaluate(([cc, rr]) => window.__game.tileToScreen(cc, rr), [c, r]);
  const o = await tile(0, 0);
  const ex = await tile(1, 0);
  const ez = await tile(0, 1);
  const vx = { x: ex.x - o.x, y: ex.y - o.y };
  const vz = { x: ez.x - o.x, y: ez.y - o.y };
  const vy = { x: -(vx.x + vz.x), y: -(vx.y + vz.y) };
  const project = (x, y, z) => ({
    x: o.x + (x - 0.5) * vx.x + y * vy.x + (z - 0.5) * vz.x,
    y: o.y + (x - 0.5) * vx.y + y * vy.y + (z - 0.5) * vz.y,
  });
  // The projection reproduces a fourth tile centre, so the model holds.
  const far = await tile(cols - 1, rows - 1);
  const farModel = project(cols - 0.5, 0, rows - 0.5);
  expect(Math.abs(far.x - farModel.x)).toBeLessThan(0.5);
  expect(Math.abs(far.y - farModel.y)).toBeLessThan(0.5);

  const canvas = await page.locator('#scene').boundingBox();
  const cx = canvas.x + canvas.width / 2;
  const cy = canvas.y + canvas.height / 2;
  let reachX = 0; // largest distance of a box corner from the canvas centre, per axis
  let reachY = 0;
  for (const x of [0, cols]) {
    for (const y of [0, 2.4]) {
      for (const z of [0, rows]) {
        const p = project(x, y, z);
        reachX = Math.max(reachX, Math.abs(p.x - cx));
        reachY = Math.max(reachY, Math.abs(p.y - cy));
      }
    }
  }
  // Each half of the canvas keeps at least the margin, and the tighter axis is
  // filled up to it (the frustum is fitted, not merely large enough).
  const fillX = reachX / (canvas.width / 2);
  const fillY = reachY / (canvas.height / 2);
  expect(fillX).toBeLessThanOrEqual(1 / 1.05 + 0.002);
  expect(fillY).toBeLessThanOrEqual(1 / 1.05 + 0.002);
  expect(Math.max(fillX, fillY)).toBeGreaterThan(1 / 1.05 - 0.002);

  // Merged static geometry keeps the draw-call count low: budget 150 with
  // furniture and NPCs, shadow passes included.
  const hud = page.locator('.debug-hud');
  await expect(hud).toContainText('draw calls');
  const calls = Number(/draw calls (\d+)/.exec(await hud.textContent())[1]);
  expect(calls).toBeLessThan(150);

  await page.waitForTimeout(500); // a few frames so shadows and labels settle
  await page.screenshot({ path: 'docs/screenshots/room-room.png' });
});
