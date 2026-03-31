"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "../../lib/api";
import { queryKeys } from "../../lib/query-keys";
import { useI18n } from "../../lib/i18n";

interface Comment {
  id: string;
  authorId: string;
  body: string;
  resolved: boolean;
  createdAt: string;
}

interface Props {
  versionId: string | null;
}

export function ReviewPanel({ versionId }: Props) {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const [comment, setComment] = useState("");

  const { data: comments = [], isLoading } = useQuery<Comment[]>({
    queryKey: queryKeys.versionComments(versionId ?? ""),
    queryFn: () => apiFetch(`/versions/${versionId}/comments`),
    enabled: !!versionId,
  });

  const addComment = useMutation({
    mutationFn: () =>
      apiFetch(`/versions/${versionId}/comments`, {
        method: "POST",
        body: { body: comment },
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.versionComments(versionId ?? "") });
      setComment("");
    },
  });

  if (!versionId) return null;

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <div style={{ padding: "var(--space-4) var(--space-4)", borderBottom: "1px solid var(--border-subtle)", flexShrink: 0 }}>
        <h3 className="heading-5" style={{ margin: 0 }}>{t("projectWorkspace.discussion.title")}</h3>
      </div>

      {/* Comment list */}
      <div style={{ flex: 1, padding: "var(--space-4)", overflowY: "auto", display: "flex", flexDirection: "column", gap: "var(--space-3)" }}>
        {isLoading ? (
          <div className="skeleton" style={{ height: 60 }} />
        ) : comments.length === 0 ? (
          <div className="empty-state" style={{ margin: "auto 0" }}>
            <p className="text-sm muted">{t("projectWorkspace.sidebar.commentsEmptyDescription")}</p>
          </div>
        ) : (
          comments.map((c: Comment) => (
            <div key={c.id} className="glass-panel animate-fade-in" style={{ padding: "var(--space-4)", borderRadius: "var(--radius-lg)" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "8px" }}>
                <div style={{ width: "24px", height: "24px", borderRadius: "50%", background: "var(--accent)", color: "var(--bg-base)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "12px", fontWeight: "bold", boxShadow: "0 0 8px rgba(56, 189, 248, 0.5)" }}>A</div>
                <span style={{ fontSize: "13px", fontWeight: 600, color: "var(--text-primary)" }}>{t("projectWorkspace.discussion.authorPrefix", { id: c.authorId.slice(-4) })}</span>
                <span className="muted" style={{ fontSize: "11px", marginLeft: "auto" }}>{new Date(c.createdAt).toLocaleDateString()}</span>
              </div>
              <p style={{ margin: 0, lineHeight: 1.6, color: "var(--text-secondary)", fontSize: "13px" }}>{c.body}</p>
            </div>
          ))
        )}
      </div>

      {/* Add comment (Sticky bottom) */}
      <div className="glass-panel" style={{ padding: "var(--space-4)", borderTop: "1px solid var(--border-subtle)", flexShrink: 0, borderBottomLeftRadius: 0, borderBottomRightRadius: 0 }}>
        <textarea
          className="input"
          placeholder={t("projectWorkspace.discussion.commentPlaceholder")}
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          style={{ minHeight: "80px", marginBottom: "var(--space-3)", resize: "none", background: "rgba(255, 255, 255, 0.05)" }}
        />
        <button
          className="btn btn-primary"
          style={{ width: "100%", justifyContent: "center" }}
          onClick={() => addComment.mutate()}
          disabled={addComment.isPending || !comment.trim()}
        >
          {addComment.isPending ? t("common.submitting") : t("projectWorkspace.sidebar.addCommentAction")}
        </button>
      </div>
    </div>
  );
}
