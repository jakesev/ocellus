// tokenize.js — pure text processing: paragraphs → tokens, chapters, ORP, timing.
// No DOM access: unit-testable in Node.

const WORD_RE = /[\p{L}\p{N}]/u;

export function paragraphsFromText(text) {
  const clean = String(text || '')
    .replace(/\r/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/­/g, '') // soft hyphens
    .trim();
  return clean
    .split(/\n{2,}/)
    .map((s) => s.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .map((s) => ({ s }));
}

/**
 * paras: [{s: string, img?: caption}] → flat token list.
 * Tokens: {w, p (para index), sEnd, pEnd}
 * Punctuation-only fragments are glued to the previous word — never a lone token.
 * Image paras produce {img: caption, p} placeholder tokens.
 */
export function tokenize(paras) {
  const tokens = [];
  const paraStart = [];
  paras.forEach((para, p) => {
    paraStart[p] = tokens.length;
    if (para.img != null) {
      tokens.push({ w: '', p, img: para.img || 'Illustration', sEnd: true, pEnd: true });
      return;
    }
    const parts = String(para.s || '').trim().split(/\s+/).filter(Boolean);
    let pendingPrefix = '';
    for (const raw of parts) {
      if (!WORD_RE.test(raw)) {
        const last = tokens[tokens.length - 1];
        if (last && last.p === p && last.img == null) last.w += raw; // glue "—", "…" to previous word
        else pendingPrefix += raw; // para starts with punctuation → attach to next word
        continue;
      }
      tokens.push({ w: pendingPrefix + raw, p });
      pendingPrefix = '';
    }
    if (pendingPrefix) {
      const last = tokens[tokens.length - 1];
      if (last && last.p === p && last.img == null) last.w += pendingPrefix;
    }
    // flag sentence/paragraph ends
    for (let i = paraStart[p]; i < tokens.length; i++) {
      tokens[i].sEnd = /[.!?…]["'”’)\]]*$/.test(tokens[i].w);
    }
    if (tokens.length > paraStart[p]) {
      tokens[tokens.length - 1].pEnd = true;
      tokens[tokens.length - 1].sEnd = true;
    }
  });
  return { tokens, paraStart };
}

/**
 * Chapter detection over paragraphs.
 * Recognises: "### Title" markers (pre-tagged), CHAPTER/PART/BOOK/PROLOGUE…,
 * roman-numeral or numbered short headings, and ALL-CAPS short lines.
 * Returns [{title, pIndex, skip}] — skip marks front/back matter.
 */
export function detectChapters(paras) {
  const chapters = [];
  const HEAD = /^(chapter|part|book|section|prologue|epilogue|introduction|preface|foreword|afterword|appendix|conclusion)\b/i;
  const NUM = /^\d{1,3}\.?\s+\S.{0,60}$/;
  const FRONT = /^(contents|table of contents|copyright|dedication|acknowledg|about the author|title page|colophon|index|glossary|bibliography|references|notes)\b/i;

  paras.forEach((para, p) => {
    if (para.img != null) return;
    const s = para.s.trim();
    if (s.startsWith('### ')) {
      chapters.push({ title: s.slice(4).trim().slice(0, 80), pIndex: p, skip: false });
      return;
    }
    if (s.length > 72) return; // headings are short
    const words = s.split(/\s+/);
    if (words.length > 10) return;
    if (FRONT.test(s)) { chapters.push({ title: titleCase(s.slice(0, 80)), pIndex: p, skip: true }); return; }
    if (HEAD.test(s)) { chapters.push({ title: s.slice(0, 80), pIndex: p, skip: false }); return; }
    // Roman numeral heading: dot required right after the numeral ("IV." / "IV. The Sphinx"),
    // so the pronoun in "I see." never matches.
    const roman = s.match(/^([IVXLC]{1,7})\.\s*(.{0,60})$/);
    if (roman && words.length <= 8 && !/[.!?]$/.test(roman[2] || '')) {
      chapters.push({ title: s.slice(0, 80), pIndex: p, skip: false });
      return;
    }
    if (NUM.test(s) && words.length <= 8 && !/[.!?]$/.test(s.replace(/^\d+\./, '').trim())) {
      chapters.push({ title: s.slice(0, 80), pIndex: p, skip: false });
      return;
    }
    if (s === s.toUpperCase() && /[A-Z]/.test(s) && words.length <= 8 && s.length >= 4 && !/[.!?,]$/.test(s)) {
      chapters.push({ title: titleCase(s.slice(0, 80)), pIndex: p, skip: FRONT.test(s) });
    }
  });

  // A wall of "chapters" close together at the start is usually a table of contents — drop dupes.
  const seen = new Set();
  const filtered = chapters.filter((c) => {
    const k = c.title.toLowerCase();
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });

  if (!filtered.length || filtered[0].pIndex > 0) {
    filtered.unshift({ title: 'Beginning', pIndex: 0, skip: false });
  }
  return filtered;
}

/** Remove '### ' heading markers once chapters have been detected — the
 *  heading text stays as a normal paragraph. */
export function stripChapterMarkers(paras) {
  return paras.map((p) => (p.img != null || !p.s || !p.s.startsWith('### ') ? p : { ...p, s: p.s.slice(4) }));
}

function titleCase(s) {
  return s.toLowerCase().replace(/(^|\s)\S/g, (c) => c.toUpperCase());
}

/** Map chapters (para index) onto token indexes. */
export function chaptersWithTokenIndex(chapters, paraStart, tokenCount) {
  return chapters
    .map((c) => ({ ...c, tIndex: Math.min(paraStart[c.pIndex] ?? 0, Math.max(0, tokenCount - 1)) }))
    .filter((c, i, arr) => i === 0 || c.tIndex > arr[i - 1].tIndex);
}

/**
 * Split oversized chapters into "Title · n/N" parts at paragraph boundaries.
 * Two jobs: (1) navigation — a 90k-word chapter-less book still gets jumpable
 * sections; (2) performance — the guided view renders one chapter at a time,
 * so no chapter may put tens of thousands of spans in the DOM.
 */
export function splitLongChapters(chapters, paraStart, tokenCount, max = 6000) {
  const out = [];
  for (let k = 0; k < chapters.length; k++) {
    const c = chapters[k];
    const end = k + 1 < chapters.length ? chapters[k + 1].tIndex : tokenCount;
    const span = end - c.tIndex;
    if (c.skip || span <= max) { out.push(c); continue; }
    const parts = Math.ceil(span / max);
    const target = Math.ceil(span / parts);
    out.push({ ...c, title: `${c.title} · 1/${parts}` });
    let cursor = c.tIndex;
    for (let p = 2; p <= parts; p++) {
      const want = c.tIndex + target * (p - 1);
      // snap forward to the nearest paragraph start ≥ want (binary search)
      let lo = 0, hi = paraStart.length - 1, snap = -1;
      while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        if (paraStart[mid] >= want) { snap = paraStart[mid]; hi = mid - 1; }
        else lo = mid + 1;
      }
      if (snap < 0 || snap >= end || snap <= cursor) break; // no clean boundary left
      out.push({ ...c, title: `${c.title} · ${p}/${parts}`, tIndex: snap });
      cursor = snap;
    }
  }
  return out;
}

/**
 * Optimal Recognition Point — the letter the eye should land on.
 * Research (Spritz): eyes naturally fixate ~1/3 into a word; longer words → ORP
 * sits further left of centre. Index is over the full string but anchored to letters.
 */
export function orpIndex(word) {
  const w = String(word || '');
  const letters = [];
  for (let i = 0; i < w.length; i++) if (WORD_RE.test(w[i])) letters.push(i);
  if (!letters.length) return Math.max(0, Math.floor((w.length - 1) / 2));
  const n = letters.length;
  let k;
  if (n <= 1) k = 0;
  else if (n <= 5) k = 1;
  else if (n <= 9) k = 2;
  else if (n <= 13) k = 3;
  else k = 4;
  return letters[Math.min(k, n - 1)];
}

/**
 * Per-token display duration.
 * Variable timing (research-backed): long words +40–70%, numbers +60%,
 * clause punctuation ×~1.5, sentence ends ×~2.2, paragraph ends ×~2.6.
 */
export function tokenMs(token, baseMs, variable = true) {
  if (token.img != null) return baseMs; // images pause the reader separately
  if (!variable) return baseMs;
  const w = token.w || '';
  const len = w.replace(/[^\p{L}\p{N}]/gu, '').length;
  let m = 1;
  if (len >= 13) m += 0.7;
  else if (len >= 8) m += 0.4;
  if (/\d/.test(w)) m += 0.6;
  const sentenceEnd = /[.!?…]["'”’)\]]*$/.test(w);
  const clauseEnd = /[,;:—–]["'”’)\]]*$/.test(w);
  if (sentenceEnd) m += 1.2;
  else if (clauseEnd) m += 0.5;
  if (token.pEnd) m += 1.4;
  return Math.round(baseMs * m);
}

/** Estimated minutes to read `count` tokens at wpm with the variable-timing model. */
export function estimateMinutes(tokens, fromIndex, wpm, variable = true) {
  const base = 60000 / Math.max(60, wpm);
  let ms = 0;
  for (let i = Math.max(0, fromIndex); i < tokens.length; i++) ms += tokenMs(tokens[i], base, variable);
  return ms / 60000;
}

/** Start of the sentence containing index i. */
export function sentenceStart(tokens, i) {
  let k = Math.min(Math.max(0, i), tokens.length - 1);
  if (k === 0) return 0;
  k -= 1;
  while (k > 0 && !tokens[k].sEnd) k -= 1;
  return k === 0 ? 0 : k + 1;
}

/** Start of the paragraph containing index i (or the previous paragraph if already at start). */
export function paraStartIndex(tokens, i, prev = false) {
  let k = Math.min(Math.max(0, i), tokens.length - 1);
  const p = tokens[k].p;
  while (k > 0 && tokens[k - 1].p === p) k -= 1;
  if (prev && k > 0) {
    let j = k - 1;
    const pp = tokens[j].p;
    while (j > 0 && tokens[j - 1].p === pp) j -= 1;
    return j;
  }
  return k;
}

export function nextParaIndex(tokens, i) {
  let k = Math.min(Math.max(0, i), tokens.length - 1);
  const p = tokens[k].p;
  while (k < tokens.length - 1 && tokens[k].p === p) k += 1;
  return k;
}
