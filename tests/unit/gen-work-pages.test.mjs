/**
 * 逐图展签页生成器的单元测试（`npm run test:unit`）。
 *
 * 为什么这些规则值得单测而不是只靠 e2e：展签页是**构建期产物**，一旦某条规则
 * 写错，症状通常是「线上某页少了/串了」，而页面本身照样 200、照样能读 ——
 * e2e 需要 18 页全查才碰得到，单测在毫秒级就能把规则本身钉死。
 *
 * 三层分工（与 sw-assets.test.mjs 同一思路）：
 *   - 本文件钉**规则**（slug / 转义 / 版式切片 / sitemap 形状），不依赖构建；
 *   - 真 manifest 的契约在这里也跑一遍（本仓 photos/manifest.json 就是输入）；
 *   - 「产物真的落在 dist/p/ 下、能 200、能被 SW 服务」交给 e2e。
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  SITE_URL,
  absoluteUrl,
  bracketedTitle,
  buildWorkPages,
  embedJsonLd,
  escapeHtml,
  escapeXml,
  formatDateCN,
  mediumSize,
  normalizeSlug,
  plainTitle,
  prefixSrcset,
  renderSitemap,
  resolveSlugs,
  slugSource,
} from "../../tools/gen_work_pages.mjs";

import { mediumWidth } from "../../src/util.js";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const MANIFEST = JSON.parse(
  fs.readFileSync(path.join(ROOT, "photos", "manifest.json"), "utf8")
);

/* ────────────────────────── slug ────────────────────────── */

test("normalizeSlug：小写、非字母数字折成单个连字符、去首尾连字符", () => {
  assert.equal(normalizeSlug("IMG20260817164949_01"), "img20260817164949-01");
  assert.equal(normalizeSlug("01-City  Rain"), "01-city-rain");
  assert.equal(normalizeSlug("--a--b--"), "a-b");
  assert.equal(normalizeSlug("01-city-rain"), "01-city-rain");
  assert.equal(normalizeSlug("   "), "");
  // 纯非 ASCII：归一后为空 —— 必须被 resolveSlugs 拦下，不能生成 /p// 这种路径
  assert.equal(normalizeSlug("雾湖"), "");
});

test("slugSource：文件名去扩展名（形态是 manifest 里的 photos/<file> 路径）", () => {
  assert.equal(slugSource({ file: "01-city-rain.jpg" }), "01-city-rain");
  assert.equal(slugSource({ file: "photos/IMG_0001.JPEG" }), "IMG_0001");
});

test("resolveSlugs：8 件策展作品沿用文件名，10 件无题作品也拿到合法 slug", () => {
  const slugs = resolveSlugs(MANIFEST, {});
  assert.equal(slugs.length, MANIFEST.photos.length);
  for (const slug of slugs) {
    assert.match(slug, /^[a-z0-9]+(?:-[a-z0-9]+)*$/, `非法 slug：${slug}`);
  }
  assert.equal(new Set(slugs).size, slugs.length, "slug 必须两两不同");
  assert.ok(slugs.includes("01-city-rain"));
  assert.ok(slugs.includes("img20260817164949-01"));
});

test("resolveSlugs：meta.json 的 slug 可覆盖文件名", () => {
  const manifest = { photos: [{ file: "IMG20260101010101.jpg" }] };
  const meta = { "IMG20260101010101.jpg": { slug: "Morning Mist" } };
  assert.deepEqual(resolveSlugs(manifest, meta), ["morning-mist"]);
});

test("resolveSlugs：冲突必须报错，不静默去重", () => {
  const manifest = { photos: [{ file: "A_1.jpg" }, { file: "a-1.jpg" }] };
  assert.throws(() => resolveSlugs(manifest, {}), /slug 冲突/);
});

test("resolveSlugs：归一后为空（纯中文名且无覆盖）必须报错", () => {
  const manifest = { photos: [{ file: "雾湖.jpg" }] };
  assert.throws(() => resolveSlugs(manifest, {}), /\[a-z0-9-\]/);
});

/* ────────────────────────── 转义 ────────────────────────── */

test("escapeHtml：五个字符都转，其余原样", () => {
  assert.equal(escapeHtml(`<a href="x">&'</a>`), "&lt;a href=&quot;x&quot;&gt;&amp;&#39;&lt;/a&gt;");
  assert.equal(escapeHtml("雨夜俯瞰"), "雨夜俯瞰");
  assert.equal(escapeHtml(null), "");
});

test("escapeXml：sitemap 的 loc/lastmod 用同一张实体表", () => {
  assert.equal(escapeXml("a&b<c"), "a&amp;b&lt;c");
});

