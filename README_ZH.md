# DramaFlow 中文说明

DramaFlow 是一个面向导演与工作室的短剧生成平台，采用 TypeScript 全栈开发，包含前端工作台、后端 API、异步任务 Worker，以及跨端共享的领域模型与业务规则。

当前仓库已经具备可运行的 monorepo 骨架，支持注册登录、团队与项目管理、剧本与分镜生成任务、图片与视频生成任务、版本管理、评论讨论、审核流，以及双存储抽象。

## 功能特性

- 用户注册、登录、刷新令牌、退出登录、忘记密码、重置密码
- Team / Project 管理
- 剧本、分镜、图片、视频四类文档模型
- 不可变版本快照与完整历史回看
- 版本评论讨论与基础审核流
- OpenAI 兼容文本生成接入
- 图片 / 视频媒体生成 Provider 抽象
- 本地磁盘 / S3 兼容对象存储双实现
- 平台后台、团队后台、导演工作台界面

## 技术栈

- 语言：TypeScript
- Monorepo：`npm workspaces`
- Node.js：`>= 24`
- 前端：Next.js 15 + React 19
- 后端：NestJS 11
- 共享类型：`@dramaflow/shared`
- 认证：JWT + Refresh Token + `argon2`
- 存储：
  - 开发和轻量部署使用本地磁盘
  - 生产风格部署使用 S3 兼容对象存储
- 异步任务：轮询式 Worker
- 目标生产数据模型：Prisma + PostgreSQL Schema

## 仓库结构

```text
.
├─ apps
│  ├─ api        # NestJS API
│  ├─ web        # Next.js 前端工作台与后台
│  └─ worker     # 异步任务消费端
├─ packages
│  └─ shared     # 共享领域模型、Provider 契约与业务规则
├─ docker-compose.yml
├─ package.json
└─ tsconfig.base.json
```

## 目录说明

### `apps/web`

前端项目，基于 Next.js App Router，目前包含：

- 首页
- 登录页
- 导演工作台
- 项目工作区
- 平台后台
- 团队后台

### `apps/api`

后端项目，基于 NestJS，按模块拆分为：

- `auth`：用户认证
- `workspace`：团队、项目、文档、版本、评论、审核流
- `jobs`：剧本 / 分镜 / 图片 / 视频任务编排
- `storage`：上传、资产 URL、本地 / S3 存储抽象
- `admin`：平台与团队后台接口
- `common`：开发态数据存储、鉴权 Guard、公共工具

### `apps/worker`

异步任务 Worker，负责：

- 从 API 领取排队任务
- 处理剧本生成、分镜生成、图片生成、视频生成任务
- 将结果写回 API 数据层

### `packages/shared`

共享包，统一维护：

- 领域类型
- 枚举与状态模型
- 权限 / 审核 / 状态流转规则
- 文本与媒体 Provider 接口
- 存储 Provider 接口

## 当前实现状态

这个仓库已经可以作为开发起点直接运行，但还不是完全生产化版本。

### 已经实现的部分

- Monorepo 工程结构
- 前后端基础页面与接口
- 基于文件的开发态数据存储
- 文本 / 媒体任务模型与 Worker 流程
- 本地 / S3 双存储抽象
- Prisma 目标生产 Schema

### 仍处于开发阶段的部分

- 运行时持久化仍使用 `DevDatabaseService`，并非 Prisma 实际落库
- Worker 仍是轮询模式，而不是 BullMQ / Redis 队列
- 视频生成仍以 mock 结果为主，真实 Provider 接口位点已预留
- 后台与工作台当前以核心流程和脚手架为主，尚未做完整生产级打磨

## 快速开始

### 推荐启动方式

当前本地最稳定的启动方式是：

1. `build`
2. `start`

仓库里的 `dev` 脚本仍然保留，但在 Windows 环境下，当前版本的 `tsx watch` 和 `next dev` 运行时稳定性一般。想要完整测试业务流程时，优先使用 `build + start`。

### 1. 安装依赖

```bash
npm install
```

如果你在 Windows PowerShell 下遇到执行策略拦截，请改用：

```powershell
npm.cmd install
```

### 2. 配置环境变量

复制环境变量模板：

```bash
cp .env.example .env
```

Windows PowerShell 可使用：

```powershell
Copy-Item .env.example .env
```

### 3. 构建整个工作区

```bash
npm run build
```

Windows PowerShell 可使用：

```powershell
npm.cmd run build
```

### 4. 分别在不同终端启动服务

启动 API：

```bash
npm --workspace @dramaflow/api run start
```

启动前端：

```bash
npm --workspace @dramaflow/web run start
```

启动 Worker：

```bash
npm --workspace @dramaflow/worker run start
```

Windows PowerShell 可使用：

```powershell
npm.cmd --workspace @dramaflow/api run start
npm.cmd --workspace @dramaflow/web run start
npm.cmd --workspace @dramaflow/worker run start
```

### 5. 打开本地地址

- Web：`http://localhost:3000`
- 登录页：`http://localhost:3000/login`
- API：`http://localhost:4000/health`
- Swagger：`http://localhost:4000/docs`

### 一键启动脚本

如果你想直接一键拉起本地环境，可以使用仓库根目录下的脚本：

Windows：

```bat
start-all.bat
```

macOS / Linux：

```bash
bash ./start-all.sh
```

这两个脚本会自动执行：

- 如果 `.env` 不存在，则从 `.env.example` 复制一份
- 当 `node_modules` 缺失时自动执行 `npm install`
- 执行完整的 `npm run build`
- 启动 API、Web 和 Worker

行为差异：

