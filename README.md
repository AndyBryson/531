# Weights

A 5/3/1 (Wendler) training-max calculator, programme planner and workout log. One HTML file plus a web app manifest, service worker and icons; no build step, no dependencies at runtime.

Independent build — not affiliated with Jim Wendler or any 5/3/1 app.

**Live:** https://andybryson.github.io/531/

## Use it

Open `index.html` in a browser, or use the link above. The programme is saved in the browser along with your workout log (and in Google Drive once linked), so the address bar stays short. "Copy share link" copies a link with the programme in it; opening that link loads the programme.

For local development serve the folder (`python3 -m http.server 8000`) rather than opening the file, so IndexedDB and the service worker work.

## Features

- Plans are named by start date, `YYYY-MM-DD`, with an optional title ("2026-10-05 - Cycle 4"): a date picker and a title box at the top of the planner. Older names without a date get today's date and keep their text as the title.
- Training max from 1RM, direct TM entry, or a rep-set (Epley) input
- Templates: Standard, Boring But Big, First Set Last, Pyramid, 5's PRO, GVT, Triumvirate, 5/3/1 for Beginners, Standard + partner FSL
- Plate-loading calculator: treats each side of the bar as a stack (plates only come on and off at the outside), picks each set's plates and their loading order to minimise total plate moves across the session, lists plates innermost first, respects a limited per-side plate inventory, flags inexact loads as "closest available"
- Custom accessory exercises per lift, with optional weight and plate loading
- 4-day or 3-day/week scheduling with reorderable lift order
- Print layout: A4 landscape, one week per page, a day per column
- Workout log (Log tab): pick the date, week and day, then tap Start session. The pickers collapse into a line pinned to the top (lift, date, week, day) with Finish session in it; Change unlocks them, asking first if sets are logged. Sets are greyed out until a session is started, and a running session survives closing the app. The day's plan is a checklist. Per set: one tap ticks it as prescribed (keeping any reps you typed first), a reps field logs a different count (AMRAP sets go straight to reps), the weight is editable, and the ⋯ button adds a comment (on any set, logged or not, including added ones) or skips the set. Each block (main lift, FSL, every accessory, anything you added) ends with "+ set", which logs one more set copying the last one there, e.g. pull-ups split into 6 × 5 instead of 3 × 10; added sets stay editable. Log any other exercise with "Add set" (names autocomplete from the main lifts, your accessories and anything logged before). Suggests the next programme day after the last session.
- Replay (Replay tab): pick a plan (by name) and one of its weeks and see it in the planner layout, using the programme as it was when those sessions were logged, with what was done beside each planned set: done, changed (different weight or reps, with any comment), or missed. Sets added with "+ set" are listed under their block, and extra exercises under their day; days with nothing logged show the plan only. Screen only, no print layout.
- Saved on the device: the programme and logs are kept in the browser's IndexedDB, so the app opens with your programme from a plain URL. Share links (Copy share link) still work: opening one loads its programme. Browsers without IndexedDB keep the programme in the URL as before.
- Google Drive sync (Settings, Google Drive, Link to Google): the programme and every session are kept in a "531 Planner" folder in your Drive (`programme.json` and `sessions/<date>.json`), so the phone and laptop share them. The device's own copy stays the working copy: logging never waits for Drive, changes queue and sync shortly after, on Finish session, and when the app comes back into view. The status pill in the top bar shows Local only / Pending / Synced / Sync failed; tap it to sync (or to sign in again, about once an hour). Sessions edited on two devices are merged set by set. Opening a share link while linked asks before replacing the programme.
- Installable on a phone (Chrome: menu, Add to Home screen / Install app). Opens straight to the Log tab and works offline; a service worker keeps a copy of the app. The installed app asks the browser to keep its storage.
- Dev build at https://andybryson.github.io/531/dev/ (the `dev` branch), with its own storage and a DEV banner

### 5/3/1 for Beginners

Fixed 3-day split, independent of the days/week and lift-order settings:

- Day 1: Squat (full 5/3/1 wave) + Bench Press practice sets (fixed 3×5 @ 55/65/75% of Bench's own TM)
- Day 2: Deadlift and Overhead Press, both full waves
- Day 3: Bench Press (full wave) + Squat practice sets

### Standard + partner FSL

Uses the normal days/week and lift-order settings. Each day is its main lift's full wave, then sets of 5 on its partner lift (OHP↔Bench, Squat↔Deadlift) at the partner's first work-set percentage for that week (65/70/75% of the partner's TM). The number of FSL sets is set per lift (default 5, 0 turns it off). Skipped on the deload week. A second set of inputs adds optional own-lift FSL (default 0): sets of 5 of the day's own lift at the same percentage, straight after its main sets, also skipped on the deload week.

## Development

Tests run the page in [jsdom](https://github.com/jsdom/jsdom) and exercise it headlessly (no browser required):

```
npm install
npm test
```
