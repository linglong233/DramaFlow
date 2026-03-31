"use client";

import { useState } from "react";
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

export function DashboardOverview() {
  const { t } = useI18n();
  const session = useSession();
  const queryClient = useQueryClient();
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState("");
  const [newDesc, setNewDesc] = useState("");
  const [feedback, setFeedback] = useState<FeedbackState>({ message: null, error: null });

  const { data: projects = [], isLoading } = useQuery<Array<{
    id: string;
    name: string;
    description?: string;
    createdAt?: string;
  }>>({
    queryKey: queryKeys.projects,
    queryFn: () => apiFetch("/projects"),
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

  const handleCreate = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newName.trim()) return;
    createMutation.mutate({ name: newName.trim(), description: newDesc.trim() });
  };

  return (
    <div>
      {/* Feedback banner */}
      {feedback.message && (
        <div className="inline-feedback inline-feedback-success" role="status">
          {feedback.message}
        </div>
      )}
      {feedback.error && (
        <div className="inline-feedback inline-feedback-error" role="alert">
          {feedback.error}
        </div>
      )}

      {/* Header */}
      <div className="inline" style={{ justifyContent: "space-between", alignItems: "center", marginBottom: "var(--space-8)" }}>
        <h2 className="heading-3">{t("dashboard.recentProjects.title")}</h2>
        <button className="btn btn-primary" onClick={() => { setShowCreate(true); setFeedback({ message: null, error: null }); }}>
          {t("dashboard.createProject.title")}
        </button>
      </div>

      {/* Create form */}
      {showCreate && (
        <form onSubmit={handleCreate} className="card card-sm" style={{ marginBottom: "var(--space-6)" }}>
          <div className="stack stack-gap-4">
            <div>
              <label className="form-label">{t("dashboard.createProject.nameLabel")}</label>
              <input
                className="input"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                autoFocus
              />
            </div>
            <div>
              <label className="form-label">{t("dashboard.createProject.descriptionLabel")}</label>
              <input
                className="input"
                value={newDesc}
                onChange={(e) => setNewDesc(e.target.value)}
              />
            </div>
            <div className="inline inline-gap-2">
              <button type="submit" className="btn btn-primary" disabled={createMutation.isPending}>
                {createMutation.isPending ? t("common.submitting") : t("dashboard.createProject.submit")}
              </button>
              <button type="button" className="btn btn-ghost" onClick={() => setShowCreate(false)}>
                {t("common.cancel")}
              </button>
            </div>
          </div>
        </form>
      )}

      {/* Project list */}
      {isLoading ? (
        <div className="stack stack-gap-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="skeleton" style={{ height: 64 }} />
          ))}
        </div>
      ) : projects.length === 0 ? (
        <div className="empty-state">
          <div className="empty-state-title">{t("dashboard.recentProjects.emptyTitle")}</div>
          <div className="empty-state-description">{t("dashboard.recentProjects.emptyDescription")}</div>
        </div>
      ) : (
        <div className="dashboard-grid">
          {projects.map((project: { id: string; name: string; description?: string; createdAt?: string }, idx: number) => (
            <Link key={project.id} href={`/projects/${project.id}`} style={{ textDecoration: "none" }}>
              <div className="project-card glass-panel animate-slide-up" style={{ animationDelay: `${0.1 * idx}s`, animationFillMode: "both" }}>
                <div className="project-card-name" style={{ color: "var(--accent)" }}>{project.name}</div>
                {project.description && (
                  <div className="project-card-meta">{project.description}</div>
                )}
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
