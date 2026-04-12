/**
 * @fileoverview 开发态数据库类型定义
 * @module api/common
 *
 * 定义 JSON 文件存储的数据库结构。
 * 运行时使用 DevDatabaseService 操作此结构。
 */

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

/** 项目邀请记录（开发态专用，未纳入 shared 层） */
export interface ProjectInviteRecord {
  id: string;
  projectId: string;
  email: string;
  role: ProjectMemberRecord["role"];
  createdBy: string;
  status: "pending" | "accepted";
  createdAt: string;
}

/** 开发态 JSON 文件数据库的完整结构 */
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

/** 创建空的数据库实例（用于首次启动时初始化文件） */
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

