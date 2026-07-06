// ui.js — DOM helpers, icons, sheets/modals, toast, downloads.

export function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'class') node.className = v;
    else if (k === 'html') node.innerHTML = v;
    else if (k === 'text') node.textContent = v;
    else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2), v);
    else if (k === 'style' && typeof v === 'object') Object.assign(node.style, v);
    else if (k === 'dataset') Object.assign(node.dataset, v);
    else node.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat(Infinity)) {
    if (c == null || c === false) continue;
    node.appendChild(typeof c === 'string' || typeof c === 'number' ? document.createTextNode(String(c)) : c);
  }
  return node;
}

export function svgIcon(name, size = 18) {
  const paths = {
    plus: '<path d="M12 5v14M5 12h14" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"/>',
    play: '<path d="M8 5.5v13l11-6.5-11-6.5Z" fill="currentColor"/>',
    pause: '<rect x="7" y="5" width="4" height="14" rx="1.3" fill="currentColor"/><rect x="13" y="5" width="4" height="14" rx="1.3" fill="currentColor"/>',
    close: '<path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"/>',
    back: '<path d="M15 6l-6 6 6 6" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/>',
    fwd: '<path d="M9 6l6 6-6 6" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/>',
    paraBack: '<path d="M18 6l-7 6 7 6M7 6v12" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>',
    paraFwd: '<path d="M6 6l7 6-7 6M17 6v12" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>',
    contents: '<path d="M4 6h16M4 12h16M4 18h10" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/>',
    bookmark: '<path d="M7 4h10a1 1 0 0 1 1 1v15l-6-4-6 4V5a1 1 0 0 1 1-1Z" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/>',
    bookmarkFill: '<path d="M7 4h10a1 1 0 0 1 1 1v15l-6-4-6 4V5a1 1 0 0 1 1-1Z" fill="currentColor" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/>',
    dots: '<circle cx="5" cy="12" r="1.6" fill="currentColor"/><circle cx="12" cy="12" r="1.6" fill="currentColor"/><circle cx="19" cy="12" r="1.6" fill="currentColor"/>',
    library: '<path d="M5 4h4v16H5zM10.5 4h4v16h-4z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/><path d="m16.5 5.2 3.6-.8 3 15-3.9.9" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" transform="scale(.82) translate(1 1.5)"/>',
    gauge: '<path d="M4 14a8 8 0 1 1 16 0" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/><path d="M12 14l4-5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><circle cx="12" cy="14" r="1.6" fill="currentColor"/>',
    chart: '<path d="M4 19h16" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/><path d="M7 15v-4M12 15V7M17 15v-6" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>',
    gear: '<circle cx="12" cy="12" r="3.1" stroke="currentColor" stroke-width="1.6"/><path d="M12 3.5v2.4M12 18.1v2.4M20.5 12h-2.4M5.9 12H3.5M18 6l-1.7 1.7M7.7 16.3 6 18M18 18l-1.7-1.7M7.7 7.7 6 6" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>',
    book: '<path d="M5 5.5A2.5 2.5 0 0 1 7.5 3H19v15H7.5A2.5 2.5 0 0 0 5 20.5v-15Z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/><path d="M19 18v3H7.5A2.5 2.5 0 0 1 5 18.5" stroke="currentColor" stroke-width="1.6"/>',
    doc: '<path d="M7 3h7l4 4v14H7z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/><path d="M14 3v4h4M10 12h5M10 16h5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>',
    photo: '<rect x="3" y="4" width="18" height="16" rx="2.5" stroke="currentColor" stroke-width="1.5"/><circle cx="8.5" cy="9.5" r="1.8" fill="currentColor"/><path d="M4 17l4.5-4.5L13 16l3-3 4 4.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>',
    spark: '<path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8L12 3Z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/><path d="M18.5 15.5l.9 2.6 2.6.9-2.6.9-.9 2.6-.9-2.6-2.6-.9 2.6-.9.9-2.6Z" fill="currentColor"/>',
    download: '<path d="M12 4v10m0 0 4-4m-4 4-4-4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/><path d="M5 18h14" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>',
    trash: '<path d="M5 7h14M10 7V5h4v2M6 7l1 13h10l1-13" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>',
    archive: '<path d="M4 7h16v13H4zM3 4h18v3H3z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/><path d="M10 11h4" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>',
    check: '<path d="M5 13l4 4L19 7" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>',
    eye: '<circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="1.3" opacity=".45"/><circle cx="12" cy="12" r="5.4" stroke="currentColor" stroke-width="1.3" opacity=".8"/><circle cx="12" cy="12" r="2.1" fill="#FF5A47"/>',
    clock: '<circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="1.5"/><path d="M12 8v4l2.5 2.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>',
    refresh: '<path d="M20 11a8 8 0 1 0-.9 4.7" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><path d="M20 5v5h-5" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>',
    quiz: '<path d="M9 4h9v16H6V7l3-3Z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/><path d="M9 4v3H6M9 11h6M9 15h6" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>',
    pin: '<path d="M12 21s-6-5.1-6-9.6A6 6 0 0 1 18 11.4C18 15.9 12 21 12 21Z" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/><circle cx="12" cy="11.3" r="2" fill="currentColor"/>',
    chevD: '<path d="M6 9l6 6 6-6" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>',
    text: '<path d="M5 6h14M8 6v13M16 6v13M5 19h6M13 19h6" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>',
  };
  const s = el('span', { html: `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" aria-hidden="true">${paths[name] || ''}</svg>` });
  s.style.display = 'inline-flex';
  return s.firstChild;
}

