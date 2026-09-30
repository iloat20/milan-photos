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
const fs = require("node:fs");
const path = require("node:path");

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
 *   - sitemap.xml：robots.txt 里是绝对 URL 引用。
 * 漏拷的后果是线上 404，且被 vite preview 的 SPA 兜底掩盖成本地 200（S1 实证），
 * e2e globalSetup 对策 5 会拦。
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
      fs.cpSync(path.join(ROOT, "sitemap.xml"), path.join(ROOT, "dist", "sitemap.xml"));
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
  plugins: [copyStaticPlugin()],
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
