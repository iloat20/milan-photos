# 安全策略

## 支持的版本

本站为静态站点（GitHub Pages），安全修复只针对 `main` 分支（即线上部署源）。

| 分支 | 支持情况 |
|---|---|
| `main` | ✅ 持续修复 |
| 其他分支 / 历史 tag | ❌ 不回溯 |

## 报告漏洞

**请勿以公开 issue 披露安全漏洞。**

请通过 GitHub 的私密漏洞披露渠道报告：
本仓库 → **Security** 标签页 → **Report a vulnerability**（Private vulnerability reporting）。

报告时请尽量附上：

- 复现步骤或 PoC（URL、请求、操作序列均可）；
- 影响评估（能读到什么 / 能改到什么）；
- 若涉及具体文件，给到 commit hash 更佳。

## 响应承诺

- **48 小时**内确认收到；
- 确认属实后按严重程度给出修复时间线（Critical ≤ 7 天，其余 ≤ 30 天）；
- 修复发布后在征得报告人同意的前提下于 release note 致谢。

## 已知边界（省得白跑一趟）

以下为**平台限制下的已知状态**，不构成漏洞：

- GitHub Pages 无法下发自定义响应头（`Referrer-Policy` / CSP 响应头 / COOP 等）——CSP 以 `<meta>` 形式内联（见 `tools/csp.mjs`）；
- 本仓无服务端、无后端存储，访客侧不收集任何数据；
- 库房同步用的 GitHub Token 仅保存在使用者本地浏览器 `localStorage`（提示已收敛为细粒度 PAT，见审计 SEC-1）。
