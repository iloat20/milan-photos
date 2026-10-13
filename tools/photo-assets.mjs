/**
 * `photos/` 目录的**产物清单**（P-1：母版移出产物）。
 *
 * 本仓的 `photos/` 同时住着三种东西，命运不同：
 *   ① 母版（`photos/<name>.jpg` 等）：sync 的**输入**，占产物的 41%（5.4 MB / 13 MB）；
 *   ② 派生图（`thumbs/` 与 `medium/`）：访客真正下载的那批；
 *   ③ `manifest.json`：产品 fetch 的清单。（`meta.json` 是策展源，前端不读。）
 *
 * 只有 ②③ 是发布物。把 ① 整棵拷进 `dist/` 是纯浪费 —— 而母版的消费者只有两类：
 * 前端在「无缩略图」时的兜底（`app.js` 的 `thumb || src`、`largestStill` 的尾项），
 * 以及动图（灯箱直接播原文件，sync 刻意不给它生成 medium，避免被冻成静帧）。
 *
 * 所以规则刻意**不是**「硬编码排除 *.jpg」，而是「**会被触达的 `src` 才保留**」：
 * 跑过 sync 的图零母版、刚入库还没跑 sync 的图留母版 —— 母版是否进产物成了
 * manifest 的函数，而不是一张需要人工维护的排除表（那种表一定会腐坏）。
 *
 * 调用方：`vite.config.js` 的 copyStaticPlugin（构建期决定拷什么）与
 * e2e `tests/e2e/global-setup.js` 对策 6（对着 dist 核对拷对了什么）。
 * 构建期那一侧必须**自己**读仓库源的 manifest —— closeBundle 是并行钩子，
 * 那一刻 dist/photos 还没拷好。
 */

/** 条目是否会真的请求母版（`src` 指向的那个文件）。 */
export function needsMasterSource(photo) {
  // 动图：灯箱直接播原文件（`lightboxSrc` 的 animated 分支），sync 不生成 medium
  if (photo?.animated) return true;
  // 无缩略图：前端 `thumb || src`（app.js 清单映射）会落到 src
  return !photo?.thumb;
}

/** 需要保留在产物里的母版（仓库根相对路径，形如 `photos/01-city-rain.jpg`）。 */
export function masterSourcesToKeep(photos) {
  const out = new Set();
  for (const photo of photos || []) {
    const src = photo?.src;
    if (needsMasterSource(photo) && typeof src === "string" && src) out.add(src);
  }
  return [...out].sort();
}

/** srcset 拆项：`a.webp 300w, b.webp 600w` → `["a.webp", "b.webp"]` */
function srcsetUrls(srcset) {
  return String(srcset || "")
    .split(",")
    .map((part) => part.trim().split(/\s+/)[0])
    .filter(Boolean);
}

/**
 * 站点会去请求的 `photos/` 路径全集（相对仓库根）。
 *
 * 刻意**遍历字段**而不是白名单字段名：manifest 的字段还会长（P-2 刚加了
 * `mediumSrcset` / `mediumAvifSrcset`），白名单漏一个，新档位就在守卫里隐形 ——
 * 而「守卫看不见的东西」正是这类改动最容易丢的。
 * 规则：任何以 `photos/` 开头的字符串字段都算引用（srcset 拆项），
 * 唯 `src` 需 `needsMasterSource` 为真才计入。
 */
export function referencedPhotoPaths(photos) {
  const out = new Set();
  for (const photo of photos || []) {
    const keepSrc = needsMasterSource(photo);
    for (const [key, value] of Object.entries(photo || {})) {
      if (typeof value !== "string" || !value.startsWith("photos/")) continue;
      if (key === "src" && !keepSrc) continue;
      if (key.endsWith("Srcset") || key.endsWith("srcset")) {
        for (const url of srcsetUrls(value)) out.add(url);
      } else {
        out.add(value);
      }
    }
  }
  return [...out].sort();
}
