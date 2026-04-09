帮我写一个导演使用的短剧生成平台，前后端都用typescript编写。
  要求：
  1.基础的用户注册登录功能，管理后台功能
  2.有生成剧本功能（自定义接入openai-completions响应的LLM API）
  3.有生成分镜头脚本功能(也是接入llm api)
  4.根据分镜头生图和生视频功能（看看openai-completions响应能不能做到，能得话也用这个）
  5.要有团队协作功能，这些数据储存在后端
  6.有剧本、分镜头、图片版本管理功能，每个版本中可以进行多人讨论，更新之后也能看到之前的。做一个选项，可以设置是否需要管理员审核



*Thinking...*

> The user wants me to create a comprehensive project design document, broken down by phases. This is a detailed technical design document for an AI short drama generation platform. Let me create a thorough design document covering all aspects we discussed.
> 
> Let me organize this into a well-structured document with clear phases, covering data models, API design, technical architecture, and implementation details for each phase.
> 
> I should write this in Chinese since the user is communicating in Chinese.
> 
> This is a document/report, so I should write in prose style without bullet points or numbered lists, using paragraphs and natural language.
> 
> Wait, actually for a project design document, the user is explicitly asking for a structured plan broken into phases. This is more of a technical specification/planning document. The user will need clear structure. But the guidelines say for reports and documents, I should write in prose and paragraphs without lists.
>  
> For a project design document of this scope, I need to balance structure with readability. I'll use headers to organize the major sections and phases, then write the content in prose form within each section rather than using bullet points or numbered lists. This way I maintain the clarity and organization the user needs while keeping the writing style natural and flowing. Now I'm mapping out the core data entities—users, teams, projects, world bibles for character and scene consistency, screenplays with version control, individual shots for storyboarding, and assets like images and audio tied to each shot. I'll also need to track versions across different levels, handle comments and discussions, manage async generation tasks, and maintain audit records for the review workflow.
> 
> I'm breaking this into four implementation phases: first establishing the user system and basic screenplay generation with version management, then adding shot-level storyboarding with the world bible and image generation, followed by video generation with task queuing and team permissions, and finally the timeline editor with audio and export capabilities. For each phase I'll design the API endpoints and frontend views needed to support those features.

# AI短剧生成平台 — 项目设计方案

---

## 一、项目总览

### 1.1 项目定位

本平台面向导演及创作团队，提供从剧本创作到成片输出的AI辅助短剧制作全流程工具。平台以"项目"为核心组织单元，贯穿剧本撰写、分镜头设计、视觉素材生成、音频合成、视频剪辑与导出的完整制作管线，同时提供团队协作、版本管理与审核机制。

### 1.2 技术栈总览

前端采用 Next.js 14+（App Router）配合 Tailwind CSS 和 Zustand 做状态管理。后端采用 NestJS 框架，数据库使用 PostgreSQL 配合 Prisma ORM，缓存与任务队列使用 Redis + BullMQ，文件存储使用 S3 兼容的对象存储（如 MinIO 或阿里云 OSS），实时通信使用 Socket.io。全项目使用 TypeScript 编写，通过 monorepo（Turborepo）管理前后端共享类型。

### 1.3 整体数据模型层级

```
Organization（团队/组织）
  └── Project（项目）
        ├── WorldBible（世界观设定）
        │     ├── Character（角色档案）
        │     ├── Location（场景档案）
        │     └── StyleGuide（风格指南）
        ├── Screenplay（剧本）
        │     ├── Synopsis（大纲）
        │     └── Scene（场次）
        │           └── Shot（分镜头）
        │                 ├── ImageAsset（图片素材）
        │                 ├── VideoAsset（视频素材）
        │                 └── AudioAsset（音频素材）
        └── Timeline（时间线/剪辑）
              └── TimelineTrack（轨道）
                    └── TimelineClip（片段）

--- 横切关注点 ---
Version（版本快照）→ 关联到 Screenplay / Scene / Shot
Comment（评论讨论）→ 关联到任意版本
AuditRecord（审核记录）→ 关联到任意版本
GenerationTask（异步生成任务）→ 关联到 Shot / Asset
```

---

## 二、第一阶段 — 基础平台与剧本引擎

### 2.1 阶段目标

搭建平台基础设施，跑通"用户注册 → 创建项目 → AI生成剧本 → 编辑迭代 → 版本管理"这条最小闭环。本阶段完成后，平台可以作为一个AI剧本写作工具独立使用。

### 2.2 功能模块

**用户系统：** 支持邮箱注册/登录，JWT Token 鉴权，用户个人资料管理。管理后台支持查看平台用户列表、项目统计数据和系统配置（如 LLM API 密钥管理）。

**项目管理：** 用户可以创建项目，每个项目包含基础信息（标题、类型、简介、封面）。项目列表页支持按状态筛选和搜索。项目详情页是后续所有工作流的入口。

**剧本生成与编辑：** 剧本创作分为两个子阶段。第一步是"大纲生成"，用户输入题材、风格、核心冲突等关键词，LLM 生成结构化大纲（包含每一幕/集的梗概）。第二步是"剧本展开"，基于确认的大纲，LLM 逐场景生成完整剧本（含对白、动作描述、场景说明）。两个阶段均支持用户手动编辑和再次调用 AI 重写指定段落。

**版本管理：** 每次对剧本内容的保存都会创建一个版本快照。用户可以浏览历史版本列表、查看任意历史版本的内容、将任意历史版本恢复为当前版本。版本之间支持简单的文本差异对比。

### 2.3 数据模型设计

