// engine.test.mjs — the scheduler must never burst-catch-up after a stall
// (the "shoots through the words" bug). Runs the real ReaderEngine with a
// controlled clock.
import test from 'node:test';
import assert from 'node:assert/strict';

// minimal DOM stubs (same approach as parse.test.mjs)
const noop = () => {};
const fakeCtx = { font: '', measureText: () => ({ width: 10 }) };
globalThis.document = {
  createElement: () => ({ getContext: () => fakeCtx }),
  addEventListener: noop,
  visibilityState: 'visible',
};
globalThis.window = globalThis;
globalThis.addEventListener = noop;
globalThis.localStorage = { getItem: () => null, setItem: noop, removeItem: noop };
globalThis.matchMedia = () => ({ matches: false, addEventListener: noop });
// navigator: Node's own is fine — keepAwake=false keeps the engine off wakeLock

// controlled clock
let NOW = 0;
globalThis.performance = { now: () => NOW };
const timers = [];
globalThis.setTimeout = (fn, ms) => { timers.push({ fn, at: NOW + Math.max(0, ms || 0) }); return timers.length; };
globalThis.clearTimeout = (id) => { if (timers[id - 1]) timers[id - 1].dead = true; };

function runUntil(t) {
  // fire due timers in time order until virtual time t
  for (;;) {
    const due = timers.filter((x) => !x.dead && !x.fired && x.at <= t).sort((a, b) => a.at - b.at)[0];
    if (!due) break;
    NOW = due.at;
    due.fired = true;
    due.fn();
  }
  NOW = t;
}

const { ReaderEngine, clampFlashLeft, nextFlashTarget } = await import('../src/reader.js');
const { settings, DEFAULTS } = await import('../src/settings.js');

test('flash words are centred by default (ORP stays optional)', () => {
  assert.equal(DEFAULTS.flashAlign, 'center');
});

test('nextFlashTarget keeps cadence through small timer jitter (honest WPM)', () => {
  // tick fired 40ms late at 200ms/word — cadence must NOT slip a full word
  const next = nextFlashTarget(1000, 1040, 200);
  assert.equal(next, 1200); // original schedule preserved → average stays 300wpm
});

test('nextFlashTarget compresses gently when moderately late, never below 0.6×', () => {
  // 250ms late: prev+dur (1200) is in the past vs now+0.6dur
  const next = nextFlashTarget(1000, 1250, 200);
  assert.equal(next, 1250 + 120); // now + 0.6×dur — catches up without flicker
});

test('nextFlashTarget re-anchors after a real stall (no burst, no penalty)', () => {
  const next = nextFlashTarget(1000, 1500, 200); // 2.5 words late
  assert.equal(next, 1700); // now + dur exactly
});

test('clampFlashLeft centres a short word on the pivot', () => {
  // frame 340, pivot at centre 170, word 60 wide with pivot 25 in
  const left = clampFlashLeft(170, 25, 60, 340, 14);
  assert.equal(left, 145);            // 170 - 25, no clamping needed
  assert.ok(left >= 14 && left + 60 <= 340 - 14);
});

test('clampFlashLeft never lets a long word spill off the right edge', () => {
  // ORP ~1/3 in: pivotCenter 90 of a 300-wide word, pivot on centre 170
  const frameW = 340, pad = 14, totalW = 300, pivotCenter = 90;
  const left = clampFlashLeft(170, pivotCenter, totalW, frameW, pad);
  assert.ok(left + totalW <= frameW - pad + 0.01, `right edge ${left + totalW} > ${frameW - pad}`);
  assert.ok(left >= pad);
});

test('clampFlashLeft never lets a word spill off the left edge', () => {
  const left = clampFlashLeft(170, 250, 300, 340, 14); // pivot far right in word
  assert.ok(left >= 14);
  assert.ok(left + 300 <= 340 - 14 + 0.01);
});

test('clampFlashLeft pins the start when a word is wider than the frame', () => {
  const left = clampFlashLeft(170, 100, 400, 340, 14); // totalW 400 > frame
  assert.equal(left, 14); // start visible; tail unavoidably clipped
});

function makeTokens(n) {
  return Array.from({ length: n }, (_, i) => ({ w: 'word', p: 0, sEnd: false, pEnd: i === n - 1 }));
}

test('steady playback advances at the configured rate', () => {
  settings.rampUp = false; settings.variableTiming = false; settings.chunk = 1; settings.keepAwake = false;
  const ticks = [];
  const eng = new ReaderEngine({ tokens: makeTokens(500), startIndex: 0, onTick: (i) => ticks.push({ i, at: NOW }) });
  eng.setWpm(300); // 200ms per word
  NOW = 0;
  eng.play();
  runUntil(2000);
  eng.pause();
  // ~10 words in 2s at 300wpm
  assert.ok(eng.i >= 9 && eng.i <= 11, 'advanced ' + eng.i);
});

test('a long stall re-anchors instead of bursting through words', () => {
  settings.rampUp = false; settings.variableTiming = false; settings.chunk = 1; settings.keepAwake = false;
  const eng = new ReaderEngine({ tokens: makeTokens(500), startIndex: 0, onTick: noop });
  eng.setWpm(300); // 200ms/word
  NOW = 0;
  eng.play();
  runUntil(1000);           // ~5 words in
  const before = eng.i;
  // simulate a 1.5s main-thread stall: time jumps, the pending timer fires late
  runUntil(2500);
  const afterStall = eng.i;
  // without the guard this would rapid-fire ~7 words; with it, the late timer
  // fires once and everything re-anchors
  assert.ok(afterStall - before <= Math.ceil(1500 / 200) + 1, `no runaway: +${afterStall - before}`);
  // and the NEXT words still take a full duration each (no zero-wait chain)
  const a = eng.i;
  runUntil(2500 + 200 * 3 + 10);
  assert.ok(eng.i - a >= 2 && eng.i - a <= 4, 'steady after stall: +' + (eng.i - a));
});

test('words display for at least ~their duration after a stall (no flicker-through)', () => {
  settings.rampUp = false; settings.variableTiming = false; settings.chunk = 1; settings.keepAwake = false;
  const times = [];
  const eng = new ReaderEngine({ tokens: makeTokens(500), startIndex: 0, onTick: () => times.push(NOW) });
  eng.setWpm(300);
  NOW = 0;
  eng.play();
  runUntil(800);
  runUntil(3000); // includes a jump
  eng.pause();
  const gaps = times.slice(1).map((t, k) => t - times[k]).filter((g) => g > 0);
  const tooFast = gaps.filter((g) => g < 200 * 0.45);
  assert.equal(tooFast.length, 0, 'ticks faster than half a word duration: ' + tooFast.join(','));
});
