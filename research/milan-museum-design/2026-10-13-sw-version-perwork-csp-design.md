# SW 缓存版本构建期注入 + 逐图展签页 CSP 设计稿

- 日期：2026-10-13
- 状态：**已实施**
- 前置：审计 `2026-10-10-upgrade-opportunity-audit.md` 的 P-5；批次③遗留「逐图页无 CSP」（`2026-10-10-theme-csp-caption-perwork-url-design.md`）
- 对齐方式：两轮问答定案（指纹来源 / 是否处理「刷新两次」），见 §0
- 提交边界：单独一个 commit，`research/` 文档与实施代码分开提交

---

## 0. 决策摘要

| # | 议题 | 决策 | 否决与理由 |
|---|---|---|---|
| ① | SW 版本指纹取自哪里 | **壳层三件套 + `photos/manifest.json`**（sha256 前 8 位） | 仅三件套：`photos/medium/*` 走 cacheFirst（命中即返回、**永不回源**），图片换版将无法失效 —— 真实回归；拆两个版本变量：语义更清楚但要多注入一个变量、多一套清理逻辑，收益不抵复杂度 |
| ② | 「老访客刷新两次」是否一并处理 | **不处理** | 这是壳层 SWR（先给缓存、后台更新）的**有意取舍**，保住离线首访与秒开；改成 network-first 会让弱网首屏变慢。见 §1 的辨析 |
| ③ | 逐图页 CSP 由谁注入 | **生成器自带** | 让 `csp-meta` 插件顺带处理 `dist/p/**`：生成器与它同挂 `closeBundle`，而 Rollup 语义下同钩子是**并行**的（顺序无保证），靠先后是撞运气 |
| ④ | 两条路径的 CSP 指令 | **共用 `tools/csp.mjs` 一份** | 各写一份：将来收紧指令时必然漏掉一侧，而漏掉的那侧**不报任何错**，只是悄悄少一道防护 |

---

## 1. 先纠正一个说法：VERSION 自动化**不能**根治「刷新两次」

上一轮交付说明里写过「顺带把这次的『刷新两次』问题根治」，这句话不准确，此处更正。

壳层资源走 `shellSwr()`（`public/sw.js:172`）：**先返回缓存、后台再更新**。所以即使版本变了、新 SW 装了、`install` 的 `cache.addAll` 把壳层刷新了，**当次页面早已用旧 CSS 渲染完毕** —— 下一次导航才会拿到新壳层。要让它当次生效，只能把壳层改成 network-first，而那会让离线首访与秒开一起消失。

**VERSION 自动化的真实收益**是另外三条：

1. **`sw.js` 字节随内容变化** ⇒ 该重新 install 的时候一定会重装（此前忘了抬版本时，sw.js 字节不变，浏览器不 install，壳层只能靠 SWR 逐条兜）；
2. **缓存名与内容对齐**，排障时 `caches.keys()` 直接可读；
3. **不再依赖人手记得递增** —— 而「忘了改」正是这件事要消灭的。

## 2. 指纹为什么必须含 `manifest.json`

`photos/medium/*` 走 `cacheFirst`（`public/sw.js:121-141`）：命中即返回、**永不回源**。也就是说，图片换了内容而缓存名不变时，访客会**无限期**看到旧图 —— 换缓存名是它唯一的失效手段。

图片的取用集合与尺寸都写在 `manifest.json` 里，所以它必须进指纹。代价是改 `caption` 也会换一次版本、清一次访客的媒体缓存 —— 这是**保守方向**的取舍：宁可多清一次，也不要让旧图驻留。

指纹**不含 `sw.js` 自身**：会自指（改版本 → sw.js 变 → 版本再变，永不稳定）。

## 3. 实现

