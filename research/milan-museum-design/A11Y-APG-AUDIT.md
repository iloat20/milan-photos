# APG 无障碍对照审计 — 米兰美术馆

> 2026-09-19 · 只读审计，未改代码 · 对照：W3C APG Dialog (Modal) / Carousel · WCAG 2.2 Understanding（研究引用见 `REPORT.md`）

## 范围

| 模块 | 代码入口 |
|------|----------|
| 灯箱观画室 | `index.html` `#lightbox`；`app.js` `openLightbox` / `closeLightbox` / `syncLightbox` / `keydown` |
| 序厅轮播 | `index.html` `.hero-carousel`；`app.js` `renderHeroCarousel` / `startHeroAuto` / `setHeroIndex` |
| 展厅卡片 | `app.js` `renderGallery` |
| 动效偏好 | `app.js` `reduceMotion` + `styles.css` `@media (prefers-reduced-motion)` |

---

## 1. 灯箱 — APG Modal Dialog

| APG / 规范点 | 现状 | 判定 |
|--------------|------|------|
| `role="dialog"` | `index.html:98` 已有 | 通过 |
| 可访问名称 | `aria-label="观画室"` | 通过 |
| 打开时焦点进入对话框 | `closeBtn.focus()`（`app.js:582`） | 通过 |
| Esc 关闭 | `document.keydown` → `closeLightbox`（`app.js:1131–1133`） | 通过 |
| 关闭后焦点回到触发元素 | `sourceImg.closest('.card').focus()`（`app.js:587–588`） | 部分通过（见下） |
| Tab 焦点陷阱 | **未实现**（无 Tab 键处理，无 `inert`/`aria-hidden` 作用于背景） | **未通过** |
| `aria-modal="true"` 仅在真模态时使用（拦截交互 + 视觉遮挡） | 已设 `aria-modal="true"`；`body.lb-open { overflow:hidden; touch-action:none }` + 全屏 fixed 遮罩在视觉/滚轮上接近模态，但**键盘仍可 Tab 到页外控件** | **声明过强 / 部分模态** |
| 对话框内图有意义替代 | `syncLightbox` 设 `lbImg.alt = displayTitle(...)`；`#lbTitle` 文本被清空且 CSS 隐藏 | 视觉无字 + alt 有字，通过（结构策略合理） |

### 灯箱缺口说明

1. **焦点陷阱缺失（高）**  
   APG 要求模态对话框内 Tab/Shift+Tab 不离开对话框。当前仅打开时 `focus(close)`，之后 Tab 可落到顶栏/展厅等背景节点，与 `aria-modal="true"` 不符，屏幕阅读器用户可能「进入」仍暴露的背景内容。

2. **`aria-modal` 与真实模态不一致（高）**  
   APG：仅当「应用阻止与外部一切交互」**且**「视觉样式遮挡外部内容」时才标 modal。当前视觉遮挡充分，交互拦截不完整（无焦点陷阱、无背景 `inert`）。修复二选一：  
   - 补齐焦点陷阱（+ 可选 `inert` 主内容）后保留 `aria-modal="true"`；或  
   - 在未做陷阱前改为非 modal 对话框语义（一般不推荐半吊子）。

3. **从轮播打开时的焦点归还（中）**  
   `openLightbox` 可由 hero slide 的 click 调用，但关闭时 `cardImageAt(lbPos)` 只还焦点到**展厅 `.card`**，不会回到被点击的轮播 slide。slide 本身不是可聚焦控件（见轮播节），键盘用户从 hero 进灯箱后焦点落点可能不符合「回到调用者」。

4. **键盘浏览灯箱（低，可算增强）**  
   左右方向键切换已有；无 roving 需求。箭头按钮有 `aria-label`，通过。

---

## 2. 序厅轮播 — APG Carousel

| APG / 规范点 | 现状 | 判定 |
|--------------|------|------|
| 轮播容器 `aria-roledescription="carousel"` + 名称 | `index.html:25` `aria-label="重点陈列"` | 通过 |
| slide：`aria-roledescription="slide"` + 可访问名 | `role="group"` + `aria-label`「i / n」（`app.js:320–322`） | 通过 |
| 上一张/下一张控件 | `#heroPrev` / `#heroNext` 均有 `aria-label` | 通过 |
| 自动旋转时提供 **停止/重启按钮** | **无** pause/play 控件 | **未通过** |
| 键盘焦点进入轮播时 **停止旋转** | 无 focusin/focus 处理；仅 `pointerdown` 调 `stopHeroAuto` | **未通过** |
| 鼠标悬停时 **停止旋转** | 无 `pointerenter`/`mouseenter` 暂停 | **未通过** |
| 页面隐藏时暂停 | `visibilitychange` → stop/start（`app.js:422–425`） | 通过 |
| 尊重 `prefers-reduced-motion` 时不自动旋转 | `startHeroAuto` 在 `reduceMotion` 时 return（`app.js:278`） | 通过 |
| 旋转指示/位置（dots） | `role="tablist"` + `role="tab"` + `aria-selected` | 部分：有选中态，但**非完整 tab 模式**（无 `tablist` 关联的 `tabpanel`；APG Carousel 常用组内按钮/旋转开关，dots 不能替代暂停控件） |
| 幻灯内容文本替代 | hero `img.alt = ""`；caption `h2` `textContent=""` 且样式隐藏 | **缺口**：重点陈列图对 AT 仅暴露「第 n 张」数字名，无作品可访问名（展厅卡片则有 `alt` + `aria-label`） |
| 用键盘操作 slide 本身打开灯箱 | slide 为 `div` click，不可聚焦、无 role=button | 中：主要依赖 arrows/dots；hero 路径键盘可达性弱 |

