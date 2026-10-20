// Game entry point: loads content, builds the world and the overlays, wires input.
import { createTextLookup } from './lib/text.js';
import { parseFlags } from './lib/flags.js';
import { createStore, storageKey } from './lib/state.js';
import { createSettings } from './lib/settings.js';
import { createClientId, detectMode, fetchResults } from './lib/session.js';
import { parseLevel } from './lib/level.js';
import { createGrid } from './lib/grid.js';
import { layoutFurniture } from './lib/furniture.js';
import { findCharacter } from './lib/characters.js';
import { occupiedTiles } from './lib/seating.js';
import { chooseTalkTile, inTalkRange, visibleNameplates } from './lib/talk.js';
import { askedIds } from './lib/dialogue.js';
import { floorClickTarget } from './lib/clickTarget.js';
import { createWorld } from './render/world.js';
import { DialogueOverlay } from './ui/dialogue.js';
import { createMenu } from './ui/menu.js';
import { PlacementPanel } from './ui/placement.js';
import { FinishDialog, createNotice } from './ui/finish.js';
import { ResultsModal } from './ui/results.js';
import { InstructionsModal } from './ui/instructions.js';
import { createLoadingScreen, hasWebGL2 } from './ui/loading.js';

const loading = createLoadingScreen(document);

const CONTENT = {
  ui: 'content/ui.json',
  assets: 'content/assets.json',
  characters: 'content/characters.json',
  level: 'content/level.json',
  instructions: 'content/instructions.json',
};
const SAMR_LABEL_KEYS = ['samr.band.0', 'samr.band.1', 'samr.band.2', 'samr.band.3'];
const ROGERS_LABEL_KEYS = ['rogers.category.0', 'rogers.category.1', 'rogers.category.2', 'rogers.category.3', 'rogers.category.4'];
// Door easter-egg phases during which the debug API's isIdle is false.
const DOOR_TRANSITION_PHASES = new Set(['opening', 'open', 'closing']);
// Brackets over the SAMR bands: the first two read "Forbedring", the last two "Transformation".
const SAMR_BRACKETS = [
  { key: 'placement.bracket.enhancement', from: 0, to: 50 },
  { key: 'placement.bracket.transformation', from: 50, to: 100 },
];

async function loadJson(url) {
  const response = await fetch(url, { cache: 'no-cache' });
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
  return response.json();
}

/** window.localStorage, or null where reading it throws (privacy modes, sandboxed frames). */
function browserStorage() {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}


/**
 * Session mode only: ask results.php whether collection is open (if the
 * API reports closed, the game runs practice mode). Any other answer, or no
 * answer, keeps session mode; Færdig handles errors when it submits. Boot
 * does not wait for it (see the mode handling in boot()).
 */
async function apiIsClosed(code) {
  const answer = await fetchResults(window.fetch.bind(window), code, []);
  return answer.kind === 'closed';
}