| 文件 | 改动 |
|---|---|
| `tools/csp.mjs`（新） | `inlineScriptHashes` / `buildCsp` / `injectCspMeta` / `withCsp` —— 指令集合与 hash 规则的**唯一来源** |
| `tools/sw-version.mjs`（新） | `computeBuildId` / `injectBuildId` / `BUILD_ID_PLACEHOLDER`（`__MILAN_BUILD_ID__`） |
| `public/sw.js` | `VERSION` 改占位符；`OWNED_CACHE_RE` 放宽为 `/^milan-(?:v\d+\|[0-9a-f]{8})-(?:shell\|media)$/` —— 两代形状都要认，否则抬版本后旧缓存永远清不掉（e2e 会造 `milan-v0-shell` 验证清理） |
| `tools/gen_work_pages.mjs` | `renderWorkPage` 的返回值外层套 `withCsp(...)` |
| `vite.config.js` | `cspPlugin` 与新的 `swVersionPlugin` **合并为一个 `finalizePlugin`** |

### 3.1 为什么必须合并成一个插件

`finalizePlugin` 顺序做两件事：① 给 `dist/index.html` 注入 CSP；② 读**最终**产物算指纹、写进 `dist/sw.js`。

- 拆成两个插件就失去顺序保证（`closeBundle` 并行）：② 可能读到「CSP 注入前」的 `index.html`，于是**同一份源码在不同构建里得到不同指纹**。不确定的指纹比没有指纹更糟。
- ① 与 ② 的顺序也不能反：指纹要覆盖 ① 改过的字节。

`manifest.json` 读的是**仓库源**而非 `dist/` —— `copyStaticPlugin` 同样挂在 `closeBundle`，此刻拷没拷完不确定；而它是原样拷贝，两份内容必然相同。

### 3.2 逐图页 CSP 的 hash 里包含 JSON-LD

`inlineScriptHashes` 抓的是「所有无 `src` 的 `<script>`」，因此每张展签页会得到 **2 个 hash**（主题初值 + JSON-LD 数据块）。浏览器是否要求给数据块算 hash 由实现决定 —— **写多无害**（只是允许了一个不存在的需求），**漏写可能被拦**。方向选保守的一侧。

## 4. 验收

### 4.1 数值

```
csp-meta: 注入 3 个内联脚本 hash        ← 主页
sw-version: 注入 milan-73e902ed
work-pages: 生成 18 个展签页 + sitemap.xml

dist/sw.js:                        const VERSION = "milan-73e902ed";
dist/index.html:                   含 CSP（3 个 hash）
dist/p/<slug>/index.html:          18/18 含 CSP（每页 2 个 hash）
```

指纹稳定性：两次独立构建（含一次破坏—还原往返）都得到 `milan-73e902ed`。

### 4.2 逐图页目视（`01-city-rain`）

`data-theme` 未设（系统默认、无 localStorage，符合预期）；画心取到 `/photos/thumbs/01-city-rain.avif`；**CSP 运行时违规 0、失败请求 0**；版式完全来自外链的 `../../styles.css` —— 证明 `style-src 'self'` 不影响外链样式。

### 4.3 红态（两条，均决定性）

| # | 破坏 | 结果 |
|---|---|---|
| ① | 把 `renderWorkPage` 的 `withCsp(...)` 撤掉 | 源码与产物均自检 `CSP 出现 0 次`；e2e 红于 `expect(meta).not.toBeNull()` → `Received: null`（展签页没带 CSP） |
| ② | 把 `computeBuildId` 的四份输入改成三份（去掉 manifest） | 单测 `not ok 52 - computeBuildId：四份输入每一份变化都会换指纹（含 manifest）`、`pass 81 / fail 1`；产物版本变成 `milan-fea1e003`；e2e 红于「版本号与四件套重算不符」 |

### 4.4 回归

`npm run lint` 干净；unit **70 → 82**；e2e **46 → 49**。

## 5. 遗留

- 入场动画在每次换图时重播（上一批遗留，未动）。
- 4× 放大裁切后无方位提示（上一批遗留，未动）。
- **改 `caption` 会换 SW 版本**（§2 的代价）。若将来嫌吵，可把指纹的 manifest 部分收窄到「资源字段」，但那是另一件事。
