/**
 * 安装引导域（PWA）——`beforeinstallprompt` 的保留与消费。
 *
 * 三条约束与 src/ 其它模块一致（见 AGENTS.md「src/ 模块的三条约束」）：
 *   1. **零副作用**：import 本模块不碰 DOM / window / matchMedia；
 *   2. **依赖树叶子**：不 import 其它 src 模块；
 *   3. 宿主按端口注入（`src/lightbox.js` 的工厂范式），状态收在闭包里。
 *
 * 为什么入口必须默认隐藏、只在事件到来后才显示：`beforeinstallprompt` 不是
 * Baseline（Firefox / iOS Safari 不派发），只有它真的到来才说明此刻这个浏览器
 * 可安装（安全上下文 + 满足安装条件 + 尚未安装）。反过来，若常驻显示，
 * 不支持的浏览器上就是一个点了没反应的死按钮。
 *
 * 时序：隐藏 → 事件到（preventDefault 并保留）→ 显示 → 用户点击 → prompt() 并
 * 消费掉事件 → 再隐藏。用户取消安装时 Chrome 可能再次派发该事件，入口随之复现，
 * 这正是期望行为，因此没有「只提示一次」的持久化标记。
 */

/**
 * 纯判定：此刻是否该显示安装入口。抽成具名导出是为了能在 Node 里直接单测
 * （工厂本身也能测，但这条规则的边界值得单独钉）。
 * @param {{hasPrompt:boolean, standalone:boolean, installed:boolean}} state
 */
export function shouldShowInstall({ hasPrompt, standalone, installed }) {
  return Boolean(hasPrompt) && !standalone && !installed;
}

/**
 * @param {{
 *   button: HTMLElement|null,
 *   win: EventTarget|null,
 *   matchMedia: ((q:string)=>MediaQueryList)|null,
 *   on: (el:EventTarget|null, type:string, handler:Function, opts?:object)=>void,
 * }} ports
 */
export function createInstallPrompt({ button, win, matchMedia, on }) {
  /** 已保留、尚未消费的 BeforeInstallPromptEvent（消费一次即作废） */
  let deferred = null;
  let installed = false;

  /** 已在独立窗口里跑（桌面安装 / 主屏图标）：再摆一个安装入口没有意义 */
  const isStandalone = () => {
    try {
      return Boolean(matchMedia && matchMedia("(display-mode: standalone)")?.matches);
    } catch {
      return false;
    }
  };

  const sync = () => {
    if (!button) return;
    button.hidden = !shouldShowInstall({
      hasPrompt: Boolean(deferred),
      standalone: isStandalone(),
      installed,
    });
  };

  on(win, "beforeinstallprompt", (e) => {
    // preventDefault 两件事：压掉浏览器自带的（已废弃）mini-infobar，
    // 并保住事件对象——不拦截的话它当场作废，prompt() 之后调不动。
    if (typeof e.preventDefault === "function") e.preventDefault();
    deferred = e;
    installed = false;
    sync();
  });

  on(win, "appinstalled", () => {
    deferred = null;
    installed = true;
    sync();
  });

  on(button, "click", async () => {
    if (!deferred) return;
    const promptEvent = deferred;
    // 先清再 await：事件只能被消费一次，用户连点两下不该调两次 prompt()。
    // 不读 userChoice —— 接受/取消都得把入口收起来（取消后浏览器会重发事件）。
    deferred = null;
    sync();
    try {
      await promptEvent.prompt();
    } catch {
      /* 被浏览器收回 / 用户取消：保持隐藏即可 */
    }
  });

  sync();
  return { sync, isStandalone };
}
