import { randomInt } from 'node:crypto';
import { test, expect, skipInstructions } from './fixtures.mjs';
import { SAMR_BANDS, ROGERS_CATEGORIES, UI } from './helpers.mjs';
import { formatText } from '../../public/js/lib/text.js';

// Færdig and submission. Placements are set through the debug API
// (setPlacement) or seeded into localStorage, so no test walks. Each run uses
// fresh random session codes, so reruns never meet an old submission (409).
//
// Several tests answer API calls with page.route, which never touches the
// database. The two-pair test and the 409 test use the real API: do not run
// them while scripts/test_api.sh has swapped in its test config.

const ALL = ['mette', 'jonas', 'karim', 'anne', 'sofie', 'lars', 'birgitte', 'henrik'];
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const TIMEOUT = 90000;

function randomCode() {
  return Array.from({ length: 6 }, () => CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]).join('');
}

/** Chromium logs a console error for every HTTP error status a fetch gets; these are expected where a test asks for them. */
function expectedHttpErrors(statuses) {
  return statuses.map((s) => new RegExp(`Failed to load resource: the server responded with a status of ${s}`));
}

/** Console errors and page errors of a page that is not the fixture's own page (the second browser context). */
function watchProblems(page) {
  const problems = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') problems.push(`console.error: ${msg.text()}`);
  });
  page.on('pageerror', (err) => problems.push(`pageerror: ${err.message}`));
  return problems;
}

/** Every request to api/ that a page makes. */
function watchApi(page) {
  const urls = [];
  page.on('request', (req) => {
    if (new URL(req.url()).pathname.includes('/api/')) urls.push(`${req.method()} ${req.url()}`);
  });
  return urls;
}

async function waitReady(page) {
  await page.waitForFunction(() => window.__game !== undefined && document.body.classList.contains('is-ready'), null, { timeout: 45000 });
}

async function open(page, query) {
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto(`/index.html?${query}`);
  await waitReady(page);
}

/** Place every character on both axes through the debug API; values differ per pair. */
async function placeAll(page, offset = 0) {
  await page.evaluate(([ids, off]) => {
    ids.forEach((id, i) => {
      window.__game.setPlacement(id, 'samr', (i * 12 + off) % 101);
      window.__game.setPlacement(id, 'rogers', (i * 9 + 3 + off) % 101);
    });
  }, [ALL, offset]);
}

