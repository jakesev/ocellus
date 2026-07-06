// app.js — boot, tab navigation, reader routing, PWA registration.

import { el, svgIcon, toast, consumeNextPop } from './ui.js';
import { applyTheme, isOnboarded, settings } from './settings.js';
import { openDB, getBook, getBookText } from './db.js';
import { tokenize, detectChapters, chaptersWithTokenIndex } from './tokenize.js';
import { renderLibrary, openImportSheet } from './screens/library.js';
import { openReaderScreen } from './screens/reader.js';
import { renderSpeed } from './screens/speed.js';
import { renderProgress } from './screens/progress.js';
import { renderSettings } from './screens/settings.js';
import { runOnboarding } from './screens/onboarding.js';
import { aiHealth } from './ai.js';

const screenEl = document.getElementById('screen');
const tabbarEl = document.getElementById('tabbar');

const TABS = [
  ['library', 'Library', 'library'],
  ['speed', 'Speed test', 'gauge'],
  ['progress', 'Progress', 'chart'],
  ['settings', 'Settings', 'gear'],
];

let currentTab = 'library';
let reader = null; // active reader screen handle
let readerHistoryDepth = 0;

const ctx = {
  navigate,
  openReader,
  closeReader,
  refreshTab: () => renderTab(currentTab),
};

function renderTabbar() {
  tabbarEl.replaceChildren(...TABS.map(([key, label, icon]) => el('button', {
    class: 'tab-btn' + (currentTab === key && !reader ? ' active' : ''),
    'aria-label': label, 'aria-current': currentTab === key ? 'page' : null,
    onclick: () => navigate(key),
  }, svgIcon(icon, 21), label)));
}

function navigate(tab) {
  currentTab = tab;
  if (reader) { closeReaderInternal(false); return; } // re-renders into the new tab after saving
  renderTabbar();
  renderTab(tab);
}

function renderTab(tab) {
  if (reader) return;
  if (tab === 'library') renderLibrary(screenEl, ctx);
  else if (tab === 'speed') renderSpeed(screenEl, ctx);
  else if (tab === 'progress') renderProgress(screenEl, ctx);
  else if (tab === 'settings') renderSettings(screenEl, ctx);
}

async function openReader(bookId, opts = {}) {
  try {
    const meta = await getBook(bookId);
    const text = await getBookText(bookId);
    if (!meta || !text || !text.paras || !text.paras.length) {
      toast('That book has no stored text — try importing it again.');
      return;
    }
    const { tokens, paraStart } = tokenize(text.paras);
    if (!tokens.length) { toast('That book appears to be empty.'); return; }
    let chapters = (text.chapters && text.chapters.length ? text.chapters : detectChapters(text.paras));
    chapters = chaptersWithTokenIndex(chapters, paraStart, tokens.length);

    tabbarEl.classList.add('hidden');
    history.pushState({ reader: true }, '');
    readerHistoryDepth += 1;
    reader = openReaderScreen(screenEl, ctx, { meta, paras: text.paras, chapters, tokens, paraStart }, opts);
    window.__ocBack = () => closeReaderInternal(true); // hardware/browser back
  } catch (e) {
    console.error(e);
    toast('Could not open that book: ' + ((e && e.message) || 'unknown error'));
  }
}

/**
 * Single close path. historyAlreadyPopped=true when triggered by popstate.
 * Idempotent: the reader screen's own close() → ctx.closeReader() re-enters
 * here with reader already null, and reader.close() re-entry is disposed-guarded.
 */
function closeReaderInternal(historyAlreadyPopped) {
  if (!reader) return;
  const r = reader;
  reader = null;
  window.__ocBack = null;
  if (readerHistoryDepth > 0) {
    readerHistoryDepth -= 1;
    if (!historyAlreadyPopped) { consumeNextPop(); history.back(); }
  }
  tabbarEl.classList.remove('hidden');
  renderTabbar();
  renderTab(currentTab);
  r.close(); // async: saves position + session, then no-ops back into ctx.closeReader
}

function closeReader() { closeReaderInternal(false); }

// ---------- boot ----------
async function boot() {
  applyTheme();
  try { await openDB(); } catch (e) {
    screenEl.innerHTML = '';
    screenEl.appendChild(el('div', { class: 'empty-state', style: { paddingTop: '30vh' } },
      el('div', { class: 't', text: 'Storage unavailable' }),
      el('div', { class: 'd', text: 'Ocellus needs browser storage (IndexedDB) to keep your books. Private/incognito windows often block it — open in a normal window.' }),
    ));
    return;
  }

  renderTabbar();
  renderTab('library');
  aiHealth(); // warm the health cache — screens show accurate AI state

  if (!isOnboarded()) {
    runOnboarding(document.getElementById('onboarding'), {
      onDone: ({ openImport } = {}) => {
        renderTab('library');
        if (openImport) openImportSheet(ctx);
      },
    });
  }

  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  }
}

boot();
