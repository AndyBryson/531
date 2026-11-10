# Progress Plots Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Progress tab that plots logged sets over time (estimated 1RM, heaviest weight for N reps, or reps), one chart with chosen exercises, points per session, week or plan.

**Architecture:** All in `index.html`, inside the existing IIFE. A read-only pipeline over the in-memory `sessions` map: `progressSets()` flattens and classifies counted sets, `progressGroups()` / `progressSeries()` turn them into points for the current settings, `progressChartSVG()` draws an inline SVG string, `renderProgress()` puts controls, chips and chart into `#progressView`. Settings live in `progressSettings`, saved to IndexedDB `meta` key `progress`, never synced.

**Tech Stack:** ES5 in one HTML file, inline SVG, no dependencies. Tests: Node, jsdom, fake-indexeddb (`npm test`).

**Spec:** `docs/superpowers/specs/2026-11-10-progress-plots-design.md`

**Where:** worktree `/Users/andy/src/weights-progress`, branch `progress-plots` (from `accessory-kit`). Do not touch `/Users/andy/src/weights`, where another session is working on `accessory-kit`.

## Global Constraints

- ES5: `var`, `function`, `"use strict"`, string-built HTML, `render()`. No dependencies, no new external requests, no chart library.
- UK English in UI text and docs. No em dashes in UI text, docs or commit messages.
- Progress only reads: no change to session records, plans, logging or Drive files.
- Settings are per device in IndexedDB `meta` key `progress`, never synced.
- Colours from CSS custom properties on `:root`, with dark values under `prefers-color-scheme` and `data-theme`, like the existing theme.
- Works at phone width; built for the laptop. No print styles for Progress (hide `#progressView` in print).
- Commit style: short imperative subject, body saying what and why with concrete numbers. End with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Tests print `PASS`/`FAIL`; read the output for FAILs (exit code only reflects runtime errors).

## Review Focus

1. Old sessions with `programme.state` null, or accessory ids missing from the snapshot: classed by weight, no exception. (Task 2 fixture has one.)
2. Reps that do not parse (`null`, `""`, `"AMRAP"`) or are below 1: the set is skipped, never NaN in the SVG. (Task 2 test.)
3. A line with one point, or all values equal: draws a visible dot, y-range padded, no `NaN`/`Infinity` in any attribute. (Task 3 test.)
4. Names differing in case or spacing ("Chin-ups" vs "chin-ups "): one line, labelled with the most recent spelling. (Task 2 test.)
5. Week boundaries: a Sunday and the following Monday fall in different weeks; computed from the `YYYY-MM-DD` string in UTC so DST never shifts a date. (Task 3 test.)

---

## Shared test fixture (written in Task 2, reused by Tasks 3 to 5)

Add to `test/logging-test.js` a function `progressFixture(idb)` that seeds `531-planner` sessions with `idbPut`, dates relative to `mondayOf(TODAY)` (helpers already in the file). `W0 = daysFrom(mondayOf(TODAY), -21)`, `W1 = -14`, `W2 = -7`, `OLD = -210`. Snapshot state `snap(title)` has `programTitle: title`, `unit: 'kg'` and `accessories: { squat: [{id:'dp', name:'Dips', kit:'belt', weight:20, sets:3, reps:'5'}, {id:'pu', name:'Pull-ups', kit:'assisted', band:'15-35 kg', sets:3, reps:'8'}], bench: [{id:'ch', name:'Chin-ups', kit:'bodyweight', weight:0, sets:3, reps:'8'}], ohp: [], deadlift: [] }`. Main-lift entries use `planned: {key:'main:N', lift, kind:'work', ...}`.

