# 米兰美术馆 · 升级优化机会审计

**日期**：2026-10-10
**对象**：`iloat20/milan-photos`（本地工作区 = HEAD `8d90bde`）
**线上**：https://iloat20.github.io/milan-photos/
**方法**：静态审读 + 实测探针（Playwright / curl / GitHub Actions API / 本地构建与测试套件）
**约束**：本报告只做分析，未修改任何产品代码

---

## 0. 结论先行

三项发现按影响排序：

1. **P0 — 当前源码状态下站点不可用且不可发布。** HEAD 构建出的页面 **展厅 0 卡片、序厅 0 画面**，且**不报任何错**。项目自带的 34 项 e2e **仅 3 项通过（31 项失败）**。根因是 manifest 响应体被两个消费者二次读取（`TypeError: body stream already read`）。
2. **P0（派生）— 线上已冻结 7 天。** CI 与 Deploy 自 **2026-10-07** 起连续失败，最后一次全绿是 **2026-10-03 的 `62a60e5`**。`deploy.yml` 的门禁（复用 `ci.yml`）正确拦住了坏版本，代价是 10-03 之后的 5+ 次提交全部未能上线。
3. **P1 — 内容与 SEO 是长期最大缺口，且部分是「已有资产未释放」。** 18 件作品中 10 件无标题（显示为《无题 · NN》）；`meta.json` 里 8 条已写好的策展说明（caption）**从未被任何渲染点读取**；全站只有 1 个可索引 URL。

一句话：**先修 P0 恢复发布能力，再用「零内容成本」的改动释放已有价值，最后才是新增功能与性能打磨。**

---

## 1. 实测证据汇总

| 检查项 | 方法 | 结果 |
|---|---|---|
| 展厅卡片数（HEAD 构建） | `npx playwright test` | **0**（期望 18） |
| 全量 e2e | `npx playwright test`（34 项） | **3 passed / 31 failed**（55.7s） |
| manifest 请求结局 | 页内 `Response.prototype.json` 埋点 | 第 1 次 `json:ok`（t=77ms）→ 第 2 次 **`TypeError: body stream already read`**（t=82ms） |
| 根因定位 | `window.__lf` 时间线 | `["start","fetch-throw:TypeError","fallback-miss","outer-catch:manifest unavailable","done:0"]` |
| 控制台表现 | `pageerror` / `console` 监听 | **零错误、零告警**（静默失败） |
| 线上是否受影响 | 同一探针跑线上 | 不受影响：`cards=18`、`lf=[...,"done:18"]`（线上是回归前的旧构建，`app.js` 31,399 B vs 本地 32,412 B） |
| CI 状态 | GitHub Actions API | `ci.yml` / `deploy.yml` 自 2026-10-07 起全部 `failure`；最后成功 `62a60e5` @ 2026-10-03T22:26Z |
| 单元测试 | `npm run test:unit` | 36 / 36 通过（510 ms） |
| Lint | `npm run lint` | ESLint + Stylelint **全绿**（修复无关：初次测量的 110 个错误全部来自本次探针临时文件，已清理后复测） |
| 主题闪烁 | 逐帧 rAF 采样（线上） | t=1173 / 1208 ms 两帧文档底色为 **rgb(255,255,255)**（已存 dark 主题未生效）；t=1230 ms 才落到 `data-theme=dark`；FCP=1240 ms |
| 产物体积 | `ls` / `du` | `dist/` 11 MB；`app.js` 32,412 B；`styles.css` 25,902 B；母版 5.3 MB 全部进产物 |
| 缩略图体积 | 逐文件统计 | 400 档 18 张合计 **137.3 KB**（均 7.6 KB）；medium AVIF 9 张 0.64 MB（均 72.3 KB） |
| 敏感信息 | 全仓正则扫描 | 未发现硬编码 token / 私钥 |
| caption 渲染点 | 全仓 grep | `caption` 仅出现在 `app.js` 的类型注解与「拷贝进对象」处，**无任何展示点** |

