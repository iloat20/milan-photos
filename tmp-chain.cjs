// 临时探针：打印关键请求链与各请求时序（用完即删）
const fs = require("node:fs");
const path = require("node:path");
const dir = ".lighthouseci/reports";
const files = fs
  .readdirSync(dir)
  .filter((f) => f.endsWith(".json") && f !== "manifest.json")
  .map((f) => ({ f, m: fs.statSync(path.join(dir, f)).mtimeMs }))
  .sort((a, b) => b.m - a.m);
const r = JSON.parse(fs.readFileSync(path.join(dir, files[0].f), "utf8"));
const lcp = r.audits["largest-contentful-paint"];
console.log("LCP", lcp.numericValue, "report", files[0].f, new Date(files[0].m).toISOString());

const chains = r.audits["critical-request-chains"];
if (chains && chains.details) {
  const print = (node, depth) => {
    const req = node.request;
    console.log(
      "  ".repeat(depth),
      Math.round(req.startTime) + "→" + Math.round(req.endTime),
      (req.priority || "").padEnd(9),
      Math.round((req.transferSize || 0) / 1024) + "KB",
      req.url.replace(/^https?:\/\/[^/]+/, "") || "/"
    );
    for (const c of node.children || []) print(c, depth + 1);
  };
  const roots = Array.isArray(chains.details.chains)
    ? chains.details.chains
    : Object.values(chains.details.chains);
  for (const c of roots) {
    try {
      print(c, 0);
    } catch (e) {
      console.log("  chain print error:", String(e));
    }
  }
} else {
  console.log("no critical-request-chains audit:", Object.keys(r.audits).filter((k) => k.includes("critical")));
}

console.log("-- all requests (sorted by start) --");
const net = r.audits["network-requests"];
const items = net.details.items
  .slice()
  .sort((a, b) => a.networkRequestTime - b.networkRequestTime);
for (const it of items) {
  console.log(
    "  ",
    String(Math.round(it.networkRequestTime)).padStart(5),
    "→" + String(Math.round(it.networkEndTime)).padStart(5),
    "dur=" + String(Math.round(it.networkEndTime - it.networkRequestTime)).padStart(5),
    (it.priority || "").padEnd(9),
    (Math.round((it.transferSize || 0) / 1024) + "KB").padStart(7),
    it.url.replace(/^https?:\/\/[^/]+/, "") || "/"
  );
}
