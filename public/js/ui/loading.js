// The loading screen: a status line and a progress bar fed by the
// GLB downloads (render/models.js), and the two ways a start can fail: no
// WebGL 2, or any other error. The elements live in index.html, so the
// screen shows before any script has run.

/**
 * @param {Document} doc
 * @returns {{
 *   setText: (text: string) => void,
 *   progress: (fraction: number) => void,
 *   hide: () => void,
 *   fail: (text?: string) => void,
 * }}
 */
export function createLoadingScreen(doc) {
  const screen = doc.getElementById('loading');
  const text = doc.getElementById('loading-text');
  const bar = doc.getElementById('loading-bar');
  const fill = doc.getElementById('loading-fill');
  const error = doc.getElementById('load-error');
  let shown = -1;
  return {
    setText(value) {
      text.textContent = value;
    },
    /** @param {number} fraction 0 to 1; whole percents only, never backwards */
    progress(fraction) {
      const percent = Math.max(shown, Math.min(100, Math.floor(fraction * 100)));
      if (percent === shown) return;
      shown = percent;
      bar.setAttribute('aria-valuenow', String(percent));
      fill.style.width = `${percent}%`;
    },
    hide() {
      screen.hidden = true;
    },
    /** @param {string} [message] replaces the error text (from ui.json once it has loaded) */
    fail(message) {
      screen.hidden = true;
      if (message !== undefined) error.textContent = message;
      error.hidden = false;
    },
  };
}

/**
 * True when the browser can make a WebGL 2 context. Probes a throwaway
 * canvas, so the game canvas keeps the attributes three.js asks for.
 * @param {Document} doc
 */
export function hasWebGL2(doc) {
  try {
    const gl = doc.createElement('canvas').getContext('webgl2');
    if (!gl) return false;
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return true;
  } catch {
    return false;
  }
}
