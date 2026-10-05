// 临时探针：测「LCP 预载 link 何时被创建」——决定把预载前移能省多少（用完即删）
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
// 在任何页面脚本之前装观察器
await page.addInitScript(() => {
  window.__preloads = [];
  window.__scriptMarks = [];
  // 标记：inline 脚本执行时刻 vs DCL
  window.__scriptMarks = [];
  document.addEventListener("DOMContentLoaded", () =>
    window.__scriptMarks.push(["DCL", Math.round(performance.now())])
  );
  window.addEventListener("load", () =>
    window.__scriptMarks.push(["load", Math.round(performance.now())])
  );
  new MutationObserver((muts) => {
    for (const m of muts) {
      for (const n of m.addedNodes) {
        if (n.tagName === "LINK" && n.getAttribute("rel") === "preload") {
          window.__preloads.push({
            t: Math.round(performance.now()),
            href: (n.getAttribute("href") || "").slice(0, 70),
            imagesrcset: (n.getAttribute("imagesrcset") || "").slice(0, 40),
          });
        }
      }
    }
  }).observe(document, { childList: true, subtree: true });
});
const cdp = await ctx.newCDPSession(page);
await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
await page.goto(BASE + "/", { waitUntil: "load" });
await page.waitForTimeout(1200);

const out = await page.evaluate(() => ({
  preloads: window.__preloads,
  marks: window.__scriptMarks,
  resources: performance
    .getEntriesByType("resource")
    .map((r) => ({
      n: r.name.replace(/^https?:\/\/[^/]+/, ""),
      s: Math.round(r.startTime),
      e: Math.round(r.responseEnd),
    }))
    .filter((r) => /photos\/(thumbs|medium)|manifest|app\.js|styles/.test(r.n)),
  lcp: (() => {
    const e = performance.getEntriesByType("largest-contentful-paint");
    return e.length ? { t: Math.round(e[e.length - 1].startTime), url: e[e.length - 1].url } : null;
  })(),
}));
console.log("preloads:", JSON.stringify(out.preloads));
console.log("marks:", JSON.stringify(out.marks));
console.log("lcp:", JSON.stringify(out.lcp));
for (const r of out.resources) console.log("  ", String(r.s).padStart(5), "→", String(r.e).padStart(5), r.n);
await browser.close();
