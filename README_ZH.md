# DramaFlow

DramaFlow 是一个面向导演与工作室的短剧生产平台 TypeScript monorepo。仓库提供可运行的 `web + api + worker + shared` 组合，覆盖认证、团队与项目协作、AI 辅助写作、媒体生成、审核流、TTS、时间线编排、通知、实时更新，以及双存储后端。

## 项目概览

- Monorepo：`npm workspaces`
- 前端：Next.js 15 + React 19 + App Router
- 后端：NestJS 11
- Worker：通过 API 内部接口领取任务的轮询型 Worker
- 共享契约：`@dramaflow/shared`
- 认证模型：JWT access token + 以 argon2 哈希保存的不透明 refresh token
- 运行时持久化：`DevDatabaseService` 管理的 JSON 文件
- 目标生产模型：面向 PostgreSQL 的 Prisma schema

## 当前状态

DramaFlow 目前已经达到"开发可用"，但还不是完整生产化实现。

- 运行时数据访问仍然使用文件型 `DevDatabaseService`；Prisma 还没有接入真实运行路径。
- 后台任务仍然使用简化的"轮询 Worker + API 内部接口"方案；Redis / BullMQ 是未来方向，不是当前依赖。
- 项目工作区已改为按需拆分加载：`GET /projects/:id` 只返回 summary，版本、任务、时间线、导出分别走独立接口刷新。
- 实时更新已通过 NestJS + Socket.IO gateway 提供，覆盖 `job.updated`、`review.updated`、`notification.created` 三类事件，同时保留轮询作为降级路径。
- 文本、图片、视频、TTS 都可以接入已配置的 Provider，同时保留 mock fallback 路径，保证仓库在没有外部服务时也能跑通。
- 视频导出优先使用 FFmpeg；在显式允许时也可以回退为 mock 导出产物。

## 架构说明

### `apps/web`

Next.js 前端包含：

- 公开路由：首页、登录、忘记密码、重置密码、团队邀请接受、项目邀请接受
- 受保护的 dashboard 路由：项目列表、平台管理后台、团队管理、团队设置、个人设置、语言设置、通知页
- 统一项目工作区 `/projects/[projectId]/workspace`，通过 `?mode=` URL 参数切换模式：
  - `info` — 项目信息面板
  - `document` — 文档模式，含子标签页：view、edit、generate、versions（worldbible 和 media 映射到此模式）
  - `tasks` — 任务面板
  - `timeline` — 时间线编辑器
- 额外项目路由：`/projects/:id/generate`（AI 生成）、`/projects/:id/review`（审核面板）、`/projects/:id/drafts`（草稿管理）
- 脚本与分镜的版本浏览、差异对比、恢复、手工编辑
- 审核动作、线程化评论、审计支持、AI rewrite 工具
- 基于 SSE 的 synopsis、script、storyboard、rewrite 流式生成
- 对话式 AI 生成模式：QA 对话 + 维度追踪（核心冲突、主角设定、配角关系、故事基调、集数节奏、特殊要求）+ 实时可编辑简报面板 + 世界观上下文注入 + 大纲→剧本两步生成流程
- 大纲文档手工编辑
- 剧本编辑器中角色名/简介行内编辑（hover 显示编辑图标）
- 剧本与世界观角色配对草稿同步，通过 WebSocket 实现双向实时同步
- Access Token 过期自动刷新（401 拦截器）
- 单镜头与批量图片/视频生成、多候选媒体缩略图网格、Lightbox 预览、显式采纳
- **镜头详情弹窗（三栏布局）**：
  - 左栏：可编辑元数据、镜头导航、操作按钮
  - 中栏：媒体工作区（Tab 驱动的图片/视频预览、候选缩略图、生成控制）
  - 右栏：镜头内容、TTS（音频播放+字幕预览）、关联提示词预览
- **分镜工作台**：拖拽排序（dnd-kit）、多选操作、动画抽屉、已绑定媒体自动展示
- 世界观角色、地点、风格指南、角色音色配置 UI，支持参考图上传和音色样例播放
- 角色、地点、风格指南的 AI 参考图生成
- 时间线自动组装、保存、导出提交，以及带 WebSocket 感知的轮询降级
- Provider 选择器：生成时可选择使用个人或团队的图片/视频 Provider
- 通知中心：未读计数、标记已读、全部已读

### `apps/api`

NestJS API 包含：

