import js from "@eslint/js";
import globals from "globals";

export default [
  {
    ignores: ["node_modules/**", "photos/**", "assets/**", ".lighthouseci/**", "test-results/**", "playwright-report/**"],
  },
  js.configs.recommended,
  {
    files: ["app.js"],
    languageOptions: {
      ecmaVersion: 2022,
      // P2-2 起 app.js 以 <script type="module"> 加载，需要 import 语法
      sourceType: "module",
      globals: { ...globals.browser },
    },
  },
  {
    // src/ 下的纯函数模块：浏览器 import + Node 单测双端加载。
    // 只用 ECMAScript 标准内建，故沿用 browser globals（含 Math / Date / decodeURIComponent）。
    files: ["src/**/*.js"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      globals: { ...globals.browser },
    },
  },
  {
    files: ["sw.js"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "script",
      globals: { ...globals.serviceworker },
    },
  },
  {
    files: ["eslint.config.mjs", "*.config.mjs", "tests/**/*.mjs"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      globals: { ...globals.node },
    },
  },
  {
    files: ["playwright.config.js", "stylelint.config.js", "tests/**/*.js"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "commonjs",
      globals: { ...globals.node, ...globals.commonjs, ...globals.browser },
    },
  },
  {
    files: ["tools/**/*.js"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "commonjs",
      globals: { ...globals.node },
    },
  },
  {
    // tools 下的 ESM 脚本（如 preview-shots.mjs）：宿主在 Node（process/console），
    // 而 page.evaluate / waitForFunction 的回调体在浏览器上下文执行（document）。
    // 与 tests/**/*.js 同一处理：两侧全局都放行。
    files: ["tools/**/*.mjs"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      globals: { ...globals.node, ...globals.browser },
    },
  },
];
