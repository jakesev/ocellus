// library.js — the home screen: real books, import flow, book management.

import { el, svgIcon, toast, openSheet, confirmDialog, downloadBlob, fmtDate, fmtK, fmtTimeLeft } from '../ui.js';
import { listBooks, saveBook, updateBookMeta, deleteBook, uid, getBookText } from '../db.js';
import { extractFile, extractPhotos, ACCEPT, cleanTitle, coverHueFor, stripMarkdown } from '../extract.js';
import { paragraphsFromText, detectChapters, stripChapterMarkers } from '../tokenize.js';
import { settings } from '../settings.js';
import { SAMPLE_TITLE, SAMPLE_AUTHOR, SAMPLE_TEXT } from '../sample.js';

let view = 'active'; // active | archived
let query = '';

export async function renderLibrary(root, ctx) {
  root.innerHTML = '';
  const scroll = el('div', { class: 'screen-scroll fadein' });
  root.appendChild(scroll);

  const books = await listBooks();
  const active = books.filter((b) => !b.archived);
  const archived = books.filter((b) => b.archived);

  // header
  scroll.appendChild(el('div', { class: 'lib-header' },
    el('div', { class: 'brand' },
      svgIcon('eye', 26),
      el('div', {},
        el('div', { class: 'brand-name', text: 'Ocellus' }),
        el('div', { class: 'brand-tag', text: 'Read faster. Understand more.' }),
      ),
    ),
    el('button', { class: 'icon-btn', 'aria-label': 'Import a book', onclick: () => openImportSheet(ctx) }, svgIcon('plus', 20)),
  ));

  // tabs
  const seg = el('div', { class: 'seg', style: { marginBottom: '18px' } },
    el('button', { class: view === 'active' ? 'on' : '', onclick: () => { view = 'active'; renderLibrary(root, ctx); } }, 'Library'),
    el('button', { class: view === 'archived' ? 'on' : '', onclick: () => { view = 'archived'; renderLibrary(root, ctx); } }, `Archived${archived.length ? ' · ' + archived.length : ''}`),
  );
  scroll.appendChild(seg);

  if (view === 'archived') {
    renderArchived(scroll, archived, ctx, root);
    return;
  }

  if (!active.length) {
    scroll.appendChild(emptyState(ctx));
    return;
  }

  // continue-reading hero (most recently read, unfinished)
  const hero = active.find((b) => b.pct > 0 && b.pct < 100 && b.lastReadAt) || null;
  if (hero) scroll.appendChild(continueCard(hero, ctx));

  // search (only useful once the shelf grows)
  if (active.length > 6) {
    const inp = el('input', { class: 'search-input', type: 'text', placeholder: 'Search your library', value: query,
      oninput: (e) => { query = e.target.value; listWrap.replaceChildren(...bookRows(filterBooks(active), ctx, root)); } });
    scroll.appendChild(el('div', { style: { marginBottom: '14px' } }, inp));
  }

  scroll.appendChild(el('div', { class: 'row', style: { justifyContent: 'space-between', margin: '0 0 12px' } },
    el('div', { class: 'eyebrow', style: { margin: '0' }, text: 'Your library' }),
    el('div', { style: { fontSize: '12px', color: 'var(--text4)' }, text: `${active.length} book${active.length === 1 ? '' : 's'}` }),
  ));

  const listWrap = el('div', {});
  listWrap.append(...bookRows(filterBooks(active), ctx, root));
  scroll.appendChild(listWrap);

  function filterBooks(list) {
    const q = query.trim().toLowerCase();
    return q ? list.filter((b) => (b.title + ' ' + (b.author || '')).toLowerCase().includes(q)) : list;
  }
}

function emptyState(ctx) {
  return el('div', { class: 'empty-state' },
    svgIcon('book', 40),
    el('div', { class: 't', text: 'Your library is empty' }),
    el('div', { class: 'd', text: 'Import a PDF, EPUB, Word doc, text file, or photos of pages — Ocellus turns them into a trainable book.' }),
    el('button', { class: 'btn primary', style: { maxWidth: '260px', margin: '0 auto' }, onclick: () => openImportSheet(ctx) }, svgIcon('plus', 17), 'Add your first book'),
    el('button', { class: 'btn ghost', style: { maxWidth: '260px', margin: '8px auto 0' }, onclick: () => addSampleBook(ctx) }, 'Try a sample book'),
  );
}

