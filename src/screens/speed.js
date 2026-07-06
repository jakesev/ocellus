// speed.js — natural reading-speed test. Times real reading, saves to real stats.

import { el, toast } from '../ui.js';
import { addSession, listSessions, listBooks, getBookText } from '../db.js';
import { STORY_TITLE, STORY_PAGES, SHORT_PAGES, pagesWordCount } from '../passages.js';

let stage = 'intro'; // intro | reading | result
let source = 'story';   // story | book
let length = 'quick';   // quick | full
let pages = SHORT_PAGES;
let pagesLabel = STORY_TITLE;
let page = 0;
let t0 = 0;
let elapsedTimer = null;
let resultWpm = 0;

export async function renderSpeed(root, ctx) {
  root.innerHTML = '';
  if (stage === 'reading') return renderReading(root, ctx);
  if (stage === 'result') return renderResult(root, ctx);
  return renderIntro(root, ctx);
}

async function renderIntro(root, ctx) {
  const scroll = el('div', { class: 'screen-scroll fadein' });
  root.appendChild(scroll);
  scroll.appendChild(el('h1', { class: 'page-title', text: 'Check reading speed' }));
  scroll.appendChild(el('p', { class: 'page-sub', text: 'Your natural pace — no pacing, no flashing. Read normally, tap through, and your true WPM lands on the trend.' }));

  const books = (await listBooks()).filter((b) => !b.archived && b.words > 300);

  scroll.appendChild(el('div', { class: 'eyebrow', text: 'What you’ll read' }));
  const grid = el('div', { class: 'src-grid' });
  const tile = (key, t, d, disabled = false) => el('button', {
    class: 'src-tile', style: source === key ? { borderColor: 'var(--accent)' } : disabled ? { opacity: '.5' } : {},
    onclick: () => { if (disabled) { toast('Add a book first'); return; } source = key; renderSpeed(root, ctx); },
  }, el('div', { class: 't', style: source === key ? { color: 'var(--accent)' } : {}, text: t }), el('div', { class: 'd', text: d }));
  grid.appendChild(tile('story', 'A short story', `“${STORY_TITLE}” — same story every time, so results compare fairly`));
  grid.appendChild(tile('book', 'From your book', books.length ? 'A fresh section of ' + books[0].title : 'Add a book first', !books.length));
  scroll.appendChild(grid);

  if (source === 'story') {
    scroll.appendChild(el('div', { class: 'eyebrow', text: 'Length' }));
    const quickWords = pagesWordCount(SHORT_PAGES);
    const fullWords = pagesWordCount(STORY_PAGES);
    scroll.appendChild(el('div', { class: 'seg' },
      el('button', { class: length === 'quick' ? 'on' : '', onclick: () => { length = 'quick'; renderSpeed(root, ctx); } }, `Quick · ${quickWords} words`),
      el('button', { class: length === 'full' ? 'on' : '', onclick: () => { length = 'full'; renderSpeed(root, ctx); } }, `Full · ${fullWords} words`),
    ));
    scroll.appendChild(el('div', { style: { fontSize: '11px', color: 'var(--text4)', marginTop: '8px', lineHeight: '1.5' },
      text: length === 'full'
        ? 'Twice the reading — a steadier, more accurate measurement.'
        : 'About a minute. Pick Full for a more accurate number.' }));
  }

  scroll.appendChild(el('button', { class: 'btn primary', style: { marginTop: '22px' }, onclick: async () => {
    if (source === 'book' && books.length) {
      const text = await getBookText(books[0].id);
      const paras = text ? text.paras.filter((p) => p.img == null).map((p) => p.s) : [];
      const startPara = Math.min(Math.max(0, paras.length - 6), Math.max(0, Math.floor(paras.length * (books[0].pct || 0) / 100)));
      const words = paras.slice(startPara, startPara + 24).join('\n\n').split(/\s+/).filter(Boolean);
      if (words.length < 120) { pages = SHORT_PAGES; pagesLabel = STORY_TITLE; }
      else {
        const per = length === 'full' ? 180 : 110;
        const take = length === 'full' ? 2 : 2;
        pages = [];
        for (let k = 0; k < take && k * per < words.length; k++) pages.push(words.slice(k * per, (k + 1) * per).join(' '));
        pagesLabel = books[0].title;
      }
    } else {
      pages = length === 'full' ? STORY_PAGES : SHORT_PAGES;
      pagesLabel = STORY_TITLE;
    }
    page = 0; stage = 'reading'; t0 = Date.now();
    renderSpeed(root, ctx);
  } }, 'Start test'));

  scroll.appendChild(el('div', { style: { fontSize: '11px', color: 'var(--text4)', textAlign: 'center', marginTop: '12px', lineHeight: '1.5' },
    text: 'The timer starts when the text appears. Distracted? Redo or discard — bad attempts never touch your stats.' }));
}

