/**
 * 序厅（hero）轮播域 —— 渲染 / 自动轮播 / 手势 + 与灯箱的过渡配对源。
 *
 * **为什么是工厂而不是模块级单例**：`src/` 的三条约束（见 AGENTS.md）要求 import
 * 阶段**零副作用**，否则 Node 端 `import` 会直接抛错、单测根本加载不起来。本模块在
 * import 时不触碰任何 DOM / window / matchMedia；只有 `createHeroCarousel(ports)`
 * 被调用时，才开始使用宿主传进来的引用。
 *
 * 收益是状态内聚：`pos` / `timer` / `slides` / `list` / 三个暂停标志（用户 / hover /
 * 观画室会话）与手势中间量（`hx` / `hy` / `pointer`）全部收进工厂闭包，`app.js` 侧
 * **不再有任何序厅态**，也不再有该域的事件监听 —— 只保留一个 `hero` 句柄。
 *
 * **依赖方向**：`hero.js` → `util.js`（纯函数叶子）；不反向 import `app.js`，无环。
 * 跨域能力一律走端口注入，见 `createHeroCarousel` 的 JSDoc。
 */
import {
  displayTitle,
  heroSrc,
  heroSrcset,
  heroAvifSrcset,
  selectHeroPhotos,
  HERO_MAX,
  HERO_SIZES,
} from "./util.js";

/* ────────────────────────── 纯判定（可被单测直接覆盖） ──────────────────────────
   刻意导出：自动轮播的开/停是本域最易静默回归的判据 —— 漏掉一个闸门不会报错，
   只表现为「某种情况下轮播没停」。原先埋在 app.js 的 IIFE 里只能靠 e2e 端到端撞，
   抽出来后 `tests/unit/hero.test.mjs` 把六个闸门逐一钉死。 */

/**
 * 自动轮播的允许判据 —— 六个独立闸门，任一为真即不放行。
 *
 * 各自的语义（都有真实来历，不是防御性写法）：
 *   - reduceMotion：系统「减少动态效果」时不自动转；
 *   - userPaused：用户按了暂停按钮（持久到本次会话）；
 *   - tempPaused：hover / 按住 / 键盘焦点持有（释放即恢复）；
 *   - modalPaused：观画室会话期间（见 `setModalPaused`：刻意独立于 tempPaused）；
 *   - hidden：后台标签页不转（省电，且回到前台时不会连跳）；
 *   - slideCount < 2：单张 / 空序厅没有「轮」可言（同时决定暂停按钮的显隐）。
 */
export function heroAutoAllowed({
  reduceMotion = false,
  userPaused = false,
  tempPaused = false,
  modalPaused = false,
  hidden = false,
  slideCount = 0,
} = {}) {
  return (
    !reduceMotion && !userPaused && !tempPaused && !modalPaused && !hidden && slideCount >= 2
  );
}

/** 自动轮播周期（ms）。手动切换会重置——startAuto 停旧计时器再起新周期。 */
const HERO_INTERVAL = 4200;

