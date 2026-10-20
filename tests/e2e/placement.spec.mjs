import { test, expect } from './fixtures.mjs';

// Placement panels with pins. State is seeded straight into
// localStorage so the tests need no walking: meeting all eight
// characters on foot would take minutes under SwiftShader.
const KEY = 'lounge:v1:practice';
const ALL = ['mette', 'jonas', 'karim', 'anne', 'sofie', 'lars', 'birgitte', 'henrik'];

/** Several pins, with Jonas, Mette and Anne close enough on SAMR (and Mette and Jonas on Rogers) to stack. */
const SCREENSHOT_PLACEMENTS = {
  mette: { samr: 62, rogers: 30 },
  jonas: { samr: 60, rogers: 32 },
  karim: { samr: 12, rogers: 70 },
  anne: { samr: 64, rogers: 8 },
  sofie: { samr: 88, rogers: 48 },
  lars: { samr: 100, rogers: 0 },
};

function seededState({ met = ALL, placements = {}, submitted = false } = {}) {
  return { clientId: null, met, asked: {}, placements, submitted, submittedAt: submitted ? '2026-10-15T10:00:00Z' : null };
}

async function waitReady(page) {
  await page.waitForFunction(() => window.__game !== undefined && document.body.classList.contains('is-ready'), null, { timeout: 30000 });
}

/** Load the game with a seeded state (written once, then a reload reads it). */
async function openSeeded(page, state) {
  await page.setViewportSize({ width: 1376, height: 768 });
  await page.goto('/index.html?debug=1');
  await waitReady(page);
  await page.evaluate(([k, s]) => localStorage.setItem(k, JSON.stringify(s)), [KEY, state]);
  await page.reload();
  await waitReady(page);
}

async function openPanel(page, name) {
  await page.getByRole('button', { name, exact: true }).click();
  const panel = page.getByRole('dialog', { name: new RegExp(name) });
  await expect(panel).toBeVisible();
  return panel;
}

const placement = (page, id, axis) => page.evaluate(([i, a]) => window.__game.getState().placements[i]?.[a] ?? null, [id, axis]);

/** Screen x of a value on the panel's axis. */
async function valueX(panel, value) {
  const box = await panel.locator('.placement__axis').boundingBox();
  return box.x + (box.width * value) / 100;
}

/** Centre x of a pin's needle tip (the triangle's point). */
async function tipX(pin) {
  const box = await pin.locator('.pin__tip').boundingBox();
  return box.x + box.width / 2;
}

async function ui(page) {
  return (await page.request.get('/content/ui.json')).json();
}

