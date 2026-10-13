/**
 * CSP 的**单一来源**：两条注入路径共用同一套指令与同一套内联脚本 hash 规则。
 *
 *   - 主页 `dist/index.html` —— vite.config.js 的 `csp-meta` 插件在 closeBundle 注入；
 *   - 逐图展签页 `dist/p/<slug>/index.html` —— gen_work_pages.mjs 生成时**自带**。
 *
 * 为什么逐图页不能等插件来注入：workPagesPlugin 与 cspPlugin 都是 `closeBundle`，
 * 而 Rollup 语义下同一钩子并行执行（顺序无保证，vite.config.js 亦已注明），
 * 谁先谁后不确定 → 只能让生成器自己负责。
 *
 * 为什么两条路径必须共用本模块：各写一份的话，将来收紧指令时必然漏掉一处 ——
 * 而漏掉的那一侧**不会报任何错**，只是悄悄少了一道防护（本仓已经踩过同类：
 * lb-enter 漏了 lb-in 的处理）。指令集合只有这里一份。
 */
import crypto from "node:crypto";

/** 抓 `<script>` 且**无 src** 的那些（`<script src=…>` 不是内联，不需要 hash）。
 *  注意这也会抓到 `type="application/ld+json"` 这类数据块：CSP 到底管不管它由
 *  浏览器实现决定，写进 hash **多写无害**（只是允许了一个不存在的需求），
 *  漏写则可能被拦 —— 故一律算进去。 */
const INLINE_SCRIPT_RE = /<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi;
const CHARSET_RE = /<meta\s+charset=["']?[^>]*>/i;

/**
 * 取出全部内联脚本及其 CSP hash。
 *
 * **CRLF 必须归一成 LF 再算**：HTML 解析器在 tokenize 阶段先归一换行，
 * 而本仓工作区是 CRLF（git index 是 LF）。不归一会线上静默失配 ——
 * 内联脚本被拦下、主题闪烁回归，而控制台只有一条 violation、页面照常可用。
 * （脚本文本处于 HTML 的 "script data" 状态，不做字符引用解码，故无需处理实体。）
 */
export function inlineScriptHashes(html) {
  return Array.from(String(html ?? "").matchAll(INLINE_SCRIPT_RE), (m) => {
    const text = m[1];
    return {
      text,
      hash:
        "sha256-" +
        crypto
          .createHash("sha256")
          .update(text.replace(/\r\n?/g, "\n"))
          .digest("base64"),
    };
  });
}

/**
 * 全指令集 CSP。
 *
 * 只能用 `<meta>` 形式：GitHub Pages 不能下发响应头，故 `frame-ancestors` /
 * `report-uri` / `sandbox` 与 Report-Only 一概不可用。
 *
 * 不预置逃生阀：不写 `'unsafe-inline'` / `'unsafe-eval'`。本站无 markup 内联样式、
 * 无 `<style>` 注入（样式写入全走 CSSOM，不受 style-src 管控），故 `style-src`
 * 也不必放开。唯一必须放行的跨源目标是 GitHub REST API（库房「同步馆藏数据到 GitHub」）。
 *
 * 逐图页其实用不到 `connect-src` 的 github、`worker-src` 与 `manifest-src`
 * （它不注册 SW、无 webmanifest），但**刻意保持与主页同一套**：两套会漂移，
 * 而漂移的那一侧不会有任何报错。
 */
export function buildCsp(hashes) {
  const list = Array.isArray(hashes) ? hashes.filter(Boolean) : [];
  if (!list.length) {
    throw new Error("csp: 没有内联脚本 hash，拒绝生成 script-src");
  }
  return [
    "default-src 'self'",
    ["script-src 'self'", ...list.map((h) => `'${h}'`)].join(" "),
    "style-src 'self'",
    "img-src 'self'",
    "connect-src 'self' https://api.github.com",
    "worker-src 'self'", // sw.js
    "manifest-src 'self'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'", // 全站无 <form> 提交
  ].join("; ");
}

/**
 * 把 CSP meta 插到 `<meta charset>` **之后** —— meta CSP 只对其后面的内容生效，
 * 放到 charset 之前会让 charset 声明落在策略之外。
 *
 * 已含 CSP 时抛错而非覆盖：重复注入说明有两条路径都在写同一个文件，
 * 静默覆盖会把「谁赢」变成随机（届时看到的又是并行钩子的顺序）。
 */
export function injectCspMeta(html, csp) {
  const source = String(html ?? "");
  if (source.includes("Content-Security-Policy")) {
    throw new Error("csp: 目标 HTML 已含 CSP，拒绝重复注入");
  }
  if (!CHARSET_RE.test(source)) {
    throw new Error("csp: 目标 HTML 缺少 <meta charset>，无处安放 CSP");
  }
  const meta = `<meta http-equiv="Content-Security-Policy" content="${csp}" />`;
  return source.replace(CHARSET_RE, (m) => `${m}\n  ${meta}`);
}

/** 一步到位：解析内联脚本 → 生成指令 → 插入 meta。返回带 CSP 的 HTML。 */
export function withCsp(html) {
  const hashes = inlineScriptHashes(html).map((s) => s.hash);
  return injectCspMeta(html, buildCsp(hashes));
}
