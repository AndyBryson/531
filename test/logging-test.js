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

  console.log('\nFINAL total runtime errors:', totalErrors);
  if (totalErrors) process.exitCode = 1;
})();
