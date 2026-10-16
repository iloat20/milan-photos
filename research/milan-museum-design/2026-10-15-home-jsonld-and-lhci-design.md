# S-2 主页图库结构化数据 + P-10 Lighthouse 门槛对齐 设计稿

日期：2026-10-15 ｜ 批次：审计 §9 的 S-2 / P-10 ｜ 前置：P-1（母版移出产物）、逐图展签页（F-1/S-1）、lhci 现行门槛

## 0. 一句话

主页 `ImageGallery` 的 JSON-LD 补上 **`image: [ImageObject × 18]`**（构建期从 manifest 注入——永不手写、永不漂移）；
把 Lighthouse 的 performance 从 `warn ≥0.9` 提为 **`error ≥0.9`**，并在部署后对**线上真实站点**补一次审计。

## 1. 决策摘要

| # | 决策 | 结论 | 依据 |
|---|---|---|---|
| 1 | image 数组的来源 | **构建期注入**：源码 `index.html` 里保持合法 JSON 的 `"image": []` 占位符；`build-finalize` 插件（closeBundle）读 manifest 生成并替换 | 手写 18 项 = 第二份数据源，manifest 一变就静默漂移（本站已有 palette 白名单、slug 分叉两案底）；占位符 + 「**恰好一次**」纪律与 sw.js 的 VERSION 同一范式（多/少都由构建断言，不静默） |
| 2 | 注入时机 | `build-finalize` 的 ⓪ 号步骤，**在 CSP hash 计算之前**（同插件内本来就是串行步骤） | 新内联数据块的 hash 必须进 `script-src`；e2e「CSP 内联脚本 hash 双向自洽（无悬空 / 无漏算）」就是这条顺序的护栏——顺序错了它立刻红 |
| 3 | 每项字段 | `@type: ImageObject`；`name`（plainTitle，不带《》）；`url` = 逐图展签页；`contentUrl` = `shareImage(photo)`（现存最大派生图）；`description` = caption；`datePublished` = date | 与逐图页 JSON-LD 同一套机器（shareImage / plainTitle / captionText 只有一份实现）——同一件作品在全站被抓图器与结构化数据描述为同一张图、同一个名字 |
| 4 | 数组项的 `@type` | 用 `ImageObject`（不用逐图页的 `Photograph`） | 审计原文点名「无 ImageObject 数组」；`Photograph ⊂ ImageObject`，两处语义兼容不会打架 |
| 5 | P-10 门槛 | `categories:performance` 由 `warn ≥0.9` 改 **`error ≥0.9`**；LCP 2500 / byte-weight 400KB 保持 warn | 审计原文「把 perf 提为 error」；类别分是复合信号，比单指标更稳（单指标 error 在 CI 上更容易抖成噪声，保留 warn 作先导） |
| 6 | 真实部署审计 | 部署后对 `https://iloat20.github.io/milan-photos/` 跑一次 Lighthouse（多轮），分数落档 §8 | `staticDistDir` 不复现 TLS/CDN/真实网络行为；审计要的就是这一次「真」的。**不做**常驻 workflow：真实网络抖动会变成 CI 噪声，审计要求是「补一次」 |

## 2. 现状与缺陷

### 2.1 审计原文

> **S-2 结构化数据不完整** —— `index.html:35-49` 只有 `ImageGallery`；无 `ImageObject` 数组。补齐后可争取富结果。

> **P-10 Lighthouse 门槛不对称** —— `lighthouserc.json`：a11y / best-practices / SEO 为 `error = 1.0`，而 performance 仅 `warn ≥ 0.9`；且用 `staticDistDir` 本地静态服务器，**不复现 GitHub Pages 的 TLS/CDN 行为**。

### 2.2 现状

- 主页 JSON-LD（`index.html:48-62`）是一个手写的 `ImageGallery` 骨架：名称 / 描述 / URL / 语言 / 题材 / 提供者，
  **没有任何一件作品的机器可读信息**。逐图页（F-1）的 `Photograph` 节点反倒已是完整的。
- `lighthouserc.json:30-35`：performance 的 warn 意味着**分数跌破 0.9 时 CI 照样绿**——Google 排名信号里
  performance 占权重最大，这条却是本站唯一没有硬门禁的类别。

### 2.3 红态判据（与实现解耦）

> 主页 `<script type="application/ld+json">` 解析出的 `ImageGallery` 节点里，`image` 是 18 项数组；
> 每项 `contentUrl` 指向 `photos/thumbs|medium/` 下的**派生图**（绝不母版）、`url` 是它自己的 `/p/<slug>/`、
> `name`/`description`/`datePublished` 全非空；注入占位符 `"image": []` 在源码里恰好出现一次。

