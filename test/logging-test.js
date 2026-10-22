// Tests for the dev build, logging, replay, install and Drive sync. Each check
// loads index.html into a fresh jsdom at a chosen URL, optionally with a fake
// IndexedDB (fake-indexeddb) and a fake Google Drive, so everything runs offline.
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');
const { IDBFactory, IDBKeyRange } = require('fake-indexeddb');
const vm = require('vm');

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
  const dom = new JSDOM(opts.transform ? opts.transform(wrapped) : wrapped, {
    runScripts: 'dangerously',
    url: opts.url || 'https://andybryson.github.io/531/',
    pretendToBeVisual: true,
    beforeParse(window) {
      if (opts.idb) { window.indexedDB = opts.idb; window.IDBKeyRange = IDBKeyRange; }
      if (opts.fakes) window.PLANNER_FAKES = opts.fakes;
      window.confirm = opts.confirm || (() => true);
      window.navigator.clipboard = { writeText: () => Promise.resolve() };
      window.addEventListener('error', e => errors.push(String(e.message)));
      if (opts.beforeParse) opts.beforeParse(window);
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

// writes records straight into a fake IndexedDB, creating the app's stores if needed
function idbPut(factory, dbName, storeName, records, key) {
  return new Promise((resolve, reject) => {
    const req = factory.open(dbName, 1);
    req.onupgradeneeded = () => { req.result.createObjectStore('sessions', { keyPath: 'date' }); req.result.createObjectStore('meta'); };
    req.onsuccess = () => {
      const db = req.result;
      const tx = db.transaction(storeName, 'readwrite');
      records.forEach(r => (key ? tx.objectStore(storeName).put(r, key) : tx.objectStore(storeName).put(r)));
      tx.oncomplete = () => { db.close(); resolve(); };
      tx.onerror = () => reject(tx.error);
    };
    req.onerror = () => reject(req.error);
  });
}
function daysFrom(iso, n) { const [y, m, d] = iso.split('-').map(Number); return isoDate(new Date(y, m - 1, d + n)); }
function mondayOf(iso) { const [y, m, d] = iso.split('-').map(Number); const dt = new Date(y, m - 1, d); return daysFrom(iso, -((dt.getDay() + 6) % 7)); }

// An in-memory Google Drive with the same interface as the app's REST client.
// Every write gets a later modifiedTime, like the real thing.
class FakeDrive {
  constructor() { this.files = {}; this.n = 0; this.calls = []; this.failNext = 0; }
  _id() { return 'f' + (++this.n); }
  _time() { this.clock = Math.max(Date.now(), (this.clock || 0) + 1); return new Date(this.clock).toISOString(); }
  _maybeFail(op) { this.calls.push(op); if (this.failNext > 0) { this.failNext--; return Promise.reject(Object.assign(new Error('Drive error 500'), { status: 500 })); } return null; }
  _meta(f) { return { id: f.id, name: f.name, mimeType: f.mimeType, modifiedTime: f.modifiedTime }; }
  findFolder(name, tag) {
    return this._maybeFail('findFolder') || Promise.resolve(Object.values(this.files)
      .filter(f => f.name === name && f.mimeType === 'application/vnd.google-apps.folder' && (f.appProperties || {}).app === tag)
      .map(f => this._meta(f))[0] || null);
  }
  createFolder(name, parentId, props) {
    const f = { id: this._id(), name, mimeType: 'application/vnd.google-apps.folder', parents: parentId ? [parentId] : [], appProperties: props || {}, modifiedTime: this._time() };
    this.files[f.id] = f;
    return this._maybeFail('createFolder') || Promise.resolve(this._meta(f));
  }
  rename(id, name, props) { const f = this.files[id]; f.name = name; f.appProperties = props || {}; f.modifiedTime = this._time(); return this._maybeFail('rename') || Promise.resolve(this._meta(f)); }
  list(folderId) { return this._maybeFail('list') || Promise.resolve(Object.values(this.files).filter(f => f.parents.includes(folderId)).map(f => this._meta(f))); }
  read(id) { return this._maybeFail('read') || Promise.resolve(JSON.parse(this.files[id].content)); }
  create(parentId, name, data) {
    return this._maybeFail('create') || (() => {
      const f = { id: this._id(), name, mimeType: 'application/json', parents: [parentId], content: JSON.stringify(data), modifiedTime: this._time() };
      this.files[f.id] = f; return Promise.resolve(this._meta(f));
    })();
  }
  update(id, data) {
    return this._maybeFail('update') || (() => {
      const f = this.files[id]; f.content = JSON.stringify(data); f.modifiedTime = this._time(); return Promise.resolve(this._meta(f));
    })();
  }
  // test helpers
  byName(name, parentName) {
    const parent = parentName && Object.values(this.files).find(f => f.name === parentName);
    return Object.values(this.files).find(f => f.name === name && (!parent || f.parents.includes(parent.id)));
  }
  json(name, parentName) { const f = this.byName(name, parentName); return f && JSON.parse(f.content); }
}
function fakeAuth(signedIn) {
  const a = { signedIn: !!signedIn, signIns: 0,
    hasToken: () => a.signedIn, token: () => (a.signedIn ? 'tok' : null),
    signIn: () => { a.signIns++; a.signedIn = true; return Promise.resolve('tok'); },
    clear: () => { a.signedIn = false; } };
  return a;
}
function makeFakeDriveFetch() {
  const reqs = [];
  const files = {}; let n = 0;
  const res = (status, body) => Promise.resolve({ ok: status < 300, status, json: () => Promise.resolve(body) });
  const fakeFetch = (url, opts) => {
    opts = opts || {};
    const u = new URL(url);
    reqs.push({ method: opts.method || 'GET', url: u, headers: opts.headers || {}, body: opts.body });
    const meta = f => ({ id: f.id, name: f.name, mimeType: f.mimeType, modifiedTime: f.modifiedTime });
    const now = () => new Date(Date.now() + (++n)).toISOString();
    if (u.pathname === '/drive/v3/files' && (opts.method || 'GET') === 'GET') {
      const q = u.searchParams.get('q');
      const parent = /^'([^']+)' in parents/.exec(q);
      const list = Object.values(files).filter(f => parent ? f.parents.includes(parent[1]) : (q.includes("name='" + f.name + "'") && q.includes("value='" + (f.appProperties || {}).app + "'")));
      return res(200, { files: list.map(meta) });
    }
    if (u.pathname === '/drive/v3/files' && opts.method === 'POST') {
      const b = JSON.parse(opts.body); const f = Object.assign({ id: 'id' + (++n), parents: b.parents || [], modifiedTime: now() }, b);
      files[f.id] = f; return res(200, meta(f));
    }
    if (u.pathname === '/upload/drive/v3/files' && opts.method === 'POST') {
      const boundary = /boundary=(.+)$/.exec(opts.headers['Content-Type'])[1];
      const parts = opts.body.split('--' + boundary).slice(1, 3).map(p => p.slice(p.indexOf('\r\n\r\n') + 4).replace(/\r\n$/, ''));
      const m = JSON.parse(parts[0]);
      const f = { id: 'id' + (++n), name: m.name, parents: m.parents, mimeType: m.mimeType, content: parts[1], modifiedTime: now() };
      files[f.id] = f; return res(200, meta(f));
    }
    const upd = /^\/upload\/drive\/v3\/files\/(.+)$/.exec(u.pathname);
    if (upd && opts.method === 'PATCH') { const f = files[upd[1]]; f.content = opts.body; f.modifiedTime = now(); return res(200, meta(f)); }
    const get = /^\/drive\/v3\/files\/(.+)$/.exec(u.pathname);
    if (get && u.searchParams.get('alt') === 'media') return res(200, JSON.parse(files[get[1]].content));
    return res(404, {});
  };
  return { fetch: fakeFetch, reqs, files };
}
// swaps the page's GOOGLE_CLIENT_ID, so tests do not depend on the real one
const withClientId = id => html => html.replace(/var GOOGLE_CLIENT_ID = "[^"]*";/, 'var GOOGLE_CLIENT_ID = "' + id + '";');
const driveBtn = (doc, act) => doc.querySelector('#googleBody [data-drive="' + act + '"]');

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


  // ---------------- step 3: replay ----------------
  {
    const idb = new IDBFactory();
    const lastMon = daysFrom(mondayOf(TODAY), -7);
    const lastTue = daysFrom(lastMon, 1);
    const twoWeeksAgo = daysFrom(lastMon, -5);
    // the plan as it was last week: different TMs and title from today's defaults
    const snapshot = { programTitle: 'Cycle 3', template: 'standard', lifts: {
      ohp: { mode: 'tm', value: 50, reps: 1 }, bench: { mode: 'tm', value: 80, reps: 1 },
      squat: { mode: 'tm', value: 120, reps: 1 }, deadlift: { mode: 'tm', value: 150, reps: 1 } } };
    const planned = (key, set, reps, weight, amrap) => ({ key, lift: 'ohp', kind: 'work', set, reps, amrap: !!amrap, weight });
    await idbPut(idb, '531-planner', 'sessions', [
      { date: lastTue, programme: { title: 'Cycle 3', week: 1, day: 1, state: snapshot }, updated: lastTue + 'T18:00:00Z', rev: 1, entries: [
        { id: 'a', t: 'x', exercise: 'Overhead Press', weight: 32.5, unit: 'kg', reps: 5, status: 'ticked', planned: planned('main:3', 1, 5, 32.5), note: '' },
        { id: 'b', t: 'x', exercise: 'Overhead Press', weight: 37.5, unit: 'kg', reps: 3, status: 'reps', planned: planned('main:4', 2, 5, 37.5), note: 'tired' },
        { id: 'c', t: 'x', exercise: 'Overhead Press', weight: 42.5, unit: 'kg', reps: 9, status: 'reps', planned: planned('main:5', 3, 5, 42.5, true), note: '', deleted: true },
        { id: 'd', t: 'x', exercise: 'Cossack squat', weight: 24, unit: 'kg', reps: 8, status: 'reps', planned: null, note: '' },
      ] },
      { date: twoWeeksAgo, programme: { title: 'Cycle 2', week: 3, day: 2, state: Object.assign({}, snapshot, { programTitle: 'Cycle 2' }) }, updated: 'x', rev: 1, entries: [
        { id: 'e', t: 'x', exercise: 'Deadlift', weight: 140, unit: 'kg', reps: 1, status: 'ticked', planned: { key: 'main:3', lift: 'deadlift', kind: 'work', set: 1, reps: 5, amrap: false, weight: 140 }, note: '' },
      ] },
    ]);
    const dom = load({ url: 'https://andybryson.github.io/531/#v=replay', idb });
    const doc = dom.doc;
    await wait(200);
    log('#v=replay opens the replay view', doc.body.dataset.view === 'replay');
    const sel = doc.getElementById('replayWeekSel');
    log('replay lists logged calendar weeks, newest first', !!sel && sel.options.length === 2 && sel.value === lastMon && sel.options[1].value === mondayOf(twoWeeksAgo));
    const view = doc.getElementById('replayView');
    log('replay titles the week from the snapshot (Cycle 3, Week 1)', /Cycle 3 · Week 1/.test(view.querySelector('.replay-title').textContent));
    log('replay uses the snapshot TMs, not the current programme', /OHP 50/.test(view.textContent) && /Deadlift 150/.test(view.textContent));
    const cards = view.querySelectorAll('.day-card');
    log('replay shows every day of that programme week', cards.length === 4);
    const day1 = cards[0];
    const mainRows = day1.querySelectorAll('.set-list')[0].querySelectorAll('.replay-row');
    log('day 1 shows the snapshot plan (3 warm-ups + 3 work sets, standard template)', mainRows.length === 6 && /5 × 32\.5 kg/.test(mainRows[3].textContent));
    log('a ticked set is marked done with its result', mainRows[3].classList.contains('done') && /✓ 5 × 32\.5 kg/.test(mainRows[3].querySelector('.replay-result').textContent));
    log('a short set is marked changed, with its comment', mainRows[4].classList.contains('changed') && /3 × 37\.5 kg/.test(mainRows[4].textContent) && /tired/.test(mainRows[4].textContent));
    log('a deleted (tombstoned) set counts as missed', mainRows[5].classList.contains('missed') && /missed/.test(mainRows[5].textContent));
    log('warm-ups not logged on a logged day show as missed', mainRows[0].classList.contains('missed'));
    log('ad hoc exercise listed under its day after the programme sets', /Cossack squat \(extra\)/.test(day1.textContent) && /8 × 24 kg/.test(day1.textContent));
    log('day card says which date it was logged', day1.querySelector('.day-idx').textContent.includes('Day 1'));
    log('a day with no session shows the plan only', cards[1].classList.contains('unlogged') && /not logged/.test(cards[1].textContent) && !cards[1].querySelector('.missed, .done'));
    setValue(dom, sel, mondayOf(twoWeeksAgo));
    await wait(30);
    const v2 = doc.getElementById('replayView');
    log('picking another week redraws it (Cycle 2, Week 3)', /Cycle 2 · Week 3/.test(v2.querySelector('.replay-title').textContent));
    const dl = v2.querySelectorAll('.day-card')[1];
    log('week 3 day 2 shows the logged deadlift set as changed (1 rep at 140, plan 5)', /Deadlift/.test(dl.querySelector('h3').textContent) && dl.querySelectorAll('.replay-row.done, .replay-row.changed').length === 1);
    log('replay never changes the current programme', doc.getElementById('programTitle').value === '' && /OHP 55 /.test(doc.getElementById('programSub').textContent));
    done(dom);

    const empty = load({ url: 'https://andybryson.github.io/531/#v=replay', idb: new IDBFactory() });
    await wait(150);
    log('replay with nothing logged says so', /Nothing logged yet/.test(empty.doc.getElementById('replayView').textContent));
    done(empty);
  }


  // ---------------- step 5: installable app ----------------
  {
    const root = path.join(__dirname, '..');
    const prodManifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.webmanifest'), 'utf8'));
    const devManifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest-dev.webmanifest'), 'utf8'));
    log('manifest starts the installed app on the log view, standalone', prodManifest.start_url === './#v=log' && prodManifest.display === 'standalone' && prodManifest.scope === './');
    log('manifest icons exist (192 and 512)', prodManifest.icons.length === 2 && prodManifest.icons.every(i => fs.existsSync(path.join(root, i.src))));
    log('dev manifest has its own name and icons', devManifest.short_name === '531 DEV' && devManifest.icons.every(i => /dev/.test(i.src) && fs.existsSync(path.join(root, i.src))));

    const fakeNav = (calls, persisted) => window => {
      Object.defineProperty(window.navigator, 'serviceWorker', { configurable: true, value: { register: u => { calls.push(u); return Promise.resolve({}); } } });
      Object.defineProperty(window.navigator, 'storage', { configurable: true, value: { persist: () => { persisted.push(true); return Promise.resolve(true); } } });
    };
    const calls = [], persisted = [];
    const prod = load({ url: 'https://andybryson.github.io/531/', beforeParse: fakeNav(calls, persisted) });
    await wait(100);
    log('service worker registered from the page\'s folder (sw.js)', calls.length === 1 && calls[0] === 'sw.js');
    log('prod page links the prod manifest', prod.doc.getElementById('manifestLink').getAttribute('href') === 'manifest.webmanifest');
    log('not installed: no persistent storage request on load', persisted.length === 0);
    prod.window.dispatchEvent(new prod.window.Event('appinstalled'));
    log('after install, persistent storage is requested', persisted.length === 1);
    done(prod);

    const dev = load({ url: 'https://andybryson.github.io/531/dev/', beforeParse: fakeNav([], []) });
    await wait(100);
    log('dev page links the dev manifest and icon', dev.doc.getElementById('manifestLink').getAttribute('href') === 'manifest-dev.webmanifest' && /dev/.test(dev.doc.getElementById('iconLink').getAttribute('href')));
    done(dev);

    const standalonePersist = [];
    const app = load({ url: 'https://andybryson.github.io/531/', beforeParse: w => { fakeNav([], standalonePersist)(w); w.matchMedia = q => ({ matches: /standalone/.test(q) }); } });
    await wait(100);
    log('opened as the installed app: persistent storage is requested', standalonePersist.length === 1);
    done(app);

    // the service worker's routing, run in a sandbox with a fake worker scope
    const swFetches = [];
    function swRoutes(scope) {
      const handlers = {};
      const sandbox = { self: { registration: { scope }, addEventListener: (t, f) => { handlers[t] = f; }, clients: { claim() {} }, skipWaiting() {} },
        caches: { open: () => Promise.resolve({ match: () => Promise.resolve(null), put() {}, addAll: () => Promise.resolve() }) },
        fetch: (u, o) => { swFetches.push({ u, o }); return Promise.resolve({ ok: true, clone() { return this; } }); }, URL, Promise, setTimeout };
      vm.runInNewContext(fs.readFileSync(path.join(root, 'sw.js'), 'utf8'), sandbox);
      return (url, mode) => {
        let handled = false;
        handlers.fetch({ request: { url, method: 'GET', mode: mode || 'no-cors' }, respondWith: p => { handled = true; if (p && p.catch) p.catch(() => {}); } });
        return handled;
      };
    }
    const prodSw = swRoutes('https://andybryson.github.io/531/');
    log('prod worker handles the prod page', prodSw('https://andybryson.github.io/531/', 'navigate') === true);
    await wait(20);
    log('page loads revalidate with the server (no-cache), so a deploy shows at once', swFetches.some(f => f.u === 'https://andybryson.github.io/531/' && f.o && f.o.cache === 'no-cache'));
    log('prod worker ignores everything under /531/dev/', prodSw('https://andybryson.github.io/531/dev/', 'navigate') === false && prodSw('https://andybryson.github.io/531/dev/sw.js') === false);
    log('prod worker leaves Google sign-in and Drive to the network', prodSw('https://accounts.google.com/gsi/client') === false && prodSw('https://www.googleapis.com/drive/v3/files') === false);
    log('fonts are served cache-first for offline use', prodSw('https://fonts.gstatic.com/s/oswald.woff2') === true);
    const devSw = swRoutes('https://andybryson.github.io/531/dev/');
    log('dev worker handles the dev page', devSw('https://andybryson.github.io/531/dev/', 'navigate') === true && devSw('https://andybryson.github.io/531/dev/icons/icon-dev-192.png') === true);
    log('dev worker does not handle the prod page', devSw('https://andybryson.github.io/531/', 'navigate') === false);
  }


  // ---------------- step 4: Google link and Drive sync ----------------
  {
    // no client ID and no fakes: the page works, sync is off, nothing from Google loads
    const plain = load({ url: 'https://andybryson.github.io/531/', idb: new IDBFactory(), transform: withClientId('') });
    await wait(150);
    log('without a client ID, Link is disabled and says why', plain.doc.querySelector('#googleBody button').disabled && /GOOGLE_CLIENT_ID/.test(plain.doc.getElementById('googleBody').textContent));
    log('sync pill says Local only when not linked', plain.doc.getElementById('syncPill').textContent === 'Local only');
    log('Google script is not loaded unless Drive is used', !plain.doc.querySelector('script[src*="accounts.google.com"]'));
    done(plain);

    const gdrive = new FakeDrive();
    const idbA = new IDBFactory(), idbB = new IDBFactory();
    const fakesFor = (auth) => ({ drive: gdrive, auth, syncDelayMs: 30 });

    // device A (laptop): plan a programme and log a set, then link to an empty Drive
    const authA = fakeAuth(false);
    let A = load({ url: 'https://andybryson.github.io/531/#v=log', idb: idbA, fakes: fakesFor(authA) });
    await wait(150);
    rowBy(A.doc, 'main:3').querySelector('[data-act="tick"]').click();
    await wait(50);
    A.doc.querySelector('#viewTabs [data-view="plan"]').click();
    setValue(A, A.doc.getElementById('programTitle'), 'Cycle 5', 'input');
    await wait(350);
    log('with Google configured, Link to Google is offered', !!driveBtn(A.doc, 'link') && !driveBtn(A.doc, 'link').disabled);
    driveBtn(A.doc, 'link').click();
    await wait(150);
    const folder = gdrive.byName('531 Planner');
    log('linking signs in and creates the "531 Planner" folder, tagged', authA.signIns === 1 && !!folder && folder.appProperties.app === '531-planner');
    log('a sessions subfolder is created inside it', !!gdrive.byName('sessions', '531 Planner'));
    const progJson = gdrive.json('programme.json', '531 Planner');
    log('programme.json holds the current planner state', !!progJson && progJson.programTitle === 'Cycle 5' && progJson.template === 'bbb');
    const sessA = gdrive.json(TODAY + '.json', 'sessions');
    log('today\'s session is uploaded as sessions/<date>.json', !!sessA && sessA.date === TODAY && sessA.entries.length === 1 && sessA.entries[0].status === 'ticked');
    log('the Drive copy leaves out the local rev counter', sessA && !('rev' in sessA));
    log('pill shows Synced', A.doc.getElementById('syncPill').textContent === 'Synced' && A.doc.getElementById('syncPill').classList.contains('ok'));
    log('settings show Sync now and Unlink once linked', !!driveBtn(A.doc, 'sync') && !!driveBtn(A.doc, 'unlink'));

    // a further set on A is pushed after the debounce
    A.doc.querySelector('#viewTabs [data-view="log"]').click();
    await wait(20);
    setValue(A, rowBy(A.doc, 'main:4').querySelector('[data-act="reps"]'), '4');
    await wait(5);
    log('a new set marks sync as pending', A.doc.getElementById('syncPill').textContent === 'Pending');
    await wait(120);
    log('the change is pushed after a short delay', gdrive.json(TODAY + '.json', 'sessions').entries.length === 2 && A.doc.getElementById('syncPill').textContent === 'Synced');

    // device B (phone): fresh, links and finds A's folder
    const authB = fakeAuth(false);
    let B = load({ url: 'https://andybryson.github.io/531/#v=log', idb: idbB, fakes: fakesFor(authB) });
    await wait(150);
    driveBtn(B.doc, 'link').click();
    await wait(80);
    log('linking a second device finds the folder and asks: load or start from scratch', !!driveBtn(B.doc, 'load') && !!driveBtn(B.doc, 'scratch') && /choose/i.test(B.doc.getElementById('syncPill').textContent));
    driveBtn(B.doc, 'load').click();
    await wait(200);
    log('Load from Drive takes the programme from Drive', B.doc.getElementById('programTitle').value === 'Cycle 5');
    log('Load from Drive brings in the logged sessions', rowBy(B.doc, 'main:3').classList.contains('done') && rowBy(B.doc, 'main:4').classList.contains('changed'));
    log('no duplicate folder was created', Object.values(gdrive.files).filter(f => f.name === '531 Planner').length === 1);

    // both devices log different sets on the same day; B also unticks A's set
    setValue(B, rowBy(B.doc, 'main:5').querySelector('[data-act="reps"]'), '7');
    rowBy(B.doc, 'main:3').querySelector('[data-act="tick"]').click();
    await wait(150);
    rowBy(A.doc, 'main:6').querySelector('[data-act="tick"]').click();
    await wait(150);
    const merged = gdrive.json(TODAY + '.json', 'sessions');
    const live = merged.entries.filter(e => !e.deleted).map(e => e.planned.key).sort();
    log('sets logged on both devices are merged by id', JSON.stringify(live) === '["main:4","main:5","main:6"]');
    log('a set unticked on one device stays unticked after merging (tombstone)', merged.entries.some(e => e.planned.key === 'main:3' && e.deleted));
    // A pulls when it becomes visible
    A.window.document.dispatchEvent(new A.window.Event('visibilitychange'));
    await wait(150);
    log('device A shows B\'s set after pulling', rowBy(A.doc, 'main:5').classList.contains('done') && !rowBy(A.doc, 'main:3').classList.contains('done'));

    // programme: last write wins
    B.doc.querySelector('#viewTabs [data-view="plan"]').click();
    setValue(B, B.doc.getElementById('programTitle'), 'Cycle 5 (phone edit)', 'input');
    await wait(450);
    log('programme edit on B is pushed to programme.json', gdrive.json('programme.json', '531 Planner').programTitle === 'Cycle 5 (phone edit)');
    A.window.document.dispatchEvent(new A.window.Event('visibilitychange'));
    await wait(150);
    log('A takes the newer programme from Drive', A.doc.getElementById('programTitle').value === 'Cycle 5 (phone edit)');
    done(B);

    // reload of A with no token: sync waits for a tap
    done(A);
    const authA2 = fakeAuth(false);
    A = load({ url: 'https://andybryson.github.io/531/#v=log', idb: idbA, fakes: fakesFor(authA2) });
    await wait(150);
    log('after a reload with no token, the pill asks for a tap instead of popping sign-in', A.doc.getElementById('syncPill').textContent === 'Tap to sync' && authA2.signIns === 0);
    A.doc.getElementById('syncPill').click();
    await wait(150);
    log('tapping the pill signs in and syncs', authA2.signIns === 1 && A.doc.getElementById('syncPill').textContent === 'Synced');

    // Finish session pushes straight away
    rowBy(A.doc, 'main:7').querySelector('[data-act="tick"]').click();
    A.doc.getElementById('finishBtn').click();
    await wait(30);
    log('Finish session pushes without waiting for the delay', gdrive.json(TODAY + '.json', 'sessions').entries.some(e => e.planned && e.planned.key === 'main:7' && !e.deleted));

    // failure and retry
    gdrive.failNext = 1;
    rowBy(A.doc, 'main:8').querySelector('[data-act="tick"]').click();
    await wait(120);
    log('a Drive error shows Sync failed with a retry', /failed/.test(A.doc.getElementById('syncPill').textContent) && A.doc.getElementById('syncPill').classList.contains('bad'));
    log('the set is still logged locally despite the failure', rowBy(A.doc, 'main:8').classList.contains('done'));
    A.doc.getElementById('syncPill').click();
    await wait(120);
    log('retry pushes the queued set', A.doc.getElementById('syncPill').textContent === 'Synced' && gdrive.json(TODAY + '.json', 'sessions').entries.some(e => e.planned && e.planned.key === 'main:8'));
    done(A);

    // share link while linked: asks before overwriting
    const other = { programTitle: 'Shared by a friend', template: 'fsl' };
    const shareHash = '#s=' + Buffer.from(JSON.stringify(other)).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    let asked = 0;
    const declined = load({ url: 'https://andybryson.github.io/531/' + shareHash, idb: idbA, fakes: fakesFor(fakeAuth(true)), confirm: () => { asked++; return false; } });
    await wait(250);
    log('opening a share link while linked asks first', asked === 1);
    log('declining keeps the saved programme', declined.doc.getElementById('programTitle').value === 'Cycle 5 (phone edit)' && gdrive.json('programme.json', '531 Planner').programTitle === 'Cycle 5 (phone edit)');
    done(declined);
    const accepted = load({ url: 'https://andybryson.github.io/531/' + shareHash, idb: idbA, fakes: fakesFor(fakeAuth(true)), confirm: () => true });
    await wait(500);
    log('accepting uses the link and pushes it to programme.json', accepted.doc.getElementById('programTitle').value === 'Shared by a friend' && gdrive.json('programme.json', '531 Planner').programTitle === 'Shared by a friend');
    done(accepted);

    // device C: start from scratch keeps the old folder, renamed
    const C = load({ url: 'https://andybryson.github.io/531/', idb: new IDBFactory(), fakes: fakesFor(fakeAuth(false)) });
    await wait(150);
    driveBtn(C.doc, 'link').click();
    await wait(60);
    driveBtn(C.doc, 'scratch').click();
    await wait(200);
    const folders = Object.values(gdrive.files).filter(f => /^531 Planner/.test(f.name) && f.mimeType.includes('folder'));
    log('start from scratch renames the old folder with a date suffix', folders.some(f => f.name === '531 Planner (old ' + TODAY + ')' && f.appProperties.app !== '531-planner'));
    log('and creates a fresh folder from this device', folders.filter(f => f.name === '531 Planner' && f.appProperties.app === '531-planner').length === 1);
    const fresh = await gdrive.findFolder('531 Planner', '531-planner');
    const freshProg = JSON.parse(Object.values(gdrive.files).find(f => f.name === 'programme.json' && f.parents.includes(fresh.id)).content);
    log('the fresh folder holds this device\'s programme', freshProg.programTitle === '');
    driveBtn(C.doc, 'unlink').click();
    await wait(30);
    log('unlink returns to local only', C.doc.getElementById('syncPill').textContent === 'Local only' && !!driveBtn(C.doc, 'link'));
    done(C);

    // dev build keeps its own Drive folder
    const devDrive = new FakeDrive();
    const D = load({ url: 'https://andybryson.github.io/531/dev/', idb: new IDBFactory(), fakes: { drive: devDrive, auth: fakeAuth(false), syncDelayMs: 30 } });
    await wait(150);
    driveBtn(D.doc, 'link').click();
    await wait(150);
    log('dev links to its own "531 Planner (dev)" folder', !!devDrive.byName('531 Planner (dev)') && devDrive.byName('531 Planner (dev)').appProperties.app === '531-planner-dev' && !devDrive.byName('531 Planner'));
    done(D);
  }


  // the real Drive REST client, driven against a fake fetch that speaks enough of Drive v3
  {
    const { fetch: fakeFetch, reqs, files } = makeFakeDriveFetch();
    const R = load({ url: 'https://andybryson.github.io/531/#v=log', idb: new IDBFactory(), fakes: { auth: fakeAuth(false), syncDelayMs: 30 },
      beforeParse: w => { w.fetch = fakeFetch; } });
    await wait(150);
    rowBy(R.doc, 'main:3').querySelector('[data-act="tick"]').click();
    await wait(20);
    driveBtn(R.doc, 'link').click();
    await wait(200);
    log('REST: every request carries the bearer token', reqs.length > 0 && reqs.every(r => r.headers.Authorization === 'Bearer tok'));
    const find = reqs[0];
    log('REST: folder lookup searches by name, folder type and app tag', find.method === 'GET' && /name='531 Planner'/.test(find.url.searchParams.get('q')) && /appProperties has \{ key='app' and value='531-planner' \}/.test(find.url.searchParams.get('q')) && /trashed=false/.test(find.url.searchParams.get('q')));
    const mk = reqs.filter(r => r.method === 'POST' && r.url.pathname === '/drive/v3/files');
    log('REST: creates the folder (tagged) and the sessions subfolder', mk.length === 2 && JSON.parse(mk[0].body).appProperties.app === '531-planner' && JSON.parse(mk[1].body).name === 'sessions');
    const up = reqs.filter(r => r.url.pathname === '/upload/drive/v3/files' && r.url.searchParams.get('uploadType') === 'multipart');
    log('REST: programme.json and the session are created with multipart uploads', up.length === 2 && /programme\.json/.test(up[0].body) && new RegExp(TODAY + '\\.json').test(up[1].body));
    const sessFile = Object.values(files).find(f => f.name === TODAY + '.json');
    log('REST: uploaded session content round-trips as JSON', !!sessFile && JSON.parse(sessFile.content).entries.length === 1);
    rowBy(R.doc, 'main:4').querySelector('[data-act="tick"]').click();
    await wait(150);
    const patch = reqs.filter(r => r.method === 'PATCH' && r.url.searchParams.get('uploadType') === 'media');
    log('REST: a later change updates the file in place (PATCH, uploadType=media)', patch.length === 1 && JSON.parse(sessFile.content).entries.length === 2);
    log('REST: pill shows Synced', R.doc.getElementById('syncPill').textContent === 'Synced');
    done(R);
  }


  // the real Google Identity Services wrapper, with a fake GIS library and a test client ID
  {
    const { fetch: gfetch, reqs } = makeFakeDriveFetch();
    let tokenConfig = null, requested = [], closePopup = false;
    const fakeGoogle = { accounts: { oauth2: { initTokenClient: cfg => {
      tokenConfig = cfg;
      return { requestAccessToken: o => { requested.push(o); setTimeout(() => closePopup ? cfg.error_callback({ type: 'popup_closed' }) : cfg.callback({ access_token: 'gis-token', expires_in: 3599 }), 5); } };
    } } } };
    const G = load({ url: 'https://andybryson.github.io/531/', idb: new IDBFactory(),
      transform: withClientId('test-client.apps.googleusercontent.com'),
      beforeParse: w => {
        w.fetch = gfetch;
        // jsdom does not fetch external scripts: stand in for the GIS script loading
        new w.MutationObserver(muts => muts.forEach(m => m.addedNodes.forEach(nd => {
          if (nd.tagName === 'SCRIPT' && /accounts\.google\.com\/gsi\/client/.test(nd.src)) { w.google = fakeGoogle; setTimeout(() => nd.onload(), 5); }
        }))).observe(w.document, { childList: true, subtree: true });
      } });
    await wait(150);
    log('GIS: with a client ID set, Link to Google is enabled', !driveBtn(G.doc, 'link').disabled);
    log('GIS: the Google script is not loaded before linking', !G.doc.querySelector('script[src*="gsi/client"]'));
    closePopup = true;
    driveBtn(G.doc, 'link').click();
    await wait(80);
    log('GIS: closing the sign-in popup reports it and does not link', /Sign-in window closed/.test(G.doc.getElementById('googleBody').textContent) && !!driveBtn(G.doc, 'link'));
    closePopup = false;
    driveBtn(G.doc, 'link').click();
    await wait(200);
    log('GIS: token client uses the client ID and the drive.file scope', tokenConfig.client_id === 'test-client.apps.googleusercontent.com' && tokenConfig.scope === 'https://www.googleapis.com/auth/drive.file');
    log('GIS: the Google script is loaded once, on demand', G.doc.querySelectorAll('script[src="https://accounts.google.com/gsi/client"]').length === 1);
    log('GIS: access token requested with prompt ""', requested.length === 2 && requested[1].prompt === '');
    log('GIS: Drive requests use the token Google returned', reqs.length > 0 && reqs.every(r => r.headers.Authorization === 'Bearer gis-token'));
    const kept = JSON.parse(G.window.sessionStorage.getItem('531-planner-token'));
    log('GIS: token kept for this tab only (sessionStorage), with its expiry', kept.token === 'gis-token' && kept.expires > Date.now() + 3500 * 1000);
    log('GIS: linked and synced', G.doc.getElementById('syncPill').textContent === 'Synced');
    done(G);
  }


  // ---------------- programme kept out of the URL ----------------
  {
    const idb = new IDBFactory();
    const plan = { programTitle: 'From a link', template: 'fsl', lifts: { ohp: { mode: 'tm', value: 55, reps: 1 } } };
    const hash = '#s=' + Buffer.from(JSON.stringify(plan)).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    const A = load({ url: 'https://andybryson.github.io/531/dev/' + hash, idb });
    await wait(450);
    log('a share link is imported', A.doc.getElementById('programTitle').value === 'From a link' && A.doc.getElementById('templateSelect').value === 'fsl');
    log('then the programme is cleared from the address bar', A.window.location.hash === '' && !/s=/.test(A.window.location.href));
    setValue(A, A.doc.getElementById('programTitle'), 'Edited', 'input');
    await wait(350);
    log('editing the programme keeps it out of the URL', A.window.location.hash === '');
    A.doc.querySelector('#viewTabs [data-view="log"]').click();
    await wait(300);
    log('the URL carries only the view', A.window.location.hash === '#v=log');
    let copied = null;
    A.window.navigator.clipboard.writeText = t => { copied = t; return Promise.resolve(); };
    A.doc.querySelector('#viewTabs [data-view="plan"]').click();
    A.doc.getElementById('shareBtn').click();
    await wait(20);
    log('Copy share link copies a link with the programme in it', !!copied && copied.indexOf('https://andybryson.github.io/531/dev/#s=') === 0 && /Copied/.test(A.doc.getElementById('shareBtn').textContent));
    done(A);

    const B = load({ url: 'https://andybryson.github.io/531/dev/', idb });
    await wait(200);
    log('reopening with a bare URL loads the saved programme', B.doc.getElementById('programTitle').value === 'Edited');
    done(B);

    const C = load({ url: copied, idb: new IDBFactory() });
    await wait(200);
    log('the copied share link opens the same programme on another device', C.doc.getElementById('programTitle').value === 'Edited' && C.doc.getElementById('templateSelect').value === 'fsl');
    done(C);

    // without IndexedDB the URL is still the save file
    const M = load({ url: 'https://andybryson.github.io/531/' });
    await wait(150);
    setValue(M, M.doc.getElementById('programTitle'), 'Memory only', 'input');
    await wait(350);
    log('without IndexedDB, the programme stays in the URL as before', /^#s=/.test(M.window.location.hash));
    done(M);
  }


  // ---------------- "+ set": add sets to any block ----------------
  {
    const idb = new IDBFactory();
    const dom = load({ url: 'https://andybryson.github.io/531/#v=log', idb });
    const doc = dom.doc;
    await wait(150);
    const section = title => Array.from(doc.querySelectorAll('#logBody .log-section')).find(sec => sec.querySelector('h3').textContent === title);
    const addSet = title => section(title).querySelector('[data-act="addset"]');
    log('every block in the log has a + set button', Array.from(doc.querySelectorAll('#logBody .log-section')).every(sec => !!sec.querySelector('[data-act="addset"]')));

    // pull-up style split: 3 x 10-15 planned, done as sets of 5
    setValue(dom, doc.querySelector('#logBody [data-slot="acc:ex1:0"] [data-act="reps"]'), '5');
    await wait(20);
    for (let i = 0; i < 5; i++) { addSet('Dip').click(); await wait(10); }
    let added = section('Dip').querySelectorAll('.log-row.added');
    log('+ set adds a set to that block, copying the last one (5 reps, bodyweight)', added.length === 5 && Array.from(added).every(r => r.querySelector('[data-act="ereps"]').value === '5' && r.querySelector('[data-act="eweight"]').value === ''));
    log('added sets sit under their block, before its + set button', section('Dip').querySelector('.log-rows').lastElementChild.dataset.act === 'addset');
    setValue(dom, added[4].querySelector('[data-act="ereps"]'), '6');
    await wait(20);
    added[0].querySelector('[data-act="remove"]').click();
    await wait(30);
    let rec = await idbGet(idb, '531-planner', 'sessions', TODAY);
    const extras = rec.entries.filter(e => e.planned && e.planned.key === 'acc:ex1:extra');
    log('added sets are saved, editable and removable', extras.filter(e => !e.deleted).length === 4 && extras.filter(e => !e.deleted).some(e => e.reps === 6) && extras.some(e => e.deleted) && extras.every(e => e.exercise === 'Dip' && e.planned.kind === 'extra'));

    // main lift block: copies the last logged set's weight and reps
    rowBy(doc, 'main:3').querySelector('[data-act="tick"]').click();
    await wait(20);
    addSet('Overhead Press').click();
    await wait(20);
    const mainAdded = section('Overhead Press').querySelector('.log-row.added');
    const tickedWeight = rowBy(doc, 'main:3').querySelector('[data-act="weight"]').value;
    log('+ set on the main lift copies the last logged set', !!mainAdded && mainAdded.querySelector('[data-act="ereps"]').value === '5' && mainAdded.querySelector('[data-act="eweight"]').value === tickedWeight);

    // nothing logged yet in a block: copies its last planned set
    const before = section('Overhead Press').querySelectorAll('.log-row.added').length;
    // (main already has a logged set; use a fresh date for an empty block)
    const tomorrow = daysFrom(TODAY, 1);
    setValue(dom, doc.getElementById('logDate'), tomorrow);
    await wait(30);
    const firstTitle = doc.querySelector('#logBody .log-section h3').textContent;
    addSet(firstTitle).click();
    await wait(20);
    const lastPlanned = Array.from(section(firstTitle).querySelectorAll('[data-slot]')).pop();
    const fresh = section(firstTitle).querySelector('.log-row.added');
    log('+ set on an empty block copies its last planned set', before === 1 && !!fresh && fresh.querySelector('[data-act="eweight"]').value === lastPlanned.querySelector('[data-act="weight"]').value);
    setValue(dom, doc.getElementById('logDate'), TODAY);
    await wait(30);

    // ad hoc exercise block gets + set too
    setValue(dom, doc.getElementById('addExName'), 'Pull up', 'input');
    doc.getElementById('addExWeight').value = '';
    doc.getElementById('addExReps').value = '5';
    doc.getElementById('addExBtn').click();
    await wait(20);
    addSet('Pull up').click();
    await wait(20);
    log('an added exercise has + set as well', section('Pull up').querySelectorAll('.log-row.added').length === 2);
    done(dom);

    const again = load({ url: 'https://andybryson.github.io/531/#v=replay', idb });
    await wait(200);
    const card = again.doc.querySelectorAll('#replayView .day-card')[0];
    const dipList = Array.from(card.querySelectorAll('.section-label')).find(l => l.textContent === 'Dip').nextElementSibling;
    const dipAdded = Array.from(dipList.querySelectorAll('.replay-row')).filter(r => /added set/.test(r.textContent));
    log('replay lists added sets under their block with what was done', dipAdded.length === 4 && dipAdded.some(r => /6 × BW/.test(r.textContent)));
    done(again);
  }


  // ---------------- comments on every set ----------------
  {
    const idb = new IDBFactory();
    const dom = load({ url: 'https://andybryson.github.io/531/#v=log', idb });
    const doc = dom.doc;
    await wait(150);
    const entryFor = async key => (await idbGet(idb, '531-planner', 'sessions', TODAY)).entries.find(e => e.planned && e.planned.key === key && !e.deleted);
    // a warm-up, not yet logged: comment first, then tick
    rowBy(doc, 'main:0').querySelector('[data-act="more"]').click();
    await wait(10);
    const note0 = rowBy(doc, 'main:0').querySelector('[data-act="note"]');
    log('an unlogged set offers a comment field', !!note0 && /saved when you log/.test(note0.placeholder));
    setValue(dom, note0, 'bar felt heavy');
    rowBy(doc, 'main:0').querySelector('[data-act="tick"]').click();
    await wait(30);
    log('a comment typed before logging is saved with the set', (await entryFor('main:0')).note === 'bar felt heavy' && /bar felt heavy/.test(rowBy(doc, 'main:0').textContent));
    // a ticked work set: comment after
    rowBy(doc, 'main:3').querySelector('[data-act="tick"]').click();
    await wait(10);
    rowBy(doc, 'main:3').querySelector('[data-act="more"]').click();
    await wait(10);
    setValue(dom, rowBy(doc, 'main:3').querySelector('[data-act="note"]'), 'easy');
    await wait(30);
    log('a ticked set takes a comment', (await entryFor('main:3')).note === 'easy');
    // a skipped set keeps a comment
    rowBy(doc, 'main:6').querySelector('[data-act="more"]').click();
    await wait(10);
    setValue(dom, rowBy(doc, 'main:6').querySelector('[data-act="note"]'), 'short on time');
    rowBy(doc, 'main:6').querySelector('[data-act="skip"]').click();
    await wait(30);
    log('a skipped set keeps its comment', (await entryFor('main:6')).status === 'skipped' && (await entryFor('main:6')).note === 'short on time' && /Skipped · short on time/.test(rowBy(doc, 'main:6').textContent));
    // an added set
    const dipSec = () => Array.from(doc.querySelectorAll('#logBody .log-section')).find(sec => sec.querySelector('h3').textContent === 'Dip');
    dipSec().querySelector('[data-act="addset"]').click();
    await wait(20);
    dipSec().querySelector('.log-row.added [data-act="enotes"]').click();
    await wait(10);
    setValue(dom, dipSec().querySelector('.log-row.added [data-act="enote"]'), 'ring dips');
    await wait(30);
    log('an added set takes a comment', (await entryFor('acc:ex1:extra')).note === 'ring dips');
    done(dom);
    const R = load({ url: 'https://andybryson.github.io/531/#v=replay', idb });
    await wait(200);
    const txt = R.doc.getElementById('replayView').textContent;
    log('replay shows comments on ticked, skipped and added sets', /bar felt heavy/.test(txt) && /short on time/.test(txt) && /ring dips/.test(txt));
    done(R);
  }


  // ---------------- typed reps survive a tick ----------------
  {
    const idb = new IDBFactory();
    const dom = load({ url: 'https://andybryson.github.io/531/#v=log', idb });
    const doc = dom.doc;
    await wait(150);
    const entryFor = async key => (await idbGet(idb, '531-planner', 'sessions', TODAY)).entries.find(e => e.planned && e.planned.key === key && !e.deleted);
    // reps typed and committed, then ticked
    setValue(dom, rowBy(doc, 'main:4').querySelector('[data-act="reps"]'), '3');
    await wait(10);
    rowBy(doc, 'main:4').querySelector('[data-act="tick"]').click();
    await wait(30);
    let e4 = await entryFor('main:4');
    log('ticking after changing the reps keeps the typed reps', e4.status === 'ticked' && e4.reps === 3);
    log('the row still shows the typed reps and marks the set as changed', rowBy(doc, 'main:4').querySelector('[data-act="reps"]').value === '3' && rowBy(doc, 'main:4').classList.contains('changed') && /Done, 3 reps/.test(rowBy(doc, 'main:4').textContent));
    // reps typed but the field not yet blurred (no change event), then ticked
    rowBy(doc, 'main:3').querySelector('[data-act="reps"]').value = '4';
    rowBy(doc, 'main:3').querySelector('[data-act="tick"]').click();
    await wait(30);
    log('reps still in the field when tapping the tick are used', (await entryFor('main:3')).reps === 4);
    // an empty reps field ticks as planned
    rowBy(doc, 'main:0').querySelector('[data-act="tick"]').click();
    await wait(30);
    const e0 = await entryFor('main:0');
    log('with the reps field empty, tick logs the planned reps', e0.status === 'ticked' && e0.reps === 5 && rowBy(doc, 'main:0').classList.contains('done') && rowBy(doc, 'main:0').querySelector('[data-act="reps"]').value === '');
    // editing reps on a ticked set keeps it ticked
    setValue(dom, rowBy(doc, 'main:0').querySelector('[data-act="reps"]'), '4');
    await wait(30);
    log('changing the reps of a ticked set keeps it ticked', (await entryFor('main:0')).status === 'ticked' && (await entryFor('main:0')).reps === 4 && rowBy(doc, 'main:0').querySelector('.tick.on'));
    setValue(dom, rowBy(doc, 'main:0').querySelector('[data-act="reps"]'), '');
    await wait(30);
    log('clearing the reps of a ticked set goes back to the plan', (await entryFor('main:0')).reps === 5 && rowBy(doc, 'main:0').classList.contains('done'));
    done(dom);
  }

  console.log('\nFINAL total runtime errors:', totalErrors);
  if (totalErrors) process.exitCode = 1;
})();
