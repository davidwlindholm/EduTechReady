// Helpers over characters.json. Pure.

/**
 * Split "Mette (Underviser)" into its name and role for two-line labels.
 * A name without a parenthesised role returns an empty role.
 * @param {string} label
 * @returns {{ name: string, role: string }}
 */
export function splitNameRole(label) {
  const match = /^(.*?)\s*\(([^()]*)\)\s*$/.exec(label);
  if (!match) return { name: label.trim(), role: '' };
  return { name: match[1], role: match[2] };
}

/**
 * Initials for placeholder portraits: first letter of the name part.
 * @param {string} label
 */
export function initialsOf(label) {
  const { name } = splitNameRole(label);
  return name.split(/\s+/).filter(Boolean).map((w) => w[0].toUpperCase()).join('').slice(0, 2);
}

/**
 * Find a character by id.
 * @param {{ characters: Array<{id: string}> }} content
 * @param {string} id
 */
export function findCharacter(content, id) {
  return content.characters.find((c) => c.id === id) ?? null;
}
