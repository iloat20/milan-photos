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
  buildHomeImages,
  buildWorkPages,
  embedJsonLd,
  escapeHtml,
  escapeXml,
  formatDateCN,
  injectHomeImageArray,
  mediumSize,
  normalizeSlug,
  pictureSrcsets,
  plainTitle,
  prefixSrcset,
  renderSitemap,
  shareImage,
  shareImageInfo,
  resolveSlugs,
  slugSource,
} from "../../tools/gen_work_pages.mjs";

import { referencedPhotoPaths } from "../../tools/photo-assets.mjs";

import { mediumWidth } from "../../src/util.js";
import { inlineScriptHashes } from "../../tools/csp.mjs";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const MANIFEST = JSON.parse(
  fs.readFileSync(path.join(ROOT, "photos", "manifest.json"), "utf8")
);
/* 策展源：title / slug / caption / date 都写在这里，`npm run sync` 用它重建 manifest
   （slug 自 F-4 起也进 manifest —— sync 的产物是唯一归一来源，生成器以它为准） */
const META = JSON.parse(
  fs.readFileSync(path.join(ROOT, "photos", "meta.json"), "utf8")
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

test("resolveSlugs：清单无 slug（老/降级清单）时回退 meta 覆盖 > 文件名 stem", () => {
  // 合成一份**无 slug** 的清单：真清单自 F-4 起带 slug，会走「manifest 优先」路径
  const manifest = {
    photos: [{ file: "01-city-rain.jpg" }, { file: "IMG20260817164949_01.jpg" }],
  };
  assert.deepEqual(resolveSlugs(manifest, {}), ["01-city-rain", "img20260817164949-01"]);
  assert.deepEqual(
    resolveSlugs(manifest, { "IMG20260817164949_01.jpg": { slug: "Rou Guang" } }),
    ["01-city-rain", "rou-guang"]
  );
});

test("resolveSlugs：meta.json 的 slug 可覆盖文件名（清单无 slug 的回退路径）", () => {
  const manifest = { photos: [{ file: "IMG20260101010101.jpg" }] };
  const meta = { "IMG20260101010101.jpg": { slug: "Morning Mist" } };
  assert.deepEqual(resolveSlugs(manifest, meta), ["morning-mist"]);
});

test("resolveSlugs：清单自带 slug 优先（sync 的产物是唯一归一来源）", () => {
  const manifest = { photos: [{ file: "IMG20260101010101.jpg", slug: "rou-guang" }] };
  // meta 后来改了 slug 但还没 sync：以清单为准 —— 页面与分享按钮一起保持旧值（自洽），
  // 而不是一边新 URL、一边旧 URL 地静默分叉
  const meta = { "IMG20260101010101.jpg": { slug: "Another Name" } };
  assert.deepEqual(resolveSlugs(manifest, meta), ["rou-guang"]);
  // 清单里混进非法 slug 照样报错（不静默归一替它收拾）
  assert.throws(
    () => resolveSlugs({ photos: [{ file: "a.jpg", slug: "Bad Slug" }] }),
    /\[a-z0-9-\]/
  );
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

test("pictureSrcsets：优先用 mediumSrcset（含 2048 档），老清单才回落 medium 标量", () => {
  // 有 mediumSrcset（P-2 后的清单）：整体纳入，最后一个候选是 -2048
  const rich = pictureSrcsets({
    width: 2560,
    height: 1920,
    thumbSrcset: "photos/thumbs/a-400.webp 400w, photos/thumbs/a.webp 1200w",
    thumbAvifSrcset: "photos/thumbs/a-400.avif 400w, photos/thumbs/a.avif 1200w",
    medium: "photos/medium/a.webp",
    mediumAvif: "photos/medium/a.avif",
    mediumSrcset: "photos/medium/a.webp 1280w, photos/medium/a-2048.webp 2048w",
    mediumAvifSrcset: "photos/medium/a.avif 1280w, photos/medium/a-2048.avif 2048w",
  });
  assert.equal(
    rich.webp,
    "../../photos/thumbs/a-400.webp 400w, ../../photos/thumbs/a.webp 1200w, " +
      "../../photos/medium/a.webp 1280w, ../../photos/medium/a-2048.webp 2048w"
  );
  assert.equal(
    rich.avif,
    "../../photos/thumbs/a-400.avif 400w, ../../photos/thumbs/a.avif 1200w, " +
      "../../photos/medium/a.avif 1280w, ../../photos/medium/a-2048.avif 2048w"
  );
  // 标量与 mediumSrcset 同时在场时**不得**重复出候选（同一个 medium 只出现一次）
  assert.equal((rich.webp.match(/medium\/a\.webp/g) || []).length, 1);
  assert.equal((rich.avif.match(/medium\/a\.avif/g) || []).length, 1);

  // 老/降级清单：只有标量 medium + 反推宽度，行为与 P-2 前一致（逐字节）
  const legacy = pictureSrcsets({
    width: 1536,
    height: 2048,
    thumbSrcset: "photos/thumbs/a-400.webp 300w",
    medium: "photos/medium/a.webp",
    mediumAvif: "photos/medium/a.avif",
  });
  assert.equal(
    legacy.webp,
    "../../photos/thumbs/a-400.webp 300w, ../../photos/medium/a.webp 960w"
  );
  assert.equal(legacy.avif, "../../photos/medium/a.avif 960w");

  // 无中图的小图：只剩缩略图候选
  assert.deepEqual(pictureSrcsets({ width: 1024, height: 901, thumbSrcset: "t.webp 400w" }), {
    avif: "",
    webp: "../../t.webp 400w",
  });
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

test("renderSitemap：image 条目输出图片扩展且命名空间恰好一次；无 image 时无命名空间", () => {
  const withImage = renderSitemap({
    entries: [
      { loc: `${SITE_URL}p/a/`, image: `${SITE_URL}photos/medium/a.webp` },
      { loc: `${SITE_URL}p/b/` },
    ],
  });
  assert.equal((withImage.match(/xmlns:image=/g) || []).length, 1);
  assert.equal((withImage.match(/<image:image>/g) || []).length, 1);
  assert.ok(withImage.includes(`<image:loc>${SITE_URL}photos/medium/a.webp</image:loc>`));
  // 主页条目（无 image）不得带空 <image:image>
  const noImage = renderSitemap({ entries: [{ loc: `${SITE_URL}` }] });
  assert.ok(!noImage.includes("image:"), "无 image 条目时不得出现图片命名空间");
});

test("renderSitemap：image:loc 走与 loc 同一张转义实体表", () => {
  const xml = renderSitemap({
    entries: [{ loc: `${SITE_URL}p/x/`, image: `${SITE_URL}photos/a<b>&c.webp` }],
  });
  assert.ok(
    xml.includes(`<image:loc>${SITE_URL}photos/a&lt;b&gt;&amp;c.webp</image:loc>`)
  );
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

test("真 manifest：sitemap 图片扩展与逐图页 og:image 同源，全指派生图（零 .jpg 母版）", () => {
  const { pages, sitemap } = buildWorkPages({ manifest: MANIFEST });
  const images = [...sitemap.matchAll(/<image:loc>([^<]+)<\/image:loc>/g)].map((m) => m[1]);
  assert.equal(images.length, pages.length, "每件作品恰好一条 image:loc");
  for (const u of images) {
    assert.ok(
      u.startsWith(SITE_URL) && u.includes("/photos/"),
      `须是站点绝对 URL 且指向 photos/ 派生图：${u}`
    );
    // P-1 后母版（.jpg）不在产物里，指向即线上 404 —— 图片搜索会拿到死链
    assert.ok(!/\.jpe?g$/i.test(u), `母版 .jpg 不得进 sitemap：${u}`);
  }
});

test("真 meta.json：18 件都定了标题，地址里不再有数码导出名", () => {
  /* 这一条钉的是「内容补齐」这件事本身：标题一旦漏写，清单会退回《无题 · NN》，
     slug 也会退回文件名 stem（img2026… / mmexport…），症状是 SERP 里一列
     「无题 · 05」和一堆不可读 URL —— 页面照样 200，只有这里拦得住。 */
  for (const photo of MANIFEST.photos) {
    const info = META[photo.file];
    assert.ok(info, `meta.json 缺 ${photo.file} 的条目`);
    assert.ok(
      String(info.title || "").trim(),
      `${photo.file} 没写 title —— 清单里会退回《无题 · NN》`
    );
  }

  const slugs = resolveSlugs(MANIFEST, META);
  for (const slug of slugs) {
    assert.doesNotMatch(
      slug,
      /^(?:img|dsc|pxl|mmexport|photo|image)\d/,
      `slug "${slug}" 仍是文件名式地址（该在 meta.json 里给它写 slug）`
    );
  }
  assert.equal(new Set(slugs).size, slugs.length, "slug 必须两两不同");

  // 显式覆盖确实被采用，而不是「恰好文件名也可读」
  for (const [file, info] of Object.entries(META)) {
    if (info.slug) {
      assert.ok(slugs.includes(info.slug), `${file} 的 slug "${info.slug}" 没被采用`);
    }
  }
});

test("真清单一致性：manifest.slug 与「meta 覆盖 ?? 文件名 stem」的归一结果逐条相等", () => {
  /* 跨语言防漂移：Python（photos_lib.normalize_slug，sync 时写入 manifest）与 JS
     （gen_work_pages.normalizeSlug，回退路径与生成器校验用）是同一规则的两份实现。
     不一致时不会立即报错（页面与分享按钮都读 manifest），但下次 sync 会悄悄换 URL ——
     这里在真数据上钉住。红了就跑 `npm run sync` 重生成清单。 */
  for (const photo of MANIFEST.photos) {
    const override = META[photo.file]?.slug;
    const expected = normalizeSlug(override ?? slugSource(photo));
    assert.equal(
      photo.slug,
      expected,
      `${photo.file}：manifest.slug="${photo.slug}" 与归一结果 "${expected}" 不一致（跑 npm run sync）`
    );
  }
});

/* ───────────────────── 分享图与产物清单（P-1） ───────────────────── */

test("shareImageInfo：取现存最大的派生图，尺寸跟着选中那一档走", () => {
  const base = { width: 2560, height: 1920, src: "photos/a.jpg" };

  // mediumSrcset 最大档优先（-2048）
  assert.deepEqual(
    shareImageInfo({
      ...base,
      medium: "photos/medium/a.webp",
      mediumSrcset: "photos/medium/a.webp 1280w, photos/medium/a-2048.webp 2048w",
      thumbSrcset: "photos/thumbs/a.webp 1920w",
    }),
    { url: "photos/medium/a-2048.webp", width: 2048, height: 1536 }
  );

  // 无 -2048 档 → medium 标量（1280），不是 thumb
  assert.deepEqual(
    shareImageInfo({
      ...base,
      medium: "photos/medium/a.webp",
      mediumSrcset: "photos/medium/a.webp 1280w",
      thumbSrcset: "photos/thumbs/a.webp 1920w",
    }),
    { url: "photos/medium/a.webp", width: 1280, height: 960 }
  );

  // 无中图 → thumb 最大档
  assert.equal(
    shareImage({
      width: 1024,
      height: 901,
      src: "photos/a.jpg",
      thumbSrcset: "photos/thumbs/a-400.webp 400w, photos/thumbs/a.webp 1024w",
    }),
    "photos/thumbs/a.webp"
  );

  // 竖图的 -2048 档实际像素宽是 1536（按长边反推），不能虚报 2048
  assert.deepEqual(
    shareImageInfo({
      width: 1920,
      height: 2560,
      src: "photos/a.jpg",
      mediumSrcset: "photos/medium/a.webp 960w, photos/medium/a-2048.webp 1536w",
    }),
    { url: "photos/medium/a-2048.webp", width: 1536, height: 2048 }
  );
});

test("shareImage：绝不回落母版 —— 无任何派生图时才用 src", () => {
  // 「无 thumb」正是 needsMasterSource() 判真的条件，那张母版会被保留在产物里，
  // 所以这条兜底与 P-1 的保留规则自洽（不是「指向不存在的文件」）
  assert.equal(shareImage({ src: "photos/a.jpg", width: 800, height: 600 }), "photos/a.jpg");
});

test("真清单契约：逐图页引用的每个 photos/ 路径都在产物清单里", () => {
  /* 爬虫与 IM 抓图器只看 HTML、不执行 JS —— 逐图页里任何指向 photos/ 的 URL
     都必须是站上真实存在的文件。母版已移出产物（P-1），而这三处此前**全部**
     指向母版：og:image、JSON-LD 的 image、<picture> 的兜底 <img src>
     （前者由 shareImage 决定，后者此前写死 photo.src）。 */
  const { pages } = buildWorkPages({ manifest: MANIFEST, meta: META });
  const available = new Set(referencedPhotoPaths(MANIFEST.photos));
  // 相对引用（<img src> / srcset）与绝对 URL（og:image / JSON-LD）两种形状都要抓
  const REF_RE = /(?:\.\.\/\.\.\/|milan-photos\/)(photos\/[A-Za-z0-9._/-]+)/g;

  let total = 0;
  for (const page of pages) {
    const refs = [...page.html.matchAll(REF_RE)].map((m) => m[1]);
    assert.ok(refs.length > 0, `slug=${page.slug} 的页面里一个 photos/ 引用都没有`);
    for (const rel of refs) {
      total += 1;
      assert.ok(available.has(rel), `${page.slug} 引用了产物里没有的 ${rel}`);
      assert.doesNotMatch(
        rel,
        /\.(?:jpe?g|png)$/i,
        `${page.slug} 仍在引用母版 ${rel} —— 它不在产物里（P-1）`
      );
    }
  }
  assert.ok(total >= pages.length, `引用总数 ${total} 少于页数 —— 抽取逻辑可能失效`);
});

/* ────────────────────────── CSP（页面自带，不等插件） ────────────────────────── */

test("展签页自带 CSP：指令齐备，且声明的 hash 与页内脚本自洽", () => {
  /* 为什么不靠插件注入：workPagesPlugin 与 build-finalize 都挂在 `closeBundle`，
     而 Rollup 语义下同钩子是**并行**的（顺序无保证）—— 靠先后去覆盖 dist/p/**
     是撞运气。所以生成器必须自己带上，这条断言就是那份契约。 */
  const { pages } = buildWorkPages({ manifest: MANIFEST, meta: META });
  const html = pages[0].html;
  const meta = /<meta http-equiv="Content-Security-Policy" content="([^"]*)"/.exec(html);
  assert.ok(meta, "展签页必须自带 CSP meta");
  const csp = meta[1];
  assert.ok(csp.includes("script-src 'self' 'sha256-"), "script-src 必须列内联脚本 hash");
  assert.ok(csp.includes("default-src 'self'"));
  assert.ok(!csp.includes("unsafe-inline"));
  assert.ok(!csp.includes("unsafe-eval"));

  // 自洽：声明的 hash 集合必须**恰好等于**页内实际算出的集合（漏一个该页就坏）
  const declared = (csp.match(/'(sha256-[^']+)'/g) || [])
    .map((s) => s.slice(1, -1))
    .sort();
  const actual = inlineScriptHashes(html)
    .map((s) => s.hash)
    .sort();
  assert.deepEqual(declared, actual);
  // 反向自证：本页确有 2 个内联脚本（主题初值 + JSON-LD），不是「空集相等」
  assert.equal(actual.length, 2);

  // 每一页都要带（只查第一页会漏掉「循环里只给首行注入」这种错法）
  for (const page of pages) {
    assert.ok(
      page.html.includes("Content-Security-Policy"),
      `slug=${page.slug} 的展签页没带 CSP`
    );
  }
});

/* ────────────────────────── S-2 主页结构化数据 ────────────────────────── */

test("buildHomeImages：18 项与馆藏同序，逐项指派生图 + 逐图页，题名不带书名号", () => {
  const items = buildHomeImages({ manifest: MANIFEST, meta: META });
  assert.equal(items.length, MANIFEST.photos.length);
  const slugs = resolveSlugs(MANIFEST, META);
  items.forEach((item, index) => {
    const photo = MANIFEST.photos[index];
    assert.equal(item["@type"], "ImageObject");
    assert.equal(item.name, plainTitle(photo, index));
    assert.ok(!item.name.includes("《"));
    assert.equal(item.url, `${SITE_URL}p/${slugs[index]}/`);
    // contentUrl 与逐图页 og:image 同源（shareImage）——抓图器两处抓的是同一张
    assert.equal(item.contentUrl, absoluteUrl(shareImage(photo), SITE_URL));
    // 绝不指向母版：母版不在产物里（P-1），指向它就是线上 404
    assert.match(item.contentUrl, /\/photos\/(thumbs|medium)\//);
    assert.ok(item.description && item.description.length > 0);
    assert.match(item.datePublished, /^\d{4}-\d{2}-\d{2}$/);
  });
});

test("buildHomeImages：无 slug 清单回退 meta 覆盖（与逐图页同一条解析）", () => {
  const manifest = {
    photos: [
      {
        file: "IMG20260101010101.jpg",
        title: "甲",
        date: "2026-01-01",
        width: 100,
        height: 80,
        thumbSrcset: "photos/thumbs/x-400.webp 400w",
      },
    ],
  };
  const meta = { "IMG20260101010101.jpg": { slug: "Morning Mist" } };
  const items = buildHomeImages({ manifest, meta });
  assert.equal(items[0].url, `${SITE_URL}p/morning-mist/`);
});

test("injectHomeImageArray：占位符恰好一次才注入；二次注入 / 缺占位都报错", () => {
  const html = '<script type="application/ld+json">{\n    "image": []\n  }</script>';
  const out = injectHomeImageArray(html, [{ "@type": "ImageObject", name: "柔光" }]);
  assert.ok(out.includes('"image": ['));
  assert.ok(out.includes("柔光"));
  assert.ok(!out.includes('"image": []'));
  // 防二次注入：占位符这时已消失，再注必须报错（静默的坏法是替换成「数组里套数组」）
  assert.throws(() => injectHomeImageArray(out, []), /恰好/);
  assert.throws(() => injectHomeImageArray("<p>没有占位符</p>", []), /恰好/);
});

test("injectHomeImageArray：< 转义为 \\u003c，且注入结果是可解析的 JSON 数组", () => {
  const out = injectHomeImageArray('"image": []', [{ name: "a</script>b" }]);
  assert.ok(!out.includes("</script>"));
  assert.ok(out.includes("\\u003c"));
  const json = out.slice(out.indexOf("["), out.lastIndexOf("]") + 1);
  assert.deepEqual(JSON.parse(json), [{ name: "a</script>b" }]);
});
