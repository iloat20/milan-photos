# AGENTS.md

纯静态 GitHub Pages 照片墙（当前视觉：Apple 式系统语言——系统字体栈 + 中性表面 + 圆角卡片 + 毛玻璃 chrome，亮/暗双主题跟随系统）。**Vite 构建管线**（2026-09-30 起；此前是零构建源码直出）：仓库里是源码，线上是 `dist/` 产物——`vite.config.js` 固定产物名（不带 hash）、`base:"./"`（相对路径，兼容子路径站点）。工程化 dev 工具：Vite / ESLint / Stylelint / Playwright 冒烟 / Lighthouse CI（`package.json` 仅 devDependencies）。入口：`index.html` → `app.js`（构建时与 `src/*.js` 打成单文件，dev 下按 ESM 直服）+ `styles.css` + `public/`（`sw.js` / `manifest.webmanifest` / `robots.txt`，原样拷贝、不做转换）。缩略图与灯箱图走 `<picture>` AVIF/WebP 协商。远端：`git@github.com:iloat20/milan-photos.git`，Pages 由 `deploy.yml` 先复用 `ci.yml` 全量作门禁、再构建 `dist/` 经 Actions 发布（非分支直出）。

## 命令

```powershell
npm run dev                 # Vite dev server → http://localhost:5173（HMR，src/*.js 是独立请求）
npm run build               # 构建 dist/（线上同款产物；e2e / lhci / deploy 都用它）
npm run preview             # 预览 dist/（默认 4173）
npm run sync                # = python tools/sync_photos.py（需 Pillow；通常只由 CI 跑）
python tools/downscale_photos.py [--check]  # 母版长边上限 2560（超限即降采样；--check 只检不写）
python tools/sanitize_photos.py  [--check]  # 字节级剥离 JPEG GPS EXIF（零像素改动；--check 只检）
npm run lint                # ESLint + Stylelint
npm run test:unit           # 纯函数单测（node --test，零新依赖，毫秒级）
npm run test:e2e            # Playwright 冒烟（自动 build + vite preview 起服，34 项）
npm run lhci                # Lighthouse CI（先 build 再审，a11y/BP/SEO 满分断言）
node tools/preview-shots.mjs   # 视觉核对截图（需先起 preview 4173 / dev 5173——dev 用 BASE 指端口；产物 tools/preview-apple-*.png，已 gitignore）
```

