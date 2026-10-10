/**
 * src/util.js 的单元测试 —— 用 Node 内置 test runner，**零新增依赖**
 * （`npm run test:unit`，即 `node --test tests/unit/`）。
 *
 * 这里只测「纯函数」，所以不需要浏览器、不需要起服务、毫秒级跑完。
 * 这也是 P2-2 拆分的第一份收益：这些函数此前埋在 app.js 的 IIFE 里，
 * 任何一行改动都只能靠 e2e 冒烟间接观察。
 *
 * 注意：本文件是 .mjs（强制 ESM），而 src/util.js 的 ESM 身份由
 * src/package.json 的 {"type":"module"} 声明 —— 仓库根 package.json
 * 必须保持无 type，否则 playwright.config.js 的 require 会失效。
 */
import test from "node:test";
import assert from "node:assert/strict";

import {
  pad,
  uid,
  safeDecode,
  looksLikeFileTitle,
  displayTitle,
  captionText,
  wallNumber,
  toLocalDate,
  ymKey,
  ymLabel,
  baseFileName,
  collectFilters,
  stripExt,
  safeFileName,
  heroSrc,
  lightboxSrc,
  lightboxAvifOrFallback,
} from "../../src/util.js";

test("pad：个位补零，两位以上原样", () => {
  assert.equal(pad(0), "00");
  assert.equal(pad(3), "03");
  assert.equal(pad(12), "12");
  assert.equal(pad(123), "123");
});

test("uid：形如 u<base36>+5 位随机后缀，且两次调用不重复", () => {
  const a = uid();
  const b = uid();
  assert.match(a, /^u[0-9a-z]{5,}$/);
  assert.notEqual(a, b);
});

test("safeDecode：正常解码；被改坏的百分号编码原样返回而不抛", () => {
  assert.equal(safeDecode("%E4%B8%AD"), "中");
  // 手工改坏 hash（如 `#p=%`）→ decodeURIComponent 抛 URIError，必须被吞掉
  assert.equal(safeDecode("%"), "%");
  assert.equal(safeDecode("plain"), "plain");
});

test("looksLikeFileTitle：相机名 / 数码导出名 / 空串都算「不是标题」", () => {
  for (const t of ["", "IMG_1234", "img20260916", "DSC0001", "PXL_2026", "mmexport1788447848472", "photo-1", "image2", "未命名-1"]) {
    assert.equal(looksLikeFileTitle(t), true, `${t} 应判为文件名`);
  }
  for (const t of ["千里江山图", "The Starry Night", "海边"]) {
    assert.equal(looksLikeFileTitle(t), false, `${t} 应判为真标题`);
  }
});

test("displayTitle：真标题加书名号，文件名式标题退化为《无题 · NN》", () => {
  assert.equal(displayTitle({ title: "千里江山图" }, 0), "《千里江山图》");
  // 退化分支用 index+1 补两位
  assert.equal(displayTitle({ title: "IMG_20260916" }, 4), "《无题 · 05》");
  assert.equal(displayTitle({ title: "" }, 0), "《无题 · 01》");
  assert.equal(displayTitle({}, 9), "《无题 · 10》");
  // 前后空白应被裁掉再判定
  assert.equal(displayTitle({ title: "  千里江山图  " }, 0), "《千里江山图》");
});

test("captionText：trim 后原样返回；空 / 纯空白 / 缺失一律空串（不降级成占位文案）", () => {
  assert.equal(captionText({ caption: "  雨珠把城市拆成散景。  " }), "雨珠把城市拆成散景。");
  assert.equal(captionText({ caption: "一束侧光，让植物变成雕塑。" }), "一束侧光，让植物变成雕塑。");
  // 与 title 不同：没写就是没有，不替作者编话
  assert.equal(captionText({ caption: "" }), "");
  assert.equal(captionText({ caption: "   \n\t " }), "");
  assert.equal(captionText({}), "");
  assert.equal(captionText({ caption: null }), "");
  assert.equal(captionText(null), "");
  assert.equal(captionText(undefined), "");
});

test("wallNumber：MIL · 三位零填充序号", () => {
  assert.equal(wallNumber(0), "MIL · 001");
  assert.equal(wallNumber(17), "MIL · 018");
  assert.equal(wallNumber(999), "MIL · 1000");
});

test("toLocalDate：本地时区 YYYY-MM-DD；非法输入返回空串", () => {
  // ⚠️ 必须用「本地构造」而非字符串：new Date("2026-09-26") 按 UTC 午夜解析，
  // 在西半球时区会回退到 9-25，测试会随运行机器漂移。
  assert.equal(toLocalDate(new Date(2026, 8, 26)), "2026-09-26");
  assert.equal(toLocalDate(new Date(2026, 0, 1)), "2026-01-01");
  assert.equal(toLocalDate("not a date"), "");
  assert.equal(toLocalDate(NaN), "");
});

