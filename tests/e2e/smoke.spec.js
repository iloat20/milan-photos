const { test, expect } = require("@playwright/test");
const { createHash } = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

test.describe("画廊冒烟", () => {
  test("首页渲染 18 张卡片且缩略图走 AVIF 协商", async ({ page }) => {
    await page.goto("/");
    const cards = page.locator(".card");
    await expect(cards).toHaveCount(18);
    // 每张卡片的 picture 都挂了 image/avif source
    await expect(page.locator('.card picture source[type="image/avif"]')).toHaveCount(18);
    // 主动滚进展厅触发其余懒加载图片，再验证浏览器实际选择了 AVIF。
    await cards.first().scrollIntoViewIfNeeded();
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

  test("manifest 响应体只被消费一次（不得有第二个消费者）", async ({ page }) => {
    // 回归锁（2026-10-10 审查）：index.html 的解析期预载脚本与 app.js 曾共用同一个
    // Response 并各自 .json() —— 第二个消费者抛 `TypeError: body stream already read`，
    // app.js 的 catch 把 folderPhotos 置空 → 展厅 0 卡、序厅 0 画面，且控制台零报错。
    // 修复是内联脚本改读 res.clone()：原始响应体只交给 app.js 一个消费者。
    // 这里直接观察「有没有人 json() 到一个已被消费的 body」，比「卡片数 = 18」
    // 更早失败、也更直接指向根因（注意：修复后原始响应体 bodyUsed 应为 true——
    // app.js 消费了它；所以不能断言 bodyUsed === false，只能断言无人读到已消费的 body）。
    await page.addInitScript(() => {
      window.__jsonReads = [];
      const orig = Response.prototype.json;
      Response.prototype.json = function (...args) {
        window.__jsonReads.push({ bodyUsed: this.bodyUsed, url: this.url });
        return orig.apply(this, args);
      };
    });
    await page.goto("/");
    await expect(page.locator(".card")).toHaveCount(18);

    const reads = await page.evaluate(() => window.__jsonReads);
    const manifestReads = reads.filter((r) => String(r.url).includes("manifest.json"));
    // 前置：确实抓到了清单解析（解析期预载 + app.js 两处），否则下面的空数组是空洞通过
    expect(manifestReads.length).toBeGreaterThanOrEqual(2);
    // 核心：没有任何一次 json() 落在已被消费的 body 上
    expect(manifestReads.filter((r) => r.bodyUsed)).toEqual([]);
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

  test("观画室策展说明：有则显示原文、无则隐藏，且题名区高度恒定", async ({
    page,
    request,
  }) => {
    /* 座位号与 manifest 下标一一对应：展厅按 manifest 顺序渲染，筛选 all 时
       visible = photos.slice()，故 .card 第 i 张 = manifest 第 i 条。
       下标从清单里现算，不写死 —— 换图/换序都不会让这条悄悄测错对象。 */
    const res = await request.get("/photos/manifest.json");
    const list = (await res.json()).photos;
    const withCap = list.findIndex((p) => (p.caption || "").trim());
    expect(withCap, "清单里得有带策展说明的条目").toBeGreaterThanOrEqual(0);

    // ④ 要用的最长策展句。先算好，下面挑空样本时必须避开它
    const longest = list
      .map((p, i) => ({ i, n: (p.caption || "").trim().length }))
      .sort((a, b) => b.n - a.n)[0];
    expect(longest.n, "清单里没有策展说明，④ 会空洞通过").toBeGreaterThan(0);

    /* 「无说明」这一支原先靠「清单里恰好有空说明的条目」供养（findIndex 找不到
       下标就直接红）。18 件全部写完策展说明后，真实清单里已无空样本，那条断言
       就从「验行为」退化成「验内容形状」—— 内容一补齐，护栏自动失效。
       改为自造样本：把一条既不是 withCap、也不是 longest 的条目抹空再喂给页面。

       拦在页面 JS 层而不是 page.route()：index.html 的内联脚本在解析期就
       fetch("photos/manifest.json") 并把 Promise 挂到 window.__milanManifest
       （app.js 复用同一 Promise），而该请求由 sw.js 的 isManifest 分支接管，
       page.route 拦不到 SW 发起的取数。addInitScript 在文档创建时注入，
       先于内联脚本执行，能确定性命中；SW 自身的 install 快照不受影响。

       注入是否真的生效，由下面的 ① 自己看守：条目若没被抹空，第 blankIdx 张
       会带着真说明显示出来，① 的 toBeHidden 立刻红 —— 样本造假不成立。 */
    const blankIdx = list.findIndex((_, i) => i !== withCap && i !== longest.i);
    expect(blankIdx, "至少需要第三张图来自造空说明样本").toBeGreaterThanOrEqual(0);
    const patched = JSON.parse(JSON.stringify(list));
    patched[blankIdx].caption = "";
    await page.addInitScript(
      ({ body, needle }) => {
        const original = window.fetch;
        window.fetch = function (input, init) {
          const url = typeof input === "string" ? input : (input && input.url) || "";
          if (url.includes(needle)) {
            return Promise.resolve(
              new Response(body, {
                status: 200,
                headers: { "content-type": "application/json" },
              })
            );
          }
          return original.call(this, input, init);
        };
      },
      { body: JSON.stringify({ photos: patched }), needle: "photos/manifest.json" }
    );
    const withoutCap = blankIdx;

    await page.goto("/");
    await expect(page.locator(".card")).toHaveCount(18);

    const openAt = async (i) => {
      await page.locator(".card").nth(i).click();
      await expect(page.locator("#lightbox")).toBeVisible();
      await page.waitForFunction(
        () => {
          const img = document.getElementById("lbImg");
          return img && img.currentSrc;
        },
        null,
        { timeout: 10_000 }
      );
    };
    const closeLb = async () => {
      await page.locator("#close").click();
      await expect(page.locator("#lightbox")).toBeHidden();
    };
    const metaHeight = () =>
      page.locator(".lightbox-meta").evaluate((el) => el.getBoundingClientRect().height);

    // ① 无说明：元素**必须仍在 DOM 里**（占位靠它撑高），且不可见
    await openAt(withoutCap);
    await expect(page.locator("#lbCaption")).toHaveCount(1);
    await expect(page.locator("#lbCaption")).toBeHidden();
    const hEmpty = await metaHeight();
    await closeLb();

    // ② 有说明：逐字等于 manifest 值（不是「非空」这类空洞断言）
    await openAt(withCap);
    await expect(page.locator("#lbCaption")).toBeVisible();
    await expect(page.locator("#lbCaption")).toHaveText(list[withCap].caption.trim());
    const hFilled = await metaHeight();
    await closeLb();

    // ③ 零跳动：题名区高度不给「有无说明」左右。这条才是真正的护栏 ——
    //    把 .is-empty 从 visibility:hidden 改成 display:none（或删掉 min-height）同样
    //    能通过 ① 的「不可见」，但画框会被挤动，只有这里抓得住。
    expect(
      Math.abs(hFilled - hEmpty),
      "切到无说明的图时题名区高度变了，上方画框会整块跳一下"
    ).toBeLessThanOrEqual(0.5);

    // ④ 移动端：最长的策展句仍须单行 —— 换行同样会破坏 ③ 的高度恒定
    await page.setViewportSize({ width: 390, height: 844 });
    await openAt(longest.i);
    const cap = await page.locator("#lbCaption").evaluate((el) => ({
      h: el.getBoundingClientRect().height,
      lh: parseFloat(getComputedStyle(el).lineHeight),
    }));
    expect(cap.h, "策展说明在 390px 下换行了（换行即破坏高度恒定）").toBeLessThanOrEqual(
      cap.lh * 1.5
    );
  });

  test("手机宽度保持双列展厅且灯箱可用", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/");
    const cards = page.locator(".card");
    await expect(cards).toHaveCount(18);

    const layout = await page.locator("#galleryGrid").evaluate((gallery) => ({
      columns: getComputedStyle(gallery).gridTemplateColumns.split(" ").length,
      noHorizontalOverflow:
        document.documentElement.scrollWidth <= window.innerWidth,
    }));
    expect(layout).toEqual({ columns: 2, noHorizontalOverflow: true });

    await cards.first().click();
    const lightbox = page.locator("#lightbox");
    await expect(lightbox).toBeVisible();
    const frameBox = await page.locator(".lightbox-frame").boundingBox();
    expect(frameBox).not.toBeNull();
    expect(frameBox.x).toBeGreaterThanOrEqual(0);
    expect(frameBox.x + frameBox.width).toBeLessThanOrEqual(390);
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
    // 先暂停自动轮播：本用例只测手动切换，而 4.2s 的 auto tick 可能落在
    // 「断言 0」与「点击」之间，把索引悄悄推到 1，next 一点就成了 2（实测红）。
    const pauseBtn = page.locator("#heroPause");
    await pauseBtn.click();
    await expect(pauseBtn).toHaveAttribute("aria-pressed", "true");
    expect(await activeIdx()).toBe(0);
    await page.locator("#heroNext").click();
    await expect.poll(activeIdx, { timeout: 3_000 }).toBe(1);
    await page.locator("#heroPrev").click();
    await expect.poll(activeIdx, { timeout: 3_000 }).toBe(0);
  });

  test("Service Worker 激活只清理本站旧缓存", async ({ page }) => {
    await page.goto("/");
    await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller));

    const cachesAfterActivate = await page.evaluate(async () => {
      const current = await navigator.serviceWorker.getRegistration();
      if (current) await current.unregister();

      const unrelated = await caches.open("unrelated-project-v1");
      await unrelated.put("/unrelated.js", new Response("keep"));
      const stale = await caches.open("milan-v0-shell");
      await stale.put("/stale", new Response("stale"));

      // 查询串确保这是全新的 Worker 安装，即使 sw.js 文件内容没有变化。
      const registration = await navigator.serviceWorker.register(
        "./sw.js?e2e-cache-isolation=1"
      );
      const worker = registration.installing || registration.waiting || registration.active;
      if (!worker) throw new Error("Service Worker 未创建");
      if (worker.state !== "activated") {
        await new Promise((resolve, reject) => {
          const timer = setTimeout(() => reject(new Error("Service Worker 激活超时")), 10_000);
          const checkState = () => {
            if (worker.state === "activated") {
              clearTimeout(timer);
              resolve();
            } else if (worker.state === "redundant") {
              clearTimeout(timer);
              reject(new Error("Service Worker 安装失败"));
            }
          };
          worker.addEventListener("statechange", checkState);
          checkState();
        });
      }

      const preserved = await (await caches.open("unrelated-project-v1")).match(
        "/unrelated.js"
      );
      return {
        unrelated: preserved ? await preserved.text() : null,
        staleOwnCacheExists: await caches.has("milan-v0-shell"),
      };
    });

    expect(cachesAfterActivate.unrelated).toBe("keep");
    expect(cachesAfterActivate.staleOwnCacheExists).toBe(false);
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

  // —— 批次 1 修复的回归网（无字陈列层叠 / 画心裁切分层 / 窄屏箭头遮挡）——

  test("展厅间距按断点取值（无字陈列层叠回归）", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto("/");
    await expect(page.locator(".card")).toHaveCount(18);

    const readLayout = () =>
      page.evaluate(() => {
        const gallery = document.getElementById("galleryGrid");
        const head = document.querySelector(".chapter-head");
        const cs = getComputedStyle(gallery);
        return {
          rowGap: cs.rowGap,
          columnGap: cs.columnGap,
          headMarginBottom: getComputedStyle(head).marginBottom,
        };
      });

    // 桌面：无字陈列块靠 responsive 层压过 sections 层的基础值
    expect(await readLayout()).toEqual({
      rowGap: "52px",
      columnGap: "36px",
      headMarginBottom: "28px",
    });

    // 窄屏：同层同权重下写在后面的 @media (max-width:560px) 必须反过来赢
    await page.setViewportSize({ width: 390, height: 844 });
    await expect.poll(readLayout).toEqual({
      rowGap: "40px",
      columnGap: "16px",
      headMarginBottom: "36px",
    });
  });

  test("画心裁切盒与墙面光分层（射灯回归）", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto("/");
    await expect(page.locator(".card")).toHaveCount(18);
    await expect(page.locator(".card-media")).toHaveCount(18);
    await expect(page.locator(".card-media-glass")).toHaveCount(18);
    await expect(page.locator(".card-media-glass img")).toHaveCount(18);

    const geom = await page.evaluate(() => {
      const media = document.querySelector(".card-media");
      const glass = media.querySelector(".card-media-glass");
      const img = glass.querySelector("img");
      const border = parseFloat(getComputedStyle(media).borderLeftWidth);
      const mediaBox = media.getBoundingClientRect();
      return {
        mediaOverflow: getComputedStyle(media).overflow,
        glassOverflow: getComputedStyle(glass).overflow,
        // content-visibility:auto 隐含 paint containment，会把 ::before 溢出的墙面光裁掉；
        // 该 containment 在 getComputedStyle().contain 上不可见，只能锁 content-visibility 本身
        cardContentVisibility: getComputedStyle(media.closest(".card"))
          .contentVisibility,
        gutter: mediaBox.width - img.getBoundingClientRect().width,
        expected: border * 2 + 4 * 2,
      };
    });

    // 光必须能溢出画框：外层不裁切，裁切收敛到只包画心的 glass
    expect(geom.mediaOverflow).toBe("visible");
    expect(geom.glassOverflow).toBe("hidden");
    // 卡片不得开启会被动裁剪子盒的渲染跳过
    expect(geom.cardContentVisibility).toBe("visible");
    // 画心几何与拆分前一致：border 2px + --frame-inset 4px，两侧共 12px
    expect(Math.abs(geom.gutter - geom.expected)).toBeLessThan(0.5);
  });

  test("窄屏箭头隐藏且不覆盖画心，翻页交回手势", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/");
    await expect(page.locator(".card")).toHaveCount(18);

    await expect(page.locator(".hero-carousel-arrow")).toHaveCount(2);
    await expect(page.locator(".hero-carousel-arrow").first()).toBeHidden();

    await page.locator(".card").first().click();
    await expect(page.locator("#lightbox")).toBeVisible();
    await expect(page.locator(".lb-arrow").first()).toBeHidden();
    await page.waitForFunction(
      () => {
        const img = document.getElementById("lbImg");
        return img && img.currentSrc;
      },
      null,
      { timeout: 10_000 }
    );

    // 灯箱开启后约 0.5s 处于 View Transition 期间，此间 **命中测试会落到 HTML**
    // （= pointerdown 打不到 .lightbox-stage），横滑手势不响应：swipeX 未初始化 →
    // dx 为 NaN → 判定恒假。这是既有的开启动画窗口，与墙色/调色板改动无关；
    // 图片被预载命中缓存时手势发得更早，就更容易落进这个窗口。
    // 本用例要测的是「箭头隐藏后手势仍可用」，所以在手势前等**命中测试就绪**，
    // 而不是等一个拍脑袋的时长。
    await page.waitForFunction(
      () => {
        const stage = document.querySelector(".lightbox-stage");
        if (!stage) return false;
        const r = stage.getBoundingClientRect();
        const el = document.elementFromPoint(
          Math.round(r.x + r.width * 0.75),
          Math.round(r.y + r.height / 2)
        );
        return Boolean(el) && (el === stage || stage.contains(el));
      },
      null,
      { timeout: 5_000 }
    );

    // 箭头隐藏后翻页必须仍可用：灯箱横滑（app.js 阈值 48px）
    const before = await page.locator("#lbImg").evaluate((img) => img.currentSrc);
    const stage = await page.locator(".lightbox-stage").boundingBox();
    const cy = stage.y + stage.height / 2;
    await page.mouse.move(stage.x + stage.width * 0.75, cy);
    await page.mouse.down();
    await page.mouse.move(stage.x + stage.width * 0.25, cy, { steps: 8 });
    await page.mouse.up();
    await expect
      .poll(
        () => page.locator("#lbImg").evaluate((img) => img.currentSrc),
        { timeout: 5_000 }
      )
      .not.toBe(before);

    await page.locator("#close").click();
    await expect(page.locator("#lightbox")).toBeHidden();
  });

  test("桌面端灯箱箭头让开画心", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto("/");
    await expect(page.locator(".card")).toHaveCount(18);
    await page.locator(".card").first().click();
    await expect(page.locator("#lightbox")).toBeVisible();

    const frame = await page.locator(".lightbox-frame").boundingBox();
    const prev = await page.locator(".lb-prev").boundingBox();
    const next = await page.locator(".lb-next").boundingBox();
    expect(frame).not.toBeNull();
    expect(prev.x + prev.width).toBeLessThanOrEqual(frame.x);
    expect(next.x).toBeGreaterThanOrEqual(frame.x + frame.width);

    await page.locator("#close").click();
  });

  test("骨架屏与真实展厅布局一致（列 / gap / 内边距 / 宽度）", async ({ page }) => {
    // 骨架屏只在 manifest 到达前可见，等它出现再量一定会 flaky。
    // 这里改成「数据到达后临时取消隐藏 → 读 computed style → 立刻还原」，
    // 纯比较 CSS 计算结果，与网络时序完全无关。
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto("/");
    await expect(page.locator(".card")).toHaveCount(18);

    const readPair = () =>
      page.evaluate(() => {
        const skel = document.getElementById("gallerySkeleton");
        const grid = document.getElementById("galleryGrid");
        const wasHidden = skel.hidden;
        skel.hidden = false;
        const pick = (el) => {
          const cs = getComputedStyle(el);
          return {
            cols: cs.gridTemplateColumns,
            rowGap: cs.rowGap,
            columnGap: cs.columnGap,
            padding: cs.padding,
            maxWidth: cs.maxWidth,
            alignItems: cs.alignItems,
            display: cs.display,
            width: Math.round(el.getBoundingClientRect().width),
          };
        };
        const pair = { skeleton: pick(skel), gallery: pick(grid) };
        skel.hidden = wasHidden;
        return pair;
      });

    const desktop = await readPair();
    expect(desktop.skeleton).toEqual(desktop.gallery);
    // computed 值会把 auto-fill 解析成实际轨道（如 "260px 260px 260px"），
    // 这里仍需确认轨道数 > 1，否则「两边都是 1 列」也能空洞地相等。
    const trackCount = (cols) => cols.trim().split(/\s+/).length;
    expect(trackCount(desktop.gallery.cols)).toBeGreaterThanOrEqual(3);

    await page.setViewportSize({ width: 390, height: 844 });
    // 窄屏真实展厅是 2 列；骨架屏曾经在这里是 1 列（auto-fill + 80px 内边距）
    await expect.poll(async () => trackCount((await readPair()).gallery.cols)).toBe(2);
    const mobile = await readPair();
    expect(mobile.skeleton).toEqual(mobile.gallery);
    expect(trackCount(mobile.skeleton.cols)).toBe(2);
  });

  test("缺元素时降级运行而非整站白屏（事件绑定守卫）", async ({ page }) => {
    // 复现「HTML 结构变化 / SW 旧壳层配新页面」：直接把灯箱 <dialog> 整块删掉，
    // 于是 #prev / #next / #close / .lightbox-stage / #lbImg 全部为 null。
    // 修复前：`closeBtn.addEventListener` 抛 TypeError → IIFE 中断 →
    //         骨架屏永不消失、展厅永久空白，控制台只有一个 TypeError。
    // 修复后：绑定静默降级，展厅照常渲染。
    const pageErrors = [];
    page.on("pageerror", (err) => pageErrors.push(String(err)));

    await page.route("**/*", async (route) => {
      if (route.request().resourceType() !== "document") return route.continue();
      const res = await route.fetch();
      const html = (await res.text()).replace(/<dialog[\s\S]*?<\/dialog>/, "");
      const headers = { ...res.headers() };
      delete headers["content-length"];
      await route.fulfill({ status: res.status(), headers, body: html });
    });

    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto("/");

    // 核心断言：展厅必须照常渲染，且骨架屏必须退场
    await expect(page.locator(".card")).toHaveCount(18);
    await expect(page.locator("#gallerySkeleton")).toBeHidden();
    expect(pageErrors).toEqual([]);
  });

  test("缺 #siteNav 时同样降级（启动期量高不得裸取 offsetHeight）", async ({ page }) => {
    // 与上一条同源，但破坏点更致命：measureHeroEnd() 在启动期就于
    // renderFilters / renderGallery / loadFolderPhotos **之前**碰 #siteNav。
    // 修复前它裸取 siteNav.offsetHeight，删掉 <header id="siteNav"> 即 TypeError
    // 中断整个 IIFE —— 实测 cards=0、#gallerySkeleton.hidden=false、主题按钮未绑，
    // 比「灯箱缺元素」严重得多（灯箱缺了只是少一个域，这里整站停在骨架屏）。
    const pageErrors = [];
    page.on("pageerror", (err) => pageErrors.push(String(err)));

    await page.route("**/*", async (route) => {
      if (route.request().resourceType() !== "document") return route.continue();
      const res = await route.fetch();
      const html = (await res.text()).replace(/<header[\s\S]*?<\/header>/, "");
      const headers = { ...res.headers() };
      delete headers["content-length"];
      await route.fulfill({ status: res.status(), headers, body: html });
    });

    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto("/");

    await expect(page.locator(".card")).toHaveCount(18);
    await expect(page.locator("#gallerySkeleton")).toBeHidden();
    expect(pageErrors).toEqual([]);
  });

  test("主题按钮：未手动选过时首击即翻转（跟随系统不等于已选 light）", async ({ page }) => {
    // 回归：原先 `current = document.documentElement.dataset.theme` 在未手动选过时是
    // undefined，`next` 于是恒为 "light" —— 亮色系统的用户第一击只是把 undefined
    // 写成 "light"，页面毫无变化（实测背景仍 rgb(255,255,255)），要第二击才变暗。
    // 现在缺省时先问系统当前主题，保证一击必反转。
    await page.emulateMedia({ colorScheme: "light" });
    await page.goto("/");
    // 等展厅就绪：IIFE 早已跑完，主题绑定必然已完成（绑定早于卡片渲染）
    await expect(page.locator(".card")).toHaveCount(18);
    await expect(page.locator("html")).not.toHaveAttribute("data-theme", /.+/);
    const bg = () => page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    const lightBg = await bg();

    await page.locator("#themeToggle").click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    expect(await bg()).not.toBe(lightBg);
    expect(await page.evaluate(() => localStorage.getItem("milan-theme"))).toBe("dark");

    await page.locator("#themeToggle").click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
    expect(await bg()).toBe(lightBg);
  });

  test("手动亮色压过系统暗色（序厅底纹随主题洗淡，不再只看系统偏好）", async ({ browser }) => {
    // 回归：亮色「洗淡」原先是 styles.css 里的一段 @media (prefers-color-scheme: light)，
    // 只认**系统**偏好 —— 系统暗色 + 手动切亮时 body 已是 #fff，序厅底纹却仍是
    // rgb(10,10,10)→rgb(0,0,0) 的黑房间（实测）。改用 light-dark() 后两处同源。
    // 断言取**结构**（洗淡会把 color-mix 落成 oklab）而非具体色值：与 1.2s 的
    // 环境色过渡、与各张 palette 的具体数值都无竞态。
    const heroBgWith = async (colorScheme, manualTheme) => {
      const ctx = await browser.newContext({
        colorScheme,
        viewport: { width: 1280, height: 900 },
      });
      if (manualTheme) {
        await ctx.addInitScript((v) => localStorage.setItem("milan-theme", v), manualTheme);
      }
      const p = await ctx.newPage();
      await p.goto("/");
      await expect(p.locator(".card")).toHaveCount(18);
      const bg = await p.evaluate(
        () => getComputedStyle(document.querySelector(".hero-carousel")).backgroundImage
      );
      await ctx.close();
      return bg;
    };

    expect(await heroBgWith("light", null)).toContain("oklab");
    expect(await heroBgWith("dark", null)).not.toContain("oklab");
    // 本次修复点：手动亮色必须与「系统亮色」同等洗淡
    expect(await heroBgWith("dark", "light")).toContain("oklab");
  });

  test("库房设置面板走 popover：点开、原生 Esc 关、关闭即不可见", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator(".card")).toHaveCount(18);
    const panel = page.locator("#ghPanel");
    // 收起态：display:none（兜底写法，见 styles.css 的 .gh-panel 注释）
    await expect(panel).toBeHidden();

    await page.locator("#upload").scrollIntoViewIfNeeded();
    await page.locator("#ghToggle").click();
    await expect(panel).toBeVisible();
    await expect(page.locator("#ghRepo")).toBeVisible();
    // 真在 top layer 的打开态，而不是「恰好显示了」
    await expect.poll(() => panel.evaluate((el) => el.matches(":popover-open"))).toBe(true);

    // 居中：面板中心 = 视口中心。别小看这条——styles.css 里用的是
    // `top:50%; left:50%; translate:-50% -50%`，而构建管线（vite8/lightningcss）会把
    // 「写在 transform 之前的独立 translate/rotate/scale」静默吞掉，居中当场失效、
    // 面板整块掉到右下象限（页面照样能开关，肉眼不盯着截图看不出来）。
    //
    // 但读法必须**轮询到过渡收敛**，不能同步读一次：面板开启有 0.24s 的 transform
    // 过渡（@starting-style 自 translateY(10px) scale(0.98) 起，见 styles.css .gh-panel）。
    // 探针实测垂直偏移随时间是 t=0→10px、t≈33ms→8.24px、t≈82ms→1.79px、t≈250ms→0；
    // CI 正是读在 ~33ms / ~82ms 处，于是拿到 8.24 / 1.79 而假红（本地只是赌赢了时机）。
    // 若居中真被吞掉，偏移会停在 height/2 量级、此轮询超时仍会红——护栏语义不变。
    const vp = page.viewportSize();
    expect(await panel.boundingBox()).not.toBeNull();
    const offsetFromCentre = async () => {
      const b = await panel.boundingBox();
      if (!b) return Infinity;
      return Math.max(
        Math.abs(b.x + b.width / 2 - vp.width / 2),
        Math.abs(b.y + b.height / 2 - vp.height / 2)
      );
    };
    await expect
      .poll(offsetFromCentre, {
        timeout: 3_000,
        message: "库房面板未收敛到视口中心（居中是否被构建管线吞掉？）",
      })
      .toBeLessThanOrEqual(1);

    // Esc 关闭是 UA 行为（本仓没有为它写 keydown）；light dismiss 同理
    await page.keyboard.press("Escape");
    await expect(panel).toBeHidden();
    await expect.poll(() => panel.evaluate((el) => el.matches(":popover-open"))).toBe(false);
  });

  test("序厅画作可键盘打开，且非活动 slide 不在 Tab 序列内", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator(".card")).toHaveCount(18);

    const arts = page.locator(".hero-art");
    await expect(arts).toHaveCount(8);

    // 8 张 slide 叠放在同一位置：只有活动那张能进 Tab 序列 / 无障碍树。
    // 用 <button> 承载画作后，opacity:0 + pointer-events:none 已挡不住键盘，
    // 必须靠活动态切换 visibility。
    await expect(arts.nth(0)).toBeVisible();
    for (let i = 1; i < 8; i += 1) {
      await expect(arts.nth(i)).toBeHidden();
    }

    // 键盘可达：<button> 原生响应 Enter → 冒泡到 slide 的 click → 开灯箱
    await arts.first().focus();
    await expect(arts.first()).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page.locator("#lightbox")).toBeVisible();
    await page.locator("#close").click();
    await expect(page.locator("#lightbox")).toBeHidden();

    // 再 Tab 一步：不得落到任何 .hero-art（那 7 张不可见的都必须被跳过）
    await arts.first().focus();
    await page.keyboard.press("Tab");
    const landedOnArt = await page.evaluate(
      () => document.activeElement?.classList?.contains("hero-art") ?? false
    );
    expect(landedOnArt).toBe(false);
  });

  test("筛选栏语义为 group，chip 仍是 aria-pressed 切换按钮", async ({ page }) => {
    await page.goto("/");
    // chip 由 manifest 数据决定，必须先等展厅就绪，否则只剩「全部展厅」一个
    await expect(page.locator(".card")).toHaveCount(18);
    // role="toolbar" 要求 roving tabindex + 方向键导航；这里并未实现，
    // 故改用语义自洽的 group（一组 aria-pressed 按钮、全部在 Tab 序列内）。
    await expect(page.locator("#filterBar")).toHaveAttribute("role", "group");

    const chips = page.locator("#filterBar button");
    await expect.poll(() => chips.count(), { timeout: 5_000 }).toBeGreaterThan(1);
    await expect(chips.first()).toHaveAttribute("aria-pressed", "true");
    // 仍在 Tab 序列内：可聚焦
    await chips.nth(1).focus();
    await expect(chips.nth(1)).toBeFocused();
  });

  test("墙色取自 manifest 预计算调色板，而非客户端采样（P1-6）", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator(".card")).toHaveCount(18);

    // 断言「取值 === manifest 里的 palette」，而不是「颜色不等于初始值」——
    // 后者采样兜底同样满足，测不出 palette 字段被 loadFolderPhotos 的白名单吞掉。
    // 这个坑真实发生过：manifest 里 18/18 都有值，页面却照旧跑采样。
    const norm = (s) => {
      const m = /rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)/.exec(s || "");
      return m ? `${m[1]},${m[2]},${m[3]}` : null;
    };

    const manifest = await page.evaluate(async () => {
      const res = await fetch("/photos/manifest.json", { cache: "no-store" });
      const data = await res.json();
      return (data.photos || []).map((p) => p.palette || null);
    });
    expect(manifest).toHaveLength(18);
    expect(manifest.every((p) => p && p.wall && p.glow && p.accent)).toBe(true);

    // 卡片墙色是同步赋值的（不等图片解码），且 `.card-media` 的 transition 只列了
    // background、**未**列 --card-wall，所以 computed 即终值，读一次即可，无时序问题。
    // （序厅则相反，见下方注释——差别就在这里。）
    const applied = await page.evaluate(() =>
      [...document.querySelectorAll("#galleryGrid .card-media")].map((el) => {
        const cs = getComputedStyle(el);
        return {
          wall: cs.getPropertyValue("--card-wall"),
          glow: cs.getPropertyValue("--card-glow"),
          accent: cs.getPropertyValue("--card-accent"),
        };
      })
    );
    expect(applied).toHaveLength(18);
    for (let i = 0; i < 18; i += 1) {
      for (const k of ["wall", "glow", "accent"]) {
        expect(norm(applied[i][k]), `第${i}张 ${k}`).toBe(norm(manifest[i][k]));
      }
    }
    // 且确实不是 CSS 初始墙色（防「manifest 与初始值恰好同色」的空洞通过）
    expect(norm(applied[0].wall)).not.toBe("42,36,24");

    // 序厅：--room-adapt 三变量同样来自首张的 palette。
    //
    // ⚠️ 这里**不能**读一次 computed 就比：`.hero-carousel` 把 --room-adapt 三个变量
    // 都列进了 transition（1.8s，且 styles.css 有对应的 @property 注册），
    // 于是 getComputedStyle 返回的是**插值中的瞬时值**。实测（写入后计时）：
    //   t=0     rgb(51, 58, 50)
    //   t=0.4s  rgb(66, 69, 59)
    //   t=1.0s  rgb(73, 74, 64)
    //   t=2.2s  rgb(74, 75, 65)  ← 收敛，等于 manifest[0].wall
    // 这个竞态在 CI 上真实爆过：本地读在过渡之后（过绿），CI 读在过渡之中（红），
    // 且两次读数不同（41,49,43 / 58,63,55）——两者都精确落在「CSS 初始值 #1f2a24
    // → manifest[0].wall」的插值线上。
    //
    // 先断言 **inline 值**（app.js 写进去的那一个）：它不受过渡影响，精确、无竞态，
    // 且正是本用例要查的东西——palette 有没有被 loadFolderPhotos 的白名单吞掉
    // （被吞则 applyRoomToHero 走采样分支或不被调用，inline 就不会是 manifest 的值）。
    const heroInline = await page.evaluate(() =>
      ["--room-adapt", "--room-adapt-deep", "--room-adapt-glow"].map((n) =>
        document.getElementById("heroCarousel").style.getPropertyValue(n)
      )
    );
    expect(norm(heroInline[0])).toBe(norm(manifest[0].wall));
    expect(norm(heroInline[1])).toBe(norm(manifest[0].deep));
    expect(norm(heroInline[2])).toBe(norm(manifest[0].glow));

    // 再确认动画层**确实收敛**到同一值（证明它不只是被写进 style、还真的生效到
    // 用户可见层）。轮询而非固定 sleep：过渡时长由 CSS 决定，写死等待会随样式漂移。
    await expect
      .poll(
        async () => {
          const s = await page.evaluate(() =>
            getComputedStyle(document.getElementById("heroCarousel"))
              .getPropertyValue("--room-adapt")
          );
          return norm(s);
        },
        {
          timeout: 5_000,
          message: "序厅 --room-adapt 的 computed 值未收敛到 manifest[0].wall",
        }
      )
      .toBe(norm(manifest[0].wall));
  });

  /* —— 灯箱「点击 / 缩放」手势 ——
     设计文档：research/milan-museum-design/2026-09-26-lightbox-tap-zoom-design.md

     覆盖两个既有缺陷：
       ① 放大态双击只能进不能出 —— click 每次都先 step(±1)，而 step → sync →
          resetZoom(false) 必把 zoom 打回 1，于是 toggleLbZoomAt 的 `if (zoom > 1)`
          分支**永不可达**；触屏用户双击放大后只能靠捏合或关闭逃出。
       ② 手慢双击跳过两张 —— tapTimer 的固定 450ms 与浏览器双击窗口不对齐
          （系统可设 200–900ms），落在灰区时两次 click 各前进一张。

     ⚠️ **Playwright 的 mouse.click 不产生 dblclick**：实测 mouse.dblclick 传
     clickCount:2、mouse.click 传 1，detail 反映的是 API 参数而非时序。所以「手慢
     双击」只能用 dispatchEvent 手工派发 —— 真实浏览器手慢双击发出的正是这一串。
     同理，位置断言一律读 location.hash（sync 里同步写入），不读 img.currentSrc
     （异步、需要轮询，且两次换图之间的中间值会让轮询误过）。 */

  const hashOf = (page) => page.evaluate(() => location.hash);
  const zoomOf = (page) =>
    page.evaluate(() =>
      Number(
        getComputedStyle(document.getElementById("lbImg")).getPropertyValue("--lb-zoom")
      )
    );

  async function openLightboxReady(page, size = { width: 1280, height: 900 }) {
    await page.setViewportSize(size);
    await page.goto("/");
    await expect(page.locator(".card")).toHaveCount(18);
    await page.locator(".card").first().click();
    await expect(page.locator("#lightbox")).toBeVisible();
    await page.waitForFunction(() => document.getElementById("lbImg")?.currentSrc, null, {
      timeout: 10_000,
    });
    // 开窗 VT 期间命中测试会落到 HTML（见「窄屏箭头隐藏」用例的说明），等它过去
    await page.waitForFunction(
      () => {
        const s = document.querySelector(".lightbox-stage");
        const r = s.getBoundingClientRect();
        const el = document.elementFromPoint(
          Math.round(r.x + r.width / 2),
          Math.round(r.y + r.height / 2)
        );
        return Boolean(el) && s.contains(el);
      },
      null,
      { timeout: 5_000 }
    );
  }

  const frameCentre = async (page) => {
    const b = await page.locator(".lightbox-frame").boundingBox();
    return { cx: Math.round(b.x + b.width / 2), cy: Math.round(b.y + b.height / 2) };
  };

  /** 用滚轮建立缩放态：不经点击，didSwipe 与连击组都干净 */
  const zoomByWheel = async (page, cx, cy, notches = 3) => {
    await page.mouse.move(cx, cy);
    for (let i = 0; i < notches; i += 1) await page.mouse.wheel(0, -100);
    await expect.poll(() => zoomOf(page), { timeout: 3_000 }).toBeGreaterThan(1);
  };

  test("放大态单击缩回 1×，且不切图", async ({ page }) => {
    await openLightboxReady(page);
    const { cx, cy } = await frameCentre(page);
    const startHash = await hashOf(page);
    await zoomByWheel(page, cx, cy);

    await page.mouse.click(cx, cy);

    await expect.poll(() => zoomOf(page), { timeout: 3_000 }).toBe(1);
    expect(await hashOf(page)).toBe(startHash);
  });

  test("放大态双击只缩回一次，不切图也不重新放大", async ({ page }) => {
    await openLightboxReady(page);
    const { cx, cy } = await frameCentre(page);
    const startHash = await hashOf(page);
    await zoomByWheel(page, cx, cy);

    await page.mouse.dblclick(cx, cy);

    await expect.poll(() => zoomOf(page), { timeout: 3_000 }).toBe(1);
    expect(await hashOf(page)).toBe(startHash);
  });

  test("手慢双击不跳过两张（跨过旧 tapTimer 的 450ms 仍判为双击）", async ({ page }) => {
    await openLightboxReady(page);
    const { cx, cy } = await frameCentre(page);
    const startHash = await hashOf(page);

    await page.mouse.click(cx, cy); // 真实第一击：乐观切图

    // 第二击必须落在与第一击**同组**的 GROUP_MS(1000ms) 窗口内：否则 groupStart 会记在
    // 「切图之后」的位置上，dblclick 的绝对回退就变成退到第二张（实测红态：期望
    // #p=<第 1 张> 收到 #p=<第 2 张>，正是 groupStart=1 的指纹）。原写法是 Node 侧
    // waitForTimeout(600) + 再发事件，中间夹着 poll 与两趟 IPC——并行负载下这点开销
    // 就能吃掉剩下的 400ms，本用例因此偶发变红（隔离跑 3/3 绿）。
    // 现在等待与两次派发都在一个 evaluate 内由页面自己的计时器完成，Node↔浏览器只剩
    // 「mouse.click → evaluate」一跳；顺带把「第一击后到了哪张」从页面里带回来，
    // 替代原来那段纯为断言而花的 poll。
    const hashAtSecondClick = await page.evaluate(
      ({ x, y }) =>
        new Promise((done) => {
          setTimeout(() => {
            const stage = document.querySelector(".lightbox-stage");
            const init = { bubbles: true, detail: 2, clientX: x, clientY: y };
            // 越过旧实现的 450ms tapTimer（它过期后第二击会被当成独立单击，再切一张）
            const mid = location.hash;
            stage.dispatchEvent(new MouseEvent("click", init));
            stage.dispatchEvent(new MouseEvent("dblclick", init));
            done(mid);
          }, 500);
        }),
      { x: cx, y: cy }
    );
    expect(hashAtSecondClick).not.toBe(startHash);

    // 回到第一击之前的位置（旧实现会停在「前进两张」），且确实完成了放大
    await expect.poll(() => hashOf(page), { timeout: 3_000 }).toBe(startHash);
    expect(await zoomOf(page)).toBeGreaterThan(1);
  });

  test("单击后键盘翻页再双击：落在键盘翻页后的位置（连击组不跨路径泄漏）", async ({ page }) => {
    // 护栏（非红灯证明）：专盯连击组的 resetGroup() 有没有漏在非点击路径上。
    // 漏了的话，dblclick 会回到「单击之前」的起点 —— 一次性倒回 4 张。
    await openLightboxReady(page);
    const { cx, cy } = await frameCentre(page);
    const startHash = await hashOf(page);

    await page.mouse.click(cx, cy);
    await expect.poll(() => hashOf(page), { timeout: 3_000 }).not.toBe(startHash);
    const afterClickHash = await hashOf(page);

    await page.keyboard.press("ArrowRight"); // 非点击路径翻页，必须重置连击组
    await expect
      .poll(() => hashOf(page), { timeout: 3_000 })
      .not.toBe(afterClickHash);
    const afterKeyHash = await hashOf(page);

    await page.mouse.dblclick(cx, cy);

    await expect.poll(() => zoomOf(page), { timeout: 3_000 }).toBeGreaterThan(1);
    expect(await hashOf(page)).toBe(afterKeyHash);
  });

  // 触屏是本次修复的**主场景**：移动端没有滚轮，双击放大后若无法缩回，用户只能靠捏合
  // 或关闭灯箱逃出。上面几条全走鼠标合成输入，触屏路径必须单独覆盖。
  test.describe("触屏手势", () => {
    test.use({ hasTouch: true, viewport: { width: 390, height: 844 } });

    test("双击放大后可单击缩回，且两种手势都不切图", async ({ page }) => {
      await openLightboxReady(page, { width: 390, height: 844 });
      const { cx, cy } = await frameCentre(page);
      const startHash = await hashOf(page);

      await page.touchscreen.tap(cx, cy);
      await page.waitForTimeout(90);
      await page.touchscreen.tap(cx, cy);

      await expect.poll(() => zoomOf(page), { timeout: 3_000 }).toBeGreaterThan(1);
      expect(await hashOf(page)).toBe(startHash);

      // 关键断言：触屏单击缩回。放大态单击若仍切图，这里 hash 会变
      await page.touchscreen.tap(cx, cy);
      await expect.poll(() => zoomOf(page), { timeout: 3_000 }).toBe(1);
      expect(await hashOf(page)).toBe(startHash);
    });
  });

  /* —— 序厅→灯箱 的视图过渡源 ——
     设计文档：research/milan-museum-design/2026-09-28-hero-lightbox-vt-design.md

     原实现 open()/close() 各写一遍 `list ? null : cardImageAt(index)`，把「没有可
     配对的元素」与「会话跟随 list 索引」混成一个判据。序厅点击传 list 的前提恰恰是
     该画**不在 visible 里**（前面已有 `if (inFilter >= 0) return` 短路），于是：
       · 默认路径（无筛选，走 inFilter 分支、list 为空）→ 配到**屏外的展厅卡片**；
         实测桌面 card0 top=1184（vh 900，溢出 284px）、移动 top=1080（vh 844，溢出 236px），
         过渡中途露出空画框（桌面）与重影（移动）。
       · 筛选路径（list = photos）→ 完全无源。
     用户真正点击的**序厅画面**从不参与。

     权威判据是「谁拿到了 view-transition-name」——直接观察它，不做几何推断。
     ⚠️ 必须在 goto 之前装 observer（addInitScript 只对之后的导航生效），
     且用 expect.poll 而非 waitForFunction（后者包 async 回调会假绿，见 AGENTS.md）。 */
  test.describe("序厅→灯箱 过渡源", () => {
    const watchVtName = (page) =>
      page.addInitScript(() => {
        window.__vtLog = [];
        const start = () => {
          new MutationObserver((muts) => {
            for (const m of muts) {
              const el = m.target;
              if (!el || el.nodeType !== 1 || !el.style) continue;
              if (el.style.viewTransitionName !== "milan-lightbox-img") continue;
              window.__vtLog.push({
                inHero: Boolean(el.closest("#heroCarousel")),
                inGallery: Boolean(el.closest("#galleryGrid")),
                inLightbox: Boolean(el.closest("#lightbox")),
              });
            }
          }).observe(document.documentElement, {
            subtree: true,
            attributes: true,
            attributeFilter: ["style"],
          });
        };
        if (document.documentElement) start();
        else document.addEventListener("DOMContentLoaded", start, { once: true });
      });

    /** 除掉灯箱自身，第一个拿到该 name 的元素即配对源；一个都没有则 null */
    const observedSource = (page) =>
      page.evaluate(() => window.__vtLog.find((r) => !r.inLightbox) || null);

    const openFromHero = async (page) => {
      // 序厅画面在两种路径下都必须成为配对源：默认路径此前配到屏外卡片，
      // 筛选路径此前没有任何源。断言序厅内外各一遍，避免「恰好都是 null」空洞通过。
      await page.locator(".hero-carousel-slide.is-active .hero-art").click();
      await expect(page.locator("#lightbox")).toBeVisible();
      await expect.poll(() => observedSource(page), { timeout: 5_000 }).not.toBeNull();
      return observedSource(page);
    };

    test("无筛选点序厅：配对源是序厅画面，不是屏外的展厅卡片", async ({ page }) => {
      await watchVtName(page);
      await page.goto("/");
      await expect(page.locator(".card")).toHaveCount(18);

      const src = await openFromHero(page);
      expect(src.inHero, "配对源应落在序厅轮播内").toBe(true);
      expect(src.inGallery, "不得再配到展厅卡片（实测那张在屏外 284px）").toBe(false);
    });

    test("筛选不含该画时点序厅：同样以序厅画面作配对源", async ({ page }) => {
      await watchVtName(page);
      await page.goto("/");
      await expect(page.locator(".card")).toHaveCount(18);

      // 序厅 8 张全是 2026-09，筛到 2026年8月 必然进入「筛选不含该画」那条路径
      await page.locator("#filterBar button", { hasText: "2026年8月" }).click();
      await expect(page.locator(".card")).toHaveCount(2);

      const src = await openFromHero(page);
      expect(src.inHero, "配对源应落在序厅轮播内").toBe(true);
      expect(src.inGallery).toBe(false);
    });

    test("灯箱会话期间序厅停止自动轮播，关闭后恢复", async ({ page }) => {
      // 关灯箱时要缩回「用户点的那幅序厅画面」，轮播若在模态框背后继续转，
      // 被点的 slide 会变成 opacity:0 / visibility:hidden，配对到隐形状比不配对更糟。
      await page.goto("/");
      await expect(page.locator(".hero-carousel-slide")).toHaveCount(8);
      const activeIndex = () =>
        page.evaluate(() =>
          [...document.querySelectorAll(".hero-carousel-slide")].findIndex((s) =>
            s.classList.contains("is-active")
          )
        );

      await page.locator(".hero-carousel-slide.is-active .hero-art").click();
      await expect(page.locator("#lightbox")).toBeVisible();

      // 越过一个轮播周期（4200ms）：期间活动 slide 必须不变
      const atOpen = await activeIndex();
      await page.waitForTimeout(5_000);
      expect(await activeIndex(), "灯箱开着时序厅不该轮播").toBe(atOpen);

      await page.locator("#close").click();
      await expect(page.locator("#lightbox")).toBeHidden();
      // 关闭后恢复：不再悬停、给足一个周期，活动 slide 必须动起来
      await page.mouse.move(0, 0);
      await expect
        .poll(activeIndex, { timeout: 12_000, message: "关灯箱后序厅未恢复轮播" })
        .not.toBe(atOpen);
    });
  });

  /* ── 缺陷回归护栏（2026-10-02 审查确认的三个 bug）──
     每条都做过红态验证：先写断言、确认在未修复的 app.js 上真的会红，再修、再转绿。 */

  test("筛选 chip 激活后焦点保持在筛选栏内（整组重建不得把焦点打回 body）", async ({ page }) => {
    // renderFilters 每次 applyFilter 都 filterBar.innerHTML="" 整组重建：键盘 Enter
    // 激活 chip 后，被聚焦的按钮连根销毁，焦点回落 <body>，键盘用户的 Tab 位置全丢
    // （APG 切换按钮组要求激活后焦点留在原 chip）。红态实测：Enter 后 activeElement === body。
    await page.goto("/");
    await expect(page.locator(".card")).toHaveCount(18);
    const chips = page.locator(".filter-chip");
    await expect.poll(() => chips.count(), { timeout: 5_000 }).toBeGreaterThan(1);
    const target = chips.nth(1);
    const label = (await target.textContent()).trim();
    await target.focus();
    await page.keyboard.press("Enter");
    // 卡片数变化 = 筛选已落地 = filterBar 已重建
    await expect.poll(() => page.locator(".card").count(), { timeout: 5_000 }).toBeLessThan(18);
    const focused = await page.evaluate(() => {
      const el = document.activeElement;
      return {
        inBar: Boolean(el && el.closest && el.closest("#filterBar")),
        text: (el && el.textContent) || "",
      };
    });
    expect(focused.inBar, `激活后焦点跑到「${focused.text || "body"}」，不在筛选栏内`).toBe(true);
    expect(focused.text).toBe(label);
  });

  test("序厅为空（清单失败/零照片）时顶栏馆名不得被隐去", async ({ browser }) => {
    // measureHeroEnd 只在启动期与 resize 时执行：hero 被标 is-empty（display:none）后
    // heroEnd 仍是启动期量的整屏高，scrollY(0) < heroEnd 恒真 → is-at-hero 常驻 →
    // .site-nav-logo visibility:hidden —— 首屏既无序厅大字又无馆名。
    // 红态实测：nav 带 is-at-hero、logo computed visibility=hidden。
    const ctx = await browser.newContext({
      serviceWorkers: "block",
      viewport: { width: 1280, height: 900 },
    });
    const page = await ctx.newPage();
    await page.route("**/photos/manifest.json", (route) => route.abort());
    await page.goto("/");
    await expect(page.locator("#empty")).toBeVisible();
    await expect(page.locator("#heroCarousel")).toHaveClass(/is-empty/);
    await expect(page.locator("#siteNav")).not.toHaveClass(/is-at-hero/);
    await expect(page.locator(".site-nav-logo")).toBeVisible();
    await ctx.close();
  });

  test("图片预载必须带 type 提示（imagesrcset 按首个候选扩展名判定）", async ({ page }) => {
    // preloadImage 用 /\.avif$/i.test(整条 srcset) 判格式，而候选串以 "900w" 这样的
    // 宽度描述符结尾，$ 锚点永远不命中 → type 从未写上，注释里「不支持该格式的浏览器
    // 跳过预载」形同虚设。红态实测：带 imagesrcset 的 preload 其 type 属性为 null。
    await page.goto("/");
    await expect(page.locator(".card")).toHaveCount(18);
    await expect
      .poll(
        () =>
          page.evaluate(() =>
            [...document.querySelectorAll('link[rel="preload"][as="image"]')].some((l) =>
              l.getAttribute("imagesrcset")
            )
          ),
        { timeout: 5_000 }
      )
      .toBe(true);
    const entries = await page.evaluate(() =>
      [...document.querySelectorAll('link[rel="preload"][as="image"]')]
        .filter((l) => l.getAttribute("imagesrcset"))
        .map((l) => ({
          type: l.getAttribute("type"),
          srcset: l.getAttribute("imagesrcset").slice(0, 64),
        }))
    );
    expect(entries.length).toBeGreaterThan(0);
    for (const e of entries) {
      expect(e.type || "", `imagesrcset=${e.srcset}… 的预载缺 type 提示`).toMatch(
        /^image\/(avif|webp)$/
      );
    }
  });

  test("产物带全指令集 CSP，且内联脚本 hash 自洽（无悬空 / 无漏算）", async ({ request }) => {
    const res = await request.get("/");
    expect(res.ok()).toBeTruthy();
    const html = await res.text();

    const meta = html.match(
      /<meta\s+http-equiv="Content-Security-Policy"\s+content="([^"]+)"/i
    );
    expect(meta, "index.html 应含构建期注入的 CSP meta").not.toBeNull();
    const csp = meta[1];

    for (const directive of [
      "default-src 'self'",
      "style-src 'self'",
      "img-src 'self'",
      "connect-src 'self' https://api.github.com", // 库房「同步馆藏数据到 GitHub」直连该源
      "worker-src 'self'", // sw.js
      "manifest-src 'self'",
      "object-src 'none'",
      "base-uri 'none'",
      "form-action 'none'",
    ]) {
      expect(csp, `CSP 缺少指令：${directive}`).toContain(directive);
    }
    // 不得预置逃生阀：本站无 markup 内联样式、无 <style> 注入（样式写入全走 CSSOM）
    expect(csp).not.toContain("unsafe-inline");
    expect(csp).not.toContain("unsafe-eval");

    /* hash 双向自洽：声明的每个 hash 都能在页面某段内联脚本上验证通过（无悬空 hash），
       每段内联脚本也都被声明（无漏算）。CRLF→LF 归一是按 HTML 解析器的算法来的。
       ⚠️ 本条**不能**证明 hash 会被浏览器接受——它与构建脚本用的是同一条归一规则，
       两边一起错就一起通过。真正的地面真值是下面那条运行时零违规用例。 */
    const declared = (csp.match(/'(sha256-[A-Za-z0-9+/=]+)'/g) || [])
      .map((s) => s.slice(1, -1))
      .sort();
    const actual = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)]
      .map(
        (m) =>
          "sha256-" +
          createHash("sha256")
            .update(m[1].replace(/\r\n?/g, "\n"))
            .digest("base64")
      )
      .sort();
    // JSON-LD + 主题初值 + LCP 预载，三段；少一段说明锚点漂了
    expect(actual).toHaveLength(3);
    expect(declared).toEqual(actual);
  });

  test("CSP 运行时零违规（走过主题切换 / 灯箱 / 库房面板全交互）", async ({ page }) => {
    await page.addInitScript(() => {
      window.__cspViolations = [];
      document.addEventListener("securitypolicyviolation", (e) => {
        window.__cspViolations.push({
          directive: e.violatedDirective,
          blockedURI: e.blockedURI,
          sample: String(e.sample || "").slice(0, 160),
        });
      });
    });
    await page.goto("/");
    await expect(page.locator(".card")).toHaveCount(18);

    await page.locator("#themeToggle").click(); // 手动主题写入路径
    await page.locator(".card").first().click(); // 灯箱：srcset 协商 + medium/AVIF
    await expect(page.locator("#lightbox")).toBeVisible();
    await page.waitForFunction(
      () => {
        const img = document.getElementById("lbImg");
        return img && img.currentSrc;
      },
      null,
      { timeout: 10_000 }
    );
    await page.locator("#close").click();
    await page.locator("#upload").scrollIntoViewIfNeeded(); // 库房 popover
    await page.locator("#ghToggle").click();
    await expect(page.locator("#ghPanel")).toBeVisible();
    await page.waitForTimeout(300);

    // 非空断言：上面若哪一步没跑到，这条会以「违规 0」空洞通过
    expect(await page.evaluate(() => window.__cspViolations)).toEqual([]);
    await expect(page.locator("#ghPanel")).toBeVisible();
  });

  test("主题初值不依赖 app.js：拦掉它也必须已带 data-theme", async ({ browser }) => {
    /* 钉住「解析期内联脚本」这个机制本身。若初值又回到 app.js 的模块执行期，
       这里 data-theme 必为空 → 直接红，不赌任何测量时机。
       这条同时是 CSP hash 的**地面真值**：hash 若被浏览器拒绝，内联脚本不执行，
       data-theme 同样为空 → 必红（自洽性用例做不到这点，它和自己用的是同一套归一规则）。 */
    const ctx = await browser.newContext({
      colorScheme: "light",
      viewport: { width: 1280, height: 900 },
    });
    await ctx.addInitScript(() => {
      try {
        localStorage.setItem("milan-theme", "dark");
      } catch {
        /* 隐私模式 / 禁用 cookie —— 与 index.html 内联脚本同一因由，这里静默即可 */
      }
    });
    const page = await ctx.newPage();
    await page.route("**/app.js", (route) => route.abort());
    await page.goto("/", { waitUntil: "load" });
    await page.waitForFunction(
      () => getComputedStyle(document.documentElement).colorScheme !== ""
    );

    const state = await page.evaluate(() => ({
      theme: document.documentElement.dataset.theme || null,
      colorScheme: getComputedStyle(document.documentElement).colorScheme,
    }));
    expect(state.theme).toBe("dark");
    expect(state.colorScheme).toBe("dark"); // 存 dark + 系统 light → 必须按 dark 解析
    await ctx.close();
  });
});