/**
 * 创建序厅控制器。调用即完成事件装配（暂停按钮 / 箭头 / 分页点 / 指针与键盘手势 /
 * 标签页可见性 / 动效偏好变更），宿主随后只需要 `render()`（数据到达、重建时调用）
 * 与 `modalPause()`（灯箱会话开/关时调用）。
 *
 * @param {object} ports
 * @param {HTMLElement|null} ports.carousel `#heroCarousel`
 * @param {HTMLElement|null} ports.track `#heroCarouselTrack`
 * @param {HTMLElement|null} ports.dots `#heroCarouselDots`
 * @param {HTMLElement|null} ports.prevBtn `#heroPrev`
 * @param {HTMLElement|null} ports.nextBtn `#heroNext`
 * @param {HTMLElement|null} ports.pauseBtn `#heroPause`（初态由 HTML 的 hidden 兜住，
 *        render 后由 syncPauseButton 接管显隐）
 * @param {HTMLElement|null} ports.progressBar `#heroProgressBar`（自动轮播进度条）
 * @param {(q: string) => MediaQueryList} ports.matchMedia
 *        动效偏好查询。监听归本域自持（change 时同步暂停按钮并重估自动轮播）；
 *        宿主的 renderGallery 有自己的同款监听，两个域各自订阅、互不代管。
 * @param {(el: any, type: string, fn: Function, opts?: any) => void} ports.on
 *        绑定守卫：元素缺失时静默降级，而不是抛 TypeError 中断整个启动。
 * @param {() => object[]} ports.getPhotos 全量馆藏（`app.js` 的 `photos`；数据到达前为空）
 * @param {() => object[]} ports.getVisible 当前筛选序列（`app.js` 的 `visible`）
 * @param {(photo: object) => number} ports.catalogIndex
 *        该画在**全量馆藏**中的序号（0 起；不在时 -1）。《无题 · NN》替代文本
 *        与墙号 / 观画室位置指示同一体系 —— 精选排名序（i）不是馆藏序，不能代替。
 * @param {(index: number, invoker: Element, list: object[] | null, source: (photoId: string | null) => Element | null) => void} ports.openLightbox
 *        打开观画室（转发给 `lb.open`）。**第 3/4 参数由本域决定、须原样透传**：
 *        第 3 参数 null = 跟当前筛选，全量数组 = 筛选不含该画时的兜底序列；
 *        第 4 参数是本域的过渡源提供者（`sourceFor`）。
 * @param {(img: HTMLImageElement) => object | null} ports.sampleRoom
 *        无预计算调色板（浏览器内上传的图）时的兜底采样。
 * @param {() => void} ports.syncNav
 *        序厅高度变化后的顶栏重量。**空序厅路径必须调用**：序厅塌成 display:none 后
 *        `heroEnd` 若沿用旧值，`is-at-hero` 会常驻、顶栏馆名与序厅大字同时消失。
 * @returns {{render: () => void, modalPause: (paused: boolean) => void}}
 *          `modalPause` 由宿主的 `pauseHero` 端口懒求值调用（工厂晚于灯箱装配，
 *          直接引用会撞 const 的 TDZ）。
 */
