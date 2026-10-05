// 临时探针：LCP 发现时序（CPU 4× 节流下的资源时序）——用完即删
import { chromium } from "@playwright/test";

const BASE = process.env.BASE || "http://127.0.0.1:4173";

const browser = await chromium.launch();
const ctx = await browser.newContext({
  viewport: { width: 412, height: 823 },
  deviceScaleFactor: 2.625,
  isMobile: true,
  hasTouch: true,
});
const page = await ctx.newPage();
const cdp = await ctx.newCDPSession(page);
await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });

await page.goto(BASE + "/", { waitUntil: "load" });

const data = await page.evaluate(async () => {
  const out = { marks: [], lcp: null, fcp: null };
  const nav = performance.getEntriesByType("navigation")[0];
  out.marks.push(["nav.domContentLoaded", Math.round(nav.domContentLoadedEventEnd)]);
  out.marks.push(["nav.loadEventEnd", Math.round(nav.loadEventEnd)]);
  const fp = performance.getEntriesByType("paint");
  for (const p of fp) out.marks.push([p.name, Math.round(p.startTime)]);

  // LCP
  out.lcp = await new Promise((resolve) => {
    const po = new PerformanceObserver((list) => {
      const es = list.getEntries();
      const last = es[es.length - 1];
      resolve({ url: last.url || "", time: Math.round(last.startTime) });
    });
    po.observe({ type: "largest-contentful-paint", buffered: true });
    setTimeout(() => resolve(null), 1500);
  });

  for (const r of performance.getEntriesByType("resource")) {
    const name = r.name.replace(/^https?:\/\/[^/]+/, "");
    if (!/manifest|app\.js|styles\.css|photos\//.test(name)) continue;
    out.marks.push([
      name.slice(0, 60),
      "start=" + Math.round(r.startTime),
      "respEnd=" + Math.round(r.responseEnd),
      "dur=" + Math.round(r.duration),
    ]);
  }
  return out;
});

console.log(JSON.stringify(data, null, 1).replace(/\[\n\s+/g, "[").replace(/,\n\s+/g, ", "));
await browser.close();
