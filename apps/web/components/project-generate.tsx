"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { ProjectWorkspacePayload } from "@dramaflow/shared";

import { apiFetch } from "../lib/api";
import { useI18n } from "../lib/i18n";
import { queryKeys } from "../lib/query-keys";
import { ErrorState } from "./error-state";
import { LoadingSkeleton } from "./loading-skeleton";
import { TextGeneratorPanel } from "./project-workspace/text-generator-panel";
import { MediaCanvasPanel } from "./project-workspace/media-canvas-panel";

export function ProjectGenerate({ projectId }: { projectId: string }) {
  const { t } = useI18n();
  const [activeTab, setActiveTab] = useState<"text" | "media">("text");

  const projectQuery = useQuery({
    queryKey: queryKeys.project(projectId),
    queryFn: () => apiFetch<ProjectWorkspacePayload>(`/projects/${projectId}`),
  });

  if (projectQuery.isPending) return <div style={{ padding: "var(--space-8)" }}><LoadingSkeleton rows={8} /></div>;
  if (projectQuery.error || !projectQuery.data) return <ErrorState title={t("projectWorkspace.loadErrorTitle")} description={t("projectWorkspace.loadErrorDescription")} action={<button className="primary-btn" onClick={() => void projectQuery.refetch()}>{t("common.reload")}</button>} />;

  const project = projectQuery.data;

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <div style={{ padding: "var(--space-6) var(--space-8)", borderBottom: "1px solid var(--border-subtle)", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <h2 className="heading-3">{t("projectWorkspace.generate.studioTitle")}</h2>
        <div style={{ display: "flex", gap: "var(--space-2)", background: "var(--bg-sidebar)", padding: "4px", borderRadius: "var(--radius-md)" }}>
          <button 
            className={`btn btn-sm ${activeTab === "text" ? "btn-primary" : "btn-ghost"}`}
            onClick={() => setActiveTab("text")}
            style={{ fontWeight: 500 }}
          >
            {t("projectWorkspace.generate.scriptAndStoryboards")}
          </button>
          <button 
            className={`btn btn-sm ${activeTab === "media" ? "btn-primary" : "btn-ghost"}`}
            onClick={() => setActiveTab("media")}
            style={{ fontWeight: 500 }}
          >
            {t("projectWorkspace.generate.mediaCanvas")}
          </button>
        </div>
      </div>
      
      <div style={{ flex: 1, overflow: "hidden", display: "flex", flexDirection: "column" }}>
        {activeTab === "text" && <TextGeneratorPanel projectId={projectId} project={project} />}
        {activeTab === "media" && <MediaCanvasPanel projectId={projectId} project={project} />}
      </div>
    </div>
  );
}
