/**
 * src/util.js 的单元测试 —— 用 Node 内置 test runner，**零新增依赖**
 * （`npm run test:unit`，即 `node --test tests/unit/`）。
 *
 * 这里只测「纯函数」，所以不需要浏览器、不需要起服务、毫秒级跑完。
 * 这也是 P2-2 拆分的第一份收益：这些函数此前埋在 app.js 的 IIFE 里，
 * 任何一行改动都只能靠 e2e 冒烟间接观察。
 *
 * 唯一读取真实文件的是末尾那几组「真清单契约」—— 灯箱取图链路必须对**真实 18 件**
 * 成立，纯函数自身的用例（含空值）覆盖不到「真实数据里到底有没有落到原图」。
 *
 * 注意：本文件是 .mjs（强制 ESM），而 src/util.js 的 ESM 身份由
 * src/package.json 的 {"type":"module"} 声明 —— 仓库根 package.json
 * 必须保持无 type，否则 playwright.config.js 的 require 会失效。
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  pad,
  uid,
  safeDecode,
  looksLikeFileTitle,
  displayTitle,
  captionText,
  wallNumber,
  positionLabel,
  positionAnnouncement,
  lightboxHintText,
  shareUrlFor,
  toLocalDate,
  ymKey,
  ymLabel,
  baseFileName,
  collectFilters,
  stripExt,
  safeFileName,
  heroSrc,
  selectHeroPhotos,
  HERO_MAX,
  lowResCapWidth,
  LOW_RES_MAX_EDGE,
  largestSrcsetUrl,
  largestStill,
  largestAvif,
  lightboxSrc,
  lightboxAvifOrFallback,
  frameCaps,
  lightboxNeed,
  lightboxTiers,
  lightboxAvifTiers,
  pickTier,
  emptyState,
  EMPTY_FAILURE_TEXT,
  EMPTY_EMPTY_TEXT,
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

test("largestSrcsetUrl：取 w 描述符最大的候选；无描述符取首个非空项；空/缺失 → \"\"", () => {
  // 真实形状（photos_lib 按宽度升序写出三档）
  assert.equal(
    largestSrcsetUrl(
      "photos/thumbs/a-400.avif 400w, photos/thumbs/a-800.avif 800w, photos/thumbs/a.avif 1024w"
    ),
    "photos/thumbs/a.avif"
  );
  // 乱序：仍取 w 最大，与书写顺序无关
  assert.equal(largestSrcsetUrl("a.avif 800w, b.avif 1024w, c.avif 400w"), "b.avif");
  // 单档（360×360 那张只有 -400）
  assert.equal(largestSrcsetUrl("photos/thumbs/t-400.avif 360w"), "photos/thumbs/t-400.avif");
  // 全部无 w 描述符：首个非空项胜出（结果确定，不依赖遍历顺序的偶然）
  assert.equal(largestSrcsetUrl("x.avif, y.avif"), "x.avif");
  // 空 / 缺失 / 纯空白 / 只有逗号
  assert.equal(largestSrcsetUrl(""), "");
  assert.equal(largestSrcsetUrl(null), "");
  assert.equal(largestSrcsetUrl(undefined), "");
  assert.equal(largestSrcsetUrl("  ,  "), "");
});

test("largestStill / largestAvif：档位优先级，且无 AVIF 变体时返回空串（交调用方回落）", () => {
  assert.equal(largestStill({ medium: "m", thumb: "t", src: "s" }), "m");
  assert.equal(largestStill({ thumb: "t", src: "s" }), "t");
  assert.equal(largestStill({ src: "s" }), "s");
  assert.equal(largestStill({}), "");
  assert.equal(largestStill(null), "");

  assert.equal(
    largestAvif({ mediumAvif: "ma.avif", thumbAvifSrcset: "t-400.avif 400w, t.avif 1024w" }),
    "ma.avif"
  );
  assert.equal(largestAvif({ thumbAvifSrcset: "t-400.avif 400w, t.avif 1024w" }), "t.avif");
  // 无 AVIF 变体 → 空串（不是回落 WebP，那是调用方的事）
  assert.equal(largestAvif({ thumb: "t" }), "");
  assert.equal(largestAvif({}), "");
});

test("heroSrc：动图只用静态缩略图，避免首屏拉原文件", () => {
  assert.equal(heroSrc({ animated: true, thumb: "t", medium: "m", src: "s" }), "t");
  assert.equal(heroSrc({ medium: "m", thumb: "t", src: "s" }), "m");
  assert.equal(heroSrc({ thumb: "t", src: "s" }), "t");
  assert.equal(heroSrc({ src: "s" }), "s");
  assert.equal(heroSrc({}), "");
});

test("lightboxSrc：动图走原文件保证能播；静态图取最大可用档 medium → thumb → src", () => {
  assert.equal(lightboxSrc({ animated: true, medium: "m", src: "s" }), "s");
  assert.equal(lightboxSrc({ medium: "m", thumb: "t", src: "s" }), "m");
  // 回归锁（P-3）：无中图的 9/18 张必须落到 thumb —— 旧实现此处返回 src（原图）
  assert.equal(lightboxSrc({ thumb: "t", src: "s" }), "t");
  assert.equal(lightboxSrc({ src: "s" }), "s");
  assert.equal(lightboxSrc({}), "");
});

test("lightboxAvifOrFallback：AVIF 优先；无 AVIF 现算顶层；动图仍走原文件", () => {
  assert.equal(lightboxAvifOrFallback({ mediumAvif: "a.avif", medium: "m" }), "a.avif");
  // 回归锁（P-3）：无 mediumAvif 时从 thumbAvifSrcset 取顶层，而非直接回落 WebP
  assert.equal(
    lightboxAvifOrFallback({
      thumbAvifSrcset: "t-400.avif 400w, t.avif 1024w",
      thumb: "t.webp",
    }),
    "t.avif"
  );
  assert.equal(lightboxAvifOrFallback({ medium: "m" }), "m");
  // 动图即使有 AVIF 变体也不能用（会丢帧）
  assert.equal(lightboxAvifOrFallback({ animated: true, src: "s", mediumAvif: "a.avif" }), "s");
  assert.equal(lightboxAvifOrFallback({}), "");
});

/* ───────────────── 真清单契约：灯箱永不请求原图（P-3 主护栏） ─────────────────
   纯函数用例用的是合成对象，覆盖不到「真实 18 件里到底有没有落到 .jpg」。
   这条读真实 manifest，对全部条目断言灯箱取图来自派生目录 ——
   毫秒级、覆盖全量、不可能同义反复。 */

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const MANIFEST = JSON.parse(
  fs.readFileSync(path.join(ROOT, "photos", "manifest.json"), "utf8")
);

