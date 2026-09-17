# 米兰 · 照片

纯静态照片墙，可 GitHub Pages。图片放进 `photos/` 即可，无需改数据文件。

## 本地预览（推荐，自动扫描）

```powershell
python tools/serve.py
```

打开 <http://127.0.0.1:8080>。

把新图丢进 `photos/` 后**直接刷新**页面就会出现，不用跑同步脚本。

## 添加照片

### 本地 / 仓库文件

1. 图片放进 `photos/`（jpg / png / webp 等）
2. 本地：用上面的 `serve.py` 预览并刷新
3. 推送到 GitHub 后，Actions 会自动更新 `photos/manifest.json`，Pages 站点刷新即可

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
index.html
styles.css
app.js
photos/                 原图 + meta.json + manifest.json
photos/thumbs/          列表缩略图（WebP ≤1200px）
photos/medium/          灯箱用中尺寸（WebP ≤1600px）
tools/serve.py          本地自动扫描预览
tools/sync_photos.py    生成 manifest + 缩略图 + 中尺寸（Actions 使用）
.github/workflows/      推送后自动同步清单
```

## 功能

- 单行 sticky 顶栏
- 全屏轮播（不拉伸，仅预载当前/前后张 medium）+ 等高 justified 图库 + 沉浸灯箱
- 指针事件统一滑动（触控 / 鼠标拖拽）
- WebP 响应式缩略图（400/800/1200 srcset）+ 中尺寸灯箱图（~1600px）+ 懒加载 + View Transitions
- Service Worker 离线缓存（媒体 LRU 上限）+ Priority Hints（fetchpriority）
- `photos/` 自动上墙（本地 serve / GitHub Actions，日期优先取 EXIF）
- 支持 GIF / 动图：列表显示静帧 + 角标，灯箱播放原文件
- 页面内本地上传（上传前客户端压缩为 ≤2048px WebP；GIF 保留原文件）
- 支持 `prefers-reduced-motion`
