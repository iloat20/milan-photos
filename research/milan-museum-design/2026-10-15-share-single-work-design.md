# F-4 单件分享（逐图展签页）设计稿

日期：2026-10-15 ｜ 批次：审计 §9 的 F-4 ｜ 前置：F-1 逐图展签页（`/p/<slug>/`，已上线）、F-5 位置指示、U-3 提示

## 0. 一句话

给观画室的 chrome 行加一个分享圆钮：点它把**当前作品的逐图展签页绝对 URL**（`/p/<slug>/`）
交给 Web Share API；浏览器不支持或调用失败时回落剪贴板复制，并给「已复制链接」的视觉 + 读屏反馈。

## 1. 决策摘要

| # | 决策 | 结论 | 依据 |
|---|---|---|---|
| 1 | 分享目标 | **逐图展签页 `/p/<slug>/`**；无 slug（浏览器内上传的自定义图）回落 `#p=` 哈希深链 | 逐图页自带**逐图 og 卡**（`og:image` = 该作中图、`og:title` =《题名》）——分享到任何平台展开的卡片都是这幅画，这才是「传播路径」，也是 F-1/S-1 建这批页面的初衷；`#p=` 是哈希，社交抓取器看不见，只配给没有静态页的自定义图兜底 |
| 2 | slug 进 manifest | `photos_lib.photo_item()` 新增 `slug` 字段（`normalize_slug`，与 `gen_work_pages.normalizeSlug` 同规则）；**sync 是唯一归一来源** | 浏览器（分享按钮）与构建期（逐图页 / sitemap）必须用**同一个** slug——两处各自计算就会在 meta 改动后静默分叉：页面换了 URL，而分享按钮还在发旧的（且都不报错） |
| 3 | 生成器取 slug 的顺序 | `resolveSlugs()` 改为 **manifest.slug 优先**；「meta 覆盖 > 文件名 stem」计算保留为回退（服务无 slug 的老清单） | 单一来源：meta 改了 slug 而没 sync 时，页面与按钮**一起保持旧值**（自洽），sync 后一起换新；跨语言算法一致由单测「真清单一致性」用例在真数据上钉住（漂移即红，提示跑 sync） |
| 4 | 分享交互 | `navigator.share({title, url})` 优先；`AbortError`（用户取消）静默；失败或不支持则回落 `navigator.clipboard.writeText(url)` | 平台惯例（分享面板 / 系统分享单）。安全上下文 + 用户手势下可用；无需 `canShare` 预检——`{title, url}` 永远是合法组合 |
| 5 | 反馈 | 复制成功：chrome 胶囊「已复制链接」约 2s（复用 `#lbHint`）+ `#lbCountLive` 播报；失败：「复制失败」同路 | WCAG 4.1.3 状态消息：**成功/结果必须可编程确定**——视觉胶囊 `aria-hidden`（U-3 契约），播报走 F-5 建的 polite 状态区（`#lbCountLive`），文本由下一次翻页的 sync() 自然覆盖 |
| 6 | 按钮落位与形态 | chrome 右侧新建 `.lb-actions`（`[分享][关闭]`，gap 8px）；分享钮复用关闭钮的 36px 玻璃圆钮规格 | 两个「对话框级」控件成组、键盘顺序相邻；hint 仍居于 chrome 行中部（布局几何见 §3.7） |
| 7 | 自定义上传图的兜底 | **不隐藏**按钮；链接为 `#p=<id>`——接受「收件人浏览器里没有这张图」的局限 | 该图本来就只存在于上传者的浏览器（IndexedDB 本机预览）；隐藏要多一条状态分支，而 `#p=` 对上传者本人（书签 / 回溯）仍然成立。局限写入 §7 |
| 8 | 端口与纯函数 | URL 构造收进 `util.shareUrlFor(photo, pageHref)` 纯函数；lightbox 新增能力端口 `share(photo, title) → Promise<"shared"｜"copied"｜"failed"｜"cancelled">` | 纯函数单测直钉（与 `positionLabel` / `lightboxHintText` 同层）；`navigator.share` / 剪贴板 / `location` 全是宿主能力，走端口注入，lightbox.js 只按结果码选反馈文案（U-3 的 `coarsePointer` 同范式） |
| 9 | 护栏 | `global-setup.js` 对策 4 的 `required` 加 `"slug"`；单测加「manifest 优先」「真清单一致性」两条 | 缺 slug 的 manifest = 半成品/降级版：分享按钮会**静默**退回 `#p=`（页面照常跑）——与 `palette` 同一机制，开跑前拦住 |

