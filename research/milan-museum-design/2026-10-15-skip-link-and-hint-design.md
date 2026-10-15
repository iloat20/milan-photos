# U-3 灯箱手势提示 + U-4 skip-link 设计稿

日期：2026-10-15 ｜ 批次：审计 §9 的 U-3 / U-4（合并批次：同属「引导与可达性」域）｜ 前置：P-6（`07ae406`）已完成

## 0. 一句话

给键盘用户一条**从首 Tab 直落展厅**的 skip-link（U-4）；给首次打开观画室的访客一条
**一次性、自动隐去的手势提示**（U-3：桌面「← → 翻页 · 双击放大」/ 触屏「双击放大 · 双指缩放」）。

## 1. 决策摘要

| # | 决策 | 结论 | 依据 |
|---|---|---|---|
| 1 | skip-link 形态 | 原生 `<a class="skip-link" href="#gallery">`，放在 `<body>` 首个元素；**不写 JS** | `app.js` 的 hashchange 已明文「纯锚点（#gallery 等）不干预」（`app.js:453`），`#f` / `#p` 均不受影响；`scroll-padding-top`（styles.css:139）已解决固定顶栏遮挡——两条地基都已就位，零脚本面 |
| 2 | 落点与焦点 | `#gallery` 加 `tabindex="-1"`；激活后浏览器原生把 DOM 焦点移过去 | 可测判据「Enter 后 `activeElement === #gallery`」不依赖 JS；APG 跳转链惯例（落点可编程聚焦） |
| 3 | 落点轮廓 | `#gallery:focus { outline: none }` | `#gallery` 是全宽、约三屏高的整段 block，默认聚焦轮廓会是围住整段展厅的巨大方框；「页面已滚到展厅」本身就是足够的位置反馈 |
| 4 | 提示出现策略 | **一次性**：localStorage 记档；打开后约 4s 自动淡出；任一翻页 / 缩放 / 指针交互立即收起 | 「无字陈列」的克制品格不容常驻提示；每开必弹的骚扰成本高于收益。交互即收：用户已经在用了，提示的使命完成 |
| 5 | 提示落位 | `.lightbox-chrome` 的**中间子元素**（计数与关闭之间） | 唯一几何稳定的空位：画框高度随图而变、题名区高度随 caption 而变，唯有 chrome 行高度被 36px 关闭钮钉死（提示 ~34px，不改变行高）；不遮画、不对手势层构成任何风险 |
| 6 | 提示文案（util 纯函数） | fine：`← → 翻页 · 双击放大`；coarse：`双击放大 · 双指缩放` | 审计点名三个手势（箭头 / 双击 / 捏合）按指针能力二分——触屏没有键盘，桌面不谈双指；滚轮缩放不做提示（悬停即自然发现，写进去只是噪音） |
| 7 | 记档与降级（端口 `claimHint`） | app.js 内读写 `milan-lb-hint`（try/catch；不可用时**本页内存兜底**——每次加载一次） | 与 `milan-theme` / `milan-gh-sync` 同一命名与兜底风格；隐私模式退化为「本次浏览一次」，而不是每一次开图都弹 |
| 8 | 提示的无障碍 | `aria-hidden="true"` + `pointer-events: none` | 提示 4s 后消失——若可被读屏读到就构成「内容凭空消失」（躲开这一类问题的最省事形态）；读屏用户的等价能力（方向键翻页）已由既有模态契约承担。`pointer-events: none` 保证它绝不吞手势 |

## 2. 现状与缺陷

### 2.1 U-4：键盘用户的通行税

`index.html` 的 body 首个可聚焦元素是顶栏馆名（`.site-nav-logo`），之后到展厅要依次经过：
馆名 → 馆内导航 3 链接 → 主题按钮 → 序厅的上一件 / 下一件 → 8 个分页点 → 暂停钮 → 筛选栏 chip……
（`renderFilters` 的 chip 数随月份浮动）。**每次到展厅都是一次完整长征**；审计原文：
「键盘用户每次都要走完整顶栏」。

