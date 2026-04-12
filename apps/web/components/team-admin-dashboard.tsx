/**
 * @fileoverview 团队管理仪表盘
 * @module web/components
 *
 * 团队管理员的成员、项目和审核统计界面。
 */

"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { TeamAdminOverviewResponse, TeamInviteLinkSummary, TeamRole, TeamSummary } from "@dramaflow/shared";

import { apiFetch, formatApiError } from "../lib/api";
import { useI18n, getProjectRoleLabel, getReviewPolicyLabel, getTeamRoleLabel, getVersionStatusLabel } from "../lib/i18n";
import { useSession } from "../lib/use-session";
import { queryKeys } from "../lib/query-keys";
import { ConfirmAction } from "./confirm-action";
import { ErrorState } from "./error-state";
import { InlineFeedback } from "./inline-feedback";
import { LoadingSkeleton } from "./loading-skeleton";

const AVATAR_COLORS = [
  "linear-gradient(135deg, #38bdf8, #a78bfa)",
  "linear-gradient(135deg, #34d399, #38bdf8)",
  "linear-gradient(135deg, #f472b6, #a78bfa)",
  "linear-gradient(135deg, #fbbf24, #f472b6)",
  "linear-gradient(135deg, #a78bfa, #38bdf8)",
  "linear-gradient(135deg, #38bdf8, #34d399)",
];

function getAvatarColor(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
}

function getInitials(name: string): string {
  const words = name.trim().split(/\s+/);
  if (words.length >= 2) {
    return (words[0][0] + words[1][0]).toUpperCase();
  }
  return name.slice(0, 2).toUpperCase();
}

function UsersIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
      <circle cx="7" cy="6" r="3" stroke="currentColor" strokeWidth="1.5" />
      <path d="M1.5 15.5c0-2.5 2-4.5 5.5-4.5s5.5 2 5.5 4.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <circle cx="13" cy="5.5" r="2" stroke="currentColor" strokeWidth="1.3" />
      <path d="M13.5 10.5c1.5.3 3 1.5 3 3.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
    </svg>
  );
}

function FolderIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
      <path d="M2 5.5c0-1.1.9-2 2-2h3l1.5 2H14c1.1 0 2 .9 2 2v5c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V5.5z" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}

function SearchIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <circle cx="7" cy="7" r="4.5" stroke="currentColor" strokeWidth="1.5" />
      <path d="M10.5 10.5L14 14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

const TEAM_ROLES: TeamRole[] = ["tenant_owner", "tenant_admin", "member"];

