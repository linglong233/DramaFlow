/**
 * @fileoverview 项目权限解析器
 * @module shared/project-permissions
 *
 * 提供项目级别细粒度权限的解析、归一化和判断功能。
 * 支持系统默认权限模板、团队自定义模板和项目成员级权限覆盖。
 */

import type {
  AccessContext,
  AccessProjectMemberContext,
  PermissionOverride,
  ProjectPermission,
  ProjectRole,
  ProjectRolePermissionTemplates,
} from "./domain";

/** 全部项目权限列表 */
export const PROJECT_PERMISSIONS: ProjectPermission[] = [
  "project.view",
  "project.edit",
  "version.review",
  "job.manage",
  "timeline.edit",
  "export.create",
  "member.manage",
  "permission.manage",
];

/** 全部项目角色列表 */
export const PROJECT_ROLES: ProjectRole[] = [
  "project_admin",
  "director",
  "writer",
  "artist",
  "reviewer",
  "viewer",
];

/** 系统默认的项目角色权限模板 */
export const SYSTEM_PROJECT_ROLE_PERMISSION_TEMPLATES: Record<ProjectRole, ProjectPermission[]> = {
  project_admin: [...PROJECT_PERMISSIONS],
  director: ["project.view", "project.edit", "version.review", "job.manage", "timeline.edit", "export.create"],
  writer: ["project.view", "project.edit"],
  artist: ["project.view", "project.edit"],
  reviewer: ["project.view", "version.review"],
  viewer: ["project.view"],
};

const PROJECT_PERMISSION_SET = new Set<ProjectPermission>(PROJECT_PERMISSIONS);
const PROJECT_ROLE_SET = new Set<ProjectRole>(PROJECT_ROLES);

/** 检查给定值是否为有效的项目权限 */
export function isProjectPermission(value: unknown): value is ProjectPermission {
  return typeof value === "string" && PROJECT_PERMISSION_SET.has(value as ProjectPermission);
}

/** 检查给定值是否为有效的项目角色 */
export function isProjectRole(value: unknown): value is ProjectRole {
  return typeof value === "string" && PROJECT_ROLE_SET.has(value as ProjectRole);
}

export interface InvalidProjectPermissionValue {
  path: string;
  value: string;
}

function describeInvalidPermissionValue(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }

  if (value === null) {
    return "null";
  }

  if (Array.isArray(value)) {
    return "array";
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }

  return typeof value;
}

export function findInvalidProjectPermissionValues(
  values: unknown,
  path: string,
): InvalidProjectPermissionValue[] {
  if (!Array.isArray(values)) {
    return values === undefined
      ? []
      : [{ path, value: typeof values }];
  }

  return values
    .map((value, index) => ({ value, index }))
    .filter(({ value }) => !isProjectPermission(value))
    .map(({ value, index }) => ({
      path: `${path}[${index}]`,
      value: describeInvalidPermissionValue(value),
    }));
}

export function findInvalidPermissionOverrideValues(value: unknown): InvalidProjectPermissionValue[] {
  const record = value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};

  return [
    ...findInvalidProjectPermissionValues(record.allow, "permissionOverride.allow"),
    ...findInvalidProjectPermissionValues(record.deny, "permissionOverride.deny"),
  ];
}

export function findInvalidProjectRolePermissionTemplateValues(value: unknown): InvalidProjectPermissionValue[] {
  const record = value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
  const invalid: InvalidProjectPermissionValue[] = [];

  for (const role of PROJECT_ROLES) {
    if (role === "project_admin") {
      continue;
    }

    if (Object.prototype.hasOwnProperty.call(record, role)) {
      invalid.push(...findInvalidProjectPermissionValues(record[role], `templates.${role}`));
    }
  }

  return invalid;
}

/** 归一化权限列表：去除无效值和重复项，保持规范排序 */
export function normalizeProjectPermissionList(values: unknown): ProjectPermission[] {
  if (!Array.isArray(values)) {
    return [];
  }

  const seen = new Set<ProjectPermission>();
  for (const value of values) {
    if (isProjectPermission(value)) {
      seen.add(value);
    }
  }

  return PROJECT_PERMISSIONS.filter((permission) => seen.has(permission));
}

/** 归一化权限覆盖：去除重复和无效值 */
export function normalizePermissionOverride(value: unknown): PermissionOverride {
  const record = value && typeof value === "object" ? value as Record<string, unknown> : {};
  return {
    allow: normalizeProjectPermissionList(record.allow),
    deny: normalizeProjectPermissionList(record.deny),
  };
}

/** 归一化团队级项目角色权限模板 */
export function normalizeProjectRolePermissionTemplates(value: unknown): ProjectRolePermissionTemplates {
  const record = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const templates: ProjectRolePermissionTemplates = {};

  for (const role of PROJECT_ROLES) {
    if (role === "project_admin") {
      continue;
    }

    if (Object.prototype.hasOwnProperty.call(record, role)) {
      templates[role] = normalizeProjectPermissionList(record[role]);
    }
  }

  return templates;
}

/** 获取角色的系统默认权限列表 */
export function getDefaultProjectRolePermissions(role: ProjectRole): ProjectPermission[] {
  return [...SYSTEM_PROJECT_ROLE_PERMISSION_TEMPLATES[role]];
}

/** 获取角色在团队模板或系统默认下的权限列表 */
export function getProjectRoleTemplatePermissions(
  role: ProjectRole,
  templates?: ProjectRolePermissionTemplates,
): ProjectPermission[] {
  if (role === "project_admin") {
    return [...PROJECT_PERMISSIONS];
  }

  const teamTemplate = templates?.[role];
  return teamTemplate ? normalizeProjectPermissionList(teamTemplate) : getDefaultProjectRolePermissions(role);
}

/** 从访问上下文中提取项目成员列表（无显式成员则从角色列表推断） */
function getContextProjectMembers(context: AccessContext): AccessProjectMemberContext[] {
  if (context.projectMembers?.length) {
    return context.projectMembers;
  }

  return context.projectRoles.map((role) => ({ role }));
}

/**
 * 解析访问上下文的最终权限列表
 * 优先级：平台超管/项目管理员拥有全部权限 > 团队模板 > 成员级覆盖（deny 优先于 allow）
 */
export function resolveProjectPermissions(context: AccessContext): ProjectPermission[] {
  if (context.globalRole === "platform_super_admin") {
    return [...PROJECT_PERMISSIONS];
  }

  const projectMembers = getContextProjectMembers(context);
  if (projectMembers.some((member) => member.role === "project_admin")) {
    return [...PROJECT_PERMISSIONS];
  }

  const granted = new Set<ProjectPermission>();
  const denied = new Set<ProjectPermission>();

  for (const member of projectMembers) {
    const inherited = getProjectRoleTemplatePermissions(member.role, context.projectRolePermissionTemplates);
    for (const permission of inherited) {
      granted.add(permission);
    }

    const override = normalizePermissionOverride(member.permissionOverride);
    for (const permission of override.allow) {
      granted.add(permission);
    }
    for (const permission of override.deny) {
      denied.add(permission);
    }
  }

  return PROJECT_PERMISSIONS.filter((permission) => granted.has(permission) && !denied.has(permission));
}

/** 检查访问上下文是否拥有指定权限 */
export function hasProjectPermission(context: AccessContext, permission: ProjectPermission): boolean {
  return resolveProjectPermissions(context).includes(permission);
}
