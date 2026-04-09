import type {
  AuditConfigRecord,
  AuditRecordEntry,
  BatchJobGroupRecord,
  CommentRecord,
  DocumentRecord,
  ExportRecord,
  JobRecord,
  NotificationRecord,
  ProjectMemberRecord,
  ProjectRecord,
  RefreshTokenRecord,
  TeamInviteLinkRecord,
  TeamMemberRecord,
  TeamRecord,
  TimelineRecord,
  UploadAssetRecord,
  UserRecord,
  VersionRecord,
} from "@dramaflow/shared";

export interface ProjectInviteRecord {
  id: string;
  projectId: string;
  email: string;
  role: ProjectMemberRecord["role"];
  createdBy: string;
  status: "pending" | "accepted";
  createdAt: string;
}

export interface DevDatabase {
  users: UserRecord[];
  refreshTokens: RefreshTokenRecord[];
  teams: TeamRecord[];
  teamMembers: TeamMemberRecord[];
  teamInviteLinks: TeamInviteLinkRecord[];
  projects: ProjectRecord[];
  projectMembers: ProjectMemberRecord[];
  projectInvites: ProjectInviteRecord[];
  documents: DocumentRecord[];
  versions: VersionRecord[];
  comments: CommentRecord[];
  jobs: JobRecord[];
  assets: UploadAssetRecord[];
  notifications: NotificationRecord[];
  auditConfigs: AuditConfigRecord[];
  auditRecords: AuditRecordEntry[];
  batchJobs: BatchJobGroupRecord[];
  timelines: TimelineRecord[];
  exports: ExportRecord[];
  updatedAt: string;
}

export function createEmptyDatabase(): DevDatabase {
  return {
    users: [],
    refreshTokens: [],
    teams: [],
    teamMembers: [],
    teamInviteLinks: [],
    projects: [],
    projectMembers: [],
    projectInvites: [],
    documents: [],
    versions: [],
    comments: [],
    jobs: [],
    assets: [],
    notifications: [],
    auditConfigs: [],
    auditRecords: [],
    batchJobs: [],
    timelines: [],
    exports: [],
    updatedAt: new Date().toISOString(),
  };
}

