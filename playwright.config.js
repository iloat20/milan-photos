// @ts-check
const { defineConfig, devices } = require("@playwright/test");

// 端口的单一事实源：serve.py 的 --port 与这里的 baseURL / webServer 同源，
// 避免「配置写死 8080，而 8080 上恰好是别人」。
// 需要换端口时：MILAN_PORT=8099 npx playwright test
const PORT = process.env.MILAN_PORT || "8080";
const BASE_URL = `http://127.0.0.1:${PORT}`;

// 用哪个解释器起 serve.py。默认 `python`（与 CI 的 setup-python 一致）；
// 本机若 `python` 指向没装 Pillow 的解释器（实测：托管 3.13 无 Pillow、
// 系统 3.12 有），serve.py 会静默降级成「无缩略图 / 无 palette」的版本，
// 症状是一堆互不相关的用例变红。global-setup.js 会把这种情况明确报出来，
// 也可用 MILAN_PY=py 直接换解释器。
const PY = process.env.MILAN_PY || "python";

module.exports = defineConfig({
  testDir: "tests/e2e",
  // 跑任何用例之前先确认「服务提供的确实是本仓库的文件」，详见该文件注释
  globalSetup: "./tests/e2e/global-setup.js",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: BASE_URL,
    trace: "on-first-retry",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: {
    command: `${PY} tools/serve.py --port ${PORT}`,
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
  },
});
