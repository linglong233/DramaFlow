/**
 * @fileoverview 平台管理仪表盘
 * @module web/components
 *
 * 平台超级管理员的统计和管理界面。
 */

"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import type { PlatformOverviewResponse } from "@dramaflow/shared";

import { apiFetch, formatApiError } from "../lib/api";
import { useI18n, getJobStatusLabel, getJobTypeLabel, getStorageDriverLabel } from "../lib/i18n";
import { queryKeys } from "../lib/query-keys";
import { useSession } from "../lib/use-session";
import { ErrorState } from "./error-state";
import { LoadingSkeleton } from "./loading-skeleton";

/* ── Inline SVG Icons ── */
function UsersIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <circle cx="10" cy="7" r="3.5" stroke="currentColor" strokeWidth="1.5" />
      <path d="M3 18c0-3.866 3.134-7 7-7s7 3.134 7 7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

function TeamsIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <circle cx="7" cy="7" r="2.5" stroke="currentColor" strokeWidth="1.5" />
      <circle cx="13" cy="7" r="2.5" stroke="currentColor" strokeWidth="1.5" />
      <path d="M1 17c0-3.314 2.686-4 6-4M13 13c3.314 0 6 .686 6 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

function ProjectsIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <rect x="3" y="3" width="14" height="14" rx="3" stroke="currentColor" strokeWidth="1.5" />
      <path d="M7 7h6M7 10h6M7 13h3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

function QueueIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <path d="M10 2v6l3 2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="10" cy="10" r="7.5" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}

function ReviewsIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <circle cx="10" cy="10" r="7.5" stroke="currentColor" strokeWidth="1.5" />
      <path d="M7 10l2 2 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function StorageIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
      <ellipse cx="9" cy="5" rx="6" ry="2.5" stroke="currentColor" strokeWidth="1.4" />
      <path d="M3 5v8c0 1.38 2.686 2.5 6 2.5s6-1.12 6-2.5V5" stroke="currentColor" strokeWidth="1.4" />
      <path d="M3 9c0 1.38 2.686 2.5 6 2.5s6-1.12 6-2.5" stroke="currentColor" strokeWidth="1.4" />
    </svg>
  );
}

function TenantIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <rect x="2" y="3" width="12" height="10" rx="2" stroke="currentColor" strokeWidth="1.3" />
      <path d="M5 7h6M5 10h3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
    </svg>
  );
}

const STAT_ICONS = [UsersIcon, TeamsIcon, ProjectsIcon, QueueIcon, ReviewsIcon];

function jobStatusColor(status: string): string {
  if (status === "failed") return "var(--color-danger, #ef4444)";
  if (status === "completed") return "var(--color-success, #34d399)";
  if (status === "processing") return "var(--accent)";
  return "var(--text-tertiary)";
}

