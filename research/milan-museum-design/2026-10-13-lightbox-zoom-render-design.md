# 灯箱缩放渲染失效设计稿（入场动画架空 transform）

- 日期：2026-10-13
- 状态：**已实施**
- 前置：`2026-10-12-hires-tier-design.md` §8.5（P-2 目视期间发现，判为既有缺陷、与 P-2 无关）
- 对齐方式：逐项 brainstorming（入场动效取舍 → 护栏形式，两轮问答；决策见 §0）
- 提交边界：单独一个 commit，`research/` 文档与实施代码分开提交

---

## 0. 决策摘要

| # | 议题 | 决策 | 否决的方案与理由 |
|---|---|---|---|
| ① | 入场动效（0.96→1 轻微放大 + 淡入） | **保留**，改用 CSS 独立属性 `scale` | 只留 opacity：零风险但丢掉入场观感；挪到画框层（`.lightbox-frame`）：观感更强，但要动 frame 自身的 transform，`overflow: hidden` / 金边阴影 / VT 配对全要重测，三案中风险最高 |
| ② | 护栏 | **新增 1 条渲染矩形断言**，与既有「只看 `--lb-zoom` 变量」的用例互补 | 改造 `zoomOf` 全群（同一判据重复 N 次，且会让不相关用例变脆）；再加 rAF 采样「动画期间 scale<1」（护栏最全，但采样在 CI 并发负载下易抖） |

---

## 1. 缺陷与复现

**症状**：默认设置下灯箱缩放（双击 / 滚轮 / 捏合）视觉上完全无效 —— 变量变了，画面不动。

实测（`.workbuddy/scratch/probe-scale-attr.mjs`，1280×900 DPR2，滚轮 9 次）：

| 设置 | `--lb-zoom` | computed `transform` | `getBoundingClientRect` |
|---|---|---|---|
| 默认（`no-preference`）修复前 | 4 | `matrix(1, 0, 0, 1, 0, 0)` | **837×628（不变）** |
| `prefers-reduced-motion: reduce` 修复前 | 4 | `matrix(4, 0, 0, 4, …)` | 3349×2512 ✅ |

也就是说：**只有主动开启「减弱动态效果」的用户才看得到缩放**。这在移动端尤其严重 —— 触屏双击/捏合是主要放大手段。

## 2. 根因

`styles.css:1346` 的

```css
@media (prefers-reduced-motion: no-preference) {
  .lightbox-frame.is-lit .lightbox-img { animation: lb-enter 0.45s var(--ease) both; }
}
```

三重叠加导致：

1. **特异性**：`.lightbox-frame.is-lit .lightbox-img` 是 (0,3,0)，压过 `:1291` 的
   `.lightbox-frame.is-lit img { animation: none }`（(0,2,1)）；
2. **层叠**：`@keyframes` 里声明的属性在层叠中**高于**普通声明 —— 只要动画覆盖了 `transform`，
   `.lightbox-img` 的 `transform: translate(…) scale(var(--lb-zoom))` 就完全失效；
3. **`fill: both`**：入场结束后动画不撤销，`to { transform: scale(1) }` **永久定格**。

于是在 `prefers-reduced-motion: reduce` 下 `:1345` 的媒体查询不成立、`:1291` 的 `animation: none` 才胜出 ——
缩放"碰巧"可见。缺陷的可见性反过来取决于无障碍设置，这是最阴的一点。

**同一个坑此前已踩过一次**：`styles.css:1333` 给 `lb-in` 写的注释是「只动 opacity：fill both 的
transform 会永久盖掉缩放手势的 transform」。那次修了 `lb-in`（`:1334`），**漏了 `lb-enter`** ——
`lb-in` 是 `.lightbox-img` 自己的入场动画，`lb-enter` 是 `.is-lit` 态下的"增强版"，作用在同一元素上。

**护栏盲区**：既有 e2e 的 `zoomOf()` 只读 `--lb-zoom` 自定义属性，因此状态机全对、渲染全错，
整套 e2e 依旧 45/45 绿。这次的教训与 P-2 一致：**变量绿 ≠ 视觉对**。

## 3. 方案

### 3.1 选定：入场动画改用独立属性 `scale`

```css
@keyframes lb-enter {
  from { opacity: 0; scale: 0.96; }
  to   { opacity: 1; scale: 1; }
}
```

**原理**：CSS Transforms Level 2 的独立属性 `scale` 与 `transform` 是**两个不同的属性**，
合成顺序为 translate → rotate → scale → transform。动画只驱动 `scale`，交互缩放只驱动 `transform`
—— 物理隔离，任何一方都不可能覆盖另一方。入场期间 `zoom === 1` 且 `tx === ty === 0`，
所以「scale 先于 transform 应用」带来的坐标系差异无可观测影响。

