/**
 * @fileoverview 文本生成面板
 * @module web/components/project-workspace
 *
 * AI 剧本/大纲/分镜生成的参数配置和流式输出界面。
 */

"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  normalizeScriptContent,
  normalizeStoryboardContent,
  type LlmConfigSource,
  type ProjectWorkspacePayload,
  type ScriptContent,
  type StoryboardContent,
  type VersionRecord,
} from "@dramaflow/shared";

import { apiStreamFetch, formatApiError } from "../../lib/api";
import { queryKeys } from "../../lib/query-keys";
import { useI18n, getShotDensityLabel } from "../../lib/i18n";
import { ScriptView, StoryboardPreview } from "./version-view";

interface Props {
  projectId: string;
  project: ProjectWorkspacePayload;
  selectedVersion?: Pick<VersionRecord, "id" | "title" | "content"> | null;
  onEditResult?: (content: ScriptContent | StoryboardContent) => void;
}

type GenerationStep = "synopsis" | "script";

/* ── Inline SVG icons ── */
function SparkleIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 2l2.4 7.2L22 12l-7.6 2.8L12 22l-2.4-7.2L2 12l7.6-2.8L12 2z" />
    </svg>
  );
}

function ChevronIcon({ open }: { open: boolean }) {
  return (
    <svg
      width="16" height="16" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
      style={{
        transition: "transform 0.3s cubic-bezier(0.4,0,0.2,1)",
        transform: open ? "rotate(0deg)" : "rotate(-90deg)",
      }}
    >
      <polyline points="6 9 12 15 18 9" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="20 6 9 17 4 12" />
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

export function TextGeneratorPanel({ projectId, project, selectedVersion: externalSelectedVersion, onEditResult }: Props) {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const abortRef = useRef<AbortController | null>(null);

  async function invalidateGenerationState() {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.project(projectId) }),
      queryClient.invalidateQueries({ queryKey: queryKeys.projectVersions(projectId) }),
      queryClient.invalidateQueries({ queryKey: queryKeys.projectJobs(projectId) }),
    ]);
  }

  // Synopsis step state — pre-fill from project metadata
  const [synTitle, setSynTitle] = useState(project.project.name ?? "");
  const [synGenre, setSynGenre] = useState(project.project.genre ?? "");
  const [synTheme, setSynTheme] = useState("");
  const [synKeywords, setSynKeywords] = useState("");
  const [synEpisodeCount, setSynEpisodeCount] = useState(3);
  const [synConstraints, setSynConstraints] = useState("");
  const [synopsisResult, setSynopsisResult] = useState<string | null>(null);
  const [synopsisEditable, setSynopsisEditable] = useState(false);
  const [generationStep, setGenerationStep] = useState<GenerationStep>("synopsis");
  const [llmConfigSource, setLlmConfigSource] = useState<LlmConfigSource>("team");

  // Streaming state
  const [streamingText, setStreamingText] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);

  // Script step state
  const [scriptTitle, setScriptTitle] = useState(project.project.name ?? "");
  const [scriptGenre, setScriptGenre] = useState(project.project.genre ?? "");
  const [scriptPremise, setScriptPremise] = useState("");
  const [episodeGoal, setEpisodeGoal] = useState("");
  const [tone, setTone] = useState("");
  const [audience, setAudience] = useState("");
  const [cinematicStyle, setCinematicStyle] = useState("");
  const [shotDensity, setShotDensity] = useState<"sparse" | "balanced" | "dense">("balanced");

  // Sync form fields when user switches to a different version in the sidebar
  const lastSyncedVersionId = useRef<string | null>(null);
  useEffect(() => {
    if (isStreaming) return; // Don't overwrite while generating

    if (!externalSelectedVersion) {
      lastSyncedVersionId.current = null;
      setSynTitle(project.project.name ?? "");
      setSynGenre(project.project.genre ?? "");
      setScriptTitle(project.project.name ?? "");
      setScriptGenre(project.project.genre ?? "");
      setSynopsisResult(null);
      setSynopsisEditable(false);
      setScriptPremise("");
      return;
    }

    if (externalSelectedVersion.id === lastSyncedVersionId.current) return;
    lastSyncedVersionId.current = externalSelectedVersion.id;

    // Always sync title from the selected version
    const versionTitle = externalSelectedVersion.title || project.project.name || "";
    setSynTitle(versionTitle);
    setScriptTitle(versionTitle);
    setSynopsisEditable(false);

    if (project.project.genre) {
      setSynGenre(project.project.genre);
      setScriptGenre(project.project.genre);
    }

    const content = externalSelectedVersion.content;
    if (typeof content === "string") {
      setSynopsisResult(content);
      setScriptPremise(content);
      return;
    }

    setSynopsisResult(null);

    if (!content || typeof content !== "object") {
      setScriptPremise("");
      return;
    }

    const c = content as Record<string, unknown>;

    // Script content: extract logline, premise, characters, genre
    if ("logline" in c || "premise" in c || "scenes" in c) {
      const premise = (c as { premise?: string }).premise;
      const logline = (c as { logline?: string }).logline;
      setScriptPremise(premise || logline || "");
      return;
    }

    setScriptPremise("");
  }, [externalSelectedVersion, isStreaming, project.project.name, project.project.genre]);
  const [targetType, setTargetType] = useState<"script" | "storyboard">("script");
  const [feedback, setFeedback] = useState<{ message: string | null; error: string | null }>({ message: null, error: null });
  const [generatedStoryboard, setGeneratedStoryboard] = useState<StoryboardContent | null>(null);
  const [formCollapsed, setFormCollapsed] = useState(false);

  const latestScript = useMemo(() => project.documents.find((document) => document.type === "script"), [project.documents]);
  const latestScriptVersion = useMemo(() => {
    if (!latestScript?.currentVersionId) {
      return null;
    }
    return project.versions.find((version) => version.id === latestScript.currentVersionId) ?? null;
  }, [latestScript?.currentVersionId, project.versions]);

  const storyboardDocument = useMemo(() => project.documents.find((document) => document.type === "storyboard"), [project.documents]);
  const latestStoryboardVersion = useMemo(() => {
    if (!storyboardDocument?.currentVersionId) return null;
    return project.versions.find((v) => v.id === storyboardDocument.currentVersionId) ?? null;
  }, [storyboardDocument?.currentVersionId, project.versions]);
  const hasScript = Boolean(latestScript && latestScriptVersion);

  function stopStreaming() {
    abortRef.current?.abort();
    abortRef.current = null;
    setIsStreaming(false);
  }

  // Auto-collapse config after successful generation
  const prevStreaming = useRef(isStreaming);
  useEffect(() => {
    if (prevStreaming.current && !isStreaming && !feedback.error) {
      setFormCollapsed(true);
    }
    prevStreaming.current = isStreaming;
  }, [isStreaming, feedback.error]);

  // Synopsis generation with SSE streaming
  const synopsisMutation = useMutation({
    mutationFn: async () => {
      setStreamingText("");
      setIsStreaming(true);
      setSynopsisResult(null);
      setFeedback({ message: null, error: null });

      const controller = new AbortController();
      abortRef.current = controller;

      let accumulated = "";
      let finalSynopsis: string | null = null;

      for await (const chunk of apiStreamFetch(`/projects/${projectId}/synopsis-jobs/stream`, {
        method: "POST",
        signal: controller.signal,
        body: {
          title: synTitle,
          genre: synGenre,
          theme: synTheme,
          keywords: synKeywords.split(",").map((k) => k.trim()).filter(Boolean),
          episodeCount: synEpisodeCount,
          constraints: synConstraints || undefined,
          llmConfigSource,
        },
      })) {
        if (chunk.type === "chunk" && chunk.content) {
          accumulated += chunk.content;
          setStreamingText(accumulated);
        } else if (chunk.type === "done" && chunk.result) {
          const result = chunk.result as { synopsis?: string; jobId?: string };
          finalSynopsis = result.synopsis ?? accumulated;
        } else if (chunk.type === "error") {
          throw new Error(chunk.error);
        }
      }

      setIsStreaming(false);
      abortRef.current = null;
      setSynopsisResult(finalSynopsis ?? accumulated);
      setStreamingText("");
      await invalidateGenerationState();
    },
    onSuccess: () => {
      setFeedback({ message: t("synopsisGeneration.synopsisSuccess"), error: null });
    },
    onError: (error) => {
      setIsStreaming(false);
      abortRef.current = null;
      setStreamingText("");
      setFeedback({ message: null, error: formatApiError(error, t, "synopsisGeneration.synopsisFailed") });
    },
  });

  // Script generation with SSE streaming
  const scriptMutation = useMutation({
    mutationFn: async () => {
      setStreamingText("");
      setIsStreaming(true);
      setFeedback({ message: null, error: null });

      const controller = new AbortController();
      abortRef.current = controller;

      let accumulated = "";

      for await (const chunk of apiStreamFetch(`/projects/${projectId}/script-jobs/stream`, {
        method: "POST",
        signal: controller.signal,
        body: {
          title: scriptTitle || synTitle,
          genre: scriptGenre || synGenre,
          premise: scriptPremise || synopsisResult || "",
          episodeGoal,
          tone,
          audience,
          llmConfigSource,
        },
      })) {
        if (chunk.type === "chunk" && chunk.content) {
          accumulated += chunk.content;
          setStreamingText(accumulated);
        } else if (chunk.type === "error") {
          throw new Error(chunk.error);
        }
      }

      setIsStreaming(false);
      abortRef.current = null;
      setStreamingText("");
      await invalidateGenerationState();
    },
    onSuccess: () => {
      setFeedback({ message: generationStep === "script" ? t("synopsisGeneration.expandSuccess") : t("projectWorkspace.feedback.scriptJobSuccess", { jobId: "queued" }), error: null });
    },
    onError: (error) => {
      setIsStreaming(false);
      abortRef.current = null;
      setStreamingText("");
      setFeedback({ message: null, error: formatApiError(error, t, "synopsisGeneration.expandFailed") });
    },
  });

  // Storyboard generation with SSE streaming
  const storyboardMutation = useMutation({
    mutationFn: async () => {
      if (!storyboardDocument || !latestScriptVersion) {
        throw new Error(t("projectWorkspace.feedback.storyboardMissingScript"));
      }

      setStreamingText("");
      setIsStreaming(true);
      setFeedback({ message: null, error: null });
      setGeneratedStoryboard(null);

      const controller = new AbortController();
      abortRef.current = controller;

      let accumulated = "";
      let capturedResult: StoryboardContent | null = null;

      for await (const chunk of apiStreamFetch(`/projects/${projectId}/storyboard-jobs/stream`, {
        method: "POST",
        signal: controller.signal,
        body: {
          documentId: storyboardDocument.id,
          versionId: latestScriptVersion.id,
          cinematicStyle,
          shotDensity,
          llmConfigSource,
        },
      })) {
        if (chunk.type === "chunk" && chunk.content) {
          accumulated += chunk.content;
          setStreamingText(accumulated);
        } else if (chunk.type === "done" && chunk.result) {
          const result = chunk.result as Record<string, unknown>;
          const content = (result.content ?? result) as unknown;
          if (content && typeof content === "object" && ("shots" in content || "overview" in content)) {
            capturedResult = normalizeStoryboardContent(content);
          }
        } else if (chunk.type === "error") {
          throw new Error(chunk.error);
        }
      }

      if (!capturedResult && accumulated) {
        try {
          const parsed = JSON.parse(accumulated) as unknown;
          if (parsed && typeof parsed === "object" && ("shots" in parsed || "overview" in parsed)) {
            capturedResult = normalizeStoryboardContent(parsed);
          }
        } catch {
          // accumulated text was not valid JSON; that's fine
        }
      }

      if (capturedResult) {
        setGeneratedStoryboard(capturedResult);
      }

      setIsStreaming(false);
      abortRef.current = null;
      setStreamingText("");
      await invalidateGenerationState();
    },
    onSuccess: () => {
      setFeedback({ message: t("projectWorkspace.feedback.storyboardJobSuccess", { jobId: "queued" }), error: null });
    },
    onError: (error) => {
      setIsStreaming(false);
      abortRef.current = null;
      setStreamingText("");
      setFeedback({ message: null, error: formatApiError(error, t, "projectWorkspace.feedback.storyboardJobFailed") });
    },
  });

  function handleConfirmSynopsis() {
    setScriptTitle(synTitle);
    setScriptGenre(synGenre);
    setScriptPremise(synopsisResult || "");
    setGenerationStep("script");
  }


  // Determine which content to show based on target type
  const outputContent = targetType === "script"
    ? latestScriptVersion?.content
    : (generatedStoryboard ?? latestStoryboardVersion?.content);

  const hasOutput = Boolean(outputContent) || (isStreaming && Boolean(streamingText));

  function renderOutput() {
    if (isStreaming && streamingText) {
      return (
        <div className="gen-stream">
          <div className="gen-stream__bar">
            <div className="gen-stream__pulse" />
            <span className="gen-stream__label">{t("common.submitting")}</span>
            <button className="gen-stream__stop" type="button" onClick={stopStreaming}>
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

    if (!outputContent) {
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
    if (targetType === "script" && typeof outputContent === "object") {
      return <ScriptView content={normalizeScriptContent(outputContent)} />;
    }
    if (targetType === "storyboard" && typeof outputContent === "object") {
      return <StoryboardPreview content={normalizeStoryboardContent(outputContent)} />;
    }
    return (
      <pre style={{ whiteSpace: "pre-wrap", lineHeight: 1.8, color: "var(--text-primary)", fontSize: "13px" }}>
        {typeof outputContent === "string" ? outputContent : JSON.stringify(outputContent, null, 2)}
      </pre>
    );
  }

  /* ── Step indicator rendering ── */
  function renderStepNum(step: number, isActive: boolean, isCompleted: boolean) {
    if (isCompleted && !isActive) {
      return <span className="gen-step__check"><CheckIcon /></span>;
    }
    return <span className="gen-step__num">{step}</span>;
  }

  return (
    <div className="gen-root">
      {/* ═══ Section 1: Configuration ═══ */}
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
          <ChevronIcon open={!formCollapsed} />
        </button>

        {!formCollapsed && (
          <div className="gen-config__body">
            {/* Target type + LLM source */}
            <div className="gen-config__row">
              <div className="form-group">
                <label className="form-label">{t("projectWorkspace.generate.generationTarget")}</label>
                <div className="gen-toggle-group">
                  <button className={`gen-toggle${targetType === "script" ? " gen-toggle--on" : ""}`} type="button" onClick={() => setTargetType("script")}>{t("projectWorkspace.generate.scriptLabel")}</button>
                  <button className={`gen-toggle${targetType === "storyboard" ? " gen-toggle--on" : ""}`} type="button" onClick={() => setTargetType("storyboard")}>{t("projectWorkspace.generate.storyboardLabel")}</button>
                </div>
              </div>
              <div className="form-group">
                <label className="form-label">{t("projectWorkspace.generate.llmConfigSourceLabel")}</label>
                <div className="gen-toggle-group">
                  <button className={`gen-toggle${llmConfigSource === "team" ? " gen-toggle--on" : ""}`} type="button" onClick={() => setLlmConfigSource("team")}>{t("projectWorkspace.generate.llmConfigSourceTeam")}</button>
                  <button className={`gen-toggle${llmConfigSource === "personal" ? " gen-toggle--on" : ""}`} type="button" onClick={() => setLlmConfigSource("personal")}>{t("projectWorkspace.generate.llmConfigSourcePersonal")}</button>
                </div>
              </div>
            </div>

            {/* Feedback */}
            {feedback.message ? <div className="gen-notice gen-notice--ok" role="status">{feedback.message}</div> : null}
            {feedback.error ? <div className="gen-notice gen-notice--err" role="alert">{feedback.error}</div> : null}

            {/* ── Script flow ── */}
            {targetType === "script" ? (
              <div className="gen-script-flow">
                {/* Step wizard */}
                <div className="gen-step-bar">
                  <button
                    className={`gen-step${generationStep === "synopsis" ? " gen-step--active" : ""}${synopsisResult ? " gen-step--done" : ""}`}
                    type="button"
                    onClick={() => setGenerationStep("synopsis")}
                  >
                    {renderStepNum(1, generationStep === "synopsis", Boolean(synopsisResult))}
                    <span>{t("synopsisGeneration.stepSynopsis")}</span>
                  </button>
                  <div className={`gen-step-line${synopsisResult ? " gen-step-line--done" : ""}`} />
                  <button
                    className={`gen-step${generationStep === "script" ? " gen-step--active" : ""}`}
                    type="button"
                    onClick={() => synopsisResult && setGenerationStep("script")}
                    disabled={!synopsisResult}
                  >
                    {renderStepNum(2, generationStep === "script", false)}
                    <span>{t("synopsisGeneration.stepScript")}</span>
                  </button>
                </div>

                {/* Synopsis step */}
                {generationStep === "synopsis" ? (
                  <div className="gen-fields-section">
                    <p className="gen-hint">{t("synopsisGeneration.description")}</p>
                    <div className="gen-fields">
                      <div className="form-group">
                        <label className="form-label">{t("synopsisGeneration.titleLabel")}</label>
                        <input className="input" value={synTitle} onChange={(e) => setSynTitle(e.target.value)} placeholder={t("synopsisGeneration.titlePlaceholder")} />
                      </div>
                      <div className="form-group">
                        <label className="form-label">{t("synopsisGeneration.genreLabel")}</label>
                        <input className="input" value={synGenre} onChange={(e) => setSynGenre(e.target.value)} placeholder={t("synopsisGeneration.genrePlaceholder")} />
                      </div>
                      <div className="form-group">
                        <label className="form-label">{t("synopsisGeneration.themeLabel")}</label>
                        <input className="input" value={synTheme} onChange={(e) => setSynTheme(e.target.value)} placeholder={t("synopsisGeneration.themePlaceholder")} />
                      </div>
                      <div className="form-group">
                        <label className="form-label">{t("synopsisGeneration.keywordsLabel")}</label>
                        <input className="input" value={synKeywords} onChange={(e) => setSynKeywords(e.target.value)} placeholder={t("synopsisGeneration.keywordsPlaceholder")} />
                      </div>
                      <div className="form-group">
                        <label className="form-label">{t("synopsisGeneration.episodeCountLabel")}</label>
                        <input className="input" type="number" min={1} max={30} value={synEpisodeCount} onChange={(e) => setSynEpisodeCount(Number(e.target.value) || 1)} />
                      </div>
                      <div className="form-group gen-field--full">
                        <label className="form-label">{t("synopsisGeneration.constraintsLabel")}</label>
                        <textarea className="input" rows={2} value={synConstraints} onChange={(e) => setSynConstraints(e.target.value)} placeholder={t("synopsisGeneration.constraintsPlaceholder")} style={{ resize: "vertical" }} />
                      </div>
                    </div>
                    <button
                      className="gen-action-btn"
                      type="button"
                      onClick={() => synopsisMutation.mutate()}
                      disabled={synopsisMutation.isPending || isStreaming || !synTitle.trim() || !synGenre.trim() || !synTheme.trim()}
                    >
                      <SparkleIcon size={16} />
                      {synopsisMutation.isPending || (isStreaming && !synopsisResult) ? t("synopsisGeneration.generating") : t("synopsisGeneration.generateSynopsis")}
                    </button>
                  </div>
                ) : (
                  <div className="gen-fields-section">
                    {synopsisResult && (
                      <button className="gen-back-btn" type="button" onClick={() => setGenerationStep("synopsis")}>
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6" /></svg>
                        {t("synopsisGeneration.backToSynopsis")}
                      </button>
                    )}
                    <div className="gen-fields">
                      <div className="form-group">
                        <label className="form-label">{t("projectWorkspace.sidebar.scriptTitleLabel")}</label>
                        <input className="input" value={scriptTitle} onChange={(event) => setScriptTitle(event.target.value)} placeholder={t("projectWorkspace.sidebar.scriptTitlePlaceholder")} />
                      </div>
                      <div className="form-group">
                        <label className="form-label">{t("projectWorkspace.sidebar.genreLabel")}</label>
                        <input className="input" value={scriptGenre} onChange={(event) => setScriptGenre(event.target.value)} placeholder={t("projectWorkspace.sidebar.genrePlaceholder")} />
                      </div>
                      <div className="form-group gen-field--full">
                        <label className="form-label">{t("projectWorkspace.sidebar.premiseLabel")}</label>
                        <textarea className="input" value={scriptPremise} onChange={(event) => setScriptPremise(event.target.value)} placeholder={t("projectWorkspace.sidebar.premisePlaceholder")} style={{ minHeight: 80, resize: "vertical" }} />
                      </div>
                      <div className="form-group">
                        <label className="form-label">{t("projectWorkspace.sidebar.episodeGoalLabel")}</label>
                        <input className="input" value={episodeGoal} onChange={(event) => setEpisodeGoal(event.target.value)} placeholder={t("projectWorkspace.sidebar.episodeGoalPlaceholder")} />
                      </div>
                      <div className="form-group">
                        <label className="form-label">{t("projectWorkspace.sidebar.toneLabel")}</label>
                        <input className="input" value={tone} onChange={(event) => setTone(event.target.value)} placeholder={t("projectWorkspace.sidebar.tonePlaceholder")} />
                      </div>
                      <div className="form-group">
                        <label className="form-label">{t("projectWorkspace.sidebar.audienceLabel")}</label>
                        <input className="input" value={audience} onChange={(event) => setAudience(event.target.value)} placeholder={t("projectWorkspace.sidebar.audiencePlaceholder")} />
                      </div>
                    </div>
                    <button className="gen-action-btn" type="button" onClick={() => scriptMutation.mutate()} disabled={scriptMutation.isPending || isStreaming || !scriptTitle.trim() || !scriptGenre.trim() || !scriptPremise.trim()}>
                      <SparkleIcon size={16} />
                      {scriptMutation.isPending || isStreaming ? t("common.submitting") : t("projectWorkspace.generate.generateScript")}
                    </button>
                  </div>
                )}
              </div>
            ) : (
              <div className="gen-fields-section">
                <p className="gen-hint">{t("projectWorkspace.generate.storyboardHint")}</p>
                <div className="gen-fields">
                  <div className="form-group gen-field--full">
                    <label className="form-label">{t("projectWorkspace.generate.baseScriptStatus")}</label>
                    {hasScript ? (
                      <div className="gen-status gen-status--ok">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
                        {t("projectWorkspace.generate.scriptReady", { title: latestScript?.title ?? "" })}
                      </div>
                    ) : (
                      <div className="gen-status gen-status--warn">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" /></svg>
                        {t("projectWorkspace.generate.noScriptYet")}
                      </div>
                    )}
                  </div>
                  <div className="form-group gen-field--full">
                    <label className="form-label">{t("projectWorkspace.sidebar.cinematicStyleLabel")}</label>
                    <textarea className="input" value={cinematicStyle} onChange={(event) => setCinematicStyle(event.target.value)} placeholder={t("projectWorkspace.sidebar.cinematicStylePlaceholder")} style={{ minHeight: 80, resize: "vertical" }} />
                  </div>
                  <div className="form-group">
                    <label className="form-label">{t("projectWorkspace.sidebar.shotDensityLabel")}</label>
                    <select className="input" value={shotDensity} onChange={(event) => setShotDensity(event.target.value as "sparse" | "balanced" | "dense")}>
                      {(["sparse", "balanced", "dense"] as const).map((value) => (
                        <option key={value} value={value}>{getShotDensityLabel(t, value)}</option>
                      ))}
                    </select>
                  </div>
                </div>
                <button className="gen-action-btn gen-action-btn--secondary" type="button" onClick={() => storyboardMutation.mutate()} disabled={storyboardMutation.isPending || isStreaming || !hasScript || !cinematicStyle.trim()}>
                  <SparkleIcon size={16} />
                  {storyboardMutation.isPending || isStreaming ? t("common.submitting") : t("projectWorkspace.generate.extractStoryboard")}
                </button>
              </div>
            )}
          </div>
        )}
      </section>

      {/* ═══ Section 2: Synopsis Result (between config and output) ═══ */}
      {(isStreaming && streamingText && !synopsisResult && generationStep === "synopsis") && (
        <section className="gen-synopsis">
          <div className="gen-synopsis__head">
            <h4 className="gen-synopsis__title">{t("synopsisGeneration.synopsisResult")}</h4>
            <div className="gen-synopsis__actions">
              <div className="gen-stream__pulse" />
              <button className="gen-stream__stop" type="button" onClick={stopStreaming}>
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

      {synopsisResult && generationStep === "synopsis" && (
        <section className="gen-synopsis">
          <div className="gen-synopsis__head">
            <h4 className="gen-synopsis__title">{t("synopsisGeneration.synopsisResult")}</h4>
            <div className="gen-synopsis__actions">
              <button className="btn btn-ghost btn-sm" type="button" onClick={() => setSynopsisEditable(!synopsisEditable)}>
                {synopsisEditable ? t("synopsisGeneration.confirmSynopsis") : t("synopsisGeneration.editSynopsis")}
              </button>
              <button className="gen-action-btn gen-action-btn--sm" type="button" onClick={handleConfirmSynopsis}>
                <SparkleIcon size={14} />
                {t("synopsisGeneration.expandToScript")}
              </button>
            </div>
          </div>
          <div className="gen-synopsis__body">
            {synopsisEditable ? (
              <textarea
                className="input gen-synopsis__text"
                rows={12}
                value={synopsisResult}
                onChange={(e) => setSynopsisResult(e.target.value)}
                style={{ resize: "vertical", whiteSpace: "pre-wrap", fontFamily: "inherit", lineHeight: 1.7 }}
              />
            ) : (
              <div className="gen-synopsis__text vv-markdown"><ReactMarkdown>{synopsisResult}</ReactMarkdown></div>
            )}
          </div>
        </section>
      )}

      {/* ═══ Section 3: Output ═══ */}
      <section className="gen-output">
        <div className="gen-output__head">
          <h3 className="gen-output__title">{t("projectWorkspace.generate.outputTitle")}</h3>
          {hasOutput && (
            <div className="gen-output__actions">
              <div className="gen-output__badge">
                <div className="gen-output__dot" />
                {targetType === "script" ? t("projectWorkspace.generate.scriptLabel") : t("projectWorkspace.generate.storyboardLabel")}
              </div>
              {onEditResult && outputContent && typeof outputContent === "object" ? (
                <button
                  className="btn btn-secondary btn-sm"
                  type="button"
                  onClick={() => onEditResult(outputContent as ScriptContent | StoryboardContent)}
                >
                  {t("projectWorkspace.generate.editResult")}
                </button>
              ) : null}
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
