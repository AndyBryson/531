# Progress plots

## Why

Andy logs every set on his phone, but the app has nowhere to answer the question he trains for: am I getting stronger? This adds a Progress tab that turns the logged sets into lines over weeks and months. It is for looking back at home, mainly on the laptop, not for use during a session.

## Goals

- A fourth view, **Progress**, after Plan / Log / Replay (`v=progress` in the hash, through `setView()`).
- One chart, with the exercises shown chosen by chips (layout "B" from the mockups). Main lifts and accessories both.
- A mode switch with three settings:
  - **Est. 1RM**: per set, Epley via the existing `epley1RM(weight, reps)` (weight × (1 + reps/30); 1 rep = the weight). A point is the best e1RM in its group.
  - **Heaviest for N reps**: N is a small number input (default 5). A point is the heaviest weight actually lifted in a set with reps ≥ N. No estimating. A group with no such set has no point.
  - **Reps**: for exercises with no weight. A second switch picks **Best set** (most reps in one set) or **Best session** (most total reps of that exercise in one session, best session in the group).
- A **Points per** switch: **Session** (one point per training date), **Week** (Monday to Sunday, the default), **Plan** (one per plan, by the plan the session was logged against).
  - Plan is identified by the name saved with the session (`rec.programme.title`, always `YYYY-MM-DD` or `YYYY-MM-DD - title`). Labels use that saved name; points are ordered by its date part, then by first session date. Records hold no plan id, so a plan renamed mid-cycle shows as two points and two plans with the same name merge; accepted rather than changing the record format. (Claude's call.)
- Tapping or hovering a point shows its group label, the value and the set it came from, for example "w/c 2 Nov: 158 kg from 130 × 7, Squat". For Best session, the date and total.
- A time range picker: All time (default), last 12 weeks, last 6 months, last year.

## Non-goals

- No bodyweight tracking. Because of that, dip-belt exercises get no e1RM (see below).
- No volume or tonnage charts, PR badges, trend lines or TM suggestions. (The logging design already ruled out automatic TM suggestions.)
- No print layout for Progress.
- Not synced: chart settings are per device.

## Anti-goals

- A number that looks precise but is wrong, such as an e1RM from dip-belt plates alone, or assisted reps on the same line as unassisted ones.
- Any change to logging, stored session records, plans or Drive files. Progress only reads.
- A chart library or any new external request.

## Which sets count

Source: every session record in the IndexedDB `sessions` store (Drive-synced ones included once pulled), whatever plan it was logged against.

A set counts when it is not deleted (`deleted: true`), not skipped (`status: "skipped"`), and has a status (`"ticked"` or `"reps"`). Warm-ups count. (They never win e1RM. In Heaviest for N, a warm-up can be the only qualifying set in a deload week; accepted.)

Reps: `e.reps`, parsed with `parseNum()`. A ticked set stores the planned reps, which may be a string such as `"5+"` or `"10-15"`; `parseNum` takes the leading number, so a ticked AMRAP counts as its minimum and a ticked range as its lower bound. Accepted: Andy types the real reps on AMRAP sets.

Weight: `e.weight` converted from the entry's own `e.unit` to the app's `state.unit` (entries carry their unit; a plan can switch kg/lb). Use the same factor `setUnit()` uses.

Exercise identity: `normName(e.exercise)` (trim, collapse spaces, lower case), the same matching the Log view uses for ad-hoc names. The label shown is the most recent spelling.

## Kit (depends on the accessory kit work)

The kit change ([2026-11-10-accessory-kit-design.md](2026-11-10-accessory-kit-design.md), plan in `docs/superpowers/plans/2026-11-10-accessory-kit.md`, partly built on `dev`) decides how each set is classed. Build Progress after it.

Each set gets a class:

| Kit of the set | Class | Est. 1RM | Heaviest for N | Reps |
|---|---|---|---|---|
| Barbell, main lifts, Landmine, Kettlebell, Dumbbell | weighted | yes | yes | no |
| Dip belt | belt | **no** (no bodyweight) | yes, on belt weight | no |
| Bodyweight, or no weight (`weight` null or 0) | reps | no | no | yes |
| Band | reps | no | no | yes |
| Assisted | assisted | no | no | yes, own line per band text, dashed |

- Kettlebell and dumbbell weights are per bell, plotted as stored.
- **Where the kit comes from (read only, no logging change).** Main-lift, light-day and supplemental sets (`planned.key` `main:*` / `light:*`) are barbell. For an accessory set, `planned.key` is `acc:<exercise id>:<n>`: look the exercise id up in the plan copy saved with that session (`rec.programme.state`) and take its kit with the kit work's `kitOf()` (which reads old `weighted` as barbell or bodyweight) and its band text with `bandText()`. Use `e.band` if the entry has one. Sets with no `planned`, or whose id is not in the copy, are classed by weight: a number above 0 is weighted, else reps. (Claude's call, after the builder check: keeps "Progress only reads".)
- **Class is per set, and a line is name plus class.** A line (and its chip) is keyed by `normName(exercise)` plus class, plus band text for assisted. So one name can give more than one chip: "Dips" (reps) and "Dips (Belt)", or "Pull-ups" and "Pull-ups (Asst 15-35 kg band)". Old bodyweight dips stay in Reps when later cycles move to the belt. (Claude's call.)
- **Exception for ad-hoc weighted sets:** a weighted-by-weight set (no kit found) under a name that also has belt sets is classed as belt, so ad-hoc "Dips" with +20 kg next to planned belt dips are never given an e1RM. (Claude's call.)
- Chip labels: the name, plus "(Belt)" for belt and "(Asst <band text>)" for assisted. Weighted and reps lines need no suffix unless the same name has both, then reps gets "(BW)".

## The screen

Top row: mode switch (Est. 1RM / Heaviest for [N] reps / Reps), the Best set / Best session switch only in Reps mode, the Points per switch, the time range picker.

Below: chips, one per exercise that has sets valid in the current mode. Belt exercises do not appear in Est. 1RM. Only reps and assisted exercises appear in Reps. A chip with no data in the chosen range is greyed out and not selectable. Each selected exercise gets a colour, kept stable per exercise while it is selected.

The chart: inline SVG, built as a string like the rest of the app, using theme custom properties so light and dark both work. Lines with point markers, y-axis labelled in the unit (or "reps"), each line labelled at its last point. Session and Week: x positioned by date, so gaps show. A gap in a line is drawn as a break, not joined across. Plan: points evenly spaced, x labels are the plan names (the `YYYY-MM-DD - title` names, shortened where needed). Week and Session points sit at the group's start date and session date respectively.

First open: Est. 1RM, Week, All time, the four main lifts selected. After that, the last mode, N, Best set/session, Points per, range and chip selection are remembered on the device in `meta` (like `meta.keepScreenOn`), never synced.

Empty states: no logs at all, "Nothing logged yet. Log a session and it will show here." No chips selected: a prompt to pick some.

Works at phone width (chips wrap, chart scales to width), designed for the laptop.

## Constraints

- Match CLAUDE.md: ES5, `var`, string-built HTML, `render()`, no dependencies, UK English, no em dashes.
- Reading sessions: all sessions are already in memory in `sessions` (loaded at startup, merged into by sync). Progress reads that and re-renders when a sync changes it.
- Depends on the kit work being in (`kitOf()`, `bandText()`). Entries now carry `band` (kit Task 3); Progress uses it when present and otherwise reads the band text from the plan copy.
- Update the README features list.
- Tests in the style of `test/logging-test.js`: seed sessions with fake-indexeddb, open `#v=progress`, assert on the computed points and the SVG/chip DOM. Cover: e1RM best-of-week, Heaviest for N with a gap, ticked `"5+"` counted as 5, kg/lb conversion, deleted and skipped sets ignored, belt excluded from e1RM, assisted split by band, Plan grouping, Best session totals.
- Add `.superpowers/` to `.gitignore` (mockups from this brainstorm live there).
- Fix the kit design's line "The app has no volume or e1RM totals" once this lands.

## Left to the builder

- Exact styling of switches, chips, tooltip and chart, within the existing theme.
- Colour palette for lines (enough distinct colours for about 8 lines, readable in both themes).
- Y-axis tick choice and whether the axis starts at zero (suggest not at zero for weight, so small gains are visible).
- How the plan name is shortened on the Plan x-axis.
- Code structure: suggest a pure function that turns sessions plus settings into series (easy to test), and a separate SVG builder.
