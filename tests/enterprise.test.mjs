// enterprise.test.mjs — chapter splitting (scale) + coach gating (honesty).
import test from 'node:test';
import assert from 'node:assert/strict';
import { splitLongChapters, tokenize, paragraphsFromText } from '../src/tokenize.js';

// ---- splitLongChapters ----
function fakeBook(paraWords, paraCount) {
  const text = Array.from({ length: paraCount }, (_, i) => (`p${i} ` + 'word '.repeat(paraWords - 1)).trim()).join('\n\n');
  const paras = paragraphsFromText(text);
  return tokenize(paras);
}

test('splitLongChapters leaves small chapters alone', () => {
  const { tokens, paraStart } = fakeBook(50, 10); // 500 tokens
  const chapters = [{ title: 'Only', tIndex: 0, skip: false }];
  const out = splitLongChapters(chapters, paraStart, tokens.length, 6000);
  assert.deepEqual(out.map((c) => c.title), ['Only']);
});

test('splitLongChapters splits an oversized chapter at paragraph starts', () => {
  const { tokens, paraStart } = fakeBook(100, 100); // 10k tokens, paras every 100
  const chapters = [{ title: 'Beginning', tIndex: 0, skip: false }];
  const out = splitLongChapters(chapters, paraStart, tokens.length, 4000);
  assert.ok(out.length >= 2 && out.length <= 4, 'got ' + out.length + ' parts');
  assert.match(out[0].title, /Beginning · 1\/\d/);
  // strictly increasing, all on paragraph boundaries, spans ≤ max+paraWords
  for (let i = 1; i < out.length; i++) {
    assert.ok(out[i].tIndex > out[i - 1].tIndex, 'increasing');
    assert.ok(paraStart.includes(out[i].tIndex), 'on a paragraph start');
    assert.ok(out[i].tIndex - out[i - 1].tIndex <= 4100, 'span bounded');
  }
});

test('splitLongChapters never splits skip chapters and keeps later chapters', () => {
  const { tokens, paraStart } = fakeBook(100, 100); // 10k tokens
  const chapters = [
    { title: 'Front', tIndex: 0, skip: true },
    { title: 'One', tIndex: 5000, skip: false },
  ];
  const out = splitLongChapters(chapters, paraStart, tokens.length, 3000);
  assert.equal(out[0].title, 'Front'); // untouched despite 5000-token span
  assert.ok(out.filter((c) => c.title.startsWith('One')).length >= 2, 'One was split');
});

// ---- coachHeuristic (research gate: never push past 500 WPM; ease off on weak comprehension) ----
const { coachHeuristic } = await import('../src/ai.js');
const sess = (wpm, q) => ({ mode: 'guided', words: 500, wpm, quizScore: q == null ? undefined : q, quizTotal: q == null ? undefined : 5 });

test('coach holds with fewer than 2 sessions', () => {
  const c = coachHeuristic([sess(300, 5)]);
  assert.equal(c.recommendedWpm, null);
});

test('coach nudges +25 when comprehension ≥80%', () => {
  const c = coachHeuristic([sess(300, 4), sess(300, 5), sess(300, 4)]);
  assert.equal(c.recommendedWpm, 325);
});

test('coach eases off when comprehension is weak', () => {
  const c = coachHeuristic([sess(300, 2), sess(300, 2), sess(300, 3)]);
  assert.equal(c.recommendedWpm, 275);
});

test('coach consolidates at 500 WPM even with strong comprehension', () => {
  const c = coachHeuristic([sess(500, 5), sess(500, 5), sess(500, 5)]);
  assert.equal(c.recommendedWpm, 500); // never recommends past the research line
  assert.match(c.summary, /500/);
});

test('coach never recommends below 150', () => {
  const c = coachHeuristic([sess(150, 0), sess(150, 1), sess(150, 0)]);
  assert.equal(c.recommendedWpm, 150);
});