- `/health` 健康检查与 `/docs` Swagger 文档
- **认证流程**：注册、登录（含 IP 速率限制）、刷新、登出、忘记密码、重置密码、个人资料更新（含 LLM 配置、多 Provider 配置、默认 Provider）、个人模型列表
- **团队流程**：团队 CRUD、团队成员（添加/移除/角色变更）、团队邀请链接（创建/列表/吊销/查询/接受）、团队 LLM 模型列表、团队设置（LLM、图片生成配置）
- **项目流程**：项目 CRUD、项目成员（邀请/添加）、项目邀请接受、待处理邀请、项目审核策略、工作区 summary
- **文档与版本流程**：版本列表（分页）、版本创建、草稿编辑、删除、提交、推进审核、批准、驳回、恢复、采纳、媒体绑定更新、剧本与世界观角色配对草稿同步
- **评论流程**：版本级评论，支持线程回复（`parentId`）
- **世界观流程**：角色（含服装）CRUD、地点 CRUD、风格指南更新、角色音色配置、AI 参考图生成
- **审核流程**：按内容类型的审核配置（是否需要审核、可自动通过的角色列表）、审核记录列表（类型过滤+分页）
- **任务类型**：
  - 剧本生成（同步 + SSE 流式）
  - 大纲生成（同步 + SSE 流式）
  - 分镜生成（同步 + SSE 流式）
  - 改写（同步 + SSE 流式）
  - 对话式 QA 对话（维度追踪 + 简报提取，SSE 流式）
  - 对话式大纲/剧本生成（基于对话上下文，SSE 流式）
  - 图片生成（单镜头、批量）
  - 视频生成（单镜头、批量）
  - TTS（单镜头、按场景批量）
  - 导出任务
- **提示词预览**：图片和视频提示词预览端点
- **批量操作**：批量图片/视频任务，支持批量状态跟踪
- **导出**：能力检测（FFmpeg 可用性）、导出任务创建
- **通知**：列表（未读过滤+分页）、未读计数、标记已读、全部标记已读
- **存储**：上传目标创建、直传上传、资产 URL 获取、项目资产注册
- **实时**：WebSocket 事件 `job.updated`、`review.updated`、`notification.created`
- **内部接口**（Worker 专用，API Key 保护）：任务领取、执行、系统级重试
- **管理后台**：平台概览、团队仪表盘、团队设置

### `apps/worker`

Worker 故意保持轻量：

- 轮询 `GET /internal/jobs/next`（可配置间隔）
- 通过 `POST /internal/jobs/:id/process` 触发处理
- 通过 `POST /internal/jobs/:id/retry` 触发重试
- 真正的生成业务逻辑不在 Worker 内部，而是在 API 的 service 层执行

### `packages/shared`

共享包是整个仓库的契约层：

- 领域类型与枚举（角色、文档类型、任务类型、版本状态、对话会话/简报/维度类型等）
- API 合同类型（生成输入、对话载荷、时间线记录、导出记录等）
- Provider 接口（LLM、图片生成、视频生成、TTS）
- 审核、权限、任务管理、时间线、导出等业务规则

## API 参考

### 认证

| 方法 | 端点 | 说明 |
|------|------|------|
| POST | `/auth/register` | 用户注册 |
| POST | `/auth/login` | 登录（含 IP 速率限制） |
| POST | `/auth/refresh` | 刷新令牌 |
| POST | `/auth/logout` | 登出 |
| POST | `/auth/forgot-password` | 发起密码重置 |
| POST | `/auth/reset-password` | 执行密码重置 |
| GET | `/auth/me` | 获取当前用户资料 |
| PATCH | `/auth/me` | 更新资料（LLM 配置、Provider、默认值） |
| POST | `/auth/me/llm-models` | 列出可用 LLM 模型 |

### 团队

| 方法 | 端点 | 说明 |
|------|------|------|
| GET | `/teams` | 列出用户所在团队 |
| GET | `/teams/:id` | 获取团队详情 |
| POST | `/teams` | 创建团队 |
| PATCH | `/teams/:id` | 更新团队 |
| DELETE | `/teams/:id` | 删除团队 |
| POST | `/teams/:id/llm-models` | 列出团队可用 LLM 模型 |
| POST | `/teams/:id/members` | 添加团队成员 |
| DELETE | `/teams/:teamId/members/:memberId` | 移除团队成员 |
| PATCH | `/teams/:teamId/members/:memberId` | 变更成员角色 |
| POST | `/teams/:id/invite-links` | 创建邀请链接 |
| GET | `/teams/:id/invite-links` | 列出邀请链接 |
| DELETE | `/teams/:teamId/invite-links/:linkId` | 吊销邀请链接 |
| GET | `/invite-links/:token` | 查询邀请链接信息 |
| POST | `/invite-links/:token/accept` | 接受团队邀请 |