test("ymKey：取 YYYY-MM；非字符串一律空串", () => {
  assert.equal(ymKey("2026-09-26"), "2026-09");
  assert.equal(ymKey("2026-09"), "2026-09");
  assert.equal(ymKey(""), "");
  assert.equal(ymKey(null), "");
  assert.equal(ymKey(undefined), "");
  assert.equal(ymKey(20260926), "");
});

test("ymLabel：YYYY-MM → 中文年月（月不补零）；残缺键原样返回", () => {
  assert.equal(ymLabel("2026-09"), "2026年9月");
  assert.equal(ymLabel("2026-12"), "2026年12月");
  assert.equal(ymLabel("2026"), "2026");
  assert.equal(ymLabel(""), "");
});

test("baseFileName：取路径最后一段；file 优先于 fileName", () => {
  assert.equal(baseFileName({ file: "photos/a.jpg" }), "a.jpg");
  assert.equal(baseFileName({ fileName: "b.png" }), "b.png");
  assert.equal(baseFileName({ file: "photos/a.jpg", fileName: "b.png" }), "a.jpg");
  assert.equal(baseFileName({}), "");
  assert.equal(baseFileName(null), "");
});

test("collectFilters：去重 + 倒序（新→旧）", () => {
  const list = [
    { date: "2026-09-01" },
    { date: "2026-07-20" },
    { date: "2026-09-26" },
    { date: "2026-08-05" },
    { date: "" },
    {},
  ];
  assert.deepEqual(collectFilters(list), ["2026-09", "2026-08", "2026-07"]);
  assert.deepEqual(collectFilters([]), []);
  // 无有效日期时返回空数组，而不是 [""]
  assert.deepEqual(collectFilters([{ date: "" }, {}]), []);
});

test("stripExt：去掉最后一个扩展名；无扩展名原样", () => {
  assert.equal(stripExt("a.jpg"), "a");
  assert.equal(stripExt("a.b.c"), "a.b");
  assert.equal(stripExt("noext"), "noext");
  // 以点结尾时 \.[^.]+$ 不匹配（点后无字符），保持原样
  assert.equal(stripExt("x."), "x.");
});

test("safeFileName：时间戳前缀 + 清掉非 \\w 字符（含 Date.now，只能按形状断言）", () => {
  const name = safeFileName({ name: "我的 照片.jpg" });
  assert.match(name, /^[0-9a-z]+-[^/\\]*\.jpg$/);
  assert.ok(!/[\s\u4e00-\u9fa5]/.test(name), `不该残留空格或中文：${name}`);
  // name 缺失 → base 直接退化为 "photo"（无扩展名）
  assert.match(safeFileName({}), /^[0-9a-z]+-photo$/);
  // 兜底串 "photo.jpg" 只在 base 被**清空**时才用得上（name 全是特殊字符）
  assert.match(safeFileName({ name: "###" }), /^[0-9a-z]+-photo\.jpg$/);
});

test("heroSrc：动图只用静态缩略图，避免首屏拉原文件", () => {
  assert.equal(heroSrc({ animated: true, thumb: "t", medium: "m", src: "s" }), "t");
  assert.equal(heroSrc({ medium: "m", thumb: "t", src: "s" }), "m");
  assert.equal(heroSrc({ thumb: "t", src: "s" }), "t");
  assert.equal(heroSrc({ src: "s" }), "s");
  assert.equal(heroSrc({}), "");
});

test("lightboxSrc：动图走原文件保证能播，其余优先中图", () => {
  assert.equal(lightboxSrc({ animated: true, medium: "m", src: "s" }), "s");
  assert.equal(lightboxSrc({ medium: "m", src: "s" }), "m");
  assert.equal(lightboxSrc({ src: "s" }), "s");
  assert.equal(lightboxSrc({}), "");
});

test("lightboxAvifOrFallback：AVIF 优先，动图仍走原文件", () => {
  assert.equal(lightboxAvifOrFallback({ mediumAvif: "a.avif", medium: "m" }), "a.avif");
  assert.equal(lightboxAvifOrFallback({ medium: "m" }), "m");
  // 动图即使有 AVIF 变体也不能用（会丢帧）
  assert.equal(lightboxAvifOrFallback({ animated: true, src: "s", mediumAvif: "a.avif" }), "s");
  assert.equal(lightboxAvifOrFallback({}), "");
});