红态判据（与实现解耦）：
> **从页面头部按第一次 Tab，焦点必须落在 skip-link；Enter 后焦点必须落到 `#gallery`。**

现状下首 Tab 落点是 `.site-nav-logo`（米兰美术馆）。

### 2.2 U-3：手势不可发现

观画室支持：← →（keydown）/ 双击缩放 / 捏合缩放 / 滚轮缩放 / 横滑翻页，但画面上**没有任何提示**
（「无字陈列」把题名都收进了 hover 墙签，更不会提示手势）。新访客的发现路径全靠误打误撞：
双击是浏览器级常识、但「双击放大一张画」不是；捏合同理。审计原文：「新访客发现成本」。

红态判据：
> **首次打开灯箱：`#lbHint` 出现（带 `is-on`）且文案非空；约 4s 后自动隐去；关后重开不再出现。**
> **翻页 / 缩放交互后立即收起。**

## 3. 实施（草案）

### 3.1 `index.html`

```html
<body>
  <a class="skip-link" href="#gallery">跳到展厅</a>
  <header class="site-nav" id="siteNav"> … </header>
  …
  <section class="gallery-section chapter-room" id="gallery" tabindex="-1"> … </section>
  …
  <div class="lightbox-chrome">
    <span class="lb-count" id="lbCount" aria-hidden="true"></span>
    <p class="lb-hint" id="lbHint" aria-hidden="true"></p>
    <button class="lb-close" id="close" …> … </button>
  </div>
```

- skip-link 是 body 首个可聚焦元素（a11y 契约：跳转链必须在一切 Tab 序列之前）。
- 提示文案由 JS 写入（与 `#lbCount` 同模式：HTML 留空，避免「无 JS 时留一句常量」的漂移源）。

### 3.2 `styles.css`

- `.skip-link`（components 层，:root 相邻域）：固定定位顶居中、玻璃药丸（`--fill-strong` + backdrop blur），
  默认 `transform: translate(-50%, calc(-100% - 20px))` 移出视口上缘；`:focus` 时归位。
  过渡只动 `transform`（AGENTS.md：位移一律写进 `transform`，不用独立 `translate` 属性）。
- `#gallery:focus { outline: none }`（见决策 #3）。
- `.lb-hint`：药丸小字（13px / `--text-2` / `--fill` 底 / blur），`opacity: 0` 默认，
  `.is-on { opacity: 1 }`，`transition: opacity 0.5s var(--ease)`；
  `pointer-events: none`；`white-space: nowrap` + `overflow: hidden` + `text-overflow: ellipsis`
  （320px 极窄屏的兜底）。显示 / 收起的过渡重启用 `void offsetWidth` 重排技巧——
  与 `sync()` 里 `frame.is-lit` 的重启方式同一范式。
- reduced-motion：`.skip-link` 与 `.lb-hint` 加入既有的 `animation/transition: none !important` 清单
  （styles.css:2013 一带）——提示立即出现 / 消失，不做位移与淡出。

### 3.3 `src/util.js`

```js
/** 灯箱手势提示文案（U-3）。fine = 精确指针（鼠标/触控板/键盘），coarse = 触屏。 */
export function lightboxHintText(coarse) {
  return coarse ? "双击放大 · 双指缩放" : "← → 翻页 · 双击放大";
}
```

（与 `positionLabel` / `positionAnnouncement` 同：文案是纯函数，单测直接钉。）

### 3.4 `src/lightbox.js`

- 新端口三个：`hintEl`（`#lbHint`）、`hintText: () => string`、`claimHint: () => boolean`
  （「本次是否应当显示」——返回 true 至多一次；跨会话记忆在宿主，符合「storage 归 app.js」的既有分工）。
- `HINT_MS = 4000`；`showHint()` / `hideHint()` 收入工厂闭包（与 zoom/pan 同域）。
- 显示点：`open()` 的 `reveal()`（`showModal` + 聚焦关闭钮之后），条件 `hintEl && claimHint?.()`。
- 收起点：① 计时器（4s）；② `stage` 的 `pointerdown`（点击 / 横滑 / 捏合 / 拖拽任一起手）；
  ③ `wheel`；④ 方向键；⑤ `close()`。全部集中调用 `hideHint()`（幂等）。