- **dev 与产物是两种形态**：`npm run dev` 直服源码（`src/*.js` 独立请求、带 HMR），`npm run build` 才是线上形态（`app.js` 单文件、JS/CSS 已压缩；体积 120KB→83KiB、LCP 2180→1900ms）。**新图上墙 dev 期要先 `npm run sync`**——Vite 读的是**仓库里提交的** `manifest.json`，serve.py 时代的 mtime 自动重建已退役；`photos/` 推上去后 CI 的 sync-photos 会生成并回写。**dev 形态不注册 Service Worker**（`app.js` 的 `isViteDev` 守卫）：Vite dev 对同一 URL 按请求形态返回不同内容——`<link>` 要 `styles.css` 拿裸 CSS，SW 的 `addAll`/页面 fetch 拿到的却是 JS 包装版，两者挤在同一缓存键上互相覆盖，二次刷新必丢样式（实测 `.site-nav` 掉回 static、`cssRules 0`）；且 dev 缓存的是带 HMR 注入的转换形态。产物形态不受影响（dist 是固定裸 CSS，构建时 `import.meta.env.DEV` 静态求值为 false、注册照旧），**SW 行为一律在 preview 形态用 e2e 验证**（「SW 激活」「SW 离线」两测依赖应用自动注册，即产物路径的护栏）。
- 端口：dev 5173 / preview 4173 / e2e 默认 8080（覆盖用 `MILAN_PORT=8099 npm run test:e2e`，webServer 与 baseURL 同源）。e2e 的 preview 用 `--strictPort`：端口被占**直接失败**，不会悄悄换端口硬跑。
- **e2e 有资产来源自检**（`tests/e2e/global-setup.js`），五层，任一不符即中止整个运行：① **新鲜度**——任一源码比 `dist/index.html` 新就先补 `npm run build`（复用本地已起的旧 preview 时靠它兜底）；② **逐字节**——服务返回的 `index.html`/`app.js`/`styles.css`/`sw.js` 与 `dist/` 磁盘文件 sha256 比对，防「端口上是另一个目录的服务，而 `reuseExistingServer` 静默复用了它」；③ **SW 清单完整性**——`public/sw.js` 的 `SHELL_ASSETS` 每一项都要在 `dist/` 真实存在（多列一条 → install 的 `cache.addAll` 整组 reject → 全站悄悄失去 SW）；④ **manifest 能力**——必须带 `thumbAvifSrcset` / `palette`；⑤ **引用完整性**——`index.html` / `manifest.webmanifest` / `robots.txt` 引用到的静态资源（`assets/og.jpg`、512 图标、`sitemap.xml`）必须真实进 `dist`（这类引用走绝对 URL 或 public 内引用、不进 Vite 资源图，漏拷即线上 404，且被 preview 的 SPA 兜底掩盖成本地 200——见 `appType:"mpa"` 注释）。有 ②⑤ 之后，全绿或全红都与本仓库强相关，不再出现「跑的是别人的服务」或「本地 200 线上 404」这种带偏排查的假象。
- 校验 UI：改完跑 `npm run lint && npm run test:unit && npm run test:e2e`，再浏览器核对轮播 / 展厅 / 灯箱 / 手机宽度；留档截图用 `node tools/preview-shots.mjs`（先起 `npm run preview`——默认 4173 与脚本一致，或 `npm run dev`——5173 需 `BASE=http://127.0.0.1:5173`；亮/暗 × 序厅/展厅/灯箱/前言/库房 + 手机宽，共 10 张）。截图类视觉验证前确认窗口前台（rAF ≈16ms）。
- **manifest 必须是完整版**：`dist/photos/manifest.json` 就是仓库里提交的那份（构建只拷贝、不重算）。缺 `palette`/`thumbAvifSrcset` 的降级版只有在**没装 Pillow** 的环境里 sync 才会生成——一旦提交，访客与测试同时受害，症状是红点散落到互不相关的地方；`global-setup.js` 会在开跑前明确报出。**本机解释器状态会漂移**（`python`/`py` 都曾指向过缺 Pillow 的那个；2026-09-30 实测两者同为 3.12.7 且都有 Pillow），别信记忆。CI 在 `setup-python` 后显式 `pip install "Pillow>=11"`，线上不受影响。
- CI 三条链：`sync-photos.yml`（photos/sync 脚本变更时**先治母版**再生成，bot 回写 `photos/` 全量）；`ci.yml`（**所有 push**：母版两条不变量检查 → lint → e2e → lhci；另带 `workflow_call` 供 deploy 复用）；`deploy.yml`（**所有 push**：**gate = 复用 ci.yml 全量，绿了才** `npm run build` → 发布 `dist/` 到 Pages——没有这道门禁时，破坏性提交会先上线、含 GPS 的照片也会照发）。**仓库 Settings → Pages 的 Source 必须保持 GitHub Actions**——改回 branch 模式会让 deploy 失败、线上退回源码直出。

## 数据与生成物

| 路径 | 角色 |
|------|------|
| `photos/*.{jpg,png,webp,gif,avif}` | 原图（源）— **长边 ≤2560px、不含 GPS EXIF**（见下「必做」） |
| `photos/meta.json` | **策展源**：按**文件名**写 `title` / `caption` / `date`；**日期已全部固化在此**。另有可选的 `slug`（逐图页 URL），缺省回退文件名 stem。改了 `title`/`caption` 必须跑 `npm run sync` 才会落到 manifest（`slug` 不进 manifest，由生成器直接读本文件） |
| `photos/manifest.json` | **生成物** — 不要手改；改图后跑 sync 或等 CI。含 `thumbAvifSrcset` / `mediumAvif` / `palette` 字段 |
| `photos/thumbs/` | **生成物** — 列表 WebP + AVIF，档位 400 / 800 / 1200 |
| `photos/medium/` | **生成物** — 灯箱 WebP + AVIF，最长边 ≤1280（原图 ≤1280 时不生成，灯箱用原图） |
| `tools/gen_work_pages.mjs` | 逐图展签页 `/p/<slug>/` + `sitemap.xml` 的生成器（构建期 `closeBundle` 里跑；规则可被单测直接调用） |
| `dist/` | **生成物（gitignore）** — Vite 构建产物，e2e/lhci 的被测对象、`deploy.yml` 的发布物；`photos/` 整棵拷入，另补拷 `assets/`（见 `copyStaticPlugin` 注释）。`dist/p/<slug>/index.html`（逐图页）与 `dist/sitemap.xml` 由 `workPagesPlugin` 生成——**仓库根曾有一份 `sitemap.xml`，已删除**（它只有 1 条 URL，且唯一消费者就是那段拷贝） |

