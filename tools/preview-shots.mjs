// 临时视觉核对脚本（截图产物在 .gitignore 内的 tools/preview-*.png）
// 用法：先起 `python tools/serve.py`，再 node tools/preview-shots.mjs
import { chromium } from "@playwright/test";

const BASE = process.env.BASE || "http://127.0.0.1:8080";

const SCENES = [
  { file: "preview-apple-hero-light.png", scheme: "light", w: 1440, h: 900, act: null },
  { file: "preview-apple-hero-dark.png", scheme: "dark", w: 1440, h: 900, act: null },
  { file: "preview-apple-gallery-light.png", scheme: "light", w: 1440, h: 900, act: "gallery" },
  { file: "preview-apple-gallery-hover-dark.png", scheme: "dark", w: 1440, h: 900, act: "hover" },
  { file: "preview-apple-lightbox-light.png", scheme: "light", w: 1440, h: 900, act: "lightbox" },
  { file: "preview-apple-lightbox-dark.png", scheme: "dark", w: 1440, h: 900, act: "lightbox" },
  { file: "preview-apple-mobile-gallery-light.png", scheme: "light", w: 390, h: 844, act: "gallery" },
  { file: "preview-apple-mobile-lightbox-dark.png", scheme: "dark", w: 390, h: 844, act: "lightbox" },
  { file: "preview-apple-upload-light.png", scheme: "light", w: 1440, h: 900, act: "upload" },
  { file: "preview-apple-about-dark.png", scheme: "dark", w: 1440, h: 900, act: "about" },
];

const browser = await chromium.launch();

for (const s of SCENES) {
  const ctx = await browser.newContext({
    colorScheme: s.scheme,
    viewport: { width: s.w, height: s.h },
    deviceScaleFactor: 2,
  });
  const page = await ctx.newPage();
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto(BASE + "/", { waitUntil: "load" });
  await page.waitForSelector(".card");
  // 懒加载：只等前两张（首屏必载），其余滚动到位后再等
  await page.waitForFunction(() =>
    [...document.querySelectorAll(".card img")].slice(0, 2).every((i) => i.complete)
  );
  if (s.act === "gallery") {
    await page.locator("#gallery").scrollIntoViewIfNeeded();
    await page.mouse.move(0, 0);
    await page.waitForTimeout(1500);
  } else if (s.act === "hover") {
    await page.locator("#gallery").scrollIntoViewIfNeeded();
    const card = page.locator(".card").nth(1);
    await card.hover();
  } else if (s.act === "lightbox") {
    await page.locator(".card").first().click();
    await page.waitForSelector("#lightbox[open]");
    await page.waitForFunction(() => document.getElementById("lbImg")?.currentSrc);
  } else if (s.act === "upload") {
    await page.locator("#upload").scrollIntoViewIfNeeded();
    await page.locator("#ghPanel > summary").click();
    await page.mouse.move(0, 0);
  } else if (s.act === "about") {
    await page.locator("#about").scrollIntoViewIfNeeded();
  }
  await page.waitForTimeout(700);
  await page.screenshot({ path: `tools/${s.file}` });
  console.log("shot", s.file);
  await ctx.close();
}

await browser.close();
