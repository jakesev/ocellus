// parse.test.mjs — actually import every browser module in Node (with a minimal
// DOM stub) so syntax errors can never ship. `node --check` silently skips ESM,
// which let a missing brace through once — this test is the real gate.
import test from 'node:test';
import assert from 'node:assert/strict';

// ---- minimal DOM/browser stubs so module-level code can run ----
const noop = () => {};
const fakeCtx = { font: '', measureText: () => ({ width: 10 }) };
const fakeEl = () => ({
  style: {}, dataset: {}, classList: { add: noop, remove: noop, toggle: noop },
  setAttribute: noop, appendChild: noop, addEventListener: noop, remove: noop,
  getContext: () => fakeCtx, querySelector: () => null, querySelectorAll: () => [],
  firstChild: null, sheet: { insertRule: noop, cssRules: [] },
});
globalThis.document = {
  createElement: fakeEl,
  createTextNode: () => ({}),
  getElementById: fakeEl,
  querySelector: () => null,
  querySelectorAll: () => [],
  addEventListener: noop,
  documentElement: { dataset: {}, style: { setProperty: noop }, classList: { toggle: noop } },
  head: { appendChild: noop, prepend: noop },
  body: { appendChild: noop },
  visibilityState: 'visible',
};
globalThis.addEventListener = noop;
globalThis.removeEventListener = noop;
globalThis.window = globalThis;
globalThis.location = { protocol: 'https:', href: 'https://test/', pathname: '/' };
globalThis.history = { pushState: noop, back: noop };
try { Object.defineProperty(globalThis, 'navigator', { value: { serviceWorker: undefined }, configurable: true }); } catch {}
globalThis.localStorage = { getItem: () => null, setItem: noop, removeItem: noop };
globalThis.matchMedia = () => ({ matches: false, addEventListener: noop });
globalThis.requestAnimationFrame = (fn) => setTimeout(fn, 0);
globalThis.indexedDB = { open: () => ({ onsuccess: null, onerror: null, onupgradeneeded: null }) };
globalThis.performance = globalThis.performance || { now: () => Date.now() };
globalThis.fetch = globalThis.fetch || (async () => ({ ok: false, json: async () => ({}) }));

const MODULES = [
  '../src/ui.js',
  '../src/settings.js',
  '../src/db.js',
  '../src/tokenize.js',
  '../src/extract.js',
  '../src/reader.js',
  '../src/ai.js',
  '../src/charts.js',
  '../src/sample.js',
  '../src/screens/library.js',
  '../src/screens/reader.js',
  '../src/screens/speed.js',
  '../src/screens/progress.js',
  '../src/screens/settings.js',
  '../src/screens/onboarding.js',
];

for (const mod of MODULES) {
  test(`module parses and loads: ${mod}`, async () => {
    await assert.doesNotReject(() => import(mod), `import of ${mod} failed`);
  });
}