async function openFinish(page) {
  await page.getByRole('button', { name: 'Færdig', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Færdig?' });
  await expect(dialog).toBeVisible();
  return dialog;
}

function resultsDialog(page) {
  return page.getByRole('dialog', { name: 'Resultater' });
}

const getState = (page) => page.evaluate(() => window.__game.getState());

test('two pairs in one session both submit and both see n = 2; a reload opens the results', async ({ page, browser, baseURL }) => {
  test.setTimeout(TIMEOUT * 2);
  const code = randomCode();
  const otherContext = await browser.newContext({ baseURL });
  await skipInstructions(otherContext);
  const other = await otherContext.newPage();
  const otherProblems = watchProblems(other);
  try {
    await open(page, `session=${code}&debug=1`);
    // The second pair's link has the code in lowercase: the game uppercases it.
    await open(other, `session=${code.toLowerCase()}&debug=1`);
    for (const p of [page, other]) {
      await expect(p.locator('body')).toHaveAttribute('data-mode', 'session');
      await expect(p.locator('.notice')).toBeHidden();
      expect((await getState(p)).clientId).toMatch(UUID_V4);
    }
    expect(await other.evaluate((k) => localStorage.getItem(k) !== null, `lounge:v1:${code}`)).toBe(true);
    expect((await getState(page)).clientId).not.toBe((await getState(other)).clientId);

    await placeAll(page, 0);
    await placeAll(other, 5);

    // First pair submits: the results show one pair.
    let dialog = await openFinish(page);
    await expect(dialog).toHaveAttribute('data-view', 'confirm');
    await dialog.getByRole('button', { name: 'Send' }).click();
    await expect(dialog).toBeHidden();
    const resultsA = resultsDialog(page);
    await expect(resultsA.getByRole('status')).toHaveText('1 par har svaret');
    expect((await getState(page)).submitted).toBe(true);

    // Second pair submits: n = 2 there, and after a refresh for the first pair.
    dialog = await openFinish(other);
    await dialog.getByRole('button', { name: 'Send' }).click();
    const resultsB = resultsDialog(other);
    await expect(resultsB.getByRole('status')).toHaveText('2 par har svaret');
    await expect(resultsB.getByRole('status')).toHaveAttribute('data-n', '2');
    await resultsA.getByRole('button', { name: 'Opdatér' }).click();
    await expect(resultsA.getByRole('status')).toHaveText('2 par har svaret');

    // Both values of a character arrive in results.php (sorted).
    const api = await (await page.request.get(`/api/results.php?session=${code}`)).json();
    expect(api.n).toBe(2);
    expect(api.characters.mette.samr).toEqual([0, 5]);

    // A reload after submitting opens the results view directly.
    await other.reload();
    await waitReady(other);
    await expect(resultsDialog(other)).toBeVisible();
    await expect(resultsDialog(other).getByRole('status')).toHaveText('2 par har svaret');

    // Færdig after submission opens the results; the panels are read-only.
    await resultsDialog(other).getByRole('button', { name: 'Luk' }).click();
    await expect(resultsDialog(other)).toBeHidden();
    await other.getByRole('button', { name: 'SAMR', exact: true }).click();
    const samr = other.getByRole('dialog', { name: /^SAMR/ });
    await expect(samr.locator('.placement__locked')).toBeVisible();
    await other.keyboard.press('Escape');
    await expect(samr).toBeHidden();
    await other.getByRole('button', { name: 'Færdig', exact: true }).click();
    await expect(resultsDialog(other)).toBeVisible();
    await expect(other.getByRole('dialog', { name: 'Færdig?' })).toBeHidden();
  } finally {
    await otherContext.close();
  }
  expect(otherProblems).toEqual([]);
});

test('Færdig lists what is missing, including characters not met yet', async ({ page }) => {
  test.setTimeout(TIMEOUT);
  await open(page, 'debug=1');
  const met = ['mette', 'jonas', 'karim', 'anne', 'sofie', 'lars', 'birgitte'];
  await page.evaluate((m) => {
    const state = {
      clientId: null, met: m, asked: {}, submitted: false, submittedAt: null,
      placements: {
        mette: { samr: 10, rogers: 20 }, jonas: { samr: 30, rogers: null }, karim: { samr: null, rogers: 40 },
        anne: { samr: 1, rogers: 2 }, sofie: { samr: 3, rogers: 4 }, lars: { samr: 5, rogers: 6 }, birgitte: { samr: 7, rogers: 8 },
      },
    };
    localStorage.setItem('lounge:v1:practice', JSON.stringify(state));
  }, met);
  await page.reload();
  await waitReady(page);

  let dialog = await openFinish(page);
  await expect(dialog).toHaveAttribute('data-view', 'missing');
  await expect(dialog).toContainText('alle 8 personer');
  const items = dialog.locator('.finish__missing-item');
  await expect(items).toHaveText([
    formatText(UI['finish.missing.rogers'], { name: 'Jonas (Underviser)' }),
    formatText(UI['finish.missing.samr'], { name: 'Karim (Administration)' }),
    /^Henrik \(Pædagogisk konsulent\): I har ikke talt med Henrik endnu\./,
  ]);
  // No send or confirm while something is missing; Esc closes, focus goes to the canvas.
  await expect(dialog.getByRole('button')).toHaveText(['Luk']);
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(page.locator('#scene')).toBeFocused();

  // A character with nothing placed after meeting: "both".
  await page.evaluate(() => window.__game.setPlacement('anne', 'samr', null));
  await page.evaluate(() => window.__game.setPlacement('anne', 'rogers', null));
  dialog = await openFinish(page);
  await expect(dialog.locator('.finish__missing-item[data-id="anne"]')).toHaveText(formatText(UI['finish.missing.both'], { name: 'Anne (Studievejleder)' }));
  await expect(dialog.locator('.finish__missing-item')).toHaveCount(4);
  await page.screenshot({ path: 'docs/screenshots/submission-missing.png' });
});

test('practice mode confirms, shows the own placements and sends nothing', async ({ page }) => {
  test.setTimeout(TIMEOUT);
  const api = watchApi(page);
  await open(page, 'debug=1');
  await expect(page.locator('body')).toHaveAttribute('data-mode', 'practice');
  await expect(page.locator('.notice')).toHaveAttribute('data-notice', 'notice.practice');
  await expect(page.locator('.notice')).toContainText('Øverunde');
  expect((await getState(page)).clientId).toBeNull();
  await placeAll(page);

  const dialog = await openFinish(page);
  await expect(dialog).toHaveAttribute('data-view', 'confirmPractice');
  await page.screenshot({ path: 'docs/screenshots/submission-confirm-practice.png' });
  await dialog.getByRole('button', { name: 'Se resultat' }).click();
  const results = resultsDialog(page);
  await expect(results).toBeVisible();
  await expect(results).toContainText('Øverunde: her er jeres egne placeringer.');
  // The results view: one row per character with the own placement only.
  const rows = results.locator('.results-row');
  await expect(rows).toHaveCount(8);
  // Practice mode has only the own placement, so the description says just that.
  await expect(rows.first().locator('svg[data-axis="samr"]')).toHaveAttribute('aria-label', `SAMR: jeres placering er 0, ${SAMR_BANDS[0]}.`);
  await expect(rows.first().locator('svg[data-axis="rogers"]')).toHaveAttribute('aria-label', `Rogers: jeres placering er 3, ${ROGERS_CATEGORIES[0]}.`);
  await expect(page.locator('.results-legend__item')).toHaveText([UI['results.legend.own']]);
  await expect(results.getByRole('button', { name: 'Opdatér' })).toHaveCount(0);
  // Practice does not lock the panels.
  expect((await getState(page)).submitted).toBe(false);

  // The notice can be dismissed.
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Luk beskeden' }).click();
  await expect(page.locator('.notice')).toBeHidden();
  expect(api).toEqual([]);
});

test('an invalid session code shows a notice and runs practice mode without API calls', async ({ page }) => {
  test.setTimeout(TIMEOUT);
  const api = watchApi(page);
  await open(page, 'session=K7MP0Q&debug=1'); // 0 is not in the code alphabet
  await expect(page.locator('body')).toHaveAttribute('data-mode', 'practice');
  await expect(page.locator('.notice')).toHaveAttribute('data-notice', 'notice.invalidCode');
  await expect(page.locator('.notice')).toContainText('Sessionskoden i linket er ugyldig');
  await page.screenshot({ path: 'docs/screenshots/submission-invalid-code.png' });
  await placeAll(page);
  const dialog = await openFinish(page);
  await expect(dialog).toHaveAttribute('data-view', 'confirmPractice');
  expect(await page.evaluate(() => Object.keys(localStorage))).toEqual(['lounge:v1:practice']);
  expect(api).toEqual([]);
});

test.describe('expected HTTP errors', () => {
  // These tests make the API answer 409, 500 or 503 on purpose; Chromium logs each
  // as a console error, which the fixture would count. They watch the console
  // themselves and allow only those lines.
  test.use({ page: async ({ browser, baseURL }, use) => {
    const context = await browser.newContext({ baseURL });
    await skipInstructions(context);
    const page = await context.newPage();
    page.problems = watchProblems(page);
    await use(page);
    await context.close();
  } });

  function expectOnly(page, statuses) {
    const allowed = expectedHttpErrors(statuses);
    expect(page.problems.filter((p) => !allowed.some((re) => re.test(p)))).toEqual([]);
  }

  test('an error keeps the data and offers a retry; a double press sends once', async ({ page }) => {
    test.setTimeout(TIMEOUT);
    const code = randomCode();
    let submits = 0;
    let release;
    const held = new Promise((resolve) => { release = resolve; });
    await page.route('**/api/submit.php', async (route) => {
      submits += 1;
      if (submits === 1) {
        await held; // keep the first request in flight
        await route.fulfill({ status: 500, contentType: 'application/json', body: '{"ok":false,"error":"server"}' });
      } else {
        await route.fulfill({ status: 201, contentType: 'application/json', body: '{"ok":true}' });
      }
    });
    await page.route('**/api/results.php*', (route) => route.fulfill({
      status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, session: code, n: 1, characters: {} }),
    }));
    await open(page, `session=${code}&debug=1`);
    await placeAll(page);
    const before = await getState(page);

    const dialog = await openFinish(page);
    const send = dialog.getByRole('button', { name: 'Send' });
    await send.dblclick();
    await expect(send).toBeDisabled();
    await expect(dialog.getByRole('button', { name: 'Tilbage' })).toBeDisabled();
    await expect(dialog.getByRole('status')).toHaveText('Sender jeres placeringer …');
    await page.keyboard.press('Escape'); // no closing while sending
    await expect(dialog).toBeVisible();
    await page.keyboard.press('Enter');
    release();

    await expect(dialog).toHaveAttribute('data-view', 'error');
    await expect(dialog.getByRole('alert')).toHaveText('Serveren kunne ikke tage imod jeres placeringer lige nu. Vent et øjeblik, og prøv igen.');
    await expect(dialog.locator('.modal__detail')).toHaveText('Fejlkode: server');
    await page.screenshot({ path: 'docs/screenshots/submission-error.png' });
    expect(submits).toBe(1);
    const after = await getState(page);
    expect(after.placements).toEqual(before.placements);
    expect(after.submitted).toBe(false);

    // The posted body has the API's shape: session, clientId, placements.
    const posted = page.waitForRequest('**/api/submit.php');
    await dialog.getByRole('button', { name: 'Prøv igen' }).click();
    const body = (await posted).postDataJSON();
    expect(body.session).toBe(code);
    expect(body.clientId).toBe(before.clientId);
    expect(Object.keys(body.placements).sort()).toEqual([...ALL].sort());
    expect(body.placements.mette).toEqual(before.placements.mette);
    await expect(resultsDialog(page).getByRole('status')).toHaveText('1 par har svaret');
    expect(submits).toBe(2);
    expect((await getState(page)).submitted).toBe(true);
    expectOnly(page, [500]);
  });

  test('an error a retry cannot fix shows friendly text, the code as detail, and no retry', async ({ page }) => {
    test.setTimeout(TIMEOUT);
    const code = randomCode();
    let submits = 0;
    await page.route('**/api/submit.php', (route) => {
      submits += 1;
      return route.fulfill({ status: 400, contentType: 'application/json', body: '{"ok":false,"error":"invalid_client"}' });
    });
    await page.route('**/api/results.php*', (route) => route.fulfill({
      status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, session: code, n: 0, characters: {} }),
    }));
    await open(page, `session=${code}&debug=1`);
    await placeAll(page);
    const before = await getState(page);
    const dialog = await openFinish(page);
    await dialog.getByRole('button', { name: 'Send' }).click();
    await expect(dialog).toHaveAttribute('data-view', 'error');
    const alert = dialog.getByRole('alert');
    await expect(alert).toContainText('det hjælper ikke at prøve igen');
    await expect(alert).not.toContainText('invalid_client');
    await expect(dialog.locator('.modal__detail')).toHaveText('Fejlkode: invalid_client');
    await expect(dialog.getByRole('button', { name: 'Prøv igen' })).toHaveCount(0);
    await expect(dialog.getByRole('button', { name: 'Luk' })).toBeFocused();
    await page.screenshot({ path: 'docs/screenshots/submission-error-final.png' });
    expect(submits).toBe(1);
    const after = await getState(page);
    expect(after.placements).toEqual(before.placements);
    expect(after.submitted).toBe(false);
    expectOnly(page, [400]);
  });

  test('409 counts as submitted and opens the results', async ({ page }) => {
    test.setTimeout(TIMEOUT);
    const code = randomCode();
    await open(page, `session=${code}&debug=1`);
    await placeAll(page);
    await (await openFinish(page)).getByRole('button', { name: 'Send' }).click();
    await expect(resultsDialog(page).getByRole('status')).toHaveText('1 par har svaret');

    // Forget the submission locally but keep the clientId: the server answers 409.
    await page.evaluate((k) => {
      const s = JSON.parse(localStorage.getItem(k));
      localStorage.setItem(k, JSON.stringify({ ...s, submitted: false, submittedAt: null }));
    }, `lounge:v1:${code}`);
    await page.reload();
    await waitReady(page);
    await expect(resultsDialog(page)).toBeHidden();
    const answer = page.waitForResponse('**/api/submit.php');
    await (await openFinish(page)).getByRole('button', { name: 'Send' }).click();
    expect((await answer).status()).toBe(409);
    await expect(resultsDialog(page).getByRole('status')).toHaveText('1 par har svaret');
    expect((await getState(page)).submitted).toBe(true);
    expectOnly(page, [409]);
  });

  test('a transient results failure after a reload is retried automatically', async ({ page }) => {
    test.setTimeout(TIMEOUT);
    const code = randomCode();
    let failNext = 0;
    let resultsCalls = 0;
    await page.route('**/api/submit.php', (route) => route.fulfill({ status: 201, contentType: 'application/json', body: '{"ok":true}' }));
    await page.route('**/api/results.php*', (route) => {
      resultsCalls += 1;
      if (failNext > 0) {
        failNext -= 1;
        return route.fulfill({ status: 502, contentType: 'text/html', body: '<h1>Bad gateway</h1>' });
      }
      return route.fulfill({
        status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, session: code, n: 2, characters: {} }),
      });
    });
    await open(page, `session=${code}&debug=1`);
    await placeAll(page);
    await (await openFinish(page)).getByRole('button', { name: 'Send' }).click();
    await expect(resultsDialog(page).getByRole('status')).toHaveText('2 par har svaret');

    // After the reload, the first results request fails once (the load-time closed check comes first).
    resultsCalls = 0;
    failNext = 2; // closed check + first results request
    await page.reload();
    await waitReady(page);
    await expect(resultsDialog(page).getByRole('status')).toHaveText('2 par har svaret', { timeout: 15000 });
    expect(resultsCalls).toBeGreaterThanOrEqual(3);
    expectOnly(page, [502]);
  });

  test('503 on submit shows the closed notice and switches to practice mode', async ({ page }) => {
    test.setTimeout(TIMEOUT);
    const code = randomCode();
    const api = watchApi(page);
    await page.route('**/api/submit.php', (route) => route.fulfill({
      status: 503, contentType: 'application/json', body: '{"ok":false,"error":"closed"}',
    }));
    await open(page, `session=${code}&debug=1`);
    await expect(page.locator('body')).toHaveAttribute('data-mode', 'session');
    await placeAll(page);
    const dialog = await openFinish(page);
    await dialog.getByRole('button', { name: 'Send' }).click();
    await expect(dialog).toHaveAttribute('data-view', 'confirmPractice');
    await expect(dialog).toContainText('Indsamlingen af svar er lukket');
    await expect(page.locator('.notice')).toHaveAttribute('data-notice', 'notice.closed');
    await expect(page.locator('body')).toHaveAttribute('data-mode', 'practice');
    expect((await getState(page)).submitted).toBe(false);
    await page.screenshot({ path: 'docs/screenshots/submission-closed.png' });
    await dialog.getByRole('button', { name: 'Se resultat' }).click();
    await expect(resultsDialog(page)).toContainText('Øverunde');
    // Only the boot check and the one submit reached the API.
    expect(api.filter((u) => u.includes('submit.php'))).toHaveLength(1);
    expectOnly(page, [503]);
  });

  test('a host 503 (not the API\'s closed body) stays in session mode and offers a retry', async ({ page }) => {
    test.setTimeout(TIMEOUT);
    const code = randomCode();
    const unavailable = { status: 503, contentType: 'text/html', body: '<h1>Service Unavailable</h1>' };
    await page.route('**/api/results.php*', (route) => route.fulfill(unavailable));
    await page.route('**/api/submit.php', (route) => route.fulfill(unavailable));
    const check = page.waitForResponse('**/api/results.php*');
    await open(page, `session=${code}&debug=1`);
    await check;
    await placeAll(page);
    await expect(page.locator('body')).toHaveAttribute('data-mode', 'session');
    const dialog = await openFinish(page);
    await expect(dialog).toHaveAttribute('data-view', 'confirm');
    await dialog.getByRole('button', { name: 'Send' }).click();
    await expect(dialog).toHaveAttribute('data-view', 'error');
    await expect(dialog.getByRole('alert')).not.toContainText('http_503');
    await expect(dialog.locator('.modal__detail')).toHaveText('Fejlkode: http_503');
    await expect(dialog.getByRole('button', { name: 'Prøv igen' })).toBeVisible();
    await expect(page.locator('body')).toHaveAttribute('data-mode', 'session');
    expect((await getState(page)).submitted).toBe(false);
    expectOnly(page, [503]);
  });

  test('a closed API at load runs practice mode', async ({ page, baseURL }) => {
    test.setTimeout(TIMEOUT);
    const code = randomCode();
    const api = watchApi(page);
    await page.route('**/api/results.php*', (route) => route.fulfill({
      status: 503, contentType: 'application/json', body: '{"ok":false,"error":"closed"}',
    }));
    await open(page, `session=${code}&debug=1`);
    await expect(page.locator('.notice')).toHaveAttribute('data-notice', 'notice.closed');
    await expect(page.locator('body')).toHaveAttribute('data-mode', 'practice');
    await placeAll(page);
    const dialog = await openFinish(page);
    await expect(dialog).toHaveAttribute('data-view', 'confirmPractice');
    await dialog.getByRole('button', { name: 'Se resultat' }).click();
    await expect(resultsDialog(page)).toBeVisible();
    expect(api).toEqual([`GET ${new URL(`/api/results.php?session=${code}`, baseURL).href}`]);
    expectOnly(page, [503]);
  });

  test('a slow closed check does not hold the loading screen; a late 503 switches to practice', async ({ page }) => {
    test.setTimeout(TIMEOUT);
    const code = randomCode();
    let release;
    const held = new Promise((resolve) => { release = resolve; });
    await page.route('**/api/results.php*', async (route) => {
      await held; // the API hangs until the test lets it answer
      await route.fulfill({ status: 503, contentType: 'application/json', body: '{"ok":false,"error":"closed"}' });
    });
    const started = Date.now();
    await open(page, `session=${code}&debug=1`);
    // Well under the 15 s request timeout: boot does not wait for the check.
    expect(Date.now() - started).toBeLessThan(10000);
    await expect(page.locator('body')).toHaveAttribute('data-mode', 'session');
    await placeAll(page);
    const dialog = await openFinish(page);
    await expect(dialog).toHaveAttribute('data-view', 'confirm');
    release();
    await expect(dialog).toHaveAttribute('data-view', 'confirmPractice');
    await expect(dialog).toContainText('Indsamlingen af svar er lukket');
    await expect(page.locator('.notice')).toHaveAttribute('data-notice', 'notice.closed');
    await expect(page.locator('body')).toHaveAttribute('data-mode', 'practice');
    expectOnly(page, [503]);
  });
});
