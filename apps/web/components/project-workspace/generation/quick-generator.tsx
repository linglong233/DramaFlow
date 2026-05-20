/**
 * @fileoverview 快速模式生成器
 * @module web/components/project-workspace/generation
 *
 * 根据生成器配置动态渲染表单，使用共享 hook 处理 SSE 流。
 */

"use client";

import { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import { useMutation } from "@tanstack/react-query";
import {
  normalizeScriptContent,
  normalizeStoryboardContent,
  type LlmConfigSource,
  type ProjectWorkspacePayload,
} from "@dramaflow/shared";

import { formatApiError } from "../../../lib/api";
import { useFeedback } from "../../../lib/hooks";
import { useI18n } from "../../../lib/i18n";
import type { TranslationKey } from "../../../lib/i18n/messages";
import { ScriptView, StoryboardPreview } from "../version-view";
import type { GeneratorConfig } from "./generator-registry";
import { SourcePicker } from "./source-picker";
import { useGenerationStream } from "./use-generation-stream";
import { WorldBibleIndicator } from "./world-bible-indicator";

interface Props {
  config: GeneratorConfig;
  projectId: string;
  project: ProjectWorkspacePayload;
  llmConfigSource: LlmConfigSource;
}

function SparkleIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 2l2.4 7.2L22 12l-7.6 2.8L12 22l-2.4-7.2L2 12l7.6-2.8L12 2z" />
    </svg>
  );
}

function StopIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
      <rect x="4" y="4" width="16" height="16" rx="2" />
    </svg>
  );
}