- 动图（GIF 等）**不生成 medium**；灯箱直接播原文件，列表用静帧 + 角标。
- 日期回退链（`photo_item`）：`meta.json` 的 `date` > manifest 的已入馆日期 > EXIF > mtime。剥掉 EXIF 后仍由前两级兜住，故日期不会漂移；**18 张的 date 已全部写进 `meta.json`**，即使 manifest 丢失也只靠 mtime 之外的两级仍然稳定。
- 原图**从不被访客请求**：`src/util.js` 的 `heroSrc` / `lightboxSrc` 都是 `medium || thumb || src`，只有动图才回落原文件。所以母版只是「生成派生图的源 + 留档」，其体积不进入访客的关键路径——这正是它该被限长的原因。
- 上传页可把压缩图写进 IndexedDB 本机预览；GitHub Token 只存浏览器 `localStorage`，勿写入仓库。
- **逐图展签页 `/p/<slug>/`**（`tools/gen_work_pages.mjs`，构建期生成）：每件作品一个静态 HTML——`<img>` + 标题 + 策展说明 + 日期 + prev/next。存在理由是 SEO：站内深链 `#p=<file>` 是**哈希，搜索引擎不索引**，图片搜索入口此前为 0；逐图页同时让社交分享拿到**逐图**卡片（`og:image` = 该作中图）。改版式时注意三点：① 页面在 `/p/<slug>/` 下，所有资源引用都要 `../../` 前缀（`<picture>` 的 404 会**静默回落**到 `<img src>` 原图，页面看不出坏）；② slug 冲突**报错退出**，不静默去重；③ prev/next 首尾**不绕环**（爬虫看到环即断链判据失效）。

## 必做：母版的两条不变量（长边上限 + 无 GPS）

`photos/` 下的源图会随 Pages 公开发布，且可被任意 URL 直接取回。因此有两条硬约束，**由 CI 在每次 push 时强制**：

1. **长边 ≤2560px**（`tools/downscale_photos.py --check`）
2. **不含 GPS EXIF**（`tools/sanitize_photos.py --check`）

背景（2026-09-29 治理，见 `research/milan-museum-design/2026-09-29-original-photo-remediation-design.md`）：
入库的 5 张手机原图是 6144×8192 / 29.3 MB 量级，且**带 GPS EXIF 与蜂窝基站号（CELLID）**——
站内展示只用 ≤1280px 的 medium，那 73 MB 原图从未被访客下载，却把拍摄地点公开发布了出去。

新增照片时：

- **上限必须 > `photos_lib.MEDIUM_MAX_EDGE`（当前 1280，全局只此一处定义）**。低于或等于该值时 `ensure_medium()`
  会直接不生成 medium，灯箱回落原文件、**反而更糊**。工具自身对此有断言（`--max` 小于等于该值报错退出），
  阈值的唯一来源是 `photos_lib`：`downscale_photos.py` 就地 `from photos_lib import MEDIUM_MAX_EDGE`
  （它曾自带第三份拷贝 `= 1600`，在 medium 降到 1280 后没跟着改，导致 `--max 1400` 这种合法上限被拒——
  别再复制这个常量）。
- 降采样会**丢弃全部 EXIF**（JPEG 重编码的副作用，也是有意为之的「去定位」路径）；
  对不超限、只想清 GPS 的文件用 `sanitize_photos.py`——它做字节级手术，**不重压缩像素、保留 Orientation**。
  这一区别很关键：8 张 1024×901 的图长边 ≤1280、没有 medium，灯箱**直接加载原图**并依赖 EXIF 方向。
- `sync-photos.yml` 会在生成派生图**之前**先跑这两个工具，并用 `git add -A -- photos` 提交，
  所以新入馆的超限/GPS 图片会被 CI 自动治好后落库，而不是等人发现。

## 必做：src/ 模块的三条约束

`src/*.js` 是**原生 ESM**（dev 下 Vite 按模块直服，构建时打包进 `app.js` 单文件），`tests/unit/*.test.mjs` 直接 import 它们做单测。往 `src/` 加模块或搬函数时：

1. **零副作用**：import 时不得触碰 DOM / `window` / `localStorage` / `matchMedia`。碰了的话 Node 端 `import` 会抛错，单测根本加载不起来 —— 这是 `util.js` 只装纯函数的**唯一**原因。
   依赖 DOM 的域要拆出去，就得先解决状态注入 —— **`lightbox.js` 给出的既有范式：工厂 + 端口注入**。
   `createLightbox(ports)` 在 import 期不碰任何 DOM，只有被调用时才开始用宿主传进来的引用；状态全收进工厂闭包，`app.js` 侧不再有该域的任何 `let`。
   做法：① 纯计算抽成**具名导出**（`clampPan` / `anchorZoom` / `resolveVtSource` …），单测直接 import；② DOM 引用与跨域能力（墙色 / 深链 / 视图过渡 / 预载 / 卡片反查 / 导航序列 / 序厅轮播暂停）走 `ports` 注入，**不**反向 import `app.js`；③ 装配点放在宿主顶部（工厂调用即绑事件，放晚了会撞 `const` 的 TDZ）。
   **按会话注入的能力走 `open()` 的参数，不要做成端口**：视图过渡的「显式源」只对一次序厅点击有效，若做成端口（只能按 photoId 查），从展厅卡片打开灯箱而该画恰好也是序厅当前那张时，卡片源会被序厅画面覆盖。同理，跨 open/close 存活的会话态（如该提供者）留在工厂闭包内。
   仍留在 `app.js` 的 `sampleRoomColor` / `applyRowFit` / `renderGallery` 尚未拆，原因是没有独立状态域或收益不足 —— 拆之前先确认能划出「自成一域 + 有回归网」的边界。
