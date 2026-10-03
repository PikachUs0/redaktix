/* Template copied to dist/; scripts/write-sw.js stamps BUILD_HASH / CACHE / PRECACHE. */
const BUILD_HASH = "dev";
const CACHE = `redaktix-offline-${BUILD_HASH}`;

const PRECACHE = [
  "/",
  "/index.html",
  "/editor.html",
  "/manifest.webmanifest",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
  "/assets/ocr/worker/worker.min.js",
  "/assets/ocr/lang/eng.traineddata.gz",
  "/assets/ocr/lang/tur.traineddata.gz",
  "/assets/ocr/core/tesseract-core.js",
  "/assets/ocr/core/tesseract-core.wasm",
  "/assets/ocr/core/tesseract-core.wasm.js",
  "/assets/ocr/core/tesseract-core-lstm.js",
  "/assets/ocr/core/tesseract-core-lstm.wasm",
  "/assets/ocr/core/tesseract-core-lstm.wasm.js",
  "/assets/ocr/core/tesseract-core-simd.js",
  "/assets/ocr/core/tesseract-core-simd.wasm",
  "/assets/ocr/core/tesseract-core-simd.wasm.js",
  "/assets/ocr/core/tesseract-core-simd-lstm.js",
  "/assets/ocr/core/tesseract-core-simd-lstm.wasm",
  "/assets/ocr/core/tesseract-core-simd-lstm.wasm.js",
  "/assets/ocr/core/tesseract-core-relaxedsimd.js",
  "/assets/ocr/core/tesseract-core-relaxedsimd.wasm",
  "/assets/ocr/core/tesseract-core-relaxedsimd.wasm.js",
  "/assets/ocr/core/tesseract-core-relaxedsimd-lstm.js",
  "/assets/ocr/core/tesseract-core-relaxedsimd-lstm.wasm",
  "/assets/ocr/core/tesseract-core-relaxedsimd-lstm.wasm.js",
];

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    await Promise.all(PRECACHE.map((url) => cache.add(url).catch(() => {})));
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key)));
    await self.clients.claim();
  })());
});

self.addEventListener("message", (event) => {
  if (event?.data?.type === "SKIP_WAITING") {
    self.skipWaiting();
  }
});

function shouldHandle(request) {
  if (request.method !== "GET") return false;
  const url = new URL(request.url);
  if (url.protocol !== "http:" && url.protocol !== "https:") return false;
  if (url.pathname.startsWith("/@vite") || url.pathname.startsWith("/@id")) return false;
  return true;
}

function isHtmlOrJsRequest(request) {
  if (request.mode === "navigate") return true;
  const destination = request.destination;
  if (destination === "document" || destination === "script") return true;
  const path = new URL(request.url).pathname;
  return path.endsWith(".html") || path.endsWith(".js") || path.endsWith(".mjs");
}

async function fromCache(request) {
  const cache = await caches.open(CACHE);
  return cache.match(request) || cache.match(new URL(request.url).pathname);
}

async function putCache(request, response) {
  if (!response || !(response.ok || response.type === "opaque")) return;
  const cache = await caches.open(CACHE);
  await cache.put(request, response.clone());
}

/** Network-first: always try the network so HTML/JS detection code updates without a hard refresh. */
async function networkFirst(request) {
  const cache = await caches.open(CACHE);
  try {
    const response = await fetch(request);
    await putCache(request, response);
    return response;
  } catch {
    const cached = await fromCache(request);
    if (cached) return cached;
    if (request.mode === "navigate") {
      return (await cache.match("/editor.html"))
        || (await cache.match("/index.html"))
        || Response.error();
    }
    return new Response("Offline", { status: 503, statusText: "Offline" });
  }
}

/**
 * Stale-while-revalidate: serve cache immediately when present, refresh in background.
 * Used for non-HTML/JS assets (OCR wasm, fonts, images).
 */
async function staleWhileRevalidate(request, event) {
  const cached = await fromCache(request);
  const networkPromise = fetch(request)
    .then(async (response) => {
      await putCache(request, response);
      return response;
    })
    .catch(() => null);
  if (event) event.waitUntil(networkPromise);
  if (cached) return cached;
  const network = await networkPromise;
  if (network) return network;
  return new Response("Offline", { status: 503, statusText: "Offline" });
}

self.addEventListener("fetch", (event) => {
  if (!shouldHandle(event.request)) return;
  if (isHtmlOrJsRequest(event.request)) {
    event.respondWith(networkFirst(event.request));
    return;
  }
  event.respondWith(staleWhileRevalidate(event.request, event));
});
