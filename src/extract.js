// extract.js — turn uploaded files into readable books.
// PDF via pdf.js, EPUB/DOCX via jszip (both vendored, loaded on demand),
// TXT/MD directly, photos via the local AI server's OCR.

import { paragraphsFromText, detectChapters, stripChapterMarkers } from './tokenize.js';
import { aiOcr } from './ai.js';

const MAX_FILE_MB = 80;

function loadScriptOnce(src) {
  if (!loadScriptOnce._p) loadScriptOnce._p = {};
  if (loadScriptOnce._p[src]) return loadScriptOnce._p[src];
  loadScriptOnce._p[src] = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error('Could not load ' + src));
    document.head.appendChild(s);
  });
  return loadScriptOnce._p[src];
}

async function getPdfJs() {
  await loadScriptOnce('./vendor/pdf.min.js');
  const lib = window.pdfjsLib || (window.pdfjs && window.pdfjs.GlobalWorkerOptions ? window.pdfjs : null);
  if (!lib) throw new Error('PDF engine failed to load.');
  lib.GlobalWorkerOptions.workerSrc = './vendor/pdf.worker.min.js';
  return lib;
}

async function getJSZip() {
  await loadScriptOnce('./vendor/jszip.min.js');
  if (!window.JSZip) throw new Error('Zip engine failed to load.');
  return window.JSZip;
}

export function kindForFile(file) {
  const name = (file.name || '').toLowerCase();
  const type = (file.type || '').toLowerCase();
  if (type.includes('pdf') || name.endsWith('.pdf')) return 'pdf';
  if (name.endsWith('.epub') || type.includes('epub')) return 'epub';
  if (name.endsWith('.docx')) return 'docx';
  if (type.startsWith('image/') || /\.(png|jpe?g|webp|heic|heif)$/.test(name)) return 'photo';
  if (name.endsWith('.md') || name.endsWith('.markdown')) return 'md';
  if (type.startsWith('text/') || name.endsWith('.txt') || name.endsWith('.text') || name.endsWith('.rtf')) return 'text';
  return null;
}

export const ACCEPT = '.pdf,.epub,.docx,.txt,.md,.markdown,.text,application/pdf,application/epub+zip,text/*,image/*';

/**
 * Extract a single file → {title, author, kind, paras, chapters}
 * onProgress({step, pct, note}) — step: 0 open, 1 extract, 2 structure, 3 ready
 */
export async function extractFile(file, onProgress = () => {}) {
  if (file.size > MAX_FILE_MB * 1024 * 1024) {
    throw new Error(`That file is ${(file.size / 1048576).toFixed(0)} MB — the limit is ${MAX_FILE_MB} MB.`);
  }
  const kind = kindForFile(file);
  if (!kind) throw new Error(`"${file.name}" isn't a supported format. Use PDF, EPUB, DOCX, TXT, Markdown, or a photo.`);
  onProgress({ step: 0, pct: 0.04, note: 'Opening file' });

  let result;
  if (kind === 'pdf') result = await extractPdf(file, onProgress);
  else if (kind === 'epub') result = await extractEpub(file, onProgress);
  else if (kind === 'docx') result = await extractDocx(file, onProgress);
  else if (kind === 'photo') result = await extractPhotos([file], onProgress);
  else result = await extractPlainText(file, kind, onProgress);

  onProgress({ step: 2, pct: 0.92, note: 'Detecting chapters' });
  if (!result.chapters) result.chapters = detectChapters(result.paras);
  result.paras = stripChapterMarkers(result.paras);
  const words = result.paras.reduce((n, p) => n + (p.img != null ? 0 : p.s.split(/\s+/).length), 0);
  if (words < 5) throw new Error('No readable text was found in that file.');
  onProgress({ step: 3, pct: 1, note: 'Ready' });
  return { ...result, kind: result.kind || kind, words };
}

// ---------- plain text / markdown ----------
async function extractPlainText(file, kind, onProgress) {
  onProgress({ step: 1, pct: 0.35, note: 'Reading text' });
  let text = await file.text();
  if (kind === 'md') text = stripMarkdown(text);
  const paras = paragraphsFromText(text);
  return { title: cleanTitle(file.name), author: '', kind: kind === 'md' ? 'MD' : 'TEXT', paras };
}

