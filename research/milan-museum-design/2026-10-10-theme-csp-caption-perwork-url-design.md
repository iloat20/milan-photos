# P1 设计稿：主题内联脚本 + CSP / 策展说明版式 / 逐图可索引 URL

- 日期：2026-10-10
- 状态：**已对齐，待实施**
- 前置：`2026-10-10-upgrade-opportunity-audit.md` §10 第 5 步
- 对齐方式：逐项 brainstorming（三项各一轮问答确认，决策见下表）

---

## 0. 决策摘要

| # | 议题 | 决策 | 否决的方案 |
|---|---|---|---|
| ① | CSP 落地方式 | **内联脚本 + sha256 hash 白名单** | 脚本外置；本轮只修闪烁 |
| ① | CSP 范围 | **全指令集，不带 `unsafe-inline`** | 只锁 `script-src`；全指令集 + style 兼容垫 |
| ① | `app.js` 重复读取段 | **删除**（单一真源，故障显性化） | 保留作降级兜底 |
| ② | caption 展示范围 | **仅观画室**（`.lightbox-meta` 内，标题下方） | 加序厅；加画廊卡片悬停 |
| ③ | 逐图页形态 | **轻量展签页 `/p/<slug>/`（静态生成）** | 完整交互页；`?p=` query 方案 |

三项**串行实施**，每项独立提交、独立验收（延续本项目「一批 end-to-end 走完再开下一批」的纪律）。

---

## 1. 证据基线（实施前不可跳过）

| 事实 | 出处 / 实测 |
|---|---|
| 主题闪烁：存 `dark` + 系统 `light` 时，t=1173ms 与 1208ms 两帧底色为白，1230ms 才生效 | 线上逐帧探针（审计报告 §7） |
| 首帧无 `data-theme` 的根因：唯一设置点 `app.js:1799-1801` 在模块执行期才跑 | `app.js` 读取 |
| 全仓**无** HTML 标记内联 `style="…"`、无 `<style>` 文本注入；样式写入全走 CSSOM | `grep`：仅 `el.style.setProperty` 等（`app.js` 24 处 / `src/lightbox.js` 13 处）→ **CSSOM 不受 `style-src` 管控** |
| `meta.json` 8 条 caption **已在 manifest 中**（`photos_lib.py:415` 正常写入，8/18 非空） | `manifest.json` 实读 |
| caption **无任何渲染点**：`app.js:991/1117/1523` 只做数据装配，`index.html` 观画室只有 `.lb-title` | `grep` + DOM |
| 10 件无题作品的《无题 · NN》**不是** manifest 里的值，而是渲染期降级 | `src/util.js:42-46` `displayTitle` |
| `.lightbox-meta` 为 `flex-shrink: 0`、高度由内容撑开 | `styles.css:1405-1411` |
| SW 对 `mode === "navigate"` 的请求走 `shellSwr`（SWR + 离线回落 `index.html`） | `public/sw.js:254` |
| sitemap 仅 1 条 URL；深链是 `#p=` 哈希（搜索引擎不索引） | `sitemap.xml` / `app.js:394` |

---

## 2. 设计 ① 主题内联脚本 + CSP

### 2.1 目标与验收

- 首帧即带正确主题：**不再出现任何底色为白的帧**（逐帧探针复测）。
- 构建产物带全指令集 CSP，**运行时零违规**。
- CSP hash **不可能静默失配**（失配必被测试抓住）。

### 2.2 A — 解析期内联脚本（`index.html`）

置于 `<meta charset>` 之后、`<link rel="stylesheet">` **之前**：

```html
<script>
  try {
    var t = localStorage.getItem("milan-theme");
    if (t === "light" || t === "dark") document.documentElement.dataset.theme = t;
  } catch (e) {}
</script>
```