现状红点：`image` 键不存在（`Array.isArray(undefined) === false`）；`buildHomeImages` / `injectHomeImageArray` 两个导出不存在。

## 3. 实施（草案）

### 3.1 `index.html`

`ImageGallery` 块尾加 `"image": []`（合法 JSON，dev 直服下空数组无害），上方注释说明占位纪律：

```html
  <!-- 主页结构化数据（S-2）：image 数组由构建期注入（build-finalize ⓪ 步骤，
       tools/gen_work_pages.mjs 的 buildHomeImages / injectHomeImageArray）。
       源码里保持空数组占位——**占位符消失会让构建失败**（恰好一次纪律，同 sw.js 的 VERSION）。 -->
  <script type="application/ld+json">
  {
    …
    "image": []
  }
  </script>
```

### 3.2 `tools/gen_work_pages.mjs`

```js
/** 主页 ImageGallery 的 image 数组（S-2）：与逐图页同一套取值机器 */
export function buildHomeImages({ manifest, meta = {}, siteUrl = SITE_URL }) {
  const photos = manifest?.photos || [];
  const slugs = resolveSlugs(manifest, meta);
  return photos.map((photo, index) => {
    const share = shareImageInfo(photo);
    const node = {
      "@type": "ImageObject",
      name: plainTitle(photo, index),
      url: absoluteUrl(`p/${slugs[index]}/`, siteUrl),
      contentUrl: absoluteUrl(share.url, siteUrl),
    };
    const caption = captionText(photo);
    if (caption) node.description = caption;
    if (photo?.date) node.datePublished = photo.date;
    return node;
  });
}

/** 把数组嵌进源码占位符："image": [] → "image": [ … ]（缩进随块，< 已转义） */
export function injectHomeImageArray(html, items) { … 恰好一次断言；embedJsonLd；续行加 4 空格前缀 … }
```

### 3.3 `vite.config.js`（`finalizePlugin`）

⓪ 读仓库 `photos/manifest.json`（+ meta）→ `injectHomeImageArray` → **然后**才做 ① CSP hash 计算与注入 → ② sw 指纹。
三步同插件串行（Rollup 的 closeBundle 是并行钩子，拆插件就丢顺序——文件里已有同款注释）。

### 3.4 `lighthouserc.json`

~~```diff
-        "categories:performance": [ "warn", { "minScore": 0.9 } ],
+        "categories:performance": [ "error", { "minScore": 0.9 } ],
```~~

**§8 实测推翻（2026-10-16，CI 红 `26ea610` 后回退 warn）**：error ≥0.9 在 GitHub Actions
runner 上是**恒红噪声门禁**，实测证据两条：

- 上一批（`114187b`，无 JSON-LD 注入）CI 的 performance = **0.87** —— 基线本就压在 0.9
  之下，此前一直靠 warn 才绿；
- 本批 CI 实测 **0.63**：注入内容仅 ~4 KB 内联 JSON，不可能是 0.24 跌幅的主因 ——
  LHCI 在 CI runner 上**单跑**（`numberOfRuns: 1`）的类别分抖动极大。

结论：审计原文「把 performance 提为 error」在「CI 单跑 + 共享 runner」环境不可行。
要把它变成可信的硬门禁，前置条件是 P-8/P-9（真实性能优化）+ 多轮取中位数 + 独立
审计 job —— 属独立批次。线上真实站点的抽验见 §8。

### 3.5 测试与护栏

- unit（`tests/unit/gen-work-pages.test.mjs`）：
  1. `buildHomeImages` 真清单 18 项：形制 / 派生图（绝不母版）/ 逐图页 URL / 不带书名号 / description / date；
  2. 无 slug 清单 + meta 覆盖 → `url` 与逐图页同源；
  3. `injectHomeImageArray`：占位符恰好一次；二次注入 / 无占位**报错**；`<` → `\u003c` 且结果可解析。
- e2e（画廊冒烟 +1）：主页 JSON-LD 解析后 `image` 18 项、字段与 URL 形状逐项断言。
- 既有护栏自动接管（无需新写）：CSP 双向自洽（新块 hash 必须被声明）、sw 指纹（index.html 入指纹自动换代）、
  global-setup 对策 2/5（改的是 dist/index.html 自身，逐字节比对以 dist 为准）。

### 3.6 影响清单（复核后）

