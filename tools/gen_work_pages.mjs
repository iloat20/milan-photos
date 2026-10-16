/**
 * 逐图展签页生成器（P1 设计稿 §4）。
 *
 * 产出 `dist/p/<slug>/index.html` × N 与 `dist/sitemap.xml`，让每件作品成为
 * **独立可索引的静态页**：深链 `#p=<file>` 是哈希，搜索引擎不索引，图片搜索这一
 * 最大的自然流量入口此前为 0；逐图页同时把社交分享从「站点级卡片」变成逐图卡片。
 *
 * 六个必须守住的点，动之前先想清楚：
 *
 * 1. **无 JS 依赖**：每页内容（图 / 标题 / 说明 / 日期 / prev-next）全是解析期就位的
 *    静态 HTML，禁 JS 也能读。唯一的脚本是主题初值（4 行，与 index.html 同一段），
 *    属于渐进增强：它不产出任何内容，只是避免「存 light + 系统 dark」的用户从搜索
 *    结果落地时看到与主页不一致的底色。
 * 2. **slug 冲突必须报错，不静默去重**：两个作品归一成同一个 slug 会让后者覆盖前者，
 *    而站点看起来完全正常（只是少了一页）。宁可构建失败。
 * 3. **转义分两种上下文**：HTML 文本/属性用 `escapeHtml`；JSON-LD 里的 `<` 必须转成
 *    `\u003c`，否则标题里的 `</script>` 会提前闭合 script 元素、把后半页变成正文。
 * 4. **绝对 URL 只从 siteUrl 派生**（`new URL(rel, siteUrl)`）：canonical / og:image /
 *    sitemap 三处必须自洽，硬编码会让改域名变成三处漏改。
 * 5. **版式复用站点 tokens**：页面直接引 `../../styles.css`，颜色/字体/圆角只有
 *    styles.css 一份来源（本仓「颜色只声明一次」的硬约束），本生成器不写任何色值。
 * 6. **不改动 Vite 资源图**：生成器在 `closeBundle` 写的是**已写盘的最终产物**，
 *    页面里的 `../../assets/*` 与 `../../styles.css` 都按产物实际路径书写。
 * 7. **CSP 自带，不等插件注入**：本生成器与 `build-finalize` 插件都挂在 closeBundle，
 *    而 Rollup 的 closeBundle 是**并行**钩子（顺序无保证）—— 等插件来覆盖 `dist/p/**`
 *    是撞运气。指令集合与 hash 规则取自 `tools/csp.mjs`（与主页同一份，不在此重写）；
 *    本页的内联脚本（主题初值）与 JSON-LD 数据块都会进 script-src 的 hash 名单。
 *
 * 为什么单独成文件而不塞进 vite.config.js：本节所有规则都要能被 `node --test`
 * 直接覆盖（slug / 转义 / 版式 / sitemap），塞进配置里就只能靠 e2e 端到端撞。
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

// CSP 与主页共用一份指令集合与 hash 规则（见 tools/csp.mjs 的说明）
import { withCsp } from "./csp.mjs";

// 与 src/util.js 同源：标题降级（《无题 · NN》）、墙号、中图宽度反推都只有一份实现，
// 生成器**不重写一遍**——漂移会让展签页与观画室显示不同的标题。
import {
  captionText,
  displayTitle,
  mediumWidth,
  wallNumber,
} from "../src/util.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** 站点根 URL（末尾必须带 /）：canonical / og:* / sitemap 的唯一来源 */
export const SITE_URL = "https://iloat20.github.io/milan-photos/";
export const SITE_NAME = "米兰美术馆";

/** 展签页的画心列宽，与 styles.css 的 `.work-frame` max-width 同值 */
export const WORK_SIZES = "min(92vw, 860px)";

/* ────────────────────────── slug ────────────────────────── */

const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/**
 * 归一为 `[a-z0-9-]+`：小写、非字母数字整段折成单个连字符、去首尾连字符。
 *
 * `IMG20260817164949_01` → `img20260817164949-01`
 * `01-city-rain`         → `01-city-rain`（8 件策展作品的名字本就是好 slug）
 */
