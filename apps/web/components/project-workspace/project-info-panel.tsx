/**
 * @fileoverview 项目信息面板
 * @module web/components/project-workspace
 *
 * 项目基本信息展示和成员管理。
 */

"use client";

import { useCallback, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { ProjectRole, ProjectWorkspacePayload } from "@dramaflow/shared";

import { useI18n, getProjectRoleLabel, getReviewPolicyLabel, getVersionStatusLabel } from "../../lib/i18n";
import { apiFetch, formatApiError } from "../../lib/api";
import { useFeedback } from "../../lib/hooks";
import { queryKeys } from "../../lib/query-keys";
import { InlineFeedback } from "../inline-feedback";
import { ReviewPolicySwitcher } from "../review-policy-switcher";
import { AuditConfigPanel } from "./audit-config-panel";

/* ── Inline SVG Icons ── */
function MembersIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
      <circle cx="9" cy="6" r="3" stroke="currentColor" strokeWidth="1.5" />
      <path d="M3 16c0-3.314 2.686-6 6-6s6 2.686 6 6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

function ReviewIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
      <circle cx="9" cy="9" r="6.5" stroke="currentColor" strokeWidth="1.5" />
      <path d="M6.5 9l1.5 1.5L11.5 7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function InviteIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
      <rect x="2" y="4" width="14" height="10" rx="2" stroke="currentColor" strokeWidth="1.5" />
      <path d="M2 6l7 4 7-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

function PencilIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" />
      <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" />
    </svg>
  );
}

const AVATAR_GRADIENTS = [
  "linear-gradient(135deg, #38bdf8, #a78bfa)",
  "linear-gradient(135deg, #34d399, #38bdf8)",
  "linear-gradient(135deg, #f472b6, #a78bfa)",
  "linear-gradient(135deg, #fbbf24, #f472b6)",
  "linear-gradient(135deg, #a78bfa, #38bdf8)",
  "linear-gradient(135deg, #38bdf8, #34d399)",
];

function avatarGradient(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  return AVATAR_GRADIENTS[Math.abs(hash) % AVATAR_GRADIENTS.length];
}

function initials(name: string): string {
  const words = name.trim().split(/\s+/);
  if (words.length >= 2) return (words[0][0] + words[1][0]).toUpperCase();
  return name.slice(0, 2).toUpperCase();
}

interface Props {
  projectId: string;
  payload: ProjectWorkspacePayload;
  onNavigateToVersion?: (documentId: string, versionId: string) => void;
}

