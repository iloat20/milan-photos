/* 米兰 Service Worker：壳层 SWR，缩略图/原图 Cache First，清单 Network First */
const VERSION = "milan-v3";
const CACHE_SHELL = `${VERSION}-shell`;
const CACHE_MEDIA = `${VERSION}-media`;

const SHELL_ASSETS = ["./", "./index.html", "./styles.css", "./app.js"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE_SHELL)
      .then((cache) => cache.addAll(SHELL_ASSETS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key !== CACHE_SHELL && key !== CACHE_MEDIA)
            .map((key) => caches.delete(key))
        )
      )
      .then(() => self.clients.claim())
  );
});

function isThumbRequest(url) {
  return url.pathname.includes("/photos/thumbs/");
}

function isMediaRequest(url) {
  return (
    isThumbRequest(url) ||
    /\.(?:jpe?g|png|webp|gif|avif|svg)$/i.test(url.pathname)
  );
}

function isManifest(url) {
  return url.pathname.endsWith("/photos/manifest.json");
}

function isShellRequest(url) {
  const path = url.pathname.replace(/\/+$/, "") || "/";
  return (
    path.endsWith("/styles.css") ||
    path.endsWith("/app.js") ||
    path.endsWith("/index.html") ||
    path.endsWith("/") ||
    path.endsWith("/milan") ||
    path.endsWith("/milan-photos")
  );
}

async function cacheFirst(request) {
  const cached = await caches.match(request, { ignoreSearch: true });
  if (cached) return cached;
  const response = await fetch(request);
  if (response && response.ok && response.type === "basic") {
    const cache = await caches.open(CACHE_MEDIA);
    cache.put(request, response.clone());
  }
  return response;
}

async function networkFirst(request) {
  try {
    const response = await fetch(request);
    if (response && response.ok) {
      const cache = await caches.open(CACHE_MEDIA);
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    const cached = await caches.match(request, { ignoreSearch: true });
    if (cached) return cached;
    throw new Error("manifest unavailable offline");
  }
}

async function staleWhileRevalidate(request) {
  const cache = await caches.open(CACHE_SHELL);
  const cached = await cache.match(request, { ignoreSearch: true });
  const network = fetch(request)
    .then((response) => {
      if (response && response.ok && response.type === "basic") {
        cache.put(request, response.clone());
      }
      return response;
    })
    .catch(() => null);

  if (cached) {
    network.then(() => {});
    return cached;
  }
  const response = await network;
  if (response) return response;
  const fallback = await caches.match("./index.html");
  if (fallback) return fallback;
  return Response.error();
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (isManifest(url)) {
    event.respondWith(networkFirst(request));
    return;
  }

  if (isThumbRequest(url)) {
    event.respondWith(staleWhileRevalidate(request));
    return;
  }

  if (isMediaRequest(url)) {
    event.respondWith(cacheFirst(request));
    return;
  }

  if (isShellRequest(url) || request.mode === "navigate") {
    event.respondWith(staleWhileRevalidate(request));
  }
});
