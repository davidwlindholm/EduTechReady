# Translating the game

The game is in Danish. This guide lists everything that has to change for a full version in another language. The project itself does not ship a full translation; it offers English versions of the dialogue and the instructions as a starting point.

## Already available in English

- `translations/en/characters.json`: the eight characters' names, roles, greetings, questions, answers and summaries.
- `translations/en/instructions.json`: the instructions window.

Both are drop-in replacements for the files of the same name in `public/content/`. Everything apart from the text (ids, models, colours, tiles, poses, portraits) is the same as in the Danish files. On their own they give a game with English dialogue and a Danish interface; for a full English version, translate `ui.json` and the HTML pages as well (below).

The English instructions call the buttons Done, Goodbye and Instructions. With the Danish `ui.json` they are still labelled Færdig, Farvel and Instruktioner, so translate at least `menu.finish`, `dialogue.farewell` and `menu.instructions` as well, or put the Danish names back into the English instructions.

## What to translate

### Content files (`public/content/`)

- **`ui.json`**: every other text, 123 keys: the menu, the dialogue window, the SAMR and Rogers panels, the Færdig dialog and its error messages, the in-game results view, the projector page (`results.page.*`) and the facilitator page (`facilitator.*`).
  - Translate only the values. Keep every key, and keep every `{placeholder}` with its exact name (`{name}`, `{n}`, `{code}` …): the code fills them in by name, and the validator does not check the names.
  - The SAMR band names (`samr.band.0` to `3`) and Rogers category names (`rogers.category.0` to `4`) are shown in the panels, the charts and the screen reader texts.
  - The pairs are addressed in the plural; the facilitator page talks to one person.
- **`characters.json`**: `name`, `summary`, `greeting`, and each question's `text` and `answer`. Keep `name` in the form `Name (Role)`: the game splits it into name and role for the name plates, the pins on the axes and the Færdig list.
- **`instructions.json`**: `title`, `intro`, `heading`s, `items` and `close`. The text names interface elements (the Færdig and Instruktioner buttons, Farvel, SAMR, Rogers) and the SAMR and Rogers names; keep them the same as in `ui.json`. The first task point gives the number of characters ("alle otte personer").

### HTML pages (`public/`)

`index.html`, `results.html` and `facilitator.html` each have:

- `<html lang="da">`: change to the new language code (screen readers use it to pick a voice).
- `<title>`: shown until the script sets the title from `ui.json` (`app.title`, `results.page.title`, `facilitator.title`).
- A loading line ("Indlæser …") and an error line: copies for the moment before `ui.json` has loaded, or when it cannot load. The error line in `index.html` is the same text as `app.loadError`.

### Number, list and time formats (`public/js/ui/`)

The game formats numbers with the Danish locale, `'da-DK'`. Change the locale string in these places:

- `placement.js`: `SHARE_FORMAT`, the Rogers shares in the panel ("2,5").
- `results.js`: `SHARE_FORMAT` (Rogers shares in the charts), `VALUE_FORMAT` (placements and the middle half in the screen reader texts), `LIST_FORMAT` ("a, b og c") and `TIME_FORMAT` (the time in `results.updated`, "kl. 14.05.03" in Danish).

The text around the numbers lives in `ui.json`: `rogers.share` is `"{share} %"` (Danish puts a space before the per cent sign; English does not), and `results.updated` is `"Senest opdateret kl. {time}"`. There are no other locale codes in `public/js`, and no text drawn on canvas: the chart labels in the SVGs come from `ui.json`.

## What does not need translating

- **The PHP API** (`public/api/`): it returns JSON with error codes only (`invalid_session`, `already_submitted`, `closed` …); the game turns them into the `finish.error.*` texts. It reads only the character ids from `characters.json`.
- **Ids and file names**: character ids, question ids, `ui.json` keys, asset ids and file names stay as they are. Keep the character ids in particular: the server checks submitted answers against them.
- **Portraits and 3D models**: they contain no text.
- **Code comments and the documentation** in `docs/` are already in English.

## Checking the result

```
npm run validate
npm test
npm run e2e
```

- `npm run validate` checks every content file against its schema in `public/content/schema/`, that `ui.json` has every key the code uses and no unused ones, that placeholders are well-formed, and that `instructions.json` fits its window (each string has a maximum length, and the estimated height may be at most 22 lines; see `docs/CONTENT.md`). It does not check that placeholder names are kept.
- The tests read the dialogue texts, summaries, instructions, the SAMR and Rogers names and the `finish.missing.*` lines from the content files, so translating those breaks no test.
- Character names, and many interface texts, are pinned word for word:
  - Names with roles ("Mette (Underviser)" …): `tests/unit/characters.test.mjs` ("exactly the eight characters") and the e2e tests `core-loop`, `loading-and-settings`, `results`, `scene-extras` and `submission`.
  - Button, dialog and menu names and other interface texts ("Færdig", "Færdig?", "Send", "Luk", "Farvel", "Spilmenu", "Resultater", "Gem som PDF", "Forbedring" …): `tests/e2e/core-loop`, `dialogue`, `placement`, `results`, `submission` and `walking` (all `.spec.mjs`).
  - Danish number formats ("2,5 %", "29,5"): `tests/e2e/placement.spec.mjs`, `tests/e2e/results.spec.mjs` and `tests/unit/resultsLabel.test.mjs`. They change when you change the `'da-DK'` locale (step 5 below).
  - To update them, search the tests for each old text, for example `grep -rn "Færdig" tests`.

## Step by step

1. Copy `translations/en/characters.json` and `translations/en/instructions.json` over the files in `public/content/`, or translate the Danish files into your own language.
2. Translate the values in `public/content/ui.json`. Keep the keys and the `{placeholders}`.
3. Make the button and scale names in `instructions.json` match `ui.json`.
4. In `public/index.html`, `results.html` and `facilitator.html`, change `lang`, the `<title>` and the loading and error lines.
5. Change `'da-DK'` in `public/js/ui/placement.js` and `public/js/ui/results.js`, and adjust `rogers.share` and `results.updated` in `ui.json` to match.
6. Run `npm run validate`, then update the pinned texts in the tests and run `npm test` and `npm run e2e`.
7. Play through once: talk to a character, place everyone on both scales, send, and open the facilitator and projector pages.