- 不 import localStorage / matchMedia：跨域能力一律走端口（AGENTS.md 三条约束之二）。

### 3.5 `app.js`

- `LB_HINT_KEY = "milan-lb-hint"` + `claimHintOnce()`：try/catch 读写；抛错走 `hintSeenMemory` 布尔兜底。
- 装配处注入：`hintEl: document.getElementById("lbHint")`、
  `hintText: () => lightboxHintText(window.matchMedia("(pointer: coarse)").matches)`、
  `claimHint: claimHintOnce`。

## 4. 红态计划与护栏（e2e）

### 4.1 新用例（`tests/e2e/smoke.spec.js`）

1. 「首 Tab 落到 skip-link，激活后焦点进展厅（U-4）」——放在「序厅画作可键盘打开」之后。
   判据：① 首 Tab 的 `activeElement` 是 `.skip-link`；②（未聚焦时）其
   `getBoundingClientRect().bottom ≤ 0`（藏出视口）；③ 聚焦时在视口内；④ Enter 后
   `activeElement === #gallery`；⑤ `scrollY` 落到展厅（poll > 200，等待平滑滚动收敛）。
2. 「灯箱手势提示：首次出现 → ~4s 自动隐去 → 重开不再出现（U-3）」——放在 F-5 用例之后。
   判据：① 首开带 `is-on` 且文案非空；② `pointer-events === "none"`；③ 无交互时
   `is-on` 在时限内消失；④ 关后重开（settle 后再查）不带 `is-on`。
3. 「提示：任一翻页交互立即收起（U-3）」——开图后按 →，`is-on` 立即消失。

### 4.2 红态先行（项目纪律）

先写用例 → 跑红（记录输出）→ 再实施 → 转绿。预期红因：
- 用例 1：首 Tab 落 `site-nav-logo`（断言 `isSkip=false`，消息带「米兰美术馆」）；
- 用例 2/3：`#lbHint` 不存在（locator 超时）。

### 4.3 既有测试影响清单（复核后）

| 用例 | 影响 | 结论 |
|---|---|---|
| 「序厅画作可键盘打开」 | 从 `arts.first().focus()` 起步（非页面头部） | 不受骨架新增 tab stop 影响 |
| 「筛选 chip 激活后焦点…」 | 程序化 focus，不数 Tab 步数 | 不受影响 |
| 「灯箱开合 / 策展说明 / F-5 位置」 | 提示在 chrome 行，不碰 stage / meta 几何 | 不受影响（chrome 行高由 36px 关闭钮钉死） |
| 「手机宽度…灯箱可用」 | 提示出现于 chrome，收窄文案 | 不受影响 |
| SW 指纹测试 | `index.html` / `styles.css` 变化 → 指纹变 → 缓存名自动换代 | 预期内，用例从 `dist/` 独立重算，自洽 |

## 5. 否决项

| 方案 | 否决理由 |
|---|---|
| A. 用 JS 拦截 skip-link 点击做 `focus()` + `scrollIntoView` | 原生锚点 + `tabindex="-1"` 已覆盖（Chromium/Firefox/Safari 原生聚焦片段目标）；多一段 JS 就多一条与 hashchange 交互的待测路径 |
| B. 跳过点选 `<main>` 而不是 `#gallery` | 本仓 `<main>` 的第一个孩子就是 `#gallery`，语义等价；但「跳到展厅」对馆内用户是逐字可懂的落点，`main` 是工程词 |
| C. 保留 `#gallery` 聚焦轮廓 | 全宽三屏高的巨型方框不是位置反馈，是视觉事故；滚动本身已经是反馈 |
| D. 常驻提示（挂在 chrome 或舞台角落） | 与「无字陈列」的克制语言直接冲突；审计要治的是「首次发现成本」，不是「每次提醒」 |
| E. 每次打开都提示（不记档） | 骚扰成本 > 收益；灯箱是全站最高频动作 |
| F. 用两个节点 + CSS 媒体查询切换文案 | DOM 里同时存在两份文案（读屏 / 搜索索引都会撞见重复文本）；JS 单节点写入更干净 |
| G. `aria-live` 播报提示 | 4s 后消失的动态文本；读屏播报「→ ← 翻页」对读屏用户价值低且打断当前阅读 |
| H. 提示做成 `position: absolute` 悬浮在舞台底部 | 画框高度随图而变，总会在某些构图上压住画心；chrome 行是唯一零风险空位（决策 #5） |

