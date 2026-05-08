/**
 * @fileoverview 文档导航列表
 * @module web/components/project-workspace
 *
 * 左侧栏的文档导航，点击切换文档。版本管理在"版本管理"子标签中。
 */

"use client";

import { useI18n, getDocumentTypeLabel } from "../../lib/i18n";

interface Document {
  id: string;
  type: string;
  title: string;
  currentVersionId?: string;
}

interface Props {
  documents: Document[];
  selectedDocId: string;
  onSelectDoc: (docId: string) => void;
  isCollapsed?: boolean;
  onToggleCollapse?: () => void;
}

export function VersionList({
  documents,
  selectedDocId,
  onSelectDoc,
  isCollapsed,
  onToggleCollapse,
}: Props) {
  const { t } = useI18n();

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
            const isSelectedDoc = doc.id === selectedDocId;

            return (
              <div key={doc.id} className="vl-doc">
                <button
                  className={`vl-doc-header ${isSelectedDoc ? "vl-doc-header--active" : ""}`}
                  onClick={() => onSelectDoc(doc.id)}
                >
                  <div className="vl-doc-header-left">
                    <span className={`vl-doc-icon ${isSelectedDoc ? "vl-doc-icon--active" : ""}`}>
                      {getDocIcon(doc.type)}
                    </span>
                    <span className="vl-doc-name">
                      {getDocumentTypeLabel(t, doc.type as never)}
                    </span>
                  </div>
                </button>
              </div>
            );
          })
        )}
      </div>
      )}
    </div>
  );
}
