// progress.js — real trends from real sessions: speed, volume, comprehension, coach.

import { el, svgIcon, toast, fmtK, fmtDate } from '../ui.js';
import { listSessions, listBooks } from '../db.js';
import { lineChart } from '../charts.js';
import { coachHeuristic } from '../ai.js';
import { settings, setSetting } from '../settings.js';

let tab = 'overview'; // overview | books | comprehension

export async function renderProgress(root, ctx) {
  root.innerHTML = '';
  const scroll = el('div', { class: 'screen-scroll fadein' });
  root.appendChild(scroll);

  scroll.appendChild(el('h1', { class: 'page-title', text: 'Progress' }));
  scroll.appendChild(el('p', { class: 'page-sub', text: 'Every number here comes from your real sessions.' }));

  const sessions = await listSessions();
  const books = await listBooks();

  if (!sessions.length) {
    scroll.appendChild(el('div', { class: 'empty-state' },
      svgIcon('chart', 38),
      el('div', { class: 't', text: 'No sessions yet' }),
      el('div', { class: 'd', text: 'Read for a couple of minutes in the trainer, or take a speed test — your trends start here.' }),
      el('button', { class: 'btn primary', style: { maxWidth: '240px', margin: '0 auto' }, onclick: () => ctx.navigate('library') }, 'Open the library'),
    ));
    return;
  }

  const seg = el('div', { class: 'seg', style: { marginBottom: '18px' } },
    ...[['overview', 'Overview'], ['books', 'Books'], ['comprehension', 'Quizzes']].map(([k, label]) =>
      el('button', { class: tab === k ? 'on' : '', onclick: () => { tab = k; renderProgress(root, ctx); } }, label)),
  );
  scroll.appendChild(seg);

  if (tab === 'books') return renderBooks(scroll, books, ctx);
  if (tab === 'comprehension') return renderQuizzes(scroll, sessions, ctx);
  renderOverview(scroll, sessions, books, ctx);
}

function dayKey(ts) { const d = new Date(ts); return d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate(); }

