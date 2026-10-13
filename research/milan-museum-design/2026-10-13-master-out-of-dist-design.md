# P-1：母版移出产物（`photos/*.jpg` 不再发布）

- 日期：2026-10-13
- 状态：**已实施**
- 相关：`tools/photo-assets.mjs`（新增）、`vite.config.js`、`tools/gen_work_pages.mjs`、
  `tests/e2e/global-setup.js`、`tests/e2e/smoke.spec.js`
- 前置：P-3/P-4（灯箱档位回退）—— 静态作品自此不再请求 `src`，本项才有可能

## 0. 一句话

`photos/` 里住着三种东西：**母版**（sync 的输入）、**派生图**（访客下载的那批）、
**清单**。此前整棵拷进 `dist/`，于是 5.56 MB 的母版占了产物的 44%。
本项只把「会被前端触达的 `src`」留在产物里 —— 而本仓 18 件**一个都不触达**。

## 1. 为什么是 44% 的浪费，且一直没人发现

| 项 | 字节 |
|---|---|
| 改动前 dist | 12 499 176 |
| 母版（`photos/*.jpg`） | 5 553 098 |
| `photos/meta.json`（策展源） | 3 046 |
| **改动后 dist** | **6 943 032（−44.4%）** |

母版在产物里**没有任何访客会下载它** —— 卡片墙走 `thumbSrcset`、序厅走 `heroSrcset`、
观画室走按画框选档（P-2）、逐图页走 `pictureSrcsets`。它之所以还在，只是因为
「拷整个目录最省事」。

**这个浪费之所以能存活这么久**：多拷不会让任何测试变红，页面也完全正常。
它是纯粹的运维面成本（Actions 上传/发布体积、Pages 存储）。

## 2. 规则：「会被触达的 `src` 才保留」，而不是硬编码排除 `*.jpg`

```js
export function needsMasterSource(photo) {
  if (photo?.animated) return true;   // 灯箱直接播原文件（sync 不给动图生成 medium）
  return !photo?.thumb;               // 无缩略图：前端 `thumb || src` 会落到 src
}
```

两条都对应**真实存在的消费路径**，不是预防性猜测：

- `app.js` 的清单映射：`thumb: item.thumb || src`
- `src/util.js` 的 `largestStill`：`medium || thumb || src`
- `src/util.js` 的 `heroSrc` / `lightboxSrc` 的 animated 分支

为什么不做成「排除 `photos/*.jpg` 这样的一张表」：排除表**一定会腐坏** ——
将来有人往 `photos/` 放 `.png`、`.gif`，或者经「库房入库」加了一张还没跑 sync 的图，
表不会知道。而按上式，规则是 **manifest 的函数**：跑过 sync 的图零母版、
刚入库还没派生图的图自动留母版 —— 两条路径都不需要人工维护。

**本仓结果**：18 件全静态、全有 `thumb` ⇒ 需要保留的母版 = **0 个**。
`photos/meta.json` 一并移出（它是 sync 的输入，前端只 `fetch` manifest）。

## 3. ⚠️ 必须一并修的 404：母版是三个对外 URL 的落点

这是本项真正的风险面 —— 母版不只是「没人下载的浪费」，它还是**爬虫与分享卡的落点**。
实测 `dist/p/01-city-rain/index.html` 改动前：

```
og:image:   …/photos/01-city-rain.jpg      ← 母版
JSON-LD image:      …/photos/01-city-rain.jpg   ← 母版
JSON-LD contentUrl: …/photos/01-city-rain.jpg   ← 母版
<picture> 的兜底 <img src>: …/photos/01-city-rain.jpg   ← 母版
```

根因是 `shareImage(photo) = photo.medium || photo.src` —— 无 medium 的 9 件
（8 张 1024 + 1 张 360）直接落到 `src`。母版一移出，**四处全 404**，
而页面渲染完全正常、没有任何用户可见症状。

**改法**：新增 `shareImageInfo(photo)`，取**现存最大的派生图**：
`mediumSrcset` 最大档（2048）> `medium` 标量（1280）> `thumb` 最大档；
`og:image` / JSON-LD 的 `image` 与 `contentUrl` / `<img src>` 四者**同值**。
`width/height` 也跟着选中的那一档走（报 1280 的尺寸却指向 2048 档，
会让抓图器按错误比例预留版面）。

**为什么是「最大」而不是像观画室那样按画框选档**：爬虫与 IM 抓图器不执行 JS、
不报告画框尺寸，只能按 URL 抓一回 —— 给它们最清晰的那档。实测体积
16–341 KB，全在微信抓取上限内。

**顺带修好的既有缺陷**：此前分享卡抓的是**母版原图**（`mmexport` 218 KB、
`IMG20260916193647` **971 KB**），而对应中图只有 68–163 KB。微信对超大抓取图
会直接放弃 —— 这是分享成功率问题，独立于 P-1 成立。