```prisma
// ===== 用户系统 =====

model User {
  id            String   @id @default(cuid())
  email         String   @unique
  passwordHash  String
  nickname      String
  avatar        String?
  role          SystemRole @default(USER)  // USER | ADMIN
  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt

  projects         Project[]
  projectMembers   ProjectMember[]
  comments         Comment[]
  auditRecords     AuditRecord[]
}

// ===== 项目 =====

model Project {
  id           String   @id @default(cuid())
  title        String
  genre        String?           // 题材类型：悬疑/爱情/科幻等
  description  String?
  coverUrl     String?
  status       ProjectStatus @default(DRAFT)  // DRAFT | IN_PROGRESS | COMPLETED | ARCHIVED
  ownerId      String
  owner        User     @relation(fields: [ownerId], references: [id])
  createdAt    DateTime @default(now())
  updatedAt    DateTime @updatedAt

  screenplays  Screenplay[]
  members      ProjectMember[]
}

enum ProjectStatus {
  DRAFT
  IN_PROGRESS
  COMPLETED
  ARCHIVED
}

// ===== 剧本 =====

model Screenplay {
  id          String   @id @default(cuid())
  projectId   String
  project     Project  @relation(fields: [projectId], references: [id])
  title       String
  currentVersionId  String?   // 指向当前生效的版本
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  versions    ScreenplayVersion[]
  scenes      Scene[]
}

model ScreenplayVersion {
  id             String   @id @default(cuid())
  screenplayId   String
  screenplay     Screenplay @relation(fields: [screenplayId], references: [id])
  versionNumber  Int
  synopsis       String?     @db.Text   // 大纲内容
  fullText       String?     @db.Text   // 完整剧本文本
  createdById    String
  changeNote     String?     // 版本说明："AI生成初稿" / "修改第三场对白" 等
  createdAt      DateTime @default(now())

  comments       Comment[]
}

model Scene {
  id              String   @id @default(cuid())
  screenplayId    String
  screenplay      Screenplay @relation(fields: [screenplayId], references: [id])
  sceneNumber     Int
  heading         String       // 场景标题：如 "INT. 咖啡馆 - 日"
  description     String? @db.Text
  content         String  @db.Text   // 场景正文（对白+动作）
  sortOrder       Int
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt
}

// ===== 通用：评论 =====

model Comment {
  id            String   @id @default(cuid())
  content       String   @db.Text
  authorId      String
  author        User     @relation(fields: [authorId], references: [id])

  // 多态关联：通过 targetType + targetId 关联到任意实体版本
  targetType    CommentTargetType   // SCREENPLAY_VERSION | SHOT_VERSION 等
  targetId      String

  parentId      String?              // 支持回复嵌套
  parent        Comment?  @relation("CommentReplies", fields: [parentId], references: [id])
  replies       Comment[] @relation("CommentReplies")

  createdAt     DateTime @default(now())
}

enum CommentTargetType {
  SCREENPLAY_VERSION
  SCENE
  SHOT_VERSION
  ASSET
}

// ===== 管理后台：系统配置 =====

model SystemConfig {
  id     String @id @default(cuid())
  key    String @unique    // 如 "llm_api_base_url", "llm_api_key", "llm_model_name"
  value  String @db.Text
}
```

### 2.4 LLM 接入层设计

在后端设计一个独立的 `AiService` 模块，封装所有与 LLM 的交互。由于要求兼容 OpenAI Completions 响应格式，核心设计如下：

```typescript
// ai/ai.service.ts

interface LlmConfig {
  baseUrl: string;       // 可配置的API基础地址
  apiKey: string;
  model: string;
  maxTokens?: number;
  temperature?: number;
}

interface LlmMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

interface LlmResponse {
  content: string;
  usage: { promptTokens: number; completionTokens: number };
}

class AiService {
  // 通用对话接口
  async chat(messages: LlmMessage[], config?: Partial<LlmConfig>): Promise<LlmResponse>;
  
  // 流式对话接口（用于前端打字机效果）
  async chatStream(messages: LlmMessage[], config?: Partial<LlmConfig>): AsyncIterable<string>;
  
  // ---- 业务封装 ----
  
  // 生成大纲
  async generateSynopsis(params: {
    genre: string;
    theme: string;
    keywords: string[];
    episodeCount: number;
    constraints?: string;
  }): Promise<string>;
  
  // 基于大纲生成完整场景
  async generateScene(params: {
    synopsis: string;
    sceneNumber: number;
    previousContext?: string;   // 前文上下文
    characters?: CharacterBrief[];
  }): Promise<{ heading: string; content: string }>;
  
  // 重写指定段落
  async rewriteSegment(params: {
    originalText: string;
    instruction: string;     // 用户的修改指令
    context?: string;
  }): Promise<string>;
}
```

所有 system prompt 模板以配置文件形式管理，放在 `prompts/` 目录下，便于调优。每次 AI 调用的输入输出都记录到 `GenerationLog` 表中，用于后续分析和调试。

### 2.5 核心 API 设计

**认证相关：** `POST /auth/register` 用户注册，`POST /auth/login` 用户登录返回JWT，`GET /auth/me` 获取当前用户信息。

**项目相关：** `POST /projects` 创建项目，`GET /projects` 获取项目列表（支持分页、筛选），`GET /projects/:id` 获取项目详情，`PATCH /projects/:id` 更新项目信息，`DELETE /projects/:id` 删除项目。

**剧本相关：** `POST /projects/:projectId/screenplays` 创建剧本，`GET /projects/:projectId/screenplays` 获取项目下的剧本列表，`GET /screenplays/:id` 获取剧本详情（含当前版本内容），`POST /screenplays/:id/generate-synopsis` AI生成大纲（流式响应），`POST /screenplays/:id/generate-scenes` 基于大纲AI生成场景，`POST /screenplays/:id/rewrite` AI重写指定内容。

**场景相关：** `GET /screenplays/:id/scenes` 获取剧本下所有场景，`PATCH /scenes/:id` 更新场景内容（同时自动创建版本快照），`PUT /screenplays/:id/scenes/reorder` 调整场景顺序。

**版本相关：** `GET /screenplays/:id/versions` 获取剧本版本列表，`GET /screenplay-versions/:versionId` 获取指定版本内容，`POST /screenplay-versions/:versionId/restore` 将此版本恢复为当前版本，`GET /screenplay-versions/:v1/diff/:v2` 对比两个版本差异。

**评论相关：** `POST /comments` 创建评论（携带 targetType 和 targetId），`GET /comments?targetType=xxx&targetId=xxx` 获取指定目标的评论列表。

**管理后台：** `GET /admin/users` 用户列表，`GET /admin/stats` 平台统计，`GET /admin/configs` 系统配置列表，`PATCH /admin/configs/:key` 更新系统配置。

### 2.6 前端页面结构

```
/                           → 首页/登录引导
/login                      → 登录页
/register                   → 注册页
/dashboard                  → 项目列表页（卡片式展示）
/projects/new               → 创建项目
/projects/:id               → 项目详情页（概览、侧边栏导航）
/projects/:id/screenplay    → 剧本工作台
  ├── 左侧：场景列表（可拖拽排序）
  ├── 中间：编辑器（富文本/Markdown）
  ├── 右侧：AI 助手面板 + 版本历史 + 评论
/projects/:id/screenplay/versions  → 版本对比页
/admin                      → 管理后台
  ├── /admin/users
  ├── /admin/configs
  └── /admin/stats
```

剧本工作台是本阶段最核心的页面，采用三栏布局。中间编辑器建议使用 Tiptap（基于 ProseMirror），支持富文本编辑且容易自定义扩展。右侧的 AI 助手面板以对话形式展示，用户可以选中文本后右键呼出 AI 操作（重写、扩写、缩写、调整语气等）。

### 2.7 本阶段技术要点

