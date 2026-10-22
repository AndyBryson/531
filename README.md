# Weights

A 5/3/1 (Wendler) training-max calculator. Single self-contained HTML file, no build step, no dependencies at runtime.

Independent build — not affiliated with Jim Wendler or any 5/3/1 app.

**Live:** https://andybryson.github.io/531/

## Use it

Open `index.html` in a browser, or use the link above. The planner state is encoded in the URL, so the address bar is always a shareable link to the exact programme on screen. It is also saved in the browser along with your workout log.

For local development serve the folder (`python3 -m http.server 8000`) rather than opening the file, so IndexedDB and the service worker work.

## Features

- Training max from 1RM, direct TM entry, or a rep-set (Epley) input
- Templates: Standard, Boring But Big, First Set Last, Pyramid, 5's PRO, GVT, Triumvirate, 5/3/1 for Beginners, Standard + partner FSL
- Plate-loading calculator: treats each side of the bar as a stack (plates only come on and off at the outside), picks each set's plates and their loading order to minimise total plate moves across the session, lists plates innermost first, respects a limited per-side plate inventory, flags inexact loads as "closest available"
- Custom accessory exercises per lift, with optional weight and plate loading
- 4-day or 3-day/week scheduling with reorderable lift order
- Print layout: A4 landscape, one week per page, a day per column
- Workout log (Log tab): the day's plan as a checklist. Per set: one tap ticks it as prescribed, a reps field logs a different count (AMRAP sets go straight to reps), the weight is editable, and the ⋯ button adds a comment or skips the set. Log any other exercise with "Add set" (names autocomplete from the main lifts, your accessories and anything logged before). Suggests the next programme day after the last session.
- Replay (Replay tab): pick a past calendar week and see it in the planner layout, using the programme as it was when those sessions were logged, with what was done beside each planned set: done, changed (different weight or reps, with any comment), or missed. Extra exercises are listed under their day; days with nothing logged show the plan only. Screen only, no print layout.
- Saved on the device: the programme and logs are kept in the browser's IndexedDB, so the app opens with your programme even without a share link. A share link in the URL still wins.
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
