# Ocellus

Local-first speed-reading book reader. Import PDFs, EPUBs, Word docs, text/Markdown, or photos of pages; read them with a **guided eye pacer** or an **ORP word flasher**; check comprehension with AI quizzes grounded in what you just read; track real progress.

## Run it

```bash
node ocellus-gemma-local.mjs
```

Then open **http://127.0.0.1:8787/** on this computer, or the printed *Phone Wi-Fi URL* on your phone (same Wi-Fi). Install it from the browser menu ("Add to Home Screen") — it's a PWA and works offline after the first load.

- **AI features** (quizzes, OCR of photos, reading assistant) need `GEMMA_API_KEY` in `.env.local` (Google AI Studio key, stays server-side) — or set `AI_PROVIDER=ollama` for a local model. Without it, everything else still works.
- Photo import and the assistant only work while the server is reachable; reading, importing files, progress and exports are fully client-side.

## Development

```bash
npm test    # unit tests (tokeniser, ORP, timing, chapter detection, PDF line joining)
npm run check  # syntax-check every module
```

No build step, no dependencies: plain ES modules served statically. `vendor/` holds pinned copies of pdf.js and JSZip so the app works offline.

## Layout

- `index.html`, `styles.css`, `src/` — the app (screens in `src/screens/`)
- `ocellus-gemma-local.mjs` — static server + AI endpoints (`/api/ai/*`, `/api/import`); the Gemma key never reaches the client
- `tests/` — `node --test` suites
- `mockup/` — the original paper.design prototype this app replaced (kept for reference at `/mockup/app.html`)

## Reading science, applied

- **Flash mode** aligns each word so its *optimal recognition point* (the letter ~1/3 in) sits on a fixed focus mark — the eye never moves ([Spritz](https://www.spritzreader.com/how-it-works)).
- **Variable timing**: long words, numbers, clause/sentence ends and paragraph breaks get proportionally more time — the pattern shown to protect comprehension in RSVP reading.
- **Guided mode** paces your eyes across the real page (meta-guiding) — better for retention; Flash trains raw speed.
- The **coach** only recommends speed increases when quiz comprehension stays ≥80%, and consolidates around ~500 WPM where research shows comprehension typically drops.
