"use client";

import type { JobRecord } from "@dramaflow/shared";
import { useI18n } from "../../lib/i18n";

interface Props {
  jobs: Array<Pick<JobRecord, "id" | "type" | "status">>;
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
  return t(key as any) ?? type;
}

function getJobStatusLabel(t: ReturnType<typeof useI18n>["t"], status: string): string {
  const key = `enums.jobStatus.${status}` as const;
  return t(key as any) ?? status;
}

export function JobStatusBar({ jobs }: Props) {
  const { t } = useI18n();
  const activeJobs = jobs.filter((j) => j.status === "queued" || j.status === "running");
  const recentJobs = activeJobs.length > 0
    ? activeJobs.slice(0, 5)
    : jobs.filter((j) => j.status === "completed" || j.status === "failed").slice(0, 3);

  return (
    <div className="uw-job-bar">
      <div className="uw-job-bar-header">
        <span className="uw-job-bar-icon"><JobIcon /></span>
        <span className="uw-job-bar-title">{t("projectWorkspace.workspace.activeJobs")}</span>
      </div>
      {recentJobs.length === 0 ? (
        <div className="uw-job-empty">{t("projectWorkspace.workspace.noActiveJobs")}</div>
      ) : (
        recentJobs.map((job) => (
          <div key={job.id} className="uw-job-item">
            <span className={`uw-job-dot uw-job-dot--${job.status}`} />
            <span className="uw-job-name">{getJobTypeLabel(t, job.type)}</span>
            <span className="uw-job-status">{getJobStatusLabel(t, job.status)}</span>
          </div>
        ))
      )}
    </div>
  );
}