## 2. 现状与缺陷

### 2.1 审计原文与背景

> **F-4 单件分享** —— 深链已存在（`#p=<id>`），但界面无分享按钮。低成本激活传播路径。

F-1 之后站内有 18 个逐图展签页，每页带逐图 og 卡——但**没有任何入口**：访客想分享某幅画，
只能复制地址栏，得到 `…/#p=<file>` 的哈希链接（社交平台抓取器不解析哈希，展开卡片永远是
首页的静态 `og.jpg`，甚至无卡）。传播资产已建好，门没开。

### 2.2 红态判据（与实现解耦）

> 打开任一件作品，点「分享」（Web Share 不可用环境）：剪贴板出现 `…/p/<slug>/` 形态的**绝对 URL**；
> 该 URL 真实可达（200），页面 canonical 与剪贴板路径一致、题名与所看作品一致。
> Web Share 可用时：`navigator.share` 收到 `{title:《题名》, url:同一 URL}`，且不落剪贴板、无复制反馈。
> manifest 任一作品缺 `slug`：e2e 在开跑前中止（对策 4 报出字段名，而不是让按钮静默退化）。

现状红点：① `#lbShare` 不存在；② manifest 无 `slug` 字段；③ `resolveSlugs()` 对带 slug 的
manifest 视而不见（只读 meta/stem）。

## 3. 实施（草案）

### 3.1 `tools/photos_lib.py`

```python
def normalize_slug(raw: str) -> str:
    """与 gen_work_pages.normalizeSlug 同一条规则（跨语言两份实现，由
    gen-work-pages 单测的「真清单一致性」用例在真数据上钉住漂移）。"""
    return re.sub(r"[^a-z0-9]+", "-", str(raw or "").lower()).strip("-")
```

`photo_item()` 内（与 `title` / `caption` 同一段）：

```python
stem = re.sub(r"\.[^.]+$", "", name)   # 与 JS slugSource 同规则：去最后一个扩展名
item["slug"] = normalize_slug(info["slug"] if info.get("slug") is not None else stem)
```

- 取覆盖的语义与 JS 的 `override ?? slugSource` 对齐：**null 才回退**，空串照走
  （`"slug": ""` 是策展笔误，交给构建期的 `SLUG_RE` 大声报错，不在这里静默兜底）。
- 运行 `npm run sync` 重生成 `photos/manifest.json` 随功能提交（先做幂等基线：
  不带改动跑一次 sync，确认与已提交文件逐字节一致——2026-10-15 实测零 diff，
  Pillow 12.3.0）。

### 3.2 `tools/gen_work_pages.mjs`

```js
export function resolveSlugs(manifest, meta = {}) {
  …
  const slug = photo?.slug != null
    ? String(photo.slug)                       // sync 的产物是唯一归一来源
    : normalizeSlug(meta?.[photo.file]?.slug ?? slugSource(photo));  // 老清单回退
  if (!SLUG_RE.test(slug)) { … throw … }
  // 冲突检查不变（报错不静默去重）
```

docstring 同步改写：来源顺序 = manifest.slug > meta 覆盖 > 文件名 stem。

### 3.3 `src/util.js`

