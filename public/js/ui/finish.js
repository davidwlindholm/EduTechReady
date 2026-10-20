// Færdig and submission.
//
// - FinishDialog: the Færdig modal. Lists the characters that still lack a
//   placement (finish.missing), or asks for confirmation (finish.confirm) and
//   then submits (session mode) or opens the results view (practice mode).
// - Modal: the centred modal shell, shared with the results view (ui/results.js).
// - createNotice: the mode notice at the top of the screen (practice mode,
//   invalid code, collection closed).
import { h, trapTab, uniqueId } from './dom.js';
import { splitNameRole } from '../lib/characters.js';
import { buildSubmission, isRetryableError, missingPlacements, submitPlacements } from '../lib/session.js';

/**
 * Error codes with their own message (friendly Danish text instead
 * of the raw code). Others use finish.error.server when a retry can help and
 * finish.error.rejected when it cannot. The code itself goes to a small
 * detail line and the console.
 */
const ERROR_KEYS = {
  network: 'finish.error.network',
  session_full: 'finish.error.full',
  invalid_session: 'finish.error.session',
  unknown_character: 'finish.error.outdated',
  incomplete: 'finish.error.outdated',
};

/**
 * A centred modal on a backdrop: Tab stays inside, Esc and a backdrop click
 * close it (unless `canClose` says no), keys pressed with focus outside it
 * still reach it, and focus goes to `focusFallback` on close.
 * `describeBody` false leaves out aria-describedby on the body (a long body,
 * such as the results list, would otherwise be read in full on open); the
 * owner can point it at a short element with `describeWith`.
 */
export class Modal {
  constructor({ host, className, titleText, focusFallback, canClose = () => true, onClose = () => {}, describeBody = true }) {
    this.focusFallback = focusFallback;
    this.canClose = canClose;
    this.onCloseCallback = onClose;
    this.isOpen = false;
    this.lastFocused = null;
    const titleId = uniqueId('modal-title');
    this.bodyId = uniqueId('modal-body');
    this.title = h('h2', { className: 'modal__title', text: titleText, attrs: { id: titleId } });
    this.body = h('div', { className: 'modal__body', attrs: { id: this.bodyId } });
    this.actions = h('div', { className: 'modal__actions' });
    this.dialog = h('section', {
      className: `modal ${className} panel`,
      attrs: { role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': titleId, ...(describeBody ? { 'aria-describedby': this.bodyId } : {}) },
    }, [this.title, this.body, this.actions]);
    this.root = h('div', { className: 'backdrop', attrs: { hidden: '' } }, [this.dialog]);
    this.root.addEventListener('keydown', (e) => this.handleKey(e));
    document.addEventListener('keydown', (e) => {
      if (!this.isOpen || e.defaultPrevented || this.root.contains(e.target)) return;
      if (e.key === 'Tab') {
        e.preventDefault();
        this.refocus();
      } else {
        this.handleKey(e);
      }
    });
    this.root.addEventListener('focusin', (e) => {
      this.lastFocused = e.target;
    });
    this.root.addEventListener('pointerdown', (e) => {
      if (e.target !== this.root) return;
      if (e.offsetX >= this.root.clientWidth || e.offsetY >= this.root.clientHeight) return; // scrollbar
      e.preventDefault(); // keep focus where close() puts it
      this.close();
    });
    host.appendChild(this.root);
  }

  handleKey(event) {
    if (event.key === 'Escape') {
      event.preventDefault();
      this.close();
    } else {
      trapTab(this.dialog, event);
    }
  }

  /** Describe the dialog by one element (given an id here if it has none), or by nothing. */
  describeWith(element) {
    if (!element) {
      this.dialog.removeAttribute('aria-describedby');
      return;
    }
    if (!element.id) element.id = uniqueId('modal-desc');
    this.dialog.setAttribute('aria-describedby', element.id);
  }

  /** Replace the body and the buttons. */
  setContent(bodyNodes, buttons) {
    this.body.replaceChildren(...bodyNodes);
    this.actions.replaceChildren(...buttons);
  }

  /**
   * @param {HTMLElement} [focusTarget] defaults to the first enabled button
   * @param {{ fromTop?: boolean }} [options] fromTop: a window taller than
   *   the screen opens scrolled to its top, not to the focused button
   */
  show(focusTarget, { fromTop = false } = {}) {
    this.isOpen = true;
    this.root.hidden = false;
    (focusTarget ?? this.actions.querySelector('button:not([disabled])'))?.focus({ preventScroll: fromTop });
    if (fromTop) this.root.scrollTop = 0;
  }

  refocus() {
    if (!this.isOpen) return;
    const target = this.lastFocused?.isConnected && this.dialog.contains(this.lastFocused) && !this.lastFocused.disabled
      ? this.lastFocused
      : this.actions.querySelector('button:not([disabled])') ?? this.dialog;
    target.focus({ preventScroll: true });
  }

  close() {
    if (!this.isOpen || !this.canClose()) return;
    this.isOpen = false;
    this.root.hidden = true;
    this.lastFocused = null;
    this.focusFallback.focus({ preventScroll: true });
    this.onCloseCallback();
  }
}

export function button(text, onClick, { primary = false } = {}) {
  const b = h('button', { className: primary ? 'button button--primary' : 'button', text, attrs: { type: 'button' } });
  b.addEventListener('click', onClick);
  return b;
}

function paragraph(text, className = 'modal__text') {
  return h('p', { className, text });
}

export class FinishDialog {
  /**
   * @param {object} options
   * @param {HTMLElement} options.host
   * @param {(key: string, params?: object) => string} options.t
   * @param {HTMLElement} options.focusFallback the canvas
   * @param {Array<{id: string, name: string}>} options.characters every character in characters.json
   * @param {ReturnType<typeof import('../lib/state.js').createStore>} options.store
   * @param {{ mode: 'session'|'practice', code: string|null }} options.session read on every open; set to practice on 503
   * @param {typeof fetch} options.fetchImpl
   * @param {() => void} options.openResults
   * @param {() => void} options.onClosedApi called after submit.php answered 503 (the mode is already practice)
   */
  constructor({ host, t, focusFallback, characters, store, session, fetchImpl, openResults, onClosedApi }) {
    this.t = t;
    this.characters = characters;
    this.store = store;
    this.session = session;
    this.fetchImpl = fetchImpl;
    this.openResults = openResults;
    this.onClosedApi = onClosedApi;
    this.sending = false;
    this.modal = new Modal({
      host, focusFallback, className: 'finish', titleText: t('finish.title'), canClose: () => !this.sending,
    });
    this.modal.dialog.dataset.view = '';
  }

