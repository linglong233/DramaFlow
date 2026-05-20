/**
 * @fileoverview DramaFlow 核心领域类型定义
 * @module shared/domain
 *
 * 定义了平台所有核心数据模型，包括：
 * - 角色与权限枚举
 * - 项目、文档、版本等业务实体
 * - AI 任务相关的输入/输出结构
 * - 世界观设定（World Bible）数据模型
 * - 时间线与导出相关结构
 *
 * 本文件是前端、后端、Worker 之间的共享契约层基础。
 */

// =============================================
// 角色与权限枚举
// =============================================

/** 全局角色：平台超级管理员 或 普通用户 */
export type GlobalRole = "platform_super_admin" | "user";

/** 团队角色：团队拥有者、团队管理员、普通成员 */
export type TeamRole = "tenant_owner" | "tenant_admin" | "member";

/** 项目角色：项目管理员、导演、编剧、美术、审核人、只读观察者 */
export type ProjectRole =
  | "project_admin"
  | "director"
  | "writer"
  | "artist"
  | "reviewer"
  | "viewer";

/** 审核策略模式：inherit 继承团队默认、required 强制审核、bypass 跳过审核 */
export type ReviewPolicyMode = "inherit" | "required" | "bypass";

// =============================================
// 项目与文档枚举
// =============================================

/** 项目状态：草稿、进行中、已完成、已归档 */
export type ProjectStatus = "draft" | "in_progress" | "completed" | "archived";

/** 文档类型：大纲、剧本、分镜、图片、视频、音频、世界观设定 */
export type DocumentType = "synopsis" | "script" | "storyboard" | "image" | "video" | "audio" | "subtitle" | "world_bible";

/** 版本状态：草稿、已提交、待审核、已批准、已拒绝 */
export type VersionStatus =
  | "draft"
  | "submitted"
  | "pending_review"
  | "approved"
  | "rejected";

/** 评论锚点类型：关联到文档、场景、镜头 或 资产 */
export type AnchorType = "document" | "scene" | "shot" | "asset";

// =============================================
// 任务与队列枚举
// =============================================

/** AI 任务类型 */
export type JobType =
  | "script_generation"
  | "synopsis_generation"
  | "storyboard_generation"
  | "image_generation"
  | "video_generation"
  | "rewrite_segment"
  | "tts_generation"
  | "export_video"
  | "shot_regenerate"
  | "novel_import";

/** 任务执行状态 */
export type JobStatus = "queued" | "running" | "completed" | "failed";

/** 任务优先级 */
export type JobPriority = "low" | "normal" | "high";

// =============================================
// 审核与轨道枚举
// =============================================

/** 审核内容类型：剧本、分镜、图片、视频 */
export type AuditContentType = "script" | "storyboard" | "image" | "video";

/** 审核动作：提交审核、推进审阅、批准、拒绝、采纳、恢复、删除 */
export type AuditAction = "submitted" | "advanced" | "approved" | "rejected" | "adopted" | "restored" | "deleted";

/** 时间线轨道类型：视频、对白、音乐、音效、字幕 */
export type TrackType = "video" | "dialogue" | "music" | "sfx" | "subtitle";

/** 转场类型 */
export type TransitionType = "none" | "fade" | "dissolve" | "wipe";

/** 导出格式 */
export type ExportFormat = "mp4" | "mov" | "webm";

/** 导出状态 */
export type ExportStatus = "pending" | "processing" | "completed" | "failed";

// =============================================
// AI 配置枚举
// =============================================

/** LLM 配置来源：使用团队配置 或 个人配置 */
export type LlmConfigSource = "team" | "personal";

/** 图片生成 Provider 类型 */
export type ImageGenerationProvider = "google-gemini" | "openai-compatible" | "stable-diffusion" | "comfyui" | "grok";

/** 视频生成 Provider 类型 */
export type VideoGenerationProvider = "grok" | "openai-compatible";

/** 图片配置来源（与 LLM 配置来源一致） */
export type ImageConfigSource = LlmConfigSource;

// =============================================
// 通知枚举
// =============================================

