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
  lightboxAvifOrFallback,
} from "./src/util.js";
import { createLightbox } from "./src/lightbox.js";

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
    preload: preloadImage,
    applyRoom: applyRoomToLightbox,
    sampleRoom: sampleRoomColor,
    setHash,
    filterHash: currentFilterHash,
    prefersVT: prefersViewTransitions,
    startVT,
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

  function rebuildPhotos() {
    const folderKeys = new Set(
      folderPhotos.map(baseFileName).filter(Boolean)
    );
    const extras = customPhotos.filter((p) => {
      const key = baseFileName(p);
      if (!key) return true;
      return !folderKeys.has(key);
    });
    photos = folderPhotos.concat(extras);
    applyFilter();
    renderHeroCarousel();
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

  function preloadImage(href, priority = "high") {
    if (!href) return;
    // 用属性比较而非拼选择器：href 含引号会让 querySelector 抛 SyntaxError，
    // 而这里在 loadFolderPhotos 的 try 内，异常会连带把整个图库清空
    const already = [...document.head.querySelectorAll('link[rel="preload"][as="image"]')]
      .some((l) => l.getAttribute("href") === href);
    if (already) return;
    const link = document.createElement("link");
    link.rel = "preload";
    link.as = "image";
    link.href = href;
    // 声明 type：不支持该格式的浏览器跳过预载，避免 AVIF 在老浏览器白下
    if (/\.avif$/i.test(href)) link.type = "image/avif";
    else if (/\.webp$/i.test(href)) link.type = "image/webp";
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
    const glyph = heroPauseBtn.querySelector(".hero-pause-glyph");
    if (glyph) glyph.textContent = heroUserPaused ? "▶" : "‖";
  }

  /** 只给当前/前后一张挂 src——绝对定位会让 loading=lazy 全部失效 */
  function applyHeroSources() {
    const n = heroSlides.length;
    if (!n) return;
    const near = new Set([
      heroPos,
      (heroPos + 1) % n,
      (heroPos - 1 + n) % n,
    ]);
    heroSlides.forEach((slide, i) => {
      const img = slide.querySelector("img");
      const source = slide.querySelector("source");
      const photo = heroList[i];
      if (!img || !photo) return;
      const src = heroSrc(photo);
      const avif = photo.mediumAvif || "";
      if (near.has(i)) {
        const srcChanged = img.getAttribute("src") !== src;
        if (srcChanged) {
          if (source) source.srcset = avif;
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
        img.removeAttribute("src");
      }
    });
  }

  function stopHeroAuto() {
    if (heroTimer) {
      clearInterval(heroTimer);
      heroTimer = 0;
    }
  }

  function heroAutoAllowed() {
    return (
      !reduceMotion &&
      !heroUserPaused &&
      !heroTempPaused &&
      !document.hidden &&
      heroSlides.length >= 2
    );
  }

  function startHeroAuto() {
    stopHeroAuto();
    if (!heroAutoAllowed()) return;
    heroTimer = setInterval(() => {
      if (!heroAutoAllowed()) {
        stopHeroAuto();
        return;
      }
      setHeroIndex(heroPos + 1);
    }, 4200);
  }

  function setHeroTempPaused(on) {
    heroTempPaused = !!on;
    startHeroAuto();
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
      return;
    }
    heroCarousel.classList.remove("is-empty");
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
      if (photo.width && photo.height) {
        img.width = photo.width;
        img.height = photo.height;
      }
      // AVIF 候选：applyHeroSources 随 near/far 一起挂摘
      const heroSource = document.createElement("source");
      heroSource.type = "image/avif";
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

      const caption = document.createElement("div");
      caption.className = "hero-carousel-caption";
      const h = document.createElement("h2");
      h.textContent = "";
      caption.appendChild(h);
      slide.appendChild(caption);

      slide.addEventListener("click", () => {
        if (heroSwiped) {
          heroSwiped = false;
          return;
        }
        const inFilter = visible.findIndex((p) => p.id === photo.id);
        if (inFilter >= 0) {
          lb.open(inFilter, slide);
          return;
        }
        // 筛选不含该画时，按全量馆藏打开，避免静默无响应
        const allIdx = photos.findIndex((p) => p.id === photo.id);
        if (allIdx >= 0) lb.open(allIdx, slide, photos);
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
      btn.addEventListener("click", () => {
        activeFilter = opt.id;
        applyFilter(true);
      });
      filterBar.appendChild(btn);
    });
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
        const res = await fetch("photos/manifest.json", { cache: "no-store" });
        if (!res.ok) throw new Error("manifest missing");
        data = await res.json();
        mark("fetch-ok");
      } catch (e) {
        mark("fetch-throw:" + (e && e.name));
        // SW 层回落意外失守（离线时序/坏 response）时直接问 CacheStorage：
        // 它是存储层、不依赖 SW 拦截，install 快照必在——终结「离线 0 卡」
        const cached = await caches.match("photos/manifest.json", {
          ignoreSearch: true,
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
          // 预计算墙色调色板：这里是逐字段白名单拷贝，新字段必须显式接管，
          // 漏掉不会报错、只会静默退回客户端采样（P1-6 就是这么被吞过一次）
          palette: item.palette || null,
        };
      });
      if (folderPhotos[0]) {
        preloadImage(folderPhotos[0].mediumAvif || heroSrc(folderPhotos[0]));
      }
      mark("parsed:" + folderPhotos.length);
    } catch (e) {
      mark("outer-catch:" + (e && e.message));
      folderPhotos = [];
    }
    // 数据到达（无论成败）后才允许显示空状态
    galleryReady = true;
    if (skeletonEl) skeletonEl.hidden = true;
    // 深链初始解析：#f 在数据重建前套用（非法/过期年月由 renderFilters 兜底退 all）
    const hm = location.hash.slice(1);
    const fm0 = hm.match(HASH_FILTER_RE);
    if (fm0) activeFilter = fm0[1];
    rebuildPhotos();
    mark("done:" + folderPhotos.length);
    const pm0 = hm.match(HASH_PHOTO_RE);
    if (pm0) openLightboxFromHash(decodeURIComponent(pm0[1]));
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
    emptyEl.hidden = !galleryReady || visible.length > 0;
    const wallIndexes = new Map(photos.map((photo, index) => [photo, index]));

    visible.forEach((photo, i) => {
      const card = document.createElement("button");
      card.type = "button";
      card.className = "card";

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
      if (i < 2) {
        img.loading = "eager";
        img.fetchPriority = "high";
      } else {
        img.loading = "lazy";
        img.fetchPriority = "low";
      }
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

  async function ghGetFileSha(cfg, path) {
    const url = `https://api.github.com/repos/${cfg.repo}/contents/${path}?ref=${encodeURIComponent(cfg.branch)}`;
    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${cfg.token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
      },
    });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`读取远端文件失败 (${res.status})`);
    const data = await res.json();
    return data.sha || null;
  }

  async function ghPutFile(cfg, path, contentB64, message) {
    const send = (sha) =>
      fetch(`https://api.github.com/repos/${cfg.repo}/contents/${path}`, {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${cfg.token}`,
          Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28",
          "Content-Type": "application/json",
        },
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
      const res = await fetch(
        `https://api.github.com/repos/${cfg.repo}/contents/${path}?ref=${encodeURIComponent(cfg.branch)}`,
        {
          headers: {
            Authorization: `Bearer ${cfg.token}`,
            Accept: "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28",
          },
        }
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
  const measureHeroEnd = () => {
    heroEnd = heroCarousel
      ? heroCarousel.offsetTop + heroCarousel.offsetHeight - siteNav.offsetHeight
      : Infinity;
  };
  const onScrollNav = () => {
    if (!siteNav) return;
    siteNav.classList.toggle("is-scrolled", window.scrollY > 40);
    siteNav.classList.toggle("is-at-hero", window.scrollY < heroEnd);
  };
  measureHeroEnd();
  window.addEventListener("scroll", onScrollNav, { passive: true });
  window.addEventListener("resize", () => {
    measureHeroEnd();
    onScrollNav();
  }, { passive: true });
  onScrollNav();

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

  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("sw.js").catch(() => {
        /* file:// or unsupported — ignore */
      });
    });
  }
})();
