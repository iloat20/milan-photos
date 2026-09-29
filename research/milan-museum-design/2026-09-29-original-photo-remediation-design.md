# 原图治理与历史重写（2026-09-29）

> 经 brainstorming 流程确认。范围：
> ① 关闭原图 EXIF GPS 的**公开泄露**；② 削掉**从不被访客下载**的 73 MB 部署体积；
> ③ 重写 git 历史，清除已进入公开仓库的大图。
> 不在范围：字体子集瘦身（P2）、minify（P3）、8 张 1024×901 缺 medium（P3）——另行排期。

## 1. 问题与证据

### 1.1 隐私泄露（P0，实测坐实）

18 张原图中 **5 张带 GPS EXIF**：`IMG20260817155311` / `IMG20260817155358` /
`IMG20260916193647` / `IMG20260916193836` / `IMG20260916193852`。

原图被 git 跟踪且随 GitHub Pages 公开发布，可直接按 URL 取回：

```
$ curl -I https://iloat20.github.io/milan-photos/photos/IMG20260817155311.jpg
HTTP/1.1 200 OK
Content-Length: 30749827
```

拉回后解析得到：

| 字段 | 值 |
|---|---|
| GPS | 30.13194, 118.16275 |
| 设备 | OPPO Find X9 |
| 拍摄时间 | 2026:08:17 15:53:11 |

`robots.txt` 为 `Allow: /`，无任何遮挡。

### 1.2 部署体积（P1）

| 项 | 体积 |
|---|---|
| `photos/` 合计 | 81 MB |
| └ 原图 18 张 | **73.28 MB**（91%） |
| └ thumbs | 4.5 MB |
| └ medium | 3.07 MB |
| `.git` | **152 MB** |
| 历史中图片 blob | **144.5 MB / 24 个** |

**原图从不被浏览器请求**——`src/util.js` 的 `heroSrc` / `lightboxSrc` 均为
`medium || thumb || src`，仅 `animated` 才走 `src`，而当前 18 张全是静态 JPEG。
全站对 `photos/*.jpg` 的直接引用只有 `assets/og.jpg`（另一路径）。
因此这 73 MB 是纯部署与工具链负担。

### 1.3 历史（P0 的必要条件）

仓库**公开**（`isPrivate: false`），历史中含 24 个图片 blob / 144.5 MB，
两张 GPS 大图各有 2 个版本。**只修 HEAD 关不掉泄露**——旧 commit 的 blob
在公开仓库里仍可按 SHA 取回（`git show <sha>:photos/IMG20260817155311.jpg`）。

## 2. 关键前提（全部实测，非推断）

1. `MEDIUM_MAX_EDGE = 1600`，且 `ensure_medium()` 在**原图长边 ≤1600 时不生成 medium**，
   灯箱回落原文件 → **降采样必须保留长边 >1600**，否则灯箱反而变糊。
2. 派生图（thumbs/medium）是 PIL 重新编码、未传 `exif=`，实测 `tags=0 / gps=False`
   → **泄露通道只有原图一条**，处理原图即彻底关闭，客户端与派生逻辑零改动。
3. 日期回退链为 `meta.date > manifest 已入馆日期 > EXIF > mtime`（`photo_item` :372），
   故剥 EXIF 不会让展厅筛选漂移。
4. 仓库派生配方：`exif_transpose` → `thumbnail(max_edge, LANCZOS)` → `save(WEBP, q85, method=6)`。
5. `forks=0 / stars=0 / watchers=0`，仓库 12 天、64 提交 → 历史重写无外部克隆受损。

## 3. 参数决策

| # | 参数 | 决策 | 依据 |
|---|---|---|---|
| 1 | 降采样档位 | **长边 2560 / JPEG q85** | 5 张母版 70.65 → 2.66 MB；原图总 73.28 → **5.30 MB（-92.8%）**；展示用 medium 的 PSNR **42.8–43.7 dB**、meanΔ 1.7/255 |
| 2 | EXIF 剥离范围 | **全部剥离** | 5 张重编码后天然无 EXIF，其余 13 张若只去 GPS 则口径不一致、难机械核验 |
| 3 | 母版备份 | **备份到仓库外** + sha256 | 降采样不可逆，备份是唯一回退路径 |
| 4 | 远端残留分支 | **删除** | 两分支各留一份大图，不删则重写 main 也关不掉泄露 |
| 5 | 重写工具 | **git-filter-repo** | 本机缺失、`java` 可用（BFG 备选）；语法清晰、支持 `--path --invert-paths` |

