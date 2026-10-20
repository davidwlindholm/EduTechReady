// Facilitator page: makes a session code and shows the participant
// and projector links with copy buttons. No server call besides loading ui.json.
import { createTextLookup } from '../lib/text.js';
import { generateSessionCode, parseSessionCode, sessionLinks } from '../lib/sessionCode.js';
import { h, uniqueId } from './dom.js';

const UI_URL = 'content/ui.json';
/** How long a copy button reads "Kopieret" before it reverts. */
const COPIED_MS = 2500;

const fillRandom = (bytes) => crypto.getRandomValues(bytes);

async function loadUi() {
  const response = await fetch(UI_URL, { cache: 'no-cache' });
  if (!response.ok) throw new Error(`${UI_URL}: HTTP ${response.status}`);
  return response.json();
}

/** Put the code in the address bar, so a reload or bookmark keeps it. */
function rememberCode(code) {
  const url = new URL(window.location.href);
  url.searchParams.set('session', code);
  url.hash = '';
  window.history.replaceState(null, '', url.href);
}

/** Show a status message; a warning gets its own colour, not the success green. */
function setStatus(status, text, { warning = false } = {}) {
  status.textContent = text;
  status.classList.toggle('is-warning', warning);
}

/**
 * One link block: heading, help text, the full URL in a read-only field, a
 * copy button and an "open" link.
 */
function linkSection(t, { id, headingKey, helpKey }, status) {
  const headingId = uniqueId(`${id}-heading`);
  const helpId = uniqueId(`${id}-help`);
  const field = h('input', {
    className: 'facilitator__url',
    attrs: {
      type: 'text', readonly: '', spellcheck: 'false', autocomplete: 'off',
      'aria-labelledby': headingId, 'aria-describedby': helpId, 'data-link': id,
    },
  });
  const copy = h('button', { className: 'button facilitator__copy', text: t('facilitator.copy'), attrs: { type: 'button', 'data-copy': id } });
  const open = h('a', { className: 'button facilitator__open', text: t('facilitator.open'), attrs: { 'data-open': id, target: '_blank', rel: 'noopener' } });
  let revert = 0;

  /** Back to "Kopiér link", e.g. when the link changes after a copy. */
  function resetCopy() {
    window.clearTimeout(revert);
    copy.textContent = t('facilitator.copy');
    copy.classList.remove('is-copied');
  }

  field.addEventListener('focus', () => field.select());
  copy.addEventListener('click', async () => {
    resetCopy();
    const copiedValue = field.value;
    try {
      await navigator.clipboard.writeText(copiedValue);
      // A new code may have arrived while the clipboard call was pending.
      if (field.value !== copiedValue) return;
      copy.textContent = t('facilitator.copied');
      copy.classList.add('is-copied');
      setStatus(status, t('facilitator.copiedStatus'));
      revert = window.setTimeout(resetCopy, COPIED_MS);
    } catch (err) {
      // No clipboard access (insecure context, denied permission): select the
      // text so a keyboard shortcut copies it.
      console.warn('Clipboard write failed', err);
      field.focus();
      field.select();
      setStatus(status, t('facilitator.copyFailed'), { warning: true });
    }
  });

  const section = h('section', { className: 'facilitator__section', attrs: { 'aria-labelledby': headingId } }, [
    h('h2', { text: t(headingKey), attrs: { id: headingId } }),
    h('p', { className: 'facilitator__help', text: t(helpKey), attrs: { id: helpId } }),
    h('div', { className: 'facilitator__row' }, [field, copy, open]),
  ]);
  return { section, field, open, resetCopy };
}

