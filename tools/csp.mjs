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

/** 剔除 HTML 注释后再扫描：注释里的 `<style>` / `<script>` 字样不是元素，浏览器
 *  把它们当注释文本，正则却会把它们当真。本仓踩过：no-JS 兜底注释里写了 `<style>`
 *  字面量，style 的 hash 被算成「注释 + 样式」的混合体 → CSP 拦下样式，而有 JS 时
 *  页面完全正常（只有「禁用 JavaScript」那条地面真值用例能抓住）。
 *  边界：脚本**内容里**合法的 `<!-- … -->` 序列也会被一并削掉 —— 本站唯一的 JSON
 *  数据块（JSON-LD）按生成器纪律把 `<` 全部转义为 `\u003c`，其余内联脚本是固定文本，
 *  故不会误伤；将来若内联脚本要内嵌 `<!--`，须先回来改掉这条。 */
const stripComments = (html) => String(html ?? "").replace(/<!--[\s\S]*?-->/g, "");

/** 抓 `<script>` 且**无 src** 的那些（`<script src=…>` 不是内联，不需要 hash）。
 *  注意这也会抓到 `type="application/ld+json"` 这类数据块：CSP 到底管不管它由
 *  浏览器实现决定，写进 hash **多写无害**（只是允许了一个不存在的需求），
 *  漏写则可能被拦 —— 故一律算进去。 */
const INLINE_SCRIPT_RE = /<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi;
/** 内联 `<style>`：本站只允许一处出现在 `<noscript>` 里（无 JS 兜底，见 index.html）。
 *  有 JS 时 noscript 内容按纯文本解析、根本不产生 style 元素；无 JS 时它是
 *  **唯一**能让骨架屏退场的样式 —— 被拦即没有第二条路，故与脚本同套 hash 机制。 */
const INLINE_STYLE_RE = /<style[^>]*>([\s\S]*?)<\/style>/gi;
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
  return Array.from(stripComments(html).matchAll(INLINE_SCRIPT_RE), (m) => {
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

/** 内联样式块与 `inlineScriptHashes` 同一套规则（含注释剔除与 CRLF 归一的因由）。
 *  `<style>` 的文本同样处于 RAWTEXT 状态：不做字符引用解码。 */
export function inlineStyleHashes(html) {
  return Array.from(stripComments(html).matchAll(INLINE_STYLE_RE), (m) => {
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
 * 不预置逃生阀：不写 `'unsafe-inline'` / `'unsafe-eval'`。样式写入全走 CSSOM
 * （不受 style-src 管控），唯一的 markup 内联样式是主页 `<noscript>` 里的
 * no-JS 兜底块 —— 它由 `styleHashes` 逐块放行，而非开 `'unsafe-inline'`。
 * 唯一必须放行的跨源目标是 GitHub REST API（库房「同步馆藏数据到 GitHub」）。
 *
 * 逐图页其实用不到 `connect-src` 的 github、`worker-src` 与 `manifest-src`
 * （它不注册 SW、无 webmanifest），也**没有** `<noscript>` 兜底（页面本就无 JS 依赖），
 * 但指令集合刻意保持与主页同一套：两套会漂移，而漂移的那一侧不会有任何报错。
 */
export function buildCsp(hashes, styleHashes = []) {
  const list = Array.isArray(hashes) ? hashes.filter(Boolean) : [];
  if (!list.length) {
    throw new Error("csp: 没有内联脚本 hash，拒绝生成 script-src");
  }
  const styles = Array.isArray(styleHashes) ? styleHashes.filter(Boolean) : [];
  return [
    "default-src 'self'",
    ["script-src 'self'", ...list.map((h) => `'${h}'`)].join(" "),
    ["style-src 'self'", ...styles.map((h) => `'${h}'`)].join(" "),
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

/** 一步到位：解析内联脚本与样式 → 生成指令 → 插入 meta。返回带 CSP 的 HTML。 */
export function withCsp(html) {
  const hashes = inlineScriptHashes(html).map((s) => s.hash);
  const styleHashes = inlineStyleHashes(html).map((s) => s.hash);
  return injectCspMeta(html, buildCsp(hashes, styleHashes));
}