**为什么优于「动画也写 transform，让它与 zoom 相乘」**：那种做法要在 `transform` 里写
`scale(calc(var(--lb-zoom) * var(--lb-enter)))`，并额外 `@property` 注册 `--lb-enter` 才能插值
（否则变量在 keyframes 里突变、不插值）。改动面更大，且把两个关注点重新揉回同一个属性。

兼容性：独立属性 Chrome 104+ / Safari 14.1+ / Firefox 72+（2022 起全绿）。本项目产物本身已依赖
`color-mix(in oklab)`、`:has()`、`@property`、View Transitions，基线一致，未引入新的兼容下限。

### 3.2 否决的替代

| 方案 | 否决理由 |
|---|---|
| keyframes 只留 `opacity` | 改动更小、零新概念，但丢掉 0.96→1 的入场放大感；观感是本项目明确在意的东西 |
| 动画挪到 `.lightbox-frame`（整框浮现） | 观感更强，但 `transform` 作用在画框上会新建包含块并影响 `overflow: hidden` 的裁切、金色边框渲染与 View Transitions 配对，需重测的边界最多 |

## 4. 实施

| 文件 | 改动 |
|---|---|
| `styles.css` | `lb-enter` 的两处 `transform: scale(…)` → `scale: …`；补注释说明**不得改回 `transform`** 及其原因 |
| `tests/e2e/smoke.spec.js` | 新增 helper `renderedWidthOf()` / `settleAnimations()`；新增用例「缩放必须落到渲染层：渲染矩形按 `--lb-zoom` 的同一倍数变大」 |

新断言的设计要点：

- **判据落在渲染层**：`getBoundingClientRect().width` 的放大倍数必须 ≈ `--lb-zoom`（`toBeCloseTo(zoom, 1)`）。
  它同时覆盖两种失效：矩形不变（被架空）与倍数不符（被部分覆盖）。
- **不依赖时间**：等入场动画结束用 `img.getAnimations().map(a => a.finished)`（`fill: both` 已结束的
  动画同样返回、`finished` 已是 resolved promise），避免固定 `sleep`，也避免量到从 `scale 0.96`
  起跳的中途帧（偏小约 4%，正是 P-2 阶段踩过的坑）。
- **与既有用例互补而非替代**：既有用例管状态机（`--lb-zoom`、hash、连击组），新用例只管渲染。

## 5. 验收

### 5.1 数值（默认动效，1280×900 DPR2，样本 `IMG20260916193852.jpg` 2560×1920）

| 时刻 | `--lb-zoom` | computed `scale` | computed `transform` | rect |
|---|---|---|---|---|
| 入场过程采样 | — | `none → 0.96 → 0.984 → 0.997 → 1` | — | — |
| 1× | 1 | 1 | `matrix(1, 0, 0, 1, 0, 0)` | 837×628 |
| 4× | 4 | 1 | `matrix(4, 0, 0, 4, −0.019, 0.853)` | **3349×2512** |

入场观感保留（scale 平滑插值 0.96 → 1），缩放视觉可见（矩形 4.00×）。

### 5.2 连带收益：平移（pan）一并恢复

`--lb-tx` / `--lb-ty` 与 `--lb-zoom` 同处被架空的 `transform` 里，因此**平移此前也是不可见的**。
实测（4× 下向左拖 200 px）：`--lb-tx = -200.019px`、`transform.e = -200.019`、
`rect.x` 从 −1035 → −1235，**视觉位移 200 px，与拖拽量 1:1**。

### 5.3 红态（决定性）

把 keyframes 改回 `transform`（其余不变）→ 重建 → 新用例必红：

```
Received difference: 3      ← 期望倍数 4、实际 1（rect 没变）
```

破坏的落地性双重自检：源码 `transform: scale(0.96)` 出现 1 次 / 独立 `scale: 0.96;` 出现 0 次；
产物 `dist/styles.css` 为 `@keyframes lb-enter{0%{opacity:0;transform:scale(.96)}…}`。还原后复跑全绿。

### 5.4 回归

`npm run lint` 干净；unit **70/70**；e2e **45 → 46 全绿**。

## 6. 遗留

- **入场动画在每次换图时都会重播**（`sync()` 会 `remove("is-lit")` 再 `add("is-lit")`）。
  这是改动前就有的行为，本次未动 —— 需确认是否为设计意图（0.45s 的轻微放大在翻页时可能偏吵）。
- 4× 放大后画框 `overflow: hidden` 把画面裁掉大半，用户只看到局部。裁切本身是「观画室凑近看」
  的设计意图，但「如何知道自己在画面的哪个部位」尚未评估（如小地图 / 惯性回弹）。