function renderReading(root, ctx) {
  const wrap = el('div', { class: 'screen-fixed fadein', style: { padding: '10px 22px calc(20px + env(safe-area-inset-bottom, 0px))' } });
  root.appendChild(wrap);

  const clock = el('span', { class: 'mono', style: { fontSize: '15px', fontWeight: '600' } }, '0:00');
  wrap.appendChild(el('div', { class: 'row', style: { justifyContent: 'space-between', padding: '4px 0 10px' } },
    el('div', { class: 'row', style: { gap: '8px' } }, el('div', { style: { width: '8px', height: '8px', borderRadius: '50%', background: 'var(--accent)' } }), clock),
    el('span', { style: { fontSize: '11.5px', color: 'var(--text4)' }, text: pagesLabel }),
  ));

  // section dots — always know where you are and what's left
  wrap.appendChild(el('div', { class: 'row', style: { gap: '6px', justifyContent: 'center', paddingBottom: '12px' } },
    ...pages.map((_, k) => el('div', {
      style: { width: k === page ? '22px' : '7px', height: '7px', borderRadius: '4px', transition: 'width .2s', background: k < page ? 'var(--good)' : k === page ? 'var(--accent)' : 'var(--line2)' },
    })),
  ));

  clearInterval(elapsedTimer);
  elapsedTimer = setInterval(() => {
    const t = Math.floor((Date.now() - t0) / 1000);
    clock.textContent = Math.floor(t / 60) + ':' + String(t % 60).padStart(2, '0');
  }, 500);

  wrap.appendChild(el('div', { class: 'noscrollbar fadein', style: { flex: '1', overflowY: 'auto', fontSize: '19px', lineHeight: '1.85', textWrap: 'pretty' }, text: pages[page] }));

  const last = page >= pages.length - 1;
  wrap.appendChild(el('div', { style: { marginTop: '16px' } },
    el('button', { class: 'btn primary', onclick: () => {
      if (!last) { page += 1; renderSpeed(root, ctx); return; }
      clearInterval(elapsedTimer);
      const words = pagesWordCount(pages);
      const mins = Math.max(0.05, (Date.now() - t0) / 60000);
      resultWpm = Math.min(900, Math.max(60, Math.round(words / mins)));
      stage = 'result';
      renderSpeed(root, ctx);
    } }, last ? 'I’m done ✓' : `Next section  (${page + 1} of ${pages.length})  →`),
    el('button', { class: 'btn ghost', style: { marginTop: '8px' }, onclick: () => { clearInterval(elapsedTimer); stage = 'intro'; renderSpeed(root, ctx); } }, 'Cancel test'),
  ));
}

async function renderResult(root, ctx) {
  const scroll = el('div', { class: 'screen-scroll fadein', style: { textAlign: 'center' } });
  root.appendChild(scroll);

  const sessions = await listSessions();
  const trainer = sessions.filter((s) => (s.mode === 'guided' || s.mode === 'flash') && s.words >= 40);
  const trainerAvg = trainer.length ? Math.round(trainer.slice(-6).reduce((n, s) => n + s.wpm, 0) / Math.min(6, trainer.length)) : null;

  scroll.appendChild(el('div', { class: 'eyebrow', style: { marginTop: '20px' }, text: 'Your natural speed' }));
  scroll.appendChild(el('div', { class: 'mono', style: { fontSize: '72px', fontWeight: '700', letterSpacing: '-2px', lineHeight: '1', margin: '12px 0 2px' }, text: String(resultWpm) }));
  scroll.appendChild(el('div', { style: { fontSize: '13px', color: 'var(--text3)' }, text: `words per minute · ${pagesWordCount(pages)} words read` }));

  if (trainerAvg) {
    const delta = Math.round(((trainerAvg - resultWpm) / resultWpm) * 100);
    scroll.appendChild(el('div', { class: 'card', style: { marginTop: '24px', display: 'flex', justifyContent: 'space-between', textAlign: 'left' } },
      el('div', {},
        el('div', { style: { fontSize: '11px', color: 'var(--text4)' }, text: 'Trainer average' }),
        el('div', { class: 'mono', style: { fontSize: '20px', fontWeight: '600', color: 'var(--accent)' }, text: trainerAvg + ' WPM' }),
      ),
      el('div', { style: { textAlign: 'right' } },
        el('div', { style: { fontSize: '11px', color: 'var(--text4)' }, text: 'With Ocellus' }),
        el('div', { class: 'mono', style: { fontSize: '20px', fontWeight: '600', color: delta >= 0 ? 'var(--good)' : 'var(--warn)' }, text: (delta >= 0 ? '+' : '') + delta + '%' }),
      ),
    ));
  } else {
    scroll.appendChild(el('div', { class: 'notice ok', style: { marginTop: '24px', textAlign: 'left' }, text: 'Baseline captured. Train a few sessions and Progress will chart natural vs. trained speed.' }));
  }

  scroll.appendChild(el('button', { class: 'btn primary', style: { marginTop: '22px' }, onclick: async () => {
    await addSession({ bookId: null, bookTitle: pagesLabel, mode: 'natural', wpm: resultWpm, words: pagesWordCount(pages), seconds: Math.round((Date.now() - t0) / 1000) });
    toast('Saved to your natural-speed trend');
    stage = 'intro';
    ctx.navigate('progress');
  } }, 'Save to my trend'));
  scroll.appendChild(el('div', { class: 'row', style: { marginTop: '10px' } },
    el('button', { class: 'btn', style: { flex: '1' }, onclick: () => { stage = 'reading'; page = 0; t0 = Date.now(); renderSpeed(root, ctx); } }, 'Redo'),
    el('button', { class: 'btn', style: { flex: '1' }, onclick: () => { stage = 'intro'; renderSpeed(root, ctx); toast('Attempt discarded — stats untouched'); } }, 'Discard'),
  ));
}