/* ────────────────────────── 逐图展签页（P1 设计稿 §4） ──────────────────────────
   被测对象仍是构建产物：`dist/p/<slug>/index.html` 由 tools/gen_work_pages.mjs 在
   closeBundle 里生成，sitemap.xml 也由它产出（仓库根那份已删除）。

   判据分两路，各取所长：
   - **HTTP**（sitemap 声明的 URL 是否真的可达）—— 这是爬虫实际看到的世界，
     只有它能证明「目录 + index.html」在静态托管下确实可用。
   - **磁盘**（逐页内容与资源引用）—— 18 页 × 数个字段用 HTTP 全查要重复下载，
     而磁盘上就是被服务的那份（globalSetup 已核对新鲜度）。资源存在性顺带覆盖
     `/p/<slug>/` 相对深度写错的经典坏法：srcset 少一层 `../` 会 404，而
     `<picture>` 会静默回落到 `<img src>`（原图），页面上完全看不出来。 */
test.describe("逐图展签页", () => {
  const SITE = "https://iloat20.github.io/milan-photos/";
  const DIST = path.resolve(__dirname, "..", "..", "dist");
  const WORK_DIR = path.join(DIST, "p");

  /** 绝对 URL → 站点内路径（剥掉部署前缀 /milan-photos/；本仓 robots/globalSetup 同一手法） */
  const pagePath = (loc) => new URL(loc).pathname.replace(/^\/[^/]+\//, "/");

  function readPages() {
    expect(fs.existsSync(WORK_DIR), "dist/p/ 不存在——生成器没跑？").toBeTruthy();
    return fs
      .readdirSync(WORK_DIR, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name)
      .sort()
      .map((slug) => ({
        slug,
        dir: path.join(WORK_DIR, slug),
        html: fs.readFileSync(path.join(WORK_DIR, slug, "index.html"), "utf8"),
      }));
  }

  test("sitemap 声明的逐图页全部可达，且条数与馆藏一致", async ({ request }) => {
    const manifest = await (await request.get("/photos/manifest.json")).json();
    const photos = manifest.photos || [];
    expect(photos.length).toBeGreaterThan(0);

    const res = await request.get("/sitemap.xml");
    expect(res.status()).toBe(200);
    const locs = [...(await res.text()).matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);

    expect(locs.length, "sitemap = 主页 1 条 + 逐图 N 条").toBe(photos.length + 1);
    expect(pagePath(locs[0])).toBe("/");

    for (const loc of locs.slice(1)) {
      const page = await request.get(pagePath(loc));
      expect(page.status(), `${loc} 应 200（静态托管的「目录 + index.html」）`).toBe(200);
      expect(page.headers()["content-type"]).toContain("text/html");
    }
  });

  test("逐页 SEO 字段齐备：title 唯一 / canonical 自指 / og:image 绝对且可达 / alt 非空 / JSON-LD 可解析", async () => {
    const pages = readPages();
    const titles = new Map();

    for (const { slug, dir, html } of pages) {
      const canonical = /<link rel="canonical" href="([^"]+)"/.exec(html);
      expect(canonical, `${slug} 缺 canonical`).not.toBeNull();
      expect(canonical[1], `${slug} 的 canonical 必须自指`).toBe(`${SITE}p/${slug}/`);

      const title = /<title>([^<]+)<\/title>/.exec(html);
      expect(title, `${slug} 缺 <title>`).not.toBeNull();
      expect(title[1].trim().length, `${slug} 的 <title> 不能为空`).toBeGreaterThan(0);
      // 书名号不进 SERP 标题（《》是站内版式，不是检索词）
      expect(title[1], `${slug} 的 <title> 不该带书名号`).not.toContain("《");
      titles.set(title[1], (titles.get(title[1]) || 0) + 1);

      const ogImage = /<meta property="og:image" content="([^"]+)"/.exec(html);
      expect(ogImage, `${slug} 缺 og:image`).not.toBeNull();
      expect(ogImage[1].startsWith(`${SITE}`), `${slug} 的 og:image 必须是绝对 URL`).toBe(true);
      expect(
        fs.existsSync(path.join(DIST, ogImage[1].slice(SITE.length))),
        `${slug} 的 og:image 指向的产物不存在：${ogImage[1]}`
      ).toBeTruthy();

      const ogType = /<meta property="og:type" content="([^"]+)"/.exec(html);
      expect(ogType, `${slug} 缺 og:type`).not.toBeNull();

      const img = /<img\s[^>]*src="([^"]+)"[^>]*alt="([^"]*)"[^>]*>/.exec(html);
      expect(img, `${slug} 缺 <img>`).not.toBeNull();
      expect(img[2].trim().length, `${slug} 的 alt 不能为空（a11y + 图片搜索）`).toBeGreaterThan(0);
      expect(html, `${slug} 的 <img> 应有显式 width/height（防 CLS）`).toMatch(
        /<img\s[^>]*width="\d+"\s+height="\d+"/
      );

      // <picture> 的每个候选 + <img src> + 样式表都必须能落到产物文件上
      const candidates = [
        ...html.matchAll(/srcset="([^"]+)"/g),
      ].flatMap((m) =>
        m[1]
          .split(",")
          .map((part) => part.trim().split(/\s+/)[0])
          .filter(Boolean)
      );
      candidates.push(img[1]);
      expect(candidates.length, `${slug} 应至少有一组响应式候选`).toBeGreaterThan(0);
      for (const rel of candidates) {
        expect(
          fs.existsSync(path.resolve(dir, rel)),
          `${slug} 引用的图片在产物中不存在：${rel}（相对深度写错？）`
        ).toBeTruthy();
      }
      const css = /<link rel="stylesheet" href="([^"]+)"/.exec(html);
      expect(css, `${slug} 缺样式表引用`).not.toBeNull();
      expect(fs.existsSync(path.resolve(dir, css[1])), `${slug} 的样式表不存在`).toBeTruthy();

      const ld = /<script type="application\/ld\+json">([\s\S]*?)<\/script>/.exec(html);
      expect(ld, `${slug} 缺 JSON-LD`).not.toBeNull();
      const data = JSON.parse(ld[1]);
      expect(data["@type"]).toBe("Photograph");
      expect(data.contentUrl.startsWith(`${SITE}`)).toBe(true);
      expect(data.name.trim().length).toBeGreaterThan(0);
    }

    // 非空断言：上面的循环若一页都没跑到，重复数为 0 会空洞通过
    expect(pages.length).toBeGreaterThan(0);
    const duplicated = [...titles.entries()].filter(([, n]) => n > 1);
    expect(duplicated, `标题重复：${JSON.stringify(duplicated)}`).toEqual([]);
  });

  test("prev/next 是一条有端点、无环、覆盖全部页的链", async () => {
    const pages = readPages();
    const bySlug = new Map(pages.map((p) => [p.slug, p.html]));

    const nextOf = new Map();
    const prevOf = new Map();
    for (const { slug, html } of pages) {
      const next = /href="\.\.\/([^"/]+)\/" rel="next"/.exec(html);
      const prev = /href="\.\.\/([^"/]+)\/" rel="prev"/.exec(html);
      if (next) nextOf.set(slug, next[1]);
      if (prev) prevOf.set(slug, prev[1]);
    }

    // 端点：恰好各一个（不绕环 → 首件无 prev、末件无 next）
    expect(prevOf.size, "应恰好有 N-1 条 prev（首件没有）").toBe(pages.length - 1);
    expect(nextOf.size, "应恰好有 N-1 条 next（末件没有）").toBe(pages.length - 1);

    const first = pages.map((p) => p.slug).find((s) => !prevOf.has(s));
    expect(first, "应存在唯一的入口页（无 prev）").toBeTruthy();

    const visited = [];
    let cursor = first;
    while (cursor) {
      expect(visited, `链条出现环：${cursor}`).not.toContain(cursor);
      visited.push(cursor);
      expect(bySlug.has(cursor), `链条指向不存在的页：${cursor}`).toBe(true);
      cursor = nextOf.get(cursor);
    }
    // 集合相等（不是顺序）：链的顺序是**陈列顺序**，与磁盘目录的字典序无关
    expect([...visited].sort(), "从入口页应一路走遍全部展签页").toEqual(
      pages.map((p) => p.slug)
    );

    // 反向也要还原出同一条链
    let back = visited[visited.length - 1];
    const reversed = [];
    while (back) {
      reversed.push(back);
      back = prevOf.get(back);
    }
    expect(reversed.reverse()).toEqual(visited);
  });
});
