# 序厅（hero）→ 观画室 的视图过渡源（2026-09-28）

> 经 brainstorming 流程确认。范围：修「从序厅点开灯箱时，画作从一个视口外 284px 的
> 盒子飞入，中途露出空画框 / 重影」，并让「筛选不含该画」时也获得过渡。
> 不在范围：展厅卡片→灯箱的配对（现状正确，不动）；深链打开（无点击元素，无源可配）。

## 1. 问题与既有证据

`src/lightbox.js` 用同一条判据取过渡源：

```js
const sourceImg = list ? null : cardImageAt(index);   // open() :225 / close() :264
```

这条判据把两件不相干的事混成了一个：**「没有可配对的元素」**与**「会话跟随 `list` 索引」**。

`app.js` 传 `list` 的两个调用点，**前置条件都是该画不在 `visible` 中**：

| 调用点 | 前置条件 |
|---|---|
| `app.js:331-338` 深链 `openLightboxFromHash` | 前面已有 `if (inVisible >= 0) return` 短路 |
| `app.js:571-578` 序厅点击 | 前面已有 `if (inFilter >= 0) return` 短路 |

因此：

- **Path A（默认路径）**：无筛选时点序厅 → `lb.open(inFilter, slide)`，`list` 为空 →
  源 = `cardImageAt(inFilter)` = **展厅卡片**。而用户点的是序厅画面，那张卡**在屏外**。
- **Path B（筛选不含该画）**：`lb.open(allIdx, slide, photos)`，`list` 非空 → 源 = `null` → 无配对。

> 附带纠正一条此前流传的说法：「给 hero 路径补 `visible.findIndex` 反查」是**无效修复**。
> 上述两个调用点的前提就是该画不在 `visible` 中，反查恒为 -1，属死代码；且 `list` 非空时
> `index` 索引的是 `list` 而非 `visible`，硬取 `cardImageAt` 会**配错卡片**。

### 取证（探针 `probe-vt-hero.mjs`，两个断点，`scrollY=0`）

| 证据 | 结果 |
|---|---|
| 谁拿到 `view-transition-name`（Path A） | 一个展厅 `<img>`：**`inCard: true` / `inHero: false`**。序厅画面在任何一条日志里都没出现过 |
| 该卡是否在视野 | **不在**。桌面 `top=1184`（vh 900，**溢出 284px**）；移动 `top=1080`（vh 844，**溢出 236px**） |
| 序厅画面 | 两断点都完整在视野内（桌面 174–804 / 移动 207–682） |
| 中途帧 桌面 t=1600/3000 | 灯箱金框已就位、**内部是空的**（墙面色），画作还在视口下缘之外上飞 |
| 中途帧 移动 t=1600/3000 | **同一人像两份错位重影**（旧卡片快照与新闻画心相距数百像素） |
| 对照 Path B | `pathB_vtLog` **只有 `lbImg`、零源元素**；同 t700 画作**已静止就位**，无位移 |

最后一行是判据：同一时序、同样被拉长到 3s 的过渡，Path B 纹丝不动、Path A 在飞——
位移只能归因于错误配对的源，而非图片加载延迟。

**结论**：此前判为「缺口」的 Path B 其实是良性的（只是少一段动画）；真正有缺陷的是
**默认路径 Path A**——只要不筛选，点序厅必然走它。

## 2. 被否决的方案

### 2.1 存下 hero `<img>` 元素 + 照片 id 兜底 — 否决

`open()` 时把元素存进闭包，`close()` 时校验照片 id 相同则复用。**不安全**：
`heroAutoAllowed()`（`app.js:464`）只挡 `reduceMotion` / 用户暂停 / `document.hidden`，
**没有任何灯箱门控**，所以灯箱开着时序厅仍每 **4200ms** 自动轮播。轮播转走后，被点的
slide 变成 `opacity: 0 / visibility: hidden`——照片 id 仍然相同，但元素已不可见。
把画缩回一个看不见的地方，比不配对更糟。

### 2.2 只补 Path B，Path A 维持现状 — 否决

改动最小，但把已坐实的默认路径缺陷留在原地。证据显示 Path A 才是更坏的那个。

### 2.3 点序厅时先切筛选 / 滚动使卡片可见，再从卡片过渡 — 否决

源始终是真实可见的卡片，但会引起页面跳变，UX 风险最高，YAGNI。

## 3. 采用方案

三件事：**规则集中到一个纯导出**、**源在 open/close 各自重新求值**、**灯箱会话期间暂停序厅轮播**。

### 3.1 纯导出（`src/lightbox.js`，可被单测直接 import）

```js
/** 选定视图过渡的配对源。规则按优先级：
 *  ① 显式源（用户点击的那幅画，如序厅画面）优先；
 *  ② 否则仅当会话**不**跟随 list 索引时才反查展厅卡片
 *     （list 非空时 index 索引 list 而非 visible，反查必配错卡片）；
 *  ③ 否则无源。 */
export function resolveVtSource({ explicit, allowCard, cardAtIndex }) {
  if (explicit) return explicit;
  return allowCard ? cardAtIndex() : null;
}
```

`allowCard` 由调用方传 `!list`。`open()` 与 `close()` 共用这一条规则，不再各自重复
三元表达式——原先两处各写一遍，正是这条规则被误解成「hero 反查」的土壤。

### 3.2 会话级显式源：`open()` 的第 4 参数

宿主在**调用时刻**回答「这张画此刻是否正由某个可见元素承载」，以函数形式作为 `open()`
的第 4 参数传入，由工厂收进闭包供本会话的 `close()` 复用：

