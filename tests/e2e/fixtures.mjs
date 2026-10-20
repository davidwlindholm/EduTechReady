import { test as base, expect } from '@playwright/test';

/**
 * The game opens the instructions window at the start. Most specs test other
 * things, so for them the window is closed as soon as it opens, through its
 * close button (a click, as a player would). Applies to every page of the
 * context (or the one page) it is given.
 * @param {import('@playwright/test').BrowserContext | import('@playwright/test').Page} target
 */
export async function skipInstructions(target) {
  await target.addInitScript(() => {
    // It opens once, at the end of loading (just before body gets is-ready),
    // or not at all (a reload after submitting); later openings come from
    // the menu and stay open.
    const observer = new MutationObserver(() => {
      const root = document.querySelector('.modal.instructions')?.parentElement;
      if (root && !root.hidden) {
        observer.disconnect();
        root.querySelector('.modal__actions button')?.click();
      } else if (document.body.classList.contains('is-ready')) {
        observer.disconnect();
      }
    });
    document.addEventListener('DOMContentLoaded', () => {
      observer.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['hidden', 'class'] });
    });
  });
}

// Every spec imports `test` from here. Any console error or uncaught page
// error recorded during a test fails it. Specs about the
// instructions window set `test.use({ keepInstructions: true })`; contexts a
// spec makes itself call skipInstructions().
export const test = base.extend({
  keepInstructions: [false, { option: true }],
  context: async ({ context, keepInstructions }, use) => {
    if (!keepInstructions) await skipInstructions(context);
    await use(context);
  },
  page: async ({ page }, use) => {
    const problems = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') problems.push(`console.error: ${msg.text()}`);
    });
    page.on('pageerror', (err) => problems.push(`pageerror: ${err.message}`));
    await use(page);
    expect(problems, 'console errors and uncaught page errors').toEqual([]);
  },
});

export { expect };
