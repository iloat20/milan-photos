(() => {
  /** @type {{src:string,thumb?:string,thumbSrcset?:string,medium?:string,animated?:boolean,title:string,caption:string,date?:string,id:string,file?:string,fileName?:string,custom?:boolean,width?:number,height?:number}[]} */
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
  let lbPos = 0;
  let reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  const gallery = document.getElementById("galleryGrid");
  const filterBar = document.getElementById("filterBar");
  const emptyEl = document.getElementById("empty");
  const skeletonEl = document.getElementById("gallerySkeleton");
  const lightbox = document.getElementById("lightbox");
  const lbImg = document.getElementById("lbImg");
  const lbTitle = document.getElementById("lbTitle");
  const prevBtn = document.getElementById("prev");
  const nextBtn = document.getElementById("next");
  const closeBtn = document.getElementById("close");
  const addPhotoBtn = document.getElementById("addPhotoBtn");
  const photoInput = document.getElementById("photoInput");
  const uploadStatus = document.getElementById("uploadStatus");
  const heroCarousel = document.getElementById("heroCarousel");
  const heroTrack = document.getElementById("heroCarouselTrack");
  const heroDots = document.getElementById("heroCarouselDots");
  const heroPrev = document.getElementById("heroPrev");
  const heroNext = document.getElementById("heroNext");
  const heroPauseBtn = document.getElementById("heroPause");

  const pad = (n) => String(n).padStart(2, "0");
  const uid = () => `u${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;

  /** 从画作采样，生成可用于展厅的低饱和墙色 */
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
      // 画作色压进展厅深绿，保持油画馆气质
      let wall = mix(mix(avg, accent, 0.35), hall, 0.62);
      let glow = mix(mix(avg, accent, 0.55), hall, 0.35);
      let deep = mix(wall, dim, 0.45);
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
        accent: css(mix(accent, hall, 0.25), 0.75),
      };
    } catch {
      return null;
    }
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
  }

  function looksLikeFileTitle(title) {
    return (
      !title ||
      /^(img|dsc|pxl|mmexport|photo|image|未命名)/i.test(title) ||
      /^[\w.-]*\d{6,}/.test(title)
    );
  }

  function displayTitle(photo, index) {
    const t = (photo?.title || "").trim();
    if (!looksLikeFileTitle(t)) return `《${t}》`;
    return `《无题 · ${String(index + 1).padStart(2, "0")}》`;
  }

  function wallNumber(index) {
    return `MIL · ${String(index + 1).padStart(3, "0")}`;
  }

  function mediumLine(photo) {
    const year = (photo?.date || "").slice(0, 4);
    return year
      ? `布面数字影像，${year} · 米兰美术馆藏`
      : "布面数字影像 · 米兰美术馆藏";
  }

  function toLocalDate(msOrDate) {
    const d = msOrDate instanceof Date ? msOrDate : new Date(msOrDate);
    if (Number.isNaN(d.getTime())) return "";
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }

  function ymKey(dateStr) {
    if (!dateStr || typeof dateStr !== "string") return "";
    return dateStr.slice(0, 7);
  }

  function ymLabel(key) {
    const [y, m] = String(key || "").split("-");
    if (!y || !m) return String(key || "");
    return `${y}年${Number(m)}月`;
  }

  /** 用于 folder / custom 去重：取路径最后一段文件名 */
  function baseFileName(p) {
    const raw = p?.file || p?.fileName || "";
    if (raw) return String(raw).split("/").pop();
    return "";
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
    link.setAttribute("fetchpriority", priority);
    document.head.appendChild(link);
  }

  function collectFilters(list) {
    const keys = [];
    list.forEach((p) => {
      const k = ymKey(p.date);
      if (k && !keys.includes(k)) keys.push(k);
    });
    keys.sort().reverse();
    return keys;
  }

  function applyFilter() {
    const update = () => {
      if (activeFilter === "all") visible = photos.slice();
      else visible = photos.filter((p) => ymKey(p.date) === activeFilter);
      renderFilters();
      renderGallery();
    };
    // 首屏初始渲染不套 VT（gallery 为空）；筛选/数据重建走卡片级配对动画
    if (prefersViewTransitions() && gallery && gallery.childElementCount > 0) {
      document.startViewTransition(update);
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
  let lbReturnFocus = null;
  /** 灯箱导航序列；null 表示跟随当前筛选 visible */
  let lbList = null;

  function lightboxPhotos() {
    return lbList || visible;
  }

  /* —— 观画室缩放状态（双指捏合 / 双击 / 滚轮） —— */
  let lbZoom = 1;
  let lbTx = 0;
  let lbTy = 0;
  /** 单击切图后的双击观察窗口（浏览器 dblclick 判定约 500ms，取 450ms 对齐） */
  let tapTimer = 0;

  function applyLbTransform() {
    if (!lbImg) return;
    lbImg.style.setProperty("--lb-zoom", String(lbZoom));
    lbImg.style.setProperty("--lb-tx", `${lbTx}px`);
    lbImg.style.setProperty("--lb-ty", `${lbTy}px`);
    lbImg.classList.toggle("is-zoomed", lbZoom > 1);
  }

  function resetLbZoom(instant) {
    lbZoom = 1;
    lbTx = 0;
    lbTy = 0;
    // instant：借 is-panning 的 transition:none 瞬时归位（VT 快照用）
    if (instant) lbImg.classList.add("is-panning");
    applyLbTransform();
    if (instant) lbImg.classList.remove("is-panning");
  }

  function clampLbPan() {
    if (lbZoom <= 1) {
      lbTx = 0;
      lbTy = 0;
      return;
    }
    // 平移上限 = 缩放溢出的半幅，超出会露底
    const maxX = (lbImg.offsetWidth * (lbZoom - 1)) / 2;
    const maxY = (lbImg.offsetHeight * (lbZoom - 1)) / 2;
    lbTx = Math.min(maxX, Math.max(-maxX, lbTx));
    lbTy = Math.min(maxY, Math.max(-maxY, lbTy));
  }

  /** 锚点相对当前渲染矩形中心的屏幕偏移（变换围绕中心，中心含平移量） */
  function anchorRel(clientX, clientY) {
    const rect = lbImg.getBoundingClientRect();
    return {
      x: clientX - (rect.left + rect.width / 2),
      y: clientY - (rect.top + rect.height / 2),
    };
  }

  /** 锚点缩放：T' = T + rel * (1 - z'/z)，锚点处画面不动 */
  function zoomAtAnchor(nextZoom, relX, relY) {
    const z = Math.min(4, Math.max(1, nextZoom));
    if (z <= 1) {
      resetLbZoom(false);
      return;
    }
    const k = 1 - z / lbZoom;
    lbTx += relX * k;
    lbTy += relY * k;
    lbZoom = z;
    clampLbPan();
    applyLbTransform();
  }

  function toggleLbZoomAt(clientX, clientY) {
    if (lbZoom > 1) {
      resetLbZoom(false);
      return;
    }
    const rel = anchorRel(clientX, clientY);
    zoomAtAnchor(2.5, rel.x, rel.y);
  }

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

  function heroSrc(photo) {
    // 动图在轮播只用静态缩略图，避免首屏拉原文件
    if (photo?.animated) return photo.thumb || photo.src || "";
    return photo?.medium || photo?.thumb || photo?.src || "";
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
      const photo = heroList[i];
      if (!img || !photo) return;
      const src = heroSrc(photo);
      if (near.has(i)) {
        const srcChanged = img.getAttribute("src") !== src;
        if (srcChanged) {
          img.src = src;
        }
        if (i === heroPos) {
          img.loading = "eager";
          img.fetchPriority = "high";
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
        } else {
          img.loading = "lazy";
          img.fetchPriority = "low";
        }
      } else if (img.getAttribute("src")) {
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
      const art = document.createElement("div");
      art.className = "hero-art";
      art.appendChild(img);
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
          openLightbox(inFilter, slide);
          return;
        }
        // 筛选不含该画时，按全量馆藏打开，避免静默无响应
        const allIdx = photos.findIndex((p) => p.id === photo.id);
        if (allIdx >= 0) openLightbox(allIdx, slide, photos);
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
        applyFilter();
      });
      filterBar.appendChild(btn);
    });
  }

  async function loadFolderPhotos() {
    try {
      const res = await fetch("photos/manifest.json", { cache: "no-store" });
      if (!res.ok) throw new Error("manifest missing");
      const data = await res.json();
      const list = Array.isArray(data) ? data : data.photos || [];
      folderPhotos = list.map((item, i) => {
        const src = item.src || item.file || `photos/${item}`;
        return {
          src,
          thumb: item.thumb || src,
          thumbSrcset: item.thumbSrcset || "",
          medium: item.medium || "",
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
        };
      });
      if (folderPhotos[0]) {
        preloadImage(heroSrc(folderPhotos[0]));
      }
    } catch {
      folderPhotos = [];
    }
    // 数据到达（无论成败）后才允许显示空状态
    galleryReady = true;
    if (skeletonEl) skeletonEl.hidden = true;
    rebuildPhotos();
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

  function cardImageAt(index) {
    return gallery?.querySelectorAll(".card")[index]?.querySelector("img") || null;
  }

  function openLightbox(index, invoker, list) {
    lbList = list && list.length ? list : null;
    const sourceImg = lbList ? null : cardImageAt(index);
    if (sourceImg) sourceImg.style.viewTransitionName = "milan-lightbox-img";
    lbPos = index;
    lbReturnFocus =
      invoker ||
      sourceImg?.closest(".card") ||
      null;

    const finish = () => {
      if (sourceImg) sourceImg.style.viewTransitionName = "";
    };

    const reveal = () => {
      syncLightbox();
      if (!lightbox.open) lightbox.showModal();
      document.body.classList.add("lb-open");
      closeBtn.focus();
    };

    if (prefersViewTransitions()) {
      const t = document.startViewTransition(() => {
        if (sourceImg) sourceImg.style.viewTransitionName = "";
        reveal();
        lbImg.style.viewTransitionName = "milan-lightbox-img";
      });
      t.finished.finally(finish);
    } else {
      reveal();
      finish();
    }
  }

  function closeLightbox() {
    if (tapTimer) {
      clearTimeout(tapTimer);
      tapTimer = 0;
    }
    // 瞬时复位缩放：VT 的 old 快照要以完整画面回卡片
    resetLbZoom(true);
    const sourceImg = lbList ? null : cardImageAt(lbPos);
    const returnEl =
      lbReturnFocus ||
      sourceImg?.closest(".card") ||
      null;
    lbReturnFocus = null;
    lbList = null;

    const restoreFocus = () => {
      if (returnEl && typeof returnEl.focus === "function") {
        returnEl.focus({ preventScroll: true });
      }
    };
    const closeUpdate = () => {
      lbImg.style.viewTransitionName = "";
      lightbox.close();
      document.body.classList.remove("lb-open");
      if (sourceImg) sourceImg.style.viewTransitionName = "milan-lightbox-img";
    };

    if (prefersViewTransitions()) {
      const t = document.startViewTransition(() => {
        lbImg.style.viewTransitionName = "";
        lightbox.close();
        document.body.classList.remove("lb-open");
        if (sourceImg) sourceImg.style.viewTransitionName = "milan-lightbox-img";
      });
      t.finished.finally(() => {
        if (sourceImg) sourceImg.style.viewTransitionName = "";
        restoreFocus();
      });
    } else {
      closeUpdate();
      if (sourceImg) sourceImg.style.viewTransitionName = "";
      restoreFocus();
    }
  }

  function lightboxSrc(photo) {
    // 动图灯箱用原文件，保证能播
    if (photo?.animated) return photo.src || "";
    return photo?.medium || photo?.src || "";
  }

  function preloadLightboxNeighbor(delta) {
    const list = lightboxPhotos();
    if (!list.length) return;
    const next = list[(lbPos + delta + list.length) % list.length];
    const src = lightboxSrc(next);
    if (!src) return;
    const img = new Image();
    img.decoding = "async";
    if ("fetchPriority" in img) img.fetchPriority = "low";
    img.src = src;
  }

  function syncLightbox() {
    const list = lightboxPhotos();
    const photo = list[lbPos];
    if (!photo) return;
    // 换图复位缩放/平移
    resetLbZoom(false);
    const titleText = displayTitle(photo, lbPos);
    lbImg.src = lightboxSrc(photo);
    lbImg.alt = titleText;
    if (lbTitle) lbTitle.textContent = "";
    applyRoomToLightbox(null);
    const frame = lightbox?.querySelector(".lightbox-frame");
    if (frame) {
      frame.classList.remove("is-lit");
      void frame.offsetWidth;
      frame.classList.add("is-lit");
    }
    const roomSync = () => applyRoomToLightbox(sampleRoomColor(lbImg));
    if (lbImg.complete) roomSync();
    else lbImg.addEventListener("load", roomSync, { once: true });
    lbImg.style.animation = "none";
    void lbImg.offsetWidth;
    lbImg.style.animation = "";
    preloadLightboxNeighbor(1);
    preloadLightboxNeighbor(-1);
  }

  function step(delta) {
    const list = lightboxPhotos();
    if (!list.length) return;
    lbPos = (lbPos + delta + list.length) % list.length;
    syncLightbox();
  }

  function renderGallery() {
    if (!gallery) return;
    gallery.innerHTML = "";
    emptyEl.hidden = !galleryReady || visible.length > 0;

    visible.forEach((photo, i) => {
      const card = document.createElement("button");
      card.type = "button";
      card.className = "card";
      const titleText = displayTitle(photo, i);
      const wallIdx = Math.max(0, photos.indexOf(photo));
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
      } else {
        img.addEventListener(
          "load",
          () => {
            applyRowFit(card, media, img.naturalWidth, img.naturalHeight);
          },
          { once: true }
        );
      }

      const bindCardRoom = () => {
        const palette = sampleRoomColor(img);
        if (!palette) return;
        media.style.setProperty("--card-wall", palette.wall);
        media.style.setProperty("--card-glow", palette.glow);
        media.style.setProperty("--card-accent", palette.accent);
      };
      if (img.complete) bindCardRoom();
      else img.addEventListener("load", bindCardRoom, { once: true });
      media.appendChild(img);
      if (photo.animated) {
        const badge = document.createElement("span");
        badge.className = "card-badge";
        badge.textContent = "GIF";
        badge.setAttribute("aria-hidden", "true");
        media.appendChild(badge);
      }

      card.appendChild(media);
      card.addEventListener("click", () => openLightbox(i, card));
      // hover/聚焦即预载灯箱中图，点开「瞬出」（light rel preload 自带去重）
      const prefetchLightbox = () => preloadImage(lightboxSrc(photo), "auto");
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

  function stripExt(name) {
    return name.replace(/\.[^.]+$/, "");
  }

  function safeFileName(file) {
    const stamp = Date.now().toString(36);
    const base = (file.name || "photo")
      .replace(/[^\w.\-]+/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "");
    return `${stamp}-${base || "photo.jpg"}`;
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
    const sha = await ghGetFileSha(cfg, path);
    const res = await fetch(`https://api.github.com/repos/${cfg.repo}/contents/${path}`, {
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

  async function uploadToGitHub(file, meta) {
    const cfg = loadGhConfig();
    if (!cfg?.token) return { skipped: true };

    const path = `photos/${meta.fileName}`;
    const buf = await file.arrayBuffer();
    const contentB64 = b64FromBuffer(buf);
    await ghPutFile(cfg, path, contentB64, `add photo: ${meta.fileName}`);

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

    await ghUpdateManifest(cfg, [item]);

    return { skipped: false };
  }

  async function handleFiles(fileList) {
    const files = Array.from(fileList || []).filter((f) => f.type.startsWith("image/"));
    if (!files.length) {
      setStatus("请选择图片文件。", true);
      return;
    }

    const ghReady = Boolean(loadGhConfig()?.token);
    let okLocal = 0;
    let okGh = 0;
    let ghFail = 0;
    let fail = 0;

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
            await uploadToGitHub(working, {
              fileName,
              title,
              caption: "",
              date,
              width: dims.width,
              height: dims.height,
            });
            okGh += 1;
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

    rebuildPhotos();

    if (ghReady && okGh) {
      let msg = `本机 +${okLocal} 张，GitHub +${okGh} 张。Pages 会在 Actions 构建后更新（约 1 分钟）。`;
      if (ghFail) msg += ` 另有 ${ghFail} 张远端同步失败，已在本机保留。`;
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

  prevBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    step(-1);
  });
  nextBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    step(1);
  });
  closeBtn.addEventListener("click", closeLightbox);

  const stage = lightbox.querySelector(".lightbox-stage");
  let swipeX = 0;
  let swipeY = 0;
  let lbDidSwipe = false;
  /** 多指轨迹：id → 最近坐标；两指即捏合 */
  const lbPointers = new Map();
  let pinch = null;
  let panBase = null;

  stage.addEventListener("pointerdown", (e) => {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    if (e.target.closest?.(".lb-arrow")) return;
    stage.setPointerCapture?.(e.pointerId);
    lbPointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (lbPointers.size === 1) {
      swipeX = e.clientX;
      swipeY = e.clientY;
      panBase = { x: e.clientX, y: e.clientY, tx: lbTx, ty: lbTy };
      lbDidSwipe = false;
      pinch = null;
    } else if (lbPointers.size === 2) {
      const [a, b] = [...lbPointers.values()];
      const rect = lbImg.getBoundingClientRect();
      pinch = {
        d0: Math.hypot(a.x - b.x, a.y - b.y) || 1,
        mx0: (a.x + b.x) / 2,
        my0: (a.y + b.y) / 2,
        cx0: rect.left + rect.width / 2,
        cy0: rect.top + rect.height / 2,
        z0: lbZoom,
        tx0: lbTx,
        ty0: lbTy,
      };
      lbDidSwipe = true; // 捏合后的合成 click 吞掉
    }
  });

  stage.addEventListener("pointermove", (e) => {
    if (!lbPointers.has(e.pointerId)) return;
    lbPointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pinch && lbPointers.size >= 2) {
      const [a, b] = [...lbPointers.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y) || 1;
      const mx = (a.x + b.x) / 2;
      const my = (a.y + b.y) / 2;
      const z = Math.min(4, Math.max(1, pinch.z0 * (d / pinch.d0)));
      if (z <= 1) {
        lbZoom = 1;
        lbTx = 0;
        lbTy = 0;
      } else {
        // 锚定两指中点下的画面：T' = mx - cx0 + T0 - (z'/z0)*(mx0 - cx0)
        lbZoom = z;
        lbTx =
          mx - pinch.cx0 + pinch.tx0 - (lbZoom / pinch.z0) * (pinch.mx0 - pinch.cx0);
        lbTy =
          my - pinch.cy0 + pinch.ty0 - (lbZoom / pinch.z0) * (pinch.my0 - pinch.cy0);
        clampLbPan();
      }
      lbImg.classList.add("is-panning");
      applyLbTransform();
      return;
    }
    if (lbZoom > 1 && panBase) {
      // 缩放态拖拽平移（屏幕像素）；位移超阈值即视为拖动，吞掉合成 click
      const dx = e.clientX - panBase.x;
      const dy = e.clientY - panBase.y;
      if (Math.hypot(dx, dy) > 6) {
        lbDidSwipe = true;
        lbImg.classList.add("is-panning");
      }
      lbTx = panBase.tx + dx;
      lbTy = panBase.ty + dy;
      applyLbTransform();
    }
    // zoom === 1 的横滑在 pointerup 判定
  });

  const lbGestureEnd = (e) => {
    lbPointers.delete(e.pointerId);
    if (pinch && lbPointers.size < 2) {
      pinch = null;
      lbImg.classList.remove("is-panning");
      if (lbZoom < 1.05) {
        resetLbZoom(false);
      } else {
        clampLbPan();
        applyLbTransform();
      }
      // 剩余一指重置为单指基线，避免后续位移跳变
      const rest = [...lbPointers.values()][0];
      if (rest) {
        swipeX = rest.x;
        swipeY = rest.y;
        panBase = { x: rest.x, y: rest.y, tx: lbTx, ty: lbTy };
      }
      return;
    }
    if (lbPointers.size > 0) return; // 尚有手指未抬起
    panBase = null;
    lbImg.classList.remove("is-panning");
    if (lbZoom > 1) {
      clampLbPan();
      applyLbTransform();
      return;
    }
    if (e.type === "pointercancel") return;
    const dx = e.clientX - swipeX;
    const dy = e.clientY - swipeY;
    if (Math.abs(dx) >= 48 && Math.abs(dx) > Math.abs(dy) * 1.2) {
      lbDidSwipe = true;
      step(dx < 0 ? 1 : -1);
    }
  };
  stage.addEventListener("pointerup", lbGestureEnd);
  stage.addEventListener("pointercancel", lbGestureEnd);

  // 点按即时切图；450ms 内第二击回退第一击，交给 dblclick 做缩放
  stage.addEventListener("click", (e) => {
    if (e.target.closest?.(".lb-arrow")) return;
    if (lbDidSwipe) {
      lbDidSwipe = false;
      return;
    }
    if (tapTimer) {
      clearTimeout(tapTimer);
      tapTimer = 0;
      step(-1);
      return;
    }
    step(1);
    tapTimer = setTimeout(() => {
      tapTimer = 0;
    }, 450);
  });

  stage.addEventListener("dblclick", (e) => {
    if (e.target.closest?.(".lb-arrow")) return;
    if (tapTimer) {
      clearTimeout(tapTimer);
      tapTimer = 0;
    }
    toggleLbZoomAt(e.clientX, e.clientY);
  });

  stage.addEventListener(
    "wheel",
    (e) => {
      if (!e.target.closest?.(".lightbox-frame")) return;
      e.preventDefault();
      if (lbZoom === 1 && e.deltaY > 0) return;
      const rel = anchorRel(e.clientX, e.clientY);
      zoomAtAnchor(lbZoom * (e.deltaY < 0 ? 1.18 : 1 / 1.18), rel.x, rel.y);
    },
    { passive: false }
  );

  // Esc → <dialog> 的 cancel 事件统一走 VT 关闭动画
  lightbox?.addEventListener("cancel", (e) => {
    e.preventDefault();
    closeLightbox();
  });

  document.addEventListener("keydown", (e) => {
    if (!lightbox || !lightbox.open) return;
    // Esc 与 Tab 焦点圈定由 <dialog> 原生处理，这里只留翻页
    if (e.key === "ArrowLeft") step(-1);
    if (e.key === "ArrowRight") step(1);
  });

  const siteNav = document.getElementById("siteNav");
  const onScrollNav = () => {
    if (!siteNav) return;
    siteNav.classList.toggle("is-scrolled", window.scrollY > 40);
  };
  window.addEventListener("scroll", onScrollNav, { passive: true });
  onScrollNav();

  renderFilters();
  renderGallery();
  loadFolderPhotos();
  loadCustomPhotos();

  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("sw.js").catch(() => {
        /* file:// or unsupported — ignore */
      });
    });
  }
})();