function continueCard(b, ctx) {
  const mins = b.words && b.pct < 100 ? ((b.words * (1 - b.pct / 100)) / Math.max(120, settings.wpm)) : 0;
  return el('div', { class: 'continue-card' },
    el('div', { class: 'eyebrow', style: { margin: '0 0 10px' }, text: 'Continue reading' }),
    el('div', { class: 'row', style: { gap: '14px', alignItems: 'stretch' } },
      cover(b, 72, 100),
      el('div', { class: 'grow', style: { display: 'flex', flexDirection: 'column' } },
        el('div', { class: 'row', style: { gap: '6px', marginBottom: '7px' } },
          el('span', { class: 'badge', text: b.kind }),
          el('span', { class: 'badge', text: `${b.chapterCount || 1} section${(b.chapterCount || 1) === 1 ? '' : 's'}` }),
        ),
        el('div', { style: { fontSize: '17px', fontWeight: '700', letterSpacing: '-.3px', lineHeight: '1.2' }, text: b.title }),
        el('div', { style: { fontSize: '12px', color: 'var(--text3)', marginTop: '3px' }, text: (b.author ? b.author + ' · ' : '') + fmtTimeLeft(mins) + ' left at ' + settings.wpm + ' WPM' }),
        el('div', { class: 'row', style: { marginTop: 'auto', paddingTop: '10px', gap: '10px' } },
          el('div', { class: 'pbar' }, el('div', { style: { width: b.pct + '%' } })),
          el('span', { class: 'mono', style: { fontSize: '11px', color: 'var(--text2)' }, text: b.pct + '%' }),
        ),
      ),
    ),
    el('button', { class: 'btn primary', style: { marginTop: '14px' }, onclick: () => ctx.openReader(b.id) },
      svgIcon('play', 16), `Resume — ${b.pct}%`),
  );
}

function cover(b, w = 48, h = 66) {
  const hue = b.coverHue ?? 220;
  const c = el('div', { class: 'cover', style: { width: w + 'px', height: h + 'px', flex: `0 0 ${w}px`, background: `linear-gradient(155deg, hsl(${hue} 26% 22%), hsl(${hue} 30% 10%))` } },
    el('div', { class: 'spine' }),
    el('div', { class: 'cv-title', text: b.title.slice(0, 34) }),
  );
  return c;
}

function bookRows(list, ctx, root) {
  if (!list.length) {
    return [el('div', { class: 'empty-state', style: { padding: '26px' } }, el('div', { class: 't', text: 'No matches' }), el('div', { class: 'd', text: 'Try a different search.' }))];
  }
  return list.map((b) => el('div', { class: 'book-row', role: 'button', tabindex: '0', 'aria-label': 'Open ' + b.title,
    onclick: () => ctx.openReader(b.id),
    onkeydown: (e) => { if (e.key === 'Enter') ctx.openReader(b.id); } },
    cover(b),
    el('div', { class: 'grow' },
      el('div', { class: 'ellip', style: { fontSize: '15px', fontWeight: '700', letterSpacing: '-.2px', marginBottom: '3px' }, text: b.title }),
      el('div', { class: 'ellip', style: { fontSize: '11.5px', color: 'var(--text4)', marginBottom: '8px' }, text: [b.author, b.lastReadAt ? fmtDate(b.lastReadAt) : 'Added ' + fmtDate(b.addedAt), fmtK(b.words || 0) + ' words'].filter(Boolean).join(' · ') }),
      el('div', { class: 'row', style: { gap: '8px' } },
        el('span', { class: 'badge', text: b.kind }),
        el('div', { class: 'pbar' }, el('div', { style: { width: Math.max(2, b.pct || 0) + '%', background: b.pct >= 100 ? 'var(--good)' : 'var(--accent)' } })),
        el('span', { class: 'mono', style: { fontSize: '11px', color: 'var(--text3)', minWidth: '32px', textAlign: 'right' }, text: (b.pct || 0) + '%' }),
      ),
    ),
    el('button', { class: 'icon-btn', style: { width: '38px', height: '38px', flex: '0 0 38px', border: 'none', background: 'transparent' }, 'aria-label': 'Book options',
      onclick: (e) => { e.stopPropagation(); openBookMenu(b, ctx, root); } }, svgIcon('dots', 17)),
  ));
}

