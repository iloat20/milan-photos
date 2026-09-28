/**
 * src/lightbox.js 的纯函数单测 —— Node 内置 test runner，零新增依赖。
 *
 * 覆盖从工厂里**具名导出**的计算：四段手势数学（clampPan / anchorRel / anchorZoom /
 * pinchZoom）与视图过渡源的选取规则（resolveVtSource）。它们此前埋在 app.js 的 IIFE 里，
 * 只能靠 e2e 端到端撞；抽出来之后边界条件（缩放钳制 1–4、平移钳到溢出半幅、锚点不变性、
 * 「list 非空时绝不反查展厅卡片」）可以直接钉住。
 *
 * 工厂本体（createLightbox）不在这里测：它调用即绑事件、要真实 DOM，
 * 归 e2e 管（tests/e2e/smoke.spec.js 有开合 / 深链 / 手势 / 窄屏 / 键盘 / 过渡源 等条目）。
 */
import test from "node:test";
import assert from "node:assert/strict";

import {
  MAX_ZOOM,
  clampPan,
  anchorRel,
  anchorZoom,
  pinchZoom,
  resolveVtSource,
} from "../../src/lightbox.js";

const close = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-9, `${msg ?? ""} (${a} !== ${b})`);

test("clampPan：未缩放时平移归零（画心与画框等大，任何位移都会露底）", () => {
  assert.deepEqual(clampPan(1, 800, 600, 120, -90), { tx: 0, ty: 0 });
  assert.deepEqual(clampPan(0.7, 800, 600, 120, -90), { tx: 0, ty: 0 });
});

test("clampPan：缩放态的平移上限 = 溢出半幅，超出即收边", () => {
  // 2× / 800×600 → 溢出 800×600 → 半幅 400×300
  assert.deepEqual(clampPan(2, 800, 600, 50, -20), { tx: 50, ty: -20 });
  assert.deepEqual(clampPan(2, 800, 600, 999, -999), { tx: 400, ty: -300 });
  assert.deepEqual(clampPan(2, 800, 600, -999, 999), { tx: -400, ty: 300 });
  // 边界值本身不越界（Math.min/max 的等号侧）
  assert.deepEqual(clampPan(2, 800, 600, 400, 300), { tx: 400, ty: 300 });
});

test("anchorRel：偏移以渲染矩形中心为原点（中心含平移量）", () => {
  const rect = { left: 100, top: 50, width: 400, height: 300 };
  // 中心 = (300, 200)
  assert.deepEqual(anchorRel(rect, 300, 200), { x: 0, y: 0 });
  assert.deepEqual(anchorRel(rect, 500, 50), { x: 200, y: -150 });
});

test("anchorZoom：锚点处画面点在缩放前后不动（公式核心不变量）", () => {
  const state = { zoom: 1, tx: 0, ty: 0 };
  const relX = 120;
  const relY = -40;
  const next = anchorZoom(state, 2, relX, relY);

  // 锚点屏幕坐标 = 中心 + rel。缩放后的画面点位置：
  //   中心 + T' + z' · (rel / z)  —— 应恒等于 中心 + T + rel
  const before = relX; // z = 1, T = 0
  const after = next.tx + next.zoom * (relX / state.zoom);
  close(after, before, "锚点横向漂移");
  close(next.ty + next.zoom * (relY / state.zoom), relY, "锚点纵向漂移");
});

test("anchorZoom：缩放下限 1、上限 MAX_ZOOM，且缩回 1 时平移一并归零", () => {
  assert.deepEqual(anchorZoom({ zoom: 2, tx: 30, ty: 40 }, 0.4, 10, 10), {
    zoom: 1,
    tx: 0,
    ty: 0,
  });
  assert.deepEqual(anchorZoom({ zoom: 1, tx: 0, ty: 0 }, 1, 5, 5), { zoom: 1, tx: 0, ty: 0 });

  const capped = anchorZoom({ zoom: 1, tx: 0, ty: 0 }, 99, 0, 0);
  assert.equal(capped.zoom, MAX_ZOOM);
  // rel 为 0 时锚点在中心，平移量应为 0
  assert.deepEqual(capped, { zoom: MAX_ZOOM, tx: 0, ty: 0 });
});