- 必须在样式表之前：`data-theme` 是 `:root` 属性选择器，首帧前设好即不闪烁。
- `try/catch` 不可省：Safari 隐私模式 / 禁用 cookie 时 `localStorage.getItem` 直接抛异常，不兜会连坐整段脚本。
- 只读不写：值域与 `app.js` 的 toggle 保持一致（`"light"` / `"dark"`；无值 = 跟随系统）。

### 2.3 B — 删除 `app.js` 的重复读取段

`app.js:1796-1801` 中的读取与赋值删除，**保留** toggle 的写入逻辑（`app.js:1802-1812`，它负责 `localStorage.setItem` 与 `dataset.theme` 更新，与内联脚本无重叠）。

理由：单一真源；被删的正是「晚约 200ms 才生效」的兜底 —— 它会将 CSP hash 失配这类故障**静默化**（闪烁回来但页面照常可用）。故障应显性化，由 §2.5 的回归网直接抓。

### 2.4 C — 构建期注入（`vite.config.js`）

新增 `cspPlugin()`，在 `closeBundle` 阶段（与既有 `copyStaticPlugin` 同一阶段，读的是**已写盘的最终产物**，天然规避「Vite 是否改写内联脚本」的不确定性）：

1. 读 `dist/index.html`；
2. 用正则抓出所有**无 `src`** 的 `<script>…</script>`（当前 2 段：JSON-LD 与主题脚本；JSON-LD 也受 `script-src` 管控，必须一并纳入 hash）；
3. 逐段算 `sha256-<base64>`（`node:crypto`）；
4. 拼串并以 `<meta http-equiv="Content-Security-Policy" content="…">` 插到 charset meta 之后（**meta CSP 只对其后内容生效**）；
5. 不重排 HTML，只插入一行。

CSP 取值：

```
default-src 'self';
script-src 'self' 'sha256-…' 'sha256-…';
style-src 'self';
img-src 'self' data:;
connect-src 'self';
worker-src 'self';
manifest-src 'self';
object-src 'none';
base-uri 'none';
form-action 'none';
```

> 若实测出现 `img-src` 违规（如某处用 `blob:`），按实测补项，不预先加宽。

### 2.5 D — 回归网（决定性，须红态验证）

e2e 新增两个用例，均跑在构建产物上：

1. **CSP 零违规**：挂 `document.addEventListener("securitypolicyviolation")`，执行完整交互（切主题 → 开灯箱 → 翻页 → 改筛选 → 开库房面板），断言违规数 **0**。
2. **hash 自校验**：读 `<meta http-equiv="Content-Security-Policy">`，对 `script-src` 中每个 `sha256-…` 逐一验证 —— 必能匹配 `index.html` 某段内联脚本的实际内容（即「无悬空 hash」），且每个内联脚本都有对应 hash。

**红态验证（必做）**：在**同一条 bash 命令内**改一个字符使 hash 失配 → 构建 → 断言必红。判据只能用「产物内可见的差异」（本仓有过教训：lightningcss 会剥离 CSS 注释，用注释做标记是无效判据）。

### 2.6 边界与风险

- **`<meta>` CSP 的能力上限**：不支持 `frame-ancestors` / `report-uri` / `sandbox`，**也不支持 Report-Only**（只能本地探针抓违规，无法线上灰度）。这些指令若要生效必须走响应头，GH Pages 给不了 —— 属既定约束。
- dev 模式不加 CSP（HMR 依赖 eval/inline），仅构建产物生效。
- `script-src` 用 hash 时**不能**同时用 `'self'` 之外的宽泛源；`app.js` 是外链同源脚本，`'self'` 覆盖。
- 每次改动任一段内联脚本都必须重新构建（hash 由产物算出）——CI 会构建，故不会漏。

---

## 3. 设计 ② 策展说明（caption）版式

### 3.1 范围

**仅观画室**。序厅保持纯图（现有美学），画廊卡片不加悬停层。

### 3.2 DOM

```html
<div class="lightbox-meta">
  <h2 class="lb-title" id="lbTitle"></h2>
  <p class="lb-caption" id="lbCaption"></p>   <!-- 新增 -->
</div>
```