### 项目

| 方法 | 端点 | 说明 |
|------|------|------|
| GET | `/projects` | 列出用户参与的项目 |
| POST | `/projects` | 创建项目 |
| GET | `/projects/:id` | 工作区 summary |
| PATCH | `/projects/:id` | 更新项目 |
| DELETE | `/projects/:id` | 删除项目 |
| PATCH | `/projects/:id/review-policy` | 更新审核策略 |
| POST | `/projects/:id/invites` | 邀请项目成员 |
| POST | `/projects/:id/members` | 添加项目成员 |
| GET | `/project-invites/pending` | 列出待处理邀请 |
| POST | `/project-invites/:id/accept` | 接受项目邀请 |

### 文档与版本

| 方法 | 端点 | 说明 |
|------|------|------|
| GET | `/projects/:id/versions` | 列出项目版本（分页） |
| GET | `/documents/:id/versions` | 列出文档版本（分页） |
| POST | `/documents/:id/versions` | 创建版本 |
| PATCH | `/versions/:id` | 更新草稿版本内容 |
| DELETE | `/versions/:id` | 删除草稿版本 |
| POST | `/documents/:id/adopt-version` | 采纳版本为基线 |
| POST | `/versions/:id/adopt` | 采纳版本 |
| POST | `/versions/:id/submit` | 提交版本 |
| POST | `/versions/:id/advance-to-review` | 推进到审核 |
| POST | `/versions/:id/approve` | 批准版本 |
| POST | `/versions/:id/reject` | 驳回版本 |
| POST | `/versions/:id/restore` | 恢复版本 |
| PATCH | `/versions/:id/media-binding` | 更新草稿媒体绑定 |

### 评论

| 方法 | 端点 | 说明 |
|------|------|------|
| GET | `/versions/:id/comments` | 列出版本评论 |
| POST | `/versions/:id/comments` | 添加评论（线程回复） |

### 世界观

| 方法 | 端点 | 说明 |
|------|------|------|
| GET | `/projects/:id/world-bible` | 获取世界观设定 |
| PATCH | `/projects/:id/world-bible` | 更新世界观设定 |
| POST | `/projects/:id/world-bible/characters` | 添加角色 |
| PATCH | `/projects/:projectId/world-bible/characters/:characterId` | 更新角色 |
| DELETE | `/projects/:projectId/world-bible/characters/:characterId` | 删除角色 |
| POST | `/projects/:id/world-bible/locations` | 添加地点 |
| PATCH | `/projects/:projectId/world-bible/locations/:locationId` | 更新地点 |
| DELETE | `/projects/:projectId/world-bible/locations/:locationId` | 删除地点 |
| PATCH | `/projects/:id/world-bible/style-guide` | 更新视觉风格指南 |
| PATCH | `/projects/:projectId/world-bible/characters/:characterId/voice` | 更新角色语音配置 |

### 审核

| 方法 | 端点 | 说明 |
|------|------|------|
| GET | `/projects/:id/audit-configs` | 获取审核配置 |
| PATCH | `/projects/:id/audit-configs/:contentType` | 更新审核配置 |
| GET | `/projects/:id/audit-records` | 列出审核记录（可过滤、分页） |
| GET | `/versions/:id/audit-records` | 列出版本审核记录 |

### 生成任务

