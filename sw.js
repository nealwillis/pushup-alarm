const CACHE = "pushup-alarm-v4";

// Resolved against this worker's URL, so /pushup-alarm/sw.js caches /pushup-alarm/* .
const ROOT = new URL("./", self.location.href);
const RELATIVE_ASSETS = [
  "./",
  "index.html",
  "manifest.webmanifest",
  "css/styles.css",
  "js/app.js",
  "js/alarms.js",
  "js/rep-counter.js",
  "js/audio.js",
  "js/tones.js",
  "js/store.js",
  "js/pose.js",
  "vendor/tf.min.js",
  "vendor/pose-detection.js",
  "models/movenet/model.json",
  "models/movenet/group1-shard1of2.bin",
  "models/movenet/group1-shard2of2.bin",
  "icons/favicon.svg",
  "icons/favicon-32.png",
  "icons/apple-touch-icon.png",
  "icons/icon-192.png",
  "icons/icon-512.png",
  "icons/icon-maskable-512.png",
];
const ASSETS = RELATIVE_ASSETS.map((path) => new URL(path, ROOT).href);
const INDEX = new URL("index.html", ROOT).href;

self.addEventListener("install", (event) => {
  self.skipWaiting();
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(ASSETS)));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.endsWith("/sw.js")) return;

  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone();
          caches.open(CACHE).then((cache) => cache.put(INDEX, copy));
          return response;
        })
        .catch(() => caches.match(INDEX)),
    );
    return;
  }

  event.respondWith(
    caches.match(request).then((cached) => {
      const network = fetch(request)
        .then((response) => {
          if (response && response.ok && response.type === "basic") {
            const copy = response.clone();
            caches.open(CACHE).then((cache) => cache.put(request, copy));
          }
          return response;
        })
        .catch(() => cached);
      return cached || network;
    }),
  );
});