test("真清单契约：全部静态作品的灯箱取图都来自派生图，无一落到 jpg/png 原图", () => {
  const photos = MANIFEST.photos;
  assert.equal(photos.length, 18, "样本量变了就得重新审视这条断言");
  const originRe = /\.(?:jpe?g|png)$/i;
  const derivedRe = /^photos\/(?:medium|thumbs)\//;
  for (const p of photos) {
    if (p.animated) continue;
    assert.match(lightboxSrc(p), derivedRe, `${p.file} 的灯箱落到了 ${lightboxSrc(p)}`);
    assert.doesNotMatch(
      lightboxSrc(p),
      originRe,
      `${p.file} 的灯箱仍加载原图：${lightboxSrc(p)}`
    );
    assert.doesNotMatch(
      lightboxAvifOrFallback(p),
      originRe,
      `${p.file} 的 AVIF 侧回落到原图：${lightboxAvifOrFallback(p)}`
    );
  }
  // 反向自证：样本里确实有无 medium 的条目，否则上面「不落原图」是空架子
  assert.ok(
    photos.some((p) => !p.medium),
    "没有无 medium 的样本，这条契约就测不到 P-3"
  );
});

/* ───────────────── P-2：观画室按需求选档（纯函数） ─────────────────
   加 2048 档之后，选档公式本身就是产品行为（移动端取 1200 而不是 2048）。
   这些边界（画框双约束、恰好相等、小图不放大）都是只差一像素就翻转的，
   埋在 IIFE 里只能靠 e2e 撞；抽成纯函数后毫秒级钉死。 */