/** 通知类型 */
export type NotificationType =
  | "task_completed"
  | "task_failed"
  | "review_submitted"
  | "review_approved"
  | "review_rejected"
  | "comment_added"
  | "comment_reply"
  | "member_invited";

// =============================================
// AI 配置接口
// =============================================

/** LLM Provider 连接配置 */
export interface LlmProviderConfig {
  /** Provider 标识（如 "openai-completions"） */
  provider: string;
  /** API 密钥 */
  apiKey?: string;
  /** API 基础 URL */
  baseUrl?: string;
  /** 模型名称 */
  model?: string;
  /** 是否启用流式输出 */
  stream?: boolean;
}

/** Stable Diffusion WebUI 配置 */
export interface SdWebuiConfig {
  /** 采样器名称 */
  samplerName?: string;
  /** 采样步数 */
  steps?: number;
  /** CFG 引导系数 */
  cfgScale?: number;
  /** 图片宽度 */
  width?: number;
  /** 图片高度 */
  height?: number;
  /** SD 模型检查点名称 */
  sdModelCheckpoint?: string;
  /** CLIP Skip 层数 */
  clipSkip?: number;
}

/** ComfyUI 工作流配置 */
export interface ComfyuiConfig {
  /** ComfyUI 工作流 JSON */
  workflowJson?: string;
  /** 采样器名称 */
  samplerName?: string;
  /** 采样步数 */
  steps?: number;
  /** CFG 引导系数 */
  cfgScale?: number;
  /** 图片宽度 */
  width?: number;
  /** 图片高度 */
  height?: number;
  /** 检查点名称 */
  checkpointName?: string;
}

/** Grok (grok2api) 图片/视频生成配置 */
export interface GrokConfig {
  /** 图片生成模型（默认 grok-imagine-1.0） */
  model?: string;
  /** 视频生成模型（默认 grok-imagine-1.0-video） */
  videoModel?: string;
  /** 画面宽高比：16:9 | 9:16 | 1:1 | 2:3 | 3:2 */
  aspectRatio?: string;
  /** 视频时长（5-15 秒，默认 6） */
  videoLength?: number;
  /** 视频分辨率：SD | HD */
  resolution?: "SD" | "HD";
}

/** 图片生成配置（统一封装各 Provider 的参数） */
export interface ImageGenerationConfig {
  /** 图片生成 Provider 类型 */
  provider: ImageGenerationProvider;
  /** API 密钥 */
  apiKey?: string;
  /** API 基础 URL */
  baseUrl?: string;
  /** 模型名称 */
  model?: string;
  /** Stable Diffusion WebUI 专用配置 */
  sdConfig?: SdWebuiConfig;
  /** ComfyUI 专用配置 */
  comfyuiConfig?: ComfyuiConfig;
  /** Grok (grok2api) 专用配置 */
  grokConfig?: GrokConfig;
}

/** Provider 配置条目（用于多 provider 管理） */
export interface ProviderEntry {
  /** 唯一标识 */
  id: string;
  /** Provider 类型 */
  provider: ImageGenerationProvider | VideoGenerationProvider;
  /** 用户自定义名称 */
  name?: string;
  /** API 密钥 */
  apiKey?: string;
  /** API 基础 URL */
  baseUrl?: string;
  /** 模型名称 */
  model?: string;
  /** Stable Diffusion WebUI 专用配置 */
  sdConfig?: SdWebuiConfig;
  /** ComfyUI 专用配置 */
  comfyuiConfig?: ComfyuiConfig;
  /** Grok (grok2api) 专用配置 */
  grokConfig?: GrokConfig;
}

// =============================================
// 核心业务实体
// =============================================

