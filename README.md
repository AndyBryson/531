# Weights

A 5/3/1 (Wendler) training-max calculator, programme planner and workout log. One HTML file plus a web app manifest, service worker and icons; no build step, no dependencies at runtime.

Independent build — not affiliated with Jim Wendler or any 5/3/1 app.

**Live:** https://andybryson.github.io/531/

## Use it

Open `index.html` in a browser, or use the link above. The programme is saved in the browser along with your workout log (and in Google Drive once linked), so the address bar stays short. "Copy share link" copies a link with the programme in it; opening that link adds the plan to your list (asking first if it would replace one of the same name).

For local development serve the folder (`python3 -m http.server 8000`) rather than opening the file, so IndexedDB and the service worker work.

## Features

- Several plans side by side: plan the next cycle while running this one. The plan picker at the top of the planner lists every plan (old ones are kept); New plan copies the open plan, dated the day after it ends. The Log tab uses the plan in effect on the session's date (the newest whose start date has arrived), with a dropdown to pick another when starting a session early.
- Plans are named by start date, `YYYY-MM-DD`, with an optional title ("2026-10-05 - Cycle 4"): a date picker and a title box at the top of the planner. Older names without a date get today's date and keep their text as the title.
- Training max from 1RM, direct TM entry, or a rep-set (Epley) input
- Templates: Standard, Boring But Big, First Set Last, Pyramid, 5's PRO, GVT, Triumvirate, 5/3/1 for Beginners, Standard + partner FSL
- Plate-loading calculator: treats each side of the bar as a stack (plates only come on and off at the outside), picks each set's plates and their loading order to minimise total plate moves across the session, lists plates innermost first, respects a limited per-side plate inventory, flags inexact loads as "closest available"
- Custom accessory exercises per lift, each done with a chosen kit: bodyweight, barbell, landmine, dip belt, kettlebell, dumbbell, band or assisted. Barbell accessories share the main lift's plate loading. Landmine and dip-belt weights are the plates on one sleeve or chain, with no bar weight, so 20 kg loads a 20 plate. Kettlebell and dumbbell weights show as typed (dumbbells per hand). Bands show the range printed on them, and assisted exercises show the helping band ("15-35 kg band, assisted"). Each accessory carries a short kit label (LM, Belt, KB, DB, Band, Asst) in the plan, print, log and replay
- 4-day or 3-day/week scheduling with reorderable lift order
- Print layout: A4 landscape, one week per page, a day per column
- Workout log (Log tab): pick the date, week and day, then tap Start session. The pickers collapse into a line pinned to the top (lift, date, week, day) with Finish session in it; Change unlocks them, asking first if sets are logged. Sets are greyed out until a session is started, and a running session survives closing the app. The day's plan is a checklist. Per set: one tap ticks it as prescribed (keeping any reps you typed first), a reps field logs a different count (AMRAP sets go straight to reps), the weight is editable, and the ⋯ button adds a comment (on any set, logged or not, including added ones) or skips the set. Each block (main lift, FSL, every accessory, anything you added) ends with "+ set", which logs one more set copying the last one there, e.g. pull-ups split into 6 × 5 instead of 3 × 10; added sets stay editable. Log any other exercise with "Add set" (names autocomplete from the main lifts, your accessories and anything logged before). Every set logged on the date is listed: sets with no planned row are grouped by exercise name in the order logged, and sets logged against another programme day that date are listed under "Also on this date". Past dates are shown with the plan saved with that session ("As logged" in the plan picker). Suggests the next programme day after the last session.
- Keep screen on (Log tab): a switch that stops the phone locking between sets, using the Screen Wake Lock API. Remembered per device, taken again when you come back to the app, let go when you leave the Log tab. Hidden in browsers without the API.
- Replay (Replay tab): pick a plan (by name) and one of its weeks and see it in the planner layout, days in the order you did them, using the programme as it was when those sessions were logged, with what was done beside each planned set: done, changed (different weight or reps, with any comment), or missed. Sets added with "+ set" are listed under their block, and any other exercise under its day by name; days with nothing logged show the plan only. Screen only, no print layout.
- Progress (Progress tab): one chart of your logged sets over time, to see whether you are getting stronger. Est. 1RM (Epley, the best set in each group), Heaviest for N reps (the heaviest weight you actually lifted for N or more reps; pick N) or Reps for bodyweight and assisted work (best set, or best one-day total). Points per session, week (Monday to Sunday) or plan, over all time or the last 12 weeks, 6 months or year. Pick the exercises with chips; main lifts and accessories both. Kit decides what each can show: dip-belt work has no e1RM (the app does not know your bodyweight), and assisted work gets a separate dashed line per band. On the session and week views the dates along the bottom fall at even calendar steps (months over a long range, weeks over a short one) with the year shown where it changes, and a dotted line marks each new year. Tap a point to see the set it came from. Settings are remembered per device.
- Import sessions (Progress tab): bring in workouts recorded elsewhere, such as Garmin Connect, from a JSON file (`{"sessions":[{"date":"2025-03-03","sets":[{"exercise":"Squat","weight":110,"unit":"kg","reps":5,"warmup":false}]}]}`). It says how many dates are new, imported before (replaced) or already logged in the app (never touched) before adding anything. Imported sessions sync like any other, go on the Progress chart, and show in Replay under "Garmin history" as a list by month: a row per session with its heaviest sets, opening to every set. Logging a set in the app on an imported date makes that date the app's, so a later import skips it.
- Saved on the device: the programme and logs are kept in the browser's IndexedDB, so the app opens with your programme from a plain URL. Share links (Copy share link) still work: opening one loads its programme. Browsers without IndexedDB keep the programme in the URL as before.
- Google Drive sync (Settings, Google Drive, Link to Google): every plan and every session are kept in a "531 Planner" folder in your Drive (`plans/<plan name>.json` and `sessions/<date>.json`), so the phone and laptop share them. The device's own copy stays the working copy: logging never waits for Drive, changes queue and sync shortly after, on Finish session, and when the app comes back into view. The status pill in the top bar shows Local only / Pending / Synced / Sync failed; tap it to sync (or to sign in again, about once an hour). Sessions edited on two devices are merged set by set. Opening a share link adds its plan, or asks before replacing the plan with the same name.
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
