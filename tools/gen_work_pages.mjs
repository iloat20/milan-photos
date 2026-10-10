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
 *
 * 为什么单独成文件而不塞进 vite.config.js：本节所有规则都要能被 `node --test`
 * 直接覆盖（slug / 转义 / 版式 / sitemap），塞进配置里就只能靠 e2e 端到端撞。
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

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
 * 逐条解析 slug。`meta.json` 的 `[file].slug` 可选覆盖，缺省回退文件名 stem。
 *
 * 冲突抛出而非去重：重名会让一页静默消失（站点照常可访问）。
 * @returns {string[]} 与 manifest.photos 同序的 slug
 */
export function resolveSlugs(manifest, meta = {}) {
  const photos = manifest?.photos || [];
  const used = new Map();
  return photos.map((photo) => {
    const override = meta?.[photo.file]?.slug;
    const slug = normalizeSlug(override ?? slugSource(photo));
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

/** 分享卡 / JSON-LD 的 contentUrl：中图优先，无中图回落原图（与 lightboxSrc 同序） */
export function shareImage(photo) {
  return photo?.medium || photo?.src || "";
}

function shareSize(photo) {
  const medium = mediumSize(photo);
  if (medium && photo?.medium) return medium;
  if (photo?.width > 0 && photo?.height > 0) {
    return { width: photo.width, height: photo.height };
  }
  return null;
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
  const medium = mediumSize(photo);
  if (medium && photo?.mediumAvif) avif.push(`${workPath(photo.mediumAvif)} ${medium.width}w`);
  if (medium && photo?.medium) webp.push(`${workPath(photo.medium)} ${medium.width}w`);
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

function renderJsonLd({ photo, index, slug, siteUrl }) {
  const data = {
    "@context": "https://schema.org",
    "@type": "Photograph",
    name: plainTitle(photo, index),
    inLanguage: "zh-CN",
    url: absoluteUrl(`p/${slug}/`, siteUrl),
    contentUrl: absoluteUrl(shareImage(photo), siteUrl),
    image: absoluteUrl(photo.src, siteUrl),
    creator: { "@type": "Organization", name: SITE_NAME },
    isPartOf: { "@type": "ImageGallery", name: SITE_NAME, url: siteUrl },
  };
  const caption = captionText(photo);
  if (caption) data.description = caption;
  if (photo?.date) data.datePublished = photo.date;
  const size = mediumSize(photo);
  if (size) {
    data.width = { "@type": "QuantitativeValue", value: size.width, unitCode: "E39" };
    data.height = { "@type": "QuantitativeValue", value: size.height, unitCode: "E39" };
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
  const shareUrl = absoluteUrl(shareImage(photo), siteUrl);
  const size = shareSize(photo);
  const { avif, webp } = pictureSrcsets(photo);
  const dateText = formatDateCN(photo.date);
  const description = caption || `${bracketed}（${SITE_NAME}馆藏摄影作品）`;

  const sizeAttrs =
    photo?.width > 0 && photo?.height > 0
      ? ` width="${photo.width}" height="${photo.height}"`
      : "";
  const shareSizeMeta = size
    ? `\n  <meta property="og:image:width" content="${size.width}" />` +
      `\n  <meta property="og:image:height" content="${size.height}" />`
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

  return `<!DOCTYPE html>
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

  <!-- 分享预览：og:image 指向**本作**中图的绝对 URL（此前只有站点级卡片） -->
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
${renderJsonLd({ photo, index, slug, siteUrl })}
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
          <img src="${escapeHtml(workPath(photo.src))}" alt="${escapeHtml(bracketed)}"${sizeAttrs} decoding="async" fetchpriority="high" />
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
`;
}

/* ────────────────────────── sitemap ────────────────────────── */

/**
 * @param {{entries:{loc:string,lastmod?:string,changefreq?:string,priority?:string}[]}} args
 */
export function renderSitemap({ entries = [] }) {
  const lines = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
  ];
  for (const entry of entries) {
    lines.push("  <url>");
    lines.push(`    <loc>${escapeXml(entry.loc)}</loc>`);
    if (entry.lastmod) lines.push(`    <lastmod>${escapeXml(entry.lastmod)}</lastmod>`);
    if (entry.changefreq) lines.push(`    <changefreq>${escapeXml(entry.changefreq)}</changefreq>`);
    if (entry.priority) lines.push(`    <priority>${escapeXml(entry.priority)}</priority>`);
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
    { loc: siteUrl, changefreq: "weekly", priority: "1.0" },
    ...photos.map((photo, index) => ({
      loc: absoluteUrl(`p/${slugs[index]}/`, siteUrl),
      lastmod: photo.date || "",
    })),
  ];
  return { pages, sitemap: renderSitemap({ entries }) };
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
