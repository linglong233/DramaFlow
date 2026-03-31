"use client";

import { useState } from "react";
import { useI18n, getDocumentTypeLabel, getVersionStatusLabel } from "../../lib/i18n";

interface Version {
  id: string;
  title: string;
  versionNumber: number;
  status: string;
  createdAt: string;
}

interface Document {
  id: string;
  type: string;
  title: string;
  currentVersionId?: string;
  versions: Version[];
}

interface Props {
  documents: Document[];
  selectedDocId: string;
  selectedVersionId: string;
  onSelectDoc: (docId: string) => void;
  onSelectVersion: (versionId: string) => void;
}

export function VersionList({
  documents,
  selectedDocId,
  selectedVersionId,
  onSelectDoc,
  onSelectVersion,
}: Props) {
  const { t } = useI18n();
  const [open, setOpen] = useState(true);
  const selectedDoc = documents.find((d) => d.id === selectedDocId);

  return (
    <div>
      <div
        className="inline"
        style={{ alignItems: "center", justifyContent: "space-between", marginBottom: "var(--space-3)", cursor: "pointer" }}
        onClick={() => setOpen(!open)}
      >
        <span className="faint text-sm">{t("projectWorkspace.versions.title")}</span>
        <span className="faint text-sm">{open ? "−" : "+"}</span>
      </div>
      {open && (
        <div className="stack stack-gap-1">
          {documents.map((doc) => (
            <div key={doc.id}>
              {/* Document tab */}
              <div
                className={`version-item ${doc.id === selectedDocId ? "selected" : ""}`}
                onClick={() => onSelectDoc(doc.id)}
              >
                <span className="version-item-title">
                  {getDocumentTypeLabel(t, doc.type as any)}
                </span>
              </div>
              {/* Version list */}
              {doc.id === selectedDocId && doc.versions.length > 0 && (
                <div className="stack stack-gap-1" style={{ paddingLeft: "var(--space-4)" }}>
                  {doc.versions.map((v) => (
                    <div
                      key={v.id}
                      className={`version-item ${v.id === selectedVersionId ? "selected" : ""}`}
                      onClick={(e) => { e.stopPropagation(); onSelectVersion(v.id); }}
                      style={{ padding: "var(--space-2) var(--space-3)" }}
                    >
                      <span className="text-sm font-medium">v{v.versionNumber}</span>
                      <span className="version-item-title">{v.title}</span>
                      <span className={`badge badge-${v.status === "approved" ? "success" : v.status === "rejected" ? "danger" : "neutral"}`}>
                        {getVersionStatusLabel(t, v.status as any)}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