```js
// app.js
lb.open(inFilter, slide, null, heroSourceFor);          // 无筛选路径
lb.open(allIdx, slide, photos, heroSourceFor);          // 筛选不含该画路径

function heroSourceFor(photoId) {
  const i = heroList.findIndex((p) => p.id === photoId);
  if (i < 0) return null;
  const slide = heroSlides[i];
  // 轮播已转走 / 序厅已重建时拒绝配对 —— 配到「看不见的画面」比不配对更糟
  if (!slide || !slide.classList.contains("is-active")) return null;
  return slide.querySelector(".hero-art img");
}
```

`open()` 与 `close()` **各自重新求值一次**，而不是把元素存起来。这是本方案的核心，
直接消解 2.1 的隐患：`close()` 以**当前**照片 id 再问一次，轮播若已转走（或已被 3.3
暂停、根本无法转走）自然得到正确的答案。

**为什么不做成端口**（这是定稿时的修正）：端口只能按 `photoId` 查，会误伤
「从展厅卡片打开灯箱、而该画恰好也是序厅当前那张」的情形 —— 正确的卡片源会被序厅画面
覆盖。做成 `open()` 的参数把作用域限死在序厅点击那一次调用上；画廊卡片路径
（`lb.open(i, card)`）不传该参数，行为完全不变。

### 3.3 灯箱会话期间暂停序厅轮播

`heroAutoAllowed()`（`app.js:464`）增加 `&& !heroModalPaused`，并新增端口
`pauseHero(on)` 设置该标志后重启计时器（`open()` 末尾置 `true`，`close()` 置 `false`）。

**用独立标志，不复用 `heroTempPaused`**：后者已被 hover / 拖拽占用，共用会在关闭时
把用户正持有的 hover 暂停一并清掉。

副作用是正向的：模态框背后不再有每 4.2s 一次的轮播与随之而来的图片预载。

## 4. 行为对照表

| # | 场景 | 新实现 | 现状 |
|---|---|---|---|
| 1 | 无筛选点序厅（Path A） | 从**序厅画面**展开，无空框无重影 | 从屏外 284px 的展厅卡片飞入；空框 / 重影 ❌ |
| 2 | 筛选不含该画点序厅（Path B） | 从序厅画面展开 | 完全无过渡 ❌ |
| 3 | 序厅打开后 <4.2s 关闭 | 缩回序厅画面 | 无配对 / 缩向屏外卡片 ❌ |
| 4 | 序厅打开后 >4.2s 关闭（轮播已被暂停，不会转走） | 缩回序厅画面 | ❌ |
| 5 | 点展厅卡片开合 | **不变**（`cardImageAt`，现状正确） | ✅ |
| 6 | 深链打开 | 不变（无点击元素，无源） | ✅ |
| 7 | 序厅 hover 时开灯箱再关闭 | hover 暂停不被清掉（独立标志） | — |
| 8 | `prefers-reduced-motion` | 不开 VT，本方案不生效 | ✅ |

## 5. 测试方案

**单测**（`tests/unit/lightbox.test.mjs`，`resolveVtSource` 是纯函数可直接 import）：

| # | 断言 |
|---|---|
| U1 | `explicit` 非空 → 返回它，且 `cardAtIndex` **不得被调用**（间谍） |
| U2 | `explicit` 为空 + `allowCard=false` → 返回 `null`，且 `cardAtIndex` **不得被调用** |
| U3 | `explicit` 为空 + `allowCard=true` → 返回 `cardAtIndex()` 的结果 |

按项目惯例**每条新断言做一次红态验证**（临时反转分支，确认真的会红）。

**e2e**（`tests/e2e/smoke.spec.js`，用 `addInitScript` 装 MutationObserver 抓
`view-transition-name` 的归属元素，手法与本次探针一致）：

| # | 断言 |
|---|---|
| E1 | 无筛选点序厅 → 承载该 name 的是**序厅内的 `<img>`**，且展厅 `<img>` 不承载 |
| E2 | 筛到「2026年8月」（序厅 8 张全是 2026-09，必然进入 Path B）→ 同上 |
| E3 | 灯箱开着时越过一个轮播周期（4200ms）活动 slide 不变；关灯箱后恢复轮播 |

E1 在修复前应为**红**（现状承载者是展厅卡片），构成红→绿证明。
E2 在修复前亦为红（现状无任何元素承载）。E3 在修复前为红（`heroModalPaused` 尚不存在）。

三项已实测红态：把 `heroSourceFor` 改为恒返回 `null`、并把 `setHeroModalPaused` 改为空实现
（即精确复现修复前行为），三例全红；恢复后全绿。

## 6. 改动面

| 文件 | 改动 |
|---|---|
| `src/lightbox.js` | 新增具名导出 `resolveVtSource`；`open()`/`close()` 改用之；`open()` 增加第 4 参数（会话级显式源提供者）与闭包态 `sessionSource`；新增端口 `pauseHero`（含 JSDoc） |
| `app.js` | 序厅点击两个调用点传 `heroSourceFor`；装配 `pauseHero` 端口；`heroAutoAllowed()` 增加 `heroModalPaused`；新增该标志、`setHeroModalPaused()`、`heroSourceFor()` |
| `tests/unit/lightbox.test.mjs` | +3 例（U1–U3） |
| `tests/e2e/smoke.spec.js` | +3 例（E1–E3），24 → 27 项 |
| `sw.js` | `VERSION` v41 → **v42** |
| `AGENTS.md` | 端口清单补「序厅轮播暂停」与 `resolveVtSource`；新增「按会话注入的能力走 `open()` 参数、不要做成端口」一条；e2e 项数 24 → 27 |


**验证顺序**：单测 → e2e → 用同一支探针复测（把「同一时刻画作从屏外飞入」变成
「起点等于序厅画面位置」）。探针 `probe-vt-hero.mjs` 为临时未跟踪文件，验证后删除。