function renderOverview(scroll, sessions, books, ctx) {
  const today = dayKey(Date.now());
  const wordsToday = sessions.filter((s) => dayKey(s.date) === today && s.mode !== 'natural').reduce((n, s) => n + s.words, 0);
  const booksDone = books.filter((b) => b.pct >= 100).length;

  // streak: consecutive days (incl. today or yesterday) with any reading
  const days = new Set(sessions.filter((s) => s.mode !== 'natural').map((s) => dayKey(s.date)));
  let streak = 0;
  for (let d = new Date(); ; d.setDate(d.getDate() - 1)) {
    if (days.has(dayKey(d.getTime()))) streak += 1;
    else if (streak === 0 && dayKey(d.getTime()) === today) continue; // today empty is fine, check yesterday
    else break;
    if (streak > 400) break;
  }

  scroll.appendChild(el('div', { class: 'stat-tiles' },
    el('div', { class: 'stat-tile' }, el('div', { class: 'v mono', text: fmtK(wordsToday) }), el('div', { class: 'l', text: 'WORDS TODAY' })),
    el('div', { class: 'stat-tile' }, el('div', { class: 'v mono', text: String(streak) }), el('div', { class: 'l', text: 'DAY STREAK' })),
    el('div', { class: 'stat-tile' }, el('div', { class: 'v mono', text: String(booksDone) }), el('div', { class: 'l', text: 'BOOKS DONE' })),
  ));

  // ---- speed trend (weekly buckets, last 8 weeks) ----
  const WEEK = 7 * 86400000;
  const now = Date.now();
  const buckets = [];
  for (let k = 7; k >= 0; k--) buckets.push({ from: now - (k + 1) * WEEK, to: now - k * WEEK, natural: [], guided: [], flash: [] });
  for (const s of sessions) {
    const b = buckets.find((x) => s.date > x.from && s.date <= x.to);
    if (!b) continue;
    if (s.mode === 'natural') b.natural.push(s.wpm);
    else if (s.mode === 'flash') b.flash.push(s.wpm);
    else b.guided.push(s.wpm);
  }
  const avg = (a) => (a.length ? Math.round(a.reduce((x, y) => x + y, 0) / a.length) : null);
  const seriesOf = (key) => {
    const vals = buckets.map((b) => avg(b[key]));
    // carry last known value forward so the line is continuous
    let last = null;
    return vals.map((v) => { if (v != null) last = v; return last; }).filter((v, i, arr) => arr.some((x) => x != null) ? true : false);
  };
  const natural = seriesOf('natural').map((v) => v ?? NaN);
  const guided = seriesOf('guided').map((v) => v ?? NaN);
  const flash = seriesOf('flash').map((v) => v ?? NaN);

  const chartCard = el('div', { class: 'card chart-card', style: { marginTop: '14px' } });
  chartCard.appendChild(el('div', { class: 'row', style: { justifyContent: 'space-between', marginBottom: '10px' } },
    el('div', { style: { fontSize: '13px', fontWeight: '700' }, text: 'Speed trend · 8 weeks' }),
  ));
  const series = [
    { values: natural.filter((v) => !isNaN(v)), color: '#7E8CA8', label: 'Natural' },
    { values: guided.filter((v) => !isNaN(v)), color: settings.tint, label: 'Guided' },
    { values: flash.filter((v) => !isNaN(v)), color: '#FFB020', label: 'Flash' },
  ].filter((s) => s.values.length >= 1);
  chartCard.appendChild(el('div', { html: lineChart(series) }));
  chartCard.appendChild(el('div', { class: 'legend', style: { marginTop: '10px' } },
    ...series.map((s) => el('span', { class: 'k' }, el('span', { class: 'swatch', style: { background: s.color } }), `${s.label} · ${s.values[s.values.length - 1]} WPM`)),
  ));
  scroll.appendChild(chartCard);

  // ---- words per day (last 7 days) ----
  const week = [];
  for (let k = 6; k >= 0; k--) {
    const d = new Date(); d.setDate(d.getDate() - k);
    const key = dayKey(d.getTime());
    week.push({ label: d.toLocaleDateString(undefined, { weekday: 'short' }).slice(0, 2), words: sessions.filter((s) => dayKey(s.date) === key && s.mode !== 'natural').reduce((n, s) => n + s.words, 0), today: k === 0 });
  }
  const max = Math.max(...week.map((w) => w.words), 1);
  const bars = el('div', { class: 'week-bars' }, ...week.map((w) => el('div', { class: 'bar' + (w.today ? ' today' : '') },
    el('div', { style: { height: Math.max(4, Math.round((w.words / max) * 86)) + 'px' }, title: fmtK(w.words) + ' words' }),
    el('span', { class: 'd', text: w.label }),
  )));
  const weekTotal = week.reduce((n, w) => n + w.words, 0);
  scroll.appendChild(el('div', { class: 'card', style: { marginTop: '12px' } },
    el('div', { class: 'row', style: { justifyContent: 'space-between', marginBottom: '12px' } },
      el('div', { style: { fontSize: '13px', fontWeight: '700' }, text: 'Words this week' }),
      el('div', { class: 'mono', style: { fontSize: '13px', color: 'var(--text3)' }, text: fmtK(weekTotal) }),
    ),
    bars,
  ));

  // ---- coach ----
  const coach = coachHeuristic(sessions);
  const coachCard = el('div', { class: 'card', style: { marginTop: '12px' } });
  coachCard.appendChild(el('div', { class: 'row', style: { gap: '8px', marginBottom: '8px' } }, svgIcon('spark', 16), el('div', { style: { fontSize: '13px', fontWeight: '700' }, text: 'Coach' })));
  coachCard.appendChild(el('div', { style: { fontSize: '12.5px', color: 'var(--text3)', lineHeight: '1.55' }, text: coach.summary }));
  if (coach.recommendedWpm) {
    coachCard.appendChild(el('div', { class: 'row', style: { marginTop: '12px' } },
      el('button', { class: 'btn small primary', style: { background: 'var(--accent)', color: 'var(--on-accent)', border: 'none' }, onclick: () => {
        setSetting('wpm', coach.recommendedWpm);
        toast('Trainer set to ' + coach.recommendedWpm + ' WPM');
      } }, `Set trainer to ${coach.recommendedWpm} WPM`),
      coach.comprehension != null ? el('span', { class: 'mono', style: { fontSize: '11px', color: 'var(--text4)' }, text: `comprehension ${coach.comprehension}%` }) : null,
    ));
  }
  scroll.appendChild(coachCard);
}

