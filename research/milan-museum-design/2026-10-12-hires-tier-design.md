# P-2 设计稿：高清显示层（2048 档 + 观画室按需求选档）

- 日期：2026-10-12
- 状态：**设计定稿，待实施**（实施后在此处补 §8 实施记录）
- 前置：`2026-10-10-upgrade-opportunity-audit.md` §9 的 P-2；依赖 `2026-10-11-lightbox-tier-fallback-design.md`（P-3/P-4，已实施）
- 对齐方式：逐项 brainstorming（范围 → 协商机制 → 档位上限与命名 → 边界用例，四轮问答；决策见 §0）
- 提交边界：单独一个 commit，`research/` 文档与实施代码分开提交

---

## 0. 决策摘要

| # | 议题 | 决策 | 否决的方案与理由 |
|---|---|---|---|
| ① | 范围 | 加高清档 + 观画室按需求选档 | 「保持单 URL 取最大档」：会让移动端被迫下 2048（DPR=3 下 1280 够用），**净回退** |
| ② | 协商机制 | **乙：JS 按需求像素选档**，仍是单 URL | 甲 `srcset`+`sizes` 交浏览器：`sizes` 表达不了「高度双约束」，竖图实测会多下约 60%；且预载须另选一档，易重回 P-3「预载 AVIF、渲染 WebP」那个坑。丙（两者结合）：两套机制并行，YAGNI |
| ③ | 档位上限 | **2048** | 1920：更大窗口（需求 1760）会略欠；多档（1280+1792+2048）：中间档几乎不会被选中 |
| ④ | 命名/契约 | `medium/<stem>-<目标长边>.webp\|.avif`；manifest 新增 `mediumSrcset` / `mediumAvifSrcset`，**不动现有 36 个文件与 `medium`/`mediumAvif` 标量** | 重命名对齐 thumbs 约定（要把 36 个文件改名，manifest / 序厅 / 逐图页 / e2e 全跟着动）；新建 `photos/large/`（多一个目录概念） |
| ⑤ | resize 重选档 | **不重选**（仅 open 时选一次） | 监听 resize 重选：会重置用户当前缩放/平移，体验更怪；灯箱是全屏浮层，打开期间改窗口极罕见 |
| ⑥ | 逐图展签页 | **纳入**候选（`<picture>` 已有 `srcset`，加候选即可） | 不纳入：高分屏下 SEO 落地页会欠采样 |
| ⑦ | **档位生成守卫（新，成本修正后重开）** | 见 §0.1 —— **推荐 `长边 > 2048` 才出档**（5 档） | 原文「9 张有 medium 的统一加档」是在 **+590 KB** 的成本口径下选的；实测该口径把「新增」误记成「替换」。真实成本见 §4 |

### 0.1 为什么重开 ⑦：成本口径被修正了 5 倍

先前记录的成本是「9 张全加 2048（AVIF 替换口径）+590 KB（1.6 MB → 约 3.1 MB）」。本次逐文件实测后修正：

- `photos/medium/` 现值 **1.6 MB**（WebP 924 KB + AVIF 668 KB，18 个文件，两种格式都发布）；
- 新增档若同时发布 WebP + AVIF（与现状一致），**9 张全量 = +3.30 MB**，不是 +590 KB；
- 其中 **3 张 1920×2560 竖图占 1.39 MB**（占全量 42%），而它们**桌面 DPR=2 已达标**（覆盖率 1.02），只在移动 DPR=3 上从 0.91 抬到 1.95；
- 而**审计真正要修的那 2 张 2560×1920 横图，两种格式合计只要 54 KB**。

三个备选的实测代价：