关于流式输出的处理：LLM 的流式响应通过 Server-Sent Events（SSE）从后端转发给前端。后端 NestJS Controller 使用 `@Sse()` 装饰器，前端使用 `EventSource` 或 `fetch` 配合 `ReadableStream` 消费。流式输出过程中，前端实时渲染内容，流结束后将完整内容保存到数据库并创建版本。

关于版本快照的存储策略：由于剧本文本量相对不大，本阶段采用全量快照策略（每个版本存完整内容），不做增量差异存储。版本对比功能在前端使用 `diff` 库（如 `diff-match-patch`）实时计算，不需要后端存储差异。

---

## 三、第二阶段 — 分镜头与视觉生成

### 3.1 阶段目标

在剧本基础上向下延伸到分镜头层级，引入世界观设定（WorldBible）保障视觉一致性，接入 AI 生图能力，实现"剧本场景 → 结构化分镜头脚本 → AI生成概念图"的完整链路。同时完善评论讨论功能和团队协作的基础框架。

### 3.2 功能模块

**世界观设定（WorldBible）：** 每个项目拥有一个世界观设定空间，包含三个子模块。角色档案（Character）记录角色名、外貌特征的自然语言描述、性格标签、参考图（用户上传或AI生成）、在不同场景中的服装设定。场景档案（Location）记录场景名、视觉描述、光照氛围、时间段、参考图。风格指南（StyleGuide）定义全局画面风格（如赛博朋克、水墨风、胶片质感等）、色调倾向、构图偏好、需要回避的元素。这些设定在后续生成分镜头脚本和生图时会自动注入到 prompt 中。

**分镜头脚本生成：** 用户选择一个场景，调用 AI 生成该场景的分镜头脚本。生成结果是结构化数据，每个镜头（Shot）包含镜头编号、景别（EXTREME_WIDE / WIDE / MEDIUM / CLOSE_UP / EXTREME_CLOSE_UP）、镜头运动（STATIC / PAN / TILT / DOLLY / ZOOM / HANDHELD / CRANE）、画面描述（详细的视觉描述文本）、涉及的角色列表、对白内容、动作描述、音效提示、预估时长（秒）。用户可以对每个镜头单独编辑，也可以添加、删除、重新排列镜头。

**AI 生图：** 用户可以为每个分镜头生成概念图。系统会自动将镜头的画面描述、涉及角色的外貌设定、场景的视觉描述、全局风格指南拼接成完整的图片生成 prompt。每个镜头可以生成多张候选图，用户选择一张作为"采纳图"。支持用户手动修改 prompt 后重新生成。

**项目成员与基础协作：** 项目拥有者可以邀请其他用户加入项目，设置角色（导演/编剧/分镜师/查看者）。所有项目成员可以在剧本版本和分镜头版本上发表评论，支持@提及其他成员、评论回复嵌套。

### 3.3 新增数据模型

```prisma
// ===== 世界观设定 =====

model WorldBible {
  id          String   @id @default(cuid())
  projectId   String   @unique
  project     Project  @relation(fields: [projectId], references: [id])

  characters  Character[]
  locations   Location[]
  styleGuide  StyleGuide?
}

model Character {
  id              String   @id @default(cuid())
  worldBibleId    String
  worldBible      WorldBible @relation(fields: [worldBibleId], references: [id])
  name            String
  appearance      String   @db.Text    // 外貌的自然语言描述
  personality     String?  @db.Text
  tags            String[]             // 标签：如 ["女主", "25岁", "黑长直"]
  referenceImages String[]             // 参考图URL数组
  costumes        Json?                // { "场景A": "白色连衣裙", "场景B": "黑色西装" }
  sortOrder       Int
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt
}

model Location {
  id              String   @id @default(cuid())
  worldBibleId    String
  worldBible      WorldBible @relation(fields: [worldBibleId], references: [id])
  name            String
  description     String   @db.Text     // 视觉描述
  lighting        String?               // 光照氛围描述
  timeOfDay       String?               // "日" | "夜" | "黄昏" 等
  referenceImages String[]
  sortOrder       Int
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt
}

model StyleGuide {
  id              String   @id @default(cuid())
  worldBibleId    String   @unique
  worldBible      WorldBible @relation(fields: [worldBibleId], references: [id])
  visualStyle     String   @db.Text     // "赛博朋克风，霓虹灯主色调"
  colorPalette    String?  @db.Text     // 色调倾向描述
  compositionNote String?  @db.Text     // 构图偏好
  negativePrompt  String?  @db.Text     // 回避元素（直接用于生图负面提示）
  referenceImages String[]
}

// ===== 分镜头 =====

model Shot {
  id              String   @id @default(cuid())
  sceneId         String
  scene           Scene    @relation(fields: [sceneId], references: [id])
  shotNumber      Int
  shotSize        ShotSize                // 景别
  cameraMovement  CameraMovement          // 镜头运动
  visualDescription String  @db.Text      // 画面描述
  dialogue        String?  @db.Text       // 对白
  actionDescription String? @db.Text      // 动作描述
  soundNote       String?                 // 音效提示
  durationSeconds Float?                  // 预估时长
  characterIds    String[]                // 涉及的角色ID
  sortOrder       Int
  currentVersionId String?
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt

  versions        ShotVersion[]
  assets          Asset[]
}

enum ShotSize {
  EXTREME_WIDE
  WIDE
  MEDIUM_WIDE
  MEDIUM
  MEDIUM_CLOSE
  CLOSE_UP
  EXTREME_CLOSE_UP
}

enum CameraMovement {
  STATIC
  PAN_LEFT
  PAN_RIGHT
  TILT_UP
  TILT_DOWN
  DOLLY_IN
  DOLLY_OUT
  ZOOM_IN
  ZOOM_OUT
  HANDHELD
  CRANE
  TRACKING
}

model ShotVersion {
  id             String   @id @default(cuid())
  shotId         String
  shot           Shot     @relation(fields: [shotId], references: [id])
  versionNumber  Int
  data           Json                   // 快照：包含 Shot 的所有字段
  createdById    String
  changeNote     String?
  createdAt      DateTime @default(now())

  comments       Comment[]
}

// ===== 素材资产 =====

model Asset {
  id           String    @id @default(cuid())
  shotId       String
  shot         Shot      @relation(fields: [shotId], references: [id])
  type         AssetType               // IMAGE | VIDEO | AUDIO
  url          String                  // 对象存储URL
  thumbnail    String?                 // 缩略图URL
  prompt       String?   @db.Text      // 生成时使用的prompt
  metadata     Json?                   // 宽高、时长、文件大小等
  isSelected   Boolean   @default(false) // 是否被采纳
  generationTaskId String?
  createdAt    DateTime  @default(now())
}

enum AssetType {
  IMAGE
  VIDEO
  AUDIO
}

// ===== 项目成员 =====

model ProjectMember {
  id          String   @id @default(cuid())
  projectId   String
  project     Project  @relation(fields: [projectId], references: [id])
  userId      String
  user        User     @relation(fields: [userId], references: [id])
  role        ProjectRole @default(VIEWER)
  joinedAt    DateTime @default(now())

  @@unique([projectId, userId])
}

enum ProjectRole {
  OWNER
  DIRECTOR
  WRITER
  STORYBOARD_ARTIST
  VIEWER
}
```

