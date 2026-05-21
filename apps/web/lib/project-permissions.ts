/**
 * @fileoverview 项目权限前端工具函数
 * @module web/lib
 *
 * 提供权限判断、标签翻译和状态初始化的工具函数，
 * 供 UI 组件在渲染前统一调用。
 */

import {
  PROJECT_PERMISSIONS,
  type ProjectPermission,
  type ProjectRole,
} from "@dramaflow/shared";

import type { TranslateFn, TranslationKey } from "./i18n";

export const EDITABLE_PROJECT_ROLES: ProjectRole[] = [
  "director",
  "writer",
  "artist",
  "reviewer",
  "viewer",
];

export const PROJECT_PERMISSION_GROUPS: Array<{
  id: string;
  permissions: ProjectPermission[];
}> = [
  { id: "core", permissions: ["project.view", "project.edit"] },
  { id: "review", permissions: ["version.review"] },
  { id: "production", permissions: ["job.manage", "timeline.edit", "export.create"] },
  { id: "admin", permissions: ["member.manage", "permission.manage"] },
];

export function getProjectPermissionLabel(t: TranslateFn, permission: ProjectPermission) {
  return t(`enums.projectPermission.${permission}.label` as TranslationKey);
}

export function getProjectPermissionHelp(t: TranslateFn, permission: ProjectPermission) {
  return t(`enums.projectPermission.${permission}.help` as TranslationKey);
}

export function hasProjectPermission(permissions: readonly ProjectPermission[] | undefined, permission: ProjectPermission) {
  return Boolean(permissions?.includes(permission));
}

export function emptyPermissionState(): Record<ProjectPermission, boolean> {
  return Object.fromEntries(PROJECT_PERMISSIONS.map((permission) => [permission, false])) as Record<ProjectPermission, boolean>;
}
