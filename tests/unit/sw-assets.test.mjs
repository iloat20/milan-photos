/**
 * SW 壳层清单契约测试（Vite 打包后的形态）。
 *
 * 历史（为什么这条契约改过一次）：
 *   app.js 曾以原生 ESM 直出，src/*.js 是**独立的网络请求**。SHELL_ASSETS 是显式清单，
 *   漏加某个模块不报任何错——首屏模块请求早于 SW 接管（进不了缓存），于是「SW 离线仍可
 *   服务」的 e2e 照样通过；真正会炸的是「首访后立刻离线」：app.js import 失败 → 整个
 *   脚本不执行 → 整站停在骨架屏。所以当时有一条「清单覆盖 src/ 全部文件」的契约。
 *
 * 现行（Vite 起）：
 *   src/*.js 被打进 app.js 单文件，上面那条契约随打包**消失**——模块与 app.js 同生共死，
 *   不存在漏缓存。新契约反过来了：清单条目必须恰好是构建产物里真实存在的壳层，
 *   **多列**一个（比如忘删的 ./src/…）会让 install 的 cache.addAll 直接 reject，
 *   表现为全站悄悄失去 SW：页面照常跑，只是不再离线可服务，不炸不报错。
 *
 * 两层分工：
 *   - 本文件钉住**源码侧的清单形状**（毫秒级、不依赖构建）；
 *   - e2e globalSetup 对着 dist 核对「每个条目真实存在」（那里才看得见构建产物）。
 *
 * （曾试过用 e2e + waitForFunction 查缓存，实测该写法会**假绿**：缓存里明明是 MISS，
 *  等待却 29ms 就判 true。已弃用——这也是本契约放在单测层的原因之一。）
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

/** 从 sw.js 源码里解析 `const SHELL_ASSETS = [...]` 的字符串项 */
function parseShellAssets(source) {
  const block = /const SHELL_ASSETS\s*=\s*\[([\s\S]*?)\];/.exec(source);
  assert.ok(block, "未能从 sw.js 解析出 SHELL_ASSETS 数组");
  return [...block[1].matchAll(/"([^"]+)"/g)].map((m) => m[1]);
}

// 打包后的壳层：两份入口（./ 与 ./index.html 是不同 cache key）+ CSS + JS + web manifest。
// 顺序即 sw.js 里的书写顺序——改清单时同步这里，迫使改动「有意为之」。
const EXPECTED_SHELL = ["./", "./index.html", "./styles.css", "./app.js", "./manifest.webmanifest"];

test("SHELL_ASSETS 恰好覆盖构建产物壳层（多列 src/ 会让 install 整组失败）", async () => {
  const sw = await readFile(join(ROOT, "public", "sw.js"), "utf8");
  const declared = parseShellAssets(sw);

  assert.deepEqual(
    declared,
    EXPECTED_SHELL,
    "清单与构建产物不一致：Vite 已把 src/*.js 打进 app.js，清单里不该再有 ./src/ 条目" +
      "（多列 → dist 404 → addAll reject → 全站失去 SW）；增删壳层文件时同时更新 EXPECTED_SHELL"
  );
});

test("SHELL_ASSETS 同时含 ./ 与 ./index.html（两者是不同的 cache key）", async () => {
  const sw = await readFile(join(ROOT, "public", "sw.js"), "utf8");
  const declared = parseShellAssets(sw);
  // "./" 服务根路径导航，"./index.html" 服务直接访问 + shellSwr 的离线 fallback。
  // 看似重复实为两个 key（/ 与 /index.html），删任一个都会让某条路径改走 fallback 分支。
  assert.ok(declared.includes("./"), "缺少 ./（根路径导航的缓存 key）");
  assert.ok(declared.includes("./index.html"), "缺少 ./index.html（离线 fallback 依赖它）");
});

test("shellSwr 的离线 fallback 指向 ./index.html", async () => {
  const sw = await readFile(join(ROOT, "public", "sw.js"), "utf8");
  assert.match(
    sw,
    // 允许带第二个参数（ignoreVary 等查询选项），但目标必须是 ./index.html
    /caches\.match\(\s*"\.\/index\.html"\s*(?:,|\))/,
    "shellSwr 的 fallback 应匹配 ./index.html，与 SHELL_ASSETS 保持一致"
  );
});
