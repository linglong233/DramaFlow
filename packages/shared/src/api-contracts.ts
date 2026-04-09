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
  WorldBibleContent,
} from "./domain";

export interface SessionUser {
  id: string;
  email: string;
  displayName: string;
  globalRole: GlobalRole;
}

export interface SessionPayload {
  user: SessionUser;
  accessToken: string;
  refreshToken: string;
  expiresAt: string;
}

export interface TeamMemberSummary extends Pick<TeamMemberRecord, "id" | "userId" | "role" | "createdAt"> {
  displayName: string;
  email: string;
}

export interface ProjectMemberSummary extends Pick<ProjectMemberRecord, "id" | "userId" | "role" | "createdAt"> {
  displayName: string;
  email: string;
}

export interface ReviewQueueVersionSummary extends Pick<VersionRecord, "id" | "title" | "status" | "versionNumber" | "createdAt"> {
  documentId: string;
  documentTitle: string;
  projectId: string;
  projectName: string;
}

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

export interface ProjectJobSummary extends Pick<JobRecord, "id" | "type" | "status" | "shotId" | "updatedAt" | "error" | "progress" | "batchId" | "retryCount"> {
  result?: Record<string, unknown>;
}

export interface PlatformOverviewResponse {
  metrics: {
    users: number;
    teams: number;
    projects: number;
    queuedJobs: number;
    pendingReviewVersions: number;
  };
  recentJobs: Array<Pick<JobRecord, "id" | "type" | "status" | "updatedAt">>;
  tenants: Array<Pick<TeamRecord, "id" | "name" | "slug">>;
  storageDriver: "local" | "s3";
}

export interface TeamSummary extends Pick<TeamRecord, "id" | "name" | "slug" | "defaultReviewPolicy" | "createdAt" | "updatedAt"> {
  currentUserRole: TeamRole | null;
  canManage: boolean;
}

export interface TeamSettingsLlmConfig extends Pick<LlmProviderConfig, "provider" | "baseUrl" | "model" | "stream"> {
  hasApiKey: boolean;
}

export interface ImageGenerationSettingsConfig extends Pick<ImageGenerationConfig, "provider" | "baseUrl" | "model"> {
  hasApiKey: boolean;
}

export interface TeamSettingsResponse extends TeamSummary {
  llmConfig?: TeamSettingsLlmConfig;
  imageGenerationConfig?: ImageGenerationSettingsConfig;
}

export interface TeamAdminOverviewResponse {
  team: TeamSummary;
  members: TeamMemberSummary[];
  projects: Array<Pick<ProjectRecord, "id" | "name" | "description" | "reviewPolicyMode" | "createdAt" | "updatedAt"> & {
    memberCount: number;
  }>;
  projectInvites: ProjectInviteSummary[];
  pendingReviews: ReviewQueueVersionSummary[];
}

export interface ProjectWorkspacePayload {
  team: Pick<TeamRecord, "id" | "name" | "defaultReviewPolicy">;
  project: Pick<ProjectRecord, "id" | "name" | "description" | "genre" | "coverUrl" | "status" | "reviewPolicyMode" | "createdAt" | "updatedAt">;
  members: ProjectMemberSummary[];
  invites: ProjectInviteSummary[];
  pendingReviews: ReviewQueueVersionSummary[];
  documents: Array<Pick<DocumentRecord, "id" | "projectId" | "type" | "title" | "shotId" | "currentVersionId">>;
  versions: Array<Pick<VersionRecord, "id" | "documentId" | "versionNumber" | "status" | "title" | "content" | "metadata" | "createdAt">>;
  jobs: ProjectJobSummary[];
  worldBible?: WorldBibleContent;
  auditConfigs?: AuditConfigResponse[];
  timeline?: TimelineRecord;
  exports?: ExportRecord[];
}

