#!/usr/bin/env node
"use strict";

import { createReadStream } from "node:fs";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { createServer } from "node:http";
import { networkInterfaces, tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const __filename = fileURLToPath(import.meta.url);
const APP_DIR = path.dirname(__filename);
const ENV_PATH = process.env.OCELLUS_ENV || path.join(APP_DIR, ".env.local");
const execFileAsync = promisify(execFile);

const env = { ...(await readLocalEnv(ENV_PATH)), ...process.env };
const provider = (env.AI_PROVIDER || (env.OLLAMA_BASE_URL ? "ollama" : "google")).toLowerCase();
const config = {
  host: env.OCELLUS_HOST || "127.0.0.1",
  port: Number(env.PORT || env.OCELLUS_PORT || 8787),
  provider,
  model: env.AI_MODEL || (provider === "ollama" ? "gemma4" : "gemma-4-31b-it"),
  googleApiBase: stripSlash(env.GEMMA_API_BASE || env.AI_API_BASE || "https://generativelanguage.googleapis.com/v1beta"),
  googleApiKey: env.GEMMA_API_KEY || env.GOOGLE_API_KEY || "",
  ollamaBase: stripSlash(env.OLLAMA_BASE_URL || "http://127.0.0.1:11434"),
  timeoutMs: clamp(Number(env.AI_TIMEOUT_MS || 60000), 5000, 180000),
};

const mimeTypes = new Map([
  [".html", "text/html; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".mjs", "text/javascript; charset=utf-8"],
  [".css", "text/css; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".webmanifest", "application/manifest+json; charset=utf-8"],
  [".png", "image/png"],
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".svg", "image/svg+xml; charset=utf-8"],
  [".webp", "image/webp"],
  [".ico", "image/x-icon"],
]);

const clientScript = String.raw`
(() => {
  const base = window.__OCELLUS_AI_BASE || "";

  async function jsonFetch(path, body) {
    const res = await fetch(base + path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body || {}),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.ok === false) {
      throw new Error(data.error || res.statusText || "AI request failed");
    }
    return data;
  }

  window.OcellusAI = {
    async health(live = false) {
      const res = await fetch(base + "/api/ai/health" + (live ? "?live=1" : ""), { cache: "no-store" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.ok === false) throw new Error(data.error || "AI health check failed");
      return data;
    },
    generate(body) {
      return jsonFetch("/api/ai/generate", body);
    },
    async generateQuiz(input) {
      const data = await jsonFetch("/api/ai/quiz", input);
      return data.questions || [];
    },
    async buildContents(input) {
      const data = await jsonFetch("/api/ai/contents", input);
      return data.sections || [];
    },
    async coach(input) {
      return jsonFetch("/api/ai/coach", input);
    },
    async ocr(input) {
      return jsonFetch("/api/ai/ocr", input);
    },
    async importFile(input) {
      return jsonFetch("/api/import", input);
    },
  };
})();
`;

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url || "/", `http://${req.headers.host || `${config.host}:${config.port}`}`);

    if (req.method === "OPTIONS") {
      res.writeHead(204, {
        ...corsHeaders(),
        "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
      });
      res.end();
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/ai/health") {
      await handleHealth(req, res, url);
      return;
    }

    if (req.method === "GET" && url.pathname === "/ocellus-ai-client.js") {
      send(res, 200, clientScript, "text/javascript; charset=utf-8");
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/ai/generate") {
      const body = await readJson(req);
      const text = await runModel({
        system: String(body.system || "You are Ocellus, a concise reading and comprehension assistant."),
        prompt: String(body.prompt || ""),
        json: Boolean(body.json),
        temperature: numberOr(body.temperature, 0.25),
      });
      json(res, 200, { ok: true, provider: config.provider, model: config.model, text });
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/ai/quiz") {
      await handleQuiz(req, res);
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/ai/assist") {
      await handleAssist(req, res);
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/ai/contents") {
      await handleContents(req, res);
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/ai/coach") {
      await handleCoach(req, res);
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/ai/ocr") {
      await handleOcr(req, res);
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/import") {
      await handleImport(req, res);
      return;
    }

    if (req.method === "GET" || req.method === "HEAD") {
      await serveStatic(req, res, url);
      return;
    }

    json(res, 405, { ok: false, error: "Method not allowed" });
  } catch (error) {
    json(res, 500, { ok: false, error: publicError(error) });
  }
});

