const { test, expect } = require("@playwright/test");

test.describe("画廊冒烟", () => {
  test("首页渲染 18 张卡片且缩略图走 AVIF 协商", async ({ page }) => {
    await page.goto("/");
    const cards = page.locator(".card");
    await expect(cards).toHaveCount(18);
    // 每张卡片的 picture 都挂了 image/avif source
    await expect(page.locator('.card picture source[type="image/avif"]')).toHaveCount(18);
    // 协商结果：已加载（非懒加载占位）的 img currentSrc 应为 .avif
    await page.waitForFunction(
      () => {
        const loaded = [...document.querySelectorAll(".card img")].filter(
          (img) => img.currentSrc
        );
        return (
          loaded.length > 0 &&
          loaded.every((img) => img.currentSrc.includes(".avif"))
        );
      },
      null,
      { timeout: 10_000 }
    );
  });

  test("manifest 提供 thumbAvifSrcset 字段", async ({ request }) => {
    const res = await request.get("/photos/manifest.json");
    expect(res.ok()).toBeTruthy();
    const data = await res.json();
    const list = data.photos || data;
    expect(list).toHaveLength(18);
    expect(list.filter((p) => p.thumbAvifSrcset)).toHaveLength(18);
  });

  test("灯箱开合（<dialog> 原生模态）", async ({ page }) => {
    await page.goto("/");
    const cards = page.locator(".card");
    await expect(cards).toHaveCount(18);
    const lightbox = page.locator("#lightbox");
    await cards.first().click();
    await expect(lightbox).toBeVisible();
    // 灯箱图走 medium AVIF（原图 ≤1600 无 medium 时回退 jpg，二者都算通过协商）；src 异步设置，等它落地
    await page.waitForFunction(() => {
      const img = document.getElementById("lbImg");
      return img && img.currentSrc;
    }, null, { timeout: 10_000 });
    const src = await page.locator("#lbImg").evaluate((img) => img.currentSrc);
    expect(src).toBeTruthy();
    await page.locator("#close").click();
    await expect(lightbox).toBeHidden();
  });

  test("筛选切换卡片数量", async ({ page }) => {
    await page.goto("/");
    const cards = page.locator(".card");
    await expect(cards).toHaveCount(18);
    const chips = page.locator(".filter-chip");
    // chips = 全部展厅 + 每个有照片的年月（数据决定数量，不写死）
    const n = await chips.count();
    expect(n).toBeGreaterThanOrEqual(2);
    await expect(chips.first()).toHaveText("全部展厅");
    await chips.last().click();
    // 筛选走 View Transitions 异步重渲染，轮询等新卡片数落地
    await expect
      .poll(async () => cards.count(), { timeout: 5_000 })
      .toBeLessThan(18);
    const filtered = await cards.count();
    expect(filtered).toBeGreaterThan(0);
    await chips.first().click();
    await expect(cards).toHaveCount(18);
  });

  test("控制台无错误", async ({ page }) => {
    const errors = [];
    page.on("pageerror", (err) => errors.push(String(err)));
    page.on("console", (msg) => {
      if (msg.type() === "error") errors.push(msg.text());
    });
    await page.goto("/");
    await expect(page.locator(".card")).toHaveCount(18);
    await page.waitForTimeout(1000);
    expect(errors).toEqual([]);
  });
});
