// Tests for the dev build, logging, replay, install and Drive sync. Each check
// loads index.html into a fresh jsdom at a chosen URL, optionally with a fake
// IndexedDB (fake-indexeddb) and a fake Google Drive, so everything runs offline.
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');
const { IDBFactory, IDBKeyRange } = require('fake-indexeddb');

const bodyContent = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const wrapped = `<!doctype html><html><head><meta charset="utf-8"></head><body>${bodyContent}</body></html>`;

function wait(ms) { return new Promise(r => setTimeout(r, ms)); }
const log = (label, cond) => console.log((cond ? 'PASS' : 'FAIL') + ' - ' + label);
let totalErrors = 0;

// opts.url, opts.idb (an IDBFactory, shared across loads to simulate a reload),
// opts.fakes (assigned to window.PLANNER_FAKES before the app script runs)
function load(opts) {
  opts = opts || {};
  const errors = [];
  const dom = new JSDOM(wrapped, {
    runScripts: 'dangerously',
    url: opts.url || 'https://andybryson.github.io/531/',
    pretendToBeVisual: true,
    beforeParse(window) {
      if (opts.idb) { window.indexedDB = opts.idb; window.IDBKeyRange = IDBKeyRange; }
      if (opts.fakes) window.PLANNER_FAKES = opts.fakes;
      window.confirm = opts.confirm || (() => true);
      window.navigator.clipboard = { writeText: () => Promise.resolve() };
      window.addEventListener('error', e => errors.push(String(e.message)));
    },
  });
  dom.errors = errors;
  dom.doc = dom.window.document;
  return dom;
}
function done(dom) { totalErrors += dom.errors.length; if (dom.errors.length) console.log(dom.errors.join('\n')); dom.window.close(); }


const pad = n => (n < 10 ? '0' : '') + n;
const isoDate = d => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
const TODAY = isoDate(new Date());
// reads every record of a store straight from a fake IndexedDB
function idbAll(factory, dbName, storeName) {
  return new Promise((resolve, reject) => {
    const req = factory.open(dbName);
    req.onsuccess = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(storeName)) { db.close(); resolve([]); return; }
      const r = db.transaction(storeName).objectStore(storeName).getAll();
      r.onsuccess = () => { db.close(); resolve(r.result); };
      r.onerror = () => reject(r.error);
    };
    req.onerror = () => reject(req.error);
  });
}
function idbGet(factory, dbName, storeName, key) {
  return new Promise((resolve, reject) => {
    const req = factory.open(dbName);
    req.onsuccess = () => {
      const db = req.result;
      const r = db.transaction(storeName).objectStore(storeName).get(key);
      r.onsuccess = () => { db.close(); resolve(r.result); };
      r.onerror = () => reject(r.error);
    };
    req.onerror = () => reject(req.error);
  });
}
function fire(dom, el, type) { el.dispatchEvent(new dom.window.Event(type, { bubbles: true })); }
function setValue(dom, el, value, type) { el.value = value; fire(dom, el, type || 'change'); }
const rowBy = (doc, key) => doc.querySelector('#logBody [data-slot="' + key + '"]');