server.listen(config.port, config.host, () => {
  const appHost = config.host === "0.0.0.0" || config.host === "::" ? "127.0.0.1" : config.host;
  const lanUrls = lanAppUrls(config.port, "/");
  console.log(`Ocellus running at http://${appHost}:${config.port}/`);
  if (lanUrls.length) {
    console.log(`Phone Wi-Fi URL: ${lanUrls.join(", ")}`);
  }
  console.log(`(Original design mockup kept at /mockup/app.html)`);
  console.log(`AI provider: ${publicProviderName()}; model: ${config.model}`);
  if (config.provider === "google" && !config.googleApiKey) {
    console.log("Missing GEMMA_API_KEY in .env.local or the current shell.");
  }
});

function lanAppUrls(port, pathname) {
  const urls = [];
  for (const entries of Object.values(networkInterfaces())) {
    for (const entry of entries || []) {
      if (entry.family !== "IPv4" || entry.internal) continue;
      urls.push(`http://${entry.address}:${port}${pathname}`);
    }
  }
  return [...new Set(urls)];
}

function publicProviderName() {
  return config.provider === "google" ? "gemma" : config.provider;
}

async function handleHealth(req, res, url) {
  const configured = config.provider === "google" ? Boolean(config.googleApiKey) : Boolean(config.ollamaBase);
  const result = {
    ok: configured,
    configured,
    provider: publicProviderName(),
    model: config.model,
    appDir: APP_DIR,
  };

  if (!configured) {
    json(res, 200, { ...result, error: missingConfigMessage() });
    return;
  }

  if (url.searchParams.get("live") === "1") {
    const text = await runModel({
      system: "",
      prompt: "Briefly confirm that Gemma is available for Ocellus.",
      temperature: 0,
    });
    result.live = Boolean(text.trim());
    result.reply = text.slice(0, 40);
  }

  json(res, 200, result);
}

async function handleQuiz(req, res) {
  const body = await readJson(req, 4 * 1024 * 1024);
  const count = clamp(Number(body.count || 5), 1, 20);
  const text = limitText(body.text || body.passage || "", 30000);
  if (!text) {
    json(res, 400, { ok: false, error: "Missing passage text for quiz generation." });
    return;
  }

  const prompt = isGoogleGemma()
    ? [
        `Make ${count} multiple choice reading-comprehension questions from this text.`,
        'Return one compact JSON object with key "questions".',
        'Each question must use keys "type", "q", "opts", and "correct".',
        "Use real question text and real answer choices from the passage. Do not use ellipses or placeholders.",
        "Use four options. correct is 0, 1, 2, or 3. Output JSON only.",
        `Text: ${text}`,
      ].join("\n")
    : [
        `Create ${count} multiple-choice comprehension questions from the passage below.`,
        "Return valid JSON only, with this exact shape:",
        '{"questions":[{"type":"Main idea","q":"Question text","opts":["A","B","C","D"],"correct":0,"explanation":"Short reason"}]}',
        "Rules: use only the passage, use four options per question, make correct a zero-based number from 0 to 3, and avoid trick questions.",
        "",
        "Passage:",
        text,
      ].join("\n");

  const raw = await runModel({
    system: isGoogleGemma() ? "" : "You create fair reading-comprehension checks. You output strict JSON and no markdown.",
    prompt,
    json: true,
    temperature: 0.2,
  });

  const parsed = parseModelJson(raw);
  const questions = normalizeQuestions(parsed.questions || parsed).slice(0, count);
  if (!questions.length) {
    json(res, 502, { ok: false, error: "The model did not return usable quiz JSON." });
    return;
  }

  json(res, 200, { ok: true, provider: config.provider, model: config.model, questions });
}

