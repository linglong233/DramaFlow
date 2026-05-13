/**
 * @fileoverview 镜头字段重新生成浮层
 * @module web/components/project-workspace
 *
 * 通过 job 系统重新生成镜头字段，完成后展示新旧对比，
 * 用户选择「采用新内容」或「保留原内容」。
 */

"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import type { LlmConfigSource } from "@dramaflow/shared";
import { apiFetch } from "../../lib/api";
import { useI18n } from "../../lib/i18n";

export interface RegenFieldEntry {
  field: string;
  label: string;
  oldValue: string;
}

interface Props {
  shotId: string;
  projectId: string | undefined;
  fields: RegenFieldEntry[];
  defaultLlmConfigSource?: LlmConfigSource;
  onAdopt: (patch: Record<string, string>) => void;
  onClose: () => void;
}

type Phase = "idle" | "generating" | "comparing" | "error";

const POLL_INTERVAL = 3000;

export function RegenerateOverlay({
  shotId,
  projectId,
  fields,
  defaultLlmConfigSource = "team",
  onAdopt,
  onClose,
}: Props) {
  const { t } = useI18n();
  const [phase, setPhase] = useState<Phase>("idle");
  const [configSource, setConfigSource] = useState<LlmConfigSource>(defaultLlmConfigSource);
  const [newValues, setNewValues] = useState<Record<string, string>>({});
  const [jobId, setJobId] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const hasStarted = useRef(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const isSingle = fields.length === 1;
  const title = isSingle
    ? `${t("shotDetailDrawer.regenerateField")} — ${fields[0].label}`
    : t("shotDetailDrawer.regenerateAll");

  function stopPolling() {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }

  const doGenerate = useCallback(async () => {
    if (!projectId) {
      setErrorMsg("No project context");
      setPhase("error");
      return;
    }

    setPhase("generating");
    setErrorMsg(null);

    try {
      const res = await apiFetch<{ id: string }>(`/shots/${shotId}/regenerate-jobs`, {
        method: "POST",
        body: {
          projectId,
          fields: fields.map((f) => f.field),
          llmConfigSource: configSource,
        },
      });

      setJobId(res.id);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error("[RegenerateOverlay] create job failed:", msg, err);
      setErrorMsg(msg);
      setPhase("error");
    }
  }, [projectId, shotId, fields, configSource]);

  // Auto-start on first mount
  useEffect(() => {
    if (hasStarted.current) return;
    hasStarted.current = true;
    doGenerate();
  }, [doGenerate]);

  // Poll for job completion
  useEffect(() => {
    if (!jobId || !projectId || phase !== "generating") return;

    stopPolling();

    async function checkJob() {
      try {
        const job = await apiFetch<{ id: string; status: string; result?: Record<string, unknown>; error?: string }>(`/jobs/${jobId}`);

        if (job.status === "completed" && job.result) {
          stopPolling();
          const parsed: Record<string, string> = {};
          for (const entry of fields) {
            const val = job.result[entry.field];
            parsed[entry.field] = typeof val === "string" ? val : String(val ?? "");
          }
          setNewValues(parsed);
          setPhase("comparing");
        } else if (job.status === "failed") {
          stopPolling();
          const msg = job.error ?? "Job failed";
          console.error("[RegenerateOverlay] job failed:", msg);
          setErrorMsg(msg);
          setPhase("error");
        }
      } catch {
        // Network error — keep polling
      }
    }

    pollRef.current = setInterval(checkJob, POLL_INTERVAL);
    checkJob();

    return stopPolling;
  }, [jobId, phase, fields]);

  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        stopPolling();
        onClose();
      }
    }
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("keydown", handleKey);
      stopPolling();
    };
  }, [onClose]);

  function handleAdopt() {
    onAdopt(newValues);
    onClose();
  }

  function handleCancel() {
    stopPolling();
    onClose();
  }

  function handleRetry() {
    hasStarted.current = false;
    setJobId(null);
    setErrorMsg(null);
    doGenerate();
  }

  const cancelLabel = phase === "generating"
    ? t("shotDetailDrawer.regenCancel")
    : isSingle
      ? t("shotDetailDrawer.regenKeep")
      : t("shotDetailDrawer.regenKeepAll");

  return (
    <div className="regen-overlay">
      <div className="regen-overlay__header">
        <span className="regen-overlay__title">{title}</span>
        <div className="regen-overlay__header-actions">
          <select
            className="input sm-config-source-select"
            value={configSource}
            onChange={(e) => setConfigSource(e.target.value as LlmConfigSource)}
            disabled={phase === "generating"}
          >
            <option value="team">{t("projectWorkspace.generate.llmConfigSourceTeam")}</option>
            <option value="personal">{t("projectWorkspace.generate.llmConfigSourcePersonal")}</option>
          </select>
          <button
            className="btn btn-ghost btn-sm"
            type="button"
            onClick={handleCancel}
          >
            {cancelLabel}
          </button>
        </div>
      </div>

      <div className="regen-overlay__body">
        {phase === "generating" && (
          <div className="regen-overlay__streaming">
            <span className="regen-overlay__spinner" />
            <span>{t("shotDetailDrawer.regenGenerating")}</span>
          </div>
        )}

        {phase === "comparing" && (
          <>
            {fields.map((entry) => (
              <div key={entry.field} className="regen-overlay__compare">
                <span className="regen-overlay__compare-label">
                  {entry.label}
                </span>
                <div className="regen-overlay__compare-cols">
                  <div className="regen-overlay__compare-cell">
                    <span className="regen-overlay__compare-tag">
                      {t("shotDetailDrawer.regenOld")}
                    </span>
                    <p>{entry.oldValue || "—"}</p>
                  </div>
                  <div className="regen-overlay__compare-cell regen-overlay__compare-cell--new">
                    <span className="regen-overlay__compare-tag">
                      {t("shotDetailDrawer.regenNew")}
                    </span>
                    <p>{newValues[entry.field] || "—"}</p>
                  </div>
                </div>
              </div>
            ))}
            <div className="regen-overlay__actions">
              <button
                className="btn btn-ghost btn-sm"
                type="button"
                onClick={onClose}
              >
                {isSingle
                  ? t("shotDetailDrawer.regenKeep")
                  : t("shotDetailDrawer.regenKeepAll")}
              </button>
              <button
                className="btn btn-primary btn-sm"
                type="button"
                onClick={handleAdopt}
              >
                {isSingle
                  ? t("shotDetailDrawer.regenAdopt")
                  : t("shotDetailDrawer.regenAdoptAll")}
              </button>
            </div>
          </>
        )}

        {phase === "error" && (
          <div className="regen-overlay__error">
            <p>{t("shotDetailDrawer.regenFailed")}</p>
            {errorMsg && <pre className="regen-overlay__error-detail">{errorMsg}</pre>}
            <div style={{ display: "flex", gap: "var(--space-2)" }}>
              <button
                className="btn btn-ghost btn-sm"
                type="button"
                onClick={onClose}
              >
                {t("common.cancel")}
              </button>
              <button
                className="btn btn-secondary btn-sm"
                type="button"
                onClick={handleRetry}
              >
                {t("shotDetailDrawer.regenRetry")}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
