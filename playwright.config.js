// @ts-check
const { defineConfig, devices } = require("@playwright/test");

// 端口的单一事实源：webServer 里 vite preview 的 --port 与 baseURL 同源，
// 避免「配置写死 8080，而 8080 上恰好是别人」。
// 需要换端口时：MILAN_PORT=8099 npx playwright test
const PORT = process.env.MILAN_PORT || "8080";
const BASE_URL = `http://127.0.0.1:${PORT}`;

module.exports = defineConfig({
  testDir: "tests/e2e",
  // 跑任何用例之前先确认「端口上确实是本工作区刚构建的 dist」，详见该文件注释：
  // 它同时负责 dist 过期时的补构建（复用旧 preview 服务时靠它兜底）。
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
    // 被测对象 = 构建产物（与线上 Pages 同源）：每次起服务先 vite build 再 preview。
    // 构建失败会让服务起不来（整个运行红），不会静默跑旧产物；本地复用已起的服务时
    // 由 global-setup 的新鲜度检查补构建。端口被占用（strictPort）直接失败，不换端口硬跑。
    command: `npm run build && npm run preview -- --host 127.0.0.1 --port ${PORT} --strictPort`,
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
