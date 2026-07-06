// settings.js — persisted user settings, applied app-wide.

const KEY = 'oc.settings.v1';

export const DEFAULTS = {
  theme: 'dark',            // dark | light | auto
  tint: '#FF5A47',          // accent + guide colour
  wpm: 300,
  readMode: 'guided',       // default mode when opening a book: guided | flash
  chunk: 1,                 // flash: words per frame (1-3)
  guideStyle: 'underline',  // guided pacer: underline | word | band | dot
  guideIntensity: 'medium', // subtle | medium | strong
  dimOthers: 'light',       // off | light | medium — dim non-active paragraphs
  lineSpacing: 'comfortable', // compact | comfortable | spacious
  fontSize: 'M',            // S | M | L | XL
  flashMarker: 'strong',    // pivot letter tint: off | subtle | strong
  centerGuide: true,        // vertical alignment guide in flash frame
  variableTiming: true,     // longer words / punctuation get more time
  rampUp: true,             // ease into speed on play
  autoScroll: true,
  pauseOnImages: true,
  autoQuiz: true,
  quizLength: 5,
  keepAwake: true,
  haptics: true,
};

function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { ...DEFAULTS, ...JSON.parse(raw) };
  } catch {}
  return { ...DEFAULTS };
}

export const settings = load();
const listeners = new Set();

export function setSetting(key, value) {
  settings[key] = value;
  try { localStorage.setItem(KEY, JSON.stringify(settings)); } catch {}
  if (key === 'theme' || key === 'tint') applyTheme();
  for (const fn of listeners) { try { fn(key, value); } catch {} }
}

export function onSettings(fn) { listeners.add(fn); return () => listeners.delete(fn); }

export function applyTheme() {
  const root = document.documentElement;
  let theme = settings.theme;
  if (theme === 'auto') {
    theme = window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
  }
  root.dataset.theme = theme;
  root.style.setProperty('--accent', settings.tint);
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', theme === 'light' ? '#EAECEF' : '#0B0B0D');
}

if (window.matchMedia) {
  window.matchMedia('(prefers-color-scheme: light)').addEventListener('change', () => {
    if (settings.theme === 'auto') applyTheme();
  });
}

// onboarding flag
export function isOnboarded() { try { return localStorage.getItem('oc.onboarded') === '1'; } catch { return true; } }
export function setOnboarded(v) { try { v ? localStorage.setItem('oc.onboarded', '1') : localStorage.removeItem('oc.onboarded'); } catch {} }

export function resetSettings() {
  Object.assign(settings, DEFAULTS);
  try { localStorage.setItem(KEY, JSON.stringify(settings)); } catch {}
  applyTheme();
  for (const fn of listeners) { try { fn('*', null); } catch {} }
}
