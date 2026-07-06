"use strict";

// Ocellus service worker — precache the app shell + vendor libs so the app
// works offline (AI endpoints always go to the network).
const CACHE_NAME = "ocellus-app-v8";
const APP_SHELL = [
  "./",
  "./index.html",
  "./styles.css",
  "./manifest.webmanifest",
  "./src/app.js",
  "./src/ui.js",
  "./src/db.js",
  "./src/settings.js",
  "./src/tokenize.js",
  "./src/extract.js",
  "./src/reader.js",
  "./src/ai.js",
  "./src/charts.js",
  "./src/sample.js",
  "./src/passages.js",
  "./src/screens/library.js",
  "./src/screens/reader.js",
  "./src/screens/speed.js",
  "./src/screens/progress.js",
  "./src/screens/settings.js",
  "./src/screens/onboarding.js",
  "./vendor/pdf.min.js",
  "./vendor/pdf.worker.min.js",
  "./vendor/jszip.min.js",
  "./ocellus-icon-192.png",
  "./ocellus-icon-512.png",
  "./ocellus-icon.svg",
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)).catch(() => {}));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))))
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== "GET") return;
  if (url.pathname.startsWith("/api/")) return; // AI + import: network only

  // fonts + everything else: network-first with cache fallback, cache successes
  event.respondWith(
    fetch(event.request)
      .then((response) => {
        if (response.ok && (url.origin === location.origin || url.hostname.includes("gstatic") || url.hostname.includes("googleapis"))) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone)).catch(() => {});
        }
        return response;
      })
      .catch(() => caches.match(event.request, { ignoreSearch: url.origin === location.origin }))
  );
});
