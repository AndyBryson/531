# Accessory kit: landmine, dip belt, kettlebell, dumbbell, band, assisted

## Why

Every weighted accessory is currently treated as a barbell lift: the bar's weight is subtracted and the rest split across two sides (`buildDay()`, `index.html` around line 1017). Anything at or below the bar weight is floored to the bar. In Andy's last session a 20 kg landmine press came out as "bar only", when what he loads is 20 kg of plates on the one sleeve. The app should give numbers that match what is physically loaded, whatever the kit.

## Goals

- Each accessory exercise has a kit: Bodyweight, Barbell, Landmine, Dip belt, Kettlebell, Dumbbell, Band, Assisted.
- Landmine and dip belt: the weight is the plates on the single sleeve or chain. No bar weight is added or subtracted, there is no minimum, and the plate breakdown is chosen from the user's plate set.
- Kettlebell and dumbbell: the weight is per bell, shown as typed, with no plate breakdown and no rounding.
- Band: a short free-text field holding what is printed on the band (for example "15-35 kg"), shown as typed.
- Assisted: for band-assisted work such as pull-ups and dips. Same text field as Band, but shown so it is clear the band helps rather than adds load, for example "8 × 15-35 kg band, assisted".
- Barbell stays the default, and existing plans and share links behave exactly as before.

## Non-goals

- Main lifts, supplemental sets, FSL and light-day blocks stay barbell-only. (Andy may move away from 5/3/1 one day, but not yet.)
- No inventory of owned kettlebells or dumbbells, and no rounding to owned sizes.
- No stacked bands and no band progression.
- No assisted machines with a kg number; Assisted means a band.
- Dip belt weight does not include bodyweight.

## Anti-goals

- Any change to how an existing plan's numbers or plate loading look. Old `weighted:false` must read as Bodyweight and `weighted:true` as Barbell.
- A landmine or dip-belt weight ever being floored to the bar weight or shown as "bar only".

## Decided with Andy

- Kit is chosen per accessory exercise in the accessory editor. A single dropdown replaces the existing "weighted" checkbox (`index.html` around line 1267): Bodyweight, Barbell, Landmine, Dip belt, Kettlebell, Dumbbell, Band, Assisted.
- Bodyweight shows no weight input. Band and Assisted show a text input. All the other kit shows the existing number input.
- Dumbbell weights are per dumbbell.
- Plan, print and Log rows show a short kit label next to the exercise, plus a plate breakdown where relevant (Barbell, Landmine, Dip belt).

## Constraints

- Match the existing code: ES5, `var`, string-built HTML, `render()`. No dependencies. See CLAUDE.md.
- UK English, no em dashes in UI text, docs or commit messages.
- New state needs defaults and must survive `loadState()` / `mergeState()`, share links (`#s=`), Drive sync, and plans saved before this change.
- Check print after the layout changes (`fitPrintToPage()`, A4 landscape, one week per page).
- Update the README features list.
- Add tests in the style of `test/dom-test.js` and `test/logging-test.js`.

## Calls I made (Claude), which Andy agreed to in the playback

- Data shape: each accessory gets `kit` (`"bodyweight" | "barbell" | "landmine" | "belt" | "kettlebell" | "dumbbell" | "band" | "assisted"`) and, for Band and Assisted, `band` (string). `weighted` is derived from or replaced by `kit`. Migration in `mergeState()`: a missing `kit` becomes `weighted ? "barbell" : "bodyweight"`. Defaults (`defaultState()`, Triumvirate slots at line 882, "add exercise" at line 1434) use `kit:"bodyweight"`.
- Landmine and dip-belt plates come from the same `state.plates` stock. The per-side counts are used as the counts available for the single sleeve or chain. These loads are not part of the barbell's plate-move minimisation in `computeSessionPlates()`: solve each separately (or as its own sequence per exercise), because a different implement is being loaded.
- Kit labels: LM (landmine), Belt (dip belt), KB (kettlebell), DB (dumbbell, with "per hand" in the load text), Band, Asst (assisted). Barbell and Bodyweight need no label.
- kg/lb switch (`index.html` around line 1462): converts every kit with a number. Band text (Band and Assisted) is left alone.
- Keep writing `weighted` alongside `kit`: true for every kit that takes a number. Then an older cached copy of the app, or an older share link, still shows a weight (landmine shows as barbell there, which is today's behaviour).
- Barbell accessories stay in the main lift's plate-move sequence, as now. Landmine and dip-belt loads skip the floor to the bar weight and the "bar only" note. When their exact weight can't be made from the plates, they reuse the existing "closest available" badges.
- Changing an exercise's kit affects the plan only. Logged entries tie to planned sets by `acc:<id>:<i>`, and replay draws from the plan saved with each session, so past logs are untouched.

## Calls for the builder (settle them sensibly and note what you chose)

- Log view and replay for Band and Assisted: the planned slot has `weight:null` and carries the band text. A logged band set records the band text (a new optional `band` field on the entry) rather than a kg number. The Log and Replay text shows the band text where it would otherwise say "BW". (When this was written the app had no volume or e1RM totals. The Progress tab, added later, reads band and assisted sets as reps-only work; see `2026-11-10-progress-plots-design.md`.)
- Ad-hoc exercises added in the Log view ("add exercise", around line 2256) keep their current numeric weight and get no kit choice in this change.
- Text export (around line 2858): include the kit label and the band text.
- Exact styling of the label badge and dropdown, as long as print still fits.
