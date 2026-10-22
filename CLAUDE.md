# 531 Planner

5/3/1 training-max calculator and programme planner. Live at https://andybryson.github.io/531/ (GitHub Pages, served from `main` of `AndyBryson/531`). Owner: Andy, who uses it for his own training and prints each cycle to hang by the squat rack.

## Working rules

- Do not build or change anything until Andy says to. Propose first.
- UK English in UI text and docs ("programme", "colour"). Existing identifiers use `program` (`generateProgram`, `programTitle`); leave them alone unless renaming is the task.
- No em dashes in UI text, docs or commit messages.
- Update README.md features list when behaviour changes.
- Commit style: short imperative subject, body explaining what changed and why with concrete numbers where relevant. See `git log`.

## Architecture

- `index.html` is the whole app: markup, CSS and one IIFE script. No build step, no runtime dependencies, no framework. Google Fonts is the only external request.
- JS style is ES5: `var`, `function`, `"use strict"`, string-built HTML via `*HTML()` helpers, then `render()`. Match it.
- State: one `state` object (`defaultState()`), serialised as base64url JSON into the URL hash (`#s=...`) by `saveState()` with `history.replaceState`, debounced 250 ms. `loadState()` shallow-merges onto defaults so old links survive new fields. Any new state field needs a default and, if nested, a merge line in `loadState()`.
- No localStorage or backend today. The URL is the save file and the share link. Planned: IndexedDB plus Google Drive sync (see below).
- Flow: `generateProgram()` -> `scheduleForWeek()` -> `buildDay()` -> `renderOutput()`. Templates are in `TEMPLATES`; weekly percentages in `WEEK_SCHEMES`; template-specific sets in `assistanceForTemplate()` and `buildDay()`.
- Plate loading: `computeSessionPlates()` treats each side of the bar as a stack and picks combos to minimise plate moves across a session, respecting `state.plates` (count per side).
- Print: separate `<style id="printStyles" media="print">`. `fitPrintToPage()` on `beforeprint` scales `--ps` so each week fits one A4 landscape page. Check print after layout changes.
- Theming: CSS custom properties on `:root`, dark mode via `prefers-color-scheme` and `data-theme`.

## Tests

```
npm install
npm test
```

`test/dom-test.js` loads `index.html` in jsdom and drives it through DOM events. Output is `PASS`/`FAIL` lines; exit code is non-zero only on runtime errors, so read the output for FAILs. Add tests in the same style for new behaviour.

## Repo housekeeping

- `Claude outputs/` is untracked scratch from earlier sessions (a print-preview PDF and a patch). Not part of the app.

## Planned work

- Workout logging on the phone, programme planning on the laptop, both synced through Google Drive from the browser (no server). Design and open questions: `docs/logging-plan.md`.