test('drag a token to a value, adjust it by keyboard, survive a reload', async ({ page }) => {
  test.setTimeout(90000);
  await openSeeded(page, seededState({ met: ['mette', 'jonas', 'karim'], placements: { jonas: { samr: 30, rogers: null } } }));
  const text = await ui(page);
  const panel = await openPanel(page, 'SAMR');
  // Only met characters get tokens.
  await expect(panel.locator('.token')).toHaveCount(3);
  const chip = panel.locator('.placement__tray .token[data-id="mette"]');
  await expect(chip).toBeVisible();

  // Drag the chip from the tray to value 62.
  const axisBox = await panel.locator('.placement__axis').boundingBox();
  const targetX = await valueX(panel, 62);
  const chipBox = await chip.boundingBox();
  await page.mouse.move(chipBox.x + chipBox.width / 2, chipBox.y + chipBox.height / 2);
  await page.mouse.down();
  // Each pointer move costs a rendered frame under SwiftShader; keep steps low.
  await page.mouse.move(targetX, axisBox.y + axisBox.height * 0.6, { steps: 3 });

  // Mid-drag: the guide line, the highlighted band and the live readout.
  const guide = panel.locator('.placement__guide');
  await expect(guide).toBeVisible();
  const guideBox = await guide.boundingBox();
  expect(Math.abs(guideBox.x + guideBox.width / 2 - targetX)).toBeLessThanOrEqual(1.5);
  expect(guideBox.height).toBeGreaterThanOrEqual(axisBox.height - 6); // runs through all the bands (minus the axis line)
  await expect(panel.locator('.placement__band.is-active')).toHaveCount(1);
  await expect(panel.locator('.placement__band').nth(2)).toHaveClass(/is-active/);
  const readout = panel.locator('.placement__readout');
  await expect(readout).toHaveText(`${text['samr.band.2']} · 62`);
  // Over the axis the chip shows as a pin preview whose tip is at the value,
  // with the readout just above its head.
  const ghost = panel.locator('.pin--ghost');
  await expect(ghost).toBeVisible();
  await expect(chip).toHaveCSS('opacity', '0');
  expect(Math.abs((await tipX(ghost)) - targetX)).toBeLessThanOrEqual(1.5);
  const readoutBox = await readout.boundingBox();
  const ghostHead = await ghost.locator('.pin__head').boundingBox();
  expect(readoutBox.y + readoutBox.height).toBeLessThanOrEqual(ghostHead.y + 1);
  expect(Math.abs(readoutBox.x + readoutBox.width / 2 - targetX)).toBeLessThanOrEqual(2);
  await page.screenshot({ path: 'docs/screenshots/placement-drag.png' });

  await page.mouse.up();
  const dropped = await placement(page, 'mette', 'samr');
  expect(Math.abs(dropped - 62)).toBeLessThanOrEqual(1);
  await expect(guide).toBeHidden();
  await expect(panel.locator('.pin--ghost')).toHaveCount(0);
  const pin = panel.locator('.placement__axis .token[data-id="mette"]');
  await expect(pin).toBeVisible();
  expect(Math.abs((await tipX(pin)) - (await valueX(panel, dropped)))).toBeLessThanOrEqual(1.5);

  // Keyboard: 1 per arrow, 5 with Shift. The readout follows the focused pin.
  await expect(pin).toBeFocused();
  // Moves update the pin in place (no rebuilt element, so no portrait reload).
  await pin.evaluate((el) => { el.dataset.testMark = 'same'; });
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Shift+ArrowRight');
  await page.keyboard.press('ArrowLeft');
  const adjusted = dropped + 1 + 5 - 1;
  expect(await placement(page, 'mette', 'samr')).toBe(adjusted);
  await expect(pin).toBeFocused();
  await expect(readout).toHaveText(`${text[`samr.band.${Math.min(3, Math.floor(adjusted / 25))}`]} · ${adjusted}`);
  await expect(pin).toHaveAccessibleName(new RegExp(`${adjusted} af 100`));
  await expect(pin).toHaveAttribute('data-test-mark', 'same');
  // Tab follows the pins from left to right (Jonas at 30, then Mette).
  await page.keyboard.press('Shift+Tab');
  await expect(panel.locator('.placement__axis .token[data-id="jonas"]')).toBeFocused();
  await expect(readout).toHaveText(`${text['samr.band.1']} · 30`);

  // Survives a reload.
  await page.reload();
  await waitReady(page);
  expect(await placement(page, 'mette', 'samr')).toBe(adjusted);
  const again = await openPanel(page, 'SAMR');
  const pinAgain = again.locator('.placement__axis .token[data-id="mette"]');
  expect(Math.abs((await tipX(pinAgain)) - (await valueX(again, adjusted)))).toBeLessThanOrEqual(1.5);
});

