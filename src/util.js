/**
 * 纯工具函数集 —— 无 DOM、无闭包状态，因此可被 Node 直接单测
 * （`tests/unit/util.test.mjs`，`npm run test:unit`）。
 *
 * 这是 P2-2（`app.js` 单文件单作用域 1800+ 行 → ESM 拆分）的**第一步**：
 * 先抽出无状态纯函数，把「原生 ESM 加载 + SW 缓存模块 + node --test」这条链路验证通，
 * 再按功能域继续拆 hero / gallery / lightbox / upload。
 *
 * 三条约束（后续往这里加东西时同样适用）：
 *   1. **零副作用**：import 本模块不得触碰 DOM / window / localStorage / matchMedia，
 *      否则 Node 端 import 会直接抛错，单测根本加载不起来；
 *   2. **依赖树叶子**：不 import 其它 src 模块，避免循环依赖；
 *   3. 只用 ECMAScript 标准内建（Date / Math / String / decodeURIComponent），
 *      浏览器与 Node 两端行为一致。
 */

/** 日期与序号格式化的统一补零 */
export const pad = (n) => String(n).padStart(2, "0");

/** 本机新增照片的临时 id：时间戳 36 进制 + 随机后缀（不引 crypto，够用且零依赖） */
export const uid = () =>
  `u${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;

/** hash 可能被手工改坏（`#p=%`）→ decodeURIComponent 会抛 URIError */
export const safeDecode = (s) => {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
};

/** 相机默认文件名 / 数码导出名都算不上「作品标题」 */
export function looksLikeFileTitle(title) {
  return (
    !title ||
    /^(img|dsc|pxl|mmexport|photo|image|未命名)/i.test(title) ||
    /^[\w.-]*\d{6,}/.test(title)
  );
}

/** 画作标题：文件名像相机默认名时给《无题 · NN》，否则用《title》 */
export function displayTitle(photo, index) {
  const t = (photo?.title || "").trim();
  if (!looksLikeFileTitle(t)) return `《${t}》`;
  return `《无题 · ${String(index + 1).padStart(2, "0")}》`;
}

/** 题下策展说明的取值：trim 后为空即视为「无说明」。
 *  与 title 不同，说明**不**做《无题 · NN》式降级 —— 没写就是没有，不替作者编话。
 *  返回值同时决定观画室里那一行是显示还是隐藏（`src/lightbox.js` 的 sync）。 */
export function captionText(photo) {
  return (photo?.caption || "").trim();
}

/** 墙号（展厅序号标签） */
export function wallNumber(index) {
  return `MIL · ${String(index + 1).padStart(3, "0")}`;
}

/** 观画室位置指示「3 / 18」：与逐图页 pager-count 同格式（不补零）。
 *  序号语义由调用方决定 —— 约定传**全量馆藏序号**（与墙号一致），见 util 域注释。 */
export function positionLabel(index, total) {
  return `${index + 1} / ${total}`;
}

/** 位置指示的读屏播报文本。视觉计数走 aria-hidden，读屏只听这一句
 *  （直接念「3 / 18」会被拆成「3 斜杠 18」，故两者分离）。 */
export function positionAnnouncement(index, total) {
  return `第 ${index + 1} 件，共 ${total} 件`;
}

/** 灯箱手势提示文案（U-3）。fine = 精确指针（鼠标/触控板/键盘），coarse = 触屏：
 *  触屏没有方向键、桌面不谈双指。只列审计点名的三个手势里各自成立的那些。 */
export function lightboxHintText(coarse) {
  return coarse ? "双击放大 · 双指缩放" : "← → 翻页 · 双击放大";
}

/** 单件分享 URL（F-4）。
 *
 *  有 slug → 逐图展签页的**绝对 URL**（社交抓取器能展开逐图卡片，这是分享钮
 *  存在的全部理由）；无 slug（浏览器内上传的自定义图）→ 站内深链 `#p=<id>`，
 *  两者皆缺 → 站点根。先剥掉 `pageHref` 的 hash —— 灯箱开着时地址栏正是 `#p=…`。 */
export function shareUrlFor(photo, pageHref) {
  const base = String(pageHref || "").split("#")[0];
  const slug = photo?.slug ? String(photo.slug) : "";
  if (slug) return new URL(`p/${encodeURIComponent(slug)}/`, base).href;
  const id = photo?.id != null ? String(photo.id) : "";
  return id ? `${base}#p=${encodeURIComponent(id)}` : base;
}

