// Shared e2e steps. Walk-then-talk means a click on a character
// opens its dialogue only after the player has walked into talking range,
// which takes several seconds under SwiftShader.
import { readFileSync } from 'node:fs';
import { expect } from './fixtures.mjs';

// Content that may be reworded (docs/CONTENT.md): tests read it from the
// files instead of repeating the wording, so a text change does not break them.
const readContent = (name) => JSON.parse(readFileSync(new URL(`../../public/content/${name}`, import.meta.url), 'utf8'));
export const UI = readContent('ui.json');
export const CHARACTERS = readContent('characters.json');
/** SAMR band names 0-3 and Rogers category names 0-4, from ui.json. */
export const SAMR_BANDS = [0, 1, 2, 3].map((i) => UI[`samr.band.${i}`]);
export const ROGERS_CATEGORIES = [0, 1, 2, 3, 4].map((i) => UI[`rogers.category.${i}`]);
/** Escape text for use inside a RegExp. */
export const escapeRegExp = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Longest walk across the level, in ms, with SwiftShader's slow frames. */
export const WALK_TIMEOUT = 45000;

/**
 * Click a character (its npcToScreen point) and wait for its dialogue.
 * @returns {Promise<import('@playwright/test').Locator>} the dialogue
 */
export async function talkTo(page, id, name = undefined) {
  const p = await page.evaluate((i) => window.__game.npcToScreen(i), id);
  await page.mouse.click(p.x, p.y);
  const dialogue = page.getByRole('dialog', { name: name ?? new RegExp(`^${id}`, 'i') });
  await expect(dialogue).toBeVisible({ timeout: WALK_TIMEOUT });
  return dialogue;
}

/** Talk to a character and close the dialogue again (marks it as met). */
export async function meet(page, id) {
  const dialogue = await talkTo(page, id);
  await page.keyboard.press('Escape');
  await expect(dialogue).toBeHidden();
}