| 守卫 | 出档张数 | 新增体积 | dist 变化 | 买到什么 |
|---|---|---|---|---|
| `长边 > 2048`（**推荐**） | 5 | **+1.41 MB** | 11 → 12.4 MB（+13%） | 桌面 DPR2 那 2 张全部修好；3 张 1920×2560 竖图的移动端上限抬到 1.95 |
| `长边 > 1280`（原文「全量」） | 9 | +3.30 MB | 11 → 14.3 MB（+30%） | 以上，再加 3 张 1536×2048 与 1 张 1706 的移动端 0.91 → 1.46 |
| 仅那 2 张横图 | 2 | **+54 KB** | 基本不变 | 只买审计的目标项 |

**推荐 `长边 > 2048`**：出档谓词与 `ensure_medium()` 同为「长边超过上限」，语义一致；`<stem>-<目标长边>` 的命名在 5 张上恒为 `-2048`，不像全量方案里会冒出 `-1706` 这种杂音。

---

## 1. 证据基线（实施前不可跳过）

### 1.1 两处**先前记录有误**，本次实测更正

| 项 | 先前记录 | 实测更正 | 出处 |
|---|---|---|---|
| 观画室画框约束 | 「`max-width: min(86vw, 880px)` + `max-height: min(68vh, 700px)`，`styles.css:485-486`」 | **那是序厅画心**（`.hero-art img, .hero-carousel-slide img`）。观画室是 `.lightbox-frame`：`--frame-max-w: min(86vw, 940px)` / `--frame-max-h: min(72vh, 760px)`；图片可用区再各减 `--frame-pad(6px)` 与 `--frame-border(4px)` 两道；窄屏（≤834px）另有覆盖 | `styles.css:485-486`（序厅）；`:1264-1277`、`:1300-1301`（观画室）；`:1883-1891`（窄屏） |
| 移动端是否达标 | 「移动 390×844 DPR=3 除 360 那张外全部达标（覆盖 1.0–1.3）」 | **不成立**。按画框上限算，7 张有 medium 的竖图在移动 DPR=3 下覆盖率只有 **0.91–0.93**（需求宽 1052 vs 中图宽 960） | §1.3 表 |
| 审计说「1280 CSS px 的画框在 DPR=2 需 ~2560」 | —— | 画框**从来不是** 1280 CSS px，且实际受高度约束；DPR=2 的真实需求宽是 1676（桌面） / 1052（移动 DPR=3）。审计高估约 1.5 倍 | §1.3 |

### 1.2 一条测量污染（影响后续所有基准，务必记住）

灯箱 `<img>` 有入场动画 `lb-in 0.4s`，其 `transform: scale()` 从 **0.96** 起跳。所以**在动画期间读 `getBoundingClientRect()` 得到的尺寸会偏小约 4%**。

实测对照（桌面 1280×900 DPR=2，`IMG20260916193852.jpg` 2560×1920）：

```
按上限算（真值）  838 × 628   ← s = min(920/2560, 628/1920) = 0.327
探针读到（动画中）804 × 603   ← 838×0.96 / 628×0.96
```

→ **结论：档位选择不得读取渲染 rect，必须按画框上限算需求。** 本文所有 `需求/覆盖` 数字均按上限计算。

### 1.3 决定性证据：画框上限可以直接读计算样式

`.lightbox-img` 的 `max-width/max-height` 就是「画框可用区」，且**在 `<dialog>` 关闭态也解析为 px**：

```
桌面 1280x900 DPR2：  getComputedStyle(#lbImg) → 920px / 628px
移动 390x844  DPR3：  getComputedStyle(#lbImg) → 350.6px / 574.8px
闭合态（dialog.display === "none"）：  → 920px / 628px   ✅ 仍可读
```

探针：`.workbuddy/scratch/probe-caps.mjs`（输出见 `.workbuddy/scratch/preview.log` 对应那次运行）。

这条是本次设计的支点：**选档公式不需要在 JS 里复刻任何 CSS 常量**。先前的草案写「在 JS 里复刻 `min(0.86·vw, 940) − 20`」，那样会引入「CSS 改了、JS 没跟上」的静默漂移（与 `mediumWidth()` 双份实现同类，但更隐蔽，因为没有任何测试能发现）。改为读计算样式后，这类漂移**在结构上不可能发生**，且 hover 预载（dialog 未开）与开图走**同一个**函数，同源性是天然的。

