# P-6 导航 network-first 设计稿

日期：2026-10-15 ｜ 批次：审计 §9 P-6 ｜ 前置：P-5 SW 版本构建期注入（`02d8699`）已完成

## 0. 一句话

把**导航请求**从 `shellSwr`（先缓存后刷新）改为**网络优先**：在线导航永远拿最新 HTML，
缓存只在网络失败/超时时兜底；同时删除 `shellSwr` 里随本次分流而死的「navigate 兜底」段。

## 1. 决策摘要

| # | 决策 | 结论 | 依据 |
|---|---|---|---|
| 1 | 修复范围 | **仅 `request.mode === "navigate"`**；子资源（app.js / styles.css）维持 `shellSwr` | 审计原文点名导航；子资源也网络优先＝每次加载每资源 +1 网络等待，残余窗口已由「每次加载 revalidate 收敛 + SW 换代原子替换」兜住（§5-A） |
| 2 | 导航语义 | 网络优先：`fetch` ok → `cache.put(request)` 覆写并应答；失败/超时 → `match(request)` → `match("./index.html")` → `Response.error()` | 在线＝最新、离线＝兜底，行为单一可测；与 manifest 的 `networkFirst` 同构（独立函数——见「实现形态」） |
| 3 | 超时兜底 | `NAV_TIMEOUT_MS = 3000`（与 manifest 同值） | 离线模拟（CDP）下 fetch 立即 reject、不消耗超时；只有真·黑洞连接才吃满——导航白屏容忍上限 |
| 4 | 判定次序 | navigate 分支置于 manifest / thumb / media **之后**、`isShellRequest` 之前 | 直接导航到图片/清单 URL 不得把非 HTML 二进制写进壳层缓存；逐图页（`/p/<slug>/`）属导航，落 `navigateNetworkFirst` 是正确语义 |
| 5 | `shellSwr` 的 navigate 兜底 | **删除**（分流后为死代码）；serve 缺缓存只余 `Response.error()` | 非导航请求本就到不了该分支；留着会误导后人以为 `shellSwr` 仍兜导航 |
| 6 | e2e 判据 | **沙箱缓存覆写**：把 canary 版 HTML 写进 shell 缓存的 `./` 与 `./index.html`，在线 reload 后断言 DOM 无 canary | 不碰 dist 磁盘（`fullyParallel:true` 下与「SW 版本＝四件套指纹」测试并发时改磁盘必然互毁——§5-B）；探针已实证红态方向成立（§2.4） |
| 7 | 版本策略 | 不额外处理：sw.js 自身字节变 → 浏览器重装；四件套未变 → 指纹不变（正确语义） | P-5 机制：同名缓存被 install 的 `addAll` 重建，activate 只清理**异名**旧缓存 |
| 8 | 实现形态 | 独立 `navigateNetworkFirst()`，**不**复用/改造 manifest 的 `networkFirst()`、不抽公共超时封装 | 与 `shellSwr`/`thumbSwr`「同构不抽象」的既有风格一致；不动 P0 地基（最小回归面） |

## 2. 缺陷模型与实测

### 2.1 机理链（现状）

1. 壳层资产是**固定文件名**（`app.js` / `styles.css` 不带 hash），「同一部署快照」是 HTML
   与子资源之间唯一的版本契约；
2. `shellSwr` 的 serve **先回缓存**、网络刷新在后台**逐条**进行（HTML / JS / CSS 各自独立成败）——
   任一条 revalidate 失败，其陈旧条目就留在缓存里；
3. 于是**在线导航可能回放任意世代的缓存 HTML**；与「已刷新到新版」的子资源拼接，
   就是审计点名的「旧 HTML + 新 app.js」错配（反向配对同理）；
4. 新 SW 换代（P-5 指纹机制）会**原子替换**缓存，但发现更新发生在**下次导航**——
   更新检查（install → activate）与「旧 SW 回放陈旧 HTML」在同一导航里并行赛跑。

**修复的语义**不是「消灭所有世代混合」（那要等 P-11 的产物名 hash 化），而是把一条
不变量钉死：**在线导航永远等于网络最新版**；缓存只服务离线兜底。此后子资源最多滞后，
「陈旧 HTML 被无限期回放」的通道消失。

