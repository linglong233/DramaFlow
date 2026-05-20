"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import ReactMarkdown from "react-markdown";
import type {
  CreateNovelImportSessionPayload,
  LatestNovelImportSessionResponse,
  LlmConfigSource,
  NovelImportJobResponse,
  NovelImportSession,
  NovelImportSessionResponse,
  NovelImportWriteDraftsResponse,
  ProjectWorkspacePayload,
} from "@dramaflow/shared";
import { normalizeScriptContent, normalizeWorldBibleContent } from "@dramaflow/shared";

import { apiFetch, formatApiError } from "../../../lib/api";
import { queryKeys } from "../../../lib/query-keys";
import { useFeedback } from "../../../lib/hooks";
import { useI18n } from "../../../lib/i18n";
import type { GeneratorConfig } from "./generator-registry";
import { ScriptView, WorldBibleView } from "../version-view";

// ── 类型定义 ──

interface Props {
  config: GeneratorConfig;
  project: ProjectWorkspacePayload;
  projectId: string;
  llmConfigSource: LlmConfigSource;
}

type WizardStep = "setup" | "progress" | "review";
type PreviewTab = "worldBible" | "synopsis" | "script";

interface SetupDraft {
  text: string;
  targetEpisodeCount: number;
  episodeDurationMinutes: number;
  genreStyle: string;
  adaptationFocus: string;
}

// ── 组件 ──