  get isOpen() {
    return this.modal.isOpen;
  }

  refocus() {
    this.modal.refocus();
  }

  close() {
    this.modal.close();
  }

  /** Færdig: results after submission, otherwise the missing list or the confirmation. */
  open() {
    const state = this.store.getState();
    if (this.session.mode === 'session' && state.submitted) {
      this.openResults();
      return;
    }
    const missing = missingPlacements(this.characters, state);
    if (missing.length > 0) this.showMissing(missing);
    else this.showConfirm();
    this.modal.show();
  }

  /**
   * The load check found the API closed after the game started (session
   * mode is already switched to practice): an open confirmation or error
   * view becomes the practice confirmation with the closed note.
   */
  apiClosed() {
    if (!this.isOpen || this.sending) return;
    if (!['confirm', 'error'].includes(this.modal.dialog.dataset.view)) return;
    this.showConfirm('finish.closed');
    this.modal.refocus();
  }

  setView(name, bodyNodes, buttons) {
    this.modal.dialog.dataset.view = name;
    this.modal.setContent(bodyNodes, buttons);
  }

  missingText({ name, reason }) {
    const first = splitNameRole(name).name;
    return this.t(`finish.missing.${reason}`, { name, first });
  }

  showMissing(missing) {
    const t = this.t;
    const list = h('ul', { className: 'finish__missing' },
      missing.map((m) => h('li', { className: 'finish__missing-item', text: this.missingText(m), attrs: { 'data-id': m.id } })));
    this.setView('missing', [paragraph(t('finish.missing', { total: this.characters.length })), list], [
      button(t('finish.close'), () => this.close(), { primary: true }),
    ]);
  }

  showConfirm(noteKey = null) {
    const t = this.t;
    const practice = this.session.mode !== 'session';
    const body = [
      ...(noteKey ? [paragraph(t(noteKey), 'modal__text modal__note')] : []),
      paragraph(t(practice ? 'finish.confirmPractice' : 'finish.confirm')),
    ];
    const confirm = button(t(practice ? 'finish.showResults' : 'finish.send'), () => this.confirm(), { primary: true });
    this.setView(practice ? 'confirmPractice' : 'confirm', body, [button(t('finish.cancel'), () => this.close()), confirm]);
  }

