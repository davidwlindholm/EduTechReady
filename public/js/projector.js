// Projector view: results.html?session=CODE. The same rows
// as the in-game view without the own dot, in larger type, refreshed every
// 30 seconds, with "Gem som PDF" (window.print; css/print.css lays the
// page out on A4). Works without debug=1.
import { createTextLookup } from './lib/text.js';
import { detectMode } from './lib/session.js';
import { h } from './ui/dom.js';
import { REFRESH_MS, ResultsList, createLegend, loadResults, setText, updatedText } from './ui/results.js';

const CONTENT = { ui: 'content/ui.json', characters: 'content/characters.json' };

async function loadJson(url) {
  const response = await fetch(url, { cache: 'no-cache' });
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
  return response.json();
}

function pageButton(text, onClick) {
  const b = h('button', { className: 'button', text, attrs: { type: 'button' } });
  b.addEventListener('click', onClick);
  return b;
}

/** A missing or invalid code: say so in Danish, and send no request. */
function renderCodeProblem(t, root, invalid) {
  root.replaceChildren(
    h('h1', { className: 'results-page__title', text: t('results.page.heading') }),
    h('p', {
      className: 'results-page__code-problem',
      text: t(invalid ? 'results.page.invalidCode' : 'results.page.missingCode'),
      attrs: { role: 'alert' },
    }),
  );
}

function renderResults(t, root, characters, code) {
  const fetchImpl = window.fetch.bind(window);
  const ids = characters.map((c) => c.id);
  // Names are h2 under the page's h1 (no level skipped).
  const list = new ResultsList({ t, characters, nameHeading: 'h2' });
  const status = h('p', { className: 'results__count', text: t('results.loading'), attrs: { role: 'status' } });
  const updated = h('p', { className: 'results__updated' });
  const problem = h('p', { className: 'results__problem', attrs: { hidden: '' } });
  let results = null;
  let shownKey = null;
  let seq = 0;
  let inFlight = false;

  /**
   * @param {{ auto?: boolean }} [options] auto: the 30 s timer, which skips a
   *   tick while a request and its retries still run (on a hanging server the
   *   error would otherwise never show, as in ui/results.js)
   */
  async function refresh({ auto = false } = {}) {
    if (auto && inFlight) return;
    const mine = ++seq;
    inFlight = true;
    const answer = await loadResults(fetchImpl, code, ids, () => mine === seq);
    if (!answer || mine !== seq) return;
    inFlight = false;
    if (answer.kind === 'ok') {
      results = answer.results;
      updated.textContent = updatedText(t, new Date());
      problem.hidden = true;
      // An unchanged answer keeps the rows and the live count as they are.
      const key = JSON.stringify(results);
      if (key === shownKey) return;
      shownKey = key;
      setText(status, t('results.count', { n: results.n }));
      status.dataset.n = String(results.n);
      list.render(results, null);
      return;
    }
    const key = answer.kind === 'closed' ? 'results.closed' : 'results.error';
    if (results) {
      problem.textContent = t(key);
      problem.hidden = false;
    } else {
      status.textContent = t(key);
    }
  }

  list.render(null, null);
  root.replaceChildren(
    h('header', { className: 'results-page__header' }, [
      h('div', { className: 'results-page__heading' }, [
        h('h1', { className: 'results-page__title', text: t('results.page.heading') }),
        h('p', { className: 'results-page__session', text: t('results.page.session', { code }) }),
      ]),
      h('div', { className: 'results-page__status' }, [status, updated, problem,
        h('p', { className: 'results-page__auto', text: t('results.auto') })]),
      h('div', { className: 'results-page__actions' }, [
        pageButton(t('results.refresh'), () => refresh()),
        pageButton(t('results.page.print'), () => window.print()),
      ]),
    ]),
    createLegend(t, { own: false }),
    list.element,
  );
  refresh();
  window.setInterval(() => refresh({ auto: true }), REFRESH_MS);
}

async function boot() {
  const root = document.getElementById('results');
  try {
    const [ui, content] = await Promise.all([loadJson(CONTENT.ui), loadJson(CONTENT.characters)]);
    const t = createTextLookup(ui, { onMissing: (key) => console.warn(`ui.json has no key "${key}"`) });
    document.title = t('results.page.title');
    const session = detectMode(window.location.search);
    if (session.mode !== 'session') renderCodeProblem(t, root, session.invalidCode);
    else renderResults(t, root, content.characters, session.code);
  } catch (err) {
    console.error('Results page failed to load', err);
    document.getElementById('results-loading').hidden = true;
    document.getElementById('results-load-error').hidden = false;
  } finally {
    root.removeAttribute('aria-busy');
  }
}

boot();
