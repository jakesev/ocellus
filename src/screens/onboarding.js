// onboarding.js — lean, skippable, persistent first-run flow with a real baseline test.

import { el, svgIcon } from '../ui.js';
import { settings, setSetting, setOnboarded } from '../settings.js';
import { addSession } from '../db.js';
import { SHORT_PAGES, STORY_TITLE, pagesWordCount } from '../passages.js';

const PASSAGES = SHORT_PAGES;

const GOAL_LABELS = { finish: 'finish more books', study: 'get through study material', focus: 'improve focus', speed: 'read faster', comp: 'remember more' };

export function runOnboarding(host, { onDone }) {
  host.classList.remove('hidden');
  let step = 0;
  let goals = new Set(settings.goals || []);
  let dailyGoal = settings.dailyGoalMin || 10;
  let baselineWpm = null;
  let page = 0;
  let t0 = 0;
  let clockTimer = null;
  const TOTAL = 6;

  const finish = async (openImport = false) => {
    clearInterval(clockTimer);
    // Persist the answers so onboarding actually DOES something: goals colour
    // the coach's language, the daily target drives the Progress ring.
    setSetting('goals', [...goals]);
    setSetting('dailyGoalMin', dailyGoal);
    setOnboarded(true);
    if (baselineWpm) {
      try { await addSession({ bookId: null, bookTitle: 'Onboarding baseline', mode: 'natural', wpm: baselineWpm, words: pagesWordCount(PASSAGES), seconds: Math.round((Date.now() - t0) / 1000) }); } catch {}
    }
    host.classList.add('hidden');
    host.innerHTML = '';
    onDone({ openImport });
  };

  const render = () => {
    host.innerHTML = '';
    const top = el('div', { class: 'onb-top' },
      svgIcon('eye', 24),
      el('div', { class: 'onb-track' }, el('div', { style: { width: Math.round(((step + 1) / TOTAL) * 100) + '%' } })),
      el('button', { class: 'btn ghost small', onclick: () => finish() }, 'Skip'),
    );
    const body = el('div', { class: 'onb-body noscrollbar' });
    const foot = el('div', { class: 'onb-foot' });
    host.append(top, body, foot);

    const next = (label = 'Continue') => el('button', { class: 'btn primary', onclick: () => { step += 1; render(); } }, label);

    if (step === 0) {
      body.appendChild(el('div', { style: { flex: '1', display: 'flex', flexDirection: 'column', justifyContent: 'center', textAlign: 'center' } },
        el('div', { style: { margin: '0 auto 18px' } }, svgIcon('eye', 72)),
        el('div', { class: 'onb-h', text: 'Read faster.\nUnderstand more.' }),
        el('div', { class: 'onb-p', text: 'Ocellus turns your PDFs, EPUBs and documents into trainable books — with a pacer that guides your eyes and honest comprehension checks.' }),
      ));
      foot.appendChild(next('Get started'));
    }

    if (step === 1) {
      body.appendChild(el('div', { class: 'onb-h', text: 'Two ways to train' }));
      body.appendChild(el('div', { class: 'card', style: { marginBottom: '10px' } },
        el('div', { class: 'row', style: { gap: '9px', marginBottom: '6px' } }, svgIcon('book', 18), el('b', { text: 'Guided' })),
        el('div', { class: 'onb-p', style: { margin: '0' }, text: 'The full page stays visible while a moving guide paces your eyes line by line — like a finger under the words. Great for comprehension.' }),
      ));
      body.appendChild(el('div', { class: 'card' },
        el('div', { class: 'row', style: { gap: '9px', marginBottom: '6px' } }, svgIcon('gauge', 18), el('b', { text: 'Flash' })),
        el('div', { class: 'onb-p', style: { margin: '0' }, text: 'One word at a time at a fixed focus point, with the key letter tinted — your eyes never move, so the usual speed limit disappears.' }),
      ));
      body.appendChild(el('div', { class: 'onb-p', style: { marginTop: '12px' }, text: 'Speed only counts if meaning sticks — after sessions, optional AI quizzes check comprehension and the coach adjusts your pace.' }));
      foot.appendChild(next());
    }

    if (step === 2) {
      body.appendChild(el('div', { class: 'onb-h', text: 'What are you here for?' }));
      body.appendChild(el('div', { class: 'onb-p', text: 'Pick any that fit — this shapes your coach and the goal you’ll track.' }));
      const defs = [['finish', 'Finish more books'], ['study', 'Get through study material'], ['focus', 'Improve focus'], ['speed', 'Raw speed'], ['comp', 'Better comprehension']];
      defs.forEach(([k, label]) => body.appendChild(el('button', { class: 'pick-row' + (goals.has(k) ? ' on' : ''), onclick: (e) => {
        goals.has(k) ? goals.delete(k) : goals.add(k);
        e.currentTarget.classList.toggle('on', goals.has(k));
      } }, label)));

      body.appendChild(el('div', { class: 'eyebrow', text: 'Your daily reading goal' }));
      body.appendChild(el('div', { class: 'onb-p', style: { marginTop: '0' }, text: 'A gentle target — Progress tracks it and celebrates the streak.' }));
      const goalSeg = el('div', { class: 'seg' },
        ...[[5, '5 min'], [10, '10 min'], [20, '20 min'], [30, '30 min']].map(([v, label]) =>
          el('button', { class: dailyGoal === v ? 'on' : '', onclick: (e) => {
            dailyGoal = v;
            [...goalSeg.children].forEach((c) => c.classList.remove('on'));
            e.currentTarget.classList.add('on');
          } }, label)),
      );
      body.appendChild(goalSeg);
      foot.appendChild(next());
    }

    if (step === 3) {
      body.appendChild(el('div', { class: 'onb-h', text: 'Find your starting speed' }));
      body.appendChild(el('div', { class: 'onb-p', text: `Read the start of a short story ("${STORY_TITLE}") at your normal pace — no rush, no tricks. We time it and set the trainer just above your natural speed.` }));
      body.appendChild(el('div', { class: 'card', style: { display: 'flex', gap: '10px', alignItems: 'center' } },
        svgIcon('clock', 20),
        el('div', { style: { fontSize: '12px', color: 'var(--text3)', lineHeight: '1.5' }, text: 'Takes about a minute. The timer starts when the passage appears.' }),
      ));
      foot.appendChild(el('button', { class: 'btn primary', onclick: () => { step = 4; page = 0; t0 = Date.now(); render(); } }, 'Start the 1-minute test'));
      foot.appendChild(el('button', { class: 'btn ghost', style: { marginTop: '8px' }, onclick: () => {
        baselineWpm = null; setSetting('wpm', 250); step = 5; render();
      } }, 'Skip — start me at 250 WPM'));
    }

    if (step === 4) {
      const clock = el('span', { class: 'mono', style: { fontSize: '15px', fontWeight: '600' } }, '0:00');
      clearInterval(clockTimer);
      clockTimer = setInterval(() => {
        const t = Math.floor((Date.now() - t0) / 1000);
        clock.textContent = Math.floor(t / 60) + ':' + String(t % 60).padStart(2, '0');
      }, 500);
      body.appendChild(el('div', { class: 'row', style: { justifyContent: 'space-between', marginBottom: '12px' } },
        el('div', { class: 'row', style: { gap: '8px' } }, el('div', { style: { width: '8px', height: '8px', borderRadius: '50%', background: 'var(--accent)' } }), clock),
        el('span', { style: { fontSize: '11.5px', color: 'var(--text4)' }, text: `Passage ${page + 1} of ${PASSAGES.length}` }),
      ));
      body.appendChild(el('div', { style: { fontSize: '18px', lineHeight: '1.85', textWrap: 'pretty', flex: '1' }, text: PASSAGES[page] }));
      foot.appendChild(el('button', { class: 'btn primary', onclick: () => {
        if (page < PASSAGES.length - 1) { page += 1; render(); return; }
        clearInterval(clockTimer);
        const words = pagesWordCount(PASSAGES);
        const mins = Math.max(0.08, (Date.now() - t0) / 60000);
        baselineWpm = Math.min(700, Math.max(80, Math.round(words / mins)));
        const rec = [200, 250, 300, 350, 400].find((p) => p > baselineWpm) || 400;
        setSetting('wpm', rec);
        step = 5; render();
      } }, page < PASSAGES.length - 1 ? 'Next passage →' : 'I’m done'));
    }

    if (step === 5) {
      body.appendChild(el('div', { style: { flex: '1', display: 'flex', flexDirection: 'column', justifyContent: 'center', textAlign: 'center' } },
        el('div', { class: 'eyebrow', text: baselineWpm ? 'Your natural speed' : 'Starting point' }),
        el('div', { class: 'mono', style: { fontSize: '64px', fontWeight: '700', letterSpacing: '-2px', margin: '8px 0 2px' }, text: String(baselineWpm || 250) }),
        el('div', { style: { fontSize: '13px', color: 'var(--text3)' }, text: 'words per minute' }),
        el('div', { class: 'card', style: { marginTop: '22px', textAlign: 'left', display: 'flex', gap: '10px', alignItems: 'center' } },
          svgIcon('spark', 18),
          el('div', { style: { fontSize: '12.5px', color: 'var(--text3)', lineHeight: '1.5' },
            text: `Trainer set to ${settings.wpm} WPM — a stretch, not a strain. The coach nudges it as your comprehension proves out.` }),
        ),
      ));
      foot.appendChild(next('Nice — continue'));
    }

    if (step === 6 || step > 5) {
      const goalList = [...goals].map((g) => GOAL_LABELS[g]).filter(Boolean);
      const goalLine = goalList.length
        ? `You want to ${goalList.slice(0, 2).join(' and ')}. Your plan: ${settings.wpm} WPM · ${dailyGoal} min a day.`
        : `Your plan: ${settings.wpm} WPM · ${dailyGoal} min a day.`;
      body.appendChild(el('div', { style: { flex: '1', display: 'flex', flexDirection: 'column', justifyContent: 'center', textAlign: 'center' } },
        el('div', { style: { width: '64px', height: '64px', borderRadius: '20px', background: 'rgba(79,216,166,.14)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 16px', color: 'var(--good)' } }, svgIcon('check', 30)),
        el('div', { class: 'onb-h', text: 'Your plan is ready' }),
        el('div', { class: 'card', style: { textAlign: 'left', display: 'flex', gap: '10px', alignItems: 'center', marginBottom: '14px' } },
          svgIcon('spark', 18),
          el('div', { style: { fontSize: '12.5px', color: 'var(--text2)', lineHeight: '1.55' }, text: goalLine }),
        ),
        el('div', { class: 'onb-p', style: { margin: '0' }, text: 'Add your first book — PDF, EPUB, Word doc, pasted text, or photos of pages — or start with the built-in sample.' }),
      ));
      foot.appendChild(el('button', { class: 'btn primary', onclick: () => finish(true) }, 'Add my first book'));
      foot.appendChild(el('button', { class: 'btn ghost', style: { marginTop: '8px' }, onclick: () => finish() }, 'Explore the library'));
    }
  };

  render();
}