### 1.4 源分辨率分布（决定 P-2 的射程）

| 原图长边 | 张数 | 有 medium | 例 |
|---|---|---|---|
| 2560 | 5 | ✅ | `IMG20260916193852`（2560×1920 横）、`IMG20260817155311`（1920×2560 竖） |
| 2048 | 3 | ✅ | `IMG20260817164949_01`（1536×2048 竖） |
| 1706 | 1 | ✅ | `mmexport1788447848472`（1279×1706 竖） |
| 1024 | 8 | ❌ | `01-city-rain` … `08-portrait-silhouette` |
| 360 | 1 | ❌ | `1700559942072` |

仓库内**没有**任何未入册的更大素材（18 个原图 = manifest 18 条，git 历史已重写）。所以 9 张（8×1024 + 1×360）**加档无效，只能补素材**。

### 1.5 需求 / 覆盖实测（按画框上限，DPR=2 / DPR=3）

桌面 1280×900 DPR2（上限 920×628，`needW = ceil(w · min(920/w, 628/h, 1) · 2)`）：

| 类别 | 张数 | 长边需求 | 现有最高档 | 覆盖 | 加 2048 档后 |
|---|---|---|---|---|---|
| 2560×1920 横 | 2 | 1676 | 1280 | **0.76 缺** | **1.22 ✅ 修好** |
| 1536×2048 竖 | 3 | 942 | 960 | 1.02 | 1.02（无变化） |
| 1920×2560 竖 | 3 | 942 | 960 | 1.02 | 1.02（无变化） |
| 1279×1706 竖 | 1 | 942 | 960 | 1.02 | 1.02（无变化） |
| 1024×901 | 8 | 1428 | 1024 | **0.72 缺** | ❌ 源不足 |
| 360×360 | 1 | 720 | 360 | **0.50 缺** | ❌ 源不足 |

→ 桌面欠采样 **11/18**，其中**只有 2 张能被加档修好**。

移动 390×844 DPR3（上限 350.6×574.8，需求宽 = 1052）：

| 类别 | 张数 | 现有最高档 | 覆盖 | 加 2048 档后 |
|---|---|---|---|---|
| 1536×2048 竖 | 3 | 960 | **0.91 缺** | 1.46 ✅ |
| 1920×2560 竖 | 3 | 960 | **0.91 缺** | 1.95 ✅ |
| 1279×1706 竖 | 1 | 960 | **0.91 缺** | 1.22 ✅ |
| 2560×1920 横 | 2 | 1280 | 1.22 | 选 1200 → 1.14（**省一点流量**） |
| 1024×901 | 8 | 1024 | 0.97 边缘 | 0.97 |
| 360×360 | 1 | 360 | **0.33 缺** | 0.33 |

→ 移动欠采样 **8/18**（7 张竖图 + 360）。**注意**：移动端并非「已经够」——加档对竖图是真实增益，而非浪费。

### 1.6 生成侧与护栏现状

