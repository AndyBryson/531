# Logging and Drive sync: progress log

Tracks the build of `docs/logging-plan.md`. Work happens on the `dev` branch; `main` is not touched. Build order agreed with Andy: steps 1, 2, 3, 5, then 4 (Google) last.

## Done

### Step 1: Pages via Actions, dev at /531/dev/
- `.github/workflows/pages.yml` checks out `main` and `dev`, copies `main` to the site root and `dev` to `/dev/` (skipping tests, docs, `.github`, package files), and deploys with `actions/deploy-pages`. Runs on push to `main` or `dev`, and by hand (`workflow_dispatch`).
- `IS_DEV` in `index.html`: true when the path contains `/dev/` or the host is `localhost`/`127.0.0.1`. Shows a DEV banner and prefixes the tab title with `[DEV]`.
- Tests: `test/logging-test.js` (new file; `npm test` runs both test files). It has a `load()` helper that opens the page in jsdom at any URL, with optional fake IndexedDB and fake Google.

### Step 2: IndexedDB store and logging view
- `openStore()` opens IndexedDB (`531-planner`, or `531-planner-dev` on dev) with stores `sessions` (keyPath `date`) and `meta`. Falls back to an in-memory store when IndexedDB is missing, so the page still works (tested).
- The programme is saved to `meta.programme` as `{state, modified}` whenever it changes (from the same debounced `saveState()`). On load: a share link's state wins; with no `s=` in the hash, the saved programme is loaded.
- Views Plan / Log / Replay via a top bar, kept in the hash as `v=log` / `v=replay` (so the installed app can start on `#v=log`).
- Log view: date, programme week and day pickers, then the day's sets from `daySections(day)`. Per set: tick, reps, weight, and a ⋯ menu with comment, skip, clear. "Add set" for ad hoc exercises. "Finish session" confirms (and will trigger a push in step 4).
- Session record: `{date, programme:{title, week, day, state}, entries:[...], updated, rev}`. Entries as in the plan. `rev` counts local writes for sync (step 4) and is not part of the Drive file.

## Next
- Step 3: replay view.

## Decisions the plan did not cover
- The workflow file lives on `dev` only until `dev` is merged into `main`. Until then a push to `main` does not redeploy; a push to `dev` (or running the workflow by hand on `dev`) republishes both. Merging dev into main fixes this.
- Each planned set's slot key (`planned.key`) is `main:<n>`, `light:<n>` or `acc:<exercise id>:<n>`, its position in the day's list. Changing the template mid-day can shift keys; accepted.
- The programme snapshot (`programme.state`) is refreshed on every write to that day's session, so it holds the plan as it stood at the last set logged.
- Programme day suggestion: a date with no session suggests the day after the most recent earlier session (rolling into the next included week), else week 1 day 1. Picking a week/day by hand overrides it.
- A comment can only be added to a set once it is logged (ticked or reps). The ⋯ menu also has Skip and Clear. Clearing or unticking leaves a tombstone (`deleted: true`).
- "Changed" marking: weight differs from the plan, or reps differ (for AMRAP only when fewer than prescribed; ranges like 10-15 never count as changed).
- Ad hoc exercise names are matched to an existing name ignoring case and spacing, and stored with that spelling. "Add set" logs one set and keeps the form filled for the next.
- Added `<meta charset="utf-8">`: without it, local servers that send no charset garble "×" and "✓".
- The `github-pages` environment only allowed `main` and `gh-pages` to deploy; `dev` was added as an allowed branch.