export function normalizeSlug(raw) {
  return String(raw ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** 文件名去扩展名——slug 的缺省来源（`meta.json` 可显式覆盖） */
export function slugSource(photo) {
  const file = String(photo?.file || photo?.src || "");
  const base = file.split("/").pop() || "";
  return base.replace(/\.[^.]+$/, "");
}

/**
 * 逐条解析 slug。来源顺序（F-4 起）：
 *   1. `manifest.slug` —— `npm run sync` 写入的唯一归一来源（浏览器分享按钮读同一份）；
 *   2. 回退（老/降级清单）：`meta.json` 的 `[file].slug` 覆盖 > 文件名 stem。
 * 两处归一算法相同的实现分别住在 photos_lib.py / 本文件，一致性由「真清单一致性」
 * 单测在真数据上钉住（红了就 `npm run sync`）。
 *
 * 冲突抛出而非去重：重名会让一页静默消失（站点照常可访问）。
 * @returns {string[]} 与 manifest.photos 同序的 slug
 */
export function resolveSlugs(manifest, meta = {}) {
  const photos = manifest?.photos || [];
  const used = new Map();
  return photos.map((photo) => {
    const override = meta?.[photo.file]?.slug;
    const slug =
      photo?.slug != null
        ? String(photo.slug)
        : normalizeSlug(override ?? slugSource(photo));
    if (!SLUG_RE.test(slug)) {
      throw new Error(
        `gen-work-pages: ${photo.file} 归一后的 slug 非空且须匹配 [a-z0-9-]："${slug}"`
      );
    }
    const owner = used.get(slug);
    if (owner !== undefined) {
      throw new Error(
        `gen-work-pages: slug 冲突——${photo.file} 与 ${owner} 都归一为 "${slug}"。` +
          "请在 photos/meta.json 里给其中一件写显式 slug。"
      );
    }
    used.set(slug, photo.file);
    return slug;
  });
}

/* ────────────────────────── 转义 ────────────────────────── */

const HTML_ENTITIES = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };

/** HTML 文本与双引号属性共用（本生成器只写双引号属性，故不需要两套） */
export function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (c) => HTML_ENTITIES[c]);
}

/** XML 文本节点（sitemap 的 loc / lastmod） */
export function escapeXml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (c) => HTML_ENTITIES[c]);
}

/**
 * JSON-LD 内联块的转义：`<` → `\u003c`。
 * 不转的话，说明里出现 `</script>` 就直接闭合 script 元素——后半页变成正文，
 * 且 JSON 里恰好没人会写这个，所以这种坏法能一路活到线上。
 */
export function embedJsonLd(data) {
  return JSON.stringify(data, null, 2).replace(/</g, "\\u003c");
}

/* ────────────────────────── 展示取值 ────────────────────────── */

/** 带书名号的题名（观画室 / 展签页 <h1> 的样式，与卡片墙签同一套） */
export function bracketedTitle(photo, index) {
  return displayTitle(photo, index);
}

/** 纯文本题名：书名号不进 <title> / og:title（SERP 与分享卡片里它是噪声） */
export function plainTitle(photo, index) {
  const t = displayTitle(photo, index);
  return t.startsWith("《") && t.endsWith("》") ? t.slice(1, -1) : t;
}

/** `2026-09-22` → `2026年9月22日`；非 ISO 形状原样返回（宁可显示原值也不抛） */
export function formatDateCN(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso ?? "").trim());
  if (!m) return String(iso ?? "");
  return `${m[1]}年${Number(m[2])}月${Number(m[3])}日`;
}

/** 中图的像素尺寸（长边 1280）；无中图返回 null */
export function mediumSize(photo) {
  const width = mediumWidth(photo);
  if (!width || !(photo?.width > 0) || !(photo?.height > 0)) return null;
  return { width, height: Math.round((photo.height * width) / photo.width) };
}

/** srcset 里宽度最大的候选（url + 描述符宽度）；无描述符 / 空 → null */
function largestCandidate(srcset) {
  let best = null;
  for (const part of String(srcset || "").split(",")) {
    const [url, desc] = part.trim().split(/\s+/);
    if (!url) continue;
    const m = /^(\d+)w$/.exec(desc || "");
    if (!m) continue;
    const width = Number(m[1]);
    if (!best || width > best.width) best = { url, width };
  }
  return best;
}

