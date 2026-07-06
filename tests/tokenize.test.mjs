import test from 'node:test';
import assert from 'node:assert/strict';
import {
  paragraphsFromText, tokenize, detectChapters, orpIndex, tokenMs,
  sentenceStart, paraStartIndex, nextParaIndex, chaptersWithTokenIndex, estimateMinutes,
} from '../src/tokenize.js';

test('paragraphsFromText splits on blank lines and normalises whitespace', () => {
  const paras = paragraphsFromText('One  two\nthree.\n\n\nNext   para.\n');
  assert.equal(paras.length, 2);
  assert.equal(paras[0].s, 'One two three.');
  assert.equal(paras[1].s, 'Next para.');
});

test('tokenize never emits lone punctuation tokens', () => {
  const { tokens } = tokenize(paragraphsFromText('Hello — world … again — !\n\n— leading dash para.'));
  for (const t of tokens) {
    assert.match(t.w, /[\p{L}\p{N}]/u, `token "${t.w}" has no letters`);
  }
});

test('tokenize glues leading punctuation to the next word', () => {
  const { tokens } = tokenize([{ s: '— said the Doctor.' }]);
  assert.equal(tokens[0].w, '—said');
});

test('tokenize flags sentence and paragraph ends', () => {
  const { tokens } = tokenize([{ s: 'One two. Three four' }]);
  assert.equal(tokens[1].sEnd, true);   // "two."
  assert.equal(tokens[2].sEnd, false);  // "Three"
  assert.equal(tokens[3].pEnd, true);   // last of para
  assert.equal(tokens[3].sEnd, true);   // para end implies sentence end
});

test('image paragraphs become placeholder tokens', () => {
  const { tokens } = tokenize([{ s: 'Before.' }, { img: 'Fig 1' }, { s: 'After.' }]);
  assert.equal(tokens[1].img, 'Fig 1');
  assert.equal(tokens.length, 3);
});

test('orpIndex follows the Spritz length mapping (letters only)', () => {
  assert.equal(orpIndex('a'), 0);        // 1 letter → 1st
  assert.equal(orpIndex('to'), 1);       // 2-5 → 2nd
  assert.equal(orpIndex('house'), 1);
  assert.equal(orpIndex('reading'), 2);  // 6-9 → 3rd
  assert.equal(orpIndex('comprehension'), 3); // 13 letters → 4th
  assert.equal(orpIndex('“quote”'), 2);  // skips leading punctuation ⇒ letter index
});

test('orpIndex on punctuation-wrapped words lands on a letter', () => {
  const w = '“extraordinary!”';
  const i = orpIndex(w);
  assert.match(w[i], /[a-z]/i);
});

test('tokenMs gives more time to long words, numbers, sentence ends and paragraph ends', () => {
  const base = 200;
  const plain = tokenMs({ w: 'cat' }, base);
  const long = tokenMs({ w: 'extraordinarily' }, base);
  const num = tokenMs({ w: '1984' }, base);
  const sentence = tokenMs({ w: 'end.' }, base);
  const para = tokenMs({ w: 'end.', pEnd: true }, base);
  assert.equal(plain, base);
  assert.ok(long > plain, 'long word longer');
  assert.ok(num > plain, 'number longer');
  assert.ok(sentence > plain, 'sentence end longer');
  assert.ok(para > sentence, 'paragraph end longest');
});

test('tokenMs is flat when variable timing is off', () => {
  assert.equal(tokenMs({ w: 'extraordinarily.', pEnd: true }, 200, false), 200);
});

test('detectChapters finds CHAPTER/roman/numbered headings and skips front matter', () => {
  const paras = paragraphsFromText([
    'CONTENTS',
    'Chapter 1 The Start',
    'Body text that is long enough to not be a heading and keeps going for a while here.',
    'II. The Machine',
    'More body text follows here.',
  ].join('\n\n'));
  const chapters = detectChapters(paras);
  const titles = chapters.map((c) => c.title.toLowerCase());
  assert.ok(titles.some((t) => t.includes('contents')));
  assert.equal(chapters.find((c) => c.title.toLowerCase().includes('contents')).skip, true);
  assert.ok(titles.some((t) => t.includes('chapter 1')));
  assert.ok(titles.some((t) => t.includes('ii. the machine')));
});

test('detectChapters does not treat the pronoun "I" sentence as a chapter', () => {
  const paras = paragraphsFromText('I see.\n\nA normal paragraph of text goes on and on beyond heading length for sure, definitely long enough.');
  const chapters = detectChapters(paras);
  assert.ok(!chapters.some((c) => c.title === 'I see.'));
});

test('### markers become chapters', () => {
  const paras = paragraphsFromText('### I. Introduction\n\nSome text.\n\n### II. The Machine\n\nMore text.');
  const chapters = detectChapters(paras);
  assert.equal(chapters.filter((c) => c.title.startsWith('I')).length >= 2, true);
});

test('chaptersWithTokenIndex maps and dedupes non-increasing chapters', () => {
  const paras = [{ s: 'A a a.' }, { s: 'Chapter Two' }, { s: 'B b.' }];
  const { tokens, paraStart } = tokenize(paras);
  const chapters = chaptersWithTokenIndex([
    { title: 'Beginning', pIndex: 0 },
    { title: 'Chapter Two', pIndex: 1 },
  ], paraStart, tokens.length);
  assert.equal(chapters.length, 2);
  assert.equal(chapters[1].tIndex, 3);
});

test('navigation helpers: sentenceStart / paraStartIndex / nextParaIndex', () => {
  const { tokens } = tokenize([{ s: 'One two. Three four.' }, { s: 'Second para here.' }]);
  assert.equal(sentenceStart(tokens, 3), 2); // "four." → sentence starts at "Three"
  assert.equal(paraStartIndex(tokens, 3), 0);
  assert.equal(nextParaIndex(tokens, 0), 4); // first token of second para
});

test('estimateMinutes scales with wpm', () => {
  const { tokens } = tokenize([{ s: 'word '.repeat(300).trim() }]);
  const slow = estimateMinutes(tokens, 0, 150);
  const fast = estimateMinutes(tokens, 0, 600);
  assert.ok(slow > fast * 3.5 && slow < fast * 4.5);
});