function renderBooks(scroll, books, ctx) {
  const active = books.filter((b) => !b.archived);
  if (!active.length) {
    scroll.appendChild(el('div', { class: 'empty-state' }, el('div', { class: 't', text: 'No books yet' }), el('div', { class: 'd', text: 'Import something in the library first.' })));
    return;
  }
  active.forEach((b) => {
    const read = Math.round((b.words || 0) * (b.pct || 0) / 100);
    const minsLeft = b.pct >= 100 ? 0 : ((b.words - read) / Math.max(120, settings.wpm));
    scroll.appendChild(el('div', { class: 'card', style: { marginBottom: '10px', cursor: 'pointer' }, onclick: () => ctx.openReader(b.id) },
      el('div', { class: 'row', style: { justifyContent: 'space-between', marginBottom: '8px' } },
        el('div', { class: 'ellip', style: { fontSize: '14px', fontWeight: '700' }, text: b.title }),
        el('span', { class: 'badge', text: b.pct >= 100 ? 'Finished' : (b.pct > 0 ? 'Reading' : 'Not started') }),
      ),
      el('div', { class: 'row', style: { gap: '10px' } },
        el('div', { class: 'pbar' }, el('div', { style: { width: Math.max(2, b.pct || 0) + '%', background: b.pct >= 100 ? 'var(--good)' : 'var(--accent)' } })),
        el('span', { class: 'mono', style: { fontSize: '11px', color: 'var(--text3)' }, text: (b.pct || 0) + '%' }),
      ),
      el('div', { style: { fontSize: '11px', color: 'var(--text4)', marginTop: '7px' },
        text: `${fmtK(read)} / ${fmtK(b.words || 0)} words` + (b.pct >= 100 ? '' : ` · ≈ ${Math.max(1, Math.round(minsLeft))} min left at ${settings.wpm} WPM`) }),
    ));
  });
}

function renderQuizzes(scroll, sessions, ctx) {
  const quizzed = sessions.filter((s) => s.quizTotal > 0).slice().reverse();
  if (!quizzed.length) {
    scroll.appendChild(el('div', { class: 'empty-state' },
      svgIcon('quiz', 36),
      el('div', { class: 't', text: 'No quizzes yet' }),
      el('div', { class: 'd', text: 'Finish a reading session and take the comprehension check — results land here and feed the coach.' }),
    ));
    return;
  }
  const avg = Math.round(quizzed.reduce((n, s) => n + (s.quizScore / s.quizTotal) * 100, 0) / quizzed.length);
  scroll.appendChild(el('div', { class: 'card', style: { marginBottom: '12px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' } },
    el('div', {}, el('div', { style: { fontSize: '11px', color: 'var(--text4)' }, text: 'Average comprehension' }),
      el('div', { class: 'mono', style: { fontSize: '24px', fontWeight: '700', color: avg >= 80 ? 'var(--good)' : avg >= 60 ? 'var(--warn)' : '#FF5A47' }, text: avg + '%' })),
    el('div', { style: { fontSize: '11px', color: 'var(--text4)', textAlign: 'right' }, text: quizzed.length + ' quiz' + (quizzed.length === 1 ? '' : 'zes') }),
  ));
  quizzed.forEach((s) => {
    const pct = Math.round((s.quizScore / s.quizTotal) * 100);
    scroll.appendChild(el('div', { class: 'card', style: { marginBottom: '9px' } },
      el('div', { class: 'row', style: { justifyContent: 'space-between' } },
        el('div', { class: 'ellip', style: { fontSize: '13px', fontWeight: '700' }, text: s.bookTitle || 'Reading session' }),
        el('span', { class: 'mono', style: { fontWeight: '700', color: pct >= 80 ? 'var(--good)' : pct >= 60 ? 'var(--warn)' : '#FF5A47' }, text: pct + '%' }),
      ),
      el('div', { style: { fontSize: '11px', color: 'var(--text4)', marginTop: '4px' },
        text: `${s.quizScore}/${s.quizTotal} correct · ${s.wpm} WPM · ${s.mode} · ${fmtDate(s.date)}` }),
    ));
  });
}
