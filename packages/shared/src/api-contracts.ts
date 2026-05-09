/**
 * @fileoverview API 请求/响应数据契约
 * @module shared/api-contracts
 *
 * 定义前后端之间通信的所有数据结构，包括：
 * - 会话与认证
 * - 团队与项目管理
 * - 文档与版本操作
 * - AI 任务与批量操作
 * - 通知、审核、时间线、导出
 * - 实时事件
 */

import type {
  AuditAction,
  AuditConfigRecord,
  AuditContentType,
  AuditRecordEntry,
  BatchJobGroupRecord,
  CharacterVoiceConfig,
  CommentRecord,
  DocumentRecord,
  DocumentType,
  ExportFormat,
  ExportRecord,
  GenerateScriptInput,
  GenerateStoryboardInput,
  GenerateSynopsisInput,
  GlobalRole,
  ImageConfigSource,
  ImageGenerationConfig,
  JobRecord,
  JobStatus,
  JobType,
  LlmConfigSource,
  LlmProviderConfig,
  NotificationRecord,
  NotificationType,
  ProjectRole,
  ProjectMemberRecord,
  ProjectRecord,
  ProjectStatus,
  ReviewPolicyMode,
  TeamInviteLinkRecord,
  TeamMemberRecord,
  TeamRecord,
  TeamRole,
  TimelineRecord,
  TimelineTrackRecord,
  UploadTarget,
  VersionRecord,
  VersionStatus,
  WorldBibleContent,
} from "./domain";

// =============================================
// 会话与认证
// =============================================

/** 会话中的用户摘要信息 */
export interface SessionUser {
  id: string;
  email: string;
  displayName: string;
  globalRole: GlobalRole;
}

/** 登录成功后返回的会话负载 */
export interface SessionPayload {
  user: SessionUser;
  accessToken: string;
  refreshToken: string;
  /** 访问令牌过期时间 */
  expiresAt: string;
}

// =============================================
// 团队管理
// =============================================

/** 团队成员摘要（包含用户显示信息） */
export interface TeamMemberSummary extends Pick<TeamMemberRecord, "id" | "userId" | "role" | "createdAt"> {
  displayName: string;
  email: string;
}

/** 项目成员摘要（包含用户显示信息） */
export interface ProjectMemberSummary extends Pick<ProjectMemberRecord, "id" | "userId" | "role" | "createdAt"> {
  displayName: string;
  email: string;
}

/** 审核队列中的版本摘要 */
export interface ReviewQueueVersionSummary extends Pick<VersionRecord, "id" | "title" | "status" | "versionNumber" | "createdAt"> {
  documentId: string;
  documentTitle: string;
  projectId: string;
  projectName: string;
}

/** 项目邀请摘要 */
export interface ProjectInviteSummary {
  id: string;
  projectId: string;
  projectName: string;
  email: string;
  role: ProjectRole;
  status: string;
  createdAt: string;
  createdBy: string;
}

/** 项目任务摘要（用于列表展示） */
export interface ProjectJobSummary extends Pick<JobRecord, "id" | "type" | "status" | "shotId" | "updatedAt" | "error" | "progress" | "batchId" | "retryCount"> {
  result?: Record<string, unknown>;
}

// =============================================
// 平台管理
// =============================================

/** 平台管理后台概览响应 */
export interface PlatformOverviewResponse {
  /** 各项指标 */
  metrics: {
    users: number;
    teams: number;
    projects: number;
    /** 排队中的任务数 */
    queuedJobs: number;
    /** 待审核版本数 */
    pendingReviewVersions: number;
  };
  /** 最近的任务列表 */
  recentJobs: Array<Pick<JobRecord, "id" | "type" | "status" | "updatedAt">>;
  /** 所有租户列表 */
  tenants: Array<Pick<TeamRecord, "id" | "name" | "slug">>;
  /** 当前存储驱动 */
  storageDriver: "local" | "s3";
}

/** 团队摘要（含当前用户角色和管理权限） */
export interface TeamSummary extends Pick<TeamRecord, "id" | "name" | "slug" | "defaultReviewPolicy" | "createdAt" | "updatedAt"> {
  /** 当前用户在该团队的角色，null 表示非成员 */
  currentUserRole: TeamRole | null;
  /** 当前用户是否有管理权限 */
  canManage: boolean;
}

/** 团队设置中的 LLM 配置摘要（隐藏 API 密钥） */
export interface TeamSettingsLlmConfig extends Pick<LlmProviderConfig, "provider" | "baseUrl" | "model" | "stream"> {
  /** 是否已配置 API 密钥 */
  hasApiKey: boolean;
}

