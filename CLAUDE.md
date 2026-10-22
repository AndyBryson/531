# 531 Planner

5/3/1 training-max calculator and programme planner. Live at https://andybryson.github.io/531/ (GitHub Pages, served from `main` of `AndyBryson/531`). Owner: Andy, who uses it for his own training and prints each cycle to hang by the squat rack.

## Working rules

- Do not build or change anything until Andy says to. Propose first.
- UK English in UI text and docs ("programme", "colour"). Existing identifiers use `program` (`generateProgram`, `programTitle`); leave them alone unless renaming is the task.
- No em dashes in UI text, docs or commit messages.
- Update README.md features list when behaviour changes.
- Commit style: short imperative subject, body explaining what changed and why with concrete numbers where relevant. See `git log`.

## Architecture

- `index.html` is the whole app: markup, CSS and one IIFE script. No build step, no runtime dependencies, no framework. Alongside it: `sw.js` (service worker, offline copy), `manifest.webmanifest` / `manifest-dev.webmanifest` and `icons/`. Google Fonts is the only external request until Drive sync is linked.
- JS style is ES5: `var`, `function`, `"use strict"`, string-built HTML via `*HTML()` helpers, then `render()`. Match it.
- State: one `state` object (`defaultState()`), saved by `saveState()` (debounced 250 ms) to IndexedDB. The URL hash holds only the view (`#v=log`); the programme goes in the hash (`#s=<base64url JSON>`) only for share links ("Copy share link") and when IndexedDB is missing. An incoming `#s=` is imported on load or `hashchange`. `loadState()` shallow-merges onto defaults so old links survive new fields. Any new state field needs a default and, if nested, a merge line in `loadState()`.
- Persistence: IndexedDB (`openStore()`, memory fallback) holds the programme (`meta` key `programme`) and one session record per date (`sessions` store). A share link's `#s=` wins over the stored programme on load (with a confirm when linked to Drive). Dev (`IS_DEV`: path has `/dev/` or localhost) uses database `531-planner-dev`.
- Plan name: `state.programTitle` is always `YYYY-MM-DD` or `YYYY-MM-DD - title` (`splitPlanName()` / `joinPlanName()`, normalised in `mergeState()`). The header edits date and title separately; print shows `#printTitle`.
- Views: Plan / Log / Replay, chosen by `v=` in the hash (`setView()`). The logging view builds its rows from `daySections()`, whose slot keys tie logged entries to planned sets.
- Drive sync: `GOOGLE_CLIENT_ID` constant (empty = off), `googleAuth()` (GIS token model, script loaded on demand, token in sessionStorage only), `driveRest()` (Drive v3 over fetch, `drive.file` scope), `syncNow()` / `syncProgramme()` / `syncSessions()`. Link state is `meta` key `link`. Dev uses folder `531 Planner (dev)`.
- Pages deploys from `.github/workflows/pages.yml`: `main` at `/531/`, `dev` at `/531/dev/`.
- Flow: `generateProgram()` -> `scheduleForWeek()` -> `buildDay()` -> `renderOutput()`. Templates are in `TEMPLATES`; weekly percentages in `WEEK_SCHEMES`; template-specific sets in `assistanceForTemplate()` and `buildDay()`.
- Plate loading: `computeSessionPlates()` treats each side of the bar as a stack and picks combos to minimise plate moves across a session, respecting `state.plates` (count per side).
- Print: separate `<style id="printStyles" media="print">`. `fitPrintToPage()` on `beforeprint` scales `--ps` so each week fits one A4 landscape page. Check print after layout changes.
- Theming: CSS custom properties on `:root`, dark mode via `prefers-color-scheme` and `data-theme`.

## Tests

```
npm install
npm test
```

`test/dom-test.js` loads `index.html` in jsdom and drives it through DOM events. `test/logging-test.js` covers logging, replay, install and sync, using `fake-indexeddb` and fakes passed in via `window.PLANNER_FAKES`. Output is `PASS`/`FAIL` lines; exit code is non-zero only on runtime errors, so read the output for FAILs. Add tests in the same style for new behaviour.

## Repo housekeeping

- `Claude outputs/` is untracked scratch from earlier sessions (a print-preview PDF and a patch). Not part of the app.

## Planned work

- Workout logging on the phone, programme planning on the laptop, both synced through Google Drive from the browser (no server). Design: `docs/logging-plan.md`. Build status: `docs/logging-progress.md`.
