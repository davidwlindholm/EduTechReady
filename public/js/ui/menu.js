// Bottom-left menu bar: SAMR, Rogers, Instruktioner and Færdig, plus a small
// shadows toggle. SAMR and Rogers open the placement panels,
// Instruktioner reopens the instructions window, Færdig opens its dialog (or
// the results view after submission).
import { h } from './dom.js';

/**
 * @param {object} options
 * @param {HTMLElement} options.host
 * @param {(key: string) => string} options.t
 * @param {() => void} options.onSamr
 * @param {() => void} options.onRogers
 * @param {() => void} options.onInstructions
 * @param {() => void} options.onFinish
 * @param {{ shadows: boolean, onShadows: (on: boolean) => void }} [options.settings]
 *   the shadows toggle; left out, the menu has no toggle
 */
export function createMenu({ host, t, onSamr, onRogers, onInstructions, onFinish, settings = null }) {
  const button = (key, onClick, attrs = {}) => {
    const b = h('button', { className: 'menu__button', text: t(key), attrs: { type: 'button', ...attrs } });
    b.addEventListener('click', onClick);
    return b;
  };
  const buttons = {
    samr: button('menu.samr', onSamr, { 'aria-haspopup': 'dialog' }),
    rogers: button('menu.rogers', onRogers, { 'aria-haspopup': 'dialog' }),
    instructions: button('menu.instructions', onInstructions, { 'aria-haspopup': 'dialog' }),
    finish: button('menu.finish', onFinish, { 'aria-haspopup': 'dialog' }),
  };
  const children = Object.values(buttons);
  if (settings) {
    // A toggle button: its name stays "Skygger", aria-pressed carries the
    // state, and the small mark shows it to sighted users.
    let on = settings.shadows;
    const toggle = h('button', {
      className: 'menu__toggle',
      attrs: { type: 'button', 'aria-pressed': String(on), title: t('menu.shadows.hint') },
    }, [
      h('span', { className: 'menu__toggle-mark', attrs: { 'aria-hidden': 'true' } }),
      h('span', { text: t('menu.shadows') }),
    ]);
    toggle.addEventListener('click', () => {
      on = !on;
      toggle.setAttribute('aria-pressed', String(on));
      settings.onShadows(on);
    });
    buttons.shadows = toggle;
    children.push(toggle);
  }
  const nav = h('nav', { className: 'menu panel', attrs: { 'aria-label': t('menu.label') } }, children);
  host.appendChild(nav);
  return { element: nav, buttons };
}
