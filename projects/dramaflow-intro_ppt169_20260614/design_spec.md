# DramaFlow 项目介绍 - Design Spec

> Human-readable design narrative. Machine-readable execution contract: `spec_lock.md` (on divergence, `spec_lock.md` wins).

## I. Project Information

| Item | Value |
| ---- | ----- |
| **Project Name** | dramaflow-intro |
| **Canvas Format** | PPT 16:9 (1280×720) |
| **Page Count** | 11 |
| **Design Style** | briefing + soft-rounded（简洁、中性、可扫描） |
| **Target Audience** | 开发者 / 技术团队成员 / 项目相关方 |
| **Use Case** | 项目介绍、技术分享、新成员 onboarding |
| **Created Date** | 2026-06-14 |

---

## II. Canvas Specification

| Property | Value |
| -------- | ----- |
| **Format** | PPT 16:9 |
| **Dimensions** | 1280×720 |
| **viewBox** | `0 0 1280 720` |
| **Margins** | 左右 64px，上下 56px |
| **Content Area** | 1152×608（安全区） |

---

## III. Visual Theme

### Theme Style

- **Mode**: `briefing` — 中性、完整、可扫描；主题标题、均衡权重
- **Visual style**: `soft-rounded` — 圆角卡片、柔和层次、亲和力
- **Theme**: Light theme
- **Tone**: 现代、干净、科技 + 创意

### Color Scheme

| Role | HEX | Purpose |
| ---- | --- | ------- |
| **Background** | `#FFFFFF` | 页面背景 |
| **Secondary bg** | `#F8FAFC` | 卡片、区块底色 |
| **Primary** | `#4F46E5` | 标题装饰、图标、关键区块（indigo） |
| **Accent** | `#06B6D4` | 数据高亮、强调（cyan） |
| **Body text** | `#1E293B` | 正文 |
| **Secondary text** | `#64748B` | 说明、注释 |
| **Tertiary text** | `#94A3B8` | 页脚、补充信息 |
| **Border/divider** | `#E2E8F0` | 卡片边框、分隔线 |
| **Success** | `#10B981` | 正向状态（已就绪） |
| **Warning** | `#EF4444` | 驳回 / 待办标记 |

### AI Image Strategy

图片方案为 A（不使用图片），省略本节。

---

## IV. Typography System

### Font Plan

**Typography direction**: 现代 CJK 无衬线（Concord 一致 + 字重对比），技术词汇用等宽体

| Role | Chinese | English | Fallback tail |
| ---- | ------- | ------- | ------------- |
| **Title** | `"Microsoft YaHei", "PingFang SC"` | — | `sans-serif` |
| **Body** | `"Microsoft YaHei", "PingFang SC"` | — | `sans-serif` |
| **Code** | — | `Consolas, "Courier New"` | `monospace` |

**Per-role font stacks**:
- Title: `"Microsoft YaHei", "PingFang SC", sans-serif`
- Body: `"Microsoft YaHei", "PingFang SC", sans-serif`
- Code: `Consolas, "Courier New", monospace`

### Font Size Hierarchy

**Baseline**: Body font size = **22px**

| Purpose | Ratio | Size @ body=22 | Weight |
| ------- | ----- | -------------- | ------ |
| Cover title | 3x | 66px | Bold |
| Section opener | 2x | 44px | Bold |
| Page title | 1.6x | 36px | Bold |
| Subtitle | 1.3x | 29px | SemiBold |
| **Body** | **1x** | **22px** | Regular |
| Annotation | 0.75x | 16px | Regular |
| Footnote | 0.6x | 13px | Regular |

**Formula rendering policy**: `text-only`（本项目无数学公式）。

---

## V. Layout Principles

### Page Structure

- **Header area**: 高 ~80px，含页码 + 页面标题 + primary 色装饰条
- **Content area**: 高 ~540px
- **Footer area**: 高 ~40px，含项目名 + 页码

### Layout Pattern Library

| Pattern | Suitable Scenarios |
| ------- | ----------------- |
| Single column centered | 封面、定位、结尾 |
| Three/four column cards | 核心能力、技术栈、AI 能力 |
| Horizontal bands | 解决的问题（痛点带） |
| Matrix grid (2×2) | 工作区四模式 |
| Layered horizontal | 架构总览 |
| Horizontal pipeline / flow | 创作工作流、AI 生产链 |
| Two-column comparison | 项目状态 |

### Spacing Specification

**Universal**: 安全边距 64/56px；内容块间距 32px；图标-文字 12px。
**Card-based**: 卡片间距 24px；内边距 24px；圆角 16px；三列卡宽 ~360px。

---

## VI. Icon Usage Specification

### Source

- **Built-in icon library**: `tabler-outline`（描边线条风）
- **Stroke width**: 2（deck-wide）

### Recommended Icon List

