// Text lookup over ui.json. Pure: no DOM, no three.js.

const PLACEHOLDER = /\{([a-zA-Z0-9_]+)\}/g;

/**
 * Replace `{name}` placeholders with values from `params`.
 * Unknown placeholders are left as they are, so a missing parameter is visible
 * on screen instead of silently disappearing.
 * @param {string} template
 * @param {Record<string, string|number>} [params]
 * @returns {string}
 */
export function formatText(template, params = {}) {
  return template.replace(PLACEHOLDER, (match, name) =>
    Object.prototype.hasOwnProperty.call(params, name) ? String(params[name]) : match);
}

/**
 * Build the single lookup function used for all user-facing text.
 * A missing key returns the key itself (visible, never a crash) and is
 * reported once through `onMissing`.
 * @param {Record<string, string>} strings flat key -> Danish string map
 * @param {{ onMissing?: (key: string) => void }} [options]
 * @returns {(key: string, params?: Record<string, string|number>) => string}
 */
export function createTextLookup(strings, { onMissing } = {}) {
  if (strings === null || typeof strings !== 'object' || Array.isArray(strings)) {
    throw new TypeError('ui strings must be a flat object');
  }
  const reported = new Set();
  return function t(key, params) {
    const template = Object.prototype.hasOwnProperty.call(strings, key) ? strings[key] : undefined;
    if (typeof template !== 'string') {
      if (onMissing && !reported.has(key)) {
        reported.add(key);
        onMissing(key);
      }
      return key;
    }
    return formatText(template, params);
  };
}