2. **SW 清单只列壳层，且不能多列**：Vite 把 `src/*.js` 打进 `app.js`，旧契约「清单要覆盖 src/ 全部文件」随打包**消失**（新模块自动进包，离线骨架屏那类坑不再可能，**不用**改清单）。现行契约反过来：`SHELL_ASSETS` 必须**恰好**等于构建产物的壳层（`./` `./index.html` `./styles.css` `./app.js` `./manifest.webmanifest`）——**多列**一条产物里不存在的条目（如忘删的 `./src/…`），install 的 `cache.addAll` 会整组 reject，表现为**全站悄悄失去 SW**（页面照常跑，只是不再离线可服务，不炸不报错）。`tests/unit/sw-assets.test.mjs` 钉清单形状（毫秒级、不依赖构建），`tests/e2e/global-setup.js` 对 `dist/` 核对每项真实存在。`isShellRequest()` 曾为 dev 期保留的 `path.includes("/src/")` 分支**已删**——dev 形态现在根本不注册 SW（见上「dev 与产物是两种形态」），产物里也没有 `/src/` 请求，两边都无人走。
3. **`src/package.json` 的 `{"type":"module"}` 不要动**：仓库根 `package.json` 必须保持**无** `type`（否则 `playwright.config.js` 的 `require` 失效），所以由 `src/` 单独向 Node 声明 ESM 身份；浏览器不读这个文件。

`npm run test:unit` 就是 `node --test`（自动发现 `**/*.test.mjs`，不会误扫 `tests/e2e/*.spec.js`）。写测试注意三个坑：

1. **时区** —— `new Date("2026-09-26")` 按 UTC 午夜解析，在西半球会回退一天，要用 `new Date(2026, 8, 26)` 本地构造。
2. **断言要按实现既有语义写，别按直觉** —— `safeFileName({})` 得到的是 `…-photo`（无扩展名），因为 `(file.name || "photo")` 先兜了底，`"photo.jpg"` 那层兜底只在 base 被清空时才生效（已被 `tests/unit/util.test.mjs` 钉住）。
3. **`page.waitForFunction` 里包 async 回调会假绿** —— 实测同一个「查 SW 缓存里有没有 src/util.js」，在 `page.evaluate` 里返回 `MISS`（正确），包进 `waitForFunction` 却 **29ms 就判 true**。要轮询用 `expect.poll`。更重要的是：**新断言一律做一次红态验证**（临时破坏被测条件，确认它真的会红）——这条假绿断言就是靠红态验证才被抓出来的。

## 必做：Service Worker 版本

改 `index.html` / `styles.css` / `app.js` / `public/sw.js` 后，**必须**把 `public/sw.js` 里的 `VERSION`（当前形如 `milan-vN`）往上抬。否则旧壳层缓存会让线上更新失效。产物名固定不带 hash 正是这条纪律的前提：URL 永远稳定，清单与缓存键才追得上。

历史例外（只换 `assets/fonts/*.woff2` 不抬版本：字体子集是超集缩减、而抬版本会连 `CACHE_MEDIA` 一起清空）**随自托管字体一起退役**——见下「字体」节。现在没有例外：改任何壳层资产都抬版本。

## 字体：系统栈（子集工具已退役）

2026-09-30 起标题不再自托管字体：`assets/fonts/`、`tools/build-font-subset.js`、`tools/font-glyphs.js`、`tests/unit/font-subset.test.mjs` 与 `sw.js` 里的字体快照**全部移除**，`--font` 是纯系统字体栈（Windows 中文衬线走系统回退）。改文案**不再有**「重跑字体生成」这一步（`meta.json` 的 `caption` 自 2026-10-10 起已在观画室题下渲染，见下方 `.lb-caption` 条目；与字体无关）。

历史教训仍有效——将来若重新引入自托管子集，三件护栏必须一起恢复（均被实证明必要）：