function render(t, root) {
  document.title = t('facilitator.title');
  const status = h('p', { className: 'facilitator__status', attrs: { role: 'status', 'aria-live': 'polite' } });
  const codeValue = h('span', { className: 'facilitator__code', attrs: { 'data-code': '' } });
  const participant = linkSection(t, { id: 'participant', headingKey: 'facilitator.participant.heading', helpKey: 'facilitator.participant.help' }, status);
  const projector = linkSection(t, { id: 'projector', headingKey: 'facilitator.projector.heading', helpKey: 'facilitator.projector.help' }, status);
  const newCode = h('button', { className: 'button facilitator__new', text: t('facilitator.newCode'), attrs: { type: 'button' } });
  // "Lav en ny kode" asks first (pairs may already have the current link),
  // and a new code can be undone, so the old one is never lost by one click.
  const confirmText = h('p', { className: 'facilitator__confirm-text' });
  const confirmYes = h('button', { className: 'button button--primary', text: t('facilitator.newCodeYes'), attrs: { type: 'button' } });
  const confirmNo = h('button', { className: 'button', text: t('facilitator.newCodeNo'), attrs: { type: 'button' } });
  const confirmBox = h('div', { className: 'facilitator__confirm', attrs: { role: 'group', hidden: '' } },
    [confirmText, h('div', { className: 'facilitator__confirm-actions' }, [confirmNo, confirmYes])]);
  confirmBox.setAttribute('aria-label', t('facilitator.newCode'));
  const undo = h('button', { className: 'button facilitator__undo', attrs: { type: 'button', hidden: '' } });
  let current = '';
  let previous = null;

  function show(code) {
    current = code;
    const links = sessionLinks(window.location.href, code);
    codeValue.textContent = code;
    participant.field.value = links.participant;
    participant.open.href = links.participant;
    projector.field.value = links.projector;
    projector.open.href = links.projector;
    // The old link may still read "Kopieret"; the new one has not been copied.
    participant.resetCopy();
    projector.resetCopy();
    rememberCode(code);
  }

  function closeConfirm(focus) {
    confirmBox.hidden = true;
    newCode.hidden = false;
    if (focus) newCode.focus();
  }

  newCode.addEventListener('click', () => {
    confirmText.textContent = t('facilitator.newCodeConfirm', { code: current });
    newCode.hidden = true;
    confirmBox.hidden = false;
    confirmNo.focus();
  });
  confirmNo.addEventListener('click', () => closeConfirm(true));
  confirmBox.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    event.preventDefault();
    closeConfirm(true);
  });
  confirmYes.addEventListener('click', () => {
    previous = current;
    const code = generateSessionCode(fillRandom);
    show(code);
    closeConfirm(true);
    undo.textContent = t('facilitator.undo', { code: previous });
    undo.hidden = false;
    setStatus(status, t('facilitator.newCodeStatus', { code }));
  });
  undo.addEventListener('click', () => {
    if (!previous) return;
    const code = previous;
    previous = null;
    show(code);
    undo.hidden = true;
    newCode.focus();
    setStatus(status, t('facilitator.undoStatus', { code }));
  });

  // Keep the code from the address bar (reload, bookmark); otherwise make one.
  const params = new URLSearchParams(window.location.search);
  show(parseSessionCode(params.get('session')) ?? generateSessionCode(fillRandom));

  root.replaceChildren(
    h('h1', { text: t('facilitator.heading') }),
    h('p', { className: 'facilitator__intro', text: t('facilitator.intro') }),
    h('p', { className: 'facilitator__code-line' }, [
      h('span', { className: 'facilitator__code-label', text: t('facilitator.codeLabel') }),
      codeValue,
    ]),
    participant.section,
    projector.section,
    h('div', { className: 'facilitator__footer' }, [
      h('p', { className: 'facilitator__keep', text: t('facilitator.keep') }),
      h('div', { className: 'facilitator__code-actions' }, [undo, newCode, confirmBox]),
    ]),
    status,
  );
}

async function boot() {
  const root = document.getElementById('facilitator');
  try {
    const t = createTextLookup(await loadUi(), { onMissing: (key) => console.warn(`ui.json has no key "${key}"`) });
    render(t, root);
  } catch (err) {
    console.error('Facilitator page failed to load', err);
    document.getElementById('facilitator-loading').hidden = true;
    document.getElementById('facilitator-error').hidden = false;
  } finally {
    root.removeAttribute('aria-busy');
  }
}

boot();