function renderArchived(scroll, archived, ctx, root) {
  if (!archived.length) {
    scroll.appendChild(el('div', { class: 'empty-state' },
      svgIcon('archive', 34),
      el('div', { class: 't', text: 'No archived books' }),
      el('div', { class: 'd', text: 'Archive a book from its ⋯ menu to tuck it away without deleting it.' }),
    ));
    return;
  }
  archived.forEach((b) => scroll.appendChild(el('div', { class: 'book-row', style: { opacity: '.85' } },
    cover(b, 40, 56),
    el('div', { class: 'grow' },
      el('div', { class: 'ellip', style: { fontSize: '14px', fontWeight: '600', color: 'var(--text2)' }, text: b.title }),
      el('div', { style: { fontSize: '11px', color: 'var(--text5)', marginTop: '2px' }, text: (b.author || b.kind) + ' · ' + (b.pct || 0) + '%' }),
    ),
    el('button', { class: 'btn small', onclick: async (e) => { e.stopPropagation(); await updateBookMeta(b.id, { archived: 0 }); toast('Book restored'); renderLibrary(root, ctx); } }, 'Restore'),
    el('button', { class: 'icon-btn', style: { width: '38px', height: '38px', flex: '0 0 38px' }, 'aria-label': 'Delete book',
      onclick: async (e) => {
        e.stopPropagation();
        if (await confirmDialog({ title: 'Delete "' + b.title + '"?', message: 'This removes the book and its bookmarks from this device. Reading stats are kept.', okLabel: 'Delete', danger: true })) {
          await deleteBook(b.id); toast('Book deleted'); renderLibrary(root, ctx);
        }
      } }, svgIcon('trash', 15)),
  )));
}

// ---------- book menu ----------
function openBookMenu(b, ctx, root) {
  const item = (icon, label, fn, danger = false) => el('button', {
    class: 'pick-row', style: danger ? { color: '#FF5A47' } : {},
    onclick: async () => { sheet.close(); await fn(); },
  }, svgIcon(icon, 17), label);

  const body = el('div', {},
    item('play', 'Resume reading', () => ctx.openReader(b.id)),
    item('back', 'Read from the beginning', () => ctx.openReader(b.id, { index: 0 })),
    item('text', 'Rename', () => renameBook(b, ctx, root)),
    item('download', 'Export text (.txt)', async () => {
      const t = await getBookText(b.id);
      if (!t) { toast('No text stored for this book'); return; }
      const body = t.paras.map((p) => (p.img != null ? `[Illustration${p.img ? ': ' + p.img : ''}]` : p.s)).join('\n\n');
      downloadBlob(safeName(b.title) + '.txt', b.title + (b.author ? '\n' + b.author : '') + '\n\n' + body);
      toast('Exported book text');
    }),
    item('refresh', 'Reset reading progress', async () => {
      await updateBookMeta(b.id, { pos: 0, pct: 0 });
      toast('Progress reset'); renderLibrary(root, ctx);
    }),
    item('archive', b.archived ? 'Restore from archive' : 'Archive', async () => {
      await updateBookMeta(b.id, { archived: b.archived ? 0 : 1 });
      toast(b.archived ? 'Restored' : 'Archived'); renderLibrary(root, ctx);
    }),
    item('trash', 'Delete book', async () => {
      if (await confirmDialog({ title: 'Delete "' + b.title + '"?', message: 'This removes the book and its bookmarks from this device. Reading stats are kept.', okLabel: 'Delete', danger: true })) {
        await deleteBook(b.id); toast('Book deleted'); renderLibrary(root, ctx);
      }
    }, true),
  );
  const sheet = openSheet({ title: b.title, sub: (b.author ? b.author + ' · ' : '') + b.kind + ' · ' + fmtK(b.words || 0) + ' words', body });
}

function renameBook(b, ctx, root) {
  const inp = el('input', { type: 'text', value: b.title, maxlength: '120', 'aria-label': 'Book title' });
  const authorInp = el('input', { type: 'text', value: b.author || '', maxlength: '80', placeholder: 'Author (optional)', style: { marginTop: '10px' }, 'aria-label': 'Author' });
  const body = el('div', {},
    inp, authorInp,
    el('button', { class: 'btn primary', style: { marginTop: '14px' }, onclick: async () => {
      const title = inp.value.trim();
      if (!title) { toast('Give it a title'); return; }
      await updateBookMeta(b.id, { title, author: authorInp.value.trim(), coverHue: coverHueFor(title) });
      sheet.close(); toast('Renamed'); renderLibrary(root, ctx);
    } }, 'Save'),
  );
  const sheet = openSheet({ title: 'Rename book', body, modal: true });
  setTimeout(() => inp.focus(), 250);
}

function safeName(t) { return t.replace(/[^\w\d\-. ]+/g, '').replace(/\s+/g, '-').slice(0, 60) || 'book'; }

