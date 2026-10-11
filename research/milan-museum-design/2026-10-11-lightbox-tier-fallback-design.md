# P3/P4 设计稿：灯箱取图档位回退修正

- 日期：2026-10-11
- 状态：**已实施完成**（验收与偏差见 §8）
- 前置：`2026-10-10-upgrade-opportunity-audit.md` §4 的 P-3 / P-4（§9 优先级总表里的 P1）
- 对齐方式：逐项 brainstorming（范围 → AVIF 来源 → 边界用例，三轮问答；决策见 §0）
- 提交边界：单独一个 commit，`research/` 文档与实施代码分开提交

---

## 0. 决策摘要

| # | 议题 | 决策 | 否决的方案与理由 |
|---|---|---|---|
| ① | 范围 | **只修回落链**（A）：`lightboxSrc` / `lightboxAvifOrFallback` 补上 thumb 档 | 改 `srcset` + `sizes` 做视口/DPR 协商（B）：与 `MAX_ZOOM = 4` 的放大体验冲突（窄屏选小档 → 放大发虚），且收益与 P-2 高度重叠，应并入 P-2 一次设计 |
| ② | AVIF 顶层 URL 来源 | **解析 `thumbAvifSrcset` 取 w 最大的候选**（纯函数） | 新增 `thumbAvif` 标量字段：要跑 sync + CI bot 回写 + 触碰 global-setup 的 manifest 能力自检；不动 AVIF 侧：9 张只省 52% 而非 57% |
| ③ | 顶层 AVIF 比顶层 WebP 大时 | **一律优先 AVIF** | 按图取 `min(avif, webp)`：只多省 4.1 KB（1.2%），却引入与 medium 路径不一致的按图分叉 |

---

## 1. 证据基线（实施前不可跳过）

| 事实 | 出处 / 实测 |
|---|---|
| **9/18 条作品无 `medium`**（长边 ≤ `MEDIUM_MAX_EDGE = 1280` 时不生成，含 360×360 那张） | `tools/photos_lib.py:301-307`；manifest 实读 |
| `lightboxSrc = medium \|\| src`，**无 thumb 分支** | `src/util.js:155-158` |
| `heroSrc = medium \|\| thumb \|\| src`，**有** thumb 分支 | `src/util.js:114-118` |
| `AGENTS.md:42` 称「`heroSrc` / `lightboxSrc` 都是 `medium \|\| thumb \|\| src`」 | `AGENTS.md:42` |
| → **漂移方向是「代码错、文档对」**，不是文档过期 | 上两行交叉对账 |
| 灯箱 `<picture>` = `<source type="image/avif" srcset="">` + `<img>`，**两者都是单 URL、无 `srcset`/`sizes`** | `index.html:274-277`；`src/lightbox.js:390-391` |
| `source.srcset` 只填 `mediumAvif`，无 medium 即为空串 → 浏览器跳过 → 回落 `img.src` | `src/lightbox.js:390` |
| 预载另走 `lightboxAvifOrFallback`，**与 `<picture>` 不同源** | `src/lightbox.js:378`；`app.js:1292` |
| 灯箱支持双击/捏合放大到 **4×** | `src/lightbox.js:24` `MAX_ZOOM = 4` |
| `THUMB_QUALITY = MEDIUM_QUALITY = 78`；`AVIF_THUMB_QUALITY = AVIF_MEDIUM_QUALITY = 55` | `tools/photos_lib.py:19-24` |
| `-1200` 档对 ≤1200px 源图**不降采样**（`if max(im.size) > edge` 不成立），文件名无 `-1200` 后缀 | `tools/photos_lib.py:281-286` |
| `item["thumb"] = thumbs["1200"][0]`，即**最大缩略档** | `tools/photos_lib.py:421-422` |
| `thumbAvifSrcset` 按**每档实际像素宽**声明并同宽去重、宽度升序 | `tools/photos_lib.py:423-439` |
| 现有单测钉的是**旧契约**：`lightboxSrc({src:"s"}) === "s"`，且无 `{thumb, src}` 用例 | `tests/unit/util.test.mjs:168-181` |

**量化（9 张无 medium 的灯箱取图成本）**

