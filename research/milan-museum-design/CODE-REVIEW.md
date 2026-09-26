# 代码质量与前端设计审查 — 米兰美术馆照片墙

> 2026-09-26 · **审查阶段为只读，未修改任何代码**；**批次 1、批次 2 的修复均已执行并验证**
> → 见 [§7 批次 1 执行记录](#7-批次-1-执行记录2026-09-26)、[§8 批次 2 执行记录](#8-批次-2-执行记录2026-09-26)
> 范围：`index.html` / `app.js` / `styles.css` / `sw.js` / `tools/` / CI 配置
> 视角：全栈工程 + 前端设计（结构、可维护性、性能、HTML/CSS/JS 实现、视觉层次、排版配色、间距、动效）
> 基线：`main` @ `8c0a7d5`，SW `milan-v34`（批次 1 后 `v35`，批次 2 后 `v36`），manifest 18 张
> 问题总数：**28 条**（P0×3 已修 / P1×7 全部已修，其中 P1-2 只落守卫、预载方案实测否定后回退 / P2×9：P2-8 核心与 P2-9 已修 / P3×6，其中 P3-2b 已修）

---

## 0. 结论摘要

工程质量**高于同类静态站的平均水位**——SW 的 SWR/LRU 分层、`@property` 类型化颜色做渐变插值、`<dialog>` 原生模态、`sizes` 分档与 AVIF 协商、离线 e2e 断言，这些都是有意识的设计而非默认产物。

但存在**三类系统性缺陷**，且都属"静默失效"（不报错、不影响 CI 绿灯，只影响观感与健壮性）：

1. **CSS 层叠被后来者静默击穿**（P0-1）：`@layer responsive` 内的"无字陈列"覆盖块写在了 `@media (max-width:560px)` **之后**，同层同权重下源序取胜 → 4 处移动端/基础值被无条件覆盖，全部变成死规则。骨架屏与真实展厅在列数、gap、内边距上三重不一致。
2. **设计意图未真正落地**（P0-2）：卡片"轨道射灯"伪元素被裁掉又被绝对定位画心遮住——`AGENTS.md` 里写的"锥光落在画框上方的墙面"在渲染上不成立。**（根因已在复验中更正，见 §4 P0-2 的「复核更正」块：主裁切者是 `.card{content-visibility:auto}` 隐含的 paint containment，`overflow:hidden` 只是次因。）** 同类的"墓碑代码"还有 `frame-lit`、三处 `content: none`。
3. **移动端主交互区被控件压住**（P0-3）：≤560px 时灯箱与序厅的翻页箭头覆盖画心 22–28px；现有 e2e 只断言 frame 在视口内，测不到遮挡。

另有两项**结构性债**值得排期：卡片的墙色采样完全放在客户端主线程（可 100% 移到 CI，且 `tools/photos_lib.py` 已经在读同一批像素），以及 `app.js` 1808 行单 IIFE 无模块边界。

> 一句话：**UI 的"形"到位了，"证据链"没闭环**——性能无预算守卫（`lighthouserc.json` 把 performance 关掉了），CSS 的层叠依赖源序却没约束，设计意图靠注释而非渲染保证。

---

## 1. 量测基线（本次实测，非估计）

### 1.1 关键路径体积

| 资源 | 原始 | gzip | 说明 |
|------|------|------|------|
| `index.html` | 8,346 B | 2,750 B | 静态壳层 |
| `styles.css` | 41,828 B | 10,968 B | 其中 ≈200–230 行为死代码（见 P2-1） |
| `app.js` | 62,274 B | 18,941 B | 单文件 1808 行 / 单 IIFE |
| `sw.js` | 7,439 B | 2,592 B | |
| `assets/fonts/milan-serif.woff2` | 97,180 B | — | 257 字形可变字重，已是最优量级 |
| `photos/medium/mmexport…avif`（第 1 张序厅图） | 99,636 B | — | **LCP 候选** |
| `photos/thumbs/IMG20260817155446.avif`（最大缩略图） | 196,043 B | — | 900×1200 |

### 1.2 仓库体积

| 项 | 体积 |
|----|------|
| `photos/` | **81 MB** |
| └ 原图 `photos/*.jpg` | **74 MB**（最大单张 9.0 MB） |
| └ `photos/thumbs/` | 4.5 MB |
| └ `photos/medium/` | 3.2 MB |
| `.git` | 87 MB |

原图占仓库 91%，运行期几乎不被请求（有 medium 的图灯箱走 medium）。这是 CI 时长与 clone 成本的主要来源。

### 1.3 工程化现状

| 项 | 状态 |
|----|------|
| ESLint / Stylelint | ✅ 有配置，覆盖 `app.js` / `sw.js` / `tools/` |
| Playwright e2e | ✅ **10 项**，含离线、深链、SW 缓存隔离、控制台零错误 |
| Lighthouse CI | ⚠️ a11y / best-practices / SEO 断言 **1.0 满分**；`performance: "off"` |
| 单元测试 | ❌ 无（纯客户端逻辑如 `sampleRoomColor`、`applyRowFit`、`ymKey` 无测试） |
| 构建步骤 | 无（刻意的设计约束，合理） |

---

## 2. 值得保留的部分（不要在这些地方"优化"）

| 项 | 为什么好 |
|----|----------|
| `sw.js` 双缓存分层 + `OWNED_CACHE_RE` 只清本站旧缓存 | 命名空间隔离正确，e2e 已验证不误删他站缓存 |
| `sw.js:128-133` 3s 超时回落 + `:140` 非 2xx 也回落 | 覆盖了"黑洞连接既不 resolve 也不 reject"的真实故障态 |
| `sw.js:150-177` SWR 拆成 serve/revalidate 两个 Promise 并交给 `event.waitUntil` | 避免了浮动 Promise 被 SW 回收——这是大多数人会写错的点 |
| `styles.css:4-39` `@property` 注册采样色 | 用类型化自定义属性做渐变插值，是解决"CSS 变量变色不触发 transition"的正解 |
| `app.js:262-278` `preloadImage` 按属性比对而非拼选择器 | 注释里写明了"href 含引号会让 querySelector 抛 SyntaxError"，防御到位 |
| `app.js:955-961` / `:994` VT 三个 promise 全部接 catch | 直击 `InvalidStateError` 冒成 `unhandledrejection` 的真实坑 |
| `app.js:1148-1152` `sizes` 分档 | 实测与网格列宽吻合（≤560px 46vw / ≤834px 40vw / 320px），不是拍脑袋写的 |
| `<dialog>` + `showModal()` + `aria-roledescription="carousel"` + 可暂停轮播 | 符合 APG，没有手写 Tab 陷阱 |
| `.card-anno` 用单一文本节点而非多节点 | 规避 axe 的 `label-content-name-mismatch`，是有意识的取舍 |

---

## 3. 问题清单

优先级定义：**P0** = 当前可复现的缺陷 / 使既有设计失效；**P1** = 本迭代修（健壮性、可访问性、可测的性能瓶颈）；**P2** = 结构债与死码；**P3** = 打磨项。

### 3.1 总览

| ID | 优先级 | 一句话 | 位置 | 状态 |
|----|--------|--------|------|------|
| P0-1 | 立即修 | `@layer responsive` 内后置规则静默覆盖 4 处移动端/基础值 | `styles.css:1637-1702` | 已修 ✅ |
| P0-2 | 立即修 | 射灯伪元素被 paint containment 裁掉又被画心遮挡（根因见 §4 复核更正） | `styles.css:808` / `:834` / `:1806` | 已修 ✅ |
| P0-3 | 立即修 | 移动端翻页箭头压住画心 22–28px | `styles.css:1588-1609` / `:596-602` | 已修 ✅ |
| P1-1 | 本迭代 | 骨架屏与真实展厅列数/gap/内边距三重不一致 | `styles.css:1850-1858` | 已修 ✅ |
| P1-2 | 本迭代 | LCP 被 manifest 串行阻塞，且无性能预算守卫 | `app.js:832` / `lighthouserc.json:16` | 守卫已加 ✅ / 预载方案**实测为负收益，已回退** ⚠️ 见 §7.7.2 |
| P1-3 | 本迭代 | `content-visibility` + 400px 固有高度估算造成移动端 CLS | `styles.css:783-787` | 随 P0-2 已修 ✅ |
| P1-4 | 本迭代 | 无守卫的 `addEventListener` 链 + 浮空 Promise → 单点失败整站白屏 | `app.js:1595-1605` / `:1798` | 已修 ✅ |
| P1-5 | 本迭代 | 序厅 slide 不可键盘操作；`role="toolbar"` 无方向键导航 | `app.js:580` / `index.html:93` | 已修 ✅ |
| P1-6 | 批次 2 | 卡片墙色采样全在客户端（63×canvas+对比度迭代） | `app.js` 三处消费点 / `photos_lib.py` | 已修 ✅ |
| P1-7 | 本迭代 | `backdrop-filter` 叠加 94% 不透明底：高成本近零收益 | `styles.css:163-166` | 已修 ✅ |
| P2-1 | 排期 | ≥200 行死 CSS（19 个选择器仅存在于 CSS） | `styles.css` 多处 | 已修 ✅ 实删 **218 行**（见 §9.2） |
| P2-2 | 排期 | `app.js` 单文件单作用域 1808 行 | `app.js` 全文 | **两步已完成** ✅ ① 纯函数抽为 `src/util.js` + `node --test` 单测（见 §10）；② lightbox 域整体拆为 `src/lightbox.js` 工厂（见 §11）。`app.js` 现 1478 行；hero / gallery / upload 待续 |
| P2-3 | 排期 | `renderGallery` 全量重建 + 每次筛选重跑全部采样 | `app.js:1110-1217` | 部分已修（采样重跑已由 P1-6 消除）；节点复用**未做**（见 §9.6） |
| P2-4 | 排期 | SW `trimMediaCache` 每次 put 全量 `cache.keys()`（O(n²)） | `sw.js:85-101` | 已修 ✅ 改**时间节流**（见 §9.4） |
| P2-5 | 排期 | 上传流程全串行（N 张 = N 轮压缩+API+清单读改写） | `app.js:1462-1543` | 已修 ✅ manifest 批量化 + 冲突重试（见 §9.5） |
| P2-6 | 排期 | `<link rel=preload>` 只增不减；每步同时预载前后两张 | `app.js:262-278` / `:1058-1064` | 已修 ✅ 回收池 + 单向预载（见 §9.3） |
| P2-7 | 排期 | `photos/` 81MB（原图 74MB）进 git | `photos/*.jpg` | |
| P2-8 | 排期 | 展厅顺序在 mtime 排序 / 文件名排序间漂移 | `tools/photos_lib.py:194-201` | 核心已修 ✅（见 §7.7.3） |
| P2-9 | 排期 | 端口硬编码 + `reuseExistingServer` → 测试静默跑在**别的仓库**上 | `tools/serve.py:70` / `playwright.config.js:11,22-23` | 已修 ✅ |
| P3-1 | 打磨 | 图标按钮 5 种尺寸；`vh`/`dvh` 混用；`.hero-title` 字距与补偿不等 | 见明细 |
| P3-2 | 打磨 | 灯箱缺底部安全区；`decodeURIComponent` 未包裹 | `styles.css:1233-1244` / `app.js:850` |
| P3-3 | 打磨 | 无 `<noscript>`；JSON-LD 缺 `image`；sitemap 无 `lastmod` | `index.html:31-49` |
| P3-4 | 打磨 | 策展节奏 `% 7` 与列数耦合（3 列才对） | `app.js:1125` |
| P3-5 | 打磨 | `window.__lf` 调试时间线进生产且无限增长 | `app.js:784-787` |
| P3-6 | 打磨 | 移动端筛选栏横向滚动无渐隐提示 | `styles.css:1556-1576` |

---

## 4. 明细

### P0-1 · `@layer responsive` 内后置规则静默击穿移动端与基础值

**位置**：`styles.css:1487` 起为 `@layer responsive`，其中
- 移动端媒体查询 `@media (max-width:560px)` 位于 **1501–1629**
- "无字陈列"覆盖块位于 **1637–1702**
- 层声明为 `@layer reset, base, components, sections, responsive;`（`:1`）→ responsive 优先级最高

**问题**：同层、同权重（均为 `(0,1,0)`）、同源 → **源序靠后者胜**。后置块无条件压掉了前面的窄屏与基础值：

| 覆盖者（后） | 被覆盖者（前） | 实际生效 |
|--------------|----------------|----------|
| `:1665` `.gallery{gap:52px 36px}` | `:1531` ≤560px `gap:40px 16px`；`:761` 基础 `gap:64px 40px` | 所有断点恒为 52/36 |
| `:1661` `.chapter-head{margin-bottom:28px}` | `:1512` ≤560px `36px`；`:712` 基础 `52px` | 恒 28px |
| `:1690` `.filter-bar{margin-top:0;margin-bottom:28px}` | `:1557` ≤560px `-4px/24px`；`:938` 基础 `-8px/36px` | 恒 0/28 |
| `:1657` `.hero-plate{padding-bottom:12px}` | `:1548` ≤560px `8px` | 恒 12px |

**影响**：
1. 手机上 2 列网格的实际列间距是 36px 而非设计的 16px → 390px 视口下每张卡片净宽从约 154px 降到约 144px，**缩略图整体小一圈**，"油画墙"的分量感被削弱。
2. 章节标题与筛选栏的垂直呼吸节奏与设计稿不符（28 vs 36 / 0 vs -4）。
3. `-8px` 的上拉对齐意图在**所有**断点都失效。
4. 这四行代码在 linter 视角完全合法（Stylelint 不管层叠胜负），CI 依然全绿 → 属无声回归。

**建议**：把"无字陈列"覆盖块整体上移到 `@layer responsive` 的最前（紧跟 `@media (max-width:834px)` 之前），仅保留"只写差异、不写完整值"的规则；给每个 `@layer` 块加一行注释标明"层内源序敏感"。

```css
/* 方案 A（推荐，改动最小）：把无字陈列块整体剪切到 1489 行之前 */

/* 方案 B：把这些覆盖降级到 base 层——base 优先级最低，
   靠 !important 的 display 声明仍可生效 */
@layer base {
  .gallery { gap: 52px 36px; }
  .chapter-head { margin-bottom: 28px; }
  /* 去掉 .filter-bar / .hero-plate 的完整值覆盖：
     只写需要变的属性，其余交给断点规则 */
}
```

> 顺带：`:1665` / `:1661` / `:1690` / `:1657` 这类"无媒体查询的覆盖块"应改成显式断点，或至少在块首注释"本块覆盖 base+560 断点，新增断点需同步"。

---

### P0-2 · "轨道射灯"伪元素被裁切且被画心遮挡

> **⚠️ 复核更正（2026-09-26 实测，原判定不完整）**
> 审查阶段的结论是"`overflow: hidden` 是主要裁切者"。落地后按像素复核发现：**只改 `overflow` 观感零变化**（画框上方墙面带 hover 前后亮度差仍恒为 `0.00`）。
> **真正的主裁切者是 `.card { content-visibility: auto }`** —— 它为卡片施加**隐含的 paint containment**，把子盒裁到卡片自身盒内，直接切掉溢出到画框之外的全部墙面光。该 containment 在 `getComputedStyle(card).contain` 上显示为 `none`，属**静默失效**，因此极难定位。
> 两处必须同时修：`overflow` 是次因（只裁掉与画心重叠的那部分），`content-visibility` 是主因（裁掉全部溢出）。

**位置**：`styles.css:806-850`（定义）、`:1805-1821`（hover 增强）、`:776-780`（主因 `content-visibility`）

```css
.card-media      { position: relative; overflow: hidden; }         /* :807-808 */
.card-media::before {
  inset: -58px -34px -26px;   /* 明确想溢出到画框之外 */           /* :837 */
  z-index: -1;
}
.card-media img  { position: absolute; top/left: var(--frame-inset);
                   width: calc(100% - 2*var(--frame-inset)); ... } /* :852-866 */
.card            { content-visibility: auto; }                      /* :776 ← 主裁切者 */
```

**问题（三层叠加，缺一即失效）**：
1. **paint containment（主因）**：`content-visibility: auto` 对 `.card` 隐含 `contain: paint`，`.card-media::before` 的 `-58px / -26px / -34px` 溢出量在卡片盒之外的部分**全部被裁掉**。
2. **`overflow: hidden`（次因）**：`.card-media` 把子盒裁到 padding box，与画心重叠的那部分被裁。
3. **绘制顺序（第三层）**：剩余可见的 4px 框内环，因 `::before` 是 `z-index:-1`、`img` 是绝对定位（z-index auto）→ 按 CSS 2.1 附录 E，img 恒定绘制在负 z-index 之上，而 img 恰好铺满内容盒 → 连 4px 环也被压住。

**实测证据（deviceScaleFactor 2，390px 与 1280px 双视口取同一张作品同一裁切）**：

| `.card` 的 `content-visibility` | 画框上方墙面带 idle | hover | hover − idle |
|---|---|---|---|
| `auto`（改动前） | (42.82, 51.36, 42.57) | (42.82, 51.36, 42.57) | **0.00 / 0.00 / 0.00** |
| `visible`（实验注入） | (64.73, 68.97, 57.44) | (96.36, 96.02, 82.04) | **+31.67 / +27.05 / +24.63** |
| `visible` + `overflow: visible`（最终修复） | (64.69, 68.93, 57.41) | (96.36, 96.02, 82.04) | **+31.67 / +27.09 / +24.63** |

**结论**：`AGENTS.md` 中"框顶边受光更亮、锥光落在画框**上方**的墙面、hover 即打亮"的设计意图，在原实现下**在渲染层完全不成立**（hover 对墙面的贡献精确为 0）。修复后墙面带 idle 提亮约 26 级、hover 再提亮约 31 级，射灯效果真实可测。

**根因**：两个属性各自服务于另一个目的——`overflow: hidden` 为 hover 的 `img { transform: scale(1.02) }`（`:868-871`）兜裁切，`content-visibility: auto` 为省渲染。两者的副作用都被压在同一个盒子上，且都不会报错、不影响 CI 绿灯。

**建议**：拆一层"裁切盒"，让画框外的光有地方可落。

```css
/* 现状：一个盒子同时承担「裁切画心」和「外溢光」 */
.card-media { overflow: hidden; }

/* 改为：外层不裁、负责光；内层裁、负责画心 */
.card-media { overflow: visible; }               /* ::before 现在可以溢出到墙面 */
.card-media-glass {                                /* 新增裁切盒，只包 picture */
  position: absolute;
  inset: var(--frame-inset);
  overflow: hidden;
}
```

对应 JS 侧（`app.js:1200`）把 `mediaEl` 塞进 `glass` 再塞进 `media`；`img` 的定位改为 `inset: 0`（相对 glass）。这样 `::before` 的 `-58px/-26px/-34px` 才能真正落在墙面上。

**验证方式**：改后截取卡片 hover 前后的对比图，确认画框上方 58px 内出现可辨的锥光梯度。

---

### P0-3 · 移动端翻页箭头覆盖画心

**位置**：`styles.css:1588-1609`（移动端灯箱）、`:545-602`（移动端序厅）

**实算（390px 视口，即项目自带 e2e 的手机断点）**：

| 量 | 灯箱 | 序厅 |
|----|------|------|
| 画框上限 | `min(94vw, 900px)` = 366.6px | `min(92%, 620px)` ≈ 358.8px |
| 居中后左右边距 | (390-366.6)/2 = **11.7px** | ≈ 15.6px |
| 箭头位置与宽度 | `left:4px` + 36px → 占 4–40px | `left:6px` + 36px → 占 6–42px |
| 画心（含框内边）起点 | 11.7 + 4 + 2 = 17.7px | ≈ 15.6px |
| **实际遮挡画心** | **≈ 22.3px** | **≈ 26.4px** |

**现有测试盲区**：`tests/e2e/smoke.spec.js:70-73` 只断言
`frameBox.x >= 0 && frameBox.x + frameBox.width <= 390`——箭头压在图上是完全可以通过的。

**影响**：手机是这类照片墙的主场景；两个 36px 的不透明按钮（`rgba(21,28,24,0.7)`）常驻压在作品边缘，直接破坏"无字油画馆"的完整性；同时侵占了双指缩放/滑动的主手势区。

**建议（二选一）**：

```css
/* 方案 A（推荐）：窄屏交给手势。swipe 已实现（app.js:1714-1717），
   箭头只在够宽的屏上出现 */
@media (max-width: 560px) {
  .lb-arrow, .hero-carousel-arrow { display: none; }
}

/* 方案 B：给画框留出两侧通道，箭头退到通道内 */
@media (max-width: 560px) {
  .lightbox-frame { --frame-max-w: min(calc(100vw - 104px), 900px); }
  .hero-art { max-width: calc(100vw - 104px); }
}
```

同步补 e2e 断言（防回归）：

```js
const arrow = await page.locator(".lb-prev").boundingBox();
expect(arrow.x + arrow.width).toBeLessThanOrEqual(frameBox.x);
```

---

### P1-1 · 骨架屏与真实展厅三重不一致

> **✅ 已修（2026-09-26）**：没有采用下方「CSS 变量」方案，而是**把两处写成同一条规则**
> （`.gallery, .gallery-skeleton { … }`，共 3 处：`sections` 层基值、`responsive` 层「无字陈列」、
> `≤560px` 断点）。同一组选择器比「两份相同的变量引用」更强：**结构上不可能漂移**。
> 新增回归测试「骨架屏与真实展厅布局一致」用「数据到达后临时取消隐藏 → 读 computed style →
> 立刻还原」的方式比对，**不依赖 manifest 到达时序**（等骨架屏出现再量必然 flaky）。
> 红态已验证：回退 `styles.css` 后该测试失败于 `rowGap 64px vs 52px` / `columnGap 40px vs 36px`。

**位置**：`styles.css:1850-1858`（`.gallery-skeleton`）vs `:755-766` + `:1525-1533`（`.gallery`）

| 属性 | 骨架屏 | 真实展厅（≤560px） | 真实展厅（桌面） |
|------|--------|--------------------|------------------|
| 列定义 | `repeat(auto-fill, minmax(260px,1fr))` | `1fr 1fr` | `repeat(auto-fill, minmax(260px,1fr))` |
| 左右内边距 | `28px 40px 8px` | `20px 18px 8px` | `28px 40px 8px` |
| gap | `64px 40px` | `52px 36px`（被 P0-1 覆盖后） | 同左 |

**实算（390px 视口）**：骨架可用宽 = 390 − 80 = 310px ≥ 260 → `auto-fill` 得 **1 列**；而真实展厅是 **2 列**。

**影响**：首屏骨架只显示 1 个较大的占位块，数据到达后突然变成 2 列——**恰好发生在 LCP 窗口内**，是感知性能最敏感的一帧。桌面端则是 64/40 → 52/36 的行列位移。

**建议**：让骨架屏复用 `.gallery` 的盒模型，只保留独立的分列规则；或用 CSS 变量把两处参数收敛为单一来源。

```css
/* 把布局参数提到 :root，骨架与实体共用 */
:root { --gallery-pad: 28px 40px 8px; --gallery-gap: 52px 36px; }

.gallery, .gallery-skeleton {
  max-width: var(--max-wide);
  margin: 0 auto;
  padding: var(--gallery-pad);
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
  gap: var(--gallery-gap);
}
@media (max-width: 560px) {
  .gallery, .gallery-skeleton {
    grid-template-columns: 1fr 1fr;
    padding: 20px 18px 8px;
    gap: 40px 16px;
  }
}
```

---

### P1-2 · LCP 被 manifest 串行阻塞；且性能没有预算守卫

> **状态（2026-09-26）**
> - **守卫部分（已做 ✅）**：`lighthouserc.json` 的 `categories:performance` 由 `"off"` 改为
>   `["warn", { minScore: 0.9 }]`，并加 `largest-contentful-paint`（warn ≤2500ms）与
>   `total-byte-weight`（warn ≤400KB）。已核实 `@lhci/cli` 源码
>   （`src/assert/assert.js:87`）：`isFailure = !passed && level === 'error'`，
>   **warn 不会让进程退出非零** → 不会弄坏 CI，但会把数字暴露在报告里。
> - **下面的「廉价档」预载方案：实测为负收益，已回退 ❌** —— 见 §7.7.2 的四组对照。

**位置**：`app.js:782-851`（`loadFolderPhotos`）→ `:832-834`（首图 preload）→ `:457-503`（`applyHeroSources`）；`lighthouserc.json:16`（`"categories:performance": "off"`）

**关键路径（冷启动，无 SW）**：

```
HTML  ──RTT──▶  CSS+JS(并行)  ──RTT──▶  manifest.json  ──RTT──▶  medium AVIF  ──▶  LCP
       :48-58            :791 显式 fetch               :833 preloadImage
                          ↑ 必须等 app.js 解析执行完才会发出
```

序厅 `<img>` 完全由 JS 创建（`app.js:582-596`），所以 **LCP 元素本身要等 4 段串行之后才诞生**：

| 网络档 | 估算 LCP |
|--------|----------|
| Fast 4G（RTT 70ms / 9Mbps） | ≈ 0.55–0.7s |
| Slow 4G + 4× CPU（Lighthouse mobile 默认） | ≈ 2.5–3.5s |
| 3G | ≈ 4s+ |

`app.js:262-278` 的 `preloadImage` 已经是"拿到 manifest 后立刻预热"，但**拿到** manifest 这一步就是瓶颈：preload 提示本可以在 HTML 里就发出。

**同时**：`lighthouserc.json:16` 把 performance 类别整体关闭 → 上述数字**没有任何 CI 守卫**，未来任何改动（多一次 RTT、多一张图）都不会报警；而 a11y/BP/SEO 却是满分硬断言。这是当前工程化配置里最不对称的一处。

**建议（分两档）**：

- **廉价档（省 1–2 个 RTT，改 CI 脚本即可）**：让 `tools/sync_photos.py`（CI 已会写回仓库）在 `index.html` 的标记区间内注入首图预载。

```html
<!-- index.html：占位，由 sync 脚本重写区间内容 -->
<!-- hero-preload:start -->
<link rel="preload" as="image" type="image/avif"
      href="photos/medium/mmexport1788447848472.avif" fetchpriority="high" />
<!-- hero-preload:end -->
```

- **正解档（消除 LCP 对 JS 的依赖）**：CI 把第一张序厅图渲染为 `index.html` 里的静态 `<img>`（渐进增强），`app.js` 启动后接管为轮播第 1 帧。静态站点完全做得到，代价只是 sync 脚本多一段模板替换。

- **补充**：把性能纳入门禁，至少设成 warn 而非 off：

```json
"categories:performance": ["warn", { "minScore": 0.9 }],
"largest-contentful-paint": ["warn", { "maxNumericValue": 2500 }],
"total-byte-weight": ["warn", { "maxNumericValue": 400000 }]
```

---

### P1-3 · `content-visibility` + 400px 固有高度估算造成移动端 CLS

> **✅ 已随 P0-2 一并修复（2026-09-26）**：复核确认 `content-visibility: auto` 的主害是裁掉墙面射灯（见 P0-2），CLS 是次害。两者同源，故整条移除 `.card` 的 `content-visibility` 与 `contain-intrinsic-height`，一处改动消两项问题。
> **附带代价与处置**：移除后 `.card-media::before` 的 34px 横向溢出不再被裁，最外侧卡片顶出视口 → 390px 出现整页横向滚动（被既有 e2e `noHorizontalOverflow` 断言捕获）。已在 `.gallery-section` 上补 `overflow-x: clip`（按展厅盒边界裁切；`clip` 不产生滚动容器，不影响 sticky 章节题，纵向仍 `visible`，锥光完整保留）。

**位置**：`styles.css:768-789`

```css
.card {
  content-visibility: auto;
  contain-intrinsic-height: auto 400px;   /* :787 */
}
```

**问题**：`content-visibility: auto` 对屏外元素施加**尺寸包含**，其高度由 `contain-intrinsic-size` 决定；`auto` 关键字只在元素**被渲染过之后**才记住真实高度。因此首次滚动经过时，每张卡片先按 **400px** 占位。

**实算（390px 视口，2 列）**：卡片真实高度 ≈ 列宽 144px × 3/4（4:3）+ 4px ≈ **112–150px**。估算值偏高 **2.7–3.6 倍**。由于网格行高取同行最大值，**整行**都先撑到 400px 再塌缩。叠加 `:765` 的 `align-items: center`，滚动过程中会出现持续的回弹式位移。

**附带风险**：`:1897-1901` 的 `animation-timeline: view()` 与 `:1133` 的 `view-transition-name` 都依赖已渲染的几何；被跳过的元素在 VT 快照里可能是空白（进入动画从"无"开始）。

**权衡**：`content-visibility: auto` 在 63 张卡片规模下收益有限（`loading="lazy"` 已经省掉了图片流量），却引入布局不稳定。建议二选一：

```css
/* 方案 A（推荐）：去掉 content-visibility，保留 lazy */
.card { /* 删除 content-visibility 与 contain-intrinsic-height */ }

/* 方案 B：保留但给出贴近真实的估值（需按断点分别给值） */
.card { contain-intrinsic-height: auto 160px; }   /* 390px 视口量测值 */
@media (min-width: 835px) { .card { contain-intrinsic-height: auto 300px; } }
```

方案 B 的数值应来自实测（Playwright 量 `.card` 的 `getBoundingClientRect().height` 中位数）。

---

### P1-4 · 无守卫的事件绑定链 + 浮空 Promise → 单点失败整站白屏

> **✅ 已修（2026-09-26）**：新增统一守卫 `on(el, type, handler, opts)`（元素为空即静默降级）与
> `safeDecode()`（hash 被改坏时 `decodeURIComponent` 抛 URIError 的兜底 —— 顺带补掉 P3-2 的前半）。
> 实际改动比原判定更大：`stage` 是 `lightbox.querySelector(...)` 的结果，`lightbox` 为 null 时
> **这一行自身**就会抛，因此把 `lightbox?.querySelector(...) || null` 也一并守卫，`stage` 上
> **7 处**监听全部改走 `on()`。`loadFolderPhotos()` / `loadCustomPhotos()` 两个浮空 Promise 都补了
> `.catch`，兜底动作是 `galleryReady = true` + 隐藏骨架屏 + 放开空状态。
> 新增回归测试「缺元素时降级运行而非整站白屏」：用 `page.route` 重写文档，把整个 `<dialog>` 删掉，
> 断言展厅仍渲染 18 张卡、骨架屏退场、且 `pageerror` 为空。
> 红态已验证：回退 `app.js` 后 `.card` 计数为 **0**（IIFE 中断，展厅完全没渲染）。

**位置**：`app.js:1595-1605`

```js
prevBtn.addEventListener("click", ...);   // :1595
nextBtn.addEventListener("click", ...);   // :1599
closeBtn.addEventListener("click", closeLightbox);  // :1603
const stage = lightbox.querySelector(".lightbox-stage");  // :1605
stage.addEventListener("pointerdown", ...);  // :1614
```

同文件其它元素**都有** `if (x) {...}` 守卫（`:647` / `:656` / `:663` / `:1565` / `:1575`），这四处是遗漏。

**影响**：这三行位于 `:1796-1799` 的 `renderFilters() / renderGallery() / loadFolderPhotos()` **之前**执行。任一元素缺失（改 HTML 结构、SW 旧壳层与旧 HTML 组合、第三方脚本注入、未来重构移除 `<dialog>`）就会抛 `TypeError`，**整个 IIFE 中断** → 骨架屏永不消失、展厅永久空白、无任何报错提示。属 fail-hard 而非 fail-soft。

**同类问题**：`app.js:1798` `loadFolderPhotos();` 是浮空 Promise，函数体内 `:850` 的 `decodeURIComponent(pm0[1])` 未被包裹（见 P3-2）→ 畸形 hash 会让它 reject 成 `unhandledrejection`。

**建议**：

```js
/** 统一守卫，缺元素时静默降级而非中断整站 */
const on = (el, type, handler, opts) => {
  if (!el) return;
  el.addEventListener(type, handler, opts);
};

on(prevBtn, "click", (e) => { e.stopPropagation(); step(-1); });
on(nextBtn, "click", (e) => { e.stopPropagation(); step(1); });
on(closeBtn, "click", closeLightbox);
on(stage, "pointerdown", ...);
```

```js
loadFolderPhotos().catch((err) => {
  window.__lf?.push("unhandled:" + (err && err.message));
  galleryReady = true;                       // 兜底放开空状态，避免骨架屏常驻
  if (skeletonEl) skeletonEl.hidden = true;
  emptyEl.hidden = false;
});
```

---

### P1-5 · 序厅不可键盘操作；`role="toolbar"` 无方向键导航

> **✅ 已修（2026-09-26）**
> - **(a) 序厅**：`.hero-art` 由 `<div>` 改为 `<button type="button">`（按钮重置：`appearance/border/padding/background`，
>   并显式 `overflow: visible` —— 窄屏画心用 `86vw` 本就宽于容器 `86%`，防某些 UA 给 button 的 overflow 裁掉两侧）。
>   保留 slide 上的 `role="group"` / `aria-roledescription="slide"` / `tabIndex=-1`（APG 轮播结构不变）。
>   `<button>` 原生响应 Enter/Space 并派发 `click`，冒泡到 slide 既有的处理器，**无需另写 keydown**。
>   **关键连带修复（原报告未提）**：加上可聚焦的 button 后，`opacity:0 + pointer-events:none` 挡不住键盘 ——
>   8 张 slide 叠放，会有 7 个不可见按钮进入 Tab 序列。已在 `.hero-carousel-slide` 上用
>   `visibility: hidden` + `transition: … visibility 0s linear .9s`（活动态 `linear 0s`）解决，
>   淡出不被破坏，非活动 slide 同时移出无障碍树。
>   已核对 `applyHeroSources()` 只用 `img.complete`/`src`、不用几何量测，`visibility` 不影响其逻辑与图片加载。
> - **(b) 筛选栏**：`role="toolbar"` → `role="group"`（采用报告里的「最省」方案，语义自洽、零焦点管理复杂度）。
> - 新增两条 e2e：「序厅画作可键盘打开，且非活动 slide 不在 Tab 序列内」（含 Enter 开灯箱 + Tab 不落到
>   任何 `.hero-art`）、「筛选栏语义为 group」。
> - 视觉核对：1280 / 390 两档截图与几何量测，桌面端 `.hero-art` 与 `img` 盒**完全重合**，无按钮残留样式。

**位置**：`app.js:580`（`slide.tabIndex = -1`）、`:609-622`（仅 click）、`index.html:93`（`role="toolbar"`）

**(a) 序厅 slide**：`<div>` + `tabIndex=-1` + 只有 `click` 处理器 → 键盘用户无法打开序厅中的作品。APG 的可轮播模式要求每张幻灯片可通过键盘进入。
> 缓解事实：`heroList = photos.slice(0,8)`（`app.js:565`），这 8 张在下方展厅也是前 8 张卡片，键盘用户仍可经卡片抵达同一内容。所以这是**操作方式不一致**，不是内容不可达 → 定级 P1 而非 P0。

修法：把 `.hero-art` 换成 `<button type="button">`（保留现有 `role="group"` / `aria-roledescription="slide"` 在 slide 上），或给 slide 加 `tabindex="0"` + `keydown` 处理 `Enter` / `Space`。

**(b) `role="toolbar"`**：toolbar 语义要求 roving tabindex + 左右方向键切换。当前 8–12 个 chip 全部在 Tab 序列内，与 toolbar 语义不符。两条路：

- **最省**：去掉 `role="toolbar"`，改 `role="group"`（`aria-pressed` 的切换按钮组语义自洽，零额外代码）。
- **最正**：保留 toolbar 并实现 roving tabindex（`tabindex="-1"` + 方向键移动焦点 + Home/End）。

推荐前者：语义准确度提升，且不引入焦点管理复杂度。

---

### P1-6 · 墙色采样应移到 CI（可删除约 90 行客户端代码）

**位置**：`app.js:41-168`（`sampleRoomColor` + idle 队列 + epoch 机制）、`:1188-1199`（每张卡片入队）、`:481-492`（序厅）、`:1091-1093`（灯箱）；对照 `tools/photos_lib.py:233-276`（`photo_item`，**已经在用 Pillow 打开同一批像素**）

**现状成本**：每次 `renderGallery` 会对**所有可见卡片**跑一遍
`创建 canvas → drawImage → getImageData(28×28) → 逐像素算饱和度 → 至多 20 轮对比度迭代`，经 `requestIdleCallback` 分片（4ms 预算）。18 张 ≈ 18 次；若馆藏到 100 张，每次筛选切换都要重跑一遍（`renderGallery` 全量重建，见 P2-3）。

**影响**：
- 移动端中低端机上持续的 idle 回调抢占，滚动期掉帧；
- 采样落地前 `--card-wall` 是初始值 `#2a2418`（`:810`），落地后跳变 → **首屏可见的色pop**；
- `AGENTS.md` 记录该队列是为"几十张缩略图 load 扎堆"做的缓解——**根因是采样位置错了**，不该在客户端做。

**建议**：把 `sampleRoomColor` 等价逻辑搬到 `tools/photos_lib.py`，在 `photo_item()` 里输出预计算调色板（Pillow 已有 `Image.resize((28,28)).getdata()`，Python 侧实现约 20 行），manifest 增加字段：

```json
{ "file": "01-city-rain.jpg",
  "palette": { "wall": "#1b2620", "glow": "rgba(201,169,106,0.34)", "accent": "rgba(180,150,90,0.75)" } }
```

客户端 `app.js:1188-1199` 缩为：

```js
const applyPalette = (el, p) => {
  if (!p) return;
  el.style.setProperty("--card-wall", p.wall);
  el.style.setProperty("--card-glow", p.glow);
  el.style.setProperty("--card-accent", p.accent);
};
```

**必须保留的例外**：浏览器内上传的 `customPhotos`（`app.js:915-943`）没有预计算值 → **保留一条仅在 `photo.custom` 时启用的采样回退路径**。这样既拿到收益，又不破坏上传流程。

**净收益**：删除约 90 行 JS（idle 队列 + epoch + 对比度迭代），消除首屏色跳变与滚动期 idle 抖动；代价是 `photos_lib.py` 约 20 行 + manifest 每项约 120 字节（18 张 ≈ 2KB，可接受）。

---

> **✅ 已修（2026-09-26，批次 2 收尾）**
>
> **实现**：`photos_lib.photo_palette()` 把 `sampleRoomColor` 逐行等价搬到 Python（含 `Math.round` 的半数进位方向），
> `photo_item()` 输出 `palette: {wall, deep, glow, accent}`；客户端三处消费点改为「有 palette 就直接用、没有才采样」：
> 卡片 `app.js` 渲染处（同步赋值，**不再等图片解码**）、序厅 `applyHeroSources`、灯箱 `syncLightbox`。
> `sampleRoomColor()` 与其 idle 队列**保留**，但只服务 `photo.custom`（上传图，无 manifest 条目）——
> 这是报告明确要求的回退例外，故「删约 90 行」未全部兑现：删掉的是**馆藏图的每次 render 全量重采样**，
> 函数本身作为回退必须留着。
>
> **实测偏差（不是估计）**：算法迁移后与旧客户端采样器在**同一批 18 张上**的终值差（已关过渡，读终值）——
> 卡片 wall 中位 Δ1 / 最大 11；卡片 glow 中位 5 / 最大 37；卡片 accent 中位 9 / 最大 74；
> 灯箱三变量中位 Δ1–3 / 最大 18；序厅 Δ1–2。
> 截图口径（1280×900）：序厅均值 Δ0.19（最大 1）、灯箱 Δ0.55–2.02（最大 8）、展厅 Δ2.93。
>
> **关键判读**：展厅那一格不能只看数字——按行分解差异后，`采样复跑 vs 采样复跑` 自身就有
> 均值 Δ2.64 / 最大 189 的差，且**全部集中在一张卡片的绘制带**（截图时该图尚未绘制完，属探针伪影）。
> 即：算法间差异（2.93）与采样器自噪（2.64）同量级，**剔除伪影带后展厅的真实色偏只有 Δ1–13**。
>
> **采样源本就不可复现（本项的真正理由）**：同一张画在 1280 / 390 视口下，
> **18 张里有 7 张**浏览器选中的 srcset 候选不同（`-800.avif` vs `-400.avif`），
> 而旧实现采的正是「浏览器实际选中的那一档」→ 墙色随身设备而变。预计算把采样源钉死为原图后，
> 同一作品在卡片／序厅／灯箱三处**共用一套墙色**（旧实现三处各采各的，同画三色）。
>
> **过程发现（两个坑，都已写进 `AGENTS.md`）**：
> 1. `loadFolderPhotos()` 是**逐字段白名单拷贝**，`palette` 被静默吞掉——manifest 里 18/18 都有值，
>    页面却照旧跑采样，且不报错。第一次「验证」正是被这一点骗过：探针读到两模式取值完全相同，
>    才反查出白名单的问题。教训：断言要写「取值 == manifest 的值」，写「颜色不等于初始值」测不出来（采样兜底同样满足）。
> 2. 滤波要选 `Image.Resampling.BILINEAR` 而非 `BOX`：实测与浏览器 `drawImage` 的输出最接近
>    （最大通道差 18 vs BOX 36 / BICUBIC 49 / LANCZOS 50 / NEAREST 42），因为 `accent` 是
>    「最饱和的单像素」argmax，滤波略有不同就会翻转成另一个像素、连带把墙色色相拉走。
>
> **代价（实测）**：manifest 12,100 → 15,678 字节（+29.6%，gzip 后远小于此，`rgba(` 前缀高度重复）；
> sync 阶段调色板计算 **2.5s / 18 张**（均值 141ms，最大的两张各 ~775ms，需完整解码原图）。
> 若馆藏涨到数百张再考虑 `Image.draft` 或跳过未变更文件。
>
> **验证**：`lint` 干净；e2e **19 / 19 通过**（新增 1 条断言墙色来自 manifest）；
> 新增的探针还证实**预计算模式复跑逐字节可复现**（取值 0/18 项不同、截图 Δ0.00），而旧采样路径在展厅截图上不自洽。

---

### P1-7 · `backdrop-filter` 叠加近不透明底：高成本、近零收益

> **✅ 已修（2026-09-26）**：采用取舍 A —— 删除 `backdrop-filter` 与 `-webkit-backdrop-filter` 两行，
> 保留 94% 不透明底（零视觉差异）。全站已无其它 `backdrop-filter` 使用点（`grep` 确认）。
> 代码内留了注释说明取舍与「若日后要玻璃质感必须同时降 alpha 并重校验文字对比度」。

**位置**：`styles.css:156-169`

```css
.site-nav {
  background: rgba(21, 28, 24, 0.94);          /* 94% 不透明 */
  backdrop-filter: saturate(120%) blur(12px);   /* 只有 6% 的透底参与模糊 */
}
```

**影响**：`.site-nav` 是 `position: fixed` 全宽条，内容在其下方持续滚动 → 合成器每帧都要重算 52px × 视宽的背景模糊。而 94% 的 alpha 意味着被模糊的内容只剩 6% 的可见权重，视觉差异几乎不可辨。这是典型的"付出滚动期 GPU 成本换取不可见的收益"，在中端 Android 上表现为持续掉帧。

**建议**（两种取舍，明确表态）：

```css
/* 取舍 A（推荐）：既然几乎不透明，就别模糊 */
.site-nav { background: rgba(21, 28, 24, 0.94); }   /* 删除 backdrop-filter 两行 */

/* 取舍 B：确实想要玻璃质感 → 必须同时降 alpha 并重新校验文字对比度 */
.site-nav {
  background: rgba(21, 28, 24, 0.72);
  backdrop-filter: saturate(120%) blur(12px);
}
/* 注意：--gilt-bright #e2c98a 在 0.72 的底上对比度会随背景内容波动，
   需给导航文字加 text-shadow 或加深渐变遮罩保底 */
```

---

### P2-1 · ≥200 行死 CSS

**核对方式**：以 `index.html` + `app.js` 全文为消费者，对 `styles.css` 的选择器做反向查找。

**A. 只存在于 CSS、HTML/JS 中完全不存在（约 130 行）**

| 选择器 | 行 | 备注 |
|--------|----|------|
| `.hero-kicker` | 264-271 | 已被"无字陈列"移除 |
| `.hero-sub` | 285-293 | 同上 |
| `.hero-carousel-caption p` | 391-397 | JS 从未创建 `p` |
| `.chapter-kicker` | 717-724 | |
| `.chapter-sub` | 737-743 | |
| `.card-meta` / `.card-label` / `.card-title` / `.card-caption` / `.card-medium` | 889-933 | `renderGallery` 从未创建 `.card-meta`（45 行） |
| `.upload-sub` | 1020-1028 | |
| `.about-text` | 1147-1155 | HTML 中只有 `.about-title` |
| `.footer-museum-en` | 1180-1187 | |
| `.footer-note` | 1189-1197 | |
| `.lb-index` / `.lb-caption` / `.lb-medium` | 1445-1478 | HTML 里只有 `#lbTitle`（34 行） |

**B. 墓碑（明确写了 `content: none` / `animation: none`，功能已废）**

| 位置 | 内容 |
|------|------|
| `:348-350` | `.hero-art::after { content: none; }` |
| `:848-850` | `.card-media::after { content: none; }` |
| `:1339-1341` | `.lightbox-frame::after { content: none; }` |
| `:1343-1358` | `.lightbox-frame.is-lit` + `@keyframes frame-lit`（keyframe 首尾同值 = 无动画），但 `app.js:1086-1090` 仍为此做一次**强制重排**（`void frame.offsetWidth`） |
| `:1094-1096` | `lbImg.style.animation = "none"; void lbImg.offsetWidth; lbImg.style.animation = "";` 每次切图两次强制重排 |

**C. 被层叠完全压死的早期草稿**

| 位置 | 被谁压死 |
|------|----------|
| `:366-368` `.filter-bar::before{display:none!important}` | `:1653` 重复同一声明 |
| `:370-373` `.filter-bar{margin-bottom:20px;justify-content:center}` | `:938`（sections 层 > components 层） |
| `:375-379` `.filter-chip{letter-spacing:.08em;color:;font-size:12px}` | `:956-969` 三个属性全被覆盖 |
| `:362-364` `.hero-carousel-caption{display:none!important}` | `:1644` 同一份 |

**D. 由 JS 创建但被 CSS 强制隐藏的 DOM**
`app.js:602-607` 每张 slide 都创建一个 `.hero-carousel-caption`，内含空的 `<h2>`；CSS `:362` / `:1644` 双重 `display:none !important`。共 8 个无用节点/次渲染。
同理 `app.js:1083` `lbTitle.textContent = ""` 是对一个 `display:none` 元素的无用写入。

**建议**：按 A→B→C→D 顺序清理，同步删除 `app.js:602-607` 与 `:1083`。清理后应在 `AGENTS.md` 补一句"CSS 只保留有消费者的选择器；新增结构时先删旧规则"。
**注意**：`lighthouserc.json` 的 a11y 满分断言会拦住任何误删（axe 不测不存在元素），所以本项**可安全执行**。
**收尾**：改 `styles.css` 后按 `AGENTS.md` 要求抬 `sw.js:2` 的 `VERSION`。

---

### P2-2 · `app.js` 单文件单作用域

**现状**：1808 行、63 个函数、全部共享一个 IIFE 作用域；`folderPhotos / customPhotos / photos / visible / activeFilter` 等 20+ 个可变状态散落在顶部，任何函数都可能读到中间态。`reduceMotion`、`roomEpoch`、`lbZoom` 等跨 5 个功能域共享。

**风险**：`activeFilter` 在 6 处被写（`:321` / `:764` / `:775` / `:846` / `applyFilter` 内），`visible` 在 4 处被写——这类隐式全局状态是无单元测试的直接原因。

**建议**：按功能域拆成原生 ESM（**不需要构建步骤**，符合项目约束）：

```
src/
  palette.js    sampleRoomColor + 采样队列（P1-6 之后可缩为 fallback）
  hero.js       HERO_MAX / heroAuto* / applyHeroSources / renderHeroCarousel
  gallery.js    renderGallery / applyRowFit / displayTitle / wallNumber
  lightbox.js   open/close / 手势 / 缩放 / syncLightbox
  filter.js     collectFilters / renderFilters / applyFilter / hash 深链
  upload.js     handleFiles / compressImage / GitHub API
  main.js       装配与启动
```

`index.html` 改 `<script type="module" src="src/main.js">`；`sw.js:8` 的 `SHELL_ASSETS` 同步列出模块清单（或改用 `import` 图预缓存）。

**收益**：状态收敛到模块内 → 可对 `applyRowFit` / `ymKey` / `collectFilters` / `displayTitle` 写纯函数单测，补上当前缺失的测试层。
**代价**：冷启动多 5–6 个 HTTP/2 请求（同源 HTTP/2 下开销很小），需同步改 SW 缓存清单与 e2e。
**建议节奏**：先做 `palette.js` + `filter.js`（无耦合、纯函数多），验证链路后再拆 `lightbox.js`。

---

### P2-3 · `renderGallery` 全量重建

**位置**：`app.js:1110-1217`

`gallery.innerHTML = ""` 后重建全部节点；`roomEpoch += 1; roomJobs.length = 0`（`:1114-1115`）作废旧采样。筛选切换、上传后 `rebuildPhotos`、`prefers-reduced-motion` 变化都会触发。

**影响**：切换筛选 = 丢弃全部 DOM + 重新解码全部缩略图（`loading` 重新走 lazy）+ 重跑全部墙色采样。虽然 View Transitions 把视觉过渡抹平了，但**主线程成本照旧**；馆藏到 100 张时这是最重的一次交互。

**建议（渐进，不推翻 VT）**：
1. 采样结果缓存在 photo 对象上（`photo._palette`），重建时直接读，不再重复计算——这一条与 P1-6 天然合流。
2. 筛选时**按 key 复用节点**：维护 `Map<photo.id, HTMLElement>`，只增删差集；`view-transition-name` 已经按 `wallIdx` 稳定命名（`:1133`），复用节点反而让 VT 配对更准。
3. 若不想改结构，至少把 `img.src` 相同的卡片 `cloneNode(true)` 复用（浏览器对已解码图片走内存缓存）。

---

### P2-4 · SW 媒体缓存裁剪 O(n²)

**位置**：`sw.js:85-101`

`putMedia()` 每次 put 后都调 `trimMediaCache()`，后者 `cache.keys()` **全量枚举** → 一次页面加载（约 108 个缩略图/中图请求）会触发约 108 次全量枚举 + 潜在删除。100 条上限下累计约 10⁴ 次 key 对象分配。

**建议**：改成计数阈值触发。

```js
let putsSinceTrim = 0;
const TRIM_EVERY = 24;

async function putMedia(request, response) {
  const cache = await caches.open(CACHE_MEDIA);
  await cache.put(request, response);
  putsSinceTrim += 1;
  if (putsSinceTrim >= TRIM_EVERY) {
    putsSinceTrim = 0;
    await trimMediaCache();
  }
}
```

**顺带**：`sw.js:8` 的 `SHELL_ASSETS` 同时含 `"./"` 与 `"./index.html"`（同一份内容两份缓存条目），可只留 `"./"; "./index.html"` 之间的一个——但 `isShellRequest` 对二者都命中 SWR，保留 `./index.html`（供 `:171` 的 fallback）即可。

---

### P2-5 · 上传流程全串行

**位置**：`app.js:1462-1543`

`for (const file of files)` 顺序执行：每张图 = 压缩（`createImageBitmap` + canvas + `toBlob`）→ 尺寸探测 → IndexedDB 写入 → 若有 token：`ghPutFile`（内含 `ghGetFileSha`，即 1–2 次网络往返）→ **每张都重写一次整份 manifest**（`ghUpdateManifest`，含 1 次读 + 1 次写）。

**实算**：20 张图 = 20 次压缩 + 20×(1 读 + 1 写 + 1 取 sha) = **约 60 次 GitHub API 往返**，且全部串行。GitHub Contents API 有速率限制（5000/h），连续大文件还会触发内容冲突。

**建议**：
1. **批量提交清单**：循环内只收集 `newItems`，循环结束后**调用一次** `ghUpdateManifest(cfg, allItems)` → API 往返从 3N 降到 2N+2。
2. **压缩并发化**：用 `Promise.all` 配 3–4 并发（`createImageBitmap` 是异步且可并行），保留 `setStatus` 的进度节流。
3. **失败重试**：`ghPutFile` 对 409/422（sha 冲突）做一次「重取 sha 再写」的重试，否则并发或人工同时提交时会永久失败。

---

### P2-6 · `preloadImage` 只增不减

**位置**：`app.js:262-278`，调用点 `:833` / `:1063` / `:1098` / `:1212-1214`

每次 hover / focus 卡片、每次灯箱翻页都往 `<head>` 追加 `<link rel="preload" as="image">`，**从不回收**。上限 = 馆藏数 × 2（medium + mediumAvif），100 张馆藏时 `<head>` 会挂到约 200 个 link 节点。

同时 `preloadLightboxNeighbor(1)` 与 `(-1)`（`:1097-1098`）在**每一次翻页**都同时预载前后两张 → 100KB 级的中图 ×2，弱网下明显浪费，而用户大量操作是单向翻页。

**建议**：
- 只预载**前进方向**（按 `step(delta)` 的符号），反向预测价值低；
- 用 `WeakSet` 或直接给 link 加 `link.dataset.pinned` 并在数量超阈值（如 24）时移除最早的；
- 或改用 `fetch(url, { priority: "low" })` 并由 SW 落缓存，不占 `<head>` 节点。

---

### P2-7 · 原图占仓库 91%

**数据**：`photos/*.jpg` 合计 **74 MB**（18 张，最大单张 9.0 MB），`photos/` 81 MB，`.git` 87 MB。

**影响**：clone 慢、CI checkout 慢、Pages 上传慢；且原图是**公开可猜 URL**（`photos/IMG20260916193647.jpg`），任何直接访问会拉 9 MB。运行期正常路径不会请求它（该图有 medium，灯箱走 `mediumAvif`），所以这是"仓库成本"而非"运行成本"。

**建议**：在入库环节加一步归一化（`tools/` 内，或 CI 首次处理时回写），长边 ≤4000px / JPEG q88 —— 9 MB → 约 1.5–2 MB，预计整体从 74 MB 降到 25 MB 以内。若坚持保留原始存档，改用 Git LFS 或把原图放独立分支（Pages 只发布 `thumbs/` + `medium/`）。

---

### P2-8 · 展厅顺序在两个环境不一致（mtime 排序 vs git 不保留 mtime）

> 本条是审查阶段遗漏、在批次 1 出图比对时暴露出来的：按索引取卡做前后对比，两次截到的**不是同一张作品**，顺藤摸到根因。

**位置**：`tools/photos_lib.py:194-201`（`list_photo_files`）、`app.js:248`（`rebuildPhotos`，不排序）、`.github/workflows/sync-photos.yml`

**现象（实测）**：
| 来源 | 首项 |
|------|------|
| 本机 `python tools/serve.py`（实时扫描 photos/） | `IMG20260916193647.jpg` |
| 线上 / CI 生成的 `photos/manifest.json` | `mmexport1788447848472.jpg` |

18 项文件集合完全相同，**顺序完全不同**。

**根因**：`list_photo_files()` 的排序键是 `(p.stat().st_mtime, p.name)` 倒序，而 **git 不保留文件 mtime**。CI checkout 后所有照片 mtime 相同 → 排序退化为"文件名倒序"；本机保留真实上传时间 → "上传时间倒序"。`photos_lib.load_prev_dates()` 只稳住了 `date` 字段，**没有稳住顺序**。

**影响**：
1. 本地预览与线上作品的**排布顺序不同**，本地无法复现线上的策展观感；
2. `app.js` 不做日期排序，展厅顺序 100% 由 manifest 决定 → 顺序漂移直接等于策展漂移；
3. 策展节奏"每 7 张独占一面墙"（`app.js:1125`）会落在**不同的作品**上，与 P3-4 的列数耦合叠加后，两环境的"重点墙"完全错位；
4. 任何一次 CI 重跑都可能整体重排，而 commit diff 只是 JSON 行序变化，人工 review 极易放过。

**建议**：给排序一个与环境无关的稳定键 —— 优先 `date` 倒序（已有 EXIF → meta → prev_dates 的回退链），同日再按文件名倒序；或在 manifest 中显式写入 `order` 并由 CI 保持不变。并补一条 CI 守卫：重新生成 manifest 后 `git diff --quiet photos/manifest.json`（顺序稳定即无 diff）。

> **✅ 核心已修（2026-09-26，提前于批次 3）**：采用「`date` 倒序 + 文件名倒序」方案，
> 见 `tools/photos_lib.py` 的 `manifest_order_key()` 与 `build_photos()`。详见 §8.3。
> **本条已获得功能性后果**：做 P1-2 时发现，顺序漂移会让 `index.html` 的序厅首图预载指向
> **与线上不同的那张图**（本地算出 `IMG20260916193647.avif`，提交版首项是 `mmexport1788447848472`），
> 变成一次高优先级白拉 —— 比不预载更糟。这也是它被从批次 3 提前的直接原因。
> **残留**：上述 CI `git diff --quiet` 守卫未加。

---

### P2-9 · 端口硬编码 + `reuseExistingServer` 使本地测试静默跑在别的仓库上

> 本条同样是审查阶段遗漏、在批次 1 收尾复验时暴露出来的：同一个改动，一次 14/14 全绿、一次 3 项失败，且失败症状与"改动未生效"**完全无法区分**。追查后发现测试根本没打在这个项目上。

> **✅ 已修（2026-09-26）**，三层防线：
> 1. `tools/serve.py` 支持 `--port` / `MILAN_PORT`（默认 8080）；
> 2. `serve.py` 在 Windows 上改用 **`SO_EXCLUSIVEADDRUSE`** —— 端口被占用时 **bind 直接失败**
>    （实测 `WinError 10048`，退出码 1 + 明确提示），**从源头阻断双绑**。已实证四项：
>    空闲可启动 / 同端口第二次启动必失败且仍只有一个 LISTENING / 杀掉后立刻重启**不被 TIME_WAIT 挡住** /
>    `MILAN_PORT` 生效；
> 3. `playwright.config.js` 端口单一事实源；新增 `tests/e2e/global-setup.js`：
>    跑任何用例前把服务返回的 `index.html` / `app.js` / `styles.css` / `sw.js` 与磁盘文件做 **sha256** 比对，
>    不一致即中止整个运行并打印占用排查步骤。
>
> **双向验证**：反向 —— 在 8099 上放一个**别人的服务**（`witty-moon` 目录），运行被明确中止，输出
> `app.js: 服务返回 62274B / 磁盘 62614B（sha256 不一致）`；正向 —— 正常端口下自检通过、18/18 全绿。
> **顺带印证了「只比字节数不够」**：那次中止里还有一行
> `sw.js: 服务返回 7439B / 磁盘 7439B（sha256 不一致）` —— `v34`→`v35` 恰好**等长**，字节数比对会放过它。

**位置**：`tools/serve.py:70`（`port = 8080`）、`tools/serve.py:74`（`directory=str(ROOT)`）、`tools/photos_lib.py:8`（`ROOT = Path(__file__).resolve().parents[1]`）、`playwright.config.js:11`（`baseURL: "http://127.0.0.1:8080"`）、`playwright.config.js:22-23`（`url` 同端口 + `reuseExistingServer: !process.env.CI`）

**现象（实测）**：

| 项 | 值 |
|----|-----|
| 8080 监听进程 | PID 16948 |
| 响应 `Server` 头 | `SimpleHTTP/0.6 Python/3.12.7` |
| 响应 `app.js` | 62274 B，`Last-Modified` = 09:39（本地） |
| 本项目磁盘 `app.js` | 62614 B，mtime = 11:46（本地） |
| 匹配目录 | `~/.local/share/opencode/worktree/0c6e1e/witty-moon`（`app.js`=62274、`styles.css`=41828，**两值完全吻合**） |

有 3 项新测试失败，症状为：390px 下 `rowGap/columnGap/headMarginBottom` 拿到桌面值 52/36/28；`.card-media-glass` 计数为 **0**；窄屏 `.hero-carousel-arrow` 仍 `visible`。这三条恰好都是批次 1 所改之处 —— 看起来就像"改动没生效"，而实际是**页面根本没加载本项目**。

**根因**：两层缺陷叠加
1. `serve.py` 的端口**硬编码**，而根目录按 `__file__` 推导 → 从任何 worktree 启动都会去抢 8080，但服务的是**那个 worktree**；
2. `playwright.config.js` 的 `reuseExistingServer: !process.env.CI` 只要 URL 可达就复用 → 本地跑测试**静默复用了别人的服务**，无任何警告。

叠加 Windows 的 `SO_REUSEADDR`（允许多进程同时 bind 同一端口、请求随机分发），同一命令可能一次全绿、一次失败。

**影响**：
1. **测试结果不可信**：绿与红都可能是幻觉，且失败信息指向被测代码，把排查引向完全错误的方向（本次实际耗时数十分钟）；
2. **改动可能假绿上线**：若外部服务恰好服务旧资产而新断言尚未覆盖该点，回归可被静默放过；
3. 只要机器上还有任何工具（本机装了 opencode，有 4 个本仓 worktree）在同一端口跑过预览，就会复现。

**建议**：
1. `serve.py` 支持 `--port` / `MILAN_PORT` 环境变量，默认仍 8080；
2. `playwright.config.js` 的 `baseURL` 与 `webServer.url` 读同一变量，并用 `webServer.command` 传出该端口（单一事实源）；
3. 在 e2e 里加一条**资产来源自检**（成本极低、收益极高）：`/app.js` 响应体中必须存在 `card-media-glass` 之类**本仓库当前源码特有**的字符串，否则直接失败并提示"端口被外部服务占用"；
4. 可选：CI 与本地统一 `reuseExistingServer: false`。

---

### P3 · 打磨项（逐条）

| ID | 问题 | 位置 | 修法 |
|----|------|------|------|
| P3-1a | 图标按钮 5 种尺寸：箭头 40/42、关闭 36、暂停 28、分页点 24/24 | `:404` `:1272` `:458` `:503` 等 | 定义 `--icon-btn: 40px / --icon-btn-sm: 32px / --dot-hit: 24px` 三档并统一引用 |
| P3-1b | `vh` 与 `dvh` 混用：序厅用 `100dvh`（`:229-230`），重点墙用 `64vh`（`:798`） | `styles.css` | 移动端浏览器 chrome 变化时 `64vh` 会跳变，统一改 `64dvh` 并给 `vh` 回退 |
| P3-1c | `.hero-title` `letter-spacing:0.28em` 配 `padding-left:0.36em` → 视觉中心偏右约 0.08em（42px 字号下约 3.4px） | `:278-281` | 补偿值应与字距同值：`padding-left: 0.28em`（同文件 `.chapter-title` `:731-734`、`.upload-title` `:1014-1017` 都是同值，可以此为基准核对全部居中标题） |
| P3-2a | 灯箱缺底部安全区：`.lightbox-meta`（含 `env(safe-area-inset-bottom)`，`:1440`）被 `:1649` 隐藏，`.lightbox` 只设了 top/left/right 安全区（`:1242-1244`） | `styles.css:1233-1251` | 给 `.lightbox` 补 `padding-bottom: env(safe-area-inset-bottom)` |
| P3-2b | ~~`decodeURIComponent` 未包裹：畸形 `%` 深链抛 `URIError` → `unhandledrejection`~~ | `app.js:850` / `:327` | **✅ 已修（随 P1-4）**：新增 `safeDecode()`，两处调用点均改走它 |
| P3-3a | 无 `<noscript>` 兜底：JS 关闭时展厅、库房全空 | `index.html` | 加一段 `<noscript>` 说明 + 指向 `photos/manifest.json` 的链接 |
| P3-3b | JSON-LD `ImageGallery` 无 `image` 数组 → 无富结果 | `index.html:31-45` | 由 `sync_photos.py` 注入前 N 张 `image` + `thumbnailUrl` |
| P3-3c | `sitemap.xml` 缺 `lastmod` | `sitemap.xml` | CI 用最近一次 manifest 提交时间填充 |
| P3-4 | 策展节奏 `(i + 1) % 7 === 0` 与列数耦合：7 = 3 列 × 2 行 + 1 面墙，仅在 3 列时成立；2 列（手机）/ 4 列时节奏失真 | `app.js:1125`，配合 `:798` | 布局后读取实际列数，`featureInterval = cols * 2 + 1`；或明确接受"仅桌面 3 列成立"并注释 |
| P3-5 | `window.__lf` 调试时间线随每次加载无限增长，且是生产可见的全局 | `app.js:784-787` | 用 `if (location.hostname === "127.0.0.1" || location.search.includes("debug"))` 包裹，或改成 `console.debug` 单次输出 |
| P3-6 | 移动端筛选栏横向滚动无渐隐提示，用户不知可横滑 | `styles.css:1556-1576` | 右侧加 `mask-image: linear-gradient(90deg, #000 92%, transparent)`，或滚动到末端时切换 |

---

## 5. 优先级与执行排期

### 批次 1 — 立即修（预计 3 处改动，全部可在 1 次提交内完成）

| 顺序 | ID | 改动 | 验证 |
|------|----|------|------|
| 1 | P0-1 | 移动"无字陈列"块到 `@layer responsive` 最前 | `npm run lint && npm run test:e2e`；330 / 390 / 560 / 834 / 1280 五档目测展厅 gap 与列宽 |
| 2 | P0-2 | 拆 `.card-media-glass` 裁切盒（CSS + `app.js:1200`） | hover 截图对比，确认画框上方 58px 出现锥光 |
| 3 | P0-3 | ≤560px 隐藏箭头（方案 A） | 新增 e2e 断言：`arrow.right <= frame.x` |
| 4 | — | 抬 `sw.js:2` `VERSION` | — |

### 批次 2 — 本迭代（可与批次 1 分开两次提交，便于回滚）

> **状态：已执行（2026-09-26），见 [§8](#8-批次-2-执行记录2026-09-26)**（另提前完成 P2-8 核心、P2-9）。

P1-1（骨架屏共用布局变量）→ P1-4（事件守卫 + Promise catch）→ P1-5（键盘可达性）→ P1-7（去 backdrop-filter）
→ P1-2（CI 注入首图 preload + 打开性能断言）→ P1-3（去 `content-visibility` 或用实测值）→ P1-6（采样移到 CI）

**实际结果**：P1-1 ✅ / P1-4 ✅ / P1-5 ✅ / P1-7 ✅ / P1-3 ✅（随 P0-2）
；P1-2 **仅落守卫**，首图 preload 方案经四组对照测试后**否定并回退**（§8.2）
；**P1-6 ✅ 已修**（§8.5，收尾时完成）。

**每批必须跑**：`npm run lint && npm run test:e2e && npm run lhci`，并抬 SW `VERSION`。
> ⚠️ 本机 `lhci` 因 Lighthouse 12.6.1 × Chrome 153 不兼容而**跑不起来**（对照实验已确认与改动无关，见 §8.4），
> 该项实际未能在本地验证。

### 批次 3 — 技术债排期

> **状态：部分执行（2026-09-26），见 [§9](#9-批次-3-执行记录2026-09-26)**。P2-1 / P2-4 / P2-5 / P2-6 ✅；P2-2 / P2-3 / P2-7 未做，各有明确理由（§9.6）。

P2-1（死码清理，一次性）→ P2-6 / P2-4（低风险局部）→ P2-5（上传批量化）→ P2-3（节点复用）→ P2-2（ESM 拆分）→ P2-7（原图归一化）
（~~P2-8~~、~~P2-9~~ 已提前完成）

**实际结果**：P2-1 ✅（实删 218 行，超出预估的 200 行）/ P2-6 ✅ / P2-4 ✅ / P2-5 ✅（压缩并发部分未做）
；P2-3 的「采样重跑」已由 P1-6 天然消除，节点复用未做
；P2-2、P2-7 未做（前者需先定测试框架，后者是破坏性改动需确认）。

### 建议补齐的测试（当前缺口）

> 已补：控件遮挡（P0-3）、移动端布局参数（P0-1）、骨架屏一致性（P1-1）、键盘可达性（P1-5）、元素缺失降级（P1-4）。
> **仍未补**：布局稳定性（P1-3，需滚动累加对比）、纯函数单测（P2-2 拆分后）、墙色采样一致性与 LCP 预算断言。

| 缺口 | 建议断言 |
|------|----------|
| 控件遮挡 | `lb-arrow` / `hero-carousel-arrow` 与画框不重叠（P0-3） |
| 移动端布局参数 | ≤560px 下 `.gallery` 的 `gap` / `columnGap` 与设计值一致（P0-1 回归网） |
| 骨架屏一致性 | 首屏骨架与数据到达后 `.gallery` 的 `gridTemplateColumns` 相同（P1-1） |
| 布局稳定性 | 滚动到底部后 `document.documentElement.scrollHeight` 与逐屏滚动累加之和的偏差（P1-3） |
| 键盘可达性 | Tab 到序厅区域能触发灯箱打开（P1-5） |
| 纯函数单测 | `displayTitle` / `wallNumber` / `ymKey` / `ymLabel` / `applyRowFit`（P2-2 拆分后） |
| 元素缺失降级 | 删除 `#prev` 后页面仍渲染卡片（P1-4） |

---

## 6. 审查边界（未覆盖 / 需实测确认）

| 项 | 说明 |
|----|------|
| **P0-2 需视觉实测确认** | 结论由绘制顺序与裁切规则推导，属确定性 CSS 推断；建议改前先截一张 hover 对比图确认观感差异幅度 |
| **P1-2 的 LCP 数值为估算** | 基于 RTT/带宽模型推算，实际值需 `lhci` 打开 performance 或用 Chrome DevTools 的 Slow 4G + 4× CPU 实测 |
| 真机表现 | `backdrop-filter`（P1-7）、`content-visibility`（P1-3）、`animation-timeline` 的掉帧幅度需中端 Android 真机验证 |
| iOS Safari | 双击缩放（`dblclick`）在 iOS 上触发不稳定，`app.js:1741-1748` 的双击缩放路径在 iOS 需真机确认；单指横滑与返回手势的冲突亦需实测 |
| 无障碍完整审计 | 本文只覆盖结构性缺口；`research/milan-museum-design/A11Y-APG-AUDIT.md` 的既有结论未重复复核 |
| 安全 | 未发现 `innerHTML` 注入点（文本一律走 `textContent`），`localStorage` 存 PAT 的风险已在 `AGENTS.md` 记录；建议长期改用 fine-grained token 并评估 `sessionStorage` 降低持久化面 |

---

## 7. 批次 1 执行记录（2026-09-26）

### 7.1 改动清单

| 文件 | 改动 | 对应 |
|------|------|------|
| `styles.css` | "无字陈列"块整体移至 `@layer responsive` 最前 + 加"层内源序敏感"注释 | P0-1 |
| `styles.css` | `.card-media { overflow: visible }`；新增 `.card-media-glass`（`absolute / inset: var(--frame-inset) / overflow: hidden`）；`.card-media img` 改 `inset: 0; width/height: 100%` | P0-2 |
| `styles.css` | `.card` 移除 `content-visibility: auto` 与 `contain-intrinsic-height: auto 400px`（主因） | P0-2 + P1-3 |
| `styles.css` | `.gallery-section { overflow-x: clip }`（补偿上条带来的横向溢出） | P0-2 连带 |
| `styles.css` | ≤560px 隐藏 `.hero-carousel-arrow` 与 `.lb-arrow`（保留横滑与分页点） | P0-3 |
| `app.js` | `renderGallery` 把画心（`<picture>`/`<img>`）包进 `.card-media-glass` | P0-2 |
| `sw.js` | `VERSION` `milan-v34` → `milan-v35` | AGENTS.md 约定 |
| `tests/e2e/smoke.spec.js` | 新增 4 条回归测试（10 → 14 项） | 见 7.2 |

### 7.2 验证结果

- `npm run lint`（ESLint + Stylelint）：**干净**。
- `npx playwright test`：**14 / 14 通过**（原 10 项全部保持 + 新增 4 项）。

新增回归测试及其锁定目标：

| 测试 | 锁定的行为 |
|------|-----------|
| 展厅间距按断点取值（无字陈列层叠回归） | 桌面 `rowGap 52 / columnGap 36`、章节题 `margin-bottom 28`；390px `40 / 16`、`36` —— 直接防止 P0-1 复发 |
| 画心裁切盒与墙面光分层（射灯回归） | `.card-media` 与 `.card-media-glass` 的 overflow 分层、`.card` 的 `content-visibility` 必须为 `visible`、画心 gutter 恒为 12px |
| 窄屏箭头隐藏且不覆盖画心，翻页交回手势 | 窄屏两处箭头必须隐藏，且**横滑仍能真实翻页**（不只看隐藏，看功能还在） |
| 桌面端灯箱箭头让开画心 | 箭头右/左边界不得越过画框边界 |

### 7.3 射灯效果像素级对照（同一作品、同一裁切、deviceScaleFactor 2）

测量区域：画框顶边以上 8–58px 的墙面带，取横向中间 50%。

| 版本 | idle 均值 RGB | hover 均值 RGB | hover − idle |
|------|---------------|----------------|--------------|
| 改动前 | (42.82, 51.36, 42.57) | (42.82, 51.36, 42.57) | **0.00 / 0.00 / 0.00** |
| 改动后 | (64.69, 68.93, 57.41) | (96.36, 96.02, 82.04) | **+31.67 / +27.09 / +24.63** |

改动前 hover 对墙面的贡献**精确为 0**；改动后墙面带真实存在射灯（idle 提亮约 26 级），hover 再提亮约 31 级。`AGENTS.md` 的设计意图首次真正落地。

> 注：上表是在只改 `overflow` 阶段**不成立**（仍为 0.00）、补上 `content-visibility` 移除后才成立的——这正是 P0-2 复核更正的依据。

### 7.4 过程发现（供后续批次参考）

**(a) 端口被残留 dev server 抢占，导致首轮验证结论不可信**
本机 8080 上有 **3 个 `python.exe` 同时监听**（Windows 允许 `SO_REUSEADDR` 重复绑定），其中一个是**上一会话遗留、指向旧项目快照**的 `serve.py`（返回 `Content-Length: 62274`，而磁盘已是 62614）。请求被随机分发到不同进程 → 首轮 e2e 出现新旧资产混版，4 项失败**全是假象**（"控制台无错误"也因混版而误报）。
**处置**：`taskkill` 清掉全部监听进程 → 重启单一实例 → 校验 `curl` 字节数 == 磁盘字节数、连续 8 次请求一致，才重跑验证。
**建议**：`serve.py` 启动时显式检查端口并**拒绝启动**（当前 `ThreadingHTTPServer` 默认 `allow_reuse_address`，多个实例静默共存）；或给 e2e 加一条前置自检"服务返回内容与磁盘一致"。

**(b) 按索引取卡做跨环境视觉对比不成立**
因 P2-8 的顺序漂移，两次运行的第 N 张不是同一张作品。已将基线副本的 `photos/manifest.json` 替换为同一份后，才得到有效对照。**凡跨环境视觉比对，必须按稳定标识（文件名 / `src`）取元素，不能按索引。**

**(c) 既有 e2e 抓到一处真实回归**
移除 `content-visibility` 后，`.card-media::before` 的 34px 横向溢出让最外侧卡片顶出视口 → 既有的 `noHorizontalOverflow` 断言立刻失败。两点结论：既有断言集是有效的；P0-2 的修复必须连带处理横向溢出（已由 `.gallery-section { overflow-x: clip }` 解决）。

**(d) 本次未能验证的**
`content-visibility` 移除带来的渲染成本变化未做量化（需中端 Android 真机 + Performance 面板）；`lhci` 的 performance 仍为 `off`，因此首次加载性能仍无守卫（P1-2 未动）。

### 7.5 仍未修（按原排期）

> **⚠️ 本节的「批次 2」清单已过期** —— 批次 2 已于同日执行，见 [§8](#8-批次-2-执行记录2026-09-26)。
> 实际结果：P1-1 / P1-4 / P1-5 / P1-7 / P1-6 已修，P1-2 只落守卫（预载方案被实测否定）。

批次 2：P1-1 骨架屏、P1-2 LCP + 性能断言、P1-4 事件守卫、P1-5 键盘可达、P1-6 采样移 CI、P1-7 `backdrop-filter`。
批次 3：P2-1 死码清理、P2-2 ESM 拆分、P2-3 节点复用、P2-4 SW trim 去抖、P2-5 上传批量化、P2-6 preload 回收、P2-7 原图归一化、~~P2-8 展厅顺序稳定性~~（核心已提前于 §8.3 完成）、~~P2-9 端口/测试可信度~~（已提前完成）。
（P1-3 已随 P0-2 一并完成。）

### 7.6 收尾复验（独立第二轮，2026-09-26）

对批次 1 做了一次独立复核，逐项确认改动落盘并重跑验证：

| 校验点 | 位置 | 结果 |
|--------|------|------|
| SW 版本已抬 | `sw.js:2` | `milan-v35` |
| 墙面横向裁切 | `styles.css:745` | `overflow-x: clip` |
| 裁切盒拆分 | `styles.css:854` `.card-media-glass` | 存在 |
| 卡片不再 paint containment | `styles.css:782` | 已移除（附说明注释） |
| 序厅箭头窄屏隐藏 | `styles.css:593-594` | 在 `@media (max-width:560px)` 内 |
| 灯箱箭头窄屏隐藏 | `styles.css:1688-1690` | 在 `@media (max-width:560px)` 内 |
| JS 包裹层 | `app.js:1203` | 存在 |
| e2e 用例数 | `tests/e2e/smoke.spec.js` | 14 |

- `npm run lint`：**干净**
- `npx playwright test`：**14 / 14 通过**（在已校验资产来源的服务上运行）
- 射灯效果**现场重测**（第 4 张卡，采样画框上沿之上 6–46px 墙面）：idle `(42.82, 52.01, 48.02)` → hover `(61.40, 71.17, 69.26)`，**delta = +18.58 / +19.16 / +21.24**，`changedBBox` 覆盖整个 322×40 采样条。
  > 与 7.3 的 `+31.67/+27.09/+24.63` 数值不同，是因为两次采样卡号与相对画框的偏移不同（7.3 取的是另一种裁切），**方向与量级一致，均为"hover 显著提亮"**。

**遗留（判定为良性，无需改）**：`.upload-section`(`styles.css:1730`)、`.footer`(`styles.css:1735`) 仍保留 `content-visibility: auto`，但（a）使用的是 `contain-intrinsic-size: auto <h>`（带 `auto` 关键字，会记忆已渲染高度，无 P1-3 的估值跳变问题），（b）二者均不承载需要溢出父盒的子盒 → 不构成 P0-2 同类风险。

**测试网的一个边界**：新增的「射灯回归」锁的是**成因**（`contentVisibility === "visible"`、`mediaOverflow === "visible"`、`glassOverflow === "hidden"` + 画心几何），不是**像素结果**。这样更稳定、不引入截图 flake，但理论上未来若改动 `::before` 本体（例如删掉背景图）而结构不变，测试不会报警。如需要，可另加一条低频（`@nightly` / 手动）的像素断言，不进主 suite。

---

## 8. 批次 2 执行记录（2026-09-26）

### 8.1 改动清单

| 文件 | 改动 |
|------|------|
| `styles.css` | ①`.gallery, .gallery-skeleton` 合一（3 处，P1-1）②`.hero-carousel-slide` 加 `visibility` 与延迟翻转（P1-5a）③`.hero-art` 改成按钮重置 + 显式 `overflow: visible`（P1-5a）④`.site-nav` 删 `backdrop-filter` 两行（P1-7） |
| `app.js` | ①新增 `on()` / `safeDecode()` 两个守卫助手（P1-4）②`prevBtn`/`nextBtn`/`closeBtn` 改走 `on()`，`lightbox?.querySelector()` 守卫，`stage` 上 **7 处**监听改走 `on()` ③`loadFolderPhotos()` / `loadCustomPhotos()` 补 `.catch` ④`.hero-art` 由 `div` 改建 `button`（P1-5a） |
| `index.html` | `#filterBar` 的 `role="toolbar"` → `role="group"`（P1-5b） |
| `tools/photos_lib.py` | 新增 `manifest_order_key()`，`build_photos()` 对结果显式排序：**date 倒序 → 文件名倒序**（P2-8 核心）；新增 `photo_palette()` 与配色助手，`photo_item()` 输出 `palette`（P1-6） |
| `lighthouserc.json` | `categories:performance`: `"off"` → `["warn", {minScore: 0.9}]`；新增 LCP（warn ≤2500ms）与 total-byte-weight（warn ≤400KB）（P1-2 守卫） |
| `tools/serve.py` | `--port` / `MILAN_PORT`（默认 8080）；Windows 下改用 `SO_EXCLUSIVEADDRUSE`；端口被占用时**明确报错退出**（P2-9） |
| `playwright.config.js` | 端口单一事实源（`MILAN_PORT`），驱动 `baseURL` 与 `webServer.command`（P2-9）；解释器可覆盖（`MILAN_PY`，默认 `python`，§8.6） |
| `tests/e2e/global-setup.js` | **新增**：跑用例前 ①比对服务返回内容与磁盘文件的 sha256（P2-9）②检查 manifest 是否带 `thumbAvifSrcset` / `palette`，即「服务是否在无 Pillow 降级模式」（§8.6） |
| `tests/e2e/smoke.spec.js` | 新增 5 条：骨架屏一致 / 缺元素降级 / 序厅键盘可达 / 筛选栏语义 / 墙色取自 manifest（14 → **19**） |
| `photos/manifest.json` | 按新的 `manifest_order_key` **一次性重排**（首项不变，其余 17 位变化）+ 18 张全部新增 `palette`；12,100 → 15,678 字节（P2-8 + P1-6，生成物） |
| `AGENTS.md` | 记录端口覆盖、e2e 资产与能力自检、manifest 字段白名单坑、Pillow 依赖 |

### 8.2 P1-2 的「廉价档」预载方案被实测否定 ❌

**原判断**：「让 sync 脚本在 index.html 注入首图 preload，省 1–2 个 RTT。」

**实测（Playwright + CDP：150ms RTT / 1.6Mbps / 4× CPU，冷缓存，各组 3 轮交替取中位）**：

| 变体 | LCP 中位 | `app.js` 发起 | 首图发起 |
|------|---------|--------------|---------|
| `fetchpriority="high"` | **2188ms** | **+204ms** | +205ms |
| `fetchpriority="low"` | 1972ms | +28ms | +29ms |
| 不带 `fetchpriority`（默认） | 1968ms | +27ms | +28ms |
| **无预载（基线）** | **1604ms** | +30ms | +1428ms |

**结论**：预载在任何优先级下都是**净损失**（最好情况仍慢 364ms，`high` 更是慢 584ms）。

**机理**：序厅 `<img>` 由 `app.js` 执行后创建 → **关键路径的瓶颈是 `app.js`，不是图片**。把 97KiB 图片塞进早期阶段，只是让它在同一条受限管道上抢 `app.js` / 字体 / CSS 的带宽：
- `high` 时 `app.js` 的请求被推迟到 +204ms（应 +28ms）；
- 即使降到 `low`，早期阶段的总字节从 203KiB 涨到 300KiB，`app.js` 的**完成**时间仍被拖后。

**处置**：**已完整回退**（`index.html` 标记区间、`sync_photos.py` 注入逻辑、工作流 `git add index.html` 全部还原）。
`lighthouserc.json` 的性能守卫保留 —— 它正是防止这类"想当然的优化"再次蒙混过 CI 的那道闸。

**仍可行的两条路（未做，需先定方向）**：
1. **内联 manifest**：CI 把 `photos/manifest.json`（约 4KB）写成 `index.html` 里的
   `<script type="application/json">`，`app.js` 直接读 DOM，**彻底消掉一次 RTT**。
   需注意 `app.js:791` 的 `fetch(..., { cache: "no-store" })` 与 SW 离线回退链的交互。
2. **正解档（消除 LCP 对 JS 的依赖）**：CI 把首图渲染为 `index.html` 里的静态 `<img>`，
   `app.js` 启动后接管为轮播第 1 帧。收益最大，但要处理静态图与 JS 轮播交接的**双重绘制 / 视觉闪动**，
   在「无字油画馆」这套对观感敏感的视觉上必须先做设计确认。

### 8.3 额外完成：P2-8 核心（原排批次 3，因 P1-2 依赖而提前）

做 P1-2 时发现它不是可选的：本地注入的首图 href 是 `IMG20260916193647.avif`，
而提交版 manifest 首项是 `mmexport1788447848472` —— **预载会指向与线上不同的那张图**，
变成一次高优先级白拉，比不预载更糟。所以顺序漂移在这里有了功能性后果。

**修法**：新增 `manifest_order_key()`，`build_photos()` 显式按 `(date, file)` 倒序。
`date` 的回退链里已有 `prev_dates`（**直接来自已提交的 manifest**），因此对已入馆照片完全环境无关；
新入馆照片在首次 CI 跑完后也会被 `prev_dates` 钉住。

**验证**：新序首项 = `mmexport1788447848472` = 提交版 manifest 首项 ✅；文件集合一致（18 项）✅。
**副作用（需知会）**：新序与提交版仅首项相同、其余顺序会变（date 倒序 vs 之前的文件名倒序退化），
因此**下一次 push 会由 CI 一次性重排 manifest**，之后稳定。本地与线上从此一致。
**残留**：报告原建议的 CI 守卫（重新生成后 `git diff --quiet photos/manifest.json`，顺序稳定即无 diff）未加。

### 8.4 验证结果

- `npm run lint`（ESLint + Stylelint）：**干净**
- `npx playwright test`：**19 / 19 通过**（在已校验资产来源的服务上；P1-6 后新增 1 条）
- 红态验证：P1-1（回退 CSS → `rowGap 64 vs 52` 失败）、P1-4（回退 JS → `.card` 计数 0）均已确认
- `lhci` **本机无法运行**：Lighthouse 12.6.1 与本机 Chrome 153 不兼容，
  `FCP/LCP All Frames not implemented in lantern` → 采集阶段即失败。
  **对照实验**：把 `categories:performance` 改回 `"off"` 重跑，**失败完全相同** →
  确认是既有环境不兼容，与本次改动无关。CI 用自己的 Chrome（`ci.yml` 里 `npx playwright install`），
  该问题不在 CI 复现路径上。**因此性能阈值未经本地实测校准**，仅以 `warn` 级挂上（不会弄坏 CI）。

### 8.5 批次 2 收尾：P1-6（墙色采样移到 CI）

见 §4 明细中的 P1-6 状态块（实现 / 实测偏差 / 采样源不可复现的理由 / 两个过程坑 / 代价）。

### 8.6 收尾过程中新增的环境护栏（P2-9 同族）

P1-6 的收尾暴露了一个比预载更隐蔽的问题：**e2e 起的服务可能是降级版**。

- 现象：先出现 4 条互不相关的红（AVIF 协商、`thumbAvifSrcset`、预计算墙色、Tab 序列），
  而 4 条的根因是同一个 —— 服务返回的 manifest 只有 `src/file/title/caption/date` 五个字段。
- 根因：`playwright.config.js` 用 `python tools/serve.py`，本机 `python` 指向**托管 3.13（无 Pillow）**，
  而 `py` 指向**系统 3.12（有 Pillow）**。缺 Pillow 时 `serve.py` 按设计静默降级（不生成缩略图、不算 palette），
  manifest 仍返回 200 → 用例不是报错，而是被测对象换成了降级版，红点散落在互不相关的地方。
- 为什么之前全绿：批次 1/2 的验证里我手动用 `py` 起过服务，`reuseExistingServer` 复用了它 —— 又是同一类陷阱。
- 对策：
  1. `global-setup.js` 增加**服务能力自检**：manifest 缺 `thumbAvifSrcset` / `palette` 即中止整个运行，
     并直接给出「解释器没有 Pillow」的判断与三种处置（装 Pillow / `MILAN_PY=py` / 查实际解释器）。
  2. `playwright.config.js` 增加解释器覆盖：`MILAN_PY`（默认仍 `python`，与 CI 的 `setup-python` 一致）。
  3. `AGENTS.md` 记录该约束。

### 8.7 批次 2 仍遗留

- P1-2 的两条可行路径（见 8.2）。
- 性能阈值待有人能跑起 `lhci` 时按真实数字校准。
- P2-8 建议的 CI 守卫（`git diff --quiet photos/manifest.json`）未加。



---

## 9. 批次 3 执行记录（2026-09-26）

### 9.1 改动清单

| 文件 | 改动 | 对应项 |
|------|------|--------|
| `styles.css` | **1988 → 1770 行（−218）**：删净 19 组死选择器的规则定义，含 `@media` 内的响应式覆盖 | P2-1 |
| `app.js` | `preloadImage` 加可回收池（上限 24）+ `preloadDir` 单向预载 | P2-6 |
| `app.js` | `uploadToGitHub` → `pushPhotoToGitHub`；manifest 改循环后一次性提交；`ghPutFile` 加 409/422 重取 sha 重试 | P2-5 |
| `sw.js` | `putMedia` 的 trim 改**时间节流**（`TRIM_MS=5000`）；`VERSION` → `milan-v38` | P2-4 |
| `AGENTS.md` | 新增「CSS 只保留有消费者的选择器」（含三个易踩点）；修正「设计意图」中已过时的描述 | P2-1 |

### 9.2 P2-1 死码清理：边界重新划定（原报告判据有两处需修正）

**核对结论**（以 `index.html` + `app.js` 全文为消费者，逐个实测）：

| 对象 | 处理 | 依据 |
|------|------|------|
| 19 组死选择器的**样式定义** | **删除** | `html=0, js=0`；JS 创建的类名完整清单（`className=` / `classList.*`）中无一匹配 |
| `@layer responsive` 开头的**隐藏清单**（现 `:1350-1365`） | **保留** | 它是「无字陈列」意图的声明，且注释明示「位置敏感：本块必须留在 responsive 层的最前」 |
| `.hero-carousel-caption { display:none !important }` | **保留** | JS 仍在创建该节点（`app.js:645`），删掉会**显形** |
| `.lightbox-frame.is-lit img { animation: none }` | **保留** | 实际关掉 `.lightbox-img` 的 `lb-in` 入场动画，删掉是视觉回归 |
| `app.js` 侧死代码（`hero-carousel-caption` 创建、`lbTitle` 写入、`is-lit` 强制重排） | **保留** | 副作用为零的「保留结构」；删它属产品行为边界，收益仅个位数行 |

**原报告两处判据需修正：**

1. **`AGENTS.md` 的「`app.js` 里仍有对应文案节点」已过时。** 实测 `.hero-kicker` / `.chapter-kicker` / `.card-title` 等在 `app.js` 中**早已不存在**——「无字陈列」改造时节点已被删，只剩隐藏清单与样式残留。该段已改写。
2. **`!important` 会反转 `@layer` 优先级。** 原文把 `.filter-bar::before`（components 层）判为「被 responsive 层压死」，实际相反：两条都是 `display: none !important`，**低层胜出** → 生效的是 components 层那条。故这条**未删**（删了效果等价但收益仅 3 行）。已写入 `AGENTS.md`。

**三个新增易踩点（已写入 `AGENTS.md`）：**

- **带缩进的 `@media` 内覆盖最容易漏。** 第一轮用 `^\.selector` 锚定行首核对，漏掉了 `@media (max-width: 560px)` 里缩进两格的 `.card-meta` / `.card-title` / `.card-caption` / `.about-text` 覆盖（共 4 处 14 行）。核对一律用 `\.selector\s*\{` 且**不限行首**。
- **墓碑要连消费者一起看。** `.hero-art::after` / `.card-media::after` / `.lightbox-frame::after` 的 `content: none` 是纯 no-op（全文再无任何地方为这些伪元素定义 `content`），可删；但同一区块的 `.lightbox-frame.is-lit img` 有实效，不可删。`@keyframes frame-lit` 无人引用（`.is-lit` 是 `animation: none`），已删。
- **删 CSS 前先确认它是否被 JS 隐式依赖。**

**验证**：`styles.css` 内无残留规则定义（仅剩隐藏清单）；**全仓库**引用检查（排除 `styles.css` 自身）只剩 `AGENTS.md` 与本文档提及选择器名，无任何代码引用。

### 9.3 P2-6 preload 回收 + 单向预载

- **回收池**：`priority === "high"`（序厅首图，关键路径）永久保留；其余（卡片 hover / 灯箱相邻）进 `preloadPool`，上限 `PRELOAD_POOL_MAX = 24`，按插入序淘汰。淘汰不产生重复下载——URL 已在 HTTP 缓存，SW 也落过盘。
- **单向预载**：新增 `preloadDir`（初值 `1`），由 `step(delta)` 记录方向；`syncLightbox` 从「同时预载 ±1」改为「只预载 `preloadDir`」。原实现每次翻页都拉前后两张 100KB 级中图，而用户大量操作是单向翻页。

### 9.4 P2-4 SW 缓存裁剪：**报告建议的计数阈值在本站会失效**

报告建议改成计数阈值（`TRIM_EVERY = 24`）。实测推演后**否定**该方案，改**时间节流**：

| 方案 | 问题 |
|------|------|
| 计数阈值（报告建议） | ① 单次浏览的媒体请求约 **18 个**（18 张卡片），**永远到不了 24 的阈值** → 永不裁剪；② SW 被回收重启后计数器归零，同样可能长期不触发。两条叠加 = 缓存无上限增长 |
| **时间节流（采用）** | `lastTrimAt` 初值 `0` → SW **每次重启后第一次 put 必然裁剪一次**，不存在「永不触发」退化；赋值与判断之间无 `await`，天然并发安全 |

效果：一次加载的 trim 次数从约 **108 次**（每次全量 `cache.keys()`）降到 **1–2 次**。

**未做**：`SHELL_ASSETS` 中 `"./"` 与 `"./index.html"` 看似重复，实为两个不同的 cache key（`/` 与 `/index.html`），分别服务根路径导航与离线 fallback。删任一个都会让某条路径改为依赖 fallback 分支——**属行为路径改变而非纯优化**，收益仅 1 个缓存条目，故保留。

### 9.5 P2-5 上传批量化

| 改动 | 前 | 后 |
|------|-----|-----|
| manifest 更新 | 每张图重写整份清单（1 取 sha + 1 读内容 + 1 写 = **3 往返**） | 循环后**一次性**提交（共 3–4 往返） |
| GitHub 往返（20 张） | 约 **6N = 120 次** | 约 **2N + 4 = 44 次**（−63%） |
| 409/422 冲突 | 永久失败，用户看不出原因 | 重取一次 sha 再写 |

`uploadToGitHub` 拆为 `pushPhotoToGitHub`（只传图文件 + 返回待并入条目），清单由 `handleFiles` 在循环后统一提交。**清单失败时按整体失败计**（图片文件虽已入仓库，但线上看不到），消息明确区分。

**未做：压缩并发化。** `createImageBitmap` + canvas 确实可并行，但：① 该函数改动与 `customPhotos.push` 顺序、`setStatus` 进度提示、失败计数强耦合；② **上传流程无任何测试覆盖**（e2e 不涉及 GitHub Token 路径）。在无回归网的前提下改动状态机，风险大于收益。留待补上传测试后处理。

### 9.6 未做项与理由

**P2-3 节点复用 —— 未做。** 报告三条建议里第 1 条（「采样结果缓存在 photo 对象上，不再重复计算」）**已由 P1-6 天然完成**（manifest `palette` 直接读取，筛选切换不再重跑采样）。剩余第 2/3 条（`Map<photo.id, HTMLElement>` 复用）的真实收益是规模敏感的：当前 18 张重建成本 < 5ms，且相同 URL 的图片会命中浏览器 decoded image cache，并非「重新解码」。报告自己也定位为「馆藏到 100 张时这是最重的一次交互」。此外复用节点需一并处理随索引变化的字段（`displayTitle(photo, i)` 的标题、`aria-label`、`is-feature`），改动面比预估大且无专项测试网。**触发条件：馆藏接近 100 张时再做。**

**P2-2 ESM 拆分 —— 未做。** 需要先决策两件事：① **测试框架**（建议用 Node 内置 `node --test`，零新依赖，契合「应用零依赖」约束）；② `index.html` 改 `<script type="module">` 后 `sw.js` 的 `SHELL_ASSETS` / `isShellRequest` 需同步。这是**独立一批**的结构改动，不宜与其他项混在同一批验证里。报告建议的节奏（先 `palette.js` + `filter.js`）仍然成立，但注意 `renderFilters` / `applyFilter` 依赖 `activeFilter` / `visible` / `renderGallery`，抽取需回调注入或状态提升——只有 `ymKey` / `ymLabel` / `collectFilters` / `displayTitle` / `wallNumber` / `applyRowFit` 是无状态纯函数。

**P2-7 原图归一化 —— 未做（破坏性，须先确认）。** 涉及对已入库 18 张原图（74MB）的改写，或改 LFS / 独立分支，都会改写仓库历史与 CI 链路。**必须由用户选定方案后再执行。**

### 9.7 验证结果

- `npm run lint`：**干净**（含 stylelint）
- `npx playwright test`：**19 / 19 通过**（单 worker，`MILAN_PY=py`）
- **实机渲染目检**：1280×900 与 390×844 两档截图确认序厅金框、馆名、箭头、分页点、移动端箭头隐藏均正常，无破版
- 死码清理的确定性证据：全仓库引用检查为空（除文档）
- `sw.js` `VERSION` → **`milan-v38`**（本批改了 `styles.css` / `app.js` / `sw.js`，一并覆盖）
- 清理了工作区全部临时文件

---

## 10. P2-2 第一步：纯函数抽为原生 ESM + 单测层（2026-09-26）

### 10.1 为什么分步做

报告 §9.6 指出：`app.js` 是 1900+ 行单作用域 IIFE，`folderPhotos / visible / activeFilter / lbPos / roomEpoch / preloadDir` 等 20+ 个可变状态散落顶部，任何函数都可能读到中间态 —— 这是**没有单元测试的直接原因**。

拆分的障碍不是「拆不动」，而是**没有回归网**。所以第一步的目标不是拆完，而是**把链路验证通并建立测试层**：抽无状态纯函数 → 跑通「原生 ESM 加载 + SW 预缓存 + `node --test`」→ 后续每拆一个功能域都有地方写测试。

### 10.2 改动清单

| 文件 | 改动 |
|------|------|
| `src/util.js` | **新增**：16 个纯函数（`pad` / `uid` / `safeDecode` / `looksLikeFileTitle` / `displayTitle` / `wallNumber` / `toLocalDate` / `ymKey` / `ymLabel` / `baseFileName` / `collectFilters` / `stripExt` / `safeFileName` / `heroSrc` / `lightboxSrc` / `lightboxAvifOrFallback`） |
| `src/package.json` | **新增**：`{"type":"module"}` —— 只给 Node 看的 ESM 身份声明 |
| `tests/unit/util.test.mjs` | **新增**：16 条断言（正常路径 + 边界） |
| `tests/unit/sw-assets.test.mjs` | **新增**：3 条 SW 壳层契约断言 |
| `app.js` | 顶部加 14 项 `import`；删掉对应本地定义（**−约 120 行**） |
| `index.html` | `<script src="app.js" defer>` → `<script type="module" src="app.js">` |
| `sw.js` | `SHELL_ASSETS` 加 `./src/util.js`；`isShellRequest()` 加 `path.includes("/src/")` |
| `eslint.config.mjs` | `app.js` 的 `sourceType` → `module`；新增 `src/**/*.js` 规则 |
| `package.json` | 加 `"test:unit": "node --test"` |
| `AGENTS.md` | 新增「src/ 模块的三条约束」；命令段补 `test:unit`；补三个测试坑 |

### 10.3 三个设计决策

**① `src/package.json` 定点声明 ESM，不动根 `package.json`。**
根 `package.json` 没有 `type`，所以 `playwright.config.js` 能用 `require`（CJS）。若给根加 `"type":"module"`，就得连带把 `playwright.config.js` 改成 `.mjs` 并重写语法 —— 为一个 `src/` 目录改造整个工具链不划算。在 `src/` 下放一份 `{"type":"module"}` 即可让 Node 把 `src/*.js` 当 ESM，而浏览器**不读**这个文件。

**② `app.js` 改 `type="module"` 不改变首屏时序。**
模块脚本默认就是 defer 语义，与原 `<script defer>` 一致；脚本仍在 `</body>` 前，DOM 已解析完。e2e「首页渲染 18 张卡片」「骨架屏一致性」两条直接验证了这一点。

**③ 单测用 Node 内置 test runner，零新增依赖。**
`node --test`（Node 22 内置）+ `node:assert/strict`，不引 vitest/jest —— 契合本项目「应用零依赖」的一贯约束。`package.json` 的 devDependencies 未增加任何条目。

### 10.4 `src/` 的三条约束（已写入 AGENTS.md）

1. **零副作用** —— import 时不得触碰 DOM / `window` / `localStorage`。碰了的话 Node 端 import 直接抛错，单测加载不起来。这是 `util.js` 只装纯函数的唯一原因。
2. **同步 `SHELL_ASSETS`** —— 模块加载失败会**连坐** `app.js`（import 不进来就整个不执行），症状是**离线时停在骨架屏**。
3. **`src/package.json` 不要动。**

### 10.5 关键教训：一条 e2e 断言被红态验证抓出「假绿」

原计划在 e2e 里断言「SW install 期已缓存 `src/util.js`」，并**做了红态验证**（临时把该模块从 `SHELL_ASSETS` 移除，确认断言会红）—— 结果它**没有红，反而通过了**。

用探针查明（决定性）：

| 测法 | 结果 |
|------|------|
| 缓存快照 | `milan-v38-shell` 只有 `/`,`/index.html`,`/styles.css`,`/app.js`,`/manifest.webmanifest`,`/photos/manifest.json`,`/assets/fonts/milan-serif.woff2` —— **确认没有 `/src/util.js`** |
| `page.evaluate` 单次求值同一查询 | **`MISS`**（正确） |
| 同一个 pageFunction 包进 `page.waitForFunction` | **29ms 就判 `true`**（错误） |

即：**`page.waitForFunction` 里包 async 回调会假绿**。原断言是**空断言**，若不做红态验证就会以「绿」的身份进入仓库，永久失去防护意义。

**处置**：删掉这条 e2e 断言，把契约检查**移到单测层** —— 新增 `tests/unit/sw-assets.test.mjs`，直接读 `sw.js` 源码解析 `SHELL_ASSETS`，并枚举 `src/` 下的实际 `.js` 文件逐一比对。理由：契约本质是「清单是否覆盖实际文件」，枚举文件系统即可判定，不需要浏览器，也不受 SW 生命周期时序影响。**红态验证重做：移除模块后该单测如期失败**，并给出可读原因。

> 记住这条规则：**新断言一律做一次红态验证**（临时破坏被测条件，确认它真的会红）。它比断言本身更能防止「假绿」。

### 10.6 另一处被单测纠正的认知

`safeFileName({})` 的返回是 `…-photo`（**无扩展名**），不是直觉上的 `…-photo.jpg`：因为 `(file.name || "photo")` 已经兜了底，`|| "photo.jpg"` 那层只在 base 被字符清洗**清空**时才生效。原实现如此，测试按既有语义钉住（`{name:"###"}` 才走 `photo.jpg` 兜底）。这类「读代码看不出来、写测试才暴露」的细节，正是补测试层的收益。

### 10.7 验证结果

- `npm run test:unit`：**19 / 19 通过**（16 条纯函数 + 3 条 SW 契约），耗时约 0.6s
- **红态验证**：`tests/unit/sw-assets.test.mjs` 在临时移除 `src/util.js` 后**如期失败**，报错信息准确
- `npm run lint`：**干净**（含新模块与 `.mjs` 测试的规则覆盖）
- `npx playwright test`：**19 / 19 通过**（单 worker，`MILAN_PY=py`）—— 含「SW 离线仍可服务」，证明 ESM 模块加载与预缓存链路完好
- `package.json` devDependencies **未新增任何依赖**

### 10.8 待续

`app.js` 仍是 1900+ 行 IIFE。剩余功能域拆分（`hero` / `gallery` / `lightbox` / `upload`）的共同障碍是**依赖闭包状态**：`renderFilters` / `applyFilter` 依赖 `activeFilter` / `visible` / `renderGallery`，`renderGallery` 依赖 `photos` / `visible` / `gallery`。拆它们需要先做**状态注入或状态提升**（例如把 `photos/visible/activeFilter` 收进一个小 store 模块，各域通过 `import` 读写）。

建议下一步优先拆 **`lightbox.js`**：它的状态（`lbPos` / `lbZoom` / `lbTx` / `lbTy` / `preloadDir`）**自成一域**，与 gallery/filter 的耦合最小，且已有 5 条 e2e 覆盖（开合 / 深链 / 手势 / 缩放 / 桌面箭头），回归网最厚。

---

## 11. P2-2 第二步：lightbox 域拆为 `src/lightbox.js`（2026-09-26）

### 11.1 为什么第二个拆 lightbox

按 §10.8 的判断执行。选定依据（勘察后仍成立）：

| 判据 | lightbox | hero | gallery / filter | upload |
|------|----------|------|------------------|--------|
| 状态是否自成一域 | ✅ 14 个可变绑定全归属本域 | ⚠️ 8 个，但被 `rebuildPhotos` 反复重建 | ❌ `activeFilter` / `visible` 是全局中枢 | ⚠️ 与压缩队列耦合 |
| 跨域依赖面 | 6 类（可枚举） | hero + gallery + 墙色 | 全网 | GitHub API + IndexedDB |
| 现有回归网 | ✅ 5 条 e2e | 1 条 | 4 条 | ❌ **0 条**（e2e 不涉 Token 路径） |

upload 的回归网为零，拆它风险最高；gallery/filter 要先做状态提升（收益大但改动面也大）；lightbox 是**唯一「状态内聚 + 回归网厚」的域**。

### 11.2 改动清单

| 文件 | 改动 | 行数 |
|------|------|------|
| `src/lightbox.js` | **新增**。工厂 `createLightbox(ports)` + 4 个具名导出的纯数学 | +514 |
| `app.js` | 删 14 个模块级可变绑定、6 个灯箱 DOM const、13 个函数、约 180 行手势绑定；新增 1 处 28 行装配 | 现 **1478**（报告基线 1808，差额含批次 1–3 的其他改动） |
| `sw.js` | `SHELL_ASSETS` 加 `./src/lightbox.js`；`VERSION` v38 → **v39** | +1 |
| `tests/unit/lightbox.test.mjs` | **新增**，8 条纯数学断言 | +93 |
| `AGENTS.md` | 「src/ 三条约束」第 1 条补上**工厂 + 端口注入**范式 | — |
| `app.js` import | 移除已迁走的 `lightboxSrc`（迁走后无消费者，lint 会红） | −1 |

> 本步的「净减行数」**不单独归因**：批次 1–3 的改动尚未提交，`git diff` 会把它们计入，无法从现状反推本步的精确差额。可核验的只有现状（1478 行）与本步的迁移清单（下表）。

搬走的东西（`app.js` 侧已归零）：

- **状态 14 个**：`lbPos` / `preloadDir` / `lbReturnFocus` / `lbList` / `lbZoom` / `lbTx` / `lbTy` / `tapTimer` / `swipeX` / `swipeY` / `lbDidSwipe` / `lbPointers` / `pinch` / `panBase`
- **DOM 引用 6 个**：`lbImg` / `lbSource` / `lbTitle` / `prevBtn` / `nextBtn` / `closeBtn`
- **函数 13 个**：`lightboxPhotos` / `applyLbTransform` / `resetLbZoom` / `clampLbPan` / `anchorRel` / `zoomAtAnchor` / `toggleLbZoomAt` / `cardImageAt` / `openLightbox` / `closeLightbox` / `preloadLightboxNeighbor` / `syncLightbox` / `step`
- **事件监听 9 处**：箭头 ×2 / 关闭 / 指针 down·move·up·cancel / click / dblclick / wheel / `<dialog>` cancel / 文档 keydown

`lightbox`（`<dialog>` 本体）**刻意留在 `app.js`**：墙色注入（`applyRoomToLightbox`）与 `hashchange` 都要读它。

### 11.3 拆分形态：为什么是「工厂 + 端口注入」

三个候选，逐个评估后只留下 B：

| 方案 | 内容 | 结论 |
|------|------|------|
| A. 纯逻辑模块 + 参数化函数 | 每个函数把 `zoom/tx/ty/rect` 全做成入参 | ❌ **等于没拆**：状态仍留在宿主的 `let` 里，只是函数搬了家；且 `zoomAtAnchor` 这类会变成 6 个参数、调用点全是长参数列 |
| **B. 工厂 + 端口注入** | `createLightbox(ports)` 返回 `{ open, isOpen }`，状态收进闭包 | ✅ **采用** |
| C. 模块级单例 | 顶部 `document.getElementById(...)`，直接导出 `open()` | ❌ **违反 `src/` 零副作用约束**（AGENTS.md 第 1 条）：Node 端 `import` 直接抛错，单测一条都加载不起来 |

B 的两个直接收益：① `app.js` 侧**再也写不出**「在灯箱开着时改 `lbPos`」这种跨域穿透（绑定已不在作用域内）；② 纯数学能单独导出给单测（`clampPan` / `anchorRel` / `anchorZoom` / `pinchZoom`）。

### 11.4 端口清单：6 类跨域能力

模块**不**反向 import `app.js`，只 import `./util.js`（纯函数叶子，无环），跨域能力全部注入：

| 端口 | 用途 | 为什么不能内联 |
|------|------|----------------|
| `on` | 绑定守卫（元素缺失静默降级） | 宿主统一约定；`#prev` 等缺失时不能抛 TypeError |
| `getList` | `() => visible` | 当前筛选序列是 app 态 |
| `cardImageAt` | 视图过渡配对：找展厅第 index 张卡片的 `<img>` | 依赖 gallery DOM 与卡片序 |
| `preload` | `rel=preload` 图片预载（含回收池） | 回收池是 gallery/hero 共用的资源管理 |
| `applyRoom` / `sampleRoom` | 墙色写 CSS 变量 / 无 palette 时的兜底采样 | 墙色域，hero 也共用 |
| `setHash` / `filterHash` | `#p=` 深链读写 | hash 域，`#f=` 与 `<dialog>` 共用 |
| `prefersVT` / `startVT` | 视图过渡（含三 promise 全接住） | 全站共用，复制一份必然分叉 |

`close` **刻意不从返回值导出**：关闭路径只有三条（关闭按钮 / Esc cancel / 无），全在域内闭环，外部没有调用点 —— 导出即死代码。

### 11.5 装配点必须放在文件顶部（TDZ 陷阱）

`createLightbox({...})` 放在 `app.js` 顶部（`on` 定义之后），**不能**放在原先绑定所在的文件尾部。原因：工厂调用即读 `.lightbox-stage` 并注册监听，而 `openLightboxFromHash`（定义在中部）要调 `lb.open()` —— 若 `const lb` 留在尾部，`hashchange` 在首屏触发时会撞 `const` 的 **TDZ**（`Cannot access 'lb' before initialization`），而这条路径只在「带 `#p=` 直接打开」时才走，冒烟测试很可能漏掉。

安全性依据：注入的要么是**函数声明**（`sampleRoomColor` / `applyRoomToLightbox` / `setHash` / `currentFilterHash` / `prefersViewTransitions` / `startVT` / `preloadImage`，全部提升），要么是**箭头**（`getList` / `cardImageAt`，惰性求值），无初始化顺序问题。

### 11.6 验证结果

| 项 | 结果 |
|----|------|
| `npm run lint` | **干净**（含 `src/**/*.js` 规则块与 `.mjs` 测试） |
| `npm run test:unit` | **27 / 27**（19 → 27，新增 8 条） |
| `npx playwright test` | **19 / 19**（`MILAN_PY=py`）—— 含「SW 离线仍可服务」，证明模块预缓存链路完好 |
| 红态验证 | 5 个探针全部如期打红（见下） |
| 实机缩放探针 | 见 11.7 |
| 临时文件 | 探针与 `test-results/` 已清理，`git status` 无残留 |

**红态验证（本会话确立的规则：新断言一律做一次红态验证）** —— 5 个探针逐一确认断言非空：

| 探针 | 破坏方式 | 结果 |
|------|----------|------|
| ① `clampPan` 平移上限 | `maxX = (w*(zoom-1))/2` → `1e9` | ✅ 如期红 |
| ② `anchorZoom` 锚点不变性 | `k = 1 - z/state.zoom` → `k = 0` | ✅ 如期红 |
| ③ `anchorZoom` 缩放上限 | 去掉 `Math.min(MAX_ZOOM, …)` | ✅ 如期红 |
| ④ `pinchZoom` 中点守恒 | 去掉 `-(z/z0)*(mx0-cx0)` 补偿项 | ✅ 如期红 |
| ⑤ `MAX_ZOOM` 常量本身 | `4` → `8` | ❌ **未红** —— 但这是**预期的** |

⑤ 的结论值得记下：`MAX_ZOOM` 相关的两条断言是**符号断言**（写的是 `expect(z).toBe(MAX_ZOOM)`，引用常量本身），破常量不会红；只有去掉「应用这个上限」的代码才会红（探针 ③ 已覆盖）。**符号断言 + 行为探针的组合才是完整的**，单靠破常量会误判为「断言有效」。

**实机缩放探针**（e2e 未覆盖的三条路径：双击 / 滚轮 / 缩放态平移）：

| 操作 | 期望 | 实测 |
|------|------|------|
| 双击画心 | 2.5× | `zoom=2.5`，`is-zoomed` ✅ |
| 缩放态拖拽 900px 后松手 | 钳到溢出半幅 `(w·(z−1)/2, h·(z−1)/2)` | `tx=366`（= 488×1.5/2）、`ty=487.5`（= 650×1.5/2）—— **精确命中** |
| 拖拽过程中 | 不钳制（贴边手感） | `is-panning` ✅，位移未被截断 |
| 滚轮上滚 1 档 | 1.18× | `zoom=1.18` ✅ |
| 滚轮下滚 6 档 | 回到 1×，位移归零 | `zoom=1, tx=0, ty=0, is-zoomed=false` ✅ |
| 1× 时继续下滚 | no-op（不产生 <1 无效缩放） | 仍为 1 ✅ |
| 连续上滚 9 档 | 钳在 4× | `zoom=4` ✅ |
| 关闭后重开 | 复位 1× | `zoom=1, tx=0, ty=0` ✅ |

拖拽钳制的精确命中（366 / 487.5 与公式完全一致）是本次搬迁保真度最强的证据 —— 它同时穿过 `anchorRel` → `anchorZoom` → `clampPan` → `applyTransform` 整条链路。

### 11.7 探针附带发现：双击缩放只能进不能出（既有缺陷，**未修**）

| 项 | 内容 |
|----|------|
| 现象 | 已在 1.643× 时双击画心 → 变成 **2.5×**（而非回到 1×） |
| 决定性证据 | `双击前 zoom=1.6430 → 双击后 zoom=2.5；同一张画=true` |
| 根因 | `click` 处理器**每次都先** `step(±1)`，而 `step → sync → resetZoom(false)` 必然把 `zoom` 打回 1。于是 `toggleLbZoomAt` 里 `if (zoom > 1) { resetZoom(false); return; }` 这半边**永远不可达** —— 双击只能进不能出 |
| 是否本次引入 | **否**。`git show HEAD:app.js` 核对：`toggleLbZoomAt`（HEAD:428）与 click 处理器（HEAD:1723）结构完全一致 |
| 影响面 | 触屏用户双击放大后**无法双击缩回**；出路只有双指捏合（`gestureEnd` → `zoom < 1.05` → `resetZoom`）或关闭重开。桌面端可用滚轮下滚复位，不痛 |
| 处置 | **已修**，走 brainstorming 流程定方案 —— 见 §12（勘察中还发现同根的第二处缺陷「手慢双击跳过两张」，用户确认一并修） |

### 11.8 待续

`app.js` 1477 行。剩余域及各自的前置条件：

| 域 | 前置条件 | 建议顺序 |
|----|----------|----------|
| `hero.js` | hero 有 8 个绑定但被 `rebuildPhotos` 重建，需先定「重建 vs 复用」 | 2 |
| `gallery.js` / `filter.js` | **必须先做状态提升**（`photos` / `visible` / `activeFilter` 收进小 store 模块），否则每拆一个域就要多注入 3 个端口 | 3 |
| `upload.js` | **先补上传路径测试**（当前 0 覆盖，改状态机风险最大） | 4（最后） |

**建议下一步：`upload.js` 之前先补它的测试** —— 它是唯一「改坏了不会被任何现有测试发现」的域，而 P2-5 的压缩并发化（报告原建议）就卡在这里。

---

## 12. 灯箱点击 / 缩放手势重设计（2026-09-26）

完整设计文档：`research/milan-museum-design/2026-09-26-lightbox-tap-zoom-design.md`（经 brainstorming 流程，两轮方向确认）。

### 12.1 起因

§11.7 的既有缺陷「双击缩放只能进不能出」。勘察中又发现**同根**的第二处缺陷：

> `tapTimer` 的固定 450ms 与浏览器双击窗口（系统可设 200–900ms，默认 500）不对齐。落在灰区时 click#1 前进一张、click#2（tapTimer 已过期）再前进一张，随后 dblclick 又放大 —— **用户只想放大，却跳过了两张画**。

两处同根：都源于**用固定时长计时器模拟浏览器的双击判定**。用户确认一并修。

### 12.2 被否决的方案

| 方案 | 否决理由 |
|------|----------|
| 用 `e.detail`（浏览器原生连击计数） | **实测否掉**。`mouse.dblclick()` → `click#1,click#2,dblclick#2`；两次 `mouse.click`（间隔 200ms，同属「应判双击」范围）→ `click#1,click#1`。差别不在时间而在 Playwright API（`dblclick()` 显式传 `clickCount:2`）。即该值**由 API 参数决定而非时序** → 本项目唯一交互回归网（e2e）**无法验证**基于它的逻辑 |
| 延迟切图（单击等 ~300ms 确认非双击再切） | 一次消除闪烁与全部连击判定，但 1× 态每次单击都引入可感知延迟（连翻 10 张累积数秒）。用户明确排除 |
| 单纯把 450ms 拉长 | 覆盖不到系统窗口上界 900ms，且窗口越长「快速连点翻页」被合并的区间越大。治标 |

### 12.3 采用方案：`dblclick` 权威裁决 + 组起点绝对回退

不再猜「这是不是双击」，而是**由浏览器 `dblclick` 事件权威裁决**；我们自己只记住「这一组点击从哪个位置开始」，回退取**绝对位置**而非相对步数。

```
GROUP_MS = 1000

click:
  if (didSwipe) { didSwipe = false; return }
  sameGroup = groupKind !== "" && now - groupAt < GROUP_MS ;  groupAt = now
  if (zoom > 1) {                                   // 放大态：本击 = 缩回
    if (!sameGroup) { groupKind = "out"; groupStart = pos }
    resetZoom(false); return
  }
  if (!sameGroup) { groupKind = "adv"; groupStart = pos }
  else if (groupKind === "out") return              // 缩回组的余波，吞掉
  moveBy(1)                                         // 1× 态：乐观切图（保留瞬时反馈）

dblclick:
  wasOut = groupKind === "out" ;  back = groupStart ;  resetGroup()
  if (pos !== back) { pos = back; sync() }          // 权威回退：绝对位置
  if (!wasOut) toggleZoomAt(...)                    // 缩回组不再缩放
```

三条要点：

1. **`groupKind` 只能在新组的第一击设定**，第二击不得改写 —— 否则「放大态双击」的第二击会把它从 `out` 改成 `adv`，第 ④ 步又去放大。
2. **回退取绝对位置是根治点**：`step(-1)`（相对）换成 `pos = back`（绝对），不管浏览器何时认定双击，结果一致。
3. **`GROUP_MS` 取 1000ms（长于系统窗口上界）而无副作用** —— 它只用于「记不记得起点」，不用于「判不判定双击」。没有 `dblclick` 时起点信息不产生任何效果。这是与旧 `tapTimer` 最本质的区别：**窗口错配的后果从「多切一张」降级为「起点被提前重置」**。

顺带实现了 `styles.css` 早已声明的意图 —— `.lightbox-img.is-zoomed { cursor: zoom-out }`（放大态指针语义就是「点了缩小」），此前那个 `if (zoom > 1)` 分支永不可达。

### 12.4 改动清单

| 文件 | 改动 |
|------|------|
| `src/lightbox.js` | 替换 `click` / `dblclick` 两个处理器；新增连击组状态（`GROUP_MS` / `groupAt` / `groupStart` / `groupKind` / `resetGroup()`）；`step` 拆为 `step`（显式翻页，先 `resetGroup`）+ `moveBy`（纯位移）；`open` / `close` 各加 `resetGroup()`；**删除 `tapTimer`** |
| `sw.js` | `VERSION` v39 → **v40** |
| `tests/e2e/smoke.spec.js` | +5 条（T1–T4 桌面 + 1 条触屏），19 → **24** |
| `AGENTS.md` | 新增「灯箱点击手势契约」（含「不要用 `e.detail`」「`step` 必须 `resetGroup`」两条禁令） |

`styles.css` 未改。

### 12.5 验证结果：TDD 红 → 绿

**红灯基线（修复前实测，3 红 1 绿 —— 与设计文档 §6 逐条吻合）**

| 测试 | 修复前 | 失败点（预测 vs 实测） |
|------|--------|------------------------|
| T1 放大态单击缩回 1× 且不切图 | ✗ 红 | hash 变成下一张（旧实现切了图）✅ 与预测一致 |
| T2 放大态双击只缩回一次 | ✗ 红 | `zoom` = 2.5 而非 1 ✅ |
| T3 手慢双击不跳两张 | ✗ 红 | hash 停在第 3 张而非第 1 张 ✅ |
| T4 连击组不跨路径泄漏 | ✓ 绿 | 与「护栏」定位一致 ✅ |

> T1–T3 的红灯基线**本身就是最强形式的红态验证**：被破坏的不是我造的假条件，而是修复前的真实实现。

**护栏红态验证（T4）**：临时移除 `step()` 里的 `resetGroup()` → 如期红，`Received` 回到了更早的照片（正是「一次性倒回好几张」）。恢复后绿。

**触屏用例红态验证**：临时把放大态单击改回 `moveBy(1)` → 如期红（`Received` 变成下一张）。恢复后绿。

**最终结果**

| 项 | 结果 |
|----|------|
| `npm run lint` | 干净 |
| `npm run test:unit` | **27 / 27** |
| `npx playwright test` | **24 / 24**（19 → 24） |
| 触屏覆盖 | `test.use({ hasTouch: true })` 独立 describe —— 触屏是本次修复的**主场景**（移动端没有滚轮），必须单独覆盖 |
| 临时文件 | 探针与 `test-results/` 已清理 |

### 12.6 本次未处理（各有明确理由）

| 项 | 说明 |
|----|------|
| 双击时的**画面闪烁**（click#1 已 `moveBy(1)`，dblclick 再回退，中间闪一下下一张） | 用户明确排除（消除它必须改成延迟切图）。是否肉眼可见取决于目标图是否命中缓存 |
| 放大态**拖拽平移后**的第一次单击被 `didSwipe` 吞掉（想缩回要点两次） | 既有行为，本次不动。属 `didSwipe` 与 click 的既有约定 |
| 「快速连点两次想翻两张」会被合并为「原地 + 放大」 | 手势冲突的本质：单击切图与双击缩放共用同一目标，二者本就不可区分。改动前同样如此，非回归 |
| 放大态单击**墙面区域**（非画心）同样缩回，但墙面光标仍是默认箭头 | 与「画心给 `zoom-out` 提示」不一致。修它要新增 CSS（`.lightbox-stage.is-zoomed`），价值不足，未做 |
