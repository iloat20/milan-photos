/**
 * 中图宽度反推的契约测试 —— 钉住 `src/util.js` 的 MEDIUM_MAX_EDGE 与
 * `tools/photos_lib.py` 的 MEDIUM_MAX_EDGE 一致。
 *
 * 背景：manifest 不存中图像素尺寸，而序厅 <picture> 的响应式候选需要给中图标
 * 宽度（`${medium} ${w}w`），只能由原图宽高按长边上限反推。两边的上限一旦漂移，
 * hero srcset 就会标错宽度、浏览器选错候选——且**不会有任何报错**（静默画质/体积
 * 问题），所以这里读 python 源做契约断言，改一边忘另一边即红。
 *
 * 约定同 tests/unit/sw-assets.test.mjs：放在单测层，避免 e2e 才发现。
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  mediumWidth,
  heroSrcset,
  heroAvifSrcset,
  HERO_SIZES,
} from "../../src/util.js";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const PHOTOS_LIB = path.join(ROOT, "tools", "photos_lib.py");

function pythonMediumMaxEdge() {
  const src = fs.readFileSync(PHOTOS_LIB, "utf8");
  const m = src.match(/^\s*MEDIUM_MAX_EDGE\s*=\s*(\d+)/m);
  assert.ok(m, "photos_lib.py 里找不到 MEDIUM_MAX_EDGE = <整数>");
  return Number(m[1]);
}

test("mediumWidth：与 photos_lib.py 的 MEDIUM_MAX_EDGE 同步", () => {
  const edge = pythonMediumMaxEdge();
  // 超限图（才会生成 medium）：按 edge 反推缩放后的实际宽
  assert.equal(
    mediumWidth({ medium: "photos/medium/a.webp", width: 1600, height: 1200 }),
    Math.round((1600 * edge) / 1600)
  );
  // 竖图：长边是 height
  assert.equal(
    mediumWidth({ medium: "m", width: 1279, height: 1706 }),
    Math.round((1279 * edge) / 1706)
  );
  // 恰好等于上限（photos_lib 规则：≤上限不生成 medium，此分支实际不可达，
  // 返回原图宽是无害兜底）
  assert.equal(mediumWidth({ medium: "m", width: edge, height: edge }), edge);
});

test("mediumWidth：无中图 / 缺尺寸信息 → 0", () => {
  // 动图、小图都不生成 medium
  assert.equal(mediumWidth({ width: 1024, height: 901 }), 0);
  assert.equal(mediumWidth({ medium: "m" }), 0);
  assert.equal(mediumWidth({ medium: "m", width: 0, height: 100 }), 0);
  assert.equal(mediumWidth(null), 0);
  assert.equal(mediumWidth(undefined), 0);
});

test("heroSrcset：缩略图各档在前，中图（标实际宽）在后", () => {
  assert.equal(
    heroSrcset({
      thumbSrcset: "photos/thumbs/a-400.webp 300w, photos/thumbs/a.webp 900w",
      medium: "photos/medium/a.webp",
      width: 1279,
      height: 1706,
    }),
    "photos/thumbs/a-400.webp 300w, photos/thumbs/a.webp 900w, " +
      "photos/medium/a.webp 960w"
  );
});

test("heroSrcset：无 medium（小图/动图）只剩缩略图候选；全无 → 空串", () => {
  assert.equal(heroSrcset({ thumbSrcset: "t.webp 400w", width: 1024, height: 901 }), "t.webp 400w");
  assert.equal(heroSrcset({ thumbSrcset: "t.webp 400w", animated: true }), "t.webp 400w");
  // 1600×1200 的中图 = 长边 1600 → 缩到 1280 → 实际宽 1280
  assert.equal(heroSrcset({ medium: "m.webp", width: 1600, height: 1200 }), "m.webp 1280w");
  assert.equal(heroSrcset({}), "");
  assert.equal(heroSrcset(null), "");
});

test("heroAvifSrcset：与 heroSrcset 同构，只换 AVIF 变体", () => {
  assert.equal(
    heroAvifSrcset({
      thumbAvifSrcset: "photos/thumbs/a-400.avif 300w, photos/thumbs/a.avif 900w",
      mediumAvif: "photos/medium/a.avif",
      medium: "photos/medium/a.webp",
      width: 1279,
      height: 1706,
    }),
    "photos/thumbs/a-400.avif 300w, photos/thumbs/a.avif 900w, " +
      "photos/medium/a.avif 960w"
  );
  // 只有 mediumAvif 没有 thumbAvifSrcset 的退化形态（宽度靠 mediumAvif 自身反推）
  assert.equal(
    heroAvifSrcset({ mediumAvif: "m.avif", width: 1600, height: 1200 }),
    "m.avif 1280w"
  );
  // 有 WebP 中图但没有 AVIF 变体 → 空串（app.js 会回落到 img.srcset）
  assert.equal(heroAvifSrcset({ medium: "m.webp", width: 1600, height: 1200 }), "");
  assert.equal(heroAvifSrcset({}), "");
});

test("HERO_SIZES：与 styles.css 的 .hero-art img max-width 同值", () => {
  const css = fs.readFileSync(path.join(ROOT, "styles.css"), "utf8");
  assert.equal(HERO_SIZES, "min(86vw, 880px)");
  assert.match(css, /max-width:\s*min\(86vw,\s*880px\)/);
});
