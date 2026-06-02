"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import ReactMarkdown from "react-markdown";
import type {
  CreateNovelImportSessionPayload,
  LatestNovelImportSessionResponse,
  NovelImportJobResponse,
  NovelImportSession,
  NovelImportSessionResponse,
  NovelImportWriteDraftsResponse,
  ProjectWorkspacePayload,
} from "@dramaflow/shared";
import { normalizeScriptContent, normalizeWorldBibleContent } from "@dramaflow/shared";

import { apiFetch, formatApiError } from "../../lib/api";
import { useI18n } from "../../lib/i18n";
import { useFeedback } from "../../lib/hooks";
import { queryKeys } from "../../lib/query-keys";
import { ScriptView, WorldBibleView } from "./version-view";

// ── 类型定义 ──

interface Props {
  projectId: string;
  project: ProjectWorkspacePayload;
}

type WizardStep = "setup" | "chunks" | "progress" | "review" | "written";
type PreviewTab = "worldBible" | "synopsis" | "script";

interface SetupDraft {
  text: string;
  targetEpisodeCount: number;
  episodeDurationMinutes: number;
  genreStyle: string;
  adaptationFocus: string;
}

// ── 组件 ──

export function NovelImportWorkbench({ projectId, project }: Props) {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const { feedback, setFeedback } = useFeedback();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [step, setStep] = useState<WizardStep>("setup");
  const [previewTab, setPreviewTab] = useState<PreviewTab>("worldBible");
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [ignoredLatestSessionId, setIgnoredLatestSessionId] = useState<string | null>(null);
  const [draft, setDraft] = useState<SetupDraft>({
    text: "",
    targetEpisodeCount: 12,
    episodeDurationMinutes: 2,
    genreStyle: "",
    adaptationFocus: "",
  });

  // 分块编辑状态
  const [editingChunkIndex, setEditingChunkIndex] = useState<number | null>(null);
  const [editingTitle, setEditingTitle] = useState("");
  const [splitDialogIndex, setSplitDialogIndex] = useState<number | null>(null);
  const [splitAt, setSplitAt] = useState<number>(1);
  const [splitNextTitle, setSplitNextTitle] = useState("");

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
    if (!session || activeSessionId || session.id === ignoredLatestSessionId) return;
    setActiveSessionId(session.id);
    if (session.status === "written") {
      setStep("written");
    } else if (session.status === "needs_review") {
      setStep("review");
    } else if (session.status === "draft") {
      setStep("chunks");
    } else if (session.status === "queued" || session.status === "running") {
      setStep("progress");
    } else {
      // failed / cancelled → 回到分块校对，允许重试
      setStep("chunks");
    }
  }, [activeSessionId, ignoredLatestSessionId, latestQuery.data?.session]);

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
      setIgnoredLatestSessionId(null);
      // 创建成功后进入分块校对步骤
      setStep("chunks");
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
      setStep("written");
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
      queryClient.invalidateQueries({
        queryKey: queryKeys.novelImportSession(payload.session.id),
      });
    },
    onError: (error) =>
      setFeedback({
        message: null,
        error: formatApiError(error, t, "novelImport.actionFailed"),
      }),
  });

  // ── 变更：分块编辑（修改标题、拆分、合并、确认） ──

  const chunkEditMutation = useMutation({
    mutationFn: (params: { path: string; method?: string; body?: Record<string, unknown> }) =>
      apiFetch<NovelImportSessionResponse>(params.path, {
        method: params.method ?? "POST",
        body: params.body,
      }),
    onSuccess: (payload) => {
      queryClient.setQueryData(
        queryKeys.novelImportSession(payload.session.id),
        { session: payload.session },
      );
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
        setFeedback({ message: null, error: t("novelImport.fileReadError") });
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
    });
  }, [createSessionMutation, draft]);

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
    if (session) {
      setIgnoredLatestSessionId(session.id);
    }
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
    setEditingChunkIndex(null);
    setSplitDialogIndex(null);
  }, [session]);

  // ── 分块编辑操作 ──

  /** 保存编辑后的分块标题 */
  const handleSaveTitle = useCallback(
    (index: number) => {
      if (!session) return;
      chunkEditMutation.mutate({
        path: `/novel-import-sessions/${session.id}/chunks/${index}/title`,
        method: "PATCH",
        body: { title: editingTitle },
      });
      setEditingChunkIndex(null);
    },
    [chunkEditMutation, editingTitle, session],
  );

  /** 拆分分块 */
  const handleSplit = useCallback(
    (index: number) => {
      if (!session) return;
      chunkEditMutation.mutate({
        path: `/novel-import-sessions/${session.id}/chunks/${index}/split`,
        method: "POST",
        body: { splitAt, nextTitle: splitNextTitle || undefined },
      });
      setSplitDialogIndex(null);
    },
    [chunkEditMutation, session, splitAt, splitNextTitle],
  );

  /** 合并到上一块 */
  const handleMergePrevious = useCallback(
    (index: number) => {
      if (!session || index === 0) return;
      chunkEditMutation.mutate({
        path: `/novel-import-sessions/${session.id}/chunks/${index}/merge-previous`,
        method: "POST",
      });
    },
    [chunkEditMutation, session],
  );

  /** 确认单个分块 */
  const handleConfirmChunk = useCallback(
    (index: number) => {
      if (!session) return;
      chunkEditMutation.mutate({
        path: `/novel-import-sessions/${session.id}/chunks/${index}/confirm`,
        method: "POST",
      });
    },
    [chunkEditMutation, session],
  );

  /** 确认全部分块 */
  const handleConfirmAll = useCallback(() => {
    if (!session) return;
    chunkEditMutation.mutate({
      path: `/novel-import-sessions/${session.id}/chunks/confirm-all`,
      method: "POST",
    });
  }, [chunkEditMutation, session]);

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
  // 分块编辑只在 draft / failed / cancelled 状态下允许
  const canEditChunks =
    session?.status === "draft" ||
    session?.status === "failed" ||
    session?.status === "cancelled";
  const allChunksConfirmed = Boolean(
    session && session.chunks.length > 0 && session.chunks.every((c) => c.confirmedAt),
  );

  const statusLabel = (status: NovelImportSession["status"]) => {
    const key =
      `novelImport.status${status === "needs_review" ? "NeedsReview" : status.charAt(0).toUpperCase() + status.slice(1)}` as const;
    return t(key as never);
  };

  const progressWidth = `${Math.max(0, Math.min(100, session?.progress ?? 0))}%`;
  const charCount = draft.text.length;

  // ── 任务清单 ──

  const tasks = [
    { key: "setup", label: t("novelImport.workbench.taskSetup"), done: Boolean(session) },
    { key: "chunks", label: t("novelImport.workbench.taskChunks"), done: Boolean(session && session.chunks.every((c) => c.confirmedAt)) },
    { key: "generate", label: t("novelImport.workbench.taskGenerate"), done: session?.status === "needs_review" || session?.status === "written" },
    { key: "review", label: t("novelImport.workbench.taskReview"), done: session?.status === "written" || session?.status === "needs_review" },
    { key: "write", label: t("novelImport.workbench.taskWrite"), done: session?.status === "written" },
  ] as const;

  // ── 写入目标文档 ──

  const worldBibleDoc = project.documents.find((d) => d.type === "world_bible");
  const synopsisDoc = project.documents.find((d) => d.type === "synopsis");
  const scriptDoc = project.documents.find((d) => d.type === "script");

  // ── 渲染 ──

  return (
    <div className="novel-import-workbench">
      <div className="novel-import-workbench__layout" style={{ display: "flex", gap: "1rem" }}>
        {/* ── 左侧主区域 ── */}
        <div className="novel-import-workbench__main" style={{ flex: 1, minWidth: 0 }}>
          {/* 任务清单 */}
          <div className="novel-import-workbench__tasks">
            {tasks.map((task, i) => {
              const isCurrent = task.key === step || (task.key === "review" && step === "written");
              return (
                <div
                  key={task.key}
                  className={`novel-import-workbench__task${
                    task.done
                      ? " novel-import-workbench__task--done"
                      : isCurrent
                        ? " novel-import-workbench__task--active"
                        : ""
                  }`}
                  style={{ display: "flex", alignItems: "center", gap: "0.5rem", padding: "0.35rem 0" }}
                >
                  <span style={{ width: 20, textAlign: "center", flexShrink: 0 }}>
                    {task.done ? "✓" : i + 1}
                  </span>
                  <span>{task.label}</span>
                </div>
              );
            })}
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
            <div className="novel-import-workbench__panel">
              <div className="novel-import__input-area">
                <textarea
                  className="input novel-import__textarea"
                  rows={10}
                  placeholder={t("novelImport.pastePlaceholder")}
                  value={draft.text}
                  onChange={(e) =>
                    setDraft((d) => ({ ...d, text: e.target.value }))
                  }
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
                  />
                </label>
              </div>

              {/* 创建会话按钮 */}
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
            </div>
          )}

          {/* ── 步骤二：分块校对 ── */}
          {step === "chunks" && session && (
            <div className="novel-import-workbench__panel">
              {/* 提示：分块不等同于剧集 */}
              <div className="gen-notice gen-notice--ok" style={{ marginBottom: "0.75rem" }}>
                {t("novelImport.workbench.chunkNotEpisode")}
              </div>

              {/* 未确认警告 */}
              {!allChunksConfirmed && (
                <div className="gen-notice gen-notice--err" style={{ marginBottom: "0.75rem" }}>
                  {t("novelImport.workbench.unconfirmedWarning")}
                </div>
              )}

              {/* 分块列表 */}
              <div className="novel-import-workbench__chunk-table">
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.85rem" }}>
                  <thead>
                    <tr style={{ borderBottom: "1px solid var(--border)" }}>
                      <th style={{ padding: "0.4rem", textAlign: "left", width: 40 }}>#</th>
                      <th style={{ padding: "0.4rem", textAlign: "left" }}>{t("novelImport.workbench.editTitle")}</th>
                      <th style={{ padding: "0.4rem", textAlign: "right", width: 60 }}>{t("novelImport.workbench.thCharCount")}</th>
                      <th style={{ padding: "0.4rem", textAlign: "center", width: 70 }}>{t("novelImport.workbench.thStatus")}</th>
                      <th style={{ padding: "0.4rem", textAlign: "center", width: 50 }}>{t("novelImport.workbench.thConfirm")}</th>
                      <th style={{ padding: "0.4rem", textAlign: "center", width: 50 }}>{t("novelImport.workbench.thAdjust")}</th>
                      <th style={{ padding: "0.4rem", textAlign: "center", width: 160 }}>{t("novelImport.workbench.thActions")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {session.chunks.map((chunk) => {
                      const isEditing = editingChunkIndex === chunk.index;
                      const isSplitting = splitDialogIndex === chunk.index;

                      return (
                        <tr
                          key={chunk.index}
                          style={{
                            borderBottom: "1px solid var(--border)",
                            background: chunk.status === "failed"
                              ? "var(--bg-error, rgba(255,0,0,0.05))"
                              : chunk.status === "stale"
                                ? "var(--bg-warning, rgba(255,165,0,0.05))"
                                : "transparent",
                          }}
                        >
                          <td style={{ padding: "0.4rem" }}>{chunk.index + 1}</td>
                          <td style={{ padding: "0.4rem" }}>
                            {isEditing ? (
                              <div style={{ display: "flex", gap: "0.25rem", alignItems: "center" }}>
                                <input
                                  className="input"
                                  type="text"
                                  value={editingTitle}
                                  onChange={(e) => setEditingTitle(e.target.value)}
                                  onKeyDown={(e) => {
                                    if (e.key === "Enter") handleSaveTitle(chunk.index);
                                    if (e.key === "Escape") setEditingChunkIndex(null);
                                  }}
                                  style={{ fontSize: "0.85rem", padding: "0.2rem 0.4rem" }}
                                  autoFocus
                                />
                                <button
                                  className="btn btn-secondary btn-sm"
                                  type="button"
                                  onClick={() => handleSaveTitle(chunk.index)}
                                  disabled={chunkEditMutation.isPending}
                                >
                                  ✓
                                </button>
                                <button
                                  className="btn btn-secondary btn-sm"
                                  type="button"
                                  onClick={() => setEditingChunkIndex(null)}
                                >
                                  ✕
                                </button>
                              </div>
                            ) : (
                              <span
                                style={{ cursor: canEditChunks ? "pointer" : "default" }}
                                onClick={() => {
                                  if (!canEditChunks) return;
                                  setEditingChunkIndex(chunk.index);
                                  setEditingTitle(chunk.title ?? "");
                                }}
                              >
                                {chunk.title || t("novelImport.workbench.chunkFallbackTitle", { index: chunk.index + 1 })}
                              </span>
                            )}
                          </td>
                          <td style={{ padding: "0.4rem", textAlign: "right", color: "var(--text-tertiary)" }}>
                            {chunk.text.length.toLocaleString()}
                          </td>
                          <td style={{ padding: "0.4rem", textAlign: "center", color: "var(--text-tertiary)" }}>
                            {statusLabel(chunk.status as never)}
                          </td>
                          <td style={{ padding: "0.4rem", textAlign: "center" }}>
                            {chunk.confirmedAt ? "✓" : ""}
                          </td>
                          <td style={{ padding: "0.4rem", textAlign: "center", color: "var(--text-tertiary)", fontSize: "0.75rem" }}>
                            {chunk.adjustedAt
                              ? new Date(chunk.adjustedAt).toLocaleTimeString()
                              : ""}
                          </td>
                          <td style={{ padding: "0.4rem", textAlign: "center" }}>
                            <div style={{ display: "flex", gap: "0.25rem", flexWrap: "wrap", justifyContent: "center" }}>
                              {/* 编辑标题 */}
                              <button
                                className="btn btn-secondary btn-sm"
                                type="button"
                                disabled={!canEditChunks || chunkEditMutation.isPending}
                                onClick={() => {
                                  setEditingChunkIndex(chunk.index);
                                  setEditingTitle(chunk.title ?? "");
                                }}
                                title={t("novelImport.workbench.editTitle")}
                              >
                                ✎
                              </button>
                              {/* 拆分 */}
                              <button
                                className="btn btn-secondary btn-sm"
                                type="button"
                                disabled={!canEditChunks || chunkEditMutation.isPending}
                                onClick={() => {
                                  setSplitDialogIndex(chunk.index);
                                  setSplitAt(1);
                                  setSplitNextTitle("");
                                }}
                                title={t("novelImport.workbench.split")}
                              >
                                {t("novelImport.workbench.split")}
                              </button>
                              {/* 合并到上一块 */}
                              <button
                                className="btn btn-secondary btn-sm"
                                type="button"
                                disabled={!canEditChunks || chunk.index === 0 || chunkEditMutation.isPending}
                                onClick={() => handleMergePrevious(chunk.index)}
                                title={t("novelImport.workbench.mergePrevious")}
                              >
                                ↗
                              </button>
                              {/* 确认 */}
                              <button
                                className="btn btn-secondary btn-sm"
                                type="button"
                                disabled={!canEditChunks || Boolean(chunk.confirmedAt) || chunkEditMutation.isPending}
                                onClick={() => handleConfirmChunk(chunk.index)}
                                title={t("novelImport.workbench.confirm")}
                              >
                                {t("novelImport.workbench.confirm")}
                              </button>
                            </div>
                            {/* 拆分对话框 */}
                            {isSplitting && (
                              <div style={{ marginTop: "0.5rem", padding: "0.5rem", border: "1px solid var(--border)", borderRadius: 4, background: "var(--bg-elevated, #fff)" }}>
                                <div style={{ display: "flex", flexDirection: "column", gap: "0.35rem", fontSize: "0.85rem" }}>
                                  <label>
                                    {t("novelImport.workbench.splitAt")} (1–{chunk.text.length - 1})
                                    <input
                                      className="input"
                                      type="number"
                                      min={1}
                                      max={chunk.text.length - 1}
                                      value={splitAt}
                                      onChange={(e) => setSplitAt(Number(e.target.value) || 1)}
                                      style={{ fontSize: "0.85rem", width: 80, marginLeft: "0.5rem" }}
                                    />
                                  </label>
                                  <label>
                                    {t("novelImport.workbench.splitNextTitle")}
                                    <input
                                      className="input"
                                      type="text"
                                      value={splitNextTitle}
                                      onChange={(e) => setSplitNextTitle(e.target.value)}
                                      style={{ fontSize: "0.85rem", marginLeft: "0.5rem" }}
                                    />
                                  </label>
                                  <div style={{ display: "flex", gap: "0.25rem" }}>
                                    <button
                                      className="btn btn-primary btn-sm"
                                      type="button"
                                      disabled={chunkEditMutation.isPending}
                                      onClick={() => handleSplit(chunk.index)}
                                    >
                                      {t("novelImport.workbench.split")}
                                    </button>
                                    <button
                                      className="btn btn-secondary btn-sm"
                                      type="button"
                                      onClick={() => setSplitDialogIndex(null)}
                                    >
                                      ✕
                                    </button>
                                  </div>
                                </div>
                              </div>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {/* 底部操作 */}
              <div className="novel-import__actions" style={{ marginTop: "1rem" }}>
                <button
                  className="btn btn-secondary btn-sm"
                  type="button"
                  disabled={!canEditChunks || allChunksConfirmed || chunkEditMutation.isPending}
                  onClick={handleConfirmAll}
                >
                  {t("novelImport.workbench.confirmAll")}
                </button>
                <button
                  className="btn btn-primary btn-sm"
                  type="button"
                  disabled={!allChunksConfirmed || actionMutation.isPending}
                  onClick={handleStart}
                >
                  {t("novelImport.startGeneration")}
                </button>
              </div>
            </div>
          )}

          {/* ── 步骤三：生成进度 ── */}
          {step === "progress" && (
            <div className="novel-import-workbench__panel">
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

          {/* ── 步骤四：结果检查 ── */}
          {step === "review" && session && (
            <div className="novel-import-workbench__panel">
              {/* 过期分块警告 */}
              {hasStaleChunks && (
                <div className="gen-notice gen-notice--err">
                  {t("novelImport.staleWarning")}
                </div>
              )}

              {/* 摘要统计 */}
              <div className="novel-import-workbench__summary" style={{ display: "flex", gap: "1rem", flexWrap: "wrap", fontSize: "0.85rem", marginBottom: "1rem" }}>
                {session.worldBible && (
                  <>
                    <span>{t("novelImport.workbench.summaryCharacters")}: {session.worldBible.characters.length}</span>
                    <span>{t("novelImport.workbench.summaryLocations")}: {session.worldBible.locations.length}</span>
                    {session.worldBible.styleGuide?.visualStyle && <span>{t("novelImport.workbench.summaryVisualStyle")}: ✓</span>}
                  </>
                )}
                {session.synopsis && <span>{t("novelImport.workbench.summarySynopsis")}: ✓</span>}
                {session.scriptPreview && (
                  <span>{t("novelImport.workbench.summarySceneCount")}: {session.scriptPreview.scenes.length}</span>
                )}
                {(() => {
                  const failedCount = session.chunks.filter((c) => c.status === "failed" || c.status === "stale").length;
                  return failedCount > 0 ? <span style={{ color: "var(--text-error, red)" }}>{t("novelImport.workbench.summaryFailedStale")}: {failedCount}</span> : null;
                })()}
              </div>

              {/* 预览标签页 */}
              <div className="novel-import__preview-tabs">
                <button
                  className={`novel-import__tab${previewTab === "worldBible" ? " novel-import__tab--on" : ""}`}
                  type="button"
                  onClick={() => setPreviewTab("worldBible")}
                >
                  {t("novelImport.workbench.worldBibleDoc")}
                  {session.worldBible
                    ? ` (${session.worldBible.characters.length} ${t("novelImport.workbench.tabCharacters")})`
                    : ""}
                </button>
                <button
                  className={`novel-import__tab${previewTab === "synopsis" ? " novel-import__tab--on" : ""}`}
                  type="button"
                  onClick={() => setPreviewTab("synopsis")}
                >
                  {t("novelImport.workbench.synopsisDoc")}
                </button>
                <button
                  className={`novel-import__tab${previewTab === "script" ? " novel-import__tab--on" : ""}`}
                  type="button"
                  onClick={() => setPreviewTab("script")}
                >
                  {t("novelImport.workbench.scriptDoc")}
                  {session.scriptPreview
                    ? ` (${session.scriptPreview.scenes.length} ${t("novelImport.workbench.tabScenes")})`
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

              {/* 写入草稿按钮 */}
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

              {/* 新建导入 */}
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

          {/* ── 步骤五：写入完成 ── */}
          {step === "written" && session && (
            <div className="novel-import-workbench__panel">
              <div className="gen-notice gen-notice--ok" role="status">
                {t("novelImport.writeSuccess")}
              </div>

              {/* 写入结果 */}
              {session.writeResult && (
                <div className="novel-import-workbench__write-result" style={{ fontSize: "0.85rem" }}>
                  <div style={{ marginBottom: "0.5rem" }}>
                    <strong>{t("novelImport.workbench.worldBibleDoc")}</strong>: {t("novelImport.workbench.versionLabel")} {session.writeResult.worldBibleVersionId}
                  </div>
                  <div style={{ marginBottom: "0.5rem" }}>
                    <strong>{t("novelImport.workbench.synopsisDoc")}</strong>: {t("novelImport.workbench.versionLabel")} {session.writeResult.synopsisVersionId}
                  </div>
                  <div style={{ marginBottom: "0.5rem" }}>
                    <strong>{t("novelImport.workbench.scriptDoc")}</strong>: {t("novelImport.workbench.versionLabel")} {session.writeResult.scriptVersionId}
                  </div>
                </div>
              )}

              {/* 预览标签页（写入后仍可查看） */}
              <div className="novel-import__preview-tabs">
                <button
                  className={`novel-import__tab${previewTab === "worldBible" ? " novel-import__tab--on" : ""}`}
                  type="button"
                  onClick={() => setPreviewTab("worldBible")}
                >
                  {t("novelImport.workbench.worldBibleDoc")}
                </button>
                <button
                  className={`novel-import__tab${previewTab === "synopsis" ? " novel-import__tab--on" : ""}`}
                  type="button"
                  onClick={() => setPreviewTab("synopsis")}
                >
                  {t("novelImport.workbench.synopsisDoc")}
                </button>
                <button
                  className={`novel-import__tab${previewTab === "script" ? " novel-import__tab--on" : ""}`}
                  type="button"
                  onClick={() => setPreviewTab("script")}
                >
                  {t("novelImport.workbench.scriptDoc")}
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

        {/* ── 右侧边栏：写入目标 ── */}
        <div className="novel-import-workbench__side" style={{ width: 260, flexShrink: 0 }}>
          <div
            className="novel-import-workbench__targets"
            style={{
              padding: "1rem",
              border: "1px solid var(--border)",
              borderRadius: 6,
              fontSize: "0.85rem",
            }}
          >
            <h4 style={{ margin: "0 0 0.75rem", fontSize: "0.9rem" }}>
              {t("novelImport.workbench.writeTargets")}
            </h4>

            {/* 世界观文档 */}
            <div style={{ marginBottom: "0.5rem", display: "flex", alignItems: "center", gap: "0.5rem" }}>
              <span style={{ width: 16, textAlign: "center" }}>🌍</span>
              <span>{worldBibleDoc ? worldBibleDoc.title : t("novelImport.workbench.worldBibleDoc")}</span>
            </div>

            {/* 大纲文档 */}
            <div style={{ marginBottom: "0.5rem", display: "flex", alignItems: "center", gap: "0.5rem" }}>
              <span style={{ width: 16, textAlign: "center" }}>📋</span>
              <span>
                {synopsisDoc
                  ? synopsisDoc.title
                  : t("novelImport.workbench.noSynopsisDoc")}
              </span>
            </div>

            {/* 剧本文档 */}
            <div style={{ marginBottom: "0.5rem", display: "flex", alignItems: "center", gap: "0.5rem" }}>
              <span style={{ width: 16, textAlign: "center" }}>🎬</span>
              <span>{scriptDoc ? scriptDoc.title : t("novelImport.workbench.scriptDoc")}</span>
            </div>

            {/* 安全提示 */}
            <div
              className="novel-import-workbench__safety-note"
              style={{
                marginTop: "0.75rem",
                padding: "0.5rem",
                background: "var(--bg-info, rgba(0,100,255,0.05))",
                borderRadius: 4,
                color: "var(--text-secondary)",
                fontSize: "0.8rem",
                lineHeight: 1.5,
              }}
            >
              {t("novelImport.workbench.writeSafety")}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