test('a pin keeps its grab offset, and drags back to the tray', async ({ page }) => {
  test.setTimeout(60000);
  await openSeeded(page, seededState({ met: ['jonas'], placements: { jonas: { samr: 40, rogers: null } } }));
  const panel = await openPanel(page, 'SAMR');
  const pin = panel.locator('.placement__axis .token[data-id="jonas"]');
  // Grab the head off-centre (its right edge); the value follows the needle.
  const head = await pin.locator('.pin__head').boundingBox();
  const grabX = head.x + head.width - 3;
  const grabY = head.y + head.height / 2;
  const dx = (await valueX(panel, 70)) - (await valueX(panel, 40));
  await page.mouse.move(grabX, grabY);
  await page.mouse.down();
  await page.mouse.move(grabX + dx, grabY, { steps: 2 });
  // Over the axis the pin slides sideways only: its tip stays on the axis line at the value.
  expect(Math.abs((await tipX(pin)) - (await valueX(panel, 70)))).toBeLessThanOrEqual(1.5);
  // The needle sits on the snapped value the readout shows, never between:
  // at a band edge (74.6 rounds to 75) and past the axis end (inside the drop slack).
  const guide = panel.locator('.placement__guide');
  const readout = panel.locator('.placement__readout');
  const guideX = async () => { const b = await guide.boundingBox(); return b.x + b.width / 2; };
  const offset = grabX - (await valueX(panel, 40));
  await page.mouse.move((await valueX(panel, 74.6)) + offset, grabY);
  await expect(readout).toHaveText(/ · 75$/);
  expect(Math.abs((await tipX(pin)) - (await valueX(panel, 75)))).toBeLessThanOrEqual(1.5);
  expect(Math.abs((await tipX(pin)) - (await guideX()))).toBeLessThanOrEqual(1.5);
  await page.mouse.move((await valueX(panel, 100)) + 40 + offset, grabY);
  await expect(readout).toHaveText(/ · 100$/);
  expect(Math.abs((await tipX(pin)) - (await valueX(panel, 100)))).toBeLessThanOrEqual(1.5);
  expect(Math.abs((await tipX(pin)) - (await guideX()))).toBeLessThanOrEqual(1.5);
  await page.mouse.move(grabX + dx, grabY);
  await expect(readout).toHaveText(/ · 70$/);
  await page.mouse.up();
  expect(Math.abs((await placement(page, 'jonas', 'samr')) - 70)).toBeLessThanOrEqual(1);

  // Press and release without moving keeps the value.
  const v = await placement(page, 'jonas', 'samr');
  const h2 = await pin.locator('.pin__head').boundingBox();
  await page.mouse.move(h2.x + 2, h2.y + h2.height / 2);
  await page.mouse.down();
  await page.mouse.up();
  expect(await placement(page, 'jonas', 'samr')).toBe(v);

  // Drag it down into the tray: removed.
  const tray = await panel.locator('.placement__tray').boundingBox();
  const h3 = await pin.locator('.pin__head').boundingBox();
  await page.mouse.move(h3.x + h3.width / 2, h3.y + h3.height / 2);
  await page.mouse.down();
  await page.mouse.move(tray.x + tray.width / 2, tray.y + tray.height / 2, { steps: 2 });
  await expect(panel.locator('.placement__tray')).toHaveClass(/is-drop-target/);
  await page.mouse.up();
  expect(await placement(page, 'jonas', 'samr')).toBeNull();
  await expect(panel.locator('.placement__tray .token[data-id="jonas"]')).toBeVisible();

  // Keyboard: Enter places at 50, Delete returns to the tray.
  await panel.locator('.token[data-id="jonas"]').focus();
  await page.keyboard.press('Enter');
  expect(await placement(page, 'jonas', 'samr')).toBe(50);
  await page.keyboard.press('Delete');
  expect(await placement(page, 'jonas', 'samr')).toBeNull();
  await expect(panel.locator('.placement__tray .token[data-id="jonas"]')).toBeFocused();
});