/**
 * 分享卡与结构化数据的代表图：**现存最大的派生图**，连同它的像素尺寸。
 *
 * 序：`mediumSrcset` 最大档（2048）> `medium` 标量（1280）> `thumb` 最大档。
 * **绝不回落 `src`** —— 母版已移出产物（P-1），回落即指向线上不存在的文件：
 * 症状是分享卡空白、Google 结构化数据报错，而页面本身完全正常（没有任何用例会红）。
 *
 * 为什么「取最大」而不是像观画室那样按画框选档：爬虫与 IM 抓图器不执行 JS、
 * 也不报告画框尺寸，只能按 URL 抓一回；给它们最清晰的那档，抓一张 16–341 KB 的
 * 派生图远比抓 218–971 KB 的母版更可能成功（微信对超大图会直接放弃）。
 */
export function shareImageInfo(photo) {
  const w0 = photo?.width;
  const h0 = photo?.height;
  const aspect = (width) => (w0 > 0 && h0 > 0 ? { height: Math.round((h0 * width) / w0) } : {});

  const large = largestCandidate(photo?.mediumSrcset);
  if (large) return { url: large.url, width: large.width, ...aspect(large.width) };

  const width1280 = mediumWidth(photo);
  if (photo?.medium && width1280) {
    return { url: photo.medium, width: width1280, ...aspect(width1280) };
  }

  const thumb = largestCandidate(photo?.thumbSrcset);
  if (thumb) return { url: thumb.url, width: thumb.width, ...aspect(thumb.width) };

  // 理论不可达的兜底（无任何派生图的条目）——注意它与 P-1 的保留规则自洽：
  // 「无 thumb」正是 needsMasterSource() 判真的条件，那种条目的母版会被留在产物里。
  return { url: photo?.thumb || photo?.src || "", ...aspect(w0) };
}

/** 分享图 URL：逐图页的 `og:image` 与 JSON-LD 的 `image` / `contentUrl` 三者同值。 */
export function shareImage(photo) {
  return shareImageInfo(photo).url;
}

/**
 * <picture> 的两组候选串：缩略图各档 + 中图（大屏兜底）。
 * 与 src/util.js 的 `heroSrcset` / `heroAvifSrcset` 同构——同一张画在序厅、观画室、
 * 展签页三处取到同一套档位，才不会各自下一张不同尺寸的图。
 */
export function pictureSrcsets(photo) {
  const avif = [];
  const webp = [];
  if (photo?.thumbAvifSrcset) avif.push(prefixSrcset(photo.thumbAvifSrcset));
  if (photo?.thumbSrcset) webp.push(prefixSrcset(photo.thumbSrcset));
  // 中图档：清单带 `mediumSrcset`（1280 + 2048，P-2）时整体纳入，交给浏览器按
  // WORK_SIZES × DPR 原生协商；老/降级清单只有标量 `medium` 时按反推宽度补一条。
  const medium = mediumSize(photo);
  if (photo?.mediumAvifSrcset) avif.push(prefixSrcset(photo.mediumAvifSrcset));
  else if (medium && photo?.mediumAvif)
    avif.push(`${workPath(photo.mediumAvif)} ${medium.width}w`);
  if (photo?.mediumSrcset) webp.push(prefixSrcset(photo.mediumSrcset));
  else if (medium && photo?.medium) webp.push(`${workPath(photo.medium)} ${medium.width}w`);
  return { avif: avif.join(", "), webp: webp.join(", ") };
}

/** 站点绝对 URL（`photos/a.jpg` → `https://…/milan-photos/photos/a.jpg`） */
export function absoluteUrl(rel, siteUrl = SITE_URL) {
  return new URL(String(rel).replace(/^\.?\//, ""), siteUrl).href;
}

/* ────────────────────────── 版式 ────────────────────────── */

/** 页面相对站点根的深度：`/p/<slug>/` → `../../` */
const ROOT_PREFIX = "../../";

function workPath(rel) {
  return `${ROOT_PREFIX}${rel}`;
}

/**
 * manifest 里的 srcset 是**站点根相对**路径（`photos/thumbs/x.webp 800w, …`）——
 * 那是主页视角。展签页在 `/p/<slug>/` 下，直接用会解析成
 * `/p/<slug>/photos/…` 而 404，且 `<picture>` 的 404 会静默回落到 `<img src>`
 * （原图 2.6MB），肉眼与页面结构都看不出问题。故逐候选加 `../../` 前缀。
 */
export function prefixSrcset(srcset) {
  return String(srcset || "")
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const [url, ...descriptor] = part.split(/\s+/);
      return [workPath(url), ...descriptor].join(" ");
    })
    .join(", ");
}

