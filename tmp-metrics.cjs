// 临时探针：读取最近一次 lhci 报告的关键指标（用完即删，不进仓库）
const fs = require("node:fs");
const path = require("node:path");

const dir = ".lighthouseci/reports";
const files = fs
  .readdirSync(dir)
  .filter((f) => f.endsWith(".json") && f !== "manifest.json")
  .map((f) => ({ f, m: fs.statSync(path.join(dir, f)).mtimeMs }))
  .sort((a, b) => b.m - a.m);

const target = process.argv[2] || files[0].f;
const r = JSON.parse(fs.readFileSync(path.join(dir, target), "utf8"));
const c = r.categories;
console.log("report:", target, new Date(files[0].m).toISOString());
console.log(
  "scores: perf", c.performance.score,
  "| a11y", c.accessibility.score,
  "| bp", c["best-practices"].score,
  "| seo", c.seo.score
);
const keys = [
  "first-contentful-paint",
  "largest-contentful-paint",
  "total-blocking-time",
  "cumulative-layout-shift",
  "speed-index",
  "total-byte-weight",
  "unused-javascript",
  "render-blocking-resources",
  "uses-responsive-images",
  "modern-image-formats",
  "uses-optimized-images",
  "prioritize-lcp-image",
  "efficient-animated-content",
  "duplicated-javascript",
  "unminified-javascript",
  "unminified-css",
  "uses-long-cache-ttl",
  "service-worker",
  "installable-manifest",
  "maskable-icon",
  "network-requests",
  "lcp-lazy-loaded",
  "non-composited-animations",
  "unsized-images",
  "image-size-responsive",
  "uses-text-compression",
];
for (const k of keys) {
  const a = r.audits[k];
  if (!a) continue;
  console.log(
    "  ",
    k.padEnd(30),
    "score=" + String(a.score).padEnd(6),
    (a.displayValue || "").padEnd(18),
    a.numericValue !== undefined ? a.numericValue : ""
  );
}
const lcpEl = r.audits["largest-contentful-paint-element"];
if (lcpEl && lcpEl.details && lcpEl.details.items) {
  console.log("LCP element:", JSON.stringify(lcpEl.details.items[0] || {}).slice(0, 400));
}
const net = r.audits["network-requests"];
if (net && net.details && net.details.items) {
  console.log("-- image requests --");
  for (const it of net.details.items) {
    if (/\.(avif|webp|jpe?g|png)/.test(it.url)) {
      console.log(
        "   ",
        String(it.priority).padEnd(9),
        String(it.resourceType).padEnd(6),
        Math.round(it.transferSize / 1024) + "KB",
        it.url.replace(/^https?:\/\/[^/]+/, "")
      );
    }
  }
}
