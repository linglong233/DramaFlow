/**
 * @fileoverview 任务面板
 * @module web/components/project-workspace
 *
 * 项目 AI 任务列表和状态管理。
 */

"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { ProjectJobSummary, JobStatus, JobType } from "@dramaflow/shared";

import { useI18n, type TranslateFn } from "../../lib/i18n";
import { apiFetch, formatApiError } from "../../lib/api";
import { useFeedback, useActiveJobs } from "../../lib/hooks";
import { queryKeys } from "../../lib/query-keys";
import { InlineFeedback } from "../inline-feedback";

type FilterTab = "all" | JobStatus;

const FILTER_TABS: FilterTab[] = ["all", "queued", "running", "completed", "failed"];

const FILTER_TAB_KEYS: Record<FilterTab, string> = {
  all: "taskPanel.filterAll",
  queued: "taskPanel.filterQueued",
  running: "taskPanel.filterRunning",
  completed: "taskPanel.filterCompleted",
  failed: "taskPanel.filterFailed",
};

const STATUS_COLORS: Record<JobStatus, string> = {
  queued: "var(--color-text-tertiary)",
  running: "var(--color-info)",
  completed: "var(--color-success)",
  failed: "var(--color-error)",
};

function JobTypeIcon({ type }: { type: JobType }) {
  switch (type) {
    case "script_generation":
    case "synopsis_generation":
      return (
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
          <path d="M4 1h4.5L11 3.5V12a1 1 0 01-1 1H4a1 1 0 01-1-1V2a1 1 0 011-1z" stroke="currentColor" strokeWidth="1.3" />
          <path d="M5 7h4M5 9.5h2.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
        </svg>
      );
    case "storyboard_generation":
      return (
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
          <rect x="1" y="2" width="5" height="4" rx="0.5" stroke="currentColor" strokeWidth="1.2" />
          <rect x="8" y="2" width="5" height="4" rx="0.5" stroke="currentColor" strokeWidth="1.2" />
          <rect x="1" y="8" width="5" height="4" rx="0.5" stroke="currentColor" strokeWidth="1.2" />
          <rect x="8" y="8" width="5" height="4" rx="0.5" stroke="currentColor" strokeWidth="1.2" />
        </svg>
      );
    case "image_generation":
      return (
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
          <rect x="1.5" y="2.5" width="11" height="9" rx="1.5" stroke="currentColor" strokeWidth="1.3" />
          <circle cx="5" cy="6" r="1.2" stroke="currentColor" strokeWidth="1" />
          <path d="M1.5 9.5l3-2.5 2 2 3-3 3 3" stroke="currentColor" strokeWidth="1" strokeLinejoin="round" />
        </svg>
      );
    case "video_generation":
      return (
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
          <rect x="1" y="2.5" width="9" height="9" rx="1.5" stroke="currentColor" strokeWidth="1.2" />
          <path d="M10 5.5l3-1.5v6l-3-1.5" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
        </svg>
      );
    default:
      return (
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
          <circle cx="7" cy="7" r="5" stroke="currentColor" strokeWidth="1.2" />
          <path d="M6 3v3l2 1" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
        </svg>
      );
  }
}

function formatRelativeTime(dateString: string, t: TranslateFn): string {
  const now = Date.now();
  const then = new Date(dateString).getTime();
  const diffMs = now - then;
  const diffSec = Math.floor(diffMs / 1000);
  if (diffSec < 60) return t("taskPanel.timeAgo.seconds" as any, { count: diffSec });
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return t("taskPanel.timeAgo.minutes" as any, { count: diffMin });
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return t("taskPanel.timeAgo.hours" as any, { count: diffHr });
  const diffDay = Math.floor(diffHr / 24);
  return t("taskPanel.timeAgo.days" as any, { count: diffDay });
}

interface TaskPanelProps {
  projectId: string;
  shotIds: string[];
  imageConfigSource?: string;
  videoConfigSource?: string;
  selectedImageProvider?: string;
  selectedVideoProvider?: string;
  canManageJobs?: boolean;
}

