(() => {
  /** @type {{src:string,thumb?:string,title:string,caption:string,date?:string,id:string,custom?:boolean,width?:number,height?:number}[]} */
  let folderPhotos = [];
  /** @type {typeof folderPhotos} */
  let customPhotos = [];
  /** @type {typeof folderPhotos} */
  let photos = [];
  /** @type {typeof folderPhotos} */
  let visible = [];
  let activeFilter = "all";
  let lbPos = 0;
  let reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  const gallery = document.getElementById("galleryGrid");
  const filterBar = document.getElementById("filterBar");
  const emptyEl = document.getElementById("empty");
  const lightbox = document.getElementById("lightbox");
  const lbImg = document.getElementById("lbImg");
  const lbIndex = document.getElementById("lbIndex");
  const lbTitle = document.getElementById("lbTitle");
  const lbCaption = document.getElementById("lbCaption");
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

  const pad = (n) => String(n).padStart(2, "0");
  const uid = () => `u${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;

  // 等高 justified：用宽高比决定横向占比，行内节奏更整齐
  function applyRowFit(card, media, width, height) {
    const ar = width > 0 && height > 0 ? width / height : 4 / 3;
    const clamped = Math.max(0.7, Math.min(ar, 1.9));
    card.style.flexGrow = String(clamped);
    card.style.flexBasis = `${Math.round(200 * clamped)}px`;
    if (media) media.style.aspectRatio = "";
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
    const [y, m] = key.split("-");
    return `${y}年${Number(m)}月`;
  }

  function rebuildPhotos() {
    photos = folderPhotos.concat(customPhotos);
    applyFilter();
    renderHeroCarousel();
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
    if (activeFilter === "all") visible = photos.slice();
    else visible = photos.filter((p) => ymKey(p.date) === activeFilter);
    renderFilters();
    renderGallery();
  }

  /* —— 顶栏下方半屏轮播 —— */
  const HERO_MAX = 8;
  let heroPos = 0;
  let heroTimer = 0;
  let heroSlides = [];

  function stopHeroAuto() {
    if (heroTimer) {
      clearInterval(heroTimer);
      heroTimer = 0;
    }
  }

  function startHeroAuto() {
    stopHeroAuto();
    if (reduceMotion || heroSlides.length < 2) return;
    heroTimer = setInterval(() => {
      if (document.hidden) return;
      setHeroIndex(heroPos + 1);
    }, 4200);
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
        dot.setAttribute("aria-selected", i === heroPos ? "true" : "false");
      });
    }
  }

  function renderHeroCarousel() {
    if (!heroTrack || !heroCarousel) return;
    stopHeroAuto();
    heroSlides = [];
    heroPos = 0;
    heroTrack.innerHTML = "";
    if (heroDots) heroDots.innerHTML = "";

    const list = photos.slice(0, HERO_MAX);
    if (!list.length) {
      heroCarousel.classList.add("is-empty");
      return;
    }
    heroCarousel.classList.remove("is-empty");

    list.forEach((photo, i) => {
      const slide = document.createElement("div");
      slide.className = "hero-carousel-slide" + (i === 0 ? " is-active" : "");
      slide.setAttribute("role", "group");
      slide.setAttribute("aria-roledescription", "slide");
      slide.setAttribute("aria-label", `${i + 1} / ${list.length}`);

      const img = document.createElement("img");
      img.src = photo.thumb || photo.src;
      img.alt = photo.title;
      img.decoding = "async";
      if (i === 0) {
        img.loading = "eager";
        img.fetchPriority = "high";
      } else {
        img.loading = "lazy";
        img.fetchPriority = "low";
      }
      if (photo.width && photo.height) {
        img.width = photo.width;
        img.height = photo.height;
      }
      slide.appendChild(img);

      const caption = document.createElement("div");
      caption.className = "hero-carousel-caption";
      const h = document.createElement("h2");
      h.textContent = photo.title;
      caption.appendChild(h);
      if (photo.caption || photo.date) {
        const p = document.createElement("p");
        p.textContent = photo.caption || photo.date;
        caption.appendChild(p);
      }
      slide.appendChild(caption);

      slide.addEventListener("click", () => {
        const idx = visible.findIndex((p) => p.id === photo.id);
        if (idx >= 0) openLightbox(idx);
      });

      heroTrack.appendChild(slide);
      heroSlides.push(slide);

      if (heroDots) {
        const dot = document.createElement("button");
        dot.type = "button";
        dot.className = "hero-carousel-dot" + (i === 0 ? " is-active" : "");
        dot.setAttribute("role", "tab");
        dot.setAttribute("aria-label", `第 ${i + 1} 张`);
        dot.setAttribute("aria-selected", i === 0 ? "true" : "false");
        dot.addEventListener("click", (e) => {
          e.stopPropagation();
          setHeroIndex(i);
          startHeroAuto();
        });
        heroDots.appendChild(dot);
      }
    });

    startHeroAuto();
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
    heroCarousel.addEventListener(
      "touchstart",
      (e) => {
        if (e.touches.length !== 1) return;
        hx = e.touches[0].clientX;
        hy = e.touches[0].clientY;
        stopHeroAuto();
      },
      { passive: true }
    );
    heroCarousel.addEventListener(
      "touchend",
      (e) => {
        if (e.changedTouches.length !== 1) return;
        const dx = e.changedTouches[0].clientX - hx;
        const dy = e.changedTouches[0].clientY - hy;
        if (Math.abs(dx) >= 40 && Math.abs(dx) > Math.abs(dy)) {
          setHeroIndex(heroPos + (dx < 0 ? 1 : -1));
        }
        startHeroAuto();
      },
      { passive: true }
    );
  }

  document.addEventListener("visibilitychange", () => {
    if (document.hidden) stopHeroAuto();
    else startHeroAuto();
  });

  window
    .matchMedia("(prefers-reduced-motion: reduce)")
    .addEventListener("change", (e) => {
      reduceMotion = e.matches;
      renderGallery();
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
      activeFilter = "all";
      if (activeFilter === "all") visible = photos.slice();
      else visible = photos.filter((p) => ymKey(p.date) === activeFilter);
    }

    options.forEach((opt) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "filter-chip" + (opt.id === activeFilter ? " is-active" : "");
      btn.textContent = opt.label;
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
      folderPhotos = list.map((item, i) => ({
        src: item.src || item.file || `photos/${item}`,
        thumb: item.thumb || item.src || item.file || `photos/${item}`,
        title: item.title || "未命名",
        caption: item.caption || "",
        date: item.date || "",
        id: item.file || item.src || `f${i}`,
        width: Number(item.width) || 0,
        height: Number(item.height) || 0,
      }));
    } catch {
      folderPhotos = [];
    }
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
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).put(record);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  async function idbGetAll() {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, "readonly");
      const req = tx.objectStore(STORE).getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });
  }

  async function loadCustomPhotos() {
    try {
      const rows = await idbGetAll();
      rows.sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
      customPhotos = rows.map((r) => ({
        id: r.id,
        src: URL.createObjectURL(r.blob),
        thumb: URL.createObjectURL(r.blob),
        title: r.title || "未命名",
        caption: r.caption || "",
        date: r.date || toLocalDate(r.createdAt || Date.now()),
        custom: true,
        width: Number(r.width) || 0,
        height: Number(r.height) || 0,
      }));
    } catch {
      customPhotos = [];
    }
    rebuildPhotos();
  }

  function prefersViewTransitions() {
    return typeof document.startViewTransition === "function" && !reduceMotion;
  }

  function cardImageAt(index) {
    return gallery?.querySelectorAll(".card")[index]?.querySelector("img") || null;
  }

  function openLightbox(index) {
    const sourceImg = cardImageAt(index);
    if (sourceImg) sourceImg.style.viewTransitionName = "milan-lightbox-img";
    lbPos = index;

    const finish = () => {
      if (sourceImg) sourceImg.style.viewTransitionName = "";
    };

    if (prefersViewTransitions()) {
      const t = document.startViewTransition(() => {
        syncLightbox();
        lightbox.hidden = false;
        document.body.classList.add("lb-open");
        lbImg.style.viewTransitionName = "milan-lightbox-img";
      });
      t.finished.finally(finish);
    } else {
      syncLightbox();
      lightbox.hidden = false;
      document.body.classList.add("lb-open");
      finish();
    }
    closeBtn.focus();
  }

  function closeLightbox() {
    const sourceImg = cardImageAt(lbPos);
    const closeUpdate = () => {
      lbImg.style.viewTransitionName = "";
      lightbox.hidden = true;
      document.body.classList.remove("lb-open");
      if (sourceImg) sourceImg.style.viewTransitionName = "milan-lightbox-img";
    };

    if (prefersViewTransitions()) {
      const t = document.startViewTransition(closeUpdate);
      t.finished.finally(() => {
        if (sourceImg) sourceImg.style.viewTransitionName = "";
      });
    } else {
      closeUpdate();
      if (sourceImg) sourceImg.style.viewTransitionName = "";
    }
  }

  function preloadLightboxNeighbor(delta) {
    if (!visible.length) return;
    const next = visible[(lbPos + delta + visible.length) % visible.length];
    if (!next?.src) return;
    const img = new Image();
    img.decoding = "async";
    if ("fetchPriority" in img) img.fetchPriority = "low";
    img.src = next.src;
  }

  function syncLightbox() {
    const photo = visible[lbPos];
    if (!photo) return;
    lbImg.src = photo.src;
    lbImg.alt = photo.title;
    lbTitle.textContent = photo.title;
    lbCaption.textContent = photo.caption || photo.date || "";
    lbIndex.textContent = `${pad(lbPos + 1)} / ${pad(visible.length)}`;
    lbImg.style.animation = "none";
    void lbImg.offsetWidth;
    lbImg.style.animation = "";
    preloadLightboxNeighbor(1);
    preloadLightboxNeighbor(-1);
  }

  function step(delta) {
    if (!visible.length) return;
    lbPos = (lbPos + delta + visible.length) % visible.length;
    syncLightbox();
  }

  function renderGallery() {
    if (!gallery) return;
    gallery.innerHTML = "";
    emptyEl.hidden = visible.length > 0;

    visible.forEach((photo, i) => {
      const card = document.createElement("button");
      card.type = "button";
      card.className = "card";
      card.setAttribute("aria-label", `打开照片：${photo.title}`);

      const media = document.createElement("div");
      media.className = "card-media";

      const img = document.createElement("img");
      img.src = photo.thumb || photo.src;
      img.alt = photo.title;
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
      media.appendChild(img);

      const meta = document.createElement("div");
      meta.className = "card-meta";
      const title = document.createElement("h3");
      title.className = "card-title";
      title.textContent = photo.title;
      const caption = document.createElement("p");
      caption.className = "card-caption";
      caption.textContent = photo.caption || photo.date || "";
      meta.append(title, caption);

      card.append(media, meta);
      card.addEventListener("click", () => openLightbox(i));
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
    let photosList = [];
    try {
      const sha = await ghGetFileSha(cfg, path);
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
        if (res.ok) {
          const data = await res.json();
          const text = atob(String(data.content || "").replace(/\n/g, ""));
          const parsed = JSON.parse(text);
          photosList = Array.isArray(parsed) ? parsed : parsed.photos || [];
        }
      }
    } catch {
      photosList = [];
    }

    const existing = new Set(photosList.map((p) => p.src || p.file));
    const merged = newItems
      .filter((item) => !existing.has(item.src))
      .concat(photosList);

    const payload = JSON.stringify({ photos: merged }, null, 2);
    const b64 = btoa(unescape(encodeURIComponent(payload)));
    await ghPutFile(cfg, path, b64, "chore: update photos manifest");
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
    let fail = 0;

    for (const file of files) {
      try {
        if (file.size > 8 * 1024 * 1024) {
          fail += 1;
          continue;
        }
        const id = uid();
        const date = toLocalDate(file.lastModified || Date.now());
        const title = stripExt(file.name) || "新照片";
        const fileName = safeFileName(file);
        const objectUrl = URL.createObjectURL(file);
        const dims = await new Promise((resolve) => {
          const probe = new Image();
          probe.onload = () =>
            resolve({ width: probe.naturalWidth, height: probe.naturalHeight });
          probe.onerror = () => resolve({ width: 0, height: 0 });
          probe.src = objectUrl;
        });
        const record = {
          id,
          blob: file,
          title,
          caption: "",
          date,
          createdAt: file.lastModified || Date.now(),
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
          width: dims.width,
          height: dims.height,
        });
        okLocal += 1;

        if (ghReady) {
          setStatus(`正在同步到 GitHub：${file.name}…`);
          await uploadToGitHub(file, {
            fileName,
            title,
            caption: "",
            date,
            width: dims.width,
            height: dims.height,
          });
          okGh += 1;
        }
      } catch (err) {
        fail += 1;
        if (err && err.message) setStatus(err.message, true);
      }
    }

    rebuildPhotos();

    if (ghReady && okGh) {
      setStatus(
        `本机 +${okLocal} 张，GitHub +${okGh} 张。Pages 会在 Actions 构建后更新（约 1 分钟）。`
      );
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

  let swipeX = 0;
  let swipeY = 0;
  let swiping = false;

  lbImg.addEventListener("click", (e) => {
    e.stopPropagation();
    if (swiping) {
      swiping = false;
      return;
    }
    step(1);
  });

  const stage = lightbox.querySelector(".lightbox-stage");

  stage.addEventListener(
    "touchstart",
    (e) => {
      if (e.touches.length !== 1) return;
      swipeX = e.touches[0].clientX;
      swipeY = e.touches[0].clientY;
      swiping = false;
    },
    { passive: true }
  );

  stage.addEventListener(
    "touchend",
    (e) => {
      if (e.changedTouches.length !== 1) return;
      const dx = e.changedTouches[0].clientX - swipeX;
      const dy = e.changedTouches[0].clientY - swipeY;
      if (Math.abs(dx) < 48 || Math.abs(dx) < Math.abs(dy) * 1.2) return;
      swiping = true;
      step(dx < 0 ? 1 : -1);
    },
    { passive: true }
  );

  document.addEventListener("keydown", (e) => {
    if (lightbox.hidden) return;
    if (e.key === "Escape") closeLightbox();
    if (e.key === "ArrowLeft") step(-1);
    if (e.key === "ArrowRight") step(1);
  });

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