## 6. 验收

- 红态：§4.2 两处红因如实记录；
- 绿态：3 条新用例 + 全量 `npm run test:e2e`；
- `npm run lint` / `npm run test:unit`（新增 `lightboxHintText` 单测）；
- 视觉：`node tools/preview-shots.mjs`（灯箱首开图应带提示——全新上下文 = 首次打开）；
- 线上：部署后抽验 skip-link（首 Tab）与提示（首开出现 / 交互收起）。

## 7. 遗留

- 提示只在「首次」出现；若用户想再看，目前无入口（若将来库房面板长成「设置中心」，可加一个「重看引导」）。刻意不做。
- skip-link 落点 `#gallery` 的 `tabindex="-1"` 使该 section 可编程聚焦；若未来把 `#gallery` 换成别的容器，焦点断言（e2e）会替我们抓住。
- 无其他遗留。

## 8. 实施记录（2026-10-15）

### 8.1 改动清单（与 §3 一致；一处实现偏差，见下）

| 文件 | 改动 |
|---|---|
| `index.html` | ① body 首个元素：skip-link（含注释契约）；② `#gallery` 加 `tabindex="-1"`；③ chrome 行「计数 ↕ 关闭」之间加 `#lbHint`（HTML 留空，文案由 JS 写） |
| `styles.css` | `.skip-link`（藏出上缘的玻璃药丸，`:focus` 滑入，只动 `transform`）；`#gallery:focus { outline: none }`；`.lb-hint`（chrome 中间药丸，默认 `opacity: 0` 保留占位、`pointer-events: none`、省略号兜底）；reduced-motion 清单 +2（`.skip-link` / `.lb-hint`） |
| `src/util.js` | `lightboxHintText(coarse)` 纯函数（fine / coarse 两份文案） |
| `src/lightbox.js` | 端口 +3（`hintEl` / `coarsePointer` / `claimHint`）；`HINT_MS=4000` + `showHint()/hideHint()` 进工厂闭包；显示点 `reveal()`；收起点五处：计时器、`pointerdown`、`wheel`、`step()`、`close()` |
| `app.js` | `LB_HINT_KEY` + `claimHintOnce()`（try/catch → 内存兜底）；装配处注入三端口 |
| `tests/unit/util.test.mjs` | `lightboxHintText` 用例 +1 |
| `tests/e2e/smoke.spec.js` | 新用例 +3（U-3 ×2、U-4 ×1） |

**实现偏差（§3.4 的 `hintText: () => string` → 实际 `coarsePointer: () => boolean`）**：
文案合成留在 `lightbox.js` 域内（`lightboxHintText` 从 util import，与 F-5 的 `positionLabel`
同范式），端口只供原始能力（matchMedia）——app.js 因此连一个 import 都不需要加。
（过程留痕：先按稿在 app.js 注入 `hintText`，lint 报 `lightboxHintText` unused 时回撤，
顺手把端口收敛成能力注入形态；两种都可以，选后者是与既有 F-5 范式对齐。）

### 8.2 红态证据（先跑，后实施）

**e2e 三连红**（`npm run test:e2e -- -g "U-3|U-4"`，先于全部实现改动）：

```text
1) 灯箱手势提示：首次出现 → 约 4s 自动隐去 → 重开不再出现（U-3）
   expect(locator).toHaveClass … Locator: locator('#lbHint') … element(s) not found
2) 灯箱手势提示：任一翻页交互立即收起（U-3）
   Locator: locator('#lbHint') … element(s) not found
3) skip-link：首 Tab 即跳转链，激活后焦点与视口一起落到展厅（U-4）
   locator.evaluate: Test timeout … waiting for locator('.skip-link')
3 failed
```