### 3.3 零布局跳动（关键）

18 件中 10 件无 caption。`.lightbox-meta` 是 `flex-shrink: 0` 的弹性子块，高度由内容撑开 —— 若切图时高度变化，画面框会被挤动，观展中**画面整块跳一下**。

对策：caption 元素**恒占一行**——空值用 `visibility: hidden`（**不用** `display: none`）配合 `min-height: 1lh`，使 `.lightbox-meta` 高度在任意两张图之间恒定。

### 3.4 版式

| 项 | 取值 |
|---|---|
| 字号 | ≈ 0.88 × 标题（标题见 `.lb-title` 现值） |
| 行高 | 1.6 |
| 对齐 | 居中（继承 `.lightbox-meta`） |
| 宽度 | `max-width: min(46ch, 100%)`，`margin-inline: auto` |
| 颜色 | `color: color-mix(in oklab, currentColor 62%, transparent)` —— 跟随主题，不硬编码 |
| 换行 | `text-wrap: pretty` |
| 与标题间距 | 6–8px（按实测视觉微调） |

**颜色纪律**：本仓「颜色只声明一次，由 `light-dark()` 按 used color-scheme 取边」是硬约束（`styles.css:69-75`），caption 不得写死任何色值。

**移动端**：最长策展短句 16 字；340px 视口下 14px 字号接近单行临界。实施时实测是否换行，若换行则降到 13px 保单行（换行会破坏 §3.3 的高度恒定）。

### 3.5 无障碍

- caption 是**可见文本**，不进 `img.alt`（避免屏幕阅读器重复播报）。`alt` 仍为 `displayTitle(photo, pos)`。
- `<h2>` 保持标题角色，`<p>` 为天然副文本，无需 ARIA。
- 切图时 `#lbCaption` 与 `#lbTitle` 同路径更新（`src/lightbox.js:383-389`）。
- 不加新动画（首次打开的淡入已有 `.lb-title` 动画；caption 可复用同一 `lb-title-in`，YAGNI 不另开）。

### 3.6 测试

- e2e：打开**有** caption 的图 → 断言文本 === manifest 值；打开**无** caption 的图 → 断言 `visibility: hidden`；并断言两者的 `.lightbox-meta` **高度相等**（这条钉住 §3.3 的零跳动）。
- 单测：caption 归一化（`trim` 空串判定），入 `tests/unit/util.test.mjs`。

---

## 4. 设计 ③ 逐图可索引 URL

### 4.1 形态

构建期静态生成**轻量展签页**，产物路径 `/p/<slug>/index.html`。GH Pages 无服务端重写，但「目录 + index.html」天然可用 —— **不需要** SPA 回退，`vite.config.js` 的 `appType: "mpa"` 保持不动。

每页内容（无 JS 依赖，禁 JS 也能读）：

- `<h1>` 标题（`displayTitle` 的**纯文本版**：书名号不进 `<title>`/`og:title`）
- `<img>`：medium 的 AVIF/WebP + JPG 回退，带 `srcset` / `sizes`，`alt` 非空、`width`/`height` 显式声明
- `<p>` 策展说明（caption；空则不渲染该元素）
- 日期（`<time datetime>`）
- `canonical` → 自身
- 逐图 `og:*` / `twitter:*`：`og:image` = 该图 medium **绝对 URL**，含 `og:image:width/height`
- JSON-LD `Photograph`：`contentUrl` / `datePublished` / `description` / `creator` / `inLanguage`
- 「进入观画室」按钮 → 跳回主页并复用**现有 `#p=<id>` 深链**打开灯箱
- `prev` / `next` 静态链接（按 manifest 陈列顺序）→ 让爬虫能串完整个展

### 4.2 slug 规则

`meta.json` 新增**可选** `slug` 字段；缺省回退文件名 stem（如 `01-city-rain`）。这样「补 10 件作品标题」**不阻塞**本项（YAGNI，不引入拼音/音译依赖）。