### 2.2 可测判据（与实现无关的行为契约）

> **把一份陈旧 HTML 放进壳层缓存 → 在线导航不得采用它。**

这与「sw.js / 指纹 / 换代窗口」的实现细节全部解耦，因此可以做成确定性 e2e（§4）。

### 2.3 探测手法

不伪造部署（那要改 dist 磁盘，与并发测试冲突，§5-B），而是**伪造「缓存落后于网络」**：

1. 正常加载首页，等 SW 激活 + shell 缓存就位 + controller 接管；
2. 用 Playwright `request` fixture（不经 SW）取原版 `/index.html` 文本，在 `</head>` 前注入
   `<meta name="e2e-nav-canary" content="stale">`；
3. 页面内 `caches.open(<…>-shell)`，把 `./` 与 `./index.html` 两个键 `put` 成 canary 版，
   **read-back 自证写入生效**；
4. 在线 `reload()`，观察 DOM。

### 2.4 实测（2026-10-15，preview 形态 `milan-e8dc5deb`，临时探针）

```text
sw-ready: true
cache-dirtied: {"name":"milan-e8dc5deb-shell","canaryInCache":true}
canary-in-dom: true → 在线导航回放了陈旧缓存（当前 SWR 行为，红态方向成立）
```

**结论**：当前实现下「在线导航回放缓存 HTML」是**确定性行为**（serve 命中缓存即回放，
与缓存是否陈旧无关）——这正是错配通道的引擎，也确认了 §2.2 判据在现状下会红。

## 3. 实施（草案）

### 3.1 `public/sw.js`：新增 `navigateNetworkFirst()`

放在 `networkFirst()` 之后（同类相聚）：

```js
/* 导航请求网络优先（P-6）：壳层资产是固定文件名，HTML 与 app.js/styles.css 之间
   没有版本互认手段；SWR 的「先回缓存」允许在线导航回放任意世代的缓存 HTML，
   与已刷新的子资源拼接即「旧 HTML + 新 JS」错配。网络优先把在线导航钉死在新版
   HTML 上；缓存只在网络失败/超时时兜底——此时已处于离线语境，可用性优先。
   （实测：preview 下把 canary 版 HTML 写进 shell 缓存，在线 reload 后它出现在
   DOM——「回放缓存」与缓存是否陈旧无关，是确定性行为。） */
const NAV_TIMEOUT_MS = 3000;

async function navigateNetworkFirst(request) {
  try {
    const response = await Promise.race([
      fetch(request),
      // 黑洞连接可能让 fetch 永久 pending：3s 兜底转缓存（同 manifest 的处置）
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error("navigate fetch timeout")), NAV_TIMEOUT_MS)
      ),
    ]);
    if (response && response.ok) {
      // 覆写导航条目：离线兜底拿到「最后一次在线导航的版本」，而不是 install 快照
      const cache = await caches.open(CACHE_SHELL);
      await cache.put(request, response.clone());
      return response;
    }
    // 非 2xx 也转缓存回落，不把错误页当文档交给访客
    throw new Error("navigate fetch not ok");
  } catch {
    const cached = await caches.match(request, { ignoreSearch: true, ignoreVary: true });
    if (cached) return cached;
    const fallback = await caches.match("./index.html", { ignoreVary: true });
    if (fallback) return fallback;
    return Response.error();
  }
}
```

### 3.2 分发树（fetch 事件末段）

```js
  if (isMediaRequest(url)) {
    event.respondWith(cacheFirst(request));
    return;
  }

  if (request.mode === "navigate") {          // ← 新分支（P-6）
    event.respondWith(navigateNetworkFirst(request));
    return;
  }

  if (isShellRequest(url)) {                  // ← 原 `isShellRequest(url) || mode === "navigate"`
    const { serve, revalidate } = shellSwr(request);
    event.respondWith(serve);
    event.waitUntil(revalidate);
  }
```

### 3.3 `shellSwr` 死码清理

