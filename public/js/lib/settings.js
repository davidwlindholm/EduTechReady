// Display settings: kept in localStorage under their own key, separate from
// the game state (lib/state.js), so a session's state and its storage key
// stay unchanged. Pure: the storage object is passed in, and every read and
// write is wrapped (storage may be unavailable).

/** Storage key for the settings; not a game state key (those are lounge:v1:<CODE|practice>). */
export const SETTINGS_KEY = 'lounge:settings:v1';

/** Defaults: shadows on (the mockup's look). */
export const DEFAULT_SETTINGS = Object.freeze({ shadows: true });

/**
 * Rebuild settings from a stored value: known fields of the right type only.
 * @param {unknown} raw parsed JSON
 * @returns {{ shadows: boolean }}
 */
export function normalizeSettings(raw) {
  const out = { ...DEFAULT_SETTINGS };
  if (raw && typeof raw === 'object' && !Array.isArray(raw) && typeof raw.shadows === 'boolean') {
    out.shadows = raw.shadows;
  }
  return out;
}

/**
 * Settings that persist when storage works and live in memory when it does not.
 * @param {object} options
 * @param {Storage|null} options.storage window.localStorage, or null
 * @param {(err: unknown) => void} [options.onStorageError]
 */
export function createSettings({ storage, onStorageError = () => {} }) {
  let current = { ...DEFAULT_SETTINGS };
  if (storage) {
    try {
      const text = storage.getItem(SETTINGS_KEY);
      if (text !== null) current = normalizeSettings(JSON.parse(text));
    } catch (err) {
      onStorageError(err);
    }
  }
  return {
    /** @returns {{ shadows: boolean }} a copy */
    get() {
      return { ...current };
    },
    /** @param {Partial<{ shadows: boolean }>} patch */
    set(patch) {
      current = normalizeSettings({ ...current, ...patch });
      if (!storage) return;
      try {
        storage.setItem(SETTINGS_KEY, JSON.stringify(current));
      } catch (err) {
        onStorageError(err);
      }
    },
  };
}