/** 归一为**本地时区**的 YYYY-MM-DD；非法输入返回空串（调用方据此跳过该条） */
export function toLocalDate(msOrDate) {
  const d = msOrDate instanceof Date ? msOrDate : new Date(msOrDate);
  if (Number.isNaN(d.getTime())) return "";
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** 取 YYYY-MM 作为筛选键；非字符串一律返回空串 */
export function ymKey(dateStr) {
  if (!dateStr || typeof dateStr !== "string") return "";
  return dateStr.slice(0, 7);
}

/** 筛选键 → 中文标签：`2026-09` → `2026年9月`（月不补零，与既有界面一致） */
export function ymLabel(key) {
  const [y, m] = String(key || "").split("-");
  if (!y || !m) return String(key || "");
  return `${y}年${Number(m)}月`;
}

/** folder / custom 去重用的键：取路径最后一段文件名 */
export function baseFileName(p) {
  const raw = p?.file || p?.fileName || "";
  if (raw) return String(raw).split("/").pop();
  return "";
}

/** 按年月收集筛选键并倒序（新→旧）。保留既有「首次出现顺序 → 再整体倒序」的行为 */
export function collectFilters(list) {
  const keys = [];
  list.forEach((p) => {
    const k = ymKey(p.date);
    if (k && !keys.includes(k)) keys.push(k);
  });
  keys.sort().reverse();
  return keys;
}

/** 去掉扩展名（上传时的标题来源） */
export function stripExt(name) {
  return name.replace(/\.[^.]+$/, "");
}

/** 上传文件名：时间戳前缀防重名 + 清掉非 \w 字符（注意含 Date.now()，非纯函数） */
export function safeFileName(file) {
  const stamp = Date.now().toString(36);
  const base = (file.name || "photo")
    .replace(/[^\w.-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  return `${stamp}-${base || "photo.jpg"}`;
}

/** 静态图最大可用档（WebP 侧）：medium > thumb > src。
 *  `thumb` 是最大缩略档，缺失（无 Pillow 的降级构建）时才落到原文件。
 *  现役消费者只剩序厅（heroSrc）—— 灯箱自 2026-10-17 起原图直出，不再过这里；
 *  `largestSrcsetUrl` / `largestAvif`（P-3 给灯箱现算 AVIF 顶层用）随直出退役。 */
export function largestStill(photo) {
  return photo?.medium || photo?.thumb || photo?.src || "";
}

/** 序厅轮播用图：动图只用静态缩略图，避免首屏拉原文件 */
export function heroSrc(photo) {
  if (photo?.animated) return photo.thumb || photo.src || "";
  return largestStill(photo);
}

// 与 tools/photos_lib.py 的 MEDIUM_MAX_EDGE 对齐；
// tests/unit/medium-width.test.mjs 读 python 源钉住一致性，改一边忘另一边即红
const MEDIUM_MAX_EDGE = 1280;

/** 序厅画心的响应式布局宽度（与 styles.css 的 .hero-art img max-width 同值） */
export const HERO_SIZES = "min(86vw, 880px)";

/** 中图实际像素宽：manifest 不存中图尺寸，由原图宽高按长边上限反推 */
export function mediumWidth(photo) {
  // 中图与 AVIF 变体总是同生同灭，两者任一在场即认为有中图
  if (!(photo?.medium || photo?.mediumAvif) || !(photo.width > 0) || !(photo.height > 0)) return 0;
  const long = Math.max(photo.width, photo.height);
  if (long <= MEDIUM_MAX_EDGE) return photo.width;
  return Math.round((photo.width * MEDIUM_MAX_EDGE) / long);
}

/** 序厅 <img> 响应式候选：缩略图各档 + 中图（大屏兜底），无候选返回空串 */
export function heroSrcset(photo) {
  const parts = [];
  if (photo?.thumbSrcset) parts.push(photo.thumbSrcset);
  const mw = mediumWidth(photo);
  if (photo?.medium && mw) parts.push(`${photo.medium} ${mw}w`);
  return parts.filter(Boolean).join(", ");
}

/** 序厅 AVIF <source> 响应式候选：与 heroSrcset 同构，只换 AVIF 变体 */
export function heroAvifSrcset(photo) {
  const parts = [];
  if (photo?.thumbAvifSrcset) parts.push(photo.thumbAvifSrcset);
  const mw = mediumWidth(photo);
  if (photo?.mediumAvif && mw) parts.push(`${photo.mediumAvif} ${mw}w`);
  return parts.filter(Boolean).join(", ");
}

/** 预载标签的 type 提示：取**首个候选的 URL** 判扩展名，返回 "image/avif" /
 *  "image/webp" / ""（未知格式不写 type，交给浏览器嗅探）。
 *
 *  为什么是「首个候选」：候选串以宽度描述符结尾（`"…-400.avif 300w, … 900w"`），
 *  拿整串去 /\.avif$/ 匹配时 `$` 锚点永远落在 "900w" 后面，条件恒假 —— 2026-10-02
 *  的红态实证就是「type 从未写上」，注释里「不支持该格式的浏览器跳过预载」形同虚设。
 *  同一 srcset 的候选由 photos_lib 按同一格式整体产出（AVIF 串全是 .avif），故只看
 *  首个候选即可；退化为单 URL 的 href 同样适配。
 *
 *  消费点：app.js 的 preloadImage（**兜底**路径 —— 产物形态下预载由构建期静态注入
 *  tools/hero-preload.mjs 写入 HTML，preloadImage 的 already 判定会跳过）。 */
export function preloadType(srcset, href = "") {
  const first = String(srcset || href || "")
    .split(",")[0]
    .trim()
    .split(/\s+/)[0];
  if (/\.avif$/i.test(first)) return "image/avif";
  if (/\.webp$/i.test(first)) return "image/webp";
  return "";
}

/* ── F-3 序厅策展精选 ─────────────────────────────────────────────────── */

/** 序厅轮播的缺省上限（无 featured 时的回落张数；有精选时数量由策展决定） */
export const HERO_MAX = 8;

/** 序厅选片（F-3）：meta.json 的 featured（唯一正整数，越小越靠前）由 sync 归一进
 *  manifest。有精选 → 按 rank 升序**全量**返回（数量交给策展，不截断）；无 → 陈列序
 *  前 max 张（旧行为）。排名重复（手工改过的清单）时 sort 稳定 → 保持陈列序，
 *  不抛错；python 端在 sync 阶段已对重复排名报错拦截。 */
export function selectHeroPhotos(photos, max = HERO_MAX) {
  const list = photos || [];
  const featured = list.filter((p) => Number.isInteger(p?.featured) && p.featured >= 1);
  if (featured.length) return featured.sort((a, b) => a.featured - b.featured);
  return list.slice(0, max);
}

/* ── D-1 低分辨率母版钳制 ──────────────────────────────────────────────── */

/** 低分辨率母版的判据（短边 px ≤ 此值）：卡片画心不放大超过源宽。
 *  当前馆藏唯一命中是 360×360 的《夜泊》；640 远小于重点陈列行的放大行程。 */
export const LOW_RES_MAX_EDGE = 640;

/** 低分辨率母版的画心限宽（D-1）：短边 ≤ LOW_RES_MAX_EDGE 时返回源宽（px），
 *  否则 0（不钳）。宽高任一未知 → 0：无权判低清，宁可不动。 */
export function lowResCapWidth(photo) {
  const w = Number(photo?.width) || 0;
  const h = Number(photo?.height) || 0;
  if (!(w > 0) || !(h > 0) || Math.min(w, h) > LOW_RES_MAX_EDGE) return 0;
  return w;
}

/** 灯箱（观画室）用图：**一律原图直出**（2026-10-17 站主决策）——
 *  观画室是「看画」的终点，放的就得是母版本身（`photos/<name>.<ext>`）。
 *  `<img>`、hover 预热（prefetchUrl）、邻居预载三处同走这一个取值；
 *  派生档（thumbs/medium）仍服务序厅与展厅列表：首屏与滚动网格吃的是体积。
 *  动图（GIF）本就走原文件，与这里同值；无 src 时返回空串（调用方不设 src）。
 *  旧实现是「最大可用档 medium → thumb → src」+ P-2 按 DPR 选档，
 *  随原图直出整体退役（历史设计见 research/milan-museum-design/2026-10-11-lightbox-tier-fallback-design.md）。 */
export function lightboxSrc(photo) {
  return photo?.src || "";
}

/* —— 空状态判据（F-9 二分模型）——
   「加载失败」与「空馆藏」在 UI 上曾经不可分：app.js 的外层 catch 把任何失败都写成
   `folderPhotos = []`，判据只剩 visibleCount —— 访客看到的是一句**面向站主**的静态文案，
   且没有任何出路（P0 那次全站白屏的落地页正是它）。这里把判据收敛成一个纯函数，
   让「哪些情形给重试入口」可被单测直接钉住。

   站主操作指引不留在访客界面：原句「将图片放入 photos/ 后刷新，或到库房登记入藏」
   面向的是站主，而站主有库房面板、CI 的 sync-photos 也会回写清单，不需要从错误页取指引。

   未启用：第三态「筛选无结果」（该提示「换个筛选」而不是「暂无作品」）。当前
   collectFilters 的选项全部源自真实照片、非法/过期 #f 年月由 renderFilters 兜底退回 all
   ⇒ 该分支无法自然触发，做出来只能靠人工改源码证明（空断言）。等 F-7（检索/标签）落地时
   在此加一个分支即可。 */
export const EMPTY_FAILURE_TEXT = "展厅暂时无法开放，请稍后重试。";
export const EMPTY_EMPTY_TEXT = "本馆暂无展出作品，敬请期待。";

/**
 * 空状态判据：`null` 表示不该显示空状态。
 * @param {{ready?:boolean, visibleCount?:number, failed?:boolean}} s
 *   ready —— 清单已到达（未到达一律不显示，避免首屏闪现）
 *   visibleCount —— 当前筛选下的可见作品数
 *   failed —— 取清单是否失败（三条失败链都收敛到这一个状态位）
 * @returns {{text:string, retry:boolean}|null}
 */
export function emptyState({ ready, visibleCount, failed } = {}) {
  if (!ready || (visibleCount || 0) > 0) return null;
  return failed
    ? { text: EMPTY_FAILURE_TEXT, retry: true }
    : { text: EMPTY_EMPTY_TEXT, retry: false };
}