> 复现注意：本沙箱的批量删除守卫会在 `npm run build` 清空 `dist/` 时中断（`dist/photos` 157 个文件 > 阈值 50）。完整套件需先 `mv dist dist.bak` 再跑。

---

## 2. P0：阻断发布的两个问题

### 2.1 清单响应体被二次读取 → 全站静默白屏

**故障链**

1. `index.html:60-62` 在解析期发起 `window.__milanManifest = fetch("photos/manifest.json", {cache:"no-store"})`。
2. `index.html:72-91` 又挂了第二个消费者，为序厅 LCP 图做解析期预载：`.then((res) => (res && res.ok ? res.json() : null))` —— **这里读掉了 response body**。
3. `app.js:957-961` 复用同一个 Promise 并再次 `await res.json()` → **`TypeError: body stream already read`**。
4. `app.js:1020-1023` 的 catch 把 `folderPhotos` 置空；`galleryReady = true` 后走空状态分支 → 骨架屏隐藏、显示「展厅尚未布展」，`rebuildPhotos` 从未被调用，因此**序厅也一并消失**。

**为何线上没事、本地必现**：线上跑的是 `62a60e5`（10-03）的构建，其 `index.html` 里只有第 1 步（发起请求），**没有第 2 步那个预载消费者**（已用 curl 抓取线上 HTML 逐段比对确认），所以只有一个读者。回归由 **`96a287e`「feat: React 19 + Zustand + Tailwind + TypeScript + Vite重构」**引入 —— 该提交名义上是 React 重写，实际也改了 vanilla 版 `index.html`。

**修复方案（建议 A）**

- **A. 一行最小改动（推荐）**：把内联脚本改为读副本 —— `res.clone().json()`。`clone()` 必须在 body 被读前调用，此处顺序天然安全；`app.js` 无需改动。
- **B. 结果缓存**：内联脚本解析后写 `window.__milanData`，`app.js` 优先读它，Promise 只当启动器。多一个全局约定，可读性略好。
- **C. 彻底去重**：序厅预载串由构建期注入 HTML，取消第二个运行时消费者。改动面最大，收益是少一次 JSON 解析。

**回归网（把本次探针固化成断言）**：在 `tests/e2e/smoke.spec.js` 增加一条 —— 页面加载后断言 `(await window.__milanManifest).bodyUsed === false`。它精确锁定「不得有第二个消费者」，比「卡片数 = 18」更早失败、更直接指向根因。（现有「首页渲染 18 张卡片」用例已能拦住本缺陷，保持即可。）

### 2.2 仓库卫生：半成品 React 重写与调试残留

`git status` 与 `git ls-tree HEAD` 显示：

| 类别 | 内容 | 状态 |
|---|---|---|
| 被跟踪但工作区已删 | `src/App.tsx` `src/main.ts` `src/store.ts` `src/state.ts` `src/render.ts` `src/events.ts` `src/image.ts` `src/util.ts` | 未提交的删除（HEAD 里仍是死代码） |
| 被跟踪的重写脚手架 | `index.rewrite.html`、`package.json.new`、`package-update.json`、`tsconfig.json`、`vitest.config.ts` | HEAD 中，无人引用 |
| 曾被提交的调试产物 | `tmp-chain.cjs` `tmp-lcp-probe.mjs` `tmp-metrics.cjs` `tmp-img-audit.cjs` `tmp-*.out/.err` | 工作区已删，未提交 |
| 过期文档 | `BUILD-OPTIMIZATION.md`（未跟踪）称「app.js 76,843 B → 应降到 <30 KB」，而构建产物已是 32,412 B；其建议拆出的 `gallery.js`/`carousel.js`/`upload.js` 从未存在 | 建议删除或改写 |
| 被覆盖的决策记录 | `tech-decision.md` 仅剩一行（且处于 `M` 状态） | 需恢复或明确废弃 |
| 其余 | `images/*.ts` 之外的 `src/package.json`、`lightbox.js`、`install.js`、`util.js` 为在用模块 | 正常 |

