# Workout logging and Google Drive sync

Status: not started. Design agreed with Andy on 22 Oct 2026. Items marked **Check** need confirming during implementation.

## What Andy wants

- Plan the programme on the laptop, log sessions on the phone (Android, Chrome) at the rack.
- Log each set as it is done. Log any exercise at any point, not only what the programme prescribes.
- No database to run. Free.
- A "Link to Google" button that sets everything up. Programme and logs are stored in Google Drive, so any device can load them. On linking, choose to load what is already in Drive or start from scratch.
- Replay past weeks: one sheet showing what was planned and what was done side by side.

## Decided

- Stay on GitHub Pages. No server. All Drive access is from the browser.
- Hosted dev version at `/531/dev/` with its own storage (see "Dev version and deployment").
- Logging a set has three levels: tick (done as prescribed), enter reps, or enter reps plus a comment. No RPE.
- No automatic training-max suggestion. Andy works out the next cycle's TM himself.
- Logging is a separate view from the planner. It shows that day's plan (warm-ups, work sets, template sets, accessories, in order) as the list to work through, with logging controls on each set.
- The replay view does not need to print.
- No GitHub-repo sync (rejected as clunky). No login of our own; Google sign-in is the only auth.
- Local-first: IndexedDB on each device is the working copy, so logging is instant and works with no signal. Drive is the shared store; sync pushes and pulls.
- Without linking, the site works as it does now (URL hash state) plus local-only logging.

## Google setup (one-off, by Andy)

1. Google Cloud project, Drive API enabled.
2. OAuth consent screen, user type External, publishing status Testing, Andy's Google account added as a test user. Testing is enough for a single user and avoids Google's verification. **Check** current Google rules when setting up.
3. OAuth client ID, type Web application. Authorised JavaScript origins: `https://andybryson.github.io` and a localhost origin for development. No client secret is used; the client ID is public and goes in the page.

## Auth

- Google Identity Services token model (`google.accounts.oauth2.initTokenClient`), loaded from `https://accounts.google.com/gsi/client`. This is the first external script; everything else stays inline.
- Scope: `https://www.googleapis.com/auth/drive.file`. The app can only see files it created, and those files are visible to Andy in Drive. (`drive.appdata` would hide them; rejected because he wants to see the files.)
- Access tokens last about an hour and there is no refresh token in the browser. When a token expires, call `requestAccessToken({prompt: ''})`; if Google still has a session this is a brief popup with no input. Never block logging on auth: queue writes and sync when a token is available.
- Store only the folder/file IDs and "linked" flag locally. Do not store tokens beyond the session.

## Drive layout

```
531 Planner/
  programme.json          current planner state (same shape as the URL-hash state)
  sessions/
    2026-10-22.json       one file per training day
```

- "Link to Google": sign in, then look for the `531 Planner` folder (search by name and `appProperties` tag). If found, offer **Load from Drive** or **Start from scratch** (scratch renames the old folder with a date suffix rather than deleting it). If not found, create it and upload the current state.
- Drive API calls via `fetch` against the REST endpoints (`files.list`, multipart `files.create`, `files.update` with `uploadType=media`). No `gapi` client library needed.

## Sync rules

- `programme.json`: last write wins, using the file's `modifiedTime`. On load, if Drive is newer than the local copy, take Drive's. Planning happens on the laptop, so real conflicts should be rare.
- Session files: merge by entry `id`. Union of both sides, newer `t` wins for the same id. Deleted entries keep a tombstone (`deleted: true`) so a merge does not bring them back.
- Push: debounced after each change, and on "Finish session". Pull: on page load and when the tab becomes visible.
- Show sync state: local only / synced / pending / failed (with retry).
- The URL-hash share link keeps working. Opening a share link while linked should ask before overwriting `programme.json`.

## Session data model (draft)

