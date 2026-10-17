/**
 * `photos/` 产物清单的单元测试（2026-10-17 起：原图直出，母版全量进产物）。
 *
 * 为什么值得单测：母版是否进产物，**没有任何页面会因此报错** —— 少拷了只有
 * 「看画链路请求母版」的那条路径会 404（观画室 / 逐图展签页 / 分享卡 / 爬虫），
 * 而本地预览与页面渲染都可能假装正常。所以规则本身要被钉死，而不是靠 e2e 去撞。
 *
 * 三层分工：
 *   - 本文件钉**规则**（保留条件 / 引用集合的形状），合成样本 + 真 manifest 各一遍；
 *   - e2e globalSetup 对策 6 对着 dist 核对「拷对了什么」（那里才看得见构建产物）；
 *   - gen-work-pages.test.mjs 钉「页面引用的每个路径都在引用集合里」（爬虫视角）。
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  masterSourcesToKeep,
  referencedPhotoPaths,
} from "../../tools/photo-assets.mjs";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const MANIFEST = JSON.parse(
  fs.readFileSync(path.join(ROOT, "photos", "manifest.json"), "utf8")
);

/* ────────────────────────── 保留条件 ────────────────────────── */

test("masterSourcesToKeep：全部 src 都保留（原图直出），去重且排序", () => {
  const photos = [
    { src: "photos/b.jpg", thumb: "photos/thumbs/b.webp" },
    { src: "photos/a.jpg" },
    { src: "photos/b.jpg", thumb: "" },
    { src: "photos/c.gif", thumb: "photos/thumbs/c.webp", animated: true },
  ];
  assert.deepEqual(masterSourcesToKeep(photos), ["photos/a.jpg", "photos/b.jpg", "photos/c.gif"]);
  // 反退化：有缩略图、非动图的条目也必须留母版（旧 P-1 规则只留动图/无缩略图）
  assert.ok(
    masterSourcesToKeep(photos).includes("photos/b.jpg"),
    "有 thumb 的条目被漏掉 —— 旧 P-1 的剪枝规则回流了"
  );
  // 空 / 非字符串 src 不炸、不入列
  assert.deepEqual(masterSourcesToKeep([{ src: "" }, {}, null]), []);
  assert.deepEqual(masterSourcesToKeep([]), []);
  assert.deepEqual(masterSourcesToKeep(null), []);
});

/* ────────────────────────── 引用集合 ────────────────────────── */

test("referencedPhotoPaths：src 与 srcset 拆项都计入，非 photos/ 字段忽略", () => {
  const photos = [
    {
      file: "a.jpg",
      src: "photos/a.jpg",
      thumb: "photos/thumbs/a.webp",
      thumbSrcset: "photos/thumbs/a-400.webp 400w, photos/thumbs/a.webp 1024w",
      medium: "photos/medium/a.webp",
      date: "2026-01-01",
      palette: { wall: "#fff" },
    },
    { src: "photos/b.jpg", thumb: "" },
  ];
  assert.deepEqual(referencedPhotoPaths(photos), [
    "photos/a.jpg",
    "photos/b.jpg",
    "photos/medium/a.webp",
    "photos/thumbs/a-400.webp",
    "photos/thumbs/a.webp",
  ]);
});

test("referencedPhotoPaths：不靠白名单字段名，新档位字段自动被接管", () => {
  const photo = {
    src: "photos/a.jpg",
    thumb: "photos/thumbs/a.webp",
    futureSrcset: "photos/thumbs/a-未来.webp 9999w",
  };
  const refs = referencedPhotoPaths([photo]);
  assert.ok(refs.includes("photos/thumbs/a-未来.webp"), "新档位字段必须自动被接管");
  assert.ok(refs.includes("photos/a.jpg"), "原图直出：src 必须计入引用");
  assert.ok(
    !refs.includes("photos/thumbs/a-未来.webp 9999w"),
    "srcset 必须拆项，不能整串计入"
  );
});

/* ────────────────────────── 真 manifest 契约 ────────────────────────── */

test("真 manifest：18 件的母版全部保留，且文件真实存在（原图直出主判据）", () => {
  const kept = masterSourcesToKeep(MANIFEST.photos);
  assert.equal(
    kept.length,
    MANIFEST.photos.length,
    "每件作品都必须有母版进产物（少拷 = 访客/爬虫 404）"
  );
  // 反向自证：源目录里**确实有**这些母版文件，否则上面那条是空架子
  for (const rel of kept) {
    assert.ok(fs.existsSync(path.join(ROOT, rel)), `母版不存在：${rel}`);
  }
});

test("真 manifest：引用集合同时覆盖母版与派生图目录", () => {
  const refs = referencedPhotoPaths(MANIFEST.photos);
  assert.ok(refs.length > 0, "引用集合为空 —— 下面的断言会变成空架子");
  for (const p of MANIFEST.photos) {
    assert.ok(refs.includes(p.src), `${p.file} 的母版不在引用集合里`);
  }
  // 派生图仍被引用（序厅与展厅列表还走它们）：两类目录都要覆盖到
  assert.ok(refs.some((r) => r.startsWith("photos/thumbs/")));
  assert.ok(refs.some((r) => r.startsWith("photos/medium/")));
});