export function ProjectInfoPanel({ projectId, payload, onNavigateToVersion }: Props) {
  const queryClient = useQueryClient();
  const { formatDate, t } = useI18n();
  const { feedback, setFeedback } = useFeedback();
  const [memberEmail, setMemberEmail] = useState("");
  const [memberRole, setMemberRole] = useState<ProjectRole>("viewer");
  const [showAddMember, setShowAddMember] = useState(false);
  const [editingField, setEditingField] = useState<"name" | "description" | null>(null);
  const [draftValue, setDraftValue] = useState("");

  const project = payload.project;

  const { mutate: updateProject, isPending: isUpdating } = useMutation({
    mutationFn: (body: { name?: string; description?: string }) =>
      apiFetch(`/projects/${projectId}`, {
        method: "PATCH",
        body,
      }),
    onSuccess: async () => {
      setEditingField(null);
      setFeedback({ message: t("projectWorkspace.overview.updateSuccess"), error: null });
      await queryClient.invalidateQueries({ queryKey: queryKeys.project(projectId) });
    },
    onError: (error) => setFeedback({ message: null, error: formatApiError(error, t, "projectWorkspace.overview.updateFailed") }),
  });

  const startEdit = useCallback((field: "name" | "description") => {
    setDraftValue(field === "name" ? (project?.name ?? "") : (project?.description ?? ""));
    setEditingField(field);
  }, [project?.name, project?.description]);

  const saveEdit = useCallback(() => {
    const trimmed = draftValue.trim();
    if (editingField === "name") {
      if (!trimmed) return;
      if (trimmed === (project?.name ?? "").trim()) {
        setEditingField(null);
        return;
      }
      updateProject({ name: trimmed });
    } else if (editingField === "description") {
      if (trimmed === (project?.description ?? "").trim()) {
        setEditingField(null);
        return;
      }
      updateProject({ description: trimmed });
    }
  }, [draftValue, editingField, project?.name, project?.description]);

  const cancelEdit = useCallback(() => {
    setEditingField(null);
  }, []);

  const addProjectMemberMutation = useMutation({
    mutationFn: () => apiFetch(`/projects/${projectId}/members`, {
      method: "POST",
      body: {
        email: memberEmail,
        role: memberRole,
      },
    }),
    onSuccess: async () => {
      setMemberEmail("");
      setMemberRole("viewer");
      setShowAddMember(false);
      setFeedback({ message: t("projectWorkspace.collaboration.assignSuccess"), error: null });
      await queryClient.invalidateQueries({ queryKey: queryKeys.project(projectId) });
    },
    onError: (error) => setFeedback({ message: null, error: formatApiError(error, t, "projectWorkspace.collaboration.assignFailed") }),
  });

  return (
    <div className="pip-root animate-fade-in">
      {/* Header */}
      <header className="pip-header">
        <div className="pip-header__top">
          <div style={{ display: "flex", alignItems: "flex-start", gap: "var(--space-4)" }}>
            <div
              className="pip-project-avatar"
              style={{ background: avatarGradient(project?.name ?? "") }}
            >
              {initials(project?.name ?? "PR")}
            </div>
            <div>
              <span className="kicker">{t("projectWorkspace.overview.kicker")}</span>
              {editingField === "name" ? (
                <div>
                  <input
                    className="pip-edit-input"
                    value={draftValue}
                    onChange={(e) => setDraftValue(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") { e.preventDefault(); saveEdit(); }
                      if (e.key === "Escape") cancelEdit();
                    }}
                    aria-label={t("projectWorkspace.overview.editName")}
                    autoFocus
                  />
                  <div className="pip-edit-actions">
                    <button
                      className="btn btn-primary"
                      type="button"
                      onClick={saveEdit}
                      disabled={isUpdating || !draftValue.trim()}
                    >
                      {isUpdating ? t("common.submitting") : t("common.save")}
                    </button>
                    <button className="btn" type="button" onClick={cancelEdit}>
                      {t("common.cancel")}
                    </button>
                  </div>
                </div>
              ) : (
                <div className="pip-editable-field" style={{ margin: "var(--space-2) 0 var(--space-1)" }}>
                  <h2 className="pip-title">{project?.name ?? t("common.loading")}</h2>
                  <button
                    className="pip-edit-btn"
                    type="button"
                    onClick={() => startEdit("name")}
                    aria-label={t("projectWorkspace.overview.editName")}
                  >
                    <PencilIcon />
                    {t("common.edit")}
                  </button>
                </div>
              )}
              {editingField === "description" ? (
                <div>
                  <textarea
                    className="pip-edit-textarea"
                    value={draftValue}
                    onChange={(e) => setDraftValue(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); saveEdit(); }
                      if (e.key === "Escape") cancelEdit();
                    }}
                    aria-label={t("projectWorkspace.overview.editDescription")}
                    autoFocus
                  />
                  <div className="pip-edit-actions">
                    <button
                      className="btn btn-primary"
                      type="button"
                      onClick={saveEdit}
                      disabled={isUpdating}
                    >
                      {isUpdating ? t("common.submitting") : t("common.save")}
                    </button>
                    <button className="btn" type="button" onClick={cancelEdit}>
                      {t("common.cancel")}
                    </button>
                    <span className="pip-edit-hint">Esc {t("common.cancel")} · Shift+Enter ↵</span>
                  </div>
                </div>
              ) : (
                <div className="pip-editable-field">
                  <p className="pip-desc">{project?.description || t("projectWorkspace.overview.noDescription")}</p>
                  <button
                    className="pip-edit-btn"
                    type="button"
                    onClick={() => startEdit("description")}
                    aria-label={t("projectWorkspace.overview.editDescription")}
                  >
                    <PencilIcon />
                    {t("common.edit")}
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="pip-meta-strip">
          <div className="pip-meta-item">
            <span className="pip-meta-label">{t("projectWorkspace.collaboration.defaultPolicyHint")}</span>
            <span className="pip-meta-value">{payload.team.name}</span>
          </div>
          <span className="pip-meta-sep" aria-hidden="true">·</span>
          <div className="pip-meta-item">
            <span className="pip-meta-label">{t("projectWorkspace.reviewPolicy.label")}</span>
            <span className="pip-meta-value">{getReviewPolicyLabel(t, project?.reviewPolicyMode ?? "inherit")}</span>
          </div>
          <span className="pip-meta-sep" aria-hidden="true">·</span>
          <div className="pip-meta-item">
            <span className="pip-meta-value">
              {formatDate(project?.updatedAt ?? project?.createdAt ?? "", { year: "numeric", month: "2-digit", day: "2-digit" })}
            </span>
          </div>
        </div>

        <div className="pip-policy-row">
          <ReviewPolicySwitcher
            projectId={projectId}
            currentMode={project?.reviewPolicyMode ?? "inherit"}
            teamId={payload.team.id}
          />
        </div>
      </header>

      <InlineFeedback message={feedback.message} error={feedback.error} />

      {/* Stats ribbon */}
      <div className="pip-stats animate-slide-up" style={{ animationDelay: "0.05s" }}>
        {[
          { value: payload.members.length, label: t("projectWorkspace.overview.membersLabel"), icon: MembersIcon },
          { value: payload.documents.length, label: t("projectWorkspace.overview.documentsLabel"), icon: ReviewIcon },
          { value: payload.pendingReviews.length, label: t("projectWorkspace.collaboration.pendingTitle"), icon: ReviewIcon },
          { value: payload.invites.length, label: t("projectWorkspace.overview.invitesLabel"), icon: InviteIcon },
        ].map((s, i) => (
          <div key={i} className="pip-stat">
            <span className="pip-stat__icon"><s.icon /></span>
            <span className="pip-stat__value">{s.value}</span>
            <span className="pip-stat__label">{s.label}</span>
          </div>
        ))}
      </div>

      {/* Main content: two columns */}
      <div className="pip-body animate-slide-up" style={{ animationDelay: "0.1s" }}>
        {/* Left: Members */}
        <section className="pip-section">
          <div className="pip-section__head">
            <h3 className="pip-section__title">{t("projectWorkspace.collaboration.membersTitle")}</h3>
            <button
              className="pip-inline-action"
              type="button"
              onClick={() => setShowAddMember(!showAddMember)}
            >
              {showAddMember ? t("common.cancel") : t("projectWorkspace.collaboration.addTitle")}
            </button>
          </div>

          {showAddMember && (
            <div className="pip-add-form">
              <input
                id="project-member-email"
                className="input pip-input"
                type="email"
                value={memberEmail}
                onChange={(e) => setMemberEmail(e.target.value)}
                placeholder={t("projectWorkspace.collaboration.emailPlaceholder")}
              />
              <select
                id="project-member-role"
                className="input pip-input"
                value={memberRole}
                onChange={(e) => setMemberRole(e.target.value as ProjectRole)}
              >
                {(["project_admin", "director", "writer", "artist", "reviewer", "viewer"] as ProjectRole[]).map((role) => (
                  <option key={role} value={role}>{getProjectRoleLabel(t, role)}</option>
                ))}
              </select>
              <button
                className="btn btn-primary pip-add-btn"
                type="button"
                onClick={() => addProjectMemberMutation.mutate()}
                disabled={addProjectMemberMutation.isPending || !memberEmail.trim()}
              >
                {addProjectMemberMutation.isPending ? t("common.submitting") : t("projectWorkspace.collaboration.assignAction")}
              </button>
            </div>
          )}

          <div className="pip-list">
            {payload.members.length === 0 ? (
              <div className="pip-empty">
                <div className="pip-empty__icon-circle"><MembersIcon /></div>
                <span className="pip-empty__title">{t("projectWorkspace.collaboration.membersEmptyTitle")}</span>
                <span className="pip-empty__desc">{t("projectWorkspace.collaboration.membersEmptyDescription")}</span>
              </div>
            ) : payload.members.map((m) => (
              <div key={m.id} className="pip-row">
                <div
                  className="pip-member-avatar"
                  style={{ background: avatarGradient(m.displayName) }}
                >
                  {initials(m.displayName)}
                </div>
                <div className="pip-row__info">
                  <span className="pip-row__name">{m.displayName}</span>
                  <span className="pip-row__sub">{m.email}</span>
                </div>
                <span className="status-badge badge-neutral">{getProjectRoleLabel(t, m.role)}</span>
              </div>
            ))}
          </div>
        </section>

        {/* Right: pending reviews + invites */}
        <div className="pip-right-stack">
          <section className="pip-section">
            <h3 className="pip-section__title">{t("projectWorkspace.collaboration.pendingTitle")}</h3>
            <div className="pip-list">
              {payload.pendingReviews.length === 0 ? (
                <div className="pip-empty">
                  <div className="pip-empty__icon-circle"><ReviewIcon /></div>
                  <span className="pip-empty__title">{t("projectWorkspace.collaboration.pendingEmptyTitle")}</span>
                  <span className="pip-empty__desc">{t("projectWorkspace.collaboration.pendingEmptyDescription")}</span>
                </div>
              ) : payload.pendingReviews.map((item) => (
                <div
                  key={item.id}
                  className="pip-row"
                  style={{ cursor: onNavigateToVersion ? "pointer" : undefined }}
                  onClick={onNavigateToVersion ? () => onNavigateToVersion(item.documentId, item.id) : undefined}
                  role={onNavigateToVersion ? "button" : undefined}
                  tabIndex={onNavigateToVersion ? 0 : undefined}
                  onKeyDown={onNavigateToVersion ? (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onNavigateToVersion(item.documentId, item.id); } } : undefined}
                >
                  <div className="pip-row__info">
                    <span className="pip-row__name">{item.title}</span>
                    <span className="pip-row__sub">{item.documentTitle} · V{item.versionNumber}</span>
                  </div>
                  <span className="status-badge badge-warning">{getVersionStatusLabel(t, item.status)}</span>
                  {onNavigateToVersion && (
                    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true" style={{ flexShrink: 0, color: "var(--text-tertiary)" }}>
                      <path d="M5 2.5l4.5 4.5L5 11.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  )}
                </div>
              ))}
            </div>
          </section>

          <section className="pip-section">
            <h3 className="pip-section__title">{t("projectWorkspace.collaboration.invitesTitle")}</h3>
            <div className="pip-list">
              {payload.invites.length === 0 ? (
                <div className="pip-empty">
                  <div className="pip-empty__icon-circle"><InviteIcon /></div>
                  <span className="pip-empty__title">{t("projectWorkspace.collaboration.invitesEmptyTitle")}</span>
                  <span className="pip-empty__desc">{t("projectWorkspace.collaboration.invitesEmptyDescription")}</span>
                </div>
              ) : payload.invites.map((item) => (
                <div key={item.id} className="pip-row">
                  <div className="pip-row__info">
                    <span className="pip-row__name">{item.email}</span>
                    <span className="pip-row__sub">{formatDate(item.createdAt, { year: "numeric", month: "2-digit", day: "2-digit" })}</span>
                  </div>
                  <span className="status-badge badge-neutral">{getProjectRoleLabel(t, item.role)}</span>
                </div>
              ))}
            </div>
          </section>
        </div>
      </div>

      {/* Audit Settings */}
      <div className="pip-body animate-slide-up" style={{ animationDelay: "0.15s" }}>
        <AuditConfigPanel projectId={projectId} />
      </div>
    </div>
  );
}
