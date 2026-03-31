"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ProjectWorkspacePayload, ReviewPolicyMode } from "@dramaflow/shared";

import { useI18n, getReviewPolicyLabel } from "../lib/i18n";
import { apiFetch, formatApiError } from "../lib/api";
import { queryKeys } from "../lib/query-keys";
import { ErrorState } from "./error-state";
import { InlineFeedback } from "./inline-feedback";
import { LoadingSkeleton } from "./loading-skeleton";

export function ProjectOverview({ projectId }: { projectId: string }) {
  const queryClient = useQueryClient();
  const { t } = useI18n();
  const [feedback, setFeedback] = useState<{ message: string | null; error: string | null }>({ message: null, error: null });

  const projectQuery = useQuery({
    queryKey: queryKeys.project(projectId),
    queryFn: () => apiFetch<ProjectWorkspacePayload>(`/projects/${projectId}`),
  });

  const project = projectQuery.data?.project;

  const updateReviewPolicyMutation = useMutation({
    mutationFn: (mode: ReviewPolicyMode) => apiFetch(`/projects/${projectId}/review-policy`, {
      method: "PATCH",
      body: { reviewPolicyMode: mode },
    }),
    onSuccess: async (_, mode) => {
      setFeedback({
        message: t("projectWorkspace.feedback.reviewPolicySuccess", { mode }),
        error: null,
      });
      await queryClient.invalidateQueries({ queryKey: queryKeys.project(projectId) });
    },
    onError: (error) => setFeedback({
      message: null,
      error: formatApiError(error, t, "projectWorkspace.feedback.reviewPolicyFailed"),
    }),
  });

  if (projectQuery.isPending) {
    return (
      <div className="stack stack-gap-4" style={{ padding: "var(--space-8)" }}>
        <LoadingSkeleton variant="hero" rows={2} />
      </div>
    );
  }

  if (projectQuery.error || !projectQuery.data) {
    return (
      <ErrorState
        title={t("projectWorkspace.loadErrorTitle")}
        description={formatApiError(projectQuery.error, t, "projectWorkspace.loadErrorDescription")}
        action={
          <button className="primary-btn" type="button" onClick={() => void projectQuery.refetch()}>
            {t("common.reload")}
          </button>
        }
      />
    );
  }

  return (
    <div style={{ padding: "var(--space-8)" }}>
      <div className="project-header">
        <div>
          <span className="kicker">{t("projectWorkspace.overview.kicker")}</span>
          <h1 className="project-header-title">{project?.name ?? "..."}</h1>
        </div>
        <div className="choice-row choice-row--compact" style={{ marginTop: "var(--space-4)" }}>
          <span className="muted text-sm">{t("projectWorkspace.reviewPolicy.label")}</span>
          {(["inherit", "required", "bypass"] as ReviewPolicyMode[]).map((mode) => (
            <button
              key={mode}
              className={mode === project?.reviewPolicyMode ? "choice-chip choice-chip--active" : "choice-chip"}
              type="button"
              disabled={updateReviewPolicyMutation.isPending}
              onClick={() => {
                setFeedback({ message: null, error: null });
                updateReviewPolicyMutation.mutate(mode);
              }}
            >
              {getReviewPolicyLabel(t, mode)}
            </button>
          ))}
        </div>
      </div>
      <InlineFeedback message={feedback.message} error={feedback.error} />
      <div className="card" style={{ marginTop: "var(--space-8)" }}>
        <h2 className="heading-4" style={{ marginBottom: "var(--space-4)" }}>{t("projectWorkspace.overview.projectDetailsTitle")}</h2>
        <p className="muted"><strong>{t("projectWorkspace.overview.descriptionLabel")}:</strong> {project?.description || t("projectWorkspace.overview.noDescription")}</p>
      </div>
    </div>
  );
}