| 事实 | 出处 |
|---|---|
| `THUMB_STEPS = (400, 800, 1200)`、`THUMB_MAX_EDGE = 1200`、`MEDIUM_MAX_EDGE = 1280`；两种格式质量 `78` / AVIF `55` | `tools/photos_lib.py:19-24` |
| `ensure_medium()` 对「长边 ≤ `MEDIUM_MAX_EDGE`」**直接返回 `None`**（不出档） | `tools/photos_lib.py:296-311` |
| `_write_webp_variant()` 产出名**固定**为 `<stem>.webp\|.avif`，故新增档需支持后缀参数 | `tools/photos_lib.py:214-246` |
| 中图像素尺寸**不进 manifest**，靠 `medium_width()` 由原图宽高反推 | `tools/photos_lib.py:313-330` |
| JS 侧同名实现 `mediumWidth()`，两份实现由真 manifest 契约测试钉住 | `src/util.js:161-168`；`tests/unit/medium-width.test.mjs` |
| `medium_width()` 的 docstring 把护栏写成 `tests/unit/hero-srcset.test.mjs` ——**该文件不存在**（真实是 `medium-width.test.mjs`） | `tools/photos_lib.py:316-317` |
| `thumbSrcset` 按每档**实际像素宽**声明、同宽去重、宽度升序 | `tools/photos_lib.py:421-439` |
| 灯箱 `<picture>` = `<source id="lbSource" type="image/avif" srcset="">` + `<img id="lbImg" class="lightbox-img">` | `index.html:273-277` |
| 灯箱赋值点：`source.srcset = … lightboxAvifOrFallback(photo)` / `img.src = lightboxSrc(photo)` | `src/lightbox.js:392-393` |
| hover 预载：`preloadImage(lightboxAvifOrFallback(photo), "auto")` | `app.js:1292` |
| 邻居预载：`preload(lightboxAvifOrFallback(next), "low")` | `src/lightbox.js:372-378` |
| `MAX_ZOOM = 4`（双击/捏合） | `src/lightbox.js:24` |
| `SHELL_ASSETS` 只列壳资源，**媒体走 runtime 缓存** → 新增档位**无需改 SW** | `public/sw.js:12-18` |
| global-setup 的产物能力自检 `required = ["thumbAvifSrcset", "palette"]`，判据是 **`items.every(...)`** | `tests/e2e/global-setup.js:202-207` |
| → 因此**不能**把 `mediumSrcset` 塞进 `required`：9 张无 medium 的条目必然缺该字段，自检会误报 | 同上（`every` 语义） |
| 中图档是「灯箱专用」：序厅用 `heroSrcset`（止于 1280），卡片墙用 `thumbSrcset` | `src/util.js:170-188` |

---

## 2. 设计

### 2.1 生成侧 —— `tools/photos_lib.py`

```python
MEDIUM_LARGE_MAX_EDGE = 2048   # 与 MEDIUM_MAX_EDGE 并列，唯一定义处
```

1. `_write_webp_variant(...)` 增加可选参数 `name_suffix: str = ""`，产出名变为 `<stem><name_suffix>.webp|.avif`（默认空串 → 现有行为逐字节不变）。
2. 新增 `ensure_medium_large(src)`：源长边 `> MEDIUM_LARGE_MAX_EDGE` 时产出 `<stem>-2048.webp|.avif`，否则返回 `None`（与 `ensure_medium()` 同谓词形状）。
3. `medium_width(item)` 泛化为 `medium_width_at(item, max_edge)`；`medium_width(item)` 成为 `max_edge=MEDIUM_MAX_EDGE` 的特例（**现有调用与契约测试零变化**）。
4. `photo_item()` 组装新增两个 srcset 字段（形态与 `thumbSrcset` 一致，宽度升序、同宽去重）：
   - `mediumSrcset`：1280 档 + 2048 档（按 `medium_width_at()` 各自反推的实际像素宽）
   - `mediumAvifSrcset`：同上，AVIF
   - **`medium` / `mediumAvif` 标量不动**（仍指 1280）→ 序厅 `heroSrcset`、逐图页 `og:image` 零变化。
5. 顺带修正 `medium_width()` docstring 里指向不存在文件的引用（改指 `tests/unit/medium-width.test.mjs`）。

### 2.2 消费侧 —— `src/util.js`（全部纯函数，可 `node --test` 直测）