| Date | Plan (`programme.title`) | Entries |
|---|---|---|
| OLD | Cycle 0 | Squat 90 kg × 5 (reps); Deadlift 140 × 3 (reps) |
| W0 Mon | Cycle 1 | Squat 60 × 5 warm-up (ticked, reps `"5"`); Squat 110 × 3 (reps); Dips 20 × 5 `acc:dp:0`; Pull-ups weight null, reps 8, `acc:pu:0`, band `"15-35 kg band, assisted"` |
| W0 Thu | Cycle 1 | Squat 105 × `"5+"` (ticked); Chin-ups weight null reps 6 `acc:ch:0`, reps 5 `acc:ch:1` |
| W1 Mon | Cycle 1 | Squat 225 **lb** × 3 (reps); Squat 120 × 2 `deleted:true`; Squat 130 × 0 `status:'skipped'`; `"chin-ups "` null × 4 `planned:null`; then Chin-ups null × 8 `acc:ch:0` (in this order, so the latest spelling is "Chin-ups"); Squat 80 × `"AMRAP"` (reps, unparseable) |
| W2 Tue | Cycle 2 | Squat 115 × 3; Squat 100 × 6; Dips 25 × 5 `planned:null` (ad hoc, weighted); Dips null × 12 `planned:null` |
| W2 Wed | Cycle 2, `state: null` | Landmine press 20 × 10 `acc:lm:0` |

Expected values used in later tasks (kg, one decimal):
- e1RM by week, Squat: OLD 105.0, W0 122.5, W1 112.3, W2 126.5. By session: 105.0, 121.0, 122.5, 112.3, 126.5. By plan: Cycle 0 105.0, Cycle 1 122.5, Cycle 2 126.5.
- Heaviest for 5, Squat by week: 90, 105, (gap at W1), 100. Heaviest for 3: 90, 110, 102.1, 115.
- Dips (Belt), heaviest for 5: W0 20, W2 25.
- Chin-ups best set: W0 6, W1 8. Best session: W0 11, W1 12.

---

### Task 1: Progress tab and empty view

**Files:**
- Modify: `index.html` (tabs ~line 353, `#replayView` ~line 520, CSS ~lines 205-212, `VIEWS` ~line 660, `render()` ~line 1205, `setView()` ~line 2140, `refreshAfterPull()` ~line 2822, print styles)
- Test: `test/logging-test.js` (new block before the final summary)

**Interfaces:**
- Produces: `renderProgress()` (no args, draws `#progressView`); `currentView` may be `"progress"`; `<section class="progress-view" id="progressView">`.

- [ ] **Step 1: Write the failing test**

```js
// ---------------- progress: tab ----------------
{
  const idb = new IDBFactory();
  const dom = load({ url: 'https://andybryson.github.io/531/#v=progress', idb });
  await wait(250);
  const { doc } = dom;
  log('#v=progress opens the progress view', doc.body.dataset.view === 'progress');
  log('a Progress tab sits after Replay', Array.from(doc.querySelectorAll('#viewTabs [data-view]')).map(b => b.dataset.view).join('|') === 'plan|log|replay|progress');
  log('with nothing logged, progress says so', /Nothing logged yet/.test(doc.getElementById('progressView').textContent));
  done(dom);
}
```

- [ ] **Step 2: Run** `npm test 2>&1 | grep -i progress`. Expected: FAIL lines.

- [ ] **Step 3: Implement**
  - Tab button `<button data-view="progress">Progress</button>` after Replay; `VIEWS = ["plan","log","replay","progress"]`.
  - Section after `#replayView`. CSS: hide `.shell` and `.menu-toggle` on `body[data-view="progress"]` like log/replay; hide `#progressView` unless `body[data-view="progress"]`; `.progress-view{max-width:1100px; margin:0 auto; padding-block:16px 80px;}`. Hidden in print.
  - `renderProgress()`: while `!storeReady` show "Loading…"; with no counted sets show `<p class="empty-note">Nothing logged yet. Log a session and it will show here.</p>`. (Until Task 2 exists, "no sessions" is enough.)
  - Call it from `render()`, `setView()` and `refreshAfterPull()` when `currentView==="progress"`, and once after the store loads (where `storeReady = true` is set, alongside the existing re-renders).

- [ ] **Step 4: Run** `npm test`. Expected: the new lines PASS, no other FAIL, `FINAL total runtime errors: 0`.

- [ ] **Step 5: Commit** `Add an empty Progress tab`.

---

### Task 2: Classify logged sets and show chips per mode

**Files:**
- Modify: `index.html` (new `// ---------------- progress ----------------` section after the replay code)
- Test: `test/logging-test.js` (`progressFixture` + tests)