export function TeamAdminDashboard() {
  const queryClient = useQueryClient();
  const { formatDate, t } = useI18n();
  const { session } = useSession();
  const [selectedTeamId, setSelectedTeamId] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<TeamRole>("member");
  const [feedback, setFeedback] = useState<{ message: string | null; error: string | null }>({ message: null, error: null });
  const [memberSearch, setMemberSearch] = useState("");
  const [projectSearch, setProjectSearch] = useState("");
  const [linkRole, setLinkRole] = useState<TeamRole>("member");
  const [linkExpires, setLinkExpires] = useState<number>(0);
  const [linkMaxUses, setLinkMaxUses] = useState<number>(0);
  const [generatedLink, setGeneratedLink] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const currentUserId = session?.user.id ?? "";

  const teamsQuery = useQuery({
    queryKey: queryKeys.teams,
    queryFn: () => apiFetch<TeamSummary[]>("/teams"),
  });

  const manageableTeams = useMemo(
    () => (teamsQuery.data ?? []).filter((team) => team.canManage),
    [teamsQuery.data],
  );

  useEffect(() => {
    if (!selectedTeamId || !manageableTeams.some((team) => team.id === selectedTeamId)) {
      setSelectedTeamId(manageableTeams[0]?.id ?? "");
    }
  }, [manageableTeams, selectedTeamId]);

  const overviewQuery = useQuery({
    queryKey: queryKeys.teamOverview(selectedTeamId),
    queryFn: () => apiFetch<TeamAdminOverviewResponse>(`/admin/teams/${selectedTeamId}/overview`),
    enabled: Boolean(selectedTeamId),
  });

  const inviteLinksQuery = useQuery({
    queryKey: ["teamInviteLinks", selectedTeamId],
    queryFn: () => apiFetch<TeamInviteLinkSummary[]>(`/teams/${selectedTeamId}/invite-links`),
    enabled: Boolean(selectedTeamId),
  });

  const invalidateTeamData = async () => {
    await queryClient.invalidateQueries({ queryKey: queryKeys.teamOverview(selectedTeamId) });
    await queryClient.invalidateQueries({ queryKey: queryKeys.teams });
    await queryClient.invalidateQueries({ queryKey: ["teamInviteLinks", selectedTeamId] });
  };

  const addMemberMutation = useMutation({
    mutationFn: () => apiFetch(`/teams/${selectedTeamId}/members`, {
      method: "POST",
      body: { email, role },
    }),
    onSuccess: async () => {
      setEmail("");
      setRole("member");
      setFeedback({ message: t("teamAdmin.members.addSuccess"), error: null });
      await invalidateTeamData();
    },
    onError: (error) => setFeedback({ message: null, error: formatApiError(error, t, "teamAdmin.members.addError") }),
  });

  const removeMemberMutation = useMutation({
    mutationFn: (memberId: string) => apiFetch(`/teams/${selectedTeamId}/members/${memberId}`, {
      method: "DELETE",
    }),
    onSuccess: async () => {
      setFeedback({ message: t("teamAdmin.members.removeSuccess"), error: null });
      await invalidateTeamData();
    },
    onError: (error) => setFeedback({ message: null, error: formatApiError(error, t, "teamAdmin.members.removeError") }),
  });

  const changeRoleMutation = useMutation({
    mutationFn: (params: { memberId: string; role: TeamRole }) => apiFetch(`/teams/${selectedTeamId}/members/${params.memberId}`, {
      method: "PATCH",
      body: { role: params.role },
    }),
    onSuccess: async () => {
      setFeedback({ message: t("teamAdmin.members.changeRoleSuccess"), error: null });
      await invalidateTeamData();
    },
    onError: (error) => setFeedback({ message: null, error: formatApiError(error, t, "teamAdmin.members.changeRoleError") }),
  });

  const createLinkMutation = useMutation({
    mutationFn: () => apiFetch<TeamInviteLinkSummary>(`/teams/${selectedTeamId}/invite-links`, {
      method: "POST",
      body: {
        role: linkRole,
        maxUses: linkMaxUses || undefined,
        expiresInHours: linkExpires || undefined,
      },
    }),
    onSuccess: async (data) => {
      const url = `${window.location.origin}/join/team?token=${data.token}`;
      setGeneratedLink(url);
      setFeedback({ message: t("teamAdmin.inviteLinks.generateSuccess"), error: null });
      await invalidateTeamData();
    },
    onError: (error) => setFeedback({ message: null, error: formatApiError(error, t, "teamAdmin.inviteLinks.generateError") }),
  });

  const revokeLinkMutation = useMutation({
    mutationFn: (linkId: string) => apiFetch(`/teams/${selectedTeamId}/invite-links/${linkId}`, {
      method: "DELETE",
    }),
    onSuccess: async () => {
      setFeedback({ message: t("teamAdmin.inviteLinks.revokeSuccess"), error: null });
      await invalidateTeamData();
    },
    onError: (error) => setFeedback({ message: null, error: formatApiError(error, t, "teamAdmin.inviteLinks.revokeError") }),
  });

  const handleCopyLink = async (url: string) => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback
    }
  };

  const filteredMembers = useMemo(() => {
    const members = overviewQuery.data?.members ?? [];
    if (!memberSearch.trim()) return members;
    const q = memberSearch.toLowerCase();
    return members.filter(
      (m) => m.displayName.toLowerCase().includes(q) || m.email.toLowerCase().includes(q),
    );
  }, [overviewQuery.data?.members, memberSearch]);

  const filteredProjects = useMemo(() => {
    const projects = overviewQuery.data?.projects ?? [];
    if (!projectSearch.trim()) return projects;
    const q = projectSearch.toLowerCase();
    return projects.filter(
      (p) => p.name.toLowerCase().includes(q) || (p.description && p.description.toLowerCase().includes(q)),
    );
  }, [overviewQuery.data?.projects, projectSearch]);

  if (teamsQuery.isPending) {
    return <LoadingSkeleton variant="hero" rows={8} />;
  }

  if (teamsQuery.error) {
    return (
      <ErrorState
        title={t("teamAdmin.loadErrorTitle")}
        description={formatApiError(teamsQuery.error, t, "teamAdmin.loadErrorDescription")}
        action={<button className="btn btn-secondary" type="button" onClick={() => void teamsQuery.refetch()}>{t("common.reload")}</button>}
      />
    );
  }

  const teams = manageableTeams;
  if (teams.length === 0) {
    return (
      <ErrorState
        title={t("teamAdmin.noTeamTitle")}
        description={t("teamAdmin.noTeamDescription")}
        action={<Link href="/dashboard" className="btn btn-secondary">{t("nav.dashboard")}</Link>}
      />
    );
  }

  return (
    <div className="animate-fade-in" style={{ maxWidth: "1400px", margin: "0 auto" }}>
      {/* Hero */}
      <div className="team-hero" style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "var(--space-6)" }}>
        <div>
          <div className="team-hero-kicker">{t("teamAdmin.kicker")}</div>
          <h1 className="team-hero-title">{t("teamAdmin.title")}</h1>
          <p className="team-hero-desc">{t("teamAdmin.description")}</p>
        </div>
        <div className="team-switcher">
          <label className="team-switcher-label" htmlFor="team-switcher">
            {t("teamAdmin.switcher.label")}
          </label>
          <select
            id="team-switcher"
            className="input"
            value={selectedTeamId}
            onChange={(event) => setSelectedTeamId(event.target.value)}
          >
            {teams.map((team) => (
              <option key={team.id} value={team.id}>{team.name}</option>
            ))}
          </select>
        </div>
      </div>

      <InlineFeedback message={feedback.message} error={feedback.error} />

      {overviewQuery.isPending ? (
        <LoadingSkeleton rows={10} />
      ) : overviewQuery.error ? (
        <ErrorState
          title={t("teamAdmin.overviewLoadErrorTitle")}
          description={formatApiError(overviewQuery.error, t, "teamAdmin.overviewLoadErrorDescription")}
          action={<button className="btn btn-secondary" type="button" onClick={() => void overviewQuery.refetch()}>{t("common.reload")}</button>}
        />
      ) : !overviewQuery.data ? (
        <LoadingSkeleton rows={10} />
      ) : (
        <>
          {/* Stats */}
          <div className="team-stats">
            {[
              { value: overviewQuery.data.members.length, label: t("nav.teamMembers") },
              { value: overviewQuery.data.projects.length, label: t("nav.projects") },
              { value: overviewQuery.data.pendingReviews.length, label: t("teamAdmin.queue.pendingVersionsTitle") },
              { value: overviewQuery.data.projectInvites.length, label: t("teamAdmin.queue.invitesTitle") },
            ].map((stat, index) => (
              <div key={index} className="team-stat">
                <div className="team-stat-value">{stat.value}</div>
                <div className="team-stat-label">{stat.label}</div>
              </div>
            ))}
          </div>

          {/* Members Section */}
          <section className="team-section">
            <div className="team-section-header">
              <h2 className="team-section-title">
                {t("teamAdmin.members.title", { name: overviewQuery.data.team.name })}
              </h2>
              <p className="team-section-desc">
                {t("teamAdmin.members.description")}
              </p>
            </div>

            {/* Review Policy + Add Member */}
            <div className="team-split-row">
              <div className="team-info-card">
                <div className="team-info-card-title">
                  {t("teamAdmin.members.defaultReviewPolicyTitle")}
                </div>
                <p className="team-info-card-desc">
                  {t("teamAdmin.members.defaultReviewPolicyDescription")}
                </p>
                <span className="team-review-badge">
                  {getReviewPolicyLabel(t, overviewQuery.data.team.defaultReviewPolicy)}
                </span>
              </div>

              <div className="team-form-card">
                <div className="team-form-card-title">
                  {t("teamAdmin.members.addTitle")}
                </div>
                <div className="stack stack-gap-3">
                  <div className="form-group">
                    <label className="form-label" htmlFor="team-member-email">
                      {t("teamAdmin.members.emailLabel")}
                    </label>
                    <input
                      id="team-member-email"
                      className="input"
                      type="email"
                      value={email}
                      onChange={(event) => setEmail(event.target.value)}
                      placeholder={t("teamAdmin.members.emailPlaceholder")}
                    />
                  </div>
                  <div className="form-group">
                    <label className="form-label" htmlFor="team-member-role">
                      {t("teamAdmin.members.roleLabel")}
                    </label>
                    <select
                      id="team-member-role"
                      className="input"
                      value={role}
                      onChange={(event) => setRole(event.target.value as TeamRole)}
                    >
                      {TEAM_ROLES.map((value) => (
                        <option key={value} value={value}>{getTeamRoleLabel(t, value)}</option>
                      ))}
                    </select>
                  </div>
                  <button
                    className="btn btn-primary"
                    type="button"
                    onClick={() => addMemberMutation.mutate()}
                    disabled={addMemberMutation.isPending || !email.trim()}
                    style={{ marginTop: "var(--space-1)" }}
                  >
                    {addMemberMutation.isPending ? t("common.submitting") : t("teamAdmin.members.submitAction")}
                  </button>
                </div>
              </div>
            </div>

            {/* Members List */}
            <div className="team-section-divider">
              <UsersIcon />
              <span>{t("nav.teamMembers")}</span>
              <span className="team-section-divider-count">{overviewQuery.data.members.length}</span>
            </div>

            {overviewQuery.data.members.length > 0 && (
              <div className="team-search">
                <div className="team-search-icon"><SearchIcon /></div>
                <input
                  className="input"
                  placeholder={t("teamAdmin.members.searchPlaceholder")}
                  value={memberSearch}
                  onChange={(e) => setMemberSearch(e.target.value)}
                />
              </div>
            )}

            {overviewQuery.data.members.length === 0 ? (
              <div className="team-empty">
                <div className="team-empty-icon"><UsersIcon /></div>
                <div className="team-empty-title">{t("teamAdmin.members.emptyTitle")}</div>
                <div className="team-empty-desc">{t("teamAdmin.members.emptyDescription")}</div>
              </div>
            ) : filteredMembers.length === 0 ? (
              <div className="team-empty">
                <div className="team-empty-icon"><SearchIcon /></div>
                <div className="team-empty-title">{t("teamAdmin.members.emptyTitle")}</div>
              </div>
            ) : (
              <div>
                {filteredMembers.map((member) => {
                  const isSelf = member.userId === currentUserId;
                  const isOwner = member.role === "tenant_owner";
                  return (
                    <div key={member.id} className="team-member">
                      <div
                        className="team-member-avatar"
                        style={{ background: getAvatarColor(member.displayName || member.email) }}
                      >
                        {getInitials(member.displayName || member.email)}
                      </div>
                      <div className="team-member-info">
                        <div className="team-member-name">{member.displayName}</div>
                        <div className="team-member-email">{member.email}</div>
                      </div>
                      <div className="team-member-actions">
                        <select
                          className="team-member-role-select"
                          value={member.role}
                          onChange={(e) => changeRoleMutation.mutate({ memberId: member.id, role: e.target.value as TeamRole })}
                          disabled={changeRoleMutation.isPending || isSelf}
                        >
                          {TEAM_ROLES.map((r) => (
                            <option key={r} value={r}>{getTeamRoleLabel(t, r)}</option>
                          ))}
                        </select>
                        {!isSelf && !isOwner && (
                          <ConfirmAction
                            label={t("teamAdmin.members.removeAction")}
                            confirmLabel={t("teamAdmin.members.removeConfirm")}
                            tone="danger"
                            onConfirm={() => removeMemberMutation.mutate(member.id)}
                          />
                        )}
                        {isSelf && (
                          <span className="team-member-badge" style={{ background: "var(--accent-subtle)", borderColor: "rgba(56,189,248,0.25)", color: "var(--accent)" }}>
                            You
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </section>

          {/* Invite Links Section */}
          <section className="team-section">
            <div className="team-section-header">
              <h2 className="team-section-title">{t("teamAdmin.inviteLinks.title")}</h2>
              <p className="team-section-desc">{t("teamAdmin.inviteLinks.description")}</p>
            </div>

            <div className="team-split-row">
              <div className="team-form-card">
                <div className="team-form-card-title">
                  {t("teamAdmin.inviteLinks.generateTitle")}
                </div>
                <div className="stack stack-gap-3">
                  <div className="form-group">
                    <label className="form-label" htmlFor="invite-link-role">
                      {t("teamAdmin.inviteLinks.roleLabel")}
                    </label>
                    <select
                      id="invite-link-role"
                      className="input"
                      value={linkRole}
                      onChange={(e) => setLinkRole(e.target.value as TeamRole)}
                    >
                      {TEAM_ROLES.map((r) => (
                        <option key={r} value={r}>{getTeamRoleLabel(t, r)}</option>
                      ))}
                    </select>
                  </div>
                  <div className="form-group">
                    <label className="form-label" htmlFor="invite-link-expires">
                      {t("teamAdmin.inviteLinks.expiresLabel")}
                    </label>
                    <select
                      id="invite-link-expires"
                      className="input"
                      value={linkExpires}
                      onChange={(e) => setLinkExpires(Number(e.target.value))}
                    >
                      <option value={0}>{t("teamAdmin.inviteLinks.expiresNever")}</option>
                      <option value={24}>{t("teamAdmin.inviteLinks.expires24h")}</option>
                      <option value={168}>{t("teamAdmin.inviteLinks.expires7d")}</option>
                      <option value={720}>{t("teamAdmin.inviteLinks.expires30d")}</option>
                    </select>
                  </div>
                  <div className="form-group">
                    <label className="form-label" htmlFor="invite-link-max-uses">
                      {t("teamAdmin.inviteLinks.maxUsesLabel")}
                    </label>
                    <select
                      id="invite-link-max-uses"
                      className="input"
                      value={linkMaxUses}
                      onChange={(e) => setLinkMaxUses(Number(e.target.value))}
                    >
                      <option value={0}>{t("teamAdmin.inviteLinks.maxUsesUnlimited")}</option>
                      <option value={10}>{t("teamAdmin.inviteLinks.maxUses10")}</option>
                      <option value={50}>{t("teamAdmin.inviteLinks.maxUses50")}</option>
                    </select>
                  </div>
                  <button
                    className="btn btn-primary"
                    type="button"
                    onClick={() => { setGeneratedLink(null); createLinkMutation.mutate(); }}
                    disabled={createLinkMutation.isPending}
                    style={{ marginTop: "var(--space-1)" }}
                  >
                    {createLinkMutation.isPending ? t("common.submitting") : t("teamAdmin.inviteLinks.generateAction")}
                  </button>

                  {generatedLink && (
                    <div className="team-invite-link-generated">
                      <span className="team-invite-link-url">{generatedLink}</span>
                      <button
                        className="team-invite-link-copy-btn"
                        type="button"
                        onClick={() => void handleCopyLink(generatedLink)}
                      >
                        {copied ? t("teamAdmin.inviteLinks.copiedAction") : t("teamAdmin.inviteLinks.copyAction")}
                      </button>
                    </div>
                  )}
                </div>
              </div>

              {/* Active Links List */}
              <div className="team-info-card">
                <div className="team-info-card-title">
                  {t("teamAdmin.inviteLinks.activeLinksTitle")}
                </div>
                {!inviteLinksQuery.data || inviteLinksQuery.data.length === 0 ? (
                  <p className="team-info-card-desc">{t("teamAdmin.inviteLinks.emptyDescription")}</p>
                ) : (
                  <div>
                    {inviteLinksQuery.data.map((link) => {
                      const isExpired = link.expiresAt ? new Date(link.expiresAt) < new Date() : false;
                      const isExhausted = link.maxUses > 0 && link.uses >= link.maxUses;
                      const linkUrl = `${typeof window !== "undefined" ? window.location.origin : ""}/join/team?token=${link.token}`;
                      return (
                        <div key={link.id} className="team-invite-link-item">
                          <div className="team-invite-link-item-info">
                            <div className="team-invite-link-item-token">{link.token.slice(0, 16)}...</div>
                            <div className="team-invite-link-item-meta">
                              <span>{getTeamRoleLabel(t, link.role)}</span>
                              <span>·</span>
                              <span>
                                {link.maxUses > 0
                                  ? t("teamAdmin.inviteLinks.usesLabel", { uses: link.uses, max: link.maxUses })
                                  : t("teamAdmin.inviteLinks.usesUnlimited", { uses: link.uses })}
                              </span>
                              {isExpired && <span className="team-invite-link-badge team-invite-link-badge--expired">{t("teamAdmin.inviteLinks.expiredBadge")}</span>}
                              {isExhausted && <span className="team-invite-link-badge team-invite-link-badge--exhausted">{t("teamAdmin.inviteLinks.exhaustedBadge")}</span>}
                            </div>
                          </div>
                          <div className="team-invite-link-item-actions">
                            <button
                              className="team-invite-link-copy-btn"
                              type="button"
                              onClick={() => void handleCopyLink(linkUrl)}
                            >
                              {t("teamAdmin.inviteLinks.copyAction")}
                            </button>
                            <ConfirmAction
                              label={t("teamAdmin.inviteLinks.revokeAction")}
                              confirmLabel={t("teamAdmin.inviteLinks.revokeConfirm")}
                              tone="danger"
                              onConfirm={() => revokeLinkMutation.mutate(link.id)}
                            />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          </section>

          {/* Projects Section */}
          <section className="team-section">
            <div className="team-section-header">
              <h2 className="team-section-title">{t("teamAdmin.projects.title")}</h2>
              <p className="team-section-desc">{t("teamAdmin.projects.description")}</p>
            </div>

            <div className="team-section-divider">
              <FolderIcon />
              <span>{t("nav.projects")}</span>
              <span className="team-section-divider-count">{overviewQuery.data.projects.length}</span>
            </div>

            {overviewQuery.data.projects.length > 0 && (
              <div className="team-search">
                <div className="team-search-icon"><SearchIcon /></div>
                <input
                  className="input"
                  placeholder={t("teamAdmin.projects.searchPlaceholder")}
                  value={projectSearch}
                  onChange={(e) => setProjectSearch(e.target.value)}
                />
              </div>
            )}

            {overviewQuery.data.projects.length === 0 ? (
              <div className="team-empty">
                <div className="team-empty-icon"><FolderIcon /></div>
                <div className="team-empty-title">{t("teamAdmin.projects.emptyTitle")}</div>
                <div className="team-empty-desc">{t("teamAdmin.projects.emptyDescription")}</div>
              </div>
            ) : filteredProjects.length === 0 ? (
              <div className="team-empty">
                <div className="team-empty-icon"><SearchIcon /></div>
                <div className="team-empty-title">{t("teamAdmin.projects.emptyTitle")}</div>
              </div>
            ) : (
              <div>
                {filteredProjects.map((project) => (
                  <div key={project.id} className="team-project">
                    <div
                      className="team-project-avatar"
                      style={{ background: getAvatarColor(project.name) }}
                    >
                      {getInitials(project.name)}
                    </div>
                    <div className="team-project-info">
                      <Link href={`/projects/${project.id}`} className="team-project-name">
                        {project.name}
                      </Link>
                      <div className="team-project-desc">
                        {project.description || t("common.noDescription")}
                      </div>
                      <div className="team-project-meta">
                        <span>{formatDate(project.updatedAt, { year: "numeric", month: "2-digit", day: "2-digit" })}</span>
                        <span className="team-project-meta-dot">·</span>
                        <span>{t("teamAdmin.projects.memberCount", { count: project.memberCount })}</span>
                      </div>
                    </div>
                    <div className="team-project-actions">
                      <span className="team-project-policy">
                        {getReviewPolicyLabel(t, project.reviewPolicyMode)}
                      </span>
                      <Link href={`/projects/${project.id}`} className="team-project-link">
                        {t("teamAdmin.projects.openProject")}
                        <span className="team-project-link-arrow">→</span>
                      </Link>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>

          {/* Queue Section */}
          <section className="team-section">
            <div className="team-section-header">
              <h2 className="team-section-title">{t("teamAdmin.queue.title")}</h2>
              <p className="team-section-desc">{t("teamAdmin.queue.description")}</p>
            </div>

            <div className="team-queue-grid">
              {/* Pending Reviews */}
              <div>
                <div className="team-queue-column-header">
                  {t("teamAdmin.queue.pendingVersionsTitle")}
                </div>
                {overviewQuery.data.pendingReviews.length === 0 ? (
                  <div className="team-empty">
                    <div className="team-empty-title">{t("teamAdmin.queue.pendingEmptyTitle")}</div>
                    <div className="team-empty-desc">{t("teamAdmin.queue.pendingEmptyDescription")}</div>
                  </div>
                ) : (
                  <div>
                    {overviewQuery.data.pendingReviews.map((version) => (
                      <div key={version.id} className="team-queue-item">
                        <div>
                          <div className="team-queue-item-title">{version.title}</div>
                          <div className="team-queue-item-subtitle">
                            {version.projectName} · {version.documentTitle}
                          </div>
                          <div className="team-queue-item-date">
                            {formatDate(version.createdAt, { year: "numeric", month: "2-digit", day: "2-digit" })}
                          </div>
                        </div>
                        <div className="team-queue-item-footer">
                          <span className="team-queue-badge-warning">
                            {getVersionStatusLabel(t, version.status)}
                          </span>
                          <Link href={`/projects/${version.projectId}/review`} className="team-project-link">
                            {t("teamAdmin.queue.reviewVersionAction")}
                            <span className="team-project-link-arrow">→</span>
                          </Link>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Project Invites */}
              <div>
                <div className="team-queue-column-header">
                  {t("teamAdmin.queue.invitesTitle")}
                </div>
                {overviewQuery.data.projectInvites.length === 0 ? (
                  <div className="team-empty">
                    <div className="team-empty-title">{t("teamAdmin.queue.invitesEmptyTitle")}</div>
                    <div className="team-empty-desc">{t("teamAdmin.queue.invitesEmptyDescription")}</div>
                  </div>
                ) : (
                  <div>
                    {overviewQuery.data.projectInvites.map((invite) => (
                      <div key={invite.id} className="team-queue-item">
                        <div>
                          <div className="team-queue-item-title">{invite.email}</div>
                          <div className="team-queue-item-subtitle">{invite.projectName}</div>
                          <div className="team-queue-item-date">
                            {formatDate(invite.createdAt, { year: "numeric", month: "2-digit", day: "2-digit" })}
                          </div>
                        </div>
                        <div style={{ marginTop: "var(--space-3)" }}>
                          <span className="team-queue-badge-info">
                            {getProjectRoleLabel(t, invite.role)}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </section>
        </>
      )}
    </div>
  );
}
