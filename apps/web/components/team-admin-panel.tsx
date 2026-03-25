"use client";

import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type {
  ProjectRole,
  TeamAdminOverviewResponse,
  TeamRecord,
  TeamRole,
} from "@dramaflow/shared";

import {
  getProjectRoleLabel,
  getReviewPolicyLabel,
  getTeamRoleLabel,
  getVersionStatusLabel,
  useI18n,
} from "../lib/i18n";
import { apiFetch, formatApiError } from "../lib/api";
import { queryKeys } from "../lib/query-keys";
import { EmptyState } from "./empty-state";
import { ErrorState } from "./error-state";
import { LoadingSkeleton } from "./loading-skeleton";
import { PageHeader } from "./page-header";
import { SectionCard } from "./section-card";
import { StatusBadge } from "./status-badge";

const TEAM_ROLES: TeamRole[] = ["tenant_owner", "tenant_admin", "member"];
const PROJECT_ROLES: ProjectRole[] = ["project_admin", "director", "writer", "artist", "reviewer", "viewer"];

function getInviteTone(status: string) {
  switch (status) {
    case "pending":
      return "warning" as const;
    case "accepted":
      return "success" as const;
    case "rejected":
    case "expired":
      return "danger" as const;
    default:
      return "neutral" as const;
  }
}