1. **字形来源要跟着模块走**：`src/*.js` 也产出可见文案（`displayTitle` 的 `《无题 · NN》`、`ymLabel` 的 `NNNN年N月`），漏扫即同一串文字混排两种字体且页面/脚本都不报错（静默故障）。
2. **要有契约测试**：`tests/unit/font-subset.test.mjs` 曾钉住「来源集合 == 渲染文本集合」；后加文案漏重跑，新字会线上逐字回落 SimSun（实证：上传失败文案里的 `大` / `过`）。
3. **SW 例外要写清理由**：换子集只减不增字形，且「抬 `VERSION` 会连 `CACHE_MEDIA` 一起清空」——恢复子集时这段取舍说明要一起带回（现行政策见上「Service Worker 版本」节）。

## 必做：manifest 新字段要接进白名单

`loadFolderPhotos()` 把 manifest 条目**逐字段拷进新对象**，不在那段映射里的字段会被静默丢弃——不报错、不走兜底，只是功能安静失效。P1-6 的 `palette` 就被这样吞过一次：manifest 里 18/18 都有值，页面却照旧跑客户端采样。

新增 manifest 字段时，除 `photos_lib.photo_item()` 与 `app.js` 的消费点外，**必须**同步改这段白名单。验证也要针对性：断言「颜色不等于初始值」是测不出来的（采样兜底同样会给出非初始值），得断言取值等于 manifest 里的值。

## 必做：CSS 只保留有消费者的选择器

`styles.css` 的每条规则都要有 HTML 或 JS 消费者（`createElement` + `className` / `classList`）。「无字陈列」改造删掉了一批文案节点，样式定义却留了下来 —— P2-1 因此清掉 **218 行**（`styles.css` 1988 → 1770），涉及 `.hero-kicker` / `.chapter-kicker` / `.card-meta`~`.card-medium` / `.lb-index`~`.lb-medium` / `.upload-sub` / `.about-text` / `.footer-museum-en` / `.footer-note` 等。核对选择器是否有消费者，用 `\.selector\s*\{`，参考命令：

```bash
for c in card-title lb-caption footer-note; do
  printf '%s: html=%s js=%s\n' "$c" "$(grep -c "$c" index.html)" "$(grep -c "$c" app.js)"
done
```

三个易踩点（P2-1 实证）：

1. **带缩进的 `@media` 内覆盖最容易漏。** 用 `^\.selector` 锚定行首核对，会漏掉 media query 里缩进两格的同名规则——`.card-meta` / `.card-title` / `.card-caption` / `.about-text` 的窄屏覆盖就是这么漏过第一轮的。核对一律用 `\.selector\s*\{` 且**不限行首**。
2. **`!important` 会反转 `@layer` 优先级。** 同一属性都带 `!important` 时**低优先级层胜出**，判断「哪条赢」不能只看层顺序。现存相关写法：`.hero-carousel-pause[hidden] { display: none !important }`（components 层）压住一切非 `!important` 的 display；给 `[hidden]` 元素补显隐样式时不要用同属性 `!important` 去顶，层序会反噬。当前全文件仅 3 处 `!important`（上述一处 + reduced-motion 的 `animation/transition: none`），新增前先问「不加能不能赢」。
3. **删 CSS 前先确认它是否被 JS 隐式依赖。** 现行实例：`.lightbox-frame.is-lit img { animation: none }`（components）**不可删**——它实际关掉 `.lightbox-img` 的 `lb-in` 入场动画，原位注释（约 `:1091`）已把这条钉住。历史上还清过一批纯 no-op 墓碑（`.hero-art::after` / `.card-media::after` / `.lightbox-frame::after` 的 `content: none`）——可删判据是「全文再无任何地方为这些伪元素定义 `content`」。

## 必做：会被构建管线静默改写的 CSS 声明

`npm run build` 的 CSS 走 **vite 8 + lightningcss**（不是老 vite 的 esbuild，`node_modules/vite/package.json`
的依赖里是 `rolldown` + `lightningcss`）。已实证一条**会静默丢声明**的行为：

- 同一条规则里，**`translate` / `rotate` / `scale` 写在 `transform` 之前** → lightningcss 1.33 试图把它们
  合并进 `transform`，却把值丢了（`minify:false` 也一样丢）；写在 `transform` **之后**才会被正确合并成
  `transform: … translate(-50%,-50%)`：

  ```js
  // node 复现：lightningcss.transform({code, minify:true})
  ".a{translate:-50% -50%;transform:translateY(4px)}"  // => ".a{transform:translateY(4px)}"                 ← 丢了
  ".a{transform:translateY(4px);translate:-50% -50%}"  // => ".a{transform:translateY(4px)translate(-50%,-50%)}" ← 活
  ```