```js
/** F-4：分享 URL。有 slug → 逐图展签页绝对 URL；无 → 站内深链 #p=<id>。
    先去掉 pageHref 的 hash（灯箱开着时地址栏正是 #p=…）。 */
export function shareUrlFor(photo, pageHref) {
  const base = String(pageHref || "").split("#")[0];
  const slug = photo?.slug ? String(photo.slug) : "";
  if (slug) return new URL(`p/${encodeURIComponent(slug)}/`, base).href;
  const id = photo?.id != null ? String(photo.id) : "";
  return id ? `${base}#p=${encodeURIComponent(id)}` : base;
}
```

### 3.4 `app.js`

- `loadFolderPhotos()` 白名单显式加 `slug: item.slug || ""`（AGENTS.md 纪律：不在映射里的字段被静默丢弃）。
- 分享能力实现（装配处注入 lightbox）：

```js
/** F-4：Web Share 优先，剪贴板兜底。返回结果码，反馈归 lightbox 域。 */
async function shareCurrentPhoto(photo, title) {
  const url = shareUrlFor(photo, location.href);
  if (navigator.share) {
    try { await navigator.share({ title, url }); return "shared"; }
    catch (err) {
      if (err && err.name === "AbortError") return "cancelled";  // 用户取消，静默
      /* NotAllowedError / TypeError 等 → 回落复制 */
    }
  }
  try { await navigator.clipboard.writeText(url); return "copied"; }
  catch { return "failed"; }
}
```

### 3.5 `src/lightbox.js`

- 端口 +2：`shareEl`（`#lbShare`）、`share`（见 §3.4）。
- `showHint()` 重构为 `showHint(text, ms = HINT_MS)`（U-3 调用点传 `lightboxHintText(...)`）；
  分享反馈由此复用同一胶囊。
- 处理：

```js
on(shareEl, "click", async () => {
  const photo = photosNow()[pos];
  if (!photo || typeof share !== "function") return;
  let code = "failed";
  try { code = await share(photo, displayTitle(photo, pos)); } catch { code = "failed"; }
  if (code === "copied" || code === "failed") {
    const text = code === "copied" ? SHARE_COPIED_TEXT : SHARE_FAILED_TEXT;
    showHint(text, SHARE_FEEDBACK_MS);
    announce(text);            // #lbCountLive（role=status）——胶囊 aria-hidden，播报走它
  }
});
```

- `SHARE_COPIED_TEXT = "已复制链接"` / `SHARE_FAILED_TEXT = "复制失败"` / `SHARE_FEEDBACK_MS = 2000`
  留在 lightbox 域（UI 微文案与反馈时长是展示决策）。

### 3.6 `index.html`

```html
<div class="lightbox-chrome">
  <span class="lb-count" id="lbCount" aria-hidden="true"></span>
  <p class="lb-hint" id="lbHint" aria-hidden="true"></p>
  <div class="lb-actions">
    <button class="lb-share" id="lbShare" type="button" aria-label="分享这件作品">
      <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true" focusable="false">…</svg>
    </button>
    <button class="lb-close" id="close" …>…</button>
  </div>
</div>
```

图标：24 viewBox 行程式描边（箭杆 + 箭头 + 开口托盘），与关闭钮同 1.8 描边语言。

### 3.7 `styles.css`

- `.lb-close` 的规格块扩为 `.lb-close, .lb-share`（同一玻璃圆钮）；hover 规则同扩。
- 新增 `.lb-actions { display: flex; align-items: center; gap: 8px }`。
- chrome 三段布局 `[计数][提示][控件组]` 的 space-between 下，提示中心较几何中心左偏
  约 20px（左侧计数 ~42px、右侧控件组 ~80px）——视觉上仍在「计数与控件之间」居中，可接受。
- `.lb-hint` 补 `min-width: 0`（flex 省略号的标准前提；控件组加宽后窄屏更值得要点）。

### 3.8 测试与护栏

- `tests/unit/util.test.mjs`：`shareUrlFor` 用例——slug 路径（去 hash、保留子路径）、
  `#p=` 兜底（含 `encodeURIComponent`）、两者皆缺回落 base。
