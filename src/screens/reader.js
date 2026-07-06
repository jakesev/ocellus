// reader.js (screen) — guided pacer + ORP flash trainer over a real book.

import { el, svgIcon, toast, openSheet, vibrate, fmtTimeLeft, fmtK } from '../ui.js';
import { settings, setSetting, onSettings } from '../settings.js';
import { ReaderEngine, setActiveEngine, orpLayout } from '../reader.js';
import { orpIndex, estimateMinutes, tokenMs } from '../tokenize.js';
import { updateBookMeta, addSession, attachQuizToLastSession, addBookmark, listBookmarks, deleteBookmark } from '../db.js';
import { aiHealth, aiQuiz, aiAssist } from '../ai.js';

const FONT_GUIDED = { S: 15, M: 17, L: 19, XL: 21 };
const FONT_FLASH = { S: 38, M: 46, L: 52, XL : 58 };
const LINE = { compact: 1.55, comfortable: 1.8, spacious: 2.05 };

export function openReaderScreen(root, ctx, book, { index } = {}) {
  // book: {meta, paras, chapters(tIndex'd), tokens, paraStart}
  const meta = book.meta;
  const tokens = book.tokens;
  const startIndex = typeof index === 'number' ? index : (meta.pos || 0);
  const sessionFrom = Math.min(startIndex, tokens.length - 1);

  root.innerHTML = '';
  const wrap = el('div', { class: 'screen-fixed fadein' });
  root.appendChild(wrap);

  let mode = settings.readMode === 'flash' ? 'flash' : 'guided';
  let disposed = false;
  let unsub = null;
  let bookmarks = [];
  listBookmarks(meta.id).then((m) => { bookmarks = m; updateBookmarkBtn(); });

  // ---------- engine ----------
  const engine = new ReaderEngine({
    tokens,
    startIndex,
    onTick: (i, tok) => onTick(i, tok),
    onPauseAt: (tok, reason) => { if (reason === 'image') showImageCard(tok); },
    onDone: () => onSessionEnd(),
    onPlayState: (playing) => {
      playBtn.replaceChildren(svgIcon(playing ? 'pause' : 'play', 25));
      playBtn.setAttribute('aria-label', playing ? 'Pause' : 'Play');
      if (playing) hideCards();
    },
  });
  engine.setWpm(settings.wpm);
  setActiveEngine(engine);

  // ---------- top bar ----------
  const bookmarkBtn = el('button', { class: 'icon-btn', 'aria-label': 'Bookmark this spot', onclick: () => toggleBookmark() }, svgIcon('bookmark', 16));
  const chapterLabel = el('div', { class: 'c' }, el('span', { text: 'Loading' }), svgIcon('chevD', 11));
  wrap.appendChild(el('div', { class: 'reader-top' },
    el('button', { class: 'icon-btn', 'aria-label': 'Close reader', onclick: () => close() }, svgIcon('close', 16)),
    el('button', { class: 'reader-title-btn', onclick: () => openContents() },
      el('div', { class: 't ellip', text: meta.title }),
      chapterLabel,
    ),
    bookmarkBtn,
  ));

  // ---------- progress ----------
  const fill = el('div', { class: 'fill', style: { width: '0%' } });
  const metaLeft = el('span', { class: 'mono' });
  const metaRight = el('span', { class: 'mono' });
  wrap.appendChild(el('div', { class: 'reader-progress' },
    el('div', { class: 'track' }, fill),
    el('div', { class: 'meta' }, metaLeft, metaRight),
  ));

  // ---------- mode switch ----------
  const segGuided = el('button', { class: mode === 'guided' ? 'on' : '', onclick: () => switchMode('guided') }, 'Guided');
  const segFlash = el('button', { class: mode === 'flash' ? 'on' : '', onclick: () => switchMode('flash') }, 'Flash');
  wrap.appendChild(el('div', { class: 'mode-switch-wrap' }, el('div', { class: 'seg', style: { minWidth: '220px' } }, segGuided, segFlash)));

  // ---------- body ----------
  const body = el('div', { style: { flex: '1', minHeight: '0', display: 'flex', flexDirection: 'column', position: 'relative' } });
  wrap.appendChild(body);

  // guided view
  const gScroll = el('div', { class: 'guided-scroll noscrollbar', style: { position: 'relative' } });
  const gBand = el('div', { class: 'g-band' });
  const gLine = el('div', { class: 'g-line' });
  const gDot = el('div', { class: 'g-dot' });
  const guidedWrap = el('div', { class: 'guided-wrap' }, gScroll);
  const pinBar = el('div', { class: 'pin-bar hidden' });
  guidedWrap.appendChild(pinBar);

  // flash view
  const flashWord = el('div', { class: 'flash-word' });
  const flashGuideV = el('div', { class: 'flash-guide-v' });
  const notchT = el('div', { class: 'flash-notch', style: { top: '14px' } });
  const notchB = el('div', { class: 'flash-notch', style: { bottom: '14px' } });
  const flashFrame = el('div', { class: 'flash-frame' }, flashGuideV, notchT, notchB, flashWord);
  const flashGhost = el('div', { class: 'flash-context' });
  const flashWrap = el('div', { class: 'flash-wrap' }, flashFrame, flashGhost);

  // tap zones on the flash frame: back / play-pause / forward
  flashFrame.appendChild(el('div', { style: { position: 'absolute', inset: '0', display: 'flex' } },
    el('div', { style: { flex: '1' }, onclick: () => { engine.stepWord(-1); } }),
    el('div', { style: { flex: '1.2' }, onclick: () => engine.toggle() }),
    el('div', { style: { flex: '1' }, onclick: () => { engine.stepWord(1); } }),
  ));

  const cardWrap = el('div', { class: 'center-card-wrap hidden' });
  body.appendChild(cardWrap);

  // ---------- controls ----------
  const playBtn = el('button', { class: 'play-btn', 'aria-label': 'Play', onclick: () => engine.toggle() }, svgIcon('play', 25));
  const tbtn = (icon, label, fn) => el('button', { class: 'icon-btn', 'aria-label': label, title: label, onclick: fn }, svgIcon(icon, 18));
  const transport = el('div', { class: 'transport' },
    tbtn('paraBack', 'Back a paragraph', () => engine.backPara()),
    tbtn('back', 'Back a sentence', () => engine.backSentence()),
    playBtn,
    tbtn('paraFwd', 'Forward a paragraph', () => engine.fwdPara()),
    tbtn('spark', 'AI assistant', () => openAiSheet()),
  );

  const wpmVal = el('div', { class: 'wpm-val' }, el('div', { class: 'v mono', text: String(engine.wpm) }), el('div', { class: 'u', text: 'WPM' }));
  const presetWrap = el('div', { class: 'wpm-presets noscrollbar' });
  const PRESETS = [200, 250, 300, 350, 400, 450, 500, 600];
  function renderPresets() {
    presetWrap.replaceChildren(...PRESETS.map((v) => el('button', {
      class: 'wpm-chip mono' + (engine.wpm === v ? ' on' : ''),
      onclick: () => setWpm(v),
    }, String(v))));
  }
  let holdT = null, holdD = null;
  const stepBtn = (dir, label) => el('button', {
    class: 'wpm-step', 'aria-label': label,
    onclick: () => setWpm(engine.wpm + dir * 10),
    onpointerdown: () => { holdD = setTimeout(() => { holdT = setInterval(() => setWpm(engine.wpm + dir * 10), 90); }, 350); },
    onpointerup: () => { clearTimeout(holdD); clearInterval(holdT); },
    onpointerleave: () => { clearTimeout(holdD); clearInterval(holdT); },
  }, svgIcon(dir > 0 ? 'fwd' : 'back', 15));
  const wpmBar = el('div', { class: 'wpm-bar' }, stepBtn(-1, 'Slower'), wpmVal, stepBtn(1, 'Faster'), el('div', { style: { width: '1px', height: '26px', background: 'var(--line2)' } }), presetWrap);
  renderPresets();

  wrap.appendChild(el('div', { class: 'reader-controls' }, transport, wpmBar));

  function setWpm(v) {
    const c = engine.setWpm(v);
    setSetting('wpm', c);
    wpmVal.firstChild.textContent = String(c);
    renderPresets();
    updateMeta();
  }

  // ---------- guided rendering (chapter-windowed) ----------
  let chapterIdx = -1;
  let spanByToken = new Map();
  let curSpan = null;
  let curParaEl = null;

  function chapterForToken(i) {
    let idx = 0;
    book.chapters.forEach((c, k) => { if (i >= c.tIndex) idx = k; });
    return idx;
  }
  function chapterRange(k) {
    const start = book.chapters[k] ? book.chapters[k].tIndex : 0;
    const end = book.chapters[k + 1] ? book.chapters[k + 1].tIndex : tokens.length;
    return { start, end };
  }

  function renderChapter(k) {
    chapterIdx = k;
    const { start, end } = chapterRange(k);
    spanByToken = new Map();
    gScroll.replaceChildren(gBand, gLine, gDot);
    const fontSize = FONT_GUIDED[settings.fontSize] || 17;
    const lineH = LINE[settings.lineSpacing] || 1.8;

    if (k > 0) {
      gScroll.appendChild(el('button', { class: 'btn ghost small', style: { margin: '0 auto 12px', display: 'flex' }, onclick: () => { engine.seek(book.chapters[k - 1].tIndex); } }, '‹ ' + (book.chapters[k - 1].title || 'Previous section')));
    }

    let p = -1, paraEl = null;
    for (let i = start; i < end; i++) {
      const t = tokens[i];
      if (t.p !== p) {
        p = t.p;
        if (t.img != null) {
          paraEl = null;
          gScroll.appendChild(el('div', { class: 'g-img', dataset: { p: String(p) } }, svgIcon('photo', 22), el('span', { text: t.img || 'Illustration' })));
          continue;
        }
        paraEl = el('p', { class: 'guided-para', dataset: { p: String(p) }, style: { fontSize: fontSize + 'px', lineHeight: String(lineH) } });
        gScroll.appendChild(paraEl);
      }
      if (t.img != null) continue;
      const span = el('span', { class: 'w', dataset: { i: String(i) }, text: t.w });
      spanByToken.set(i, span);
      paraEl.appendChild(span);
      paraEl.appendChild(document.createTextNode(' '));
    }

    if (k < book.chapters.length - 1) {
      gScroll.appendChild(el('button', { class: 'btn ghost small', style: { margin: '4px auto 30px', display: 'flex' }, onclick: () => { engine.seek(book.chapters[k + 1].tIndex); } }, (book.chapters[k + 1].title || 'Next section') + ' ›'));
    }
    curSpan = null; curParaEl = null;
    applyDim(tokens[Math.min(engine.i, tokens.length - 1)].p);
  }

  // tap a word → pin
  gScroll.addEventListener('click', (e) => {
    const span = e.target.closest && e.target.closest('span.w');
    if (!span) return;
    if (engine.playing) engine.pause();
    showPin(Number(span.dataset.i));
  });

  function showPin(i) {
    const word = tokens[i] ? tokens[i].w : '';
    pinBar.classList.remove('hidden');
    pinBar.replaceChildren(
      svgIcon('pin', 16),
      el('div', { class: 'grow', style: { minWidth: '0' } },
        el('div', { style: { fontSize: '13px', fontWeight: '700' }, text: 'Start from here?' }),
        el('div', { class: 'ellip', style: { fontSize: '11px', color: 'var(--text4)' }, text: '“' + word + '…”' }),
      ),
      el('button', { class: 'btn small ghost', onclick: () => defineWord(i), 'aria-label': 'Define word' }, 'Define'),
      el('button', { class: 'btn small', onclick: () => pinBar.classList.add('hidden') }, 'Cancel'),
      el('button', { class: 'btn small primary', style: { background: 'var(--accent)', color: 'var(--on-accent)', border: 'none' }, onclick: () => { pinBar.classList.add('hidden'); engine.seek(i); engine.play(); } }, 'Start'),
    );
  }

  function applyDim(activeP) {
    if (settings.dimOthers === 'off') {
      gScroll.querySelectorAll('.guided-para.dim1,.guided-para.dim2').forEach((n) => n.classList.remove('dim1', 'dim2'));
      return;
    }
    const cls = settings.dimOthers === 'medium' ? 'dim2' : 'dim1';
    gScroll.querySelectorAll('.guided-para').forEach((n) => {
      const on = n.dataset.p !== String(activeP);
      n.classList.toggle(cls, on);
      n.classList.remove(cls === 'dim1' ? 'dim2' : 'dim1');
    });
  }

  function guidedTick(i, tok) {
    const k = chapterForToken(i);
    if (k !== chapterIdx || !spanByToken.size) renderChapter(k);
    const span = spanByToken.get(i);
    if (!span) return;

    if (curSpan) { curSpan.style.background = ''; curSpan.style.color = ''; curSpan.style.borderRadius = ''; }
    curSpan = span;

    const paraEl = span.parentElement;
    if (paraEl !== curParaEl) { curParaEl = paraEl; applyDim(tok.p); }

    const style = settings.guideStyle;
    const inten = settings.guideIntensity;
    const tint = settings.tint;
    const bandA = inten === 'strong' ? 0.18 : inten === 'medium' ? 0.11 : 0.06;
    const lineH = inten === 'strong' ? 3 : inten === 'medium' ? 2.5 : 2;
    const wordMs = tokenMs(tok, 60000 / engine.wpm, settings.variableTiming);
    const trans = Math.max(40, Math.min(140, Math.round(wordMs * 0.6)));

    const top = span.offsetTop, left = span.offsetLeft, w = span.offsetWidth, h = span.offsetHeight;

    // line band behind the current line
    if (style === 'underline' || style === 'dot' || style === 'band') {
      gBand.style.display = 'block';
      gBand.style.background = hexA(tint, style === 'band' ? bandA + 0.05 : bandA * 0.6);
      gBand.style.top = (top - 3) + 'px';
      gBand.style.height = (h + 6) + 'px';
    } else gBand.style.display = 'none';

    if (style === 'underline') {
      gLine.style.display = 'block';
      gLine.style.transition = `left ${trans}ms linear, width ${trans}ms linear, top 90ms ease-out`;
      gLine.style.background = tint;
      gLine.style.height = lineH + 'px';
      gLine.style.top = (top + h - 1) + 'px';
      gLine.style.left = left + 'px';
      gLine.style.width = w + 'px';
    } else gLine.style.display = 'none';

    if (style === 'dot') {
      gDot.style.display = 'block';
      gDot.style.transition = `left ${trans}ms linear, top 90ms ease-out`;
      gDot.style.background = tint;
      gDot.style.top = (top + h + 1) + 'px';
      gDot.style.left = (left + w / 2 - 3) + 'px';
    } else gDot.style.display = 'none';

    if (style === 'word') {
      span.style.background = hexA(tint, 0.28 + (inten === 'strong' ? 0.14 : inten === 'medium' ? 0.06 : 0));
      span.style.borderRadius = '5px';
    }

    if (settings.autoScroll) {
      const vis = top - gScroll.scrollTop;
      const H = gScroll.clientHeight;
      if (vis > H * 0.62 || vis < 36) {
        gScroll.scrollTo({ top: Math.max(0, top - H * 0.33), behavior: engine.playing ? 'smooth' : 'auto' });
      }
    }
  }

  // ---------- flash rendering ----------
  let frameW = 0;
  function pivotX() { return Math.round(frameW * 0.38); }
  function layoutFlashChrome() {
    frameW = flashFrame.clientWidth;
    const x = pivotX();
    flashGuideV.style.left = x + 'px';
    notchT.style.left = notchB.style.left = (x - 1) + 'px';
    const markerOn = settings.flashMarker !== 'off';
    notchT.style.background = notchB.style.background = markerOn ? settings.tint : 'var(--text4)';
    flashGuideV.style.display = settings.centerGuide ? 'block' : 'none';
  }

  function flashTick(i, tok) {
    if (tok.img != null) return;
    if (!frameW) layoutFlashChrome();
    const chunk = Math.max(1, settings.chunk | 0);
    let text = tok.w;
    if (chunk > 1) {
      const parts = [tok.w];
      for (let k = 1; k < chunk; k++) {
        const t = tokens[i + k];
        if (!t || t.img != null || t.p !== tok.p) break;
        parts.push(t.w);
      }
      text = parts.join(' ');
    }

    let size = FONT_FLASH[settings.fontSize] || 46;
    const fontFor = (s) => `600 ${s}px 'Manrope', system-ui, sans-serif`;
    let lay = orpLayout(text, orpIndex(text), fontFor(size));
    while (lay.totalW > frameW - 28 && size > 17) { size -= 2; lay = orpLayout(text, orpIndex(text), fontFor(size)); }

    const pi = orpIndex(text);
    const marker = settings.flashMarker;
    const tintCol = marker === 'off' ? 'inherit' : marker === 'subtle' ? `color-mix(in srgb, ${settings.tint} 55%, #F5F5F6)` : settings.tint;
    flashWord.style.fontSize = size + 'px';
    flashWord.replaceChildren(
      el('span', { class: 'pre', text: text.slice(0, pi) }),
      el('span', { style: { color: tintCol, fontWeight: '700' }, text: text[pi] || '' }),
      el('span', { class: 'post', text: text.slice(pi + 1) }),
    );
    flashWord.style.left = (pivotX() - lay.pivotCenter) + 'px';

    const next = tokens[i + Math.max(1, settings.chunk | 0)];
    flashGhost.textContent = next ? (next.img != null ? '□ illustration ahead' : next.w) : 'end of book';
  }

  // countdown before flash playback (lets the eye settle on the pivot mark)
  let countingDown = false;
  function flashCountdown(cb) {
    countingDown = true;
    const dots = [0, 1, 2].map(() => el('div', { class: 'dot' }));
    const cd = el('div', { class: 'flash-count' }, ...dots);
    flashFrame.appendChild(cd);
    flashWord.style.opacity = '0';
    let n = 0;
    const step = () => {
      if (disposed) { cd.remove(); countingDown = false; return; }
      if (n < 3) { dots[n].classList.add('on'); n += 1; setTimeout(step, 220); }
      else { cd.remove(); flashWord.style.opacity = '1'; countingDown = false; cb(); }
    };
    step();
  }
  const origPlay = engine.play.bind(engine);
  engine.play = () => {
    if (countingDown) return;
    if (mode === 'flash' && !engine.playing && settings.rampUp) flashCountdown(origPlay);
    else origPlay();
  };

  // ---------- shared tick ----------
  let lastMetaAt = 0;
  function onTick(i, tok) {
    if (disposed) return;
    if (mode === 'guided') guidedTick(i, tok);
    else flashTick(i, tok);
    const now = performance.now();
    if (now - lastMetaAt > 250) { lastMetaAt = now; updateMeta(); }
  }

  function updateMeta() {
    const i = engine.i;
    const read = i + 1;
    const pct = Math.round((read / tokens.length) * 100);
    fill.style.width = pct + '%';
    metaLeft.textContent = `${fmtK(read)} / ${fmtK(tokens.length)} words`;
    const minsLeft = estimateMinutes(tokens, i, engine.wpm, settings.variableTiming);
    metaRight.textContent = `${pct}% · ${fmtTimeLeft(minsLeft)} left`;
    const k = chapterForToken(i);
    const c = book.chapters[k];
    chapterLabel.firstChild.textContent = c ? c.title : 'Reading';
    updateBookmarkBtn();
  }

  function updateBookmarkBtn() {
    const near = bookmarks.some((m) => Math.abs(m.tokenIndex - engine.i) < 12);
    bookmarkBtn.replaceChildren(svgIcon(near ? 'bookmarkFill' : 'bookmark', 16));
    bookmarkBtn.style.color = near ? settings.tint : '';
  }

  async function toggleBookmark() {
    const near = bookmarks.find((m) => Math.abs(m.tokenIndex - engine.i) < 12);
    if (near) {
      await deleteBookmark(near.id);
      bookmarks = bookmarks.filter((m) => m.id !== near.id);
      toast('Bookmark removed');
    } else {
      const snippet = tokens.slice(engine.i, engine.i + 8).map((t) => t.w).join(' ');
      await addBookmark({ bookId: meta.id, tokenIndex: engine.i, snippet });
      bookmarks = await listBookmarks(meta.id);
      toast('Bookmarked — resume from here any time');
      vibrate(10);
    }
    updateBookmarkBtn();
  }

  // ---------- mode switching ----------
  function switchMode(m) {
    if (m === mode) return;
    mode = m;
    setSetting('readMode', m);
    segGuided.classList.toggle('on', m === 'guided');
    segFlash.classList.toggle('on', m === 'flash');
    mountMode();
    onTick(engine.i, engine.token);
  }

  function mountMode() {
    hideCards();
    guidedWrap.remove(); flashWrap.remove();
    // synchronous initial paint — rAF never fires in a hidden tab
    if (mode === 'guided') {
      body.insertBefore(guidedWrap, cardWrap);
      chapterIdx = -1; // force re-render (font settings may have changed)
      onTick(engine.i, engine.token);
    } else {
      body.insertBefore(flashWrap, cardWrap);
      layoutFlashChrome();
      flashTick(engine.i, engine.token);
    }
  }

  // ---------- pause cards ----------
  function hideCards() { cardWrap.classList.add('hidden'); cardWrap.innerHTML = ''; if (mode === 'guided') guidedWrap.classList.remove('hidden'); else flashWrap.classList.remove('hidden'); }

  function showCard(node) {
    (mode === 'guided' ? guidedWrap : flashWrap).classList.add('hidden');
    cardWrap.classList.remove('hidden');
    cardWrap.replaceChildren(node);
  }

  function showImageCard(tok) {
    showCard(el('div', { style: { width: '100%', textAlign: 'center' } },
      el('div', { class: 'card', style: { padding: '30px 20px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '12px' } },
        svgIcon('photo', 46),
        el('div', { style: { fontSize: '12.5px', color: 'var(--text3)', maxWidth: '260px', lineHeight: '1.5' }, text: tok.img || 'Illustration' }),
      ),
      el('div', { style: { fontSize: '11px', color: 'var(--text4)', marginTop: '12px' }, text: 'Paused for an illustration in the original' }),
      el('button', { class: 'btn primary', style: { marginTop: '12px' }, onclick: () => { hideCards(); engine.stepWord(1); engine.play(); } }, 'Continue reading'),
    ));
  }

  async function onSessionEnd() {
    const stats = engine.sessionStats();
    await saveProgress(true);
    showCard(el('div', { style: { width: '100%', textAlign: 'center' } },
      el('div', { style: { width: '64px', height: '64px', borderRadius: '20px', background: 'rgba(79,216,166,.14)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 16px', color: 'var(--good)' } }, svgIcon('check', 30)),
      el('div', { style: { fontSize: '22px', fontWeight: '800', letterSpacing: '-.4px' }, text: 'You reached the end' }),
      el('div', { style: { fontSize: '13px', color: 'var(--text3)', marginTop: '6px' }, text: `${fmtK(stats.words)} words this session · ${fmtTimeLeft(stats.minutes)} · ~${stats.avgWpm} WPM` }),
      settings.autoQuiz ? el('button', { class: 'btn primary', style: { marginTop: '22px' }, onclick: () => openQuiz() }, 'Check comprehension') : null,
      el('button', { class: 'btn' + (settings.autoQuiz ? '' : ' primary'), style: { marginTop: settings.autoQuiz ? '9px' : '22px' }, onclick: () => close() }, 'Back to library'),
    ));
  }

  // ---------- contents sheet ----------
  function openContents() {
    if (engine.playing) engine.pause();
    const body = el('div', {});
    const search = el('input', { class: 'search-input', type: 'text', placeholder: 'Search sections', style: { marginBottom: '12px' } });
    if (book.chapters.length > 8) body.appendChild(search);

    const secList = el('div', {});
    body.appendChild(secList);

    function renderSections() {
      const q = (search.value || '').trim().toLowerCase();
      const curK = chapterForToken(engine.i);
      secList.replaceChildren(...book.chapters
        .map((c, k) => ({ c, k }))
        .filter(({ c }) => !q || c.title.toLowerCase().includes(q))
        .map(({ c, k }) => {
          const range = chapterRange(k);
          const mins = estimateMinutes(tokens.slice(range.start, range.end), 0, engine.wpm, settings.variableTiming);
          const isCur = k === curK;
          const done = engine.i >= range.end;
          return el('button', { class: 'pick-row' + (isCur ? ' on' : ''), onclick: () => { sheet.close(); engine.seek(c.tIndex); toast('Jumped to ' + c.title); } },
            el('div', { class: 'grow', style: { minWidth: '0' } },
              el('div', { class: 'ellip', style: { fontWeight: '700' }, text: c.title }),
              el('div', { style: { fontSize: '10.5px', color: 'var(--text4)', marginTop: '2px' }, text: (c.skip ? 'Front/back matter · ' : '') + fmtTimeLeft(mins) + (isCur ? ' · reading now' : done ? ' · read' : '') }),
            ),
            c.skip ? el('span', { class: 'badge', text: 'Skip' }) : null,
          );
        }));
    }
    search.addEventListener('input', renderSections);
    renderSections();

    if (bookmarks.length) {
      body.appendChild(el('div', { class: 'eyebrow', text: 'Bookmarks' }));
      bookmarks.forEach((m) => body.appendChild(el('div', { class: 'row', style: { marginBottom: '9px' } },
        el('button', { class: 'pick-row grow', style: { marginBottom: '0' }, onclick: () => { sheet.close(); engine.seek(m.tokenIndex); } },
          el('div', { class: 'grow', style: { minWidth: '0' } },
            el('div', { class: 'ellip', style: { fontSize: '12.5px' }, text: '“' + m.snippet + '…”' }),
          )),
        el('button', { class: 'icon-btn', style: { width: '38px', height: '38px', flex: '0 0 38px' }, 'aria-label': 'Delete bookmark',
          onclick: async (e) => { e.stopPropagation(); await deleteBookmark(m.id); bookmarks = bookmarks.filter((x) => x.id !== m.id); sheet.close(); toast('Bookmark removed'); } }, svgIcon('trash', 14)),
      )));
    }
    const sheet = openSheet({ title: 'Contents', sub: meta.title, body });
  }

  // ---------- AI ----------
  function currentParagraphText() {
    // The current paragraph — extended forward while it's too thin to explain
    // (headings, one-liners), capped at ~160 words.
    const p0 = engine.token && engine.token.p;
    let p1 = p0;
    const textFor = (a, b) => tokens.filter((t) => t.p >= a && t.p <= b && t.img == null).map((t) => t.w);
    let words = textFor(p0, p1);
    const maxP = tokens[tokens.length - 1].p;
    while (words.length < 15 && p1 < maxP && words.length < 160) {
      p1 += 1;
      words = textFor(p0, p1);
    }
    return words.slice(0, 160).join(' ');
  }
  function chapterSoFarText(cap = 5500) {
    const k = chapterForToken(engine.i);
    const { start } = chapterRange(k);
    const words = tokens.slice(start, engine.i + 1).filter((t) => t.img == null).map((t) => t.w);
    return words.slice(-cap).join(' ');
  }
  function sessionText(cap = 5000) {
    const words = tokens.slice(Math.max(0, sessionFrom), engine.i + 1).filter((t) => t.img == null).map((t) => t.w);
    return words.slice(-cap).join(' ');
  }
  function sentenceAround(i) {
    let a = i, b = i;
    while (a > 0 && !tokens[a - 1].sEnd) a -= 1;
    while (b < tokens.length - 1 && !tokens[b].sEnd) b += 1;
    return tokens.slice(a, b + 1).filter((t) => t.img == null).map((t) => t.w).join(' ');
  }

  async function defineWord(i) {
    pinBar.classList.add('hidden');
    const word = (tokens[i].w || '').replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '');
    runAiAction({ title: 'Define “' + word + '”', action: 'define', selection: word, context: sentenceAround(i) });
  }

  function openAiSheet() {
    if (engine.playing) engine.pause();
    const body = el('div', {});
    const status = el('div', { class: 'notice warn hidden', style: { marginBottom: '12px' } });
    body.appendChild(status);

    const input = el('input', { type: 'text', placeholder: 'Ask anything about this book…', 'aria-label': 'Question about the book' });
    const askBtn = el('button', { class: 'btn primary', style: { marginTop: '10px', marginBottom: '16px' }, onclick: () => {
      const q = input.value.trim();
      if (!q) { toast('Type a question first'); return; }
      sheet.close();
      runAiAction({ title: q, action: 'ask', question: q, context: chapterSoFarText() || currentParagraphText() });
    } }, 'Ask');
    body.appendChild(input); body.appendChild(askBtn);

    const act = (icon, label, d, fn) => el('button', { class: 'pick-row', onclick: () => { sheet.close(); fn(); } },
      svgIcon(icon, 17),
      el('div', { class: 'grow' }, el('div', { text: label }), el('div', { style: { fontSize: '10.5px', color: 'var(--text4)', marginTop: '1px' }, text: d })));

    body.appendChild(act('doc', 'Explain this paragraph', 'Plain-language explanation', () =>
      runAiAction({ title: 'Explain this paragraph', action: 'explain', context: currentParagraphText() })));
    body.appendChild(act('text', 'Simplify this paragraph', 'Rewrite it in easy words', () =>
      runAiAction({ title: 'Simplified', action: 'simplify', context: currentParagraphText() })));
    body.appendChild(act('contents', 'Summarize the chapter so far', 'Up to where you are — no spoilers', () =>
      runAiAction({ title: 'Chapter summary', action: 'summarize', context: chapterSoFarText() })));
    body.appendChild(act('spark', 'Key ideas so far', 'The main points as bullets', () =>
      runAiAction({ title: 'Key ideas', action: 'keyideas', context: chapterSoFarText() })));
    body.appendChild(act('quiz', 'Quiz me on this session', 'Questions from what you just read', () => openQuiz()));

    body.appendChild(el('div', { style: { fontSize: '10.5px', color: 'var(--text4)', lineHeight: '1.5', marginTop: '10px' },
      text: 'Answers are grounded in the book text sent with your request — the AI is told to say so when something isn’t in it.' }));

    const sheet = openSheet({ title: 'Reading assistant', sub: meta.title, body });
    aiHealth().then((h) => {
      if (!h.ok) { status.classList.remove('hidden'); status.textContent = h.error || 'AI is offline.'; }
    });
  }

  function runAiAction({ title, action, context, question, selection }) {
    const out = el('div', { class: 'ai-answer' });
    const spin = el('div', { class: 'row', style: { gap: '10px', padding: '8px 0' } }, el('div', { class: 'spinner' }), el('span', { style: { fontSize: '12.5px', color: 'var(--text3)' }, text: 'Reading the text…' }));
    const body = el('div', {}, spin, out);
    const sheet = openSheet({ title, sub: meta.title, body });

    const go = () => {
      spin.classList.remove('hidden');
      out.textContent = '';
      aiAssist({ action, title: meta.title, context, question, selection })
        .then((text) => { spin.classList.add('hidden'); out.textContent = text || 'The AI returned nothing — try again.'; })
        .catch((e) => {
          spin.classList.add('hidden');
          out.replaceChildren(
            el('div', { class: 'notice err', text: (e && e.message) || 'AI request failed.' }),
            el('button', { class: 'btn small', style: { marginTop: '10px' }, onclick: go }, 'Try again'),
          );
        });
    };
    go();
  }

  // ---------- quiz (grounded, honest failure) ----------
  function openQuiz() {
    const stats = engine.sessionStats();
    const text = sessionText();
    if (text.split(/\s+/).length < 40) { toast('Read a little more first — not enough text to quiz on'); return; }
    const body = el('div', {});
    const sheet = openSheet({ title: 'Comprehension check', sub: `${fmtK(stats.words)} words this session`, body });
    let questions = [];
    let idx = 0;
    let answers = [];

    const renderGen = () => {
      body.replaceChildren(
        el('div', { class: 'row', style: { gap: '10px', padding: '10px 0' } }, el('div', { class: 'spinner' }), el('span', { style: { fontSize: '12.5px', color: 'var(--text3)' }, text: 'Writing questions from what you just read…' })),
      );
      aiQuiz({ title: meta.title, text, count: settings.quizLength })
        .then((qs) => {
          questions = (qs || []).filter((q) => q && q.q && Array.isArray(q.opts) && q.opts.length === 4);
          if (!questions.length) throw new Error('The AI did not return usable questions.');
          idx = 0; answers = [];
          renderQ();
        })
        .catch((e) => {
          body.replaceChildren(
            el('div', { class: 'notice err', text: (e && e.message) || 'Quiz generation failed.' }),
            el('div', { class: 'row', style: { marginTop: '12px' } },
              el('button', { class: 'btn', style: { flex: '1' }, onclick: () => sheet.close() }, 'Skip'),
              el('button', { class: 'btn primary', style: { flex: '1' }, onclick: renderGen }, 'Try again'),
            ),
          );
        });
    };

    const renderQ = () => {
      const q = questions[idx];
      const picked = answers[idx];
      body.replaceChildren(
        el('div', { class: 'row', style: { justifyContent: 'space-between', margin: '2px 0 10px' } },
          el('span', { class: 'badge', text: q.type || 'Comprehension' }),
          el('span', { class: 'mono', style: { fontSize: '11px', color: 'var(--text4)' }, text: `${idx + 1} / ${questions.length}` }),
        ),
        el('div', { style: { fontSize: '15.5px', fontWeight: '700', lineHeight: '1.45', marginBottom: '14px' }, text: q.q }),
        ...q.opts.map((o, oi) => el('button', { class: 'quiz-opt' + (picked === oi ? ' picked' : ''), onclick: () => { answers[idx] = oi; renderQ(); } }, o)),
        el('button', { class: 'btn primary', style: { marginTop: '8px' }, disabled: picked == null, onclick: () => {
          if (idx < questions.length - 1) { idx += 1; renderQ(); } else renderResult();
        } }, idx < questions.length - 1 ? 'Next question' : 'See results'),
      );
    };

    const renderResult = async () => {
      const score = questions.reduce((n, q, i2) => n + (answers[i2] === q.correct ? 1 : 0), 0);
      const pct = Math.round((score / questions.length) * 100);
      await attachQuizToLastSession(meta.id, score, questions.length);
      const msg = pct >= 80 ? `Excellent recall at ${engine.wpm} WPM.` : pct >= 50 ? 'Solid — a little slower might lock it in.' : `Comprehension slipped — try ${Math.max(150, engine.wpm - 50)} WPM next session.`;
      body.replaceChildren(
        el('div', { style: { textAlign: 'center', padding: '8px 0 4px' } },
          el('div', { class: 'mono', style: { fontSize: '52px', fontWeight: '700', letterSpacing: '-2px' }, text: pct + '%' }),
          el('div', { style: { fontSize: '12.5px', color: 'var(--text3)', marginTop: '4px' }, text: `${score} of ${questions.length} correct · ${msg}` }),
        ),
        el('div', { class: 'eyebrow', text: 'Review' }),
        ...questions.map((q, qi) => el('div', { style: { marginBottom: '12px' } },
          el('div', { style: { fontSize: '12.5px', fontWeight: '700', marginBottom: '6px' }, text: (qi + 1) + '. ' + q.q }),
          el('div', { class: 'quiz-opt ' + (answers[qi] === q.correct ? 'correct' : 'wrong'), style: { pointerEvents: 'none', marginBottom: '4px' },
            text: (answers[qi] === q.correct ? '✓ ' : '✗ ') + q.opts[answers[qi]] }),
          answers[qi] !== q.correct ? el('div', { class: 'quiz-opt correct', style: { pointerEvents: 'none' }, text: '✓ ' + q.opts[q.correct] }) : null,
        )),
        el('button', { class: 'btn primary', style: { marginTop: '6px' }, onclick: () => { sheet.close(); } }, 'Done'),
      );
      vibrate(pct >= 80 ? [10, 60, 10] : 20);
    };

    renderGen();
  }

  // ---------- persistence ----------
  async function saveProgress(ended = false) {
    const i = engine.i;
    const pct = Math.min(100, Math.round(((i + 1) / tokens.length) * 100));
    await updateBookMeta(meta.id, { pos: ended && pct >= 100 ? tokens.length - 1 : i, pct, lastReadAt: Date.now() });
    const stats = engine.sessionStats();
    if (stats.words >= 30) {
      await addSession({ bookId: meta.id, bookTitle: meta.title, mode, wpm: stats.avgWpm, words: stats.words, seconds: Math.round(stats.minutes * 60) });
      // start a fresh stint so continued reading counts as its own session
      engine.session = { words: 0, ms: 0, wpmSum: 0, wpmN: 0, startedAt: null };
    }
  }

  async function close() {
    if (disposed) return;
    disposed = true;
    engine.destroy();
    setActiveEngine(null);
    if (unsub) unsub();
    const stats = engine.sessionStats();
    await saveProgress();
    if (stats.words >= 30) toast(`Saved · ${fmtK(stats.words)} words in ${fmtTimeLeft(stats.minutes)}`);
    ctx.closeReader();
  }

  // live-apply settings changes (from the settings tab or AI sheet)
  unsub = onSettings((key) => {
    if (disposed) return;
    if (['fontSize', 'lineSpacing', 'dimOthers', 'guideStyle', 'guideIntensity', 'tint'].includes(key) && mode === 'guided') {
      chapterIdx = -1; onTick(engine.i, engine.token);
    }
    if (['flashMarker', 'centerGuide', 'fontSize', 'tint', 'chunk'].includes(key) && mode === 'flash') {
      layoutFlashChrome(); flashTick(engine.i, engine.token);
    }
  });

  // initial mount
  mountMode();
  updateMeta();

  return { close, isOpen: () => !disposed };
}

function hexA(hex, a) {
  const h = hex.replace('#', '');
  const r = parseInt(h.slice(0, 2), 16), g = parseInt(h.slice(2, 4), 16), b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${a})`;
}
