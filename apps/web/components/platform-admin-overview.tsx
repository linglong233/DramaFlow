"use client";

import { useQuery } from "@tanstack/react-query";
import type { PlatformOverviewResponse } from "@dramaflow/shared";

import { getJobStatusLabel, getJobTypeLabel, getStorageDriverLabel, useI18n } from "../lib/i18n";
import { apiFetch, formatApiError } from "../lib/api";
import { queryKeys } from "../lib/query-keys";
import { EmptyState } from "./empty-state";
import { ErrorState } from "./error-state";
import { LoadingSkeleton } from "./loading-skeleton";
import { PageHeader } from "./page-header";
import { SectionCard } from "./section-card";
import { StatusBadge } from "./status-badge";

function getJobTone(status: PlatformOverviewResponse["recentJobs"][number]["status"]) {
  switch (status) {
    case "failed":
      return "danger" as const;
    case "completed":
      return "success" as const;
    case "queued":
    case "running":
      return "warning" as const;
    default:
      return "neutral" as const;
  }
}

export function PlatformAdminOverview() {
  const { t, formatDate } = useI18n();
  const overviewQuery = useQuery({
    queryKey: queryKeys.platformOverview,
    queryFn: () => apiFetch<PlatformOverviewResponse>("/admin/platform/overview"),
  });

  const stats = overviewQuery.data ? [
    {
      label: t("platformAdmin.stats.usersLabel"),
      value: overviewQuery.data.metrics.users,
      note: t("platformAdmin.stats.usersNote"),
    },
    {
      label: t("platformAdmin.stats.teamsLabel"),
      value: overviewQuery.data.metrics.teams,
      note: t("platformAdmin.stats.teamsNote"),
    },
    {
      label: t("platformAdmin.stats.projectsLabel"),
      value: overviewQuery.data.metrics.projects,
      note: t("platformAdmin.stats.projectsNote"),
    },
    {
      label: t("platformAdmin.stats.queuedJobsLabel"),
      value: overviewQuery.data.metrics.queuedJobs,
      note: t("platformAdmin.stats.queuedJobsNote"),
    },
  ] : [];

  return (
    <div className="stack stack--page">
      <PageHeader
        kicker={t("platformAdmin.kicker")}
        title={t("platformAdmin.title")}
        description={t("platformAdmin.description")}
      />

      {overviewQuery.isPending ? <LoadingSkeleton variant="hero" rows={6} /> : null}

      {overviewQuery.error ? (
        <ErrorState
          title={t("platformAdmin.loadErrorTitle")}
          description={formatApiError(overviewQuery.error, t, "platformAdmin.loadErrorDescription")}
          action={(
            <button className="primary-btn" type="button" onClick={() => void overviewQuery.refetch()}>
              {t("common.reload")}
            </button>
          )}
        />
      ) : null}

      {overviewQuery.data ? (
        <>
          <section className="stats-grid">
            {stats.map((stat) => (
              <div key={stat.label} className="stat-tile">
                <div className="muted">{stat.label}</div>
                <div className="metric">{stat.value}</div>
                <div className="stat-note">{stat.note}</div>
              </div>
            ))}
          </section>

          <section className="workspace-grid workspace-grid--dashboard">
            <SectionCard title={t("platformAdmin.recentJobs.title")} description={t("platformAdmin.recentJobs.description")}>
              {overviewQuery.data.recentJobs.length > 0 ? (
                <div className="stack stack--tight">
                  {overviewQuery.data.recentJobs.map((job) => (
                    <div key={job.id} className="job-row">
                      <div>
                        <strong>{getJobTypeLabel(t, job.type)}</strong>
                        <div className="muted">{job.id}</div>
                      </div>
                      <div className="job-row__meta">
                        <StatusBadge tone={getJobTone(job.status)}>{getJobStatusLabel(t, job.status)}</StatusBadge>
                        <span className="muted">{formatDate(job.updatedAt)}</span>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <EmptyState
                  title={t("platformAdmin.recentJobs.emptyTitle")}
                  description={t("platformAdmin.recentJobs.emptyDescription")}
                />
              )}
            </SectionCard>

            <SectionCard title={t("platformAdmin.tenants.title")} description={t("platformAdmin.tenants.description")}>
              <div className="stack stack--tight">
                <div className="team-card">
                  <div>
                    <strong>{t("platformAdmin.tenants.driverTitle")}</strong>
                    <div className="muted">{t("platformAdmin.tenants.driverDescription")}</div>
                  </div>
                  <StatusBadge tone="info">{getStorageDriverLabel(t, overviewQuery.data.storageDriver)}</StatusBadge>
                </div>
                {overviewQuery.data.tenants.length > 0 ? (
                  overviewQuery.data.tenants.map((tenant) => (
                    <div key={tenant.id} className="project-card project-card--compact">
                      <div>
                        <strong>{tenant.name}</strong>
                        <div className="muted">{tenant.slug}</div>
                      </div>
                      <StatusBadge tone="neutral">{t("platformAdmin.tenants.badge")}</StatusBadge>
                    </div>
                  ))
                ) : (
                  <EmptyState
                    title={t("platformAdmin.tenants.emptyTitle")}
                    description={t("platformAdmin.tenants.emptyDescription")}
                  />
                )}
              </div>
            </SectionCard>
          </section>
        </>
      ) : null}
    </div>
  );
}