**风险**：工作区脏且夹杂死代码，会让「修完 P0 后提交什么」变得不确定 —— `git add -A` 会把删除和残留一起打包。建议先做一次**纯卫生提交**（删残留、删 tmp、恢复/移除过期文档），再提交 P0 修复，两件事分开，便于回溯。

---

## 3. 功能维度

| 编号 | 机会点 | 现状证据 | 预期收益 |
|---|---|---|---|
| F-1 | **释放策展说明** | `photos/meta.json` 8 条 caption 已写好、已进 manifest（`app.js:991`），但 `index.html` 的观画室只有 `.lb-title`，**无任何渲染点** | 8 件作品的叙事从 0 → 可见；零新增内容成本 |
| F-2 | **作品标题补全** | 10/18 条 title 是原始文件名，被 `displayTitle()` 统一遮蔽为《无题 · NN》（`src/util.js:34-47`） | 展厅墙签、`alt`、分享卡片全部受益；这是 SEO 与 a11y 的共同上游 |
| F-3 | **策展排序 / 精选位** | 序厅 = `photos.slice(0, 8)`（`app.js:697`），即 manifest 顺序。当前前 5 席恰好是 5 件无题作品 | 首屏（最贵的位置）改为策展可控；需给 manifest 加 `featured` 或 `order` 字段 |
| F-4 | **单件分享** | 深链已存在（`#p=<id>`），但界面无分享按钮 | 低成本激活传播路径 |
| F-5 | **观画室位置指示** | 灯箱无「3 / 18」计数 | 减少「还有多少」的认知负担 |
| F-6 | **EXIF / 拍摄信息** | 站点无任何相机、镜头、焦距、曝光信息 | 摄影类站点的标准配置；编辑成本低（sync 阶段可提取） |
| F-7 | **检索与集合** | 只有按月筛 chip（`collectFilters`），无搜索 / 标签 / 专辑 / 收藏 | 18 张时非必需，50+ 张后成为主要瓶颈 |
| F-8 | **灯箱放映模式** | 无自动播放 | 观展叙事的自然延伸 |
| F-9 | **失败可重试** | 清单失败后只显示「展厅尚未布展」，无重试入口 —— **本例故障正是走到这条路径** | 把静默失败变成可自愈 |
| F-10 | **上传链路简化** | 需在浏览器填 PAT（`index.html:208-211`），单作者场景成本/风险都偏高 | 改为本地脚本 + `git push` 可同时解决 F-10 与 S-1 |

---

## 4. 性能维度