- 后果**不是报错**，是那条声明凭空消失：`.gh-panel` 的居中（`top:50%` + `translate:-50% -50%`）就这么丢过，
  面板整块掉到右下象限，页面照样能开关、肉眼不看截图根本发现不了，只有 e2e 的「面板中心 = 视口中心」
  断言抓得住。
- 三条纪律：① 位移/居中一律写进 **`transform`**，别用独立 `translate`/`rotate`/`scale` 属性；② 改完 CSS
  以 **`dist/styles.css`** 为准核对（源码里有 ≠ 产物里有，`Select-String dist\styles.css translate:` 即可）；
  ③ 定位类新断言先跑一次**红态**——这条 bug 当时正好是活的，断言一加就是 `Received: 209.99…`（恰好半个
  面板宽），修完转绿。

## 必做：三处易复发点（整组重建 / 一次性测量 / 串内格式判定）

2026-10-02 审查确认并修复，三条都由 e2e 护栏钉住（先做红态验证，确认断言真能抓住）：

1. **`renderFilters()` 整组重建要给回焦点**：`filterBar.innerHTML = ""` 会销毁持有焦点的
   chip，键盘 Enter 激活后焦点回落 `<body>`，Tab 位置全丢（APG 要求激活后焦点留在原 chip）。
   现按 `btn.dataset.filterId` 记住重建前焦点归属，重建后用 `focus({ preventScroll: true })` 还回。
   **凡是 `innerHTML = ""` 重建交互控件的函数，都要先问一句「焦点怎么办」。**
2. **序厅高度会变，`heroEnd` 必须重量**：空馆藏/清单失败时 `renderHeroCarousel` 给序厅挂
   `is-empty`（display:none），而 `heroEnd` 只在启动期与 resize 被测 —— `scrollY(0) < 旧值
   （整屏高）` 恒真，`is-at-hero` 常驻，顶栏馆名与序厅大字**同时**从首屏消失（红态实证）。
   现 `measureHeroEnd()` 对 `is-empty` 显式取 0（display:none 的 offset 也是 0，无法与
   「未测量」区分，必须显式判），`renderHeroCarousel()` 收尾调 `syncNavToHero()`，resize 同用。
   **任何「启动期只量一次」的布局常量，先确认它不会随后续 DOM 变化而变。**
3. **preload 的 `type` 判定要拆候选**：srcset 串以宽度描述符结尾（`…-400.avif 300w, …900w`），
   拿整串 `/\.avif$/` 匹配永远不命中 → `type` 从未写上，注释里「不支持该格式的浏览器跳过
   预载」形同虚设。现取**首个候选的 URL** 判扩展名（同一 srcset 由 `photos_lib` 按同一格式
   整体产出）。**凡对 srcset 字符串做正则，先想清楚 `$` 锚在哪个 token 后面。**

## 设计意图（勿当 bug「修好」）

当前是**「无字陈列」+ 亮/暗双主题**（Apple 式系统语言）。「无字」的**现行实现**是墙签默认不可见：`.card-anno { opacity: 0 }`，hover / 键盘聚焦才浮现（`.card:hover .card-anno` / `.card:focus-visible .card-anno`，见 `styles.css:810` 附近注释）。**不要**改成标签常显的馆藏 UI（Met/卢浮宫式一图一签）——那是外部对标结论里的「不建议」项，不是缺陷；亮/暗主题跟随系统（`prefers-color-scheme`）是**有意设计**，也别当成机构风要裁掉。

- **亮/暗主题的唯一事实源是 `light-dark()` + `color-scheme`**（2026-10-01 起）：`:root` 里每个颜色只声明
  **一对** `light-dark(亮, 暗)`；手动切换只写 `:root[data-theme=…] { color-scheme: light | dark }`。
  **不要**再为手动主题写第二套颜色值（2026-10-01 之前同一组颜色在「`:root` / 亮色媒体查询 /
  `[data-theme=light]`」三处各写一遍，是典型的漂移温床），也**不要**用 `@media (prefers-color-scheme: …)`
  做亮色专属覆盖——那种写法只认系统偏好，`data-theme` 手动覆盖时会被静默跳过。实测教训：
  序厅/观画室的亮色「洗淡」原本就写在这样一个媒体查询里，结果「系统暗 + 手动亮」时 body 已是 `#fff`
  而底纹仍是 `rgb(10,10,10)→rgb(0,0,0)` 的黑房间。现两处都用 `light-dark()` 内联进 `background`，
  顺带摆脱了「必须放在 @layer 末尾压住基础值」的源序陷阱。护栏：e2e「手动亮色压过系统暗色…」。
  基线：`light-dark()`（Chrome 123 / Safari 17.5 / Firefox 120）**早于**本站已在用的 `color-mix()`
  与 `content-visibility: auto`，故可硬依赖；装饰性特性仍按惯例包 `@supports`。
