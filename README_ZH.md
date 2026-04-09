# DramaFlow

DramaFlow 是一个面向导演与工作室的短剧工作流 TypeScript monorepo。当前仓库已经提供可运行的 `web + api + worker + shared` 组合，覆盖认证、协作、AI 辅助写作、媒体生成、审核与审计、TTS、时间线编排、通知与实时更新，以及双存储后端。

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

DramaFlow 目前已经达到“开发可用”，但还不是完整生产化实现。

- 运行时数据访问仍然使用文件型 `DevDatabaseService`；Prisma 还没有接入真实运行路径。
- 后台任务仍然使用简化的“轮询 Worker + API 内部接口”方案；Redis / BullMQ 是未来方向，不是当前依赖。
- 项目工作区已经改为按需拆分加载：`GET /projects/:id` 只返回 summary，版本、任务、时间线、导出分别走独立接口刷新。
- 实时更新已经通过 NestJS + Socket.IO gateway 提供，覆盖 `job.updated`、`review.updated`、`notification.created` 三类事件，同时保留轮询作为降级路径。
- 文本、图片、视频、TTS 都可以接入已配置的 provider，但为了保证仓库在没有外部服务时也能跑通，仍然保留了 mock fallback 路径。
- 视频导出现在会优先使用 FFmpeg；在显式允许的情况下，也可以回退为 mock 导出产物。

## 架构说明

### `apps/web`

Next.js 前端目前包含：

- 对外公开路由：首页、登录、忘记密码、重置密码、团队邀请接受、项目邀请接受
- 受保护的 dashboard 路由：项目页、平台后台、团队后台、团队设置、个人设置、语言设置、通知页
- 统一项目工作区 `/projects/[projectId]/workspace`，支持以下模式：
  - `info`
  - `document`
  - `worldbible`
  - `generate`
  - `media`
  - `tasks`
  - `timeline`
- 脚本与分镜的版本浏览、差异对比、恢复、手工编辑
- 审核动作、线程化评论、审计支持、AI rewrite 工具
- 基于 SSE 的 synopsis、script、storyboard、rewrite 流式生成
- 单镜头与批量图片/视频生成、多候选媒体、显式采纳
- 世界观角色、地点、风格指南、角色音色配置 UI，支持参考图上传和音色样例播放
- 时间线自动组装、保存、导出提交，以及带 WebSocket 感知的轮询降级

### `apps/api`

NestJS API 目前包含：

- `/health` 健康检查与 `/docs` Swagger 文档
- 认证流程：注册、登录、刷新、登出、忘记密码、重置密码、个人资料更新、个人模型列表
- 工作区流程：团队 CRUD、团队成员、团队邀请链接、项目 CRUD、项目邀请、项目邀请接受、项目成员、文档版本、线程化评论、审核流转、世界观 CRUD、审计配置、审计记录、时间线保存/自动组装、导出列表
- 工作区数据拆分接口：summary、versions、jobs、timeline、exports
- 任务类型包括：
  - script generation
  - synopsis generation
  - storyboard generation
  - rewrite
  - image generation
  - video generation
  - TTS generation
  - export jobs
- 批量图片/视频任务，以及按场景批量 TTS 任务
- prompt preview 接口
- 通知接口与实时 websocket 事件
- 直传上传目标与资源 URL 等存储接口

### `apps/worker`

Worker 目前故意保持轻量：

- 轮询 `GET /internal/jobs/next`
- 通过 `POST /internal/jobs/:id/process` 触发处理
- 通过 `POST /internal/jobs/:id/retry` 触发重试
- 真正的生成业务逻辑不在 Worker 内部，而是在 API 的 service 层执行

### `packages/shared`

共享包是整个仓库的契约层：

- 领域类型与枚举
- API 合同类型
- Provider 接口
- 审核、权限、任务管理、时间线、导出等业务规则

## API 重点接口

当前最关键的工作区接口如下：

- `GET /projects/:id`：工作区 summary
- `GET /projects/:id/versions`：版本数据
- `GET /projects/:id/jobs`：任务列表
- `GET /projects/:id/timeline`：时间线数据
- `GET /projects/:id/exports`：导出列表
- `POST /project-invites/:id/accept`：接受项目邀请
- `POST /scenes/:id/batch-tts-jobs`：为场景内镜头批量创建 TTS 任务
- WebSocket 事件：
  - `job.updated`
  - `review.updated`
  - `notification.created`

## 仓库结构

