# Accessory Kit Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let each accessory exercise be done on a chosen kit (bodyweight, barbell, landmine, dip belt, kettlebell, dumbbell, band, assisted), with landmine and dip-belt plates loaded on one sleeve or chain and no bar weight.

**Architecture:** Each accessory gets a `kit` string (and `band` text for Band and Assisted). A `KIT_META` table plus `kitOf(ex)` and `accessoryLoadText(ex)` helpers drive the editor, plan and print rows, Log and Replay, and the text export. In `buildDay()`, landmine and dip-belt accessories leave the barbell plate sequence and get their own single-stack combo from `computeSessionPlates()`.

**Tech Stack:** a single `index.html` (ES5 IIFE, string-built HTML), tests in jsdom (`test/dom-test.js`, `test/logging-test.js`), run with `npm test`.

**Spec:** `docs/superpowers/specs/2026-11-10-accessory-kit-design.md`

## Global Constraints

- ES5 only: `var`, `function`, string-built HTML, then `render()`. No dependencies.
- UK English in UI text and docs. No em dashes in UI text, docs or commit messages.
- Kit values, exactly: `"bodyweight" | "barbell" | "landmine" | "belt" | "kettlebell" | "dumbbell" | "band" | "assisted"`.
- Dropdown labels, in this order: Bodyweight, Barbell, Landmine, Dip belt, Kettlebell, Dumbbell, Band, Assisted.
- Short labels: LM (landmine), Belt (dip belt), KB (kettlebell), DB (dumbbell, with "per hand" in the load text), Band, Asst (assisted). Barbell and Bodyweight have none.
- Main lifts, supplemental, FSL and light blocks are unchanged.
- `weighted` is still written: true for every kit except bodyweight, band and assisted.
- Migration: a missing `kit` becomes `weighted ? "barbell" : "bodyweight"`. An existing plan's output must not change.
- Tests print `PASS`/`FAIL` lines. Read the output for FAIL, because the exit code only catches runtime errors.
- Commit style: short imperative subject, and a body giving the what and why with concrete numbers. End with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. A landmine weight below the bar weight (5 kg) shows a 5 kg plate and the weight 5, never "bar only" or 20. (Task 2 test)
2. A landmine weight beyond the plate stock (300 kg with default plates) shows "closest available" badges, not an error. (Task 2 test)
3. An old share link with `weighted:true` / `weighted:false` and no `kit` renders the same plate badges and text as before. (Task 1 test)
4. Switching kg to lb converts a landmine weight and leaves band text untouched. (Task 1 test)
5. A band with empty text shows "Band" in the plan and the Log weight placeholder, with no runtime errors. (Task 3 test)

---

### Task 1: Kit data model, migration and editor

**Files:**
- Modify: `index.html`: `defaultState()` (~line 611), `mergeState()` (~643), Triumvirate seeding (~882), `renderAccessoryEditor()` (~1258), accessory editor `input`/`change`/`click` handlers (~1401-1438), `setUnit()` (~1457)
- Test: `test/dom-test.js` (replace the "weighted" checkbox steps at ~93-95), `test/logging-test.js` (migration via share link)

**Interfaces:**
- Produces:
  - `KIT_META`: an object keyed by kit value, each `{label:String, short:String, input:"none"|"number"|"text", plates:"bar"|"single"|null}`. bodyweight `{label:"Bodyweight", short:"", input:"none", plates:null}`, barbell `{"Barbell","", "number","bar"}`, landmine `{"Landmine","LM","number","single"}`, belt `{"Dip belt","Belt","number","single"}`, kettlebell `{"Kettlebell","KB","number",null}`, dumbbell `{"Dumbbell","DB","number",null}`, band `{"Band","Band","text",null}`, assisted `{"Assisted","Asst","text",null}`.
  - `KIT_ORDER`: the array of kit values in dropdown order.
  - `kitOf(ex) -> String`: `ex.kit` if it is a key of `KIT_META`, else `ex.weighted ? "barbell" : "bodyweight"`.
  - `normaliseAccessory(ex) -> ex`: sets `kit = kitOf(ex)`, `band = String(ex.band||"")`, `weighted = KIT_META[kit].input==="number"`. Called on every accessory in `mergeState()`.
  - New accessories (defaults, Triumvirate seeding, "+ Add exercise") carry `kit:"bodyweight", band:""`.

- [ ] **Step 1: Write the failing tests**