export function TaskPanel({ projectId, shotIds, imageConfigSource, selectedImageProvider, selectedVideoProvider, canManageJobs = false }: TaskPanelProps) {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const [activeFilter, setActiveFilter] = useState<FilterTab>("all");
  const { feedback, setFeedback } = useFeedback();
  const [confirmBatch, setConfirmBatch] = useState<"images" | "videos" | null>(null);

  const jobsQuery = useActiveJobs({ projectId, limit: 50, pollWhenActive: true });

  const cancelMutation = useMutation({
    mutationFn: (jobId: string) => apiFetch(`/jobs/${jobId}/cancel`, { method: "POST" }),
    onSuccess: () => {
      setFeedback({ message: t("taskPanel.jobCancelled"), error: null });
      void queryClient.invalidateQueries({ queryKey: queryKeys.projectJobs(projectId) });
    },
    onError: (err) => setFeedback({ message: null, error: formatApiError(err, t, "common.cancel" as any) }),
  });

  const retryMutation = useMutation({
    mutationFn: (jobId: string) => apiFetch(`/jobs/${jobId}/retry`, { method: "POST" }),
    onSuccess: () => {
      setFeedback({ message: t("taskPanel.jobRetried"), error: null });
      void queryClient.invalidateQueries({ queryKey: queryKeys.projectJobs(projectId) });
    },
    onError: (err) => setFeedback({ message: null, error: formatApiError(err, t, "common.cancel" as any) }),
  });

  const batchImageMutation = useMutation({
    mutationFn: () => apiFetch(`/projects/${projectId}/batch-image-jobs`, { method: "POST", body: { shotIds, configSource: imageConfigSource, providerId: selectedImageProvider } }),
    onSuccess: () => {
      setFeedback({ message: t("taskPanel.batchImageStarted"), error: null });
      setConfirmBatch(null);
      void queryClient.invalidateQueries({ queryKey: queryKeys.projectJobs(projectId) });
    },
    onError: (err) => {
      setFeedback({ message: null, error: formatApiError(err, t, "common.cancel" as any) });
      setConfirmBatch(null);
    },
  });

  const batchVideoMutation = useMutation({
    mutationFn: () => apiFetch(`/projects/${projectId}/batch-video-jobs`, { method: "POST", body: { shotIds, configSource: imageConfigSource, providerId: selectedVideoProvider } }),
    onSuccess: () => {
      setFeedback({ message: t("taskPanel.batchVideoStarted"), error: null });
      setConfirmBatch(null);
      void queryClient.invalidateQueries({ queryKey: queryKeys.projectJobs(projectId) });
    },
    onError: (err) => {
      setFeedback({ message: null, error: formatApiError(err, t, "common.cancel" as any) });
      setConfirmBatch(null);
    },
  });

  const jobs = jobsQuery.data?.jobs ?? [];
  const filteredJobs = activeFilter === "all" ? jobs : jobs.filter((j) => j.status === activeFilter);

  // Group by batchId
  const batchGroups = new Map<string, ProjectJobSummary[]>();
  const ungrouped: ProjectJobSummary[] = [];
  for (const job of filteredJobs) {
    if (job.batchId) {
      const group = batchGroups.get(job.batchId) ?? [];
      group.push(job);
      batchGroups.set(job.batchId, group);
    } else {
      ungrouped.push(job);
    }
  }

  return (
    <div className="task-panel">
      <div className="task-panel__header">
        <h2 className="task-panel__title">{t("taskPanel.title")}</h2>
        {canManageJobs && (
        <div className="task-panel__actions">
          {confirmBatch === "images" ? (
            <div className="task-panel__confirm">
              <span>{t("taskPanel.batchConfirmImages")}</span>
              <button
                className="btn btn-primary btn-sm"
                type="button"
                onClick={() => batchImageMutation.mutate()}
                disabled={batchImageMutation.isPending || shotIds.length === 0}
              >
                {t("taskPanel.confirm")}
              </button>
              <button className="btn btn-ghost btn-sm" type="button" onClick={() => setConfirmBatch(null)}>
                {t("taskPanel.cancel")}
              </button>
            </div>
          ) : confirmBatch === "videos" ? (
            <div className="task-panel__confirm">
              <span>{t("taskPanel.batchConfirmVideos")}</span>
              <button
                className="btn btn-primary btn-sm"
                type="button"
                onClick={() => batchVideoMutation.mutate()}
                disabled={batchVideoMutation.isPending || shotIds.length === 0}
              >
                {t("taskPanel.confirm")}
              </button>
              <button className="btn btn-ghost btn-sm" type="button" onClick={() => setConfirmBatch(null)}>
                {t("taskPanel.cancel")}
              </button>
            </div>
          ) : (
            <>
              <button className="btn btn-secondary btn-sm" type="button" onClick={() => setConfirmBatch("images")}>
                {t("taskPanel.batchImages")}
              </button>
              <button className="btn btn-secondary btn-sm" type="button" onClick={() => setConfirmBatch("videos")}>
                {t("taskPanel.batchVideos")}
              </button>
            </>
          )}
        </div>
        )}
      </div>

      <InlineFeedback message={feedback.message} error={feedback.error} />

      {/* Filter tabs */}
      <div className="task-panel__filters">
        {FILTER_TABS.map((tab) => (
          <button
            key={tab}
            className={`task-panel__filter${activeFilter === tab ? " task-panel__filter--active" : ""}`}
            type="button"
            onClick={() => setActiveFilter(tab)}
          >
            {t(FILTER_TAB_KEYS[tab] as any)}
            {tab === "all" ? ` (${jobs.length})` : ` (${jobs.filter((j) => j.status === tab).length})`}
          </button>
        ))}
      </div>

      {/* Job list */}
      <div className="task-panel__list">
        {jobsQuery.isPending && (
          <div className="task-panel__empty">{t("taskPanel.loading")}</div>
        )}

        {!jobsQuery.isPending && filteredJobs.length === 0 && (
          <div className="task-panel__empty">{t("taskPanel.emptyTitle")}</div>
        )}

        {/* Batch groups */}
        {Array.from(batchGroups.entries()).map(([batchId, batchJobs]) => (
          <div key={batchId} className="task-panel__batch">
            <div className="task-panel__batch-header">
              {t("taskPanel.batchPrefix")} {batchId.slice(0, 8)}
              <span className="task-panel__batch-count">{t("taskPanel.batchCount", { count: batchJobs.length })}</span>
            </div>
            {batchJobs.map((job) => (
              <JobRow
                key={job.id}
                job={job}
                t={t}
                onCancel={() => cancelMutation.mutate(job.id)}
                onRetry={() => retryMutation.mutate(job.id)}
                isCancelling={cancelMutation.isPending}
                isRetrying={retryMutation.isPending}
                canManageJobs={canManageJobs}
              />
            ))}
          </div>
        ))}

        {/* Ungrouped jobs */}
        {ungrouped.map((job) => (
          <JobRow
            key={job.id}
            job={job}
            t={t}
            onCancel={() => cancelMutation.mutate(job.id)}
            onRetry={() => retryMutation.mutate(job.id)}
            isCancelling={cancelMutation.isPending}
            isRetrying={retryMutation.isPending}
            canManageJobs={canManageJobs}
          />
        ))}
      </div>
    </div>
  );
}