**Interfaces:**
- Consumes: `sessions`, `state.unit`, `kitOf(ex)`, `bandText(ex)`, `normName(n)`, `parseNum(v)`, `LIFT_META`.
- Produces:
  - `progressSets() -> Array<{date:"YYYY-MM-DD", plan:String, line:String, name:String, cls:"weighted"|"belt"|"reps"|"assisted", weight:Number|null, reps:Number}>` (weight in `state.unit`, rounded to 0.1; `plan` = `rec.programme.title`).
  - `progressLines(sets) -> Object<lineKey, {key, label, cls}>`.
  - Line key: `cls + "|" + normName(name)`, plus `"|" + bandLabel` for assisted (e.g. `"assisted|pull-ups|15-35 kg band"`).
  - `PROGRESS_MODES = {e1rm:["weighted"], heavy:["weighted","belt"], reps:["reps","assisted"]}`.
  - `progressSettings` (global): `{mode:"e1rm", n:5, repsBy:"set", per:"week", range:"all", lines:{<lineKey>: colourIndex}}`; `defaultProgressSettings()` selects `weighted|overhead press`, `weighted|bench press`, `weighted|squat`, `weighted|deadlift` (use `normName(LIFT_META[l].name)`) with colours 0 to 3.
  - DOM: mode buttons `[data-pmode="e1rm"|"heavy"|"reps"]` (`.on` when active), chips `button.chip[data-line]` (`.on` when selected).

Rules (from the spec, "Which sets count" and "Kit"):
- Counted: not `deleted`, status `"ticked"` or `"reps"`, `parseNum(e.reps) >= 1`. Reps rounded down to an integer.
- Weight: `e.weight` if a number, converted from `e.unit` to `state.unit` with factor 2.20462.
- Kit: `planned.key` starting `main:` or `light:` is barbell. `acc:<id>:<n>`: find the accessory with that id in any `rec.programme.state.accessories[lift]` and use `kitOf(ex)`; band label from `e.band`, else `bandText(ex)`. No snapshot, no match, or `planned` null: no kit.
- Class: belt kit -> belt; assisted -> assisted; band or bodyweight kit -> reps; other kits -> weighted. No kit: weight > 0 -> weighted, else reps. Then, any weighted set with no kit whose `normName` also has a belt set becomes belt.
- Assisted band label: band text with a trailing `", assisted"` removed (`"15-35 kg band"`).
- Labels: most recent spelling of the name (latest date, then entry order); `" (Belt)"` for belt, `" (Asst <band label>)"` for assisted, `" (BW)"` for reps when the same `normName` also has a weighted or belt line.
- Chips shown: lines whose class is in `PROGRESS_MODES[mode]`, sorted with the four main lifts first in `LIFTS` order, then by label.

- [ ] **Step 1: Write `progressFixture(idb)` and the failing tests**

```js
// ---------------- progress: classes and chips ----------------
{
  const idb = new IDBFactory();
  await progressFixture(idb);
  const dom = load({ url: 'https://andybryson.github.io/531/#v=progress', idb });
  await wait(250);
  const { doc } = dom;
  const chips = () => Array.from(doc.querySelectorAll('#progressView .chip')).map(c => c.textContent.trim());
  const click = sel => doc.querySelector(sel).dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
  log('e1RM chips: weighted lines only, main lifts first', chips().join('|') === 'Squat|Deadlift|Landmine press');
  log('main lifts start selected', doc.querySelector('.chip[data-line="weighted|squat"]').classList.contains('on'));
  log('a session with no plan copy is classed by weight', chips().includes('Landmine press'));
  click('[data-pmode="heavy"]');
  log('heaviest-for-N adds belt lines, ad hoc weighted dips join the belt line', chips().join('|') === 'Squat|Deadlift|Dips (Belt)|Landmine press');
  click('[data-pmode="reps"]');
  log('reps chips: bodyweight and assisted, names merged ignoring case and spacing', chips().join('|') === 'Chin-ups|Dips (BW)|Pull-ups (Asst 15-35 kg band)');
  log('no NaN anywhere in the view', !/NaN/.test(doc.getElementById('progressView').innerHTML));
  done(dom);
}
```

- [ ] **Step 2: Run** `npm test 2>&1 | grep -A0 'progress\|chips\|classed'`. Expected: FAIL.
- [ ] **Step 3: Implement** `progressSets()`, `progressLines()`, `defaultProgressSettings()`, the mode buttons and chips in `renderProgress()`, and a delegated click handler on `#progressView` that sets `progressSettings.mode` or toggles `progressSettings.lines[key]` (new selection takes the lowest colour index not in use, 0 to 7) and re-renders.
- [ ] **Step 4: Run** `npm test`. Expected: all PASS, 0 runtime errors.
- [ ] **Step 5: Commit** `Classify logged sets for the Progress tab`.

