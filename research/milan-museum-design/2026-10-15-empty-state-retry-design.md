# 空状态可自愈（F-9）＋ 文案面向访客（D-5）设计稿

- 日期：2026-10-15
- 来源：`2026-10-10-upgrade-opportunity-audit.md` §3 F-9 / §5 U-2 / §4 D-5
- 依赖：无（`lightboxSrc` 链路、`shareImageInfo` 均不涉及）
- 状态：定案，待实施

## 0. 决策摘要

| # | 议题 | 决策 | 否决 |
|---|---|---|---|
| ① | 状态模型 | **二分**：`加载失败` / `空馆藏`；**只有失败给重试入口** | 三分（再拆「筛选无结果」）—— 当前数据下不可自然触发，做出来即空断言 |
| ② | 文案归属 | 全部改为**面向访客**；站主指引（`photos/`、库房）移出到代码注释 | 保留站主提示（Visitor 看到等于无效信息） |
| ③ | 文案来源 | 由 JS 从**单一常量**写入（`src/util.js`） | HTML 静态双节点 + JS 切显隐 —— 同一语义两处文本，必然漂移 |
| ④ | 重试实现 | 重跑 `loadFolderPhotos()`；**解析期那条 Promise 只复用一次** | 复用 `window.__milanManifest` —— 它已永久 rejected，重试必然同因失败（假重试） |
| ⑤ | 可访问性 | **不动 ARIA**：不新增 live region、不改语义 role | 给容器加 `role="status"` —— 容器自身被 `hidden` 切换时公告无保证，属不可验证的断言 |

## 1. 问题与证据（均本仓实测）

1. **三种语义被压成一种。** `app.js:1024-1027` 的外层 catch 把任何失败都写成 `folderPhotos = []`；`app.js:1175` 的判据只有 `!galleryReady || visible.length > 0`。于是「清单加载失败」「清单为空」「筛选无结果」在 UI 上**完全不可分**。
2. **文案面向站主。** `index.html:192` 原文：「展厅尚未布展。将图片放入 `photos/` 后刷新，或到库房登记入藏。」—— `photos/` 与「库房」（本站的上传面板）只对站主有意义。
3. **零出路。** 该节点是纯静态 `<p>`，无任何重试入口。审计 §5 U-2 记：「本例故障正是走到这条路径」——P0 那次全站白屏的落地页就是它。
4. **失败链是三条，不是一条。** 失败可能来自：① `!res.ok`（`app.js:959`）；② fetch 抛错且 `caches.match` 也落空（`app.js:976`）；③ 取清单之后、`rebuildPhotos` 之前的任何异常穿出，由启动期的浮空 Promise 兜底（`app.js:1752-1757`）。三者都必须收敛到同一状态位，否则「失败却显示空馆藏」。
5. **已有可复用的测试配方。** `tests/e2e/smoke.spec.js:1401`「序厅为空…」已用 `serviceWorkers:"block"` + `page.route("**/photos/manifest.json", route.abort())` 造出过失败态，并断言 `#empty` 可见。本批沿用同一配方，无需新造手段。

## 2. 状态模型：为什么是二分

```
ready === false                 → 不显示空状态（保持现状：清单到达前不闪）
ready && visibleCount > 0       → 不显示空状态
ready && visibleCount === 0 ┬─ failed === true  → 失败态：文案 + 【重试】
                            └─ failed === false → 空馆藏态：只给文案
```

**为什么不做「筛选无结果」这第三态**：`collectFilters` 的选项全部源自真实照片，非法/过期 `#f=` 年月由 `renderFilters` 兜底退回 `all` —— 该分支在当前数据下**无法自然触发**。做出来只能靠人工改源码证明，属于「必然为真的空断言」，与项目纪律冲突（同 P-1 红② 的教训：护栏不能与被测物同源，也不能无从证伪）。等 F-7（检索/标签）落地、空结果成为常态时再启用；本批已在 `emptyState()` 的返回结构里给它留了位置（返回 `null | {text, retry}`，加一态只是多一个分支）。

## 3. 语义与文案

| 状态 | 文案 | 入口 |
|---|---|---|
| 加载失败 | 展厅暂时无法开放，请稍后重试。 | 【重试】按钮 |
| 空馆藏 | 本馆暂无展出作品，敬请期待。 | 无 |
| 重试中 | （沿用失败态文案） | 按钮禁用、文字变「重试中…」 |

- 两句都去掉了实现细节与站主术语，访客可读。
- 「重试中…」用省略号而非「请稍候」：它描述的是按钮自身的进行态，不是对用户的新指令。
- 站主的操作指引（`photos/` 入库、库房登记）不留在访客界面 —— 站主有库房面板，且 CI 的 sync-photos 会回写清单，不需要从错误页获取指引。原句以注释形式留在 `src/util.js` 的常量旁，避免「这信息被谁弄丢了」的重查成本。