### 3.4 Prompt 拼接引擎设计

这是本阶段最关键的技术设计。生图的质量高度依赖 prompt 的构建质量，而 prompt 需要从多个数据源自动拼接。设计一个 `PromptBuilder` 服务：

```typescript
class PromptBuilderService {
  
  // 为指定 Shot 构建图片生成 prompt
  async buildImagePrompt(shotId: string): Promise<{
    positivePrompt: string;
    negativePrompt: string;
  }> {
    const shot = await this.getShot(shotId);          // 获取镜头数据
    const scene = await this.getScene(shot.sceneId);   // 获取所属场景
    const characters = await this.getCharacters(shot.characterIds); // 获取涉及角色
    const location = await this.findMatchingLocation(scene);  // 匹配场景档案
    const style = await this.getStyleGuide(shot);      // 获取风格指南
    
    // 拼接正面 prompt
    // 结构：[风格前缀] + [景别描述] + [画面描述] + [角色外貌] + [场景环境] + [光照氛围] + [色调]
    const positivePrompt = [
      style?.visualStyle,
      this.shotSizeToPrompt(shot.shotSize),        // "close-up shot" 等
      shot.visualDescription,
      ...characters.map(c => `${c.name}: ${c.appearance}`),
      location?.description,
      location?.lighting,
      style?.colorPalette,
    ].filter(Boolean).join(', ');
    
    const negativePrompt = style?.negativePrompt || 
      'blurry, low quality, distorted, deformed';
    
    return { positivePrompt, negativePrompt };
  }
  
  // 为指定 Scene 构建分镜头脚本生成的 LLM prompt
  async buildStoryboardPrompt(sceneId: string): Promise<LlmMessage[]> {
    const scene = await this.getScene(sceneId);
    const screenplay = await this.getScreenplay(scene.screenplayId);
    const worldBible = await this.getWorldBible(screenplay.projectId);
    
    const systemPrompt = `你是一位专业的分镜头脚本设计师。
      根据剧本场景内容，生成结构化的分镜头脚本。
      
      项目风格：${worldBible.styleGuide?.visualStyle || '写实风格'}
      
      可用角色：
      ${worldBible.characters.map(c => `- ${c.name}：${c.appearance}`).join('\n')}
      
      可用场景：
      ${worldBible.locations.map(l => `- ${l.name}：${l.description}`).join('\n')}
      
      请为每个镜头输出以下JSON结构：
      {
        "shotNumber": number,
        "shotSize": "WIDE" | "MEDIUM" | "CLOSE_UP" | ...,
        "cameraMovement": "STATIC" | "PAN_LEFT" | ...,
        "visualDescription": "详细的画面描述",
        "dialogue": "台词（如有）",
        "actionDescription": "动作描述",
        "soundNote": "音效提示",
        "durationSeconds": number,
        "characterNames": ["角色名"]
      }`;
      
    return [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: `请为以下场景生成分镜头脚本：\n\n${scene.heading}\n\n${scene.content}` }
    ];
  }
}
```

### 3.5 生成服务适配层设计

```typescript
// generation/generation-adapter.interface.ts

interface ImageGenerationParams {
  positivePrompt: string;
  negativePrompt?: string;
  width?: number;
  height?: number;
  count?: number;          // 生成几张候选图
  seed?: number;
  referenceImageUrl?: string;  // 参考图（用于img2img）
}

interface ImageGenerationResult {
  images: Array<{
    url: string;
    seed: number;
  }>;
}

interface IImageGenerationAdapter {
  generate(params: ImageGenerationParams): Promise<ImageGenerationResult>;
}

// 实现多个适配器
class OpenAiDalleAdapter implements IImageGenerationAdapter { ... }
class StabilityAiAdapter implements IImageGenerationAdapter { ... }
class ComfyUiAdapter implements IImageGenerationAdapter { ... }

// generation/generation.service.ts
class GenerationService {
  private adapter: IImageGenerationAdapter;
  
  constructor(configService: ConfigService) {
    // 根据系统配置选择适配器
    const provider = configService.get('IMAGE_PROVIDER');
    this.adapter = this.createAdapter(provider);
  }
  
  async generateImage(params: ImageGenerationParams): Promise<ImageGenerationResult> {
    return this.adapter.generate(params);
  }
}
```

### 3.6 核心 API 设计（新增部分）

**世界观设定：** `GET /projects/:id/world-bible` 获取项目世界观设定，`POST /projects/:id/world-bible/characters` 创建角色，`PATCH /characters/:id` 更新角色信息，`DELETE /characters/:id` 删除角色。场景档案和风格指南同理，结构类似。`POST /characters/:id/generate-portrait` AI生成角色参考图。

**分镜头：** `POST /scenes/:sceneId/generate-shots` AI生成分镜头脚本（返回结构化数据），`GET /scenes/:sceneId/shots` 获取场景下所有分镜头，`PATCH /shots/:id` 更新分镜头信息（自动创建版本），`PUT /scenes/:sceneId/shots/reorder` 调整分镜头顺序，`DELETE /shots/:id` 删除分镜头，`GET /shots/:id/versions` 获取分镜头版本历史。

**生图：** `POST /shots/:id/generate-image` 为分镜头生成概念图，`GET /shots/:id/assets?type=IMAGE` 获取分镜头的所有图片素材，`PATCH /assets/:id/select` 将某张图设为采纳图，`DELETE /assets/:id` 删除素材。`POST /shots/:id/generate-image/preview-prompt` 预览自动拼接的prompt（不实际生成，让用户可以检查和修改）。

**项目成员：** `POST /projects/:id/members` 邀请成员，`GET /projects/:id/members` 获取成员列表，`PATCH /project-members/:id` 修改成员角色，`DELETE /project-members/:id` 移除成员。

### 3.7 前端页面结构（新增部分）

