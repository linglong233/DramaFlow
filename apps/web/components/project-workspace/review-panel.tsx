/**
 * @fileoverview 审核面板
 * @module web/components/project-workspace
 *
 * 版本审核操作界面，支持通过/驳回/评论。
 */

"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { apiFetch, formatApiError } from "../../lib/api";
import { queryKeys } from "../../lib/query-keys";
import { useI18n } from "../../lib/i18n";

interface CommentItem {
  id: string;
  authorId: string;
  authorDisplayName: string;
  authorEmail: string;
  body: string;
  parentId?: string;
  resolved: boolean;
  createdAt: string;
}

interface AuditRecord {
  id: string;
  action: "submitted" | "approved" | "rejected";
  reviewerDisplayName: string;
  reviewerEmail: string;
  comment?: string | null;
  createdAt: string;
}

interface Props {
  versionId: string | null;
}

const AUDIT_ACTION_STYLES: Record<string, { bg: string; color: string; label: string }> = {
  submitted: { bg: "var(--color-info-subtle, #1e3a5f)", color: "var(--color-info, #38bdf8)", label: "??? / Submitted" },
  approved: { bg: "var(--color-success-subtle, #14532d)", color: "var(--color-success, #34d399)", label: "??? / Approved" },
  rejected: { bg: "var(--color-danger-subtle, #7f1d1d)", color: "var(--color-danger, #f87171)", label: "??? / Rejected" },
};

