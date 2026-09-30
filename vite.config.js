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
 * 站点必需、但不在 Vite 资源图里的目录拷贝。
 * Vite 只会搬运 public/ 与「被 index.html / JS 引用到的资源」；
 * photos/manifest.json 是运行时 fetch 的，永远不会进图，只能显式拷。
 */
function copyStaticPlugin() {
  return {
    name: "copy-photos",
    closeBundle() {
      fs.cpSync(path.join(ROOT, "photos"), path.join(ROOT, "dist", "photos"), {
        recursive: true,
      });
    },
  };
}

module.exports = {
  base: "./",
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
