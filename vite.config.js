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
//    按仓库根路径书写；移动它会连坐 tools 与 CI。改由 copyStaticPlugin 按清单拷贝
//    （母版不进产物 —— 见 tools/photo-assets.mjs）。
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
 *
 * photos/ 不再是整棵拷贝（P-1）：只拷 `manifest.json` + `thumbs/` + `medium/`，
 * 母版按 tools/photo-assets.mjs 的规则**按需**保留（本仓 0 个）。`meta.json` 是
 * 策展源（sync 的输入、前端不读），同样不再发布。
 */
function copyStaticPlugin() {
  return {
    name: "copy-static",
    async closeBundle() {
      // 生成器/清单模块都是 .mjs，本配置是 CJS —— 用 file URL 显式 import（同 workPagesPlugin）
      const { masterSourcesToKeep } = await import(
        pathToFileURL(path.join(ROOT, "tools", "photo-assets.mjs")).href
      );

      const photosSrc = path.join(ROOT, "photos");
      const photosDist = path.join(ROOT, "dist", "photos");
      fs.mkdirSync(photosDist, { recursive: true });

      // 清单原样拷（产品 fetch 的就是它；指纹插件也读仓库源那一份，两者内容必然相同）
      fs.copyFileSync(
        path.join(photosSrc, "manifest.json"),
        path.join(photosDist, "manifest.json")
      );
      // 派生图整目录拷：逐档枚举更脆 —— sync 的档位表一变，这里就得跟着改
      for (const sub of ["thumbs", "medium"]) {
        fs.cpSync(path.join(photosSrc, sub), path.join(photosDist, sub), {
          recursive: true,
        });
      }
      // 只有「会被触达的 src」才留母版（本仓 0 个）。**必须自己读仓库源**：
      // closeBundle 是并行钩子，此刻 dist/photos 才刚建好。
      const manifest = JSON.parse(
        fs.readFileSync(path.join(photosSrc, "manifest.json"), "utf8")
      );
      for (const rel of masterSourcesToKeep(manifest.photos)) {
        fs.copyFileSync(path.join(ROOT, rel), path.join(ROOT, "dist", rel));
      }

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
 * 构建收尾：三件事都必须**基于最终产物**、且彼此**有先后**，所以放在同一个插件里
 * 串行执行 —— Rollup 的 closeBundle 是**并行**钩子（同钩子多插件同时跑），
 * 拆成多个插件就失去了顺序保证。
 *
 *   ⓪ 主页 `ImageGallery` 的 `image` 数组（S-2）：读仓库 manifest 注入 index.html。
 *      **必须在 ① 之前** —— 这个数据块是内联脚本，hash 要进 script-src 名单。
 *   ① 给 `dist/index.html` 注入全指令集 CSP。
 *      （逐图展签页自带 CSP —— 那个生成器也在 closeBundle 里跑，同样不能靠插件先后。）
 *   ② SW 缓存版本号：读 ① 之后的四件套算内容指纹，写进 `dist/sw.js`。
 *
 * **顺序不可颠倒**：① 的 hash 必须覆盖 ⓪ 注入的块，② 的指纹必须覆盖 ⓪① 改过的
 * index.html 字节，否则同一份源码在不同构建里可能得到不同结果（取决于钩子谁先跑完）。
 *
 * 另外两点：CSP 只能用 `<meta>` 形式（GitHub Pages 不下发响应头，frame-ancestors /
 * report-uri / sandbox 与 Report-Only 一概不可用）；hash 必须在**产物**上算，
 * 而不是源码 —— 内联脚本的 hash 要覆盖浏览器实际收到的字节。细节见 tools/csp.mjs。
 */
function finalizePlugin() {
  async function load(name) {
    return import(pathToFileURL(path.join(ROOT, "tools", name)).href);
  }

  return {
    name: "build-finalize",
    async closeBundle() {
      const htmlPath = path.join(ROOT, "dist", "index.html");

      // ── ⓪ 主页结构化数据：ImageGallery 的 image 数组（S-2）──────────
      // 必须在 ① 的 hash 计算**之前**落地：这个数据块是内联脚本，它的 sha256
      // 要进 script-src 名单（e2e「CSP hash 双向自洽」就是这条顺序的护栏）。
      const gp = await load("gen_work_pages.mjs");
      const { manifest, meta } = gp.loadSources();
      let html = fs.readFileSync(htmlPath, "utf8");
      html = gp.injectHomeImageArray(html, gp.buildHomeImages({ manifest, meta }));

      // ── ① 主页 CSP ─────────────────────────────────────────────
      const csp = await load("csp.mjs");
      const count = csp.inlineScriptHashes(html).length;
      if (!count) {
        throw new Error("csp-meta: dist/index.html 里找不到内联脚本，hash 无从计算");
      }
      fs.writeFileSync(htmlPath, csp.withCsp(html), "utf8");
      console.log(`csp-meta: 注入 ${count} 个内联脚本 hash`);

      // ── ② SW 缓存版本号 ────────────────────────────────────────
      const swv = await load("sw-version.mjs");
      const read = (rel) => fs.readFileSync(path.join(ROOT, "dist", rel), "utf8");
      const buildId = swv.computeBuildId({
        html: read("index.html"),
        js: read("app.js"),
        css: read("styles.css"),
        // manifest 读**仓库源**而不是 dist：copyStaticPlugin 也挂在 closeBundle 上，
        // 此刻拷没拷完不确定；而它是原样拷贝，两份内容必然相同。
        manifest: fs.readFileSync(path.join(ROOT, "photos", "manifest.json"), "utf8"),
      });
      const swPath = path.join(ROOT, "dist", "sw.js");
      fs.writeFileSync(
        swPath,
        swv.injectBuildId(fs.readFileSync(swPath, "utf8"), buildId),
        "utf8"
      );
      console.log(`sw-version: 注入 ${buildId}`);
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
  plugins: [copyStaticPlugin(), finalizePlugin(), workPagesPlugin()],
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
