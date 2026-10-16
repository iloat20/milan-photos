/**
 * CSP 单一来源（tools/csp.mjs）的单元测试。
 *
 * 为什么值得单测：CSP 出错的表现是**静默**的 —— 内联脚本被拦下，页面照常可用，
 * 控制台只有一条 violation；hash 漏算一页则只有那一页出问题。e2e 能端到端撞，
 * 但需要跑 18 页；这里在毫秒级把规则本身钉死。
 */
import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";

import {
  buildCsp,
  inlineScriptHashes,
  inlineStyleHashes,
  injectCspMeta,
  withCsp,
} from "../../tools/csp.mjs";

const sha256 = (text) =>
  "sha256-" + crypto.createHash("sha256").update(text).digest("base64");

/* ────────────────────────── hash 规则 ────────────────────────── */

test("inlineScriptHashes：CRLF 与 LF 得到同一 hash（按解析器归一后的字节）", () => {
  const lf = "<script>\nvar a = 1;\n</script>";
  const crlf = "<script>\r\nvar a = 1;\r\n</script>";
  const a = inlineScriptHashes(lf);
  const b = inlineScriptHashes(crlf);
  assert.equal(a.length, 1);
  assert.equal(b.length, 1);
  assert.equal(a[0].hash, b[0].hash);
  // 反向自证：若实现忘了归一，crlf 版的 hash 会等于「原文直接哈希」
  assert.notEqual(b[0].hash, sha256("\r\nvar a = 1;\r\n"));
});

test("inlineScriptHashes：<script src> 不计入；ld+json 数据块计入", () => {
  const html = [
    '<script src="./app.js"></script>',
    '<script type="application/ld+json">{"@type":"Photograph"}</script>',
    "<script>var t = 1;</script>",
  ].join("\n");
  const got = inlineScriptHashes(html);
  assert.equal(got.length, 2, "外链 script 不是内联，不该算 hash");
  assert.equal(got[0].text, '{"@type":"Photograph"}');
  assert.equal(got[1].text, "var t = 1;");
});

test("inlineScriptHashes：没有内联脚本时返回空数组（由 buildCsp 负责拒绝）", () => {
  assert.deepEqual(inlineScriptHashes('<script src="./a.js"></script>'), []);
  assert.deepEqual(inlineScriptHashes(""), []);
});

test("inlineStyleHashes：与脚本同套规则（CRLF 归一、无 style 时空数组）", () => {
  const crlf = "<style>\r\n  .a { color: red; }\r\n</style>";
  const got = inlineStyleHashes(crlf);
  assert.equal(got.length, 1);
  assert.equal(
    got[0].hash,
    sha256("\n  .a { color: red; }\n"),
    "样式块同样按解析器归一后的字节算 hash"
  );
  // 带属性的 style（noscript 里目前没有，但规则上要认）同样计入
  const withAttr = inlineStyleHashes('<style media="screen">b{}</style>');
  assert.equal(withAttr.length, 1);
  assert.equal(withAttr[0].text, "b{}");
  assert.deepEqual(inlineStyleHashes("<html></html>"), []);
  assert.deepEqual(inlineStyleHashes(""), []);
});

test("注释里的标签字面量不是元素：扫描前剔除注释（hash 只覆盖真实内容）", () => {
  // 回归锁：本仓踩过 —— no-JS 兜底注释里写了 `<style>` 字面量，hash 被算成
  // 「注释 + 样式」的混合体，CSP 拦下样式；有 JS 时页面完全正常，只有
  // 「禁用 JavaScript」e2e 能抓住。修复是扫描前先剥 HTML 注释。
  const styled = [
    "<!-- 说明里提到 <style> 与 <script> 都不算数 -->",
    "<style>.a { display: none; }</style>",
  ].join("\n");
  const styles = inlineStyleHashes(styled);
  assert.equal(styles.length, 1, "注释里的 <style> 不得被当成元素");
  assert.equal(styles[0].text, ".a { display: none; }");
  assert.equal(styles[0].hash, sha256(".a { display: none; }"));

  const scripted = [
    "<!-- 假脚本对：<script>var fake = 1;</script> -->",
    "<script>var real = 1;</script>",
  ].join("\n");
  const scripts = inlineScriptHashes(scripted);
  assert.equal(scripts.length, 1);
  assert.equal(scripts[0].text, "var real = 1;");
});