export function ReviewPanel({ versionId }: Props) {
  const { formatDate, t } = useI18n();
  const queryClient = useQueryClient();
  const [comment, setComment] = useState("");
  const [replyDrafts, setReplyDrafts] = useState<Record<string, string>>({});
  const [replyingTo, setReplyingTo] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [auditTrailOpen, setAuditTrailOpen] = useState(false);

  const { data: comments = [], isLoading } = useQuery<CommentItem[]>({
    queryKey: queryKeys.versionComments(versionId ?? ""),
    queryFn: () => apiFetch(`/versions/${versionId}/comments`),
    enabled: !!versionId,
  });

  const addComment = useMutation({
    mutationFn: (payload: { body: string; parentId?: string }) =>
      apiFetch(`/versions/${versionId}/comments`, {
        method: "POST",
        body: { ...payload, anchorType: "document" },
      }),
    onSuccess: async () => {
      setError(null);
      setComment("");
      setReplyDrafts({});
      setReplyingTo(null);
      await queryClient.invalidateQueries({ queryKey: queryKeys.versionComments(versionId ?? "") });
    },
    onError: (submitError) => {
      setError(formatApiError(submitError, t, "projectWorkspace.feedback.commentFailed"));
    },
  });

  const { data: auditRecords = [] } = useQuery<AuditRecord[]>({
    queryKey: queryKeys.versionAuditRecords(versionId ?? ""),
    queryFn: () => apiFetch(`/versions/${versionId}/audit-records`),
    enabled: !!versionId,
  });

  const { topLevelComments, repliesByParent } = useMemo(() => {
    const roots: CommentItem[] = [];
    const replies = new Map<string, CommentItem[]>();

    for (const item of comments) {
      if (!item.parentId) {
        roots.push(item);
        continue;
      }
      const group = replies.get(item.parentId) ?? [];
      group.push(item);
      replies.set(item.parentId, group);
    }

    return { topLevelComments: roots, repliesByParent: replies };
  }, [comments]);

  if (!versionId) {
    return null;
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <div style={{ flex: 1, padding: "var(--space-4)", overflowY: "auto", display: "flex", flexDirection: "column", gap: "var(--space-3)" }}>
        {isLoading ? (
          <div className="skeleton" style={{ height: 60 }} />
        ) : topLevelComments.length === 0 ? (
          <div className="empty-state" style={{ margin: "auto 0" }}>
            <div className="empty-state-description">{t("projectWorkspace.sidebar.commentsEmptyDescription")}</div>
          </div>
        ) : (
          topLevelComments.map((item) => {
            const replies = repliesByParent.get(item.id) ?? [];
            const replyValue = replyDrafts[item.id] ?? "";
            const replyOpen = replyingTo === item.id;

            return (
              <div key={item.id} className="comment-thread" style={{ display: "flex", flexDirection: "column", gap: "var(--space-3)" }}>
                <CommentCard item={item} formatDate={formatDate} />

                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "var(--space-2)" }}>
                  <span className="muted text-sm">{replies.length > 0 ? `${replies.length} replies` : ""}</span>
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    onClick={() => setReplyingTo((current) => current === item.id ? null : item.id)}
                  >
                    ?? / Reply
                  </button>
                </div>

                {replies.length > 0 ? (
                  <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)", paddingLeft: "var(--space-4)", borderLeft: "1px solid var(--border-subtle)" }}>
                    {replies.map((reply) => (
                      <CommentCard key={reply.id} item={reply} formatDate={formatDate} compact />
                    ))}
                  </div>
                ) : null}

                {replyOpen ? (
                  <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)", paddingLeft: "var(--space-4)", borderLeft: "1px solid var(--border-subtle)" }}>
                    <textarea
                      className="input"
                      value={replyValue}
                      onChange={(event) => setReplyDrafts((current) => ({ ...current, [item.id]: event.target.value }))}
                      placeholder={t("projectWorkspace.discussion.commentPlaceholder")}
                      style={{ minHeight: 72, resize: "none" }}
                    />
                    <div style={{ display: "flex", gap: "var(--space-2)", justifyContent: "flex-end" }}>
                      <button type="button" className="btn btn-ghost btn-sm" onClick={() => setReplyingTo(null)}>
                        {t("common.cancel")}
                      </button>
                      <button
                        type="button"
                        className="btn btn-primary btn-sm"
                        disabled={addComment.isPending || !replyValue.trim()}
                        onClick={() => addComment.mutate({ body: replyValue, parentId: item.id })}
                      >
                        {addComment.isPending ? t("common.submitting") : "????"}
                      </button>
                    </div>
                  </div>
                ) : null}
              </div>
            );
          })
        )}
      </div>

      {auditRecords.length > 0 ? (
        <div style={{ borderTop: "1px solid var(--border-subtle)", flexShrink: 0 }}>
          <button
            type="button"
            onClick={() => setAuditTrailOpen(!auditTrailOpen)}
            style={{
              width: "100%",
              padding: "var(--space-3) var(--space-4)",
              background: "none",
              border: "none",
              color: "inherit",
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              fontWeight: 600,
              fontSize: "0.875rem",
            }}
          >
            <span>???? / Audit Trail ({auditRecords.length})</span>
            <span style={{ transform: auditTrailOpen ? "rotate(180deg)" : "rotate(0deg)", transition: "transform 0.2s" }}>&#9662;</span>
          </button>
          {auditTrailOpen ? (
            <div style={{ padding: "0 var(--space-4) var(--space-3)", display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
              {auditRecords.map((record) => {
                const style = AUDIT_ACTION_STYLES[record.action] ?? AUDIT_ACTION_STYLES.submitted;
                return (
                  <div key={record.id} className="comment-thread" style={{ padding: "var(--space-3)" }}>
                    <div className="comment-thread__meta" style={{ alignItems: "center" }}>
                      <span
                        style={{
                          display: "inline-block",
                          padding: "2px 8px",
                          borderRadius: 4,
                          fontSize: "0.75rem",
                          fontWeight: 600,
                          background: style.bg,
                          color: style.color,
                        }}
                      >
                        {style.label}
                      </span>
                      <strong>{record.reviewerDisplayName}</strong>
                      <span className="muted text-sm">{record.reviewerEmail}</span>
                      <span className="muted text-sm">
                        {formatDate(record.createdAt, { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })}
                      </span>
                    </div>
                    {record.comment ? <p style={{ marginTop: "var(--space-2)", fontSize: "0.875rem" }}>{record.comment}</p> : null}
                  </div>
                );
              })}
            </div>
          ) : null}
        </div>
      ) : null}

      <div className="glass-panel" style={{ padding: "var(--space-4)", borderTop: "1px solid var(--border-subtle)", flexShrink: 0, borderBottomLeftRadius: 0, borderBottomRightRadius: 0 }}>
        <textarea
          className="input"
          placeholder={t("projectWorkspace.discussion.commentPlaceholder")}
          value={comment}
          onChange={(event) => setComment(event.target.value)}
          style={{ minHeight: 80, marginBottom: "var(--space-3)", resize: "none" }}
        />
        {error ? <div className="inline-feedback inline-feedback-error" role="alert" style={{ marginBottom: "var(--space-3)" }}>{error}</div> : null}
        <button
          className="btn btn-primary"
          style={{ width: "100%", justifyContent: "center" }}
          onClick={() => addComment.mutate({ body: comment })}
          disabled={addComment.isPending || !comment.trim()}
        >
          {addComment.isPending ? t("common.submitting") : t("projectWorkspace.sidebar.addCommentAction")}
        </button>
      </div>
    </div>
  );
}

function CommentCard({
  item,
  formatDate,
  compact = false,
}: {
  item: CommentItem;
  formatDate: (value: string, options?: Intl.DateTimeFormatOptions) => string;
  compact?: boolean;
}) {
  return (
    <div className="comment-thread" style={compact ? { padding: "var(--space-3)" } : undefined}>
      <div className="comment-thread__meta">
        <strong>{item.authorDisplayName}</strong>
        <span className="muted text-sm">{item.authorEmail}</span>
        <span className="muted text-sm">{formatDate(item.createdAt, { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })}</span>
      </div>
      <p style={{ marginTop: "var(--space-2)" }}>{item.body}</p>
    </div>
  );
}
