// 临时探针：展开 uses-responsive-images / render-blocking-resources 明细（用完即删）
const fs = require("node:fs");
const path = require("node:path");
const dir = ".lighthouseci/reports";
const files = fs
  .readdirSync(dir)
  .filter((f) => f.endsWith(".json") && f !== "manifest.json")
  .map((f) => ({ f, m: fs.statSync(path.join(dir, f)).mtimeMs }))
  .sort((a, b) => b.m - a.m);
const r = JSON.parse(fs.readFileSync(path.join(dir, files[0].f), "utf8"));
for (const id of ["uses-responsive-images", "render-blocking-resources"]) {
  const a = r.audits[id];
  console.log("==", id, a.score, a.displayValue);
  const items = (a.details && a.details.items) || [];
  for (const it of items) {
    console.log(
      "  ",
      "wasted=" + Math.round((it.wastedBytes || 0) / 1024) + "KB",
      "natural=" + (it.naturalDimensions && it.naturalDimensions.width),
      "displayed=" + (it.displayedDimensions && it.displayedDimensions.width),
      String(it.url || "").replace(/^https?:\/\/[^/]+/, ""),
      it.totalBytes ? "total=" + Math.round(it.totalBytes / 1024) + "KB" : ""
    );
  }
}