serve 内以下段落在分流后**理论上不可达**（能到 `shellSwr` 的 navigate 请求已不存在），删除：

```js
    // HTML 只兜导航：把 index.html 当 JS/CSS 喂只会把「缺缓存」变成难查的 MIME 报错
    if (request.mode === "navigate") {
      const fallback = await caches.match("./index.html", { ignoreVary: true });
      if (fallback) return fallback;
    }
    return Response.error();
```

改为：

```js
    // 导航已由 navigateNetworkFirst 分流（P-6）；此处只服务壳层子资源
    return Response.error();
```

### 3.4 文件头注释

`sw.js` 第 1 行「壳层 SWR，缩略图/中图/原图带 LRU，清单 Network First」→
「**导航 Network First**，壳层子资源 SWR，缩略图/中图/原图带 LRU，清单 Network First」。

## 4. 红态计划与护栏（e2e）

### 4.1 新用例（`tests/e2e/smoke.spec.js`，「SW 离线仍可服务」之后）

```js
  test("在线导航不回放陈旧 HTML 缓存（P-6：导航网络优先）", async ({ page, request }) => {
    // …goto("/") + 等 SW 激活/缓存/接管（expect.poll，不用 async waitForFunction——单测坑 3）
    // 1) 伪造「缓存落后于网络」：canary 版 HTML 覆写 shell 缓存的 ./ 与 ./index.html
    //    注入点存在性 + read-back 自证，两步断言防「前提没生效」的假绿
    // 2) 在线 reload
    // 3) 主断言（红/绿判据）：document 里不得出现 meta[name="e2e-nav-canary"]
    //    — 现状（SWR）红：canary 必然出现在 DOM（§2.4 已实证）
    //    — 修复后绿：在线导航完全不读这份缓存
    // 4) 副断言（回归护栏，两态最终都绿）：缓存 `./` 条目在 reload 后被覆写为网络版
    //    （poll 宽超时；不承担红态区分，只锁「导航成功写缓存」不被退化）
  });
```

### 4.2 红态先行（项目纪律）

1. **先在当前实现上跑新用例**：主断言红（Received `true`）——留输出到实施记录；
2. 探针（§2.4）已等效预演该红态方向成立；
3. 修复后转绿，**且**下列既有用例必须保持绿。

### 4.3 既有测试影响清单（复核后）

| 用例 | 影响的路径 | 结论 |
|---|---|---|
| Service Worker 激活只清理本站旧缓存 | 不碰 install / activate | 不受影响 |
| Service Worker 离线仍可服务 | 离线导航改走 `navigateNetworkFirst` → fetch 立即 reject → 命中 `./` | 行为等价，应保持绿；预热注释若语义过时同步改写 |
| SW 缓存版本＝四件套独立重算 | 四件套不动 | 不受影响 |
| global-setup 五层核对 | 清单/产物引用不动 | 不受影响 |

### 4.4 测试沙箱性说明

- canary 只写进**该 test 的 context** 的 Cache Storage（Playwright 每用例独立 context，
  运行结束即销毁）——零跨测试污染；
- 全程不碰 dist 磁盘、不碰 sw.js 版本、不改变任何产物文件。

## 5. 否决项

- **A. 壳层子资源（app.js / styles.css）也改网络优先**：每资源每次加载 +1 网络等待；
  它修的残余窗口（子资源滞后）本就由「每次加载 revalidate 收敛」与「SW 换代原子替换」
  兜住，而「陈旧 HTML 被回放」的主通道已由本批消灭。彻底根治（含 HTTP
  `max-age=600` 回访陈旧）属于 P-11 的范畴，不在本批。
- **B. e2e 改 dist 磁盘伪造部署**：`fullyParallel:true` 下与「SW 版本＝四件套指纹」
  测试（读 dist 独立重算）并发互毁——改 HTML 的窗口里指纹重算必错。否决，采用 §4.1
  沙箱缓存覆写。
- **C. 复用 manifest 的 `networkFirst()`**：其失败行为是 throw（给页面 fetch 消费）、
  错误消息与注释均为清单语境；导航需要「缓存 → index.html → Response.error」回退链。
  独立函数（决策 8）。
