/**
 * Service Worker 的缓存版本号：构建期按**内容指纹**自动生成，取代手工递增。
 *
 * 手工递增（`milan-v49`）的代价不只是「忘了改」：sw.js 的**字节不变**时浏览器
 * 不会重新 install SW，壳层缓存只能靠 SWR 逐条兜；而 `photos/medium/*` 走
 * cacheFirst（命中即返回、**永不回源**），换缓存名是它唯一的失效手段。
 * 版本随内容自动变 ⇒ sw.js 字节随之变 ⇒ 该重新 install 的时候一定会重装。
 *
 * 指纹来源 = dist/index.html + app.js + styles.css + photos/manifest.json。
 * 为什么含 manifest：图片的取用集合与尺寸都体现在它里面，图片换版必须让缓存名变。
 * 代价是改 caption 也会换一次版本（访客的媒体缓存跟着清）—— 这是**保守方向**的
 * 取舍：宁可多清一次，也不要让旧图无限期驻留。
 *
 * 为什么不含 sw.js 自身：会自指（改版本 → sw.js 变 → 版本再变，永不稳定）。
 */
import crypto from "node:crypto";

/** public/sw.js 里的占位符，构建期替换成 `milan-<8 位 hex>`。 */
export const BUILD_ID_PLACEHOLDER = "__MILAN_BUILD_ID__";

/** 版本号形状。public/sw.js 的 OWNED_CACHE_RE 依赖它。 */
export const BUILD_ID_RE = /^milan-[0-9a-f]{8}$/;

/**
 * 由四份输入算出版本号。**本函数唯一的契约是「任一份变化即变」** ——
 * 稳定性（同样的输入永远得到同样的输出）由 sha256 保证。
 *
 * 各段之间插 `\0` 分隔：不隔开的话 `("ab","c")` 与 `("a","bc")` 会撞成同一个指纹。
 */
export function computeBuildId({ html = "", js = "", css = "", manifest = "" }) {
  const hash = crypto.createHash("sha256");
  for (const part of [html, js, css, manifest]) {
    hash.update(String(part));
    hash.update("\0");
  }
  return `milan-${hash.digest("hex").slice(0, 8)}`;
}

/**
 * 把占位符替换成版本号。
 *
 * 占位符**必须恰好出现一次**：0 次说明源码里已被人写死成数字（于是「自动」静默
 * 失效，退回手工递增）；多次说明注释里也写了它，替换会误伤说明文字。
 * 两种都宁可让构建失败 —— 这是本仓对「静默降级」的一贯处置。
 */
export function injectBuildId(source, buildId) {
  const text = String(source ?? "");
  const occurrences = text.split(BUILD_ID_PLACEHOLDER).length - 1;
  if (occurrences !== 1) {
    throw new Error(
      `sw-version: ${BUILD_ID_PLACEHOLDER} 应恰好出现 1 次，实际 ${occurrences} 次`
    );
  }
  if (!BUILD_ID_RE.test(buildId)) {
    throw new Error(`sw-version: 版本号形状不合法：${buildId}`);
  }
  return text.replace(BUILD_ID_PLACEHOLDER, buildId);
}
