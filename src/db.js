// db.js — IndexedDB persistence: book metadata, book text, reading sessions, bookmarks.

const DB_NAME = 'ocellus';
const DB_VERSION = 1;
let dbPromise = null;

export function openDB() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('books')) {
        const s = db.createObjectStore('books', { keyPath: 'id' });
        s.createIndex('lastReadAt', 'lastReadAt');
      }
      if (!db.objectStoreNames.contains('bookText')) db.createObjectStore('bookText', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('sessions')) {
        const s = db.createObjectStore('sessions', { keyPath: 'id', autoIncrement: true });
        s.createIndex('date', 'date');
        s.createIndex('bookId', 'bookId');
      }
      if (!db.objectStoreNames.contains('bookmarks')) {
        const s = db.createObjectStore('bookmarks', { keyPath: 'id', autoIncrement: true });
        s.createIndex('bookId', 'bookId');
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error('Could not open the local database.'));
  });
  return dbPromise;
}

function tx(db, store, mode, fn) {
  return new Promise((resolve, reject) => {
    const t = db.transaction(store, mode);
    const s = t.objectStore(store);
    let result;
    try { result = fn(s); } catch (e) { reject(e); return; }
    t.oncomplete = () => resolve(result && result.result !== undefined ? result.result : result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error || new Error('Transaction aborted'));
  });
}

function reqAsPromise(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

// ---------- books ----------
// meta: {id,title,author,kind,words,chapterCount,addedAt,lastReadAt,archived,pos,pct,coverHue}
// text: {id, paras: [{s, img?}], chapters: [{title, tIndex, pIndex, skip}]}

export async function saveBook(meta, text) {
  const db = await openDB();
  await tx(db, 'books', 'readwrite', (s) => s.put(meta));
  if (text) await tx(db, 'bookText', 'readwrite', (s) => s.put({ id: meta.id, ...text }));
  return meta;
}

export async function updateBookMeta(id, patch) {
  const db = await openDB();
  const meta = await tx(db, 'books', 'readonly', (s) => reqAsPromise(s.get(id))).then((r) => r);
  if (!meta) return null;
  const next = { ...meta, ...patch };
  await tx(db, 'books', 'readwrite', (s) => s.put(next));
  return next;
}

export async function listBooks() {
  const db = await openDB();
  const all = await tx(db, 'books', 'readonly', (s) => reqAsPromise(s.getAll()));
  return (all || []).sort((a, b) => (b.lastReadAt || b.addedAt || 0) - (a.lastReadAt || a.addedAt || 0));
}

export async function getBook(id) {
  const db = await openDB();
  return tx(db, 'books', 'readonly', (s) => reqAsPromise(s.get(id)));
}

export async function getBookText(id) {
  const db = await openDB();
  return tx(db, 'bookText', 'readonly', (s) => reqAsPromise(s.get(id)));
}

export async function deleteBook(id) {
  const db = await openDB();
  await tx(db, 'books', 'readwrite', (s) => s.delete(id));
  await tx(db, 'bookText', 'readwrite', (s) => s.delete(id));
  const marks = await listBookmarks(id);
  for (const m of marks) await deleteBookmark(m.id);
}

// ---------- sessions (real reading history; powers Progress) ----------
// {bookId, bookTitle, date, mode:'guided'|'flash'|'natural', wpm, words, seconds, quizScore?, quizTotal?}

export async function addSession(session) {
  const db = await openDB();
  return tx(db, 'sessions', 'readwrite', (s) => s.add({ ...session, date: session.date || Date.now() }));
}

export async function listSessions(limit = 500) {
  const db = await openDB();
  const all = await tx(db, 'sessions', 'readonly', (s) => reqAsPromise(s.getAll()));
  return (all || []).sort((a, b) => a.date - b.date).slice(-limit);
}

export async function attachQuizToLastSession(bookId, quizScore, quizTotal) {
  const db = await openDB();
  const all = await tx(db, 'sessions', 'readonly', (s) => reqAsPromise(s.getAll()));
  const mine = (all || []).filter((s) => s.bookId === bookId).sort((a, b) => b.date - a.date);
  if (!mine.length) return;
  const last = { ...mine[0], quizScore, quizTotal };
  await tx(db, 'sessions', 'readwrite', (s) => s.put(last));
}

export async function clearSessions() {
  const db = await openDB();
  await tx(db, 'sessions', 'readwrite', (s) => s.clear());
}

// ---------- bookmarks ----------
export async function addBookmark(mark) {
  const db = await openDB();
  return tx(db, 'bookmarks', 'readwrite', (s) => s.add({ ...mark, createdAt: Date.now() }));
}

export async function listBookmarks(bookId) {
  const db = await openDB();
  const all = await tx(db, 'bookmarks', 'readonly', (s) => reqAsPromise(s.getAll()));
  const list = (all || []).sort((a, b) => b.createdAt - a.createdAt);
  return bookId ? list.filter((m) => m.bookId === bookId) : list;
}

export async function deleteBookmark(id) {
  const db = await openDB();
  await tx(db, 'bookmarks', 'readwrite', (s) => s.delete(id));
}

export function uid() {
  return 'b' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}