- **库房的 GitHub 设置面板是 `<div popover>` + 带 `popovertarget` 的按钮**（2026-10-01 起，不再是 `<details>`）：
  top layer 不受祖先 overflow / stacking 影响，light dismiss 与 Esc 关闭都是 UA 行为 —— **不要**为它写
  keydown。`.gh-panel { display: none }` 是**刻意兜底**：不支持 popover 的浏览器只是打不开它，不能退化成
  「opacity:0 却仍可聚焦」的隐形表单。进出场靠 `@starting-style` + `display/overlay … allow-discrete`
  三者配套，缺一则要么没有入场动画、要么退场被立刻截断。改名或删 `#ghToggle` 要同步
  `tools/preview-shots.mjs`（库房那张截图靠它开面板）。

历史记录：旧版曾用一份 `display: none !important` 清单（藏 `.hero-kicker` / `.chapter-sub` / `.card-meta` / `.lb-index` / `.upload-sub` / `.footer-note` 等）做「无字」，其中多数选择器早已无节点（no-op 声明）。2026-09-30 重绘时**清单连同这些死选择器整体删除**——这些名字**不要**再写成样式定义（写了就是新的死 CSS）。

- 环境光取色：**在 sync 阶段预计算**（`photos_lib.photo_palette()` → manifest 的 `palette` 字段，四值 `wall` / `deep` / `glow` / `accent`），客户端只做样式赋值——卡片写 `--card-wall/--card-glow/--card-accent`（`applyCardPalette`），序厅与灯箱写 `--room-adapt*`（`@property` 注册、过渡平滑，见 `styles.css:27` 附近）。同一张画在卡片／序厅／灯箱共用一套色（P1-6 之前三处各采各的，同画三色）。`app.js` 的 `sampleRoomColor()` 退居**回退**，只服务浏览器内上传的图（`photo.custom`，没有 manifest 条目）。取色会按与前景文字的对比度**压暗**，避免亮画把 chrome 冲没。
- 画框是**中性细边 + 圆角**：卡片 = `--surface` 底 + `2px var(--hairline-soft)` + `--r-lg`，照片再内缩 `--frame-inset: 4px`；灯箱同构（`--frame-pad: 6px` / `--frame-border: 2px` / radius 18px）。**不要**加宽/提亮成装饰性金框或粗边，那会压过画心。
- 环境光晕落在画框**之外**的四周（`.card-media::before`：径向 `--card-accent`、`opacity .45`、`inset: -28px -20px`、`z-index: -1`），**不要**打在画心上；为此 `.card-media` 自身 `overflow: visible` 不裁切，裁切只交给 `.card-media-glass`（管 hover 缩放不出框）。
- 画作标题：文件名像相机默认名时显示 `《无题 · NN》`，否则 `《title》`。
- 观画室的**题下策展说明**（`.lb-caption`，取 `meta.json` 的 `caption`）必须**恒占一行**：`.lightbox-meta` 是 `flex-shrink: 0` 且高度由内容撑开，而空说明确实会遇到（浏览器内上传的图没有 manifest 条目、也就没有 caption；2026-10-10 起馆藏 18 件已全部写完策展说明）—— 空值若用 `display: none`（或干脆不占位），切到无说明的图时上方画框会被挤得**整块跳一下**。空值一律 `visibility: hidden` + `min-height: 1lh`（红态实证：改成 `display: none` 后题名区高度差 26.8px）。护栏是 e2e「题名区高度恒定」那条 —— 只断言「元素不可见」抓不住它。该用例的空说明样本由**页面 JS 层拦 `photos/manifest.json` 自造**（馆藏补齐后清单里已无空样本；该请求归 SW 的 `isManifest` 分支接管，`page.route` 拦不到，故包 `window.fetch`）。取值归 `util.captionText()`（trim 后为空即视为没有，**不**做《无题》式降级）。
- 展厅按「策展」陈列而非均匀网格：每 7 张末张 `.card.is-feature` 独占整行成为一面墙，宽度由 `--fit`（`applyRowFit()` 写入）反算成 `min(100%, 64vh × --fit)`，保证框与画同比例不出卡纸空洞——**不要**为了网格对齐把它改回普通卡。
- 卡片的反馈是「抬升 + 光晕变亮」：hover / 键盘聚焦时 `translateY(-3px)` + `--shadow-2` + 边框提亮到 `--hairline`，光晕同步加压（`.card:hover .card-media::before`）；**不要**加回「轨道射灯」式的顶边受光/锥形投影。字体一律走系统栈 `--font`，**不要**再引入 `--display` / `Milan Serif` / woff2 这类字段。
- 序厅门厅大字在场时顶栏馆名由 `.site-nav.is-at-hero` 隐去、滚入展厅浮现（避免同屏两次馆名）；隐藏用 `visibility` 是为了退出 Tab 顺序，**别**改成 `opacity: 0`。