- **D. `revalidate-then-serve` 双版本猜测**（审计括注的变体）：先取缓存同时赛跑
  revalidate、等先到者——行为不连续、判据复杂；network-first 语义单一且可测。

## 6. 验收

1. 红态：新用例在当前实现上跑出预期红（输出留实施记录）；
2. 绿态：`npm run lint && npm run test:unit && npm run test:e2e` 全量绿（e2e +1 条）；
3. 手测（preview）：在线刷新正常；DevTools 离线 → 导航仍可用（缓存兜底）；
   恢复网络 → 再导航拿到最新版；
4. 代价粗测：记录一次导航首字节与修复前的差（预期几十 ms 量级）；
5. 提交切分：docs（本设计稿）+ feat（`sw.js` + `smoke.spec.js`）。

## 7. 遗留

- **P-11**（`?v=<build>` / hash 产物名 + HTTP `max-age=600`）：根治「固定文件名」
  这一更上游问题域；本批不引入。
- **离线时的缓存可能是混合世代**：离线语境下可用性优先于一致性，不处理。
- 浏览器「导航触发更新检查」的节流细节（24h 等）未实测，本稿不承诺数字。

## 8. 实施记录（2026-10-15）

### 8.1 改动清单（与 §3 一致，无偏差）

- `public/sw.js`：头注释改为「导航 Network First」；新增 `NAV_TIMEOUT_MS` +
  `navigateNetworkFirst()`；`shellSwr` serve 删除 navigate 兜底死码；
  fetch 分发在 media 判定之后拆出 navigate 分支。
- `tests/e2e/smoke.spec.js`：新增用例「在线导航不回放陈旧 HTML 缓存
  （P-6：导航网络优先）」。

### 8.2 红态证据（先跑，后实施）

在改动 sw.js **之前**单跑新用例（当前 SWR 实现）：

```text
x 1 [chromium] › tests\e2e\smoke.spec.js:643:3
  › 画廊冒烟 › 在线导航不回放陈旧 HTML 缓存（P-6：导航网络优先） (1.3s)

Error: expect(received).toBe(expected) // Object.is equality

Expected: false
Received: true
  at smoke.spec.js:694:7
```

`Received: true` 即 canary 出现在 DOM——测试确定性地抓住了「在线导航回放陈旧缓存」。

### 8.3 绿态与全量验证

- `npm run lint`：通过（ESLint + Stylelint）；
- `npm run test:unit`：96/96；
- `npm run test:e2e`：**57 passed**（新用例 +1；「SW 离线仍可服务」「激活只清理
  本站旧缓存」「SW 版本＝指纹」等既有护栏全部保持绿）。

### 8.4 独立复验（探针重跑）

§2.3 的探针在修复后的产物上重跑（独立于 e2e 测试代码）：

```text
cache-dirtied: {"name":"milan-e8dc5deb-shell","canaryInCache":true}
canary-in-dom: false → 在线导航未用陈旧缓存
```

与 §2.4 的 `true` 对照——「陈旧缓存不复用」在两个独立观测面上成立。

### 8.5 手测（preview 4173）与首字节粗测

1. 在线 reload：OK（`responseStart` 33 ms）；
2. CDP 离线导航：OK，缓存回落（15 ms）；
3. 恢复在线再导航：OK（20 ms）。

本机 localhost 环境的「网络导航 vs 缓存回落」差 ≈ 13–18 ms；CDN（GitHub Pages）
上的几十 ms 量级按审计预期，待线上抽验。

### 8.6 顺带修正：AGENTS.md 的 SW 版本纪律（P-5 的滞后残留）

「Service Worker 版本」节仍写着「必须把 `VERSION` 往上抬（`milan-vN`）」——P-5 已改为
构建期指纹注入，本批是**首个「只改 sw.js、不动四件套」**的部署、实际用到了该语义，
故一并修正为：无人工版本动作；改四件套 → 换缓存名；只改 sw.js → 同名缓存被
`addAll` 覆盖重建。

### 8.7 遗留

与 §7 相同（P-11 根治；离线混合世代不处理；更新检查节流未实测）。
