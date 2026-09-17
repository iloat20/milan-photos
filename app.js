(() => {
  /** @type {{src:string,title:string,caption:string,date?:string,id:string,custom?:boolean}[]} */
  let folderPhotos = [];
  /** @type {{src:string,title:string,caption:string,date?:string,id:string,custom?:boolean}[]} */
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

  const pad = (n) => String(n).padStart(2, "0");
  const uid = () => `u${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;

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
        title: item.title || "未命名",
        caption: item.caption || "",
        date: item.date || "",
        id: item.file || item.src || `f${i}`,
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
        title: r.title || "未命名",
        caption: r.caption || "",
        date: r.date || toLocalDate(r.createdAt || Date.now()),
        custom: true,
      }));
    } catch {
      customPhotos = [];
    }
    rebuildPhotos();
  }

  function openLightbox(index) {
    lbPos = index;
    syncLightbox();
    lightbox.hidden = false;
    document.body.classList.add("lb-open");
    closeBtn.focus();
  }

  function closeLightbox() {
    lightbox.hidden = true;
    document.body.classList.remove("lb-open");
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
      img.src = photo.src;
      img.alt = photo.title;
      img.loading = "eager";
      img.decoding = "async";
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

  async function handleFiles(fileList) {
    const files = Array.from(fileList || []).filter((f) => f.type.startsWith("image/"));
    if (!files.length) {
      setStatus("请选择图片文件。", true);
      return;
    }

    let ok = 0;
    let fail = 0;

    for (const file of files) {
      try {
        if (file.size > 8 * 1024 * 1024) {
          fail += 1;
          continue;
        }
        const id = uid();
        const date = toLocalDate(file.lastModified || Date.now());
        const record = {
          id,
          blob: file,
          title: stripExt(file.name) || "新照片",
          caption: "",
          date,
          createdAt: file.lastModified || Date.now(),
        };
        await idbPut(record);
        customPhotos.push({
          id,
          src: URL.createObjectURL(file),
          title: record.title,
          caption: "",
          date,
          custom: true,
        });
        ok += 1;
      } catch {
        fail += 1;
      }
    }

    rebuildPhotos();
    if (ok && !fail) setStatus(`已添加 ${ok} 张。`);
    else if (ok && fail) setStatus(`已添加 ${ok} 张，${fail} 张失败（过大或写入失败）。`, true);
    else setStatus("添加失败，请重试或换较小的图片。", true);

    const target = document.getElementById("gallery");
    if (target && ok) target.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth" });
  }

  if (addPhotoBtn && photoInput) {
    addPhotoBtn.addEventListener("click", () => photoInput.click());
    photoInput.addEventListener("change", () => {
      handleFiles(photoInput.files);
      photoInput.value = "";
    });
  }

  prevBtn.addEventListener("click", () => step(-1));
  nextBtn.addEventListener("click", () => step(1));
  closeBtn.addEventListener("click", closeLightbox);

  document.addEventListener("keydown", (e) => {
    if (lightbox.hidden) return;
    if (e.key === "Escape") closeLightbox();
    if (e.key === "ArrowLeft") step(-1);
    if (e.key === "ArrowRight") step(1);
  });

  window
    .matchMedia("(prefers-reduced-motion: reduce)")
    .addEventListener("change", (e) => {
      reduceMotion = e.matches;
      renderGallery();
    });

  renderFilters();
  renderGallery();
  loadFolderPhotos();
  loadCustomPhotos();
})();