| 口径 | 合计 | 相对现状 |
|---|---|---|
| `src`（JPEG 原图，**现状实际加载物**） | 743.7 KB | — |
| `thumb` 顶层（WebP q78） | 359.7 KB | **−52%** |
| `thumb` 顶层 AVIF（q55） | 321.9 KB | **−57%** |

极值：`1700559942072` 46 636 → 2 732 B（−94%）；`06-neon-window` 184 144 → 121 586 B。
审计报告写的 `06-neon-window` 179.8 KB / 118.7 KB、`08-portrait-silhouette` 54.5 KB / 21.0 KB，与实测**逐字节吻合**。

**质量口径结论**：这 9 张的顶层 `thumb` 与 `src` **像素完全相同**（1024×901），且用**与 medium 完全相同的编码参数**生成。所以本次是**质量中性替换**（不是「降级用缩略图」），并把这 9 张与另 9 张（本就加载 WebP q78 的 medium）**统一到同一质量口径**。

---

## 2. 设计

### 2.1 契约变更 —— `src/util.js`

新增 3 个具名导出（纯函数，零 DOM 依赖，可被 `node --test` 直接调用）：

```js
/** 从 srcset 串取 w 描述符最大的候选 URL；无候选返回空串 */
export function largestSrcsetUrl(srcset) { /* 逐项解析，n > bestW 才替换 */ }

/** 静态图最大可用档（WebP 侧）：medium > thumb > src */
export function largestStill(photo) {
  return photo?.medium || photo?.thumb || photo?.src || "";
}

/** 静态图最大可用档（AVIF 侧）：mediumAvif > thumbAvifSrcset 顶层 */
export function largestAvif(photo) {
  return photo?.mediumAvif || largestSrcsetUrl(photo?.thumbAvifSrcset);
}
```

三个消费函数改为：

```js
heroSrc(photo)            = photo.animated ? (photo.thumb || photo.src || "") : largestStill(photo)
lightboxSrc(photo)        = photo.animated ? (photo.src || "")               : largestStill(photo)
lightboxAvifOrFallback(p) = p.animated ? (p.src || "") : (largestAvif(p) || largestStill(p))
```

- `heroSrc` **行为零变化**（仅改为复用 `largestStill`）。
- **6 张有 `medium` 的作品零变化**（`largestStill` 返回 `medium`，`largestAvif` 返回 `mediumAvif`，与现状逐字节相同）。
- `largestSrcsetUrl` 的边界：全部候选无 `w` 描述符时 `bestW` 初值 `-1`，首个非空 URL 胜出 → 结果确定；空串 / `null` / `undefined` 一律返回 `""`。
- **不新增 manifest 字段、不改 `photos_lib.py`、不需要跑 sync**。

### 2.2 装配 —— `src/lightbox.js:390`（**必改，不可省**）

```js
if (source) source.srcset = photo.animated ? "" : lightboxAvifOrFallback(photo);
```

理由：若不改，AVIF 那半边是**负收益** —— 预载（`lightbox.js:378` / `app.js:1292` 走 `lightboxAvifOrFallback`）会下 AVIF，而 `<picture>` 因 `srcset` 为空仍回落 `img.src` 的 WebP，**下两次**。这一行让「预载」与「实际选中」同源，正是 `app.js:357-358` 注释强调的既有原则。

对无 avif 的图（manifest 恒有 `thumbAvifSrcset`，理论不出现）：`lightboxAvifOrFallback` 返回 WebP，`type="image/avif"` 使其被跳过 → 回落 `img.src`（同一 URL），**无重复下载**。

### 2.3 文档对齐 —— `AGENTS.md:42`

改为精确表述：

- WebP 侧：`medium || thumb || src`
- AVIF 侧：`mediumAvif || thumbAvifSrcset 顶层`
- 例外：动图走原文件（保证能播）

### 2.4 测试

**（a）单测改写 —— `tests/unit/util.test.mjs`**

- `lightboxSrc`：补 `{thumb:"t", src:"s"} === "t"`、`{medium:"m", thumb:"t"} === "m"`；保留动图与非动图的既有断言。**删掉** `lightboxSrc({src:"s"}) === "s"` 之外**不再成立**的旧值（`{medium, src}` 期望值不变，但需补 thumb 档的期望）。
- `lightboxAvifOrFallback`：新增 `{thumbAvifSrcset:"…-400.avif 400w, ….avif 1024w", thumb:"t"}` → 顶层 `.avif`。
- 新增 `largestSrcsetUrl`（乱序 / 无 `w` / 空串 / `null`）与 `largestStill` / `largestAvif` 用例。