```text
.
|-- apps
|   |-- api
|   |-- web
|   `-- worker
|-- packages
|   `-- shared
|-- scripts
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

如果 PowerShell 阻止 `npm.ps1`，请改用：

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

至少请先设置以下安全相关变量：

- `JWT_ACCESS_SECRET`
- `JWT_REFRESH_SECRET`
- `INTERNAL_API_KEY`

### 3. 构建整个工作区

```bash
npm run build
```

### 4. 启动服务

推荐的本地验证路径：

- 使用根目录启动器。它会在 `.env` 缺失时自动复制模板、检查端口、执行全量构建、拉起 API / Web / Worker，并等待就绪。

Windows：

```bat
start-all.bat
```

macOS / Linux：

```bash
bash ./start-all.sh
```

也可以分别手动启动：

```bash
npm --workspace @dramaflow/api run start
npm --workspace @dramaflow/web run start
npm --workspace @dramaflow/worker run start
```

仓库也保留了开发态脚本：

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

`.env.example` 已经覆盖了主应用、存储、OpenAI 兼容文本/媒体设置，以及 Google Gemini 图片默认项。但仍有少量运行时变量是代码层读取、未必已经写进模板，因此以下列表以当前代码为准。

### 核心应用与认证

- `APP_URL`：API 用于 CORS 的前端域名
- `API_URL`：Worker 与启动脚本使用的后端地址
- `NEXT_PUBLIC_API_URL`：Web 前端使用的后端地址
- `PORT`：直接启动服务时覆盖 API 或 Web 端口
- `JWT_ACCESS_SECRET`：access token 签名密钥
- `JWT_REFRESH_SECRET`：生产环境启动时要求的密钥
- `INTERNAL_API_KEY`：Worker 调用 API 内部任务接口的共享密钥

### 持久化与存储

- `DATA_DIR`：`dev-db.json` 所在目录
- `UPLOADS_DIR`：本地上传目录
- `STORAGE_DRIVER`：`local` 或 `s3`
- `LOCAL_STORAGE_PUBLIC_URL`：本地文件公开访问前缀
- `S3_ENDPOINT`
- `S3_REGION`
- `S3_BUCKET`
- `S3_ACCESS_KEY`
- `S3_SECRET_KEY`

### 文本与媒体 Provider 配置

图片任务既可以走团队/个人图片配置对应的原生 Google Gemini 图片生成，也可以在未指定图片配置来源时退回旧的 OpenAI 兼容链路。

- `OPENAI_COMPAT_BASE_URL`
- `OPENAI_COMPAT_API_KEY`
- `OPENAI_TEXT_MODEL`
- `OPENAI_COMPAT_MOCK_FALLBACK`
- `GOOGLE_IMAGE_API_KEY`
- `GOOGLE_IMAGE_MODEL`
- `GOOGLE_IMAGE_BASE_URL`
- `MEDIA_IMAGE_MODEL`
- `MEDIA_VIDEO_MODEL`

### TTS

这些变量会被 API 的 TTS 适配层读取，视你当前分支状态，可能还没有同步写入 `.env.example`：

- `OPENAI_BASE_URL`
- `OPENAI_API_KEY`
- `OPENAI_TTS_MODEL`

### 导出与 Worker 覆盖项

这些也是运行时代码会读取、但未必已经写进 `.env.example` 的变量：

- `FFMPEG_PATH`
- `EXPORT_KEEP_TEMP`
- `WORKER_POLL_INTERVAL_MS`
- `DRAMAFLOW_START_INLINE`
- `DRAMAFLOW_START_TIMEOUT_MS`

## Docker Compose

仓库内提供了偏演示 / 开发用途的 `docker-compose.yml`，会启动：

- Web
- API
- Worker
- MinIO

运行方式：

```bash
docker compose up --build
```

需要注意：

- Compose 使用的是 `npm run dev:*`，定位是开发和演示，不是加固后的生产部署方案。
- 当前提交的 Compose 仍然给 API 和 Worker 设置了 `STORAGE_DRIVER=local`，所以 MinIO 默认并不会成为实际存储后端。
- 当前提交的 Compose 默认只透传了部分 Provider 配置。如果你希望 API 走真实 Provider 而不是 mock fallback，还需要把相关 Provider 变量一并注入 API 容器。

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

- `npm run lint` 当前实际是分发到各 workspace 的 `tsc --noEmit`，并不是 ESLint 检查。
- `npm test` 当前只会运行声明了 `test` 脚本的包，也就是 API 和 shared，不包含 web 与 worker。

## 开发说明

- 仓库内所有文件必须统一使用 UTF-8 无 BOM。
- `packages/shared` 是跨端领域类型与业务规则的唯一真相源。
- 保持 controller 轻量，把业务逻辑放在 service 中。
- 保持 Next.js `page.tsx` 足够薄，把较重的 UI 逻辑下沉到 `components`。
- 如果修改影响 API payload，必须同步更新 shared 合同、API 处理、前端调用方和 Worker 行为。
- 如果修改影响审核逻辑、状态流转或权限判断，优先检查 `packages/shared/src/business-rules.ts`。
- 只要更新 `README.md`，就必须同步更新 `README_ZH.md`。

## 建议阅读顺序

如果你要继续开发这个仓库，建议按下面顺序进入代码：

1. `README.md`
2. `README_ZH.md`
3. `package.json`
4. `tsconfig.base.json`
5. `packages/shared/src/domain.ts`
6. `packages/shared/src/business-rules.ts`
7. `apps/api/src/workspace/workspace.service.ts`
8. `apps/api/src/jobs/jobs.service.ts`
9. `apps/web/components/unified-workspace.tsx`
10. `apps/web/lib/api.ts`

## 官方参考

这次更新项目文档时，以下上游资料最有帮助：

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