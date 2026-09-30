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

/** 墙号（展厅序号标签） */
export function wallNumber(index) {
  return `MIL · ${String(index + 1).padStart(3, "0")}`;
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

/** 序厅轮播用图：动图只用静态缩略图，避免首屏拉原文件 */
export function heroSrc(photo) {
  if (photo?.animated) return photo.thumb || photo.src || "";
  return photo?.medium || photo?.thumb || photo?.src || "";
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

/** 灯箱用图：动图走原文件保证能播，其余优先中图 */
export function lightboxSrc(photo) {
  if (photo?.animated) return photo.src || "";
  return photo?.medium || photo?.src || "";
}

/** 预载须与灯箱 <picture> 实际选中一致：AVIF 优先，动图仍走原文件 */
export function lightboxAvifOrFallback(photo) {
  if (photo?.animated) return photo?.src || "";
  return photo?.mediumAvif || lightboxSrc(photo);
}
