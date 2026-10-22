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

### Step 3: replay view
- Replay tab: a select of calendar weeks (Monday to Sunday) that have logged sets, newest first. Each programme week found in that calendar week is drawn from the latest session's `programme.state` snapshot via `withState()`, which swaps the global `state` while the planner's own generation code runs.
- Each planned set shows its result: done (green), changed (amber, different weight or reps), missed or skipped (red). Comments show under the set. Ad hoc work is listed under its day as "<name> (extra)". Days with no session show the plan only, dimmed. Sessions for a day that no longer exists in the snapshot are listed as plain cards.

### Step 5: installable app
- `manifest.webmanifest` (prod) and `manifest-dev.webmanifest` (dev: "531 DEV", red icon). The page links the prod one; on dev, JS swaps the link, icon and theme colour. `start_url` is `./#v=log`, so the installed app opens on the Log tab.
- `icons/`: 192 and 512 PNGs (barbell, full-bleed so they work as maskable), prod and dev colours. Drawn by a throwaway Python script; plain PNGs, no source to maintain.
- `sw.js`: registered as `sw.js` from the page, so scope is the page's folder. Page requests are network first with a 3 s fallback to the cached copy; icons, manifests and Google Fonts are cache first, refreshed in the background. Ignores anything under `<scope>dev/` (prod worker vs dev site), non-GET, and other origins except Google Fonts. Cache names include the scope so prod and dev do not share.
- `navigator.storage.persist()` on `appinstalled` and when opened in standalone mode.
- Checked in headless Chrome on localhost: worker installs and controls the page, shell cached, and an offline reload still renders the Log view. (The in-app preview browser cannot register service workers, so it was not used for this.)

