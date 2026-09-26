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
];