/** 团队设置中的图片生成配置摘要（隐藏 API 密钥） */
export interface ImageGenerationSettingsConfig extends Pick<ImageGenerationConfig, "provider" | "baseUrl" | "model" | "sdConfig" | "comfyuiConfig" | "grokConfig"> {
  /** 是否已配置 API 密钥 */
  hasApiKey: boolean;
}

/** 团队设置响应（含 LLM 和图片生成配置） */
export interface TeamSettingsResponse extends TeamSummary {
  llmConfig?: TeamSettingsLlmConfig;
  imageGenerationConfig?: ImageGenerationSettingsConfig;
  imageProviders?: import("./domain").ProviderEntry[];
  videoProviders?: import("./domain").ProviderEntry[];
  defaultImageProvider?: string;
  defaultVideoProvider?: string;
}

/** 团队管理后台概览响应 */
export interface TeamAdminOverviewResponse {
  team: TeamSummary;
  members: TeamMemberSummary[];
  /** 团队下的项目列表（含成员数统计） */
  projects: Array<Pick<ProjectRecord, "id" | "name" | "description" | "reviewPolicyMode" | "createdAt" | "updatedAt"> & {
    memberCount: number;
  }>;
  /** 项目邀请列表 */
  projectInvites: ProjectInviteSummary[];
  /** 待审核版本列表 */
  pendingReviews: ReviewQueueVersionSummary[];
}

// =============================================
// 项目工作区
// =============================================

/** 项目工作区完整数据负载 */
export interface ProjectWorkspacePayload {
  team: Pick<TeamRecord, "id" | "name" | "defaultReviewPolicy">;
  project: Pick<ProjectRecord, "id" | "name" | "description" | "genre" | "coverUrl" | "status" | "reviewPolicyMode" | "createdAt" | "updatedAt">;
  members: ProjectMemberSummary[];
  invites: ProjectInviteSummary[];
  pendingReviews: ReviewQueueVersionSummary[];
  documents: Array<Pick<DocumentRecord, "id" | "projectId" | "type" | "title" | "shotId" | "currentVersionId" | "draftVersionId">>;
  versions: Array<Pick<VersionRecord, "id" | "documentId" | "versionNumber" | "status" | "title" | "content" | "metadata" | "parentVersionId" | "createdBy" | "createdAt">>;
  jobs: ProjectJobSummary[];
  /** 世界观设定内容 */
  worldBible?: WorldBibleContent;
  /** 审核配置列表 */
  auditConfigs?: AuditConfigResponse[];
  /** 时间线数据 */
  timeline?: TimelineRecord;
  /** 导出记录列表 */
  exports?: ExportRecord[];
}

/** 项目工作区简要负载（不含版本、任务、时间线、导出） */
export interface ProjectWorkspaceSummaryPayload extends Omit<ProjectWorkspacePayload, "versions" | "jobs" | "timeline" | "exports"> {}

/** 项目版本列表响应 */
export interface ProjectVersionsResponse {
  versions: Array<Pick<VersionRecord, "id" | "documentId" | "versionNumber" | "status" | "title" | "content" | "metadata" | "parentVersionId" | "createdBy" | "createdAt">>;
  total: number;
}

/** 创建版本请求体 */
export interface CreateVersionPayload {
  title: string;
  content: unknown;
  metadata?: Record<string, unknown>;
}

/** 恢复版本响应（新创建的 draft 版本摘要） */
export interface RestoreVersionResponse {
  version: Pick<VersionRecord, "id" | "documentId" | "versionNumber" | "status" | "title" | "createdAt">;
}

/** 采纳版本请求体 */
export interface AdoptVersionPayload {
  versionId: string;
}

/** 推进版本到审阅（submitted → pending_review）请求体 */
export interface AdvanceToReviewPayload {
  comment?: string;
}

/** 版本列表分页响应 */
export interface VersionListResponse {
  versions: Array<Pick<VersionRecord, "id" | "documentId" | "versionNumber" | "status" | "title" | "content" | "metadata" | "parentVersionId" | "createdBy" | "createdAt">>;
  total: number;
}

// =============================================
// 项目与团队创建/更新
// =============================================

/** 创建项目请求体 */
export interface ProjectCreationPayload {
  teamId: string;
  name: string;
  description?: string;
  genre?: string;
  coverUrl?: string;
  status?: ProjectStatus;
  reviewPolicyMode?: ReviewPolicyMode;
}

/** 更新项目请求体 */
export interface ProjectUpdatePayload {
  name?: string;
  description?: string;
  genre?: string;
  coverUrl?: string;
  status?: ProjectStatus;
  reviewPolicyMode?: ReviewPolicyMode;
}

/** 创建团队请求体 */
export interface TeamCreationPayload {
  name: string;
  slug?: string;
  defaultReviewPolicy?: Exclude<ReviewPolicyMode, "inherit">;
}

/** 添加团队成员请求体 */
export interface TeamMemberAssignmentPayload {
  email: string;
  role: TeamRole;
}