// ---------- import ----------
export function openImportSheet(ctx) {
  const tile = (icon, t, d, fn) => el('button', { class: 'src-tile', onclick: () => { sheet.close(); fn(); } },
    el('div', { class: 't' }, svgIcon(icon, 16), t), el('div', { class: 'd', text: d }));

  const body = el('div', {},
    el('div', { class: 'src-grid' },
      tile('doc', 'File', 'PDF · EPUB · DOCX · TXT · MD', () => pickFiles(ctx, ACCEPT, false)),
      tile('photo', 'Photos of pages', 'AI reads the text (needs the AI server)', () => pickFiles(ctx, 'image/*', true)),
      tile('text', 'Paste text', 'Any text you’ve copied', () => pasteTextFlow(ctx)),
      tile('book', 'Sample book', 'The Time Machine · H. G. Wells', () => addSampleBook(ctx)),
    ),
    el('div', { style: { fontSize: '11px', color: 'var(--text4)', lineHeight: '1.5', marginTop: '12px' },
      text: 'Everything stays on this device. Photos are sent only to your own local AI server for OCR.' }),
  );
  const sheet = openSheet({ title: 'Add a book', body });
}

function pickFiles(ctx, accept, multiple) {
  const input = document.getElementById('file-input');
  input.accept = accept;
  input.multiple = !!multiple;
  input.value = '';
  input.onchange = async () => {
    const files = Array.from(input.files || []);
    if (!files.length) return;
    if (files.length > 1 && files.every((f) => (f.type || '').startsWith('image/'))) {
      runImport(ctx, () => extractPhotos(files, progressHandler()), 'photo');
    } else {
      runImport(ctx, (onP) => extractFile(files[0], onP), null, files[0]);
    }
  };
  input.click();
}

function pasteTextFlow(ctx) {
  const title = el('input', { type: 'text', placeholder: 'Title', maxlength: '120' });
  const ta = el('textarea', { rows: '8', placeholder: 'Paste the text here…', style: { marginTop: '10px', resize: 'vertical', minHeight: '140px' } });
  const body = el('div', {},
    title, ta,
    el('button', { class: 'btn primary', style: { marginTop: '12px' }, onclick: async () => {
      const text = ta.value.trim();
      if (text.split(/\s+/).length < 20) { toast('Paste at least a paragraph or two'); return; }
      sheet.close();
      const paras = paragraphsFromText(stripMarkdown(text));
      const chapters = detectChapters(paras);
      await finishImport(ctx, { title: title.value.trim() || 'Pasted text', author: '', kind: 'TEXT', paras: stripChapterMarkers(paras), chapters, words: text.split(/\s+/).length });
    } }, 'Add to library'),
  );
  const sheet = openSheet({ title: 'Paste text', body });
  setTimeout(() => title.focus(), 250);
}

export async function addSampleBook(ctx) {
  const existing = (await listBooks()).find((b) => b.sample);
  if (existing) { toast('The sample is already in your library'); ctx.openReader(existing.id); return; }
  const paras = paragraphsFromText(SAMPLE_TEXT);
  const chapters = detectChapters(paras);
  await finishImport(ctx, { title: SAMPLE_TITLE, author: SAMPLE_AUTHOR, kind: 'EPUB', paras: stripChapterMarkers(paras), chapters, words: SAMPLE_TEXT.split(/\s+/).length, sample: true }, { quiet: true });
}

let progressUi = null;
function progressHandler() { return (p) => progressUi && progressUi(p); }