| 编号 | 机会点 | 实测数据 | 预期收益 |
|---|---|---|---|
| P-1 | **母版不进发布产物** | `dist/` 11 MB，其中母版 5.3 MB **从不被访客请求**（`heroSrc`/`lightboxSrc` 只取 medium/thumb/src）；连带 `photos/meta.json` 也无发布价值 | 部署体积 −48%；同时缩小原图被任意 URL 直接抓取的面（含人脸/场景内容） |
| P-2 | **画质档位缺口** | `MEDIUM_MAX_EDGE = 1280`（`tools/photos_lib.py:20`）→ 1280 CSS px 的观画室在 DPR=2 下需要 ~2560 物理像素；9 张原图 ≤1280 干脆不生成 medium | 高分屏观感提升；建议增设 1920–2048 档，并按 `sizes`/DPR 协商 |
| P-3 | **灯箱回落档位错误** | `lightboxSrc = medium \|\| src`（`src/util.js:148-151`）**没有 thumb 兜底** → 9 张无 medium 的图在灯箱加载**原图 JPEG**：`06-neon-window` 原图 179.8 KB vs 缩略 118.7 KB，`08-portrait-silhouette` 54.5 KB vs 21.0 KB（2.6×） | 修正逻辑或补 medium 后，单张省 40–60% 体积且改用 AVIF |
| P-4 | **文档与实现漂移** | `AGENTS.md` 称 `lightboxSrc` 是 `medium \|\| thumb \|\| src`，实际代码无 thumb 分支 | 修正文档，避免后续基于错误契约做决策 |
| P-5 | **SW 版本号靠人工** | `public/sw.js:2` `VERSION = "milan-v49"` 手工递增；忘记递增则 `activate` 不清理旧缓存，SWR 会把新旧文件混进同一缓存键 | 改为构建期注入（git sha / 日期），消除人工纪律 |
| P-6 | **HTML 走 stale-while-revalidate** | `shellSwr` 先回缓存再后台刷新（`public/sw.js:172-206`）。配合「产物不带 hash」的取舍，会出现 **旧 HTML + 新 app.js** 的版本错配窗口 | 导航请求改 network-first（或 revalidate-then-serve），代价是首字节慢几十毫秒 |
| P-7 | **重复构建拷贝** | 每次 `npm run build` 整棵重拷 11 MB `photos/`，并把 `dist/` 全部清空重建 | 构建更快；本沙箱下还直接触发了批量删除守卫 |
| P-8 | **渲染优化未使用** | 展厅卡片无 `content-visibility: auto` / `contain-intrinsic-size` | 长列表（50+ 图）首帧布局成本下降 |
| P-9 | **图像质量参数可调** | `MEDIUM_QUALITY = 78`、`AVIF_MEDIUM_QUALITY = 55`（`tools/photos_lib.py:21,24`）；单张 medium WebP 最大 243.9 KB，AVIF 163.4 KB | 大图档位可再压 15–25% 而视觉差异有限（需 A/B 目视） |
| P-10 | **Lighthouse 门槛不对称** | `lighthouserc.json`：a11y / best-practices / SEO 为 `error = 1.0`，而 performance 仅 `warn ≥ 0.9`；且用 `staticDistDir` 本地静态服务器，**不复现 GitHub Pages 的 TLS/CDN 行为** | 把 perf 提为 error、并补一次真实部署后的审计 |
| P-11 | **缓存策略取舍** | 固定文件名（`app.js`/`styles.css`）→ 无法用 immutable 长缓存；GH Pages 统一 `max-age=600`，回访需重新校验 | 若愿意引入 `?v=<build>` 或改 hash 名，回访可近零请求（需与 SW 契约整体设计） |

---

## 5. 用户体验

| 编号 | 机会点 | 证据 | 预期收益 |
|---|---|---|---|
| U-1 | **主题闪烁** | 已实测：存 dark + 系统 light 时，t=1173/1208 ms 两帧底色为白，t=1230 ms 才生效。主题应用代码在 `app.js:1796-1801`，而 `app.js` 是 `type="module"`（defer）→ `index.html` 的 `<head>` **没有任何阻塞式主题脚本** | 消除窗口底色先白后黑。本次 FCP（1240 ms）晚于生效点（1230 ms），故未出现「深色内容以浅色绘制」；但慢网/慢 CPU 下会退化为真正的内容闪烁。修法：`<head>` 内联一段 3 行阻塞脚本（读 localStorage → 设 `data-theme`） |
| U-2 | 空状态无出路 | `index.html:174` 静态文案，无重试 | 见 F-9 |
| U-3 | 键盘/手势提示 | 灯箱支持 ← → / 双击缩放 / 捏合，但无任何提示 | 新访客发现成本 |
| U-4 | 无 skip-link | `index.html` 无跳到 `#gallery` / `<main>` 的跳转 | 键盘用户每次都要走完整顶栏 |
| U-5 | 观画室位置播报 | `<dialog aria-label="观画室">`，无当前位置语义 | 屏幕阅读器用户不知道在看第几件 |
| U-6 | 离线提示已做 | `app.js:1786-1793` + `sw.js` 缓存 | 保持 |

---

## 6. 界面设计

站点已确立「无字油画馆陈列」+ Apple 式系统语言，方向清晰，**不建议重做视觉**。可打磨项：