```json
{
  "date": "2026-10-22",
  "programme": { "title": "Cycle 4", "week": 2, "day": 1, "state": { } },
  "entries": [
    {
      "id": "uuid",
      "t": "2026-10-22T18:04:11Z",
      "exercise": "Squat",
      "weight": 120,
      "unit": "kg",
      "reps": 5,
      "status": "ticked",
      "planned": { "lift": "squat", "kind": "work", "set": 3, "reps": 5, "amrap": true, "weight": 120 },
      "note": ""
    },
    { "id": "uuid", "t": "...", "exercise": "Cossack squat", "weight": 24, "unit": "kg", "reps": 8, "planned": null }
  ]
}
```

- `exercise` is free text. Autocomplete from the four main lifts, the programme's accessories and everything previously logged; match ignoring case and extra spaces.
- `status`: `ticked` (done as planned, `reps` and `weight` copied from the plan), `reps` (reps entered), or `skipped`. `note` holds the optional comment.
- `planned` links a set to its programme slot; `null` for ad hoc work.
- `programme.state` snapshots the planner state used that day, so replay can show the plan as it was.
- `unit` per entry, since the planner supports kg and lbs.

## Replay view

- Pick a past week. Render it with the planner layout for the programme state snapshotted in that week's session files (`programme.state`), not the current one.
- Each planned set shows the logged result next to it: weight x reps done, AMRAP reps, missed or changed sets marked.
- Ad hoc exercises (`planned: null`) are listed under their day after the programme sets.
- Days with no session file show the plan only. Screen only; no print layout.

## Phone

- Make it an installable web app: `manifest.webmanifest` and a small service worker for offline loading. This adds two files alongside `index.html` (breaks single-file, still no build step). Call `navigator.storage.persist()` after install.
- Logging view must work one-handed at phone width. Per set: one tap ticks it as prescribed; a reps field logs a different count; an optional comment field opens from the same row. AMRAP sets go straight to the reps field. Weight is editable for when the load changed. "Add exercise" always available.

## Tests

- jsdom has no Google script or IndexedDB. Keep Drive and storage behind a small interface so tests can swap in fakes (`fake-indexeddb` is an option as a dev dependency). The site must load and work with the Google script blocked.

## Dev version and deployment

Production stays at `https://andybryson.github.io/531/` (from `main`) until the dev version is tested.

- **Local:** serve the folder on localhost (`python3 -m http.server 8000` or `npx serve`). Add the exact origin, including port, to the OAuth client's authorised origins. Service workers and Google sign-in both work on localhost.
- **Local on the phone:** USB debugging plus Chrome port forwarding (`chrome://inspect` on the laptop, forward port 8000), so the phone opens `http://localhost:8000`. Do not use the laptop's LAN IP: plain http on an IP is not a secure context, so the service worker fails, and Google will not accept it as an origin.
- **Hosted dev:** switch Pages to deploy from GitHub Actions. One workflow, run on push to `main` or `dev`, checks out both branches and publishes `main` at `/531/` and `dev` at `/531/dev/`. No app build step; the workflow only copies files. Same origin, so the same OAuth client covers both.
- **Keep dev data apart:** dev and prod share the `andybryson.github.io` origin, so they share IndexedDB and would share the Drive folder. Detect dev (path contains `/dev/` or host is `localhost`) and then use IndexedDB name `531-planner-dev`, Drive folder `531 Planner (dev)`, and show a visible DEV banner. Service worker scopes nest: prod's `/531/` scope also covers `/531/dev/`, so the prod worker must ignore any request under `/531/dev/` and let it fall through to the dev worker.
- Promote by merging `dev` into `main`.

## Suggested build order

Each step is usable on the dev site before the next starts.

1. Pages via GitHub Actions, `dev` branch at `/531/dev/`, dev detection and DEV banner. Prod unchanged.
2. IndexedDB store and the logging view: today's plan, tick / reps / reps + comment, add any exercise. Local only.
3. Replay view: planned vs done for a past week.
4. Link to Google: sign-in, folder create/load/start from scratch, sync of `programme.json` and session files.
5. Installable app: manifest, service worker (prod worker ignores `/531/dev/`), `navigator.storage.persist()`.

## Open questions

None at present.
