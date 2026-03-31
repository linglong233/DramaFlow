"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "../../lib/api";
import { queryKeys } from "../../lib/query-keys";
import { useI18n } from "../../lib/i18n";

interface Props {
  projectId: string;
  documents: Array<{ id: string; type: string; currentVersionId?: string }>;
}

export function GenerationPanel({ projectId, documents }: Props) {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(true);
  const [scriptTitle, setScriptTitle] = useState("");
  const [scriptGenre, setScriptGenre] = useState("");
  const [scriptPremise, setScriptPremise] = useState("");

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

  const hasScript = documents.some((d) => d.type === "script");

  return (
    <div>
      <div
        className="inline"
        style={{ alignItems: "center", justifyContent: "space-between", marginBottom: "var(--space-3)", cursor: "pointer" }}
        onClick={() => setOpen(!open)}
      >
        <span className="faint text-sm">{t("projectWorkspace.sidebar.tabAi")}</span>
        <span className="faint text-sm">{open ? "−" : "+"}</span>
      </div>

      {open && (
        <div className="stack stack-gap-4">
          {/* Script generation */}
          <div className="gen-section glass-panel" style={{ position: "relative", overflow: "hidden", ...(scriptMutation.isPending ? { boxShadow: "var(--shadow-glow)", borderColor: "var(--accent)" } : {}) }}>
            {scriptMutation.isPending && <div style={{ position: "absolute", top: 0, left: 0, height: 2, background: "var(--accent)", width: "100%", animation: "skeleton-pulse 1s infinite" }} />}
            <div className="gen-section-header">
              <span className="gen-section-title">{t("projectWorkspace.sidebar.aiTitle")}{t("projectWorkspace.generationSuffix.script")}</span>
            </div>
            <div className="gen-section-body">
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
                <textarea className="input" value={scriptPremise} onChange={(e) => setScriptPremise(e.target.value)} placeholder={t("projectWorkspace.sidebar.premisePlaceholder")} style={{ minHeight: 80 }} />
              </div>
              <button
                className="btn btn-primary"
                onClick={() => scriptMutation.mutate()}
                disabled={scriptMutation.isPending || !scriptTitle.trim()}
              >
                {scriptMutation.isPending ? t("common.submitting") : t("projectWorkspace.sidebar.submitScriptAction")}
              </button>
              {scriptMutation.isError && (
                <div className="inline-feedback inline-feedback-error">{t("projectWorkspace.feedback.scriptJobFailed")}</div>
              )}
            </div>
          </div>

          {/* Storyboard generation */}
          <div className="gen-section glass-panel" style={{ position: "relative", overflow: "hidden", ...(storyboardMutation.isPending ? { boxShadow: "var(--shadow-glow)", borderColor: "var(--accent)" } : {}) }}>
            {storyboardMutation.isPending && <div style={{ position: "absolute", top: 0, left: 0, height: 2, background: "var(--accent)", width: "100%", animation: "skeleton-pulse 1s infinite" }} />}
            <div className="gen-section-header">
              <span className="gen-section-title">{t("projectWorkspace.sidebar.aiTitle")}{t("projectWorkspace.generationSuffix.storyboard")}</span>
            </div>
            <div className="gen-section-body">
              <p className="text-sm muted">{t("projectWorkspace.sidebar.aiDescription")}</p>
              <button
                className="btn btn-secondary"
                onClick={() => storyboardMutation.mutate()}
                disabled={storyboardMutation.isPending || !hasScript}
              >
                {storyboardMutation.isPending ? t("common.submitting") : t("projectWorkspace.sidebar.submitStoryboardAction")}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