**定量探针（修复前，preview 4173 现场）**：从页面头部逐次 Tab，抵达展厅的第一处
可聚焦元素（筛选 chip）在**第 18 次**；其间依次经过馆名 → 3 个导航链接 → 主题钮 →
序厅画作 / 上一件 / 下一件 / 8 个分页点 / 暂停钮：

```text
#1 A.site-nav-logo 「米兰美术馆」
#2~4 A 「展厅」「前言」「库房」
#5 BUTTON.theme-toggle 「切换主题」
#6~17 序厅（hero-art / 箭头 ×2 / 分页点 ×8 / 暂停）
#18 BUTTON.filter-chip.is-active 「全部展厅」 ← 进入展厅
stops-to-gallery: 18 | reached: true
```

### 8.3 绿态与全量验证

- 新用例：3/3 绿（14.5s）；全量 `npm run test:e2e`：**60 passed**（44.1s，新增 3 条）。
- **一次既存偶发**：首跑全量时「手慢双击不跳过两张」变红（Received 停在
  `#p=IMG20260817164949_01.jpg`——即 groupStart 记晚一张的指纹）。该用例注释本就记载
  「并行负载下窗口赛跑、隔离跑 3/3 绿」的历史；本次隔离 `--repeat-each=3` 3/3 绿、
  重跑全量 60/60 绿。本批在该用例的时间窗内只多了一次 `pointerdown → hideHint()`
  （clearTimeout + remove 类，微秒级），判定为**既存脆弱性在负载下的复现**，非本批引入；
  CI 侧继续观察（如再犯，属该用例的既有遗留，应单独加固候选——见 §7 之外的维护注记）。
- `npm run lint` 通过；`npm run test:unit` 97/97（新增 1 条）。
- 探针复验（修复后，同一探针）：

```text
skip-link:bounds.bottom(未聚焦) = -10 (≤0 = 藏出上缘)
首 Tab 落点 = A.skip-link
Enter 后 activeElement = gallery | scrollY = 660 | #gallery.top = 60
首开 #lbHint = {"on":true,"text":"← → 翻页 · 双击放大"}
ArrowRight 后 is-on = false | 重开 is-on = false
```

（`#gallery.top = 60` 落在 `scroll-padding-top`（48+12）上——顶栏遮挡量精确生效。）

- 视觉：`node tools/preview-shots.mjs` 10 张（`tools/preview-apple-*.png`，已 gitignore）；
  灯箱亮/暗两图中提示药丸在「计数 ↕ 关闭」之间居中、不遮画；手机宽窄屏文案省略号逻辑未被触发。

### 8.4 顺带修正：AGENTS.md 的画框描述（2026-10-06 改版的滞后残留）

设计意图一节仍写着「画框是中性细边 + 圆角……不要装饰性金框」，而 `2ba2824`
（2026-10-06「金色实体画框」）之后卡片与灯箱都已是 4px `#d4af37` 实体金框 ——
本次勘察实读代码时被该描述误导过一次，属 AGENTS.md 自身的漂移，已按代码现状改写
（规格以 `.card-media` / `.lightbox-frame` 为准，禁止在框面叠新装饰）。

### 8.5 遗留

- §7 的既有遗留不变。新增维护注记：「手慢双击」用例的并行脆弱性（见 §8.3 第二点），
  CI 若复现再单独加固（不属本批范围）。

### 8.6 线上抽验（部署后）

`9ed1a42` 推送后 CI（38741555481）与 Deploy（38741556040，gate 复用全量）均 success，
Pages 发布完成后活体探针：

```text
线上馆藏卡片数 = 18
首 Tab 落点 = A.skip-link
Enter 后 activeElement = gallery | scrollY = 660
线上首开 #lbHint = {"on":true,"text":"← → 翻页 · 双击放大"}
```

skip-link 的藏出 / 滑入、原生片段聚焦、提示的一次性出现与文案，在线上形态（产物 +
SW）全部成立。
