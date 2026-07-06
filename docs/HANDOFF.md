# Ocellus — session handoff (2026-07-06)

Self-contained context for a fresh Claude session (new account, no prior memory). Read this fully before touching anything.

## What this is
**Ocellus** — a local-first speed-reading PWA. Import books (PDF/EPUB/DOCX/TXT/MD/paste/photo-OCR) → they convert on-device into a real library (IndexedDB) → read with a **guided pacer** (underline/band/dot follows the words) or a **flash trainer** (one word at a time on a fixed focus point) → optional AI quizzes/assistant grounded in the actual book text → real Progress screen with a daily-goal ring and an honest coach.

- **Folder:** `~/Desktop/Ocellus speed-reading app` (own git repo — NOT part of Knock'a)
- **Live installable PWA:** https://jakesev.github.io/ocellus/ (GitHub repo `jakesev/ocellus`, public, Pages via Actions workflow `.github/workflows/pages.yml`)
- **Installed on the owner's S23** (WebAPK via Brave → Add to home screen → Install). adb serial in recent use: `R5CW60PJXMA` (adb at `~/Library/Android/sdk/platform-tools/adb`).
- **Run locally:** `node ocellus-gemma-local.mjs` → http://127.0.0.1:8787/ (+ printed LAN URL). Preview entry exists in Knock'a's `.claude/launch.json` as `ocellus` on port **8791**.
- **Tests:** `npm test` → 59 passing (`node --test`, zero deps). **Typecheck:** none (plain JS); `node --check` silently NO-OPS on ES modules — the real gate is `tests/parse.test.mjs` which imports every module.

## Architecture (dependency-free, no build step)
- `index.html` + `styles.css` (design tokens, dark-first, safe-areas) + `src/*.js` ES modules; screens in `src/screens/`.
- `src/tokenize.js` — pure text logic: paragraphs→tokens (punctuation ALWAYS glued to words — never a lone `.` `"` `,`), chapter detection, `splitLongChapters` (big/chapter-less books → "Title · n/N" parts, keeps guided DOM ≤ ~6k spans), ORP index, `tokenMs` timing (pauses exclusive, hard cap 2.2×).
- `src/reader.js` — engine: drift-free scheduler (`nextFlashTarget` — absorbs timer jitter, keeps WPM honest, re-anchors after real stalls, never bursts), wake lock, session accounting; `clampFlashLeft` keeps flash words inside the frame; `orpLayout` canvas measurement.
- `src/screens/reader.js` — guided pacer (getClientRects positioning, SNAPS on line change), flash view (**`flashAlign` setting: 'center' default = word balanced on the middle line; 'orp' = classic focus-letter**), contents sheet with per-chapter ✓/reading/todo + "N of M complete", chapter-complete toast (only on read-through, `celebrated` Set), AI sheet, quiz, bookmarks.
- `src/db.js` — IndexedDB: books meta + text, sessions (power Progress), bookmarks. `src/settings.js` — localStorage, live-applied (incl. `goals`, `dailyGoalMin` from onboarding → Progress ring + coach).
- `ocellus-gemma-local.mjs` — static server + AI endpoints (`/api/ai/health|quiz|assist|ocr`, `/api/import`). **Gemma key lives ONLY in `.env.local`** (gitignored). Gemma-4 needs `thinkingConfig.thinkingLevel='MINIMAL'` AND filtering response parts with `thought:true`, else chain-of-thought leaks (pattern from Knock'a `src/server/aiHandler.ts`). API is **same-origin only**: foreign `Origin` → 403, no CORS headers, 120 req/min/IP rate limit.
- `vendor/` — pinned pdf.js + jszip (offline). `sw.js` — precache, **CACHE_NAME currently `ocellus-app-v9`** (bump on every deployable change or installed PWAs keep stale code). `mockup/` — the original paper.design prototype (reference only).

## State: what's shipped (all live at v9)
1. Full production rebuild replacing the mockup (commit `1d9c03e`; prototype snapshot `7b04aed`).
2. Pacer accuracy: rect-based underline, line-snap, no-burst scheduler (`tests/engine.test.mjs`).
3. Speed test: original story "The Four A.M. Baker" (`src/passages.js`), Quick 184w / Full 380w selector, section dots; onboarding baseline uses it.
4. GitHub Pages deploy + S23 install; real 142k-word PDF (Poor Charlie's Almanack) converted on-device.
5. Onboarding→workflow: goals + daily minutes persist → Progress daily-goal ring + coach "Working toward" line.
6. Independent adversarial review round: 5 real bugs found & fixed (flash right-edge clip → `clampFlashLeft`; last chapter never ✓; false "Chapter complete" on jump-over; toast clobber; re-fire on re-cross).
7. Enterprise hardening: CORS/private-network hole closed (was `ACAO:*` + `Allow-Private-Network:true` — any website could spend the Gemma quota), rate limit, global error net (window error/unhandledrejection → toast), O(1) time-left via cumulative multiplier prefix, `splitLongChapters` (45k-word book: 45,000 → 5,700 guided spans), `prefers-reduced-motion`.
8. Flash feel (owner phone feedback): **words geometrically centered by default** (±0.8px verified; ORP optional in Settings → "Word position"), pause multipliers un-stacked + capped 2.2× (was 4.3× hangs), jitter-absorbing cadence, countdown only on fresh start/15s+ pause, gentler ramp.

## OPEN ITEMS (the current order is NOT fully closed)
1. **📍 25d — Owner re-feel of Flash v9 on the S23.** v9 is live on the CDN. Owner must cold-launch Ocellus twice (first fetch, second run) and confirm centering + smoothness at 300wpm. If still "sticky": suspects are `tokenMs` weights (`src/tokenize.js`), ramp (`_rampLeft`/0.075 in `src/reader.js`), `nextFlashTarget` 0.6× floor.
2. **⬜ 26 — optional external Codex `/test` pass.** A copy-ready prompt exists in the previous session log; regenerate if needed (test: centering/clamp, chapter ✓ incl. LAST chapter, toast only on read-through, onboarding→ring persistence, jump-back-in dedup, 59 tests).
3. **⬜ .docx real-fixture test** (parser tested only at unit level — no real .docx file was on disk).
4. **⬜ TOC-heavy PDFs get coarse chapters** (e.g. Poor Charlie's Almanack = 8 outline chapters, TOC merged into front) — mitigated by `splitLongChapters` parts; a proper fix would improve PDF outline/heading detection in `src/extract.js`.

## Hard-won gotchas (do not re-learn these the painful way)
- **`node --check` passes broken ES modules.** Always run `npm test` (parse gate) instead.
- **rAF never fires in hidden tabs** → initial paints must be synchronous (already are). The preview/headless tab also throttles `setTimeout` to ~1/s — engine "slowness" in preview is an artifact; assert end-states, not wall-clock.
- **GitHub Pages deploys:** wait on the run **matched by head SHA** (`gh run list --json headSha…`), NOT `--limit 1` (race → you read the previous run's success; happened once, and the v9 run had also transiently failed with "Deployment failed, try again later" → `gh run rerun <id>` fixed it). CDN edge caches ~10 min — poll `sw.js` for the new CACHE_NAME with a cache-buster.
- **Installed WebAPK updates:** SW updates in background → tell the owner "close from recents, open twice".
- **Preview MCP:** use the `ocellus` launch entry (port 8791). The knocka repo's launch.json is shared — don't clobber other entries.
- **Owner style (no memory on the new account, so know this):** non-deep-technical; wants concrete step-by-step, propose→confirm→build→verify one slice at a time; NEVER wave off a named risk (fix / track / explicitly accept); end substantive turns with a cumulative Stage|Status|Notes table carried forward (see docs/STATUS.md convention in the Knock'a repo — for Ocellus keep the same discipline in-chat); rebuild/redeploy after merges so devices stay in lockstep; verification = prove on the real device, not just green tests.

## Useful commands
```bash
cd ~/Desktop/"Ocellus speed-reading app"
node ocellus-gemma-local.mjs      # run app+AI locally (key in .env.local)
npm test                          # 59 tests
git log --oneline | head          # history reads as the build journal
gh run list --repo jakesev/ocellus --limit 3   # deploys (needs gh auth as jakesev)
```
Note: GitHub/gh auth is the **jakesev** account — unrelated to which Claude account is used. If gh isn't authed in the new environment, deploys still happen via `git push` (workflow runs server-side); you only lose `gh run` monitoring.