---

### Task 3: Points and the chart (week grouping)

**Files:**
- Modify: `index.html` (progress section, CSS)
- Test: `test/logging-test.js`

**Interfaces:**
- Consumes: `progressSets()`, `progressLines()`, `progressSettings`, `epley1RM(weight, reps)`.
- Produces:
  - `progressGroups(sets, per) -> Array<{key:String, x:Number, label:String}>` (Task 3 handles `per:"week"`: key = Monday `YYYY-MM-DD`, `x` = days since epoch of that Monday, label `"w/c 2 Nov"`). Only groups containing at least one counted set (any line), oldest first.
  - `progressSeries(sets, groups, settings) -> Array<{line:String, label:String, colour:Number, points:Array<{group:String, x:Number, value:Number|null, title:String}>}>` for selected lines visible in the current mode. One entry per group; `value:null` where that group has no qualifying set (draws a break).
  - `progressChartSVG(series, groups, settings) -> String`.
  - DOM: `#progressN` (number input, min 1), `[data-prepsby="set"|"session"]` (only in reps mode), `svg#progressChart`, `path.pline[data-line]` (one `M` per unbroken run), `circle.ppt[data-line][data-group][data-value]` each with a `<title>`.

Values per group: e1rm = max `epley1RM(weight, reps)` over weighted sets; heavy = max weight over sets with `reps >= n` (weighted, belt); reps/set = max reps; reps/session = max over dates in the group of the summed reps of that line on that date. `data-value` is the value rounded to 0.1, printed without trailing `.0` (`"122.5"`, `"90"`).

Titles: `"<group label>: <value> <unit> from <weight> × <reps>, <label>"` for e1rm and heavy (the set that won), `"<group label>: <n> reps, <label>"` for best set, `"<group label>: <n> reps on <D Mon>, <label>"` for best session.

Chart: viewBox width 800, height 320, scales with CSS `width:100%`. x by `group.x` (linear). y: weight modes padded 5% above and below the data range, not from zero; reps from zero. If the range is zero, pad by 1 unit (or 1 rep). Ticks: about 5 round numbers. Each line labelled at its last point. Colours `var(--line0)` to `var(--line7)` defined in `:root` with dark-mode values (builder picks, distinct in both themes). Markers `r=4`, lines `stroke-width:2`.

- [ ] **Step 1: Write the failing tests**

```js
// ---------------- progress: values ----------------
{
  const idb = new IDBFactory();
  await progressFixture(idb);
  const dom = load({ url: 'https://andybryson.github.io/531/#v=progress', idb });
  await wait(250);
  const { doc } = dom;
  const vals = line => Array.from(doc.querySelectorAll('#progressChart circle.ppt[data-line="' + line + '"]')).map(c => c.dataset.value).join(',');
  const click = sel => doc.querySelector(sel).dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
  log('e1RM by week: best set per week, lb converted, deleted/skipped/unparseable ignored', vals('weighted|squat') === '105,122.5,112.3,126.5');
  log('a point title names the set it came from', /122\.5 kg from 105 × 5, Squat/.test(doc.querySelector('circle.ppt[data-value="122.5"] title').textContent));
  click('[data-pmode="heavy"]');
  log('heaviest for 5 by week, gap where no set reached 5', vals('weighted|squat') === '90,105,100');
  log('the gap breaks the line', (doc.querySelector('path.pline[data-line="weighted|squat"]').getAttribute('d').match(/M/g) || []).length === 2);
  setValue(dom, doc.getElementById('progressN'), '3');
  log('heaviest for 3 by week', vals('weighted|squat') === '90,110,102.1,115');
  click('.chip[data-line="belt|dips"]');
  setValue(dom, doc.getElementById('progressN'), '5');
  log('belt line plots belt weight', vals('belt|dips') === '20,25');
  click('[data-pmode="reps"]');
  click('.chip[data-line="reps|chin-ups"]');
  log('best set by week', vals('reps|chin-ups') === '6,8');
  click('[data-prepsby="session"]');
  log('best session by week sums one day', vals('reps|chin-ups') === '11,12');
  log('no NaN or Infinity in the chart', !/NaN|Infinity/.test(doc.getElementById('progressChart').outerHTML));
  done(dom);
}
```

