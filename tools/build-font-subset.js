#!/usr/bin/env node
/**
 * 重新生成标题字体子集 assets/fonts/milan-serif.woff2
 *
 * 站内可见中文散在 index.html / app.js / styles.css / photos/meta.json 里，
 * 改文案、加图注之后跑一次，把新增字形补进子集；不跑也不报错——
 * 子集外的字会逐字回退到字体栈里的 SimSun，只是观感降级。
 *
 * 做法：提取「可见」字符（剔除源码注释与 ASCII，拉丁让给 Georgia/Times），
 * 用 Google Fonts 的 text= 服务端子集拿一个 400–600 可变字重的 woff2。
 * 这是一次性下载：产物自托管在仓库里，页面运行时零外部请求。
 *
 * 需要 Node 18+（内置 fetch）与网络；离线/无网络时 CI 不跑此脚本。
 */
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const OUT_FILE = path.join(ROOT, "assets", "fonts", "milan-serif.woff2");
const FAMILY = "Noto+Serif+SC:wght@400..600";
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

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

function collectGlyphs() {
  const sources = [
    stripComments(read("index.html"), "html"),
    stripComments(read("app.js"), "js"),
    stripComments(read("styles.css"), "css"),
    read(path.join("photos", "meta.json")),
  ];
  const chars = new Set();
  for (const text of sources) {
    for (const ch of text) if (keepGlyph(ch)) chars.add(ch);
  }
  return [...chars].sort().join("");
}

async function main() {
  const chars = collectGlyphs();
  console.log(`glyphs: ${[...chars].length}`);

  const url = `https://fonts.googleapis.com/css2?family=${FAMILY}&text=${encodeURIComponent(chars)}`;
  const cssRes = await fetch(url, { headers: { "User-Agent": UA } });
  if (!cssRes.ok) throw new Error(`Google Fonts ${cssRes.status}（url 长度 ${url.length}，过长可先拆分文案再试）`);
  const css = await cssRes.text();

  const match = css.match(/font-weight:\s*([^;]+);[\s\S]*?url\((https:[^)]+)\)/);
  if (!match) throw new Error(`未在响应中找到 woff2 地址：\n${css}`);
  const woff2Res = await fetch(match[2], { headers: { "User-Agent": UA } });
  if (!woff2Res.ok) throw new Error(`woff2 下载失败：${woff2Res.status}`);
  const buf = Buffer.from(await woff2Res.arrayBuffer());
  if (buf.slice(0, 4).toString() !== "wOF2") throw new Error("产物不是 woff2");

  fs.mkdirSync(path.dirname(OUT_FILE), { recursive: true });
  fs.writeFileSync(OUT_FILE, buf);
  console.log(`saved ${path.relative(ROOT, OUT_FILE)} weight=${match[1].trim()} bytes=${buf.length}`);
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