| 方法 | 端点 | 说明 |
|------|------|------|
| POST | `/projects/:id/script-jobs` | 创建剧本生成任务 |
| POST | `/projects/:id/script-jobs/stream` | SSE 流式剧本生成 |
| POST | `/projects/:id/synopsis-jobs` | 创建大纲生成任务 |
| POST | `/projects/:id/synopsis-jobs/stream` | SSE 流式大纲生成 |
| POST | `/projects/:id/storyboard-jobs` | 创建分镜生成任务 |
| POST | `/projects/:id/storyboard-jobs/stream` | SSE 流式分镜生成 |
| POST | `/projects/:id/rewrite-jobs` | 创建改写任务 |
| POST | `/projects/:id/rewrite-jobs/stream` | SSE 流式改写 |
| POST | `/shots/:id/image-jobs` | 创建图片生成任务 |
| POST | `/shots/:id/video-jobs` | 创建视频生成任务 |
| POST | `/shots/:id/tts-jobs` | 创建 TTS 任务 |
| POST | `/scenes/:id/batch-tts-jobs` | 按场景批量 TTS |
| POST | `/projects/:id/batch-image-jobs` | 批量图片生成 |
| POST | `/projects/:id/batch-video-jobs` | 批量视频生成 |
| GET | `/batch-jobs/:batchId` | 查询批量任务状态 |
| POST | `/shots/:id/preview-prompt` | 预览图片提示词 |
| POST | `/shots/:id/preview-video-prompt` | 预览视频提示词 |

### 对话式生成

| 方法 | 端点 | 说明 |
|------|------|------|
| POST | `/projects/:id/conversation-jobs/message` | 发送消息，SSE 流式返回 AI 回复及简报更新 |
| POST | `/projects/:id/conversation-jobs/generate` | 基于对话历史生成大纲/剧本，SSE 流式输出 |
| GET | `/projects/:id/conversation-jobs/:sessionId` | 获取对话会话状态 |
| POST | `/projects/:id/conversation-jobs/:sessionId/delete` | 删除对话会话 |

### 世界观参考图生成

| 方法 | 端点 | 说明 |
|------|------|------|
| POST | `/projects/:projectId/world-bible/characters/:characterId/generate-reference-image` | 生成角色参考图 |
| POST | `/projects/:projectId/world-bible/locations/:locationId/generate-reference-image` | 生成地点参考图 |
| POST | `/projects/:projectId/world-bible/style-guide/generate-reference-image` | 生成风格指南参考图 |

### 任务管理

| 方法 | 端点 | 说明 |
|------|------|------|
| GET | `/projects/:id/jobs` | 列出项目任务（可过滤、分页） |
| GET | `/jobs/:id` | 获取任务详情 |
| POST | `/jobs/:id/cancel` | 取消任务 |
| POST | `/jobs/:id/retry` | 重试失败任务 |

### 时间线与导出

| 方法 | 端点 | 说明 |
|------|------|------|
| GET | `/projects/:id/timeline` | 获取时间线 |
| PUT | `/projects/:id/timeline` | 保存时间线 |
| POST | `/projects/:id/timeline/auto-assemble` | 自动组装时间线 |
| GET | `/export/capabilities` | 检测导出能力（FFmpeg） |
| POST | `/projects/:id/export-jobs` | 创建导出任务 |
| GET | `/projects/:id/exports` | 列出导出记录 |

### TTS

| 方法 | 端点 | 说明 |
|------|------|------|
| GET | `/tts/voices` | 列出可用 TTS 音色 |

### 存储

| 方法 | 端点 | 说明 |
|------|------|------|
| POST | `/uploads` | 创建上传目标 |
| PUT | `/uploads/direct/:key` | 直传上传文件 |
| GET | `/assets/:id/url` | 获取资产 URL |
| POST | `/projects/:id/assets` | 注册项目资产 |

### 通知

| 方法 | 端点 | 说明 |
|------|------|------|
| GET | `/notifications` | 列出通知（可过滤、分页） |
| GET | `/notifications/unread-count` | 获取未读数 |
| PATCH | `/notifications/:id/read` | 标记已读 |
| POST | `/notifications/mark-all-read` | 全部标记已读 |

### 管理后台

| 方法 | 端点 | 说明 |
|------|------|------|
| GET | `/admin/platform/overview` | 平台概览指标 |
| GET | `/admin/teams/:id/overview` | 团队仪表盘 |
| GET | `/admin/teams/:id/settings` | 团队设置 |

### WebSocket 事件

- `job.updated`
- `review.updated`
- `notification.created`
- `draft.character.synced`

### Worker 内部接口

这些接口受 `InternalApiKeyGuard` 保护，不对外暴露。

| 方法 | 端点 | 说明 |
|------|------|------|
| GET | `/internal/jobs/next` | 领取下一个待处理任务（按优先级排序） |
| POST | `/internal/jobs/:id/process` | 执行任务 |
| POST | `/internal/jobs/:id/retry` | 系统级重试 |

## 仓库结构