(async () => {
  // ---------------- step 1: dev detection ----------------
  {
    const prod = load({ url: 'https://andybryson.github.io/531/' });
    await wait(100);
    log('prod: no DEV banner', prod.doc.getElementById('devBanner').hidden === true);
    log('prod: title has no DEV prefix', prod.doc.title === '531 Planner');
    done(prod);
    const dev = load({ url: 'https://andybryson.github.io/531/dev/' });
    await wait(100);
    log('dev path: DEV banner shown', dev.doc.getElementById('devBanner').hidden === false);
    log('dev path: title marked DEV', /^\[DEV\]/.test(dev.doc.title));
    done(dev);
    const local = load({ url: 'http://localhost:8000/' });
    await wait(100);
    log('localhost: DEV banner shown', local.doc.getElementById('devBanner').hidden === false);
    done(local);
  }


  // ---------------- step 2: IndexedDB store and logging view ----------------
  {
    const idb = new IDBFactory();
    const dom = load({ url: 'https://andybryson.github.io/531/#v=log', idb });
    const doc = dom.doc;
    await wait(150);
    log('#v=log opens the logging view', doc.body.dataset.view === 'log' && doc.querySelector('#viewTabs [data-view="log"]').classList.contains('active'));
    log('logging view defaults to today', doc.getElementById('logDate').value === TODAY);
    log('first session defaults to week 1, day 1 (Overhead Press)', doc.getElementById('logWeek').value === '1' && doc.getElementById('logDay').value === '1' && /Overhead Press/.test(doc.getElementById('logDay').selectedOptions[0].textContent));
    const sectionTitles = Array.from(doc.querySelectorAll('#logBody .log-section h3')).map(h => h.textContent);
    log('day plan lists the main lift then accessories (Overhead Press, Dip)', JSON.stringify(sectionTitles) === '["Overhead Press","Dip"]');
    const mainRows = doc.querySelectorAll('#logBody .log-section')[0].querySelectorAll('.log-row');
    log('BBB day has 3 warm-ups + 3 work + 5 BBB rows', mainRows.length === 11);
    log('warm-up rows are marked', mainRows[0].classList.contains('warmup') && !mainRows[3].classList.contains('warmup'));

    // tick the first work set
    rowBy(doc, 'main:3').querySelector('[data-act="tick"]').click();
    await wait(50);
    log('one tap ticks a set as done', rowBy(doc, 'main:3').classList.contains('done') && rowBy(doc, 'main:3').querySelector('.tick.on'));
    let rec = await idbGet(idb, '531-planner', 'sessions', TODAY);
    const e3 = rec && rec.entries[0];
    log('ticked set saved to IndexedDB with planned reps and weight', !!e3 && e3.status === 'ticked' && e3.reps === 5 && e3.planned.key === 'main:3' && e3.planned.kind === 'work' && e3.planned.set === 1 && e3.weight === e3.planned.weight && e3.unit === 'kg' && e3.exercise === 'Overhead Press');
    log('session snapshots the programme state and day', rec.programme.week === 1 && rec.programme.day === 1 && rec.programme.state && rec.programme.state.template === 'bbb');

    // AMRAP set: no tick button, reps go straight in
    const amrap = rowBy(doc, 'main:5');
    log('AMRAP set has no tick button, only a reps field', !amrap.querySelector('[data-act="tick"]') && !!amrap.querySelector('[data-act="reps"]'));
    setValue(dom, amrap.querySelector('[data-act="reps"]'), '8');
    await wait(50);
    log('AMRAP reps above the target count as done, not changed', rowBy(doc, 'main:5').classList.contains('done') && /8 reps/.test(rowBy(doc, 'main:5').textContent));
    // a short set
    setValue(dom, rowBy(doc, 'main:4').querySelector('[data-act="reps"]'), '3');
    await wait(50);
    log('fewer reps than prescribed marks the set as changed', rowBy(doc, 'main:4').classList.contains('changed'));

    // comment: open extras on a logged row
    rowBy(doc, 'main:4').querySelector('[data-act="more"]').click();
    await wait(20);
    const note = rowBy(doc, 'main:4').querySelector('[data-act="note"]');
    log('more button opens a comment field on a logged set', !!note);
    setValue(dom, note, 'grindy, elbow');
    await wait(50);
    rec = await idbGet(idb, '531-planner', 'sessions', TODAY);
    const e4 = rec.entries.find(e => e.planned && e.planned.key === 'main:4');
    log('reps plus comment saved', e4.status === 'reps' && e4.reps === 3 && e4.note === 'grindy, elbow');

    // weight changed before ticking
    const bbb1 = rowBy(doc, 'main:6');
    setValue(dom, bbb1.querySelector('[data-act="weight"]'), '25');
    bbb1.querySelector('[data-act="tick"]').click();
    await wait(50);
    rec = await idbGet(idb, '531-planner', 'sessions', TODAY);
    const e6 = rec.entries.find(e => e.planned && e.planned.key === 'main:6');
    log('weight edited before ticking is logged and marked changed', e6.weight === 25 && e6.status === 'ticked' && rowBy(doc, 'main:6').classList.contains('changed'));

    // skip, then untick leaves a tombstone
    rowBy(doc, 'main:7').querySelector('[data-act="more"]').click();
    await wait(20);
    rowBy(doc, 'main:7').querySelector('[data-act="skip"]').click();
    await wait(50);
    log('skip marks a set skipped', rowBy(doc, 'main:7').classList.contains('skipped'));
    rowBy(doc, 'main:3').querySelector('[data-act="tick"]').click();
    await wait(50);
    rec = await idbGet(idb, '531-planner', 'sessions', TODAY);
    log('tapping a ticked set again unticks it, keeping a tombstone', !rowBy(doc, 'main:3').classList.contains('done') && rec.entries.find(e => e.id === e3.id).deleted === true);

    // accessory: bodyweight dip
    const dip = doc.querySelector('#logBody [data-slot^="acc:ex1:0"]');
    log('bodyweight accessory shows BW in the weight field', dip.querySelector('[data-act="weight"]').placeholder === 'BW' && dip.querySelector('[data-act="weight"]').value === '');
    setValue(dom, dip.querySelector('[data-act="reps"]'), '12');
    await wait(50);
    log('accessory range reps (10-15) logged at 12 counts as done', doc.querySelector('#logBody [data-slot="acc:ex1:0"]').classList.contains('done'));

    // ad hoc exercise, twice with sloppy spelling
    setValue(dom, doc.getElementById('addExName'), 'Cossack squat', 'input');
    doc.getElementById('addExWeight').value = '24';
    doc.getElementById('addExReps').value = '8';
    doc.getElementById('addExBtn').click();
    await wait(30);
    doc.getElementById('addExName').value = '  cossack   SQUAT ';
    doc.getElementById('addExBtn').click();
    await wait(50);
    const adhocTitles = Array.from(doc.querySelectorAll('#logBody .log-section h3')).map(h => h.textContent);
    log('ad hoc sets with the same name (any case, spacing) group under one heading', adhocTitles.filter(t => t === 'Cossack squat').length === 1 && doc.querySelectorAll('#logBody [data-entry]').length === 2);
    const opts = Array.from(doc.querySelectorAll('#exerciseNames option')).map(o => o.value);
    log('autocomplete offers main lifts, accessories and logged exercises', opts.includes('Squat') && opts.includes('Dip') && opts.includes('Cossack squat') && opts.filter(o => o.toLowerCase() === 'cossack squat').length === 1);
    rec = await idbGet(idb, '531-planner', 'sessions', TODAY);
    const adhoc = rec.entries.filter(e => !e.planned);
    log('ad hoc entries saved with planned: null', adhoc.length === 2 && adhoc.every(e => e.planned === null && e.exercise === 'Cossack squat' && e.weight === 24 && e.reps === 8));
    doc.querySelector('#logBody [data-entry] [data-act="remove"]').click();
    await wait(50);
    log('removing an ad hoc set leaves one', doc.querySelectorAll('#logBody [data-entry]').length === 1);

    doc.getElementById('finishBtn').click();
    log('finish session confirms what was saved', /Saved \d+ sets?/.test(doc.getElementById('logMsg').textContent));

    // next day suggests the next programme day
    const tomorrow = new Date(); tomorrow.setDate(tomorrow.getDate() + 1);
    setValue(dom, doc.getElementById('logDate'), isoDate(tomorrow));
    await wait(30);
    log('the next date suggests the next programme day (week 1, day 2)', doc.getElementById('logWeek').value === '1' && doc.getElementById('logDay').value === '2' && /Deadlift/.test(doc.querySelector('#logBody h3').textContent));

    // planner change is saved for a reload with no share link
    doc.querySelector('#viewTabs [data-view="plan"]').click();
    setValue(dom, doc.getElementById('programTitle'), 'Cycle 4', 'input');
    await wait(400);
    log('switching back to Plan shows the planner', doc.body.dataset.view === 'plan');
    done(dom);

    const again = load({ url: 'https://andybryson.github.io/531/#v=log', idb });
    await wait(200);
    log('after reload with no share link, the saved programme is restored', again.doc.getElementById('programTitle').value === 'Cycle 4');
    log('after reload, today\'s logged sets are still there', again.doc.querySelectorAll('#logBody .log-row.done, #logBody .log-row.changed, #logBody .log-row.skipped').length >= 5);
    done(again);

    // dev keeps its own database
    const dev = load({ url: 'https://andybryson.github.io/531/dev/#v=log', idb });
    await wait(200);
    log('dev build uses its own database (nothing logged there)', dev.doc.querySelectorAll('#logBody .log-row.done').length === 0 && dev.doc.getElementById('programTitle').value === '');
    done(dev);
  }

  // without IndexedDB the logging view still works from memory
  {
    const dom = load({ url: 'https://andybryson.github.io/531/#v=log' });
    await wait(150);
    rowBy(dom.doc, 'main:3').querySelector('[data-act="tick"]').click();
    await wait(30);
    log('no IndexedDB: logging still works in memory', rowBy(dom.doc, 'main:3').classList.contains('done'));
    done(dom);
  }

  console.log('\nFINAL total runtime errors:', totalErrors);
  if (totalErrors) process.exitCode = 1;
})();
