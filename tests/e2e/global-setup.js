// 资产来源自检（e2e globalSetup）：确认 baseURL 上跑的确实是**本工作区刚构建的 dist**。
//
// 两类风险（都是实证踩过的坑），五层对策：
//
//   风险 A：端口被另一个目录的服务占用，webServer.reuseExistingServer 只要 URL 可达
//           就静默复用 → 用例跑在别的仓库资产上，症状与「本次改动没生效」完全无法区分
//           （曾把排查完全带偏：改动没问题，是验证环境不可信）。
//   风险 B：复用了本项目还在跑的 vite preview，但 dist 已过期 —— 构建只写在 webServer
//           启动命令里，复用即跳过；源码改了而产物没跟上，测的是旧世界。
//
//   对策 1（新鲜度）：任一源码比 dist/index.html 新就先 `npm run build` 补一次；
//         preview 每次请求都读盘，重建即生效，与服务是否被复用无关。
//   对策 2（逐字节）：壳层文件按 sha256 与 dist/ 磁盘比对，任何一项不一致就中止
//         整个测试运行（而不是让用例带着假象去红或绿）。
//   对策 3（构建完整性）：public/sw.js 的 SHELL_ASSETS 每一项都要在 dist 里真实存在——
//         漏一项（比如忘删的 ./src/…）install 时 cache.addAll 直接 reject，
//         表现为全站悄悄失去 SW：页面照常跑，只是不再离线可服务，不炸不报错。
//   对策 4（能力）：manifest 不得是降级版（缺 palette / thumbAvifSrcset 说明生成它的
//         环境没装 Pillow；缺 slug 说明清单还是 F-4 之前的老形态）。该文件直接被站点发布，
//         降级版会让访客与测试同时受害，且症状是「红点散落在互不相关的地方」——
//         必须在开跑前拦住。
//   对策 5（引用完整性）：index.html / manifest.webmanifest / robots.txt 引用到的静态
//         资源（og.jpg、512 图标、sitemap.xml…）必须真实进 dist。这类引用不经过
//         Vite 资源图（绝对 URL 或 public 内引用），漏拷即线上必 404；而 vite preview
//         的 SPA 兜底会把 404 变成 200 text/html，本地永远看不出来（GitHub Pages
//         没有兜底）——2026-09-30 审查抓到的 S1 就是这么漏上线的。
//   对策 6（photos 产物清单，原图直出）：manifest 里**会被请求**的每个路径都要在 dist
//         真实存在；反过来，dist/photos 下的母版必须全部都在引用集合里。
//         正向漏拷 = 访客与爬虫 404（观画室/展签页/分享图都直出母版）；
//         反向残留 = 引用集合之外的图混进 dist（没有任何请求方会取到它）。

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { pathToFileURL } = require("node:url");
const { execSync } = require("node:child_process");

const ROOT = path.resolve(__dirname, "..", "..");
const DIST = path.join(ROOT, "dist");

// dist 壳层 ↔ 线上 URL 一一对应（Vite 固定产物名，不带 hash）
const SHELL_FILES = ["index.html", "app.js", "styles.css", "sw.js"];

// 判定 dist 新鲜度的源码面：任一比 dist/index.html 新就重建。
// photos/ 整棵进列表——thumbs/medium 变了而 manifest 没变时同样要重拷进 dist。
// tools/ 整棵进列表（不再是单个 gen_work_pages.mjs）：构建期真正跑的是 tools/ 下的
// 模块（photo-assets / csp / sw-version 都被 vite.config.js 动态 import），只列生成器
// 会让「改了别的构建模块却不重建」——跑的就是旧规则，而症状是「改动没生效」。
// sitemap.xml 已不在列表：它不再是仓库里的源文件，而是 tools/gen_work_pages.mjs 的产物。
const SOURCES = [
  "index.html",
  "app.js",
  "styles.css",
  "vite.config.js",
  "public",
  "src",
  "tools",
  "package.json",
  "package-lock.json",
  "photos",
  "assets",
];

function sha256(buf) {
  return crypto.createHash("sha256").update(buf).digest("hex");
}