// ---------- toast ----------
let toastTimer = null;
export function toast(msg, ms = 2000) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), ms);
}

// ---------- overlay stack (sheets + modals), wired to browser history ----------
const stack = [];
let navDepth = 0;

export function openSheet({ title, sub, body, onClose, modal = false, cls = '' }) {
  const overlays = document.getElementById('overlays');
  const scrim = el('div', { class: 'scrim' });
  const panel = el('div', { class: (modal ? 'modal ' : 'sheet ') + cls, role: 'dialog', 'aria-modal': 'true', 'aria-label': title || 'Dialog' });
  if (!modal) panel.appendChild(el('div', { class: 'sheet-grab' }));
  if (title) panel.appendChild(el('div', { class: 'sheet-title', text: title }));
  if (sub) panel.appendChild(el('div', { class: 'sheet-sub', text: sub }));
  const bodyEl = el('div', { class: modal ? '' : 'sheet-body' });
  if (body) bodyEl.appendChild(body);
  panel.appendChild(bodyEl);
  overlays.appendChild(scrim);
  overlays.appendChild(panel);
  requestAnimationFrame(() => { scrim.classList.add('show'); panel.classList.add('show'); });

  const entry = { scrim, panel, onClose, closed: false };
  stack.push(entry);
  history.pushState({ ov: ++navDepth }, '');
  scrim.addEventListener('click', () => closeTop());

  return {
    close: () => closeEntry(entry, true),
    panel, body: bodyEl,
    setTitle: (t) => { const n = panel.querySelector('.sheet-title'); if (n) n.textContent = t; },
  };
}

let expectPop = 0; // popstates we triggered ourselves — must not close the next overlay

function closeEntry(entry, viaCode) {
  if (entry.closed) return;
  entry.closed = true;
  const idx = stack.indexOf(entry);
  if (idx >= 0) stack.splice(idx, 1);
  entry.scrim.classList.remove('show');
  entry.panel.classList.remove('show');
  setTimeout(() => { entry.scrim.remove(); entry.panel.remove(); }, 280);
  if (entry.onClose) { try { entry.onClose(); } catch {} }
  if (viaCode) { expectPop += 1; history.back(); } // consume the history entry we pushed
}

export function closeTop() {
  const top = stack[stack.length - 1];
  if (top) closeEntry(top, true);
}

export function overlaysOpen() { return stack.length > 0; }

/** For other owners of history entries (e.g. the reader screen): mark the next
 *  popstate as self-inflicted so it doesn't close an unrelated overlay. */
export function consumeNextPop() { expectPop += 1; }

window.addEventListener('popstate', () => {
  if (expectPop > 0) { expectPop -= 1; return; } // our own back() — already handled
  const top = stack[stack.length - 1];
  if (top) closeEntry(top, false);
  else if (typeof window.__ocBack === 'function') window.__ocBack();
});

// confirm dialog (promise-based)
export function confirmDialog({ title, message, okLabel = 'Confirm', danger = false }) {
  return new Promise((resolve) => {
    const body = el('div', {},
      el('div', { style: { fontSize: '13px', color: 'var(--text3)', lineHeight: '1.55', marginBottom: '16px' }, text: message }),
      el('div', { class: 'row' },
        el('button', { class: 'btn', style: { flex: '1' }, onclick: () => { h.close(); resolve(false); } }, 'Cancel'),
        el('button', { class: 'btn ' + (danger ? 'danger' : 'primary'), style: { flex: '1' }, onclick: () => { h.close(); resolve(true); } }, okLabel),
      ),
    );
    const h = openSheet({ title, body, modal: true, onClose: () => resolve(false) });
  });
}

// ---------- downloads ----------
export function downloadBlob(filename, content, mime = 'text/plain;charset=utf-8') {
  const blob = content instanceof Blob ? content : new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = el('a', { href: url, download: filename });
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { a.remove(); URL.revokeObjectURL(url); }, 2000);
}

export function vibrate(pattern = 12) {
  try { if (navigator.vibrate) navigator.vibrate(pattern); } catch {}
}

export function fmtTimeLeft(minutes) {
  if (!isFinite(minutes) || minutes <= 0) return '—';
  if (minutes < 1) return '<1 min';
  if (minutes < 60) return Math.round(minutes) + ' min';
  return Math.floor(minutes / 60) + 'h ' + String(Math.round(minutes % 60)).padStart(2, '0') + 'm';
}

export function fmtK(x) {
  return x >= 1000 ? (x / 1000).toFixed(x >= 10000 ? 0 : 1) + 'k' : String(x);
}

export function fmtDate(ts) {
  const d = new Date(ts);
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const day = new Date(d); day.setHours(0, 0, 0, 0);
  const diff = Math.round((today - day) / 86400000);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Yesterday';
  if (diff < 7) return diff + ' days ago';
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
