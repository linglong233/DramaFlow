/**
 * @fileoverview 版本列表
 * @module web/components/project-workspace
 *
 * 文档版本的列表展示和选择。
 */

"use client";

import { useEffect, useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useI18n, getDocumentTypeLabel, getVersionStatusLabel } from "../../lib/i18n";
import { apiFetch, formatApiError } from "../../lib/api";
import { queryKeys } from "../../lib/query-keys";

/** Maximum number of versions to show before collapsing behind a toggle. */
const MAX_VISIBLE_VERSIONS = 3;

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
  onSelectVersion: (versionId: string, docId: string) => void;
  isCollapsed?: boolean;
  onToggleCollapse?: () => void;
  projectId?: string;
}

// Status indicator dot color
function StatusDot({ status }: { status: string }) {
  const getStatusColor = () => {
    switch (status) {
      case "approved":
        return "#22c55e";
      case "rejected":
        return "#ef4444";
      case "pending_review":
      case "submitted":
        return "#f59e0b";
      default:
        return "#6b7280";
    }
  };

  return (
    <span
      style={{
        width: 6,
        height: 6,
        borderRadius: "50%",
        backgroundColor: getStatusColor(),
        display: "inline-block",
        flexShrink: 0,
      }}
    />
  );
}

export function VersionList({
  documents,
  selectedDocId,
  selectedVersionId,
  onSelectDoc,
  onSelectVersion,
  isCollapsed,
  onToggleCollapse,
  projectId,
}: Props) {
  const { t } = useI18n();
  const queryClient = useQueryClient();

  // Only expand the document that currently holds the selection
  const initialExpandedDoc = useMemo(() => {
    if (selectedDocId) return selectedDocId;
    const match = documents.find(d => d.versions.some(v => v.id === selectedVersionId));
    return match?.id ?? "";
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [expandedDocs, setExpandedDocs] = useState<Set<string>>(
    initialExpandedDoc ? new Set([initialExpandedDoc]) : new Set()
  );
  const [showAllVersions, setShowAllVersions] = useState<Set<string>>(new Set());
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  useEffect(() => {
    const activeDocId = selectedDocId || documents.find((doc) => doc.versions.some((version) => version.id === selectedVersionId))?.id;
    if (!activeDocId) return;

    setExpandedDocs((prev) => {
      if (prev.has(activeDocId)) return prev;
      const next = new Set(prev);
      next.add(activeDocId);
      return next;
    });
  }, [documents, selectedDocId, selectedVersionId]);

  const deleteVersionMutation = useMutation({
    mutationFn: async (versionId: string) => apiFetch(`/versions/${versionId}`, { method: "DELETE" }),
    onSuccess: async () => {
      setConfirmDeleteId(null);
      if (projectId) {
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: queryKeys.project(projectId) }),
          queryClient.invalidateQueries({ queryKey: queryKeys.projectVersions(projectId) }),
        ]);
      }
    },
  });

  const toggleDoc = (docId: string, e?: React.MouseEvent) => {
    e?.stopPropagation();
    setExpandedDocs(prev => {
      const next = new Set(prev);
      if (next.has(docId)) {
        next.delete(docId);
      } else {
        next.add(docId);
      }
      return next;
    });
  };

  const toggleShowAll = (docId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setShowAllVersions(prev => {
      const next = new Set(prev);
      if (next.has(docId)) {
        next.delete(docId);
      } else {
        next.add(docId);
      }
      return next;
    });
  };

  // Expand doc when selected
  const handleSelectDoc = (docId: string) => {
    if (!expandedDocs.has(docId)) {
      setExpandedDocs(prev => new Set([...prev, docId]));
    }
    onSelectDoc(docId);
  };

  const getDocIcon = (type: string) => {
    switch (type) {
      case "synopsis":
        return (
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
            <polyline points="14 2 14 8 20 8" />
            <line x1="16" y1="13" x2="8" y2="13" />
            <line x1="12" y1="17" x2="8" y2="17" />
          </svg>
        );
      case "script":
        return (
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
            <polyline points="14 2 14 8 20 8" />
            <line x1="16" y1="13" x2="8" y2="13" />
            <line x1="16" y1="17" x2="8" y2="17" />
            <line x1="10" y1="9" x2="8" y2="9" />
          </svg>
        );
      case "storyboard":
        return (
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <rect x="3" y="3" width="18" height="18" rx="2" />
            <circle cx="8.5" cy="8.5" r="1.5" />
            <path d="M21 15l-5-5L5 21" />
          </svg>
        );
      case "video":
        return (
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <polygon points="5 3 19 12 5 21 5 3" />
          </svg>
        );
      case "world_bible":
        return (
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z" />
            <path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z" />
          </svg>
        );
      default:
        return (
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
            <polyline points="14 2 14 8 20 8" />
          </svg>
        );
    }
  };

  return (
    <div className={`vl-root ${isCollapsed ? "vl-root--collapsed" : ""}`}>
      <div className="vl-header">
        {!isCollapsed && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span className="vl-header-title">{t("projectWorkspace.versions.title")}</span>
            <span className="vl-header-count">{documents.length}</span>
          </div>
        )}
        {onToggleCollapse && (
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={onToggleCollapse}
            style={{ padding: '0 4px', margin: isCollapsed ? '0 auto' : '0' }}
            title={isCollapsed ? t("projectWorkspace.generate.expandSettings") : t("projectWorkspace.generate.collapseSettings")}
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
              {isCollapsed ? (
                <path d="M4.5 2.5l5 4.5-5 4.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              ) : (
                <path d="M9.5 2.5l-5 4.5 5 4.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              )}
            </svg>
          </button>
        )}
      </div>

      {!isCollapsed && (
        <div className="vl-list">
        {documents.length === 0 ? (
          <div className="vl-empty">
            {t("projectWorkspace.versions.emptyCurrentDescription")}
          </div>
        ) : (
          documents.map((doc) => {
            const isExpanded = expandedDocs.has(doc.id);
            const isSelectedDoc = doc.id === selectedDocId;
            const hasVersions = doc.versions.length > 0;

            return (
              <div key={doc.id} className="vl-doc">
                {/* Document header */}
                <button
                  className={`vl-doc-header ${isSelectedDoc ? "vl-doc-header--active" : ""}`}
                  onClick={() => handleSelectDoc(doc.id)}
                >
                  <div className="vl-doc-header-left">
                    {hasVersions && (
                      <span
                        role="button"
                        tabIndex={0}
                        className={`vl-chevron ${isExpanded ? "vl-chevron--expanded" : ""}`}
                        onClick={(e) => toggleDoc(doc.id, e)}
                        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggleDoc(doc.id); } }}
                        aria-label={isExpanded ? "Collapse" : "Expand"}
                      >
                        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
                          <polyline points="9 18 15 12 9 6" />
                        </svg>
                      </span>
                    )}
                    <span
                      className={`vl-doc-icon ${isSelectedDoc ? "vl-doc-icon--active" : ""}`}
                    >
                      {getDocIcon(doc.type)}
                    </span>
                    <span className="vl-doc-name">
                      {getDocumentTypeLabel(t, doc.type as any)}
                    </span>
                  </div>
                  {doc.currentVersionId && (
                    <span className="vl-doc-badge">
                      V{doc.versions.find(v => v.id === doc.currentVersionId)?.versionNumber || "?"}
                    </span>
                  )}
                </button>

                {/* Version list */}
                {isExpanded && hasVersions && (() => {
                  const isShowingAll = showAllVersions.has(doc.id);
                  const totalVersions = doc.versions.length;
                  const hasMore = totalVersions > MAX_VISIBLE_VERSIONS;

                  // If the selected version belongs to this doc but would be
                  // hidden, force-show all versions for this doc.
                  const selectedIsHidden = hasMore && !isShowingAll &&
                    doc.versions.slice(MAX_VISIBLE_VERSIONS).some(v => v.id === selectedVersionId);
                  const effectiveShowAll = isShowingAll || selectedIsHidden;

                  const visibleVersions = (hasMore && !effectiveShowAll)
                    ? doc.versions.slice(0, MAX_VISIBLE_VERSIONS)
                    : doc.versions;
                  const hiddenCount = totalVersions - MAX_VISIBLE_VERSIONS;

                  return (
                    <div className="vl-versions">
                      {visibleVersions.map((version, index) => {
                        const isSelectedVersion = version.id === selectedVersionId;

                        return (
                          <button
                            key={version.id}
                            className={`vl-version ${isSelectedVersion ? "vl-version--active" : ""}`}
                            onClick={() => onSelectVersion(version.id, doc.id)}
                            style={{ animationDelay: `${index * 0.03}s` }}
                          >
                            <div className="vl-version-left">
                              <StatusDot status={version.status} />
                              <span className="vl-version-number">
                                V{version.versionNumber}
                              </span>
                            </div>
                            <span className="vl-version-title" title={version.title}>
                              {version.title}
                            </span>
                            <span className={`vl-version-badge badge badge-${
                              version.status === "approved" ? "success" :
                              version.status === "rejected" ? "danger" :
                              version.status === "draft" ? "neutral" : "warning"
                            }`}>
                              {getVersionStatusLabel(t, version.status as any)}
                            </span>
                            {version.status === "draft" && (
                              confirmDeleteId === version.id ? (
                                <span className="vl-version-delete-confirm" onClick={(e) => e.stopPropagation()}>
                                  <button
                                    className="vl-version-delete-btn vl-version-delete-btn--danger"
                                    type="button"
                                    onClick={(e) => { e.stopPropagation(); deleteVersionMutation.mutate(version.id); }}
                                    disabled={deleteVersionMutation.isPending}
                                    title={t("projectWorkspace.versions.deleteDraftConfirm")}
                                  >
                                    {deleteVersionMutation.isPending ? "..." : "✓"}
                                  </button>
                                  <button
                                    className="vl-version-delete-btn"
                                    type="button"
                                    onClick={(e) => { e.stopPropagation(); setConfirmDeleteId(null); }}
                                    title={t("common.cancel")}
                                  >
                                    ✕
                                  </button>
                                </span>
                              ) : (
                                <button
                                  className="vl-version-delete-btn"
                                  type="button"
                                  onClick={(e) => { e.stopPropagation(); setConfirmDeleteId(version.id); }}
                                  title={t("projectWorkspace.versions.deleteDraftAction")}
                                >
                                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                    <polyline points="3 6 5 6 21 6" />
                                    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                                  </svg>
                                </button>
                              )
                            )}
                          </button>
                        );
                      })}
                      {hasMore && (
                        <button
                          className="vl-version-toggle"
                          type="button"
                          onClick={(e) => toggleShowAll(doc.id, e)}
                        >
                          {effectiveShowAll
                            ? t("projectWorkspace.versions.showLess")
                            : t("projectWorkspace.versions.showMore", { count: hiddenCount })
                          }
                        </button>
                      )}
                    </div>
                  );
                })()}
              </div>
            );
          })
        )}
      </div>
      )}
    </div>
  );
}