export function QuickGenerator({ config, projectId, project, llmConfigSource }: Props) {
  const { t } = useI18n();
  const { feedback, setFeedback } = useFeedback();
  const { streamingText, isStreaming, startStream, stopStream } = useGenerationStream(projectId);
  const [formCollapsed, setFormCollapsed] = useState(false);
  const [sourceVersionId, setSourceVersionId] = useState<string | undefined>(undefined);
  const [generatedStoryboard, setGeneratedStoryboard] = useState<unknown>(null);

  // Initialize form values from project defaults
  const [formValues, setFormValues] = useState<Record<string, unknown>>(() => {
    const defaults: Record<string, unknown> = {};
    for (const field of config.quickFields) {
      if (field.key === "title") defaults[field.key] = project.project.name ?? "";
      else if (field.key === "genre") defaults[field.key] = project.project.genre ?? "";
      else if (field.key === "shotDensity") defaults[field.key] = "balanced";
      else if (field.type === "number") defaults[field.key] = 3;
      else defaults[field.key] = "";
    }
    return defaults;
  });

  // Auto-collapse config after successful generation
  const prevStreaming = useRef(isStreaming);
  useEffect(() => {
    if (prevStreaming.current && !isStreaming && !feedback.error) {
      setFormCollapsed(true);
    }
    prevStreaming.current = isStreaming;
  }, [isStreaming, feedback.error]);

  function setFieldValue(key: string, value: unknown) {
    setFormValues((prev) => ({ ...prev, [key]: value }));
  }

  const generateMutation = useMutation({
    mutationFn: async () => {
      setFeedback({ message: null, error: null });
      setGeneratedStoryboard(null);

      const payload = config.buildPayload(formValues, {
        llmConfigSource,
        sourceVersionId,
        project,
      });

      const result = await startStream(`/projects/${projectId}${config.streamEndpoint}`, payload);

      // Post-process based on output type
      if (config.outputType === "storyboard") {
        const content = result.result?.content ?? result.result;
        if (content && typeof content === "object" && ("shots" in (content as object) || "overview" in (content as object))) {
          setGeneratedStoryboard(normalizeStoryboardContent(content));
        } else if (result.text) {
          try {
            const parsed = JSON.parse(result.text);
            if (parsed && typeof parsed === "object" && ("shots" in parsed || "overview" in parsed)) {
              setGeneratedStoryboard(normalizeStoryboardContent(parsed));
            }
          } catch { /* ignore */ }
        }
      }

      return result;
    },
    onSuccess: () => {
      const successKey = config.id === "synopsis"
        ? "synopsisGeneration.synopsisSuccess"
        : config.id === "storyboard"
          ? "projectWorkspace.feedback.storyboardJobSuccess"
          : "projectWorkspace.feedback.scriptJobSuccess";
      setFeedback({ message: t(successKey, { jobId: "queued" }), error: null });
    },
    onError: (error) => {
      const failKey = config.id === "synopsis"
        ? "synopsisGeneration.synopsisFailed"
        : config.id === "storyboard"
          ? "projectWorkspace.feedback.storyboardJobFailed"
          : "synopsisGeneration.expandFailed";
      setFeedback({ message: null, error: formatApiError(error, t, failKey) });
    },
  });

  // Determine which content to show
  function getOutputContent() {
    if (config.outputType === "storyboard") {
      const storyboardDoc = project.documents.find((d) => d.type === "storyboard");
      const storyboardVersion = storyboardDoc
        ? project.versions.find((v) => v.id === storyboardDoc.currentVersionId)
        : null;
      return generatedStoryboard ?? storyboardVersion?.content ?? null;
    }
    if (config.outputType === "script") {
      const scriptDoc = project.documents.find((d) => d.type === "script");
      const scriptVersion = scriptDoc
        ? project.versions.find((v) => v.id === scriptDoc.currentVersionId)
        : null;
      return scriptVersion?.content ?? null;
    }
    // synopsis: text output is ephemeral, shown during/after streaming
    return null;
  }

  const outputContent = getOutputContent();
  const hasOutput = Boolean(outputContent) || (isStreaming && Boolean(streamingText));

  function renderOutput() {
    if (isStreaming && streamingText) {
      return (
        <div className="gen-stream">
          <div className="gen-stream__bar">
            <div className="gen-stream__pulse" />
            <span className="gen-stream__label">{t("common.submitting")}</span>
            <button className="gen-stream__stop" type="button" onClick={stopStream}>
              <StopIcon />
              {t("common.cancel") ?? "Stop"}
            </button>
          </div>
          <pre className="gen-stream__text">
            {streamingText}
            <span className="gen-stream__cursor" />
          </pre>
        </div>
      );
    }

    if (!outputContent && !isStreaming) {
      return (
        <div className="gen-empty">
          <div className="gen-empty__glow" />
          <div className="gen-empty__icon">
            <svg width="56" height="56" viewBox="0 0 56 56" fill="none" aria-hidden="true">
              <path d="M28 6l5.25 12.25L46 23.5l-12.75 5.25L28 41l-5.25-12.25L10 23.5l12.75-5.25L28 6z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" opacity="0.5" />
              <path d="M44 32l3 6.5L53 42l-6 3L44 51l-3-6-6-3 6-3.5L44 32z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" opacity="0.35" />
              <path d="M14 35l2 4L20 41l-4 2-2 4-2-4-4-2 4-2 2-4z" stroke="currentColor" strokeWidth="1" strokeLinejoin="round" opacity="0.25" />
            </svg>
          </div>
          <div className="gen-empty__title">{t("projectWorkspace.generate.outputEmpty")}</div>
          <div className="gen-empty__hint">{t("projectWorkspace.generate.outputEmptyHint")}</div>
        </div>
      );
    }

    if (config.outputType === "script" && outputContent && typeof outputContent === "object") {
      return <ScriptView content={normalizeScriptContent(outputContent)} />;
    }
    if (config.outputType === "storyboard" && outputContent && typeof outputContent === "object") {
      return <StoryboardPreview content={normalizeStoryboardContent(outputContent)} />;
    }
    // Text output (synopsis)
    if (typeof outputContent === "string") {
      return (
        <div className="gen-synopsis__body">
          <div className="gen-synopsis__text vv-markdown"><ReactMarkdown>{outputContent}</ReactMarkdown></div>
        </div>
      );
    }
    return null;
  }

  // Check required fields
  const missingRequired = config.quickFields.some((f) => f.required && !String(formValues[f.key] ?? "").trim());

  // For storyboard: need a source version
  const needsSourceVersion = config.sourcePicker?.sourceType === "script";
  const scriptDoc = project.documents.find((d) => d.type === "script");
  const scriptVersion = scriptDoc
    ? project.versions.find((v) => v.id === scriptDoc.currentVersionId)
    : null;
  const hasSourceVersion = !needsSourceVersion || Boolean(scriptVersion);

  // Auto-select latest source version
  useEffect(() => {
    if (!config.sourcePicker) return;
    const sourceDoc = project.documents.find((d) => d.type === config.sourcePicker!.sourceType);
    if (sourceDoc?.currentVersionId && !sourceVersionId) {
      setSourceVersionId(sourceDoc.currentVersionId);
    }
  }, [project, config.sourcePicker, sourceVersionId]);

  // Pre-fill premise from source version (for script generator)
  useEffect(() => {
    if (config.id !== "script" || !sourceVersionId) return;
    const version = project.versions.find((v) => v.id === sourceVersionId);
    if (!version) return;
    const content = version.content;
    if (typeof content === "string") {
      setFieldValue("premise", content);
      if (version.title) setFieldValue("title", version.title);
    } else if (content && typeof content === "object") {
      const c = content as Record<string, unknown>;
      if ("premise" in c && typeof c.premise === "string") {
        setFieldValue("premise", c.premise);
      } else if ("logline" in c && typeof c.logline === "string") {
        setFieldValue("premise", c.logline);
      }
    }
  }, [config.id, sourceVersionId, project.versions]);

  return (
    <div>
      {/* Configuration section */}
      <section className={`gen-config${formCollapsed ? " gen-config--collapsed" : ""}${isStreaming ? " gen-config--busy" : ""}`}>
        <button
          className="gen-config__head"
          type="button"
          onClick={() => setFormCollapsed(!formCollapsed)}
          aria-expanded={!formCollapsed}
        >
          <div className="gen-config__title">
            <SparkleIcon size={18} />
            <span>{t("projectWorkspace.generate.promptSettings")}</span>
          </div>
          <svg
            width="16" height="16" viewBox="0 0 24 24" fill="none"
            stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
            style={{
              transition: "transform 0.3s cubic-bezier(0.4,0,0.2,1)",
              transform: !formCollapsed ? "rotate(0deg)" : "rotate(-90deg)",
            }}
          >
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </button>

        {!formCollapsed && (
          <div className="gen-config__body">
            {/* Feedback */}
            {feedback.message ? <div className="gen-notice gen-notice--ok" role="status">{feedback.message}</div> : null}
            {feedback.error ? <div className="gen-notice gen-notice--err" role="alert">{feedback.error}</div> : null}

            {/* World bible indicator */}
            <WorldBibleIndicator project={project} />

            {/* Source picker */}
            {config.sourcePicker && (
              <SourcePicker
                config={config.sourcePicker}
                project={project}
                value={sourceVersionId}
                onChange={setSourceVersionId}
              />
            )}

            {/* Dynamic form fields */}
            <div className="gen-fields-section">
              {config.hintKey && <p className="gen-hint">{t(config.hintKey as TranslationKey)}</p>}
              <div className="gen-fields">
                {config.quickFields.map((field) => (
                  <div key={field.key} className={`form-group${field.fullWidth ? " gen-field--full" : ""}`}>
                    <label className="form-label">{t(field.labelKey as TranslationKey)}</label>
                    {field.type === "select" ? (
                      <select
                        className="input"
                        value={String(formValues[field.key] ?? "")}
                        onChange={(e) => setFieldValue(field.key, e.target.value)}
                      >
                        {field.options?.map((opt) => (
                          <option key={opt.value} value={opt.value}>{t(opt.labelKey as TranslationKey)}</option>
                        ))}
                      </select>
                    ) : field.type === "textarea" ? (
                      <textarea
                        className="input"
                        rows={field.rows ?? 3}
                        value={String(formValues[field.key] ?? "")}
                        onChange={(e) => setFieldValue(field.key, e.target.value)}
                        placeholder={field.placeholderKey ? t(field.placeholderKey as TranslationKey) : undefined}
                        style={{ resize: "vertical" }}
                      />
                    ) : field.type === "number" ? (
                      <input
                        className="input"
                        type="number"
                        min={field.min}
                        max={field.max}
                        value={Number(formValues[field.key] ?? 1)}
                        onChange={(e) => setFieldValue(field.key, Number(e.target.value) || 1)}
                      />
                    ) : (
                      <input
                        className="input"
                        type="text"
                        value={String(formValues[field.key] ?? "")}
                        onChange={(e) => setFieldValue(field.key, e.target.value)}
                        placeholder={field.placeholderKey ? t(field.placeholderKey as TranslationKey) : undefined}
                      />
                    )}
                  </div>
                ))}
              </div>
              <button
                className="gen-action-btn"
                type="button"
                onClick={() => generateMutation.mutate()}
                disabled={generateMutation.isPending || isStreaming || missingRequired || !hasSourceVersion}
              >
                <SparkleIcon size={16} />
                {generateMutation.isPending || isStreaming
                  ? t("common.submitting")
                  : t(config.id === "synopsis" ? "synopsisGeneration.generateSynopsis" : config.id === "storyboard" ? "projectWorkspace.generate.extractStoryboard" : "projectWorkspace.generate.generateScript")}
              </button>
            </div>
          </div>
        )}
      </section>

      {/* Synopsis result section (between config and output) */}
      {config.id === "synopsis" && isStreaming && streamingText && (
        <section className="gen-synopsis">
          <div className="gen-synopsis__head">
            <h4 className="gen-synopsis__title">{t("synopsisGeneration.synopsisResult")}</h4>
            <div className="gen-synopsis__actions">
              <div className="gen-stream__pulse" />
              <button className="gen-stream__stop" type="button" onClick={stopStream}>
                <StopIcon />
                {t("common.cancel") ?? "Stop"}
              </button>
            </div>
          </div>
          <div className="gen-synopsis__body">
            <pre className="gen-synopsis__text">{streamingText}<span className="gen-stream__cursor" /></pre>
          </div>
        </section>
      )}

      {/* Output section */}
      <section className="gen-output">
        <div className="gen-output__head">
          <h3 className="gen-output__title">{t("projectWorkspace.generate.outputTitle")}</h3>
          {hasOutput && (
            <div className="gen-output__actions">
              <div className="gen-output__badge">
                <div className="gen-output__dot" />
                {t(config.labelKey as TranslationKey)}
              </div>
            </div>
          )}
        </div>
        <div className="gen-output__body">
          {renderOutput()}
        </div>
      </section>
    </div>
  );
}
