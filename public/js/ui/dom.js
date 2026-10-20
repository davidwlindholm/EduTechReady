// Small DOM helpers shared by the overlays. Text is always set with textContent.

/**
 * Create an element.
 * @param {string} tag
 * @param {{ className?: string, text?: string, attrs?: Record<string, string> }} [options]
 * @param {Node[]} [children]
 */
export function h(tag, { className, text, attrs } = {}, children = []) {
  const el = document.createElement(tag);
  if (className) el.className = className;
  if (text !== undefined) el.textContent = text;
  if (attrs) for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  children.forEach((c) => el.appendChild(c));
  return el;
}

const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** Focusable elements inside a container, in DOM order, skipping hidden ones. */
export function focusableIn(container) {
  return [...container.querySelectorAll(FOCUSABLE)].filter((el) => !el.closest('[hidden]'));
}

/**
 * Keep Tab and Shift+Tab inside a modal container. Call from its keydown handler.
 * @param {HTMLElement} container
 * @param {KeyboardEvent} event
 */
export function trapTab(container, event) {
  if (event.key !== 'Tab') return;
  const items = focusableIn(container);
  if (items.length === 0) {
    event.preventDefault();
    return;
  }
  const first = items[0];
  const last = items[items.length - 1];
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}

let idCounter = 0;
/** A unique element id for aria-labelledby links. */
export function uniqueId(prefix) {
  idCounter += 1;
  return `${prefix}-${idCounter}`;
}

/**
 * Return focus to where it was before an overlay opened, or to a fallback.
 * @param {Element|null} previous
 * @param {HTMLElement} fallback
 */
export function restoreFocus(previous, fallback) {
  const target = previous instanceof HTMLElement && previous.isConnected && previous !== document.body ? previous : fallback;
  target.focus({ preventScroll: true });
}