export function TeamAdminPanel() {
  const { t } = useI18n();
  const [selectedTeamId, setSelectedTeamId] = useState("");

  const teamsQuery = useQuery({
    queryKey: queryKeys.teams,
    queryFn: () => apiFetch<TeamRecord[]>("/teams"),
  });

  useEffect(() => {
    if (!selectedTeamId && teamsQuery.data?.[0]?.id) {
      setSelectedTeamId(teamsQuery.data[0].id);
    }
  }, [selectedTeamId, teamsQuery.data]);

  const overviewQuery = useQuery({
    enabled: Boolean(selectedTeamId),
    queryKey: queryKeys.teamOverview(selectedTeamId),
    queryFn: () => apiFetch<TeamAdminOverviewResponse>(`/admin/teams/${selectedTeamId}/overview`),
  });

  function translateInviteRole(role: string) {
    if (TEAM_ROLES.includes(role as TeamRole)) {
      return getTeamRoleLabel(t, role as TeamRole);
    }

    if (PROJECT_ROLES.includes(role as ProjectRole)) {
      return getProjectRoleLabel(t, role as ProjectRole);
    }

    return role;
  }

  return (
    <div className="stack stack--page">
      <PageHeader
        kicker={t("teamAdmin.kicker")}
        title={t("teamAdmin.title")}
        description={t("teamAdmin.description")}
      />

      {teamsQuery.error ? (
        <ErrorState
          title={t("teamAdmin.loadErrorTitle")}
          description={formatApiError(teamsQuery.error, t, "teamAdmin.loadErrorDescription")}
          action={(
            <button className="primary-btn" type="button" onClick={() => void teamsQuery.refetch()}>
              {t("common.reload")}
            </button>
          )}
        />
      ) : null}

      <SectionCard title={t("teamAdmin.switcher.title")} description={t("teamAdmin.switcher.description")}>
        {teamsQuery.isPending ? (
          <LoadingSkeleton rows={2} />
        ) : (
          <label>
            {t("teamAdmin.switcher.label")}
            <select value={selectedTeamId} onChange={(event) => setSelectedTeamId(event.target.value)}>
              <option value="">{t("teamAdmin.switcher.placeholder")}</option>
              {(teamsQuery.data ?? []).map((team) => (
                <option key={team.id} value={team.id}>
                  {team.name}
                </option>
              ))}
            </select>
          </label>
        )}
      </SectionCard>

      {!selectedTeamId && !teamsQuery.isPending ? (
        <EmptyState title={t("teamAdmin.noTeamTitle")} description={t("teamAdmin.noTeamDescription")} />
      ) : null}

      {overviewQuery.isPending ? <LoadingSkeleton rows={6} /> : null}

      {overviewQuery.error && selectedTeamId ? (
        <ErrorState
          title={t("teamAdmin.overviewLoadErrorTitle")}
          description={formatApiError(overviewQuery.error, t, "teamAdmin.overviewLoadErrorDescription")}
          action={(
            <button className="primary-btn" type="button" onClick={() => void overviewQuery.refetch()}>
              {t("common.reload")}
            </button>
          )}
        />
      ) : null}

      {overviewQuery.data ? (
        <section className="workspace-grid workspace-grid--dashboard">
          <SectionCard
            title={t("teamAdmin.members.title", { name: overviewQuery.data.team.name })}
            description={t("teamAdmin.members.description")}
          >
            <div className="stack stack--tight">
              <div className="team-card">
                <div>
                  <strong>{t("teamAdmin.members.defaultReviewPolicyTitle")}</strong>
                  <div className="muted">{t("teamAdmin.members.defaultReviewPolicyDescription")}</div>
                </div>
                <StatusBadge tone={overviewQuery.data.team.defaultReviewPolicy === "required" ? "warning" : "neutral"}>
                  {getReviewPolicyLabel(t, overviewQuery.data.team.defaultReviewPolicy)}
                </StatusBadge>
              </div>
              {overviewQuery.data.members.length > 0 ? (
                overviewQuery.data.members.map((member) => (
                  <div key={member.id} className="project-card project-card--compact">
                    <div>
                      <strong>{member.userId}</strong>
                      <div className="muted">{t("teamAdmin.members.memberHint")}</div>
                    </div>
                    <StatusBadge tone="info">{getTeamRoleLabel(t, member.role)}</StatusBadge>
                  </div>
                ))
              ) : (
                <EmptyState title={t("teamAdmin.members.emptyTitle")} description={t("teamAdmin.members.emptyDescription")} />
              )}
            </div>
          </SectionCard>

          <SectionCard title={t("teamAdmin.projects.title")} description={t("teamAdmin.projects.description")}>
            <div className="stack stack--tight">
              {overviewQuery.data.projects.length > 0 ? (
                overviewQuery.data.projects.map((project) => (
                  <div key={project.id} className="project-card project-card--compact">
                    <div>
                      <strong>{project.name}</strong>
                      <div className="muted">{t("teamAdmin.projects.modeHint")}</div>
                    </div>
                    <StatusBadge tone="info">{getReviewPolicyLabel(t, project.reviewPolicyMode)}</StatusBadge>
                  </div>
                ))
              ) : (
                <EmptyState title={t("teamAdmin.projects.emptyTitle")} description={t("teamAdmin.projects.emptyDescription")} />
              )}
            </div>
          </SectionCard>

          <SectionCard title={t("teamAdmin.queue.title")} description={t("teamAdmin.queue.description")}>
            <div className="stack stack--tight">
              <div className="stack stack--tight">
                <strong>{t("teamAdmin.queue.pendingVersionsTitle")}</strong>
                {overviewQuery.data.pendingReviews.length > 0 ? (
                  overviewQuery.data.pendingReviews.map((version) => (
                    <div key={version.id} className="job-row">
                      <div>
                        <strong>{version.title}</strong>
                        <div className="muted">{t("teamAdmin.queue.pendingVersionHint")}</div>
                      </div>
                      <StatusBadge tone="warning">{getVersionStatusLabel(t, version.status)}</StatusBadge>
                    </div>
                  ))
                ) : (
                  <EmptyState
                    title={t("teamAdmin.queue.pendingEmptyTitle")}
                    description={t("teamAdmin.queue.pendingEmptyDescription")}
                  />
                )}
              </div>

              <div className="stack stack--tight">
                <strong>{t("teamAdmin.queue.invitesTitle")}</strong>
                {overviewQuery.data.projectInvites.length > 0 ? (
                  overviewQuery.data.projectInvites.map((invite) => (
                    <div key={invite.id} className="job-row">
                      <div>
                        <strong>{invite.email}</strong>
                        <div className="muted">{t("teamAdmin.queue.inviteRoleHint", { role: translateInviteRole(invite.role) })}</div>
                      </div>
                      <StatusBadge tone={getInviteTone(invite.status)}>{invite.status}</StatusBadge>
                    </div>
                  ))
                ) : (
                  <EmptyState title={t("teamAdmin.queue.invitesEmptyTitle")} description={t("teamAdmin.queue.invitesEmptyDescription")} />
                )}
              </div>
            </div>
          </SectionCard>
        </section>
      ) : null}
    </div>
  );
}