# Content guide

Everything the game shows comes from five JSON files in `public/content/`. You can change the text, the characters, the map and the furniture without touching JavaScript. After every change, run the validator (see the end of this guide).

| File | What it holds | Schema |
|---|---|---|
| `characters.json` | the player's look and the eight characters: place, look, portrait, dialogue, summary | `schema/characters.schema.json` |
| `ui.json` | every other Danish text: buttons, panels, messages, the results views, the facilitator page | `schema/ui.schema.json` |
| `instructions.json` | the instructions window shown at the start and from the Instruktioner button | `schema/instructions.schema.json` |
| `level.json` | the map, the player's start, furniture and props | `schema/level.schema.json` |
| `assets.json` | the 3D models: file, size, rotation, animation clips, footprint, source and licence | `schema/assets.schema.json` |

The schemas in `public/content/schema/` define the exact fields and allowed values of each file.

## Characters (`characters.json`)

```json
{
  "id": "mette",
  "name": "Mette (Underviser)",
  "model": "char_w1",
  "materialColors": { "Shirt": "#4a6a94", "Hair": "#5a3d2b" },
  "col": 3, "row": 7, "facing": "N", "pose": "sit",
  "portrait": "assets/portraits/mette.webp",
  "summary": "Kort opsummering, vist på resultatsiderne.",
  "greeting": "Det første, personen siger.",
  "maxQuestions": null,
  "questions": [
    { "id": "q1", "text": "Spørgsmålet, som parret kan stille", "answer": "Personens svar" }
  ]
}
```

- **Text to write**: `greeting` (shown when the dialogue opens), each question's `text` and `answer`, and `summary` (shown under the name on the results views, in the game and on the projector). Address the pair in the plural (I, jeres) where the character speaks to them.
- **`name`** is the name and the role together, `"Name (Role)"`. The label over the head, the dialogue and the results use the part before the brackets as the first name.
- **`questions`**: exactly three per character, in the order shown (numbered 1, 2, 3; the number keys pick them). The game works with any number, but `npm run validate` warns (it does not fail) when a character has fewer than three. An asked question stays marked and can be asked again; it shows its answer again. Question `id`s must be unique within the character (`q1`, `q2` …). Keep the ids when you rewrite the text: the pairs' "asked" marks are stored by id.
- **`maxQuestions`**: `null` lets the pair ask every question, and that is what every character uses. A number (at most the number of questions) would cap it; after that the rest are greyed out with `dialogue.capReached`. The cap is supported but unused.
- **`id`**: lowercase letters, digits and hyphens, unique. Submissions and results are stored by id, so never change an id or add or remove a character while a session is collecting answers. Pairs that sent nothing yet would get `finish.error.outdated`.
- **Place**: `col`, `row` is a tile (see the map below). `pose` is `stand` or `sit`. A standing character needs a walkable floor tile without furniture. A seated character's tile must be a chair or a sofa tile, and `facing` must match that seat's facing in `level.json`. Every character needs a walkable tile within 1.5 m that the player can reach; the validator checks this.
- **Look**: `model` is a character model from `assets.json` (`char_w1` to `char_w4`, `char_m1` to `char_m4`; the player uses `char_m4`). `materialColors` recolours materials by name; the material names per model are listed in `docs/ASSETS.md`, section 3. No two characters, the player or the alien may share both model and colours, so every figure can be told apart.
- **Portrait**: `assets/portraits/<name>.webp` (or `.png`). Square, head and shoulders with the face centred, at least 200 by 200 pixels; it is shown at 96 px in the dialogue and smaller in the panels and results. Put the file in `public/assets/portraits/` and change the `portrait` path. Lowercase file names without spaces. The current portraits (320 by 320 WebP) were cut from one illustrated sheet generated with Google Gemini. `tests/e2e/portrait.spec.mjs` samples Mette's and Jonas's shirt colours, so if you replace either of those two, update the two colours at the top of that test.
- **`player`**: the model and colours of the pair's own figure.