### Step 4: Google link and Drive sync (everything except real credentials)
- `GOOGLE_CLIENT_ID` in `index.html`, in a marked block at the top of the "Google Drive sync" section. Empty means sync is off: the Link button is disabled and says why.
- `googleAuth()`: loads `https://accounts.google.com/gsi/client` on demand (only when linking, or on load once linked), token model with scope `drive.file`, `requestAccessToken({prompt: ""})`.
- `driveRest()`: Drive v3 via `fetch` (find folder by name + `appProperties.app` tag, create folder, rename, list children, read with `alt=media`, multipart create, `uploadType=media` update).
- Link flow in Settings > Google Drive: sign in, look for the tagged folder. Not found: create `531 Planner/` + `sessions/`, upload programme and all local sessions. Found: offer Load from Drive (take Drive's programme, merge sessions) or Start from scratch (rename old folder to `531 Planner (old YYYY-MM-DD)`, untag it, create a fresh one from this device). Unlink forgets the link and keeps local data.
- Sync rules as planned: programme last write wins on `modifiedTime`; sessions merged by entry id, newer `t` wins, tombstones kept. Push debounced 2 s after a change and straight away on Finish session; pull on load and on `visibilitychange` to visible. Pill: Local only / Tap to sync / Pending / Syncing / Synced / Sync failed, retry.
- Share link while linked: `confirm()` before replacing the programme (on load and on `hashchange`).
- Tests: `FakeDrive` + fake auth (two devices sharing one Drive: link, load, merge, tombstones, last write wins, failure and retry, start from scratch, share-link prompt, dev folder), the real REST client against a fake `fetch`, and the real GIS wrapper against a fake `google.accounts.oauth2` with a test client ID.

### Client ID set
- Google Cloud project `planner-512420` set up by Andy (Drive API, External/Testing, agbryson@gmail.com as test user, `drive.file`, Web client "531 Planner web" with origins `https://andybryson.github.io` and `http://localhost:8000`). `GOOGLE_CLIENT_ID` now holds its client ID. No client secret is used or stored.
- Tests no longer depend on the real ID: they set their own via `withClientId()` (empty for the "sync off" checks, a test ID for the GIS checks).

### Programme out of the URL (Andy's follow-up)
- The address bar no longer carries the programme: `saveState()` writes only `v=` (or nothing) once the store has loaded. The programme lives in IndexedDB and, when linked, Drive's `programme.json`.
- "Copy share link" (next to Copy program) builds `#s=` on demand. Opening one imports it, then the hash is cleared.
- With the memory fallback (no IndexedDB) the URL still holds `s=`, so nothing is lost on reload there.
- Kept to one programme at a time, as before. A library of past programmes was not built; replay already keeps each week's programme snapshot.

- The service worker fetches the page with `cache: "no-cache"`: GitHub Pages sends `max-age=600`, so a plain network-first fetch could serve a page up to 10 minutes old after a deploy (seen in Chrome on 22 Oct).
- Set up in Andy's Chrome on 22 Oct: the "2026-10-05" programme (partner FSL) is in the dev Drive folder `531 Planner (dev)`. An earlier test folder with only defaults was renamed `531 Planner (dev) (old 2026-10-22)` by Start from scratch.

### "+ set" on every block (Andy's request, 22 Oct)
- Every section in the Log tab (main lift, light/FSL block, each accessory, each ad hoc exercise) ends with a "+ set" button. It logs one more set copying the last non-skipped set logged in that block, or the block's last planned set when nothing is logged yet.
- Added sets are entries with `planned: {key: "<section>:extra", kind: "extra", ...}` (sections are `main`, `light`, `acc:<exercise id>`); on ad hoc blocks they are plain `planned: null` entries of that exercise. Weight and reps stay editable in place; × removes (tombstone).
- Replay lists added sets under their block as "added set" with the result. No volume-based judging: Andy only wants planned vs done side by side.

### Comments on every set (22 Oct)
- The ⋯ comment field now shows on every planned set, logged or not, and on skipped sets; added sets get their own ⋯ for a comment. A comment typed before the set is logged is held (in memory, not saved) and attached when the set is ticked, given reps or skipped.
- Replaces the earlier rule that a comment could only be added once a set was logged.

## Next
- Real-device checks (sign-in popup in the installed app, sync between phone and laptop), and merging `dev` into `main` when happy.

## Google Cloud setup (for Andy)
1. https://console.cloud.google.com: create a project, e.g. "531 Planner".
2. APIs & Services > Library: enable **Google Drive API**.
3. Google Auth Platform (APIs & Services > OAuth consent screen) > Get started: app name "531 Planner", support email, audience **External**, contact email, agree.
4. Audience: leave publishing status on **Testing**; under Test users add your Google account.
5. Data Access > Add or remove scopes: add `https://www.googleapis.com/auth/drive.file`. Save.
6. Clients > Create client: type **Web application**. Authorised JavaScript origins: `https://andybryson.github.io` and `http://localhost:8000`. No redirect URIs. Create, copy the client ID (ends `.apps.googleusercontent.com`).
7. Set `GOOGLE_CLIENT_ID` in `index.html` to it (on `dev`), commit, push. In Testing mode Google shows an "unverified app" warning at first sign-in; continue past it.

## Decisions the plan did not cover
- The workflow file lives on `dev` only until `dev` is merged into `main`. Until then a push to `main` does not redeploy; a push to `dev` (or running the workflow by hand on `dev`) republishes both. Merging dev into main fixes this.
- Each planned set's slot key (`planned.key`) is `main:<n>`, `light:<n>` or `acc:<exercise id>:<n>`, its position in the day's list. Changing the template mid-day can shift keys; accepted.
- The programme snapshot (`programme.state`) is refreshed on every write to that day's session, so it holds the plan as it stood at the last set logged.
- Programme day suggestion: a date with no session suggests the day after the most recent earlier session (rolling into the next included week), else week 1 day 1. Picking a week/day by hand overrides it.
- (Superseded 22 Oct: comments now work on any set.) The ⋯ menu also has Skip and Clear. Clearing or unticking leaves a tombstone (`deleted: true`).
- "Changed" marking: weight differs from the plan, or reps differ (for AMRAP only when fewer than prescribed; ranges like 10-15 never count as changed).
- Ad hoc exercise names are matched to an existing name ignoring case and spacing, and stored with that spelling. "Add set" logs one set and keeps the form filled for the next.
- Replay groups by calendar week (Monday start), since a programme week number repeats every cycle. A calendar week normally holds one programme week; if it holds more, each is drawn in turn.
- In replay, a day with a session but no entry for a planned set shows it as missed (warm-ups included).
- Sign-in needs a tap. Popups opened without a user gesture are blocked, so on load with no token the app does not try; the pill says "Tap to sync" and a tap signs in (a brief popup when Google still has a session) and syncs. Finish session and Sync now also count as taps. Logging is never blocked.
- The access token is kept in `sessionStorage` (this tab only, cleared when it closes) with its expiry, so a reload within the hour does not need another tap. Nothing else about auth is stored. This is the one use of Web Storage.
- "Start from scratch" means Drive starts from this device's programme and logs; it does not wipe the device.
- "Load from Drive" replaces the device's programme with Drive's and merges sessions (local logs are kept, not discarded).
- The programme is saved to IndexedDB as soon as the store opens on a fresh device (not after the 250 ms debounce), so a quick first link does not upload it twice.
- `programme.json` is the merged planner state as stored (`mergeState` output), the same shape as the share-link state.
- Added `<meta charset="utf-8">`: without it, local servers that send no charset garble "×" and "✓".
- The `github-pages` environment only allowed `main` and `gh-pages` to deploy; `dev` was added as an allowed branch.
