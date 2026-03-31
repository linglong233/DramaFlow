"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { ProjectWorkspacePayload } from "@dramaflow/shared";
import { apiFetch } from "../../lib/api";
import { queryKeys } from "../../lib/query-keys";
import { useI18n } from "../../lib/i18n";

interface Props {
  projectId: string;
  project: ProjectWorkspacePayload;
}

export function TextGeneratorPanel({ projectId, project }: Props) {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const [scriptTitle, setScriptTitle] = useState("");
  const [scriptGenre, setScriptGenre] = useState("");
  const [scriptPremise, setScriptPremise] = useState("");
  const [targetType, setTargetType] = useState<"script" | "storyboard">("script");

  const scriptMutation = useMutation({
    mutationFn: () =>
      apiFetch(`/projects/${projectId}/script-jobs`, {
        method: "POST",
        body: { title: scriptTitle, genre: scriptGenre, premise: scriptPremise },
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.project(projectId) });
      setScriptTitle("");
      setScriptGenre("");
      setScriptPremise("");
    },
  });

  const storyboardMutation = useMutation({
    mutationFn: () =>
      apiFetch(`/projects/${projectId}/storyboard-jobs`, { method: "POST" }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.project(projectId) }),
  });

  const latestScript = project.documents.find((d) => d.type === "script");
  const latestScriptVersion = project.versions?.find((v) => v.documentId === latestScript?.id);

  const hasScript = !!latestScript;

  return (
    <div style={{ display: "flex", height: "100%", width: "100%" }}>
      {/* Left Column: Form & Settings */}
      <div style={{ width: "400px", borderRight: "1px solid var(--border-subtle)", padding: "var(--space-6)", overflowY: "auto", background: "var(--bg-surface)" }}>
        <h3 className="heading-4" style={{ marginBottom: "var(--space-6)" }}>{t("projectWorkspace.generate.promptSettings")}</h3>
        
        <div className="form-group" style={{ marginBottom: "var(--space-6)" }}>
          <label className="form-label">{t("projectWorkspace.generate.generationTarget")}</label>
          <div style={{ display: "flex", gap: "8px" }}>
            <button className={`btn btn-sm ${targetType === "script" ? "btn-primary" : "btn-secondary"}`} onClick={() => setTargetType("script")}>{t("projectWorkspace.generate.scriptLabel")}</button>
            <button className={`btn btn-sm ${targetType === "storyboard" ? "btn-primary" : "btn-secondary"}`} onClick={() => setTargetType("storyboard")}>{t("projectWorkspace.generate.storyboardLabel")}</button>
          </div>
        </div>

        {targetType === "script" && (
          <div className="stack stack-gap-4">
            <div className="form-group">
              <label className="form-label">{t("projectWorkspace.sidebar.scriptTitleLabel")}</label>
              <input className="input" value={scriptTitle} onChange={(e) => setScriptTitle(e.target.value)} placeholder={t("projectWorkspace.sidebar.scriptTitlePlaceholder")} />
            </div>
            <div className="form-group">
              <label className="form-label">{t("projectWorkspace.sidebar.genreLabel")}</label>
              <input className="input" value={scriptGenre} onChange={(e) => setScriptGenre(e.target.value)} placeholder={t("projectWorkspace.sidebar.genrePlaceholder")} />
            </div>
            <div className="form-group">
              <label className="form-label">{t("projectWorkspace.sidebar.premiseLabel")}</label>
              <textarea className="input" value={scriptPremise} onChange={(e) => setScriptPremise(e.target.value)} placeholder={t("projectWorkspace.sidebar.premisePlaceholder")} style={{ minHeight: 120, resize: "vertical" }} />
            </div>
            <button
              className="btn btn-primary"
              onClick={() => scriptMutation.mutate()}
              disabled={scriptMutation.isPending || !scriptTitle.trim()}
              style={{ width: "100%", justifyContent: "center" }}
            >
              {scriptMutation.isPending ? t("common.submitting") : t("projectWorkspace.generate.generateScript")}
            </button>
            {scriptMutation.isError && (
              <div className="inline-feedback inline-feedback-error">{t("projectWorkspace.feedback.scriptJobFailed")}</div>
            )}
          </div>
        )}

        {targetType === "storyboard" && (
          <div className="stack stack-gap-4">
             <p className="text-sm muted" style={{ lineHeight: 1.6 }}>
               {t("projectWorkspace.generate.storyboardHint")}
             </p>
             <div className="form-group">
               <label className="form-label">{t("projectWorkspace.generate.baseScriptStatus")}</label>
               {hasScript ? (
                 <div style={{ padding: "8px 12px", background: "rgba(0,255,100,0.1)", color: "#10b981", borderRadius: "6px", fontSize: "13px" }}>
                   {t("projectWorkspace.generate.scriptReady", { title: latestScript.title })}
                 </div>
               ) : (
                 <div style={{ padding: "8px 12px", background: "rgba(255,50,50,0.1)", color: "#ef4444", borderRadius: "6px", fontSize: "13px" }}>
                   {t("projectWorkspace.generate.noScriptYet")}
                 </div>
               )}
             </div>
             <button
              className="btn btn-secondary"
              onClick={() => storyboardMutation.mutate()}
              disabled={storyboardMutation.isPending || !hasScript}
              style={{ width: "100%", justifyContent: "center" }}
            >
              {storyboardMutation.isPending ? t("common.submitting") : t("projectWorkspace.generate.extractStoryboard")}
            </button>
          </div>
        )}
      </div>

      {/* Right Column: Output / Flow */}
      <div style={{ flex: 1, padding: "var(--space-6)", overflowY: "auto", background: "var(--bg-canvas)" }}>
        <h3 className="heading-4" style={{ marginBottom: "var(--space-6)" }}>{t("projectWorkspace.generate.outputTitle")}</h3>
        <div style={{ 
          background: "var(--bg-surface)", 
          border: "1px solid var(--border-subtle)", 
          borderRadius: "var(--radius-md)", 
          padding: "var(--space-6)",
          minHeight: "400px" 
        }}>
          {latestScriptVersion?.content ? (
            <div style={{ whiteSpace: "pre-wrap", lineHeight: 1.8, color: "var(--text-primary)", fontSize: "14px", fontFamily: "var(--font-cjk)" }}>
              {typeof latestScriptVersion.content === "string" ? latestScriptVersion.content : JSON.stringify(latestScriptVersion.content, null, 2)}
            </div>
          ) : (
             <div style={{ height: "100%", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--text-tertiary)" }}>
               {t("projectWorkspace.generate.outputEmpty")}
             </div>
          )}
        </div>
      </div>
    </div>
  );
}
