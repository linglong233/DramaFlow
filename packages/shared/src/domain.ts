export type GlobalRole = "platform_super_admin" | "user";

export type TeamRole = "tenant_owner" | "tenant_admin" | "member";

export type ProjectRole =
  | "project_admin"
  | "director"
  | "writer"
  | "artist"
  | "reviewer"
  | "viewer";

export type ReviewPolicyMode = "inherit" | "required" | "bypass";

export type ProjectStatus = "draft" | "in_progress" | "completed" | "archived";

export type DocumentType = "script" | "storyboard" | "image" | "video" | "audio" | "world_bible";

export type VersionStatus =
  | "draft"
  | "submitted"
  | "pending_review"
  | "approved"
  | "rejected";

export type AnchorType = "document" | "scene" | "shot" | "asset";

export type JobType =
  | "script_generation"
  | "synopsis_generation"
  | "storyboard_generation"
  | "image_generation"
  | "video_generation"
  | "rewrite_segment"
  | "tts_generation"
  | "export_video";

export type JobStatus = "queued" | "running" | "completed" | "failed";

export type JobPriority = "low" | "normal" | "high";

export type AuditContentType = "script" | "storyboard" | "image" | "video";

export type AuditAction = "submitted" | "approved" | "rejected";

export type TrackType = "video" | "dialogue" | "music" | "sfx" | "subtitle";

export type TransitionType = "none" | "fade" | "dissolve" | "wipe";

export type ExportFormat = "mp4" | "mov" | "webm";

export type ExportStatus = "pending" | "processing" | "completed" | "failed";

export type LlmConfigSource = "team" | "personal";

export type ImageGenerationProvider = "google-gemini" | "openai-compatible";

export type ImageConfigSource = LlmConfigSource;

export type NotificationType =
  | "task_completed"
  | "task_failed"
  | "review_submitted"
  | "review_approved"
  | "review_rejected"
  | "comment_added"
  | "comment_reply"
  | "member_invited";

export interface LlmProviderConfig {
  provider: string;
  apiKey?: string;
  baseUrl?: string;
  model?: string;
  stream?: boolean;
}

export interface ImageGenerationConfig {
  provider: ImageGenerationProvider;
  apiKey?: string;
  baseUrl?: string;
  model?: string;
}

export interface UserRecord {
  id: string;
  email: string;
  displayName: string;
  passwordHash: string;
  globalRole: GlobalRole;
  llmConfig?: LlmProviderConfig;
  imageGenerationConfig?: ImageGenerationConfig;
  createdAt: string;
  updatedAt: string;
}

export interface RefreshTokenRecord {
  id: string;
  userId: string;
  tokenHash: string;
  expiresAt: string;
  createdAt: string;
}

export interface TeamRecord {
  id: string;
  name: string;
  slug: string;
  defaultReviewPolicy: Exclude<ReviewPolicyMode, "inherit">;
  createdBy: string;
  llmConfig?: LlmProviderConfig;
  imageGenerationConfig?: ImageGenerationConfig;
  createdAt: string;
  updatedAt: string;
}

export interface TeamMemberRecord {
  id: string;
  teamId: string;
  userId: string;
  role: TeamRole;
  createdAt: string;
}

export interface TeamInviteLinkRecord {
  id: string;
  teamId: string;
  token: string;
  role: TeamRole;
  maxUses: number;
  uses: number;
  expiresAt: string | null;
  createdBy: string;
  createdAt: string;
}