- `tests/unit/gen-work-pages.test.mjs`：
  1. 改写既有「回退文件名 stem」用例为合成无 slug 清单（原用例输入 = 真清单，会改走新路径）；
  2. 新增「manifest.slug 优先」（meta 与清单不一致时以清单为准；非法 slug 仍抛错）；
  3. 新增「真清单一致性」：`photo.slug === normalizeSlug(meta 覆盖 ?? stem)`，跨语言算法漂移即红。
- `tests/e2e/smoke.spec.js` 新用例 ×2（`test.use({ permissions: ["clipboard-read", "clipboard-write"] })`）：
  1. 复制回落：stub 掉 `navigator.share` → 点分享 → 胶囊 + `#lbCountLive` 反馈、
     剪贴板 URL 匹配 `/p/<slug>/$`、`page.request.get` 200、canonical 路径一致、页面题名与所看作品一致；
  2. Web Share：stub 捕获 `{title, url}` → 键盘 Enter 触发 → 断言载荷、断言无复制反馈、剪贴板未被写。
- `tests/e2e/global-setup.js`：对策 4 `required` 加 `"slug"`。
- AGENTS.md：`meta.json` 行与逐图页条目里「`slug` 不进 manifest」的表述改写；注明 F-4 的分享目标是逐图页。

## 4. 红态计划（先跑，后实施）

1. 先落单测改动 + e2e 用例（不含 global-setup 与实现），跑红：
   - unit：`shareUrlFor` import 报「不提供该导出」；`resolveSlugs` 两条新用例红（清单 slug 被无视 /
     真清单缺 slug 字段）；
   - e2e：两条新用例红（`#lbShare` 不存在）。
2. 再把 `"slug"` 加入 global-setup 的 `required`，跑一个既存用例：**开跑前中止**并报出
   `slug`（对策 4 的红态证据）。
3. 全部实施 + `npm run sync` 后转绿：`npm run lint` / `test:unit` / `test:e2e` 全量。
4. 视觉：`node tools/preview-shots.mjs`——灯箱亮/暗两张应见「分享」圆钮，胶囊居中不遮画。
5. 线上：部署后活体探针（授予剪贴板权限）：点分享 → 剪贴板 = `…/milan-photos/p/<slug>/`，URL 200。

### 4.1 既有测试影响清单（复核后）

| 用例 | 影响 | 结论 |
|---|---|---|
| gen-work-pages 单测（经 `buildWorkPages({manifest: MANIFEST})`） | resolveSlugs 改走 manifest.slug；真数据两来源归一结果相同 | 断言不受影响；仅「回退 stem」一条改写为合成输入 |
| F-5 位置指示 / U-3 提示 / U-4 skip-link | chrome 结构变化（新增 `.lb-actions` 包裹），`#close` / `#lbHint` / `#lbCountLive` id 不变 | 不受影响 |
| 灯箱手势（翻页 / 双击 / 捏合 / 横滑） | 分享钮在 chrome，不碰舞台 | 不受影响 |
| SW 指纹 | `photos/manifest.json` 入指纹，slug 落库即自动换代 | 预期内，测试从 `dist/` 独立重算 |
| `global-setup` 对策 2（逐字节） | manifest 已随功能同步提交，无漂移 | 不受影响 |

## 5. 否决项