| Purpose | Icon Path | Page |
| ------- | --------- | ---- |
| 短剧/影视 | `tabler-outline/movie` | P01 |
| 散落组件（工具割裂） | `tabler-outline/components` | P02 |
| AI 能力 | `tabler-outline/robot` | P02 |
| 协作 | `tabler-outline/users` | P02 |
| 启动/回答 | `tabler-outline/rocket` | P02, P11 |
| 创作写剧本 | `tabler-outline/writing` | P04, P07 |
| 分镜/工作区 | `tabler-outline/layout-grid` | P04, P09 |
| 图片生成 | `tabler-outline/photo` | P04, P07 |
| 视频生成 | `tabler-outline/video` | P04, P07 |
| 语音 TTS | `tabler-outline/microphone` | P04, P07 |
| 审阅/通过 | `tabler-outline/circle-check` | P04, P08 |
| 时间线 | `tabler-outline/timeline` | P04, P09 |
| 导出 | `tabler-outline/file-export` | P04, P06, P07 |
| 技术栈 | `tabler-outline/code` | P05, P06 |
| 数据库 | `tabler-outline/database` | P05, P06 |
| 云存储 | `tabler-outline/cloud` | P05, P06 |
| 实时 | `tabler-outline/bolt` | P06, P08 |
| 架构分层 | `tabler-outline/stack` | P06, P08 |
| 服务器 | `tabler-outline/server` | P05, P06 |
| 信息模式 | `tabler-outline/info-circle` | P09 |
| 文档模式 | `tabler-outline/file-text` | P09 |
| 任务模式 | `tabler-outline/list-check` | P09 |
| 版本/刷新 | `tabler-outline/refresh` | P06, P08 |
| 已就绪 | `tabler-outline/check` | P10 |
| 未来/规划 | `tabler-outline/clock` | P10 |

---

## VII. Visualization Reference List

Catalog read: 71 templates

| Page | Template | Path | Summary-quote (verbatim from `charts_index.json`) | Usage |
| ---- | -------- | ---- | ------------------------------------------------- | ----- |
| P04 | icon_grid | `templates/charts/icon_grid.svg` | "Pick for 4-9 parallel features/capabilities/services as icon cards — feature grid, service lineup, benefits matrix, brand values, product highlights. Skip for sequential ordering (use numbered_steps) or hierarchical layers (use pyramid_chart)." | 6 项核心产品能力并列展示 |
| P06 | layered_architecture | `templates/charts/layered_architecture.svg` | "Pick for 3-4 horizontal architecture layers (presentation/service/data), 2-4 module cards per layer, each card = title + 1-line description (description required, even if source brief). Skip if no per-module descriptions (use icon_grid) or no horizontal layering (use module_composition)." | 前端/服务/任务/共享契约四层架构 |
| P07 | pipeline_with_stages | `templates/charts/pipeline_with_stages.svg` | "Pick for 3-5 horizontal pipeline stages, each = title + 1-line description + output artifact, connected by arrows (data pipelines, ETL, build pipelines). Skip if any stage lacks an artifact (use process_flow or numbered_steps)." | AI 生产链 5 阶段（每阶段产出物） |
| P08 | process_flow | `templates/charts/process_flow.svg` | "Pick for 3-8 sequential steps connected by simple arrows — approval workflows, customer onboarding, request handling, lifecycle stages. Skip if cyclical (use circular_stages) or stages produce named outputs (use pipeline_with_stages)." | 版本状态流转 draft→approved/rejected |
| P09 | labeled_card | `templates/charts/labeled_card.svg` | "Pick for 3-4 parallel aspects of one subject with per-aspect titles + short body (self-introduction, four-pillar overview, capability quadrant). Skip for plain feature lists (use icon_grid), sequential steps (use numbered_steps), or strategic quadrants (use quadrant_text_bullets / matrix_2x2)." | 工作区 4 种模式（每模式带说明） |

**Runners-up considered**:

- `labeled_card` | rejected for P04: 核心能力是并列的单项特性，无需每卡大段正文 body，icon-led 卡片更贴切
- `vertical_list` | rejected for P04: 能力点不像带描述的编号要点，icon_grid 更直观
- `module_composition` | rejected for P06: 四个 app 是客户端-服务端分层，而非父容器包裹子模块
- `client_server_flow` | rejected for P06: 只能呈现 web↔api 请求流，无法承载 shared 契约层完整分层
- `process_flow` | rejected for P07: 生成链每阶段都有命名产出物，pipeline_with_stages 能凸显产出物
- `pipeline_with_stages` | rejected for P08: 版本状态流转不产生命名产出物，是状态机
- `icon_grid` | rejected for P09: 工作区模式每项需要短说明 body，不只是图标卡

---

## VIII. Image Resource List

图片方案为 A（不使用图片），省略本节。

---

## IX. Content Outline

### Part 1: 开场

#### Slide 01 - 封面

- **Layout**: 单列居中 + 装饰背景几何
- **Title**: DramaFlow
- **Subtitle**: AI 驱动的短剧全流程生产平台
- **Info**: TypeScript Monorepo · Web + API + Worker + Shared · 2026

#### Slide 02 - 解决的问题