export interface ProjectRecord {
  id: string;
  teamId: string;
  name: string;
  description: string;
  genre?: string;
  coverUrl?: string;
  status: ProjectStatus;
  reviewPolicyMode: ReviewPolicyMode;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface ProjectMemberRecord {
  id: string;
  projectId: string;
  userId: string;
  role: ProjectRole;
  createdAt: string;
}

export interface DocumentRecord {
  id: string;
  projectId: string;
  type: DocumentType;
  title: string;
  shotId?: string;
  currentVersionId?: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface VersionRecord<TContent = unknown> {
  id: string;
  documentId: string;
  versionNumber: number;
  status: VersionStatus;
  title: string;
  content: TContent;
  metadata: Record<string, unknown>;
  parentVersionId?: string;
  createdBy: string;
  createdAt: string;
}

export interface CommentRecord {
  id: string;
  versionId: string;
  authorId: string;
  body: string;
  parentId?: string;
  anchorType: AnchorType;
  anchorId?: string;
  resolved: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface JobRecord<TInput = Record<string, unknown>, TResult = Record<string, unknown>> {
  id: string;
  type: JobType;
  status: JobStatus;
  projectId: string;
  documentId?: string;
  shotId?: string;
  input: TInput;
  result?: TResult;
  error?: string;
  progress?: number;
  retryCount?: number;
  maxRetries?: number;
  priority?: JobPriority;
  cancelledAt?: string;
  batchId?: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface UploadAssetRecord {
  id: string;
  projectId: string;
  documentId?: string;
  versionId?: string;
  storageDriver: "local" | "s3";
  storageKey: string;
  publicUrl?: string;
  mimeType: string;
  sizeInBytes: number;
  createdBy: string;
  createdAt: string;
}

export interface ScriptScene {
  id: string;
  heading: string;
  synopsis: string;
  characters: string[];
  dialogue: Array<{
    speaker: string;
    line: string;
  }>;
  directorNote?: string;
  locationId?: string;
}

export interface ScriptContent {
  logline: string;
  premise: string;
  characters: Array<{
    name: string;
    profile: string;
    worldBibleCharId?: string;
  }>;
  scenes: ScriptScene[];
}

export interface StoryboardShot {
  id: string;
  sceneId: string;
  shotLabel: string;
  framing: string;
  cameraMove: string;
  durationSeconds: number;
  visualDescription: string;
  actionDescription?: string;
  dialogue?: string;
  soundDesign?: string;
  notes?: string;
  imagePrompt?: string;
  videoPrompt?: string;
  characterIds?: string[];
}

export interface StoryboardContent {
  overview: string;
  shots: StoryboardShot[];
}

export interface MediaContent {
  prompt: string;
  assetId?: string;
  assetUrl?: string;
  provider: string;
  model?: string;
  mimeType: string;
  parameters: Record<string, unknown>;
  providerVideoId?: string;
  providerStatus?: string;
  progress?: number;
  mode?: "provider" | "mock";
  note?: string;
  configSource?: ImageConfigSource;
}

export interface UploadTarget {
  driver: "local" | "s3";
  key: string;
  method: "PUT" | "POST";
  url: string;
  headers: Record<string, string>;
  fields?: Record<string, string>;
  publicUrl?: string;
}

export interface GenerateScriptInput {
  title: string;
  genre: string;
  premise: string;
  episodeGoal: string;
  tone: string;
  audience: string;
}

export interface GenerateSynopsisInput {
  title: string;
  genre: string;
  theme: string;
  keywords: string[];
  episodeCount: number;
  constraints?: string;
}

export interface RewriteSegmentInput {
  originalText: string;
  instruction: string;
  context?: string;
  documentId: string;
}

export interface GenerateStoryboardInput {
  documentId: string;
  versionId: string;
  cinematicStyle: string;
  shotDensity: "sparse" | "balanced" | "dense";
}

export interface GenerateMediaInput {
  shotId: string;
  style: string;
  aspectRatio: string;
  durationSeconds?: number;
  referenceImageAssetId?: string;
}

export interface AccessContext {
  userId: string;
  globalRole: GlobalRole;
  teamRoles: TeamRole[];
  projectRoles: ProjectRole[];
}

export interface ProjectSummary {
  project: ProjectRecord;
  documents: DocumentRecord[];
  members: ProjectMemberRecord[];
}

export interface CharacterProfile {
  id: string;
  name: string;
  appearance: string;
  personality?: string;
  tags: string[];
  referenceImages: string[];
  costumes?: Record<string, string>;
  sortOrder: number;
}

export interface LocationProfile {
  id: string;
  name: string;
  description: string;
  lighting?: string;
  timeOfDay?: string;
  referenceImages: string[];
  sortOrder: number;
}

export interface StyleGuideProfile {
  visualStyle: string;
  colorPalette?: string;
  compositionNote?: string;
  negativePrompt?: string;
  referenceImages: string[];
}

export interface CharacterVoiceConfig {
  characterId: string;
  ttsProvider: string;
  voiceId: string;
  voiceName: string;
  sampleUrl?: string;
  settings?: {
    speed?: number;
    emotion?: string;
    volume?: number;
  };
}

export interface WorldBibleContent {
  characters: CharacterProfile[];
  locations: LocationProfile[];
  styleGuide?: StyleGuideProfile;
  voiceConfigs?: CharacterVoiceConfig[];
}

export interface PromptPreviewResult {
  positivePrompt: string;
  negativePrompt: string;
  shotId: string;
  injectedCharacters: string[];
  injectedLocation?: string;
  injectedStyle?: string;
}

export interface AuditConfigRecord {
  id: string;
  projectId: string;
  contentType: AuditContentType;
  reviewRequired: boolean;
  autoApproveRoles: ProjectRole[];
  createdAt: string;
  updatedAt: string;
}

export interface AuditRecordEntry {
  id: string;
  projectId: string;
  versionId: string;
  documentType: DocumentType;
  action: AuditAction;
  reviewerId: string;
  comment?: string;
  createdAt: string;
}

export interface NotificationRecord {
  id: string;
  userId: string;
  projectId?: string;
  type: NotificationType;
  title: string;
  body: string;
  referenceId?: string;
  referenceType?: "job" | "version" | "comment";
  isRead: boolean;
  createdAt: string;
}

export type BatchJobStatus = "running" | "completed" | "partial_failure";

export interface BatchJobGroupRecord {
  id: string;
  projectId: string;
  jobIds: string[];
  status: BatchJobStatus;
  createdBy: string;
  createdAt: string;
}

export interface TimelineClipRecord {
  id: string;
  assetId?: string;
  assetUrl?: string;
  startTime: number;
  duration: number;
  inPoint: number;
  outPoint?: number;
  subtitleText?: string;
  subtitleStyle?: Record<string, unknown>;
  transitionIn?: TransitionType;
  transitionOut?: TransitionType;
  transitionDuration?: number;
  sortOrder: number;
  label?: string;
  shotId?: string;
}

export interface TimelineTrackRecord {
  id: string;
  type: TrackType;
  name: string;
  sortOrder: number;
  isMuted: boolean;
  volume: number;
  clips: TimelineClipRecord[];
}

export interface TimelineRecord {
  id: string;
  projectId: string;
  duration: number;
  fps: number;
  resolution: string;
  tracks: TimelineTrackRecord[];
  createdAt: string;
  updatedAt: string;
}

export interface ExportRecord {
  id: string;
  projectId: string;
  taskId: string;
  resolution: string;
  fps: number;
  bitrate?: string;
  format: ExportFormat;
  outputUrl?: string;
  fileSize?: number;
  duration?: number;
  status: ExportStatus;
  createdBy: string;
  createdAt: string;
  completedAt?: string;
}

export interface GenerateTTSInput {
  shotId: string;
  characterId: string;
  text: string;
  projectId: string;
}

export interface ExportTimelineInput {
  projectId: string;
  resolution: string;
  fps: number;
  bitrate?: string;
  format: ExportFormat;
  allowMockFallback?: boolean;
}