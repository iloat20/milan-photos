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

  test("URL 深链：#f 筛选 / #p 灯箱 / 关灯箱恢复 / 直达", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator(".card")).toHaveCount(18);
    const curHash = () => new URL(page.url()).hash;
    // ① 点 chip → #f=<年月>
    await page.locator(".filter-chip").nth(1).click();
    await expect.poll(curHash, { timeout: 5_000 }).toMatch(/^#f=\d{4}-\d{2}$/);
    const fHash = curHash();
    // ② 开卡 → #p=<photo.id>，灯箱为原生 open
    await page.locator(".card").first().click();
    await expect(page.locator("#lightbox")).toBeVisible();
    await expect.poll(curHash, { timeout: 5_000 }).toMatch(/^#p=.+/);
    const pHash = curHash();
    // ③ 关灯箱 → hash 恢复 #f（回归防护：VT 分支曾内联漏掉 setHash 导致残留 #p）
    await page.locator("#close").click();
    await expect(page.locator("#lightbox")).toBeHidden();
    await expect.poll(curHash, { timeout: 5_000 }).toBe(fHash);
    // ④ 同文档直达 #p（hashchange 路由）→ 灯箱自动开
    await page.goto("/" + pHash);
    await expect(page.locator("#lightbox")).toBeVisible();
    // ⑤ 硬刷新（loadFolderPhotos 初始解析 #p）→ 灯箱仍自动开、18 卡在场
    await page.reload();
    await expect(page.locator(".card")).toHaveCount(18);
    await expect(page.locator("#lightbox")).toBeVisible();
  });

  test("hero 轮播切换与分页点", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator(".card")).toHaveCount(18);
    const slides = page.locator(".hero-carousel-slide");
    await expect(slides).toHaveCount(8);
    const activeIdx = () =>
      slides.evaluateAll((els) =>
        els.findIndex((el) => el.classList.contains("is-active"))
      );
    expect(await activeIdx()).toBe(0);
    await page.locator("#heroNext").click();
    await expect.poll(activeIdx, { timeout: 3_000 }).toBe(1);
    await page.locator("#heroPrev").click();
    await expect.poll(activeIdx, { timeout: 3_000 }).toBe(0);
  });

  test("Service Worker 离线仍可服务", async ({ page, context }) => {
    await page.goto("/");
    await expect(page.locator(".card")).toHaveCount(18);
    // claim 后主动经 SW 补拉一次清单：networkFirst 成功即写入 shell 缓存，
    // 兜住 install 期请求被瞬断的场景（首屏 manifest 请求早于 claim、不经 SW）
    await page.evaluate(() =>
      fetch("photos/manifest.json", { cache: "no-store" }).then((r) => r.ok)
    );
    // 等 SW 激活 + shell 缓存（含 manifest 快照）+ 被 controller 接管
    await page.waitForFunction(
      async () => {
        const regs = await navigator.serviceWorker.getRegistrations();
        const activated = regs.some((r) => r.active?.state === "activated");
        const keys = await caches.keys();
        const shelled = keys.some((k) => k.endsWith("-shell"));
        const hasManifest = !!(await caches.match(
          new Request("photos/manifest.json", { cache: "no-store" }),
          { ignoreSearch: true }
        ));
        return (
          activated && shelled && !!navigator.serviceWorker.controller && hasManifest
        );
      },
      null,
      { timeout: 20_000 }
    );
    await context.setOffline(true);
    try {
      // 用页面内导航而非 page.reload()：CDP 驱动的 reload 在 offline 模拟下
      // 会直接 ERR_INTERNET_DISCONNECTED（未走 SW 拦截），页面内导航走标准 SW 路径
      const navP = page.waitForNavigation({ waitUntil: "load", timeout: 10_000 });
      await page
        .evaluate(() => {
          location.href = location.pathname + location.search + location.hash;
        })
        .catch(() => {});
      await navP;
      await expect(page.locator(".card")).toHaveCount(18, { timeout: 10_000 });
    } finally {
      await context.setOffline(false);
    }
  });

  test("控制台无错误", async ({ page }) => {
    const errors = [];
    page.on("pageerror", (err) => errors.push(String(err)));
    page.on("console", (msg) => {
      if (msg.type() === "error") errors.push(msg.text());
    });
    await page.goto("/");
    await expect(page.locator(".card")).toHaveCount(18);
    // 交互盲区：开/关灯箱 + 快速连续切筛选（会 skip 进行中的 VT——
    // finished 无 catch 时其 InvalidStateError reject 会冒泡成 unhandledrejection）
    await page.locator(".card").first().click();
    await expect(page.locator("#lightbox")).toBeVisible();
    await page.locator("#close").click();
    await expect(page.locator("#lightbox")).toBeHidden();
    await page.locator(".filter-chip").nth(1).click();
    await page.waitForTimeout(100);
    await page.locator(".filter-chip").first().click();
    await page.waitForTimeout(1000);
    expect(errors).toEqual([]);
  });
});
