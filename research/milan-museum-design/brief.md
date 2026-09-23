# Research brief — 米兰美术馆照片墙项目设计

## Refined question

「米兰美术馆」静态照片墙（GitHub Pages，无字油画馆陈列）当前的视觉/交互设计决策，在可验证的数字美术馆、摄影画廊与作品墙实践中分别对应什么原则、反例与可改进点？报告需服务本项目：评估现有设计是否站得住，以及哪些改动有外部依据。

## Scope

**In**
- 数字博物馆 / 在线展览 / 美术馆网站的视觉与信息架构（约 2024–2026 优先）
- 摄影/作品墙布局：等高 justified 网格、画廊墙、hero 轮播、灯箱
- 暗色展厅美学：墙面取色、金框/画框隐喻、衬线馆名、无墙签（少字）呈现
- 照片浏览 UX 与性能惯例：懒加载、srcset、手势、View Transitions、离线
- 可对比的开源 GitHub Pages / 纯静态相册项目的设计取向

**Out**
- 本仓库代码级 bug 修复或功能实现（本研究只产出报告）
- 相机/摄影创作技法、相册业务后端
- 非展示层面的 CI/token 安全审计（可一笔带过，不作为主线）

## Assumptions

- 受众：项目维护者（中文），用于决定「要不要改设计、改哪几处」
- 决策：当前「无字油画馆」方向是否合理；若调整，优先动视觉还是信息层
- 本地现状（研究背景，不作网络证据）：深墙绿 `#1f2a24` + 金色 `#c9a96a` + 象牙字；全屏轮播 + 等高画库 + 金框灯箱；`sampleRoomColor()` 按画作采样墙面；`styles.css` 末尾故意 `display:none` 藏掉墙签/说明/上传文案/GitHub 面板等；无 npm、纯静态
- 时间框：优先 2024–2026 来源；经典设计原则可引用更早一手材料
- 今日日期：2026-09-19

## Depth

**standard** · Round-1 sub-agents: 4 · Max follow-up rounds: 1 · Sources target: 15+ · Query budget per agent: 6

## Angles

### F1 — 数字美术馆在线展览设计
在线博物馆/美术馆站点如何组织「序厅—展厅—作品」叙事？暗色/浅色展厅、导航克制、作品优先 vs 机构信息优先的近年实践。

### F2 — 摄影墙与作品网格布局
Justified gallery、masonry、固定比例网格、画廊墙（gallery wall）在网页摄影呈现中的优劣与权威建议；等高行布局与「像挂在墙上」隐喻的对应关系。

### F3 — 框、光与无墙签美学
数字端画框/金色饰边、墙面自适应取色、低文案（wall label hiding）是否被美术馆/摄影集设计支持；文化机构字体与字距（衬线馆名、大写 kicker）惯例。

### F4 — 照片浏览交互与性能基准
灯箱、全屏轮播、触控滑动、懒加载/WebP/srcset/View Transitions/SW 离线在高质量摄影站点中的常见做法与已知取舍（含无障碍与 `prefers-reduced-motion`）。

## Workspace

`C:\Users\Administrator\Downloads\work\milan\research\milan-museum-design\`
