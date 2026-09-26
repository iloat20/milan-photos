# AGENTS.md

纯静态 GitHub Pages 照片墙（当前视觉：油画馆陈列）。**无打包/构建步骤**（源码直出）；工程化 dev 工具：ESLint / Stylelint / Playwright 冒烟 / Lighthouse CI（`package.json` 仅 devDependencies）。入口：`index.html` + `app.js` + `styles.css` + `sw.js`。缩略图与灯箱图走 `<picture>` AVIF/WebP 协商。远端：`git@github.com:iloat20/milan-photos.git`，Pages 部署 `main` 分支根目录。

## 命令

```powershell
python tools/serve.py          # 本地预览 http://127.0.0.1:8080
python tools/sync_photos.py    # 生成 manifest + thumbs + medium（需 Pillow；通常只由 CI 跑）
npm run lint                   # ESLint + Stylelint
npm run test:e2e               # Playwright 冒烟（自动起 serve.py，5 项）
npm run lhci                   # Lighthouse CI（a11y/BP/SEO 满分断言）
node tools/build-font-subset.js # 改文案后重生成标题字体子集（需网络；不跑则新字逐字回退 SimSun）
```

- 本地预览：`serve.py` 对 `/photos/manifest.json` 做 mtime 戳缓存（`photos/` 变了自动重建），新图刷新即见，**不要**为预览去跑 sync。
- 校验 UI：改完跑 `npm run lint && npm run test:e2e`，再浏览器核对轮播 / 展厅 / 灯箱 / 手机宽度；截图类视觉验证前确认窗口前台（rAF ≈16ms）。
- CI 两条链：`sync-photos.yml`（photos/sync 脚本变更时生成并 bot 回写 manifest/thumbs/medium）；`ci.yml`（**所有 push**：lint → e2e → lhci）。

## 数据与生成物

| 路径 | 角色 |
|------|------|
| `photos/*.{jpg,png,webp,gif,avif}` | 原图（源） |
| `photos/meta.json` | 可选：按**文件名**写 `title` / `caption` / `date` |
| `photos/manifest.json` | **生成物** — 不要手改；改图后跑 sync 或等 CI。含 `thumbAvifSrcset` / `mediumAvif` 字段 |
| `photos/thumbs/` | **生成物** — 列表 WebP + AVIF，档位 400 / 800 / 1200 |
| `photos/medium/` | **生成物** — 灯箱 WebP + AVIF，最长边 ≤1600（原图 ≤1600 时不生成，灯箱用原图） |
| `assets/fonts/milan-serif.woff2` | 标题字体子集（站内 257 字形 / ~95KB / 可变 400–600），`tools/build-font-subset.js` 生成；只含**可见**文本，改文案后重跑 |

- 动图（GIF 等）**不生成 medium**；灯箱直接播原文件，列表用静帧 + 角标。
- 日期优先 EXIF（DateTimeOriginal / DateTime），否则文件 mtime。
- 上传页可把压缩图写进 IndexedDB 本机预览；GitHub Token 只存浏览器 `localStorage`，勿写入仓库。

## 必做：Service Worker 版本

改 `index.html` / `styles.css` / `app.js` 后，**必须**把 `sw.js` 里的 `VERSION`（当前形如 `milan-vN`）往上抬。否则旧壳层缓存会让线上更新失效。

## 设计意图（勿当 bug「修好」）

当前是**无字油画馆**：`styles.css` 末尾用 `display: none !important` 故意藏掉墙签、画作说明、章节 kicker、上传文案、GitHub 面板、页脚说明等。`app.js` 里仍有对应文案节点——那是保留的结构，不是渲染失败。**不要**改成浅色机构馆藏站（Met/卢浮宫式有标签馆藏 UI）——那是外部对标结论里的「不建议」项，不是缺陷。

