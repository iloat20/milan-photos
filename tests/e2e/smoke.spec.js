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
    const pageErrs = [];
    page.on("pageerror", (e) => pageErrs.push("pageerror:" + String(e)));
    page.on("console", (m) => {
      if (m.type() === "error") pageErrs.push("console:" + m.text());
    });
    page.on("requestfailed", (req) =>
      pageErrs.push(
        "reqfail:" + req.url().replace(/^https?:\/\/[^/]+/, "") +
          " " + (req.failure()?.errorText || "")
      )
    );
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
    // 关键预热：goto 的 navigation 早于 SW register，SW 此前从未拦截过 navigation——
    // 「SW 首次拦截 navigation/子资源」若恰逢 CDP 离线边界会出现 0 卡混沌（已实测双形态：
    // app.js 直达网络被断 JS 没跑；manifest fetch 断 + 快照窗口期 match 落空）。
    // 在线先 reload 一遍让 shellSwr/networkFirst 全链路走热，离线导航即第二次（热）路径。
    await page.reload();
    await expect(page.locator(".card")).toHaveCount(18);
    await page.waitForFunction(
      async () => {
        const regs = await navigator.serviceWorker.getRegistrations();
        const activated = regs.some((r) => r.active?.state === "activated");
        const hasManifest = !!(await caches.match(
          new Request("photos/manifest.json", { cache: "no-store" }),
          { ignoreSearch: true }
        ));
        return (
          activated && !!navigator.serviceWorker.controller && hasManifest
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
      // 早态：导航完成后立刻取时间线，失败时与 errs 一起输出
      const early = await page
        .evaluate(() => ({
          readyState: document.readyState,
          cards0: document.querySelectorAll(".card").length,
          appSrc: [...document.scripts].map((s) => s.src).filter((s) => s.includes("app.js")),
        }))
        .catch((err) => ({ earlyErr: String(err) }));
      try {
        await expect(page.locator(".card")).toHaveCount(18, { timeout: 10_000 });
      } catch (e) {
        // 失败现场：区分 fetch 挂起 / 缓存缺失 / SW 掉线 / 页面异常，避免间歇问题盲修
        const diag = await page
          .evaluate(async () => ({
            controller: !!navigator.serviceWorker.controller,
            keys: await caches.keys(),
            matchDirect: !!(await caches.match("photos/manifest.json", {
              ignoreSearch: true,
            })),
            fetchRes: await Promise.race([
              fetch("photos/manifest.json", { cache: "no-store" })
                .then((r) => "status:" + r.status)
                .catch((err) => "reject:" + err.name),
              new Promise((r) => setTimeout(() => r("HANG-5s"), 5000)),
            ]),
            cards: document.querySelectorAll(".card").length,
          }))
          .catch((err) => ({ diagErr: String(err) }));
        console.log(
          "OFFLINEDIAG " +
            JSON.stringify({
              ...diag,
              early,
              pageErrs: pageErrs.slice(0, 10),
              lf: await page.evaluate(() => window.__lf || null).catch(() => "read-err"),
            })
        );
        throw e;
      }
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
