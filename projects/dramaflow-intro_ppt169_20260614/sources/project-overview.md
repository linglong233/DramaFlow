# DramaFlow 项目介绍

## 一句话定位
DramaFlow 是面向导演与制作团队的**短剧 AI 生产平台**，用 TypeScript 构建，覆盖从剧本创作、角色设定、分镜生成、图片/视频/TTS 媒体生产、审阅协作到时间线合成与导出的全流程。

## 核心价值
- **AI 辅助全流程**：剧本、梗概、分镜、改写均可流式生成（SSE）
- **对话式创作**：QA 对话 + 维度追踪（核心冲突、主角、配角、调性、节奏、约束），可实时编辑的 brief 面板，世界观上下文注入
- **媒体生产闭环**：逐镜头/批量 图片、视频、TTS 生成，候选管理，Lightbox 预览，明确采纳
- **协作与审阅**：版本管理（draft→submitted→pending_review→approved/rejected）、线程评论、审计、权限
- **实时更新**：Socket.IO 推送 job.updated / review.updated / notification.created / draft.character.synced
- **双存储后端**：本地文件系统 或 S3 兼容（MinIO）

## 技术栈
| 层 | 技术 |
|---|---|
| 前端 | Next.js 15 + React 19 + App Router |
| 后端 | NestJS 11 |
| 任务 | 轻量轮询 Worker（轮询 + 内部 API） |
| 共享契约 | @dramaflow/shared（领域类型、API 契约、业务规则） |
| 数据库 | PostgreSQL + Prisma ORM（26 个模型） |
| 实时 | NestJS + Socket.IO 网关 |
| 认证 | JWT access token + opaque refresh token（argon2 哈希） |
| 导出 | FFmpeg（可选） |

## 架构（Monorepo via npm workspaces）
```
apps/api       — NestJS 11 后端
apps/web       — Next.js 15 前端
apps/worker    — 轻量轮询 Worker
packages/shared — 跨栈领域类型与业务规则（唯一真相源）
```

### 数据层
PostgreSQL via Prisma（`apps/api/prisma/schema.prisma`，26 个模型）。`PrismaService` 注入到所有服务。

### 共享包（@dramaflow/shared）—— 唯一真相源
- `domain.ts` — 核心类型/枚举（DocumentType, VersionStatus, JobType, roles）
- `api-contracts.ts` — 请求/响应载荷类型
- `business-rules.ts` — 审阅/审批逻辑与权限检查
- `storyboard.ts` — 分镜领域逻辑
- `providers.ts` — 图片/视频生成 provider 接口
- `project-permissions.ts` — 项目级权限定义
- `impact-rules.ts` — 影响分析规则
- `version-diff.ts` — 版本差异逻辑
- `document-content.ts` — 文档内容类型
- `storage.ts` — 存储 provider 类型

### API（apps/api）
NestJS 模块：`AuthModule`, `WorkspaceModule`, `JobsModule`, `StorageModule`, `RealtimeModule`, `AdminModule`, `NotificationModule`

- `workspace.service.ts` — 最大服务（~132KB），处理文档、版本、世界观、角色、场景、风格指南的全部 CRUD
- `jobs.service.ts` — AI 生成任务编排（剧本、图片、视频、TTS、导出）
- `jobs/` — provider 实现（Gemini, SD WebUI, ComfyUI, Grok）与文本生成
- `common/` — PrismaService、auth guards、JWT、LLM provider service
- 内部 API key guard（`x-internal-key`）保护 `/internal/*` 端点

### Worker（apps/worker）
~100 行轮询循环。通过 `POST /internal/jobs/next` 认领任务，通过 `POST /internal/jobs/:id/process` 执行，处理重试。**无业务逻辑**——全部逻辑在 API。

### 前端（apps/web）
Next.js 15 App Router + React 19
- `app/` — 页面：login, dashboard, projects, workspace, admin
- `components/` — 共享组件 + `project-workspace/` 子目录（30+ 组件用于分镜、编辑、媒体）
- `components/unified-workspace.tsx` — 主工作区 shell（~44KB），通过 URL `?mode=` 切换模式（info, document, tasks, timeline）
- `lib/api.ts` — 自定义 fetch wrapper，含会话管理与自动 token 刷新
- `lib/hooks/` — react-query hooks（projects, versions, jobs, realtime）
- `lib/i18n/` — 自定义 i18n（`messages.ts` ~138KB 翻译文件，中英双语）
- `app/globals.css` — 单一语义 CSS 文件（~310KB），无组件库

## 关键 AI 能力
- **剧本生成**（sync + SSE 流）
- **梗概生成**（sync + SSE 流）
- **分镜生成**（sync + SSE 流）
- **改写**（sync + SSE 流）
- **对话式 QA**：维度追踪 + brief 提取（SSE 流）
- **图片生成**：逐镜头、批量（Gemini / SD WebUI / ComfyUI）
- **视频生成**：逐镜头、批量（Grok 等）
- **TTS 生成**：逐镜头、按场景批量
- **导出**：FFmpeg 能力检测

## 协作与版本生命周期
- 版本状态：draft → submitted → pending_review → approved/rejected
- 审阅/审批业务规则集中在 `packages/shared/src/business-rules.ts`
- 线程评论（parentId）
- 审计配置（按内容类型：是否需要审阅、自动审批角色）
- 世界观：角色（含服装）、场景、风格指南、角色配音配置 + AI 参考图生成
- 剧本与世界角色的配对草稿同步（WebSocket 实时双向）

## 工作区模式（URL `?mode=`）
- `info` — 项目信息面板
- `document` — 文档模式（子标签：view, edit, generate, versions；世界观与媒体映射到此模式）
- `tasks` — 任务面板
- `timeline` — 时间线编辑器

## 分镜工作台
- 拖拽重排序（dnd-kit）、多选、动画抽屉、自动展示绑定媒体
- 镜头详情三栏布局：左（可编辑元数据、镜头导航、操作按钮）、中（媒体工作区：图片/视频预览、候选缩略图、生成控制）、右（镜头内容、TTS 播放与字幕预览、关联 prompt 预览）

## 当前状态
- 开发就绪，但未完全产品化
- 后台任务用简化轮询 worker + 内部 API；Redis/BullMQ 是未来方向
- 项目工作区分片加载：`GET /projects/:id` 返回摘要，versions/jobs/timeline/exports 通过专用端点刷新
- 文本/图片/视频/TTS 生成可对接已配置 provider，保留 mock 回退路径以便无外部服务运行
- 视频导出在 FFmpeg 可用时使用，否则 mock 导出回退

## 快速启动
- Node.js >= 24
- `npm install` → 配置 `.env` → `npm run build` → `start-all.bat`(Windows) / `bash ./start-all.sh`(macOS/Linux)
- Web: http://localhost:3000 | API: http://localhost:4000 | Swagger: http://localhost:4000/docs
- Docker Compose: PostgreSQL 17 + Web + API + Worker + MinIO

## 设计哲学 / 关键模式
- **构建顺序依赖**：shared 必须先于 api 和 worker 编译
- **纯 CSS 样式**：无 Tailwind、无 CSS modules、无组件库；全部样式在 `globals.css` 使用语义类名
- **自定义 i18n**：不使用 i18n 库；键定义在 `messages.ts`，通过 `TranslateFn`（以 `TranslationKey` 类型化）消费
- **注释用中文**：代码库全程使用中文注释
- **乐观 UI**：前端对变更使用乐观更新（内联编辑、媒体选择）+ react-query 缓存失效
- **版本生命周期**：文档遵循 draft → submitted → pending_review → approved/rejected
