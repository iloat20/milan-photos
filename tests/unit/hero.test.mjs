/**
 * 序厅域（src/hero.js）的单元测试。
 *
 * 覆盖范围刻意只有**纯判定**：工厂本体要 DOM（渲染 / 手势 / 监听），归 e2e 的十条
 * 例行（轮播切换 / 策展精选 / 配对源 / 模态暂停 / 空序厅导航…）。heroAutoAllowed
 * 是六闸门 AND，漏掉任何一门的症状都是「某种情况下轮播没停」——静默、难撞，
 * 故在这里逐一钉死。
 */
import test from "node:test";
import assert from "node:assert/strict";

import { heroAutoAllowed } from "../../src/hero.js";

/** 全闸门放行的基线：任何一项单独翻转都应变 false。 */
const open = {
  reduceMotion: false,
  userPaused: false,
  tempPaused: false,
  modalPaused: false,
  hidden: false,
  slideCount: 2,
};

test("heroAutoAllowed：全部放行时为 true（基线，防六闸门里混进一个恒真的写反）", () => {
  assert.equal(heroAutoAllowed(open), true);
  assert.equal(heroAutoAllowed({ ...open, slideCount: 8 }), true);
});

test("heroAutoAllowed：五个布尔闸门逐一验证（任一为真即停）", () => {
  for (const gate of ["reduceMotion", "userPaused", "tempPaused", "modalPaused", "hidden"]) {
    assert.equal(heroAutoAllowed({ ...open, [gate]: true }), false, `${gate} 为真时必须停`);
  }
});

test("heroAutoAllowed：张数是「至少两张」——单张与空序厅都停", () => {
  assert.equal(heroAutoAllowed({ ...open, slideCount: 1 }), false, "单张没有「轮」可言");
  assert.equal(heroAutoAllowed({ ...open, slideCount: 0 }), false, "空序厅必须停");
});

test("heroAutoAllowed：缺省参数按不放行处理（slideCount 缺省为 0）", () => {
  assert.equal(heroAutoAllowed(), false);
  assert.equal(heroAutoAllowed({ slideCount: 5 }), true, "只给张数时其余闸门默认放行");
});