```
/projects/:id/world-bible          → 世界观设定页
  ├── /characters                  → 角色档案列表与编辑
  ├── /locations                   → 场景档案列表与编辑
  └── /style                       → 风格指南编辑

/projects/:id/storyboard           → 分镜头工作台
  ├── 左侧：场景列表（从剧本同步）
  ├── 中间：分镜头卡片网格视图（每个卡片展示缩略图+镜头信息）
  ├── 底部：分镜头条形时间线视图（可切换）
  └── 右侧：选中镜头的详情编辑面板 + AI生图面板 + 评论

/projects/:id/members              → 项目成员管理页
```

分镜头工作台支持两种视图模式：卡片网格模式适合概览和排列，每个卡片展示镜头编号、缩略图、景别图标和简要描述；时间线条形模式更直观地展示镜头顺序和时长比例。右侧的AI生图面板展示自动拼接的 prompt（可编辑），生成按钮，和候选图结果网格。

---

## 四、第三阶段 — 视频生成、异步任务与审核流程

### 4.1 阶段目标

接入 AI 视频生成能力，搭建完善的异步任务处理系统支撑耗时操作，建立完整的审核工作流，并细化权限体系。本阶段完成后，平台具备从剧本到视频片段的完整AI生产能力。

### 4.2 功能模块

**AI 视频生成：** 用户可以基于分镜头的已采纳图片或画面描述，为每个镜头生成视频片段。支持两种生成模式：图生视频（Image-to-Video，以采纳的概念图为起始帧）和文生视频（Text-to-Video，纯文字描述生成）。视频生成的 prompt 同样由 PromptBuilder 自动拼接，注入角色、场景、风格信息。每个镜头可以生成多个候选视频，用户选择采纳。支持设置视频时长、宽高比、运动幅度等参数。

**异步任务队列：** 所有耗时的生成操作（生图、生视频、批量生成等）通过 BullMQ 任务队列异步处理。前端提交生成请求后立即获得一个 taskId，通过 WebSocket 实时接收任务状态变更（排队中 → 处理中 → 已完成/失败）。支持批量操作：一键为所有分镜头生成概念图，一键为所有分镜头生成视频。任务面板展示当前项目的所有进行中和已完成任务，支持取消排队中的任务和重试失败的任务。

**审核工作流：** 项目可以配置审核策略，针对不同内容类型（剧本、分镜头脚本、图片素材、视频素材）分别设置是否需要审核。审核状态流转：草稿（Draft）→ 提交审核（Pending Review）→ 审核通过（Approved）/ 审核驳回（Rejected，附理由）。被驳回的内容可以修改后重新提交。具有"导演"或"Owner"角色的成员才能执行审核操作。审核操作会创建 AuditRecord 记录，包含审核人、审核意见、时间戳。

**通知系统：** 当评论被回复、内容提交审核、审核通过/驳回时，相关人员收到站内通知。通知通过 WebSocket 实时推送，同时持久化到数据库供离线查看。

### 4.3 新增数据模型

```prisma
// ===== 异步任务 =====

model GenerationTask {
  id           String    @id @default(cuid())
  projectId    String
  type         TaskType              // IMAGE_GENERATION | VIDEO_GENERATION | BATCH_IMAGE | BATCH_VIDEO | TTS
  status       TaskStatus @default(PENDING)
  priority     Int       @default(0)
  
  // 输入参数
  input        Json                  // 包含 prompt、目标shotId、生成参数等
  
  // 输出结果
  output       Json?                 // 包含生成的 assetUrl、错误信息等
  
  // 进度追踪
  progress     Float     @default(0) // 0~1
  errorMessage String?
  
  // 关联
  createdById  String
  shotId       String?
  
  // 重试机制
  attempts     Int       @default(0)
  maxAttempts  Int       @default(3)
  
  startedAt    DateTime?
  completedAt  DateTime?
  createdAt    DateTime  @default(now())
}

enum TaskType {
  IMAGE_GENERATION
  VIDEO_GENERATION
  BATCH_IMAGE
  BATCH_VIDEO
  TTS_GENERATION
  LLM_GENERATION
}

enum TaskStatus {
  PENDING
  QUEUED
  PROCESSING
  COMPLETED
  FAILED
  CANCELLED
}

// ===== 审核 =====

model AuditConfig {
  id              String   @id @default(cuid())
  projectId       String
  project         Project  @relation(fields: [projectId], references: [id])
  contentType     AuditContentType     // SCREENPLAY | STORYBOARD | IMAGE | VIDEO
  requireAudit    Boolean  @default(false)
  
  @@unique([projectId, contentType])
}

enum AuditContentType {
  SCREENPLAY
  STORYBOARD
  IMAGE
  VIDEO
}

model AuditRecord {
  id            String   @id @default(cuid())
  targetType    String              // 同 CommentTargetType
  targetId      String
  status        AuditStatus
  reviewerId    String
  reviewer      User     @relation(fields: [reviewerId], references: [id])
  comment       String?  @db.Text   // 审核意见
  createdAt     DateTime @default(now())
}

enum AuditStatus {
  PENDING
  APPROVED
  REJECTED
}

// ===== 通知 =====

model Notification {
  id          String   @id @default(cuid())
  userId      String                    // 接收人
  type        NotificationType
  title       String
  content     String
  data        Json?                     // 额外数据：如跳转链接参数
  isRead      Boolean  @default(false)
  createdAt   DateTime @default(now())
}

enum NotificationType {
  COMMENT_REPLY
  AUDIT_SUBMITTED
  AUDIT_APPROVED
  AUDIT_REJECTED
  TASK_COMPLETED
  TASK_FAILED
  MEMBER_INVITED
}
```

### 4.4 任务队列架构设计

```typescript
// task/task-queue.module.ts

// BullMQ 队列定义
const IMAGE_QUEUE = 'image-generation';
const VIDEO_QUEUE = 'video-generation';
const NOTIFICATION_QUEUE = 'notification';

// 队列处理器
@Processor(IMAGE_QUEUE)
class ImageGenerationProcessor {
  @Process()
  async handleGeneration(job: Job<ImageTaskPayload>) {
    const { taskId, shotId, params } = job.data;
    
    // 更新任务状态
    await this.taskService.updateStatus(taskId, TaskStatus.PROCESSING);
    
    // 通过适配器调用生图API
    const result = await this.generationService.generateImage(params);
    
    // 保存生成的素材到对象存储，创建 Asset 记录
    const assets = await this.assetService.saveGeneratedImages(shotId, result);
    
    // 更新任务状态
    await this.taskService.complete(taskId, { assetIds: assets.map(a => a.id) });
    
    // 通过 WebSocket 通知前端
    this.wsGateway.notifyTaskComplete(job.data.userId, taskId, assets);
  }
}

@Processor(VIDEO_QUEUE)
class VideoGenerationProcessor {
  @Process()
  async handleGeneration(job: Job<VideoTaskPayload>) {
    const { taskId, shotId, params } = job.data;
    
    await this.taskService.updateStatus(taskId, TaskStatus.PROCESSING);
    
    // 视频生成通常需要轮询第三方API获取结果
    const externalTaskId = await this.videoAdapter.submit(params);
    
    // 轮询等待结果（带超时）
    const result = await this.videoAdapter.pollResult(externalTaskId, {
      interval: 5000,        // 每5秒查询一次
      timeout: 300000,       // 最多等5分钟
      onProgress: (progress) => {
        this.taskService.updateProgress(taskId, progress);
        this.wsGateway.notifyTaskProgress(job.data.userId, taskId, progress);
      }
    });
    
    const asset = await this.assetService.saveGeneratedVideo(shotId, result);
    await this.taskService.complete(taskId, { assetId: asset.id });
    this.wsGateway.notifyTaskComplete(job.data.userId, taskId, asset);
  }
}
```