export function PlatformAdminDashboard() {
  const { session, ready } = useSession();
  const { formatDate, t } = useI18n();
  const isPlatformAdmin = session?.user.globalRole === "platform_super_admin";

  const overviewQuery = useQuery({
    queryKey: queryKeys.platformOverview,
    queryFn: () => apiFetch<PlatformOverviewResponse>("/admin/platform/overview"),
    enabled: ready && isPlatformAdmin,
  });

  if (!ready) {
    return <LoadingSkeleton variant="hero" rows={6} />;
  }

  if (!isPlatformAdmin) {
    return (
      <ErrorState
        title={t("dashboard.platformOverview.unavailableTitle")}
        description={t("dashboard.platformOverview.nonAdminDescription")}
        action={<Link href="/dashboard/team" className="btn btn-secondary">{t("dashboard.platformOverview.fallbackAction")}</Link>}
      />
    );
  }

  if (overviewQuery.isPending || !overviewQuery.data) {
    return <LoadingSkeleton variant="hero" rows={8} />;
  }

  if (overviewQuery.error) {
    return (
      <ErrorState
        title={t("platformAdmin.loadErrorTitle")}
        description={formatApiError(overviewQuery.error, t, "platformAdmin.loadErrorDescription")}
        action={<button className="btn btn-secondary" type="button" onClick={() => void overviewQuery.refetch()}>{t("common.reload")}</button>}
      />
    );
  }

  const overview = overviewQuery.data;

  const stats = [
    { value: overview.metrics.users, label: t("platformAdmin.stats.usersLabel") },
    { value: overview.metrics.teams, label: t("platformAdmin.stats.teamsLabel") },
    { value: overview.metrics.projects, label: t("platformAdmin.stats.projectsLabel") },
    { value: overview.metrics.queuedJobs, label: t("platformAdmin.stats.queuedJobsLabel") },
    { value: overview.metrics.pendingReviewVersions, label: t("dashboard.stats.pendingVersionsLabel") },
  ];

  return (
    <div className="pa-root animate-fade-in">
      {/* Hero header */}
      <header className="pa-header">
        <span className="pa-kicker">{t("platformAdmin.kicker")}</span>
        <h1 className="pa-title">{t("platformAdmin.title")}</h1>
        <p className="pa-desc">{t("platformAdmin.description")}</p>
      </header>

      {/* Stats ribbon */}
      <div className="pa-stats animate-slide-up" style={{ animationDelay: "0.06s" }}>
        {stats.map((s, i) => {
          const Icon = STAT_ICONS[i];
          return (
            <div key={i} className="pa-stat">
              <div className="pa-stat-icon"><Icon /></div>
              <div className="pa-stat-value">{s.value}</div>
              <div className="pa-stat-label">{s.label}</div>
            </div>
          );
        })}
      </div>

      {/* Two-column content */}
      <div className="pa-body animate-slide-up" style={{ animationDelay: "0.12s" }}>
        {/* Recent Jobs */}
        <section className="pa-section">
          <div className="pa-section-head">
            <h2 className="pa-section-title">{t("platformAdmin.recentJobs.title")}</h2>
            <p className="pa-section-desc">{t("platformAdmin.recentJobs.description")}</p>
          </div>

          {overview.recentJobs.length === 0 ? (
            <div className="projects-empty">
              <div className="projects-empty-icon"><QueueIcon /></div>
              <div className="projects-empty-title">{t("platformAdmin.recentJobs.emptyTitle")}</div>
              <div className="projects-empty-desc">{t("platformAdmin.recentJobs.emptyDescription")}</div>
            </div>
          ) : (
            <div className="pa-list">
              {overview.recentJobs.map((job) => (
                <div key={job.id} className="pa-row">
                  <div className="pa-row-left">
                    <div className="pa-row-indicator" style={{ background: jobStatusColor(job.status) }} />
                    <div className="pa-row-info">
                      <span className="pa-row-name">{job.id.slice(0, 16)}...</span>
                      <span className="pa-row-sub">{getJobTypeLabel(t, job.type)}</span>
                    </div>
                  </div>
                  <div className="pa-row-right">
                    <span className="status-badge badge-neutral" style={{ fontSize: 11 }}>
                      {getJobStatusLabel(t, job.status)}
                    </span>
                    <span className="pa-row-date">
                      {formatDate(job.updatedAt, { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* Tenants & Storage */}
        <section className="pa-section">
          <div className="pa-section-head">
            <h2 className="pa-section-title">{t("platformAdmin.tenants.title")}</h2>
            <p className="pa-section-desc">{t("platformAdmin.tenants.description")}</p>
          </div>

          {/* Storage driver badge */}
          <div className="pa-storage-card">
            <div className="pa-storage-icon"><StorageIcon /></div>
            <div className="pa-storage-info">
              <span className="pa-storage-label">{t("platformAdmin.tenants.driverTitle")}</span>
              <span className="pa-storage-desc">{t("platformAdmin.tenants.driverDescription")}</span>
            </div>
            <span className="status-badge badge-neutral">{getStorageDriverLabel(t, overview.storageDriver)}</span>
          </div>

          {/* Tenant list */}
          <div className="pa-subsection-label">租户列表</div>
          {overview.tenants.length === 0 ? (
            <div className="projects-empty">
              <div className="projects-empty-icon"><TenantIcon /></div>
              <div className="projects-empty-title">{t("platformAdmin.tenants.emptyTitle")}</div>
              <div className="projects-empty-desc">{t("platformAdmin.tenants.emptyDescription")}</div>
            </div>
          ) : (
            <div className="pa-list">
              {overview.tenants.map((tenant) => (
                <div key={tenant.id} className="pa-row">
                  <div className="pa-row-left">
                    <div className="pa-tenant-avatar">
                      {tenant.name.slice(0, 2).toUpperCase()}
                    </div>
                    <div className="pa-row-info">
                      <span className="pa-row-name" style={{ color: "var(--accent)" }}>{tenant.name}</span>
                      <span className="pa-row-sub">/ {tenant.slug}</span>
                    </div>
                  </div>
                  <span className="status-badge badge-neutral" style={{ fontSize: 11 }}>
                    {t("platformAdmin.tenants.badge")}
                  </span>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}