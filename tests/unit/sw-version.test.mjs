/**
 * SW 缓存版本号（tools/sw-version.mjs）的单元测试。
 *
 * 契约只有两条：**任一份输入变化即变**、**占位符恰好出现一次**。
 * 前者错了 → 图片/壳层换版后访客仍吃旧缓存（`photos/medium/*` 走 cacheFirst，
 * 命中即返回、永不回源，症状极难发现）；后者错了 → 版本注入静默失效，
 * 退回手工递增，而「忘了改」正是这件事要消灭的。
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  BUILD_ID_PLACEHOLDER,
  BUILD_ID_RE,
  computeBuildId,
  injectBuildId,
} from "../../tools/sw-version.mjs";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

const BASE = { html: "<html>A</html>", js: "var a=1;", css: "a{}", manifest: "{}" };

/* ────────────────────────── 指纹 ────────────────────────── */

test("computeBuildId：四份输入**每一份**变化都会换指纹（含 manifest）", () => {
  const id = computeBuildId(BASE);
  assert.match(id, BUILD_ID_RE, "版本号形状被 OWNED_CACHE_RE 依赖");
  for (const key of Object.keys(BASE)) {
    const changed = computeBuildId({ ...BASE, [key]: `${BASE[key]}x` });
    assert.notEqual(changed, id, `${key} 变了但指纹没变`);
  }
});

test("computeBuildId：稳定（同输入同输出），且各段之间有分隔符", () => {
  assert.equal(computeBuildId(BASE), computeBuildId({ ...BASE }));
  // 缺分隔符时 ("ab","c") 与 ("a","bc") 会拼成同一串
  assert.notEqual(
    computeBuildId({ html: "ab", js: "c" }),
    computeBuildId({ html: "a", js: "bc" })
  );
});

/* ────────────────────────── 注入 ────────────────────────── */

test("injectBuildId：替换成功；占位符必须恰好一次；版本号形状必须合法", () => {
  const src = `const VERSION = "${BUILD_ID_PLACEHOLDER}";`;
  assert.equal(injectBuildId(src, "milan-0123abcd"), 'const VERSION = "milan-0123abcd";');

  // 0 次：源码里已被人写死 → 「自动注入」静默失效，必须报错
  assert.throws(
    () => injectBuildId('const VERSION = "milan-v49";', "milan-0123abcd"),
    /恰好出现 1 次/
  );
  // 2 次：注释里也写了占位符 → 替换会误伤说明文字
  assert.throws(
    () => injectBuildId(`${BUILD_ID_PLACEHOLDER} + ${BUILD_ID_PLACEHOLDER}`, "milan-0123abcd"),
    /恰好出现 1 次/
  );
  assert.throws(() => injectBuildId(src, "milan-v49"), /形状不合法/);
  assert.throws(() => injectBuildId(src, "milan-0123456"), /形状不合法/);
});

/* ────────────────────────── 真源码契约 ────────────────────────── */

test("真 public/sw.js：VERSION 是占位符（未被手工写死），且占位符只出现一次", () => {
  const src = fs.readFileSync(path.join(ROOT, "public", "sw.js"), "utf8");
  assert.equal(
    src.split(BUILD_ID_PLACEHOLDER).length - 1,
    1,
    "占位符必须恰好出现一次（0 次 = 被写死；多次 = 注释里也写了它）"
  );
  assert.match(
    src,
    new RegExp(`const VERSION = "${BUILD_ID_PLACEHOLDER}";`),
    "VERSION 必须由构建期注入"
  );
  assert.ok(
    !/const VERSION = "milan-v\d+"/.test(src),
    "VERSION 又退回手工递增了 —— 那正是本次要消灭的东西"
  );
});
