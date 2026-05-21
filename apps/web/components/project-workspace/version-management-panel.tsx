/**
 * @fileoverview 版本管理面板
 * @module web/components/project-workspace
 *
 * 分栏布局：左侧版本列表 + 右侧内容预览或版本对比。
 */

"use client";

import { useState, useMemo, useCallback } from "react";
import ReactMarkdown from "react-markdown";
import type { VersionImpactSummary, VersionRecord } from "@dramaflow/shared";
import {
  diffContents,
  type DiffEntry,
  normalizeScriptContent,
  normalizeStoryboardContent,
  normalizeWorldBibleContent,
} from "@dramaflow/shared";
import { useI18n, getVersionStatusLabel } from "../../lib/i18n";
import { useVersionMutations } from "../../lib/hooks";
import { VersionActionDialog, type VersionActionType } from "./version-action-dialog";
import {
  ScriptView,
  StoryboardView,
  WorldBibleView,
  isScriptContent,
  isStoryboardContent,
  isWorldBibleContent,
} from "./version-view";
import { ImpactIssueList } from "./impact-issue-list";
import { VersionLineageStrip } from "./version-lineage-strip";

/* ─── Types ──────────────────────────────────────────────────── */

interface Props {
  documentId?: string;
  documentTitle?: string;
  documentType?: string;
  versions: Array<
    Pick<
      VersionRecord,
      "id" | "title" | "versionNumber" | "status" | "content" | "createdAt"
    > & Partial<Pick<VersionRecord, "documentId" | "parentVersionId" | "createdBy">> & { impactSummary?: VersionImpactSummary }
  >;
  currentVersionId?: string;
  projectId: string;
  allVersions?: Array<
    Pick<
      VersionRecord,
      "id" | "documentId" | "title" | "versionNumber" | "status" | "content" | "createdAt"
    > & Partial<Pick<VersionRecord, "parentVersionId" | "createdBy">> & { impactSummary?: VersionImpactSummary }
  >;
  allDocuments?: Array<{ id: string; title: string }>;
}

type StatusFilter =
  | "all"
  | "needs_review"
  | "draft"
  | "submitted"
  | "pending_review"
  | "approved"
  | "rejected";


/* ─── Relative time helper ───────────────────────────────────── */

function getRelativeTime(
  dateStr: string,
  t: (key: "versionManagement.today" | "versionManagement.yesterday" | "versionManagement.daysAgo", params?: Record<string, string | number>) => string,
): string {
  const now = new Date();
  const date = new Date(dateStr);
  const diffMs = now.getTime() - date.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  if (diffDays === 0) return t("versionManagement.today");
  if (diffDays === 1) return t("versionManagement.yesterday");
  return t("versionManagement.daysAgo", { count: diffDays });
}

/* ─── Status badge styling ───────────────────────────────────── */

function getStatusBadgeStyle(
  status: string,
): { color: string; backgroundColor: string } {
  switch (status) {
    case "approved":
      return {
        color: "var(--color-success-6)",
        backgroundColor: "var(--color-success-1)",
      };
    case "pending_review":
    case "submitted":
      return {
        color: "var(--color-warning-6)",
        backgroundColor: "var(--color-warning-1)",
      };
    case "rejected":
      return {
        color: "var(--color-danger-6)",
        backgroundColor: "var(--color-danger-1)",
      };
    default:
      return {
        color: "var(--color-neutral-6)",
        backgroundColor: "var(--color-neutral-1)",
      };
  }
}

/* ─── 影响徽章 ──────────────────────────────────────────────── */

function getImpactBadge(summary?: VersionImpactSummary): { labelKey: string; tone: string } | null {
  if (!summary) return null;
  if (summary.openCount > 0) return { labelKey: "impact.status.open", tone: "warning" };
  if (summary.suggestedCount > 0) return { labelKey: "impact.status.suggested", tone: "info" };
  if (summary.acceptedCount > 0) return { labelKey: "impact.status.accepted", tone: "success" };
  if (summary.ignoredCount > 0) return { labelKey: "impact.status.ignored", tone: "neutral" };
  return null;
}

/* ─── Content renderer (single version) ──────────────────────── */

function VersionContentRenderer({ content }: { content: unknown }) {
  if (!content) {
    return <span className="muted">—</span>;
  }

  if (isScriptContent(content)) {
    return <ScriptView content={normalizeScriptContent(content)} />;
  }
  if (isStoryboardContent(content)) {
    return <StoryboardView content={normalizeStoryboardContent(content)} />;
  }
  if (isWorldBibleContent(content)) {
    return <WorldBibleView content={normalizeWorldBibleContent(content)} />;
  }
  if (typeof content === "string") {
    return (
      <div className="vv-markdown">
        <ReactMarkdown>{content}</ReactMarkdown>
      </div>
    );
  }
  return <pre className="vv-json">{JSON.stringify(content, null, 2)}</pre>;
}

