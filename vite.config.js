// Vite 配置（CJS：根 package.json 刻意保持无 "type"，与 playwright.config.js 同一身份）。
//
// 三个关键取舍，改动前先想清楚：
//
// 1. **产物不带 hash**（固定 app.js / styles.css 名字）：sw.js 的 SHELL_ASSETS 是显式清单，
//    且本仓的缓存纪律是「抬 VERSION 换整套壳层缓存」。若文件名带 hash，每个构建都会产生
//    全新 URL，SHELL_ASSETS 追不上、VERSION 也换不掉磁盘上的旧文件——两条纪律同时失效。
// 2. **base 用 "./"（相对路径）**：GitHub Pages 项目页挂在 /milan-photos/ 子路径下，
//    绝对路径在子路径站点上会打头 404；相对路径同时兼容子路径部署与本地 preview。
// 3. **photos/ 不进 public/**：它是 bot（sync-photos workflow）管理的大目录，且 sync 脚本
//    按仓库根路径书写；移动它会连坐 tools 与 CI。代价只是构建结束时整棵拷进 dist（约 10MB）。
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const ROOT = __dirname;

/**
 * 站点必需、但不在 Vite 资源图里的文件拷贝。
 * Vite 只会搬运 public/ 与「被 index.html / JS 以可解析方式引用到的资源」；
 * 下列内容永远进不了图，只能显式拷：
 *   - photos/（含运行时 fetch 的 manifest.json）
 *   - assets/ 的一部分：og.jpg 被 og:image 以**绝对 URL** 引用、icon-512 系被
 *     public/manifest.webmanifest 引用——两种都不经资源图（也不能整体搬进 public：
 *     index.html 相对引用 ./assets/favicon-32.png，HTML 引用 public 目录会被 Vite 警告）。
 *     同名的 favicon/icon-192 已被 HTML 相对引用进产物，覆盖即同内容，无害。
 * 漏拷的后果是线上 404，且被 vite preview 的 SPA 兜底掩盖成本地 200（S1 实证），
 * e2e globalSetup 对策 5 会拦。
 *
 * sitemap.xml 原先也在这里拷，现交由 workPagesPlugin 生成（逐图页要进 sitemap，
 * 静态那份只有 1 条 URL）。仓库根的 sitemap.xml 因此已删除——它的唯一消费者就是本函数。
 */
function copyStaticPlugin() {
  return {
    name: "copy-static",
    closeBundle() {
      fs.cpSync(path.join(ROOT, "photos"), path.join(ROOT, "dist", "photos"), {
        recursive: true,
      });
      fs.cpSync(path.join(ROOT, "assets"), path.join(ROOT, "dist", "assets"), {
        recursive: true,
      });
    },
  };
}

/**
 * 生成逐图展签页 `/p/<slug>/index.html` × N 与 `dist/sitemap.xml`（P1 设计稿 §4）。
 *
 * 为什么在 closeBundle 里 `await import()` 而不是 require：
 * 生成器是 `.mjs`，全部规则要能被 `node --test` 直接覆盖（slug / 转义 / 版式 / sitemap），
 * 而本配置是 CJS。用 file URL 导入是显式的——CJS 里的相对 `import()` 解析基准容易踩坑。
 *
 * 与 cspPlugin 无先后依赖：本插件只写 `dist/p/**` 与 `dist/sitemap.xml`，
 * 不碰 `dist/index.html`，而 closeBundle 是并行钩子（Rollup 语义），不该假设顺序。
 * 同理它也不依赖 copyStaticPlugin——sitemap 已不在那边的拷贝清单里。
 */
function workPagesPlugin() {
  return {
    name: "work-pages",
    async closeBundle() {
      const { writeWorkPages } = await import(
        pathToFileURL(path.join(ROOT, "tools", "gen_work_pages.mjs")).href
      );
      const { count } = writeWorkPages({ distDir: path.join(ROOT, "dist") });
      console.log(`work-pages: 生成 ${count} 个展签页 + sitemap.xml`);
    },
  };
}

