/**
 * 观画室（lightbox）域 —— 状态机 + 缩放/平移 + 指针手势。
 *
 * **为什么是工厂而不是模块级单例**：`src/` 的三条约束（见 AGENTS.md）要求 import
 * 阶段**零副作用**，否则 Node 端 `import` 会直接抛错、单测根本加载不起来。本模块在
 * import 时不触碰任何 DOM / window；只有 `createLightbox(ports)` 被调用时，才开始使用
 * 宿主传进来的引用。
 *
 * 收益是状态内聚：`pos` / `zoom` / `tx` / `ty` / `preloadDir` / `list` / `returnFocus`
 * 以及全部手势中间量（`swipeX` / `pointers` / `pinch` / `panBase` …）都收进工厂闭包，
 * `app.js` 侧**不再有任何灯箱态**，也不再有灯箱事件监听 —— 只保留一个 `lb` 句柄。
 *
 * **依赖方向**：`lightbox.js` → `util.js`（纯函数叶子）；不反向 import `app.js`，无环。
 * 跨域能力一律走端口注入，见 `createLightbox` 的 JSDoc。
 */
import { displayTitle, lightboxSrc, lightboxAvifOrFallback } from "./util.js";

/* ────────────────────────── 纯数学（可被单测直接覆盖） ──────────────────────────
   刻意导出：这四段是本域唯一有真实边界条件（缩放钳制 1–4、平移钳到溢出半幅、
   锚点不变性）的计算，但原先埋在 IIFE 里只能靠 e2e 端到端撞。抽出来后
   `tests/unit/lightbox.test.mjs` 可以直接钉住公式。 */

/** 缩放上限。4× 已能看清细节，再大只剩像素噪点。 */
export const MAX_ZOOM = 4;

/** 平移上限 = 缩放溢出的半幅，超出就会露底（画心之外是墙面色信箱）。 */
export function clampPan(zoom, w, h, tx, ty) {
  if (zoom <= 1) return { tx: 0, ty: 0 };
  const maxX = (w * (zoom - 1)) / 2;
  const maxY = (h * (zoom - 1)) / 2;
  return {
    tx: Math.min(maxX, Math.max(-maxX, tx)),
    ty: Math.min(maxY, Math.max(-maxY, ty)),
  };
}

/** 锚点相对渲染矩形中心的屏幕偏移（变换围绕中心，中心含平移量）。 */
export function anchorRel(rect, clientX, clientY) {
  return {
    x: clientX - (rect.left + rect.width / 2),
    y: clientY - (rect.top + rect.height / 2),
  };
}

/** 锚点缩放：T' = T + rel · (1 − z′/z)。该系数使 rel 处的画面点在缩放前后不动。 */
export function anchorZoom(state, nextZoom, relX, relY) {
  const z = Math.min(MAX_ZOOM, Math.max(1, nextZoom));
  if (z <= 1) return { zoom: 1, tx: 0, ty: 0 };
  const k = 1 - z / state.zoom;
  return { zoom: z, tx: state.tx + relX * k, ty: state.ty + relY * k };
}

/** 捏合：两指中点压在同一个画面点上。
 *  T' = (中点 − 画面中心) + T₀ − (z′/z₀) · (中点₀ − 画面中心₀)
 *  调用方须保证 `pinch.d0` 与 `d` 非零（原实现用 `|| 1` 兜底，保持在同一位置）。 */
export function pinchZoom(pinch, mx, my, d) {
  const z = Math.min(MAX_ZOOM, Math.max(1, pinch.z0 * (d / pinch.d0)));
  if (z <= 1) return { zoom: 1, tx: 0, ty: 0 };
  return {
    zoom: z,
    tx: mx - pinch.cx0 + pinch.tx0 - (z / pinch.z0) * (pinch.mx0 - pinch.cx0),
    ty: my - pinch.cy0 + pinch.ty0 - (z / pinch.z0) * (pinch.my0 - pinch.cy0),
  };
}