test("embedJsonLd：`<` 转成 \\u003c，`</script>` 无法提前闭合 script", () => {
  const out = embedJsonLd({ description: "x</script><img src=x>" });
  assert.ok(!out.includes("</script>"), "JSON-LD 里不得残留可闭合标签的序列");
  assert.ok(out.includes("\\u003c/script"), "`<` 应被转义为 \\u003c");
  // 转义后仍是合法 JSON
  assert.deepEqual(JSON.parse(out), { description: "x</script><img src=x>" });
});

/* ────────────────────────── 展示取值 ────────────────────────── */

test("题名：<h1> 带书名号，<title>/og:title 不带", () => {
  const photo = { title: "雨夜俯瞰" };
  assert.equal(bracketedTitle(photo, 0), "《雨夜俯瞰》");
  assert.equal(plainTitle(photo, 0), "雨夜俯瞰");
  // 无题作品走《无题 · NN》降级，纯文本版去掉书名号但保留序号
  assert.equal(bracketedTitle({ title: "IMG_1234" }, 4), "《无题 · 05》");
  assert.equal(plainTitle({ title: "IMG_1234" }, 4), "无题 · 05");
});

test("formatDateCN：ISO → 中文日期；月日不补零；非法输入原样返回", () => {
  assert.equal(formatDateCN("2026-09-22"), "2026年9月22日");
  assert.equal(formatDateCN("2026-10-03"), "2026年10月3日");
  assert.equal(formatDateCN(""), "");
  assert.equal(formatDateCN(null), "");
  assert.equal(formatDateCN("2026/09/22"), "2026/09/22");
});

test("mediumSize：有中图时按长边 1280 反推；无中图返回 null", () => {
  const portrait = { width: 1536, height: 2048, medium: "photos/medium/a.webp" };
  assert.deepEqual(mediumSize(portrait), { width: 960, height: 1280 });

  const small = { width: 1024, height: 901, src: "photos/a.jpg" };
  assert.equal(mediumSize(small), null, "长边 ≤1280 的照片没有中图产物");
  // 与 util.mediumWidth 同源：无 medium 字段时它同样返回 0（"没有中图"的同一判据）
  assert.equal(mediumWidth(small), 0);
});

test("prefixSrcset：逐候选加 ../../ 前缀并保留宽度描述符", () => {
  const out = prefixSrcset("photos/thumbs/a-400.webp 400w, photos/thumbs/a.webp 900w");
  assert.equal(
    out,
    "../../photos/thumbs/a-400.webp 400w, ../../photos/thumbs/a.webp 900w"
  );
  assert.equal(prefixSrcset(""), "");
});

test("absoluteUrl：站点根相对路径解析为绝对 URL（不做前缀，避免重复）", () => {
  assert.equal(
    absoluteUrl("photos/a.jpg", SITE_URL),
    "https://iloat20.github.io/milan-photos/photos/a.jpg"
  );
  assert.equal(
    absoluteUrl("p/01-city-rain/", SITE_URL),
    "https://iloat20.github.io/milan-photos/p/01-city-rain/"
  );
});

/* ────────────────────────── 装配 ────────────────────────── */

function syntheticManifest() {
  return {
    photos: [
      { file: "IMG20260101000001.jpg", title: "IMG20260101000001", src: "photos/IMG20260101000001.jpg", date: "2026-01-01", width: 1000, height: 800 },
      { file: "02-second.jpg", title: "第二件", caption: "含 & 与 <em> 的说明", src: "photos/02-second.jpg", date: "2026-02-02", width: 2000, height: 1500, medium: "photos/medium/02-second.webp", mediumAvif: "photos/medium/02-second.avif", thumbSrcset: "photos/thumbs/02-second-400.webp 400w", thumbAvifSrcset: "photos/thumbs/02-second-400.avif 400w" },
      { file: "03-third.jpg", title: "03 third", src: "photos/03-third.jpg", date: "2026-03-03", width: 900, height: 1200 },
    ],
  };
}

test("buildWorkPages：页数与 manifest 同序，首尾 pager 不绕环", () => {
  const { pages, sitemap } = buildWorkPages({ manifest: syntheticManifest() });
  assert.equal(pages.length, 3);
  assert.deepEqual(pages.map((p) => p.slug), ["img20260101000001", "02-second", "03-third"]);

  // 首件：无上一件、有下一件
  assert.match(pages[0].html, /is-disabled[^>]*>← 上一件/);
  assert.match(pages[0].html, /href="\.\/?\.\.\/02-second\/"|href="\.\.\/02-second\/"/);
  // 末件：有上一件、无下一件
  assert.match(pages[2].html, /href="\.\.\/02-second\/" rel="prev"/);
  assert.match(pages[2].html, /is-disabled[^>]*>下一件 →/);
  assert.ok(!/rel="next"/.test(pages[2].html), "末件不得有 rel=next（绕环即断链判据失效）");

  // 中间件：两侧都有
  assert.match(pages[1].html, /rel="prev"/);
  assert.match(pages[1].html, /rel="next"/);

  assert.ok(sitemap.includes("<loc>https://iloat20.github.io/milan-photos/</loc>"));
  assert.ok(sitemap.includes("<loc>https://iloat20.github.io/milan-photos/p/03-third/</loc>"));
});

