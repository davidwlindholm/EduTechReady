// FPS and draw-call counter, created only with debug=1.
// Debug-only output; not user-facing text, so no ui.json keys.
import { h } from './dom.js';

const UPDATE_SECONDS = 0.5;

/** @param {HTMLElement} host */
export function createDebugHud(host) {
  const el = h('div', { className: 'debug-hud', attrs: { 'aria-hidden': 'true' } });
  host.appendChild(el);
  let frames = 0;
  let elapsed = 0;
  return {
    /**
     * @param {number} dt seconds since the last frame
     * @param {{ render: { calls: number } }} info renderer.info
     */
    update(dt, info) {
      frames += 1;
      elapsed += dt;
      if (elapsed < UPDATE_SECONDS) return;
      el.textContent = `FPS ${Math.round(frames / elapsed)} | draw calls ${info.render.calls}`;
      frames = 0;
      elapsed = 0;
    },
  };
}