| 编号 | 机会点 | 说明 |
|---|---|---|
| D-1 | **小尺寸作品的呈现** | `1700559942072.jpg` 只有 360×360，在展厅卡片被放大后必然发虚。建议为低分辨率条目单独设最小展示尺寸或限制最大放大倍率（`.card.is-feature` 独占整行时更明显） |
| D-2 | 墙签信息层级 | 墙签目前只有「MIL · NNN《标题》」。caption（F-1）上线后需要设计它与标题的层级关系 —— **涉及版式，按项目纪律应先走 brainstorming** |
| D-3 | 观画室信息区留白 | `.lightbox-meta` 现仅一行标题，加入 caption / EXIF 后需要重新分配构图 |
| D-4 | 序厅首屏内容质量 | 见 F-3：首屏是「最贵的一屏」，当前却是 5 件无题作品 |
| D-5 | 空状态文案 | 「展厅尚未布展。将图片放入 `photos/` 后刷新」面向的是站主，不是访客；且这是本次故障的实际落地页 |

---

## 7. SEO

| 编号 | 机会点 | 现状 | 预期收益 |
|---|---|---|---|
| S-1 | **无逐图可索引 URL** | 深链是 `#p=<id>` 哈希 —— **搜索引擎不索引哈希**；全站仅 1 个 URL | 这是最大缺口。图片站的天然流量入口是图片搜索；没有逐图落地页 = 完全没有该入口 |
| S-2 | 结构化数据不完整 | `index.html:35-49` 只有 `ImageGallery`；无 `ImageObject` 数组 | 补齐后可争取富结果 |
| S-3 | `sitemap.xml` 过薄 | 单条 URL、无 `lastmod`、无图片扩展（`image:image`） | 加上 `lastmod` + 图片站点地图是低成本高杠杆项 |
| S-4 | 标题/描述 | 10/18 作品的 alt 与墙签是《无题 · NN》（见 F-2）；页面 `meta description` 为固定泛化串 | 标题补全后 SEO 与 a11y 同时受益 |
| S-5 | `og:image` 静态 | 固定 `assets/og.jpg`，与内容无关 | 分享到微信/X 时缺乏吸引力；可按作品生成分享卡 |
| S-6 | 主题聚合页缺失 | 只有按月筛选（`#f=2026-09`，同为哈希） | 分类/标签聚合页是可持续增长的可索引页面 |
| S-7 | 无自有域名 | 挂在 `github.io/milan-photos/` 子路径 | 影响品牌与部分 SEO 信号；同时所有 canonical / og 绝对 URL 都硬编码该域，迁移时需统一替换（建议抽成构建期常量） |

---

## 8. 安全性

| 编号 | 机会点 | 证据 | 风险 / 收益 |
|---|---|---|---|
| SEC-1 | **PAT 明文存 `localStorage`** | `GH_KEY = "milan-gh-sync"`（`app.js:1342-1358`），明文 JSON 写入 `localStorage` | 任意 XSS 或恶意浏览器扩展可直接读取；建议改为**细粒度 PAT 仅限本仓库 `Contents: Read and write`**（当前 UI 把 classic `repo` 放在首位提示，权限过大），或按 F-10 移除浏览器端上传 |
| SEC-2 | **无 CSP** | `index.html` 无任何 `http-equiv="Content-Security-Policy"` | GH Pages 无法下发响应头，但可用 `<meta>` CSP；因存在内联脚本，需为它生成 sha256 hash（正好与 U-1 的主题内联脚本一并处理） |
| SEC-3 | 缺安全响应头 | GH Pages 不支持下发 `Referrer-Policy` / `X-Content-Type-Options` / COOP/COEP | 平台限制。若要头部能力，需迁到 Cloudflare Pages / Netlify |
| SEC-4 | 无依赖治理配置 | 仓库无 `.github/dependabot.yml`（仅靠 GitHub 默认告警）、无 `SECURITY.md` | 供应链与漏洞披露渠道 |
| SEC-5 | 无 LICENSE | 仓库根无 LICENSE 文件 | 公开仓库的权利边界不清 |
| **SEC-6** | **正面结论** | 全仓扫描无硬编码密钥；GitHub API 仅向 `api.github.com` 发 `Bearer`，不外泄第三方；渲染全程 `textContent`（`filterBar`/`gallery` 的 `innerHTML=""` 仅用于清空），无用户内容注入点 | 当前暴露面可控，风险集中在 SEC-1 |

