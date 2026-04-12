/**
 * @fileoverview 业务规则函数集合
 * @module shared/business-rules
 *
 * 包含审核流、权限判断、版本状态流转等核心业务规则。
 * 前端和后端共享这些规则，确保权限判断逻辑的一致性。
 */

import type {
  AccessContext,
  AuditConfigRecord,
  AuditContentType,
  ProjectRole,
  ReviewPolicyMode,
  TeamRole,
  VersionStatus,
} from "./domain";

/** 拥有团队管理权限的角色 */
const TEAM_ADMIN_ROLES: TeamRole[] = ["tenant_owner", "tenant_admin"];

/** 拥有项目编辑权限的角色 */
const PROJECT_EDITOR_ROLES: ProjectRole[] = [
  "project_admin",
  "director",
  "writer",
  "artist",
];

/** 拥有项目审核权限的角色 */
const PROJECT_REVIEW_ROLES: ProjectRole[] = ["project_admin", "reviewer"];

/**
 * 解析最终生效的审核策略
 * @param teamDefaultPolicy - 团队默认审核策略
 * @param projectPolicy - 项目级审核策略
 * @returns 是否需要审核
 */
export function resolveReviewRequired(
  teamDefaultPolicy: Exclude<ReviewPolicyMode, "inherit">,
  projectPolicy: ReviewPolicyMode,
): boolean {
  if (projectPolicy === "required") {
    return true;
  }

  if (projectPolicy === "bypass") {
    return false;
  }

  // projectPolicy === "inherit" 时继承团队默认策略
  return teamDefaultPolicy === "required";
}

/**
 * 根据是否需要审核，确定版本提交后的状态
 * @param reviewRequired - 是否需要审核
 * @returns 需要审核则为 "pending_review"，否则直接 "approved"
 */
export function getSubmittedStatus(reviewRequired: boolean): VersionStatus {
  return reviewRequired ? "pending_review" : "approved";
}

/**
 * 检查版本状态是否可以从 currentStatus 流转到 nextStatus
 * @param currentStatus - 当前版本状态
 * @param nextStatus - 目标版本状态
 * @returns 是否允许流转
 */
export function canTransitionVersionStatus(
  currentStatus: VersionStatus,
  nextStatus: VersionStatus,
): boolean {
  const allowed: Record<VersionStatus, VersionStatus[]> = {
    draft: ["submitted", "pending_review", "approved"],
    submitted: ["pending_review", "approved", "rejected"],
    pending_review: ["approved", "rejected"],
    approved: [],
    rejected: ["draft", "submitted", "pending_review"],
  };

  return allowed[currentStatus].includes(nextStatus);
}

/**
 * 检查用户是否有团队管理权限
 * @param context - 访问权限上下文
 * @returns 平台超管或团队管理员返回 true
 */
export function canManageTenant(context: AccessContext): boolean {
  return context.globalRole === "platform_super_admin" || context.teamRoles.some((role) => TEAM_ADMIN_ROLES.includes(role));
}

/**
 * 检查是否可以移除指定角色的团队成员
 * @param context - 操作者的访问权限上下文
 * @param targetRole - 被操作成员的角色
 * @returns 团队拥有者不可被移除
 */
export function canRemoveTeamMember(context: AccessContext, targetRole: TeamRole): boolean {
  if (context.globalRole === "platform_super_admin") {
    return true;
  }
  // 团队拥有者不可被移除
  if (targetRole === "tenant_owner") {
    return false;
  }
  return context.teamRoles.some((role) => TEAM_ADMIN_ROLES.includes(role));
}

/**
 * 检查是否可以更改团队成员角色
 * @param context - 操作者的访问权限上下文
 * @param currentRole - 成员当前角色
 * @param newRole - 目标角色
 * @returns 涉及 tenant_owner 角色变更时只有 owner 自己可操作
 */
