// speed.js — natural reading-speed test. Times real reading, saves to real stats.

import { el, toast } from '../ui.js';
import { addSession, listSessions, listBooks, getBookText } from '../db.js';

// Two public-domain passages (Thoreau, Walden) — a stable, comparable baseline.
const PASSAGES = [
  'I went to the woods because I wished to live deliberately, to front only the essential facts of life, and see if I could not learn what it had to teach, and not, when I came to die, discover that I had not lived. I did not wish to live what was not life, living is so dear; nor did I wish to practise resignation, unless it was quite necessary.',
  'I wanted to live deep and suck out all the marrow of life, to live so sturdily and Spartan-like as to put to rout all that was not life, to cut a broad swath and shave close, to drive life into a corner, and reduce it to its lowest terms, and, if it proved to be mean, why then to get the whole and genuine meanness of it, and publish its meanness to the world; or if it were sublime, to know it by experience, and be able to give a true account of it.',
];

let stage = 'intro'; // intro | reading | result
let source = 'template';
let pages = PASSAGES;
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
  scroll.appendChild(el('p', { class: 'page-sub', text: 'Your natural pace — no pacing, no flashing. Read normally, then tap “I’m done”. This becomes your baseline trend.' }));

  const books = (await listBooks()).filter((b) => !b.archived && b.words > 300);
  scroll.appendChild(el('div', { class: 'eyebrow', text: 'Test source' }));
  const grid = el('div', { class: 'src-grid' });
  const tile = (key, t, d, disabled = false) => el('button', {
    class: 'src-tile', style: source === key ? { borderColor: 'var(--accent)', color: 'var(--accent)' } : disabled ? { opacity: '.5' } : {},
    onclick: () => { if (disabled) { toast('Add a book first'); return; } source = key; renderSpeed(root, ctx); },
  }, el('div', { class: 't', text: t }), el('div', { class: 'd', text: d }));
  grid.appendChild(tile('template', 'Built-in passage', 'Walden · comparable every time'));
  grid.appendChild(tile('book', 'From your book', books.length ? 'A fresh section of ' + books[0].title : 'Add a book first', !books.length));
  scroll.appendChild(grid);

  scroll.appendChild(el('button', { class: 'btn primary', style: { marginTop: '22px' }, onclick: async () => {
    if (source === 'book' && books.length) {
      const text = await getBookText(books[0].id);
      const paras = text ? text.paras.filter((p) => p.img == null).map((p) => p.s) : [];
      // take ~150 words per page from wherever the user is up to
      const startPara = Math.min(paras.length - 1, Math.max(0, Math.floor(paras.length * (books[0].pct || 0) / 100)));
      const chunk = paras.slice(startPara, startPara + 14).join('\n\n').split(/\s+/);
      if (chunk.length < 80) { pages = PASSAGES; }
      else pages = [chunk.slice(0, 160).join(' '), chunk.slice(160, 340).join(' ')].filter((p) => p.trim());
    } else pages = PASSAGES;
    page = 0; stage = 'reading'; t0 = Date.now();
    renderSpeed(root, ctx);
  } }, 'Start test'));

  scroll.appendChild(el('div', { style: { fontSize: '11px', color: 'var(--text4)', textAlign: 'center', marginTop: '12px', lineHeight: '1.5' },
    text: 'The timer starts when the passage appears. Distracted? Redo or discard — bad attempts never touch your stats.' }));
}

function renderReading(root, ctx) {
  const wrap = el('div', { class: 'screen-fixed fadein', style: { padding: '10px 22px calc(20px + env(safe-area-inset-bottom, 0px))' } });
  root.appendChild(wrap);

  const clock = el('span', { class: 'mono', style: { fontSize: '15px', fontWeight: '600' } }, '0:00');
  wrap.appendChild(el('div', { class: 'row', style: { justifyContent: 'space-between', padding: '4px 0 14px' } },
    el('div', { class: 'row', style: { gap: '8px' } }, el('div', { style: { width: '8px', height: '8px', borderRadius: '50%', background: 'var(--accent)' } }), clock),
    el('span', { style: { fontSize: '11.5px', color: 'var(--text4)' }, text: `Section ${page + 1} of ${pages.length}` }),
  ));

  clearInterval(elapsedTimer);
  elapsedTimer = setInterval(() => {
    const t = Math.floor((Date.now() - t0) / 1000);
    clock.textContent = Math.floor(t / 60) + ':' + String(t % 60).padStart(2, '0');
  }, 500);

  wrap.appendChild(el('div', { class: 'noscrollbar', style: { flex: '1', overflowY: 'auto', fontSize: '19px', lineHeight: '1.85', textWrap: 'pretty' }, text: pages[page] }));

  const last = page >= pages.length - 1;
  wrap.appendChild(el('div', { class: 'row', style: { marginTop: '16px' } },
    el('button', { class: 'btn ghost', style: { flex: '0 0 auto', width: 'auto', padding: '0 14px' }, onclick: () => { clearInterval(elapsedTimer); stage = 'intro'; renderSpeed(root, ctx); } }, 'Cancel'),
    el('button', { class: 'btn primary', style: { flex: '1' }, onclick: () => {
      if (!last) { page += 1; renderSpeed(root, ctx); return; }
      clearInterval(elapsedTimer);
      const words = pages.join(' ').trim().split(/\s+/).length;
      const mins = Math.max(0.05, (Date.now() - t0) / 60000);
      resultWpm = Math.min(900, Math.max(60, Math.round(words / mins)));
      stage = 'result';
      renderSpeed(root, ctx);
    } }, last ? 'I’m done' : 'Next section →'),
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
  scroll.appendChild(el('div', { style: { fontSize: '13px', color: 'var(--text3)' }, text: 'words per minute · without pacing' }));

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
    scroll.appendChild(el('div', { class: 'notice ok', style: { marginTop: '24px', textAlign: 'left' }, text: 'Baseline saved-to-be: train a few sessions and Progress will chart natural vs. trained speed.' }));
  }

  scroll.appendChild(el('button', { class: 'btn primary', style: { marginTop: '22px' }, onclick: async () => {
    const words = pages.join(' ').trim().split(/\s+/).length;
    await addSession({ bookId: null, bookTitle: source === 'book' ? 'From a book' : 'Walden passage', mode: 'natural', wpm: resultWpm, words, seconds: Math.round((Date.now() - t0) / 1000) });
    toast('Saved to your natural-speed trend');
    stage = 'intro';
    ctx.navigate('progress');
  } }, 'Save to my trend'));
  scroll.appendChild(el('div', { class: 'row', style: { marginTop: '10px' } },
    el('button', { class: 'btn', style: { flex: '1' }, onclick: () => { stage = 'reading'; page = 0; t0 = Date.now(); renderSpeed(root, ctx); } }, 'Redo'),
    el('button', { class: 'btn', style: { flex: '1' }, onclick: () => { stage = 'intro'; renderSpeed(root, ctx); toast('Attempt discarded — stats untouched'); } }, 'Discard'),
  ));
}