/**
 * 创建一个观画室控制器。调用即完成事件装配（按钮 / 手势 / 滚轮 / Esc / 方向键），
 * 宿主随后只需要 `open()`。
 *
 * @param {object} ports
 * @param {HTMLElement|null} ports.lightbox   `<dialog id="lightbox">`
 * @param {HTMLImageElement|null} ports.img   `#lbImg`
 * @param {HTMLSourceElement|null} ports.source `#lbSource`（AVIF 协商）
 * @param {HTMLElement|null} ports.title      `#lbTitle`（无字陈列下恒空）
 * @param {HTMLElement|null} ports.prevBtn / nextBtn / closeBtn
 * @param {(el:any,type:string,fn:Function,opts?:any)=>void} ports.on
 *        绑定守卫：元素缺失时静默降级，而不是抛 TypeError 中断整个 IIFE。
 * @param {() => object[]} ports.getList      当前筛选下的可见序列（`app.js` 的 `visible`）
 * @param {(index:number) => HTMLImageElement|null} ports.cardImageAt
 *        视图过渡配对：把展厅第 index 张卡片的 `<img>` 与灯箱画心连成同一个
 *        `view-transition-name`，让「画心从卡片位置放大到灯箱」有连续动画。
 * @param {(href:string, priority:string) => void} ports.preload   图片预载（rel=preload）
 * @param {(palette:object|null) => void} ports.applyRoom          把墙色写进 `<dialog>` 的 CSS 变量
 * @param {(img:HTMLImageElement) => object|null} ports.sampleRoom 无预计算调色板时的兜底采样
 * @param {(hash:string) => void} ports.setHash                    replaceState 写深链
 * @param {() => string} ports.filterHash                          当前筛选对应的 `#f` 值
 * @param {() => boolean} ports.prefersVT
 * @param {(update:()=>void) => object} ports.startVT
 * @returns {{open:(index:number, invoker?:Element|null, list?:object[]|null)=>void, isOpen:()=>boolean}}
 *          `close` 刻意不导出：关闭路径只有三条（关闭按钮 / Esc cancel / 无），全在本域内闭环。
 */