## 4. 实现要点

### 4.1 唯一出口

新增 `updateEmptyState()`，**所有**影响空状态的地方只调它（`renderGallery()` 内联的那行 `emptyEl.hidden = …` 删除并改为调用）。判据与文案全部来自 `src/util.js` 的纯函数：

```js
emptyState({ ready, visibleCount, failed }) -> null | { text, retry }
```

放 `util.js` 的理由与既有约束一致：零副作用纯函数，单测可直接 import；`app.js` 只负责把状态位喂进去、把结果落到 DOM。**这同时让「二分」这件事可被单测钉住**，而不是埋在 e2e 的 DOM 时序里。

### 4.2 解析期 Promise「只复用一次」

`index.html:74` 在解析期就发起清单请求并挂到 `window.__milanManifest`，`app.js:957` 复用它。**这个 Promise 一旦 reject 就永久 reject** —— 重试若继续复用它，就是一次注定失败的假重试（本批最容易踩的坑）。

```js
const parsed = window.__milanManifest;
window.__milanManifest = null;                       // 取走即清空
const res = await (parsed || fetch("photos/manifest.json", { cache: "no-store" }));
```

「消费一次」同时更贴住 `smoke.spec.js:30`「manifest 响应体只被消费一次」的契约：该用例注入的 `Response.prototype.json` 探针观测的是 `bodyUsed`，本次改动**不新增任何消费者**，该用例结论不变。

### 4.3 重入守卫与忙态

- `retryInFlight` 布尔位：点击期间再次点击直接返回（连点不得并发两条 `loadFolderPhotos`，否则后到的那次会覆盖 `photos` 与 `roomEpoch`）。
- 重试开始：`galleryReady = false`、`manifestError = false`、收起空状态、**重新亮出骨架屏**（与首访同一套反馈语言），再 `loadFolderPhotos()`。
- 结束（成功或失败都走 `finally`）：解除禁用、按钮文字复原。失败时 `manifestError` 回到 `true`，空状态复现且按钮可用。

### 4.4 ⚠️ `display` 覆盖 `hidden`：两处后果不同（实测修正）

`hidden` 属性靠 UA 样式表里的 `[hidden] { display: none }` 生效，而**作者样式表里的 `display` 会无条件压过它**。因此 `.empty` / `.empty-text` / `.empty-retry` 都不得声明 `display`（居中交给父级已有的 `text-align: center`，`<button>` 默认 `inline-block` 自会被居中）。但两处的**暴露面不同** —— 这一点是实施中实测出来的，与设计稿初版判断不符：

| 破坏写法 | 实际后果 | 唯一能抓住它的护栏 |
|---|---|---|
| `.empty { display: … }` | 容器留在文档流，但内容为空（正文由 JS 在显示前才写入、按钮也 `hidden`）⇒ **高度 0**，`toBeHidden()` 认为「不可见」⇒ **逐层可见性断言全绿、破坏隐身通过** | 只能直接量计算值：`getComputedStyle(#empty).display === "none"` |
| `.empty-retry { display: … }` | 空馆藏态里本该隐藏的按钮**真的显形** | 行为断言即可（`#emptyRetry` 在空馆藏态必须 `toBeHidden()`） |

**初版写错了**：原判断是两处都会让「正常页面常驻提示 / 按钮」，于是打算用一条可见性用例同时挡两者。实测（给 `.empty` 写 `display: flow-root`）该用例**照样绿** —— 空内容 + 0 高度逃过了 `toBeHidden()`。这是「护栏必须可被证伪」的又一例：一个不会因所述理由变红的断言，等于没有。修正后普通页面的用例同时做可见性断言（挡 JS 判据写反）与**计算值断言**（挡 CSS 覆盖），各行其是。

## 5. 否决项

| 否决 | 理由 |
|---|---|
| 复用 `window.__milanManifest` 做重试 | 永久 rejected，重试必然同因失败（§4.2） |
| 重试时清空 SW 缓存 / 强制 `skipWaiting` | 失败与本机缓存无关；清缓存会让「离线仍可用」这一既有能力在用户手上凭空消失 |
| 重试按钮自动获取焦点 | 会在首访失败时抢走键盘用户/读屏用户的焦点（本仓已有「焦点不被重建劫持」的既有用例与约定） |
| 加 `role="status"` / live region | 容器自身在 `hidden` 切换下公告无保证，只能写不可证伪的断言；且离线场景已有 `#offlineNote` 承担播报（§0 ⑤） |
| 为「筛选无结果」预留可见 UI | 见 §2，做出来即空断言 |

## 6. 测试与红态计划