**（b）真清单契约（新增，主护栏）**

读 `photos/manifest.json`，对**全部 18 条**断言：`lightboxSrc(p)` 与 `lightboxAvifOrFallback(p)` 都**不以 `.jpg` / `.png` 结尾**（`animated` 条目除外）。纯函数 + 真数据 → 毫秒级、覆盖全量、不可能同义反复。

**（c）e2e 抽检 —— `tests/e2e/smoke.spec.js`**

从 manifest 现算一张**无 medium** 作品的下标（沿用既有「`.card` 第 i 张 = manifest 第 i 条」约定，不写死序号），点开后断言：`#lbImg.currentSrc` 以 `.avif` 结尾，且 `#lbSource.srcset` 非空。

### 2.5 红态验证（两条，必须在单条 bash 内完成 + 字节级还原）

1. 把 `lightboxSrc` 改回 `medium || src` → **真清单契约立刻红**，并指名具体作品（如 `01-city-rain.jpg 的灯箱仍加载原图`）。
2. 撤销 `lightbox.js:390` 的改动 → e2e 的 `#lbImg.currentSrc` 变回 `.jpg`。

> 还原一律用 Edit 工具改回或 `cp` 备份回写，**禁止 `git checkout -- <file>`**（会按 git 所在层写回 HEAD，抹掉本批改动）。

---

## 3. 边界用例与不变量

| # | 边界 | 处理 |
|---|---|---|
| 1 | 动图（当前 0 张） | 灯箱仍走 `src`，`source.srcset` 置空 —— **不变** |
| 2 | `thumb` 缺失（无 Pillow 的降级构建） | 保留 `\|\| src` 兜底 |
| 3 | 顶层 AVIF > 顶层 WebP（9 张里 4 张） | 仍优先 AVIF（§0-③） |
| 4 | `1700559942072` 360×360 | 改后仍省 92%；**显示放大发虚是 D-1，不在本次范围** |
| 5 | 预载一致性 | `source.srcset` 与 `lightboxAvifOrFallback` 同源（§2.2） |
| 6 | 无 avif 的图 | 见 §2.2，无重复下载 |
| 7 | 有 `medium` 的 6 张 | 逐字节零变化 |

**不变量**：对任意静态作品，灯箱加载的 URL **必须来自派生图**（`photos/medium/` 或 `photos/thumbs/`），不得是 `photos/<name>.<ext>` 原图。

---

## 4. 样例（改前 → 改后）

| 作品 | 现状灯箱 | 改后灯箱（选中 AVIF） | 字节 |
|---|---|---|---|
| `mmexport1788447848472`（有 medium） | `photos/medium/….avif` | **不变** | 不变 |
| `01-city-rain` | `photos/01-city-rain.jpg` | `photos/thumbs/01-city-rain.avif` | 106 312 → **51 345** |
| `06-neon-window` | `photos/06-neon-window.jpg` | `photos/thumbs/06-neon-window.avif` | 184 144 → **97 421** |
| `1700559942072` | `photos/1700559942072.jpg` | `photos/thumbs/1700559942072-400.avif` | 46 636 → **3 742** |

---

## 5. 明确不在范围

- **D-1**：`1700559942072` 360×360 的呈现（需限最大放大倍率或替换素材）
- **P-1**：母版移出 `dist/`（见 §6，本项是它的前置）
- **P-2**：1920–2048 高清档
- **P-5**：SW 版本号构建期注入
- 逐图页 CSP（本批次③的遗留）

---

## 6. 遗留耦合（本项做完后成立，但不在本项内动手）

修完后，**静态作品不再触达 `src`** —— 这正是 P-1「母版移出产物」的前置条件。
但注意：`photo.src` 还担当前端去重键（`app.js:997` 的 `id`、`app.js:1493` 的 `existing` 集合），
所以 **`src` 字段必须留在 manifest**，只是不再随产物发布文件。

---

## 7. 验收清单