/* ────────────────────────── 指令集合 ────────────────────────── */

test("buildCsp：指令齐备、无逃生阀；空 hash 拒绝生成", () => {
  const csp = buildCsp(["sha256-AAA="]);
  for (const directive of [
    "default-src 'self'",
    "script-src 'self' 'sha256-AAA='",
    "style-src 'self'",
    "img-src 'self'",
    "connect-src 'self' https://api.github.com",
    "worker-src 'self'",
    "manifest-src 'self'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
  ]) {
    assert.ok(csp.includes(directive), `缺少指令：${directive}`);
  }
  assert.ok(!csp.includes("unsafe-inline"), "不得预置 unsafe-inline");
  assert.ok(!csp.includes("unsafe-eval"), "不得预置 unsafe-eval");
  assert.ok(!csp.includes("frame-ancestors"), "meta 形式下 frame-ancestors 无效，不该写");

  assert.throws(() => buildCsp([]), /没有内联脚本 hash/);
  assert.throws(() => buildCsp(undefined), /没有内联脚本 hash/);
});

test("buildCsp：style-src 只放行传入的样式 hash，不传则保持 'self' 裸指令", () => {
  const withStyles = buildCsp(["sha256-AAA="], ["sha256-BBB=", "sha256-CCC="]);
  assert.ok(withStyles.includes("style-src 'self' 'sha256-BBB=' 'sha256-CCC='"));
  assert.ok(!withStyles.includes("unsafe-inline"));
  // 逐图页没有 noscript 兜底样式 —— 不得凭空带入 script-src 的 hash 或占位
  const none = buildCsp(["sha256-AAA="]);
  assert.ok(none.includes("style-src 'self';"));
});

/* ────────────────────────── 注入 ────────────────────────── */

test("injectCspMeta：插在 charset 之后、其余内容之前", () => {
  const html = '<head>\n  <meta charset="UTF-8" />\n  <title>x</title>\n</head>';
  const out = injectCspMeta(html, "default-src 'self'");
  const iCharset = out.indexOf("charset");
  const iCsp = out.indexOf("Content-Security-Policy");
  const iTitle = out.indexOf("<title>");
  assert.ok(iCsp > iCharset, "meta CSP 只对其**后面**的内容生效，必须在 charset 之后");
  assert.ok(iCsp < iTitle, "越早出现越保险");
  assert.ok(out.endsWith("</html>") || out.includes("<title>x</title>"), "其余内容不得丢");
});

test("injectCspMeta：已含 CSP 拒绝重复注入；缺 charset 无处安放", () => {
  const once = injectCspMeta('<meta charset="UTF-8" /><p>x</p>', "default-src 'self'");
  assert.throws(() => injectCspMeta(once, "default-src 'none'"), /拒绝重复注入/);
  assert.throws(() => injectCspMeta("<head></head>", "default-src 'none'"), /缺少 <meta charset>/);
});

test("withCsp：CSP 声明的 hash 集合 = 页内实际脚本/样式各自的 hash 集合", () => {
  const html = [
    "<head>",
    '  <meta charset="UTF-8" />',
    "  <script>var t = 1;</script>",
    '  <script type="application/ld+json">{"@type":"Photograph"}</script>',
    "</head>",
    "<body>",
    "  <noscript>",
    "    <style>.gallery-skeleton { display: none; }</style>",
    "  </noscript>",
    "</body>",
  ].join("\n");
  const out = withCsp(html);
  const csp = /<meta http-equiv="Content-Security-Policy" content="([^"]*)"/.exec(out);
  assert.ok(csp, "应注入了 CSP meta");
  const declaredOf = (directive) => {
    const m = new RegExp(`${directive} ([^;]+)`).exec(csp[1]);
    return (m ? m[1].match(/'(sha256-[^']+)'/g) || [] : []).map((s) => s.slice(1, -1)).sort();
  };
  const scripts = inlineScriptHashes(html)
    .map((s) => s.hash)
    .sort();
  assert.deepEqual(declaredOf("script-src"), scripts);
  // 反向自证：本页确有 2 个内联脚本，上面不是「空集相等」凑出来的
  assert.equal(scripts.length, 2);
  const styles = inlineStyleHashes(html)
    .map((s) => s.hash)
    .sort();
  assert.deepEqual(declaredOf("style-src"), styles);
  assert.equal(styles.length, 1, "样式侧同样要反向自证非空");
});
