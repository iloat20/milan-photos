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

/** 从 srcset 串取 **w 描述符最大**的候选 URL；无候选 / 无描述符时取首个非空项，空串返回 ""。
 *  「取最大档」这条语义在 WebP 侧由 `photo.thumb`（= 最大缩略档）承担，
 *  AVIF 侧没有对应的标量字段，故从 `thumbAvifSrcset` 现算 —— 与 mediumWidth
 *  「由原图反推而非存储」同一范式，避免新增 manifest 字段与一次 sync。 */
export function largestSrcsetUrl(srcset) {
  let best = "";
  let bestW = -1;
  for (const part of String(srcset || "").split(",")) {
    const [url, descriptor] = part.trim().split(/\s+/);
    if (!url) continue;
    const m = /^(\d+)w$/.exec(descriptor || "");
    const w = m ? Number(m[1]) : 0;
    if (w > bestW) {
      bestW = w;
      best = url;
    }
  }
  return best;
}

/** 静态图最大可用档（WebP 侧）：medium > thumb > src。
 *  `thumb` 是最大缩略档，缺失（无 Pillow 的降级构建）时才落到原文件。 */
export function largestStill(photo) {
  return photo?.medium || photo?.thumb || photo?.src || "";
}

/** 静态图最大可用档（AVIF 侧）：mediumAvif > thumbAvifSrcset 顶层。
 *  `thumbAvifSrcset` 的档位与 medium 同参数生成（`thumb` 与 `medium` 共用质量常量），
 *  故对无 medium 的图，顶层 AVIF 是**质量中性**的替换而非降级。 */
