/**
 * 序厅首图（LCP）预载的**构建期注入**：把 manifest 里的 hero 候选写成静态
 * `<link rel="preload">`，直接落到 `dist/index.html`。
 *
 * 为什么在构建期而不是解析期脚本（2026-10-16 改）：
 *   - 最早的形态是「app.js 里 preloadImage」—— app.js 解析 + 执行完才发起，
 *     实测（4× CPU 节流）把高优先级图推迟到 ~270ms；
 *   - 之后改成「内联脚本先 fetch 清单、拿到 hero 字段再插 link」—— 快了很多，
 *     但仍要等清单一个 RTT（真实网络 ~100–300ms）才发起预载，且连坐了
 *     「同一 Response 要 clone 给两个消费者」的脆弱契约；
 *   - 现在预加载扫描器在解析到本标签的那一刻就发起请求，零脚本依赖、零额外
 *     请求延迟，内联脚本也瘦回「只发清单请求」。
 *
 * 口径与运行期严格同一：hero 指针（manifest.hero，sync 按 meta.json 的 featured
 * 排名生成）与候选串（heroAvifSrcset / heroSrcset，sync 预计算）都在清单里，
 * 此处只搬运字符串、不重算任何规则；hero 指针与 selectHeroPhotos 的一致性由
 * `tests/unit/util.test.mjs` 的「真清单契约」对拍。**降级清单**（无候选串字段）时
 * 本模块注入一串空说明注释，由 `app.js` 的 `preloadImage` 按缩略图现场算候选兜底
 * —— 那条兜底同时服务「非构建产物直服源码」的形态。
 *
 * 两条纪律（与 HOME_IMAGE_SLOT 同款，都为了「静默的坏法」）：
 *   1. 源码 index.html 里的占位注释 `<!--HERO_PRELOAD-->` 必须**恰好一处** ——
 *      消失或重复都直接抛错让构建失败，而不是注入到别处/没注入；
 *   2. 注入必须发生在 vite.config.js 的 ①（CSP）之前 —— 标签本身是 link 不参与
 *      CSP hash，但它改变 index.html 字节，② 的 SW 指纹读的是最终产物。
 */
import { escapeHtml } from "./gen_work_pages.mjs";
import { HERO_SIZES } from "../src/util.js";

/** 源码 index.html 里的占位注释。dev 形态不跑插件，占位原样保留（无预载，属预期差异）。 */
const HERO_PRELOAD_SLOT = "<!--HERO_PRELOAD-->";

const DEGRADED_NOTE =
  "<!-- 序厅预载：清单缺 hero 候选串（降级清单），交由 app.js 的 preloadImage 兜底 -->";

/**
 * 生成预载标签；清单里没有可用候选串（降级版）时返回空串。
 * @param {object} manifest photos/manifest.json 的对象形态
 */
export function heroPreloadTag(manifest) {
  const list = manifest?.photos || [];
  const first = list.find((p) => p.file === manifest?.hero) || list[0];
  const srcset = first && (first.heroAvifSrcset || first.heroSrcset);
  if (!srcset) return "";
  // href 是「不支持 imagesrcset 的老浏览器」的回退，与 src/util.js 的 heroSrc 同序：
  // medium → thumb（动图没有 medium，因此与 heroSrc 的 thumb 分支同值）。
  const href = first.medium || first.thumb || first.src || "";
  // 格式由字段名判定：heroAvifSrcset 只由 AVIF 候选拼成，首个候选必是 AVIF
  const type = first.heroAvifSrcset ? "image/avif" : "image/webp";
  return (
    `<link rel="preload" as="image" href="${escapeHtml(href)}" ` +
    `imagesrcset="${escapeHtml(srcset)}" imagesizes="${escapeHtml(HERO_SIZES)}" ` +
    `type="${type}" fetchpriority="high" />`
  );
}

/**
 * 把标签替换进占位注释（标签为空串时改写为可排查的说明注释）。
 * @param {string} html 源码（或 dist 里）的 index.html
 * @param {string} [tag] heroPreloadTag 的结果
 */
export function injectHeroPreload(html, tag = "") {
  const source = String(html ?? "");
  const parts = source.split(HERO_PRELOAD_SLOT);
  if (parts.length === 1) {
    throw new Error("hero-preload: 源码 index.html 缺少 <!--HERO_PRELOAD--> 占位注释");
  }
  if (parts.length > 2) {
    throw new Error("hero-preload: 占位注释出现多处，注入目标不唯一");
  }
  return parts[0] + (tag || DEGRADED_NOTE) + parts[1];
}
