"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { ProjectWorkspacePayload, StoryboardContent } from "@dramaflow/shared";
import { apiFetch } from "../../lib/api";
import { queryKeys } from "../../lib/query-keys";
import { useI18n } from "../../lib/i18n";

interface Props {
  projectId: string;
  project: ProjectWorkspacePayload;
}

export function MediaCanvasPanel({ projectId, project }: Props) {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const [model, setModel] = useState("dall-e-3");

  const storyboardDoc = project.documents?.find(d => d.type === "storyboard");
  const storyboardVersion = project.versions?.find(v => v.id === storyboardDoc?.currentVersionId);
  const shots = (storyboardVersion?.content as StoryboardContent)?.shots ?? [];

  function getMediaDocsForShot(shotId: string) {
    return project.documents?.filter((d) => d.shotId === shotId) ?? [];
  }

  const generateImage = useMutation({
    mutationFn: (shotId: string) => apiFetch(`/shots/${shotId}/image-jobs`, {
      method: "POST",
      body: { projectId, style: "cinematic", aspectRatio: "16:9" }
    }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.project(projectId) }),
  });

  const generateVideo = useMutation({
    mutationFn: (shotId: string) => apiFetch(`/shots/${shotId}/video-jobs`, {
      method: "POST",
      body: { projectId, style: "cinematic", aspectRatio: "16:9" }
    }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.project(projectId) }),
  });


  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", background: "var(--bg-canvas)" }}>
      <div style={{ padding: "var(--space-4) var(--space-6)", borderBottom: "1px solid var(--border-subtle)", display: "flex", justifyContent: "space-between", background: "var(--bg-surface)" }}>
        <div style={{ display: "flex", gap: "16px", alignItems: "center" }}>
          <span className="text-sm font-medium">{t("projectWorkspace.media.modelLabel")}:</span>
          <select className="input" value={model} onChange={(e) => setModel(e.target.value)} style={{ width: "200px", padding: "4px 8px", height: "32px", fontSize: "13px" }}>
            <option value="dall-e-3">DALL-E 3 (Image)</option>
            <option value="sora-preview">Mock Sora (Video API)</option>
          </select>
        </div>
        <button className="btn btn-primary btn-sm">{t("projectWorkspace.media.batchGenerate")}</button>
      </div>

      <div style={{ flex: 1, padding: "var(--space-6)", overflowY: "auto" }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))", gap: "var(--space-6)" }}>
          {shots.length === 0 ? (
            <div style={{ gridColumn: "1 / -1", textAlign: "center", padding: "4rem", color: "var(--text-secondary)" }}>
              <p>{t("projectWorkspace.media.noShotsHint")}</p>
            </div>
          ) : shots.map((shot: any) => {
            const shotDocs = getMediaDocsForShot(shot.id);
            const latestImage = shotDocs.find(d => d.type === "image");
            const latestVideo = shotDocs.find(d => d.type === "video");
            const activeMedia = latestVideo || latestImage;
            const activeVersion = activeMedia ? project.versions.find(v => v.id === activeMedia.currentVersionId) : null;
            const content = activeVersion?.content as any;

            return (
              <div key={shot.id} style={{ border: "1px solid var(--border-subtle)", borderRadius: "var(--radius-md)", overflow: "hidden", background: "var(--bg-surface)", display: "flex", flexDirection: "column" }}>
                <div style={{ aspectRatio: "16/9", background: "#000", position: "relative", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--text-secondary)" }}>
                  {content?.assetUrl ? (
                     <img src={content.assetUrl} alt={content?.prompt} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                  ) : (
                     <span style={{ fontSize: "13px" }}>{t("projectWorkspace.media.awaitingGeneration")}</span>
                  )}
                  {activeMedia?.type === "video" && (
                    <div style={{ position: "absolute", top: 8, right: 8, background: "rgba(0,0,0,0.6)", color: "#fff", padding: "2px 6px", borderRadius: "4px", fontSize: "11px", fontWeight: "bold" }}>
                      {t("projectWorkspace.media.videoTag")}
                    </div>
                  )}
                </div>
                <div style={{ padding: "var(--space-4)", display: "flex", flexDirection: "column", gap: "8px", flex: 1 }}>
                  <span style={{ fontSize: "12px", color: "var(--text-secondary)", fontWeight: 600 }}>{t("projectWorkspace.media.shotPrefix", { label: shot.shotLabel })}</span>
                  <p style={{ fontSize: "13px", color: "var(--text-primary)", lineHeight: 1.4, margin: 0, flex: 1 }}>{shot.visualDescription}</p>
                  <div style={{ marginTop: "8px", display: "flex", gap: "8px" }}>
                    <button 
                      className="btn btn-secondary btn-sm" 
                      style={{ flex: 1 }}
                      onClick={() => generateImage.mutate(shot.id)}
                      disabled={generateImage.isPending}
                    >
                      {generateImage.isPending ? t("projectWorkspace.media.starting") : t("projectWorkspace.media.genImage")}
                    </button>
                    <button 
                      className="btn btn-primary btn-sm" 
                      onClick={() => generateVideo.mutate(shot.id)}
                      disabled={generateVideo.isPending}
                    >
                      {generateVideo.isPending ? t("projectWorkspace.media.starting") : t("projectWorkspace.media.genVideo")}
                    </button>
                  </div>
                </div>
              </div>
            );
          })}

          {/* New Empty Slot */}
          <div style={{ border: "1px dashed var(--border-subtle)", borderRadius: "var(--radius-md)", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", minHeight: "240px", cursor: "pointer", color: "var(--text-secondary)" }}>
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ marginBottom: "12px" }}>
              <line x1="12" y1="5" x2="12" y2="19"></line>
              <line x1="5" y1="12" x2="19" y2="12"></line>
            </svg>
            <span style={{ fontSize: "14px", fontWeight: 500 }}>{t("projectWorkspace.media.addScene")}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