export function stripMarkdown(md) {
  return String(md)
    .replace(/^```[\s\S]*?^```/gm, '') // fenced code blocks
    .replace(/^#{1,6}\s+(.+)$/gm, '### $1') // headings → chapter markers
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1') // images → alt text
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1') // links → text
    .replace(/(\*\*|__)(.*?)\1/g, '$2')
    .replace(/(\*|_)(.*?)\1/g, '$2')
    .replace(/^>\s?/gm, '')
    .replace(/^[-*+]\s+/gm, '')
    .replace(/`([^`]+)`/g, '$1');
}

// ---------- PDF ----------
async function extractPdf(file, onProgress) {
  const pdfjs = await getPdfJs();
  onProgress({ step: 1, pct: 0.08, note: 'Opening PDF' });
  const data = await file.arrayBuffer();
  let doc;
  try {
    doc = await pdfjs.getDocument({ data, isEvalSupported: false }).promise;
  } catch (e) {
    throw new Error(/password/i.test(String(e && e.message)) ? 'That PDF is password-protected.' : 'That PDF could not be opened — it may be corrupted.');
  }

  const pages = doc.numPages;
  const lines = [];
  let emptyPages = 0;
  for (let n = 1; n <= pages; n++) {
    const page = await doc.getPage(n);
    const content = await page.getTextContent();
    const pageLines = linesFromTextContent(content);
    if (!pageLines.join('').trim()) emptyPages++;
    lines.push(...pageLines, ''); // page break = blank line candidate
    onProgress({ step: 1, pct: 0.08 + 0.7 * (n / pages), note: `Extracting page ${n} of ${pages}` });
    page.cleanup();
  }

  if (emptyPages > pages * 0.8) {
    throw new Error('This PDF has no embedded text — it looks scanned. Import its pages as photos instead and Ocellus will OCR them.');
  }

  const text = joinPdfLines(lines);
  const paras = paragraphsFromText(text);

  // Prefer the PDF's own outline for chapters when present.
  let chapters = null;
  try {
    const outline = await doc.getOutline();
    if (outline && outline.length >= 2) {
      const flat = outline.slice(0, 80).map((o) => String(o.title || '').trim()).filter(Boolean);
      if (flat.length >= 2) {
        chapters = [];
        let searchFrom = 0;
        for (const t of flat) {
          const idx = paras.findIndex((p, i) => i >= searchFrom && p.s && p.s.toLowerCase().startsWith(t.slice(0, 40).toLowerCase()));
          if (idx >= 0) { chapters.push({ title: t.slice(0, 80), pIndex: idx, skip: false }); searchFrom = idx + 1; }
        }
        if (chapters.length < 2) chapters = null;
        else if (chapters[0].pIndex > 0) chapters.unshift({ title: 'Beginning', pIndex: 0, skip: false });
      }
    }
  } catch {}

  const meta = await doc.getMetadata().catch(() => null);
  const info = meta && meta.info ? meta.info : {};
  await doc.destroy();
  return {
    title: cleanTitle(info.Title && String(info.Title).trim() ? String(info.Title) : file.name),
    author: info.Author ? String(info.Author).slice(0, 80) : '',
    kind: 'PDF',
    paras,
    chapters,
  };
}

function linesFromTextContent(content) {
  // Group text items into visual lines by their y coordinate.
  const rows = [];
  for (const item of content.items) {
    if (!item.str) continue;
    const y = Math.round(item.transform[5]);
    let row = rows.find((r) => Math.abs(r.y - y) <= 2);
    if (!row) { row = { y, parts: [] }; rows.push(row); }
    row.parts.push({ x: item.transform[4], str: item.str });
  }
  rows.sort((a, b) => b.y - a.y); // top → bottom (PDF y grows upward)
  return rows.map((r) => r.parts.sort((a, b) => a.x - b.x).map((p) => p.str).join(' ').replace(/\s+/g, ' ').trim());
}

export function joinPdfLines(lines) {
  // Rebuild paragraphs: a line that ends without terminal punctuation and is
  // followed by a lowercase start continues the same paragraph.
  const out = [];
  let cur = '';
  for (let raw of lines) {
    const line = raw.trim();
    if (!line) { if (cur) { out.push(cur); cur = ''; } continue; }
    if (/^\d{1,4}$/.test(line)) continue; // bare page numbers
    if (cur) {
      const hyphen = /[A-Za-z]-$/.test(cur);
      if (hyphen) cur = cur.slice(0, -1) + line;
      else cur += ' ' + line;
    } else cur = line;
    const endsSentence = /[.!?:…]["'”’)\]]*$/.test(line);
    const shortLine = line.length < 55;
    if (endsSentence && shortLine) { out.push(cur); cur = ''; }
  }
  if (cur) out.push(cur);
  return out.join('\n\n');
}

// ---------- EPUB ----------
async function extractEpub(file, onProgress) {
  const JSZip = await getJSZip();
  onProgress({ step: 1, pct: 0.1, note: 'Unpacking EPUB' });
  const zip = await JSZip.loadAsync(await file.arrayBuffer()).catch(() => {
    throw new Error('That EPUB could not be opened — it may be corrupted or DRM-protected.');
  });

  const parser = new DOMParser();
  const containerXml = await zip.file('META-INF/container.xml')?.async('string');
  if (!containerXml) throw new Error('Not a valid EPUB (missing container.xml). DRM-protected books cannot be imported.');
  const container = parser.parseFromString(containerXml, 'application/xml');
  const rootPath = container.querySelector('rootfile')?.getAttribute('full-path');
  if (!rootPath) throw new Error('Not a valid EPUB (no rootfile).');

  const opfText = await zip.file(rootPath)?.async('string');
  if (!opfText) throw new Error('Not a valid EPUB (missing package file).');
  const opf = parser.parseFromString(opfText, 'application/xml');
  const opfDir = rootPath.includes('/') ? rootPath.slice(0, rootPath.lastIndexOf('/') + 1) : '';

  const title = opf.querySelector('metadata > *|title, title')?.textContent?.trim() || cleanTitle(file.name);
  const author = opf.querySelector('metadata > *|creator, creator')?.textContent?.trim() || '';

  const manifest = {};
  opf.querySelectorAll('manifest > item').forEach((it) => {
    manifest[it.getAttribute('id')] = { href: it.getAttribute('href'), type: it.getAttribute('media-type') || '' };
  });
  const spineIds = [...opf.querySelectorAll('spine > itemref')].map((r) => r.getAttribute('idref')).filter(Boolean);
  const docs = spineIds.map((id) => manifest[id]).filter((m) => m && /html|xml/.test(m.type));
  if (!docs.length) throw new Error('This EPUB has no readable sections.');

  const paras = [];
  const chapters = [];
  const FRONT = /cover|copyright|title[-_ ]?page|toc|contents|dedication|acknowledg|colophon|imprint/i;

  for (let d = 0; d < docs.length; d++) {
    const href = decodeURIComponent(docs[d].href);
    const path = resolveZipPath(opfDir, href);
    const html = await zip.file(path)?.async('string');
    onProgress({ step: 1, pct: 0.1 + 0.7 * ((d + 1) / docs.length), note: `Reading section ${d + 1} of ${docs.length}` });
    if (!html) continue;
    const dom = parser.parseFromString(html, 'text/html');
    const body = dom.body;
    if (!body) continue;

    let sectionStart = paras.length;
    let sectionTitle = '';
    for (const node of body.querySelectorAll('h1,h2,h3,h4,p,li,blockquote,figcaption,img')) {
      if (node.closest('nav')) continue;
      if (node.tagName === 'IMG') {
        const alt = (node.getAttribute('alt') || '').trim();
        paras.push({ img: alt || 'Illustration' });
        continue;
      }
      const t = (node.textContent || '').replace(/\s+/g, ' ').trim();
      if (!t) continue;
      if (/^H[1-4]$/.test(node.tagName)) {
        if (!sectionTitle) sectionTitle = t.slice(0, 80);
        chapters.push({ title: t.slice(0, 80), pIndex: paras.length, skip: FRONT.test(href) || FRONT.test(t) });
        paras.push({ s: t });
      } else {
        paras.push({ s: t });
      }
    }
    if (paras.length > sectionStart && !chapters.some((c) => c.pIndex >= sectionStart && c.pIndex < paras.length)) {
      chapters.push({ title: sectionTitle || `Section ${chapters.length + 1}`, pIndex: sectionStart, skip: FRONT.test(href) });
    }
  }

  if (!paras.length) throw new Error('No readable text found in this EPUB.');
  const seen = new Set();
  const chaps = chapters.filter((c) => { const k = c.title + '@' + c.pIndex; if (seen.has(k)) return false; seen.add(k); return true; });
  if (!chaps.length || chaps[0].pIndex > 0) chaps.unshift({ title: 'Beginning', pIndex: 0, skip: false });
  return { title, author, kind: 'EPUB', paras, chapters: chaps };
}

function resolveZipPath(baseDir, href) {
  const parts = (baseDir + href).split('/');
  const out = [];
  for (const p of parts) {
    if (p === '..') out.pop();
    else if (p !== '.' && p !== '') out.push(p);
  }
  return out.join('/');
}

// ---------- DOCX ----------
async function extractDocx(file, onProgress) {
  const JSZip = await getJSZip();
  onProgress({ step: 1, pct: 0.2, note: 'Unpacking document' });
  const zip = await JSZip.loadAsync(await file.arrayBuffer()).catch(() => {
    throw new Error('That DOCX could not be opened — it may be corrupted.');
  });
  const xml = await zip.file('word/document.xml')?.async('string');
  if (!xml) throw new Error('Not a valid Word document.');
  onProgress({ step: 1, pct: 0.55, note: 'Extracting text' });
  const dom = new DOMParser().parseFromString(xml, 'application/xml');
  const paras = [];
  const chapters = [];
  const pNodes = dom.getElementsByTagName('w:p');
  for (let i = 0; i < pNodes.length; i++) {
    const pn = pNodes[i];
    let text = '';
    const tNodes = pn.getElementsByTagName('w:t');
    for (let j = 0; j < tNodes.length; j++) text += tNodes[j].textContent;
    text = text.replace(/\s+/g, ' ').trim();
    if (!text) continue;
    const style = pn.getElementsByTagName('w:pStyle')[0]?.getAttribute('w:val') || '';
    if (/^Heading[123]$/i.test(style) || /^Title$/i.test(style)) {
      chapters.push({ title: text.slice(0, 80), pIndex: paras.length, skip: false });
    }
    paras.push({ s: text });
  }
  if (!paras.length) throw new Error('No readable text found in that document.');
  if (!chapters.length || chapters[0].pIndex > 0) chapters.unshift({ title: 'Beginning', pIndex: 0, skip: false });
  return { title: cleanTitle(file.name), author: '', kind: 'DOCX', paras, chapters: chapters.length > 1 ? chapters : null };
}

// ---------- photos (OCR via local AI server) ----------
export async function extractPhotos(files, onProgress) {
  const texts = [];
  for (let i = 0; i < files.length; i++) {
    onProgress({ step: 1, pct: 0.05 + 0.85 * (i / files.length), note: `Reading photo ${i + 1} of ${files.length} with AI` });
    const b64 = await fileToBase64(files[i]);
    const text = await aiOcr({ imageBase64: b64, mimeType: files[i].type || 'image/jpeg' });
    if (text && text.trim()) texts.push(text.trim());
  }
  if (!texts.length) throw new Error('The AI could not read any text in those photos. Try sharper, well-lit shots.');
  const paras = paragraphsFromText(texts.join('\n\n'));
  return { title: 'Scanned pages', author: '', kind: 'SCAN', paras, chapters: null };
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onerror = () => reject(new Error('Could not read that file.'));
    r.onload = () => resolve(String(r.result || '').split(',')[1] || '');
    r.readAsDataURL(file);
  });
}

export function cleanTitle(name) {
  return String(name || 'Imported document').replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120) || 'Imported document';
}

export function coverHueFor(title) {
  let h = 0;
  for (let i = 0; i < title.length; i++) h = (h * 31 + title.charCodeAt(i)) % 360;
  return h;
}
