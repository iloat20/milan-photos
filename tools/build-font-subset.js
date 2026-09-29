#!/usr/bin/env node
/**
 * 重新生成标题字体子集 assets/fonts/milan-serif.woff2
 *
 * 站内可见中文散在 index.html / app.js / styles.css / src/*.js / photos/meta.json
 * 里（meta 只取 title —— caption 无处渲染）。字形来源的收集已抽到
 * tools/font-glyphs.js，契约由 tests/unit/font-subset.test.mjs 钉住。
 *
 * 改文案、加图注之后跑一次，把新增字形补进子集；不跑也不报错——
 * 子集外的字会逐字回退到字体栈里的 SimSun，只是观感降级。
 *
 * 做法：提取「可见」字符（剔除源码注释与 ASCII，拉丁让给 Georgia/Times），
 * 用 Google Fonts 的 text= 服务端子集拿一个 400–600 可变字重的 woff2。
 * 这是一次性下载：产物自托管在仓库里，页面运行时零外部请求。
 *
 * 注意：**字重轴不是杠杆**。实测 wght@400..600 与 wght@400..500 的产物字节
 * 完全相同（都只含 text= 里那几个字形）；唯一有效的杠杆是**字形数**，
 * 即「来源清单是否精确」。要瘦身只能从来源下手，不要动字重档位。
 *
 * 需要 Node 18+（内置 fetch）与网络；离线/无网络时 CI 不跑此脚本。
 */
const fs = require("fs");
const path = require("path");
const { ROOT, collectGlyphs } = require("./font-glyphs.js");

const OUT_FILE = path.join(ROOT, "assets", "fonts", "milan-serif.woff2");
const FAMILY = "Noto+Serif+SC:wght@400..600";
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

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
