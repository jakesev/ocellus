// reader.js — the reading engine. Drift-corrected variable-duration scheduler,
// session accounting, and a screen wake lock. UI-agnostic: emits events.

import { tokenMs, sentenceStart, paraStartIndex, nextParaIndex } from './tokenize.js';
import { settings } from './settings.js';

export class ReaderEngine {
  /**
   * opts: {tokens, startIndex, onTick(i, token), onPauseAt(token, reason), onDone, onPlayState(bool)}
   */
  constructor(opts) {
    this.tokens = opts.tokens;
    this.i = Math.min(Math.max(0, opts.startIndex || 0), this.tokens.length - 1);
    this.onTick = opts.onTick || (() => {});
    this.onPauseAt = opts.onPauseAt || (() => {});
    this.onDone = opts.onDone || (() => {});
    this.onPlayState = opts.onPlayState || (() => {});
    this.playing = false;
    this.wpm = settings.wpm;
    this._timer = null;
    this._rampLeft = 0;
    // session accounting (real stats, saved by the screen when it ends)
    this.session = { words: 0, ms: 0, wpmSum: 0, wpmN: 0, startedAt: null };
    this._playStartedAt = null;
    this._wake = null;
  }

  get token() { return this.tokens[this.i]; }
  get length() { return this.tokens.length; }

  play() {
    if (this.playing || !this.tokens.length) return;
    if (this.i >= this.tokens.length - 1 && this.tokens.length > 1) this.i = 0; // replay from start when at end
    this.playing = true;
    this._rampLeft = settings.rampUp ? 8 : 0;
    this._playStartedAt = performance.now();
    if (!this.session.startedAt) this.session.startedAt = Date.now();
    this.onPlayState(true);
    this._acquireWake();
    this._next = performance.now() + this._durFor(this.token);
    this.onTick(this.i, this.token);
    this._schedule();
  }

  pause() {
    if (!this.playing) return;
    this.playing = false;
    clearTimeout(this._timer);
    this._timer = null;
    if (this._playStartedAt != null) {
      this.session.ms += performance.now() - this._playStartedAt;
      this._playStartedAt = null;
    }
    this.onPlayState(false);
    this._releaseWake();
  }

  toggle() { this.playing ? this.pause() : this.play(); }

  destroy() {
    this.pause();
    this._releaseWake();
  }

  _durFor(token) {
    const base = 60000 / Math.max(60, this.wpm);
    let ms = tokenMs(token, base, settings.variableTiming);
    const chunk = Math.max(1, settings.chunk | 0);
    if (chunk > 1 && token && token.img == null) {
      // a chunk frame shows N words: give it (slightly less than) their summed time
      ms = 0;
      const at = this.i;
      for (let k = 0; k < chunk; k++) {
        const t = this.tokens[Math.min(at + k, this.tokens.length - 1)];
        if (!t || t.img != null) break;
        ms += tokenMs(t, base, settings.variableTiming);
      }
      ms *= 0.88;
    }
    if (this._rampLeft > 0) {
      ms *= 1 + 0.09 * this._rampLeft; // ease from ~1.7× down to 1× over 8 words
    }
    return ms;
  }

  _schedule() {
    if (!this.playing) return;
    const now = performance.now();
    const wait = Math.max(0, this._next - now);
    this._timer = setTimeout(() => this._advance(), wait);
  }