```js
/** 画框可用区上限（px）：直接读计算样式，不复制任何 CSS 常量 */
export function frameCaps(imgEl) {
  const cs = getComputedStyle(imgEl);
  return { w: parseFloat(cs.maxWidth), h: parseFloat(cs.maxHeight) };
}

/** 该图在给定上限与 DPR 下的需求宽度（px）；min(...,1) 保证不放大 */
export function lightboxNeed(photo, caps, dpr) {
  const w = photo?.width, h = photo?.height;
  if (!w || !h || !caps?.w || !caps?.h) return 0;
  const s = Math.min(caps.w / w, caps.h / h, 1);
  return Math.ceil(w * s * dpr);
}

/** 候选档 [{url,w}]：解析 mediumSrcset + thumbSrcset，按 w 升序、按 url 去重 */
export function lightboxTiers(photo) { /* 静态图；动图返回 [] */ }
export function lightboxAvifTiers(photo) { /* 同上，AVIF 侧 */ }

/** 选 ≥ need 的最小档；全都比 need 小则取最大档 */
export function pickTier(tiers, need) { /* … */ }
```

`lightboxSrc` / `lightboxAvifOrFallback` / `largestStill` / `largestAvif`（P-3 产物）**保留不动**，作为「读不到上限或 `width/height` 缺失」时的兜底 —— 与 P-3 的语义「取最大可用档」一致，所以兜底路径不会比现状更差。

### 2.3 灯箱装配 —— `src/lightbox.js`

`sync()` 里（`src/lightbox.js:381-393`）把两处赋值改为「先选档，选不出再回落」：

```js
const caps = frameCaps(img);
const need = lightboxNeed(photo, caps, window.devicePixelRatio || 1);
const avif = pickTier(lightboxAvifTiers(photo), need);
const still = pickTier(lightboxTiers(photo), need);
if (source) source.srcset = photo.animated ? "" : (avif || lightboxAvifOrFallback(photo));
img.src = photo.animated ? lightboxSrc(photo) : (still || lightboxSrc(photo));
```

`preloadNeighbor()`（`:372-378`）改用**同一个**选档函数 —— 这是方案乙的核心收益：预载与 `<picture>` 天生同源，不会重现 P-3 那种「预载 A、渲染 B」的双下。

`app.js:1292` 的 hover 预载同理（dialog 未开也能读到 caps，见 §1.3）。

**不监听 resize**（决策 ⑤）。

### 2.4 逐图展签页 —— `tools/gen_work_pages.mjs`

`pictureSrcsets()` 把 `mediumSrcset` / `mediumAvifSrcset` 纳入候选（该页 `<picture>` 本来就带 `srcset`+`sizes`，交给浏览器原生协商即可，无需 JS）。

### 2.5 产物自检 —— `tests/e2e/global-setup.js`

**不能**把 `mediumSrcset` 加进 `required`（`every` 语义，见 §1.6）。改为追加一条**蕴含式**检查：

```
有 medium 的条目 ⇒ 必须有 mediumSrcset 与 mediumAvifSrcset
```

这样既拦住「降级版静默发布」，又不会对 9 张无 medium 的条目误报。

---

## 3. 测试与红态

**单测（`tests/unit/util.test.mjs`）**
- `frameCaps`：用**假 imgEl**（`getComputedStyle` 注入）验证返回值解析（含非数值回退）。
- `lightboxNeed`：已实测算例——`{2560×1920}` + `{920,628}` + DPR2 → **1676**；`{1536×2048}` + `{350.6,574.8}` + DPR3 → **1052**；小图 `{360×360}` → 不放大（`= 360·dpr`）。
- `pickTier`：空候选 → `""`；需求小于全部 → 最小档；需求大于全部 → 最大档；需求恰好等于某档宽 → 取该档（**边界必须实测**，`>=` 与 `>` 只差一像素）。
- `lightboxTiers` / `lightboxAvifTiers`：去重、升序、无 `mediumSrcset` 时退化为 thumb 档。

