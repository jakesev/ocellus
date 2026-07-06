// settings.js (screen) — every control persists and is honoured by the reader.

import { el, toast, confirmDialog, downloadBlob } from '../ui.js';
import { settings, setSetting, resetSettings, setOnboarded } from '../settings.js';
import { listBooks, listSessions, clearSessions, listBookmarks, getBookText } from '../db.js';
import { aiHealth } from '../ai.js';

export async function renderSettings(root, ctx) {
  root.innerHTML = '';
  const scroll = el('div', { class: 'screen-scroll fadein' });
  root.appendChild(scroll);

  scroll.appendChild(el('h1', { class: 'page-title', text: 'Settings' }));
  scroll.appendChild(el('p', { class: 'page-sub', text: 'Saved instantly · applied live to the reader.' }));

  const rerender = () => renderSettings(root, ctx);

  const segRow = (title, desc, key, options) => el('div', { class: 'set-row' },
    el('div', { class: 'set-label' }, el('div', { class: 't', text: title }), desc ? el('div', { class: 'd', text: desc }) : null),
    el('div', { class: 'seg', style: { flex: '0 0 auto', minWidth: '150px' } },
      ...options.map(([val, label]) => el('button', { class: settings[key] === val ? 'on' : '', style: { padding: '8px 10px' },
        onclick: () => { setSetting(key, val); rerender(); } }, label))),
  );

  const toggleRow = (title, desc, key) => el('div', { class: 'set-row' },
    el('div', { class: 'set-label' }, el('div', { class: 't', text: title }), desc ? el('div', { class: 'd', text: desc }) : null),
    el('button', { class: 'toggle' + (settings[key] ? ' on' : ''), role: 'switch', 'aria-checked': String(!!settings[key]), 'aria-label': title,
      onclick: (e) => { setSetting(key, !settings[key]); e.currentTarget.classList.toggle('on', settings[key]); e.currentTarget.setAttribute('aria-checked', String(!!settings[key])); } }),
  );

  const section = (title, ...rows) => {
    scroll.appendChild(el('div', { class: 'eyebrow', text: title }));
    scroll.appendChild(el('div', { class: 'card', style: { padding: '2px 14px' } }, ...rows));
  };

  // ---- reading ----
  section('Reading',
    segRow('Default mode', 'How books open', 'readMode', [['guided', 'Guided'], ['flash', 'Flash']]),
    segRow('Words per flash', 'Train peripheral vision with 2–3', 'chunk', [[1, '1'], [2, '2'], [3, '3']]),
    toggleRow('Natural rhythm', 'Longer words & sentence ends get more time — keeps comprehension up', 'variableTiming'),
    toggleRow('Ease in on play', 'Brief countdown + ramp to speed', 'rampUp'),
    toggleRow('Pause at illustrations', 'Stop where the original had an image', 'pauseOnImages'),
  );

  // ---- guided pacer ----
  section('Guided pacer',
    segRow('Guide style', 'What your eyes follow', 'guideStyle', [['underline', 'Line'], ['word', 'Word'], ['band', 'Band'], ['dot', 'Dot']]),
    segRow('Intensity', null, 'guideIntensity', [['subtle', 'Subtle'], ['medium', 'Med'], ['strong', 'Strong']]),
    segRow('Dim other paragraphs', 'Keeps focus on the active line', 'dimOthers', [['off', 'Off'], ['light', 'Light'], ['medium', 'More']]),
    toggleRow('Auto-scroll', 'Keep the active line in view', 'autoScroll'),
  );

  // ---- flash trainer ----
  section('Flash trainer',
    segRow('Focus letter', 'Tints the letter your eye should land on', 'flashMarker', [['off', 'Off'], ['subtle', 'Subtle'], ['strong', 'Strong']]),
    toggleRow('Alignment guide', 'Faint vertical line at the focus point', 'centerGuide'),
  );

  // ---- appearance ----
  const tints = ['#FF5A47', '#4D9BFF', '#FFB020', '#4FD8A6'];
  const tintRow = el('div', { class: 'set-row' },
    el('div', { class: 'set-label' }, el('div', { class: 't', text: 'Accent colour' }), el('div', { class: 'd', text: 'Also colours the reading guide' })),
    el('div', { class: 'row', style: { gap: '9px' } }, ...tints.map((c) => el('button', {
      'aria-label': 'Accent ' + c,
      style: { width: '30px', height: '30px', borderRadius: '50%', border: settings.tint === c ? '2px solid var(--text)' : '2px solid transparent', background: c, cursor: 'pointer', boxShadow: settings.tint === c ? `0 0 0 3px color-mix(in srgb, ${c} 35%, transparent)` : 'none' },
      onclick: () => { setSetting('tint', c); rerender(); },
    }))),
  );
  section('Appearance',
    segRow('Theme', null, 'theme', [['dark', 'Dark'], ['light', 'Light'], ['auto', 'Auto']]),
    tintRow,
    segRow('Reading font size', null, 'fontSize', [['S', 'S'], ['M', 'M'], ['L', 'L'], ['XL', 'XL']]),
    segRow('Line spacing', 'Guided mode', 'lineSpacing', [['compact', 'Tight'], ['comfortable', 'Comfy'], ['spacious', 'Airy']]),
  );

  // ---- comprehension ----
  section('Comprehension',
    toggleRow('Offer a quiz after sessions', 'AI writes questions from the exact text you read', 'autoQuiz'),
    segRow('Quiz length', null, 'quizLength', [[3, '3'], [5, '5'], [8, '8']]),
  );

  // ---- device ----
  section('Device',
    toggleRow('Keep screen awake', 'While the reader is playing', 'keepAwake'),
    toggleRow('Haptics', 'Small taps on milestones (Android)', 'haptics'),
  );

  // ---- AI status ----
  const aiRow = el('div', { class: 'set-row' },
    el('div', { class: 'set-label' },
      el('div', { class: 't', text: 'AI server' }),
      el('div', { class: 'd', text: 'Checking…' })),
    el('button', { class: 'btn small', onclick: async (e) => {
      e.currentTarget.textContent = '…';
      await refreshAi(true);
    } }, 'Re-check'),
  );
  async function refreshAi(force) {
    const h = await aiHealth(force);
    const d = aiRow.querySelector('.d');
    d.textContent = h.ok ? `Connected · ${h.model || 'Gemma'} · quizzes, OCR & assistant available` : (h.error || 'Offline');
    d.style.color = h.ok ? 'var(--good)' : 'var(--warn)';
    aiRow.querySelector('button').textContent = 'Re-check';
  }
  section('AI',
    aiRow,
    el('div', { class: 'set-row' },
      el('div', { class: 'set-label' },
        el('div', { class: 't', text: 'Privacy' }),
        el('div', { class: 'd', text: 'Books and stats live in this browser. AI requests go only to your own local server; the Gemma key never leaves it.' })),
    ),
  );
  refreshAi(false);

  // ---- data ----
  section('Data',
    el('div', { class: 'set-row' },
      el('div', { class: 'set-label' }, el('div', { class: 't', text: 'Export reading stats' }), el('div', { class: 'd', text: 'Sessions & quiz scores as CSV' })),
      el('button', { class: 'btn small', onclick: exportStats }, 'CSV'),
    ),
    el('div', { class: 'set-row' },
      el('div', { class: 'set-label' }, el('div', { class: 't', text: 'Export everything' }), el('div', { class: 'd', text: 'Books, bookmarks, stats & settings as JSON backup' })),
      el('button', { class: 'btn small', onclick: exportAll }, 'JSON'),
    ),
    el('div', { class: 'set-row' },
      el('div', { class: 'set-label' }, el('div', { class: 't', text: 'Export notes & bookmarks' }), el('div', { class: 'd', text: 'Markdown, grouped by book' })),
      el('button', { class: 'btn small', onclick: exportNotes }, 'MD'),
    ),
    el('div', { class: 'set-row' },
      el('div', { class: 'set-label' }, el('div', { class: 't', text: 'Reset reading stats' }), el('div', { class: 'd', text: 'Clears sessions & quiz history. Books stay.' })),
      el('button', { class: 'btn small danger', onclick: async () => {
        if (await confirmDialog({ title: 'Reset stats?', message: 'All sessions and quiz results will be deleted. Your books and bookmarks stay.', okLabel: 'Reset', danger: true })) {
          await clearSessions(); toast('Stats reset');
        }
      } }, 'Reset'),
    ),
    el('div', { class: 'set-row' },
      el('div', { class: 'set-label' }, el('div', { class: 't', text: 'Replay onboarding' }), el('div', { class: 'd', text: 'See the intro again' })),
      el('button', { class: 'btn small', onclick: () => { setOnboarded(false); location.reload(); } }, 'Replay'),
    ),
    el('div', { class: 'set-row' },
      el('div', { class: 'set-label' }, el('div', { class: 't', text: 'Reset settings' }), el('div', { class: 'd', text: 'Back to defaults (books & stats untouched)' })),
      el('button', { class: 'btn small', onclick: () => { resetSettings(); toast('Settings reset'); rerender(); } }, 'Reset'),
    ),
  );

  scroll.appendChild(el('div', { style: { textAlign: 'center', fontSize: '11px', color: 'var(--text5)', padding: '18px 0 6px' } },
    'Ocellus · local-first speed reader'));

  async function exportStats() {
    const sessions = await listSessions();
    if (!sessions.length) { toast('No sessions to export yet'); return; }
    const rows = [['date', 'book', 'mode', 'wpm', 'words', 'seconds', 'quiz_score', 'quiz_total']];
    for (const s of sessions) {
      rows.push([new Date(s.date).toISOString(), csv(s.bookTitle || ''), s.mode, s.wpm, s.words, s.seconds || '', s.quizScore ?? '', s.quizTotal ?? '']);
    }
    downloadBlob('ocellus-stats.csv', rows.map((r) => r.join(',')).join('\n'), 'text/csv;charset=utf-8');
    toast('Stats exported');
  }
  function csv(v) { return /[",\n]/.test(v) ? '"' + String(v).replace(/"/g, '""') + '"' : v; }

  async function exportAll() {
    const [books, sessions, bookmarks] = await Promise.all([listBooks(), listSessions(), listBookmarks()]);
    const texts = {};
    for (const b of books) texts[b.id] = await getBookText(b.id);
    downloadBlob('ocellus-backup.json', JSON.stringify({ exportedAt: new Date().toISOString(), settings, books, texts, sessions, bookmarks }, null, 2), 'application/json');
    toast('Backup exported');
  }

  async function exportNotes() {
    const [books, bookmarks] = await Promise.all([listBooks(), listBookmarks()]);
    if (!bookmarks.length) { toast('No bookmarks yet — add some in the reader'); return; }
    let md = '# Ocellus — bookmarks & notes\n';
    for (const b of books) {
      const marks = bookmarks.filter((m) => m.bookId === b.id);
      if (!marks.length) continue;
      md += `\n## ${b.title}${b.author ? ' — ' + b.author : ''}\n\n`;
      for (const m of marks) md += `- “${m.snippet}…” (${new Date(m.createdAt).toLocaleDateString()})\n`;
    }
    downloadBlob('ocellus-notes.md', md, 'text/markdown;charset=utf-8');
    toast('Notes exported');
  }
}