视频生成适配层需要支持多个供应商。由于不同供应商的API差异很大（有的是同步返回，有的是提交任务后轮询，有的是WebHook回调），适配器接口需要抽象出统一的异步模式：

```typescript
interface IVideoGenerationAdapter {
  submit(params: VideoGenerationParams): Promise<string>;  // 返回外部任务ID
  pollResult(externalTaskId: string, options: PollOptions): Promise<VideoResult>;
  cancel?(externalTaskId: string): Promise<void>;
}

class RunwayAdapter implements IVideoGenerationAdapter { ... }
class KlingAdapter implements IVideoGenerationAdapter { ... }
class PikaAdapter implements IVideoGenerationAdapter { ... }
```

### 4.5 WebSocket 网关设计

```typescript
@WebSocketGateway({ cors: true })
class EventsGateway {
  @WebSocketServer()
  server: Server;
  
  // 用户连接时加入自己的房间和所属项目房间
  handleConnection(client: Socket) {
    const userId = this.extractUserId(client);
    client.join(`user:${userId}`);
    // 加入用户所有项目的房间
    const projectIds = await this.memberService.getUserProjectIds(userId);
    projectIds.forEach(pid => client.join(`project:${pid}`));
  }
  
  // 任务进度通知（发送给指定用户）
  notifyTaskProgress(userId: string, taskId: string, progress: number) {
    this.server.to(`user:${userId}`).emit('task:progress', { taskId, progress });
  }
  
  // 任务完成通知
  notifyTaskComplete(userId: string, taskId: string, result: any) {
    this.server.to(`user:${userId}`).emit('task:complete', { taskId, result });
  }
  
  // 新评论通知（发送给项目所有成员）
  notifyNewComment(projectId: string, comment: CommentDto) {
    this.server.to(`project:${projectId}`).emit('comment:new', comment);
  }
  
  // 审核状态变更通知
  notifyAuditUpdate(userId: string, audit: AuditRecordDto) {
    this.server.to(`user:${userId}`).emit('audit:update', audit);
  }
}
```

### 4.6 核心 API 设计（新增部分）

**视频生成：** `POST /shots/:id/generate-video` 提交视频生成任务（返回 taskId），`POST /shots/:id/generate-video/preview-prompt` 预览视频生成prompt，`POST /scenes/:sceneId/batch-generate-video` 批量生成该场景所有镜头的视频。

**任务管理：** `GET /projects/:id/tasks` 获取项目任务列表（支持按状态和类型筛选），`GET /tasks/:taskId` 获取任务详情和进度，`POST /tasks/:taskId/cancel` 取消排队中的任务，`POST /tasks/:taskId/retry` 重试失败的任务。

**审核流程：** `GET /projects/:id/audit-config` 获取项目审核配置，`PATCH /projects/:id/audit-config` 更新审核配置，`POST /audit/submit` 提交内容进行审核（携带 targetType 和 targetId），`POST /audit/:id/approve` 通过审核，`POST /audit/:id/reject` 驳回审核（附理由），`GET /projects/:id/audit-records` 获取审核记录列表（支持按状态筛选）。

**通知：** `GET /notifications` 获取当前用户的通知列表，`PATCH /notifications/:id/read` 标记已读，`PATCH /notifications/read-all` 全部标记已读。

### 4.7 前端页面结构（新增部分）

```
/projects/:id/storyboard    → 在第二阶段的基础上增强
  └── 右侧面板增加：
      ├── AI生视频面板（参数配置、生成/候选列表）
      └── 审核状态与操作按钮

/projects/:id/tasks          → 任务管理面板
  ├── 进行中任务（带进度条）
  ├── 排队中任务（可取消）
  └── 已完成/失败任务历史

/projects/:id/review         → 审核工作台
  ├── 待审核列表
  ├── 已审核历史
  └── 点击展开：内容预览 + 审核操作

/projects/:id/settings       → 项目设置
  ├── 基础信息
  ├── 成员管理
  └── 审核策略配置

/notifications               → 通知中心页
```

任务管理可以做成一个全局面板（类似下载管理器），固定在页面右下角，显示当前进行中的任务数量，展开后展示详细列表和进度。

---

## 五、第四阶段 — 时间线剪辑、音频与成片导出

### 5.1 阶段目标

将所有生成的视频片段、音频组装成完整短剧。提供轻量级的时间线编辑器，支持 AI 配音生成，最终导出可发布的完整视频。本阶段完成后，平台覆盖短剧制作的完整生命周期。

### 5.2 功能模块

**AI 配音/TTS：** 在分镜头层级，系统自动提取每个镜头的对白内容，用户可以为每个角色指定音色（从TTS供应商的音色库中选择，或上传角色参考音频进行声音克隆）。支持一键为整个场景的所有对白生成配音。生成的音频作为 AudioAsset 绑定到对应镜头。支持调整语速、情感、音量等参数。

**背景音乐与音效：** 用户可以上传背景音乐和音效文件，也可以使用 AI 音乐生成（如对接 Suno 或 Udio 的 API）。这些音频素材存放在项目的素材库中，供时间线编辑时使用。

**时间线编辑器：** 这是本阶段最核心的功能，提供一个多轨道时间线编辑界面。视频轨道自动从已采纳的镜头视频按序排列，用户可以拖拽调整顺序、裁剪片段的入点和出点。对白/配音轨道展示与视频对齐的配音片段。背景音乐轨道可以添加和排列音乐片段，调整音量曲线。字幕轨道自动从对白生成字幕，支持手动编辑字幕文本、时间和样式。支持基础的转场设置（淡入淡出、溶解等）。播放预览功能：在编辑器内播放合成预览（前端实时混合，不需要实际渲染）。

