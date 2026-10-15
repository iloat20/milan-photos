# F-5 观画室位置指示「3 / 18」设计稿

日期：2026-10-15 ｜ 批次：审计 §9 F-5 ｜ 前置：F-9（`a5dab64`）已完成

## 1. 决策摘要

| # | 决策 | 结论 | 依据 |
|---|---|---|---|
| 1 | 呈现形式 | **chrome 行左端视觉计数（aria-hidden）+ 独立 sr-only live region** | 用户已确认。视觉文本直接当 live region 会被读屏念成「3 斜杠 18」，故分离 |
| 2 | 序号语义 | **全量馆藏序号 / 全量总数** | 用户已确认。与墙号 `MIL · 003`（`app.js:1241`，wallIndexes 全量映射）、逐图页 `${index+1} / ${total}`（`gen_work_pages.mjs:408`）同一体系；筛选浏览时总数恒为 18 |
| 3 | 状态归属 | 不新增状态：在 `lightbox.js` 的 `sync()` 内更新 | `pos` / `photos()` 已在闭包内，事件路径（箭头/键盘/横滑/点击/深链）全部汇经 `sync()` |
| 4 | 跨域访问 | 走端口：`catalogIndex(photo)` / `catalogTotal()` 由 `app.js` 注入 | `lightbox.js` 不 import `app.js`（无环约束）；全量数组只有宿主有 |
| 5 | 焦点/行为 | 纯展示，不可聚焦、不进 Tab 序 | YAGNI：无点击行为 |

## 2. DOM 与样式

```html
<div class="lightbox-chrome">
  <span class="lb-count" id="lbCount" aria-hidden="true"></span>   <!-- 新增，行首 -->
  <button class="lb-close" ...>                                    <!-- 原有，行尾 -->
</div>
...
<dialog ...>
  ...
  <span class="sr-only" id="lbCountLive" role="status" aria-live="polite"></span>  <!-- 新增 -->
</dialog>
```

- `.lightbox-chrome` 由 `justify-content: flex-end` 改 `space-between`。
- `.lb-count`：`var(--text-2)` 小号字 + `font-variant-numeric: tabular-nums`（数字宽度稳定，翻页不抖）。
- `.sr-only`：站内首个视觉隐藏工具类（标准 clip 模式），放基础区。
- **live region 必须是静态空节点**：动态插入的 live region 首次变更常不播报。
- **CSP**：`index.html` 内联脚本一字不动 ⇒ hash 不变；新增均为普通标记。

## 3. 纯函数（src/util.js）

```js
/** 「3 / 18」——与逐图页 pager-count 同格式（不补零） */
export function positionLabel(index, total) {
  return `${index + 1} / ${total}`;
}
/** 读屏播报：「第 3 件，共 18 件」 */
export function positionAnnouncement(index, total) {
  return `第 ${index + 1} 件，共 ${total} 件`;
}
```

## 4. 接线（lightbox.js / app.js）

`sync()` 在题名更新之后：

```js
const total = catalogTotal() || arr.length;
let gIdx = catalogIndex(photo);
if (gIdx < 0) gIdx = pos;          // 不在全量（理论不可达）：回退当前序列序号
if (countEl) countEl.textContent = positionLabel(gIdx, total);
if (countLive) countLive.textContent = positionAnnouncement(gIdx, total);
```

`app.js` 注入：`catalogIndex: (p) => photos.findIndex((q) => q.id === p.id)`、
`catalogTotal: () => photos.length`。端口缺失（元素被移除）按既有 `on` 守卫范式静默降级。

## 5. e2e 护栏与红态计划

| 用例 | 断言 | 挡什么 |
|---|---|---|
| 计数 = 全量序号 | 筛选后打开某画，计数应为该画在**全量**中的序号（非筛选内序号） | 序号语义走样成「当前序列」（**决定性判据**：两种实现只有一种是绿的） |
| 翻页回绕 | 末件 ArrowRight → 「1 / 18」 | `pos` 取模遗漏 |
| 播报节点 | 切图后 `#lbCountLive` 文本 = 「第 N 件，共 18 件」 | live region 没接 |
| aria-hidden | `#lbCount` 的 `aria-hidden="true"` 且 `#lbCountLive` 计算样式视觉隐藏 | 读屏重复念 / 工具类丢失 |

**红态（各一次，自检破坏落到源码并产物）**：
① 注释 `sync()` 内两行更新 → 计数用例红；
② `catalogIndex` 改为恒返回 `pos`（退化为序列语义）→ 筛选用例红。

## 6. 否决项

- **meta 区放计数**（用户否决）：`.lightbox-meta` 是「零跳动」敏感区（高度由内容撑开），多一行有跳动风险。
- **仅 aria 播报**（用户否决）：明眼访客无位置感。
- **跟随筛选序列**（用户否决）：与墙号/逐图页编号体系冲突，同一幅画两套序号。
- **给 live region 加 `role="status"` 之外的额外轮询/去抖**：`sync()` 每次切图恰调用一次，天然无需。
