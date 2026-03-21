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

export type DocumentType = "script" | "storyboard" | "image" | "video";

export type VersionStatus =
  | "draft"
  | "submitted"
  | "pending_review"
  | "approved"
  | "rejected";

export type AnchorType = "document" | "scene" | "shot" | "asset";

export type JobType =
  | "script_generation"
  | "storyboard_generation"
  | "image_generation"
  | "video_generation";

export type JobStatus = "queued" | "running" | "completed" | "failed";

export interface UserRecord {
  id: string;
  email: string;
  displayName: string;
  passwordHash: string;
  globalRole: GlobalRole;
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

export interface ProjectRecord {
  id: string;
  teamId: string;
  name: string;
  description: string;
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
}

export interface ScriptContent {
  logline: string;
  premise: string;
  characters: Array<{
    name: string;
    profile: string;
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
  dialogue?: string;
  soundDesign?: string;
  imagePrompt?: string;
  videoPrompt?: string;
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
  mimeType: string;
  parameters: Record<string, unknown>;
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
