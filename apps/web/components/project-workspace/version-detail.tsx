import type { DocumentRecord, VersionRecord } from "@dramaflow/shared";

import { getDocumentTypeLabel, getVersionStatusLabel, useI18n } from "../../lib/i18n";
import { ConfirmAction } from "../confirm-action";
import { EmptyState } from "../empty-state";
import { SectionCard } from "../section-card";
import { StatusBadge } from "../status-badge";

interface VersionDetailProps {
  currentDocument?: Pick<DocumentRecord, "type" | "title">;
  currentVersion: Pick<VersionRecord, "id" | "versionNumber" | "status" | "title" | "content" | "metadata" | "createdAt"> | null;
  submitting: boolean;
  reviewing: boolean;
  onSubmitVersion: () => void;
  onApprove: () => void;
  onReject: () => void;
}

function getStatusTone(status: VersionRecord["status"]) {
  switch (status) {
    case "approved":
      return "success" as const;
    case "pending_review":
    case "submitted":
      return "warning" as const;
    case "rejected":
      return "danger" as const;
    default:
      return "neutral" as const;
  }
}

function stringifyContent(value: unknown) {
  if (typeof value === "string") {
    return value;
  }

  return JSON.stringify(value, null, 2);
}

export function VersionDetail({
  currentDocument,
  currentVersion,
  submitting,
  reviewing,
  onSubmitVersion,
  onApprove,
  onReject,
}: VersionDetailProps) {
  const { t, formatDate } = useI18n();
  const canReview = currentVersion?.status === "submitted" || currentVersion?.status === "pending_review";
  const canSubmit = currentVersion?.status === "draft";

  return (
    <SectionCard title={t("projectWorkspace.versions.currentTitle")} description={t("projectWorkspace.versions.currentDescription")}>
      {currentVersion ? (
        <div className="stack">
          <div className="version-header">
            <div className="stack stack--tight">
              <h2>{currentVersion.title}</h2>
              <div className="version-header__meta">
                <StatusBadge tone={getStatusTone(currentVersion.status)}>{getVersionStatusLabel(t, currentVersion.status)}</StatusBadge>
                <StatusBadge tone="info">V{currentVersion.versionNumber}</StatusBadge>
                {currentDocument ? (
                  <StatusBadge tone="neutral">
                    {getDocumentTypeLabel(t, currentDocument.type)} · {currentDocument.title}
                  </StatusBadge>
                ) : null}
              </div>
            </div>
            <div className="muted">{formatDate(currentVersion.createdAt)}</div>
          </div>

          <div className="inline-actions inline-actions--wrap">
            <button className="primary-btn" type="button" disabled={!canSubmit || submitting} onClick={onSubmitVersion}>
              {submitting ? t("common.submitting") : t("projectWorkspace.versions.submitAction")}
            </button>
            <ConfirmAction
              label={t("projectWorkspace.versions.approveAction")}
              confirmLabel={t("projectWorkspace.versions.approveConfirm")}
              disabled={!canReview || reviewing}
              onConfirm={onApprove}
            />
            <ConfirmAction
              label={t("projectWorkspace.versions.rejectAction")}
              confirmLabel={t("projectWorkspace.versions.rejectConfirm")}
              tone="danger"
              disabled={!canReview || reviewing}
              onConfirm={onReject}
            />
          </div>

          <div className="json-preview">
            <pre>{stringifyContent(currentVersion.content)}</pre>
          </div>

          {Object.keys(currentVersion.metadata ?? {}).length > 0 ? (
            <div className="metadata-list">
              {Object.entries(currentVersion.metadata).map(([key, value]) => (
                <div key={key} className="metadata-item">
                  <span className="muted">{key}</span>
                  <strong>{typeof value === "string" ? value : JSON.stringify(value)}</strong>
                </div>
              ))}
            </div>
          ) : null}
        </div>
      ) : (
        <EmptyState
          title={t("projectWorkspace.versions.emptyCurrentTitle")}
          description={t("projectWorkspace.versions.emptyCurrentDescription")}
        />
      )}
    </SectionCard>
  );
}