export function createLightbox({
  lightbox,
  img,
  source,
  title,
  prevBtn,
  nextBtn,
  closeBtn,
  on,
  getList,
  cardImageAt,
  preload,
  applyRoom,
  sampleRoom,
  setHash,
  filterHash,
  prefersVT,
  startVT,
}) {
  /* —— 状态（原先散落在 app.js 的十余个模块级 let，现在全部内聚于此） —— */
  let pos = 0;
  /** 导航序列；null 表示跟随当前筛选 */
  let list = null;
  let returnFocus = null;
  let zoom = 1;
  let tx = 0;
  let ty = 0;
  /** 相邻预载只跟前进方向：反向预测价值低（用户大量操作是单向翻页），
   *  而每次翻页同时预载前后两张 = 100KB 级中图 ×2，弱网下明显浪费。 */
  let preloadDir = 1;

  /* —— 点击手势的「连击组」——
     单击切图与双击缩放共用同一个舞台，而 click 事件**无法预知自己是不是双击的第一击**。
     旧实现用固定 450ms 的 tapTimer 去猜，两个后果：

       · tapTimer 与浏览器双击窗口（系统可设 200–900ms，默认 500）不对齐：落在灰区时
         两次 click 各前进一张 —— 用户只想放大，却跳过了两张画；
       · 双击时 click 先 step 再 step(-1)，中途的 sync 已把 zoom 打回 1，于是
         toggleZoomAt 的 `if (zoom > 1)` 分支**永不可达** —— 双击只能进不能出。

     新实现不再猜：**由浏览器的 dblclick 事件做权威裁决**，我们只记住「这一组点击从哪个
     位置开始」，回退目标是**绝对位置**而非相对步数 —— 不管浏览器何时认定双击，结果一致。
     顺带实现 styles.css 早已声明的意图（`.lightbox-img.is-zoomed { cursor: zoom-out }`）：
     放大态单击 = 缩回。

     GROUP_MS 只用于「记不记得起点」，不用于「判不判定双击」：没有 dblclick 时起点信息不
     产生任何效果（见 dblclick 处理器），所以取 1000ms（长于系统双击窗口上界 900ms）没有
     副作用。这是与旧 tapTimer 最本质的区别 —— 窗口错配的后果被限制为「起点被提前重置」，
     而不是「多切一张」。 */
  const GROUP_MS = 1000;
  let groupAt = 0;
  let groupStart = 0;
  /** 本组种类："" = 未开启；"adv" = 1× 态切图组；"out" = 放大态缩回组 */
  let groupKind = "";

  function resetGroup() {
    groupKind = "";
    groupAt = 0;
  }

  /** 当前导航序列：显式 list 优先，否则跟随筛选 */
  const photos = () => list || getList();

  /* ────────────────────────── 缩放 / 平移 ────────────────────────── */

  function applyTransform() {
    if (!img) return;
    img.style.setProperty("--lb-zoom", String(zoom));
    img.style.setProperty("--lb-tx", `${tx}px`);
    img.style.setProperty("--lb-ty", `${ty}px`);
    img.classList.toggle("is-zoomed", zoom > 1);
  }

  function resetZoom(instant) {
    zoom = 1;
    tx = 0;
    ty = 0;
    // instant：借 is-panning 的 transition:none 瞬时归位（VT 快照用）
    if (instant && img) img.classList.add("is-panning");
    applyTransform();
    if (instant && img) img.classList.remove("is-panning");
  }

  /** 把当前 (zoom, tx, ty) 收进合法范围。仅缩放态需要读布局，故先短路。 */
  function applyPan() {
    if (!img) {
      if (zoom <= 1) {
        tx = 0;
        ty = 0;
      }
      return;
    }
    const next = clampPan(zoom, img.offsetWidth, img.offsetHeight, tx, ty);
    tx = next.tx;
    ty = next.ty;
  }

  function relTo(clientX, clientY) {
    if (!img) return { x: 0, y: 0 };
    return anchorRel(img.getBoundingClientRect(), clientX, clientY);
  }

  function zoomAt(nextZoom, relX, relY) {
    const next = anchorZoom({ zoom, tx, ty }, nextZoom, relX, relY);
    zoom = next.zoom;
    tx = next.tx;
    ty = next.ty;
    if (zoom <= 1) {
      tx = 0;
      ty = 0;
    } else {
      applyPan();
    }
    applyTransform();
  }

  function toggleZoomAt(clientX, clientY) {
    if (zoom > 1) {
      resetZoom(false);
      return;
    }
    const rel = relTo(clientX, clientY);
    zoomAt(2.5, rel.x, rel.y);
  }

  /* ────────────────────────── 开 / 关 ────────────────────────── */

  function open(index, invoker, nextList) {
    // 灯箱 DOM 缺失（HTML 结构变化 / SW 旧壳层配新页面）时静默降级
    if (!lightbox) return;
    // 连击组不跨会话（同 close）
    resetGroup();
    list = nextList && nextList.length ? nextList : null;
    const sourceImg = list ? null : cardImageAt(index);
    if (sourceImg) sourceImg.style.viewTransitionName = "milan-lightbox-img";
    pos = index;
    returnFocus = invoker || sourceImg?.closest(".card") || null;

    const finish = () => {
      if (sourceImg) sourceImg.style.viewTransitionName = "";
    };

    const reveal = () => {
      sync();
      if (!lightbox.open) lightbox.showModal();
      document.body.classList.add("lb-open");
      if (closeBtn) closeBtn.focus();
    };

    if (prefersVT()) {
      // startVT 已把 finished/ready/updateCallbackDone 全部接住；这里再 .catch 一次
      // 是因为 finish() 自身也可能在 skip 后 reject（见 startVT 注释）。
      const t = startVT(() => {
        if (sourceImg) sourceImg.style.viewTransitionName = "";
        reveal();
        if (img) img.style.viewTransitionName = "milan-lightbox-img";
      });
      t.finished.finally(finish).catch(() => {
        /* VT 被后续 transition skip 时 finished reject（InvalidStateError），吞掉勿冒泡 */
      });
    } else {
      reveal();
      finish();
    }
  }

  function close() {
    if (!lightbox) return;
    // 连击组不跨会话：否则重开灯箱后的一次 dblclick 会把画面倒回上一轮的位置
    resetGroup();
    // 瞬时复位缩放：VT 的 old 快照要以完整画面回卡片
    resetZoom(true);
    const sourceImg = list ? null : cardImageAt(pos);
    const returnEl = returnFocus || sourceImg?.closest(".card") || null;
    returnFocus = null;
    list = null;

    const restoreFocus = () => {
      if (returnEl && typeof returnEl.focus === "function") {
        returnEl.focus({ preventScroll: true });
      }
    };
    const closeUpdate = () => {
      if (img) img.style.viewTransitionName = "";
      lightbox.close();
      document.body.classList.remove("lb-open");
      if (sourceImg) sourceImg.style.viewTransitionName = "milan-lightbox-img";
      // 关灯箱恢复筛选深链（all 时清空）
      setHash(filterHash());
    };

    if (prefersVT()) {
      // 复用 closeUpdate，勿内联复制：此前内联漏掉 setHash，导致 VT 分支关灯箱后 hash 残留 #p
      const t = startVT(() => {
        closeUpdate();
      });
      t.finished
        .finally(() => {
          if (sourceImg) sourceImg.style.viewTransitionName = "";
          restoreFocus();
        })
        .catch(() => {
          /* VT 被后续 transition skip 时 finished reject（InvalidStateError），吞掉勿冒泡 */
        });
    } else {
      closeUpdate();
      if (sourceImg) sourceImg.style.viewTransitionName = "";
      restoreFocus();
    }
  }

  /* ────────────────────────── 换图 ────────────────────────── */

  function preloadNeighbor(delta) {
    const arr = photos();
    if (!arr.length) return;
    const next = arr[(pos + delta + arr.length) % arr.length];
    // 走 rel=preload：带 type=image/avif 时老浏览器免下无效图，与灯箱选中一致可复用。
    // 只预载**一个**方向（由 step() 记录的 preloadDir 决定），不再前后各一张。
    preload(lightboxAvifOrFallback(next), "low");
  }

  function sync() {
    if (!lightbox || !img) return;
    const arr = photos();
    const photo = arr[pos];
    if (!photo) return;
    // 换图复位缩放/平移
    resetZoom(false);
    const titleText = displayTitle(photo, pos);
    // AVIF source 优先；动图/无中图留空，浏览器回退 img.src
    if (source) source.srcset = photo.animated ? "" : photo.mediumAvif || "";
    img.src = lightboxSrc(photo);
    img.alt = titleText;
    if (title) title.textContent = "";
    const frame = lightbox.querySelector(".lightbox-frame");
    if (frame) {
      frame.classList.remove("is-lit");
      void frame.offsetWidth;
      frame.classList.add("is-lit");
    }
    if (photo.palette) {
      // 预计算调色板：直接切到本张的墙色。不先清空 —— 清空再设会在同一帧内被
      // 浏览器合并成跳变，观画室失去 0.65s 的墙色过渡；直接设则是「上一张墙色
      // → 本张墙色」的连续过渡，左右翻看时更顺。
      applyRoom(photo.palette);
    } else {
      // 上传图无预计算值：先清空，等中图解码后再采样（与 P1-6 前行为一致）
      applyRoom(null);
      const roomSync = () => applyRoom(sampleRoom(img));
      if (img.complete) roomSync();
      else img.addEventListener("load", roomSync, { once: true });
    }
    img.style.animation = "none";
    void img.offsetWidth;
    img.style.animation = "";
    preloadNeighbor(preloadDir);
    // 深链：初开与单击切图都经这里，#p 始终指向当前画
    if (photo.id != null) setHash("p=" + encodeURIComponent(photo.id));
  }

  /** 实际位移。是否作废连击组由调用方决定（见下方的 step 与 click 处理器）。 */
  function moveBy(delta) {
    const arr = photos();
    if (!arr.length) return;
    // 记录翻页方向，供 preloadNeighbor 单向预载
    if (delta !== 0) preloadDir = delta > 0 ? 1 : -1;
    pos = (pos + delta + arr.length) % arr.length;
    sync();
  }

  /** 显式翻页（箭头 / 键盘 / 横滑）。这些路径与点击连击无关，**必须**作废连击组：
   *  否则挂在旧起点上的 dblclick 会把画面一次性倒回好几张。 */
  function step(delta) {
    resetGroup();
    moveBy(delta);
  }

  /* ────────────────────────── 事件装配 ────────────────────────── */

  on(prevBtn, "click", (e) => {
    e.stopPropagation();
    step(-1);
  });
  on(nextBtn, "click", (e) => {
    e.stopPropagation();
    step(1);
  });
  on(closeBtn, "click", close);

  const stage = lightbox?.querySelector(".lightbox-stage") || null;
  let swipeX = 0;
  let swipeY = 0;
  let didSwipe = false;
  /** 多指轨迹：id → 最近坐标；两指即捏合 */
  const pointers = new Map();
  let pinch = null;
  let panBase = null;

  const rectOrZero = () =>
    img ? img.getBoundingClientRect() : { left: 0, top: 0, width: 0, height: 0 };

  on(stage, "pointerdown", (e) => {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    if (e.target.closest?.(".lb-arrow")) return;
    stage.setPointerCapture?.(e.pointerId);
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.size === 1) {
      swipeX = e.clientX;
      swipeY = e.clientY;
      panBase = { x: e.clientX, y: e.clientY, tx, ty };
      didSwipe = false;
      pinch = null;
    } else if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      const rect = rectOrZero();
      pinch = {
        d0: Math.hypot(a.x - b.x, a.y - b.y) || 1,
        mx0: (a.x + b.x) / 2,
        my0: (a.y + b.y) / 2,
        cx0: rect.left + rect.width / 2,
        cy0: rect.top + rect.height / 2,
        z0: zoom,
        tx0: tx,
        ty0: ty,
      };
      didSwipe = true; // 捏合后的合成 click 吞掉
    }
  });

  on(stage, "pointermove", (e) => {
    if (!pointers.has(e.pointerId)) return;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pinch && pointers.size >= 2) {
      const [a, b] = [...pointers.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y) || 1;
      const mx = (a.x + b.x) / 2;
      const my = (a.y + b.y) / 2;
      const next = pinchZoom(pinch, mx, my, d);
      zoom = next.zoom;
      tx = next.tx;
      ty = next.ty;
      if (zoom > 1) applyPan();
      if (img) img.classList.add("is-panning");
      applyTransform();
      return;
    }
    if (zoom > 1 && panBase) {
      // 缩放态拖拽平移（屏幕像素）；位移超阈值即视为拖动，吞掉合成 click。
      // 拖拽中**不**钳制，松手时才收边（见 gestureEnd）——否则贴边手感发涩。
      const dx = e.clientX - panBase.x;
      const dy = e.clientY - panBase.y;
      if (Math.hypot(dx, dy) > 6) {
        didSwipe = true;
        if (img) img.classList.add("is-panning");
      }
      tx = panBase.tx + dx;
      ty = panBase.ty + dy;
      applyTransform();
    }
    // zoom === 1 的横滑在 pointerup 判定
  });

  const gestureEnd = (e) => {
    pointers.delete(e.pointerId);
    if (pinch && pointers.size < 2) {
      pinch = null;
      if (img) img.classList.remove("is-panning");
      if (zoom < 1.05) {
        resetZoom(false);
      } else {
        applyPan();
        applyTransform();
      }
      // 剩余一指重置为单指基线，避免后续位移跳变
      const rest = [...pointers.values()][0];
      if (rest) {
        swipeX = rest.x;
        swipeY = rest.y;
        panBase = { x: rest.x, y: rest.y, tx, ty };
      }
      return;
    }
    if (pointers.size > 0) return; // 尚有手指未抬起
    panBase = null;
    if (img) img.classList.remove("is-panning");
    if (zoom > 1) {
      applyPan();
      applyTransform();
      return;
    }
    if (e.type === "pointercancel") return;
    const dx = e.clientX - swipeX;
    const dy = e.clientY - swipeY;
    if (Math.abs(dx) >= 48 && Math.abs(dx) > Math.abs(dy) * 1.2) {
      didSwipe = true;
      step(dx < 0 ? 1 : -1);
    }
  };
  on(stage, "pointerup", gestureEnd);
  on(stage, "pointercancel", gestureEnd);

  // 舞台上的点击：1× 态切图（乐观、保留瞬时反馈）；放大态缩回（与 CSS 的 zoom-out 指针一致）
  on(stage, "click", (e) => {
    if (e.target.closest?.(".lb-arrow")) return;
    if (didSwipe) {
      didSwipe = false;
      return;
    }
    const now = performance.now();
    const sameGroup = groupKind !== "" && now - groupAt < GROUP_MS;
    groupAt = now;

    if (zoom > 1) {
      // 放大态：本击 = 缩回。只在新组时登记起点 —— 第二击若改写 groupKind，
      // dblclick 就会把它当成「切图组」而重新放大。
      if (!sameGroup) {
        groupKind = "out";
        groupStart = pos;
      }
      resetZoom(false);
      return;
    }

    if (!sameGroup) {
      groupKind = "adv";
      groupStart = pos;
    } else if (groupKind === "out") {
      // 本组是「缩回」组，第二击是它的余波：吞掉，否则会先缩回再切图
      return;
    }
    moveBy(1);
  });

  // 双击：回到本组起点 + 缩放切换。回退取**绝对位置**，这才是「手慢也不跳两张」的原因
  on(stage, "dblclick", (e) => {
    if (e.target.closest?.(".lb-arrow")) return;
    const wasOut = groupKind === "out";
    const back = groupStart;
    resetGroup();
    if (pos !== back) {
      pos = back;
      sync();
    }
    // 「缩回」组已经缩回过了，本次双击不再缩放
    if (!wasOut) toggleZoomAt(e.clientX, e.clientY);
  });

  on(
    stage,
    "wheel",
    (e) => {
      if (!e.target.closest?.(".lightbox-frame")) return;
      e.preventDefault();
      if (zoom === 1 && e.deltaY > 0) return;
      const rel = relTo(e.clientX, e.clientY);
      zoomAt(zoom * (e.deltaY < 0 ? 1.18 : 1 / 1.18), rel.x, rel.y);
    },
    { passive: false }
  );

  // Esc → <dialog> 的 cancel 事件统一走 VT 关闭动画
  lightbox?.addEventListener("cancel", (e) => {
    e.preventDefault();
    close();
  });

  document.addEventListener("keydown", (e) => {
    if (!lightbox || !lightbox.open) return;
    // Esc 与 Tab 焦点圈定由 <dialog> 原生处理，这里只留翻页
    if (e.key === "ArrowLeft") step(-1);
    if (e.key === "ArrowRight") step(1);
  });

  return { open, isOpen: () => Boolean(lightbox && lightbox.open) };
}