/* ─── Main component ─────────────────────────────────────────── */

export function VersionManagementPanel({
  documentId,
  documentTitle,
  documentType,
  versions,
  currentVersionId,
  projectId,
  allVersions,
  allDocuments,
}: Props) {
  const { t } = useI18n();

  const canCrossDoc = !!(allVersions?.length && allDocuments?.length);
  const [crossDocument, setCrossDocument] = useState(false);

  const activeVersions = useMemo(() => {
    if (!crossDocument || !allVersions) return versions;
    return allVersions;
  }, [crossDocument, allVersions, versions]);

  const docNameMap = useMemo(() => {
    if (!allDocuments) return new Map<string, string>();
    return new Map(allDocuments.map((d) => [d.id, d.title]));
  }, [allDocuments]);

  /* ── State ── */
  const [selectedVersionId, setSelectedVersionId] = useState<string>(
    () => versions[0]?.id ?? "",
  );
  const [compareMode, setCompareMode] = useState(false);
  const [compareVersionIds, setCompareVersionIds] = useState<
    [string, string] | null
  >(null);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [pendingAction, setPendingAction] = useState<{
    type: VersionActionType;
    versionId: string;
    versionTitle: string;
    versionNumber: number;
  } | null>(null);

  /* ── Mutations ── */
  const mutations = useVersionMutations(projectId);

  /* ── Filtered & sorted versions ── */
  const filteredVersions = useMemo(() => {
    const sorted = [...activeVersions].sort(
      (a, b) => b.versionNumber - a.versionNumber,
    );
    return sorted.filter((v) => {
      if (statusFilter === "needs_review") {
        if (v.status !== "submitted" && v.status !== "pending_review") return false;
      } else if (statusFilter !== "all" && v.status !== statusFilter) {
        return false;
      }
      if (searchQuery && !v.title.toLowerCase().includes(searchQuery.toLowerCase()))
        return false;
      return true;
    });
  }, [activeVersions, statusFilter, searchQuery]);

  /* ── Selected version data ── */
  const selectedVersion = useMemo(
    () => activeVersions.find((v) => v.id === selectedVersionId) ?? null,
    [activeVersions, selectedVersionId],
  );

  /* ── Compare data ── */
  const compareBase = useMemo(
    () => (compareVersionIds ? activeVersions.find((v) => v.id === compareVersionIds[0]) ?? null : null),
    [activeVersions, compareVersionIds],
  );
  const compareTarget = useMemo(
    () => (compareVersionIds ? activeVersions.find((v) => v.id === compareVersionIds[1]) ?? null : null),
    [activeVersions, compareVersionIds],
  );

  const diffEntries = useMemo(() => {
    if (!compareBase?.content || !compareTarget?.content) return null;
    return diffContents(compareBase.content, compareTarget.content);
  }, [compareBase, compareTarget]);

  /* ── Handlers ── */
  const handleToggleCompareMode = useCallback(() => {
    setCompareMode((prev) => {
      if (prev) {
        setCompareVersionIds(null);
      }
      return !prev;
    });
  }, []);

  const handleVersionClick = useCallback(
    (versionId: string) => {
      if (compareMode) {
        setCompareVersionIds((prev) => {
          if (!prev) return [versionId, ""];
          if (!prev[1]) {
            return prev[0] === versionId ? null : [prev[0], versionId];
          }
          if (prev.includes(versionId)) {
            const remaining = prev.filter((id) => id !== versionId);
            return remaining.length === 1
              ? [remaining[0], ""]
              : null;
          }
          return [prev[1], versionId];
        });
      } else {
        setSelectedVersionId(versionId);
      }
    },
    [compareMode],
  );

  const handleActionConfirm = useCallback(
    (comment?: string) => {
      if (!pendingAction) return;
      const { type, versionId } = pendingAction;
      const settled = { onSettled: () => setPendingAction(null) };
      switch (type) {
        case "submit":
          mutations.submit.mutate(versionId, settled);
          break;
        case "approve":
          mutations.approve.mutate({ versionId, comment }, settled);
          break;
        case "reject":
          mutations.reject.mutate({ versionId, comment }, settled);
          break;
        case "adopt":
          mutations.adopt.mutate(versionId, settled);
          break;
        case "restore":
          mutations.restore.mutate(versionId, settled);
          break;
        case "delete":
          mutations.deleteVersion.mutate(versionId, settled);
          break;
      }
    },
    [pendingAction, mutations],
  );

  const isActionPending = pendingAction
    ? (pendingAction.type === "delete" ? mutations.deleteVersion.isPending : mutations[pendingAction.type].isPending)
    : false;

  /* ── Diff summary rendering ── */
  function renderDiffSummary() {
    if (!diffEntries) return null;
    if (diffEntries.length === 0) {
      return (
        <div className="vmp-diff-empty">
          {t("versionManagement.noDifference")}
        </div>
      );
    }

    const counts = {
      added: diffEntries.filter((e) => e.type === "added").length,
      removed: diffEntries.filter((e) => e.type === "removed").length,
      modified: diffEntries.filter((e) => e.type === "modified").length,
    };

    return (
      <div className="vmp-diff-summary">
        <h4 className="vmp-diff-summary__title">
          {t("versionManagement.diffSummary")}
        </h4>
        <div className="vmp-diff-summary__counts">
          {counts.added > 0 && (
            <span className="vmp-diff-count vmp-diff-count--added">
              {t("versionManagement.added")} {counts.added}
            </span>
          )}
          {counts.removed > 0 && (
            <span className="vmp-diff-count vmp-diff-count--removed">
              {t("versionManagement.removed")} {counts.removed}
            </span>
          )}
          {counts.modified > 0 && (
            <span className="vmp-diff-count vmp-diff-count--modified">
              {t("versionManagement.modified")} {counts.modified}
            </span>
          )}
        </div>
        <div className="vmp-diff-entries">
          {diffEntries.map((entry, index) => (
            <div
              key={`${entry.type}-${entry.label}-${index}`}
              className={`vmp-diff-entry vmp-diff-entry--${entry.type}`}
            >
              <span className="vmp-diff-entry__type">
                {entry.type === "added"
                  ? t("versionManagement.added")
                  : entry.type === "removed"
                    ? t("versionManagement.removed")
                    : t("versionManagement.modified")}
              </span>
              <span className="vmp-diff-entry__label">{entry.label}</span>
              {entry.details.length > 0 && (
                <div className="vmp-diff-entry__details">
                  {entry.details.map((detail) => (
                    <span key={detail} className="vmp-diff-entry__detail">
                      {detail}
                    </span>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    );
  }

  /* ── Version actions (right panel header) ── */
  function renderVersionActions(version: NonNullable<typeof selectedVersion>) {
    const isCurrent = version.id === currentVersionId;
    const isPending =
      version.status === "pending_review" || version.status === "submitted";

    const openAction = (type: VersionActionType) => {
      setPendingAction({
        type,
        versionId: version.id,
        versionTitle: version.title,
        versionNumber: version.versionNumber,
      });
    };

    return (
      <div className="vmp-actions">
        {version.status === "draft" && (
          <>
            <button
              className="btn btn-secondary btn-sm"
              type="button"
              onClick={() => openAction("submit")}
            >
              {t("versionManagement.submitForReview")}
            </button>
            <button
              className="btn btn-danger btn-sm"
              type="button"
              onClick={() => openAction("delete")}
            >
              {t("versionManagement.delete")}
            </button>
          </>
        )}
        {isPending && (
          <>
            <button
              className="btn btn-primary btn-sm"
              type="button"
              onClick={() => openAction("approve")}
            >
              {t("versionManagement.approve")}
            </button>
            <button
              className="btn btn-danger btn-sm"
              type="button"
              onClick={() => openAction("reject")}
            >
              {t("versionManagement.reject")}
            </button>
          </>
        )}
        {version.status === "approved" && !isCurrent && (
          <>
            <button
              className="btn btn-primary btn-sm"
              type="button"
              onClick={() => openAction("adopt")}
            >
              {t("versionManagement.adopt")}
            </button>
            <button
              className="btn btn-secondary btn-sm"
              type="button"
              onClick={() => openAction("restore")}
            >
              {t("versionManagement.restore")}
            </button>
          </>
        )}
        {version.status === "approved" && isCurrent && (
          <button
            className="btn btn-secondary btn-sm"
            type="button"
            onClick={() => openAction("restore")}
          >
            {t("versionManagement.restore")}
          </button>
        )}
        {version.status === "rejected" && (
          <button
            className="btn btn-secondary btn-sm"
            type="button"
            onClick={() => openAction("restore")}
          >
            {t("versionManagement.restore")}
          </button>
        )}
      </div>
    );
  }

  /* ── Right panel: single view ── */
  function renderSingleView() {
    if (!selectedVersion) {
      return (
        <div className="vmp-empty">
          {t("versionManagement.noVersions")}
        </div>
      );
    }

    const parentVersion = selectedVersion.parentVersionId
      ? activeVersions.find((v) => v.id === selectedVersion.parentVersionId)
      : undefined;

    return (
      <div className="vmp-preview">
        <div className="vmp-preview__header">
          <div className="vmp-preview__info">
            <h3 className="vmp-preview__title">{selectedVersion.title}</h3>
            <span className="vmp-preview__meta">
              V{selectedVersion.versionNumber} ·{" "}
              {getRelativeTime(selectedVersion.createdAt, t)}
              {selectedVersion.createdBy && (
                <> · {selectedVersion.createdBy}</>
              )}
              {parentVersion && (
                <> · {t("versionManagement.basedOn", { version: `V${parentVersion.versionNumber}` }) as string}</>
              )}
            </span>
          </div>
          <div className="vmp-preview__status">
            <span
              className="vmp-status-badge"
              style={getStatusBadgeStyle(selectedVersion.status)}
            >
              {getVersionStatusLabel(t, selectedVersion.status as never)}
            </span>
            {selectedVersion.id === currentVersionId && (
              <span className="vmp-current-badge">
                {t("versionManagement.currentVersion")}
              </span>
            )}
          </div>
          {renderVersionActions(selectedVersion)}
        </div>
        {/* 影响面板 */}
        {selectedVersion.impactSummary ? (
          <div className="vmp-impact-panel">
            <VersionLineageStrip summary={selectedVersion.impactSummary} />
            {selectedVersion.impactSummary.latestIssues.length > 0 ? (
              <ImpactIssueList issues={selectedVersion.impactSummary.latestIssues} />
            ) : null}
          </div>
        ) : null}
        <div className="vmp-preview__body">
          <VersionContentRenderer content={selectedVersion.content} />
        </div>
      </div>
    );
  }

  /* ── Right panel: compare view ── */
  function renderCompareView() {
    if (!compareVersionIds || !compareVersionIds[1]) {
      return (
        <div className="vmp-empty">
          {t("versionManagement.selectTwoVersions")}
        </div>
      );
    }

    if (!compareBase || !compareTarget) {
      return (
        <div className="vmp-empty">
          {t("versionManagement.selectTwoVersions")}
        </div>
      );
    }

    return (
      <div className="vmp-compare">
        <div className="vmp-compare__panels">
          <div className="vmp-compare__panel">
            <div className="vmp-compare__panel-header">
              <span className="vmp-compare__panel-label">
                {t("versionManagement.compareBase")}
              </span>
              <span className="vmp-compare__panel-title">
                V{compareBase.versionNumber} · {compareBase.title}
              </span>
            </div>
            <div className="vmp-compare__panel-body">
              <VersionContentRenderer content={compareBase.content} />
            </div>
          </div>
          <div className="vmp-compare__panel">
            <div className="vmp-compare__panel-header">
              <span className="vmp-compare__panel-label">
                {t("versionManagement.compareTarget")}
              </span>
              <span className="vmp-compare__panel-title">
                V{compareTarget.versionNumber} · {compareTarget.title}
              </span>
            </div>
            <div className="vmp-compare__panel-body">
              <VersionContentRenderer content={compareTarget.content} />
            </div>
          </div>
        </div>
        {renderDiffSummary()}
      </div>
    );
  }

  /* ── Render ── */
  return (
    <div className="vmp-root">
      {/* Left panel: version list */}
      <div className="vmp-left">
        <div className="vmp-left-header">
          <h3>{t("versionManagement.versionList")}</h3>
          <span className="vmp-left-header__count">{activeVersions.length}</span>
        </div>

        {canCrossDoc && (
          <button
            type="button"
            className={`btn btn-sm ${crossDocument ? "btn-primary" : "btn-ghost"}`}
            style={{ marginBottom: "var(--space-2)", width: "100%", justifyContent: "center", fontSize: 12 }}
            onClick={() => {
              const next = !crossDocument;
              setCrossDocument(next);
              if (next) setStatusFilter("needs_review");
              else setStatusFilter("all");
            }}
          >
            {crossDocument ? t("versionManagement.singleDocMode") : t("versionManagement.crossDocMode")}
          </button>
        )}

        <div className="vmp-filters">
          <select
            className="input vmp-filter-select"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
          >
            <option value="all">{t("versionManagement.filterAll")}</option>
            {crossDocument && (
              <option value="needs_review">
                {t("versionManagement.filterNeedsReview")}
              </option>
            )}
            <option value="draft">
              {getVersionStatusLabel(t, "draft")}
            </option>
            <option value="submitted">
              {getVersionStatusLabel(t, "submitted")}
            </option>
            <option value="pending_review">
              {getVersionStatusLabel(t, "pending_review")}
            </option>
            <option value="approved">
              {getVersionStatusLabel(t, "approved")}
            </option>
            <option value="rejected">
              {getVersionStatusLabel(t, "rejected")}
            </option>
          </select>
          <input
            className="input vmp-filter-search"
            type="text"
            placeholder={t("versionManagement.searchPlaceholder")}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>

        <div className="vmp-list">
          {filteredVersions.length === 0 ? (
            <div className="vmp-list-empty">
              {t("versionManagement.noVersions")}
            </div>
          ) : (
            filteredVersions.map((version) => {
              const isSelected = compareMode
                ? compareVersionIds?.includes(version.id) ?? false
                : version.id === selectedVersionId;
              const isCurrent = version.id === currentVersionId;
              const badgeStyle = getStatusBadgeStyle(version.status);

              return (
                <div
                  key={version.id}
                  className={`vmp-item${isSelected ? " vmp-item--selected" : ""}`}
                  onClick={() => handleVersionClick(version.id)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); handleVersionClick(version.id); } }}
                >
                  <div className="vmp-item__left">
                    {compareMode && (
                      <span className="vmp-item__checkbox">
                        <svg
                          width="14"
                          height="14"
                          viewBox="0 0 24 24"
                          fill={isSelected ? "currentColor" : "none"}
                          stroke="currentColor"
                          strokeWidth="2"
                        >
                          <rect x="3" y="3" width="18" height="18" rx="2" />
                        </svg>
                      </span>
                    )}
                    {isCurrent && !compareMode && (
                      <span className="vmp-item__star" title={t("versionManagement.currentVersion")}>
                        ★
                      </span>
                    )}
                    <span className="vmp-item__version">V{version.versionNumber}</span>
                  </div>
                  <div className="vmp-item__center">
                    <span className="vmp-item__title" title={version.title}>
                      {crossDocument && version.documentId && docNameMap.has(version.documentId) && (
                        <span className="vmp-item__doc-name">{docNameMap.get(version.documentId)}</span>
                      )}
                      {version.title}
                    </span>
                    <span className="vmp-item__time">
                      {getRelativeTime(version.createdAt, t)}
                    </span>
                  </div>
                  <span
                    className="vmp-item__status"
                    style={badgeStyle}
                  >
                    {getVersionStatusLabel(t, version.status as never)}
                  </span>
                  {getImpactBadge(version.impactSummary) ? (
                    <span className={`vmp-impact-badge vmp-impact-badge--${getImpactBadge(version.impactSummary)!.tone}`}>
                      {t(getImpactBadge(version.impactSummary)!.labelKey as any)}
                    </span>
                  ) : null}
                  {version.status === "draft" && !compareMode && (
                    <button
                      type="button"
                      className="vmp-item__delete"
                      title={t("versionManagement.delete")}
                      onClick={(e) => {
                        e.stopPropagation();
                        setPendingAction({
                          type: "delete",
                          versionId: version.id,
                          versionTitle: version.title,
                          versionNumber: version.versionNumber,
                        });
                      }}
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="3 6 5 6 21 6" />
                        <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                      </svg>
                    </button>
                  )}
                </div>
              );
            })
          )}
        </div>

        <div className="vmp-left-footer">
          <button
            className={`btn btn-sm ${compareMode ? "btn-primary" : "btn-secondary"}`}
            type="button"
            onClick={handleToggleCompareMode}
          >
            {compareMode
              ? t("versionManagement.exitCompare")
              : t("versionManagement.compareMode")}
          </button>
        </div>
      </div>

      {/* Right panel: preview or comparison */}
      <div className="vmp-right">
        {compareMode ? renderCompareView() : renderSingleView()}
      </div>

      <VersionActionDialog
        open={!!pendingAction}
        action={pendingAction?.type ?? "submit"}
        versionTitle={pendingAction?.versionTitle ?? ""}
        versionNumber={pendingAction?.versionNumber ?? 0}
        onConfirm={handleActionConfirm}
        onCancel={() => setPendingAction(null)}
        isPending={isActionPending}
      />
    </div>
  );
}
