/* 米兰 Service Worker：壳层 SWR，缩略图/中图/原图带 LRU，清单 Network First */
const VERSION = "milan-v29";
const CACHE_SHELL = `${VERSION}-shell`;
const CACHE_MEDIA = `${VERSION}-media`;
const MEDIA_MAX_ENTRIES = 100;
const OWNED_CACHE_RE = /^milan-v\d+-(?:shell|media)$/;

const SHELL_ASSETS = ["./", "./index.html", "./styles.css", "./app.js", "./manifest.webmanifest"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE_SHELL);
      await cache.addAll(SHELL_ASSETS);
      // manifest 不进 addAll 原子组（缺它时 SW 仍应装上）；
      // 首访时 SW claim 接管晚于首屏 manifest 请求，install 快照保证「首访后立刻离线」也有清单可回退。
      // 注意 addAll 返回 undefined，不能链式当 cache 用，必须显式持有 cache 变量。
      try {
        const res = await fetch("./photos/manifest.json");
        if (res && res.ok) await cache.put("./photos/manifest.json", res);
      } catch {
        /* 快照失败不阻断安装 */
      }
      await self.skipWaiting();
    })()
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter(
              (key) =>
                OWNED_CACHE_RE.test(key) &&
                key !== CACHE_SHELL &&
                key !== CACHE_MEDIA
            )
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

/** 媒体缓存按插入序裁剪，超出上限删最旧 */
async function trimMediaCache(maxEntries = MEDIA_MAX_ENTRIES) {
  try {
    const cache = await caches.open(CACHE_MEDIA);
    const keys = await cache.keys();
    if (keys.length <= maxEntries) return;
    const excess = keys.length - maxEntries;
    await Promise.all(keys.slice(0, excess).map((key) => cache.delete(key)));
  } catch {
    /* quota / private mode — ignore */
  }
}

async function putMedia(request, response) {
  const cache = await caches.open(CACHE_MEDIA);
  await cache.put(request, response);
  await trimMediaCache();
}

async function cacheFirst(request) {
  const cached = await caches.match(request, { ignoreSearch: true });
  if (cached) {
    // 命中后重放一份到 media，便于 LRU 保留热图
    // （Cache API 无原生 recency，用 delete+put 近似）
    try {
      const cache = await caches.open(CACHE_MEDIA);
      await cache.delete(request);
      await cache.put(request, cached.clone());
    } catch {
      /* ignore */
    }
    return cached;
  }
  const response = await fetch(request);
  if (response && response.ok && response.type === "basic") {
    await putMedia(request, response.clone());
  }
  return response;
}

async function networkFirst(request) {
  try {
    // 离线模拟/黑洞连接可能让 fetch 永久 pending（既不 resolve 也不 reject），
    // 3s 兜底转缓存回落，避免页面 loadFolderPhotos 永远不 settle、展厅永远空
    const response = await Promise.race([
      fetch(request),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error("manifest fetch timeout")), 3000)
      ),
    ]);
    if (response && response.ok) {
      // 清单存壳层缓存：不占媒体 LRU 名额，免得每次刷新清单挤掉一张图
      const cache = await caches.open(CACHE_SHELL);
      await cache.put(request, response.clone());
      return response;
    }
    // 非 2xx（离线模拟/中转可能给 error response 而非 reject）也走缓存回落，
    // 不把坏清单交给页面——否则 r.json() 抛错，展厅会空
    throw new Error("manifest fetch not ok");
  } catch {
    const cached = await caches.match(request, { ignoreSearch: true });
    if (cached) return cached;
    throw new Error("manifest unavailable offline");
  }
}

/* SWR 拆成「应答」和「后台刷新」两个 Promise：
   刷新必须在 fetch 事件的同步阶段交给 event.waitUntil()，
   否则是浮动 Promise，SW 随时可能被回收，缓存更新半途而废。 */
function shellSwr(request) {
  const cacheP = caches.open(CACHE_SHELL);
  const revalidate = cacheP
    .then((cache) =>
      fetch(request).then(async (response) => {
        if (response && response.ok && response.type === "basic") {
          await cache.put(request, response.clone());
        }
        return response;
      })
    )
    .catch(() => null);

  const serve = cacheP.then(async (cache) => {
    const cached = await cache.match(request, { ignoreSearch: true });
    if (cached) return cached;
    const response = await revalidate;
    if (response) return response;
    const fallback = await caches.match("./index.html");
    if (fallback) return fallback;
    return Response.error();
  });

  return { serve, revalidate };
}

function thumbSwr(request) {
  const cacheP = caches.open(CACHE_MEDIA);
  const revalidate = cacheP
    .then(() =>
      fetch(request).then(async (response) => {
        if (response && response.ok && response.type === "basic") {
          await putMedia(request, response.clone());
        }
        return response;
      })
    )
    .catch(() => null);

  const serve = cacheP.then(async (cache) => {
    const cached = await cache.match(request, { ignoreSearch: true });
    if (cached) return cached;
    return (await revalidate) || Response.error();
  });

  return { serve, revalidate };
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
    const { serve, revalidate } = thumbSwr(request);
    event.respondWith(serve);
    event.waitUntil(revalidate);
    return;
  }

  if (isMediaRequest(url)) {
    event.respondWith(cacheFirst(request));
    return;
  }

  if (isShellRequest(url) || request.mode === "navigate") {
    const { serve, revalidate } = shellSwr(request);
    event.respondWith(serve);
    event.waitUntil(revalidate);
  }
});