/** 更新团队设置请求体 */
export interface TeamSettingsUpdatePayload {
  name: string;
  defaultReviewPolicy: Exclude<ReviewPolicyMode, "inherit">;
  llmConfig?: LlmProviderConfig;
  imageGenerationConfig?: ImageGenerationConfig;
}

// =============================================
// LLM 模型管理
// =============================================

/** LLM 模型摘要 */
export interface LlmModelSummary {
  id: string;
  created?: number;
  ownedBy?: string;
}

/** 查询 LLM 模型列表请求体 */
export interface LlmModelListRequest {
  llmConfig?: LlmProviderConfig;
}

/** 查询 LLM 模型列表响应 */
export interface LlmModelListResponse {
  models: LlmModelSummary[];
}

// =============================================
// AI 任务创建
// =============================================

/** 创建图片生成任务请求体 */
export interface CreateImageJobPayload {
  projectId: string;
  style: string;
  aspectRatio: string;
  prompt?: string;
  referenceImageAssetId?: string;
  configSource?: ImageConfigSource;
}

/** 创建剧本生成任务请求体 */
export interface CreateScriptJobPayload extends GenerateScriptInput {
  llmConfigSource?: LlmConfigSource;
}

/** 创建大纲生成任务请求体 */
export interface CreateSynopsisJobPayload extends GenerateSynopsisInput {
  llmConfigSource?: LlmConfigSource;
}

/** 创建分镜生成任务请求体 */
export interface CreateStoryboardJobPayload extends GenerateStoryboardInput {
  llmConfigSource?: LlmConfigSource;
}

/** 添加项目成员请求体 */
export interface ProjectMemberAssignmentPayload {
  email: string;
  role: ProjectRole;
}

// =============================================
// 评论与审核操作
// =============================================

/** 创建评论请求体 */
export interface CommentCreationPayload {
  body: string;
  parentId?: string;
  anchorType: CommentRecord["anchorType"];
  anchorId?: string;
}

/** 审核版本请求体 */
export interface ReviewVersionPayload {
  comment?: string;
}

/** 采纳文档版本请求体 */
export interface DocumentVersionAdoptPayload {
  versionId: string;
}

// =============================================
// 上传
// =============================================

/** 上传目标响应 */
export interface UploadTargetResponse extends UploadTarget {}

// =============================================
// 团队邀请链接
// =============================================

/** 创建团队邀请链接请求体 */
export interface TeamInviteLinkCreatePayload {
  role: TeamRole;
  maxUses?: number;
  /** 过期时间（小时） */
  expiresInHours?: number;
}

/** 团队邀请链接摘要 */
export interface TeamInviteLinkSummary extends Pick<TeamInviteLinkRecord, "id" | "token" | "role" | "maxUses" | "uses" | "expiresAt" | "createdAt"> {
  createdByName: string;
}

/** 团队邀请链接详情响应（用于加入页面展示） */
export interface TeamInviteLinkInfoResponse {
  teamName: string;
  teamSlug: string;
  role: TeamRole;
  /** 是否已过期 */
  expired: boolean;
  /** 是否已用完 */
  exhausted: boolean;
}

// =============================================
// 世界观设定
// =============================================

/** 更新世界观设定请求体 */
export interface WorldBibleUpdatePayload {
  characters?: WorldBibleContent["characters"];
  locations?: WorldBibleContent["locations"];
  styleGuide?: WorldBibleContent["styleGuide"];
}

/** 创建角色请求体 */
export interface CharacterCreatePayload {
  name: string;
  appearance: string;
  personality?: string;
  tags?: string[];
  referenceImages?: string[];
  costumes?: Record<string, string>;
}

/** 创建场景地点请求体 */
export interface LocationCreatePayload {
  name: string;
  description: string;
  lighting?: string;
  timeOfDay?: string;
  referenceImages?: string[];
}

/** 更新风格指南请求体 */
export interface StyleGuideUpdatePayload {
  visualStyle: string;
  colorPalette?: string;
  compositionNote?: string;
  negativePrompt?: string;
  referenceImages?: string[];
}

/** 世界观参考图片生成请求 */
export interface WorldBibleReferenceImageGenerateRequest {
  prompt: string;
  configSource?: ImageConfigSource;
  /** 指定使用的 Provider ID（可选，未传则使用默认） */
  providerId?: string;
}

/** 世界观参考图片生成响应 */
export interface WorldBibleReferenceImageGenerateResponse {
  assetUrl: string;
}

// =============================================
// 提示词预览
// =============================================

/** 提示词预览请求 */
export interface PromptPreviewRequest {
  projectId: string;
  shotId: string;
  /** 自定义提示词（可选，不传则使用默认） */
  prompt?: string;
}