test("pinchZoom：中点压在同一个画面点上；d/d0 决定倍率", () => {
  const pinch = { d0: 100, mx0: 200, my0: 150, cx0: 200, cy0: 150, z0: 1, tx0: 0, ty0: 0 };
  // 指距翻倍 → 2×；中点与画面中心重合 → 无平移
  assert.deepEqual(pinchZoom(pinch, 200, 150, 200), { zoom: 2, tx: 0, ty: 0 });
  // 指距减半 → 缩回 1 并归零
  assert.deepEqual(pinchZoom(pinch, 200, 150, 50), { zoom: 1, tx: 0, ty: 0 });
  // 上限同样受 MAX_ZOOM 约束
  assert.equal(pinchZoom(pinch, 200, 150, 10_000).zoom, MAX_ZOOM);
});

test("pinchZoom：中点偏离画面中心时产生平移，且中点下的画面点守恒", () => {
  const pinch = { d0: 100, mx0: 200, my0: 150, cx0: 100, cy0: 100, z0: 1, tx0: 0, ty0: 0 };
  const next = pinchZoom(pinch, 260, 190, 200);
  // 画面点 p 的屏幕位置 = cx + (p·z + T)。中点在缩放前压在 (mx0, my0)。
  // 该点相对中心为 mx0 - cx0；缩放后应仍落在 (mx, my)。
  close(next.tx + 2 * (pinch.mx0 - pinch.cx0), 260 - pinch.cx0, "横向中点漂移");
  close(next.ty + 2 * (pinch.my0 - pinch.cy0), 190 - pinch.cy0, "纵向中点漂移");
});

test("pinchZoom：z0 已缩放时倍率按 z0 累积（相对当前值，而非绝对）", () => {
  const pinch = { d0: 100, mx0: 200, my0: 150, cx0: 200, cy0: 150, z0: 2, tx0: 10, ty0: 20 };
  const next = pinchZoom(pinch, 200, 150, 200);
  close(next.zoom, 4, "2× 基础上再翻倍");
  // 中点在中心 → 增量项为 0，只保留 T0
  close(next.tx, 10, "T0 应保留");
  close(next.ty, 20, "T0 应保留");
});

/* ─────────────── 视图过渡源的选取（序厅→灯箱，2026-09-28） ───────────────
   背景：原实现 open()/close() 各写一遍 `list ? null : cardImageAt(index)`，把
   「没有可配对的元素」与「会话跟随 list 索引」混成一个判据，结果序厅点击配到了
   屏外 284px 的展厅卡片。规则抽成纯函数后由本组钉住。 */

test("resolveVtSource：显式源优先，命中时不得再反查展厅卡片", () => {
  const explicit = { tagName: "IMG", from: "hero" };
  let called = 0;
  const cardAtIndex = () => {
    called += 1;
    return { tagName: "IMG", from: "card" };
  };

  assert.equal(resolveVtSource({ explicit, allowCard: true, cardAtIndex }), explicit);
  assert.equal(called, 0, "显式源命中时仍调用 cardAtIndex，会把源覆盖成屏外卡片");
});

test("resolveVtSource：无显式源且跟随 list → 无源，且不得反查卡片", () => {
  let called = 0;
  const cardAtIndex = () => {
    called += 1;
    return { tagName: "IMG", from: "card" };
  };

  assert.equal(resolveVtSource({ explicit: null, allowCard: false, cardAtIndex }), null);
  assert.equal(called, 0, "list 非空时 index 索引 list 而非 visible，反查必配错卡片");
});

test("resolveVtSource：无显式源且不跟随 list → 回退展厅卡片（画廊点击路径不变）", () => {
  const card = { tagName: "IMG", from: "card" };
  let called = 0;
  const cardAtIndex = () => {
    called += 1;
    return card;
  };

  assert.equal(resolveVtSource({ explicit: null, allowCard: true, cardAtIndex }), card);
  assert.equal(called, 1, "展厅点击路径必须仍然反查到卡片");
});