slug 必须满足：`[a-z0-9-]+`，归一化后**全局唯一**；生成器对冲突必须**报错退出**，不静默去重。

### 4.3 生成位置

挂在 `closeBundle`（与 §2.4 的 CSP 注入同一钩子链内部，**先切页后算 hash**：切页只影响各自页面，index.html 的 hash 不受影响；但顺序仍固定，避免未来互相干扰）。生成器为独立文件 `tools/gen_work_pages.mjs`，读 `photos/manifest.json` + `photos/meta.json`，便于单测直接调用。

### 4.4 sitemap

扩为 19 条（主页 + 18 逐图页），逐图页带 `lastmod` = 作品 `date`。`robots.txt` 不变。

注：sitemap 需在**切页之后**生成（或由生成器一并产出），否则会漏 URL。

### 4.5 SW

预期**零改动**：`/p/<slug>/` 是导航请求（`mode === "navigate"`）→ 走 `shellSwr`（SWR + 离线回落 `index.html`）。**需实测**：逐图页在 `CACHE_SHELL` 中累积（18 条，可接受）、离线直开未访问过的逐图页会回落到主页（可接受）。

### 4.6 测试

- e2e：18 个页面存在；`<title>` 两两不同；`canonical` 正确；`og:image` 为绝对 URL；`alt` 非空；JSON-LD 可解析；sitemap 含全部 18 条且 `loc` 与目录一致；`prev`/`next` 链条完整（无断链、无环）。
- 单测：slug 归一化与**唯一性冲突报错**；HTML 转义（标题/说明含 `&` `"` `<` 时不得破坏结构）。

### 4.7 风险

- **重复内容**：主页画廊与逐图页共享图片。处置：各页 `canonical` 指向自身（标准做法），不设跨页 canonical。
- **图片抓取**：逐图页的 `<img>` 与主页灯箱同源同尺寸档位，不新增图片产物。
- **实施面**：本项改动面最大（新增生成器 + 18 页 + sitemap + 测试），故排在最后。

---

## 5. 实施顺序与提交切分

| 批次 | 内容 | 提交粒度 |
|---|---|---|
| ① | 内联脚本 + 删重复读取 + CSP 插件 + 回归网 | 1 commit（fix + test 同批，因 hash 与脚本强耦合） |
| ② | caption DOM + 版式 + 测试 | 1 commit |
| ③ | 生成器 + 18 页 + sitemap + 测试 | 1 commit（生成器与测试同批） |

每批**必须**：`npm run lint` + `npm run test:unit` + `npx playwright test` 全绿 → 推送 → CI/Deploy `success` → 线上复测。

---

## 6. 明确不做（YAGNI）

- 序厅与画廊卡片的 caption 展示
- 灯箱的 EXIF / 位置信息（审计报告 D-4，另议）
- CSP 的 `report-uri` 上报（meta 不支持）
- 逐图页的客户端翻页（保留静态 `prev`/`next` 链接即可）
- slug 的自动拼音化

---

## 7. 附：勘误记录

审计报告 `2026-10-10-upgrade-opportunity-audit.md` 有两处需更正，本设计稿以此处为准：

1. **§10 第 3 步建议的 `bodyUsed === false` 断言是错的**。修复后 `app.js` 消费的是**原始** Response，其 `bodyUsed` 本就为 `true`；按该断言实现会在修复后依然红。实际落地为「劫持 `Response.prototype.json`，断言无人 `json()` 到已消费的 body」（见 `tests/e2e/smoke.spec.js`，已红态验证）。
2. **§10 未覆盖一项 CI 阻断**：`库房设置面板走 popover` 的垂直居中断言在 CI 上稳定假红（过渡中途测量，实测偏移 8.24px / 1.79px，与 CI 报数吻合）。已改为 `expect.poll` 轮询收敛，并做破坏性红态验证（置 `transform: none` → `Received: 210`）。