---

## 9. 优先级总表

| 优先级 | 项 | 维度 | 改动量 | 预期收益 | 依赖 |
|---|---|---|---|---|---|
| **P0** | 修复 manifest 二次读取（§2.1） | 功能/可用性 | 1 行（方案 A） | 恢复 18/18 渲染；解除发布阻断；e2e 从 3/34 → 34/34 | — |
| **P0** | 仓库卫生提交（§2.2） | 工程 | 小 | 让后续提交边界清晰，避免死代码与删除混入 | — |
| **P0** | 恢复 CI 绿 + 重新部署 | 发布 | 0（随前两项） | 线上从 10-03 版本追上 HEAD（已积压 5+ 提交） | 前两项 |
| **P1** | 释放 caption（F-1） | 功能/UX | 小 | 8 条策展文案从 0 → 可见；零内容成本 | 需先定版式（走 brainstorming） |
| **P1** | 主题闪烁（U-1） | UX | 3 行内联脚本 | 消除白底窗口；慢设备上避免内容闪烁 | 与 SEC-2 的 CSP hash 一并做 |
| **P1** | 标题补全 10 件作品（F-2） | 内容/SEO/a11y | 纯内容 | 墙签、`alt`、分享卡、图片搜索同时受益 | — |
| **P1** | 逐图可索引 URL（S-1 + S-3） | SEO | 中～大 | 打开图片搜索这一最大自然流量入口 | 需先定 URL 形态与路由方案 |
| **P1** | SW 版本构建期注入（P-5） | 性能/可靠性 | 小 | 消除「忘记抬版本 → 新旧缓存混用」的人工纪律 | — |
| **P1** | 灯箱档位修正（P-3 + P-4） | 性能/正确性 | 小 | 单张省 40–60%；修正文档漂移 | — |
| **P2** | 高分辨率档位（P-2） | 性能/设计 | 中 | 高分屏观感提升 | 影响 sync 脚本与 manifest 契约 |
| **P2** | 母版移出产物（P-1） | 性能/隐私 | 小 | 部署体积 −48% | 影响 e2e 对策 5 与 SW 清单核对 |
| **P2** | HTML 改 network-first（P-6） | 可靠性 | 小 | 消除旧 HTML + 新 JS 的错配窗口 | — |
| **P2** | 策展排序字段（F-3） | 内容/设计 | 小～中 | 首屏质量可控 | manifest 契约变更 |
| **P2** | 分享 / 位置指示 / EXIF（F-4/5/6） | 功能/UX | 中 | 传播与观展体验 | F-1 上线后一并做更经济 |
| **P2** | 空状态可重试（F-9） | UX | 小 | 把静默失败变为可自愈 | — |
| **P2** | SEC-1 Token 收敛 | 安全 | 小～中 | 显著降低凭据被盗风险 | 与 F-10 二选一 |
| **P2** | CSP / 依赖治理 / LICENSE | 安全 | 小 | 补齐合规与治理基线 | SEC-2 依赖 U-1 |
| **P3** | 检索/标签/专辑/收藏（F-7） | 功能 | 大 | 藏品 50+ 后成为主要瓶颈 | — |
| **P3** | `content-visibility`、质量参数调优（P-8/P-9） | 性能 | 小 | 边际收益，需实测确认 | — |
| **P3** | Lighthouse 门槛对齐真实部署（P-10） | 工程 | 小 | 断言更贴近线上 | — |
| **P3** | 自有域名 + 绝对 URL 常量化（S-7） | SEO/工程 | 小～中 | 品牌与迁移成本 | — |

