/**
 * 安装引导域（src/install.js）的单元测试。
 *
 * 为什么有这个文件：`shouldShowInstall` 的 JSDoc 从落地起就写着「抽成具名导出
 * 是为了能在 Node 里直接单测」，但测试一直缺席（2026-10-17 审查补齐）。
 * 这条判据的后果全在「静默」一侧：写反了不报任何错 —— 按钮要么在不支持安装的
 * 浏览器上常驻成死按钮，要么该出现时永不出现；两者都只有装过 PWA 的浏览器才撞得到。
 *
 * 工厂本体里真正依赖浏览器的只有 prompt() 弹窗本身，事件时序契约（保留一次性
 * 事件 → 显示 → 消费一次 → 收起 → 浏览器重发再显示）用假端口在 Node 里就能
 * 完整钉住 —— 不需要 DOM，与 `shouldShowInstall` 同一动机。
 */
import test from "node:test";
import assert from "node:assert/strict";

import { shouldShowInstall, createInstallPrompt } from "../../src/install.js";

test("shouldShowInstall：只有「有事件 + 非独立窗口 + 未安装」三者同时成立才显示", () => {
  const base = { hasPrompt: true, standalone: false, installed: false };
  assert.equal(shouldShowInstall(base), true);
  // 三门逐一翻转
  assert.equal(shouldShowInstall({ ...base, hasPrompt: false }), false);
  assert.equal(shouldShowInstall({ ...base, standalone: true }), false);
  assert.equal(shouldShowInstall({ ...base, installed: true }), false);
  // 全空对象（字段缺省）：按 false 兜底，不抛错
  assert.equal(shouldShowInstall({}), false);
});

/* ────────────────────────── 工厂：事件时序契约 ────────────────────────── */

/** 假按钮：只需 hidden 属性 + addEventListener（工厂仅消费这两项）。 */
function makeButton() {
  const listeners = new Map();
  return {
    hidden: true,
    addEventListener(type, fn) {
      if (!listeners.has(type)) listeners.set(type, []);
      listeners.get(type).push(fn);
    },
    /** 模拟点击（awaits 异步监听器，让 prompt() 的 await 链跑完） */
    async click() {
      for (const fn of listeners.get("click") || []) await fn();
    },
  };
}

/** 模拟 BeforeInstallPromptEvent：可拦截、可 prompt，自带调用计数。 */
class FakeInstallEvent extends Event {
  constructor() {
    super("beforeinstallprompt");
    this.intercepted = false;
    this.promptCalls = 0;
  }

  preventDefault() {
    this.intercepted = true;
  }

  async prompt() {
    this.promptCalls += 1;
  }
}

function setup({ standalone = false } = {}) {
  const button = makeButton();
  const win = new EventTarget();
  createInstallPrompt({
    button,
    win,
    matchMedia: () => ({ matches: standalone }),
    on: (el, type, fn) => el && el.addEventListener(type, fn),
  });
  return { button, win };
}

test("初始隐藏；事件到来后显示，且事件被 preventDefault 保住（否则当场作废）", () => {
  const { button, win } = setup();
  assert.equal(button.hidden, true, "无事件时不该显示入口");

  const event = new FakeInstallEvent();
  win.dispatchEvent(event);
  assert.equal(button.hidden, false, "事件到来即显示");
  assert.equal(event.intercepted, true, "必须 preventDefault 保留一次性事件对象");
});

test("点击消费一次 prompt() 并收起；连点不重复弹窗；浏览器重发事件再现", async () => {
  const { button, win } = setup();
  const event = new FakeInstallEvent();
  win.dispatchEvent(event);

  await button.click();
  assert.equal(event.promptCalls, 1, "点击应消费保留的事件");
  assert.equal(button.hidden, true, "消费后立即收起（不等用户选择结果）");

  await button.click();
  assert.equal(event.promptCalls, 1, "deferred 已清，连点不得重复 prompt()");

  // 用户取消安装后浏览器会重发事件，入口随之复现 —— 这是期望行为（无持久化标记）
  const again = new FakeInstallEvent();
  win.dispatchEvent(again);
  assert.equal(button.hidden, false, "重发事件后入口复现");
});

test("appinstalled 后入口保持隐藏（即便旧事件尚在）", () => {
  const { button, win } = setup();
  win.dispatchEvent(new FakeInstallEvent());
  assert.equal(button.hidden, false);

  win.dispatchEvent(new Event("appinstalled"));
  assert.equal(button.hidden, true, "已安装后不再摆入口");
});

test("独立窗口（display-mode: standalone）即便有事件也不显示", () => {
  const { button, win } = setup({ standalone: true });
  win.dispatchEvent(new FakeInstallEvent());
  assert.equal(button.hidden, true, "独立窗口里安装入口没有意义");
});

test("prompt() 抛错（事件被浏览器收回）不冒泡，入口保持收起", async () => {
  const { button, win } = setup();
  const event = new FakeInstallEvent();
  event.prompt = async () => {
    throw new Error("reclaimed");
  };
  win.dispatchEvent(event);

  await button.click(); // 不抛
  assert.equal(button.hidden, true, "失败路径与成功路径一样收起");
});