test("frameCaps：解析 max-width / max-height；非数值与信息缺失一律回退 0", () => {
  const desktop = () => ({ maxWidth: "920px", maxHeight: "628px" });
  assert.deepEqual(frameCaps({}, desktop), { w: 920, h: 628 });
  // 窄屏覆盖后是小数（styles.css 的 min(94vw, 900px) 在 390px 视口下 ≈ 350.6）
  assert.deepEqual(
    frameCaps({}, () => ({ maxWidth: "350.6px", maxHeight: "574.8px" })),
    { w: 350.6, h: 574.8 }
  );
  // max-width: none / 空值 → 0（调用方据此走 P-3 的兜底最大档，而不是误判成「需求 0」）
  assert.deepEqual(frameCaps({}, () => ({ maxWidth: "none", maxHeight: "" })), { w: 0, h: 0 });
  assert.deepEqual(frameCaps(null, desktop), { w: 0, h: 0 });
  // 取样式函数缺失：Node 端没有 getComputedStyle。import 期不报错、调用期静默回退
  assert.deepEqual(frameCaps({}), { w: 0, h: 0 });
});

test("lightboxNeed：画框宽高双约束 + DPR；小图不放大；信息不足 → 0", () => {
  const DESK = { w: 920, h: 628 };
  const MOB = { w: 350.6, h: 574.8 };
  // 桌面 DPR2：2560×1920 受**高度**约束（628/1920 比 920/2560 更紧）→ ceil(2560·0.327083·2)
  assert.equal(lightboxNeed({ width: 2560, height: 1920 }, DESK, 2), 1675);
  // 移动 DPR3：同一张改为受**宽度**约束 → 1052
  assert.equal(lightboxNeed({ width: 2560, height: 1920 }, MOB, 3), 1052);
  // 竖图桌面 DPR2 也是受高度约束 → 942
  assert.equal(lightboxNeed({ width: 1920, height: 2560 }, DESK, 2), 942);
  // 竖图移动 DPR3 与横图同值 1052（瓶颈都是 350.6 的画框宽）
  assert.equal(lightboxNeed({ width: 1536, height: 2048 }, MOB, 3), 1052);
  assert.equal(lightboxNeed({ width: 1920, height: 2560 }, MOB, 3), 1052);
  // 取整是**整式** ceil(w·s·dpr)：350.6×3 = 1051.8 → 1052。
  // 若先 ceil(350.6)=351 再 ×3 会得 1053 —— 差这 1px 正是选 1200 与选 1280 的边界
  assert.equal(lightboxNeed({ width: 1536, height: 2048 }, MOB, 3), 1052);
  // 小图不放大（min(…,1)）：360×360 按原尺寸显示 → need = 360·dpr，而不是画框宽
  assert.equal(lightboxNeed({ width: 360, height: 360 }, DESK, 3), 1080);
  // dpr 非法按 1 处理，不产出 NaN / Infinity
  assert.equal(lightboxNeed({ width: 100, height: 100 }, DESK, 0), 100);
  // 信息不足 → 0（0 是「不知道」而非「需求为 0」：正常取值恒 ≥ 1）
  assert.equal(lightboxNeed({ width: 0, height: 100 }, DESK, 2), 0);
  assert.equal(lightboxNeed({ width: 100 }, DESK, 2), 0);
  assert.equal(lightboxNeed({ width: 100, height: 100 }, { w: 0, h: 0 }, 2), 0);
  assert.equal(lightboxNeed(null, DESK, 2), 0);
});