- `start-all.bat` 会分别打开三个独立终端窗口
- `start-all.sh` 会占用当前终端，按 `Ctrl+C` 时同时停止三个服务

## 常用命令

```bash
# 构建整个 monorepo
npm run build

# 启动 API
npm --workspace @dramaflow/api run start

# 启动前端
npm --workspace @dramaflow/web run start

# 启动 Worker
npm --workspace @dramaflow/worker run start

# 仅开发调试使用
npm run dev:api
npm run dev:web
npm run dev:worker

# 全仓库类型检查
npm run lint

# 全仓库测试
npm test
```

## 本地运行说明

- 如果 PowerShell 提示 `npm.ps1` 无法执行，请改用 `npm.cmd`。
- 当没有排队任务时，Worker 日志输出 `idle` 是正常现象。
- 如果 `3000` 或 `4000` 端口已被占用，请先停止旧进程再重新启动。
- 本地手工测试时，除非你正在验证对象存储链路，否则优先使用 `STORAGE_DRIVER=local`。
- 一键启动的 shell 脚本会把日志写到 `api.log`、`web.log` 和 `worker.log`。

## 环境变量说明

完整模板请看 [.env.example](./.env.example)。

常用项包括：

- `APP_URL`：前端地址
- `API_URL`：后端地址
- `NEXT_PUBLIC_API_URL`：前端调用 API 的公开地址
- `DATA_DIR`：开发态数据文件目录
- `UPLOADS_DIR`：本地上传目录
- `STORAGE_DRIVER`：存储驱动，可选 `local` / `s3`
- `LOCAL_STORAGE_PUBLIC_URL`：本地文件公开访问地址
- `JWT_ACCESS_SECRET`：访问令牌密钥
- `JWT_REFRESH_SECRET`：刷新令牌密钥
- `OPENAI_COMPAT_BASE_URL`：兼容 OpenAI 风格接口的基础地址
- `OPENAI_COMPAT_API_KEY`：文本生成 API Key
- `OPENAI_TEXT_MODEL`：文本模型名称
- `MEDIA_IMAGE_MODEL`：图片模型名称
- `MEDIA_VIDEO_MODEL`：视频模型名称

## 存储模式

### 本地存储

设置：

```env
STORAGE_DRIVER=local
```

此模式下，生成文件和上传资源会写入：

- `apps/api/uploads`

适合：

- 本地开发
- 轻量私有化部署
- 调试上传与媒体生成链路

### S3 兼容对象存储

设置：

```env
STORAGE_DRIVER=s3
```

并配置：

- `S3_ENDPOINT`
- `S3_REGION`
- `S3_BUCKET`
- `S3_ACCESS_KEY`
- `S3_SECRET_KEY`

适合：

- 生产环境
- 多实例部署
- 需要更强扩展性、备份能力与 CDN 集成的场景

## Docker Compose

仓库提供了基础的 `docker-compose.yml`，可用于快速拉起：

- Web
- API
- Worker
- MinIO

执行：

```bash
docker compose up --build
```

说明：

- 当前 Compose 更偏开发与演示用途
- 如果要用于正式环境，建议单独完善镜像构建、环境变量、数据库方案与队列基础设施

## API 与数据层说明

### 当前运行时数据层

当前 API 在开发态通过 `apps/api/src/common/dev-database.service.ts` 读写 JSON 文件，因此无需真实数据库也能快速启动。

### 目标生产数据层

`apps/api/prisma/schema.prisma` 定义了未来的 PostgreSQL / Prisma 数据模型，包括：

- 用户
- 团队
- 项目
- 文档
- 版本
- 评论
- 任务
- 资产

如果后续要继续生产化，推荐优先做：

1. 将 `DevDatabaseService` 替换为 Prisma Repository
2. 将 Worker 从轮询迁移到 Redis / BullMQ
3. 接入真实图片 / 视频 Provider

## AI 能力说明

### 文本生成

当前文本能力通过 OpenAI 兼容 Provider 抽象接入，可用于：

- 剧本生成
- 分镜生成

如果未配置真实 API Key，会回退到 mock 数据，方便本地联调。

### 图片生成

当前图片生成支持：

- 真实接口接入位点
- 未配置时生成 mock SVG 结果

### 视频生成

当前视频生成默认使用 mock manifest 结果，主要用于先打通工作流和版本链路。

## 推荐阅读顺序

如果你准备继续开发，建议先看：

1. `README.md`
2. `README_ZH.md`
3. `package.json`
4. `packages/shared/src/domain.ts`
5. `packages/shared/src/business-rules.ts`
6. `apps/api/src/workspace/workspace.service.ts`
7. `apps/api/src/jobs/jobs.service.ts`
8. `apps/web/components/project-workspace.tsx`
9. `apps/web/lib/api.ts`

## 开发约定

- 仓库内所有文件必须使用 UTF-8 编码且无 BOM
- 新增跨端模型时，优先放到 `packages/shared`
- 保持 controller 轻量，把业务逻辑放在 service
- 保持 Next.js page 文件轻量，复杂 UI 下沉到 `components`
- 修改权限、审核、版本状态流转时，优先检查 shared 规则层
- 更新 `README.md` 时必须同步更新 `README_ZH.md`，反之亦然

## 后续建议

如果你想把这个项目继续推进到可上线状态，优先级最高的方向是：

1. Prisma + PostgreSQL 运行时落地
2. Redis / BullMQ 队列基础设施
3. 更完整的成员与邀请流程
4. 真实上传链路与媒体生成生产管线
5. 更细化的后台工具与审计日志

## License

当前仓库尚未单独声明 License。如果后续计划开源或商用分发，请补充明确的许可文件。