/** 源码面里最新的 mtime（目录递归；取到即可，不挑文件类型） */
function newestSourceMtime() {
  let newest = 0;
  const visit = (p) => {
    const st = fs.statSync(p, { throwIfNoEntry: false });
    if (!st) return;
    if (st.isDirectory()) {
      for (const entry of fs.readdirSync(p)) visit(path.join(p, entry));
    } else if (st.mtimeMs > newest) {
      newest = st.mtimeMs;
    }
  };
  for (const rel of SOURCES) visit(path.join(ROOT, rel));
  return newest;
}

/** 从 public/sw.js 源码里解析 `const SHELL_ASSETS = [...]` 的字符串项（与单测同一正则约定） */
function parseShellAssets(source) {
  const block = /const SHELL_ASSETS\s*=\s*\[([\s\S]*?)\];/.exec(source);
  if (!block) return [];
  return [...block[1].matchAll(/"([^"]+)"/g)].map((m) => m[1]);
}

module.exports = async function globalSetup(config) {
  const baseURL =
    config.projects?.[0]?.use?.baseURL ||
    config.use?.baseURL ||
    "http://127.0.0.1:8080";

  // ── 对策 1：dist 新鲜度（缺了、或源码更新，都先重建再开跑） ──
  const distIndex = path.join(DIST, "index.html");
  const stale =
    !fs.existsSync(distIndex) ||
    newestSourceMtime() > fs.statSync(distIndex).mtimeMs;
  if (stale) {
    // 走 npm script：node_modules/.bin 由 npm 注入 PATH，直调 vite 在裸 shell 里未必可见
    execSync("npm run build", { cwd: ROOT, stdio: "inherit" });
  }

  const problems = [];

  // ── 对策 2：逐字节比对「服务返回的」与「dist 磁盘上的」 ──
  for (const rel of SHELL_FILES) {
    const localPath = path.join(DIST, rel);
    let local;
    try {
      local = fs.readFileSync(localPath);
    } catch {
      problems.push(`${rel}: dist 文件读取失败（${localPath}）`);
      continue;
    }
    try {
      const res = await fetch(`${baseURL}/${rel}`, { cache: "no-store" });
      if (!res.ok) {
        problems.push(`${rel}: HTTP ${res.status}`);
        continue;
      }
      const served = Buffer.from(await res.arrayBuffer());
      if (sha256(served) !== sha256(local)) {
        problems.push(
          `${rel}: 服务返回 ${served.length}B / dist ${local.length}B（sha256 不一致）`
        );
      }
    } catch (err) {
      problems.push(`${rel}: 请求失败（${(err && err.message) || err}）`);
    }
  }

  // ── 对策 3：SHELL_ASSETS 每一项都要在 dist 里真实存在 ──
  try {
    const swSource = fs.readFileSync(path.join(ROOT, "public", "sw.js"), "utf8");
    const declared = parseShellAssets(swSource);
    if (declared.length === 0) {
      problems.push("public/sw.js 里解析不出 SHELL_ASSETS 数组");
    }
    for (const entry of declared) {
      // "./" 与 "./index.html" 都落到 dist/index.html（两个不同的 cache key，同一页）
      const rel =
        entry === "./" || entry === "." ? "index.html" : entry.replace(/^\.\//, "");
      if (!fs.existsSync(path.join(DIST, rel))) {
        problems.push(
          `SHELL_ASSETS 条目 ${entry} 在 dist 不存在 —— install 时 addAll 整组失败，全站失去 SW`
        );
      }
    }
  } catch (err) {
    problems.push(`public/sw.js 读取失败（${(err && err.message) || err}）`);
  }

  // ── 对策 5：被引用的静态资源必须真实进 dist（漏拷即线上 404，且被 preview 兜底掩盖） ──
  try {
    const expected = new Set();
    // index.html：剥掉注释再扫（注释里的举例字面量不是引用），收集 assets/* 路径——
    // 覆盖相对引用（favicon/icon-192）与绝对 URL 引用（og:image 的 assets/og.jpg）
    const html = fs.readFileSync(path.join(DIST, "index.html"), "utf8").replace(/<!--[\s\S]*?-->/g, "");
    for (const m of html.matchAll(/assets\/[A-Za-z0-9._-]+/g)) expected.add(m[0]);
    // manifest.webmanifest（public 内引用根 assets，不进 Vite 资源图）
    const webmanifest = JSON.parse(
      fs.readFileSync(path.join(ROOT, "public", "manifest.webmanifest"), "utf8")
    );
    for (const icon of webmanifest.icons || []) {
      const src = String(icon.src || "").replace(/^\.\//, "");
      if (src && !/^https?:/.test(src)) expected.add(src);
    }
    // robots.txt 的 Sitemap 绝对 URL → 取 pathname、剥掉部署前缀（/milan-photos/）
    const robots = fs.readFileSync(path.join(ROOT, "public", "robots.txt"), "utf8");
    const sm = /^Sitemap:\s*(\S+)/m.exec(robots);
    if (sm) expected.add(new URL(sm[1]).pathname.replace(/^\/[^/]+\//, "/"));
    for (const rel of expected) {
      if (!fs.existsSync(path.join(DIST, rel))) {
        problems.push(
          `被引用资源 ${rel} 不在 dist —— 线上必 404（vite preview 的 SPA 兜底会本地掩盖成 200）`
        );
      }
    }
  } catch (err) {
    problems.push(`引用完整性检查失败（${(err && err.message) || err}）`);
  }

  // ── 对策 6：photos 产物清单（原图直出：母版全量进产物且都会被请求） ──
  try {
    const { referencedPhotoPaths } = await import(
      pathToFileURL(path.join(ROOT, "tools", "photo-assets.mjs")).href
    );
    const manifest = JSON.parse(
      fs.readFileSync(path.join(DIST, "photos", "manifest.json"), "utf8")
    );
    const photos = manifest.photos || [];
    const IMG_RE = /\.(?:jpe?g|png|gif|webp|avif)$/i;

    // 正向：会被请求的每个路径都必须在 dist（漏拷即访客与爬虫 404）
    const refs = referencedPhotoPaths(photos);
    if (refs.length === 0) {
      problems.push("manifest 解析不出任何 photos/ 引用 —— 对策 6 会变成空架子");
    }
    for (const rel of refs) {
      if (!fs.existsSync(path.join(DIST, rel))) {
        problems.push(`manifest 引用的 ${rel} 不在 dist —— 访客与爬虫都会拿到 404`);
      }
    }

    // 反向：dist/photos 下的母版必须**确实会被请求**（出现在引用集合里）。
    // 原图直出后全部 src 都在引用集合里，这条反过来说明：dist 里出现引用集合
    // 之外的图片文件 = 不该在产物里的残留（或漏挂 manifest 的图）。
    // 刻意**不用**构建期决定拷什么的那份判断（masterSourcesToKeep）来校验 ——
    // 拿它校验自己就是同义反复（两边都从同一份 manifest 现算）。
    const referenced = new Set(refs);
    for (const name of fs.readdirSync(path.join(DIST, "photos"))) {
      if (!IMG_RE.test(name)) continue;
      if (!referenced.has(`photos/${name}`)) {
        problems.push(
          `photos/${name} 在 dist 里，却不在 manifest 引用集合里 —— 无人会请求它（残留？漏挂？）`
        );
      }
    }

    // 反向自证：源目录确实有母版，否则上面那条反向检查是空架子
    const sources = fs
      .readdirSync(path.join(ROOT, "photos"))
      .filter((n) => IMG_RE.test(n));
    if (sources.length === 0) {
      problems.push("photos/ 源目录里没有任何母版 —— 对策 6 的反向检查成了空架子");
    }
  } catch (err) {
    problems.push(`photos 产物清单检查失败（${(err && err.message) || err}）`);
  }

  if (problems.length > 0) {
    throw new Error(
      [
        "",
        "",
        `[资产来源自检失败] ${baseURL} 上的服务不是本工作区刚构建的 dist：`,
        ...problems.map((p) => `  - ${p}`),
        "",
        "最可能的原因：",
        "  a) 该端口被另一个目录的服务占用，reuseExistingServer 静默复用了它；",
        "  b) 复用了本项目的 vite preview，但 dist 过期且补构建失败。",
        "",
        "处置：",
        `  1) 查占用：netstat -ano | findstr LISTENING | findstr :${new URL(baseURL).port}`,
        "  2) 结束占用进程（taskkill /PID <pid> /F），或",
        `  3) 换端口重跑：MILAN_PORT=8099 npx playwright test`,
        "",
        "",
      ].join("\n")
    );
  }

  // ── 对策 4：manifest 能力（服务可用 ≠ 服务是完整版） ──
  // slug（F-4）：分享按钮靠它拼逐图展签页 URL，缺了会静默退回 #p= 深链 —— 与
  // palette 同属「页面照常跑、能力悄悄降级」类，必须在开跑前拦住。
  const required = ["thumbAvifSrcset", "palette", "slug"];
  try {
    const res = await fetch(`${baseURL}/photos/manifest.json`, { cache: "no-store" });
    const data = await res.json();
    const items = data.photos || [];
    const missing = required.filter((key) => !items.every((it) => it[key]));
    if (items.length === 0 || missing.length > 0) {
      throw new Error(
        [
          "",
          "",
          `[产物能力自检失败] ${baseURL} 的 manifest 缺少站点与测试依赖的字段：${missing.join(", ") || "(清单为空)"}`,
          `  条目数 ${items.length}；样例字段 ${JSON.stringify(Object.keys(items[0] || {}))}`,
          "",
          "最可能的原因：photos/manifest.json 是在**没装 Pillow** 的环境里 sync 出来的降级版",
          "（无缩略图字段 / 无 palette），或是 F-4 之前生成的老清单（无 slug）。这个文件被",
          "站点直接发布，降级版会让访客和测试同时受害——用例不是报错，而是被测对象悄悄",
          "换成了降级版，红点会散落在互不相关的地方。",
          "",
          "处置：",
          '  1) python -m pip install "Pillow>=11"',
          "  2) python tools/sync_photos.py 重新生成并提交 photos/manifest.json",
          "",
          "注：sync-photos workflow 显式安装 Pillow，线上不存在该问题；这是本机生成的问题。",
          "",
          "",
        ].join("\n")
      );
    }

    // ── 对策 4b：中图候选串的蕴含式检查（sync 产出形状）──
    // **不能**把 mediumSrcset 塞进上面的 required：那是 `every()` 语义，而 9 张
    // 无中图的条目必然缺该字段，自检会整片误报。这里改成「有中图 ⇒ 必须有候选串」。
    // 候选串自原图直出起**暂无消费方**（观画室直出母版）：这条从「防观画室退化」
    // 转为钉住 sync 的产出形状——将来决定停生成 -2048 派生档时连同此检查一起撤。
    const missingLarge = items.filter(
      (it) => (it.medium || it.mediumAvif) && !(it.mediumSrcset && it.mediumAvifSrcset)
    );
    if (missingLarge.length > 0) {
      const names = missingLarge
        .slice(0, 3)
        .map((it) => it.file)
        .join(", ");
      throw new Error(
        [
          "",
          "",
          `[产物能力自检失败] ${baseURL} 的 manifest 里有中图却没有中图候选串的条目：` +
            `${names}${missingLarge.length > 3 ? ` 等 ${missingLarge.length} 条` : ""}`,
          `  （缺 mediumSrcset / mediumAvifSrcset；条目总数 ${items.length}）`,
          "",
          "这是 sync 的产出契约：有中图就必须带候选串。候选串目前无客户端消费方",
          "（观画室已原图直出）——若正在有意停生成派生档，请连同本检查一起撤。",
          "",
          "处置：python tools/sync_photos.py 重新生成并提交 photos/manifest.json",
          "",
          "",
        ].join("\n")
      );
    }
  } catch (err) {
    if (err && err.message && err.message.startsWith("\n\n[产物能力自检失败]")) throw err;
    // 挂 cause 而非只把 message 拼进文本：保留原始堆栈（网络/TLS/JSON 解析都可能在这）
    throw new Error(
      [
        "",
        "",
        `[产物能力自检失败] 无法读取 ${baseURL}/photos/manifest.json：${(err && err.message) || err}`,
        "",
        "",
      ].join("\n"),
      { cause: err }
    );
  }
};