export interface ProjectWorkspaceSummaryPayload extends Omit<ProjectWorkspacePayload, "versions" | "jobs" | "timeline" | "exports"> {}

export interface ProjectVersionsResponse {
  versions: Array<Pick<VersionRecord, "id" | "documentId" | "versionNumber" | "status" | "title" | "content" | "metadata" | "createdAt">>;
}

export interface ProjectCreationPayload {
  teamId: string;
  name: string;
  description?: string;
  genre?: string;
  coverUrl?: string;
  status?: ProjectStatus;
  reviewPolicyMode?: ReviewPolicyMode;
}

export interface ProjectUpdatePayload {
  name?: string;
  description?: string;
  genre?: string;
  coverUrl?: string;
  status?: ProjectStatus;
  reviewPolicyMode?: ReviewPolicyMode;
}

export interface TeamCreationPayload {
  name: string;
  slug?: string;
  defaultReviewPolicy?: Exclude<ReviewPolicyMode, "inherit">;
}

export interface TeamMemberAssignmentPayload {
  email: string;
  role: TeamRole;
}

export interface TeamSettingsUpdatePayload {
  name: string;
  defaultReviewPolicy: Exclude<ReviewPolicyMode, "inherit">;
  llmConfig?: LlmProviderConfig;
  imageGenerationConfig?: ImageGenerationConfig;
}

export interface LlmModelSummary {
  id: string;
  created?: number;
  ownedBy?: string;
}

export interface LlmModelListRequest {
  llmConfig?: LlmProviderConfig;
}

export interface LlmModelListResponse {
  models: LlmModelSummary[];
}

export interface CreateImageJobPayload {
  projectId: string;
  style: string;
  aspectRatio: string;
  prompt?: string;
  referenceImageAssetId?: string;
  configSource?: ImageConfigSource;
}

export interface CreateScriptJobPayload extends GenerateScriptInput {
  llmConfigSource?: LlmConfigSource;
}

export interface CreateSynopsisJobPayload extends GenerateSynopsisInput {
  llmConfigSource?: LlmConfigSource;
}

export interface CreateStoryboardJobPayload extends GenerateStoryboardInput {
  llmConfigSource?: LlmConfigSource;
}

export interface ProjectMemberAssignmentPayload {
  email: string;
  role: ProjectRole;
}

export interface CommentCreationPayload {
  body: string;
  parentId?: string;
  anchorType: CommentRecord["anchorType"];
  anchorId?: string;
}

export interface ReviewVersionPayload {
  comment?: string;
}

export interface DocumentVersionAdoptPayload {
  versionId: string;
}

export interface UploadTargetResponse extends UploadTarget {}

export interface TeamInviteLinkCreatePayload {
  role: TeamRole;
  maxUses?: number;
  expiresInHours?: number;
}

export interface TeamInviteLinkSummary extends Pick<TeamInviteLinkRecord, "id" | "token" | "role" | "maxUses" | "uses" | "expiresAt" | "createdAt"> {
  createdByName: string;
}

export interface TeamInviteLinkInfoResponse {
  teamName: string;
  teamSlug: string;
  role: TeamRole;
  expired: boolean;
  exhausted: boolean;
}

export interface WorldBibleUpdatePayload {
  characters?: WorldBibleContent["characters"];
  locations?: WorldBibleContent["locations"];
  styleGuide?: WorldBibleContent["styleGuide"];
}

export interface CharacterCreatePayload {
  name: string;
  appearance: string;
  personality?: string;
  tags?: string[];
  referenceImages?: string[];
  costumes?: Record<string, string>;
}

export interface LocationCreatePayload {
  name: string;
  description: string;
  lighting?: string;
  timeOfDay?: string;
  referenceImages?: string[];
}

export interface StyleGuideUpdatePayload {
  visualStyle: string;
  colorPalette?: string;
  compositionNote?: string;
  negativePrompt?: string;
  referenceImages?: string[];
}

