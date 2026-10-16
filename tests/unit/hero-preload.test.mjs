/**
 * 序厅预载构建期注入（tools/hero-preload.mjs）的单元测试。
 *
 * 为什么值得单测：预载错了**不会报错** —— 标签没了只是 LCP 退回去（构建成功、
 * 页面正常），href/候选串错了只是白下一次图（体积翻倍但页面看不出）。e2e 在
 * 产物上端到端撞，这里把规则本身钉死（指针回落 / 格式判定 / href 次序 / 占位纪律）。
 */
import test from "node:test";
import assert from "node:assert/strict";

import { heroPreloadTag, injectHeroPreload } from "../../tools/hero-preload.mjs";
import { HERO_SIZES } from "../../src/util.js";

function syntheticManifest() {
  return {
    hero: "a.jpg",
    photos: [
      {
        file: "a.jpg",
        src: "photos/a.jpg",
        medium: "photos/medium/a.webp",
        thumb: "photos/thumbs/a.webp",
        heroSrcset: "photos/thumbs/a-400.webp 300w, photos/thumbs/a.webp 900w",
        heroAvifSrcset: "photos/thumbs/a-400.avif 300w, photos/thumbs/a.avif 900w",
      },
      {
        file: "b.jpg",
        src: "photos/b.jpg",
        medium: "photos/medium/b.webp",
        heroSrcset: "photos/thumbs/b.webp 900w",
      },
    ],
  };
}

test("heroPreloadTag：AVIF 优先、href 走 medium、imagesizes 与 HERO_SIZES 同值", () => {
  const tag = heroPreloadTag(syntheticManifest());
  assert.match(tag, /^<link rel="preload" as="image"/);
  assert.ok(tag.includes('href="photos/medium/a.webp"'), "href 回退次序：medium → thumb → src");
  assert.ok(
    tag.includes('imagesrcset="photos/thumbs/a-400.avif 300w, photos/thumbs/a.avif 900w"'),
    "有 AVIF 候选串时必须用它（与 <picture> 的 source 同串，选中结果一致）"
  );
  // imagesizes 只能来自 HERO_SIZES —— 手抄一份会在调版式时静默漂移
  assert.ok(tag.includes(`imagesizes="${HERO_SIZES}"`));
  assert.ok(tag.includes('type="image/avif"'));
  assert.ok(tag.includes('fetchpriority="high"'));
});

test("heroPreloadTag：无 AVIF 候选回落 WebP；hero 指针缺失时取陈列首张", () => {
  const m = syntheticManifest();
  delete m.hero;
  delete m.photos[0].heroAvifSrcset;
  const tag = heroPreloadTag(m);
  assert.ok(tag.includes('type="image/webp"'));
  assert.ok(tag.includes("a-400.webp"), "无指针时回落陈列首张（与 selectHeroPhotos 无精选同序）");
});

test("heroPreloadTag：动图/无中图条目 —— href 落到 thumb（与 heroSrc 的序一致）", () => {
  const m = syntheticManifest();
  delete m.photos[0].medium;
  const tag = heroPreloadTag(m);
  assert.ok(tag.includes('href="photos/thumbs/a.webp"'));
});

test("heroPreloadTag：降级清单（无候选串）返回空串 —— 交给 app.js 的 preloadImage", () => {
  const m = syntheticManifest();
  delete m.photos[0].heroAvifSrcset;
  delete m.photos[0].heroSrcset;
  assert.equal(heroPreloadTag(m), "");
  assert.equal(heroPreloadTag({ photos: [] }), "");
  assert.equal(heroPreloadTag(undefined), "");
});

test("injectHeroPreload：占位注释恰好一处；空串注入也须清掉占位（改留说明注释）", () => {
  const html = '<head>\n  <!--HERO_PRELOAD-->\n</head>';
  const out = injectHeroPreload(html, '<link rel="preload" as="image" href="x" />');
  assert.ok(out.includes('<link rel="preload" as="image" href="x" />'));
  assert.ok(!out.includes("HERO_PRELOAD"), "占位符不得残留（残留说明注入目标漂了）");

  const degraded = injectHeroPreload(html, "");
  assert.ok(!degraded.includes("HERO_PRELOAD"));
  assert.ok(degraded.includes("preloadImage"), "降级时留一条指回兜底的说明注释");

  assert.throws(() => injectHeroPreload("<head></head>"), /缺少 .*HERO_PRELOAD/);
  assert.throws(
    () => injectHeroPreload("<!--HERO_PRELOAD--><!--HERO_PRELOAD-->"),
    /多处/
  );
});

test("injectHeroPreload：属性值转义（& 等）不破坏标签", () => {
  const tag = heroPreloadTag({
    hero: "x.jpg",
    photos: [
      {
        file: "x.jpg",
        src: "photos/x.jpg",
        thumb: "photos/thumbs/x.webp?a=1&b=2",
        heroSrcset: "photos/thumbs/x-400.webp?a=1&b=2 300w",
      },
    ],
  });
  assert.ok(tag.includes("a=1&amp;b=2"), "& 必须转义（srcset/URL 里的裸 & 会破坏属性）");
  const out = injectHeroPreload("<i><!--HERO_PRELOAD--></i>", tag);
  assert.ok(out.startsWith("<i><link "));
});