降采样实测对照（往返测量：medium 从**落盘后的母版**再派生，非内存估算）：

| cap / q | 5 张母版 | 原图总计 | medium PSNR |
|---|---|---|---|
| 2048 / 85 | 1.76 MB | 4.39 MB | ~41.5 dB |
| **2560 / 85** | **2.66 MB** | **5.30 MB** | **~43 dB** |
| 3200 / 85 | 4.07 MB | 6.70 MB | ~44 dB |

## 4. 执行顺序（不可调换）

1. **备份** 5 张原母版到 `C:/Users/Administrator/milan-photo-masters-backup-20260929/`，
   生成 sha256 清单并校验
2. `tools/sanitize_photos.py` 从 `wip/photo-sanitize` 迁入 main（护栏脚本，先取后用）
3. 降采样 5 张 + 全 18 张剥 EXIF；日期固化进 `photos/meta.json`
4. 本地跑 `sync_photos.py` 重生成 thumbs / medium / manifest
5. **逐张比对** date（必须完全相同）、palette（差异须在量化步长内）、宽高比
6. `lint` / `test:unit` / `test:e2e` 全绿 + 灯箱与序厅改前改后截图
7. 提交；`sw.js` VERSION 按需上抬（本批不改源码，理论不需要，需核实）
8. **临时 clone 预演** `git filter-repo --path photos/ --invert-paths`，
   验证历史零图片 blob、工作树逐字节一致
9. force-push main → 删远端 `dependabot/github_actions/actions/setup-python-7`、
   `fix/bug-fixes` → 向 GitHub 申请清理悬挂对象
10. 线上复测：原图 URL 路径**不变**（是内容被替换），故预期 200 + **降采样后的体积** + 无 GPS EXIF

**历史重写形态**：整目录移除而非逐文件匹配——`--path photos/ --invert-paths` 后，
全部历史零图片 blob，再把清理后的 `photos/` 作为**单个提交**加回。
判据可机械核验：`git log --all --objects | ...` 一秒判定无图片 blob。

## 5. 验证判据

| 判据 | 期望 |
|---|---|
| manifest `date` 逐张比对 | **完全相同** |
| manifest `palette` 逐张比对 | 差异在 CSS 量化步长内（预期 ≤2/255） |
| manifest `width`/`height` | 宽高比不变；5 张变为 1920×2560 等 |
| 原图 EXIF | 18/18 无 GPS、无 EXIF |
| 派生图 | thumbs/medium 逐张仍存在且可解码 |
| 代码质量门槛 | lint clean + unit 全绿 + e2e 全绿 |
| 线上 | 原图 URL 200 且 `Content-Length` 等于降采样后体积（845,515 等）；`curl` 取回的图解析不出 GPS |
| 体积 | `photos/` 81 → 约 13 MB；`.git` 152 → 约 20–30 MB |

## 6. 风险与回退

| 风险 | 处置 |
|---|---|
| 降采样不可逆 | 执行前备份 5 张原母版 + sha256 校验；**备份是唯一回退路径** |
| force-push 后旧 blob 仍可按 SHA 取回 | 向 GitHub Support 申请清理悬挂对象；`forks=0` 使暴露面极小 |
| filter-repo 在非新鲜 clone 上拒绝执行 | 先在临时 clone 预演；正式仓库用 `--force` |
| 删远端分支后无法恢复 | 已确认其 HEAD 全部可达 main（无独有提交），且脚本已迁入 main |
| 剥 EXIF 后 manifest 丢失 → 日期退回 mtime | 日期固化进 `photos/meta.json`（优先级高于 manifest） |

## 7. 不在范围（另行排期）

- `assets/fonts/milan-serif.woff2` 97 KB 单档字重瘦身（P2）
- app.js / styles.css minify（P3，与「零构建」价值观冲突）
- 8 张 1024×901 不生成 medium，灯箱回落 900w 缩略图，放大会糊（P3）
- 按画作的 OG 图 / 分享卡片（P3）

## 8. 执行记录（2026-09-29，已全部完成）

### 8.1 治理（HEAD）

| 项 | 前 | 后 |
|---|---|---|
| 5 张 >2560 母版 | 70.65 MB | **2.66 MB** |
| 原图总计（18 张） | 73.28 MB | **5.30 MB**（-92.8%） |
| `photos/` | 81 MB | 13 MB |