export interface PromptPreviewRequest {
  projectId: string;
  shotId: string;
  prompt?: string;
}

export interface PromptPreviewResponse {
  positivePrompt: string;
  negativePrompt: string;
  shotId: string;
  injectedCharacters: string[];
  injectedLocation?: string;
  injectedStyle?: string;
}

// ===== Audit Contracts =====

export interface AuditConfigResponse extends Pick<AuditConfigRecord, "id" | "projectId" | "contentType" | "reviewRequired" | "autoApproveRoles"> {}

export interface AuditConfigUpdatePayload {
  reviewRequired: boolean;
  autoApproveRoles?: ProjectRole[];
}

export interface AuditRecordSummary extends Pick<AuditRecordEntry, "id" | "projectId" | "versionId" | "documentType" | "action" | "comment" | "createdAt"> {
  reviewerDisplayName: string;
  reviewerEmail: string;
}

// ===== Notification Contracts =====

export interface NotificationSummary extends Pick<NotificationRecord, "id" | "userId" | "projectId" | "type" | "title" | "body" | "referenceId" | "referenceType" | "isRead" | "createdAt"> {}

export interface NotificationListQuery {
  unreadOnly?: boolean;
  limit?: number;
  offset?: number;
}

export interface UnreadCountResponse {
  count: number;
}

// ===== Task / Batch Contracts =====

export interface TaskListQuery {
  status?: JobStatus;
  type?: JobType;
  batchId?: string;
  limit?: number;
  offset?: number;
}

export interface TaskListResponse {
  jobs: ProjectJobSummary[];
  total: number;
}

export interface BatchGenerateRequest {
  shotIds: string[];
}

export interface BatchJobStatusResponse extends Pick<BatchJobGroupRecord, "id" | "projectId" | "jobIds" | "status" | "createdAt"> {
  totalCount: number;
  completedCount: number;
  failedCount: number;
  runningCount: number;
}

// ===== TTS / Voice Contracts =====

export interface VoiceInfo {
  id: string;
  name: string;
  provider: string;
  sampleUrl?: string;
}

export interface VoiceListResponse {
  voices: VoiceInfo[];
}

export interface CharacterVoiceUpdatePayload {
  ttsProvider: string;
  voiceId: string;
  voiceName: string;
  settings?: { speed?: number; emotion?: string; volume?: number };
}

export interface TTSGenerateRequest {
  shotId: string;
  characterId: string;
  text: string;
}

export interface BatchTTSGenerateRequest {
  shotIds: string[];
}

export interface ProjectInviteAcceptResponse {
  inviteId: string;
  projectId: string;
  projectName: string;
  role: ProjectRole;
  alreadyMember: boolean;
}

export interface PendingProjectInvitesResponse {
  invites: ProjectInviteSummary[];
}

// ===== Realtime Contracts =====

export interface RealtimeProjectSubscriptionPayload {
  projectId: string;
}

export interface RealtimeJobUpdatedEvent {
  projectId: string;
  job: ProjectJobSummary;
}

export interface RealtimeReviewUpdatedEvent {
  projectId: string;
  versionId: string;
  documentId: string;
  status?: VersionRecord["status"];
  action: AuditAction | "comment_added" | "comment_reply";
  commentId?: string;
  parentId?: string;
}

export interface RealtimeNotificationCreatedEvent {
  notification: NotificationSummary;
  unreadCount: number;
}

// ===== Timeline Contracts =====

export interface TimelineResponse extends TimelineRecord {}

export interface TimelineSavePayload {
  duration: number;
  fps: number;
  resolution: string;
  tracks: TimelineTrackRecord[];
}

// ===== Export Contracts =====

export interface ExportRequest {
  resolution: string;
  fps: number;
  bitrate?: string;
  format: ExportFormat;
}

export interface ExportResponse extends ExportRecord {}

export interface ExportListResponse {
  exports: ExportRecord[];
}