---

## 10. 建议的下一步动作清单

严格串行，每步独立可验证：

1. **（P0）确认修复方案**：§2.1 的 A / B / C，建议 A。
2. **（P0）纯卫生提交**：删除 React 残留与 tmp 残留、处理 `BUILD-OPTIMIZATION.md` 与 `tech-decision.md`，单独一个 commit。
3. **（P0）P0 修复 + 回归断言**：应用方案 A，跑 `npm run lint && npm run test:unit && npm run test:e2e`，确认 34/34。建议追加 `bodyUsed === false` 断言。
4. **（P0）推送并观察 CI/Deploy**：确认线上更新到 HEAD。
5. **（P1）进入 brainstorming**：caption 的展示版式、逐图 URL 形态、主题内联脚本与 CSP hash —— 三项都涉及产品或版式决策，按项目纪律先对齐再动手。
6. **（P1）内容侧**：补齐 10 件作品的标题（可与 5 并行，无代码依赖）。

**成本提示**：第 1–4 步为 P0 闭环，改动面极小；第 5–6 步开始引入设计决策，建议逐步确认而非一次性铺开。

---

## 11. 未决与不确定性

- 本次未能测得**完整首访字节数与 LCP**：P0 回归使序厅与展厅均不渲染，性能测量在当前构建下无意义。历史基线（README/AGENTS.md）为 LCP 2180→1900 ms、产物 120 KB→83 KiB，可作为参照但需在修复后重测。
- U-1 未观测到「内容以错误主题绘制」：本次 FCP（1240 ms）晚于主题生效（1230 ms）。结论限定为「窗口底色先白后黑 2 帧（~57 ms）」，在更慢的设备/网络下存在退化为内容闪烁的可能，未做低速模拟验证。
- 完整 e2e 的 31 项失败仅确认「首页渲染」的单点根因；其余用例共享同一渲染前置（需 `.card` 就绪），推断同因，未逐项单独归因。
- CI 失败原因未逐条拉取日志：本地已确定性复现 `npm run test:e2e` 失败，且 Actions API 显示同一 commit 的 CI 与 Deploy 同时 `failure`，与「门禁拦发布」一致。

---

## 12. 事后勘误（2026-10-10，执行 P0 闭环时发现）

本文档保留为审计快照，以下两条以勘误为准：

1. **§10 第 3 步建议的 `bodyUsed === false` 断言不成立。** 修复采用 `res.clone()` 后，被 `app.js` 消费的是**原始** Response，其 `bodyUsed` 本就为 `true`——照该建议实现，修复后断言依然会红。实际落地为「劫持 `Response.prototype.json`，断言无人 `json()` 到已消费的 body」（`tests/e2e/smoke.spec.js`，已红态验证：缺陷版 0 卡必红）。
2. **§10 遗漏一项 CI 阻断。** `库房设置面板走 popover` 的垂直居中断言在 CI 上稳定假红、本地绿。根因：面板开启有 0.24s transform 过渡（`@starting-style` 自 `translateY(10px) scale(0.98)` 起），原断言在**过渡中途**同步读 `boundingBox()`（探针实测偏移 t≈33ms→8.24px、t≈82ms→1.79px，与 CI 报数逐点吻合；用例与过渡同属 `8bab817`，故该断言在 CI 上从未稳定通过）。已改为 `expect.poll` 轮询收敛，并做破坏性红态验证（`:popover-open` 的 `transform` 置 `none` → `Received: 210`）。

P0 闭环实际提交：`648586e`（卫生清理）/ `ae68628`（P0 修复 + 回归锁）/ `0a5d7cd`（popover 断言修复）/ `e2dec7a`（tmp 日志清理）。

后续 P1 设计见 `2026-10-10-theme-csp-caption-perwork-url-design.md`。