| 方案 | 否决理由 |
|---|---|
| A. 分享 `#p=` 深链（现成资产，零服务端面） | 哈希对社交抓取器不可见，展开卡片永远是首页静态图——「传播路径」等于没激活；分享按钮存在的全部理由就是卡片 |
| B. 浏览器端算 slug（复刻 JS 归一规则进 app.js） | 规则第三份拷贝；meta 覆盖（`ye-bo` 这类）只存在于策展源，浏览器算不出来 |
| C. 只手改 manifest 加 slug（不改 photos_lib） | 下一次 CI sync 会把手工字段抹掉（bot 全量回写）；生成物必须由生成器产出 |
| D. `resolveSlugs` 继续两处计算、加运行时 throw 校验 | 校验只能证明「两份相等」或「都红」；把来源收敛为一份，问题在生成端就已不可能发生 |
| E. 分享按钮放舞台角落 / 题名区 | 舞台手势层（点击切图、双击缩放、拖拽）是既有风险面；chrome 行是唯一零风险、几何稳定的位置（U-3 决策 #5 的同一结论） |
| F. `navigator.share` 成功也给「已分享」反馈 | 系统面板的关闭本身就是反馈；多一层浮层反而打断 |
| G. 复制反馈也走 `aria-live` 专用新节点 | 现成的 `#lbCountLive`（role=status）就是对话框的 polite 状态区，加节点是重复建设 |

## 6. 验收

- 红态三处如实记录（§4.1、§4.2）；
- 绿态：unit 全量 + e2e 全量（新增 2 条）+ lint；
- 视觉：10 张截图核对分享钮形态与 chrome 行高稳定；
- 线上：活体探针拿到 `/p/<slug>/` 绝对 URL 且 200。

## 7. 遗留

- 自定义上传图的分享链接（`#p=`）对收件人无意义（图只在上传者浏览器）——已接受（决策 #7）；
  若将来上传图有服务端落点，此处随之下线兜底。
- 连点分享第二次不再播报（live region 文本未变化）——刻意不做 reset 技巧（会引入双播报）。
- 无其他遗留。

## 8. 实施记录（2026-10-15）

### 8.1 改动清单（与 §3 一致；两处实现偏差，见下）

| 文件 | 改动 |
|---|---|
| `tools/photos_lib.py` | `normalize_slug()`（与 JS 同规则）；`photo_item()` 写入 `slug`（meta 覆盖 > 文件名 stem；**null 才回退**，空串照走交给构建期报错） |
| `tools/gen_work_pages.mjs` | `resolveSlugs()` 改为 `manifest.slug` 优先，回退计算保留；docstring 更新 |
| `photos/manifest.json` | `npm run sync` 重生成：**+18 行 slug**，逐行核过无其他变化 |
| `src/util.js` | `shareUrlFor(photo, pageHref)` 纯函数（去 hash → `/p/<slug>/` 绝对 URL，或 `#p=<id>`） |
| `src/lightbox.js` | 端口 +2（`shareEl` / `share`）；`showHint(text, ms)` 重构；分享处理器（仅 `copied` / `failed` 给反馈：胶囊 + `#lbCountLive` 播报） |
| `app.js` | import `shareUrlFor`；`shareCurrentPhoto()`（Web Share 优先、`AbortError` 静默、回落剪贴板）；装配注入两端口；白名单 +`slug`；类型注释 +`slug` |
| `index.html` | chrome 右端新建 `.lb-actions` 包裹 `[分享][关闭]`；`#lbShare` 16px 图标（24 viewBox 描边） |
| `styles.css` | `.lb-actions`（flex / gap 8）；`.lb-close, .lb-share` 合并规格与 hover；`.lb-hint` 注释更新（`min-width: 0` 批 A 已有） |
| `tests/unit/util.test.mjs` | `shareUrlFor` ×3（slug 路径 / `#p=` 兜底 / 皆缺回落） |
| `tests/unit/gen-work-pages.test.mjs` | 「回退」用例改合成无 slug 清单；新增「manifest 优先」「真清单一致性」 |
| `tests/e2e/smoke.spec.js` | +2：复制回落全链路（可达 / canonical / 同题）；Web Share 载荷（键盘 Enter、无复制反馈） |
| `tests/e2e/global-setup.js` | 对策 4 `required` +`"slug"`；注释与报错文案同步 |
| `AGENTS.md` | meta 行 / 逐图页条目 / 白名单纪律三处同步 |

