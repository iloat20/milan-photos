/**
 * 标题字体子集的**字形来源**收集器。
 *
 * 从 tools/build-font-subset.js 抽出成独立模块，理由是可测性：子集漏字是**静默**故障
 * ——子集外的字逐个回落到字体栈里的 SimSun，同一串文字里会看到两种字体，
 * 而页面不报任何错。只靠「重新生成一次看看」发现不了。抽出来后
 * tests/unit/font-subset.test.mjs 能直接断言「哪些字必须进子集 / 哪些必须排除」，
 * 不必去 grep 脚本源码（那种断言在有来源漂移时会跟着一起漂移，等于没测）。
 *
 * 两条易漂移的约定，都已由那条单测钉住：
 *
 * 1. **来源必须覆盖 `src/*.js`**。P2-2 拆分把 `displayTitle`（产出 `《无题 · NN》`）
 *    与 `ymLabel`（产出 `NNNN年N月`）从 `app.js` 搬进了 `src/util.js`，而本收集器的
 *    来源清单当时没跟上——于是「下一次重新生成就丢这 5 个字」。实测漏收
 *    `《 》 无 题 月`；症状是 hover 墙签与筛选胶囊里那几个字回退 SimSun。
 *    缓释现状：线上 woff2 是**搬迁之前**生成的（字体 commit 09-26 10:15 早于
 *    拆分 commit 09-26 22:19），所以现在还没坏——只是随时会坏。
 *
 * 2. **`meta.json` 只取 `title` 值**。caption 在站内**无处渲染**：
 *    `.hero-carousel-caption` / `.card-meta` / `.lb-caption` / `.lb-index` /
 *    `.lb-medium` / `.lightbox-meta` 全在 `styles.css` 的 `display: none !important`
 *    隐藏清单里；`app.js` 里 `caption` 只被搬运，从不写入文本节点。
 *    而 `title` **会**渲染：`.card-anno` 用 `var(--display)`（= 本站字体栈）承接
 *    `${wallNo} ${titleText}`，在 hover / 键盘聚焦时浮现。
 *    实测：把整份 meta.json 收进来会多带 33 个 caption 独有的字形。
 */
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");

/** 剔除源码注释：这些文字不渲染，不该占字形 */
function stripComments(text, kind) {
  let out = text;
  if (kind === "css") return text.replace(/\/\*[\s\S]*?\*\//g, "");
  if (kind === "html") return text.replace(/<!--[\s\S]*?-->/g, "");
  if (kind === "js") {
    out = out.replace(/\/\*[\s\S]*?\*\//g, "");
    // 行注释：:// 后的斜杠不算（站内正则字面量不含中文）
    return out.replace(/(^|[^:"'`\\])\/\/[^\n]*/gm, "$1");
  }
  return out;
}

/** 只保留中日韩与中文排版符号；ASCII 走 Georgia/Times（子集外逐字回退） */
function keepGlyph(ch) {
  const c = ch.codePointAt(0);
  if (c === 0x00a0 || c === 0x00a9 || c === 0x00b7 || c === 0x00d7) return true; // nbsp © · ×
  if (c >= 0x2000 && c <= 0x206f) return true; // 破折号引号省略号‹›
  if (c >= 0x2190 && c <= 0x21ff) return true; // 箭头
  if (c >= 0x2200 && c <= 0x22ff) return true; // × ÷ ± 等数学
  if (c >= 0x25a0 && c <= 0x26ff) return true; // ● ▶ 等符号
  if (c >= 0x3000 && c <= 0x303f) return true; // 。，《》、等中文标点
  if (c >= 0x3400 && c <= 0x4dbf) return true; // CJK 扩展 A
  if (c >= 0x4e00 && c <= 0x9fff) return true; // CJK 基本区
  if (c >= 0xf900 && c <= 0xfaff) return true; // CJK 兼容
  if (c >= 0xff00 && c <= 0xffef) return true; // 全角（！？：；（）等）
  return false;
}

/** `src/` 下的 ESM 模块——文案已部分搬到这里，必须一并收（见文件头约定 1） */
function srcModules() {
  return fs
    .readdirSync(path.join(ROOT, "src"))
    .filter((f) => f.endsWith(".js"))
    .map((f) => path.join("src", f));
}

/** `meta.json` 只取 title 值（caption 无处渲染，见文件头约定 2） */
function metaTitles() {
  const meta = JSON.parse(read(path.join("photos", "meta.json")));
  return Object.values(meta)
    .map((v) => (v && v.title) || "")
    .join("\n");
}

/** 全部字形来源，按名字分组——单测要按来源分别断言，故不直接返回并集 */
function glyphSources() {
  return {
    "index.html": stripComments(read("index.html"), "html"),
    "app.js": stripComments(read("app.js"), "js"),
    "styles.css": stripComments(read("styles.css"), "css"),
    ...Object.fromEntries(
      srcModules().map((p) => [p, stripComments(read(p), "js")])
    ),
    "meta.json#title": metaTitles(),
  };
}

function collectGlyphs() {
  const chars = new Set();
  for (const text of Object.values(glyphSources())) {
    for (const ch of text) if (keepGlyph(ch)) chars.add(ch);
  }
  return [...chars].sort().join("");
}

module.exports = {
  ROOT,
  read,
  stripComments,
  keepGlyph,
  srcModules,
  metaTitles,
  glyphSources,
  collectGlyphs,
};