**成片导出：** 用户确认时间线编辑后，提交导出任务。后端使用 FFmpeg 将所有视频片段按时间线拼接，混入音频轨道，烧入字幕，应用转场效果，输出最终视频文件。支持配置输出参数：分辨率、帧率、码率、格式（MP4/MOV）。导出也是异步任务，完成后用户可以下载或在线预览。

### 5.3 新增数据模型

```prisma
// ===== 角色音色配置 =====

model CharacterVoice {
  id            String   @id @default(cuid())
  characterId   String
  character     Character @relation(fields: [characterId], references: [id])
  ttsProvider   String              // 如 "openai" | "fish-audio" | "chattts"
  voiceId       String              // 供应商的音色ID
  voiceName     String              // 音色名称（展示用）
  sampleUrl     String?             // 试听音频URL
  settings      Json?               // { speed: 1.0, emotion: "neutral", volume: 1.0 }
  createdAt     DateTime @default(now())
}

// ===== 时间线 =====

model Timeline {
  id          String   @id @default(cuid())
  projectId   String   @unique
  project     Project  @relation(fields: [projectId], references: [id])
  duration    Float    @default(0)         // 总时长（秒）
  fps         Int      @default(30)
  resolution  String   @default("1080x1920")  // 竖屏短剧
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  tracks      TimelineTrack[]
}

model TimelineTrack {
  id          String   @id @default(cuid())
  timelineId  String
  timeline    Timeline @relation(fields: [timelineId], references: [id])
  type        TrackType              // VIDEO | DIALOGUE | MUSIC | SFX | SUBTITLE
  name        String
  sortOrder   Int                    // 轨道上下排列顺序
  isMuted     Boolean  @default(false)
  volume      Float    @default(1.0)       // 0~1，音频轨道的音量

  clips       TimelineClip[]
}

enum TrackType {
  VIDEO
  DIALOGUE
  MUSIC
  SFX
  SUBTITLE
}

model TimelineClip {
  id          String   @id @default(cuid())
  trackId     String
  track       TimelineTrack @relation(fields: [trackId], references: [id])
  assetId     String?              // 关联的素材（视频/音频Asset）
  
  // 时间定位
  startTime   Float                // 在时间线上的起始时间（秒）
  duration    Float                // 在时间线上占用的时长（秒）
  
  // 素材裁剪
  inPoint     Float    @default(0)  // 素材的入点（秒）
  outPoint    Float?                // 素材的出点（秒）
  
  // 字幕专用字段
  subtitleText    String?
  subtitleStyle   Json?             // { fontSize, color, position, fontFamily }
  
  // 转场
  transitionIn    String?           // "fade" | "dissolve" | "none"
  transitionOut   String?
  transitionDuration Float?
  
  sortOrder   Int
}

// ===== 导出记录 =====

model ExportRecord {
  id          String   @id @default(cuid())
  projectId   String
  project     Project  @relation(fields: [projectId], references: [id])
  taskId      String                  // 关联的 GenerationTask
  
  // 输出配置
  resolution  String
  fps         Int
  bitrate     String?
  format      String   @default("mp4")
  
  // 结果
  outputUrl   String?                 // 导出视频的URL
  fileSize    Int?                    // 字节
  duration    Float?
  
  status      TaskStatus @default(PENDING)
  createdAt   DateTime @default(now())
  completedAt DateTime?
}
```

### 5.4 TTS 适配层设计

```typescript
interface TTSParams {
  text: string;
  voiceId: string;
  speed?: number;       // 0.5 ~ 2.0
  emotion?: string;     // neutral | happy | sad | angry | ...
}

interface TTSResult {
  audioUrl: string;
  duration: number;     // 秒
}

interface ITTSAdapter {
  listVoices(): Promise<VoiceInfo[]>;
  synthesize(params: TTSParams): Promise<TTSResult>;
}

class OpenAiTTSAdapter implements ITTSAdapter { ... }
class FishAudioAdapter implements ITTSAdapter { ... }
```

### 5.5 FFmpeg 导出服务设计

```typescript
class ExportService {
  async exportTimeline(timelineId: string, config: ExportConfig): Promise<string> {
    const timeline = await this.getFullTimeline(timelineId);
    
    // 1. 下载所有引用的素材到临时目录
    const tempDir = await this.downloadAssets(timeline);
    
    // 2. 构建 FFmpeg 复杂滤镜图
    const filterGraph = this.buildFilterGraph(timeline, tempDir);
    
    // 3. 执行 FFmpeg 命令
    //    - 拼接视频片段（按时间线顺序，应用入出点裁剪）
    //    - 应用转场效果
    //    - 混合多轨音频（对白 + 背景音乐 + 音效，各自音量）
    //    - 烧入字幕（使用 ASS/SRT 字幕格式）
    //    - 输出到指定格式
    const outputPath = await this.runFfmpeg(filterGraph, config);
    
    // 4. 上传到对象存储
    const url = await this.storageService.upload(outputPath);
    
    // 5. 清理临时文件
    await this.cleanup(tempDir);
    
    return url;
  }
  
  private buildFilterGraph(timeline: FullTimeline, tempDir: string): string {
    // 构建 FFmpeg filter_complex 字符串
    // 处理视频拼接、转场、音频混合等
    // 这是整个导出服务最复杂的部分
    ...
  }
}
```

FFmpeg 的执行放在独立的 Worker 进程中（通过 BullMQ），避免阻塞主进程。对于大型项目，导出可能需要几分钟，通过 WebSocket 实时上报进度百分比。

### 5.6 核心 API 设计（新增部分）

**TTS 配音：** `GET /tts/voices` 获取可用音色列表，`POST /characters/:id/voice` 为角色设置音色配置，`POST /shots/:id/generate-tts` 为指定镜头生成配音，`POST /scenes/:sceneId/batch-generate-tts` 批量生成整个场景的配音。

**素材库：** `POST /projects/:id/assets/upload` 上传素材文件（音乐、音效等），`GET /projects/:id/assets?type=MUSIC` 获取项目素材库列表。

**时间线：** `GET /projects/:id/timeline` 获取项目时间线数据，`PUT /projects/:id/timeline` 保存时间线数据（整体覆盖），`POST /projects/:id/timeline/auto-assemble` 自动组装时间线（从分镜头的已采纳素材自动生成初始时间线），`POST /projects/:id/timeline/generate-subtitles` 自动从对白生成字幕轨道。

**导出：** `POST /projects/:id/export` 提交导出任务，`GET /exports/:id` 获取导出记录详情，`GET /projects/:id/exports` 获取项目的导出历史列表。

### 5.7 前端页面结构（新增部分）

