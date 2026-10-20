import { randomInt, randomUUID } from 'node:crypto';
import { test, expect } from './fixtures.mjs';
import { SAMR_BANDS as S, ROGERS_CATEGORIES as R, escapeRegExp } from './helpers.mjs';

const Sre = S.map(escapeRegExp);

// Results views. Submissions are seeded through the real API
// (submit.php), so do not run this while scripts/test_api.sh has swapped in
// its test config. Each test uses a fresh random session code.

const ALL = ['mette', 'jonas', 'karim', 'anne', 'sofie', 'lars', 'birgitte', 'henrik'];
const NAMES = [
  'Mette (Underviser)', 'Jonas (Underviser)', 'Karim (Administration)', 'Anne (Studievejleder)',
  'Sofie (Underviser)', 'Lars (IT)', 'Birgitte (Uddannelsesleder)', 'Henrik (Pædagogisk konsulent)',
];
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const TIMEOUT = 90000;
// Seven pairs' SAMR and Rogers values for character i: spread out, with a
// tie and a near-tie so some dots stack.
const SAMR_SEED = [12, 30, 41, 44, 44, 63, 85];
const ROGERS_SEED = [8, 22, 35, 47, 49, 58, 81];

function randomCode() {
  return Array.from({ length: 6 }, () => CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]).join('');
}

const clamp = (v) => Math.max(0, Math.min(100, v));

/** POST `count` submissions to submit.php; pair k shifts every value by a per-character offset. */
async function seed(request, code, count) {
  for (let k = 0; k < count; k += 1) {
    const placements = {};
    ALL.forEach((id, i) => {
      placements[id] = { samr: clamp(SAMR_SEED[k] + i * 2 - 6), rogers: clamp(ROGERS_SEED[k] + i - 4) };
    });
    const response = await request.post('/api/submit.php', {
      data: { session: code, clientId: randomUUID(), placements },
    });
    expect(response.status(), await response.text()).toBe(201);
  }
}

function watchApi(page) {
  const urls = [];
  page.on('request', (req) => {
    if (new URL(req.url()).pathname.includes('/api/')) urls.push(req.url());
  });
  return urls;
}

async function openProjector(page, query) {
  await page.goto(`/results.html?${query}`);
  await expect(page.locator('#results')).not.toHaveAttribute('aria-busy', 'true');
}

test('projector view with 7 submissions shows dots and the band, and prints to PDF', async ({ page }) => {
  test.setTimeout(TIMEOUT);
  const code = randomCode();
  await seed(page.request, code, 7);
  await page.setViewportSize({ width: 1600, height: 900 });
  await openProjector(page, `session=${code}`);

  await expect(page).toHaveTitle('EduTechReady: resultater');
  await expect(page.getByRole('status')).toHaveText('7 par har svaret');
  await expect(page.getByRole('status')).toHaveAttribute('data-n', '7');
  await expect(page.getByText(`Session ${code}`)).toBeVisible();
  await expect(page.locator('.results__updated')).toHaveText(/^Senest opdateret kl\. \d\d\.\d\d\.\d\d$/);

  // Eight rows in characters.json order, each with a SAMR and a Rogers chart.
  const rows = page.locator('.results-row');
  await expect(rows).toHaveCount(8);
  await expect(rows.locator('.results-row__name')).toHaveText(NAMES);
  await expect(page.locator('svg.results-chart')).toHaveCount(16);
  // Seven dots per chart, no own diamond on the projector, and the band (n >= 6) everywhere.
  await expect(page.locator('svg.results-chart .results-chart__dot')).toHaveCount(16 * 7);
  await expect(page.locator('svg.results-chart .results-chart__dot--own')).toHaveCount(0);
  await expect(page.locator('svg.results-chart .results-chart__middle')).toHaveCount(16);
  await expect(page.locator('.results-legend__item')).toHaveText(['Et par', /^Den midterste halvdel/]);

  // Mette's SAMR values are SAMR_SEED - 6: 6 24 35 38 38 57 79 -> Q1 29.5, Q3 47.5 (QUARTILE.INC).
  const metteSamr = rows.first().locator('svg[data-axis="samr"]');
  await expect(metteSamr).toHaveAttribute('aria-label', `SAMR: 7 svar. Fordeling: ${S[0]} 2, ${S[1]} 3, ${S[2]} 1 og ${S[3]} 1. `
    + 'Svarene: 6, 24, 35, 38, 38, 57 og 79. Den midterste halvdel ligger fra 29,5 til 47,5.');
  await expect(metteSamr.locator('.results-chart__middle')).toHaveAttribute('data-from', '29.5');
  await expect(metteSamr.locator('.results-chart__middle')).toHaveAttribute('data-to', '47.5');
  // The tie at 38 stacks: two dots share an x, at different heights.
  const tie = await metteSamr.locator('circle').evaluateAll((dots) => {
    const byX = new Map();
    for (const d of dots) byX.set(d.getAttribute('cx'), [...(byX.get(d.getAttribute('cx')) ?? []), d.getAttribute('cy')]);
    return [...byX.values()].find((ys) => ys.length > 1);
  });
  expect(tie).toHaveLength(2);
  expect(tie[0]).not.toBe(tie[1]);
  // The axes look like the placement panels: brackets and bands, the bell curve with five regions.
  await expect(metteSamr.locator('.results-chart__bracket-label')).toHaveText(['Forbedring', 'Transformation']);
  await expect(metteSamr.locator('.results-chart__band-label')).toHaveText(S);
  const metteRogers = rows.first().locator('svg[data-axis="rogers"]');
  await expect(metteRogers.locator('.results-chart__region')).toHaveCount(5);
  await expect(metteRogers.locator('.results-chart__share')).toHaveText(['2,5 %', '13,5 %', '34 %', '34 %', '16 %']);

  await expect(page.getByRole('button', { name: 'Gem som PDF' })).toBeVisible();
  await page.screenshot({ path: 'docs/screenshots/results-projector.png' });

  // Print: A4 with print.css (Playwright's pdf uses print media).
  const pdf = await page.pdf({ path: 'docs/screenshots/results-print.pdf', format: 'A4', preferCSSPageSize: true, printBackground: true });
  expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
  await page.emulateMedia({ media: 'print' });
  await expect(page.getByRole('button', { name: 'Gem som PDF' })).toBeHidden();
  const breaks = await rows.first().evaluate((el) => getComputedStyle(el).breakInside);
  expect(breaks).toBe('avoid');
  await page.emulateMedia({ media: 'screen' });
});

