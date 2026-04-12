/**
 * @fileoverview 工作台概览组件
 * @module web/components
 *
 * 工作台首页的统计卡片和快速入口。
 */

"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiFetch, formatApiError } from "../lib/api";
import { queryKeys } from "../lib/query-keys";
import { useSession } from "../lib/use-session";
import { useI18n } from "../lib/i18n";

interface FeedbackState {
  message: string | null;
  error: string | null;
}

interface ProjectItem {
  id: string;
  name: string;
  description?: string;
  genre?: string;
  status?: string;
  createdAt?: string;
}

interface ProjectInviteItem {
  id: string;
  projectId: string;
  projectName: string;
  role: string;
  createdAt: string;
}

type ViewMode = "grid" | "list";
type StatusFilter = "all" | "draft" | "in_progress" | "completed" | "archived";

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

function formatDate(dateStr?: string): string {
  if (!dateStr) return "";
  try {
    const d = new Date(dateStr);
    return d.toLocaleDateString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  } catch {
    return "";
  }
}

function SearchIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <circle cx="7" cy="7" r="4.5" stroke="currentColor" strokeWidth="1.5" />
      <path d="M10.5 10.5L14 14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

function GridIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <rect x="1" y="1" width="6" height="6" rx="1.5" stroke="currentColor" strokeWidth="1.5" />
      <rect x="9" y="1" width="6" height="6" rx="1.5" stroke="currentColor" strokeWidth="1.5" />
      <rect x="1" y="9" width="6" height="6" rx="1.5" stroke="currentColor" strokeWidth="1.5" />
      <rect x="9" y="9" width="6" height="6" rx="1.5" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}

function ListIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M1 3h14M1 8h14M1 13h14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

function ArrowIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M6 4l4 4-4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function EmptyIcon() {
  return (
    <svg width="28" height="28" viewBox="0 0 28 28" fill="none" aria-hidden="true">
      <rect x="3" y="5" width="22" height="18" rx="3" stroke="currentColor" strokeWidth="1.5" />
      <path d="M3 10h22" stroke="currentColor" strokeWidth="1.5" />
      <circle cx="6.5" cy="7.5" r="1" fill="currentColor" />
      <circle cx="9.5" cy="7.5" r="1" fill="currentColor" />
      <circle cx="12.5" cy="7.5" r="1" fill="currentColor" />
      <path d="M8 16h12M8 19h8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
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

export function DashboardOverview() {
  const { t } = useI18n();
  const { session } = useSession();
  const queryClient = useQueryClient();
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState("");
  const [newDesc, setNewDesc] = useState("");
  const [feedback, setFeedback] = useState<FeedbackState>({ message: null, error: null });
  const [searchQuery, setSearchQuery] = useState("");
  const [viewMode, setViewMode] = useState<ViewMode>("grid");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");

  const { data: projects = [], isLoading } = useQuery<ProjectItem[]>({
    queryKey: queryKeys.projects,
    queryFn: () => apiFetch("/projects"),
  });

  const invitesQuery = useQuery<{ invites: ProjectInviteItem[] }>({
    queryKey: ["pending-project-invites"],
    queryFn: () => apiFetch("/project-invites/pending"),
  });

  const createMutation = useMutation({
    mutationFn: (body: { name: string; description: string }) =>
      apiFetch("/projects", { method: "POST", body }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.projects });
      setShowCreate(false);
      setNewName("");
      setNewDesc("");
      setFeedback({ message: t("dashboard.createProject.success"), error: null });
    },
    onError: (error: unknown) => {
      setFeedback({ message: null, error: formatApiError(error, t) });
    },
  });


  const acceptInviteMutation = useMutation({
    mutationFn: (inviteId: string) => apiFetch(`/project-invites/${inviteId}/accept`, { method: "POST" }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["pending-project-invites"] });
      await queryClient.invalidateQueries({ queryKey: queryKeys.projects });
      setFeedback({ message: "Project invitation accepted.", error: null });
    },
    onError: (error: unknown) => {
      setFeedback({ message: null, error: formatApiError(error, t) });
    },
  });

  const filteredProjects = useMemo(() => {
    let result = projects;
    if (statusFilter !== "all") {
      result = result.filter((p) => (p.status || "draft") === statusFilter);
    }
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      result = result.filter(
        (p) =>
          p.name.toLowerCase().includes(q) ||
          (p.description && p.description.toLowerCase().includes(q))
      );
    }
    return result;
  }, [projects, searchQuery, statusFilter]);

  const handleCreate = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newName.trim()) return;
    createMutation.mutate({ name: newName.trim(), description: newDesc.trim() });
  };

  const handleOverlayClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) {
      setShowCreate(false);
    }
  };

  const displayName = session?.user.displayName ?? "";

  return (
    <div className="animate-fade-in">
      {/* Feedback banner */}
      {feedback.message && (
        <div className="inline-feedback inline-feedback-success" role="status" style={{ marginBottom: "var(--space-4)" }}>
          {feedback.message}
        </div>
      )}
      {feedback.error && (
        <div className="inline-feedback inline-feedback-error" role="alert" style={{ marginBottom: "var(--space-4)" }}>
          {feedback.error}
        </div>
      )}

      {/* Hero */}
      <div className="projects-hero">
        <div className="projects-hero-kicker">{t("dashboard.recentProjects.title")}</div>
        <h2 className="projects-hero-title">
          {displayName ? t("dashboard.title", { name: displayName }) : t("dashboard.recentProjects.title")}
        </h2>
        <p className="projects-hero-desc">
          {t("dashboard.recentProjects.description")}
        </p>
        {projects.length > 0 && (
          <div className="projects-hero-stats">
            <div className="projects-hero-stat">
              <span className="projects-hero-stat-value">{projects.length}</span>
              {t("dashboard.stats.projectsLabel")}
            </div>
          </div>
        )}
      </div>

      {/* Toolbar */}
      <div className="projects-toolbar">
        {projects.length > 0 && (
          <div className="project-search">
            <div className="project-search-icon"><SearchIcon /></div>
            <input
              id="project-search-input"
              className="input"
              placeholder={t("dashboard.recentProjects.title") + "..."}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>
        )}

        <div className="view-toggle">
          <button
            className={`view-toggle-btn${viewMode === "grid" ? " active" : ""}`}
            onClick={() => setViewMode("grid")}
            aria-label="Grid view"
          >
            <GridIcon />
          </button>
          <button
            className={`view-toggle-btn${viewMode === "list" ? " active" : ""}`}
            onClick={() => setViewMode("list")}
            aria-label="List view"
          >
            <ListIcon />
          </button>
        </div>

        <button
          className="btn btn-primary"
          onClick={() => { setShowCreate(true); setFeedback({ message: null, error: null }); }}
        >
          {t("dashboard.createProject.title")}
        </button>
      </div>

      {/* Status filter chips */}
      {projects.length > 0 && (
        <div className="dash-status-filter">
          {(["all", "draft", "in_progress", "completed", "archived"] as StatusFilter[]).map((status) => (
            <button
              key={status}
              className={`dash-filter-chip${statusFilter === status ? " dash-filter-chip--active" : ""}`}
              type="button"
              onClick={() => setStatusFilter(status)}
            >
              {t(`dashboard.filter${status === "all" ? "All" : status === "draft" ? "Draft" : status === "in_progress" ? "InProgress" : status === "completed" ? "Completed" : "Archived"}` as any)}
            </button>
          ))}
        </div>
      )}

      {/* Create Modal */}
      {showCreate && (
        <div className="create-project-overlay" onClick={handleOverlayClick} role="dialog" aria-modal="true">
          <form onSubmit={handleCreate} className="create-project-modal">
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "var(--space-4)" }}>
              <div>
                <div className="create-project-modal-title">{t("dashboard.createProject.title")}</div>
                <div className="create-project-modal-desc">{t("dashboard.createProject.description")}</div>
              </div>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setShowCreate(false)} aria-label={t("common.cancel")}>
                <CloseIcon />
              </button>
            </div>
            <div className="stack stack-gap-4">
              <div>
                <label className="form-label">{t("dashboard.createProject.nameLabel")}</label>
                <input
                  id="create-project-name"
                  className="input"
                  placeholder={t("dashboard.createProject.namePlaceholder")}
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  autoFocus
                />
              </div>
              <div>
                <label className="form-label">{t("dashboard.createProject.descriptionLabel")}</label>
                <input
                  id="create-project-desc"
                  className="input"
                  placeholder={t("dashboard.createProject.descriptionPlaceholder")}
                  value={newDesc}
                  onChange={(e) => setNewDesc(e.target.value)}
                />
              </div>
              <div className="inline inline-gap-2" style={{ justifyContent: "flex-end" }}>
                <button type="button" className="btn btn-ghost" onClick={() => setShowCreate(false)}>
                  {t("common.cancel")}
                </button>
                <button type="submit" className="btn btn-primary" disabled={createMutation.isPending}>
                  {createMutation.isPending ? t("common.submitting") : t("dashboard.createProject.submit")}
                </button>
              </div>
            </div>
          </form>
        </div>
      )}

      {invitesQuery.data?.invites.length ? (
        <div className="glass-panel" style={{ padding: "var(--space-4)", marginBottom: "var(--space-5)", display: "flex", flexDirection: "column", gap: "var(--space-3)" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "var(--space-3)", flexWrap: "wrap" }}>
            <div>
              <div style={{ fontSize: "0.9rem", fontWeight: 700 }}>Pending project invites</div>
              <div className="muted text-sm">Accept an invite to add the project to your workspace.</div>
            </div>
            <div className="muted text-sm">{invitesQuery.data.invites.length} pending</div>
          </div>
          <div style={{ display: "grid", gap: "var(--space-3)" }}>
            {invitesQuery.data.invites.map((invite) => (
              <div key={invite.id} style={{ display: "flex", justifyContent: "space-between", gap: "var(--space-3)", alignItems: "center", padding: "var(--space-3)", borderRadius: "var(--radius-md)", background: "rgba(255,255,255,0.03)", border: "1px solid var(--border-subtle)" }}>
                <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                  <strong>{invite.projectName}</strong>
                  <span className="muted text-sm">Role: {invite.role}</span>
                  <span className="muted text-sm">Invited {formatDate(invite.createdAt)}</span>
                </div>
                <button
                  className="btn btn-primary btn-sm"
                  type="button"
                  disabled={acceptInviteMutation.isPending}
                  onClick={() => acceptInviteMutation.mutate(invite.id)}
                >
                  {acceptInviteMutation.isPending ? t("common.submitting") : "Accept"}
                </button>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {/* Project list */}
      {isLoading ? (
        <div className="dashboard-grid">
          {[1, 2, 3, 4, 5, 6].map((i) => (
            <div
              key={i}
              className="skeleton animate-fade-in"
              style={{ height: 120, borderRadius: "var(--radius-lg)", animationDelay: `${0.05 * i}s` }}
            />
          ))}
        </div>
      ) : projects.length === 0 ? (
        <div className="projects-empty">
          <div className="projects-empty-icon">
            <EmptyIcon />
          </div>
          <div className="projects-empty-title">{t("dashboard.recentProjects.emptyTitle")}</div>
          <div className="projects-empty-desc">{t("dashboard.recentProjects.emptyDescription")}</div>
          <button
            className="btn btn-primary"
            onClick={() => { setShowCreate(true); setFeedback({ message: null, error: null }); }}
          >
            {t("dashboard.createProject.title")}
          </button>
        </div>
      ) : filteredProjects.length === 0 ? (
        <div className="projects-empty">
          <div className="projects-empty-icon">
            <SearchIcon />
          </div>
          <div className="projects-empty-title">{t("dashboard.recentProjects.emptyTitle")}</div>
          <div className="projects-empty-desc" style={{ maxWidth: "44ch" }}>
            {searchQuery && `"${searchQuery}" `}{t("dashboard.recentProjects.emptyProjectDescription")}
          </div>
        </div>
      ) : viewMode === "grid" ? (
        <div className="dashboard-grid">
          {filteredProjects.map((project, idx) => (
            <Link key={project.id} href={`/projects/${project.id}`} style={{ textDecoration: "none", display: "flex", height: "100%" }}>
              <div
                className="project-card glass-panel animate-slide-up"
                style={{ animationDelay: `${0.06 * idx}s`, animationFillMode: "both", flex: 1 }}
              >
                <div className="project-card-header">
                  <div
                    className="project-card-avatar"
                    style={{ background: getAvatarColor(project.name) }}
                  >
                    {getInitials(project.name)}
                  </div>
                  <div className="project-card-title-group">
                    <div className="project-card-name">{project.name}</div>
                    {project.createdAt && (
                      <div className="project-card-date">{formatDate(project.createdAt)}</div>
                    )}
                  </div>
                  <div className="project-card-arrow">
                    <ArrowIcon />
                  </div>
                </div>
                {project.description ? (
                  <div className="project-card-meta">{project.description}</div>
                ) : (
                  <div className="project-card-meta" style={{ fontStyle: "italic", opacity: 0.6 }}>
                    {t("dashboard.recentProjects.emptyProjectDescription")}
                  </div>
                )}
                <div className="project-card-tags">
                  {project.genre && <span className="dash-genre-tag">{project.genre}</span>}
                  <span className={`dash-status-badge dash-status-badge--${project.status || "draft"}`}>
                    {t(`enums.projectStatus.${project.status || "draft"}` as any)}
                  </span>
                </div>
              </div>
            </Link>
          ))}
        </div>
      ) : (
        <div className="project-list">
          {filteredProjects.map((project, idx) => (
            <Link
              key={project.id}
              href={`/projects/${project.id}`}
              className="project-list-item animate-slide-up"
              style={{ animationDelay: `${0.04 * idx}s`, animationFillMode: "both" }}
            >
              <div
                className="project-card-avatar"
                style={{ background: getAvatarColor(project.name) }}
              >
                {getInitials(project.name)}
              </div>
              <div className="project-list-item-info">
                <div className="project-list-item-name">{project.name}</div>
                <div className="project-list-item-desc">
                  {project.description || t("dashboard.recentProjects.emptyProjectDescription")}
                </div>
              </div>
              {project.createdAt && (
                <div className="project-list-item-date">{formatDate(project.createdAt)}</div>
              )}
              <div className="project-list-item-arrow">
                <ArrowIcon />
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