function JobRow({
  job,
  t,
  onCancel,
  onRetry,
  isCancelling,
  isRetrying,
  canManageJobs,
}: {
  job: ProjectJobSummary;
  t: TranslateFn;
  onCancel: () => void;
  onRetry: () => void;
  isCancelling: boolean;
  isRetrying: boolean;
  canManageJobs: boolean;
}) {
  return (
    <div className="task-panel__row">
      <div className="task-panel__row-icon">
        <JobTypeIcon type={job.type} />
      </div>
      <div className="task-panel__row-info">
        <span className="task-panel__row-type">
          {t(`taskPanel.jobTypes.${job.type}` as any)}
        </span>
        <span className="task-panel__row-time">
          {formatRelativeTime(job.updatedAt, t)}
        </span>
      </div>
      <div className="task-panel__row-status">
        <span
          className="task-panel__status-dot"
          style={{ backgroundColor: STATUS_COLORS[job.status] }}
        />
        <span className="task-panel__status-label">{t(`taskPanel.statusLabels.${job.status}` as any)}</span>
      </div>
      {job.status === "running" && typeof job.progress === "number" && (
        <div className="task-panel__progress">
          <div className="task-panel__progress-bar">
            <div
              className="task-panel__progress-fill"
              style={{ width: `${Math.min(100, Math.max(0, job.progress))}%` }}
            />
          </div>
          <span className="task-panel__progress-text">{t("taskPanel.progress", { value: job.progress })}</span>
        </div>
      )}
      {canManageJobs && (
      <div className="task-panel__row-actions">
        {job.status === "queued" && (
          <button
            className="btn btn-ghost btn-sm task-panel__cancel-btn"
            type="button"
            onClick={onCancel}
            disabled={isCancelling}
          >
            {t("taskPanel.cancelJob")}
          </button>
        )}
        {job.status === "failed" && (
          <button
            className="btn btn-ghost btn-sm task-panel__retry-btn"
            type="button"
            onClick={onRetry}
            disabled={isRetrying}
          >
            {t("taskPanel.retryJob")}
          </button>
        )}
      </div>
      )}
    </div>
  );
}