/**
 * 结构化数据。
 *
 * `image` 与 `contentUrl` 都用**同一张派生图**（shareImageInfo）：此前 `image` 指向
 * `photo.src`（母版），母版移出产物后那是个 404 —— Google 会把它记成抓取失败，
 * 而页面渲染完全正常，肉眼与既有用例都发现不了。两者同值是通行做法
 * （`contentUrl` = 该作品的媒体文件、`image` = 代表图，取同一张不影响语义）。
 *
 * width/height 也必须跟着同一个 url 走：报 medium 标量的尺寸、却指向 2048 档，
 * 会让抓图器按错误比例预留版面。
 */
function renderJsonLd({ photo, index, slug, siteUrl, share }) {
  const data = {
    "@context": "https://schema.org",
    "@type": "Photograph",
    name: plainTitle(photo, index),
    inLanguage: "zh-CN",
    url: absoluteUrl(`p/${slug}/`, siteUrl),
    contentUrl: absoluteUrl(share.url, siteUrl),
    image: absoluteUrl(share.url, siteUrl),
    creator: { "@type": "Organization", name: SITE_NAME },
    isPartOf: { "@type": "ImageGallery", name: SITE_NAME, url: siteUrl },
  };
  const caption = captionText(photo);
  if (caption) data.description = caption;
  if (photo?.date) data.datePublished = photo.date;
  if (share.width > 0 && share.height > 0) {
    data.width = { "@type": "QuantitativeValue", value: share.width, unitCode: "E39" };
    data.height = { "@type": "QuantitativeValue", value: share.height, unitCode: "E39" };
  }
  return `  <script type="application/ld+json">\n${embedJsonLd(data)
    .split("\n")
    .map((line) => `  ${line}`)
    .join("\n")}\n  </script>`;
}

/**
 * 渲染一张展签页。
 * @param {{photo:object, index:number, total:number, slug:string,
 *          prevSlug:string|null, nextSlug:string|null, siteUrl?:string}} args
 */