```text
.
|-- apps
|   |-- api          # NestJS 后端
|   |-- web          # Next.js 前端
|   `-- worker       # 轮询型任务 Worker
|-- packages
|   `-- shared       # 跨端类型与业务规则
|-- scripts
|-- tests
|-- .env.example
|-- AGENTS.md
|-- README.md
|-- README_ZH.md
|-- package.json
`-- tsconfig.base.json
```

## 快速开始

### 环境要求

- Node.js `>=24`
- npm

### 1. 安装依赖

```bash
npm install
```

如果 PowerShell 阻止 `npm.ps1`：

```powershell
npm.cmd install
```

### 2. 创建 `.env`

```bash
cp .env.example .env
```

PowerShell：

```powershell
Copy-Item .env.example .env
```

至少请设置以下安全变量：

- `JWT_ACCESS_SECRET`
- `JWT_REFRESH_SECRET`
- `INTERNAL_API_KEY`

### 3. 构建工作区

```bash
npm run build
```

### 4. 启动服务

推荐使用根目录启动器，它会自动复制 `.env`、检查端口、构建工作区、拉起 API/Web/Worker 并等待就绪。

Windows：

```bat
start-all.bat
```

macOS / Linux：

```bash
bash ./start-all.sh
```

也可以手动分别启动：

```bash
npm --workspace @dramaflow/api run start
npm --workspace @dramaflow/web run start
npm --workspace @dramaflow/worker run start
```

开发模式：

```bash
npm run dev:api
npm run dev:web
npm run dev:worker
```

### 5. 打开本地地址

- Web：`http://localhost:3000`
- 登录页：`http://localhost:3000/login`
- API health：`http://localhost:4000/health`
- Swagger：`http://localhost:4000/docs`

## 环境变量

`.env.example` 覆盖了核心应用、存储和 Provider 配置。部分运行时变量仅在代码层读取，以下列表为权威参考。

### 核心应用与认证

| 变量 | 说明 |
|------|------|
| `APP_URL` | API 用于 CORS 的前端域名 |
| `API_URL` | Worker 与启动脚本使用的后端地址 |
| `NEXT_PUBLIC_API_URL` | Web 前端使用的后端地址 |
| `PORT` | 直接启动服务时覆盖端口 |
| `JWT_ACCESS_SECRET` | Access token 签名密钥 |
| `JWT_REFRESH_SECRET` | Refresh token 密钥 |
| `INTERNAL_API_KEY` | Worker 调用 API 内部接口的共享密钥 |

### 持久化与存储

| 变量 | 说明 |
|------|------|
| `DATA_DIR` | `dev-db.json` 所在目录 |
| `UPLOADS_DIR` | 本地上传目录 |
| `STORAGE_DRIVER` | `local` 或 `s3` |
| `LOCAL_STORAGE_PUBLIC_URL` | 本地文件公开访问前缀 |
| `S3_ENDPOINT` | S3 端点 URL |
| `S3_REGION` | S3 区域 |
| `S3_BUCKET` | S3 桶名称 |
| `S3_ACCESS_KEY` | S3 访问密钥 |
| `S3_SECRET_KEY` | S3 密钥 |

### 文本生成

| 变量 | 说明 |
|------|------|
| `OPENAI_COMPAT_BASE_URL` | OpenAI 兼容 API 基础 URL |
| `OPENAI_COMPAT_API_KEY` | OpenAI 兼容 API 密钥 |
| `OPENAI_TEXT_MODEL` | 文本生成模型名称 |
| `OPENAI_COMPAT_MOCK_FALLBACK` | Provider 失败时回退到 mock（`true`/`false`） |

### 图片生成

| 变量 | 说明 |
|------|------|
| `GOOGLE_IMAGE_API_KEY` | Google Gemini 图片 API 密钥 |
| `GOOGLE_IMAGE_MODEL` | Gemini 图片模型名称 |
| `GOOGLE_IMAGE_BASE_URL` | Gemini API 基础 URL |
| `MEDIA_IMAGE_MODEL` | 默认图片生成模型 |
| `SD_WEBUI_BASE_URL` | Stable Diffusion WebUI 基础 URL |
| `SD_WEBUI_API_KEY` | Stable Diffusion WebUI API 密钥 |
| `COMFYUI_BASE_URL` | ComfyUI 基础 URL |
| `COMFYUI_API_KEY` | ComfyUI API 密钥 |

