"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  PlatformOverviewResponse,
  ProjectCreationPayload,
  ProjectRecord,
  TeamCreationPayload,
  TeamRecord,
} from "@dramaflow/shared";

import {
  getJobStatusLabel,
  getJobTypeLabel,
  getReviewPolicyLabel,
  getStorageDriverLabel,
  useI18n,
} from "../lib/i18n";
import { apiFetch, formatApiError } from "../lib/api";
import { queryKeys } from "../lib/query-keys";
import { useSession } from "../lib/use-session";
import { EmptyState } from "./empty-state";
import { ErrorState } from "./error-state";
import { InlineFeedback } from "./inline-feedback";
import { LoadingSkeleton } from "./loading-skeleton";
import { PageHeader } from "./page-header";
import { SectionCard } from "./section-card";
import { StatusBadge } from "./status-badge";

interface FeedbackState {
  message: string | null;
  error: string | null;
}

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

export function DashboardOverview() {
  const queryClient = useQueryClient();
  const { session } = useSession();
  const { t, formatDate } = useI18n();
  const [teamName, setTeamName] = useState("");
  const [projectName, setProjectName] = useState("");
  const [projectDescription, setProjectDescription] = useState("");
  const [selectedTeamId, setSelectedTeamId] = useState("");
  const [feedback, setFeedback] = useState<FeedbackState>({ message: null, error: null });

  const teamsQuery = useQuery({
    queryKey: queryKeys.teams,
    queryFn: () => apiFetch<TeamRecord[]>("/teams"),
  });

  const projectsQuery = useQuery({
    queryKey: queryKeys.projects,
    queryFn: () => apiFetch<ProjectRecord[]>("/projects"),
  });

  const platformOverviewQuery = useQuery({
    enabled: session?.user.globalRole === "platform_super_admin",
    queryKey: queryKeys.platformOverview,
    queryFn: () => apiFetch<PlatformOverviewResponse>("/admin/platform/overview"),
  });

  useEffect(() => {
    if (!selectedTeamId && teamsQuery.data?.[0]?.id) {
      setSelectedTeamId(teamsQuery.data[0].id);
    }
  }, [selectedTeamId, teamsQuery.data]);

  const createTeamMutation = useMutation({
    mutationFn: (payload: TeamCreationPayload) => apiFetch<TeamRecord>("/teams", {
      method: "POST",
      body: payload,
    }),
    onSuccess: async (team) => {
      setFeedback({ message: t("dashboard.createTeamSuccess", { name: team.name }), error: null });
      setTeamName("");
      await queryClient.invalidateQueries({ queryKey: queryKeys.teams });
      await queryClient.invalidateQueries({ queryKey: queryKeys.platformOverview });
    },
    onError: (error) => {
      setFeedback({ message: null, error: formatApiError(error, t, "dashboard.createTeamFailed") });
    },
  });

  const createProjectMutation = useMutation({
    mutationFn: (payload: ProjectCreationPayload) => apiFetch<ProjectRecord>("/projects", {
      method: "POST",
      body: payload,
    }),
    onSuccess: async (project) => {
      setFeedback({ message: t("dashboard.createProjectSuccess", { name: project.name }), error: null });
      setProjectName("");
      setProjectDescription("");
      await queryClient.invalidateQueries({ queryKey: queryKeys.projects });
      await queryClient.invalidateQueries({ queryKey: queryKeys.platformOverview });
    },
    onError: (error) => {
      setFeedback({ message: null, error: formatApiError(error, t, "dashboard.createProjectFailed") });
    },
  });

  const recentProjects = useMemo(() => {
    return [...(projectsQuery.data ?? [])]
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
      .slice(0, 4);
  }, [projectsQuery.data]);

  const canOpenPlatform = session?.user.globalRole === "platform_super_admin";
  const stats = [
    {
      label: t("dashboard.stats.teamsLabel"),
      value: teamsQuery.data?.length ?? 0,
      note: t("dashboard.stats.teamsNote"),
    },
    {
      label: t("dashboard.stats.projectsLabel"),
      value: projectsQuery.data?.length ?? 0,
      note: t("dashboard.stats.projectsNote"),
    },
    {
      label: t("dashboard.stats.queuedJobsLabel"),
      value: platformOverviewQuery.data?.metrics.queuedJobs ?? 0,
      note: t("dashboard.stats.queuedJobsNote"),
    },
    {
      label: t("dashboard.stats.pendingVersionsLabel"),
      value: platformOverviewQuery.data?.metrics.pendingReviewVersions ?? 0,
      note: t("dashboard.stats.pendingVersionsNote"),
    },
  ];

  const rootError = teamsQuery.error || projectsQuery.error || platformOverviewQuery.error;

  function submitTeam(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFeedback({ message: null, error: null });
    createTeamMutation.mutate({
      name: teamName,
      defaultReviewPolicy: "required",
    });
  }

  function submitProject(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFeedback({ message: null, error: null });
    createProjectMutation.mutate({
      teamId: selectedTeamId,
      name: projectName,
      description: projectDescription,
      reviewPolicyMode: "inherit",
    });
  }

  return (
    <div className="stack stack--page">
      <PageHeader
        kicker={t("dashboard.kicker")}
        title={t("dashboard.title", { name: session?.user.displayName ?? "Director" })}
        description={t("dashboard.description")}
        actions={(
          <div className="inline-actions inline-actions--wrap">
            {recentProjects[0] ? (
              <Link className="primary-btn" href={`/projects/${recentProjects[0].id}`}>
                {t("dashboard.continueProject")}
              </Link>
            ) : null}
            <Link className="secondary-btn" href="/admin/team">
              {t("nav.teamAdmin")}
            </Link>
            {canOpenPlatform ? (
              <Link className="secondary-btn" href="/admin/platform">
                {t("nav.platformAdmin")}
              </Link>
            ) : null}
          </div>
        )}
      />

      <InlineFeedback message={feedback.message} error={feedback.error} />

      {rootError && !teamsQuery.data && !projectsQuery.data ? (
        <ErrorState
          title={t("dashboard.loadErrorTitle")}
          description={formatApiError(rootError, t, "dashboard.loadErrorDescription")}
          action={(
            <button
              className="primary-btn"
              type="button"
              onClick={() => {
                void teamsQuery.refetch();
                void projectsQuery.refetch();
                void platformOverviewQuery.refetch();
              }}
            >
              {t("common.reload")}
            </button>
          )}
        />
      ) : null}

      <section className="stats-grid">
        {stats.map((stat) => (
          <div key={stat.label} className="stat-tile">
            <div className="muted">{stat.label}</div>
            <div className="metric">{stat.value}</div>
            <div className="stat-note">{stat.note}</div>
          </div>
        ))}
      </section>

      <section className="workspace-grid workspace-grid--dashboard" id="dashboard-quick-create">
        <SectionCard title={t("dashboard.createTeam.title")} description={t("dashboard.createTeam.description")}>
          <form className="stack stack--tight" onSubmit={submitTeam}>
            <label>
              {t("dashboard.createTeam.teamNameLabel")}
              <input
                value={teamName}
                onChange={(event) => setTeamName(event.target.value)}
                placeholder={t("dashboard.createTeam.teamNamePlaceholder")}
              />
            </label>
            <button className="primary-btn" type="submit" disabled={!teamName.trim() || createTeamMutation.isPending}>
              {createTeamMutation.isPending ? t("common.creating") : t("dashboard.createTeam.submit")}
            </button>
          </form>
        </SectionCard>

        <SectionCard title={t("dashboard.createProject.title")} description={t("dashboard.createProject.description")}>
          <form className="stack stack--tight" onSubmit={submitProject}>
            <label>
              {t("dashboard.createProject.teamLabel")}
              <select value={selectedTeamId} onChange={(event) => setSelectedTeamId(event.target.value)}>
                <option value="">{t("dashboard.createProject.teamPlaceholder")}</option>
                {(teamsQuery.data ?? []).map((team) => (
                  <option key={team.id} value={team.id}>
                    {team.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              {t("dashboard.createProject.nameLabel")}
              <input
                value={projectName}
                onChange={(event) => setProjectName(event.target.value)}
                placeholder={t("dashboard.createProject.namePlaceholder")}
              />
            </label>
            <label>
              {t("dashboard.createProject.descriptionLabel")}
              <textarea
                value={projectDescription}
                onChange={(event) => setProjectDescription(event.target.value)}
                placeholder={t("dashboard.createProject.descriptionPlaceholder")}
              />
            </label>
            <button
              className="primary-btn"
              type="submit"
              disabled={!selectedTeamId || !projectName.trim() || createProjectMutation.isPending}
            >
              {createProjectMutation.isPending ? t("common.creating") : t("dashboard.createProject.submit")}
            </button>
          </form>
        </SectionCard>
      </section>

      <section className="workspace-grid workspace-grid--dashboard">
        <SectionCard title={t("dashboard.nextSteps.title")} description={t("dashboard.nextSteps.description")}>
          <div className="stack stack--tight">
            <div className="task-hint">
              <strong>{t("dashboard.nextSteps.step1Title")}</strong>
              <p className="muted">
                {(teamsQuery.data?.length ?? 0) > 0 ? t("dashboard.nextSteps.step1Ready") : t("dashboard.nextSteps.step1Empty")}
              </p>
            </div>
            <div className="task-hint">
              <strong>{t("dashboard.nextSteps.step2Title")}</strong>
              <p className="muted">
                {recentProjects[0]
                  ? t("dashboard.nextSteps.step2Ready", { name: recentProjects[0].name })
                  : t("dashboard.nextSteps.step2Empty")}
              </p>
            </div>
            <div className="task-hint">
              <strong>{t("dashboard.nextSteps.step3Title")}</strong>
              <p className="muted">
                {t("dashboard.nextSteps.step3Summary", {
                  pending: platformOverviewQuery.data?.metrics.pendingReviewVersions ?? 0,
                  queued: platformOverviewQuery.data?.metrics.queuedJobs ?? 0,
                })}
              </p>
            </div>
          </div>
        </SectionCard>

        <SectionCard title={t("dashboard.recentProjects.title")} description={t("dashboard.recentProjects.description")}>
          {projectsQuery.isPending ? (
            <LoadingSkeleton rows={4} />
          ) : recentProjects.length > 0 ? (
            <div className="stack stack--tight">
              {recentProjects.map((project) => (
                <Link key={project.id} href={`/projects/${project.id}`} className="project-card project-card--compact">
                  <div>
                    <strong>{project.name}</strong>
                    <p className="muted">{project.description || t("dashboard.recentProjects.emptyProjectDescription")}</p>
                  </div>
                  <StatusBadge tone="info">{getReviewPolicyLabel(t, project.reviewPolicyMode)}</StatusBadge>
                </Link>
              ))}
            </div>
          ) : (
            <EmptyState
              title={t("dashboard.recentProjects.emptyTitle")}
              description={t("dashboard.recentProjects.emptyDescription")}
            />
          )}
        </SectionCard>
      </section>

      <section className="workspace-grid workspace-grid--dashboard">
        <SectionCard title={t("dashboard.teamsOverview.title")} description={t("dashboard.teamsOverview.description")}>
          {teamsQuery.isPending ? (
            <LoadingSkeleton rows={4} />
          ) : (teamsQuery.data?.length ?? 0) > 0 ? (
            <div className="stack stack--tight">
              {(teamsQuery.data ?? []).map((team) => (
                <div key={team.id} className="team-card">
                  <div>
                    <strong>{team.name}</strong>
                    <div className="muted">Slug: {team.slug}</div>
                  </div>
                  <StatusBadge tone={team.defaultReviewPolicy === "required" ? "warning" : "neutral"}>
                    {t("dashboard.teamsOverview.defaultReviewPolicy", {
                      mode: getReviewPolicyLabel(t, team.defaultReviewPolicy),
                    })}
                  </StatusBadge>
                </div>
              ))}
            </div>
          ) : (
            <EmptyState
              title={t("dashboard.teamsOverview.emptyTitle")}
              description={t("dashboard.teamsOverview.emptyDescription")}
            />
          )}
        </SectionCard>

        <SectionCard title={t("dashboard.platformOverview.title")} description={t("dashboard.platformOverview.description")}>
          {canOpenPlatform ? (
            platformOverviewQuery.isPending ? (
              <LoadingSkeleton rows={4} />
            ) : platformOverviewQuery.data ? (
              <div className="stack stack--tight">
                <div className="team-card">
                  <div>
                    <strong>{t("dashboard.platformOverview.metricsTitle")}</strong>
                    <div className="muted">
                      {t("dashboard.platformOverview.metricsSummary", {
                        users: platformOverviewQuery.data.metrics.users,
                        teams: platformOverviewQuery.data.metrics.teams,
                        projects: platformOverviewQuery.data.metrics.projects,
                      })}
                    </div>
                  </div>
                  <StatusBadge tone="info">{t("common.storagePrefix", { value: getStorageDriverLabel(t, platformOverviewQuery.data.storageDriver) })}</StatusBadge>
                </div>
                {platformOverviewQuery.data.recentJobs.slice(0, 3).map((job) => (
                  <div key={job.id} className="project-card project-card--compact">
                    <div>
                      <strong>{getJobTypeLabel(t, job.type)}</strong>
                      <div className="muted">{job.id}</div>
                      <div className="muted">{formatDate(job.updatedAt)}</div>
                    </div>
                    <StatusBadge tone={getJobTone(job.status)}>{getJobStatusLabel(t, job.status)}</StatusBadge>
                  </div>
                ))}
              </div>
            ) : (
              <EmptyState
                title={t("dashboard.platformOverview.unavailableTitle")}
                description={t("dashboard.platformOverview.unavailableDescription")}
              />
            )
          ) : (
            <div className="stack stack--tight">
              <p className="muted">{t("dashboard.platformOverview.nonAdminDescription")}</p>
              <Link className="secondary-btn" href="/admin/team">
                {t("dashboard.platformOverview.fallbackAction")}
              </Link>
            </div>
          )}
        </SectionCard>
      </section>
    </div>
  );
}