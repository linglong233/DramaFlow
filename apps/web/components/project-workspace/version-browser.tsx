import type { DocumentRecord, VersionRecord } from "@dramaflow/shared";

import { getDocumentTypeLabel, getVersionStatusLabel, useI18n } from "../../lib/i18n";
import { EmptyState } from "../empty-state";
import { SectionCard } from "../section-card";
import { StatusBadge } from "../status-badge";

interface VersionBrowserProps {
  documents: Array<Pick<DocumentRecord, "id" | "type" | "title">>;
  versions: Array<Pick<VersionRecord, "id" | "documentId" | "versionNumber" | "status" | "title">>;
  selectedDocumentId: string;
  selectedVersionId: string;
  onSelectDocument: (documentId: string) => void;
  onSelectVersion: (versionId: string) => void;
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

export function VersionBrowser({
  documents,
  versions,
  selectedDocumentId,
  selectedVersionId,
  onSelectDocument,
  onSelectVersion,
}: VersionBrowserProps) {
  const { t } = useI18n();
  const documentVersions = versions
    .filter((version) => version.documentId === selectedDocumentId)
    .sort((left, right) => right.versionNumber - left.versionNumber);

  return (
    <SectionCard title={t("projectWorkspace.versions.title")} description={t("projectWorkspace.versions.description")}>
      {documents.length > 0 ? (
        <div className="stack stack--tight">
          <div className="choice-row choice-row--vertical">
            {documents.map((document) => (
              <button
                key={document.id}
                className={document.id === selectedDocumentId ? "choice-chip choice-chip--active choice-chip--block" : "choice-chip choice-chip--block"}
                type="button"
                onClick={() => onSelectDocument(document.id)}
              >
                <span>{getDocumentTypeLabel(t, document.type)}</span>
                <strong>{document.title}</strong>
              </button>
            ))}
          </div>

          {documentVersions.length > 0 ? (
            <div className="stack stack--tight">
              {documentVersions.map((version) => (
                <button
                  key={version.id}
                  className={version.id === selectedVersionId ? "version-item version-item--active" : "version-item"}
                  type="button"
                  onClick={() => onSelectVersion(version.id)}
                >
                  <div>
                    <strong>V{version.versionNumber} · {version.title}</strong>
                    <div className="muted">{t("projectWorkspace.versions.versionHint")}</div>
                  </div>
                  <StatusBadge tone={getStatusTone(version.status)}>{getVersionStatusLabel(t, version.status)}</StatusBadge>
                </button>
              ))}
            </div>
          ) : (
            <EmptyState
              title={t("projectWorkspace.versions.emptyVersionTitle")}
              description={t("projectWorkspace.versions.emptyVersionDescription")}
            />
          )}
        </div>
      ) : (
        <EmptyState
          title={t("projectWorkspace.versions.emptyDocumentTitle")}
          description={t("projectWorkspace.versions.emptyDocumentDescription")}
        />
      )}
    </SectionCard>
  );
}