const ASSIST_ACTIONS = {
  ask: (q) => `Answer the reader's question using ONLY the excerpt. Question: ${q}`,
  explain: () => "Explain this passage in plain language for a general reader. Be concise (under 120 words).",
  simplify: () => "Rewrite this passage in simple, everyday words at the same length or shorter. Keep the meaning exact.",
  summarize: () => "Summarize this excerpt in 3-5 short sentences. No spoilers beyond the excerpt itself.",
  keyideas: () => "List the 3-6 key ideas of this excerpt as short bullet points (use the '-' character).",
  define: (q, sel) => `Define the word "${sel}" as it is used in this sentence. Give: the meaning in this context (one sentence), then a simple synonym. If the word does not appear, say so.`,
};

async function handleAssist(req, res) {
  const body = await readJson(req, 4 * 1024 * 1024);
  const action = String(body.action || "ask").toLowerCase();
  const build = ASSIST_ACTIONS[action];
  if (!build) {
    json(res, 400, { ok: false, error: `Unknown assist action "${action}".` });
    return;
  }
  const context = limitText(body.context || "", 26000);
  const question = String(body.question || "").slice(0, 500);
  const selection = String(body.selection || "").slice(0, 120);
  const title = String(body.title || "the book").slice(0, 160);
  if (!context) {
    json(res, 400, { ok: false, error: "Missing text context for the assistant." });
    return;
  }

  // Excerpt first, one task, one closing rule — Gemma echoes instruction lists
  // back at the reader if the prompt reads like a spec.
  const prompt = [
    `Excerpt from "${title}":`,
    '"""',
    context,
    '"""',
    "",
    build(question, selection),
    "",
    "Use only the excerpt above; if it does not contain the answer, say so plainly. Reply with the answer text only — no preamble, no headings, no notes about these instructions.",
  ].join("\n");

  const text = await runModel({
    system: "",
    prompt,
    temperature: 0.2,
  });
  json(res, 200, { ok: true, provider: config.provider, model: config.model, text: String(text || "").trim() });
}

async function handleContents(req, res) {
  const body = await readJson(req, 4 * 1024 * 1024);
  const text = limitText(body.text || "", 30000);
  const title = String(body.title || "Imported document").slice(0, 160);
  const wpm = clamp(Number(body.wpm || 300), 80, 1200);

  if (!text) {
    json(res, 400, { ok: false, error: "Missing text for contents generation." });
    return;
  }

  const prompt = [
    `Build smart reading sections for "${title}" at ${wpm} WPM.`,
    "Return JSON only:",
    '{"sections":[{"label":"1","title":"Section title","type":"section","time":"5 min","skip":false}]}',
    "Mark front matter, references, appendices, exercises, and acknowledgements as skip:true when appropriate.",
    "",
    text,
  ].join("\n");

  const raw = await runModel({
    system: "You split documents into useful reading sections for a speed-reading app. Output strict JSON only.",
    prompt,
    json: true,
    temperature: 0.2,
  });

  const parsed = parseModelJson(raw);
  const sections = normalizeSections(parsed.sections || parsed);
  json(res, 200, { ok: true, provider: config.provider, model: config.model, sections });
}

async function handleCoach(req, res) {
  const body = await readJson(req, 1024 * 1024);
  const metrics = JSON.stringify(body.metrics || body, null, 2).slice(0, 12000);
  const prompt = [
    "Recommend the next reading speed for this user.",
    "Use speed and comprehension together. Never recommend a speed increase when comprehension is weak.",
    "Return JSON only:",
    '{"summary":"One sentence","recommendedWpm":350,"mode":"Guided","reason":"Short reason","warning":null}',
    "",
    metrics,
  ].join("\n");

  const raw = await runModel({
    system: "You are a practical reading coach. Output strict JSON only.",
    prompt,
    json: true,
    temperature: 0.15,
  });

  json(res, 200, { ok: true, provider: config.provider, model: config.model, coach: parseModelJson(raw) });
}