/** Full-screen import progress overlay with error recovery. */
function runImport(ctx, job, forcedKind, file) {
  const overlay = el('div', { class: 'screen-fixed fadein', style: { position: 'absolute', inset: '0', zIndex: '65', background: 'var(--bg)', padding: '0 22px' } });
  document.getElementById('app').appendChild(overlay);

  const stepsDef = ['Opening file', 'Extracting text', 'Detecting chapters', 'Ready to read'];
  let closed = false;
  const close = () => { if (!closed) { closed = true; overlay.remove(); } };

  const render = (state) => {
    overlay.innerHTML = '';
    overlay.appendChild(el('div', { style: { display: 'flex', justifyContent: 'flex-start', paddingTop: '10px' } },
      el('button', { class: 'btn ghost small', onclick: () => { close(); } }, 'Cancel'),
    ));
    const mid = el('div', { style: { flex: '1', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', textAlign: 'center' } });
    overlay.appendChild(mid);

    mid.appendChild(el('div', { style: { animation: state.error ? 'none' : 'pulse 2.4s ease-in-out infinite', marginBottom: '20px' } }, svgIcon('eye', 64)));
    mid.appendChild(el('div', { style: { fontSize: '21px', fontWeight: '800', letterSpacing: '-.4px' }, text: state.error ? 'Import failed' : (state.done ? 'Ready to read' : 'Preparing your book') }));
    mid.appendChild(el('div', { style: { fontSize: '12px', color: 'var(--text4)', marginTop: '6px' }, text: state.note || (file ? file.name : '') }));

    if (state.error) {
      mid.appendChild(el('div', { class: 'notice err', style: { width: '100%', marginTop: '18px', textAlign: 'left' }, text: state.error }));
      mid.appendChild(el('div', { class: 'row', style: { width: '100%', marginTop: '14px' } },
        el('button', { class: 'btn', style: { flex: '1' }, onclick: () => { close(); openImportSheet(ctx); } }, 'Choose another file'),
        el('button', { class: 'btn primary', style: { flex: '1' }, onclick: () => { close(); runImport(ctx, job, forcedKind, file); } }, 'Try again'),
      ));
      return;
    }

    const pct = Math.round((state.pct || 0) * 100);
    const bar = el('div', { style: { width: '100%', marginTop: '24px' } },
      el('div', { class: 'row', style: { justifyContent: 'space-between', marginBottom: '8px' } },
        el('span', { style: { fontSize: '12px', color: 'var(--text3)' }, text: state.done ? 'Done' : 'Extracting' }),
        el('span', { class: 'mono', style: { fontSize: '13px', color: 'var(--accent)' }, text: pct + '%' }),
      ),
      el('div', { style: { height: '6px', borderRadius: '3px', background: 'var(--line2)', overflow: 'hidden' } },
        el('div', { style: { width: pct + '%', height: '100%', background: 'linear-gradient(90deg,var(--accent),color-mix(in srgb,var(--accent) 60%,#fff))', transition: 'width .15s linear' } }),
      ),
    );
    mid.appendChild(bar);

    const steps = el('div', { class: 'extract-steps' });
    stepsDef.forEach((label, i) => {
      const cls = i < state.step ? 'done' : i === state.step ? 'active' : 'pending';
      steps.appendChild(el('div', { class: 'extract-step ' + cls }, el('div', { class: 'dot' }), el('span', { text: label })));
    });
    mid.appendChild(steps);

    if (state.done && state.result) {
      const r = state.result;
      mid.appendChild(el('div', { class: 'notice ok', style: { width: '100%', marginTop: '20px' },
        text: `“${r.title}” · ${fmtK(r.words)} words · ${r.chapters ? r.chapters.length : 1} sections` }));
      overlay.appendChild(el('div', { style: { padding: '14px 0 26px' } },
        el('button', { class: 'btn primary', onclick: async () => { const id = await persist(r); close(); ctx.openReader(id); } }, 'Start reading'),
        el('button', { class: 'btn ghost', style: { marginTop: '8px' }, onclick: async () => { await persist(r); close(); ctx.refreshTab(); toast('Added to your library'); } }, 'Add to library'),
      ));
    }
  };

  let last = { step: 0, pct: 0 };
  render(last);
  progressUi = (p) => { if (!closed) { last = { ...last, ...p }; render(last); } };

  job((p) => progressUi(p))
    .then((result) => { if (!closed) render({ step: 4, pct: 1, done: true, result }); })
    .catch((e) => { if (!closed) render({ ...last, error: (e && e.message) || 'Something went wrong reading that file.' }); });

  async function persist(r) {
    const id = uid();
    const meta = {
      id, title: r.title, author: r.author || '', kind: forcedKind === 'photo' ? 'SCAN' : (r.kind || 'TEXT'),
      words: r.words, chapterCount: r.chapters ? r.chapters.length : 1,
      addedAt: Date.now(), lastReadAt: 0, archived: 0, pos: 0, pct: 0,
      coverHue: coverHueFor(r.title), sample: !!r.sample,
    };
    await saveBook(meta, { paras: r.paras, chapters: r.chapters || [] });
    return id;
  }
}

/** Direct import used by paste + sample (no file job). */
async function finishImport(ctx, r, { quiet } = {}) {
  const id = uid();
  const meta = {
    id, title: r.title, author: r.author || '', kind: r.kind || 'TEXT',
    words: r.words, chapterCount: r.chapters ? r.chapters.length : 1,
    addedAt: Date.now(), lastReadAt: 0, archived: 0, pos: 0, pct: 0,
    coverHue: coverHueFor(r.title), sample: !!r.sample,
  };
  await saveBook(meta, { paras: r.paras, chapters: r.chapters || [] });
  if (!quiet) toast('Added to your library');
  ctx.openReader(id);
  return id;
}