/**
 * 构建期为产物注入全指令集 CSP（只能用 <meta> 形式：GitHub Pages 不能下发响应头，
 * 故 frame-ancestors / report-uri / sandbox 与 Report-Only 一概不可用）。
 *
 * 四个必须守住的点，动之前先想清楚：
 * 1. **在 closeBundle 里读 dist/index.html**，不是读源码：内联脚本的 hash 必须覆盖
 *    浏览器**实际收到**的那份字节（Vite 与下游插件都可能改写 HTML）。
 * 2. **算 hash 前先把 CRLF 归一成 LF**：本仓工作区是 CRLF（git index 是 LF），而 HTML
 *    解析器在 tokenize 时把 CRLF 归一后再算 hash —— 不归一就会线上静默失配：
 *    内联脚本被 CSP 拦下、主题闪烁回归，且控制台只有一条 violation，页面照常可用。
 *    （脚本文本处于 HTML 的 "script data" 状态，不做字符引用解码，故无需处理实体。）
 * 3. **meta 必须插在 charset 之后**：meta CSP 只对其**后面**的内容生效。
 * 4. **不预置逃生阀**：不写 'unsafe-inline' / 'unsafe-eval'。本站无 markup 内联样式、
 *    无 <style> 注入（样式写入全走 CSSOM，不受 style-src 管控），故 style-src 也不必放开。
 *    唯一必须放行的跨源目标是 GitHub REST API（库房「同步馆藏数据到 GitHub」用）。
 */
function cspPlugin() {
  const INLINE_SCRIPT_RE = /<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi;
  const CHARSET_RE = /<meta\s+charset=["']?[^>]*>/i;
  return {
    name: "csp-meta",
    closeBundle() {
      const file = path.join(ROOT, "dist", "index.html");
      const html = fs.readFileSync(file, "utf8");

      const hashes = [...html.matchAll(INLINE_SCRIPT_RE)].map(
        (m) =>
          "sha256-" +
          crypto
            .createHash("sha256")
            .update(m[1].replace(/\r\n?/g, "\n"))
            .digest("base64")
      );
      if (!hashes.length) {
        throw new Error("csp-meta: dist/index.html 里找不到内联脚本，hash 无从计算");
      }
      if (html.includes("Content-Security-Policy")) {
        throw new Error("csp-meta: 产物已含 CSP，拒绝重复注入");
      }
      if (!CHARSET_RE.test(html)) {
        throw new Error('csp-meta: dist/index.html 缺少 <meta charset>，无处安放 CSP');
      }

      const csp = [
        "default-src 'self'",
        ["script-src 'self'", ...hashes.map((h) => `'${h}'`)].join(" "),
        "style-src 'self'",
        // 站点无 data: / blob: 图片，也无外链字体（不写 font-src，由 default-src 兜住）
        "img-src 'self'",
        "connect-src 'self' https://api.github.com",
        "worker-src 'self'", // sw.js
        "manifest-src 'self'",
        "object-src 'none'",
        "base-uri 'none'",
        "form-action 'none'", // 全站无 <form> 提交
      ].join("; ");

      const meta = `<meta http-equiv="Content-Security-Policy" content="${csp}" />`;
      fs.writeFileSync(file, html.replace(CHARSET_RE, (m) => `${m}\n  ${meta}`), "utf8");
      console.log(`csp-meta: 注入 ${hashes.length} 个内联脚本 hash`);
    },
  };
}

module.exports = {
  base: "./",
  // preview 的 404 语义对齐 GitHub Pages（S1 教训）：默认 appType:"spa" 会给未知路径
  // 回退 index.html（200 text/html），把「资源缺失」在本地掩盖成 200——og.jpg / sitemap
  // 就是这么漏到线上的（e2e 对策 5 会在开跑前拦）。本站只有 hash 深链、无 client router，
  // SPA 回退毫无用处；dev 下未知路径也直接 404，不误导。
  appType: "mpa",
  publicDir: "public", // sw.js / robots.txt / manifest.webmanifest：原样搬运、不做转换
  plugins: [copyStaticPlugin(), cspPlugin(), workPagesPlugin()],
  build: {
    outDir: "dist",
    // 服务 worker 在 dev 下必须原样返回（Vite 会转换根目录 .js，会破坏它），
    // 放 public/ 即可；构建时同样原样拷贝，URL 保持 /sw.js 不变。
    rollupOptions: {
      output: {
        // 固定名（见文件头取舍 1）。本站单入口、无动态 import，不存在撞名冲突。
        entryFileNames: "app.js",
        chunkFileNames: "[name].js",
        assetFileNames: (info) => {
          // Rollup 4 用 names[]，Rollup 3 用 name——两个形状都接。
          const names = info.names || (info.name ? [info.name] : []);
          const name = names[0] || "";
          if (name.endsWith(".css")) return "styles.css";
          // 图标等小资源保持 assets/ 原位，index.html 里的引用路径就不漂移。
          return "assets/[name][extname]";
        },
      },
    },
  },
};