async function handleOcr(req, res) {
  const body = await readJson(req, 18 * 1024 * 1024);
  const imageBase64 = stripDataUrl(String(body.imageBase64 || body.image || ""));
  const mimeType = String(body.mimeType || "image/jpeg");
  if (!imageBase64) {
    json(res, 400, { ok: false, error: "Missing imageBase64 for OCR." });
    return;
  }

  const prompt = [
    "Transcribe the reading text from this image.",
    "Return JSON only:",
    '{"text":"Transcribed text","confidence":0.9,"notes":[]}',
    "Preserve paragraph breaks. Ignore UI chrome, page numbers, and decorative content unless they are part of the text.",
  ].join("\n");

  const raw = await runModel({
    system: "You are OCR for a reading app. Output strict JSON only.",
    prompt,
    image: { base64: imageBase64, mimeType },
    json: true,
    temperature: 0,
  });

  const parsed = parseModelJson(raw);
  json(res, 200, { ok: true, provider: config.provider, model: config.model, text: String(parsed.text || ""), confidence: parsed.confidence ?? null, notes: parsed.notes || [] });
}

async function handleImport(req, res) {
  const body = await readJson(req, 80 * 1024 * 1024);
  const name = String(body.name || "Imported document").slice(0, 240);
  const mimeType = String(body.mimeType || "application/octet-stream").toLowerCase();
  const dataBase64 = stripDataUrl(String(body.dataBase64 || body.fileBase64 || ""));
  if (!dataBase64) {
    json(res, 400, { ok: false, error: "Missing dataBase64 for import." });
    return;
  }

  const buffer = Buffer.from(dataBase64, "base64");
  let text = "";
  let importKind = "text";

  if (mimeType.includes("pdf") || /\.pdf$/i.test(name)) {
    importKind = "pdf";
    text = await extractPdfText(buffer, name);
  } else if (mimeType.startsWith("image/") || /\.(png|jpe?g|webp|heic)$/i.test(name)) {
    importKind = "image";
    text = await ocrImageBase64(dataBase64, mimeType || "image/jpeg");
  } else {
    importKind = /\.epub$/i.test(name) ? "epub" : "text";
    text = buffer.toString("utf8");
  }

  text = normalizeImportedText(text);
  if (!text || text.split(/\s+/).filter(Boolean).length < 8) {
    json(res, 422, { ok: false, error: "I could not extract readable text from that file yet." });
    return;
  }

  json(res, 200, {
    ok: true,
    kind: importKind,
    title: name.replace(/\.[^.]+$/, "") || "Imported document",
    text,
    wordCount: text.split(/\s+/).filter(Boolean).length,
    charCount: text.length,
  });
}

