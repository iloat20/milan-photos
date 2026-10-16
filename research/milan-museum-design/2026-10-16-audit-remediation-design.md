# 审计修复批 · 治理与 SEO 收尾（SEC-1/4/5 + S-3；F-6/P-8/S-7 实测定案）

日期：2026-10-16 ｜ 状态：已实施
输入：`2026-10-10-upgrade-opportunity-audit.md` §7/§8/§4 剩余项 + 2026-10-16 复核

## 1. 范围划分（先划清「我能做」与「须用户决策」）

### 1.1 本批自主执行（审计给出明确修法、无交互行为改动）

| 项 | 修法 | 依据 |
|---|---|---|
| **SEC-1** | 库房 Token 提示收敛为细粒度 PAT 优先 | 实测确认审计指认属实：hint 把 classic `repo` 放首位、placeholder `ghp_…` 在前。classic 全仓库读写，权限过大。**纯文案，零行为改动，内联脚本不动 ⇒ CSP hash 不变** |
| **SEC-4** | `.github/dependabot.yml`（npm + github-actions，周更） | 审计 §8：仅靠 GitHub 默认告警，无供应链治理配置 |
| **SEC-5（部分）** | `SECURITY.md`（GitHub 私密漏洞披露渠道） | 审计 §8。**LICENSE 留用户定授权条款，不代选** |
| **S-3（剩余）** | sitemap 图片扩展（`xmlns:image` + `image:loc`） | lastmod 已落地（`467`/`505` 行）；图片扩展是「低成本高杠杆」项的另一半 |

### 1.2 本批实测定案（审计建议在实测面前不成立或暂不成立）

| 项 | 实测证据 | 定案 |
|---|---|---|
| **F-6 EXIF** | 18/18 张母版（`photos/*.jpg`）全部 `NO-EXIF`——不止 5 张手机图，8 张 1024 图同样没有。拍摄信息（DateTimeOriginal/Make/Model/曝光）在母版层已不存在，sync 管线无从保留 | **不可执行**。除非将来补录带 EXIF 的原始母版并改 sync 保留策略；届时重开 |
| **P-8 content-visibility** | 审计自身条件是「长列表（50+ 图）」；现馆藏 18 张，布局成本低于测量噪声（探针读数见 §5）。且 `contain` 会波及墙色采样（`roomJobs` 依赖真实布局矩形）与 e2e 可见性断言 | **暂缓**，等 F-7 藏品 50+ 时随批实测启用 |
| **S-7 绝对 URL 常量化** | 生成器侧已单源：`SITE_URL`（`gen_work_pages.mjs:51`）+ 头注第 18 行「canonical / og:image / sitemap 三处必须自洽，硬编码会让改域名变成三处漏改」。剩余硬编码只有 `index.html` 头部 5 处（canonical / og:url / og:image / twitter:image / JSON-LD url），同文件同值 | **不做构建期注入**：收益＝迁移时少改一个文件（一文件 sed 可完成），代价＝build-finalize 加占位符纪律与顺序敏感改动。**自有域名本身留用户决策** |

### 1.3 留给用户（本批不动）

F-3 策展排序（意图）｜F-4 分享按钮 + E 灯箱两项遗留（交互→brainstorming）｜S-6 聚合页（中批）｜SEC-5 LICENSE（授权条款）｜P-9 质量 A/B（须用户目视）｜P-11 缓存策略（随 SW 契约设计）｜D-1（限倍率 or 补素材）｜8 张 1024 素材（等母版）。

## 2. S-3 图片扩展设计

### 2.1 现状与目标

- 现状：`renderSitemap` 支持 `loc/lastmod/changefreq/priority`；逐图页条目有 `lastmod`（`photo.date`）。
- 目标：逐图页条目追加图片扩展，让 Google 图片搜索直接从 sitemap 拿到每件作品的图：

```xml
<urlset xmlns="…" xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">
  <url>
    <loc>https://…/p/<slug>/</loc>
    <lastmod>…</lastmod>
    <image:image>
      <image:loc>https://…/photos/medium/<file>.webp</image:loc>
    </image:image>
  </url>
</urlset>
```

### 2.2 取值纪律

- `image:loc` = `absoluteUrl(shareImage(photo))` —— **与逐图页 `og:image` / JSON-LD `contentUrl` 同一取值机器**（现存最大派生图，绝不母版）。同一件作品在全站被抓图器看到同一张图，四者同值。
- 主页条目不加 image 扩展（`assets/og.jpg` 是站点分享卡，不是馆藏作品；加了反而把分享卡当作品喂给图片搜索）。
- 命名空间**只在有 image 条目时输出**，且恰好一次。

### 2.3 改动点

1. `tools/gen_work_pages.mjs`：`renderSitemap` 渲染 `image` 字段；`buildWorkPages` 的逐图 entries 附 `image`。
2. 单测（`gen-work-pages.test.mjs`）：命名空间恰好一次 / `image:loc` 转义走同一张实体表 / 无 image 条目时无命名空间 / 真清单下 18 条 image 全指 `photos/` 派生图（`.webp`/`.avif`），**零 `.jpg`**（P-1：母版已不在产物）。
3. e2e（`smoke.spec.js` 既有 sitemap 用例扩展）：`image:loc` 计数 = 18；逐条 HTTP 可达（爬虫实际看到的世界）；无 `.jpg`。

### 2.4 红态计划

| 红 | 破坏 | 预期 |
|---|---|---|
| ① | `renderSitemap` 不输出 image 块（源码级破坏 + 自检产物） | 单测「命名空间恰好一次」「image 计数」红 |
| ② | `buildWorkPages` 的 image 回落母版（`photo.src`） | e2e「零 .jpg」红 + HTTP 可达红（母版 404） |

## 3. SEC-1 文案改法

```
label:      Token（仅本仓库 Contents 读写）
placeholder: fine-grained PAT（github_pat_…）
hint:       建议创建细粒度 PAT（fine-grained）：仅勾选本仓库、权限仅
            Contents: Read and write。classic token（ghp_…）授予全部仓库读写，
            权限过大，不建议。Token 只存在这台设备的浏览器里。
```

## 4. 验证门槛

lint + unit（106 → +N）+ e2e（63 → +N）全绿；红态按 §2.4；线上探针核验 `sitemap.xml` 实际输出。

## 5. P-8 探针读数（2026-10-16 实测）

`.workbuddy/scratch/probe-p8.mjs`：首页稳定后连续 7 轮「真实失效布局 → 强制同步布局」，逐轮耗时：

```
cardCount 18 ｜ domNodes 327（全文档）
runsMs [5.6, 5.6, 6.2, 6.4, 7, 7.6, 8.5] ｜ median 6.4 ms
```

全文档（含 18 卡）单次强制布局中位数 **6.4 ms**；`content-visibility: auto` 能省的只是
视口外卡片的布局份额（<6.4ms 的一部分，亚毫秒/帧量级），而代价是 `contain` 会波及
墙色采样（`roomJobs` 依赖真实布局矩形）与 e2e 可见性断言。**定案：暂缓**，等 F-7
藏品 50+ 时随批实测启用 —— 与审计 §4 P-8 自身的适用条件一致。

另：SEC-4 dependabot.yml 实测发现**已存在**（npm + github-actions 周更，配置正确），
审计信息滞后，无需改动；SECURITY.md 已补。