### 网格与比例（正名）

- 展厅是 **CSS Grid 规则格 + 细边画心**（`repeat(auto-fill, minmax(260px,1fr))`，见 `.gallery`/`:1271`），**不是** Flickr justified（等高行、不裁切凑满宽），也**不是** CSS masonry/grid-lanes。
- 画框 `aspect-ratio` 由 `applyRowFit()` 按画心宽高设定，钳制在约 0.55–1.9；未知尺寸时 CSS 默认 4:3。
- 列表 `.card-media img` 与灯箱均为 `object-fit: contain`：比例与画框不一致时完整显示画心，框内以墙面色信箱化，避免 cover 裁切。
- `README.md` 若再写「justified」即过时，以本节与代码为准。

### 无障碍契约（已按 APG 精修，保持）

- 灯箱：原生 `<dialog>` + `showModal()`（Esc/焦点圈闭由 UA 承担，`::backdrop` 遮罩）；不要回退到手写 inert/Tab 陷阱。
- 轮播：可暂停按钮（`aria-pressed`）、pointer/focus/hover 暂停；`prefers-reduced-motion` 时不自动转。
- 筛选 chip 有 `aria-pressed`；卡片 button 的可见文本须进 `aria-label`。
- Hero/展厅图 `alt` 使用 `displayTitle()`；可见墙签可藏，**等价文本不要删**。

### 灯箱点击手势契约（`src/lightbox.js`）

舞台上的点击与双击共享同一个目标，而 `click` **无法预知自己是不是双击的第一击**。契约如下，改动前先读 `research/milan-museum-design/2026-09-26-lightbox-tap-zoom-design.md`：

- **1× 态单击 = 切下一张**（乐观、立即）；**放大态单击 = 缩回 1×，不切图** —— 后者是 `styles.css` 里 `.lightbox-img.is-zoomed { cursor: zoom-out }` 早已声明的意图，不是新交互。
- **双击 = 回到「连击组起点」的绝对位置，再切缩放**。回退目标是**绝对位置**而非 `step(-1)` 的相对步数 —— 这才是「浏览器何时认定双击都不跳张」的原因。
- **不要用固定时长计时器去猜双击**。旧 `tapTimer` 的 450ms 与浏览器双击窗口（系统可设 200–900ms）不对齐，典型后果是手慢双击跳过两张。现在由 `dblclick` 事件权威裁决，`GROUP_MS = 1000` 只用于「记不记得起点」，没有 `dblclick` 时起点信息不产生任何效果。
- **`step()`（箭头 / 键盘 / 横滑）必须 `resetGroup()`**；`open()` / `close()` 同理。漏了会让挂在旧起点上的 `dblclick` 一次性倒回好几张 —— 这条有专门护栏（e2e「连击组不跨路径泄漏」）。
- **不要用 `e.detail` 判连击**：实测 Playwright 的 `mouse.dblclick` 传 `clickCount:2`、`mouse.click` 传 `1`，该值反映 API 参数而非时序，**在本仓库不可测**。

## Git

- 提交信息风格：`type: 中文描述`，type 常用 `feat` / `ui` / `chore` / `perf` / `photos`。
- `tools/preview-*.png`（含截图工具产出的 `preview-apple-*.png`）是设计过程稿，**已加入 `.gitignore`**，不要提交。
- 推送若因 CI 刚写回 manifest 被拒：`git fetch && git rebase origin/main` 再推；勿 force push `main`。
- 不要手改 bot 管理的 `photos/manifest.json` / `thumbs/` / `medium/` 当作功能提交。

## 环境

- Windows 开发机；Python 经系统 PATH 或 `py` 启动。Photos 处理依赖 **Pillow**（CI 与完整 sync 需要）；无 Pillow 时列表仍可出图，但尺寸 / EXIF 日期 / 动图检测会降级。
- `package.json` + `package-lock.json` 只为 dev 工具（vite / lint / e2e / lhci），**应用运行时零依赖**（产物是纯静态文件）；根 `package.json` 保持**无** `type`（`playwright.config.js` / `vite.config.js` 的 `require` 依赖此）；无 monorepo。`README.md` 里的产品叙事可能滞后于当前博物馆 UI——**以代码为准**。
