/**
 * @fileoverview 任务状态栏
 * @module web/components/project-workspace
 *
 * 展示 AI 任务的实时状态、进度、耗时，并提供取消 / 重试入口。
 */

"use client";

import { useEffect, useState } from "react";
import type { JobRecord } from "@dramaflow/shared";

import { formatApiError } from "../../lib/api";
import { useI18n } from "../../lib/i18n";
import { useJobMutations } from "../../lib/hooks/use-job-mutations";
import { useToast } from "../toast-provider";

interface Props {
  jobs: Array<Pick<JobRecord, "id" | "type" | "status" | "progress" | "updatedAt" | "error">>;
  projectId?: string;
  canManageJobs?: boolean;
}

function JobIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
      <circle cx="6" cy="6" r="5" stroke="currentColor" strokeWidth="1.2" />
      <path d="M6 3v3l2 1" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
    </svg>
  );
}

function getJobTypeLabel(t: ReturnType<typeof useI18n>["t"], type: string): string {
  const key = `enums.jobType.${type}` as const;
  return t(key as Parameters<typeof t>[0]) ?? type;
}

function getJobStatusLabel(t: ReturnType<typeof useI18n>["t"], status: string): string {
  const key = `enums.jobStatus.${status}` as const;
  return t(key as Parameters<typeof t>[0]) ?? status;
}

/** 把秒数格式化为 30s / 5m / 1h20m 这样的简短耗时（自给定时间点起） */
function formatDuration(since: string): string {
  const seconds = Math.max(0, Math.floor((Date.now() - new Date(since).getTime()) / 1000));
  if (seconds < 60) {
    return `${seconds}s`;
  }
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) {
    return `${minutes}m`;
  }
  const hours = Math.floor(minutes / 60);
  return `${hours}h${minutes % 60}m`;
}

export function JobStatusBar({ jobs, projectId, canManageJobs = false }: Props) {
  const { t } = useI18n();
  const toast = useToast();
  const { cancel, retry } = useJobMutations(projectId);
  // 每 10s 触发一次重算，刷新耗时显示
  const [, tick] = useState(0);

  useEffect(() => {
    const id = window.setInterval(() => tick((n) => n + 1), 10000);
    return () => window.clearInterval(id);
  }, []);

  const activeJobs = jobs.filter((j) => j.status === "queued" || j.status === "running");
  const recentJobs =
    activeJobs.length > 0
      ? activeJobs.slice(0, 5)
      : jobs.filter((j) => j.status === "completed" || j.status === "failed").slice(0, 3);

  function handleCancel(jobId: string) {
    cancel.mutate(jobId, {
      onSuccess: () => toast.success(t("projectWorkspace.workspace.jobCancelledToast")),
      onError: (error) => toast.error(formatApiError(error, t, "projectWorkspace.workspace.jobCancelFailed")),
    });
  }

  function handleRetry(jobId: string) {
    retry.mutate(jobId, {
      onSuccess: () => toast.success(t("projectWorkspace.workspace.jobRetriedToast")),
      onError: (error) => toast.error(formatApiError(error, t, "projectWorkspace.workspace.jobRetryFailed")),
    });
  }

  return (
    <div className="uw-job-bar">
      <div className="uw-job-bar-header">
        <span className="uw-job-bar-icon"><JobIcon /></span>
        <span className="uw-job-bar-title">{t("projectWorkspace.workspace.activeJobs")}</span>
      </div>
      {recentJobs.length === 0 ? (
        <div className="uw-job-empty">{t("projectWorkspace.workspace.noActiveJobs")}</div>
      ) : (
        recentJobs.map((job) => {
          const isActive = job.status === "queued" || job.status === "running";
          const hasProgress = typeof job.progress === "number" && job.progress > 0;
          const duration = job.updatedAt ? formatDuration(job.updatedAt) : null;

          return (
            <div key={job.id} className="uw-job-item">
              <span className={`uw-job-dot uw-job-dot--${job.status}`} />
              <span className="uw-job-name">{getJobTypeLabel(t, job.type)}</span>
              <span className="uw-job-status">{getJobStatusLabel(t, job.status)}</span>
              {isActive && duration ? (
                <span className="uw-job-meta">
                  {job.status === "running"
                    ? t("projectWorkspace.workspace.jobElapsedRunning", { duration })
                    : t("projectWorkspace.workspace.jobElapsedWaiting", { duration })}
                </span>
              ) : null}
              {canManageJobs && isActive ? (
                <span className="uw-job-actions">
                  <button
                    type="button"
                    className="uw-job-btn uw-job-btn--danger"
                    disabled={cancel.isPending}
                    onClick={() => handleCancel(job.id)}
                  >
                    {t("projectWorkspace.workspace.jobCancel")}
                  </button>
                </span>
              ) : null}
              {canManageJobs && job.status === "failed" ? (
                <span className="uw-job-actions">
                  <button
                    type="button"
                    className="uw-job-btn"
                    disabled={retry.isPending}
                    onClick={() => handleRetry(job.id)}
                  >
                    {t("projectWorkspace.workspace.jobRetry")}
                  </button>
                </span>
              ) : null}
              {isActive ? (
                <div className={hasProgress ? "uw-job-progress" : "uw-job-progress uw-job-progress--indeterminate"}>
                  <div
                    className="uw-job-progress__bar"
                    style={hasProgress ? { width: `${job.progress}%` } : undefined}
                  />
                </div>
              ) : null}
              {job.status === "failed" && job.error ? (
                <div className="uw-job-error" title={job.error}>{job.error}</div>
              ) : null}
            </div>
          );
        })
      )}
    </div>
  );
}