- 全 18 张实测 `exif_tags=0 / gps=False`。**13 张未动的本来就没有 EXIF**，
  故口径天然统一——之前担心的「5 张无 EXIF、13 张保留设备信息」的混合状态并不存在。
- `date` 固化进 `photos/meta.json`（18 条，原有 8 条 title/caption 完好）。
- 一处参数修正：原本建议「全部剥离 EXIF」，实际检查 EXIF 全貌后发现**唯一具备定位性质的
  只有 GPS IFD（内含 `CELLID` 蜂窝基站号）**，其余为 `Make/Model/Software/DateTime`
  等通用设备指纹，而 `DateTime` 本就以 `date` 公开在 manifest 里。若为此给 13 张不超限的图
  做一次 JPEG 重编码，是拿真实画质损失换零安全收益。故 13 张走零像素改动的
  `sanitize_photos.py`；结果为 18/18 零 EXIF，该修正无需保留分歧。

### 8.2 验证

| 判据 | 结果 |
|---|---|
| `date` 逐张比对 | 18/18 **完全不变** |
| `palette`（18 张 × 4 字段 = 72 分量） | 仅 5 个变化，**最大差 3** |
| 宽高比 | Δ = 0.000000 |
| 派生字段（thumb/thumbSrcset/thumbAvifSrcset/medium/mediumAvif） | 零丢失；medium 9 → 9 |
| 派生文件可解码 | 88/88 |
| lint / unit / e2e | clean / **30 / 30** / **27 passed** |
| 真实页面 | 18 张卡片全解码、零 HTTP 错误，序厅与灯箱取到新 medium |

> 过程坑：视觉探针首版未滚动就读 `naturalWidth`，把 4 张**懒加载**图误报为损坏
> （展厅卡片绝对定位 + `loading=lazy`，首屏外不解码）。修正为「滚到底再回顶 + 同步回调
> `waitForFunction`」后全绿。再次印证：新断言必须先做红态/反例验证。

### 8.3 历史重写

本地提交 `25257b4` → 重写后 `c457847` → 回填 photos 后 **`84e7519`**。

| 项 | 前 | 后 |
|---|---|---|
| 提交数（含各分支） | 65 | 53 |
| 历史中 `photos/` 对象 | 222 | 144（**全部来自加回的那一个提交**） |
| 历史中 >1 MB 的 blob | 24 个 / 144.5 MB | **0** |
| `.git` | 157 MB | **14 MB** |
| 远端分支 | `main` + `fix/bug-fixes` + `dependabot/…` | **仅 `main`** |

- 内容零改动：重写前后 `git ls-tree -r HEAD` 逐行 diff，199 条目 **0 差异**（blob 哈希全同）。
- 两个预演已识别的坑在正式执行时都出现且已处理：① filter-repo 把工作树 checkout 成
  「无 photos」，已从仓库外副本恢复；② 它**自动移除了 `origin` remote**，已重新添加。
- 另有一处预演未覆盖的现象：filter-repo 把原来的**远程跟踪分支转成了本地分支**
  （`fix/bug-fixes`、`dependabot/…`），已一并清理。
- 推送用 `--force-with-lease=refs/heads/main:9305b2c…` 锁定远端旧值，避免并发覆盖。
  **未向 GitHub 申请清理悬挂对象**（用户决定）：仓库 `forks=0 / stars=0 / watchers=0`，
  旧 commit 已不可达，实际暴露面极小。

### 8.4 线上复测

| 检查 | 结果 |
|---|---|
| Pages 部署（`84e7519`） | success |
| CI（`84e7519`） | success，含新增的 `Verify photo privacy` 与 `Verify photo master size cap` 两条护栏 |
| 原图 URL `photos/IMG20260817155311.jpg` | 200 / **845,515 B**（原 30,749,827 B） |
| 下载后解析 | 1920×2560，EXIF tag **0**，GPS **false** |
| 其余 4 张带 GPS 的原图 | 均已为新体积（731,074 / 993,941 / 135,498 / 87,750 B） |
| `index.html` / `manifest.json` | 200 / 200 |

### 8.5 回退路径

- **全分辨率母版**：`C:/Users/Administrator/milan-photo-masters-backup-20260929/`
  （5 张 + `SHA256SUMS.txt` + 重写前的 `manifest-before.json`）。这是母版的**唯一**副本。
- **重写前的完整仓库**（含已删除的 `fix/bug-fixes` 分支与旧 `.git`）：
  `%TEMP%/milan-prerewrite-20260929/`，属一次性快照，确认无需求后可删。
