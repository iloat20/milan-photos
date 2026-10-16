/* 米兰 Service Worker：导航 Network First，壳层子资源 SWR，
   缩略图/中图/原图带 LRU，清单 Network First */
/* 缓存版本号由**构建期**按内容指纹注入（tools/sw-version.mjs + vite.config.js 的
   sw-version 插件），不再手工递增。手工的代价不只是「忘了改」：sw.js 字节不变时
   浏览器**不会重新 install**，壳层缓存只能靠 SWR 逐条兜，而 `photos/medium/*`
   走 cacheFirst（命中即返回、永不回源），换缓存名是它唯一的失效手段。
   dev 下本文件原样服、且 dev 不注册 SW，占位符不会被替换，无副作用。 */
const VERSION = "__MILAN_BUILD_ID__";
const CACHE_SHELL = `${VERSION}-shell`;
const CACHE_MEDIA = `${VERSION}-media`;
const MEDIA_MAX_ENTRIES = 100;
/* 两代形状都要认，否则抬版本后旧缓存永远清不掉：
   `milan-v<数字>` 是历史遗留（e2e 会造一个 `milan-v0-shell` 验证 activate 清理），
   `milan-<8 位 hex>` 是 2026-10-13 起的构建期指纹。 */
const OWNED_CACHE_RE = /^milan-(?:v\d+|[0-9a-f]{8})-(?:shell|media)$/;

// Vite 起：src/*.js 被打进 app.js 单文件，清单只需「构建产物的壳层」。
// 曾经的坑（清单漏列 src 模块 → 首访后立刻离线停在骨架屏）随打包消失；
// 反向的坑依然在：**多列**一个产物里不存在的条目（如忘删的 ./src/…）会让 install 的
// cache.addAll 直接 reject，全站悄悄失去 SW。条目与 dist 的对齐由 e2e globalSetup 核对。
const SHELL_ASSETS = [
  "./",
  "./index.html",
  "./styles.css",
  "./app.js",
  "./manifest.webmanifest",
];

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
      // 站内已无自托管字体（标题走系统字体栈）：不再快照 assets/fonts/*
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
  // 曾把 /milan、/milan-photos（serve.py 时代的站点根）当壳层路径列为分支：
  // 现在导航请求由 fetch 里的 `mode === "navigate"` 分支先接走（Network First），
  // 且 base="./" 下所有壳层子资源都带扩展名 —— 那两个分支再无人走，已删。
  const path = url.pathname.replace(/\/+$/, "") || "/";
  return (
    path.endsWith("/styles.css") ||
    path.endsWith("/app.js") ||
    path.endsWith("/index.html") ||
    path.endsWith("/")
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

/* putMedia 原先每次 put 都调 trimMediaCache()，而后者全量 cache.keys()：
   一次页面加载（约 108 个缩略图/中图请求）会触发同等次数的全量枚举，
   100 条上限下累计约 10⁴ 次 key 对象分配。

   改用**时间节流**而不是报告建议的「计数阈值」——后者在本馆规模下会失效：
   单次浏览的媒体请求约 18 个（18 张卡片），永远到不了 24 的阈值，于是永不裁剪；
   且 SW 被回收重启后计数器归零，同样可能长期不触发。
   时间节流无此退化：lastTrimAt 初值 0，SW 每次重启后第一次 put 必然裁剪一次。
   赋值语句与判断之间没有 await，天然并发安全（只有第一个 put 通过）。 */
const TRIM_MS = 5000;
let lastTrimAt = 0;

async function putMedia(request, response) {
  const cache = await caches.open(CACHE_MEDIA);
  await cache.put(request, response);
  const now = Date.now();
  if (now - lastTrimAt < TRIM_MS) return;
  lastTrimAt = now;
  await trimMediaCache();
}

async function cacheFirst(request) {
  // ignoreVary：与 shellSwr 同因（preview 发 Vary: Origin，同源自产缓存忽略之）
  const cached = await caches.match(request, { ignoreSearch: true, ignoreVary: true });
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
    const cached = await caches.match(request, { ignoreSearch: true, ignoreVary: true });
    if (cached) return cached;
    throw new Error("manifest unavailable offline");
  }
}

/* 导航请求网络优先（P-6）：壳层资产是固定文件名，HTML 与 app.js/styles.css 之间
   没有版本互认手段；SWR 的「先回缓存」允许在线导航回放任意世代的缓存 HTML，
   与已刷新的子资源拼接即「旧 HTML + 新 JS」错配。网络优先把在线导航钉死在新版
   HTML 上；缓存只在网络失败/超时时兜底——此时已处于离线语境，可用性优先。
   （实测：preview 下把 canary 版 HTML 写进 shell 缓存，在线 reload 后它出现在
   DOM——「回放缓存」与缓存是否陈旧无关，是确定性行为。） */
const NAV_TIMEOUT_MS = 3000;

async function navigateNetworkFirst(request) {
  try {
    const response = await Promise.race([
      fetch(request),
      // 黑洞连接可能让 fetch 永久 pending：3s 兜底转缓存（同 manifest 的处置）
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error("navigate fetch timeout")), NAV_TIMEOUT_MS)
      ),
    ]);
    if (response && response.ok) {
      // 覆写导航条目：离线兜底拿到「最后一次在线导航的版本」，而不是 install 快照
      const cache = await caches.open(CACHE_SHELL);
      await cache.put(request, response.clone());
      return response;
    }
    // 非 2xx 也转缓存回落，不把错误页当文档交给访客
    throw new Error("navigate fetch not ok");
  } catch {
    const cached = await caches.match(request, { ignoreSearch: true, ignoreVary: true });
    if (cached) return cached;
    const fallback = await caches.match("./index.html", { ignoreVary: true });
    if (fallback) return fallback;
    return Response.error();
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
    // ignoreVary 是这次迁移的实证修复，别删：vite preview（与 dev）对静态文件发
    // `Vary: Origin`，而 Cache API 的 Vary 匹配比较「存储时的请求」与「当前请求」的
    // 同名头——addAll 的内部请求与 FetchEvent.request（cors 模式、带 Origin）不对称，
    // 于是**键明明在 keys() 里却 match 不中**：离线首访拿不到壳层 → 兜底把 index.html
    // 当 app.js 喂 → 模块 MIME 报错、展厅 0 卡。线上表现为约 40% 的偶发（取决于
    // 热路径 revalidate 是否已用页面同款请求重写过条目）。本缓存是同源自产内容，
    // Vary 无信息量，整体忽略。（旧 serve.py 不发 Vary: Origin，所以迁移前从未出现。）
    const cached = await cache.match(request, { ignoreSearch: true, ignoreVary: true });
    if (cached) return cached;
    const response = await revalidate;
    if (response) return response;
    // 导航已由 navigateNetworkFirst 分流（P-6）；此处只服务壳层子资源——
    // 把 index.html 当 JS/CSS 喂只会把「缺缓存」变成难查的 MIME 报错
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
    const cached = await cache.match(request, { ignoreSearch: true, ignoreVary: true });
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

  if (request.mode === "navigate") {
    // 导航网络优先（P-6）：在线永远拿最新 HTML，缓存只作离线兜底
    event.respondWith(navigateNetworkFirst(request));
    return;
  }

  if (isShellRequest(url)) {
    const { serve, revalidate } = shellSwr(request);
    event.respondWith(serve);
    event.waitUntil(revalidate);
  }
});
