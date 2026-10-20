// Debug API (window.__game). Installed only when the URL has debug=1.

/**
 * @param {object} deps
 * @param {ReturnType<typeof import('./render/world.js').createWorld> extends Promise<infer W> ? W : never} deps.world
 * @param {ReturnType<typeof import('./lib/state.js').createStore>} deps.store
 * @param {() => boolean} deps.transitionRunning true while a camera or overlay transition runs
 * @param {() => void} deps.onStateChanged lets open panels redraw after setPlacement
 */
export function installDebugApi({ world, store, transitionRunning, onStateChanged }) {
  window.__game = Object.freeze({
    getPlayerTile: () => ({ ...world.player.tile }),
    tileToScreen: (col, row) => world.tileToScreen(col, row),
    npcToScreen: (id) => world.npcToScreen(id),
    isIdle: () => world.player.isSettled && !transitionRunning(),
    getState: () => store.getState(),
    setPlacement: (id, axis, value) => {
      store.setPlacement(id, axis, value);
      onStateChanged();
    },
  });
}
