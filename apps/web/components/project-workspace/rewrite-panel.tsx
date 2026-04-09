"use client";

import { useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiStreamFetch, formatApiError } from "../../lib/api";
import { queryKeys } from "../../lib/query-keys";
import { useI18n } from "../../lib/i18n";

interface Props {
  projectId: string;
  documentId: string;
  onFeedback: (fb: { message: string | null; error: string | null }) => void;
}

export function RewritePanel({ projectId, documentId, onFeedback }: Props) {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const abortRef = useRef<AbortController | null>(null);
  const [originalText, setOriginalText] = useState("");
  const [instruction, setInstruction] = useState("");
  const [context, setContext] = useState("");
  const [rewriteResult, setRewriteResult] = useState<string | null>(null);
  const [streamingText, setStreamingText] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);

  function stopStreaming() {
    abortRef.current?.abort();
    abortRef.current = null;
    setIsStreaming(false);
  }

  const rewriteMutation = useMutation({
    mutationFn: async () => {
      setStreamingText("");
      setRewriteResult(null);
      setIsStreaming(true);
      onFeedback({ message: null, error: null });

      const controller = new AbortController();
      abortRef.current = controller;

      let accumulated = "";
      let finalResult: string | null = null;

      for await (const chunk of apiStreamFetch(`/projects/${projectId}/rewrite-jobs/stream`, {
        method: "POST",
        signal: controller.signal,
        body: {
          originalText,
          instruction,
          context: context || undefined,
          documentId,
        },
      })) {
        if (chunk.type === "chunk" && chunk.content) {
          accumulated += chunk.content;
          setStreamingText(accumulated);
        } else if (chunk.type === "done" && chunk.result) {
          const result = chunk.result as { rewrittenText?: string };
          finalResult = result.rewrittenText ?? accumulated;
        } else if (chunk.type === "error") {
          throw new Error(chunk.error);
        }
      }

      setIsStreaming(false);
      abortRef.current = null;
      setRewriteResult(finalResult ?? accumulated);
      setStreamingText("");
      await queryClient.invalidateQueries({ queryKey: queryKeys.projectJobs(projectId) });
    },
    onSuccess: () => {
      onFeedback({ message: t("rewritePanel.success"), error: null });
    },
    onError: (error) => {
      setIsStreaming(false);
      abortRef.current = null;
      setStreamingText("");
      onFeedback({ message: null, error: formatApiError(error, t, "rewritePanel.failed") });
    },
  });

  function handleApply() {
    if (rewriteResult) {
      setOriginalText(rewriteResult);
      setRewriteResult(null);
    }
  }

  function handleDiscard() {
    setRewriteResult(null);
  }

  return (
    <div className="rw-root">
      <h4 className="heading-5" style={{ marginBottom: "var(--space-3)" }}>{t("rewritePanel.title")}</h4>

      <div className="stack stack-gap-3">
        <div className="form-group">
          <label className="form-label">{t("rewritePanel.originalText")}</label>
          <textarea
            className="input rw-textarea"
            rows={4}
            value={originalText}
            onChange={(e) => setOriginalText(e.target.value)}
            placeholder={t("rewritePanel.originalTextPlaceholder")}
          />
        </div>

        <div className="form-group">
          <label className="form-label">{t("rewritePanel.instruction")}</label>
          <textarea
            className="input rw-textarea"
            rows={2}
            value={instruction}
            onChange={(e) => setInstruction(e.target.value)}
            placeholder={t("rewritePanel.instructionPlaceholder")}
          />
        </div>

        <div className="form-group">
          <label className="form-label">{t("rewritePanel.context")}</label>
          <textarea
            className="input rw-textarea"
            rows={2}
            value={context}
            onChange={(e) => setContext(e.target.value)}
            placeholder={t("rewritePanel.contextPlaceholder")}
          />
        </div>

        <button
          className="btn btn-primary btn-sm"
          type="button"
          onClick={() => rewriteMutation.mutate()}
          disabled={rewriteMutation.isPending || isStreaming || !originalText.trim() || !instruction.trim()}
          style={{ width: "100%", justifyContent: "center" }}
        >
          {rewriteMutation.isPending || isStreaming ? t("rewritePanel.submitting") : t("rewritePanel.submitRewrite")}
        </button>
      </div>

      <div className="rw-result-section">
        <h5 className="heading-6" style={{ marginBottom: "var(--space-2)" }}>{t("rewritePanel.result")}</h5>
        {rewriteResult ? (
          <div className="rw-result">
            <pre className="rw-result-text">{rewriteResult}</pre>
            <div className="rw-result-actions">
              <button className="btn btn-primary btn-sm" type="button" onClick={handleApply}>
                {t("rewritePanel.applyResult")}
              </button>
              <button className="btn btn-ghost btn-sm" type="button" onClick={handleDiscard}>
                {t("rewritePanel.discardResult")}
              </button>
            </div>
          </div>
        ) : isStreaming && streamingText ? (
          <div className="rw-result">
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: "var(--space-2)" }}>
              <div className="uw-gen-streaming-dot" />
              <span className="muted text-sm">{t("rewritePanel.submitting")}</span>
              <button className="btn btn-ghost btn-sm" type="button" onClick={stopStreaming} style={{ marginLeft: "auto" }}>
                {t("common.cancel") ?? "Stop"}
              </button>
            </div>
            <pre className="rw-result-text">{streamingText}<span className="uw-gen-cursor">|</span></pre>
          </div>
        ) : isStreaming ? (
          <div className="rw-polling">
            <div className="rw-spinner" />
            <span className="muted">{t("rewritePanel.submitting")}</span>
          </div>
        ) : (
          <p className="muted" style={{ fontSize: 13, lineHeight: 1.6 }}>{t("rewritePanel.noResult")}</p>
        )}
      </div>
    </div>
  );
}