export function renderWorkPage({
  photo,
  index,
  total,
  slug,
  prevSlug,
  nextSlug,
  siteUrl = SITE_URL,
}) {
  const plain = plainTitle(photo, index);
  const bracketed = bracketedTitle(photo, index);
  const caption = captionText(photo);
  const canonical = absoluteUrl(`p/${slug}/`, siteUrl);
  const shareTitle = `${plain} · ${SITE_NAME}`;
  // 分享图只算一次，og:image 与 JSON-LD 的 image/contentUrl 共用（三者必须同值，
  // 否则抓图器与结构化数据会各自抓一张；此前 image 走 src，母版移出后即 404）
  const share = shareImageInfo(photo);
  const shareUrl = absoluteUrl(share.url, siteUrl);
  const { avif, webp } = pictureSrcsets(photo);
  const dateText = formatDateCN(photo.date);
  const description = caption || `${bracketed}（${SITE_NAME}馆藏摄影作品）`;

  const sizeAttrs =
    photo?.width > 0 && photo?.height > 0
      ? ` width="${photo.width}" height="${photo.height}"`
      : "";
  const shareSizeMeta =
    share.width > 0 && share.height > 0
      ? `\n  <meta property="og:image:width" content="${share.width}" />` +
        `\n  <meta property="og:image:height" content="${share.height}" />`
      : "";
  const dateLine = photo?.date
    ? `\n          <time datetime="${escapeHtml(photo.date)}">${escapeHtml(dateText)}</time> · `
    : "\n          ";

  // 首尾不绕环：prev/next 是一条有端点的链（0 → 1 → … → N-1）。
  // 绕环看似方便浏览，但爬虫会看到一个环，且「链条完整」这条断言就失去意义。
  const prevLink = prevSlug
    ? `<a href="../${escapeHtml(prevSlug)}/" rel="prev">← 上一件</a>`
    : '<span class="work-pager-link is-disabled">← 上一件</span>';
  const nextLink = nextSlug
    ? `<a href="../${escapeHtml(nextSlug)}/" rel="next">下一件 →</a>`
    : '<span class="work-pager-link is-disabled">下一件 →</span>';

  return withCsp(`<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover" />
  <meta name="description" content="${escapeHtml(description)}" />
  <meta name="theme-color" content="#ffffff" media="(prefers-color-scheme: light)" />
  <meta name="theme-color" content="#000000" media="(prefers-color-scheme: dark)" />
  <meta name="color-scheme" content="light dark" />
  <!-- 与 index.html 同一段解析期主题初值：本站的手动主题存在 localStorage，而本页不带
       app.js（无 JS 依赖）。不等解析期落定的话，「存 light + 系统 dark」的用户从搜索结果
       落地会看到与主页相反的底色。只读不写，try/catch 兜 Safari 隐私模式的 getItem 抛错。 -->
  <script>
    try {
      var t = localStorage.getItem("milan-theme");
      if (t === "light" || t === "dark") document.documentElement.dataset.theme = t;
    } catch {}
  </script>
  <link rel="canonical" href="${canonical}" />
  <link rel="stylesheet" href="${workPath("styles.css")}" />
  <link rel="icon" type="image/png" sizes="32x32" href="${workPath("assets/favicon-32.png")}" />
  <link rel="icon" type="image/png" sizes="192x192" href="${workPath("assets/icon-192.png")}" />
  <link rel="apple-touch-icon" href="${workPath("assets/apple-touch-icon.png")}" />

  <!-- 分享预览：og:image 指向**本体现存最大的派生图**（有 2048 档就用它，否则 1280 /
       缩略最大档）—— 此前指向母版，母版移出产物后即 404（P-1） -->
  <meta property="og:type" content="website" />
  <meta property="og:site_name" content="${escapeHtml(SITE_NAME)}" />
  <meta property="og:locale" content="zh_CN" />
  <meta property="og:title" content="${escapeHtml(shareTitle)}" />
  <meta property="og:description" content="${escapeHtml(description)}" />
  <meta property="og:url" content="${canonical}" />
  <meta property="og:image" content="${escapeHtml(shareUrl)}" />${shareSizeMeta}
  <meta property="og:image:alt" content="${escapeHtml(bracketed)}" />
  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:title" content="${escapeHtml(shareTitle)}" />
  <meta name="twitter:description" content="${escapeHtml(description)}" />
  <meta name="twitter:image" content="${escapeHtml(shareUrl)}" />
  <meta name="twitter:image:alt" content="${escapeHtml(bracketed)}" />

  <title>${escapeHtml(plain)} · ${escapeHtml(SITE_NAME)}</title>
${renderJsonLd({ photo, index, slug, siteUrl, share })}
</head>
<body class="work-page">
  <header class="site-nav">
    <div class="site-nav-inner">
      <a class="site-nav-logo" href="${ROOT_PREFIX}">${escapeHtml(SITE_NAME)}</a>
      <nav class="site-nav-links" aria-label="馆内导航">
        <a href="${ROOT_PREFIX}#gallery">展厅</a>
        <a href="${ROOT_PREFIX}#about">前言</a>
        <a href="${ROOT_PREFIX}#archive">库房</a>
      </nav>
    </div>
  </header>

  <main class="work">
    <article class="work-piece">
      <nav class="work-pager" aria-label="陈列顺序">
        <span class="work-pager-slot">${prevLink}</span>
        <span class="work-pager-count">${index + 1} / ${total}</span>
        <span class="work-pager-slot is-next">${nextLink}</span>
      </nav>

      <figure class="work-frame">
        <picture>${avif ? `\n          <source type="image/avif" srcset="${escapeHtml(avif)}" sizes="${WORK_SIZES}" />` : ""}${webp ? `\n          <source type="image/webp" srcset="${escapeHtml(webp)}" sizes="${WORK_SIZES}" />` : ""}
          <img src="${escapeHtml(workPath(share.url))}" alt="${escapeHtml(bracketed)}"${sizeAttrs} decoding="async" fetchpriority="high" />
        </picture>
      </figure>

      <div class="work-label">
        <h1 class="work-title">${escapeHtml(bracketed)}</h1>${
          caption
            ? `\n        <p class="work-caption">${escapeHtml(caption)}</p>`
            : ""
        }
        <p class="work-meta">${dateLine}<span class="work-wall">${escapeHtml(
          wallNumber(index)
        )}</span></p>
        <a class="btn btn-outline work-enter" href="${ROOT_PREFIX}#p=${encodeURIComponent(
          photo.file || photo.src
        )}">进入观画室</a>
      </div>
    </article>
  </main>

  <footer class="footer">
    <div class="footer-inner">
      <div class="footer-brand">
        <p class="footer-museum">${escapeHtml(SITE_NAME)}</p>
      </div>
      <p class="footer-copy">© 2026 ${escapeHtml(SITE_NAME)}</p>
    </div>
  </footer>
</body>
</html>
`);
}

