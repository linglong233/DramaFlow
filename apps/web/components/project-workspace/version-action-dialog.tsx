/**
 * @fileoverview 版本操作确认对话框
 * @module web/components/project-workspace
 */

"use client";

import { useState } from "react";
import { useI18n } from "../../lib/i18n";

export type VersionActionType = "submit" | "approve" | "reject" | "adopt" | "restore" | "delete";

interface Props {
  open: boolean;
  action: VersionActionType;
  versionTitle: string;
  versionNumber: number;
  onConfirm: (comment?: string) => void;
  onCancel: () => void;
  isPending: boolean;
}

export function VersionActionDialog({
  open,
  action,
  versionTitle,
  versionNumber,
  onConfirm,
  onCancel,
  isPending,
}: Props) {
  const { t } = useI18n();
  const [comment, setComment] = useState("");

  if (!open) return null;

  const needsComment = action === "approve" || action === "reject";
  const isDestructive = action === "delete";

  const actionLabels: Record<VersionActionType, string> = {
    submit: t("projectWorkspace.versions.submitAction"),
    approve: t("projectWorkspace.versions.approveAction"),
    reject: t("projectWorkspace.versions.rejectAction"),
    adopt: t("projectWorkspace.versions.adoptAction"),
    restore: t("projectWorkspace.versions.restoreAction"),
    delete: t("projectWorkspace.versions.deleteAction"),
  };

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 50,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "rgba(0, 0, 0, 0.5)",
      }}
      onClick={(e) => { if (e.target === e.currentTarget && !isPending) onCancel(); }}
    >
      <div
        className="glass-panel"
        style={{
          width: "100%",
          maxWidth: 420,
          margin: "var(--space-4)",
          padding: "var(--space-6)",
          display: "flex",
          flexDirection: "column",
          gap: "var(--space-4)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div>
          <h4 className="heading-4">{actionLabels[action]}</h4>
          <p className="muted" style={{ marginTop: "var(--space-2)" }}>
            V{versionNumber} — {versionTitle}
          </p>
        </div>

        {isDestructive && (
          <div style={{ padding: "var(--space-3)", background: "var(--color-danger-subtle)", borderRadius: "var(--radius-md)" }}>
            <p style={{ color: "var(--color-danger)", fontSize: "0.875rem" }}>
              {t("projectWorkspace.versions.deleteWarning")}
            </p>
          </div>
        )}

        {action === "adopt" && (
          <p className="text-sm">
            {t("projectWorkspace.versions.adoptWarning")}
          </p>
        )}

        {needsComment && (
          <textarea
            className="input"
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            placeholder={t("projectWorkspace.review.commentPlaceholder")}
            style={{ minHeight: 72, resize: "none" }}
          />
        )}

        <div style={{ display: "flex", gap: "var(--space-3)", justifyContent: "flex-end" }}>
          <button type="button" className="btn btn-ghost" onClick={onCancel} disabled={isPending}>
            {t("common.cancel")}
          </button>
          <button
            type="button"
            className={isDestructive ? "btn btn-danger" : "btn btn-primary"}
            onClick={() => onConfirm(needsComment ? comment || undefined : undefined)}
            disabled={isPending}
          >
            {isPending ? t("common.submitting") : actionLabels[action]}
          </button>
        </div>
      </div>
    </div>
  );
}