**实现偏差 1（e2e canonical 断言按后缀比对）**：canonical 恒写生产前缀 `…/milan-photos/`
（`SITE_URL` 常量），而本地预览在站根，全路径比对在本地永远红。改为
`canonical.pathname.endsWith(剪贴板路径)`；生产前缀下的**严格自指**已由逐图页的
「逐页 SEO 字段齐备」用例在全量 18 页上钉死，此处弱化不丢判据（首跑 61 passed / 1 failed，
失败点正是这一个前缀）。

**实现偏差 2（lint `no-useless-assignment`）**：`let code = "failed"` 的初值在所有路径都会
被覆盖 → eslint 报无用赋值；改为无初值声明（try/catch 双路覆盖）。

### 8.2 红态证据（先跑，后实施）

**unit 三连红**（`npm run test:unit`，实施前）：`1..67 # pass 64 # fail 3`

```text
not ok 12 - resolveSlugs：清单自带 slug 优先（sync 的产物是唯一归一来源）
not ok 31 - 真清单一致性…
   mmexport1788447848472.jpg：manifest.slug="undefined" 与归一结果 "rou-guang" 不一致（跑 npm run sync）
not ok 8 - tests\unit\util.test.mjs
   SyntaxError: The requested module '../../src/util.js' does not provide an export named 'shareUrlFor'
```

**e2e 双红**（`npm run test:e2e -- -g "单件分享"`，实施前）：两条都卡在
`waiting for locator('#lbShare')`（30s 动作超时）。

**global-setup 对策 4 红**（`"slug"` 加进 `required` 后、sync 前）：

```text
[产物能力自检失败] http://127.0.0.1:8080 的 manifest 缺少站点与测试依赖的字段：slug
  条目数 18；样例字段 ["src","file","title",…,"heroAvifSrcset","palette"]
```

### 8.3 绿态与全量验证

- `npm run lint` 通过；`npm run test:unit`：**102/102**（97 → 102，新增 5 条）。
- `npm run test:e2e`：**62 passed**（60 + 2；首跑 1 红为偏差 1，修后全绿）。
- sync 幂等基线：实施前先跑一次 `npm run sync`，与已提交 manifest **逐字节一致**（零 diff），
  证明本机 Pillow 12.3.0 与入库产物同源；实施后 diff = +18 行 slug（逐行核过）。
- 视觉：`node tools/preview-shots.mjs` 10 张——灯箱亮/暗两图中分享钮在关闭钮左侧、与关闭钮
  同规格玻璃圆钮；提示胶囊处于计数与控件组之间（中心较几何中心略左约 20px，与 §3.7 预告一致）。
- 探针复验（preview 4173 现场，脚本化；种下 `milan-lb-hint` 压掉 U-3 提示 + shadow
  `navigator.share`）：
  `{hintText:"已复制链接", hintOn:true, live:"已复制链接", copied:"http://localhost:4173/p/rou-guang/",
  status:200, hintAfter:false}` —— 反馈双路同时成立、约 2s 自动收起、逐图页真实可达。
  （首轮探针在点击后立刻读文案，读到的是尚未被替换的 U-3 手势文案——异步处理器完成前
  的时序假象，加 300ms 收敛后再读即为上表。）

### 8.4 线上抽验（部署后）

`9a4463f` 推送后：Sync photo manifest（38748044527，**无回写**——CI 与本机逐字节同源）、
CI（38748044563）、Deploy（38748044727，gate 复用全量）均 success。Pages 发布后活体探针：

```text
cards=18 | title=《柔光》
hintText=「已复制链接」| live=「已复制链接」
copied=https://iloat20.github.io/milan-photos/p/rou-guang/
status=200 | canonical=同一 URL（生产前缀下严格自指）| 逐图页含该作题名
```

分享按钮在产物 + SW 的线上形态下：URL 走子路径站点的正确绝对化、逐图页可达、
反馈双路成立。F-4 闭环。