### 视频生成

| 变量 | 说明 |
|------|------|
| `MEDIA_VIDEO_MODEL` | 默认视频生成模型 |

### TTS

| 变量 | 说明 |
|------|------|
| `OPENAI_BASE_URL` | TTS 使用的 OpenAI API 基础 URL |
| `OPENAI_API_KEY` | TTS 使用的 OpenAI API 密钥 |
| `OPENAI_TTS_MODEL` | TTS 模型名称 |

### 导出与 Worker 覆盖项

| 变量 | 说明 |
|------|------|
| `FFMPEG_PATH` | FFmpeg 二进制文件路径 |
| `EXPORT_KEEP_TEMP` | 保留导出临时文件 |
| `WORKER_POLL_INTERVAL_MS` | Worker 轮询间隔 |
| `DRAMAFLOW_START_INLINE` | 内联启动服务（不后台运行） |
| `DRAMAFLOW_START_TIMEOUT_MS` | 启动就绪超时时间 |

## Docker Compose

仓库提供了偏演示/开发用途的 `docker-compose.yml`，会启动：

- Web
- API
- Worker
- MinIO

```bash
docker compose up --build
```

注意：

- Compose 使用 `npm run dev:*`，定位是开发和演示，不是加固后的生产部署方案。
- Compose 设置了 `STORAGE_DRIVER=local`，因此 MinIO 默认不作为实际存储后端。
- 默认只透传了部分 Provider 配置。如需真实 Provider 执行，需要把相关变量注入 API 容器。

## 常用命令

```bash
# 构建全部包
npm run build

# 分别启动服务
npm --workspace @dramaflow/api run start
npm --workspace @dramaflow/web run start
npm --workspace @dramaflow/worker run start

# 开发模式
npm run dev:api
npm run dev:web
npm run dev:worker

# 工作区类型检查
npm run lint

# 工作区测试
npm test
```

补充说明：

- `npm run lint` 当前实际是分发到各 workspace 的 `tsc --noEmit`，不是 ESLint 检查。
- `npm test` 当前只会运行声明了 `test` 脚本的包，即 API 和 shared，不包含 web 和 worker。

## 开发说明

- 仓库内所有文件必须统一使用 UTF-8 无 BOM。
- `packages/shared` 是跨端领域类型与业务规则的唯一真相源。
- 保持 controller 轻量，把业务逻辑放在 service 中。
- 保持 Next.js `page.tsx` 足够薄，把较重的 UI 逻辑下沉到 `components`。
- 如果修改影响 API payload，必须同步更新 shared 合同、API 处理、前端调用方和 Worker 行为。
- 如果修改影响审核逻辑、状态流转或权限判断，优先检查 `packages/shared/src/business-rules.ts`。
- 只要更新 `README.md`，就必须同步更新 `README_ZH.md`。

## 建议阅读顺序

1. `README.md` / `README_ZH.md`
2. `AGENTS.md`
3. `package.json`
4. `tsconfig.base.json`
5. `packages/shared/src/domain.ts`
6. `packages/shared/src/business-rules.ts`
7. `apps/api/src/workspace/workspace.service.ts`
8. `apps/api/src/jobs/jobs.service.ts`
9. `apps/web/components/unified-workspace.tsx`
10. `apps/web/lib/api.ts`

## 官方参考

- Next.js App Router：<https://nextjs.org/docs/app>
- React 19：<https://react.dev/blog/2024/12/05/react-19>
- NestJS 文档：<https://docs.nestjs.com>
- NestJS WebSocket gateways：<https://docs.nestjs.com/websockets/gateways>
- Socket.IO client options 与 auth：<https://socket.io/docs/v4/client-options/>
- npm workspaces：<https://docs.npmjs.com/cli/using-npm/workspaces/>
- Prisma schema 概览：<https://www.prisma.io/docs/orm/prisma-schema/overview>
- Google Gemini 图片生成：<https://ai.google.dev/gemini-api/docs/image-generation>
- Google Gemini OpenAI 兼容层：<https://ai.google.dev/gemini-api/docs/openai>
- OpenAI 图片生成：<https://developers.openai.com/api/docs/guides/image-generation>
- OpenAI 文本转语音：<https://developers.openai.com/api/docs/guides/text-to-speech>

## License

当前仓库尚未声明独立 license。若后续要开源或商业分发，请先补充明确的许可证文件。