test('pickTier：选 ≥ need 的最小档；全都偏小取最大档；空候选 → ""；边界取等号', () => {
  const tiers = [
    { url: "t400", w: 400 },
    { url: "t800", w: 800 },
    { url: "t1200", w: 1200 },
    { url: "m2048", w: 2048 },
  ];
  assert.equal(pickTier(tiers, 100), "t400"); // 需求小于全部 → 最小档
  assert.equal(pickTier(tiers, 401), "t800");
  assert.equal(pickTier(tiers, 1200), "t1200"); // **恰好等于**取该档（>= 而非 >）
  assert.equal(pickTier(tiers, 1201), "m2048");
  assert.equal(pickTier(tiers, 99999), "m2048"); // 全都偏小 → 最大档
  assert.equal(pickTier([], 500), "");
  assert.equal(pickTier(null, 500), "");
});

test("lightboxTiers：medium + thumb 合并、按 w 升序、按 url 去重；动图 → []", () => {
  assert.deepEqual(
    lightboxTiers({
      mediumSrcset: "photos/medium/a.webp 1280w, photos/medium/a-2048.webp 2048w",
      thumbSrcset: "photos/thumbs/a-400.webp 400w, photos/thumbs/a.webp 1200w",
    }),
    [
      { url: "photos/thumbs/a-400.webp", w: 400 },
      { url: "photos/thumbs/a.webp", w: 1200 },
      { url: "photos/medium/a.webp", w: 1280 },
      { url: "photos/medium/a-2048.webp", w: 2048 },
    ]
  );
  // 同一个 url 出现两次 → 只留一条，w 取较大者
  assert.deepEqual(lightboxTiers({ mediumSrcset: "m.webp 800w, m.webp 1280w" }), [
    { url: "m.webp", w: 1280 },
  ]);
  // 老/降级清单没有 mediumSrcset：用标量 medium + 反推宽度补齐（不至于选不出档）
  assert.deepEqual(lightboxTiers({ medium: "photos/medium/a.webp", width: 2560, height: 1920 }), [
    { url: "photos/medium/a.webp", w: 1280 },
  ]);
  // 动图不进选档（会冻成静帧），交给 lightboxSrc 走原文件
  assert.deepEqual(lightboxTiers({ animated: true, thumbSrcset: "t.webp 400w" }), []);
  assert.deepEqual(lightboxTiers({}), []);
  assert.deepEqual(lightboxTiers(null), []);
});

test("lightboxAvifTiers：与 WebP 侧同构，只换 AVIF 变体", () => {
  assert.deepEqual(
    lightboxAvifTiers({
      mediumAvifSrcset: "photos/medium/a.avif 1280w, photos/medium/a-2048.avif 2048w",
      thumbAvifSrcset: "photos/thumbs/a-400.avif 400w, photos/thumbs/a.avif 1200w",
    }),
    [
      { url: "photos/thumbs/a-400.avif", w: 400 },
      { url: "photos/thumbs/a.avif", w: 1200 },
      { url: "photos/medium/a.avif", w: 1280 },
      { url: "photos/medium/a-2048.avif", w: 2048 },
    ]
  );
  // 无 AVIF 变体的降级清单 → 空候选（调用方回落 lightboxAvifOrFallback）
  assert.deepEqual(lightboxAvifTiers({ medium: "m.webp", width: 2560, height: 1920 }), []);
  assert.deepEqual(lightboxAvifTiers({ animated: true, mediumAvif: "a.avif" }), []);
  assert.deepEqual(lightboxAvifTiers({}), []);
});

/* ───────────── 真清单契约（P-2）：候选串须与磁盘文件、命名、序数自洽 ─────────────
   合成的对象测不出「线上真的生成了 5 张 -2048、且描述符与文件名相符」。
   这两条读真 manifest + 摸真文件系统，把「生成侧产出」与「消费侧解析」钉在一起。 */

const PHOTOS_DIR = path.join(ROOT, "photos");