**真清单契约（新增，`tests/unit/`）**
- 对全部 18 条断言：**候选里出现的 `w` 描述符必须单调不减**，且每个 URL 都在 `photos/` 下真实存在。
- 反向自证（防空架子）：断言样本里**确有**长边 > 2048 的条目，否则 `pickTier` 无从被测。
- **JS ↔ Python 上限同步**：`medium-width.test.mjs` 的既有做法扩展到 `MEDIUM_LARGE_MAX_EDGE`（读 `photos_lib.py` 源正则取值，两边各钉一条）。

**e2e（`tests/e2e/smoke.spec.js`，2 条）**
1. **桌面 1280×900 / DPR2 打开 2560×1920 那张** → `#lbImg.currentSrc` 必须含 `-2048`。**这条是审计目标的判据。**
2. **移动 390×844 / DPR3 打开 2560×1920 那张** → `currentSrc` 必须是 **1200 档**（`thumbs/<stem>.webp`），**不得**是 2048 档。这条是**反退化断言**：证明「选档」不是「永远取最大档」。（实测：移动端该图需求宽 1052，最小够用档是 1200。）

**红态验证（两条，均须决定性）**
- **红①**：把 `pickTier` 改成「总返回最大档」→ 移动那条立刻红（收到 2048），证明 ② 的断言非空架子、且协商真实存在。
- **红②**：从 `lightboxTiers` 里去掉 `mediumSrcset` 候选 → 桌面那条红（收到 1280 档），证明候选链路有效。

两条都要在**单条 bash** 内完成「破坏 + 自检破坏已落地 + 跑测试 + 用 Edit 还原」，并注意本项目既有教训：**不要用源码文本 grep `dist/app.js` 核验产物**（esbuild 会把 `|| ""` 压成空模板字面量），改按语义判定；还原的判据是 `git diff` + 重建 + 复跑，不是 bash 的 `md5sum`。

---

## 4. 收益与成本（实测，非估算）

**收益**

| 口径 | 结果 |
|---|---|
| 桌面 DPR2 欠采样 | 11/18，**其中 2 张被修好**（0.76 → 1.22） |
| 移动 DPR3 欠采样 | 8/18；加档后 7 张竖图由 0.91 抬到 1.22–1.95，且 2 张横图由 1280 降到 1200（省流量） |
| 源分辨率不足的 9 张 | **加档无效**（8×1024 + 1×360），只能补素材 |
| 序厅 / 卡片墙 / SW | **零改动** |

**成本（Pillow 12.3.0，同参数 WebP q78 / AVIF q55；试算见 `.workbuddy/scratch/tier-cost.py`）**

| 文件 | 原图 | 现有 mediumAvif | 2048.avif | 2048.webp |
|---|---|---|---|---|
| `mmexport1788447848472` | 1279×1706 | 55.4 KB | *(1706 档)* 80.8 KB | — |
| `IMG20260817164949_01` | 1536×2048 | 92.2 KB | 228.3 KB | 289.4 KB |
| `IMG20260817164045` | 1536×2048 | 75.6 KB | 184.6 KB | 237.1 KB |
| `IMG20260817155446` | 1536×2048 | 163.4 KB | 392.4 KB | 524.7 KB |
| `IMG20260916193852` | 2560×1920 | 3.2 KB | **6.1 KB** | **10.2 KB** |
| `IMG20260916193836` | 2560×1920 | 8.2 KB | **16.2 KB** | **21.5 KB** |
| `IMG20260916193647` | 1920×2560 | 111.2 KB | 240.5 KB | 341.0 KB |
| `IMG20260817155358` | 1920×2560 | 65.0 KB | 160.3 KB | 206.1 KB |
| `IMG20260817155311` | 1920×2560 | 76.7 KB | 189.4 KB | 255.6 KB |

按 §0.1 的三个守卫分别汇总：

