/**
 * `photos/` 目录的**产物清单**（2026-10-17 起：原图直出，母版全量发布）。
 *
 * 本仓的 `photos/` 同时住着三种东西：
 *   ① 母版（`photos/<name>.jpg` 等）：**原图直出的交付物** —— 观画室、逐图展签页、
 *      分享卡（og:image / JSON-LD / sitemap）与浏览器的「另存为」拿到的都是它，
 *      同时仍是派生图的生成源；
 *   ② 派生图（`thumbs/` 与 `medium/`）：序厅首屏与展厅列表的体积优化档；
 *   ③ `manifest.json`：产品 fetch 的清单。（`meta.json` 是策展源，前端不读。）
 *
 * 历史（防回改）：P-1（2026-09）曾把母版整体移出产物 —— 当时看画链路走派生档，
 * 只有动图/无缩略图的兜底会触达 `src`；2026-10-17 站主决策「原图直出」后反转：
 * 母版必须全量进 dist，否则观画室、逐图页、爬虫与分享卡拿到的都是线上不存在的
 * URL（404，且页面渲染完全正常、肉眼不可见）。
 *
 * 调用方：`vite.config.js` 的 copyStaticPlugin（构建期决定拷什么）与
 * e2e `tests/e2e/global-setup.js` 对策 6（对着 dist 核对拷对了什么）。
 * 构建期那一侧必须**自己**读仓库源的 manifest —— closeBundle 是并行钩子，
 * 那一刻 dist/photos 还没拷好。
 */

/** 需要保留在产物里的母版（仓库根相对路径，形如 `photos/01-city-rain.jpg`）。
 *  原图直出：`src` 指向的每个文件都是访客/爬虫会取的交付物，全量保留（去重、排序）。 */
export function masterSourcesToKeep(photos) {
  const out = new Set();
  for (const photo of photos || []) {
    const src = photo?.src;
    if (typeof src === "string" && src) out.add(src);
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
 * 刻意**遍历字段**而不是白名单字段名：manifest 的字段还会长（`thumbAvifSrcset`、
 * `heroSrcset` 都是后加的），白名单漏一个，新档位就在守卫里隐形 ——
 * 而「守卫看不见的东西」正是这类改动最容易丢的。
 * 规则：任何以 `photos/` 开头的字符串字段都算引用（srcset 拆项）；
 * `src` 自原图直出起也直接计入（此前只在 needsMasterSource 为真时才计）。
 */
export function referencedPhotoPaths(photos) {
  const out = new Set();
  for (const photo of photos || []) {
    for (const [key, value] of Object.entries(photo || {})) {
      if (typeof value !== "string" || !value.startsWith("photos/")) continue;
      if (key.endsWith("Srcset") || key.endsWith("srcset")) {
        for (const url of srcsetUrls(value)) out.add(url);
      } else {
        out.add(value);
      }
    }
  }
  return [...out].sort();
}