export function NovelImportGenerator({ projectId, llmConfigSource }: Props) {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const { feedback, setFeedback } = useFeedback();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [step, setStep] = useState<WizardStep>("setup");
  const [previewTab, setPreviewTab] = useState<PreviewTab>("worldBible");
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [draft, setDraft] = useState<SetupDraft>({
    text: "",
    targetEpisodeCount: 12,
    episodeDurationMinutes: 2,
    genreStyle: "",
    adaptationFocus: "",
  });

  // ── 查询：最新会话（恢复用） ──

  const latestQuery = useQuery({
    queryKey: queryKeys.novelImportLatest(projectId),
    queryFn: () =>
      apiFetch<LatestNovelImportSessionResponse>(
        `/projects/${projectId}/novel-import-sessions/latest`,
      ),
  });

  // 挂载时自动恢复会话状态
  useEffect(() => {
    const session = latestQuery.data?.session;
    if (!session || activeSessionId) return;
    setActiveSessionId(session.id);
    setStep(
      session.status === "needs_review" || session.status === "written"
        ? "review"
        : session.status === "draft"
          ? "setup"
          : "progress",
    );
  }, [activeSessionId, latestQuery.data?.session]);

  // ── 查询：当前会话详情（轮询） ──

  const sessionQuery = useQuery({
    queryKey: activeSessionId
      ? queryKeys.novelImportSession(activeSessionId)
      : ["novel-import-session", "none"],
    enabled: Boolean(activeSessionId),
    queryFn: () =>
      apiFetch<NovelImportSessionResponse>(
        `/novel-import-sessions/${activeSessionId}`,
      ),
    refetchInterval: (query) => {
      const status = query.state.data?.session.status;
      return status === "queued" || status === "running" ? 2500 : false;
    },
  });

  const session =
    sessionQuery.data?.session ?? latestQuery.data?.session ?? null;

  // ── 变更：创建会话 ──

  const createSessionMutation = useMutation({
    mutationFn: (payload: CreateNovelImportSessionPayload) =>
      apiFetch<NovelImportSessionResponse>(
        `/projects/${projectId}/novel-import-sessions`,
        { method: "POST", body: payload },
      ),
    onSuccess: (payload) => {
      setActiveSessionId(payload.session.id);
      setStep("setup");
      queryClient.setQueryData(
        queryKeys.novelImportSession(payload.session.id),
        payload,
      );
      queryClient.invalidateQueries({
        queryKey: queryKeys.novelImportLatest(projectId),
      });
    },
    onError: (error) =>
      setFeedback({
        message: null,
        error: formatApiError(error, t, "novelImport.createFailed"),
      }),
  });

  // ── 变更：通用动作（start / cancel / retry / rerun） ──

  const actionMutation = useMutation({
    mutationFn: (path: string) =>
      apiFetch<NovelImportJobResponse>(path, { method: "POST" }),
    onSuccess: (payload) => {
      setActiveSessionId(payload.session.id);
      setStep("progress");
      queryClient.invalidateQueries({
        queryKey: queryKeys.novelImportSession(payload.session.id),
      });
      queryClient.invalidateQueries({
        queryKey: queryKeys.projectJobs(projectId),
      });
    },
    onError: (error) =>
      setFeedback({
        message: null,
        error: formatApiError(error, t, "novelImport.actionFailed"),
      }),
  });

  // ── 变更：写入草稿 ──

  const writeMutation = useMutation({
    mutationFn: (sessionId: string) =>
      apiFetch<NovelImportWriteDraftsResponse>(
        `/novel-import-sessions/${sessionId}/write-drafts`,
        { method: "POST" },
      ),
    onSuccess: (payload) => {
      setStep("review");
      setFeedback({ message: t("novelImport.writeSuccess"), error: null });
      queryClient.setQueryData(
        queryKeys.novelImportSession(payload.session.id),
        { session: payload.session },
      );
      queryClient.invalidateQueries({
        queryKey: queryKeys.project(projectId),
      });
      queryClient.invalidateQueries({
        queryKey: queryKeys.projectVersions(projectId),
      });
    },
    onError: (error) =>
      setFeedback({
        message: null,
        error: formatApiError(error, t, "novelImport.actionFailed"),
      }),
  });

  // ── 事件处理 ──

  const handleFileUpload = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (readerEvent) => {
        const text = readerEvent.target?.result;
        if (typeof text === "string") {
          setDraft((current) => ({ ...current, text }));
        }
      };
      reader.onerror = () =>
        setFeedback({ message: null, error: "文件读取失败" });
      reader.readAsText(file, "utf-8");
      event.target.value = "";
    },
    [setFeedback],
  );

  const handleCreateSession = useCallback(() => {
    createSessionMutation.mutate({
      text: draft.text,
      targetEpisodeCount: draft.targetEpisodeCount,
      episodeDurationMinutes: draft.episodeDurationMinutes,
      genreStyle: draft.genreStyle,
      adaptationFocus: draft.adaptationFocus,
      llmConfigSource,
    });
  }, [createSessionMutation, draft, llmConfigSource]);

  const handleStart = useCallback(() => {
    if (!session) return;
    actionMutation.mutate(`/novel-import-sessions/${session.id}/start`);
  }, [actionMutation, session]);

  const handleCancel = useCallback(() => {
    if (!session) return;
    actionMutation.mutate(`/novel-import-sessions/${session.id}/cancel`);
  }, [actionMutation, session]);

  const handleRetryChunk = useCallback(
    (index: number) => {
      if (!session) return;
      actionMutation.mutate(
        `/novel-import-sessions/${session.id}/chunks/${index}/retry`,
      );
    },
    [actionMutation, session],
  );

  const handleRerunFollowing = useCallback(
    (index: number) => {
      if (!session) return;
      actionMutation.mutate(
        `/novel-import-sessions/${session.id}/chunks/${index}/rerun-following`,
      );
    },
    [actionMutation, session],
  );

  const handleNewImport = useCallback(() => {
    setActiveSessionId(null);
    setStep("setup");
    setPreviewTab("worldBible");
    setDraft({
      text: "",
      targetEpisodeCount: 12,
      episodeDurationMinutes: 2,
      genreStyle: "",
      adaptationFocus: "",
    });
  }, []);

  // ── 派生值 ──

  const hasStaleChunks = Boolean(
    session?.chunks.some((chunk) => chunk.status === "stale"),
  );
  const canCreate =
    draft.text.trim().length > 0 &&
    draft.targetEpisodeCount > 0 &&
    draft.episodeDurationMinutes > 0;
  const isBusy =
    session?.status === "queued" || session?.status === "running";

  const statusLabel = (status: NovelImportSession["status"]) => {
    const key =
      `novelImport.status${status === "needs_review" ? "NeedsReview" : status.charAt(0).toUpperCase() + status.slice(1)}` as const;
    return t(key as never);
  };

  const progressWidth = `${Math.max(0, Math.min(100, session?.progress ?? 0))}%`;

  const charCount = draft.text.length;

  // ── 渲染 ──

  return (
    <div className="novel-import">
      {/* 步骤切换 */}
      <div className="novel-import-wizard__steps">
        {(["setup", "progress", "review"] as const).map((s) => (
          <button
            key={s}
            className={`novel-import-wizard__step${step === s ? " novel-import-wizard__step--on" : ""}`}
            type="button"
            disabled={!session && s !== "setup"}
            onClick={() => setStep(s)}
          >
            {s === "setup"
              ? t("novelImport.stepSetup")
              : s === "progress"
                ? t("novelImport.stepProgress")
                : t("novelImport.stepReview")}
          </button>
        ))}
      </div>

      {/* 反馈提示 */}
      {feedback.message && (
        <div className="gen-notice gen-notice--ok" role="status">
          {feedback.message}
        </div>
      )}
      {feedback.error && (
        <div className="gen-notice gen-notice--err" role="alert">
          {feedback.error}
        </div>
      )}

      {/* ── 步骤一：导入设置 ── */}
      {step === "setup" && (
        <div className="novel-import-wizard__panel">
          <div className="novel-import__input-area">
            <textarea
              className="input novel-import__textarea"
              rows={10}
              placeholder={t("novelImport.pastePlaceholder")}
              value={draft.text}
              onChange={(e) =>
                setDraft((d) => ({ ...d, text: e.target.value }))
              }
              disabled={Boolean(session)}
            />
            <div className="novel-import__input-footer">
              <span className="novel-import__char-count">
                {charCount > 0
                  ? t("novelImport.charCount", { count: charCount.toLocaleString() })
                  : ""}
              </span>
              <div className="novel-import__actions">
                <button
                  className="btn btn-secondary btn-sm"
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={Boolean(session)}
                >
                  {t("novelImport.uploadTxt")}
                </button>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".txt"
                  onChange={handleFileUpload}
                  hidden
                />
              </div>
            </div>
          </div>

          {/* 参数表单 */}
          <div className="novel-import-wizard__fields">
            <label>
              {t("novelImport.targetEpisodeCount")}
              <input
                className="input"
                type="number"
                min={1}
                max={100}
                value={draft.targetEpisodeCount}
                onChange={(e) =>
                  setDraft((d) => ({
                    ...d,
                    targetEpisodeCount: Number(e.target.value) || 0,
                  }))
                }
                disabled={Boolean(session)}
              />
            </label>
            <label>
              {t("novelImport.episodeDurationMinutes")}
              <input
                className="input"
                type="number"
                min={0.5}
                max={30}
                step={0.5}
                value={draft.episodeDurationMinutes}
                onChange={(e) =>
                  setDraft((d) => ({
                    ...d,
                    episodeDurationMinutes: Number(e.target.value) || 0,
                  }))
                }
                disabled={Boolean(session)}
              />
            </label>
            <label>
              {t("novelImport.genreStyle")}
              <input
                className="input"
                type="text"
                placeholder={t("novelImport.genreStylePlaceholder")}
                value={draft.genreStyle}
                onChange={(e) =>
                  setDraft((d) => ({ ...d, genreStyle: e.target.value }))
                }
                disabled={Boolean(session)}
              />
            </label>
            <label>
              {t("novelImport.adaptationFocus")}
              <input
                className="input"
                type="text"
                placeholder={t("novelImport.adaptationFocusPlaceholder")}
                value={draft.adaptationFocus}
                onChange={(e) =>
                  setDraft((d) => ({
                    ...d,
                    adaptationFocus: e.target.value,
                  }))
                }
                disabled={Boolean(session)}
              />
            </label>
          </div>

          {/* 创建会话或开始生成 */}
          {!session ? (
            <div className="novel-import__actions">
              <button
                className="btn btn-primary btn-sm"
                type="button"
                disabled={!canCreate || createSessionMutation.isPending}
                onClick={handleCreateSession}
              >
                {createSessionMutation.isPending
                  ? "..."
                  : t("novelImport.createSession")}
              </button>
            </div>
          ) : session.status === "draft" ? (
            <div className="novel-import__actions">
              {session.chunks.length > 0 && (
                <span style={{ fontSize: 12, color: "var(--text-tertiary)" }}>
                  {t("novelImport.chunkCount", {
                    count: session.chunks.length,
                  })}
                </span>
              )}
              <button
                className="btn btn-primary btn-sm"
                type="button"
                onClick={handleStart}
                disabled={actionMutation.isPending}
              >
                {t("novelImport.startGeneration")}
              </button>
            </div>
          ) : null}

          {/* 会话创建后的分块预览列表 */}
          {session && session.chunks.length > 0 && (
            <div className="novel-import-wizard__chunks">
              <div className="novel-import-wizard__chunk-list">
                {session.chunks.map((chunk) => (
                  <div
                    key={chunk.index}
                    className={`novel-import-wizard__chunk-card${
                      chunk.status === "failed"
                        ? " novel-import-wizard__chunk-card--failed"
                        : chunk.status === "stale"
                          ? " novel-import-wizard__chunk-card--stale"
                          : ""
                    }`}
                  >
                    <div>
                      <span>
                        #{chunk.index + 1}
                        {chunk.title ? ` — ${chunk.title}` : ""}
                      </span>
                      <span style={{ color: "var(--text-tertiary)" }}>
                        {statusLabel(chunk.status as never)}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── 步骤二：生成进度 ── */}
      {step === "progress" && (
        <div className="novel-import-wizard__panel">
          {/* 进度条 */}
          <div className="novel-import__progress">
            <div className="novel-import__progress-bar">
              <div
                className="novel-import__progress-fill"
                style={{ width: progressWidth }}
              />
            </div>
            <div className="novel-import__progress-text">
              {session
                ? `${statusLabel(session.status)} — ${progressWidth}`
                : ""}
            </div>
          </div>

          {/* 操作按钮 */}
          <div className="novel-import__actions">
            {isBusy && (
              <button
                className="btn btn-secondary btn-sm"
                type="button"
                onClick={handleCancel}
                disabled={actionMutation.isPending}
              >
                {t("novelImport.cancel")}
              </button>
            )}
            <button
              className="btn btn-secondary btn-sm"
              type="button"
              onClick={handleNewImport}
            >
              {t("novelImport.newImport")}
            </button>
          </div>

          {/* 分块状态列表 */}
          {session && session.chunks.length > 0 && (
            <div className="novel-import-wizard__chunks">
              <div className="novel-import-wizard__chunk-list">
                {session.chunks.map((chunk) => (
                  <div
                    key={chunk.index}
                    className={`novel-import-wizard__chunk-card${
                      chunk.status === "failed"
                        ? " novel-import-wizard__chunk-card--failed"
                        : chunk.status === "stale"
                          ? " novel-import-wizard__chunk-card--stale"
                          : ""
                    }`}
                  >
                    <div>
                      <span>
                        #{chunk.index + 1}
                        {chunk.title ? ` — ${chunk.title}` : ""}
                      </span>
                      {chunk.scenes.length > 0 && (
                        <span style={{ color: "var(--text-tertiary)" }}>
                          {t("novelImport.scenesCount", {
                            count: chunk.scenes.length,
                          })}
                        </span>
                      )}
                      {chunk.error && (
                        <span className="novel-import-wizard__error">
                          {chunk.error}
                        </span>
                      )}
                    </div>
                    {(chunk.status === "failed" || chunk.status === "stale") && (
                      <div className="novel-import__actions">
                        <button
                          className="btn btn-secondary btn-sm"
                          type="button"
                          onClick={() => handleRetryChunk(chunk.index)}
                          disabled={actionMutation.isPending}
                        >
                          {t("novelImport.retryChunk")}
                        </button>
                        <button
                          className="btn btn-secondary btn-sm"
                          type="button"
                          onClick={() => handleRerunFollowing(chunk.index)}
                          disabled={actionMutation.isPending}
                        >
                          {t("novelImport.rerunFollowing")}
                        </button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── 步骤三：结果确认 ── */}
      {step === "review" && session && (
        <div className="novel-import-wizard__panel">
          {/* 过期分块警告 */}
          {hasStaleChunks && (
            <div className="gen-notice gen-notice--err">
              {t("novelImport.staleWarning")}
            </div>
          )}

          {/* 预览标签页 */}
          <div className="novel-import__preview-tabs">
            <button
              className={`novel-import__tab${previewTab === "worldBible" ? " novel-import__tab--on" : ""}`}
              type="button"
              onClick={() => setPreviewTab("worldBible")}
            >
              世界观
              {session.worldBible
                ? ` (${session.worldBible.characters.length} 角色)`
                : ""}
            </button>
            <button
              className={`novel-import__tab${previewTab === "synopsis" ? " novel-import__tab--on" : ""}`}
              type="button"
              onClick={() => setPreviewTab("synopsis")}
            >
              大纲
            </button>
            <button
              className={`novel-import__tab${previewTab === "script" ? " novel-import__tab--on" : ""}`}
              type="button"
              onClick={() => setPreviewTab("script")}
            >
              剧本
              {session.scriptPreview
                ? ` (${session.scriptPreview.scenes.length} 场景)`
                : ""}
            </button>
          </div>

          {/* 预览内容 */}
          <div className="novel-import__preview-content">
            {previewTab === "worldBible" && session.worldBible && (
              <WorldBibleView
                content={normalizeWorldBibleContent(session.worldBible)}
              />
            )}
            {previewTab === "synopsis" && session.synopsis && (
              <div className="vv-markdown">
                <ReactMarkdown>{session.synopsis}</ReactMarkdown>
              </div>
            )}
            {previewTab === "script" && session.scriptPreview && (
              <ScriptView
                content={normalizeScriptContent(session.scriptPreview)}
              />
            )}
          </div>

          {/* 写入草稿 & 新建导入按钮 */}
          {session.status === "needs_review" && (
            <div className="novel-import__actions">
              <button
                className="btn btn-primary btn-sm"
                type="button"
                onClick={() => writeMutation.mutate(session.id)}
                disabled={writeMutation.isPending}
              >
                {writeMutation.isPending
                  ? "..."
                  : t("novelImport.writeDrafts")}
              </button>
            </div>
          )}
          <div className="novel-import__actions">
            <button
              className="btn btn-secondary btn-sm"
              type="button"
              onClick={handleNewImport}
            >
              {t("novelImport.newImport")}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