test("真清单契约：候选每档都真实存在、w 描述符严格升序、无重复 URL；有中图必能选出档", () => {
  let withLarge = 0;
  for (const p of MANIFEST.photos) {
    for (const key of ["mediumSrcset", "mediumAvifSrcset"]) {
      const raw = p[key];
      if (raw === undefined) continue;
      const seen = new Set();
      let prevW = -1;
      for (const part of raw.split(",")) {
        const [url, descriptor] = part.trim().split(/\s+/);
        const w = Number(/^(\d+)w$/.exec(descriptor || "")?.[1]);
        assert.ok(Number.isFinite(w) && w > 0, `${p.file} 的 ${key} 有非法描述符：${part}`);
        assert.ok(w > prevW, `${p.file} 的 ${key} 描述符非严格升序：${raw}`);
        prevW = w;
        assert.ok(!seen.has(url), `${p.file} 的 ${key} 有重复 URL：${url}`);
        seen.add(url);
        assert.ok(
          fs.existsSync(path.join(PHOTOS_DIR, url.replace(/^photos\//, ""))),
          `${p.file} 的 ${key} 指向不存在的文件：${url}`
        );
      }
    }
    const tiers = lightboxTiers(p);
    if (tiers.some((t) => /-2048\.\w+$/.test(t.url))) withLarge += 1;
    if (p.medium || p.mediumAvif) {
      assert.ok(tiers.length > 0, `${p.file} 有中图却没有 WebP 候选`);
      assert.ok(
        tiers.some((t) => t.url.startsWith("photos/medium/")),
        `${p.file} 的 WebP 候选里没有中图档`
      );
      assert.ok(lightboxAvifTiers(p).length > 0, `${p.file} 有中图却没有 AVIF 候选`);
    }
  }
  // 反向自证（防空架子）：真有长边 > 2048 的样本，否则「选档」根本无从被测
  assert.equal(withLarge, 5, "有 -2048 档的样本数变了，选档断言的对象要重新审视");
});

test("真清单契约：-2048 档的宽度描述符 = 按长边 2048 反推的实际宽（竖图是 1536）", () => {
  const large = MANIFEST.photos.filter((p) => (p.mediumSrcset || "").includes("-2048."));
  assert.equal(large.length, 5);
  for (const p of large) {
    // 竖图的 2048 档长边是 2048、实际**像素宽** 1536；描述符必须写实际宽，
    // 否则浏览器/选档会以为拿到一张比实际更大的图（大两档、白下 60% 字节）
    const expected = Math.round((p.width * 2048) / Math.max(p.width, p.height));
    const m = /photos\/medium\/[^ ]+-2048\.webp (\d+)w/.exec(p.mediumSrcset);
    assert.ok(m, `${p.file} 的 mediumSrcset 里找不到 -2048 档：${p.mediumSrcset}`);
    assert.equal(Number(m[1]), expected, `${p.file} 的 -2048 档宽度描述符`);
  }
  // 竖图与横图都得有样本，否则「按长边反推」只测了一半
  assert.ok(large.some((p) => p.height > p.width), "样本里得有竖图");
  assert.ok(large.some((p) => p.width > p.height), "样本里得有横图");
});

/* —— 空状态判据（F-9）——
   二分模型的真值全表：只有「就绪 + 0 件 + 取清单失败」才给重试入口。
   文案的差异也一并钉住（D-5）：两句必须互不相同，且都不含面向站主的实现细节
   （`photos/` 路径、「库房」面板）—— 文案写回站主视角时本用例即红。 */
test("emptyState：未就绪 / 有可见作品 一律不显示空状态", () => {
  assert.equal(emptyState({ ready: false, visibleCount: 0, failed: true }), null);
  assert.equal(emptyState({ ready: false, visibleCount: 0, failed: false }), null);
  assert.equal(emptyState({ ready: true, visibleCount: 18, failed: false }), null);
  // 失败但已有可见作品：不得盖一层错误提示（局部失败不该伪装成全站故障）
  assert.equal(emptyState({ ready: true, visibleCount: 3, failed: true }), null);
  // 缺参兜底：不得被判成「该显示」
  assert.equal(emptyState(), null);
});

test("emptyState：失败态给重试入口，空馆藏态不给", () => {
  assert.deepEqual(emptyState({ ready: true, visibleCount: 0, failed: true }), {
    text: EMPTY_FAILURE_TEXT,
    retry: true,
  });
  assert.deepEqual(emptyState({ ready: true, visibleCount: 0, failed: false }), {
    text: EMPTY_EMPTY_TEXT,
    retry: false,
  });
});

test("空状态文案：两句互不相同，且都不含站主指引（D-5）", () => {
  assert.notEqual(EMPTY_FAILURE_TEXT, EMPTY_EMPTY_TEXT);
  for (const s of [EMPTY_FAILURE_TEXT, EMPTY_EMPTY_TEXT]) {
    assert.ok(s.length > 0);
    for (const leak of ["photos/", "库房", "刷新", "入藏"]) {
      assert.ok(!s.includes(leak), `空状态文案仍面向站主（含「${leak}」）：${s}`);
    }
  }
});

/* ───────────── F-5 观画室位置指示 ───────────── */

test("positionLabel：与逐图页 pager-count 同格式，覆盖首件/末件/第 3 件", () => {
  assert.equal(positionLabel(2, 18), "3 / 18");
  assert.equal(positionLabel(0, 18), "1 / 18");
  assert.equal(positionLabel(17, 18), "18 / 18");
  // 单件序列（筛选只剩一张）不除零、不出错
  assert.equal(positionLabel(0, 1), "1 / 1");
});

test("positionAnnouncement：播报是完整中文句，不是「3 / 18」的碎片", () => {
  assert.equal(positionAnnouncement(2, 18), "第 3 件，共 18 件");
  assert.equal(positionAnnouncement(0, 1), "第 1 件，共 1 件");
  // 两者职责不同：视觉串不含「件」，播报句不含斜杠 —— 读屏念斜杠是已知劣化
  assert.ok(!positionLabel(2, 18).includes("件"));
  assert.ok(!positionAnnouncement(2, 18).includes("/"));
});

/* ───────────── U-3 灯箱手势提示 ───────────── */

test("lightboxHintText：按指针精度二分文案，两份互不串味", () => {
  const fine = lightboxHintText(false);
  const coarse = lightboxHintText(true);
  // 桌面谈方向键/双击；触屏谈双击/双指 —— 各说各的，不互相混入
  assert.ok(fine.includes("← →") && fine.includes("双击放大"));
  assert.ok(!fine.includes("双指"));
  assert.ok(coarse.includes("双击放大") && coarse.includes("双指缩放"));
  assert.ok(!coarse.includes("← →"));
  assert.notEqual(fine, coarse);
});

/* ───────────── F-4 单件分享 ───────────── */

test("shareUrlFor：有 slug 走逐图展签页绝对 URL，且先剥掉当时地址栏上的 #p= hash", () => {
  assert.equal(
    shareUrlFor(
      { slug: "rou-guang", id: "IMG20260817164949_01.jpg" },
      "https://e.com/milan-photos/#p=IMG20260817164949_01.jpg"
    ),
    "https://e.com/milan-photos/p/rou-guang/"
  );
  // 子路径站点（Pages）与站根（本地 8080）都从传入的 href 派生，不写死任何 origin
  assert.equal(
    shareUrlFor({ slug: "01-city-rain" }, "http://127.0.0.1:8080/#p=x"),
    "http://127.0.0.1:8080/p/01-city-rain/"
  );
});

test("shareUrlFor：无 slug（浏览器内上传的自定义图）回落站内深链 #p=<id>", () => {
  assert.equal(
    shareUrlFor({ id: "u1a2b3" }, "https://e.com/milan-photos/#p=t"),
    "https://e.com/milan-photos/#p=u1a2b3"
  );
  // id 里的特殊字符要编码，别把参数切断
  assert.equal(shareUrlFor({ id: "a b&c" }, "https://e.com/"), "https://e.com/#p=a%20b%26c");
});

test("shareUrlFor：两者皆缺时回落站点根，不产生 undefined 字样", () => {
  assert.equal(shareUrlFor({}, "https://e.com/milan-photos/#p=t"), "https://e.com/milan-photos/");
  assert.equal(shareUrlFor(null, "https://e.com/"), "https://e.com/");
});

/* ───────────── F-3 序厅策展精选（featured → 序厅） ───────────── */

test("selectHeroPhotos：featured 正整数定序；无精选回落陈列序前 HERO_MAX 张", () => {
  const p = (id, featured) => (featured === undefined ? { id } : { id, featured });

  // 无任何 featured：保持旧行为（陈列序前 max 张）
  assert.deepEqual(
    selectHeroPhotos([p("a"), p("b"), p("c")], 2).map((x) => x.id),
    ["a", "b"]
  );
  const ten = Array.from({ length: 10 }, (_, i) => p(`x${i}`));
  assert.equal(selectHeroPhotos(ten).length, HERO_MAX, "缺省上限是 HERO_MAX");

  // 有 featured：精选者按 rank 升序**全量**返回（数量交给策展，不再按 HERO_MAX 截断）
  const curated = [p("a", 3), p("b"), p("c", 1), p("d", 2)];
  assert.deepEqual(
    selectHeroPhotos(curated, 2).map((x) => x.id),
    ["c", "d", "a"]
  );

  // 排名重复（手工改过的清单）：稳定排序保持陈列序，不抛错、不定序漂移
  assert.deepEqual(
    selectHeroPhotos([p("a", 5), p("b", 5), p("c", 1)]).map((x) => x.id),
    ["c", "a", "b"]
  );

  // 非法值视同没有：0 / 负数 / 字符串 / 布尔 / 小数
  const bad = [p("a", 0), p("b", -1), p("c", "1"), p("d", true), p("e", 1.5), p("f", 2)];
  assert.deepEqual(selectHeroPhotos(bad).map((x) => x.id), ["f"]);
});

test("lowResCapWidth：低分辨率母版钳到源宽；高清 / 未知一律不钳（D-1）", () => {
  assert.equal(LOW_RES_MAX_EDGE, 640);
  assert.equal(lowResCapWidth({ width: 360, height: 360 }), 360, "《夜泊》360×360");
  assert.equal(lowResCapWidth({ width: 500, height: 2000 }), 500, "短边 500 ≤ 640");
  assert.equal(lowResCapWidth({ width: 640, height: 640 }), 640, "边界含 640");
  assert.equal(lowResCapWidth({ width: 1024, height: 901 }), 0, "1024 档不钳");
  assert.equal(lowResCapWidth({ width: 641, height: 2000 }), 0, "短边 641 > 640");
  assert.equal(lowResCapWidth({}), 0, "缺宽高 → 不钳（无权判低清）");
  assert.equal(lowResCapWidth({ width: 0, height: 360 }), 0);
  assert.equal(lowResCapWidth({ width: 360, height: 0 }), 0);
  assert.equal(lowResCapWidth(null), 0);
});

test("真清单契约：manifest.hero 与 selectHeroPhotos 的选择一致（F-3）", () => {
  // python 端（sync 写 hero 指针）与 JS 端（序厅选片）是同一条规则的两个实现，
  // 这里逐条对拍：指针指的必须是 JS 规则选出的首张 —— 任一侧漂移即红。
  const first = selectHeroPhotos(MANIFEST.photos, HERO_MAX)[0];
  assert.ok(first, "真清单里应当能选出序厅首张");
  assert.equal(MANIFEST.hero, first.file, "manifest.hero 指针 ≠ 按 featured 规则选出的首张");
  for (const p of MANIFEST.photos) {
    if ("featured" in p) {
      assert.ok(
        Number.isInteger(p.featured) && p.featured >= 1,
        `${p.file} 的 featured 必须为正整数，实际 ${JSON.stringify(p.featured)}`
      );
    }
  }
  // 反向自证（防空架子）：真清单当前确有精选，否则上面可能是「两边都在回落」凑出来的
  assert.ok(
    MANIFEST.photos.some((p) => p.featured >= 1),
    "真清单里没有任何 featured，契约测不到选片"
  );
});