export function canChangeTeamMemberRole(context: AccessContext, currentRole: TeamRole, newRole: TeamRole): boolean {
  if (context.globalRole === "platform_super_admin") {
    return true;
  }
  // 涉及 owner 角色的变更只有 owner 自己可以操作
  if (currentRole === "tenant_owner" || newRole === "tenant_owner") {
    return context.teamRoles.includes("tenant_owner");
  }
  return context.teamRoles.some((role) => TEAM_ADMIN_ROLES.includes(role));
}

/**
 * 检查用户是否有项目编辑权限
 * @param context - 访问权限上下文
 * @returns 平台超管或项目编辑角色返回 true
 */
export function canEditProject(context: AccessContext): boolean {
  return context.globalRole === "platform_super_admin" || context.projectRoles.some((role) => PROJECT_EDITOR_ROLES.includes(role));
}

/**
 * 检查用户是否有项目审核权限
 * @param context - 访问权限上下文
 * @returns 平台超管或审核角色返回 true
 */
export function canReviewProject(context: AccessContext): boolean {
  return context.globalRole === "platform_super_admin" || context.projectRoles.some((role) => PROJECT_REVIEW_ROLES.includes(role));
}

/**
 * 解析特定内容类型的审核需求（优先使用审核配置，回退到项目/团队策略）
 * @param teamDefaultPolicy - 团队默认审核策略
 * @param projectPolicy - 项目级审核策略
 * @param auditConfigs - 项目审核配置列表
 * @param contentType - 内容类型
 * @returns 是否需要审核
 */
export function resolveContentReviewRequired(
  teamDefaultPolicy: Exclude<ReviewPolicyMode, "inherit">,
  projectPolicy: ReviewPolicyMode,
  auditConfigs: AuditConfigRecord[],
  contentType: AuditContentType,
): boolean {
  const config = auditConfigs.find((c) => c.contentType === contentType);
  if (config) {
    return config.reviewRequired;
  }
  // 未找到特定内容类型的配置时，回退到通用审核策略
  return resolveReviewRequired(teamDefaultPolicy, projectPolicy);
}

/**
 * 检查用户角色是否满足自动审批条件
 * @param auditConfigs - 项目审核配置列表
 * @param contentType - 内容类型
 * @param userRoles - 用户在项目中的角色列表
 * @returns 用户角色在自动审批角色列表中则返回 true
 */
export function canAutoApprove(
  auditConfigs: AuditConfigRecord[],
  contentType: AuditContentType,
  userRoles: ProjectRole[],
): boolean {
  const config = auditConfigs.find((c) => c.contentType === contentType);
  if (!config || config.autoApproveRoles.length === 0) {
    return false;
  }
  return userRoles.some((role) => config.autoApproveRoles.includes(role));
}

/** 拥有任务管理权限的角色 */
const JOB_MANAGEMENT_ROLES: ProjectRole[] = ["project_admin", "director"];

/**
 * 检查用户是否有 AI 任务管理权限
 * @param context - 访问权限上下文
 */
export function canManageJobs(context: AccessContext): boolean {
  return context.globalRole === "platform_super_admin" || context.projectRoles.some((role) => JOB_MANAGEMENT_ROLES.includes(role));
}

/** 拥有时间线编辑权限的角色 */
const TIMELINE_EDITOR_ROLES: ProjectRole[] = ["project_admin", "director"];

/**
 * 检查用户是否有时间线编辑权限
 * @param context - 访问权限上下文
 */
export function canEditTimeline(context: AccessContext): boolean {
  return context.globalRole === "platform_super_admin" || context.projectRoles.some((role) => TIMELINE_EDITOR_ROLES.includes(role));
}

/**
 * 检查用户是否有项目导出权限
 * @param context - 访问权限上下文
 */
export function canExportProject(context: AccessContext): boolean {
  return context.globalRole === "platform_super_admin" || context.projectRoles.some((role) => TIMELINE_EDITOR_ROLES.includes(role));
}
