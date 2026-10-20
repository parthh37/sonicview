'use strict';
/*
 * Loads the app logic straight out of sonicview.html so tests run against the
 * exact file that ships. The inline <script> runs in a node:vm sandbox with a
 * tiny DOM stub: enough for the start-up code (event listeners, theme, saved
 * file) to run without error. No views are rendered.
 */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const HTML_PATH = path.join(__dirname, '..', '..', 'sonicview.html');

/* functions and constants the tests reach for; a rename in the app fails loudly here */
const EXPORTS = [
  'ip2n', 'n2ip', 'maskBits', 'isPrivate',
  'parseExp', 'buildModel', 'derive',
  'addrRanges', 'addrHosts', 'addrPure', 'addrValue', 'mergeRanges', 'addrCovers',
  'svcLeaves', 'svcValue', 'svcOverlap', 'svcCovers', 'overlaps',
  'ruleProblems', 'mainProblems', 'isDefaultRule', 'unusedObjects',
  'snapshot', 'diffModels', 'migrationCheck', 'csvCell',
];

/* every classic inline script, in page order; skips src= and data blocks (JSON, templates) */
function inlineScripts(html) {
  const out = [];
  for (const [, attrs, body] of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi)) {
    if (/\bsrc\s*=/i.test(attrs)) continue;
    const type = /\btype\s*=\s*["']?([^"'\s>]+)/i.exec(attrs)?.[1].toLowerCase();
    if (type && !['text/javascript', 'application/javascript'].includes(type)) continue;
    out.push(body);
  }
  return out;
}

function stubElement() {
  const el = {
    hidden: false, disabled: false, textContent: '', innerHTML: '', value: '', id: '',
    dataset: {}, style: {}, files: [],
    classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
    addEventListener() {}, removeEventListener() {}, dispatchEvent: () => true,
    appendChild: c => c, append() {}, prepend() {}, remove() {}, replaceChildren() {},
    setAttribute() {}, getAttribute: () => null, removeAttribute() {},
    querySelector: () => stubElement(), querySelectorAll: () => [], closest: () => null,
    focus() {}, blur() {}, click() {}, scrollIntoView() {},
    getBoundingClientRect: () => ({ x: 0, y: 0, top: 0, left: 0, width: 0, height: 0 }),
  };
  return el;
}

function memoryStorage() {
  const m = new Map();
  return {
    getItem: k => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => void m.set(k, String(v)),
    removeItem: k => void m.delete(k),
    clear: () => m.clear(),
  };
}

function makeSandbox() {
  const document = Object.assign(stubElement(), {
    title: '',
    documentElement: stubElement(),
    body: stubElement(),
    head: stubElement(),
    createElement: () => stubElement(),
    getElementById: () => stubElement(),
  });
  const sandbox = {
    console, atob, btoa, setTimeout, clearTimeout, URL, Blob, TextEncoder, TextDecoder,
    document,
    location: { hash: '', href: 'file:///sonicview.html', reload() {} },
    localStorage: memoryStorage(),
    navigator: { userAgent: 'node' },
    innerWidth: 1280, innerHeight: 800,
    addEventListener() {}, removeEventListener() {}, scrollTo() {},
    getComputedStyle: () => ({ colorScheme: 'light' }),
    requestAnimationFrame: fn => setTimeout(fn, 0),
  };
  sandbox.window = sandbox.self = sandbox;
  return vm.createContext(sandbox);
}

/**
 * Evaluate sonicview.html and return its logic functions plus helpers:
 *   useModel(m)  set the app's global model M (addrRanges, ruleProblems, ... read it)
 *   load(kv)     buildModel + derive, set as M, return the model
 *   evaluate(js) run an expression inside the sandbox (escape hatch)
 */
function loadSonicView(htmlPath = HTML_PATH) {
  const html = fs.readFileSync(htmlPath, 'utf8');
  const scripts = inlineScripts(html);
  if (!scripts.length) throw new Error(`No inline <script> found in ${htmlPath}`);
  const ctx = makeSandbox();
  scripts.forEach((code, i) => vm.runInContext(code, ctx, { filename: `sonicview.html#script${i}` }));

  const api = {};
  for (const name of EXPORTS) {
    try {
      api[name] = vm.runInContext(name, ctx);
    } catch (e) {
      throw new Error(`sonicview.html no longer defines "${name}" (update tests/helpers/harness.js)`);
    }
  }
  /* M is a top-level `let`: reachable from another script in the same context, not via globalThis */
  const bridge = vm.runInContext('({ get(){ return M; }, set(m){ M = m; } })', ctx);
  api.useModel = m => (bridge.set(m), m);
  api.model = () => bridge.get();
  api.load = kv => {
    const m = api.buildModel(kv);
    bridge.set(m);
    api.derive();
    return m;
  };
  api.evaluate = code => vm.runInContext(code, ctx);
  return api;
}

/*
 * Values made inside the sandbox come from another realm (other Array.prototype),
 * so assert.deepStrictEqual rejects them. plain() copies them into this realm.
 * Functions are dropped.
 */
function plain(v, seen = new Map()) {
  if (v === null || typeof v !== 'object') return v;
  if (seen.has(v)) return seen.get(v);
  const tag = Object.prototype.toString.call(v);
  let out;
  if (tag === '[object Array]') {
    seen.set(v, (out = []));
    for (const x of v) out.push(plain(x, seen));
  } else if (tag === '[object Map]') {
    seen.set(v, (out = new Map()));
    for (const [k, x] of v) out.set(plain(k, seen), plain(x, seen));
  } else if (tag === '[object Set]') {
    seen.set(v, (out = new Set()));
    for (const x of v) out.add(plain(x, seen));
  } else {
    seen.set(v, (out = {}));
    for (const [k, x] of Object.entries(v)) if (typeof x !== 'function') out[k] = plain(x, seen);
  }
  return out;
}

/** assert.deepStrictEqual that first copies `actual` out of the sandbox realm */
function eq(actual, expected, message) {
  require('node:assert/strict').deepEqual(plain(actual), expected, message);
}

module.exports = { loadSonicView, plain, eq, inlineScripts, HTML_PATH };