In `test/dom-test.js`, change the Front Squat setup to pick kit through the dropdown, then add these checks:
```js
const kitSelect = lastRow.querySelector('select[data-field="kit"]');
log('accessory row has a kit dropdown, Bodyweight first and Assisted last', !!kitSelect && kitSelect.options[0].text === 'Bodyweight' && kitSelect.options[7].text === 'Assisted');
kitSelect.value = 'barbell'; kitSelect.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
// ...existing 61.5 kg Front Squat checks stay as they are...
// then add a second squat accessory, set kit 'band': its row has input[data-field="band"][type="text"] and no [data-field="weight"]
log('band kit shows a text box instead of a weight box', ...);
log('assisted kit shows a text box instead of a weight box', ...);
// kit 'bodyweight': neither a weight nor a band input
log('bodyweight kit shows no weight input', ...);
```
Unit switch (Review Focus 4): give a squat accessory kit `landmine` with weight 20 and a band accessory with text `15-35 kg`. Switch to lb, then check that the landmine weight input reads `44.1` and the band input still reads `15-35 kg`. Switch back to kg.

In `test/logging-test.js`, add a block that loads a share link (`url: base + '#s=' + base64url(JSON.stringify(snap))`, the same way existing share-link tests build it). Use the snapshot `accessories.squat = [{id:'a1', name:'Front Squat', sets:3, reps:'5', weighted:true, weight:61.5}, {id:'a2', name:'Pull-up', sets:3, reps:'8', weighted:false, weight:0}]` and assert:
```js
log('old weighted:true accessory reads as Barbell', rowFor('a1').querySelector('[data-field="kit"]').value === 'barbell');
log('old weighted:false accessory reads as Bodyweight', rowFor('a2').querySelector('[data-field="kit"]').value === 'bodyweight');
log('old barbell accessory still shows 61.5 with a closest-available plate badge', /61\.5/.test(squatCardText) && !!squatCard.querySelector('.badge.approx'));
```

- [ ] **Step 2: Run the tests to check they fail**