test('in-game view after Færdig shows every pair, the own diamond and the band', async ({ page }) => {
  test.setTimeout(TIMEOUT);
  const code = randomCode();
  await seed(page.request, code, 7);
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto(`/index.html?session=${code}&debug=1`);
  await page.waitForFunction(() => window.__game !== undefined && document.body.classList.contains('is-ready'), null, { timeout: 45000 });
  // The pair's own placements (seeded through the debug API, no walking).
  await page.evaluate((ids) => ids.forEach((id, i) => {
    window.__game.setPlacement(id, 'samr', 52 + i);
    window.__game.setPlacement(id, 'rogers', 40 - i);
  }), ALL);
  await page.getByRole('button', { name: 'Færdig', exact: true }).click();
  await page.getByRole('dialog', { name: 'Færdig?' }).getByRole('button', { name: 'Send' }).click();

  const results = page.getByRole('dialog', { name: 'Resultater' });
  await expect(results).toBeVisible();
  await expect(results.getByRole('status')).toHaveText('8 par har svaret');
  await expect(results.locator('.results__updated')).toHaveText(/^Senest opdateret kl\./);
  const rows = results.locator('.results-row');
  await expect(rows).toHaveCount(8);
  await expect(rows.locator('.results-row__name')).toHaveText(NAMES);
  // One own diamond per chart; the other seven answers are dots.
  await expect(results.locator('svg.results-chart .results-chart__dot--own')).toHaveCount(16);
  await expect(results.locator('svg.results-chart circle.results-chart__dot')).toHaveCount(16 * 7);
  await expect(results.locator('svg.results-chart .results-chart__middle')).toHaveCount(16);
  await expect(rows.first().locator('svg[data-axis="samr"]')).toHaveAttribute('aria-label', new RegExp(`^SAMR: 8 svar\\. Fordeling: ${Sre[0]} 2, ${Sre[1]} 3, ${Sre[2]} 2 og ${Sre[3]} 1\\. Svarene: 6, 24, 35, 38, 38, 52, 57 og 79\\. Den midterste halvdel ligger fra .* Jeres placering: 52, ${Sre[2]}\\.$`));
  await expect(rows.first().locator('.results-chart__middle').first()).toBeVisible();
  await expect(results.locator('.results-legend__item')).toHaveText(['Jeres placering', 'Et par', /^Den midterste halvdel/]);
  await page.screenshot({ path: 'docs/screenshots/results-ingame.png' });

  // The refresh button asks again; a new pair shows up.
  await seed(page.request, code, 1);
  await results.getByRole('button', { name: 'Opdatér' }).click();
  await expect(results.getByRole('status')).toHaveText('9 par har svaret');
  // The list scrolls inside the modal; the buttons stay on screen. Keyboard
  // users reach the scroller with Tab (the focus trap includes it) and scroll
  // it with Page Down and End.
  await expect(results.locator('.results-list')).toHaveAttribute('tabindex', '0');
  await expect(rows.last()).not.toBeInViewport();
  await expect(results.getByRole('button', { name: 'Opdatér' })).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(results.locator('.results-list')).toBeFocused();
  await page.keyboard.press('PageDown');
  // Wait until the animated Page Down scroll has settled: Chromium drops an
  // End pressed while that animation runs (seen under load in the full
  // suite; the list then stays at the Page Down position).
  const scrollTop = () => results.locator('.results-list').evaluate((el) => el.scrollTop);
  let last = -1;
  await expect.poll(async () => {
    const now = await scrollTop();
    const settled = now > 0 && now === last;
    last = now;
    return settled;
  }, { intervals: [150] }).toBe(true);
  // Chromium can still drop an End pressed just after the scroll looked
  // settled (a longer list makes the Page Down animation longer, seen with
  // real summaries), so End is pressed again while the
  // list is not at the bottom, as a keyboard user would.
  const remaining = () => results.locator('.results-list').evaluate((el) => el.scrollHeight - el.clientHeight - el.scrollTop);
  await page.keyboard.press('End');
  await expect.poll(async () => {
    const left = await remaining();
    if (left > 1) await page.keyboard.press('End');
    return left;
  }, { intervals: [300, 500, 1000] }).toBeLessThanOrEqual(1);
  await expect(rows.last()).toBeInViewport();
  await expect(results.getByRole('button', { name: 'Luk' })).toBeInViewport();
  // Tab from the last button wraps back to the list.
  await results.getByRole('button', { name: 'Luk' }).focus();
  await page.keyboard.press('Tab');
  await expect(results.locator('.results-list')).toBeFocused();
  await results.getByRole('button', { name: 'Luk' }).click();
  await expect(results).toBeHidden();
  await expect(page.locator('#scene')).toBeFocused();
});

