import type {
  CommentRecord,
  DocumentRecord,
  GlobalRole,
  JobRecord,
  ProjectMemberRecord,
  ProjectRecord,
  ReviewPolicyMode,
  TeamMemberRecord,
  TeamRecord,
  TeamRole,
  UploadTarget,
  VersionRecord,
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

export interface TeamAdminOverviewResponse {
  team: Pick<TeamRecord, "id" | "name" | "defaultReviewPolicy">;
  members: Array<Pick<TeamMemberRecord, "id" | "userId" | "role">>;
  projects: Array<Pick<ProjectRecord, "id" | "name" | "reviewPolicyMode">>;
  projectInvites: Array<{
    id: string;
    email: string;
    role: TeamRole | string;
    status: string;
  }>;
  pendingReviews: Array<Pick<VersionRecord, "id" | "title" | "status">>;
}

export interface ProjectWorkspacePayload {
  project: Pick<ProjectRecord, "id" | "name" | "description" | "reviewPolicyMode">;
  members: Array<Pick<ProjectMemberRecord, "id" | "userId" | "role">>;
  invites: Array<{
    id: string;
    email: string;
    role: string;
    status: string;
  }>;
  documents: Array<Pick<DocumentRecord, "id" | "projectId" | "type" | "title" | "shotId" | "currentVersionId">>;
  versions: Array<Pick<VersionRecord, "id" | "documentId" | "versionNumber" | "status" | "title" | "content" | "metadata" | "createdAt">>;
}

export interface ProjectCreationPayload {
  teamId: string;
  name: string;
  description?: string;
  reviewPolicyMode?: ReviewPolicyMode;
}

export interface TeamCreationPayload {
  name: string;
  slug?: string;
  defaultReviewPolicy?: Exclude<ReviewPolicyMode, "inherit">;
}

export interface CommentCreationPayload {
  body: string;
  anchorType: CommentRecord["anchorType"];
  anchorId?: string;
}

export interface UploadTargetResponse extends UploadTarget {}