Two more checks in the same block style:

```js
// one point: only Landmine press selected (20 × 10 -> 26.7)
{
  const idb = new IDBFactory();
  await progressFixture(idb);
  const dom = load({ url: 'https://andybryson.github.io/531/#v=progress', idb });
  await wait(250);
  const { doc } = dom;
  const click = sel => doc.querySelector(sel).dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
  ['squat', 'deadlift'].forEach(l => click('.chip[data-line="weighted|' + l + '"]'));   // deselect
  click('.chip[data-line="weighted|landmine press"]');
  const pts = doc.querySelectorAll('#progressChart circle.ppt');
  log('a single point draws one marker with no NaN', pts.length === 1 && pts[0].dataset.value === '26.7' && !/NaN|Infinity/.test(doc.getElementById('progressChart').outerHTML));
  done(dom);
}
// Sunday and the next Monday are different weeks
{
  const idb = new IDBFactory();
  const mon = daysFrom(mondayOf(TODAY), -7), sun = daysFrom(mon, -1);
  const sq = (id, w) => ({ id, t: 'x', exercise: 'Squat', weight: w, unit: 'kg', reps: 5, status: 'reps', planned: { key: 'main:3', lift: 'squat', kind: 'work', set: 1, reps: 5, amrap: false, weight: w }, note: '' });
  await idbPut(idb, '531-planner', 'sessions', [
    { date: sun, programme: { title: 'C', week: 1, day: 1, state: null }, updated: 'x', rev: 1, entries: [sq('s1', 100)] },
    { date: mon, programme: { title: 'C', week: 1, day: 2, state: null }, updated: 'x', rev: 1, entries: [sq('s2', 102.5)] },
  ]);
  const dom = load({ url: 'https://andybryson.github.io/531/#v=progress', idb });
  await wait(250);
  log('Sunday and Monday fall in different weeks', dom.doc.querySelectorAll('#progressChart circle.ppt[data-line="weighted|squat"]').length === 2);
  done(dom);
}
```

- [ ] **Step 2: Run** `npm test`. Expected: FAIL on the new lines.
- [ ] **Step 3: Implement** the three functions, the N input (change re-renders, values below 1 become 1), the reps sub-switch, and the chart. Monday of a date: parse `YYYY-MM-DD` with `Date.UTC`, `x = Math.floor(ms / 86400000)`, Monday = `x - ((dayOfWeekUTC + 6) % 7)`.
- [ ] **Step 4: Run** `npm test`. Expected: all PASS, 0 runtime errors.
- [ ] **Step 5: Commit** `Plot progress by week`.

---

### Task 4: Points per session or plan, and the time range

**Files:**
- Modify: `index.html`
- Test: `test/logging-test.js`

