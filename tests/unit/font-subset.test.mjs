/**
 * 标题字体子集的字形来源契约测试。
 *
 * 为什么要有这一条：**子集漏字是静默故障**——生成脚本不报错，页面也不报错，
 * 只是那几个字回落 SimSun，同一串文字里出现两种字体。真实发生过一次：
 * P2-2 把 `displayTitle`（产出 `《无题 · NN》`）与 `ymLabel`（产出 `NNNN年N月`）
 * 从 `app.js` 搬进 `src/util.js`，而 `build-font-subset.js` 的来源清单没跟上。
 * 当时线上 woff2 恰好在搬迁**之前**生成（字体 commit 09-26 10:15 < 拆分 commit
 * 09-26 22:19）才没暴露，但「下一次重新生成就丢字」。
 *
 * 这里测的是**来源清单**，不是 woff2 文件内容：
 *   1. 渲染热路径用字必须在子集里（漏扫 src/ 会红）
 *   2. caption 独有的字必须不在子集里（把整份 meta.json 收回来会红）
 * 校验 woff2 实际内容需要 fontTools + brotli，为一条断言引依赖不划算；
 * 而上面两条的失效模式恰好就是「来源清单漂移」，覆盖住了。
 *
 * 放单测层而非 e2e：契约是文件系统枚举 + 纯函数，不需要浏览器、毫秒级；
 * 且 e2e 的 SW 生命周期时序会让这类断言变得不可靠（见 sw-assets.test.mjs 头注）。
 */
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

// tools/ 下是 CJS（仓库根 package.json 必须保持无 type，否则
// playwright.config.js 的 require 会失效），故用 createRequire 加载。
const require = createRequire(import.meta.url);
const { collectGlyphs, keepGlyph, glyphSources, metaTitles, srcModules, read } =
  require("../../tools/font-glyphs.js");

test("子集覆盖渲染热路径用字（src/*.js 漏扫会在这里红）", () => {
  const glyphs = new Set(collectGlyphs());

  // displayTitle（src/util.js）的产物模板 `《无题 · NN》`：这四个字只在那里
  for (const ch of "无题《》") {
    assert.ok(
      glyphs.has(ch),
      `渲染热路径用字「${ch}」不在子集里：displayTitle 产出「《无题 · NN》」，` +
        `它会进 .card-anno（hover 墙签，var(--display)）。缺它 → 该字回落 SimSun，同串两种字体`
    );
  }
  // ymLabel（src/util.js）的产物模板 `NNNN年N月`：筛选胶囊上真实可见
  for (const ch of "年月") {
    assert.ok(
      glyphs.has(ch),
      `渲染热路径用字「${ch}」不在子集里：ymLabel 产出「2026年9月」，筛选胶囊可见`
    );
  }
});

test("子集不含 caption 独有的字（caption 无处渲染，收进来纯占体积）", () => {
  const subset = new Set(collectGlyphs());

  // 参照集 =「确定会渲染」的字：所有非 meta 来源 + meta 的 title
  const rendered = new Set();
  for (const [name, text] of Object.entries(glyphSources())) {
    if (name.startsWith("meta.json")) continue;
    for (const ch of text) if (keepGlyph(ch)) rendered.add(ch);
  }
  for (const ch of metaTitles()) if (keepGlyph(ch)) rendered.add(ch);

  // caption 里那些「不在参照集中」的字：站内无处渲染
  const meta = JSON.parse(read("photos/meta.json"));
  const captions = Object.values(meta)
    .map((v) => (v && v.caption) || "")
    .join("");
  const captionOnly = [...new Set(captions)].filter(
    (ch) => keepGlyph(ch) && !rendered.has(ch)
  );

  // 守住测试本身：若 caption 被有意删掉，这条断言会退化成空转
  assert.ok(
    captionOnly.length > 0,
    "meta.json 里已没有 caption 独有字形——若是刻意删了 caption，请一并更新本测试"
  );

  const leaked = captionOnly.filter((ch) => subset.has(ch));
  assert.deepEqual(
    leaked,
    [],
    `caption 独有的字不该进子集（无处渲染）：${leaked.join("")}。` +
      `「确定会渲染」的参照集为 index.html / app.js / styles.css / src/*.js / meta.title`
  );
});

test("来源清单覆盖 src/ 下全部 ESM 模块（与 sw.js 的 SHELL_ASSETS 同一类漂移风险）", () => {
  const declared = new Set(Object.keys(glyphSources()));
  const modules = srcModules();
  assert.ok(modules.length > 0, "src/ 下没有 .js 模块，本测试已失去意义");
  for (const m of modules) {
    assert.ok(declared.has(m), `${m} 未纳入字形来源 —— 其中的文案会静默回落 SimSun`);
  }
});

test("collectGlyphs 无外部状态，且规模在预期区间", () => {
  const a = collectGlyphs();
  const b = collectGlyphs();
  assert.equal(a, b, "两次调用结果不同：收集过程引入了外部状态");
  // 2026-09-29 实测 200（去 caption + 补 src/）。上限留出余量：
  // 一旦把 caption 收回来会立刻跳到 254+，这条会红。
  assert.ok(
    a.length > 100 && a.length <= 215,
    `字形数 ${a.length} 超出预期区间 (100, 215] —— 疑似来源清单漂移`
  );
});