/* ────────────────────────── sitemap ────────────────────────── */

/**
 * sitemap 渲染。条目可选 `image`（Google 图片扩展）：sitemap 协议本身只描述页面，
 * 图片站的天然流量入口是图片搜索 —— 不写扩展，抓取器得先爬完每个页面才能发现图。
 * @param {{entries:{loc:string,lastmod?:string,changefreq?:string,priority?:string,image?:string}[]}} args
 */
export function renderSitemap({ entries = [] }) {
  // 图片命名空间只在真有 image 条目时输出，且恰好一次 —— 空命名空间是合法但无意义的噪音
  const hasImage = entries.some((entry) => entry.image);
  const lines = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    hasImage
      ? '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">'
      : '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
  ];
  for (const entry of entries) {
    lines.push("  <url>");
    lines.push(`    <loc>${escapeXml(entry.loc)}</loc>`);
    if (entry.lastmod) lines.push(`    <lastmod>${escapeXml(entry.lastmod)}</lastmod>`);
    if (entry.changefreq) lines.push(`    <changefreq>${escapeXml(entry.changefreq)}</changefreq>`);
    if (entry.priority) lines.push(`    <priority>${escapeXml(entry.priority)}</priority>`);
    if (entry.image) {
      lines.push("    <image:image>");
      lines.push(`      <image:loc>${escapeXml(entry.image)}</image:loc>`);
      lines.push("    </image:image>");
    }
    lines.push("  </url>");
  }
  lines.push("</urlset>", "");
  return lines.join("\n");
}

/* ────────────────────────── 装配 ────────────────────────── */

/**
 * 从 manifest + meta 装配全部产物（纯函数：不碰文件系统，便于单测）。
 * @param {{manifest:object, meta?:object, siteUrl?:string, total?:number}} args
 */
export function buildWorkPages({ manifest, meta = {}, siteUrl = SITE_URL }) {
  const photos = manifest?.photos || [];
  if (!photos.length) {
    throw new Error("gen-work-pages: manifest 里没有照片，展签页无从生成");
  }
  const slugs = resolveSlugs(manifest, meta);
  const pages = photos.map((photo, index) => ({
    slug: slugs[index],
    index,
    html: renderWorkPage({
      photo,
      index,
      total: photos.length,
      slug: slugs[index],
      prevSlug: index > 0 ? slugs[index - 1] : null,
      nextSlug: index < photos.length - 1 ? slugs[index + 1] : null,
      siteUrl,
    }),
  }));
  const entries = [
    // 主页条目不带 image 扩展：assets/og.jpg 是站点分享卡不是馆藏作品，
    // 喂给图片搜索反而会把「展厅一角」当成一件作品。
    { loc: siteUrl, changefreq: "weekly", priority: "1.0" },
    ...photos.map((photo, index) => ({
      loc: absoluteUrl(`p/${slugs[index]}/`, siteUrl),
      lastmod: photo.date || "",
      // 与逐图页 og:image / JSON-LD contentUrl 同一取值机器（shareImageInfo，
      // 现存最大派生图，绝不母版）：同一件作品在抓图器眼里全站同值。
      image: absoluteUrl(shareImage(photo), siteUrl),
    })),
  ];
  return { pages, sitemap: renderSitemap({ entries }) };
}

/* ────────────────────────── 主页结构化数据（S-2） ────────────────────────── */

/** 源码 index.html 里的占位符（ImageGallery 的 image 数组）。**恰好一次**纪律：
 *  多于一处或消失都会让构建报错 —— 静默的坏法是「注入到了别的地方」或「没注入，
 *  线上富结果素材整个缺失」，两者页面都完全正常、没有任何用例会红。 */