## 4. 实施

| 文件 | 改动 |
|---|---|
| `tools/photo-assets.mjs`（新） | `needsMasterSource` / `masterSourcesToKeep` / `referencedPhotoPaths` |
| `vite.config.js` | `copyStaticPlugin` 改为 async + 动态 import，只拷 `manifest.json` + `thumbs/` + `medium/` + 按需母版 + `assets/` |
| `tools/gen_work_pages.mjs` | `shareImage` → `shareImageInfo`（最大现存派生图）；四处引用同值；删掉旧的 `shareSize` |
| `tests/e2e/global-setup.js` | 新增对策 6；`SOURCES` 由 `tools/gen_work_pages.mjs` 扩为整个 `tools/` |

`referencedPhotoPaths` 刻意**遍历字段**而不是白名单字段名 —— P-2 刚加了
`mediumSrcset` / `mediumAvifSrcset`，白名单漏一个，新档位就在守卫里隐形。

`thumbs/` 与 `medium/` 仍整目录拷（108 + 28 文件，逐档枚举更脆：sync 的档位表
一变就得同步改拷贝逻辑）。

## 5. 护栏（两层）与两条红态

| 层 | 判据 |
|---|---|
| 单测 `photo-assets.test.mjs` | 规则真值表；**真 manifest 下 `masterSourcesToKeep` 必须为空**（硬编码期望，不受实现影响） |
| 单测 `gen-work-pages.test.mjs` | **逐图页引用的每个 `photos/` 路径都在引用集合里**（爬虫视角），且无一以 `.jpg/.png` 结尾 |
| e2e global-setup 对策 6 | 正向：引用集合里每个路径都在 dist；反向：dist 里的母版必须**确实会被请求** |
| e2e smoke（新） | 分享图走 **HTTP**（磁盘存在 ≠ 线上可达）：og:image / JSON-LD 的 image 与 contentUrl 三者 200 且 `image/*` |

**红①（改 `shareImageInfo` 回 `medium \|\| src`）**：单测 `not ok 30`（规则）
与 `not ok 32`（主护栏）；产物自检 og:image 回到 `photos/01-city-rain.jpg`；
e2e「逐页 SEO 字段齐备」与「分享图 HTTP 可达」双双变红。决定性通过。

**红②（`masterSourcesToKeep` 无视触达条件、全量保留）**：单测 `not ok 56`；
产物自检 dist 顶层母版 **18** 个。

> **红② 抓出了守卫自身的一个缺陷（本次最有价值的发现）**：对策 6 的反向检查
> 原本写的是「dist 里的母版必须在 `masterSourcesToKeep` 的输出里」—— 而
> `masterSourcesToKeep` **正是构建期决定拷什么的那份判断**。拿它校验自己就是
> 同义反复：破坏后 dist 有 18 个母版、`kept` 里也是 18 个，恰好一一对应，
> **e2e 一路绿**（实测 `1 passed`）。
> 改成用 `referencedPhotoPaths` 的引用集合做判据后，18 个母版全部被拦下。
> 教训：**护栏不能与被测物同源** —— 这一条只有做红态才会暴露。

## 6. 验收

- 产物：`dist/photos/` 顶层只剩 `manifest.json` + `thumbs/` + `medium/`；
  母版 0 个；`thumbs` 108/108、`medium` 28/28 与源目录一致。
- 体积：12 499 176 B → **6 943 032 B（−5 556 144 B，−44.4%）**。
- 逐图页引用：18 页共 132 个 `photos/` 引用，**0 缺失**；无一处指向 `.jpg`。
- 三件套：lint 干净；unit **82 → 91**；e2e **49 → 50**。
- 两条红态决定性通过（见 §5）。
- 线上验收：母版 URL 404；分享图 URL 200 且 `image/*`；主页 / 观画室 / 逐图页零失败请求。

## 7. 遗留

- **`src` 字段仍在 manifest 里**且仍指向母版路径 —— 它是前端去重键
  （`app.js` 的 `id` 与 `existing` 集合），也是「无派生图时」的兜底锚点。
  它现在是一条**条件性**承诺：只有当该条目 `animated || !thumb` 时，那个文件才会
  真的出现在线上。这个语义已写在 `tools/photo-assets.mjs` 头部。
- **库房入库的窗口期**：刚 commit 到 sync bot 回写之间，新图无 `thumb` ⇒
  按规则保留母版 ⇒ 立即可见，无回归。
- 逐图页 og:image 用 WebP（`medium` 只有 webp/avif，无 jpg）—— 微信支持 WebP 抓取，
  未做兼容回落。
- 8 张 1024 素材补录（补完后 P-2 射程从 9 张扩到 18 张，本项不受影响）。