  /**
   * The error view. A retryable error offers "Prøv igen"; a final one (a
   * retry would get the same answer) offers only "Luk". Either way the
   * placements stay in storage.
   */
  showError(code) {
    const t = this.t;
    const retryable = isRetryableError(code);
    console.warn(`Submission failed: ${code}`);
    const text = t(ERROR_KEYS[code] ?? (retryable ? 'finish.error.server' : 'finish.error.rejected'));
    const body = [h('p', { className: 'modal__text modal__error', text, attrs: { role: 'alert' } })];
    if (code !== 'network') body.push(paragraph(t('finish.error.code', { code }), 'modal__text modal__detail'));
    body.push(paragraph(t(retryable ? 'finish.error.kept' : 'finish.error.keptFinal')));
    if (!retryable) {
      const close = button(t('finish.close'), () => this.close(), { primary: true });
      this.setView('error', body, [close]);
      close.focus();
      return;
    }
    const retry = button(t('finish.retry'), () => this.confirm(), { primary: true });
    this.setView('error', body, [button(t('finish.close'), () => this.close()), retry]);
    retry.focus();
  }

  async confirm() {
    if (this.sending) return; // the confirm button is disabled too; this guards a fast double press
    if (this.session.mode !== 'session') {
      this.close();
      this.openResults();
      return;
    }
    const state = this.store.getState();
    if (missingPlacements(this.characters, state).length > 0) {
      this.showMissing(missingPlacements(this.characters, state));
      return;
    }
    this.sending = true;
    // The status line takes focus before the buttons are disabled, so focus
    // stays inside the dialog (a disabled button drops it to the page), and
    // the dialog is not marked aria-busy, which can silence the status.
    const status = h('p', { className: 'modal__text modal__status', text: this.t('finish.sending'), attrs: { role: 'status', tabindex: '-1' } });
    this.modal.body.appendChild(status);
    status.focus();
    for (const b of this.modal.actions.querySelectorAll('button')) b.disabled = true;
    let outcome;
    try {
      const payload = buildSubmission(this.session.code, state.clientId, this.characters, state.placements);
      outcome = await submitPlacements(this.fetchImpl, payload);
    } catch (err) {
      // submitPlacements never throws; this is a bug guard (e.g. a missing clientId).
      console.error('Submission could not be prepared', err);
      outcome = { kind: 'error', error: 'client' };
    } finally {
      this.sending = false;
    }
    if (outcome.kind === 'submitted' || outcome.kind === 'already') {
      this.store.markSubmitted(new Date().toISOString());
      this.close();
      this.openResults();
    } else if (outcome.kind === 'closed') {
      this.session.mode = 'practice';
      this.onClosedApi();
      this.showConfirm('finish.closed');
      this.modal.refocus();
    } else {
      this.showError(outcome.error);
    }
  }
}

/** Delay before a notice's text goes into the live region (see createNotice). */
const ANNOUNCE_DELAY_MS = 150;

/**
 * The mode notice at the top of the screen. One notice at a time; the pair
 * can dismiss it. Screen readers often skip a live region that appears
 * together with its text, so the announcement goes through a separate,
 * always-present live region that gets the text a moment after the notice
 * shows. Dismissing it puts focus on `focusFallback` (the canvas) instead of
 * dropping it with the hidden button.
 * @param {{ host: HTMLElement, t: (key: string) => string, focusFallback?: HTMLElement }} options
 */
export function createNotice({ host, t, focusFallback = null }) {
  const text = h('p', { className: 'notice__text' });
  const dismiss = h('button', { className: 'notice__close', text: t('notice.closeMark'), attrs: { type: 'button', 'aria-label': t('notice.close') } });
  const root = h('div', { className: 'notice panel', attrs: { hidden: '' } }, [text, dismiss]);
  const live = h('p', { className: 'visually-hidden', attrs: { role: 'status', 'data-notice-live': '' } });
  let announce = 0;
  dismiss.addEventListener('click', () => {
    const hadFocus = root.contains(document.activeElement);
    root.hidden = true;
    window.clearTimeout(announce);
    live.textContent = '';
    if (hadFocus) focusFallback?.focus({ preventScroll: true });
  });
  host.append(live, root);
  return {
    element: root,
    /** @param {string} key ui.json key */
    show(key) {
      text.textContent = t(key);
      root.dataset.notice = key;
      root.hidden = false;
      window.clearTimeout(announce);
      live.textContent = '';
      announce = window.setTimeout(() => {
        live.textContent = t(key);
      }, ANNOUNCE_DELAY_MS);
    },
  };
}
