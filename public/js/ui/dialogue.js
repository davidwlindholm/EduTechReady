// Dialogue overlay: portrait, name, current line (the greeting,
// then the latest answer), numbered questions with the asked ones marked,
// the maxQuestions cap, and Farvel last. Walking to the character first is
// main.js's job (lib/talk.js).
import { h, trapTab, uniqueId } from './dom.js';
import { questionOptions } from '../lib/dialogue.js';

export class DialogueOverlay {
  /**
   * @param {object} options
   * @param {HTMLElement} options.host
   * @param {(key: string, params?: object) => string} options.t
   * @param {HTMLElement} options.focusFallback where focus goes on close (the canvas)
   * @param {(characterId: string, questionId: string) => void} options.onAsk
   * @param {() => void} [options.onClose]
   */
  constructor({ host, t, focusFallback, onAsk, onClose = () => {} }) {
    this.t = t;
    this.focusFallback = focusFallback;
    this.onAsk = onAsk;
    this.onClose = onClose;
    this.character = null;
    this.lastFocused = null;
    /** @type {string[]} question ids asked of the open character */
    this.asked = [];

    const nameId = uniqueId('dialogue-name');
    // One image element per portrait, kept for the page's life (see
    // preloadPortraits): the frame shows the current character's element.
    /** @type {Map<string, { img: HTMLImageElement, ready: boolean }>} */
    this.portraits = new Map();
    this.portrait = null;
    this.portraitFrame = h('div', { className: 'dialogue__portrait' });
    this.nameEl = h('h2', { className: 'dialogue__name', attrs: { id: nameId } });
    const lineId = uniqueId('dialogue-line');
    this.lineEl = h('p', { className: 'dialogue__line', attrs: { id: lineId, 'aria-live': 'polite' } });
    this.list = h('ol', { className: 'dialogue__questions', attrs: { 'aria-label': t('dialogue.questions') } });
    const capId = uniqueId('dialogue-cap');
    this.capNote = h('p', { className: 'dialogue__cap', text: t('dialogue.capReached'), attrs: { id: capId, hidden: '' } });
    this.capId = capId;
    this.root = h('section', {
      className: 'dialogue',
      attrs: { role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': nameId, 'aria-describedby': lineId, hidden: '' },
    }, [
      h('div', { className: 'dialogue__speech panel' }, [
        this.portraitFrame,
        h('div', { className: 'dialogue__text' }, [this.nameEl, this.lineEl]),
      ]),
      h('div', { className: 'dialogue__options panel' }, [this.list, this.capNote]),
    ]);
    this.root.addEventListener('keydown', (e) => this.handleKey(e));
    // Focus can leave the dialog while it is open (a click on the scene focuses
    // the canvas). Keys pressed there must still reach the dialog.
    document.addEventListener('keydown', (e) => {
      if (this.isOpen && !e.defaultPrevented && !this.root.contains(e.target)) this.handleOutsideKey(e);
    });
    this.root.addEventListener('focusin', (e) => {
      this.lastFocused = e.target;
    });
    host.appendChild(this.root);
  }

  get isOpen() {
    return this.character !== null;
  }

  /**
   * @param {object} character characters.json entry
   * @param {string[]} askedIds questions already asked
   */
  open(character, askedIds = []) {
    // May replace an open dialogue (a click on another character, main.js).
    this.character = character;
    this.lastFocused = null;
    this.asked = [...askedIds];
    this.showPortrait(character.portrait);
    this.nameEl.textContent = character.name;
    this.lineEl.textContent = character.greeting;
    this.renderOptions();
    this.root.hidden = false;
    this.list.querySelector('button:not([disabled])')?.focus();
  }

  /**
   * Load and decode every portrait up front and keep the image elements.
   * Holding on to them matters: an image nobody references can be dropped
   * from the browser's memory, and loading it again costs a round trip to
   * the server (Cache-Control: no-cache), about half a second on the host.
   * @param {string[]} sources
   */
  preloadPortraits(sources) {
    for (const src of sources) this.portraitFor(src);
  }

  /** The kept image element for a portrait, created and decoding on first use. */
  portraitFor(src) {
    let entry = this.portraits.get(src);
    if (!entry) {
      const img = h('img', { className: 'dialogue__portrait-img', attrs: { alt: '', width: '96', height: '96', src } });
      entry = { img, ready: false };
      const done = entry;
      img.decode().catch(() => {}).then(() => {
        done.ready = true;
        img.classList.remove('is-loading');
      });
      this.portraits.set(src, entry);
    }
    return entry;
  }

  /**
   * Show a portrait in the frame. A decoded one shows at once; one still
   * loading stays hidden until it has decoded (or failed), so the frame is
   * empty rather than showing the previous character's face.
   * @param {string} src
   */
  showPortrait(src) {
    const { img, ready } = this.portraitFor(src);
    if (this.portrait === img) return;
    img.classList.toggle('is-loading', !ready);
    this.portraitFrame.replaceChildren(img);
    this.portrait = img;
  }

  /** Move focus back into the open dialog, to the option that had it last. */
  refocus() {
    if (!this.isOpen) return;
    const target = this.lastFocused?.isConnected && this.root.contains(this.lastFocused)
      ? this.lastFocused
      : this.list.querySelector('button:not([disabled])');
    target?.focus({ preventScroll: true });
  }

  /**
   * Close the dialogue. Asked questions are already saved through onAsk.
   * Farvel and Esc return focus to the scene (the dialogue
   * only opens from it). When main.js closes it because the player walked out
   * of talking range (`byRange`), only focus that was in the dialogue (or
   * nowhere) moves to the canvas; focus the pair has put elsewhere (the
   * shadows toggle) stays.
   * @param {{ byRange?: boolean }} [options]
   */
  close({ byRange = false } = {}) {
    if (!this.isOpen) return;
    const active = document.activeElement;
    const moveFocus = !byRange || !active || active === document.body || this.root.contains(active);
    this.root.hidden = true;
    this.character = null;
    this.lastFocused = null;
    if (moveFocus) this.focusFallback.focus({ preventScroll: true });
    this.onClose();
  }

  /** Rebuild the numbered list from the asked state; keeps focus on the same option. */
  renderOptions() {
    const focusedIndex = [...this.list.querySelectorAll('button')].indexOf(document.activeElement);
    const { options, capReached } = questionOptions(this.character, this.asked);
    const items = options.map((q) => this.optionButton(q.text, () => this.ask(q), q));
    items.push(this.optionButton(this.t('dialogue.farewell'), () => this.close(), null, 'dialogue__farewell'));
    this.list.replaceChildren(...items.map((button, i) => {
      button.prepend(h('span', { className: 'dialogue__number', text: `${i + 1}.`, attrs: { 'aria-hidden': 'true' } }));
      return h('li', {}, [button]);
    }));
    this.capNote.hidden = !capReached;
    if (focusedIndex >= 0) {
      const buttons = this.list.querySelectorAll('button');
      const target = buttons[focusedIndex]?.disabled ? buttons[buttons.length - 1] : buttons[focusedIndex];
      target?.focus({ preventScroll: true });
    }
  }

  /**
   * @param {string} text
   * @param {() => void} onClick
   * @param {import('../lib/dialogue.js').QuestionOption|null} question null for Farvel
   * @param {string} [extraClass]
   */
  optionButton(text, onClick, question, extraClass = '') {
    const button = h('button', { className: `dialogue__option ${extraClass}`.trim(), attrs: { type: 'button' } }, [
      h('span', { className: 'dialogue__option-text', text }),
    ]);
    if (question?.asked) {
      button.classList.add('is-asked');
      button.appendChild(h('span', { className: 'visually-hidden', text: ` (${this.t('dialogue.asked')})` }));
    }
    if (question?.disabled) {
      button.disabled = true;
      button.setAttribute('aria-describedby', this.capId);
    }
    button.addEventListener('click', onClick);
    return button;
  }

  /** @param {import('../lib/dialogue.js').QuestionOption} question */
  ask(question) {
    if (question.disabled) return;
    this.lineEl.textContent = question.answer;
    if (!this.asked.includes(question.id)) {
      this.asked.push(question.id);
      this.onAsk(this.character.id, question.id);
    }
    this.renderOptions();
  }

  handleOutsideKey(event) {
    if (event.key === 'Tab') {
      event.preventDefault();
      this.refocus();
      return;
    }
    this.handleKey(event);
  }

  handleKey(event) {
    if (event.key === 'Escape') {
      event.preventDefault();
      this.close();
      return;
    }
    if (/^[1-9]$/.test(event.key) && !event.altKey && !event.ctrlKey && !event.metaKey) {
      const button = this.list.querySelectorAll('button')[Number(event.key) - 1];
      if (button) {
        event.preventDefault();
        button.focus();
        button.click();
      }
      return;
    }
    trapTab(this.root, event);
  }
}