/** 用户记录 */
export interface UserRecord {
  id: string;
  email: string;
  /** 用户显示名称 */
  displayName: string;
  /** 密码哈希值（argon2） */
  passwordHash: string;
  /** 全局角色 */
  globalRole: GlobalRole;
  /** 用户个人 LLM 配置 */
  llmConfig?: LlmProviderConfig;
  /** @deprecated 使用 imageProviders + defaultImageProvider 替代 */
  imageGenerationConfig?: ImageGenerationConfig;
  /** 用户配置的图片 Provider 列表 */
  imageProviders?: ProviderEntry[];
  /** 用户配置的视频 Provider 列表 */
  videoProviders?: ProviderEntry[];
  /** 默认图片 Provider ID（指向 imageProviders 中某项） */
  defaultImageProvider?: string;
  /** 默认视频 Provider ID（指向 videoProviders 中某项） */
  defaultVideoProvider?: string;
  createdAt: string;
  updatedAt: string;
}

/** 刷新令牌记录 */
export interface RefreshTokenRecord {
  id: string;
  userId: string;
  /** 令牌哈希值 */
  tokenHash: string;
  /** 过期时间 */
  expiresAt: string;
  createdAt: string;
}

/** 团队记录 */
export interface TeamRecord {
  id: string;
  name: string;
  /** 团队 URL 标识（唯一） */
  slug: string;
  /** 团队默认审核策略（不可设为 inherit） */
  defaultReviewPolicy: Exclude<ReviewPolicyMode, "inherit">;
  /** 创建者用户 ID */
  createdBy: string;
  /** 团队级 LLM 配置 */
  llmConfig?: LlmProviderConfig;
  /** @deprecated 使用 imageProviders + defaultImageProvider 替代 */
  imageGenerationConfig?: ImageGenerationConfig;
  /** 团队配置的图片 Provider 列表 */
  imageProviders?: ProviderEntry[];
  /** 团队配置的视频 Provider 列表 */
  videoProviders?: ProviderEntry[];
  /** 默认图片 Provider ID（指向 imageProviders 中某项） */
  defaultImageProvider?: string;
  /** 默认视频 Provider ID（指向 videoProviders 中某项） */
  defaultVideoProvider?: string;
  createdAt: string;
  updatedAt: string;
}
export interface TeamMemberRecord {
  id: string;
  teamId: string;
  userId: string;
  /** 该成员在团队中的角色 */
  role: TeamRole;
  createdAt: string;
}

/** 团队邀请链接记录 */
export interface TeamInviteLinkRecord {
  id: string;
  teamId: string;
  /** 邀请令牌（URL 中使用） */
  token: string;
  /** 受邀者被分配的角色 */
  role: TeamRole;
  /** 最大使用次数 */
  maxUses: number;
  /** 已使用次数 */
  uses: number;
  /** 过期时间，null 表示永不过期 */
  expiresAt: string | null;
  /** 创建者用户 ID */
  createdBy: string;
  createdAt: string;
}