1. `npm run lint` 干净（eslint + stylelint）
2. `npm run test:unit` 全绿（含新增的 `largestSrcsetUrl` / `largestStill` / `largestAvif` / 真清单契约）
3. `npx playwright test` 全绿（含新增抽检）
4. 两条红态验证均决定性通过（§2.5）
5. 预览目视：任取一张无 medium 作品，灯箱开图与放大到 4× 的画质与有 medium 的作品一致
6. `AGENTS.md:42` 与实现一致（契约不再漂移）

---

## 8. 实施记录

### 8.1 验收结果

| # | 项 | 结果 |
|---|---|---|
| 1 | `npm run lint` | ✅ eslint + stylelint 干净 |
| 2 | `npm run test:unit` | ✅ **61/61**（58 → 61：新增 `largestSrcsetUrl`、`largestStill`/`largestAvif`、真清单契约各 1 条） |
| 3 | `npx playwright test` | ✅ **43/43**（42 → 43：新增「灯箱档位回退」抽检 1 条） |
| 4 | 红态验证 ①（`lightboxSrc` 改回 `medium \|\| src`） | ✅ `not ok 20`，报 `1700559942072.jpg 的灯箱落到了 photos/1700559942072.jpg`；字节级恢复一致 |
| 5 | 红态验证 ②（撤销 `lightbox.js` 同源化） | ✅ e2e 报 `Expected pattern: /\.avif$/ / Received string: "…/photos/thumbs/1700559942072.webp"` —— 证明旧实现下 `<picture>` 的 AVIF source 为空、回落 `img.src` 的 WebP |
| 6 | 预览目视 | ✅ 见 §8.3 |
| 7 | `AGENTS.md` 契约对齐 | ✅ 两处（`:36` medium 行、`:42` 取图链） |

### 8.2 实施中的偏差与新增决定

1. **`largestSrcsetUrl` 的 minify 判定探针**：`dist/app.js` 里 esbuild 把 `|| ""` 压成了**模板字面量** ` `` `，
   所以「源码里 `mediumAvif || ""`」这条 grep 在产物里**找不到**（我第一次的产物核验因此误判为「破坏没进产物」而中止）。
   改为按语义判定：`srcset=<x>.animated?``:<w>` 之后跟的是**函数调用**（绿）还是 `.mediumAvif`（红）。
   探针落在 `.workbuddy/scratch/probe-srcset.mjs`。
2. **`AGENTS.md:36` 也有一处同类漂移**（设计稿只点了 `:42`）：原文写 `photos/medium/` 「原图 ≤1280 时不生成，
   **灯箱用原图**」—— 修完之后应改为「灯箱改用最大缩略档 `thumbs/`」。已一并修正。
3. **未新增 manifest 字段、未跑 sync**，与设计一致。

### 8.3 预览目视（`vite preview` 实测）

| 作品 | 有无 medium | 灯箱 `currentSrc` | 内在尺寸 | 显示尺寸 |
|---|---|---|---|---|
| `01-city-rain.jpg` | 无 | `photos/thumbs/01-city-rain.avif` | 1024×901 | 685×603 |
| `mmexport1788447848472.jpg` | 有 | `photos/medium/mmexport1788447848472.avif` | 960×1280 | 452×603 |

- 滚轮放大到 `--lb-zoom = 3.76`（上限 4），画心清晰、无可见编码劣化；题名与策展说明照常渲染。
- 失败请求 **0**。截图：`.workbuddy/scratch/lb-no-medium-1x.png`、`lb-no-medium-zoom.png`。
- `01-city-rain` 三档字节实测：原图 JPEG `106 312` → 顶层 WebP `55 138` → **顶层 AVIF `51 345`**，与 §4 预期逐字节一致。

### 8.4 遗留（本项未动）

`01-city-rain` 这类 1024px 的作品在 4× 放大时仍会发虚 —— 这是**源本身没有更大档**造成的，
本次并未加剧（改前加载的 1024px JPEG 与改后的 1024px AVIF **像素数完全相同**，只是编码更小）。
真正的解在 **P-2（1920–2048 高清档）**，与本项正交。
`1700559942072` 仅 360×360，放大发虚属 **D-1**，另有 4× 上限的取舍空间。
