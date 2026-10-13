/**
 * `photos/` 产物清单的单元测试（P-1：母版移出产物）。
 *
 * 为什么值得单测：母版是否进产物，**没有任何页面会因此报错** ——
 * 多拷了只是浪费 5.4 MB；少拷了只有「前端兜底请求母版」的那条路径会 404，
 * 而那 18 件全都不走兜底（本文件最后一条就是钉这个）。所以规则本身要被钉死，
 * 而不是靠 e2e 去撞。
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
  needsMasterSource,
  referencedPhotoPaths,
} from "../../tools/photo-assets.mjs";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const MANIFEST = JSON.parse(
  fs.readFileSync(path.join(ROOT, "photos", "manifest.json"), "utf8")
);

/* ────────────────────────── 保留条件 ────────────────────────── */

test("needsMasterSource：动图与无缩略图的条目必须保留母版", () => {
  const withThumb = {
    src: "photos/a.jpg",
    thumb: "photos/thumbs/a.webp",
    medium: "photos/medium/a.webp",
  };
  assert.equal(needsMasterSource(withThumb), false, "跑过 sync 的静态图不该留母版");

  // 无 thumb：app.js 的 `thumb || src` 会落到 src，不留给它就 404
  assert.equal(needsMasterSource({ ...withThumb, thumb: "" }), true);
  assert.equal(needsMasterSource({ src: "photos/a.jpg" }), true);

  // 动图：lightboxSrc 的 animated 分支直接播原文件（sync 不生成 medium 避免冻帧）
  assert.equal(needsMasterSource({ ...withThumb, animated: true }), true);

  // 空值不炸
  assert.equal(needsMasterSource(null), true, "没有条目信息时保守保留");
  assert.equal(needsMasterSource(undefined), true);
});

test("masterSourcesToKeep：只留被触达的 src，去重且排序", () => {
  const photos = [
    { src: "photos/b.jpg", thumb: "photos/thumbs/b.webp" },
    { src: "photos/a.jpg" }, // 无 thumb → 留
    { src: "photos/b.jpg", thumb: "" }, // 与第 1 条同一个 src，但这条要留
    { src: "photos/c.jpg", thumb: "photos/thumbs/c.webp", animated: true }, // 动图 → 留
  ];
  assert.deepEqual(masterSourcesToKeep(photos), ["photos/a.jpg", "photos/b.jpg", "photos/c.jpg"]);
  assert.deepEqual(masterSourcesToKeep([]), []);
});

/* ────────────────────────── 引用集合 ────────────────────────── */

test("referencedPhotoPaths：srcset 拆项、src 仅在触达时计入、非 photos/ 字段忽略", () => {
  const photos = [
    {
      file: "a.jpg", // 不以 photos/ 开头 → 不是路径引用
      src: "photos/a.jpg", // 有 thumb 且非动图 → 不计入
      thumb: "photos/thumbs/a.webp",
      thumbSrcset: "photos/thumbs/a-400.webp 400w, photos/thumbs/a.webp 1024w",
      mediumSrcset: "photos/medium/a.webp 1280w",
      date: "2026-01-01",
      palette: { wall: "#fff" }, // 对象字段不能当路径
    },
    { src: "photos/b.jpg", thumb: "" }, // 无 thumb → src 必须计入
  ];
  assert.deepEqual(referencedPhotoPaths(photos), [
    "photos/b.jpg",
    "photos/medium/a.webp",
    "photos/thumbs/a-400.webp",
    "photos/thumbs/a.webp",
  ]);
});

test("referencedPhotoPaths：不靠白名单字段名，新档位字段自动被接管", () => {
  /* 这条钉的是「字段名白名单会腐坏」这件事：P-2 刚加 mediumSrcset /
     mediumAvifSrcset，若这里靠白名单，下一次 sync 加档位时守卫会静默失灵。 */
  const photo = {
    src: "photos/a.jpg",
    thumb: "photos/thumbs/a.webp",
    futureSrcset: "photos/thumbs/a-未来.webp 9999w",
  };
  const refs = referencedPhotoPaths([photo]);
  assert.ok(refs.includes("photos/thumbs/a-未来.webp"), "新档位字段必须自动被接管");
  assert.ok(!refs.includes("photos/a.jpg"), "有 thumb 的条目不该把 src 算进引用");
});

/* ────────────────────────── 真 manifest 契约 ────────────────────────── */

test("真 manifest：本仓 18 件无需保留任何母版（P-1 主判据）", () => {
  const kept = masterSourcesToKeep(MANIFEST.photos);
  assert.deepEqual(kept, [], `这些母版被认为必须保留：${kept.join(", ")}——请确认是动图或无缩略图条目`);

  // 反向自证：源目录里**确实有**母版，否则上面那条是空架子
  const sources = fs
    .readdirSync(path.join(ROOT, "photos"))
    .filter((n) => /\.(?:jpe?g|png|gif|webp|avif)$/i.test(n));
  assert.ok(sources.length >= 18, `photos/ 源目录只有 ${sources.length} 个母版，样本不足`);
});

test("真 manifest：被请求的路径全部落在派生图目录，无一指向母版", () => {
  const refs = referencedPhotoPaths(MANIFEST.photos);
  assert.ok(refs.length > 0, "引用集合为空 —— 下面的断言会变成空架子");
  for (const rel of refs) {
    assert.match(
      rel,
      /^photos\/(?:thumbs|medium)\//,
      `${rel} 不在派生图目录 —— 它可能是母版，P-1 之后线上不存在`
    );
  }
  // 反向自证：缩略图与中图两类**都**被覆盖到了
  assert.ok(refs.some((r) => r.startsWith("photos/thumbs/")));
  assert.ok(refs.some((r) => r.startsWith("photos/medium/")));
});
