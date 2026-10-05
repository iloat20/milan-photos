// 临时探针：LCP 分相 + 关键指标（用完即删）
const fs = require("node:fs");
const path = require("node:path");
const dir = ".lighthouseci/reports";
const files = fs
  .readdirSync(dir)
  .filter((f) => f.endsWith(".json") && f !== "manifest.json")
  .map((f) => ({ f, m: fs.statSync(path.join(dir, f)).mtimeMs }))
  .sort((a, b) => b.m - a.m);
for (const { f, m } of files.slice(0, 4)) {
  const r = JSON.parse(fs.readFileSync(path.join(dir, f), "utf8"));
  const lcp = r.audits["largest-contentful-paint"];
  const det = (lcp.details && lcp.details.items && lcp.details.items[0]) || {};
  console.log(
    new Date(m).toISOString(),
    "| LCP", Math.round(lcp.numericValue),
    "| FCP", Math.round(r.audits["first-contentful-paint"].numericValue),
    "| TBT", Math.round(r.audits["total-blocking-time"].numericValue),
    "| CLS", Number(r.audits["cumulative-layout-shift"].numericValue).toFixed(4),
    "| SI", Math.round(r.audits["speed-index"].numericValue),
    "| perf", r.categories.performance.score,
    "| bytes", r.audits["total-byte-weight"].numericValue
  );
  if (det.items) {
    for (const it of det.items) console.log("     ", it.phase, "=", Math.round(it.timing));
  }
}