test('Rogers drag shows the category readout; drops past the end clamp', async ({ page }) => {
  test.setTimeout(60000);
  await openSeeded(page, seededState({ met: ['sofie'] }));
  const text = await ui(page);
  const panel = await openPanel(page, 'Rogers');
  // Five regions with their shares.
  await expect(panel.locator('.placement__band-share')).toHaveText(['2,5 %', '13,5 %', '34 %', '34 %', '16 %']);
  await expect(panel.locator('.placement__curve path')).toHaveCount(6);
  const chip = panel.locator('.token[data-id="sofie"]');
  const box = await chip.boundingBox();
  const axisBox = await panel.locator('.placement__axis').boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(await valueX(panel, 38), axisBox.y + axisBox.height * 0.7, { steps: 2 });
  await expect(panel.locator('.placement__readout')).toHaveText(`${text['rogers.category.2']} · 38`);
  await expect(panel.locator('.placement__band').nth(2)).toHaveClass(/is-active/);
  // Past the right end of the axis (within the slack): clamps to 100.
  await page.mouse.move(axisBox.x + axisBox.width + 30, axisBox.y + axisBox.height * 0.7, { steps: 1 });
  await expect(panel.locator('.placement__readout')).toHaveText(`${text['rogers.category.4']} · 100`);
  await page.mouse.up();
  expect(await placement(page, 'sofie', 'rogers')).toBe(100);
  // Esc during a drag cancels it; Esc again closes the panel and focus returns to the canvas.
  await page.keyboard.press('Escape');
  await expect(panel).toBeHidden();
  await expect(page.locator('#scene')).toBeFocused();
});

test('stacked pins stay readable and every tip marks its value (screenshots)', async ({ page }) => {
  test.setTimeout(60000);
  await openSeeded(page, seededState({ placements: SCREENSHOT_PLACEMENTS }));
  for (const [name, axis] of [['SAMR', 'samr'], ['Rogers', 'rogers']]) {
    const panel = await openPanel(page, name);
    const dialogBox = await panel.boundingBox();
    const pins = panel.locator('.placement__axis .token');
    await expect(pins).toHaveCount(Object.keys(SCREENSHOT_PLACEMENTS).length);
    await expect(panel.locator('.placement__tray .token')).toHaveCount(ALL.length - Object.keys(SCREENSHOT_PLACEMENTS).length);
    const heads = [];
    for (const [id, values] of Object.entries(SCREENSHOT_PLACEMENTS)) {
      const pin = panel.locator(`.placement__axis .token[data-id="${id}"]`);
      expect(Math.abs((await tipX(pin)) - (await valueX(panel, values[axis]))), `${axis} ${id} tip`).toBeLessThanOrEqual(1.5);
      // The tip touches the axis line (the field's bottom edge).
      const axisBox = await panel.locator('.placement__axis').boundingBox();
      const tip = await pin.locator('.pin__tip').boundingBox();
      const axisLine = axisBox.y + axisBox.height - 4; // above the 4px bottom border
      expect(Math.abs(tip.y + tip.height - axisLine), `${axis} ${id} tip on the axis`).toBeLessThanOrEqual(1.5);
      const head = await pin.locator('.pin__head').boundingBox();
      expect(head.x, `${id} inside the panel`).toBeGreaterThanOrEqual(dialogBox.x);
      expect(head.x + head.width).toBeLessThanOrEqual(dialogBox.x + dialogBox.width);
      expect(head.y, `${id} below the band labels`).toBeGreaterThan(axisBox.y + (axis === 'samr' ? 34 : 50)); // LABEL_AREA
      heads.push({ id, ...head });
    }
    // No two heads overlap, so every name stays readable.
    for (let i = 0; i < heads.length; i += 1) {
      for (let j = i + 1; j < heads.length; j += 1) {
        const a = heads[i];
        const b = heads[j];
        const overlap = a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
        expect(overlap, `${axis}: ${a.id} and ${b.id} overlap`).toBe(false);
      }
    }
    // At least two pins are stacked.
    const levels = await pins.evaluateAll((els) => els.map((el) => Number(el.dataset.level)));
    expect(Math.max(...levels)).toBeGreaterThanOrEqual(1);
    await page.screenshot({ path: `docs/screenshots/placement-${axis}.png` });
    await page.keyboard.press('Escape');
    await expect(panel).toBeHidden();
  }
});