/** 项目记录 */
export interface ProjectRecord {
  id: string;
  /** 所属团队 ID */
  teamId: string;
  name: string;
  description: string;
  /** 项目类型/题材 */
  genre?: string;
  /** 封面图 URL */
  coverUrl?: string;
  status: ProjectStatus;
  /** 项目级审核策略（可继承团队默认） */
  reviewPolicyMode: ReviewPolicyMode;
  /** 创建者用户 ID */
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

/** 项目成员记录 */
export interface ProjectMemberRecord {
  id: string;
  projectId: string;
  userId: string;
  /** 该成员在项目中的角色 */
  role: ProjectRole;
  createdAt: string;
}

/** 文档记录 */
export interface DocumentRecord {
  id: string;
  projectId: string;
  /** 文档类型 */
  type: DocumentType;
  title: string;
  /** 关联的镜头 ID（仅媒体类文档使用） */
  shotId?: string;
  /** 当前采纳的基线版本 ID（仅 adopt 时更新） */
  currentVersionId?: string;
  /** 当前工作草稿版本 ID（每次创建版本时更新） */
  draftVersionId?: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

/** 版本记录（泛型 TContent 对应不同文档类型的内容结构） */
export interface VersionRecord<TContent = unknown> {
  id: string;
  documentId: string;
  /** 版本号（递增） */
  versionNumber: number;
  status: VersionStatus;
  title: string;
  /** 版本内容（ScriptContent / StoryboardContent / MediaContent 等） */
  content: TContent;
  /** 版本元数据 */
  metadata: Record<string, unknown>;
  /** 父版本 ID（用于版本分支） */
  parentVersionId?: string;
  createdBy: string;
  createdAt: string;
}

/** 评论记录 */
export interface CommentRecord {
  id: string;
  /** 关联的版本 ID */
  versionId: string;
  /** 评论作者用户 ID */
  authorId: string;
  /** 评论内容 */
  body: string;
  /** 父评论 ID（用于回复嵌套） */
  parentId?: string;
  /** 评论锚点类型 */
  anchorType: AnchorType;
  /** 评论锚点目标 ID */
  anchorId?: string;
  /** 是否已解决 */
  resolved: boolean;
  createdAt: string;
  updatedAt: string;
}

/** AI 任务记录（泛型 TInput 和 TResult 对应不同任务类型的输入/输出结构） */
export interface JobRecord<TInput = Record<string, unknown>, TResult = Record<string, unknown>> {
  id: string;
  type: JobType;
  status: JobStatus;
  projectId: string;
  documentId?: string;
  /** 关联的镜头 ID */
  shotId?: string;
  /** 任务输入参数 */
  input: TInput;
  /** 任务执行结果 */
  result?: TResult;
  /** 失败时的错误信息 */
  error?: string;
  /** 执行进度（0-100） */
  progress?: number;
  /** 已重试次数 */
  retryCount?: number;
  /** 最大重试次数 */
  maxRetries?: number;
  priority?: JobPriority;
  /** 取消时间 */
  cancelledAt?: string;
  /** 批量任务组 ID */
  batchId?: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

/** 上传资产记录 */
export interface UploadAssetRecord {
  id: string;
  projectId: string;
  documentId?: string;
  versionId?: string;
  /** 存储驱动类型 */
  storageDriver: "local" | "s3";
  /** 存储键名 */
  storageKey: string;
  /** 公开访问 URL */
  publicUrl?: string;
  mimeType: string;
  /** 文件大小（字节） */
  sizeInBytes: number;
  createdBy: string;
  createdAt: string;
}

// =============================================
// 剧本内容结构
// =============================================

/** 剧本场景 */
export interface ScriptScene {
  id: string;
  /** 场景标题 */
  heading: string;
  /** 场景简介 */
  synopsis: string;
  /** 出场角色列表 */
  characters: string[];
  /** 对白列表 */
  dialogue: Array<{
    /** 说话人 */
    speaker: string;
    /** 台词 */
    line: string;
  }>;
  /** 导演备注 */
  directorNote?: string;
  /** 关联的场景地点 ID */
  locationId?: string;
}

/** 剧本内容（VersionRecord 的 content 泛型参数） */
export interface ScriptContent {
  /** 一句话故事梗概 */
  logline: string;
  /** 故事前提 */
  premise: string;
  /** 角色列表 */
  characters: Array<{
    name: string;
    /** 角色简介 */
    profile: string;
    /** 世界观设定中对应角色的 ID */
    worldBibleCharId?: string;
  }>;
  /** 场景列表 */
  scenes: ScriptScene[];
}

// =============================================
// 分镜内容结构
// =============================================

/** 分镜镜头 */
export interface StoryboardShot {
  id: string;
  /** 所属场景 ID */
  sceneId: string;
  /** 镜头编号标签 */
  shotLabel: string;
  /** 景别（如 CU、MS、LS） */
  framing: string;
  /** 运镜方式（如 static、pan-left、dolly-in） */
  cameraMove: string;
  /** 镜头时长（秒） */
  durationSeconds: number;
  /** 画面描述 */
  visualDescription: string;
  /** 动作描述 */
  actionDescription?: string;
  /** 对白内容 */
  dialogue?: string;
  /** 音效设计 */
  soundDesign?: string;
  /** 备注 */
  notes?: string;
  /** 图片生成提示词 */
  imagePrompt?: string;
  /** 视频生成提示词 */
  videoPrompt?: string;
  /** 出场角色 ID 列表 */
  characterIds?: string[];
}

/** 镜头媒体绑定（记录镜头与媒体版本、字幕的关联） */
export interface ShotMediaBinding {
  imageVersionId?: string;
  videoVersionId?: string;
  audioVersionId?: string;
  subtitle?: string;
}

/** 分镜内容（VersionRecord 的 content 泛型参数） */
export interface StoryboardContent {
  /** 分镜总览 */
  overview: string;
  /** 镜头列表 */
  shots: StoryboardShot[];
  /** 每个镜头的媒体版本引用 */
  mediaBindings: Record<string, ShotMediaBinding>;
  /** 旧 shotId → 新 shotId 的映射（AI 重新生成时产出） */
  shotIdMappings?: Record<string, string>;
}

// =============================================
// 媒体内容结构
// =============================================

/** 媒体内容（图片/视频生成结果） */
export interface MediaContent {
  /** 生成提示词 */
  prompt: string;
  /** 关联的资产 ID */
  assetId?: string;
  /** 资产访问 URL */
  assetUrl?: string;
  /** 使用的 Provider 标识 */
  provider: string;
  /** 使用的模型名称 */
  model?: string;
  mimeType: string;
  /** 生成参数 */
  parameters: Record<string, unknown>;
  /** Provider 端视频 ID（用于异步视频生成轮询） */
  providerVideoId?: string;
  /** Provider 端状态 */
  providerStatus?: string;
  /** 生成进度 */
  progress?: number;
  /** 运行模式：真实 Provider 或 Mock */
  mode?: "provider" | "mock";
  /** 备注 */
  note?: string;
  /** 使用的配置来源 */
  configSource?: ImageConfigSource;
}

// =============================================
// 上传与存储
// =============================================

/** 上传目标描述（前端据此发起直传请求） */
export interface UploadTarget {
  /** 存储驱动 */
  driver: "local" | "s3";
  /** 存储键名 */
  key: string;
  /** HTTP 方法 */
  method: "PUT" | "POST";
  /** 上传 URL */
  url: string;
  /** 请求头 */
  headers: Record<string, string>;
  /** 表单字段（S3 预签名 POST 需要） */
  fields?: Record<string, string>;
  /** 上传后的公开访问 URL */
  publicUrl?: string;
}

// =============================================
// AI 生成任务输入
// =============================================

/** 剧本生成输入参数 */
export interface GenerateScriptInput {
  /** 标题 */
  title: string;
  /** 题材/类型 */
  genre: string;
  /** 故事前提 */
  premise: string;
  /** 本集目标 */
  episodeGoal: string;
  /** 风格基调 */
  tone: string;
  /** 目标受众 */
  audience: string;
  /** 关联的大纲版本 ID（可选，用于注入大纲上下文） */
  sourceSynopsisVersionId?: string;
}

/** 大纲生成输入参数 */
export interface GenerateSynopsisInput {
  title: string;
  genre: string;
  /** 主题 */
  theme: string;
  /** 关键词列表 */
  keywords: string[];
  /** 集数 */
  episodeCount: number;
  /** 创作约束 */
  constraints?: string;
}

/** 片段改写输入参数 */
export interface RewriteSegmentInput {
  /** 原始文本 */
  originalText: string;
  /** 改写指令 */
  instruction: string;
  /** 上下文 */
  context?: string;
  /** 关联的文档 ID */
  documentId: string;
}

/** 分镜生成输入参数 */
export interface GenerateStoryboardInput {
  /** 源剧本文档 ID */
  documentId: string;
  /** 源剧本版本 ID */
  versionId: string;
  /** 电影风格 */
  cinematicStyle: string;
  /** 镜头密度：稀疏、平衡、密集 */
  shotDensity: "sparse" | "balanced" | "dense";
}

/** 小说导入输入参数 */
export interface NovelImportInput {
  /** 小说全文 */
  text: string;
  /** LLM 配置来源 */
  llmConfigSource?: LlmConfigSource;
}

/** 小说导入状态 */
export type NovelImportStatus =
  | "draft"
  | "queued"
  | "running"
  | "needs_review"
  | "failed"
  | "cancelled"
  | "written";

/** 小说导入阶段 */
export type NovelImportStage =
  | "setup"
  | "chunking"
  | "adaptationPlan"
  | "worldBible"
  | "synopsis"
  | "script"
  | "review"
  | "write";

/** 小说导入分块状态 */
export type NovelImportChunkStatus =
  | "pending"
  | "running"
  | "completed"
  | "failed"
  | "stale";

/** 小说导入参数 */
export interface NovelImportOptions {
  targetEpisodeCount: number;
  episodeDurationMinutes: number;
  genreStyle: string;
  adaptationFocus: string;
  llmConfigSource?: LlmConfigSource;
}

/** 小说导入分块记录 */
export interface NovelImportChunkRecord {
  index: number;
  title?: string;
  text: string;
  status: NovelImportChunkStatus;
  summary?: string;
  continuityNotes?: string;
  scenes: ScriptScene[];
  rawOutput?: string;
  error?: string;
  startedAt?: string;
  completedAt?: string;
}

/** 小说导入写入结果 */
export interface NovelImportWriteResult {
  worldBibleDocumentId: string;
  worldBibleVersionId: string;
  synopsisDocumentId: string;
  synopsisVersionId: string;
  scriptDocumentId: string;
  scriptVersionId: string;
  writtenAt: string;
}

/** 小说导入会话 */
export interface NovelImportSession {
  id: string;
  projectId: string;
  createdBy: string;
  status: NovelImportStatus;
  stage: NovelImportStage;
  progress: number;
  sourceText: string;
  options: NovelImportOptions;
  chunks: NovelImportChunkRecord[];
  adaptationPlan?: string;
  worldBible?: WorldBibleContent;
  synopsis?: string;
  scriptPreview?: ScriptContent;
  writeResult?: NovelImportWriteResult;
  lastJobId?: string;
  error?: string;
  createdAt: string;
  updatedAt: string;
}

/** 小说导入后台任务输入 */
export type NovelImportJobInput =
  | { action: "runSession"; sessionId: string }
  | { action: "retryChunk"; sessionId: string; chunkIndex: number }
  | { action: "rerunFromChunk"; sessionId: string; chunkIndex: number };

/** 媒体（图片/视频）生成输入参数 */
export interface GenerateMediaInput {
  /** 目标镜头 ID */
  shotId: string;
  /** 视觉风格 */
  style: string;
  /** 画面比例 */
  aspectRatio: string;
  /** 视频时长（秒） */
  durationSeconds?: number;
  /** 参考图片资产 ID */
  referenceImageAssetId?: string;
  /** 指定使用的 Provider ID（可选，未传则使用默认） */
  providerId?: string;
}

// =============================================
// 权限上下文
// =============================================

/** 访问权限上下文（用于业务规则判断） */
export interface AccessContext {
  userId: string;
  globalRole: GlobalRole;
  /** 用户在相关团队中的角色列表 */
  teamRoles: TeamRole[];
  /** 用户在相关项目中的角色列表 */
  projectRoles: ProjectRole[];
}

/** 项目摘要（包含项目信息、文档列表和成员列表） */
export interface ProjectSummary {
  project: ProjectRecord;
  documents: DocumentRecord[];
  members: ProjectMemberRecord[];
}

// =============================================
// 世界观设定（World Bible）
// =============================================

/** 角色档案 */
export interface CharacterProfile {
  id: string;
  name: string;
  /** 外貌描述 */
  appearance: string;
  /** 性格描述 */
  personality?: string;
  /** 标签列表 */
  tags: string[];
  /** 参考图片 URL 列表 */
  referenceImages: string[];
  /** 服装信息（键为服装名称，值为描述） */
  costumes?: Record<string, string>;
  /** 角色简介，与剧本角色的 profile 双向同步 */
  summary?: string;
  /** 排序序号 */
  sortOrder: number;
}

/** 场景地点档案 */
export interface LocationProfile {
  id: string;
  name: string;
  description: string;
  /** 光照条件 */
  lighting?: string;
  /** 时间段 */
  timeOfDay?: string;
  /** 参考图片 URL 列表 */
  referenceImages: string[];
  /** 排序序号 */
  sortOrder: number;
}

/** 视觉风格指南 */
export interface StyleGuideProfile {
  /** 视觉风格描述 */
  visualStyle: string;
  /** 色彩方案 */
  colorPalette?: string;
  /** 构图备注 */
  compositionNote?: string;
  /** 负面提示词（生成时应避免的元素） */
  negativePrompt?: string;
  /** 参考图片 URL 列表 */
  referenceImages: string[];
}

/** 角色语音配置 */
export interface CharacterVoiceConfig {
  /** 关联的角色 ID */
  characterId: string;
  /** TTS Provider 标识 */
  ttsProvider: string;
  /** 语音 ID */
  voiceId: string;
  /** 语音名称 */
  voiceName: string;
  /** 试听 URL */
  sampleUrl?: string;
  /** 语音参数 */
  settings?: {
    /** 语速 */
    speed?: number;
    /** 情感 */
    emotion?: string;
    /** 音量 */
    volume?: number;
  };
}

/** 世界观设定内容 */
export interface WorldBibleContent {
  /** 角色档案列表 */
  characters: CharacterProfile[];
  /** 场景地点列表 */
  locations: LocationProfile[];
  /** 视觉风格指南 */
  styleGuide?: StyleGuideProfile;
  /** 角色语音配置列表 */
  voiceConfigs?: CharacterVoiceConfig[];
}

// =============================================
// 提示词预览
// =============================================

/** 提示词预览结果（用于在生成前预览最终拼装的提示词） */
export interface PromptPreviewResult {
  /** 正面提示词 */
  positivePrompt: string;
  /** 负面提示词 */
  negativePrompt: string;
  /** 目标镜头 ID */
  shotId: string;
  /** 已注入的角色名称列表 */
  injectedCharacters: string[];
  /** 已注入的场景地点 */
  injectedLocation?: string;
  /** 已注入的风格描述 */
  injectedStyle?: string;
}

// =============================================
// 审核配置与记录
// =============================================

/** 审核配置记录（每种内容类型独立配置） */
export interface AuditConfigRecord {
  id: string;
  projectId: string;
  /** 审核的内容类型 */
  contentType: AuditContentType;
  /** 是否需要审核 */
  reviewRequired: boolean;
  /** 可自动通过审核的角色列表 */
  autoApproveRoles: ProjectRole[];
  createdAt: string;
  updatedAt: string;
}

/** 审核记录条目 */
export interface AuditRecordEntry {
  id: string;
  projectId: string;
  /** 审核的版本 ID */
  versionId: string;
  /** 文档类型 */
  documentType: DocumentType;
  /** 审核动作 */
  action: AuditAction;
  /** 审核人用户 ID */
  reviewerId: string;
  /** 审核意见 */
  comment?: string;
  createdAt: string;
}

// =============================================
// 通知
// =============================================

/** 通知记录 */
export interface NotificationRecord {
  id: string;
  /** 通知接收者用户 ID */
  userId: string;
  /** 关联的项目 ID */
  projectId?: string;
  type: NotificationType;
  title: string;
  body: string;
  /** 引用目标 ID */
  referenceId?: string;
  /** 引用目标类型 */
  referenceType?: "job" | "version" | "comment";
  /** 是否已读 */
  isRead: boolean;
  createdAt: string;
}

// =============================================
// 批量任务
// =============================================

/** 批量任务状态：运行中、全部完成、部分失败 */
export type BatchJobStatus = "running" | "completed" | "partial_failure";

/** 批量任务组记录 */
export interface BatchJobGroupRecord {
  id: string;
  projectId: string;
  /** 包含的子任务 ID 列表 */
  jobIds: string[];
  status: BatchJobStatus;
  createdBy: string;
  createdAt: string;
}

// =============================================
// 时间线
// =============================================

/** 时间线片段（轨道中的单个素材片段） */
export interface TimelineClipRecord {
  id: string;
  /** 关联的资产 ID */
  assetId?: string;
  /** 资产 URL */
  assetUrl?: string;
  /** 在时间线上的起始时间（秒） */
  startTime: number;
  /** 片段时长（秒） */
  duration: number;
  /** 素材入点（秒） */
  inPoint: number;
  /** 素材出点（秒） */
  outPoint?: number;
  /** 字幕文本 */
  subtitleText?: string;
  /** 字幕样式 */
  subtitleStyle?: Record<string, unknown>;
  /** 入场转场类型 */
  transitionIn?: TransitionType;
  /** 出场转场类型 */
  transitionOut?: TransitionType;
  /** 转场时长（秒） */
  transitionDuration?: number;
  /** 排序序号 */
  sortOrder: number;
  /** 片段标签 */
  label?: string;
  /** 关联的镜头 ID */
  shotId?: string;
}

/** 时间线轨道 */
export interface TimelineTrackRecord {
  id: string;
  /** 轨道类型 */
  type: TrackType;
  /** 轨道名称 */
  name: string;
  /** 排序序号 */
  sortOrder: number;
  /** 是否静音 */
  isMuted: boolean;
  /** 音量（0-1） */
  volume: number;
  /** 轨道中的片段列表 */
  clips: TimelineClipRecord[];
}

/** 时间线记录 */
export interface TimelineRecord {
  id: string;
  projectId: string;
  /** 总时长（秒） */
  duration: number;
  /** 帧率 */
  fps: number;
  /** 分辨率（如 "1920x1080"） */
  resolution: string;
  /** 轨道列表 */
  tracks: TimelineTrackRecord[];
  createdAt: string;
  updatedAt: string;
}

// =============================================
// 导出
// =============================================

/** 导出记录 */
export interface ExportRecord {
  id: string;
  projectId: string;
  /** 关联的导出任务 ID */
  taskId: string;
  /** 输出分辨率 */
  resolution: string;
  /** 输出帧率 */
  fps: number;
  /** 输出比特率 */
  bitrate?: string;
  /** 输出格式 */
  format: ExportFormat;
  /** 输出文件 URL */
  outputUrl?: string;
  /** 文件大小（字节） */
  fileSize?: number;
  /** 视频时长（秒） */
  duration?: number;
  status: ExportStatus;
  createdBy: string;
  createdAt: string;
  /** 完成时间 */
  completedAt?: string;
}

// =============================================
// 对话式生成
// =============================================

/** 对话式生成的 QA 维度 */
export type ConversationDimension =
  | "coreConflict"
  | "protagonist"
  | "supportingChars"
  | "tone"
  | "pacing"
  | "constraints";

/** 维度状态 */
export type ConversationDimensionStatus = "pending" | "discussing" | "confirmed";

/** 对话消息 */
export interface ConversationMessage {
  role: "ai" | "user";
  content: string;
}

/** 对话简报（AI 从对话中提炼的结构化摘要） */
export interface ConversationBrief {
  coreConflict?: string;
  protagonist?: string;
  supportingChars?: string;
  tone?: string;
  pacing?: string;
  constraints?: string;
}

/** 对话会话 */
export interface ConversationSession {
  id: string;
  projectId: string;
  messages: ConversationMessage[];
  brief: ConversationBrief;
  dimensionStatus: Record<ConversationDimension, ConversationDimensionStatus>;
  targetDocType: "synopsis" | "script";
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

// =============================================
// TTS 与导出任务输入
// =============================================

/** TTS（语音合成）生成输入参数 */
export interface GenerateTTSInput {
  /** 目标镜头 ID */
  shotId: string;
  /** 角色 ID（用于确定语音） */
  characterId: string;
  /** 要合成的文本 */
  text: string;
  projectId: string;
  configSource?: ImageConfigSource;
}

/** 时间线导出输入参数 */
export interface ExportTimelineInput {
  projectId: string;
  /** 输出分辨率 */
  resolution: string;
  /** 输出帧率 */
  fps: number;
  /** 输出比特率 */
  bitrate?: string;
  /** 输出格式 */
  format: ExportFormat;
  /** 是否允许在无 FFmpeg 时使用 Mock 降级 */
  allowMockFallback?: boolean;
}