```
/projects/:id/voices                → 角色配音配置页
  ├── 角色列表（左侧）
  └── 音色选择与试听、参数调整（右侧）

/projects/:id/timeline              → 时间线编辑器
  ├── 顶部：工具栏（播放/暂停、缩放、撤销/重做、导出按钮）
  ├── 中间上方：视频预览播放器
  ├── 中间下方：多轨道时间线
  │     ├── 视频轨道（可拖拽排列和裁剪）
  │     ├── 对白轨道
  │     ├── 音乐轨道
  │     ├── 音效轨道
  │     └── 字幕轨道
  └── 右侧：属性面板（选中片段的详细编辑）

/projects/:id/exports               → 导出管理页
  ├── 导出配置面板
  └── 历史导出记录列表（可下载/预览）
```

时间线编辑器是整个平台最复杂的前端组件。建议使用 Canvas 或 SVG 绘制时间线（纯DOM实现在性能上可能不够）。播放预览不需要真正渲染视频，而是利用多个 `<video>` 和 `<audio>` 元素的时间同步播放来实现实时预览效果。如果自研时间线编辑器的成本太高，也可以考虑集成开源方案如 Remotion。

### 5.8 本阶段的自动组装逻辑

"自动组装时间线"是一个重要的便利功能，逻辑如下：系统遍历项目中所有场景下的所有镜头（按场景序号和镜头序号排序），对于每个镜头，找到已采纳的视频素材放入视频轨道，找到已生成的配音放入对白轨道，根据对白内容生成字幕片段放入字幕轨道。相邻片段之间自动添加默认转场（如 0.5 秒淡入淡出）。这样用户不需要从零开始手动拖拽，可以在自动组装的基础上微调。

---

## 六、横切关注点与基础设施

以下内容贯穿所有阶段，在第一阶段搭建基础，后续持续完善。

### 6.1 权限系统设计

权限分为两层。系统级权限通过 User.role 控制，分为 ADMIN（可访问管理后台、管理所有用户和系统配置）和 USER（普通用户）。项目级权限通过 ProjectMember.role 控制，OWNER 拥有项目全部权限包括删除项目和管理成员，DIRECTOR 可以审核内容、管理分镜头和素材生成，WRITER 可以编辑剧本和提交审核但不能审核他人内容，STORYBOARD_ARTIST 可以编辑分镜头和生成素材，VIEWER 只能查看和评论。后端每个API接口都通过 Guard（NestJS守卫）检查权限，使用装饰器声明所需角色：

```typescript
@UseGuards(JwtAuthGuard, ProjectRoleGuard)
@RequireProjectRole(ProjectRole.WRITER, ProjectRole.DIRECTOR, ProjectRole.OWNER)
@Post('screenplays/:id/generate-synopsis')
async generateSynopsis(...) { ... }
```

### 6.2 文件存储设计

所有用户上传和AI生成的文件（图片、视频、音频）统一存储到S3兼容的对象存储中。存储路径规范为 `/{projectId}/{assetType}/{date}/{fileId}.{ext}`，例如 `/proj_abc/images/2026-04/asset_xyz.png`。上传流程：前端请求后端获取预签名上传URL → 前端直传到对象存储 → 上传完成后回调后端创建 Asset 记录。图片自动生成缩略图（使用 sharp 库）。视频自动提取首帧作为封面。设置合理的生命周期策略清理未被引用的临时文件。

### 6.3 错误处理与日志

所有 API 接口统一错误响应格式。AI 生成调用需要特别关注错误处理：API 限流、余额不足、内容审核不通过、超时等都需要有清晰的错误提示返回给前端。使用结构化日志（如 Winston + JSON格式），记录所有 AI API 调用的输入输出、耗时、token消耗、错误信息，便于后续分析成本和调优。

### 6.4 Monorepo 项目结构

```
/
├── apps/
│   ├── web/                  # Next.js 前端
│   │   ├── app/              # App Router 页面
│   │   ├── components/       # UI 组件
│   │   ├── hooks/            # 自定义 Hooks
│   │   ├── services/         # API 调用层
│   │   └── stores/           # Zustand 状态管理
│   │
│   └── server/               # NestJS 后端
│       ├── src/
│       │   ├── auth/         # 认证模块
│       │   ├── user/         # 用户模块
│       │   ├── project/      # 项目模块
│       │   ├── screenplay/   # 剧本模块
│       │   ├── storyboard/   # 分镜头模块
│       │   ├── world-bible/  # 世界观设定模块
│       │   ├── generation/   # AI 生成模块（含适配器）
│       │   ├── asset/        # 素材管理模块
│       │   ├── task/         # 任务队列模块
│       │   ├── audit/        # 审核模块
│       │   ├── timeline/     # 时间线模块
│       │   ├── export/       # 导出模块
│       │   ├── notification/ # 通知模块
│       │   ├── comment/      # 评论模块
│       │   ├── admin/        # 管理后台模块
│       │   └── common/       # 公共：守卫、拦截器、过滤器、管道
│       └── prisma/
│           └── schema.prisma
│
├── packages/
│   └── shared/               # 前后端共享
│       ├── types/            # TypeScript 类型定义
│       ├── constants/        # 共享常量（枚举值等）
│       └── utils/            # 共享工具函数
│
├── docker-compose.yml        # PostgreSQL + Redis + MinIO
├── turbo.json
└── package.json
```

### 6.5 部署架构

开发环境使用 Docker Compose 编排 PostgreSQL、Redis 和 MinIO。生产环境建议使用云服务商的托管数据库和对象存储以降低运维成本，应用服务部署到容器平台。后端需要至少两种进程类型：API Server 处理HTTP/WebSocket请求，Worker 处理 BullMQ 任务队列。两者可以独立扩缩容——当有大量生成任务时可以单独增加 Worker 实例。FFmpeg 导出任务对 CPU 和内存要求较高，建议 Worker 实例配置较高的计算资源，或者将导出任务拆分到专用的"导出Worker"上。

---

## 七、各阶段工期估算

第一阶段（基础平台与剧本引擎）预计 4-6 周，是全栈基础设施搭建最重的阶段，包含认证系统、项目CRUD、剧本编辑器、版本管理等基础功能。

第二阶段（分镜头与视觉生成）预计 4-5 周，世界观设定模块相对直接，主要复杂度在分镜头的结构化解析、PromptBuilder 和生图适配层。

第三阶段（视频生成、任务队列与审核流程）预计 5-6 周，异步任务系统和 WebSocket 实时通知是主要工程量，审核工作流逻辑也需要仔细处理状态流转。

第四阶段（时间线剪辑、音频与导出）预计 6-8 周，时间线编辑器是整个项目中前端最复杂的组件，FFmpeg 导出服务也需要大量调试。

以上估算基于 2-3 人的全栈团队。如果是单人开发，建议每个阶段的时间翻倍，并优先保证第一和第二阶段的质量。