test("buildWorkPages：prev/next 链是一条无环的完整路径", () => {
  const { pages } = buildWorkPages({ manifest: syntheticManifest() });
  const nextOf = new Map();
  for (const page of pages) {
    const m = /href="\.\.\/([^"/]+)\/" rel="next"/.exec(page.html);
    if (m) nextOf.set(page.slug, m[1]);
  }
  const visited = new Set();
  let cursor = pages[0].slug;
  while (cursor !== undefined) {
    assert.ok(!visited.has(cursor), `出现环：${cursor}`);
    visited.add(cursor);
    cursor = nextOf.get(cursor);
  }
  assert.equal(visited.size, pages.length, "从首件应走遍全部页");
});

test("buildWorkPages：标题与说明含 & / \" / < 时不破坏结构", () => {
  const manifest = {
    photos: [
      {
        file: "x.jpg",
        title: `A & B "C" <script>alert(1)</script>`,
        caption: `<b>粗体</b> & "引号"`,
        src: "photos/x.jpg",
        date: "2026-01-01",
        width: 10,
        height: 10,
      },
    ],
  };
  const { pages } = buildWorkPages({ manifest });
  const html = pages[0].html;

  // 正文里不得出现任何未转义的用户可控标签
  assert.ok(!/<script>alert\(1\)<\/script>/.test(html), "标题里的 script 必须被转义");
  assert.ok(html.includes("&lt;script&gt;"), "`<` 应转义为 &lt;");
  assert.ok(!html.includes(`<b>粗体</b>`), "说明里的标签必须被转义");
  assert.ok(html.includes("&quot;引号&quot;"));
  assert.ok(html.includes("A &amp; B"), "裸 & 必须转义");
  // 页面自己那个 JSON-LD script 仍然完好、且能被解析
  const ld = /<script type="application\/ld\+json">([\s\S]*?)<\/script>/.exec(html);
  assert.ok(ld, "JSON-LD 块应存在");
  assert.equal(JSON.parse(ld[1]).name, `A & B "C" <script>alert(1)</script>`);
});

test("buildWorkPages：空 manifest 直接报错（不生成空站点）", () => {
  assert.throws(() => buildWorkPages({ manifest: { photos: [] } }), /没有照片/);
});

test("renderSitemap：条目顺序即输入顺序，lastmod 只出现在有值的条目", () => {
  const xml = renderSitemap({
    entries: [
      { loc: `${SITE_URL}`, changefreq: "weekly", priority: "1.0" },
      { loc: `${SITE_URL}p/a/`, lastmod: "2026-01-01" },
      { loc: `${SITE_URL}p/b/`, lastmod: "" },
    ],
  });
  assert.equal((xml.match(/<loc>/g) || []).length, 3);
  assert.equal((xml.match(/<lastmod>/g) || []).length, 1);
  assert.ok(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>'));
  assert.ok(xml.endsWith("</urlset>\n"));
});

/* ────────────────────────── 真 manifest 契约 ────────────────────────── */

test("真 manifest：18 页、slug 唯一、标题两两不同、canonical 自指", () => {
  const { pages, sitemap } = buildWorkPages({ manifest: MANIFEST });
  assert.equal(pages.length, MANIFEST.photos.length);

  const titles = new Set();
  for (const page of pages) {
    const canonical = /<link rel="canonical" href="([^"]+)"/.exec(page.html);
    assert.ok(canonical, `${page.slug} 缺 canonical`);
    assert.equal(canonical[1], `${SITE_URL}p/${page.slug}/`);
    const title = /<title>([^<]+)<\/title>/.exec(page.html);
    assert.ok(title, `${page.slug} 缺 <title>`);
    titles.add(title[1]);
  }
  assert.equal(titles.size, pages.length, "标题两两不同（否则 SERP 里无法区分）");

  // sitemap = 主页 1 条 + 逐图 N 条，且 loc 与目录一一对应
  const locs = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
  assert.equal(locs.length, pages.length + 1);
  for (const page of pages) {
    assert.ok(locs.includes(`${SITE_URL}p/${page.slug}/`), `sitemap 缺 ${page.slug}`);
  }
});