async function boot() {
  const flags = parseFlags(window.location.search);
  // Mode detection (?session= code). `session` is shared with the Færdig dialog,
  // which switches it to practice when submit.php reports closed.
  const session = detectMode(window.location.search);
  const closedCheck = session.mode === 'session' ? apiIsClosed(session.code) : Promise.resolve(false);
  const [ui, assets, characters, levelData, instructionsContent] = await Promise.all([
    loadJson(CONTENT.ui), loadJson(CONTENT.assets), loadJson(CONTENT.characters), loadJson(CONTENT.level),
    loadJson(CONTENT.instructions),
  ]);
  const level = parseLevel(levelData);
  const furniture = layoutFurniture(level, assets);
  const t = createTextLookup(ui, { onMissing: (key) => console.warn(`ui.json has no key "${key}"`) });
  document.title = t('app.title');
  loading.setText(t('app.loading'));
  // From here a failed start shows the ui.json text; the copy in index.html
  // covers a start that fails before ui.json has loaded.
  document.getElementById('load-error').textContent = t('app.loadError');
  if (!hasWebGL2(document)) {
    // A clear Danish message instead of three.js failing to make a context.
    console.warn('WebGL 2 is not available; the game cannot start');
    loading.fail(t('app.noWebgl'));
    return;
  }

  // The storage key follows the code (lounge:v1:<CODE>, or lounge:v1:practice).
  // A session whose API is closed keeps its own key: the pair's work stays
  // with the session.
  const store = createStore({
    storage: browserStorage(),
    key: storageKey(session.code),
    createClientId: session.mode === 'session' ? () => createClientId(window.crypto) : () => null,
    knownIds: characters.characters.map((c) => c.id),
    onStorageError: (err) => console.warn('localStorage unavailable, keeping state in memory', err),
  });

  const canvas = document.getElementById('scene');
  canvas.setAttribute('aria-label', t('scene.label'));
  const overlayHost = document.getElementById('overlays');
  // Furniture footprints and characters occupy their tiles (a seated
  // character's tile is its chair or sofa, already blocked; a standing one
  // occupies the tile it actually stands on, see occupiedTiles).
  const grid = createGrid(level, [...furniture.blocked, ...occupiedTiles(characters, furniture)]);
  const world = await createWorld({
    canvas, labelHost: document.getElementById('labels'), assets, characters, level, grid, furniture,
    onProgress: (fraction) => loading.progress(fraction),
  });

  // Display settings: own storage key, not part of the game state.
  const settings = createSettings({
    storage: browserStorage(),
    onStorageError: (err) => console.warn('Settings not saved; keeping them in memory', err),
  });
  world.setShadows(settings.get().shadows);

  // The menu comes first in the DOM so modal backdrops added later cover it.
  createMenu({
    host: overlayHost, t,
    onSamr: () => openPanel('samr'),
    onRogers: () => openPanel('rogers'),
    onInstructions: () => openInstructions(),
    onFinish: () => openFinish(),
    settings: {
      shadows: settings.get().shadows,
      onShadows: (on) => {
        settings.set({ shadows: on });
        world.setShadows(on);
      },
    },
  });

  const dialogue = new DialogueOverlay({
    host: overlayHost, t, focusFallback: canvas,
    onAsk: (characterId, questionId) => store.markAsked(characterId, questionId),
  });
  // Every portrait loads now, so a dialogue shows its face at once.
  dialogue.preloadPortraits(characters.characters.map((c) => c.portrait));

  const metCharacters = () => store.getState().met
    .map((id) => findCharacter(characters, id))
    .filter(Boolean);
  // Placement panels: only met characters get tokens; read-only
  // once the pair has submitted. Closing returns focus to the canvas.
  const panelOptions = (axis, titleKey, labelKeys, brackets = []) => ({
    host: overlayHost, t, axis, titleKey, labelKeys, brackets, focusFallback: canvas,
    getCharacters: metCharacters,
    getPlacements: () => store.getState().placements,
    isLocked: () => store.getState().submitted,
    onChange: (id, value) => store.setPlacement(id, axis, value),
  });
  const panels = {
    samr: new PlacementPanel(panelOptions('samr', 'placement.samr.title', SAMR_LABEL_KEYS, SAMR_BRACKETS)),
    rogers: new PlacementPanel(panelOptions('rogers', 'placement.rogers.title', ROGERS_LABEL_KEYS)),
  };

  // Færdig and submission, then the results view.
  const notice = createNotice({ host: overlayHost, t, focusFallback: canvas });
  const fetchImpl = window.fetch.bind(window);
  const results = new ResultsModal({
    host: overlayHost, t, focusFallback: canvas, characters: characters.characters, store, session, fetchImpl,
  });
  const finish = new FinishDialog({
    host: overlayHost, t, focusFallback: canvas, characters: characters.characters, store, session, fetchImpl,
    openResults: () => results.open(),
    onClosedApi: () => {
      notice.show('notice.closed');
      setModeAttribute();
    },
  });
  const instructions = new InstructionsModal({ host: overlayHost, content: instructionsContent, focusFallback: canvas });
  const modals = [finish, results, instructions];
  const closeAll = () => {
    dialogue.close();
    Object.values(panels).forEach((panel) => panel.close());
    modals.forEach((m) => m.close());
  };
  const openPanel = (name) => {
    closeAll();
    panels[name].open();
  };
  const openFinish = () => {
    closeAll();
    finish.open();
  };
  const openInstructions = () => {
    closeAll();
    instructions.open();
  };

  // Fixed for the page's life; built once because the nameplate update asks every frame.
  const overlayList = [dialogue, ...Object.values(panels), ...modals];
  const overlays = () => overlayList;
  const overlayOpen = () => overlayList.some((o) => o.isOpen);
  // Panels and modals block the scene; the dialogue does not: a click
  // elsewhere walks there, and the dialogue closes once the player is out of
  // talking range (see the frame callback below).
  const sceneBlockers = [...Object.values(panels), ...modals];
  const sceneBlocked = () => sceneBlockers.some((o) => o.isOpen);
  // A click that reached the canvas or a nameplate while a panel or modal is
  // open does nothing in the scene; focus goes back into the open overlay.
  const refocusOverlay = () => overlays().find((o) => o.isOpen)?.refocus();

  // The mode as a body attribute (for styling and tests; not the debug API).
  function setModeAttribute() {
    document.body.dataset.mode = session.mode;
  }
  if (session.invalidCode) notice.show('notice.invalidCode');
  else if (session.mode === 'practice') notice.show('notice.practice');
  else {
    // Not awaited: a slow or hanging API must not hold the loading screen.
    // The game starts in session mode and switches when the answer says
    // closed, unless a submission has settled it meanwhile (Færdig in
    // flight gets its own 503, a 201 or 409 sets submitted).
    closedCheck.then((closed) => {
      if (!closed || session.mode !== 'session' || finish.sending || store.getState().submitted) return;
      session.mode = 'practice';
      notice.show('notice.closed');
      setModeAttribute();
      finish.apiClosed();
    }).catch((err) => console.error('Closed check failed', err));
  }
  setModeAttribute();

  // Walk-then-talk: a conversation opens only within talking range
  // of the character (lib/talk.js). From further away the player first walks
  // to the reachable tile in range with the shortest walk. Each new click
  // supersedes a pending conversation; a cancelled walk or turn opens nothing.
  let talkSeq = 0;
  async function talkTo(id) {
    const seq = ++talkSeq;
    const character = findCharacter(characters, id);
    const place = world.places.get(id);
    if (!character || !place) return;
    const { player } = world;
    if (!inTalkRange(player.position, place)) {
      const tile = chooseTalkTile(grid, player.tile, place);
      if (!tile) return;
      // player.moveTo, not world.walkTo: no click marker under the character.
      const walk = player.moveTo(tile.col, tile.row);
      if (!(await walk.arrived) || seq !== talkSeq) return;
    } else if (player.isMoving) {
      // Already in range while walking to an earlier target: stop here, or
      // the old route would carry the player away behind the dialogue and
      // overwrite the turn's heading every frame.
      player.stop();
    }
    if (!(await player.faceToward(place.x, place.z)) || seq !== talkSeq || sceneBlocked()) return;
    if (dialogue.character?.id === id) {
      // Already talking to them: keep the conversation where it is.
      dialogue.refocus();
      return;
    }
    store.markMet(id);
    dialogue.open(character, askedIds(store.getState(), id)); // replaces another open dialogue
  }

  canvas.addEventListener('click', (event) => {
    if (sceneBlocked()) {
      // The click focused the canvas; keep focus inside the open overlay.
      refocusOverlay();
      return;
    }
    const hit = world.pick(event.clientX, event.clientY);
    // The click focused the canvas; an open dialogue keeps the keyboard
    // focus while the player walks (it closes by itself out of range).
    dialogue.refocus();
    if (!hit) return;
    if (hit.kind === 'npc') {
      talkTo(hit.id);
      return;
    }
    talkSeq += 1; // any other click drops a pending conversation
    if (hit.kind === 'door') {
      world.openDoor();
    } else if (level.typeAt(hit.col, hit.row) !== 'void') {
      // Any tile of the map, walls and blocked tiles included: an unreachable
      // target sends the player to the reachable tile nearest the clicked
      // point (the point, not the tile). Clicks
      // beside the map (void) stay ignored.
      const target = floorClickTarget(grid, world.player.tile, hit);
      world.walkTo(target.col, target.row);
    }
  });

  // Nameplates: hidden until the mouse hovers the character (its
  // visible body, the same pick as a click, or its visible nameplate) or the
  // player is in talking range.
  let hoverPick = null;
  let hoverLabel = null;
  let showAllNameplates = false; // debug=1 only, key L
  // Hover picks the same shape a click does, but at most once per frame and
  // only after the pointer has moved (pointermove can fire many times a frame).
  const pointer = { x: 0, y: 0, moved: false, inPage: false };
  canvas.addEventListener('pointermove', (event) => {
    pointer.x = event.clientX;
    pointer.y = event.clientY;
    pointer.moved = true;
  });
  canvas.addEventListener('pointerleave', () => {
    pointer.moved = false;
    setHover(null);
  });
  // The last position over the overlays too, so hover can be worked out again
  // when the scene changes under a still pointer (see rehover).
  window.addEventListener('pointermove', (event) => {
    pointer.x = event.clientX;
    pointer.y = event.clientY;
    pointer.inPage = true;
  });
  document.documentElement.addEventListener('pointerleave', () => { pointer.inPage = false; });
  // After the door sequence moves on or an overlay closes, the hover state
  // is stale until the pointer moves (the door would keep its pointer cursor
  // once it can no longer be clicked): pick again if the pointer is over the
  // scene.
  function rehover() {
    if (pointer.inPage && document.elementFromPoint(pointer.x, pointer.y) === canvas) pointer.moved = true;
  }
  let hoverDoorPhase = world.doorPhase;
  let hoverOverlayOpen = false;
  function rehoverOnChange() {
    const open = overlayOpen();
    if (world.doorPhase !== hoverDoorPhase || (hoverOverlayOpen && !open)) rehover();
    hoverDoorPhase = world.doorPhase;
    hoverOverlayOpen = open;
  }
  function setHover(hit) {
    hoverPick = hit?.kind === 'npc' ? hit.id : null;
    canvas.classList.toggle('is-over-npc', hit?.kind === 'npc');
    canvas.classList.toggle('is-over-door', hit?.kind === 'door');
  }
  function updateHover() {
    if (!pointer.moved) return;
    pointer.moved = false;
    setHover(sceneBlocked() ? null : world.pick(pointer.x, pointer.y));
  }
  for (const npc of world.npcs.values()) {
    const el = npc.label.element;
    // A visible nameplate starts the conversation like a click on the
    // character; hidden ones take no pointer events (CSS).
    el.addEventListener('click', () => {
      if (sceneBlocked()) {
        refocusOverlay();
        return;
      }
      talkTo(npc.id);
    });
    el.addEventListener('pointerenter', () => {
      hoverLabel = npc.id;
    });
    el.addEventListener('pointerleave', () => {
      if (hoverLabel === npc.id) hoverLabel = null;
    });
  }
  const allIds = new Set(world.places.keys());
  // Runs every frame: the hovered list and the result set are reused.
  const hovered = [];
  const shown = new Set();
  function updateNameplates() {
    hovered.length = 0;
    if (!sceneBlocked()) {
      if (hoverPick) hovered.push(hoverPick);
      if (hoverLabel) hovered.push(hoverLabel);
    }
    world.setNameplates(showAllNameplates ? allIds
      : visibleNameplates(world.places, world.player.root.position, hovered, undefined, shown));
  }
  updateNameplates();

  world.resize();
  window.addEventListener('resize', () => world.resize());

  let hud = null;
  if (flags.debug) {
    // Debug-only modules load on demand, so without debug=1 none of this exists.
    const [{ createDebugHud }, { installDebugApi }] = await Promise.all([
      import('./ui/debugHud.js'), import('./debug.js'),
    ]);
    hud = createDebugHud(overlayHost);
    const { createGridOverlay } = await import('./render/gridOverlay.js');
    const gridOverlay = createGridOverlay(level, grid);
    world.adopt(gridOverlay);
    // G toggles the walkable/blocked overlay, L shows every nameplate (for
    // checking the label layout). Body classes let tests see the state.
    document.addEventListener('keydown', (event) => {
      if (event.ctrlKey || event.metaKey || event.altKey || overlayOpen()) return;
      if (event.key === 'g' || event.key === 'G') {
        gridOverlay.group.visible = !gridOverlay.group.visible;
        document.body.classList.toggle('is-grid-overlay', gridOverlay.group.visible);
      } else if (event.key === 'l' || event.key === 'L') {
        showAllNameplates = !showAllNameplates;
        document.body.classList.toggle('is-all-nameplates', showAllNameplates);
      }
    });
    installDebugApi({
      world, store,
      // The camera is fixed and overlays open at once; the only transition is
      // the door easter egg while it swings and holds open.
      transitionRunning: () => DOOR_TRANSITION_PHASES.has(world.doorPhase),
      onStateChanged: () => Object.values(panels).forEach((p) => p.isOpen && p.render()),
    });
  }
  // With debug=1 only: the door easter egg's phase, as a body attribute for
  // tests (the window.__game API itself stays fixed). Without debug=1 it does not exist.
  let doorPhase = null;
  // Talking range ends the conversation: walking away from the character
  // closes the dialogue.
  function closeDialogueOutOfRange() {
    if (!dialogue.isOpen) return;
    const place = world.places.get(dialogue.character.id);
    if (place && !inTalkRange(world.player.root.position, place)) dialogue.close({ byRange: true });
  }
  world.start((dt) => {
    closeDialogueOutOfRange();
    rehoverOnChange();
    updateHover();
    updateNameplates();
    if (!flags.debug) return;
    hud.update(dt, world.renderer.info);
    if (world.doorPhase !== doorPhase) {
      doorPhase = world.doorPhase;
      document.body.dataset.doorPhase = doorPhase ?? '';
    }
  });
  loading.progress(1);
  loading.hide();
  // After submitting, a reload opens the results view directly.
  // Otherwise the game starts with the instructions window.
  if (session.mode === 'session' && store.getState().submitted) results.open();
  else instructions.open();
  document.body.classList.add('is-ready');
}

boot().catch((err) => {
  console.error('EduTechReady failed to start', err);
  loading.fail();
});
