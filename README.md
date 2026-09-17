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

即时上传，仅存在本机浏览器（IndexedDB）。

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
photos/                 照片 + meta.json + manifest.json
tools/serve.py          本地自动扫描预览
tools/sync_photos.py    生成 manifest（Actions 使用）
.github/workflows/      推送后自动同步清单
```

## 功能

- 单行 sticky 顶栏
- 双列图库 + 悬停轻放大 + 沉浸灯箱
- `photos/` 自动上墙（本地 serve / GitHub Actions）
- 页面内本地上传
- 支持 `prefers-reduced-motion`