**单测（`tests/unit/util.test.mjs`）** —— `emptyState()` 四态：未就绪 → `null`；就绪且有作品 → `null`；就绪 + 空 + 失败 → `{retry:true}`；就绪 + 空 + 无失败 → `{retry:false}`。断言两句文案**互不相等且都不含 `photos/`**（D-5 的直接判据）。
**红态**：把 `failed` 三元翻转 → 失败/空馆藏两条必须红。

**e2e（`tests/e2e/smoke.spec.js`，与 `:1401` 同配方）**

| 用例 | 断言 | 为什么不可自证 |
|---|---|---|
| 失败 → 重试后真的恢复 | abort 清单 → `#empty` 可见、文案含「无法开放」、`#emptyRetry` 可见 → 放行请求 → 点重试 → `.card` 计 18、`#empty` 隐藏、`#heroCarousel` 不再 `is-empty` | **假重试**（只收起提示、不重取数据）→ 卡片数 0 必红；**复用 rejected Promise** → 卡片数 0 必红 |
| 空馆藏 → 不给重试入口 | 清单 `fulfill([])` → `#empty` 可见、文案含「暂无展出」、`#emptyRetry` **隐藏** | 「无脑恒显重试按钮」的写法必红 |
| 正常页面必须仍为 display:none | 18 卡时 `#empty`/`#emptyRetry` 的可见性 **+ 计算后的 `display` 均须为 `none`** | 挡 §4.4 的 CSS 覆盖；**只用可见性断言挡不住**（实测，见下表 ⑤） |

**红态实测记录**（每条都自检了「破坏已落到源码**并**产物」）

| # | 破坏方式 | 源码自检 | 产物自检 | 结果 |
|---|---|---|---|---|
| ① | 重试不重取数据（`loadFolderPhotos()` → `Promise.resolve()`）＝ 假重试 | 独立行计数 1 → 1 | `dist/app.js` 含 `Promise.resolve()` = 1 | **红**：`toHaveCount(18)` → Received `0` |
| ② | 复用已 reject 的解析期 Promise（删 `= null` 行、改回直接复用 `window.__milanManifest`） | `null` 行 1 → 0，复用计数 1 | `dist/app.js` 含 `__milanManifest=null` = 0 | **红**：`toHaveCount(18)` → Received `0` |
| ③ | 恒显重试按钮（`hidden = !state.retry` → `= false`） | 目标行 1 | `dist/app.js` 含 `hidden=!1` = 1 | **红**：`#emptyRetry` `toBeHidden()` → visible |
| ④ | `.empty-retry { display: inline-block }` | 规则块内多一行 | `dist/styles.css` 含 `display:inline-block` = 1 | **红**：空馆藏态 `#emptyRetry` `toBeHidden()` → visible |
| ⑤ | `.empty { display: flow-root }` | 规则块内多一行 | 构建 exit 0 | **绿 ⇒ 初版护栏失效**，促成 §4.4 的修正；改用计算值断言后重测为**红**（`display` ≠ `none`） |
| ⑥ | `emptyState` 的失败分支翻转（`return failed` → `return !failed`） | — | — | **红**：单测 `deepEqual` 两条失败 |

`⑤` 是本批最有价值的一条：它证明「照设计稿写出来的护栏」在实施后可能**不会因所述理由变红**，只有实测能发现。所有破坏都在**同一条命令内** patch → build → 测 → restore，并以 `git diff --stat` 复核还原无损（未用 `git checkout` 还原）。


## 7. 影响面

- `index.html`：`#empty` 由 `<p>` 改容器 + 两个子节点。**内联脚本一字未改 ⇒ CSP hash 不变**（`tools/csp.mjs` 算的是脚本内容）。
- `sw.js` 版本指纹：含 `index.html` / `app.js` / `styles.css` ⇒ 版本必然变化，这是预期（构建期自动注入，无需人工抬版本）。
- `app.js:957` 的消费方式微调（只复用一次）。
- 既有断言不变量：`smoke.spec.js:1401` 仍断言 `#empty` 可见（节点仍在、判据未变）；`:763`/`:790` 的删元素降级用例不涉 `#empty`，且新代码对 `#empty`/`#emptyText`/`#emptyRetry` 三处均做 null 守卫。
- Lighthouse a11y 仍为 1.0：新增 `<button>` 在正常页面下被 `hidden` 排除在可访问树之外，且其可访问名恒非空。

## 8. 已知限制（本批不做，留档）

- **失败态无播报**：视障用户不会被告知「加载失败、可重试」（§0 ⑤ 的取舍）。真正要做需按 `#offlineNote` 的范式另建常驻 live region，属独立批次。
- **重试期间无进度语义**：只有骨架屏与按钮忙态，没有「第几次尝试」。对一次网络抖动足够。
- **错误的细分**：网络失败、清单 404、JSON 损坏共用一句文案。若将来需要区分（例如 404 提示「本馆正在维护」），在 `emptyState()` 增加一个 `reason` 入参即可，不动 DOM 结构。
