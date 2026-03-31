"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "../../lib/api";
import { queryKeys } from "../../lib/query-keys";
import { useI18n, getVersionStatusLabel } from "../../lib/i18n";

interface Version {
  id: string;
  title: string;
  versionNumber: number;
  status: string;
  content: any;
  createdAt: string;
}

interface Props {
  version: Version | null;
  projectId: string;
  isLoading: boolean;
}

export function VersionView({ version, projectId, isLoading }: Props) {
  const { t } = useI18n();
  const queryClient = useQueryClient();

  const submitMutation = useMutation({
    mutationFn: () => apiFetch(`/versions/${version!.id}/submit`, { method: "POST" }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.project(projectId) }),
  });

  const approveMutation = useMutation({
    mutationFn: () => apiFetch(`/versions/${version!.id}/approve`, { method: "POST" }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.project(projectId) }),
  });

  const rejectMutation = useMutation({
    mutationFn: () => apiFetch(`/versions/${version!.id}/reject`, { method: "POST" }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.project(projectId) }),
  });

  if (!version) {
    return (
      <div className="empty-state">
        <div className="empty-state-title">{t("projectWorkspace.versions.emptyCurrentTitle")}</div>
        <div className="empty-state-description">{t("projectWorkspace.versions.emptyCurrentDescription")}</div>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="stack stack-gap-4">
        <div className="skeleton" style={{ height: 24, width: "40%" }} />
        <div className="skeleton" style={{ height: 200 }} />
      </div>
    );
  }

  return (
    <div>
      {/* Version header */}
      <div className="inline" style={{ alignItems: "center", justifyContent: "space-between", marginBottom: "var(--space-6)" }}>
        <div>
          <h2 style={{ fontSize: "1rem", fontWeight: 600 }}>{version.title}</h2>
          <span className="faint text-sm">V{version.versionNumber} · {new Date(version.createdAt).toLocaleDateString()}</span>
        </div>
        <span className={`badge badge-${version.status === "approved" ? "success" : version.status === "rejected" ? "danger" : "neutral"}`}>
          {getVersionStatusLabel(t, version.status as any)}
        </span>
      </div>

      {/* Content */}
      <div className="card card-sm" style={{ marginBottom: "var(--space-6)" }}>
        {version.content ? (
          <pre style={{ fontSize: 12, whiteSpace: "pre-wrap", wordBreak: "break-word", fontFamily: "var(--font-mono)" }}>
            {JSON.stringify(version.content, null, 2)}
          </pre>
        ) : (
          <span className="muted">{t("projectWorkspace.overview.fallbackDescription")}</span>
        )}
      </div>

      {/* Actions */}
      <div className="inline inline-gap-2">
        {version.status === "draft" && (
          <button
            className="btn btn-secondary btn-sm"
            onClick={() => submitMutation.mutate()}
            disabled={submitMutation.isPending}
          >
            {submitMutation.isPending ? "..." : t("projectWorkspace.versions.submitAction")}
          </button>
        )}
        {version.status === "pending_review" && (
          <>
            <button
              className="btn btn-primary btn-sm"
              onClick={() => approveMutation.mutate()}
              disabled={approveMutation.isPending}
            >
              {approveMutation.isPending ? "..." : t("projectWorkspace.versions.approveAction")}
            </button>
            <button
              className="btn btn-danger btn-sm"
              onClick={() => rejectMutation.mutate()}
              disabled={rejectMutation.isPending}
            >
              {rejectMutation.isPending ? "..." : t("projectWorkspace.versions.rejectAction")}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
