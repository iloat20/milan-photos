// 资产来源自检（e2e globalSetup）：确认 baseURL 上的服务提供的确实是**本仓库**的文件。
//
// 为什么需要这一步：
//   本机曾在 8080 上存在**另一个目录**的预览服务（opencode 的工作树），而
//   webServer.reuseExistingServer 只要 URL 可达就静默复用 → 14 条用例跑在别的仓库资产上，
//   表现为 3 条莫名其妙的失败，且症状与「本次改动没生效」完全无法区分，把排查引向
//   被测代码。改动本身没有任何问题，问题在「验证环境不可信」。
//
// 对策：跑任何用例之前，把服务返回的字节与磁盘文件做 sha256 逐一对齐；
//       任何一项不一致就直接中止整个测试运行（而不是让用例带着假象去红或绿）。
//
// 与 tools/serve.py 的关系：serve.py 在 Windows 上改用 SO_EXCLUSIVEADDRUSE，
// 端口被占用时**bind 直接失败**（WinError 10048），已从源头阻断双绑；
// 本自检是第二层防线，覆盖非 Windows、旧版 serve.py、反代等其它路径。

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const ROOT = path.resolve(__dirname, "..", "..");

// 只校验确定会原样落盘的文件；manifest.json / thumbs 是生成物，不适合做字节比对
const FILES = ["index.html", "app.js", "styles.css", "sw.js"];

function sha256(buf) {
  return crypto.createHash("sha256").update(buf).digest("hex");
}

module.exports = async function globalSetup(config) {
  const baseURL =
    config.projects?.[0]?.use?.baseURL ||
    config.use?.baseURL ||
    `http://127.0.0.1:${process.env.MILAN_PORT || 8080}`;

  const problems = [];

  for (const rel of FILES) {
    const localPath = path.join(ROOT, rel);
    let local;
    try {
      local = fs.readFileSync(localPath);
    } catch {
      problems.push(`${rel}: 本地文件读取失败（${localPath}）`);
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
          `${rel}: 服务返回 ${served.length}B / 磁盘 ${local.length}B（sha256 不一致）`
        );
      }
    } catch (err) {
      problems.push(`${rel}: 请求失败（${err && err.message}）`);
    }
  }

  if (problems.length > 0) {
    throw new Error(
      [
        "",
        "",
        `[资产来源自检失败] ${baseURL} 上的服务提供的不是本仓库的文件：`,
        ...problems.map((p) => `  - ${p}`),
        "",
        "最可能的原因：该端口被**另一个目录**的预览服务占用，",
        "而 webServer.reuseExistingServer 静默复用了它，测试并未打到本项目上。",
        "",
        "处置：",
        `  1) 查占用：netstat -ano | grep LISTENING | grep :${new URL(baseURL).port}`,
        "  2) 结束占用进程（taskkill //PID <pid> //F），或",
        `  3) 换端口重跑：MILAN_PORT=8099 npx playwright test`,
        "",
        "",
      ].join("\n")
    );
  }

  // 第二项自检：**服务的能力**，而不只是资产来源。
  // serve.py 在缺 Pillow 时会优雅降级——不生成缩略图、不算 palette，manifest 照常返回。
  // 这是对产品的合理设计，但对测试是灾难：用例不是「失败」，而是被测对象悄悄换成了降级版，
  // 表现为 4 条互不相关的红（AVIF 协商、thumbAvifSrcset、预计算墙色、Tab 序列），
  // 排查方向会被完全带偏。本机实测过：`python`（托管 3.13，无 Pillow）与
  // `py`（系统 3.12，有 Pillow）是两个解释器，而 playwright.config.js 写的是 `python`。
  const required = ["thumbAvifSrcset", "palette"];
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
          `[服务能力自检失败] ${baseURL} 的 manifest 缺少测试所依赖的字段：${missing.join(", ") || "(清单为空)"}`,
          `  条目数 ${items.length}；样例字段 ${JSON.stringify(Object.keys(items[0] || {}))}`,
          "",
          "最可能的原因：启动 serve.py 的解释器**没有装 Pillow**。",
          "缺 Pillow 时 serve.py 会静默降级（无缩略图、无 palette），manifest 仍返回 200，",
          "于是用例不是报错，而是被测对象换成了降级版——红点会散落在互不相关的地方。",
          "",
          "处置（任选）：",
          "  1) 给当前解释器装 Pillow：python -m pip install \"Pillow>=11\"",
          "  2) 换解释器重跑：MILAN_PY=py npx playwright test",
          "  3) 确认跑的是哪个：python -c \"import sys,PIL;print(sys.executable)\"",
          "",
          "注：CI 里 setup-python 后显式 `pip install Pillow`，所以线上不存在这个问题；",
          "这是**本机**解释器不一致导致的。",
          "",
          "",
        ].join("\n")
      );
    }
  } catch (err) {
    if (err && err.message && err.message.startsWith("\n\n[服务能力自检失败]")) throw err;
    // 挂 cause 而非只把 message 拼进文本：保留原始堆栈（网络/TLS/JSON 解析都可能在这）
    throw new Error(
      [
        "",
        "",
        `[服务能力自检失败] 无法读取 ${baseURL}/photos/manifest.json：${(err && err.message) || err}`,
        "",
        "",
      ].join("\n"),
      { cause: err }
    );
  }
};
