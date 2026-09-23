# 米兰 · 照片

纯静态照片墙，可 GitHub Pages。图片放进 `photos/` 即可，无需改数据文件。

当前视觉是**无字油画馆陈列**（艺术指导），不是浅色机构馆藏站：深墙 + 金框 + 极简导航；墙签与说明在 CSS 中刻意隐藏，DOM 仍保留标题/alt 供辅助技术读取。

展厅布局是**规则网格上的金框画心**（CSS Grid + 随画比例的画框），**不是** Flickr 式 justified（等高行、按宽缩放、不裁切）；也**不**依赖 CSS masonry（2026 仍非 Baseline）。列表与灯箱均用 `contain` 完整呈现画心，极端比例时画框内侧以墙面色信箱化。

## 本地预览

```powershell
python tools/serve.py
```

打开 <http://127.0.0.1:8080>。

把新图丢进 `photos/` 后**直接刷新**页面就会出现（serve 对 manifest 做 mtime 戳缓存，变了自动重建），不用跑同步脚本。

## 添加照片

### 本地 / 仓库文件

1. 图片放进 `photos/`（jpg / png / webp / avif 等）
2. 本地：用上面的 `serve.py` 预览并刷新
3. 推送到 GitHub 后：`sync-photos` Actions 生成缩略图/中图/AVIF 并回写 `manifest.json`，`ci` Actions 跑 lint → e2e → Lighthouse，全绿后 Pages 刷新即可

可选：在 `photos/meta.json` 按文件名写标题和说明：

```json
{
  "my-trip.jpg": { "title": "旅途", "caption": "一句说明" }
}
```

### 页面底部「选择图片」

1. 本机自动压缩（最长边 ≤2048px WebP）后写入 IndexedDB 预览（默认）
2. 展开「同步到 GitHub」：填写仓库、分支和有 `Contents: Read and write` 权限的 Token 并保存
3. 之后上传会把压缩图写入仓库的 `photos/` 并更新 `manifest.json`，Pages 构建后线上可见

Token 只保存在当前浏览器的 localStorage，不会提交到仓库。

## 发布到 GitHub Pages

```powershell
git init
git add .
git commit -m "feat: 米兰照片墙"
git branch -M main
git remote add origin https://github.com/<用户名>/<仓库名>.git
git push -u origin main
```

**Settings → Pages**：`Deploy from a branch` → `main` / `(root)`。

之后加图流程：把图片放进 `photos/` → `git add` / `commit` / `push` → 等 Actions 跑完 → 刷新网站。本地不用执行同步命令。

## 目录

```text
index.html                 入口（head 含 og/twitter 卡片与 JSON-LD）
styles.css                 深墙金框设计系统
app.js                     轮播 / 展厅 / 灯箱 / 筛选 / 上传
sw.js                      Service Worker（壳层 SWR + 媒体 LRU + 清单 Network First）
photos/                    原图 + meta.json + manifest.json
photos/thumbs/             列表缩略图（WebP + AVIF，400/800/1200 三档）
photos/medium/             灯箱用中尺寸（WebP + AVIF ≤1600px；原图 ≤1600 时不生成）
tools/serve.py             本地预览（manifest mtime 戳缓存）
tools/sync_photos.py       生成 manifest + 缩略图 + 中尺寸 + AVIF（CI 权威跑）
tests/e2e/                 Playwright 冒烟（7 项）
.github/workflows/         sync-photos（清单回写）+ ci（lint → e2e → Lighthouse）
.github/dependabot.yml     npm + GitHub Actions 每周依赖巡检
AGENTS.md                  项目约定（命令 / 生成物 / 无障碍契约）
research/                  设计研究文档（brief / findings / a11y audit）
package.json               仅 dev 工具（应用本身零依赖零构建）
```

## 工程化与测试

```powershell
npm ci            # 首次
npm run lint      # ESLint + Stylelint
npm run test:e2e  # Playwright 冒烟：AVIF 协商 / manifest / 灯箱 / 筛选 / 轮播 / SW 离线 / 零 console 错误
npm run lhci      # Lighthouse CI（a11y / best-practices / SEO 满分断言）
```

所有 push 都会触发 CI（lint → e2e → Lighthouse）；Dependabot 每周检查依赖与 Actions 版本。

## 工程化与测试

```powershell
npm ci            # 首次
npm run lint      # ESLint + Stylelint
npm run test:e2e  # Playwright 冒烟：AVIF 协商 / manifest / 灯箱 / 筛选 / 轮播 / SW 离线 / 零 console 错误
npm run lhci      # Lighthouse CI（a11y / best-practices / SEO 满分断言）
```

所有 push 都会触发 CI（lint → e2e → Lighthouse）；Dependabot 每周检查依赖与 Actions 版本。

- 单行 sticky 顶栏 + 章节锚点导航（展厅 / 关于 / 库房）
- 半屏重点陈列轮播（pause/play、pointer/focus/hover 暂停、APG Carousel）+ **金框规则网格展厅**（非 justified）+ 沉浸灯箱
- 灯箱为**原生 `<dialog>` + `showModal()`**：Esc/焦点圈闭由 UA 承担、`::backdrop` 遮罩（APG Dialog）；支持双指捏合 / 双击 / 滚轮缩放、单击切图
- 年月筛选 chip（`aria-pressed` + View Transitions 卡片配对动画）
- **URL 深链**：`#f=<年月>` 直达筛选、`#p=<文件名>` 直达某张画的灯箱（可分享、刷新不丢状态）；纯锚点导航不受影响
- AVIF + WebP `<picture>` 协商（缩略图三档 400/800/1200 srcset + 灯箱 ~1600px 中图）+ 懒加载 + View Transitions
- Service Worker 离线缓存（壳层 SWR、媒体 LRU 上限、清单 Network First + install 快照）+ Priority Hints；改前端后须抬 `sw.js` 的 `VERSION`
- `photos/` 自动上墙（本地 serve / GitHub Actions，日期优先取 EXIF）
- 支持 GIF / 动图：列表显示静帧 + 角标，灯箱播放原文件
- 页面内本地上传（上传前客户端压缩为 ≤2048px WebP；GIF 保留原文件）
- 支持 `prefers-reduced-motion`（关闭自动轮播与非必要动效）
- 展厅墙面 `sampleRoomColor()` 随画采样，并钳制墙色亮度以保证金字/象牙字对比度