| 守卫 | 新增体积（WebP+AVIF） | dist |
|---|---|---|
| `长边 > 2048`（推荐，5 档） | **+1.41 MB** | 11 → 12.4 MB（+13%） |
| `长边 > 1280`（全量，9 档） | +3.30 MB | 11 → 14.3 MB（+30%） |
| 仅 2 张横图（2 档） | **+54 KB** | 基本不变 |

---

## 5. 边界用例

| # | 边界 | 处理 |
|---|---|---|
| 1 | 源 ≤1280 的 9 张 | 无 `mediumSrcset` → 候选只剩 thumb 档 → 行为与 P-3 后**完全一致** |
| 2 | 源长边恰好 = 2048（3 张） | 推荐守卫下**不出档**（`> 2048` 不成立）；桌面需求 942 已由 960 覆盖，故无损失；移动端 0.91 不修 |
| 3 | 源长边 = 1706（1 张） | 同上不出档 |
| 4 | 源长边 = 2560（5 张） | 出 2048 档；横图桌面修好，竖图移动端上限抬到 1.95 |
| 5 | 小图（360×360） | `lightboxNeed` 的 `min(...,1)` 保证不放大；候选只有 360 → 取 360 |
| 6 | 动图（当前 0 张） | `lightboxTiers` 返回 `[]` → 回落 `lightboxSrc()` 走原文件（不变） |
| 7 | AVIF 缺失（降级构建） | `lightboxAvifTiers` 为空 → 回落 `lightboxAvifOrFallback()` → WebP 同档 |
| 8 | 读不到 caps / `width·height` 缺失 | `need = 0` / caps 非数值 → 回落 P-3 的「最大可用档」 |
| 9 | 预载同源 | hover（`app.js:1292`）与邻居（`lightbox.js:372-378`）与 `<picture>` **共用选档函数** |
| 10 | 选档公式 vs 实际布局 | 上限**直接读计算样式**，无公式误差；仅依赖「计算样式 == 实际可用区」这一浏览器保证 |
| 11 | 打开期间 resize | 不重选（决策 ⑤）；用户已缩放/平移时不被打断 |
| 12 | 序厅 / 卡片墙 | **不动**（`medium` 标量仍为 1280，`heroSrcset` 零变化） |
| 13 | SW | **不动**（媒体走 runtime 缓存，`SHELL_ASSETS` 不含媒体） |
| 14 | P-1 前置 | 静态作品仍不触达 `src`，前置条件保持成立 |

---

## 6. 不在范围

- **P-1**（母版移出 `dist/`，占产物 49%）
- **P-5**（SW 版本 `milan-v49` 手工递增 → 构建期注入）
- **逐图页 CSP**（批次③遗留）
- **D-1**（`1700559942072` 仅 360×360）
- **8 张 1024 + 1 张 360 的素材补录**（内容项；做完 P-2 的射程可从 9 张扩到 18 张）
- 序厅与卡片墙的档位调整

---

## 7. 验收清单（实施后逐项核对）

1. `npm run lint` 干净；`npm run test:unit` 全绿（且新增用例确实因实现缺失而红过）
2. `npx playwright test` 全绿（含 §3 的 2 条新 e2e）
3. 两条红态验证均决定性通过（红①给 2048、红②给 1280）
4. `photos/manifest.json` 由 `npm run sync`（系统 Python 3.12 + Pillow）重建；逐字段 diff 只新增 `mediumSrcset` / `mediumAvifSrcset`，**顺序与 date 零漂移**
5. CI 侧（Linux + Pillow）重跑 `sync-photos` 后**无 bot 回写**（证明两处结果一致）
6. `dist/` 里新增档文件与 manifest 描述符逐一对得上；`dist` 体积增量落在 §4 的 ±5% 内
7. 线上验收：桌面 DPR2 打开 2560×1920 → 取到 `-2048`；移动 DPR3 打开同一张 → 取到 1200 档；失败请求 0、页面错误 0
8. 目视：无 medium 的 9 张与有 medium 的作品，在 1× 与 4× 缩放下观感无劣化