### 轮播缺口说明

1. **自动旋转三件套缺失（高）** — APG 明确要求：可停可启的按钮；焦点进入即停；悬停即停。当前 4.2s 间隔自动轮换在 `reduceMotion=false` 时持续进行，仅指针按下与页面隐藏会停。  
2. **`prefers-reduced-motion` 已做对** — 作为 WCAG 2.3.3 / MDN Baseline 的相关项，此条是合规亮点，应保留。  
3. **hero 图 `alt=""`（中）** — 若重点陈列承担展示职责，空 alt 使内容对读屏不可见；宜与卡片一致使用 `displayTitle`，或声明整块轮播对 AT 仅作装饰并把浏览主路径留给展厅（需产品决策）。  
4. **dots 的 tablist 语义（低–中）** — 缺 tabpanel 关联，可能造成错误期望；可改为普通按钮组 + 清晰名称，或按 APG Carousel 补齐旋转控件后弱化 dots 角色。

---

## 3. 展厅卡片与过滤条（附带）

| 项 | 现状 | 判定 |
|----|------|------|
| 卡片可聚焦与名称 | `button.card` + `aria-label="观展：{title}"` + `img.alt=titleText` | 通过 |
| 动图角标 | `aria-hidden="true"` | 通过 |
| 筛选 | `role="toolbar"` + `aria-pressed` | 可接受；非 APG 强制项 |
| 画廊 `aria-live="polite"` | `#galleryGrid` | 需注意：整格 live 在大量重绘时可能过吵；非 APG 灯箱/轮播项，记为观察项 |

---

## 4. 动效与其他

| 项 | 现状 | 判定 |
|----|------|------|
| JS 读取 `prefers-reduced-motion` | `app.js:12` + `matchMedia` change | 通过 |
| CSS reduce 下关闭动画 | `styles.css` 末段 reduce 块 | 通过 |
| View Transitions 在 reduce 下跳过 | `prefersViewTransitions()` 含 `!reduceMotion` | 通过 |
| 灯箱打开时背景滚动锁定 | `body.lb-open` | 辅助项，通过 |
| 隐藏墙签的等价文本 | DOM 仍有 title/alt 路径（CSS `display:none`） | 与 W3C alt 决策树方向一致；**不要**删掉 alt/aria-label |

---

## 5. 优先级汇总（仅结论，不改代码）

| 优先级 | 问题 | 位置 | 依据 |
|--------|------|------|------|
| P0 | 灯箱无焦点陷阱，却标了 `aria-modal="true"` | `app.js` lightbox / `index.html:98` | APG Dialog (Modal) |
| P0 | 自动轮播无暂停按钮；焦点/悬停不暂停 | `app.js` hero + `index.html` hero | APG Carousel |
| P1 | Hero 作品图 `alt=""`，AT 无作品名 | `app.js:325–326` | W3C alt；与展厅卡片不一致 |
| P1 | Hero 打开灯箱后关闭，焦点不回到调用 slide | `closeLightbox` / `cardImageAt` | APG：焦点返回调用者 |
| P2 | Dots 使用 tablist 但无完整 tab 关系 | `index.html:32` + `renderHeroCarousel` | ARIA 模式一致性 |
| P2 | Slide 非键盘可操作打开灯箱 | hero slide `div` + click | 仅作浏览增强时可接受 |
| 通过 | Esc、关闭按钮、灯箱 alt、卡片 aria、reduce-motion、SW 契约外的工程项 | — | 保持 |

---

## 6. 建议修复方向（供下一步实现，本次未改）

1. **灯箱**：打开时 `focus(close)` 后对 `.lightbox` 内可聚焦元素做 Tab 循环；背景 `main/header/footer` 设 `inert`（或等价 aria-hidden + tabindex 管理）；保留 `aria-modal="true"`。  
2. **轮播**：增加「暂停/播放」按钮（`aria-pressed` 或 APG 示意名称）；`focusin`/`pointerenter` → `stopHeroAuto`，`focusout`/`pointerleave` 且非用户手动暂停时再 `startHeroAuto`。  
3. **Hero alt**：`img.alt = displayTitle(photo, i)`（与卡片一致）；caption 可继续视觉隐藏。  
4. **焦点归还**：记录 `openLightbox` 的调用源（card vs hero slide），关闭时 `focus` 回源；hero slide 若需作为源，给 slide 增加可聚焦的触发控件更干净。

---

## 结论

项目在 **灯箱 Esc/关闭/图 alt、卡片命名、reduced-motion、页面隐藏暂停** 上已具备良好底子；与 APG 的硬差距集中在两处：**模态灯箱的焦点陷阱（及 `aria-modal` 名实相符）**、**自动轮播的可暂停与 focus/hover 暂停**。这两项不涉及推翻油画馆视觉，属于交互契约层修补，与 `REPORT.md` 的「保留艺术指导、精修 a11y」一致。