Writing text (greetings, questions, answers, summaries), adding or removing questions, setting `maxQuestions` and swapping a portrait are content changes: `npm run validate` checks them, and no test pins the wording (the e2e tests that show Mette's questions read them from `characters.json`). Moving, adding, removing or renaming a character is different: unit and e2e tests pin today's cast. See "Tests that pin the cast" below.

### Adding a character

1. Add an entry to `characters.json` with a new `id` (lowercase, unique), `"Name (Role)"`, a model and colours no one else has, a place, a portrait and the text (start with `[PLADSHOLDER]` texts if you like).
2. Pick the tile with the map below. A standing character blocks its tile, so do not stand in a one-tile gap (one who faces furniture on the next tile steps up to it, as Lars does at the counter, and blocks the furniture's tile instead, so its own tile stays free to stand on behind it; the step is a fixed 0.95 m, which only suits furniture pushed back against a wall, like the counters: in front of a table, a sofa or other free-standing furniture the character would stand inside it, so put such a character one tile further away, not facing the furniture, or check `STAND_CLOSER` in `public/js/lib/seating.js` first): the validator reports every walkable tile that can no longer be reached from `playerStart` (for example a character on (11, 9) cuts off (12, 9)).
3. Run `npm run validate` until it says "Content is valid".
4. Look at the game: the character should be visible from the fixed camera, not hidden by a tall wall.
5. Run `npm test` and `npx playwright test`. The failures you get now are the tests that pin the cast (next section), not content errors; update them to the new cast.
6. Do it before a session collects answers, never during one (see `id` above).

### Tests that pin the cast

The validator decides whether content is valid. The tests also check that the build matches today's cast, so they fail when the cast changes on purpose:

- **The number of characters (eight) and their ids, names and poses**: `tests/unit/characters.test.mjs` ("exactly the eight characters"), `tests/unit/talk.test.mjs` ("all eight characters"), and e2e tests that count tray entries, placements or results (`tests/e2e/placement`, `submission`, `results`).
- **Places**: `tests/unit/furniture.test.mjs` ("the character tiles work": Birgitte by the door, Henrik in the hallway, Lars at the coffee machine), `tests/unit/seating.test.mjs`, `tests/unit/characters.test.mjs` (men and women models, Henrik's look).
- **The id `henrik`** (and the other ids): see the next section.

Search the tests for the id (`grep -rn "lars" tests`) to find them.

### The hallway character (Henrik)

Henrik (Pædagogisk konsulent) stands at the east end of the hallway, on (8, 1), facing west. He is an ordinary entry in `characters.json`, so his name, look and dialogue change the same way as everyone else's.

- To give the hallway a different person, edit Henrik's entry: `name`, `model` and `materialColors` (keep the look distinct), `portrait` and the text. Keeping the `id` `henrik` keeps the tests and stored data working. A new id needs every test that names `henrik` updated: unit tests `characters.test.mjs`, `furniture.test.mjs`, `seating.test.mjs`, `session.test.mjs` and `validate_content.test.mjs`, and e2e tests `characters`, `scene-extras`, `dialogue`, `placement`, `submission` and `results` in `tests/e2e/` (`grep -rln henrik tests` lists them).
- To move him: the hallway is rows 1 and 2, cols 1 to 8 (the `h` tiles). Birgitte stands on (6, 2) by the open door. From the fixed camera, the kitchen's tall wall hides (8, 2) and the tiles near it; (8, 1) shows him from the knees up. Look at the game after moving him.
- He is part of Færdig like the others: pairs must talk to him and place him on both axes.

### The [PLADSHOLDER] workflow

`[PLADSHOLDER]` at the start of a text marks text that is not written yet. The game shows it as it is, so it is easy to spot.

1. Run `npm run validate`. The warning line counts the markers per character, for example `jonas 8`.
2. Search `characters.json` for `[PLADSHOLDER]`, write the real text and delete the marker. Keep the question ids.
3. Run `npm run validate` again until the count you are working on reaches 0. Placeholders are only a warning, so the game works while some remain.
4. `npm test` passes with or without placeholders; no test expects a text to be a placeholder or pins its wording.

The current text has no placeholders left.

## Interface texts (`ui.json`)

A flat list of keys and Danish strings, for example `"menu.finish": "Færdig"`.

- `{name}` in a text is filled in by the game (`"results.count": "{n} par har svaret"`). Keep every `{…}` that the old text had; braces are not allowed otherwise.
- Address the pairs in the plural (I, jeres). The facilitator page talks to one person and avoids "I".
- The SAMR band names, the Rogers category names, the `finish.missing.*` lines and the dialogue in `characters.json` (greetings, questions, answers, summaries) are read by the tests from the content files, so changing them breaks no test. Character names are pinned (see "Tests that pin the cast"). Other interface texts (buttons such as "Færdig" and "Send", dialog titles, notices, messages) are checked word for word by the e2e tests in `tests/e2e/`: when you change one, search `tests/e2e` for the old sentence and change it there too.
- Do not add or remove keys without changing the code: the validator fails when a key is missing or unused.
- The two loading and error lines in `index.html`, `results.html` and `facilitator.html` are copies for the moment before `ui.json` has loaded. If you change `app.loadError`, change the line in `index.html` too.

## The instructions window (`instructions.json`)

The game opens this window when it has loaded (not when a pair that has already sent its answers reloads: they get the results view), and the Instruktioner button in the menu opens it again.

```json
{
  "title": "Velkommen til lærerværelset",
  "intro": "One short paragraph under the title (optional).",
  "sections": [
    { "heading": "Jeres opgave", "items": ["One bullet point", "Another bullet point"] }
  ],
  "close": "Luk"
}
```

- **Fitting the window.** The window should not need scrolling in a 1280 x 600 browser window (what a 1280 x 720 laptop screen leaves once the browser's bars are drawn), so the text has a limit. Each string has a maximum length (title 45 characters, intro 240, heading 40, point 300, close button 20), there are at most 4 sections of at most 6 points, and `npm run validate` estimates the height of the whole text: every point and the intro take one line per 80 characters (rounded up), a heading 1.6 lines, and the limit is 22 lines. The current text uses about 18. When you go over, the validator says so; shorten or remove points. The estimate is on the safe side, and an e2e test checks that the longest texts it allows really fit. On a smaller window, or with browser zoom, the window still works: it opens scrolled to the top, and the page behind it scrolls down to the close button.
- The first task point says "alle otte personer". If you add or remove a character, change the number there too.
- The text names the SAMR levels and Rogers categories in plain words ("Substitution", "Innovatorer" …). If you rename them in `ui.json`, change them here too.
- The tests read the text from this file, so changing the wording breaks no test.

## The map (`level.json`)

`rows` draws the map from above, one string per row. Row 0 is north (the far side on screen), col 0 is west (the window side). Each character is one 1 m tile:

| Sign | Tile | Walkable |
|---|---|---|
| `#` | wall | no |
| `W` | window wall | no |
| `G` | glass wall | no |
| `D` | open door | yes |
| `d` | closed door (the alien easter egg) | no |
| `.` | lounge floor | yes |
| `h` | hallway floor | yes |
| `_` | nothing (no floor) | no |

- The legend itself is fixed. All rows must have the same length.
- **Cutaway rule**: a wall-type tile (`#`, `W`, `G`, `D`, `d`) is drawn full height (2.4 m) when the tile south of it, east of it or south-east of it is walkable. Otherwise it is drawn as a 0.3 m "near wall" so the camera can see in. That is why the east and south walls are low.
- `playerStart`: the tile and facing where the player begins. It must be walkable and free.

### Furniture and props

- **Furniture** (`furniture`): `{ "id": "table-1", "asset": "table_long", "col": 2, "row": 5, "facing": "S" }`. `col`, `row` is the north-west tile of the footprint after turning. The footprint (`w` along X, `d` along Z) comes from `assets.json`; facing E or W swaps them. Furniture blocks its tiles, must stand on floor tiles, must not overlap other furniture or `playerStart`, and every walkable tile must stay reachable from `playerStart` (a unit test, `tests/unit/furniture.test.mjs`, checks this). Chairs and the sofa are seats for seated characters.
- **Props** (`props`): decoration without a footprint, placed in metres: `{ "asset": "mug", "x": 9.58, "y": 0.81, "z": 4.02, "rotationDeg": 90 }`. `x` and `z` are world positions (tile (3, 5) runs from x 3 to 4 and z 5 to 6); `y` is the height of the surface it stands on (table top 0.755, counter about 0.8, coffee table 0.392; copy a neighbouring prop's `y`).
- Asset ids come from `assets.json`. `kind` must match: furniture for `furniture`, prop for `props`.

### Tests that pin the map

As with the cast, the validator decides whether `level.json` is valid, but some unit tests also pin today's layout, so a deliberate layout change can fail `npm test` on valid content. Update these tests along with the layout:

- `tests/unit/level.test.mjs`: the exact `rows` ("the starting map has the exact expected rows"), the size (14 by 12), `playerStart` (8, 7) facing N, the tile types at a few named tiles, and the wall height (full or near) of every wall tile plus their count ("every wall-type tile … has the expected height"). Any change to `rows` or `playerStart` fails here.
- `tests/unit/furniture.test.mjs`: at least 15 furniture items and 10 props; the assets `table_long`, `chair`, `sofa`, `coffee_table`, `counter_drawers`, `counter_sink`, `counter_cabinet`, `fridge`, `drawer_cabinet` and `plant_1` to `plant_3` must all be placed; every prop must stand over the long table, the coffee table or one of the three counters (a counter prop may be one row north of the counter's tile, on the part pushed back to the wall) at that surface's height; Lars's coffee machine must be on his column, north of him, with the counter front 0.30 to 0.45 m from him; tile (5, 2), next to the open door, must stay walkable.
- `tests/unit/talk.test.mjs`: the talk-tile sweep starts from `playerStart`, (1, 1), (11, 10) and (1, 9), so those tiles must stay walkable and reachable.
- `tests/unit/clickTarget.test.mjs`: (2, 9) and (9, 6) must be walkable; Karim's chair blocks his tile with (6, 6) free behind it, and a click at (5.85, 6.5) must go to (6, 6); Lars's tile (9, 5) must be free and walkable behind him.
- `tests/unit/seating.test.mjs`: Mette, Jonas and Karim sit on chairs and Anne and Sofie on the sofa, there is exactly one `table_long`, and each character stays in its intended area.
- The e2e tests in `tests/e2e/` click named tiles (`tileToScreen(col, row)`), so a moved wall or piece of furniture can break them too: `grep -rn tileToScreen tests/e2e` lists them.

## Models (`assets.json`)

Each model has its `file` (a GLB in `public/assets/models/`), `kind` (`character`, `furniture` or `prop`), `scale`, `rotationOffsetDeg`, `source` and `licence`. Characters also have `clips` (`idle`, `walk`, `sit`; `sit` may be `null`, then the character cannot sit); furniture has `footprint`. `docs/ASSETS.md` lists every model with its clips, materials and size. Adding a model is a developer task: see `scripts/convert_assets.sh` and `docs/ASSETS.md`.

## The alien easter egg

Clicking the closed door (`d`) at the west end of the hallway walks the player there; the door swings open on a dark closet with a friendly neon-green alien, holds for a moment and closes. It happens once per page load. The alien is not a character: it is not in `characters.json`, cannot be talked to and is not placed.

- **Code**: `public/js/render/alienDoor.js` (the closet, the alien, the door swing). `public/js/render/world.js` creates it for the first closed door in the map. The door panel is built in `public/js/render/room.js`.
- **Look**: `THEME.alien` in `public/js/render/theme.js` (`model` and `materialColors`; the validator checks it does not look like a character).
- **Turn it off**: set `enabled: false` in `THEME.alien`. The door then stays shut, and a click on it just walks the player to the nearest tile. The e2e test `tests/e2e/scene-extras.spec.mjs` ("door easter egg") expects the alien, so skip or remove that test as well. Replacing the `d` in `level.json` with `#` also removes it (and the door).

## Running the validator

```
npm run validate
```

It checks, and names the file and entry for every problem:

1. Each file against its schema in `public/content/schema/` (required fields, types, allowed values, no unknown fields). Before that, no key may occur twice in the same object: JSON keeps only the last copy without a word, so a key pasted twice into `ui.json`, or a model id twice in `assets.json`, is reported with its line number.
2. Cross-references: assets exist and have the right kind, model files and portraits exist on disk, every clip a character model names in `assets.json` is an animation in its GLB (`idle` and `walk` are required; `sit` may be `null`), furniture fits the map, characters stand on walkable tiles or sit on a matching chair or sofa, ids are unique, every walkable tile can still be reached from `playerStart` with the furniture and characters in place, every character can be reached for a talk, colour names exist in the model, no two figures look the same.
3. `ui.json` keys: every key the code uses exists, and every key is used. Keys the code builds at run time (`finish.missing.${reason}`, `results.axis.${axis}`) are declared with their possible values in `DYNAMIC_KEYS` at the top of `scripts/validate_content.mjs`; a new run-time key fails until it is declared there. A key glued together with `+` (`t('notice.' + reason)`) or a key prefix kept in a variable (`'notice.'`) fails too, with a request to write it as a declared template literal. Every literal written inside the first argument of `t(…)` (the lookup every text goes through) must be a key, whatever its first part: `t('nyt.navn')` fails until `nyt.navn` is in `ui.json`, and so does `t(['menu', x].join('.'))`, because `'menu'` is not a key. Limit: when `t()` gets a variable and the key in it was never written as text in `public/js` (read from a JSON file, joined from parts that are not literals, or a new first part such as `'nyt.navn'` kept in a variable outside the `t()` call), the check cannot see it; the code has none of these. In the game such a key shows as the raw key on screen, with a warning in the browser console.
4. No Danish or other user-facing text written directly in `public/js` (all interface text lives in `ui.json`; debug-only files and developer messages in `console` and `Error` calls are exempt). This is a heuristic: it flags text with æ, ø or å, a capitalised word followed by another word, or a run of lowercase words. Limit: a single word without æ, ø or å (`'Luk'`), or two lowercase words without end punctuation (`'luk dialogen'`), gets through, because such strings cannot be told apart from class names and ids. Code review has to catch those.
5. `instructions.json` is short enough for its window: the estimated height is at most 22 lines (see "The instructions window").

It ends with "Content is valid" (exit code 0) or lists the errors (exit code 1). The `[PLADSHOLDER]` count is a warning only, and so is a character with fewer than three questions (every character should have exactly three). `npm test` runs the same checks, so a broken content file also fails the unit tests. The reverse does not hold: when you change the cast, `npm test` can fail on valid content (see "Tests that pin the cast"). Changes to the dialogue never fail `npm test`; character names are pinned by `tests/unit/characters.test.mjs`, and some interface texts in `ui.json` are pinned by the e2e tests (see "Interface texts").