Run: `npm test 2>&1 | grep FAIL`
Expected: FAIL lines for the new kit checks (the dropdown doesn't exist yet).

- [ ] **Step 3: Implement**

- Add `KIT_META`, `KIT_ORDER`, `kitOf()` and `normaliseAccessory()` near the accessory code. Note that `mergeState()` runs at the top of the script (see the comment on `splitPlanName`), so declare them as function declarations, or put the table inside the functions, to avoid hoisting problems with `var`.
- `mergeState()`: after merging, map every list in `merged.accessories` through `normaliseAccessory`.
- Editor row: replace the `weighted` checkbox with `<select data-field="kit">` built from `KIT_ORDER`. Then show the number input (`data-field="weight"`) when `input==="number"`, or `<input type="text" data-field="band" placeholder="e.g. 15-35 kg">` when `input==="text"`.
- `change` handler on `data-field="kit"`: set `ex.kit`, call `normaliseAccessory(ex)`, then `render()`. Keep `ex.weight` across kit changes. The `input` handler gets `field==="band"` and sets `ex.band`.
- `setUnit()`: convert `ex.weight` when `KIT_META[kitOf(ex)].input==="number"`. Band text is never touched.

- [ ] **Step 4: Run the tests to check they pass**

Run: `npm test 2>&1 | grep -c FAIL`
Expected: `0`.

- [ ] **Step 5: Commit**

```bash
git add index.html test/dom-test.js test/logging-test.js
git commit   # subject: "Choose the kit for each accessory exercise"
```

---

### Task 2: Plate loading and display for each kit

**Files:**
- Modify: `index.html`: the accessory map in `buildDay()` (~997), the loadable/below-bar/plates block (~1005-1033), `plateBadgesHTML()` (~1059), `accessoryRowsHTML()` / `accessoryBlockHTML()` (~1099-1115), text export (~2858). Add a small CSS rule for the kit label badge in both screen and `#printStyles`.
- Test: `test/dom-test.js`

**Interfaces:**
- Consumes: `KIT_META`, `kitOf()` (Task 1).
- Produces:
  - Accessory objects from `buildDay()` carry `kit` and `band`, plus `perSide` / `plateCombo` / `plateApprox` for kits with plates.
  - `accessoryLoadText(ex) -> String` (plain text, no HTML):
    - bodyweight: `"<reps> reps"`
    - barbell, landmine, belt, kettlebell: `"<reps> × <w> <unit>"`
    - dumbbell: `"<reps> × <w> <unit> per hand"`
    - band and assisted: `"<reps> × " + bandText(ex)`
  - `bandText(ex) -> String`: band: `ex.band || "Band"`; assisted: `(ex.band ? ex.band+" band" : "Band") + ", assisted"`; other kits: `""`.
  - `kitLabelHTML(kit) -> String`: `''` when `short` is empty, else `<span class="kit-tag">SHORT</span>`.

- [ ] **Step 1: Write the failing tests**

In `test/dom-test.js`, on a squat day, add these accessories through the editor (same event pattern as Task 1) and assert on the squat day card:
```js
// Landmine Press, landmine, 20 kg
log('landmine 20 kg shows 20 and a 20 plate, not "bar only"', /20 kg/.test(lmRowText) && !/bar only/.test(lmRowText) && badgeTexts(lmRows[0]).join(',') === '20');
// Review Focus 1: landmine 5 kg
log('landmine 5 kg stays 5 and loads a 5 plate', /5 kg/.test(lm5Text) && badgeTexts(lm5Rows[0]).join(',') === '5');
// Review Focus 2: landmine 300 kg
log('landmine beyond plate stock is flagged closest available', !!lm300List.querySelector('.badge.approx'));
// Weighted Dip, belt, 25 kg: the plates add up to exactly 25, and no badge says "bar only"
log('dip belt 25 kg loads 25 kg of plates on one chain', sum(badgeTexts(beltRows[0])) === 25);
// Goblet Squat, kettlebell, 24: text "24 kg", no .badge except .kit-tag
log('kettlebell shows the weight as typed with no plate badges', /24 kg/.test(kbText) && kbRows[0].querySelectorAll('.badge').length === 0);
// DB Row, dumbbell, 22.5
log('dumbbell load says per hand', /22\.5 kg per hand/.test(dbText));
// Band Pull-apart, band, '15-35 kg'
log('band shows its printed range', /15-35 kg/.test(bandText));
// Assisted Pull-up, assisted, '15-35 kg', reps '8'
log('assisted reads as a helping band', /8 × 15-35 kg band, assisted/.test(asstText));
log('kit labels appear next to the exercise names', ['LM','Belt','KB','DB','Band','Asst'].every(t => kitTags.includes(t)));
log('barbell Front Squat plate badges unchanged', /* same badge list as captured before the new accessories were added */);
```
(`badgeTexts(el)` maps `.badge:not(.kit-tag)` to numbers. `kitTags` collects the `.kit-tag` text in the squat card.)

Also add a check that the text export (the existing "copy as text" path the dom test already uses, or `programText()` if it's reachable) contains `Landmine Press @ 20kg (LM)` and `Band Pull-apart (15-35 kg)` and `Assisted Pull-up (15-35 kg band, assisted)`.

- [ ] **Step 2: Run the tests to check they fail**

Run: `npm test 2>&1 | grep FAIL`
Expected: FAIL lines for the new kit display checks.

- [ ] **Step 3: Implement**

- `buildDay()` accessory map: copy `kit:kitOf(ex)` and `band`. Set `weight` to `ex.weight` for kits with `input==="number"`, else 0.
- Loadable list: only accessories with `KIT_META[kit].plates==="bar"` join the barbell sequence and the below-bar floor.
- When `state.showPlates` is on, call `computeSessionPlates([ex.weight], state.plates)` once for each accessory with `plates==="single"` and `weight>0`. The single target is the whole weight, and the per-side counts serve as the counts available. Set `plateCombo` / `plateApprox` from the result and leave `belowBar` false.
- `accessoryRowsHTML()`: use `accessoryLoadText(ex)`, and show `plateBadgesHTML(ex)` only for kits with plates. The `.bw` row class stays for bodyweight only.
- `accessoryBlockHTML()`: the section label is the name followed by `kitLabelHTML(kit)`. Style `.kit-tag` as a small muted badge, and check that it prints.
- Text export, accessory line: `"  " + sets + "x" + reps + " " + name` followed by:
  - bodyweight: ` (bodyweight)`
  - band and assisted: ` (` + bandText(ex) + `)`
  - number kits: ` @ <w><unit>`, then ` (<short>)` when `short` is set, then ` per hand` for dumbbells

- [ ] **Step 4: Run the tests to check they pass**

Run: `npm test 2>&1 | grep -c FAIL`
Expected: `0`.

- [ ] **Step 5: Check print**

Open `index.html` locally with a squat day that has five accessories (one of each new kit), and use print preview (A4 landscape). Check that each week still fits on one page and the kit tags are legible. If you can't print, say so in the task report.

- [ ] **Step 6: Commit**

```bash
git commit -am "Load landmine and dip belt plates on one sleeve, show kit on each accessory"
```

---

### Task 3: Log and Replay

**Files:**
- Modify: `index.html`: `setLoadText()` and `daySections()` (~1754-1793), `logRowHTML` (~1840-1876), `upsertSlotEntry()` (~2042), `resultText()` (~2322), and the log section heading render (wherever `section.title` is drawn in the Log view)
- Test: `test/logging-test.js`

**Interfaces:**
- Consumes: `kitOf()`, `accessoryLoadText()`, `kitLabelHTML()` (Tasks 1-2). Accessory objects from `buildDay()` carry `kit` and `band` (Task 2).
- Produces:
  - Accessory slot `s` carries `kit` and `band`.
  - `planned` for accessory slots gains `band` = `bandText(ex)` (Band and Assisted only). `planned.weight` is `null` for bodyweight, band and assisted.
  - Section objects gain `kit`. `section.title` is unchanged, because existing tests compare titles exactly.
  - A log entry created from a Band or Assisted slot carries `band` (copied from `planned.band`).

- [ ] **Step 1: Write the failing tests**

In `test/logging-test.js`, add a block that seeds a plan whose OHP day has `[{id:'lm1', name:'Landmine Press', kit:'landmine', weight:20, sets:2, reps:'10'}, {id:'bd1', name:'Band Pull-apart', kit:'band', band:'15-35 kg', sets:2, reps:'15'}, {id:'bd2', name:'Face Pull', kit:'band', band:'', sets:1, reps:'15'}, {id:'as1', name:'Assisted Pull-up', kit:'assisted', band:'15-35 kg', sets:1, reps:'8'}]`, then opens the Log on an OHP day (use the existing helpers). Assert:
```js
log('landmine slot plans 20 kg with no bar only note', lmRow.querySelector('[data-act="weight"]').value === '20' && !/bar only/.test(lmRow.textContent));
log('band slot weight box is empty with the band text as placeholder', bdRow.querySelector('[data-act="weight"]').value === '' && bdRow.querySelector('[data-act="weight"]').placeholder === '15-35 kg');
log('empty band text falls back to Band', fpRow.querySelector('[data-act="weight"]').placeholder === 'Band' && /Band/.test(fpRow.textContent));   // Review Focus 5
// tick the band set, then read the session record from IndexedDB
log('ticked band set records the band text', entry.band === '15-35 kg' && entry.weight === null);
log('ticked assisted set records the assisted band text', asEntry.band === '15-35 kg band, assisted' && asEntry.weight === null);
log('assisted slot weight placeholder is the short band text', asRow.querySelector('[data-act="weight"]').placeholder === '15-35 kg');
log('log section heading shows the kit label', /LM/.test(lmSectionHeading.textContent));
// open Replay for that session
log('replay shows the band text instead of BW', /15 × 15-35 kg/.test(replayRowText) && !/BW/.test(replayRowText));
```

- [ ] **Step 2: Run the tests to check they fail**

Run: `npm test 2>&1 | grep FAIL`
Expected: FAIL lines for the new log and replay checks.

- [ ] **Step 3: Implement**

- `daySections()`: the accessory slot `s` includes `kit` and `band`. `planned.weight` is `ex.weight` when `KIT_META[kit].input==="number"`, else `null`. `planned.band = bandText(ex)` for Band and Assisted, so an empty band still reads "Band" downstream.
- `setLoadText(s)` for accessories returns `accessoryLoadText(s)`.
- Log row: show plate badges for kits with plates only. The weight placeholder is `s.band || "Band"` (the short printed range) for Band and Assisted, `"BW"` for bodyweight, and empty otherwise. Draw `kitLabelHTML(section.kit)` after the section heading.
- `upsertSlotEntry()`: when `slot.planned.band` is set, set `e.band = slot.planned.band` on the new entry.
- `resultText(e)`: the weight part is `fmtWeight(e.weight)+" "+e.unit` if there's a weight, else `e.band || (e.planned && e.planned.band) || "BW"`.

- [ ] **Step 4: Run the tests to check they pass**

Run: `npm test 2>&1 | grep -c FAIL`
Expected: `0`.

- [ ] **Step 5: Commit**

```bash
git commit -am "Show accessory kit in the log and replay, and record band text"
```

---

### Task 4: Docs

**Files:**
- Modify: `README.md` (features list), `docs/logging-progress.md` (one line noting the change)

- [ ] **Step 1:** Add a README feature bullet in UK English with no em dashes. Say that accessories can be set to bodyweight, barbell, landmine, dip belt, kettlebell, dumbbell, band or assisted; that landmine and dip-belt weights are the plates on one sleeve or chain, with no bar weight; that dumbbell weights are per hand; that bands show the range printed on them, and that assisted exercises show the helping band. Replace any bullet that describes the old "weighted" tick box.
- [ ] **Step 2:** Run `npm test 2>&1 | grep -c FAIL`. Expected: `0`.
- [ ] **Step 3:** Commit: `git commit -am "Describe accessory kit in the README"`.
