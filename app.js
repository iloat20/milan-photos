import {
  uid,
  safeDecode,
  displayTitle,
  wallNumber,
  toLocalDate,
  ymKey,
  ymLabel,
  baseFileName,
  collectFilters,
  stripExt,
  safeFileName,
  heroSrc,
  heroSrcset,
  heroAvifSrcset,
  HERO_SIZES,
  lightboxAvifOrFallback,
} from "./src/util.js";
import { createLightbox } from "./src/lightbox.js";
import { createInstallPrompt } from "./src/install.js";

(() => {
  /** @type {{src:string,thumb?:string,thumbSrcset?:string,thumbAvifSrcset?:string,medium?:string,mediumAvif?:string,animated?:boolean,title:string,caption:string,date?:string,id:string,file?:string,fileName?:string,custom?:boolean,width?:number,height?:number,palette?:{wall:string,deep:string,glow:string,accent:string}}[]} */
  let folderPhotos = [];
  /** @type {typeof folderPhotos} */
  let customPhotos = [];
  /** @type {typeof folderPhotos} */
  let photos = [];
  /** @type {typeof folderPhotos} */
  let visible = [];
  let activeFilter = "all";
  // manifest 到达前不展示空状态，避免首屏闪现「展厅尚未布展」
  let galleryReady = false;
  let reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  const gallery = document.getElementById("galleryGrid");
  const filterBar = document.getElementById("filterBar");
  const emptyEl = document.getElementById("empty");
  const skeletonEl = document.getElementById("gallerySkeleton");
  // 灯箱自身的 DOM 引用（画心/标题/箭头/关闭）不在此处持有 —— 它们全归 src/lightbox.js。
  // 这里只留 <dialog> 本体：墙色注入（applyRoomToLightbox）与 hashchange 需要读它。
  const lightbox = document.getElementById("lightbox");
  const addPhotoBtn = document.getElementById("addPhotoBtn");
  const photoInput = document.getElementById("photoInput");
  const uploadStatus = document.getElementById("uploadStatus");
  const heroCarousel = document.getElementById("heroCarousel");
  const heroTrack = document.getElementById("heroCarouselTrack");
  const heroDots = document.getElementById("heroCarouselDots");
  const heroPrev = document.getElementById("heroPrev");
  const heroNext = document.getElementById("heroNext");
  const heroPauseBtn = document.getElementById("heroPause");

  /** 统一的绑定守卫：元素缺失时静默降级，而不是抛 TypeError 中断整个 IIFE。
   *  这个 IIFE 里的事件绑定都发生在 renderFilters/renderGallery/loadFolderPhotos 之前，
   *  任何一处裸 addEventListener 命中 null（HTML 结构调整、SW 旧壳层配新页面、
   *  未来重构移掉 <dialog>）都会让整站停在骨架屏且不报错。
   *  同文件其余绑定早已是 `if (x) {}` 风格，这里把遗漏的几处补齐并统一。 */
  const on = (el, type, handler, opts) => {
    if (!el) return;
    el.addEventListener(type, handler, opts);
  };

  /* —— 观画室域装配（P2-2 第二步）——
     src/lightbox.js 自带状态机、缩放平移、指针手势与全部灯箱事件监听；
     这里只把 DOM 引用和六类跨域能力按端口注入。装配点必须留在文件顶部：
     createLightbox 会在调用时立刻读 .lightbox-stage 并绑事件，且
     openLightboxFromHash（定义在下方）依赖它 —— 放晚了会撞 const 的 TDZ。
     注入的都是函数声明（提升）或箭头（惰性求值），无初始化顺序问题。 */
  const lb = createLightbox({
    lightbox,
    img: document.getElementById("lbImg"),
    source: document.getElementById("lbSource"),
    title: document.getElementById("lbTitle"),
    prevBtn: document.getElementById("prev"),
    nextBtn: document.getElementById("next"),
    closeBtn: document.getElementById("close"),
    on,
    getList: () => visible,
    // 视图过渡配对：把展厅第 index 张卡片的 <img> 与灯箱画心连成同一个 name
    cardImageAt: (index) =>
      gallery?.querySelectorAll(".card")[index]?.querySelector("img") || null,
    pauseHero: setHeroModalPaused,
    preload: preloadImage,
    applyRoom: applyRoomToLightbox,
    sampleRoom: sampleRoomColor,
    setHash,
    filterHash: currentFilterHash,
    prefersVT: prefersViewTransitions,
    startVT,
  });

  /* —— 安装引导域装配 ——
     与 createLightbox 同一范式：工厂自带状态与事件接线，这里只注入 DOM 引用与
     window / matchMedia 这类跨域能力。入口默认 hidden，只有 beforeinstallprompt
     真的到来才显示；按钮缺失时工厂整体静默降级（HTML 结构调整不该打挂启动）。 */
  createInstallPrompt({
    button: document.getElementById("installBtn"),
    win: window,
    matchMedia: (q) => window.matchMedia(q),
    on,
  });

  /** 从画作采样，生成可用于展厅的低饱和墙色。
   *  仅作**回退**用：manifest 里的 palette 是 sync 阶段用同一算法预计算的，
   *  只有浏览器内上传的图（photo.custom，没有 manifest 条目）才走到这里。 */
  function sampleRoomColor(img) {
    if (!img || !img.naturalWidth) return null;
    try {
      const n = 28;
      const canvas = document.createElement("canvas");
      canvas.width = n;
      canvas.height = n;
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      ctx.drawImage(img, 0, 0, n, n);
      const { data } = ctx.getImageData(0, 0, n, n);
      let r = 0;
      let g = 0;
      let b = 0;
      let count = 0;
      let ar = 0;
      let ag = 0;
      let ab = 0;
      let as = 0;
      for (let i = 0; i < data.length; i += 4) {
        const pr = data[i];
        const pg = data[i + 1];
        const pb = data[i + 2];
        const pa = data[i + 3];
        if (pa < 32) continue;
        r += pr;
        g += pg;
        b += pb;
        count += 1;
        const mx = Math.max(pr, pg, pb);
        const mn = Math.min(pr, pg, pb);
        const sat = mx === 0 ? 0 : (mx - mn) / mx;
        const score = sat * (mx / 255);
        if (score > as) {
          as = score;
          ar = pr;
          ag = pg;
          ab = pb;
        }
      }
      if (!count) return null;
      const avg = { r: r / count, g: g / count, b: b / count };
      const accent = as > 0.08 ? { r: ar, g: ag, b: ab } : avg;
      const mix = (c, t, k) => ({
        r: c.r * (1 - k) + t.r * k,
        g: c.g * (1 - k) + t.g * k,
        b: c.b * (1 - k) + t.b * k,
      });
      const hall = { r: 31, g: 42, b: 36 };
      const dim = { r: 12, g: 16, b: 14 };
      // 画作色压进展厅深绿，保持油画馆气质。
      // 混合度取高（墙 0.72 / 光晕 0.45）：采样只贡献明暗与色相差，
      // 否则亮米色画作会把序厅/观画室的墙拉成发灰的棕墙，脱离展厅深绿基调
      let wall = mix(mix(avg, accent, 0.35), hall, 0.72);
      let glow = mix(mix(avg, accent, 0.55), hall, 0.45);
      let deep = mix(wall, dim, 0.52);
      // 采样墙再亮也不牺牲 chrome 文字对比（对照象牙字）
      const ivory = { r: 240, g: 234, b: 216 };
      const relLum = (c) => {
        const f = (v) => {
          const s = Math.max(0, Math.min(255, v)) / 255;
          return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
        };
        return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b);
      };
      const contrastWith = (c, fg) => {
        const l1 = relLum(c);
        const l2 = relLum(fg);
        const hi = Math.max(l1, l2);
        const lo = Math.min(l1, l2);
        return (hi + 0.05) / (lo + 0.05);
      };
      const darkenForUi = (c, fg, minRatio) => {
        let col = { r: c.r, g: c.g, b: c.b };
        for (let i = 0; i < 20; i += 1) {
          if (contrastWith(col, fg) >= minRatio) return col;
          col = { r: col.r * 0.9, g: col.g * 0.9, b: col.b * 0.9 };
        }
        return col;
      };
      wall = darkenForUi(wall, ivory, 4.5);
      deep = darkenForUi(deep, ivory, 4.5);
      glow = darkenForUi(glow, ivory, 3);
      const css = (c, a = 1) =>
        `rgba(${Math.round(c.r)}, ${Math.round(c.g)}, ${Math.round(c.b)}, ${a})`;
      return {
        wall: css(wall),
        glow: css(glow, 0.55),
        deep: css(deep),
        accent: css(mix(accent, hall, 0.4), 0.75),
      };
    } catch {
      return null;
    }
  }

  /** 把调色板写到卡片的画心容器上。palette 来自 manifest 预计算或采样回退，
   *  两者同形，故这里不认识来源。（P1-6 前这段赋值散在 idle 任务里） */
  function applyCardPalette(el, p) {
    el.style.setProperty("--card-wall", p.wall);
    el.style.setProperty("--card-glow", p.glow);
    el.style.setProperty("--card-accent", p.accent);
  }

  /* 采样回退队列：仅在 manifest 没有 palette 时使用（当前只有上传图）。
     保留分片是因为上传图数量不设上限，逐张 canvas 取色 + 对比度迭代仍可能
     一帧打满；队列按 requestIdleCallback 分片跑，renderGallery 重建时代际作废旧任务。
     注意：馆藏图已不再进这个队列（P1-6 前每次 renderGallery 会排 18 个任务）。 */
  const roomJobs = [];
  let roomEpoch = 0;
  let roomScheduled = false;
  const scheduleIdle = (fn) => {
    if (typeof requestIdleCallback === "function") {
      requestIdleCallback(fn, { timeout: 600 });
    } else {
      setTimeout(fn, 32);
    }
  };
  const flushRoomJobs = (deadline) => {
    roomScheduled = false;
    const timedOut = !deadline || deadline.didTimeout === true;
    while (roomJobs.length) {
      const job = roomJobs.shift();
      if (job.epoch === roomEpoch) job.run();
      if (timedOut) continue;
      if (deadline.timeRemaining() < 4) break;
    }
    if (roomJobs.length) queueRoomFlush();
  };
  const queueRoomFlush = () => {
    if (roomScheduled) return;
    roomScheduled = true;
    scheduleIdle(flushRoomJobs);
  };
  function queueRoomJob(run) {
    roomJobs.push({ run, epoch: roomEpoch });
    queueRoomFlush();
  }

  function applyRoomToHero(palette) {
    if (!heroCarousel) return;
    if (!palette) {
      heroCarousel.style.removeProperty("--room-adapt");
      heroCarousel.style.removeProperty("--room-adapt-deep");
      heroCarousel.style.removeProperty("--room-adapt-glow");
      return;
    }
    heroCarousel.style.setProperty("--room-adapt", palette.wall);
    heroCarousel.style.setProperty("--room-adapt-deep", palette.deep);
    heroCarousel.style.setProperty("--room-adapt-glow", palette.glow);
  }

  function applyRoomToLightbox(palette) {
    if (!lightbox) return;
    if (!palette) {
      lightbox.style.removeProperty("--room-adapt");
      lightbox.style.removeProperty("--room-adapt-deep");
      lightbox.style.removeProperty("--room-adapt-glow");
      return;
    }
    lightbox.style.setProperty("--room-adapt", palette.wall);
    lightbox.style.setProperty("--room-adapt-deep", palette.deep);
    lightbox.style.setProperty("--room-adapt-glow", palette.glow);
  }

  // 画心随原作比例，金框只是外沿
  function applyRowFit(card, media, width, height) {
    const ar = width > 0 && height > 0 ? width / height : 4 / 3;
    const clamped = Math.max(0.55, Math.min(ar, 1.9));
    if (media) media.style.aspectRatio = String(clamped);

    // 重点陈列（.is-feature 独占一行）用它反算卡片宽度，见 .card.is-feature
    if (card) card.style.setProperty("--fit", String(clamped));
  }

  /**
   * @param {() => void} [afterGallery] 展厅渲染完成后回调（深链开灯箱 / 隐藏骨架屏等
   *   依赖 `visible` 已就绪的收尾必须挂这里——rebuildPhotos 现在等序厅画心画完才渲染展厅）
   *
   * 序厅先渲染、**展厅延后到序厅画心可立刻 paint 之后**（首图 load + decode + 双 rAF：
   * 第一帧只画序厅，第二帧才动展厅；300ms 兜底防慢网/后台标签页）。
   * 动机是 LCP：lantern 的 LCP 图以**观察 LCP** 为截止，此前的主线程工作全部 ×4 CPU
   * 计入 Render Delay。实测首图 82ms 就 load 完，但 decoding="async" 的 decode 任务
   * 排在展厅 18 卡渲染之后，画心 paint 被顶到 266ms 才结算（element render delay
   * 168ms），整厅 style/layout 与全部卡片图请求都落在截止线内（Render Delay 占
   * LCP 67%）。同步连跑两者不会在中间产生 paint——必须等 decode 完成再让序厅先
   * 完成一帧，否则 paint 照样被展厅渲染压住。
   */
  function rebuildPhotos(afterGallery) {
    const folderKeys = new Set(
      folderPhotos.map(baseFileName).filter(Boolean)
    );
    const extras = customPhotos.filter((p) => {
      const key = baseFileName(p);
      if (!key) return true;
      return !folderKeys.has(key);
    });
    photos = folderPhotos.concat(extras);
    renderHeroCarousel();
    // 后台标签页 rAF 不派发：没有兜底的话骨架屏会永久不退场（展厅空转）。
    // go 幂等，谁先到谁生效。
    let gallerySettled = false;
    const go = () => {
      if (gallerySettled) return;
      gallerySettled = true;
      applyFilter();
      if (afterGallery) afterGallery();
    };
    // 展厅渲染排到序厅画心**能立刻画出来之后**：lantern 的 LCP 图以观察 LCP 为截止，
    // 此前的一切网络 + 主线程工作（×4 CPU）都计入 Render Delay。只让出一帧不够——
    // 实测 load 完 ≠ 能画：decoding="async" 的 decode 任务排在展厅渲染后面，
    // 画心 paint 被顶到 266ms（观察 element render delay 168ms），整厅 18 卡的
    // style/layout 与全部卡片图请求照样落在截止线内（Render Delay 占 LCP 67%）。
    // 现在等首图 **decode 完成**再双 rAF：第一帧只画画心（LCP 在此结算），第二帧才动展厅。
    const heroImg = heroTrack?.querySelector(".hero-carousel-slide.is-active img");
    const schedule = () => requestAnimationFrame(() => requestAnimationFrame(go));
    if (heroImg) {
      const loaded = heroImg.complete
        ? Promise.resolve()
        : new Promise((resolve) => {
            heroImg.addEventListener("load", resolve, { once: true });
            heroImg.addEventListener("error", resolve, { once: true });
          });
      // decode() 自带失败分支（加载错误 / 不支持），.then(schedule, schedule) 两头都落
      loaded.then(() => heroImg.decode(), () => 0).then(schedule, schedule);
    } else {
      schedule();
    }
    setTimeout(go, 300);
  }

  /* preload 的 <link> 只增不减：每次 hover/focus/翻页都往 <head> 追加，
     100 张馆藏时会挂到约 200 个节点。这里分两类管理：
       priority === "high"（序厅首图，关键路径）→ 永久保留
       其余（卡片 hover / 灯箱相邻）           → 进可回收池，超上限按插入序淘汰
     淘汰不会造成重复下载：预载过的 URL 已在 HTTP 缓存里，SW 也落过盘，
     真到用时命中缓存，不额外产生请求。 */
  const PRELOAD_POOL_MAX = 24;
  const preloadPool = [];

  function trimPreloadPool() {
    while (preloadPool.length > PRELOAD_POOL_MAX) {
      const dead = preloadPool.shift();
      if (dead && dead.isConnected) dead.remove();
    }
  }

  /**
   * @param {string} href 回退 URL（不支持 imagesrcset 的老浏览器用）
   * @param {"high"|"auto"|"low"} priority
   * @param {{srcset?:string,sizes?:string}} [opts] 响应式候选：与 <picture> 用同一
   *   字符串同 sizes，选中结果才一致；否则预载中图、picture 选缩略图，白下一倍字节
   */
  function preloadImage(href, priority = "high", opts = {}) {
    if (!href && !opts.srcset) return;
    // 用属性比较而非拼选择器：href 含引号会让 querySelector 抛 SyntaxError，
    // 而这里在 loadFolderPhotos 的 try 内，异常会连带把整个图库清空
    const already = [...document.head.querySelectorAll('link[rel="preload"][as="image"]')]
      .some((l) => l.getAttribute("href") === href);
    if (already) return;
    const link = document.createElement("link");
    link.rel = "preload";
    link.as = "image";
    link.href = href || "";
    if (opts.srcset) {
      link.setAttribute("imagesrcset", opts.srcset);
      if (opts.sizes) link.setAttribute("imagesizes", opts.sizes);
    }
    // 声明 type：不支持该格式的浏览器跳过预载，避免 AVIF 在老浏览器白下。
    // 有 imagesrcset 时按**首个候选的 URL** 判定格式。这里曾拿整条候选串去
    // /\.avif$/ 匹配——而候选串是以宽度描述符结尾的（"…-400.avif 300w, …900w"），
    // $ 锚点永远落在 "900w" 后面，条件恒假 → type 从未写上，上面那句注释形同虚设
    // （e2e 红态实证：带 imagesrcset 的 preload，type 属性为空）。
    // 同一 srcset 的候选由 photos_lib 按同一格式整体产出（AVIF 串全是 .avif），
    // 故只看首个候选即可；退化为单 URL 的 href 同样适配。
    const firstUrl = String(opts.srcset || href || "")
      .split(",")[0]
      .trim()
      .split(/\s+/)[0];
    if (/\.avif$/i.test(firstUrl)) link.type = "image/avif";
    else if (/\.webp$/i.test(firstUrl)) link.type = "image/webp";
    link.setAttribute("fetchpriority", priority);
    document.head.appendChild(link);
    if (priority !== "high") {
      preloadPool.push(link);
      trimPreloadPool();
    }
  }

  /* —— URL hash 深链：#f=<年月> 筛选 / #p=<photo.id> 灯箱；纯锚点（#gallery 等）不干预 —— */
  const HASH_FILTER_RE = /^f=(\d{4}-\d{2})$/;
  const HASH_PHOTO_RE = /^p=(.+)$/;

  function setHash(hash) {
    // replaceState 不触发 hashchange，避免读写互激
    const base = location.href.split("#")[0];
    history.replaceState(null, "", hash ? base + "#" + hash : base);
  }

  function currentFilterHash() {
    return activeFilter === "all" ? "" : "f=" + encodeURIComponent(activeFilter);
  }

  function openLightboxFromHash(key) {
    const inVisible = visible.findIndex((p) => p.id === key);
    if (inVisible >= 0) {
      lb.open(inVisible, null);
      return;
    }
    // 筛选不含该画时按全量馆藏打开，与 hero 点击行为一致
    const allIdx = photos.findIndex((p) => p.id === key);
    if (allIdx >= 0) lb.open(allIdx, null, photos);
  }

  window.addEventListener("hashchange", () => {
    const hm = location.hash.slice(1);
    const fm = hm.match(HASH_FILTER_RE);
    if (fm) {
      if (fm[1] !== activeFilter) {
        activeFilter = fm[1];
        applyFilter(true); // 非法年月由 renderFilters 兜底退 all 并清 hash
      }
      return;
    }
    const pm = hm.match(HASH_PHOTO_RE);
    if (pm && !lb.isOpen()) {
      openLightboxFromHash(safeDecode(pm[1]));
    }
    // 纯锚点交给浏览器默认滚动
  });

  function applyFilter(syncHash) {
    const update = () => {
      if (activeFilter === "all") visible = photos.slice();
      else visible = photos.filter((p) => ymKey(p.date) === activeFilter);
      renderFilters();
      renderGallery();
      // 用户点 chip 才同步 #f 深链；初始/rebuild 调用不传，避免顶掉 URL 里的 #p
      if (syncHash) setHash(currentFilterHash());
    };
    // 首屏初始渲染不套 VT（gallery 为空）；筛选/数据重建走卡片级配对动画
    if (prefersViewTransitions() && gallery && gallery.childElementCount > 0) {
      startVT(update);
    } else {
      update();
    }
  }

  /* —— 顶栏下方半屏轮播 —— */
  const HERO_MAX = 8;
  let heroPos = 0;
  let heroTimer = 0;
  let heroSlides = [];
  let heroList = [];
  let heroSwiped = false;
  let heroUserPaused = false;
  let heroTempPaused = false;
  /** 观画室会话期间暂停。**独立于** heroTempPaused（后者由 hover / 拖拽持有），见 setHeroModalPaused */
  let heroModalPaused = false;

  /* 观画室的导航序列 / 焦点回归 / 缩放平移状态与全部手势，已迁往 src/lightbox.js —— 
     本文件自 P2-2 第二步起不再持有任何灯箱态。 */

  function syncHeroPauseButton() {
    if (!heroPauseBtn) return;
    const canAuto = !reduceMotion && heroSlides.length >= 2;
    heroPauseBtn.hidden = !canAuto;
    heroPauseBtn.setAttribute("aria-pressed", heroUserPaused ? "true" : "false");
    heroPauseBtn.setAttribute(
      "aria-label",
      heroUserPaused ? "继续自动轮播" : "暂停自动轮播"
    );
    // 图标切换交给 CSS（[aria-pressed="true"] 显播放、否则显暂停），
    // 不再用 ‖ / ▶ 文本字形——字形渲染依赖字体，图标不该依赖字体
  }

  /* —— 序厅邻张解锁（LCP 友好）—— */
  let heroNeighborsReady = false;
  function unlockHeroNeighbors() {
    if (heroNeighborsReady) return;
    heroNeighborsReady = true;
    if (heroSlides.length) applyHeroSources();
  }
  // 解锁 = 观察到带 url 的 LCP entry（序厅图已结算、离开 lantern 截止线）
  // 或 800ms 兜底（不支持该 entry 类型 / 图迟迟不来）。此后切换照常一次挂三张
  //（自动轮播 4.2s 远晚于解锁；手动秒切换时目标张本身必有 src）。
  try {
    const lcpObs = new PerformanceObserver((list) => {
      for (const e of list.getEntries()) {
        if (e.url) {
          lcpObs.disconnect();
          unlockHeroNeighbors();
          break;
        }
      }
    });
    lcpObs.observe({ type: "largest-contentful-paint", buffered: true });
  } catch {
    /* 老浏览器没有该 entry 类型：只靠下面的超时兜底 */
  }
  setTimeout(unlockHeroNeighbors, 800);

  /**
   * 只给「已解锁的 near 集合」挂 src——绝对定位会让 loading=lazy 全部失效。
   *
   * 邻张（前后各一）**延后到首图 LCP 结算后再挂**：这两张首访合计 ~184KB，
   * 发起时间落在观察 LCP 之前，simulate 的 LCP 图会把它们算进 Load/Render Delay。
   * A/B 实测摘掉它们：Load Delay 302→221、Render Delay 1751→1526、
   * LCP 2562→2247（过 2500 断言线）。解锁条件见 unlockHeroNeighbors。
   */
  function applyHeroSources() {
    const n = heroSlides.length;
    if (!n) return;
    const near = new Set([heroPos]);
    if (heroNeighborsReady) {
      near.add((heroPos + 1) % n);
      near.add((heroPos - 1 + n) % n);
    }
    heroSlides.forEach((slide, i) => {
      const img = slide.querySelector("img");
      const source = slide.querySelector("source");
      const photo = heroList[i];
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
        if (i === heroPos) {
          img.loading = "eager";
          img.fetchPriority = "high";
          if (photo.palette) {
            // 预计算调色板：不必等中图解码，切到本张时墙色立刻即终点色，
            // 省掉「先默认深绿 → 解码后再变」的一次色跳（P1-6）
            applyRoomToHero(photo.palette);
          } else {
            // 上传图无预计算值：等解码后采样，与 P1-6 前行为一致
            const syncRoom = () => {
              if (heroPos !== i) return;
              applyRoomToHero(sampleRoomColor(img));
            };
            // src 被摘掉再挂回时 complete 会短暂为 false，必须重新绑 load
            if (srcChanged || !img.dataset.roomBound) {
              img.dataset.roomBound = "1";
              if (img.complete) syncRoom();
              else img.addEventListener("load", syncRoom, { once: true });
            } else if (img.complete) {
              applyRoomToHero(sampleRoomColor(img));
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

  function stopHeroAuto() {
    if (heroTimer) {
      clearInterval(heroTimer);
      heroTimer = 0;
    }
    stopHeroProgress();
  }

  function heroAutoAllowed() {
    return (
      !reduceMotion &&
      !heroUserPaused &&
      !heroTempPaused &&
      !heroModalPaused &&
      !document.hidden &&
      heroSlides.length >= 2
    );
  }

  const HERO_INTERVAL = 4200;

  function startHeroProgress() {
    stopHeroProgress();
    const bar = document.getElementById("heroProgressBar");
    if (!bar) return;
    bar.style.transition = "none";
    bar.style.transform = "scaleX(0)";
    void bar.offsetWidth;
    bar.style.transition = `transform ${HERO_INTERVAL}ms linear`;
    bar.style.transform = "scaleX(1)";
  }

  function stopHeroProgress() {
    // 这里曾有一份 heroProgressTimer（clearTimeout 后置 0）。它从来没有被赋过值：
    // 进度条走的是 CSS transform 过渡（startHeroProgress 里重置 + 触发），
    // 不需要 JS 计时器。保留它只会让下一位读者以为存在一条计时器生命周期。
    const bar = document.getElementById("heroProgressBar");
    if (bar) {
      bar.style.transition = "none";
      bar.style.transform = "scaleX(0)";
    }
  }

  function startHeroAuto() {
    stopHeroAuto();
    if (!heroAutoAllowed()) return;
    startHeroProgress();
    heroTimer = setInterval(() => {
      if (!heroAutoAllowed()) {
        stopHeroAuto();
        return;
      }
      setHeroIndex(heroPos + 1);
      startHeroProgress();
    }, HERO_INTERVAL);
  }

  function setHeroTempPaused(on) {
    heroTempPaused = !!on;
    startHeroAuto();
  }

  /**
   * 观画室会话期间暂停序厅轮播（由 src/lightbox.js 的 `pauseHero` 端口驱动）。
   *
   * ⚠️ 刻意**不复用** `heroTempPaused`：那个标志由 hover / 拖拽持有，共用会在关灯箱时
   * 把用户当时正持有的 hover 暂停一并清掉。
   *
   * 为什么必须暂停：序厅轮播没有任何模态门控（`heroAutoAllowed` 只看 reduceMotion /
   * 用户暂停 / `document.hidden`），灯箱开着时它仍每 4.2s 转走。而灯箱关闭时的视图过渡
   * 要缩回「用户点的那幅序厅画面」—— 转走后该 slide 变成 `opacity:0 / visibility:hidden`，
   * 配对到隐形状比不配对更糟。顺带省掉模态框背后毫无意义的轮播与图片预载。
   */
  function setHeroModalPaused(on) {
    heroModalPaused = !!on;
    startHeroAuto();
  }

  /**
   * 本会话的显式视图过渡源提供者（作为 `lb.open()` 的第 4 参数传入）。
   * 回答「photoId 此刻是否正由序厅某个**可见**画面承载」：是则返回该 `<img>`，
   * 灯箱便以它作 `view-transition-name` 的配对源 —— 那是用户实际点击的元素，且必然
   * 在视野内；而展厅里对应的那张卡片可能远在首屏之外（实测桌面溢出 284px、移动 236px）。
   *
   * 必须是**函数**而非元素快照：灯箱在 open 与 close 各调用一次，序厅在此期间可能已
   * 轮播（见 setHeroModalPaused），转走后须返回 null，宁可不配对也不给错动画。
   */
  function heroSourceFor(photoId) {
    if (!photoId) return null;
    const i = heroList.findIndex((p) => p.id === photoId);
    if (i < 0) return null;
    const slide = heroSlides[i];
    if (!slide || !slide.classList.contains("is-active")) return null;
    return slide.querySelector(".hero-art img");
  }

  function setHeroIndex(next) {
    if (!heroSlides.length) return;
    heroPos = (next + heroSlides.length) % heroSlides.length;
    heroSlides.forEach((el, i) => {
      el.classList.toggle("is-active", i === heroPos);
    });
    if (heroDots) {
      [...heroDots.children].forEach((dot, i) => {
        dot.classList.toggle("is-active", i === heroPos);
        if (i === heroPos) dot.setAttribute("aria-current", "true");
        else dot.removeAttribute("aria-current");
      });
    }
    applyHeroSources();
  }

  function renderHeroCarousel() {
    if (!heroTrack || !heroCarousel) return;
    stopHeroAuto();
    heroSlides = [];
    heroList = [];
    heroPos = 0;
    heroTempPaused = false;
    heroTrack.innerHTML = "";
    if (heroDots) heroDots.innerHTML = "";

    const list = photos.slice(0, HERO_MAX);
    if (!list.length) {
      heroCarousel.classList.add("is-empty");
      syncHeroPauseButton();
      // 序厅塌成 display:none 后必须重测：heroEnd 原本量的是整屏高，
      // 而 onScrollNav 只在启动期与 resize 时跑 —— scrollY(0) < 整屏高 恒真，
      // is-at-hero 常驻、顶栏馆名在首屏被隐去，而序厅大字并不在场（两者同时消失）。
      syncNavToHero();
      return;
    }
    heroCarousel.classList.remove("is-empty");
    // 首屏入场动画：首次渲染时添加 is-initial，动画完成后移除
    if (!heroCarousel.dataset.initialized) {
      heroCarousel.dataset.initialized = "1";
      heroCarousel.classList.add("is-initial");
      setTimeout(() => heroCarousel.classList.remove("is-initial"), 1500);
    }
    heroList = list;

    list.forEach((photo, i) => {
      const slide = document.createElement("div");
      slide.className = "hero-carousel-slide" + (i === 0 ? " is-active" : "");
      slide.setAttribute("role", "group");
      slide.setAttribute("aria-roledescription", "slide");
      slide.setAttribute("aria-label", `${i + 1} / ${list.length}`);
      slide.tabIndex = -1;

      const img = document.createElement("img");
      img.alt = displayTitle(photo, i);
      img.decoding = "async";
      img.loading = "lazy";
      img.fetchPriority = "low";
      // 响应式候选的布局宽度（与 .hero-art img max-width 对应），随 near/far 挂摘 srcset
      img.sizes = HERO_SIZES;
      if (photo.width && photo.height) {
        img.width = photo.width;
        img.height = photo.height;
      }
      // AVIF 候选：applyHeroSources 随 near/far 一起挂摘
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
        if (heroSwiped) {
          heroSwiped = false;
          return;
        }
        const inFilter = visible.findIndex((p) => p.id === photo.id);
        if (inFilter >= 0) {
          // 第 4 参数：以**序厅这幅画面**作过渡源，而不是展厅里那张可能在屏外的卡片
          lb.open(inFilter, slide, null, heroSourceFor);
          return;
        }
        // 筛选不含该画时，按全量馆藏打开，避免静默无响应
        const allIdx = photos.findIndex((p) => p.id === photo.id);
        if (allIdx >= 0) lb.open(allIdx, slide, photos, heroSourceFor);
      });

      heroTrack.appendChild(slide);
      heroSlides.push(slide);

      if (heroDots) {
        const dot = document.createElement("button");
        dot.type = "button";
        dot.className = "hero-carousel-dot" + (i === 0 ? " is-active" : "");
        dot.setAttribute("aria-label", `第 ${i + 1} 张`);
        if (i === 0) dot.setAttribute("aria-current", "true");
        dot.addEventListener("click", (e) => {
          e.stopPropagation();
          setHeroIndex(i);
          startHeroAuto();
        });
        heroDots.appendChild(dot);
      }
    });

    syncHeroPauseButton();
    applyHeroSources();
    startHeroAuto();
    // slides 建完后 hero 高度才定：与启动期那次测量对齐（最小高度 100vh，通常是同值）
    syncNavToHero();
  }

  if (heroPauseBtn) {
    heroPauseBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      heroUserPaused = !heroUserPaused;
      syncHeroPauseButton();
      startHeroAuto();
    });
  }

  if (heroPrev) {
    heroPrev.addEventListener("click", (e) => {
      e.stopPropagation();
      setHeroIndex(heroPos - 1);
      startHeroAuto();
    });
  }
  if (heroNext) {
    heroNext.addEventListener("click", (e) => {
      e.stopPropagation();
      setHeroIndex(heroPos + 1);
      startHeroAuto();
    });
  }

  if (heroCarousel) {
    let hx = 0;
    let hy = 0;
    let heroPointer = null;

    // 只有键盘焦点（:focus-visible）才算「用户在用键盘看轮播」：
    // 触屏/鼠标点按产生的焦点不该长期压住自动轮播，否则触屏点开灯箱、
    // 关闭后焦点还给 slide 时没有可见的移出方式，轮播会一直停着
    const keyboardFocusInHero = () => {
      const el = document.activeElement;
      return Boolean(el) && heroCarousel.contains(el) && el.matches(":focus-visible");
    };

    // 按压结束后的恢复：键盘焦点在内→保持焦点暂停；鼠标仍悬停→保持悬停暂停；
    // 触屏/笔没有持续悬停状态，抬起即恢复，不依赖可能缺失的 pointerleave
    const resumeAfterPress = (e) => {
      if (keyboardFocusInHero() || (e.pointerType === "mouse" && heroCarousel.matches(":hover"))) {
        startHeroAuto();
      } else {
        setHeroTempPaused(false);
      }
    };

    heroCarousel.addEventListener("pointerdown", (e) => {
      if (e.pointerType === "mouse" && e.button !== 0) return;
      if (e.isPrimary === false) return;
      heroPointer = e.pointerId;
      hx = e.clientX;
      hy = e.clientY;
      heroSwiped = false;
      setHeroTempPaused(true);
    });
    heroCarousel.addEventListener("pointerup", (e) => {
      if (heroPointer !== e.pointerId) return;
      heroPointer = null;
      const dx = e.clientX - hx;
      const dy = e.clientY - hy;
      if (Math.abs(dx) >= 40 && Math.abs(dx) > Math.abs(dy)) {
        heroSwiped = true;
        setHeroIndex(heroPos + (dx < 0 ? 1 : -1));
      }
      resumeAfterPress(e);
    });
    heroCarousel.addEventListener("pointercancel", (e) => {
      heroPointer = null;
      resumeAfterPress(e);
    });
    heroCarousel.addEventListener("pointerenter", () => setHeroTempPaused(true));
    heroCarousel.addEventListener("pointerleave", () => {
      if (heroPointer != null) return;
      if (keyboardFocusInHero()) {
        startHeroAuto();
        return;
      }
      setHeroTempPaused(false);
    });
    heroCarousel.addEventListener("focusin", () => {
      if (keyboardFocusInHero()) setHeroTempPaused(true);
    });
    heroCarousel.addEventListener("focusout", (e) => {
      if (heroCarousel.contains(e.relatedTarget)) return;
      if (heroPointer != null || heroCarousel.matches(":hover")) {
        startHeroAuto();
        return;
      }
      setHeroTempPaused(false);
    });
  }

  document.addEventListener("visibilitychange", () => {
    startHeroAuto();
  });

  window
    .matchMedia("(prefers-reduced-motion: reduce)")
    .addEventListener("change", (e) => {
      reduceMotion = e.matches;
      renderGallery();
      syncHeroPauseButton();
      startHeroAuto();
    });

  function renderFilters() {
    if (!filterBar) return;
    // 键盘焦点保持：本函数每次 applyFilter 都整组重建 chip，被 Enter 激活的那个按钮
    // 会连根销毁 → 焦点回落 <body>，键盘用户的 Tab 位置全丢（APG 切换按钮组要求
    // 激活后焦点留在原 chip）。故先记下重建前焦点所在 chip，重建后原位还回。
    const focusedChipId =
      document.activeElement instanceof HTMLElement &&
      filterBar.contains(document.activeElement)
        ? document.activeElement.dataset.filterId || ""
        : "";
    const keys = collectFilters(photos);
    filterBar.innerHTML = "";

    const options = [{ id: "all", label: "全部" }].concat(
      keys.map((k) => ({ id: k, label: ymLabel(k) }))
    );

    if (!options.some((o) => o.id === activeFilter)) {
      // 该月份已不在馆藏里：退回全部，并同步 visible 供 renderGallery 使用
      activeFilter = "all";
      visible = photos.slice();
    }

    options.forEach((opt) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "filter-chip" + (opt.id === activeFilter ? " is-active" : "");
      btn.textContent = opt.id === "all" ? "全部展厅" : `${ymLabel(opt.id)}`;
      btn.setAttribute("aria-pressed", opt.id === activeFilter ? "true" : "false");
      // 焦点归属的稳定标识：重建后按它找回同一个 chip（不能用索引——选项集合会变）
      btn.dataset.filterId = opt.id;
      btn.addEventListener("click", () => {
        activeFilter = opt.id;
        applyFilter(true);
      });
      filterBar.appendChild(btn);
    });

    if (focusedChipId) {
      const restored = [...filterBar.children].find(
        (el) => el.dataset.filterId === focusedChipId
      );
      // preventScroll：键盘用户刚激活的 chip 就在眼前，重建不该引起页面跳动
      if (restored) restored.focus({ preventScroll: true });
    }
  }

  async function loadFolderPhotos() {
    // 离线间歇问题留痕时间线：window.__lf 记录当初每步（轻量，线上可查）
    const mark = (s) => {
      (window.__lf || (window.__lf = [])).push(s);
    };
    mark("start");
    try {
      let data = null;
      try {
        // 清单请求已由 index.html 的内联脚本在解析期发起（window.__milanManifest），
        // 这里复用同一 Promise——直连 fallback 只服务「内联脚本被拦截/未执行」的残障态
        const res = await (window.__milanManifest ||
          fetch("photos/manifest.json", { cache: "no-store" }));
        if (!res.ok) throw new Error("manifest missing");
        data = await res.json();
        mark("fetch-ok");
      } catch (e) {
        mark("fetch-throw:" + (e && e.name));
        // SW 层回落意外失守（离线时序/坏 response）时直接问 CacheStorage：
        // 它是存储层、不依赖 SW 拦截，install 快照必在——终结「离线 0 卡」
        const cached = await caches.match("photos/manifest.json", {
          ignoreSearch: true,
          // 与 sw.js 各 match 点同因：preview/dev 发 Vary: Origin，本缓存是同源自产内容
          ignoreVary: true,
        });
        if (cached) {
          data = await cached.json();
          mark("fallback-hit");
        } else {
          mark("fallback-miss");
          throw new Error("manifest unavailable", { cause: e });
        }
      }
      const list = Array.isArray(data) ? data : data.photos || [];
      folderPhotos = list.map((item, i) => {
        const src = item.src || item.file || `photos/${item}`;
        return {
          src,
          thumb: item.thumb || src,
          thumbSrcset: item.thumbSrcset || "",
          thumbAvifSrcset: item.thumbAvifSrcset || "",
          medium: item.medium || "",
          mediumAvif: item.mediumAvif || "",
          animated: Boolean(item.animated),
          title: item.title || "未命名",
          caption: item.caption || "",
          date: item.date || "",
          // file 必须保留：rebuildPhotos 靠 baseFileName(file/fileName)
          // 按文件名去重 folder 与 custom，缺了它去重会整体失效
          file: item.file || String(src).split("/").pop(),
          id: item.file || item.src || `f${i}`,
          width: Number(item.width) || 0,
          height: Number(item.height) || 0,
          // 序厅预载候选：sync 预算好的整串（hero-srcset 规则的家在 photos_lib）。
          // index.html 的内联脚本直接读 manifest 原件（不走这里）；本字段是给
          // app.js 的 preloadImage 用的兜底——两处取到同一串，才不会重复下不同候选。
          heroSrcset: item.heroSrcset || "",
          heroAvifSrcset: item.heroAvifSrcset || "",
          // 预计算墙色调色板：这里是逐字段白名单拷贝，新字段必须显式接管，
          // 漏掉不会报错、只会静默退回客户端采样（P1-6 就是这么被吞过一次）
          palette: item.palette || null,
        };
      });
      // 只预载序厅首图（= LCP 元素）：候选与 <picture> 同串同 sizes，选中即命中。
      // 第 2/3 张不预载——在 lantern 的 LCP 图里非低优先级图会计入 max(endTime)，
      // 与首图争模拟带宽反而拉长 LCP；它们本就会由 near 集合以低优先级加载。
      const firstHero = folderPhotos[0];
      if (firstHero) {
        preloadImage(heroSrc(firstHero), "high", {
          srcset: heroAvifSrcset(firstHero) || heroSrcset(firstHero),
          sizes: HERO_SIZES,
        });
      }
      mark("parsed:" + folderPhotos.length);
    } catch (e) {
      mark("outer-catch:" + (e && e.message));
      folderPhotos = [];
    }
    // 数据到达（无论成败）后才允许显示空状态
    galleryReady = true;
    // 深链初始解析：#f 在数据重建前套用（非法/过期年月由 renderFilters 兜底退 all）
    const hm = location.hash.slice(1);
    const fm0 = hm.match(HASH_FILTER_RE);
    if (fm0) activeFilter = fm0[1];
    // 骨架屏与 #p 深链都挪进 afterGallery：展厅现在延后一帧渲染，
    // 若在重建前就摘骨架屏，会出现「骨架屏没了、卡片也没进来」的空档（CLS）
    rebuildPhotos(() => {
      if (skeletonEl) skeletonEl.hidden = true;
      mark("done:" + folderPhotos.length);
      const pm0 = hm.match(HASH_PHOTO_RE);
      // 与 hashchange 路径一致用 safeDecode：`#p=%` 这类被改坏的 hash 会让裸
      // decodeURIComponent 抛 URIError，异常穿出 loadFolderPhotos 后被调用点的
      // catch 当成「取清单失败」处理——展厅其实已渲染，却会再盖一层空状态提示。
      if (pm0) openLightboxFromHash(safeDecode(pm0[1]));
    });
  }

  const DB_NAME = "milan-photos";
  const STORE = "uploads";

  function openDb() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE)) {
          db.createObjectStore(STORE, { keyPath: "id" });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  async function idbPut(record) {
    const db = await openDb();
    try {
      await new Promise((resolve, reject) => {
        const tx = db.transaction(STORE, "readwrite");
        tx.objectStore(STORE).put(record);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
    } finally {
      db.close();
    }
  }

  async function idbGetAll() {
    const db = await openDb();
    try {
      return await new Promise((resolve, reject) => {
        const tx = db.transaction(STORE, "readonly");
        const req = tx.objectStore(STORE).getAll();
        req.onsuccess = () => resolve(req.result || []);
        req.onerror = () => reject(req.error);
      });
    } finally {
      db.close();
    }
  }

  function revokeBlobUrl(url) {
    if (url && String(url).startsWith("blob:")) {
      try {
        URL.revokeObjectURL(url);
      } catch {
        /* ignore */
      }
    }
  }

  function revokePhotoUrls(photo) {
    revokeBlobUrl(photo?.src);
    if (photo?.thumb && photo.thumb !== photo.src) {
      revokeBlobUrl(photo.thumb);
    }
  }

  async function loadCustomPhotos() {
    const previous = customPhotos;
    try {
      const rows = await idbGetAll();
      rows.sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
      customPhotos = rows.map((r) => {
        const url = URL.createObjectURL(r.blob);
        return {
          id: r.id,
          src: url,
          thumb: url,
          title: r.title || "未命名",
          caption: r.caption || "",
          date: r.date || toLocalDate(r.createdAt || Date.now()),
          custom: true,
          fileName: r.fileName || "",
          animated:
            Boolean(r.animated) ||
            Boolean(r.blob && r.blob.type === "image/gif"),
          width: Number(r.width) || 0,
          height: Number(r.height) || 0,
        };
      });
    } catch {
      customPhotos = [];
    }
    /* 启动期与 loadFolderPhotos 的首次重建撞车：两个异步入口都无条件
       rebuildPhotos，带卡展厅就会渲染两次（实测第二次落在 manifest 重建后
       ~50ms）。卡片 <img> 跟着取两遍——首访页面尚未被 SW 接管时第一遍直连、
       第二遍再经 sw.js thumbSwr 走一次网络，两批请求全落在观测 LCP 之前，
       被 lantern 全算进 Render Delay；重复的 hero/展厅渲染也是同窗口内的
       主线程工作（×4 CPU）。两边都没有自定义图时状态零变化，直接跳过。 */
    if (!previous.length && !customPhotos.length) return;
    previous.forEach(revokePhotoUrls);
    rebuildPhotos();
  }

  function prefersViewTransitions() {
    return typeof document.startViewTransition === "function" && !reduceMotion;
  }

  /**
   * 启动 VT 并把三个 promise 全接住：hidden/被后续 skip 时 finished/ready/
   * updateCallbackDone 都会 reject InvalidStateError——漏接任何一个都会冒成
   * unhandledrejection（headless 可见时 VT 正常完成不 reject，e2e 单测难复现，
   * 线上 hidden 场景实测：只接 finished 每次交互仍冒 1 个）。
   */
  function startVT(update) {
    const t = document.startViewTransition(update);
    t.finished.catch(() => {});
    t.ready.catch(() => {});
    t.updateCallbackDone.catch(() => {});
    return t;
  }

  /* 观画室的开合 / 换图 / 预载 / 手势实现已整体迁往 src/lightbox.js（P2-2 第二步）。
     本文件只保留装配（顶部 createLightbox 调用）与调用点 lb.open(...)。 */

  function renderGallery() {
    if (!gallery) return;
    gallery.innerHTML = "";
    // 旧卡片脱离文档：作废它们排队中的墙色采样
    roomEpoch += 1;
    roomJobs.length = 0;
    // 空状态节点可能缺失（HTML 结构调整）：与其余绑定一样静默降级，
    // 不因一处裸写中断整个渲染
    if (emptyEl) emptyEl.hidden = !galleryReady || visible.length > 0;
    const wallIndexes = new Map(photos.map((photo, index) => [photo, index]));

    visible.forEach((photo, i) => {
      const card = document.createElement("button");
      card.type = "button";
      card.className = "card";

      // 这里曾有「首次渲染按序入场」（加 .card.is-enter + animationDelay）。
      // 已删：它**从未生效**——启动期那次 renderGallery() 的 visible 是空的，却仍旧
      // 在函数末尾写下 gallery.dataset.enterBound="1"，于是 18 张卡真正上墙时
      // `!enterBound` 恒为 false（实测 .card.is-enter 数量 0、animationDelay 全空）。
      // 而「修好」它是错的：序厅占满首屏，展厅整段在视口之外，0.5s 的一次性动画会在
      // 用户滚动到之前放完；且 .card.is-enter 的 animation 简写会把当前生效的滚动驱动
      // card-rise（animation-timeline: view()）顶成 auto（实测 timeline view()→auto）。
      // 想让卡片有入场感就用 @supports 里那条 card-rise，别再挂回 is-enter。

      // 策展节奏：每 7 张的末张做「重点陈列」，独占一行成为一面墙
      if ((i + 1) % 7 === 0) card.classList.add("is-feature");

      const titleText = displayTitle(photo, i);
      const wallIdx = wallIndexes.get(photo) ?? 0;
      const wallNo = wallNumber(wallIdx);
      // accessible name 需覆盖卡片内全部可见文本（图注编号 + 标题），否则 axe label-content-name-mismatch
      card.setAttribute("aria-label", `观展：${wallNo} ${titleText}`);
      // 筛选 View Transitions：按馆藏序号稳定命名，跨渲染配对（未命名元素走根 cross-fade）
      card.style.viewTransitionName = `milan-card-${wallIdx}`;

      const media = document.createElement("div");
      media.className = "card-media";

      // 墙签浮层：默认无字陈列，hover/键盘聚焦才浮现。
      // 单一文本节点：多节点列布局会被 axe 提取为 \n 分隔的可见文本，与 aria-label 无法匹配
      const anno = document.createElement("div");
      anno.className = "card-anno";
      anno.setAttribute("aria-hidden", "true");
      anno.textContent = `${wallNo} ${titleText}`;
      media.appendChild(anno);

      const img = document.createElement("img");
      img.src = photo.thumb || photo.src;
      if (photo.thumbSrcset) {
        img.srcset = photo.thumbSrcset;
        img.sizes =
          "(max-width: 560px) 46vw, (max-width: 834px) 40vw, 320px";
      }
      // AVIF 变体优先：source 的 sizes 与 img 保持一致，WebP 仍作回退
      let mediaEl = img;
      if (photo.thumbAvifSrcset) {
        const source = document.createElement("source");
        source.type = "image/avif";
        source.srcset = photo.thumbAvifSrcset;
        source.sizes = img.sizes;
        const picture = document.createElement("picture");
        picture.appendChild(source);
        picture.appendChild(img);
        mediaEl = picture;
      }
      img.alt = titleText;
      img.decoding = "async";
      // 展厅恒在序厅之后（首屏被 hero 占满）：卡片一律 lazy + 低优先级。
      // 曾把前 2 张设 eager/high——在 lantern 的 LCP 图里非低优先级图才计入
      // max(endTime)，eager/high 的卡片会与首图争模拟带宽并抬高 LCP 估值。
      // 浏览器的 lazy 阈值（视口外 ~1250px）仍会在滚动接近时提前拉取。
      img.loading = "lazy";
      img.fetchPriority = "low";
      if (photo.width && photo.height) {
        img.width = photo.width;
        img.height = photo.height;
        applyRowFit(card, media, photo.width, photo.height);
      } else if (img.complete && img.naturalWidth) {
        // 缓存命中的图不会再派发 load：直接同步量一次。否则 applyRowFit 永不执行，
        // 重点墙反算宽度用的 --fit 就没有任何写入点（它只在这里被写）。
        // 仅在缺宽高的条目上走到 —— manifest 条目与新建的 custom 记录都带宽高，
        // 走上面的同步分支；实际可达路径是 IndexedDB 里早于宽高字段的旧记录。
        applyRowFit(card, media, img.naturalWidth, img.naturalHeight);
      } else {
        img.addEventListener(
          "load",
          () => {
            applyRowFit(card, media, img.naturalWidth, img.naturalHeight);
          },
          { once: true }
        );
      }

      // 墙色优先用 manifest 预计算的调色板：不依赖图片解码，卡片一挂上墙色就是
      // 对的（P1-6 之前要等 img load，落地前是初始 #2a2418 → 首屏可见色跳）。
      // 只有上传图没有预计算值，才回落到客户端采样。
      if (photo.palette) {
        applyCardPalette(media, photo.palette);
      } else {
        const bindCardRoom = () => {
          // 采样进空闲队列：命中主线程的只有这一行 canvas 取色
          queueRoomJob(() => {
            const sampled = sampleRoomColor(img);
            if (!sampled || !media.isConnected) return;
            applyCardPalette(media, sampled);
          });
        };
        if (img.complete) bindCardRoom();
        else img.addEventListener("load", bindCardRoom, { once: true });
      }
      // 画心进独立裁切盒：.card-media 保持不裁切，墙面射灯（::before）才能溢出画框。
      // 裁切盒只负责 hover 缩放不出框，几何与旧版直接定位 img 等价。
      const glass = document.createElement("div");
      glass.className = "card-media-glass";
      glass.appendChild(mediaEl);
      media.appendChild(glass);
      if (photo.animated) {
        const badge = document.createElement("span");
        badge.className = "card-badge";
        badge.textContent = "GIF";
        badge.setAttribute("aria-hidden", "true");
        media.appendChild(badge);
      }

      card.appendChild(media);
      card.addEventListener("click", () => lb.open(i, card));
      // hover/聚焦即预载灯箱用图，点开「瞬出」（与 <picture> 选中格式一致才可复用）
      const prefetchLightbox = () => preloadImage(lightboxAvifOrFallback(photo), "auto");
      card.addEventListener("pointerenter", prefetchLightbox, { once: true });
      card.addEventListener("focus", prefetchLightbox, { once: true });
      gallery.appendChild(card);
    });
  }

  function setStatus(msg, isError) {
    if (!uploadStatus) return;
    uploadStatus.textContent = msg;
    uploadStatus.classList.toggle("is-error", Boolean(isError));
  }

  /** 上传前压缩：最长边 ≤2048px WebP；GIF/动图跳过压缩以免丢帧 */
  async function compressImage(file, maxEdge = 2048, quality = 0.82) {
    if (!file.type.startsWith("image/")) return file;
    // GIF 直接保留，灯箱可播放
    if (file.type === "image/gif") return file;
    try {
      const bitmap = await createImageBitmap(file, {
        imageOrientation: "from-image",
      });
      const { width, height } = bitmap;
      const scale = Math.min(1, maxEdge / Math.max(width, height));
      if (scale >= 1 && file.size < 600 * 1024) {
        bitmap.close();
        return file;
      }
      const w = Math.max(1, Math.round(width * scale));
      const h = Math.max(1, Math.round(height * scale));
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d");
      ctx.drawImage(bitmap, 0, 0, w, h);
      bitmap.close();
      const blob = await new Promise((resolve) =>
        canvas.toBlob(resolve, "image/webp", quality)
      );
      if (!blob || blob.size >= file.size) return file;
      const name = `${stripExt(file.name || "photo")}.webp`;
      return new File([blob], name, {
        type: "image/webp",
        lastModified: file.lastModified || Date.now(),
      });
    } catch {
      return file;
    }
  }

  /* —— GitHub Contents API —— */
  const GH_KEY = "milan-gh-sync";

  function loadGhConfig() {
    try {
      return JSON.parse(localStorage.getItem(GH_KEY) || "null") || null;
    } catch {
      return null;
    }
  }

  function saveGhConfig(cfg) {
    localStorage.setItem(GH_KEY, JSON.stringify(cfg));
  }

  function clearGhConfig() {
    localStorage.removeItem(GH_KEY);
  }

  function fillGhForm() {
    const cfg = loadGhConfig() || {
      repo: "iloat20/milan-photos",
      branch: "main",
      token: "",
    };
    const repoEl = document.getElementById("ghRepo");
    const branchEl = document.getElementById("ghBranch");
    const tokenEl = document.getElementById("ghToken");
    if (repoEl) repoEl.value = cfg.repo || "iloat20/milan-photos";
    if (branchEl) branchEl.value = cfg.branch || "main";
    if (tokenEl) tokenEl.value = cfg.token || "";
  }

  function readGhForm() {
    const repo = (document.getElementById("ghRepo")?.value || "").trim();
    const branch = (document.getElementById("ghBranch")?.value || "main").trim() || "main";
    const token = (document.getElementById("ghToken")?.value || "").trim();
    if (!repo.includes("/")) throw new Error("仓库格式应为 owner/repo");
    if (!token) throw new Error("请先填写 GitHub Token");
    return { repo, branch, token };
  }

  function b64FromBuffer(buf) {
    const bytes = new Uint8Array(buf);
    let bin = "";
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) {
      bin += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
    }
    return btoa(bin);
  }

  /* 所有 GitHub API 调用都走这里：统一「三件套头」+ 统一超时。
     原先三处各自手写同一组头（漂移风险），而且**完全没有超时** —— 连接挂住时 fetch
     永不 reject，状态条会永远停在「正在同步到 GitHub…」，用户既看不到失败也无法重试。
     AbortSignal.timeout 是平台原语（Baseline 2022），不必手搓计时器；每次调用新建一个
     signal（同一个 signal 超时后不可复用）。 */
  const GH_TIMEOUT_MS = 30_000;

  async function ghFetch(url, cfg, init = {}) {
    try {
      return await fetch(url, {
        ...init,
        headers: {
          Authorization: `Bearer ${cfg.token}`,
          Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28",
          ...init.headers,
        },
        signal: AbortSignal.timeout(GH_TIMEOUT_MS),
      });
    } catch (err) {
      // 超时是 DOMException(TimeoutError)：翻成可读中文，与其它失败一样由 setStatus 呈现。
      // 附上 cause（本仓 eslint 的 preserve-caught-error 要求，同 manifest 那处）。
      if (err && err.name === "TimeoutError") {
        throw new Error("GitHub 响应超时（30 秒），请检查网络后重试", { cause: err });
      }
      throw err;
    }
  }

  async function ghGetFileSha(cfg, path) {
    const url = `https://api.github.com/repos/${cfg.repo}/contents/${path}?ref=${encodeURIComponent(cfg.branch)}`;
    const res = await ghFetch(url, cfg);
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`读取远端文件失败 (${res.status})`);
    const data = await res.json();
    return data.sha || null;
  }

  async function ghPutFile(cfg, path, contentB64, message) {
    const send = (sha) =>
      ghFetch(`https://api.github.com/repos/${cfg.repo}/contents/${path}`, cfg, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message,
          content: contentB64,
          branch: cfg.branch,
          ...(sha ? { sha } : {}),
        }),
      });

    let sha = await ghGetFileSha(cfg, path);
    let res = await send(sha);
    // 409 / 422 = sha 冲突（并发上传、或人工同时在网页提交）：基于陈旧 sha 的写入被拒。
    // 重取一次 sha 再写，否则这张图会永久失败、且用户看不出原因。
    if (res.status === 409 || res.status === 422) {
      sha = await ghGetFileSha(cfg, path);
      res = await send(sha);
    }
    if (!res.ok) {
      let detail = "";
      try {
        const err = await res.json();
        detail = err.message || "";
      } catch {
        /* ignore */
      }
      throw new Error(detail || `写入 GitHub 失败 (${res.status})`);
    }
    return res.json();
  }

  async function ghUpdateManifest(cfg, newItems) {
    const path = "photos/manifest.json";
    // 读取失败必须中止本次写入：一旦用空清单合并，会把远端 manifest
    // 覆盖成只剩本次新图，历史记录全部丢失。404（首次创建）才允许空清单。
    const sha = await ghGetFileSha(cfg, path);
    let photosList = [];
    if (sha) {
      const res = await ghFetch(
        `https://api.github.com/repos/${cfg.repo}/contents/${path}?ref=${encodeURIComponent(cfg.branch)}`,
        cfg
      );
      if (!res.ok) throw new Error(`读取远端清单失败 (${res.status})，已中止写入`);
      const data = await res.json();
      let parsed;
      try {
        // GitHub Contents API 返回 base64；必须按 UTF-8 解码，裸 atob 会弄坏中文标题
        const bin = atob(String(data.content || "").replace(/\n/g, ""));
        const bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
        const text = new TextDecoder("utf-8").decode(bytes);
        parsed = JSON.parse(text);
      } catch {
        throw new Error("远端清单解析失败，已中止写入以免覆盖历史记录");
      }
      photosList = Array.isArray(parsed) ? parsed : parsed.photos || [];
    }

    const existing = new Set(photosList.map((p) => p.src || p.file));
    const merged = newItems
      .filter((item) => !existing.has(item.src))
      .concat(photosList);

    const payload = JSON.stringify({ photos: merged }, null, 2);
    const payloadBytes = new TextEncoder().encode(payload);
    let bin = "";
    const chunk = 0x8000;
    for (let i = 0; i < payloadBytes.length; i += chunk) {
      bin += String.fromCharCode.apply(
        null,
        payloadBytes.subarray(i, i + chunk)
      );
    }
    await ghPutFile(cfg, path, btoa(bin), "chore: update photos manifest");
  }

  /** 只把图文件写进仓库，返回待并入 manifest 的条目。
   *  manifest 由调用方在**所有图都传完后一次性**更新 —— 原先每张图都重写整份清单
   *  （1 取 sha + 1 读内容 + 1 写 = 3 次往返），20 张就是 60 次往返，且每次都在
   *  「读-改-写」窗口内，并发或人工同时提交必撞 sha 冲突。 */
  async function pushPhotoToGitHub(cfg, blob, meta) {
    const path = `photos/${meta.fileName}`;
    const buf = await blob.arrayBuffer();
    await ghPutFile(cfg, path, b64FromBuffer(buf), `add photo: ${meta.fileName}`);

    const item = {
      src: `photos/${meta.fileName}`,
      file: meta.fileName,
      title: meta.title,
      caption: meta.caption,
      date: meta.date,
    };
    if (meta.width && meta.height) {
      item.width = meta.width;
      item.height = meta.height;
    }
    return item;
  }

  async function handleFiles(fileList) {
    const files = Array.from(fileList || []).filter((f) => f.type.startsWith("image/"));
    if (!files.length) {
      setStatus("请选择图片文件。", true);
      return;
    }

    const ghCfg = loadGhConfig();
    const ghReady = Boolean(ghCfg?.token);
    let okLocal = 0;
    let okGh = 0;
    let ghFail = 0;
    let fail = 0;
    // 收集本批全部待并入清单的条目，循环结束后一次性提交（见 pushPhotoToGitHub）
    const ghItems = [];

    for (const file of files) {
      // 本张图的 blob URL；入藏 customPhotos 后转移所有权并置空，
      // 没转移就失败时由 catch 回收，避免反复失败累积泄漏
      let objectUrl = "";
      try {
        if (file.size > 25 * 1024 * 1024) {
          fail += 1;
          continue;
        }
        setStatus(`正在压缩：${file.name}…`);
        const working = await compressImage(file);
        if (working.size > 8 * 1024 * 1024) {
          fail += 1;
          continue;
        }
        const id = uid();
        const date = toLocalDate(working.lastModified || file.lastModified || Date.now());
        const title = stripExt(file.name) || "新照片";
        const fileName = safeFileName(working);
        objectUrl = URL.createObjectURL(working);
        const dims = await new Promise((resolve) => {
          const probe = new Image();
          probe.onload = () =>
            resolve({ width: probe.naturalWidth, height: probe.naturalHeight });
          probe.onerror = () => resolve({ width: 0, height: 0 });
          probe.src = objectUrl;
        });
        const isAnimated = working.type === "image/gif" || file.type === "image/gif";
        const record = {
          id,
          blob: working,
          title,
          caption: "",
          date,
          fileName,
          animated: isAnimated,
          createdAt: working.lastModified || file.lastModified || Date.now(),
          width: dims.width,
          height: dims.height,
        };
        await idbPut(record);
        customPhotos.push({
          id,
          src: objectUrl,
          thumb: objectUrl,
          title,
          caption: "",
          date,
          custom: true,
          fileName,
          animated: isAnimated,
          width: dims.width,
          height: dims.height,
        });
        // URL 已交给 customPhotos 持有，失败路径不再回收
        objectUrl = "";
        okLocal += 1;

        if (ghReady) {
          setStatus(`正在同步到 GitHub：${file.name}…`);
          // 远端失败单独计数：本机已存成功，不该和本地失败混为一谈
          try {
            ghItems.push(
              await pushPhotoToGitHub(ghCfg, working, {
                fileName,
                title,
                caption: "",
                date,
                width: dims.width,
                height: dims.height,
              })
            );
          } catch (err) {
            ghFail += 1;
            if (err && err.message) setStatus(err.message, true);
          }
        }
      } catch (err) {
        fail += 1;
        if (objectUrl) revokeBlobUrl(objectUrl);
        if (err && err.message) setStatus(err.message, true);
      }
    }

    // 本批图文件都传完后一次性更新清单：往返从 3N 降到 4（取 sha + 读 + 写 + 重试余量）
    if (ghReady && ghItems.length) {
      setStatus(`正在更新展厅清单（${ghItems.length} 张）…`);
      try {
        await ghUpdateManifest(ghCfg, ghItems);
        okGh = ghItems.length;
      } catch (err) {
        // 图片文件已进仓库，但清单没更新 → 线上仍看不到，按整体失败计
        ghFail += ghItems.length;
        if (err && err.message) setStatus(err.message, true);
      }
    }

    rebuildPhotos();

    if (ghReady && okGh) {
      let msg = `本机 +${okLocal} 张，GitHub +${okGh} 张。Pages 会在 Actions 构建后更新（约 1 分钟）。`;
      if (ghFail) msg += ` 另有 ${ghFail} 张远端同步失败，已在本机保留。`;
      // fail 只在本机阶段累加（文件过大 / 解码失败）。不给文案的话，
      // Boolean(ghFail || fail) 会把状态条点成红灯却不说明原因。
      if (fail) msg += ` 另有 ${fail} 张本地失败（文件过大）。`;
      setStatus(msg, Boolean(ghFail || fail));
    } else if (okLocal && ghFail) {
      setStatus(`本机 +${okLocal} 张已保存，但 GitHub 同步失败 ${ghFail} 张，请稍后重试。`, true);
    } else if (okLocal && !fail) {
      setStatus(`已在本机添加 ${okLocal} 张（未配置 GitHub Token，仅本机可见）。`);
    } else if (okLocal && fail) {
      setStatus(`本机 +${okLocal}，失败 ${fail} 张。`, true);
    } else {
      setStatus("添加失败，请重试或换较小的图片。", true);
    }

    const target = document.getElementById("gallery");
    if (target && okLocal) target.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth" });
  }

  if (addPhotoBtn && photoInput) {
    addPhotoBtn.addEventListener("click", () => photoInput.click());
    photoInput.addEventListener("change", () => {
      handleFiles(photoInput.files);
      photoInput.value = "";
    });
  }

  const ghSaveBtn = document.getElementById("ghSaveBtn");
  const ghClearBtn = document.getElementById("ghClearBtn");
  if (ghSaveBtn) {
    ghSaveBtn.addEventListener("click", () => {
      try {
        const cfg = readGhForm();
        saveGhConfig(cfg);
        setStatus("GitHub 同步设置已保存。之后上传会写入仓库。");
      } catch (err) {
        setStatus(err.message || "保存失败", true);
      }
    });
  }
  if (ghClearBtn) {
    ghClearBtn.addEventListener("click", () => {
      clearGhConfig();
      fillGhForm();
      setStatus("已清除 GitHub 设置。");
    });
  }
  fillGhForm();

  /* 灯箱全部事件监听（箭头 / 关闭 / 指针手势 / 滚轮 / Esc / 方向键）已随域迁入
     src/lightbox.js，在 createLightbox 调用时完成装配。 */

  const siteNav = document.getElementById("siteNav");
  // 序厅门厅大字与顶栏馆名同屏重复：大字在场时隐去顶栏馆名，滚入展厅再浮现
  let heroEnd = Infinity;
  function measureHeroEnd() {
    // siteNav 缺失（HTML 结构调整 / SW 旧壳层配新页面）时**不得**裸取 offsetHeight：
    // 本条在启动期就于 renderFilters / renderGallery / loadFolderPhotos **之前**求值，
    // 抛 TypeError 会中断整个 IIFE —— 展厅 0 卡、骨架屏永不退场、主题按钮也没绑上。
    // 这正是 on() 守卫要挡的那类故障（实证：删掉 <header id="siteNav"> 后 cards=0、
    // skeleton.hidden=false、pageerror「Cannot read properties of null」）。
    //
    // is-empty（display:none）必须显式按 0 处理：display:none 的元素 offset 都是 0，
    // 但「0 高」与「未测量」都会给出 0，靠 offset 区分不出来 —— 而语义完全不同：
    // 序厅不在场时没有任何大字需要避让，馆名必须一直可见（heroEnd=0 → scrollY(0) 不小于它）。
    heroEnd =
      heroCarousel && siteNav && !heroCarousel.classList.contains("is-empty")
        ? heroCarousel.offsetTop + heroCarousel.offsetHeight - siteNav.offsetHeight
        : 0;
  }
  function onScrollNav() {
    if (!siteNav) return;
    siteNav.classList.toggle("is-scrolled", window.scrollY > 40);
    siteNav.classList.toggle("is-at-hero", window.scrollY < heroEnd);
  }
  /**
   * 序厅高度变化后的一次「重量 + 同步」。
   *
   * 为什么必须有：heroEnd 只在启动期与 resize 时被测，但序厅高度是**会变的**——
   * 空馆藏/清单失败时 renderHeroCarousel 给它挂上 `is-empty` 塌成 display:none。
   * 不重测的话 scrollY(0) < 旧值（整屏高）恒真，`is-at-hero` 常驻，
   * 顶栏馆名被隐去而序厅大字并不在场——两者同时从首屏消失（e2e 红态实证）。
   */
  function syncNavToHero() {
    measureHeroEnd();
    onScrollNav();
  }
  syncNavToHero();
  window.addEventListener("scroll", onScrollNav, { passive: true });
  window.addEventListener("resize", syncNavToHero, { passive: true });

  renderFilters();
  renderGallery();
  // 浮空 Promise 必须落地：loadFolderPhotos 的 try/catch 只覆盖取清单那一段，
  // 之后的 rebuildPhotos / decodeURIComponent / openLightboxFromHash 若抛错
  // 会变成 unhandledrejection，且页面停在「骨架屏已隐藏但展厅空白」的状态。
  // 这里兜底放开空状态，让用户看到提示而不是一片空墙。
  loadFolderPhotos().catch((err) => {
    (window.__lf || (window.__lf = [])).push("unhandled:" + (err && err.message));
    galleryReady = true;
    if (skeletonEl) skeletonEl.hidden = true;
    if (emptyEl) emptyEl.hidden = false;
  });
  loadCustomPhotos().catch((err) => {
    (window.__lf || (window.__lf = [])).push("custom-unhandled:" + (err && err.message));
  });

  // dev 形态（npm run dev）不注册 SW。Vite dev 对**同一 URL 按请求形态返回不同内容**：
  // <link rel=stylesheet> 要 styles.css 拿到裸 CSS，而 SW 的 addAll / 页面 JS fetch
  // 拿到的是 JS 包装版（实测缓存里 content-type: text/javascript）。两种形态挤在
  // 同一缓存键上互相覆盖（shellSwr 的 revalidate 会把最后一次 fetch 的形态写回去），
  // 二次刷新后 <link> 命中包装版 → 样式全丢（.site-nav 掉回 static、cssRules 0）。
  // dev 缓存里的 app.js / index.html 还是 Vite 转换形态（带 HMR 注入），同样会让刷新
  // 跑旧代码。产物（build / preview）不受影响：dist 里 styles.css 是固定裸 CSS，
  // 且 import.meta.env.DEV 构建时被静态求值为 false，注册照旧。
  // 用 typeof 守卫而非裸 import.meta.env.DEV：万一被非 Vite 的静态服务器直服源码
  //（迁移前的老形态），裸引用会 TypeError 打挂整个 init；守卫下则退回「照常注册」。
  // SW 行为一律用 e2e 验证（preview 形态），不要在 dev 下测 SW。
  const isViteDev =
    typeof import.meta.env === "object" && import.meta.env !== undefined && import.meta.env.DEV === true;
  if ("serviceWorker" in navigator && !isViteDev) {
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("sw.js").catch(() => {
        /* file:// or unsupported — ignore */
      });
    });
  }

  /* —— 离线提示 ——
     本站离线仍可用（壳层 + 清单 + 已看过的图都进了 SW 缓存），但访客需要知道
     「现在看到的是缓存的、未看的画取不到」，否则只会觉得图片坏了。
     判定用 navigator.onLine：它只反映有没有网络接口，是个近似量——这里正是要
     近似（真去探连通性反而会多一次请求），故不额外探测。
     文本由 JS 写：live region 靠**文本变化**播报，节点常驻空串既不会在联网时
     被辅助技术读到一句反话，也能在离线瞬间被播报。 */
  const offlineNote = document.getElementById("offlineNote");
  function syncOfflineNote() {
    const off = navigator.onLine === false;
    document.body.classList.toggle("is-offline", off);
    if (offlineNote) offlineNote.textContent = off ? "离线观展 · 已缓存的作品仍可浏览" : "";
  }
  window.addEventListener("offline", syncOfflineNote);
  window.addEventListener("online", syncOfflineNote);
  syncOfflineNote();

  /* —— 主题切换：跟随系统 + 手动覆盖 ——
     注意这里**不再**读 localStorage 设初值：那件事已移到 index.html 的解析期内联脚本
     （在样式表之前执行，首帧即带 data-theme，消除主题闪烁）。此处留一份只会把
     「内联脚本被 CSP hash 失配拦下」这类故障**静默化**（闪烁回来但页面照常可用）——
     而回归网（smoke.spec.js 的 CSP 零违规 + 主题不依赖 app.js 两个用例）正是要抓它。
     手动切换的**写入**仍在这里，与内联脚本无重叠。 */
  const THEME_KEY = "milan-theme";
  const themeToggle = document.getElementById("themeToggle");
  if (themeToggle) {
    themeToggle.addEventListener("click", () => {
      // 没手动选过时 data-theme 缺省、页面跟随系统。此时必须先问系统当前是什么，
      // 否则 `undefined → "light"` 会让**亮色系统**的用户第一击原地不动（实测：
      // 亮色系统下首击 data-theme=light 而背景仍是 #fff，要第二击才变暗）。
      const current =
        document.documentElement.dataset.theme ||
        (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
      const next = current === "light" ? "dark" : "light";
      document.documentElement.dataset.theme = next;
      localStorage.setItem(THEME_KEY, next);
    });
  }
})();
