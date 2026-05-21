/**
 * @fileoverview React Query 缓存键定义
 * @module web/lib
 *
 * 统一管理所有 React Query 的缓存键常量。
 */

export const queryKeys = {
  teams: ["teams"] as const,
  team: (teamId: string) => ["team", teamId] as const,
  teamSettings: (teamId: string) => ["team-settings", teamId] as const,
  projects: ["projects"] as const,
  project: (projectId: string) => ["project", projectId] as const,
  projectVersions: (projectId: string) => ["project-versions", projectId] as const,
  versionComments: (versionId: string) => ["version-comments", versionId] as const,
  platformOverview: ["platform-overview"] as const,
  teamOverview: (teamId: string) => ["team-overview", teamId] as const,
  notifications: ["notifications"] as const,
  unreadCount: ["unread-count"] as const,
  projectJobs: (projectId: string) => ["project-jobs", projectId] as const,
  batchJob: (batchId: string) => ["batch-job", batchId] as const,
  auditConfigs: (projectId: string) => ["audit-configs", projectId] as const,
  auditRecords: (projectId: string) => ["audit-records", projectId] as const,
  versionAuditRecords: (versionId: string) => ["version-audit-records", versionId] as const,
  timeline: (projectId: string) => ["timeline", projectId] as const,
  ttsVoices: ["tts-voices"] as const,
  exports: (projectId: string) => ["exports", projectId] as const,
  novelImportLatest: (projectId: string) => ["novel-import-latest", projectId] as const,
  novelImportSession: (sessionId: string) => ["novel-import-session", sessionId] as const,
  teamPermissionTemplates: (teamId: string) => ["team-permission-templates", teamId] as const,
  projectMemberPermissions: (projectId: string, memberId: string) => ["project-member-permissions", projectId, memberId] as const,
};