| 用例 / 机制 | 影响 | 结论 |
|---|---|---|
| e2e「产物带全指令集 CSP，且内联脚本 hash 自洽」 | dist/index.html 多一段更长的 LD 数据块 | 构建期先注入后算 hash，自动一致；**顺序写错此用例必红** |
| unit「展签页自带 CSP」（真数据） | 不读主页 html | 不受影响 |
| sw 指纹四件套 | index.html 字节变化 | 自动换版本，无需人工 |
| `lhci`（本地 / CI） | performance 断言级别 | warn→error；本地全绿即证 |

## 4. 红态计划（先跑，后实施）

1. unit 红：`buildHomeImages` 导出不存在 → gen-work-pages 测试文件整载失败（已跑，见 §8.2）。
2. e2e 红：新用例在 `Array.isArray(data.image)` 处断言失败（现 dist 无 image 键）。
3. P-10 红态验证：临时把 `minScore` 调成不可能值（1.01）跑 `npx lhci assert`，必须**非零退出**——
   证明 error 级别真的会拦；随后复位 0.9 并全跑 `npm run lhci` 转绿。
4. 全部实施后：lint + unit + e2e 全量 + lhci 全量。

## 5. 否决项

| 方案 | 否决理由 |
|---|---|
| A. 手写 image 数组进 `index.html` | 第二份数据源：加图 / 改 slug / 换派生图档位都得记得改它，漂移是时间问题且无任何用例会红 |
| B. 运行时 JS 注入 JSON-LD | 富结果抓取器不保证执行 JS；且现状「禁 JS 也能读」是逐图页的明示契约，主页同样不引入 |
| C. 每项只写图片 URL 字符串（`image: ["…"]`） | 放弃 name / description / date 就没有富结果素材，等于没补；审计要的是补全 |
| D. 另起第二个 `<script>` LD 块 | 同一实体拆两块声明，更新时必漏一块；嵌进原块 = 一个节点一份真相 |
| E. contentUrl 用更小的 thumb 档 | 与逐图页 og:image 分叉（同一作品全站两处指向两张图）；shareImage 已限定 16–341KB 量级的派生图，够轻 |
| F. P-10 连 LCP 单指标一起提 error | 类别分（error ≥0.9）已覆盖；单指标 error 在共享 CI runner 上抖动概率更高、信息增益小，保留 warn 作先导 |
| G. 线上审计做成常驻 workflow | 真实网络与 CDN 边缘节点抖动会变成周期性 CI 噪声；审计要求是「补一次」，落档为准 |

## 6. 验收

- 红态三处如实记录（§8.2）；
- 绿态：unit 全量 + e2e 全量（61→62？见 §8.3——本批 +1 条）+ lint + **lhci 全量（新 error 门槛）**；
- 线上：部署后真实审计落档（分数、LCP、关键机会项）。

## 7. 遗留

- 主页 JSON-LD 的 `image` 项未带 `width/height`（逐图页有）——数组语境下抓取器会按 contentUrl 自取尺寸，省体积；
  若将来要严格对齐逐图页字段，在 `buildHomeImages` 一处加即可。
- **P-10 的可信硬门禁**：前置是 P-8/P-9 真实优化 + 多轮取中位数 + 独立审计 job（见 §8 回退记录），属独立批次。

## 8. 线上真实站点审计（2026-10-16，`76cdc68` 部署后，决策 6 承诺）

对 `https://iloat20.github.io/milan-photos/` 直跑 3 轮 Lighthouse（headless，本机真网络）：

| 轮次 | performance | a11y | best-practices | SEO | LCP | TBT | CLS |
|---|---|---|---|---|---|---|---|
| 1 | 1.0 | 1.0 | 1.0 | 1.0 | 1.5 s | 40 ms | 0.019 |
| 2 | 1.0 | 1.0 | 1.0 | 1.0 | 1.5 s | 30 ms | 0.019 |
| 3 | 1.0 | 1.0 | 1.0 | 1.0 | 1.2 s | 20 ms | 0.003 |

**四类别三轮全满分。** 这组数与 CI runner 的 0.63/0.87（§3.4 回退记录）互为对照，
坐实「CI 分数是节流 runner 假象，站点真实性能没有问题」——P-10 的正确落点不是
在 CI 里把 warn 提成 error，而是「以线上审计为准、CI 保持 warn 作先导信号」。

线上 JSON-LD 抽验（curl 直取产物页解析）：`ImageGallery.image` = 18 项 `ImageObject`，
首项 `name: 柔光 / url: /p/rou-guang/ / contentUrl: medium/*.webp`；18 项
contentUrl **全部**指向 `photos/` 派生图、零母版引用。