test('read-only after submission', async ({ page }) => {
  test.setTimeout(60000);
  await openSeeded(page, seededState({ met: ['mette', 'karim'], placements: { mette: { samr: 40, rogers: 60 } }, submitted: true }));
  const panel = await openPanel(page, 'SAMR');
  await expect(panel.locator('.placement__locked')).toBeVisible();
  await expect(panel.locator('.placement__instructions')).toBeHidden();
  await expect(panel).toHaveClass(/is-locked/);
  const pin = panel.locator('.placement__axis .token[data-id="mette"]');
  await expect(pin).toHaveAttribute('aria-disabled', 'true');
  // No dragging.
  const head = await pin.locator('.pin__head').boundingBox();
  await page.mouse.move(head.x + head.width / 2, head.y + head.height / 2);
  await page.mouse.down();
  await page.mouse.move(head.x + head.width / 2 + 120, head.y + head.height / 2, { steps: 2 });
  await page.mouse.up();
  expect(await placement(page, 'mette', 'samr')).toBe(40);
  // No keyboard moves, no placing from the tray.
  await pin.focus();
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Delete');
  expect(await placement(page, 'mette', 'samr')).toBe(40);
  await panel.locator('.token[data-id="karim"]').focus();
  await page.keyboard.press('Enter');
  expect(await placement(page, 'karim', 'samr')).toBeNull();
});

test('scene clicks are blocked while a panel is open; Esc returns focus to the canvas', async ({ page }) => {
  test.setTimeout(60000);
  await openSeeded(page, seededState({ met: ['lars'] }));
  const start = await page.evaluate(() => window.__game.getPlayerTile());
  const panel = await openPanel(page, 'SAMR');
  // The backdrop covers the canvas; dispatch a click on Lars straight on the
  // canvas (focused, as a real click would leave it) to check the handler itself.
  const p = await page.evaluate(() => window.__game.npcToScreen('lars'));
  await page.evaluate(({ x, y }) => {
    const scene = document.getElementById('scene');
    scene.focus();
    scene.dispatchEvent(new MouseEvent('click', { clientX: x, clientY: y, bubbles: true }));
  }, p);
  await page.waitForTimeout(300);
  expect(await page.evaluate(() => window.__game.isIdle())).toBe(true);
  expect(await page.evaluate(() => window.__game.getPlayerTile())).toEqual(start);
  await expect(page.locator('.dialogue')).toBeHidden();
  await expect(panel).toBeVisible();
  // Focus is back in the panel after the canvas click.
  expect(await panel.evaluate((el) => el.contains(document.activeElement))).toBe(true);
  await page.keyboard.press('Escape');
  await expect(panel).toBeHidden();
  await expect(page.locator('#scene')).toBeFocused();
  // The Færdig button is present (its behaviour is in submission.spec.mjs).
  await expect(page.getByRole('button', { name: 'Færdig', exact: true })).toBeVisible();
});

test('a backdrop click closes the panel and focus goes to the canvas', async ({ page }) => {
  test.setTimeout(60000);
  await openSeeded(page, seededState({ met: ['lars'] }));
  const panel = await openPanel(page, 'SAMR');
  await page.mouse.click(30, 300);
  await expect(panel).toBeHidden();
  await expect(page.locator('#scene')).toBeFocused();
});

test('a panel taller than the screen scrolls; title and Luk stay reachable', async ({ page }) => {
  test.setTimeout(60000);
  const values = [50, 51, 49, 50, 52, 48, 50, 51];
  const placements = Object.fromEntries(ALL.map((id, i) => [id, { samr: values[i], rogers: values[i] }]));
  await openSeeded(page, seededState({ placements }));
  await page.setViewportSize({ width: 1280, height: 720 });
  for (const name of ['SAMR', 'Rogers']) {
    const panel = await openPanel(page, name);
    const box = await panel.boundingBox();
    expect(box.height).toBeGreaterThan(720); // eight stacked pins: taller than the screen
    expect(box.y).toBeGreaterThanOrEqual(0); // the title is not cut off at the top
    const luk = panel.getByRole('button', { name: 'Luk', exact: true });
    await page.mouse.move(640, 360);
    await page.mouse.wheel(0, 2000);
    await expect.poll(async () => {
      const b = await luk.boundingBox();
      return b.y + b.height;
    }).toBeLessThanOrEqual(705); // scrolled to the bottom, the 16 px padding below Luk shows
    await luk.click();
    await expect(panel).toBeHidden();
    await expect(page.locator('#scene')).toBeFocused();
  }
});
