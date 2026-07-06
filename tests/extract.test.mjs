import test from 'node:test';
import assert from 'node:assert/strict';
import { joinPdfLines, stripMarkdown, cleanTitle, kindForFile } from '../src/extract.js';

test('joinPdfLines rebuilds paragraphs across wrapped lines', () => {
  const text = joinPdfLines([
    'The Time Traveller was expounding a recondite',
    'matter to us across the table with great energy.',
    '',
    'His eyes shone.',
  ]);
  const paras = text.split('\n\n');
  assert.equal(paras.length, 2);
  assert.ok(paras[0].includes('recondite matter'));
});

test('joinPdfLines repairs hyphenated line breaks', () => {
  const text = joinPdfLines(['This is extra-', 'ordinary reading.']);
  assert.ok(text.includes('extraordinary'));
});

test('joinPdfLines drops bare page numbers', () => {
  const text = joinPdfLines(['Some text here that goes on.', '42', 'And continues after the page break.']);
  assert.ok(!/\b42\b/.test(text));
});

test('stripMarkdown keeps text, promotes headings to chapter markers', () => {
  const out = stripMarkdown('# Title\n\nSome **bold** and [a link](http://x) and `code`.');
  assert.ok(out.includes('### Title'));
  assert.ok(out.includes('Some bold and a link and code.'));
});

test('cleanTitle strips extension and underscores', () => {
  assert.equal(cleanTitle('my_great_book.v2.pdf'), 'my great book.v2');
  assert.equal(cleanTitle(''), 'Imported document');
});

test('kindForFile routes by extension and mime', () => {
  assert.equal(kindForFile({ name: 'a.pdf', type: '' }), 'pdf');
  assert.equal(kindForFile({ name: 'b.epub', type: '' }), 'epub');
  assert.equal(kindForFile({ name: 'c.docx', type: '' }), 'docx');
  assert.equal(kindForFile({ name: 'd.md', type: '' }), 'md');
  assert.equal(kindForFile({ name: 'e.txt', type: 'text/plain' }), 'text');
  assert.equal(kindForFile({ name: 'f.jpg', type: 'image/jpeg' }), 'photo');
  assert.equal(kindForFile({ name: 'g.xyz', type: '' }), null);
});