export function largestAvif(photo) {
  return photo?.mediumAvif || largestSrcsetUrl(photo?.thumbAvifSrcset);
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

/** 灯箱用图：动图走原文件保证能播，其余取**最大可用档**
 *  （medium → thumb → src）。原图 `src` 只在派生图全缺时才被触达 ——
 *  这正是 P-1「母版移出产物」的前置：修完后静态作品不再请求 `photos/<name>.<ext>`。 */
export function lightboxSrc(photo) {
  if (photo?.animated) return photo.src || "";
  return largestStill(photo);
}

/** 预载须与灯箱 <picture> 实际选中一致：AVIF 优先，动图仍走原文件。
 *  无 AVIF 变体时返回 WebP，`type="image/avif"` 会让浏览器跳过它、回落同值 —— 无重复下载。 */
export function lightboxAvifOrFallback(photo) {
  if (photo?.animated) return photo?.src || "";
  return largestAvif(photo) || largestStill(photo);
}

/* ── 观画室按需求选档（P-2）─────────────────────────────────────────────────
   加了 2048 档之后**不能**「永远取最大档」：移动端 DPR3 下一张竖图的需求宽约
   1052，取 2048 档只是让弱网多下两倍字节，肉眼无差别。把「按需求选档」拆成四个
   纯函数，浏览器与 Node 两侧共用同一份实现：

     caps  = frameCaps(img)           画框可用区上限（读计算样式，不复刻 CSS）
     need  = lightboxNeed(photo, …)   该图在当前 DPR 下的需求宽度
     tiers = lightboxTiers(photo)     升序候选 [{url, w}]
     url   = pickTier(tiers, need)    选 ≥ need 的最小档

   `lightboxSrc` / `lightboxAvifOrFallback`（P-3 产物）保留不动，作为
   「读不到画框 / 缺 width·height」时的兜底 —— 与 P-3「取最大可用档」语义一致，
   故兜底路径不会比现状更差。 */

/** 画框可用区上限（CSS px）：直接读 `.lightbox-img` 的 max-width / max-height。
 *
 *  **刻意不在 JS 里复刻 CSS 常量**（形如 `min(86vw, 940px) − 2*pad − 2*border`）：
 *  那样会引入「CSS 改了、JS 没跟上」的静默漂移，而且没有任何测试能发现它
 *  —— 与 `mediumWidth()` 的双份实现同类，但更隐蔽。读计算样式后这类漂移在结构上
 *  不可能发生；且 `<dialog>` 处于关闭态（hover 预载、开图前）同样解析出 px。
 *
 *  非数值（`max-width: none` 等）一律回退 0，由调用方据此走 P-3 的兜底最大档。
 *  @param {HTMLElement|null} imgEl `.lightbox-img`
 *  @param {Function} [getStyle] 仅测试注入；默认取全局 getComputedStyle（import 期不触碰）
 */
export function frameCaps(imgEl, getStyle) {
  const gs =
    typeof getStyle === "function"
      ? getStyle
      : typeof getComputedStyle === "function"
        ? getComputedStyle
        : null;
  if (!imgEl || !gs) return { w: 0, h: 0 };
  const cs = gs(imgEl) || {};
  const w = parseFloat(cs.maxWidth);
  const h = parseFloat(cs.maxHeight);
  return { w: Number.isFinite(w) ? w : 0, h: Number.isFinite(h) ? h : 0 };
}

/** 该图在当前画框上限与 DPR 下的需求宽度（设备 px）。
 *
 *  `scale = min(capsW/w, capsH/h, 1)`：等比缩放同时受宽高双约束；`min(…, 1)`
 *  保证小图不被放大（放大只插值、不增信息）。
 *
 *  返回 **0 表示「信息不足」而非「需求为 0」**——正常取值恒 ≥ 1。调用方用
 *  `need > 0` 判定能否走选档，否则回落 P-3 的最大可用档。
 *
 *  取整取**整式** `ceil(w · s · dpr)`，不是 `ceil(w · s) · dpr`：后者会把
 *  0.4 个设备像素放大成整整 1 个（移动端实测差 1px），而这个 px 正是选档边界。
 */
export function lightboxNeed(photo, caps, dpr) {
  const w = photo?.width;
  const h = photo?.height;
  if (!(w > 0) || !(h > 0) || !(caps?.w > 0) || !(caps?.h > 0)) return 0;
  const scale = Math.min(caps.w / w, caps.h / h, 1);
  return Math.ceil(w * scale * (dpr > 0 ? dpr : 1));
}

/** srcset 串 → [{url, w}]（缺 `w` 描述符记 0；空串 → []） */
function parseTiers(srcset) {
  const out = [];
  for (const part of String(srcset || "").split(",")) {
    const [url, descriptor] = part.trim().split(/\s+/);
    if (!url) continue;
    const m = /^(\d+)w$/.exec(descriptor || "");
    out.push({ url, w: m ? Number(m[1]) : 0 });
  }
  return out;
}

/** 候选合并：按 url 去重（同 url 保留较大 w）、按 w 升序 */
function mergeTiers(lists) {
  const seen = new Map();
  for (const { url, w } of lists) {
    if (!url) continue;
    const prev = seen.get(url);
    if (prev === undefined || w > prev) seen.set(url, w);
  }
  return [...seen.entries()]
    .map(([url, w]) => ({ url, w }))
    .sort((a, b) => a.w - b.w);
}

/** 静态图 WebP 候选：`mediumSrcset`（1280 + 2048）+ `thumbSrcset`（400/800/1200）。
 *  老/降级清单只有 `medium` 标量时按它的反推宽度补一条。动图 → `[]`（走原文件）。 */
export function lightboxTiers(photo) {
  if (photo?.animated) return [];
  const lists = [...parseTiers(photo?.mediumSrcset), ...parseTiers(photo?.thumbSrcset)];
  if (!photo?.mediumSrcset && photo?.medium) {
    lists.push({ url: photo.medium, w: mediumWidth(photo) });
  }
  return mergeTiers(lists);
}

/** 静态图 AVIF 候选：与 `lightboxTiers` 同构，只换 AVIF 变体 */
export function lightboxAvifTiers(photo) {
  if (photo?.animated) return [];
  const lists = [...parseTiers(photo?.mediumAvifSrcset), ...parseTiers(photo?.thumbAvifSrcset)];
  if (!photo?.mediumAvifSrcset && photo?.mediumAvif) {
    lists.push({ url: photo.mediumAvif, w: mediumWidth(photo) });
  }
  return mergeTiers(lists);
}

/** 选「≥ need 的最小档」（恰好相等取该档）；全都比 need 小则取最大档；空候选 → `""`。 */
export function pickTier(tiers, need) {
  if (!tiers || !tiers.length) return "";
  let best = "";
  let bestW = Infinity;
  for (const { url, w } of tiers) {
    if (url && w >= need && w < bestW) {
      bestW = w;
      best = url;
    }
  }
  if (best) return best;
  // 全都比 need 小：取最大档（有总比没有好；浏览器不会自行放大，只是略软）
  let maxW = -Infinity;
  for (const { url, w } of tiers) {
    if (url && w > maxW) {
      maxW = w;
      best = url;
    }
  }
  return best;
}
