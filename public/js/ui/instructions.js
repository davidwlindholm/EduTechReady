// The instructions window: opens when
// the game has loaded and again from the Instruktioner button in the menu.
// All of its text comes from content/instructions.json, so the text can change
// it without touching code; the validator keeps it short enough to fit a
// 1280 x 600 browser window without scrolling (a longer text, or a smaller
// window, still works: the backdrop scrolls, as for the other modals, and
// the window opens scrolled to the top so the title shows first).
import { h } from './dom.js';
import { Modal } from './finish.js';

export class InstructionsModal {
  /**
   * @param {object} options
   * @param {HTMLElement} options.host
   * @param {{ title: string, intro?: string, sections: Array<{ heading: string, items: string[] }>, close: string }} options.content
   *   parsed instructions.json
   * @param {HTMLElement} options.focusFallback where focus goes on close (the canvas)
   */
  constructor({ host, content, focusFallback }) {
    // describeBody false: the whole text would be read out on open; the
    // intro (when there is one) describes the dialog instead.
    this.modal = new Modal({ host, className: 'instructions', titleText: content.title, focusFallback, describeBody: false });
    const intro = content.intro ? h('p', { className: 'modal__text instructions__intro', text: content.intro }) : null;
    const sections = content.sections.map((section) => h('section', { className: 'instructions__section' }, [
      h('h3', { className: 'instructions__heading', text: section.heading }),
      h('ul', { className: 'instructions__list' }, section.items.map((item) => h('li', { text: item }))),
    ]));
    const close = h('button', { className: 'button button--primary', text: content.close, attrs: { type: 'button' } });
    close.addEventListener('click', () => this.close());
    this.modal.setContent(intro ? [intro, ...sections] : sections, [close]);
    this.modal.describeWith(intro);
  }

  get isOpen() {
    return this.modal.isOpen;
  }

  open() {
    // When the window is taller than the screen, the pair sees the title first.
    this.modal.show(undefined, { fromTop: true });
  }

  refocus() {
    this.modal.refocus();
  }

  close() {
    this.modal.close();
  }
}