/** 提示词预览响应 */
export interface PromptPreviewResponse {
  positivePrompt: string;
  negativePrompt: string;
  shotId: string;
  injectedCharacters: string[];
  injectedLocation?: string;
  injectedStyle?: string;
}

// ===== 审核配置契约 =====

/** 审核配置响应 */
export interface AuditConfigResponse extends Pick<AuditConfigRecord, "id" | "projectId" | "contentType" | "reviewRequired" | "autoApproveRoles"> {}

/** 更新审核配置请求体 */
export interface AuditConfigUpdatePayload {
  reviewRequired: boolean;
  autoApproveRoles?: ProjectRole[];
}

/** 审核记录摘要（含审核人信息） */
export interface AuditRecordSummary extends Pick<AuditRecordEntry, "id" | "projectId" | "versionId" | "documentType" | "action" | "comment" | "createdAt"> {
  reviewerDisplayName: string;
  reviewerEmail: string;
}

// ===== 通知契约 =====

/** 通知摘要 */
export interface NotificationSummary extends Pick<NotificationRecord, "id" | "userId" | "projectId" | "type" | "title" | "body" | "referenceId" | "referenceType" | "isRead" | "createdAt"> {}

/** 通知列表查询参数 */
export interface NotificationListQuery {
  /** 是否只查未读 */
  unreadOnly?: boolean;
  limit?: number;
  offset?: number;
}

/** 未读通知计数响应 */
export interface UnreadCountResponse {
  count: number;
}

// ===== 任务与批量契约 =====

/** 任务列表查询参数 */
export interface TaskListQuery {
  status?: JobStatus;
  type?: JobType;
  batchId?: string;
  limit?: number;
  offset?: number;
}

/** 任务列表响应 */
export interface TaskListResponse {
  jobs: ProjectJobSummary[];
  total: number;
}

/** 批量图片生成请求 */
export interface BatchGenerateRequest {
  /** 要生成图片的镜头 ID 列表 */
  shotIds: string[];
}

/** 批量任务状态响应 */
export interface BatchJobStatusResponse extends Pick<BatchJobGroupRecord, "id" | "projectId" | "jobIds" | "status" | "createdAt"> {
  totalCount: number;
  completedCount: number;
  failedCount: number;
  runningCount: number;
}

// ===== TTS / 语音契约 =====

/** 语音信息 */
export interface VoiceInfo {
  id: string;
  name: string;
  provider: string;
  sampleUrl?: string;
}

/** 语音列表响应 */
export interface VoiceListResponse {
  voices: VoiceInfo[];
}

/** 更新角色语音配置请求体 */
export interface CharacterVoiceUpdatePayload {
  ttsProvider: string;
  voiceId: string;
  voiceName: string;
  settings?: { speed?: number; emotion?: string; volume?: number };
}

/** TTS 生成请求 */
export interface TTSGenerateRequest {
  shotId: string;
  characterId: string;
  text: string;
}

/** 批量 TTS 生成请求 */
export interface BatchTTSGenerateRequest {
  shotIds: string[];
}

/** 接受项目邀请响应 */
export interface ProjectInviteAcceptResponse {
  inviteId: string;
  projectId: string;
  projectName: string;
  role: ProjectRole;
  /** 是否已经是项目成员 */
  alreadyMember: boolean;
}

/** 待处理项目邀请列表响应 */
export interface PendingProjectInvitesResponse {
  invites: ProjectInviteSummary[];
}

// ===== 实时事件契约 =====

/** 实时订阅项目频道负载 */
export interface RealtimeProjectSubscriptionPayload {
  projectId: string;
}

/** 实时任务更新事件 */
export interface RealtimeJobUpdatedEvent {
  projectId: string;
  job: ProjectJobSummary;
}

/** 实时审核更新事件 */
export interface RealtimeReviewUpdatedEvent {
  projectId: string;
  versionId: string;
  documentId: string;
  status?: VersionRecord["status"];
  action: AuditAction | "comment_added" | "comment_reply";
  commentId?: string;
  parentId?: string;
}

/** 实时通知创建事件 */
export interface RealtimeNotificationCreatedEvent {
  notification: NotificationSummary;
  unreadCount: number;
}

// ===== 时间线契约 =====

/** 时间线响应 */
export interface TimelineResponse extends TimelineRecord {}

/** 保存时间线请求体 */
export interface TimelineSavePayload {
  duration: number;
  fps: number;
  resolution: string;
  tracks: TimelineTrackRecord[];
}

// ===== 导出契约 =====

/** 创建导出请求体 */
export interface ExportRequest {
  resolution: string;
  fps: number;
  bitrate?: string;
  format: ExportFormat;
}

/** 导出响应 */
export interface ExportResponse extends ExportRecord {}

/** 导出列表响应 */
export interface ExportListResponse {
  exports: ExportRecord[];
}
