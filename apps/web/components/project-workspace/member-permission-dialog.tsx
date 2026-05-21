/**
 * @fileoverview 项目成员权限覆盖对话框
 * @module web/components/project-workspace
 *
 * 允许管理员查看和编辑单个成员的权限覆盖（允许/拒绝列表）。
 */

"use client";

import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  PROJECT_PERMISSIONS,
  type PermissionOverride,
  type ProjectMemberPermissionsResponse,
  type ProjectMemberSummary,
  type ProjectPermission,
  type UpdateProjectMemberPermissionsPayload,
} from "@dramaflow/shared";

import { apiFetch, formatApiError } from "../../lib/api";
import { useFeedback } from "../../lib/hooks";
import { useI18n, getProjectRoleLabel } from "../../lib/i18n";
import { getProjectPermissionHelp, getProjectPermissionLabel } from "../../lib/project-permissions";
import { queryKeys } from "../../lib/query-keys";
import { InlineFeedback } from "../inline-feedback";

interface Props {
  projectId: string;
  member: ProjectMemberSummary;
  onClose: () => void;
}

function togglePermission(list: ProjectPermission[], permission: ProjectPermission) {
  const next = new Set(list);
  if (next.has(permission)) {
    next.delete(permission);
  } else {
    next.add(permission);
  }
  return PROJECT_PERMISSIONS.filter((item) => next.has(item));
}

export function MemberPermissionDialog({ projectId, member, onClose }: Props) {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const { feedback, setFeedback } = useFeedback();
  const [override, setOverride] = useState<PermissionOverride>(member.permissionOverride);

  const permissionsQuery = useQuery({
    queryKey: queryKeys.projectMemberPermissions(projectId, member.id),
    queryFn: () => apiFetch<ProjectMemberPermissionsResponse>(`/projects/${projectId}/members/${member.id}/permissions`),
  });

  useEffect(() => {
    if (permissionsQuery.data) {
      setOverride(permissionsQuery.data.permissionOverride);
    }
  }, [permissionsQuery.data]);

  const saveMutation = useMutation({
    mutationFn: () => apiFetch<ProjectMemberPermissionsResponse>(`/projects/${projectId}/members/${member.id}/permissions`, {
      method: "PUT",
      body: { permissionOverride: override } satisfies UpdateProjectMemberPermissionsPayload,
    }),
    onSuccess: async () => {
      setFeedback({ message: t("projectWorkspace.collaboration.permissionsSaved"), error: null });
      await queryClient.invalidateQueries({ queryKey: queryKeys.project(projectId) });
      await queryClient.invalidateQueries({ queryKey: queryKeys.projectMemberPermissions(projectId, member.id) });
      onClose();
    },
    onError: (error) => setFeedback({
      message: null,
      error: formatApiError(error, t, "projectWorkspace.collaboration.permissionsSaveFailed"),
    }),
  });

  const source = permissionsQuery.data ?? {
    inheritedPermissions: member.inheritedPermissions,
    permissionOverride: member.permissionOverride,
    effectivePermissions: member.effectivePermissions,
  };

  return (
    <div className="uw-drawer-overlay" role="presentation" onClick={onClose}>
      <div className="create-project-modal permission-dialog" role="dialog" aria-modal="true" onClick={(event) => event.stopPropagation()}>
        <div className="permission-dialog__header">
          <div>
            <h3 className="create-project-modal-title">{t("projectWorkspace.collaboration.permissionsDialogTitle")}</h3>
            <p style={{ fontSize: 13, color: "var(--text-tertiary)", marginTop: 4 }}>{member.displayName} · {getProjectRoleLabel(t, member.role)}</p>
          </div>
          <button className="btn btn-ghost btn-sm" type="button" onClick={onClose}>{t("common.cancel")}</button>
        </div>
        <InlineFeedback message={feedback.message} error={feedback.error} />
        <div className="permission-dialog__grid">
          {PROJECT_PERMISSIONS.map((permission) => (
            <div key={permission} className="permission-dialog__row">
              <div>
                <strong>{getProjectPermissionLabel(t, permission)}</strong>
                <span>{getProjectPermissionHelp(t, permission)}</span>
              </div>
              <span>{source.inheritedPermissions.includes(permission) ? t("projectWorkspace.collaboration.permissionsInherited") : "-"}</span>
              <label>
                <input
                  type="checkbox"
                  checked={override.allow.includes(permission)}
                  onChange={() => setOverride((current) => ({ ...current, allow: togglePermission(current.allow, permission) }))}
                />
                {t("projectWorkspace.collaboration.permissionsAllow")}
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={override.deny.includes(permission)}
                  onChange={() => setOverride((current) => ({ ...current, deny: togglePermission(current.deny, permission) }))}
                />
                {t("projectWorkspace.collaboration.permissionsDeny")}
              </label>
              <span>{source.effectivePermissions.includes(permission) ? t("projectWorkspace.collaboration.permissionsEffective") : "-"}</span>
            </div>
          ))}
        </div>
        <div style={{ display: "flex", justifyContent: "flex-end", gap: "var(--space-2)", marginTop: "var(--space-4)" }}>
          <button className="btn btn-primary" type="button" onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending}>
            {saveMutation.isPending ? t("common.submitting") : t("common.save")}
          </button>
        </div>
      </div>
    </div>
  );
}