**Interfaces:**
- Consumes: Task 3 functions.
- Produces: `progressGroups(sets, per)` for `"session"` (key = date, `x` = day number, label `"Tue 3 Nov"`) and `"plan"` (key = plan name; ordered by the name's leading `YYYY-MM-DD` if present, then by first session date; `x` = 0, 1, 2...; label = the plan name, shortened by the builder if long). `progressInRange(sets, range) -> sets` for `"all"|"12w"|"6m"|"1y"` (cut-off = today minus 84, 182 or 365 days). DOM: `[data-pper="session"|"week"|"plan"]`, `select#progressRange`, chips with no sets in range get `.empty` and `disabled`. Plan x labels are `text.pxlabel`.

- [ ] **Step 1: Write the failing tests**

```js
// ---------------- progress: grouping and range ----------------
{
  const idb = new IDBFactory();
  await progressFixture(idb);
  const dom = load({ url: 'https://andybryson.github.io/531/#v=progress', idb });
  await wait(250);
  const { doc } = dom;
  const vals = line => Array.from(doc.querySelectorAll('#progressChart circle.ppt[data-line="' + line + '"]')).map(c => c.dataset.value).join(',');
  const click = sel => doc.querySelector(sel).dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
  click('[data-pper="session"]');
  log('points per session', vals('weighted|squat') === '105,121,122.5,112.3,126.5');
  click('[data-pper="plan"]');
  log('points per plan', vals('weighted|squat') === '105,122.5,126.5');
  log('plan points are labelled with plan names', Array.from(doc.querySelectorAll('#progressChart text.pxlabel')).map(t => t.textContent).join('|') === 'Cycle 0|Cycle 1|Cycle 2');
  click('[data-pper="week"]');
  setValue(dom, doc.getElementById('progressRange'), '12w');
  log('last 12 weeks drops the old session', vals('weighted|squat') === '122.5,112.3,126.5');
  const dl = doc.querySelector('.chip[data-line="weighted|deadlift"]');
  log('a chip with nothing in range is greyed out', dl.classList.contains('empty') && dl.disabled);
  done(dom);
}
```

- [ ] **Step 2: Run** `npm test`. Expected: FAIL on the new lines.
- [ ] **Step 3: Implement** session and plan grouping, x labels for plan grouping (evenly spaced), the range select, and greyed chips. Session and week x axes get date labels at sensible intervals (builder's choice).
- [ ] **Step 4: Run** `npm test`. Expected: all PASS, 0 runtime errors.
- [ ] **Step 5: Commit** `Group progress points by session or plan, and pick a time range`.

---

### Task 5: Remember settings, docs

**Files:**
- Modify: `index.html` (startup `Promise.all` ~line 3088, progress handlers), `README.md` (features list), `CLAUDE.md` (Views line: add Progress), `docs/superpowers/specs/2026-11-10-accessory-kit-design.md` (the line "The app has no volume or e1RM totals, so nothing else needs to change"), `docs/superpowers/specs/2026-11-10-progress-plots-design.md` (the note that kit Task 3 was not built: it is now)
- Test: `test/logging-test.js`

**Interfaces:**
- Consumes: `progressSettings`, `defaultProgressSettings()`, `store.getMeta` / `store.setMeta`.
- Produces: `saveProgressSettings()` (writes `meta` key `progress`, called after every settings change). On load, `progressSettings` = stored value shallow-merged onto `defaultProgressSettings()`, `lines` taken whole if present.

- [ ] **Step 1: Write the failing test**

```js
// ---------------- progress: settings remembered ----------------
{
  const idb = new IDBFactory();
  await progressFixture(idb);
  let dom = load({ url: 'https://andybryson.github.io/531/#v=progress', idb });
  await wait(250);
  const click = (d, sel) => d.doc.querySelector(sel).dispatchEvent(new d.window.MouseEvent('click', { bubbles: true }));
  click(dom, '[data-pmode="reps"]');
  click(dom, '.chip[data-line="reps|chin-ups"]');
  click(dom, '[data-pper="plan"]');
  await wait(100);
  done(dom);
  dom = load({ url: 'https://andybryson.github.io/531/#v=progress', idb });
  await wait(250);
  const { doc } = dom;
  log('mode is remembered on the device', doc.querySelector('[data-pmode="reps"]').classList.contains('on'));
  log('points per is remembered', doc.querySelector('[data-pper="plan"]').classList.contains('on'));
  log('chip selection is remembered', doc.querySelector('.chip[data-line="reps|chin-ups"]').classList.contains('on'));
  const meta = await idbGet(idb, '531-planner', 'meta', 'progress');
  log('settings are kept in meta, not in the plan', !!meta && meta.mode === 'reps');
  done(dom);
}
```

- [ ] **Step 2: Run** `npm test`. Expected: FAIL on the new lines.
- [ ] **Step 3: Implement** loading in the startup `Promise.all` (add `st.getMeta("progress")`), `saveProgressSettings()`, and call it from every progress handler.
- [ ] **Step 4: Update docs**: README features list (Progress tab: estimated 1RM, heaviest for N reps, reps for bodyweight work; points per session, week or plan; per-device settings). CLAUDE.md Views line. The two spec lines above.
- [ ] **Step 5: Run** `npm test`. Expected: all PASS, 0 runtime errors. Then serve locally (`python3 -m http.server 8000` in the worktree, open `http://localhost:8000/#v=progress`) and check by eye in light and dark, at phone width, and that print preview of the Plan tab is unchanged.
- [ ] **Step 6: Commit** `Remember Progress settings on the device, document the tab`.