test('with 3 submissions no band appears; the view refreshes every 30 seconds', async ({ page }) => {
  test.setTimeout(TIMEOUT);
  const code = randomCode();
  await seed(page.request, code, 3);
  const api = watchApi(page);
  await page.clock.install();
  await page.setViewportSize({ width: 1600, height: 900 });
  await openProjector(page, `session=${code}`);
  await expect(page.getByRole('status')).toHaveText('3 par har svaret');
  await expect(page.locator('svg.results-chart .results-chart__dot')).toHaveCount(16 * 3);
  await expect(page.locator('svg.results-chart .results-chart__middle')).toHaveCount(0);
  await expect(page.locator('.results-row').first().locator('svg[data-axis="rogers"]')).toHaveAttribute('aria-label',
    `Rogers: 3 svar. Fordeling: ${R[0]} 1, ${R[1]} 2, ${R[2]} 0, ${R[3]} 0 og ${R[4]} 0. Svarene: 4, 18 og 31.`);
  expect(api).toHaveLength(1);

  // Three more pairs make six: the next automatic refresh brings the band.
  await seed(page.request, code, 3);
  await page.clock.runFor(29000);
  await expect(page.getByRole('status')).toHaveText('3 par har svaret');
  await page.clock.runFor(1500);
  await expect(page.getByRole('status')).toHaveText('6 par har svaret');
  await expect(page.locator('svg.results-chart .results-chart__middle')).toHaveCount(16);
  expect(api).toHaveLength(2);
});

test('results.html without a valid code says so in Danish and sends nothing', async ({ page }) => {
  test.setTimeout(TIMEOUT);
  const api = watchApi(page);
  await openProjector(page, '');
  await expect(page.getByRole('alert')).toHaveText(/^Linket mangler en sessionskode\./);
  await openProjector(page, 'session=AB0O12');
  await expect(page.getByRole('alert')).toHaveText(/^Sessionskoden i linket er ugyldig\./);
  await expect(page.locator('.results-row')).toHaveCount(0);
  // The short page stays dark down to the bottom of the window.
  const below = await page.evaluate(() => {
    const el = document.elementFromPoint(window.innerWidth / 2, window.innerHeight - 5);
    return getComputedStyle(el).backgroundColor;
  });
  expect(below).toBe('rgb(36, 34, 31)');
  expect(api).toEqual([]);
});

test('an unknown session shows zero pairs and empty axes', async ({ page }) => {
  test.setTimeout(TIMEOUT);
  // Lowercase is accepted, as in the game.
  const code = randomCode();
  await openProjector(page, `session=${code.toLowerCase()}`);
  await expect(page.getByRole('status')).toHaveText('0 par har svaret');
  await expect(page.getByText(`Session ${code}`)).toBeVisible();
  await expect(page.locator('svg.results-chart .results-chart__dot')).toHaveCount(0);
  await expect(page.locator('.results-row').first().locator('svg[data-axis="samr"]')).toHaveAttribute('aria-label', 'SAMR: ingen svar endnu.');

  // On a 1024 x 768 projector every name stays in its column, and no word
  // (such as "(Uddannelsesleder)") is broken across lines.
  await page.setViewportSize({ width: 1024, height: 768 });
  const problems = await page.evaluate(() => [...document.querySelectorAll('.results-row')].flatMap((row) => {
    const name = row.querySelector('.results-row__name');
    const chart = row.querySelector('.results-row__chart');
    const text = name.firstChild;
    const out = [];
    if (name.getBoundingClientRect().right > chart.getBoundingClientRect().left) out.push(`${name.textContent} overlaps the chart`);
    let start = 0;
    for (const word of text.textContent.split(' ')) {
      const range = document.createRange();
      range.setStart(text, start);
      range.setEnd(text, start + word.length);
      if (range.getClientRects().length !== 1) out.push(`${word} is broken`);
      if (range.getBoundingClientRect().right > chart.getBoundingClientRect().left) out.push(`${word} overlaps the chart`);
      start += word.length + 1;
    }
    return out;
  }));
  expect(problems).toEqual([]);
});