- **Layout**: 五条紧凑横向痛点行 + 底部回答横条
- **Title**: 解决的问题
- **Core message**: 传统短剧生产流程的五大痛点 —— 工具、AI 能力、协作、组装、一致性各自为政。
- **Content**:
  - 工具链割裂 — 剧本、分镜、绘图、视频、配音、剪辑散落多个工具，素材靠手动搬运
  - AI 能力难成闭环 — 文本 / 图 / 视频 / TTS 各自为政，产出物无法被下游复用
  - 协作与审阅缺位 — 版本、评论、审计、权限依赖文件名与聊天记录
  - 成片组装最后一公里 — 产出物仍需手工拼时间线、对齐字幕与音轨再导出
  - 角色视觉一致性难维持 — 反复重生成时人物与场景外观容易漂移
  - DramaFlow 的回答 —— 一个平台，一条 AI 全流程闭环

#### Slide 03 - 项目定位

- **Layout**: 单列居中（breathing，大留白）
- **Title**: 项目定位
- **Core message**: 面向导演与制作团队的短剧 AI 全流程生产平台 —— 从剧本到导出的闭环。
- **Content**:
  - 一句话定位：从剧本到导出的 AI 全流程闭环
  - 三支柱：创作 / 媒体生产 / 协作与导出

### Part 2: 能力与技术

#### Slide 04 - 核心能力

- **Layout**: 三列双行卡片网格（icon_grid）
- **Title**: 核心能力
- **Core message**: 六大核心能力构成从创作到导出的完整闭环。
- **Visualization**: icon_grid
- **Content**: AI 写作 · 分镜工作台 · 图片生成 · 视频生成 · TTS 配音 · 协作审阅

#### Slide 05 - 技术栈

- **Layout**: 四列分组卡片（前端 / 后端 / 数据 / 基础设施）
- **Title**: 技术栈
- **Core message**: 全栈 TypeScript，现代化、统一语言、共享契约。
- **Content**: 前端 Next.js 15 / 后端 NestJS 11 / 数据 PostgreSQL+Prisma / 基础设施 npm workspaces+双存储+FFmpeg

#### Slide 06 - 架构总览

- **Layout**: 水平分层架构（layered_architecture）
- **Title**: 架构总览
- **Core message**: Monorepo 四件套——前端、API、Worker、共享契约——职责清晰、单向依赖。
- **Visualization**: layered_architecture
- **Content**: 前端层 web / 服务层 api / 任务层 worker / 契约层 shared + 横切关注点基座

#### Slide 07 - AI 生成能力

- **Layout**: 水平生产链（pipeline_with_stages）
- **Title**: AI 生成能力
- **Core message**: 一条端到端的 AI 生产链，每阶段产出可复用的中间产物。
- **Visualization**: pipeline_with_stages
- **Content**: 文本生成 → 图片 → 视频 → TTS → 合成导出

#### Slide 08 - 创作工作流

- **Layout**: 水平状态流转（process_flow）
- **Title**: 创作工作流
- **Core message**: draft → submitted → pending_review → approved/rejected，规则集中在 shared 包。
- **Visualization**: process_flow
- **Content**: 草稿→提交→待审→通过/驳回（回环）+ 规则集中 / 版本管理 / 实时同步

#### Slide 09 - 工作区与协作

- **Layout**: 2×2 标签卡片（labeled_card）
- **Title**: 工作区与协作
- **Core message**: 统一工作区通过 URL ?mode= 切换四种模式。
- **Visualization**: labeled_card
- **Content**: info / document / tasks / timeline 四模式

### Part 3: 现状与收尾

#### Slide 10 - 项目状态

- **Layout**: 双栏对比（breathing，裸文本 + 分隔）
- **Title**: 项目状态
- **Core message**: 开发就绪，关键能力已落地；部分基础设施面向未来产品化演进。
- **Content**: 已就绪 5 项（Prisma / Worker / Socket.IO / provider+mock / FFmpeg）· 规划中 2 项（Redis/BullMQ / 生产化加固）

#### Slide 11 - 结尾

- **Layout**: 单列居中（anchor）
- **Title**: Thank You
- **Subtitle**: DramaFlow — 让短剧创作如行云流水
- **Info**: Node.js >= 24 · npm install · npm run build

---

## X. Speaker Notes Requirements

每页一个 speaker note 文件，保存到 `notes/`，匹配 SVG 名。
- **总时长**: ~9-11 分钟
- **风格**: 正式但友好（技术分享口吻）

---

## XI. Technical Constraints Reminder

### SVG Generation Must Follow:

1. viewBox: `0 0 1280 720`
2. 背景用 `<rect>`；文本换行用 `<tspan>`（`<foreignObject>` 禁用）
3. 透明度用 `fill-opacity` / `stroke-opacity`；`rgba()` 禁用
4. 禁用：`mask`, `<style>`, `class`, `foreignObject`, `textPath`, `animate*`, `script`
5. 文本字符用原生 Unicode；HTML 命名实体禁用；XML 保留字转义 `&amp; &lt; &gt;`

### PPT Compatibility Rules:

- `<g opacity>` 禁用；仅内联样式；外部 CSS 与 `@font-face` 禁用