export function createHeroCarousel({
  carousel,
  track,
  dots,
  prevBtn,
  nextBtn,
  pauseBtn,
  progressBar,
  matchMedia,
  on,
  getPhotos,
  getVisible,
  catalogIndex,
  openLightbox,
  sampleRoom,
  syncNav,
}) {
  /* —— 状态（原先散落在 app.js 的九个模块级 let，现在全部内聚于此） —— */
  let pos = 0;
  let timer = 0;
  let slides = [];
  let list = [];
  let swiped = false;
  let userPaused = false;
  let tempPaused = false;
  /** 观画室会话期间暂停。**独立于** tempPaused（后者由 hover / 拖拽持有），见 setModalPaused */
  let modalPaused = false;
  let neighborsReady = false;
  const motionQuery = matchMedia ? matchMedia("(prefers-reduced-motion: reduce)") : null;
  let reduceMotion = Boolean(motionQuery && motionQuery.matches);

  /** 纯判据的取参包装：六个闸门的值全部来自本域状态 / document。 */
  function autoAllowed() {
    return heroAutoAllowed({
      reduceMotion,
      userPaused,
      tempPaused,
      modalPaused,
      hidden: document.hidden,
      slideCount: slides.length,
    });
  }

  function syncPauseButton() {
    if (!pauseBtn) return;
    const canAuto = !reduceMotion && slides.length >= 2;
    pauseBtn.hidden = !canAuto;
    pauseBtn.setAttribute("aria-pressed", userPaused ? "true" : "false");
    pauseBtn.setAttribute("aria-label", userPaused ? "继续自动轮播" : "暂停自动轮播");
    // 图标切换交给 CSS（[aria-pressed="true"] 显播放、否则显暂停），
    // 不再用 ‖ / ▶ 文本字形——字形渲染依赖字体，图标不该依赖字体
  }

  /* —— 邻张解锁（LCP 友好）—— */
  function unlockNeighbors() {
    if (neighborsReady) return;
    neighborsReady = true;
    if (slides.length) applySources();
  }
  // 解锁 = 观察到带 url 的 LCP entry（序厅图已结算、离开 lantern 截止线）
  // 或 800ms 兜底（不支持该 entry 类型 / 图迟迟不来）。此后切换照常一次挂三张
  //（自动轮播 4.2s 远晚于解锁；手动秒切换时目标张本身必有 src）。
  try {
    const lcpObs = new PerformanceObserver((entryList) => {
      for (const e of entryList.getEntries()) {
        if (e.url) {
          lcpObs.disconnect();
          unlockNeighbors();
          break;
        }
      }
    });
    lcpObs.observe({ type: "largest-contentful-paint", buffered: true });
  } catch {
    /* 老浏览器没有该 entry 类型：只靠下面的超时兜底 */
  }
  setTimeout(unlockNeighbors, 800);

  /**
   * 只给「已解锁的 near 集合」挂 src——绝对定位会让 loading=lazy 全部失效。
   *
   * 邻张（前后各一）**延后到首图 LCP 结算后再挂**：这两张首访合计 ~184KB，
   * 发起时间落在观察 LCP 之前，simulate 的 LCP 图会把它们算进 Load/Render Delay。
   * A/B 实测摘掉它们：Load Delay 302→221、Render Delay 1751→1526、
   * LCP 2562→2247（过 2500 断言线）。解锁条件见 unlockNeighbors。
   */
  function applySources() {
    const n = slides.length;
    if (!n) return;
    const near = new Set([pos]);
    if (neighborsReady) {
      near.add((pos + 1) % n);
      near.add((pos - 1 + n) % n);
    }
    slides.forEach((slide, i) => {
      const img = slide.querySelector("img");
      const source = slide.querySelector("source");
      const photo = list[i];
      if (!img || !photo) return;
      const src = heroSrc(photo);
      const avif = heroAvifSrcset(photo);
      const webpSrcset = heroSrcset(photo);
      if (near.has(i)) {
        const srcChanged = img.getAttribute("src") !== src;
        if (srcChanged) {
          // 响应式候选：序厅画心只显示 min(86vw,880px)，喂中图（960w）在手机上
          // 是 40% 的体积浪费；候选由缩略图各档 + 中图（大屏兜底）组成
          if (source) source.srcset = avif;
          img.srcset = webpSrcset;
          img.src = src;
        }
        if (i === pos) {
          img.loading = "eager";
          img.fetchPriority = "high";
          if (photo.palette) {
            // 预计算调色板：不必等中图解码，切到本张时墙色立刻即终点色，
            // 省掉「先默认深绿 → 解码后再变」的一次色跳（P1-6）
            applyRoom(photo.palette);
          } else {
            // 上传图无预计算值：等解码后采样，与 P1-6 前行为一致
            const syncRoom = () => {
              if (pos !== i) return;
              applyRoom(sampleRoom(img));
            };
            // src 被摘掉再挂回时 complete 会短暂为 false，必须重新绑 load
            if (srcChanged || !img.dataset.roomBound) {
              img.dataset.roomBound = "1";
              if (img.complete) syncRoom();
              else img.addEventListener("load", syncRoom, { once: true });
            } else if (img.complete) {
              applyRoom(sampleRoom(img));
            }
          }
        } else {
          img.loading = "lazy";
          img.fetchPriority = "low";
        }
      } else if (img.getAttribute("src")) {
        // 摘 src 才能让 lazy 失效省流——source 同步摘，否则浏览器仍会从 source 取
        if (source) source.srcset = "";
        img.removeAttribute("srcset");
        img.removeAttribute("src");
      }
    });
  }

  /** 把序厅画面主色写进轮播容器的 CSS 变量（预计算 palette 或采样结果都走这里）。 */
  function applyRoom(palette) {
    if (!carousel) return;
    if (!palette) {
      carousel.style.removeProperty("--room-adapt");
      carousel.style.removeProperty("--room-adapt-deep");
      carousel.style.removeProperty("--room-adapt-glow");
      return;
    }
    carousel.style.setProperty("--room-adapt", palette.wall);
    carousel.style.setProperty("--room-adapt-deep", palette.deep);
    carousel.style.setProperty("--room-adapt-glow", palette.glow);
  }

  function stopAuto() {
    if (timer) {
      clearInterval(timer);
      timer = 0;
    }
    stopProgress();
  }

  function startProgress() {
    stopProgress();
    if (!progressBar) return;
    progressBar.style.transition = "none";
    progressBar.style.transform = "scaleX(0)";
    void progressBar.offsetWidth;
    progressBar.style.transition = `transform ${HERO_INTERVAL}ms linear`;
    progressBar.style.transform = "scaleX(1)";
  }

  function stopProgress() {
    // 这里曾有一份 heroProgressTimer（clearTimeout 后置 0）。它从来没有被赋过值：
    // 进度条走的是 CSS transform 过渡（startProgress 里重置 + 触发），
    // 不需要 JS 计时器。保留它只会让下一位读者以为存在一条计时器生命周期。
    if (!progressBar) return;
    progressBar.style.transition = "none";
    progressBar.style.transform = "scaleX(0)";
  }

  function startAuto() {
    stopAuto();
    if (!autoAllowed()) return;
    startProgress();
    timer = setInterval(() => {
      if (!autoAllowed()) {
        stopAuto();
        return;
      }
      setIndex(pos + 1);
      startProgress();
    }, HERO_INTERVAL);
  }

  function setTempPaused(value) {
    tempPaused = !!value;
    startAuto();
  }

  /**
   * 观画室会话期间暂停序厅轮播（由 src/lightbox.js 的 `pauseHero` 端口驱动）。
   *
   * ⚠️ 刻意**不复用** `tempPaused`：那个标志由 hover / 拖拽持有，共用会在关灯箱时
   * 把用户当时正持有的 hover 暂停一并清掉。
   *
   * 为什么必须暂停：序厅轮播没有任何模态门控（`autoAllowed` 只看 reduceMotion /
   * 用户暂停 / document.hidden），灯箱开着时它仍每 4.2s 转走。而灯箱关闭时的视图过渡
   * 要缩回「用户点的那幅序厅画面」—— 转走后该 slide 变成 `opacity:0 / visibility:hidden`，
   * 配对到隐形状比不配对更糟。顺带省掉模态框背后毫无意义的轮播与图片预载。
   */
  function setModalPaused(value) {
    modalPaused = !!value;
    startAuto();
  }

  /**
   * 本会话的显式视图过渡源提供者（经 `openLightbox` 端口作第 4 参数传给灯箱的 open）。
   * 回答「photoId 此刻是否正由序厅某个**可见**画面承载」：是则返回该 `<img>`，
   * 灯箱便以它作 `view-transition-name` 的配对源 —— 那是用户实际点击的元素，且必然
   * 在视野内；而展厅里对应的那张卡片可能远在首屏之外（实测桌面溢出 284px、移动 236px）。
   *
   * 必须是**函数**而非元素快照：灯箱在 open 与 close 各调用一次，序厅在此期间可能已
   * 轮播（见 setModalPaused），转走后须返回 null，宁可不配对也不给错动画。
   */
  function sourceFor(photoId) {
    if (!photoId) return null;
    const i = list.findIndex((p) => p.id === photoId);
    if (i < 0) return null;
    const slide = slides[i];
    if (!slide || !slide.classList.contains("is-active")) return null;
    return slide.querySelector(".hero-art img");
  }

  function setIndex(next) {
    if (!slides.length) return;
    pos = (next + slides.length) % slides.length;
    slides.forEach((el, i) => {
      el.classList.toggle("is-active", i === pos);
    });
    if (dots) {
      [...dots.children].forEach((dot, i) => {
        dot.classList.toggle("is-active", i === pos);
        if (i === pos) dot.setAttribute("aria-current", "true");
        else dot.removeAttribute("aria-current");
      });
    }
    applySources();
  }

  /** 重建轮播（数据到达 / 自定义上传去重后调用；也可在馆藏变化时再次调用）。 */
  function render() {
    if (!track || !carousel) return;
    stopAuto();
    slides = [];
    list = [];
    pos = 0;
    tempPaused = false;
    track.innerHTML = "";
    if (dots) dots.innerHTML = "";

    const picked = selectHeroPhotos(getPhotos(), HERO_MAX);
    if (!picked.length) {
      carousel.classList.add("is-empty");
      syncPauseButton();
      // 序厅塌成 display:none 后必须重测：heroEnd 原本量的是整屏高，
      // 而 onScrollNav 只在启动期与 resize 时跑 —— scrollY(0) < 整屏高 恒真，
      // is-at-hero 常驻、顶栏馆名在首屏被隐去，而序厅大字并不在场（两者同时消失）。
      syncNav();
      return;
    }
    carousel.classList.remove("is-empty");
    // 首屏入场动画：首次渲染时添加 is-initial，动画完成后移除
    if (!carousel.dataset.initialized) {
      carousel.dataset.initialized = "1";
      carousel.classList.add("is-initial");
      setTimeout(() => carousel.classList.remove("is-initial"), 1500);
    }
    list = picked;

    picked.forEach((photo, i) => {
      const slide = document.createElement("div");
      slide.className = "hero-carousel-slide" + (i === 0 ? " is-active" : "");
      slide.setAttribute("role", "group");
      slide.setAttribute("aria-roledescription", "slide");
      slide.setAttribute("aria-label", `${i + 1} / ${picked.length}`);
      slide.tabIndex = -1;

      const img = document.createElement("img");
      // 替代文本的《无题 · NN》取**全量馆藏序号**：i 是精选排名序，与站内其它
      // 入口的口径不同；端口缺失时退回 i（替代文本宁可不完美也不能缺序号）
      const altIdx = catalogIndex ? catalogIndex(photo) : -1;
      img.alt = displayTitle(photo, altIdx < 0 ? i : altIdx);
      img.decoding = "async";
      img.loading = "lazy";
      img.fetchPriority = "low";
      // 响应式候选的布局宽度（与 .hero-art img max-width 对应），随 near/far 挂摘 srcset
      img.sizes = HERO_SIZES;
      if (photo.width && photo.height) {
        img.width = photo.width;
        img.height = photo.height;
      }
      // AVIF 候选：applySources 随 near/far 一起挂摘
      const heroSource = document.createElement("source");
      heroSource.type = "image/avif";
      heroSource.sizes = HERO_SIZES;
      const picture = document.createElement("picture");
      picture.appendChild(heroSource);
      picture.appendChild(img);
      // 序厅画作用 <button> 承载：原生可聚焦、Enter/Space 原生派发 click，
      // 事件冒泡到 slide 上既有的 click 处理器，无需另写 keydown。
      // slide 自身仍是 role="group" + aria-roledescription="slide"（APG 轮播结构），
      // tabIndex 保持 -1：它是可编程聚焦的容器，不是 Tab 站点。
      const art = document.createElement("button");
      art.type = "button";
      art.className = "hero-art";
      art.appendChild(picture);
      slide.appendChild(art);

      slide.addEventListener("click", () => {
        if (swiped) {
          swiped = false;
          return;
        }
        const visible = getVisible();
        const inFilter = visible.findIndex((p) => p.id === photo.id);
        if (inFilter >= 0) {
          // 第 4 参数：以**序厅这幅画面**作过渡源，而不是展厅里那张可能在屏外的卡片
          openLightbox(inFilter, slide, null, sourceFor);
          return;
        }
        // 筛选不含该画时，按全量馆藏打开，避免静默无响应
        const all = getPhotos();
        const allIdx = all.findIndex((p) => p.id === photo.id);
        if (allIdx >= 0) openLightbox(allIdx, slide, all, sourceFor);
      });

      track.appendChild(slide);
      slides.push(slide);

      if (dots) {
        const dot = document.createElement("button");
        dot.type = "button";
        dot.className = "hero-carousel-dot" + (i === 0 ? " is-active" : "");
        dot.setAttribute("aria-label", `第 ${i + 1} 张`);
        if (i === 0) dot.setAttribute("aria-current", "true");
        dot.addEventListener("click", (e) => {
          e.stopPropagation();
          setIndex(i);
          startAuto();
        });
        dots.appendChild(dot);
      }
    });

    syncPauseButton();
    applySources();
    startAuto();
    // slides 建完后 hero 高度才定：与启动期那次测量对齐（最小高度 100vh，通常是同值）
    syncNav();
  }

  /* ────────────────────────── 事件装配 ────────────────────────── */

  on(pauseBtn, "click", (e) => {
    e.stopPropagation();
    userPaused = !userPaused;
    syncPauseButton();
    startAuto();
  });

  on(prevBtn, "click", (e) => {
    e.stopPropagation();
    setIndex(pos - 1);
    startAuto();
  });

  on(nextBtn, "click", (e) => {
    e.stopPropagation();
    setIndex(pos + 1);
    startAuto();
  });

  if (carousel) {
    let hx = 0;
    let hy = 0;
    let pointer = null;

    // 只有键盘焦点（:focus-visible）才算「用户在用键盘看轮播」：
    // 触屏/鼠标点按产生的焦点不该长期压住自动轮播，否则触屏点开灯箱、
    // 关闭后焦点还给 slide 时没有可见的移出方式，轮播会一直停着
    const keyboardFocusInHero = () => {
      const el = document.activeElement;
      return Boolean(el) && carousel.contains(el) && el.matches(":focus-visible");
    };

    // 按压结束后的恢复：键盘焦点在内→保持焦点暂停；鼠标仍悬停→保持悬停暂停；
    // 触屏/笔没有持续悬停状态，抬起即恢复，不依赖可能缺失的 pointerleave
    const resumeAfterPress = (e) => {
      if (keyboardFocusInHero() || (e.pointerType === "mouse" && carousel.matches(":hover"))) {
        startAuto();
      } else {
        setTempPaused(false);
      }
    };

    on(carousel, "pointerdown", (e) => {
      if (e.pointerType === "mouse" && e.button !== 0) return;
      if (e.isPrimary === false) return;
      pointer = e.pointerId;
      hx = e.clientX;
      hy = e.clientY;
      swiped = false;
      setTempPaused(true);
    });
    on(carousel, "pointerup", (e) => {
      if (pointer !== e.pointerId) return;
      pointer = null;
      const dx = e.clientX - hx;
      const dy = e.clientY - hy;
      if (Math.abs(dx) >= 40 && Math.abs(dx) > Math.abs(dy)) {
        swiped = true;
        setIndex(pos + (dx < 0 ? 1 : -1));
      }
      resumeAfterPress(e);
    });
    on(carousel, "pointercancel", (e) => {
      pointer = null;
      resumeAfterPress(e);
    });
    on(carousel, "pointerenter", () => setTempPaused(true));
    on(carousel, "pointerleave", () => {
      if (pointer != null) return;
      if (keyboardFocusInHero()) {
        startAuto();
        return;
      }
      setTempPaused(false);
    });
    on(carousel, "focusin", () => {
      if (keyboardFocusInHero()) setTempPaused(true);
    });
    on(carousel, "focusout", (e) => {
      if (carousel.contains(e.relatedTarget)) return;
      if (pointer != null || carousel.matches(":hover")) {
        startAuto();
        return;
      }
      setTempPaused(false);
    });
  }

  document.addEventListener("visibilitychange", () => {
    startAuto();
  });

  if (motionQuery) {
    motionQuery.addEventListener("change", (e) => {
      reduceMotion = e.matches;
      syncPauseButton();
      startAuto();
    });
  }

  return { render, modalPause: setModalPaused };
}
