/** @type {import('stylelint').Config} */
module.exports = {
  extends: ["stylelint-config-standard"],
  rules: {
    // 项目既有约定：类名连字符风格、自定义属性双空格排版均保留
    "selector-class-pattern": null,
    "custom-property-pattern": null,
    "color-function-notation": null,
    "alpha-value-notation": null,
    "number-max-precision": null,
    "declaration-block-no-redundant-longhand-properties": null,
    "shorthand-property-no-redundant-values": null,
    "value-keyword-case": null,
    "font-family-no-duplicate-names": true,
    "no-duplicate-selectors": true,
    // 既有惯例/兼容性取舍：rgba 书写、有意 vendor 前缀、hover 顺序、旧式 media 语法（保旧 Safari）、既有 id 命名
    "color-function-alias-notation": null,
    "property-no-vendor-prefix": null,
    "no-descending-specificity": null,
    "media-feature-range-notation": null,
    "selector-id-pattern": null,
  },
};