  _advance() {
    if (!this.playing) return;
    if (this._rampLeft > 0) this._rampLeft -= 1;

    // consume the frame we just displayed: 1 word, or N words in chunk mode
    const cur = this.token;
    const step = cur && cur.img == null ? Math.max(1, settings.chunk | 0) : 1;
    let nextI = this.i;
    let consumed = 0;
    for (let s = 0; s < step && nextI < this.tokens.length - 1; s++) {
      if (this.tokens[nextI].img == null) consumed += 1;
      nextI += 1;
      if (this.tokens[nextI].img != null) break; // an image always gets its own stop
    }
    if (consumed > 0) {
      this.session.words += consumed;
      this.session.wpmSum += this.wpm; this.session.wpmN += 1;
    }

    if (nextI >= this.tokens.length - 1 && this.i === nextI) {
      this.pause();
      this.onDone();
      return;
    }
    this.i = nextI;
    const tok = this.token;

    if (tok.img != null && settings.pauseOnImages) {
      this.pause();
      this.onTick(this.i, tok);
      this.onPauseAt(tok, 'image');
      return;
    }
    if (this.i >= this.tokens.length - 1) {
      this.onTick(this.i, tok);
      this.pause();
      this.onDone();
      return;
    }

    const dur = this._durFor(tok);
    this._next = this._next + dur;
    // Never burst-catch-up: after any stall (tab hiccup, heavy layout, sleep)
    // re-anchor instead of firing a rapid chain of zero-wait ticks — that was
    // the "shoots through the words" bug. Small jitter (<½ word) may tick
    // promptly once; anything larger gets a full word duration again.
    const now = performance.now();
    if (this._next < now - dur * 0.5) this._next = now + dur;
    this.onTick(this.i, tok);
    this._schedule();
  }

  seek(i, { silent = false } = {}) {
    this.i = Math.min(Math.max(0, i), this.tokens.length - 1);
    if (this.tokens[this.i].img != null && !settings.pauseOnImages) {
      this.i = Math.min(this.i + 1, this.tokens.length - 1);
    }
    if (!silent) this.onTick(this.i, this.token);
    if (this.playing) this._next = performance.now() + this._durFor(this.token);
  }

  stepWord(dir) {
    let i = this.i + dir;
    while (i > 0 && i < this.tokens.length && this.tokens[i].img != null) i += dir;
    this.seek(i);
  }
  backSentence() { this.seek(sentenceStart(this.tokens, this.i)); }
  backPara() {
    const start = paraStartIndex(this.tokens, this.i);
    this.seek(this.i === start ? paraStartIndex(this.tokens, Math.max(0, start - 1)) : start);
  }
  fwdPara() { this.seek(nextParaIndex(this.tokens, this.i)); }

  setWpm(v) {
    const c = Math.min(900, Math.max(120, Math.round(v)));
    this.wpm = c;
    if (this.playing) this._next = performance.now() + this._durFor(this.token);
    return c;
  }

  /** words actually read this session, average wpm, active minutes */
  sessionStats() {
    const ms = this.session.ms + (this._playStartedAt != null ? performance.now() - this._playStartedAt : 0);
    return {
      words: Math.round(this.session.words),
      minutes: ms / 60000,
      avgWpm: this.session.wpmN ? Math.round(this.session.wpmSum / this.session.wpmN) : this.wpm,
    };
  }

  async _acquireWake() {
    if (!settings.keepAwake || !('wakeLock' in navigator)) return;
    try {
      this._wake = await navigator.wakeLock.request('screen');
    } catch {}
  }
  _releaseWake() {
    try { if (this._wake) { this._wake.release(); this._wake = null; } } catch {}
  }
}

// Re-acquire the wake lock if the tab becomes visible while playing.
let activeEngine = null;
export function setActiveEngine(engine) { activeEngine = engine; }
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && activeEngine && activeEngine.playing) {
    activeEngine._acquireWake();
  } else if (document.visibilityState === 'hidden' && activeEngine && activeEngine.playing) {
    activeEngine.pause(); // don't burn through words while the screen is off
  }
});

/**
 * ORP layout for the flash frame: measure the word with canvas so the pivot
 * letter's centre sits exactly on the fixed guide line — the eye never moves.
 */
const measureCtx = document.createElement('canvas').getContext('2d');
export function orpLayout(word, pivotIdx, font) {
  measureCtx.font = font;
  const pre = word.slice(0, pivotIdx);
  const pivot = word[pivotIdx] || '';
  const preW = measureCtx.measureText(pre).width;
  const pivotW = measureCtx.measureText(pivot).width;
  const totalW = measureCtx.measureText(word).width;
  return { preW, pivotW, totalW, pivotCenter: preW + pivotW / 2 };
}