const HOME_IMAGE_SLOT = '"image": []';

/**
 * 主页 ImageGallery 的 `image` 数组：与逐图页同一套取值机器（shareImageInfo /
 * plainTitle / captionText 都只有一份实现），同一件作品在全站被抓图器与结构化
 * 数据描述为同一张图、同一个名字。
 *
 * `contentUrl` 取现存最大派生图（与逐图页 og:image 同源）：**绝不回落母版** ——
 * 母版不在产物里（P-1），指向它就是线上 404，且富结果校验器会记成抓取失败。
 */
export function buildHomeImages({ manifest, meta = {}, siteUrl = SITE_URL }) {
  const photos = manifest?.photos || [];
  const slugs = resolveSlugs(manifest, meta);
  return photos.map((photo, index) => {
    const share = shareImageInfo(photo);
    const node = {
      "@type": "ImageObject",
      name: plainTitle(photo, index),
      // 逐图展签页：深链 #p= 是哈希，抓取器看不见；每项都必须有自己的静态落点
      url: absoluteUrl(`p/${slugs[index]}/`, siteUrl),
      contentUrl: absoluteUrl(share.url, siteUrl),
    };
    const caption = captionText(photo);
    if (caption) node.description = caption;
    if (photo?.date) node.datePublished = photo.date;
    return node;
  });
}

/**
 * 把数组嵌进主页占位符：`"image": []` → `"image": [ … ]`。
 *
 * 续行补 4 空格前缀，让 JSON-LD 在源码的 4 空格缩进层级里保持整齐（纯版面）。
 * 转义走 embedJsonLd（`<` → `\u003c`）：标题/说明里出现 `</script>` 时不会提前
 * 闭合数据块。替换用**函数形式** —— 字符串形式的替换会把内容里的 `$&` 当反向引用。
 */
export function injectHomeImageArray(html, items) {
  const source = String(html ?? "");
  const count = source.split(HOME_IMAGE_SLOT).length - 1;
  if (count !== 1) {
    throw new Error(
      `gen-work-pages: 主页 JSON-LD 占位符 ${HOME_IMAGE_SLOT} 必须恰好出现一次` +
        `（实际 ${count} 处）——源码 index.html 的 ImageGallery 块里应恰有一处，见那里的注释。`
    );
  }
  const rendered = embedJsonLd(items)
    .split("\n")
    .map((line, index) => (index === 0 ? line : `    ${line}`))
    .join("\n");
  return source.replace(HOME_IMAGE_SLOT, () => `"image": ${rendered}`);
}

/** 读磁盘上的 manifest / meta（`meta.json` 缺失不致命：它只提供覆盖项） */
export function loadSources({
  manifestPath = path.join(ROOT, "photos", "manifest.json"),
  metaPath = path.join(ROOT, "photos", "meta.json"),
} = {}) {
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  const meta = fs.existsSync(metaPath) ? JSON.parse(fs.readFileSync(metaPath, "utf8")) : {};
  return { manifest, meta };
}

/**
 * 写入 `dist/p/<slug>/index.html` × N 与 `dist/sitemap.xml`。
 *
 * 不做 `rmSync(dist/p)`：本函数只在 `closeBundle` 里被调用，而 Vite 起手就清空过
 * outDir，`dist/p` 必然不存在。（顺带避开沙箱对递归删除的守卫。）
 */
export function writeWorkPages({
  distDir = path.join(ROOT, "dist"),
  siteUrl = SITE_URL,
  manifestPath,
  metaPath,
} = {}) {
  const { manifest, meta } = loadSources({ manifestPath, metaPath });
  const { pages, sitemap } = buildWorkPages({ manifest, meta, siteUrl });
  for (const page of pages) {
    const dir = path.join(distDir, "p", page.slug);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "index.html"), page.html, "utf8");
  }
  fs.writeFileSync(path.join(distDir, "sitemap.xml"), sitemap, "utf8");
  return { count: pages.length, slugs: pages.map((p) => p.slug) };
}

const isMain =
  process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;

if (isMain) {
  const { count } = writeWorkPages({ siteUrl: process.env.MILAN_SITE_URL || SITE_URL });
  console.log(`gen-work-pages: 生成 ${count} 个展签页 + sitemap.xml`);
}
