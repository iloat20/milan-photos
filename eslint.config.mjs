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
      sourceType: "script",
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
