// ai.js — client for the local Ocellus AI server (Gemma). The API key lives
// server-side only; the app talks to same-origin /api/* endpoints.

let healthCache = { at: 0, ok: false, error: null };

async function post(path, body, timeoutMs = 90000) {
  const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timer = ctrl ? setTimeout(() => ctrl.abort(), timeoutMs) : null;
  try {
    const res = await fetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body || {}),
      signal: ctrl ? ctrl.signal : undefined,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.ok === false) throw new Error(data.error || `AI request failed (HTTP ${res.status}).`);
    return data;
  } catch (e) {
    if (e && e.name === 'AbortError') throw new Error('The AI took too long to respond. Try again.');
    if (e instanceof TypeError) throw new Error('AI server unreachable. Start it on your computer: node ocellus-gemma-local.mjs');
    throw e;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** Cached health check — cheap enough to call before showing AI actions. */
export async function aiHealth(force = false) {
  const now = Date.now();
  if (!force && now - healthCache.at < 30000) return healthCache;
  try {
    const res = await fetch('/api/ai/health', { cache: 'no-store' });
    const data = await res.json().catch(() => ({}));
    healthCache = { at: now, ok: !!data.ok, error: data.ok ? null : (data.error || 'AI not configured'), model: data.model };
  } catch {
    healthCache = { at: now, ok: false, error: 'AI server offline — reading works, AI features are paused.' };
  }
  return healthCache;
}

export function aiLastKnown() { return healthCache; }

/** Quiz questions grounded in the exact text the user just read. */
export async function aiQuiz({ title, text, count = 5 }) {
  const data = await post('/api/ai/quiz', { title, text, count }, 120000);
  return data.questions || [];
}

/** Grounded reading assistant: action ∈ ask|explain|define|summarize|keyideas|simplify */
export async function aiAssist({ action, title, context, question, selection }) {
  const data = await post('/api/ai/assist', { action, title, context, question, selection }, 120000);
  return String(data.text || '').trim();
}

/** OCR one image via Gemma vision. */
export async function aiOcr({ imageBase64, mimeType }) {
  const data = await post('/api/ai/ocr', { imageBase64, mimeType }, 180000);
  return String(data.text || '');
}

/**
 * Coach recommendation. The NUMBERS come from a deterministic local heuristic
 * (honest, works offline); AI only phrases the advice when available.
 * Research note: comprehension drops sharply past ~500 WPM — never push
 * beyond that without strong quiz evidence.
 */
export function coachHeuristic(sessions) {
  const trainer = sessions.filter((s) => (s.mode === 'guided' || s.mode === 'flash') && s.words >= 40);
  const recent = trainer.slice(-6);
  if (recent.length < 2) {
    return { recommendedWpm: null, summary: 'Read a couple of sessions first — then I can recommend a speed.', confidence: 'low' };
  }
  const avgWpm = Math.round(recent.reduce((n, s) => n + s.wpm, 0) / recent.length / 5) * 5;
  const quizzed = recent.filter((s) => s.quizTotal > 0);
  const comp = quizzed.length
    ? Math.round(quizzed.reduce((n, s) => n + (s.quizScore / s.quizTotal) * 100, 0) / quizzed.length)
    : null;

  let rec = avgWpm;
  let reason;
  if (comp == null) {
    reason = 'No quiz results yet — holding steady. Take a quiz after your next session so I can check comprehension.';
  } else if (comp >= 80) {
    rec = Math.min(avgWpm + 25, avgWpm >= 500 ? avgWpm : 500);
    reason = `Comprehension is strong (${comp}%). Nudge up and see if it holds.`;
    if (avgWpm >= 500) reason = `Comprehension is strong (${comp}%) — but past 500 WPM comprehension usually drops. Consolidate here.`;
  } else if (comp >= 65) {
    reason = `Comprehension is fair (${comp}%). Hold this pace until quizzes sit above 80%.`;
  } else {
    rec = Math.max(150, avgWpm - 25);
    reason = `Comprehension dipped to ${comp}%. Ease back — speed only counts when the meaning sticks.`;
  }
  return { recommendedWpm: rec, currentAvg: avgWpm, comprehension: comp, summary: reason, confidence: quizzed.length >= 2 ? 'good' : 'low' };
}