async function extractPdfText(buffer, name) {
  const dir = await mkdtemp(path.join(tmpdir(), "ocellus-import-"));
  const pdfPath = path.join(dir, sanitizeFileName(name || "import.pdf"));
  try {
    await writeFile(pdfPath, buffer);
    const { stdout } = await execFileAsync("pdftotext", ["-layout", pdfPath, "-"], {
      maxBuffer: 60 * 1024 * 1024,
      timeout: 120000,
    });
    return stdout;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

async function ocrImageBase64(imageBase64, mimeType) {
  const prompt = [
    "Transcribe the reading text from this image.",
    "Return JSON only:",
    '{"text":"Transcribed text","confidence":0.9,"notes":[]}',
    "Preserve paragraph breaks. Ignore UI chrome, page numbers, and decorative content unless they are part of the text.",
  ].join("\n");

  const raw = await runModel({
    system: "You are OCR for a reading app. Output strict JSON only.",
    prompt,
    image: { base64: imageBase64, mimeType },
    json: true,
    temperature: 0,
  });

  const parsed = parseModelJson(raw);
  return String(parsed.text || "");
}

function normalizeImportedText(text) {
  return String(text || "")
    .replace(/\r/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{4,}/g, "\n\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

function sanitizeFileName(name) {
  const safe = String(name || "import.pdf").replace(/[^a-z0-9._-]+/gi, "_");
  return safe || "import.pdf";
}

async function runModel({ system = "", prompt = "", image = null, json: wantsJson = false, temperature = 0.2 }) {
  if (!prompt && !image) throw new Error("Missing model prompt.");
  if (config.provider === "ollama") {
    return runOllama({ system, prompt, image, wantsJson, temperature });
  }
  return runGoogle({ system, prompt, image, wantsJson, temperature, modelName: config.model });
}

async function runGoogle({ system, prompt, image, wantsJson, temperature, modelName }) {
  if (!config.googleApiKey) throw new Error(missingConfigMessage());
  const model = String(modelName || config.model).replace(/^models\//, "");
  const endpoint = `${config.googleApiBase}/models/${encodeURIComponent(model)}:generateContent`;
  const gemmaModel = /^gemma-/i.test(model);
  const parts = [];
  if (prompt) parts.push({ text: gemmaModel && system ? `${system}\n\n${prompt}` : prompt });
  if (image?.base64) {
    parts.push({
      inlineData: {
        mimeType: image.mimeType || "image/jpeg",
        data: stripDataUrl(image.base64),
      },
    });
  }
  const body = {
    contents: [{ role: "user", parts }],
    generationConfig: {
      temperature,
    },
  };
  // Gemma 4 is a thinking model: keep thinking minimal for app-speed answers,
  // and extractGoogleText drops any `thought` parts that still come back.
  if (/^gemma-4\b/i.test(model)) {
    body.generationConfig.thinkingConfig = { thinkingLevel: "MINIMAL" };
  }
  if (wantsJson && !gemmaModel) body.generationConfig.responseMimeType = "application/json";
  if (system && !gemmaModel) body.systemInstruction = { parts: [{ text: system }] };

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-goog-api-key": config.googleApiKey,
    },
    body: JSON.stringify(body),
    signal: abortSignal(),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error?.message || `Google AI request failed with HTTP ${response.status}`);
  }
  return extractGoogleText(data);
}

async function runOllama({ system, prompt, image, wantsJson, temperature }) {
  const body = {
    model: config.model,
    prompt,
    system,
    stream: false,
    options: { temperature },
  };
  if (wantsJson) body.format = "json";
  if (image?.base64) body.images = [stripDataUrl(image.base64)];

  const response = await fetch(`${config.ollamaBase}/api/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: abortSignal(),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error || `Ollama request failed with HTTP ${response.status}`);
  }
  return String(data.response || "").trim();
}

async function serveStatic(req, res, url) {
  const cleanPath = url.pathname === "/" ? "/index.html" : decodeURIComponent(url.pathname);
  const filePath = path.normalize(path.join(APP_DIR, cleanPath));
  const rel = path.relative(APP_DIR, filePath);
  if (rel.startsWith("..") || path.isAbsolute(rel) || path.basename(filePath).startsWith(".")) {
    json(res, 404, { ok: false, error: "Not found" });
    return;
  }
  if (path.basename(filePath) === path.basename(__filename)) {
    json(res, 404, { ok: false, error: "Not found" });
    return;
  }

  let info;
  try {
    info = await stat(filePath);
  } catch {
    json(res, 404, { ok: false, error: "Not found" });
    return;
  }
  if (!info.isFile()) {
    json(res, 404, { ok: false, error: "Not found" });
    return;
  }

  const ext = path.extname(filePath).toLowerCase();
  const type = mimeTypes.get(ext) || "application/octet-stream";
  if (ext === ".html") {
    let html = await readFile(filePath, "utf8");
    const inject = '<script src="/ocellus-ai-client.js"></script>';
    if (!html.includes("/ocellus-ai-client.js")) {
      html = html.replace("</head>", `${inject}\n</head>`);
    }
    send(res, 200, html, type);
    return;
  }

  res.writeHead(200, {
    ...corsHeaders(),
    "Content-Type": type,
    "Content-Length": info.size,
    "Cache-Control": "no-store",
  });
  if (req.method === "HEAD") {
    res.end();
    return;
  }
  createReadStream(filePath).pipe(res);
}

async function readLocalEnv(envPath) {
  try {
    const text = await readFile(envPath, "utf8");
    const out = {};
    for (const rawLine of text.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line || line.startsWith("#")) continue;
      const eq = line.indexOf("=");
      if (eq === -1) continue;
      const key = line.slice(0, eq).trim();
      let value = line.slice(eq + 1).trim();
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      out[key] = value;
    }
    return out;
  } catch {
    return {};
  }
}

function readJson(req, maxBytes = 2 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > maxBytes) {
        reject(new Error("Request body too large."));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      const text = Buffer.concat(chunks).toString("utf8");
      if (!text) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(text));
      } catch {
        reject(new Error("Invalid JSON request body."));
      }
    });
    req.on("error", reject);
  });
}

function normalizeQuestions(value) {
  const list = Array.isArray(value) ? value : [];
  return list
    .map((q) => {
      const opts = questionOptions(q);
      const normalizedOpts = opts.map((o) => optionText(o)).filter(Boolean).slice(0, 4);
      const answer = q.correct ?? q.answerIndex ?? q.correctIndex ?? q.answer ?? 0;
      let correct = Number(answer);
      if (!Number.isFinite(correct) && typeof answer === "string") {
        const normalizedAnswer = answer.trim().toLowerCase();
        correct = normalizedOpts.findIndex((opt) => opt.toLowerCase() === normalizedAnswer || opt.toLowerCase().startsWith(normalizedAnswer));
      }
      correct = clamp(Number.isFinite(correct) ? correct : 0, 0, 3);
      if (!q.q && !q.question) return null;
      if (normalizedOpts.length !== 4) return null;
      if (String(q.q || q.question).trim() === "..." || normalizedOpts.every((opt) => opt === "...")) return null;
      return {
        type: String(q.type || "Comprehension").slice(0, 40),
        q: String(q.q || q.question).trim(),
        opts: normalizedOpts,
        correct,
        explanation: String(q.explanation || "").trim(),
      };
    })
    .filter(Boolean);
}

function questionOptions(q) {
  if (Array.isArray(q.opts)) return q.opts;
  if (Array.isArray(q.options)) return q.options;
  if (Array.isArray(q.choices)) return q.choices;
  if (Array.isArray(q.answers)) return q.answers;
  return [q.a, q.b, q.c, q.d].filter((x) => x != null);
}

function optionText(option) {
  if (option == null) return "";
  if (typeof option === "object") return String(option.text || option.label || option.value || "").trim();
  return String(option).trim();
}

function normalizeSections(value) {
  const list = Array.isArray(value) ? value : [];
  return list
    .map((s, index) => ({
      label: String(s.label || index + 1).slice(0, 8),
      title: String(s.title || s.name || `Section ${index + 1}`).slice(0, 120),
      type: String(s.type || "section").slice(0, 40),
      time: String(s.time || s.eta || "5 min").slice(0, 30),
      skip: Boolean(s.skip),
    }))
    .filter((s) => s.title);
}

function parseModelJson(text) {
  const clean = String(text || "")
    .trim()
    .replace(/^```(?:json)?/i, "")
    .replace(/```$/i, "")
    .trim();
  try {
    return JSON.parse(clean);
  } catch {
    const fenced = [...clean.matchAll(/```(?:json)?\s*([\s\S]*?)```/gi)].map((m) => m[1].trim());
    const candidates = [...fenced, ...extractJsonCandidates(clean)];
    const parsed = [];
    for (const candidate of candidates) {
      try {
        parsed.push(JSON.parse(candidate));
      } catch {
      }
    }
    parsed.sort((a, b) => jsonUsefulnessScore(b) - jsonUsefulnessScore(a));
    if (parsed.length && jsonUsefulnessScore(parsed[0]) > 0) return parsed[0];
    throw new Error("Model response was not JSON.");
  }
}

function jsonUsefulnessScore(value) {
  if (value && Array.isArray(value.questions)) return 10;
  if (Array.isArray(value) && value.some((item) => item && (item.q || item.question))) return 8;
  if (value && Array.isArray(value.sections)) return 7;
  if (value && (value.summary || value.recommendedWpm || value.text)) return 6;
  if (value && (value.q || value.question)) return 5;
  return 0;
}

function extractJsonCandidates(text) {
  const out = [];
  const pairs = { "{": "}", "[": "]" };
  for (let start = 0; start < text.length; start++) {
    const opener = text[start];
    if (!pairs[opener]) continue;
    const stack = [pairs[opener]];
    let inString = false;
    let escaped = false;
    for (let i = start + 1; i < text.length; i++) {
      const ch = text[i];
      if (escaped) {
        escaped = false;
        continue;
      }
      if (ch === "\\") {
        escaped = true;
        continue;
      }
      if (ch === '"') {
        inString = !inString;
        continue;
      }
      if (inString) continue;
      if (pairs[ch]) {
        stack.push(pairs[ch]);
      } else if (ch === stack[stack.length - 1]) {
        stack.pop();
        if (!stack.length) {
          out.push(text.slice(start, i + 1));
          break;
        }
      }
    }
  }
  return out;
}

function extractGoogleText(data) {
  const parts = data?.candidates?.[0]?.content?.parts || [];
  // Gemma 4 marks chain-of-thought parts with thought:true — never show those.
  const answerParts = parts.filter((part) => !part.thought);
  const text = answerParts.map((part) => part.text || "").join("").trim();
  if (!text) {
    const reason = data?.candidates?.[0]?.finishReason;
    throw new Error(reason ? `Google AI returned no text. Finish reason: ${reason}` : "Google AI returned no text.");
  }
  return text;
}

function send(res, status, body, type) {
  const data = typeof body === "string" ? body : String(body);
  res.writeHead(status, {
    ...corsHeaders(),
    "Content-Type": type,
    "Content-Length": Buffer.byteLength(data),
    "Cache-Control": "no-store",
  });
  res.end(data);
}

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Private-Network": "true",
  };
}

function json(res, status, body) {
  send(res, status, JSON.stringify(body, null, 2), "application/json; charset=utf-8");
}

function missingConfigMessage() {
  return config.provider === "google"
    ? "Missing Google AI Studio API key. Put GEMMA_API_KEY in .env.local, or set AI_PROVIDER=ollama for a local Ollama model."
    : "Missing Ollama connection. Start Ollama or set OLLAMA_BASE_URL.";
}

function isGoogleGemma() {
  return config.provider === "google" && /^gemma-/i.test(config.model);
}

function publicError(error) {
  let message = error instanceof Error ? error.message : String(error);
  if (config.googleApiKey) message = message.replaceAll(config.googleApiKey, "[redacted]");
  return message;
}

function stripSlash(value) {
  return String(value || "").replace(/\/+$/, "");
}

function stripDataUrl(value) {
  return String(value || "").replace(/^data:[^;]+;base64,/, "");
}

function numberOr(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function clamp(value, min, max) {
  const n = Number.isFinite(value) ? value : min;
  return Math.max(min, Math.min(max, n));
}

function limitText(value, max) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, max);
}

function abortSignal() {
  return typeof AbortSignal !== "undefined" && AbortSignal.timeout ? AbortSignal.timeout(config.timeoutMs) : undefined;
}
