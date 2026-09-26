/**
 * SW 壳层清单契约测试。
 *
 * 为什么要有这一条：`src/*.js` 是 ESM，`app.js` 靠 `import` 引入；而 SW 的
 * `SHELL_ASSETS` 是**显式清单**，漏加某个模块时不会报任何错 —— 首屏的模块请求
 * 早于 SW 接管（不经 SW，也就进不了缓存），于是「SW 离线仍可服务」那条 e2e
 * 照样通过；真正会炸的是「首次访问后立刻离线」，表现为**整站停在骨架屏**
 * （app.js 的 import 失败 → 整个 IIFE 不执行）。
 *
 * 放在单测层而不是 e2e：契约是「清单是否覆盖 src/ 下的实际文件」，
 * 枚举文件系统即可判定，不需要浏览器、不受 SW 生命周期时序影响。
 * （曾试过用 e2e + waitForFunction 查缓存，实测该写法会**假绿**：
 *  缓存里明明是 MISS，等待却 29ms 就判 true。已弃用。）
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

/** 从 sw.js 源码里解析 `const SHELL_ASSETS = [...]` 的字符串项 */
function parseShellAssets(source) {
  const block = /const SHELL_ASSETS\s*=\s*\[([\s\S]*?)\];/.exec(source);
  assert.ok(block, "未能从 sw.js 解析出 SHELL_ASSETS 数组");
  return [...block[1].matchAll(/"([^"]+)"/g)].map((m) => m[1]);
}

test("sw.js 的 SHELL_ASSETS 覆盖 src/ 下全部 ESM 模块", async () => {
  const sw = await readFile(join(ROOT, "sw.js"), "utf8");
  const declared = parseShellAssets(sw);

  const entries = await readdir(join(ROOT, "src"));
  const modules = entries.filter((f) => f.endsWith(".js"));
  // 守住测试本身：src/ 空了说明断言会退化成空转
  assert.ok(modules.length > 0, "src/ 下没有 .js 模块，本测试已失去意义");

  for (const f of modules) {
    assert.ok(
      declared.includes(`./src/${f}`),
      `src/${f} 未列入 sw.js 的 SHELL_ASSETS —— 离线时 app.js 的 import 会失败，整站停在骨架屏`
    );
  }
});

test("SHELL_ASSETS 同时含 ./ 与 ./index.html（两者是不同的 cache key）", async () => {
  const sw = await readFile(join(ROOT, "sw.js"), "utf8");
  const declared = parseShellAssets(sw);
  // "./" 服务根路径导航，"./index.html" 服务直接访问 + shellSwr 的离线 fallback。
  // 看似重复实为两个 key（/ 与 /index.html），删任一个都会让某条路径改走 fallback 分支。
  assert.ok(declared.includes("./"), "缺少 ./（根路径导航的缓存 key）");
  assert.ok(declared.includes("./index.html"), "缺少 ./index.html（离线 fallback 依赖它）");
});

test("shellSwr 的离线 fallback 指向 ./index.html", async () => {
  const sw = await readFile(join(ROOT, "sw.js"), "utf8");
  assert.match(
    sw,
    /caches\.match\(\s*"\.\/index\.html"\s*\)/,
    "shellSwr 的 fallback 应匹配 ./index.html，与 SHELL_ASSETS 保持一致"
  );
});