- 展厅墙面取色：`sampleRoomColor()` 从当前画作采样，写入 `--room-adapt` / `--room-adapt-deep` / `--room-adapt-glow`；采样后会按与象牙字的对比度**压暗墙色**，避免亮画把 chrome 冲没。
- 金框用 box-shadow / border 模拟；光晕应落在墙面（伪元素），**不要**打在画心上。
- 框要退到照片**之后**：框面统一古铜金 `--gilt-dark`、勾边 `--gilt-edge` 再暗一档、框体窄（序厅 7px / 卡片 `--frame-inset` 4px / 灯箱 `--frame-pad` 6px）——**不要**改回亮金 `--gilt` 粗框，那会压过画心；`--gilt` 只留给文字、分页点与 hover 提边。
- 画作标题：文件名像相机默认名时显示 `《无题 · NN》`，否则 `《title》`。
- 展厅按「策展」陈列而非均匀网格：每 7 张末张 `.card.is-feature` 独占整行成为一面墙，宽度由 `--fit`（`applyRowFit()` 写入）反算成 `min(100%, 64vh × --fit)`，保证框与画同比例不出卡纸空洞——**不要**为了网格对齐把它改回普通卡。
- 卡片的光是「轨道射灯」：框顶边受光更亮、锥光落在画框**上方**的墙面、投影向下坠，hover 即打亮；`--display` 字体栈里 `Milan Serif` 是站内字形子集（Windows 无系统中文衬线时兜底），插在 `STSong` 后、`SimSun` 前。
- 序厅门厅大字在场时顶栏馆名由 `.site-nav.is-at-hero` 隐去、滚入展厅浮现（避免同屏两次馆名）；隐藏用 `visibility` 是为了退出 Tab 顺序，**别**改成 `opacity: 0`。

### 网格与比例（正名）

- 展厅是 **CSS Grid 规则格 + 金框画心**（`repeat(auto-fill, minmax(260px,1fr))`），**不是** Flickr justified（等高行、不裁切凑满宽），也**不是** CSS masonry/grid-lanes。
- 画框 `aspect-ratio` 由 `applyRowFit()` 按画心宽高设定，钳制在约 0.55–1.9；未知尺寸时 CSS 默认 4:3。
- 列表 `.card-media img` 与灯箱均为 `object-fit: contain`：比例与画框不一致时完整显示画心，框内以墙面色信箱化，避免 cover 裁切。
- `README.md` 若再写「justified」即过时，以本节与代码为准。

### 无障碍契约（已按 APG 精修，保持）

- 灯箱：原生 `<dialog>` + `showModal()`（Esc/焦点圈闭由 UA 承担，`::backdrop` 遮罩）；不要回退到手写 inert/Tab 陷阱。
- 轮播：可暂停按钮（`aria-pressed`）、pointer/focus/hover 暂停；`prefers-reduced-motion` 时不自动转。
- 筛选 chip 有 `aria-pressed`；卡片 button 的可见文本须进 `aria-label`。
- Hero/展厅图 `alt` 使用 `displayTitle()`；可见墙签可藏，**等价文本不要删**。

## Git

- 提交信息风格：`type: 中文描述`，type 常用 `feat` / `ui` / `chore` / `perf` / `photos`。
- `tools/preview-*.png` 是设计过程稿，**已加入 `.gitignore`**，不要提交。
- 推送若因 CI 刚写回 manifest 被拒：`git fetch && git rebase origin/main` 再推；勿 force push `main`。
- 不要手改 bot 管理的 `photos/manifest.json` / `thumbs/` / `medium/` 当作功能提交。

## 环境

- Windows 开发机；Python 经系统 PATH 或 `py` 启动。Photos 处理依赖 **Pillow**（CI 与完整 sync 需要）；无 Pillow 时列表仍可出图，但尺寸 / EXIF 日期 / 动图检测会降级。
- `package.json` + `package-lock.json` 只为 dev 工具（lint/e2e/lhci），**应用本身零依赖零构建**；无 monorepo。`README.md` 里的产品叙事可能滞后于当前博物馆 UI——**以代码为准**。
