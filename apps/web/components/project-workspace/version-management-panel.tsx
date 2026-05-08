/**
 * @fileoverview 版本管理面板
 * @module web/components/project-workspace
 *
 * 分栏布局：左侧版本列表 + 右侧内容预览或版本对比。
 */

"use client";

import { useState, useMemo, useCallback } from "react";
import ReactMarkdown from "react-markdown";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { VersionRecord } from "@dramaflow/shared";
import {
  normalizeScriptContent,
  normalizeStoryboardContent,
  normalizeWorldBibleContent,
} from "@dramaflow/shared";
import { useI18n, getVersionStatusLabel } from "../../lib/i18n";
import { apiFetch } from "../../lib/api";
import { queryKeys } from "../../lib/query-keys";
import {
  ScriptView,
  StoryboardView,
  WorldBibleView,
  isScriptContent,
  isStoryboardContent,
  isWorldBibleContent,
} from "./version-view";

/* ─── Types ──────────────────────────────────────────────────── */

interface Props {
  documentId: string;
  documentTitle: string;
  documentType: string;
  versions: Array<
    Pick<
      VersionRecord,
      "id" | "title" | "versionNumber" | "status" | "content" | "createdAt"
    >
  >;
  currentVersionId?: string;
  projectId: string;
}

type StatusFilter =
  | "all"
  | "draft"
  | "submitted"
  | "pending_review"
  | "approved"
  | "rejected";

/* ─── Diff helpers (inline) ──────────────────────────────────── */

type DiffType = "added" | "removed" | "modified";

interface DiffEntry {
  type: DiffType;
  label: string;
  details: string[];
}

function diffStrings(base: string, compare: string): DiffEntry[] {
  if (base === compare) return [];
  return [{ type: "modified", label: "Content", details: ["Content changed"] }];
}

function diffJson(base: unknown, compare: unknown): DiffEntry[] {
  if (JSON.stringify(base) === JSON.stringify(compare)) return [];
  return [{ type: "modified", label: "Content", details: ["Content changed"] }];
}

function computeDiff(
  baseContent: unknown,
  compareContent: unknown,
): DiffEntry[] {
  if (baseContent == null || compareContent == null) return [];

  const baseIsString = typeof baseContent === "string";
  const compareIsString = typeof compareContent === "string";

  if (baseIsString && compareIsString) {
    return diffStrings(baseContent, compareContent);
  }

  if (isScriptContent(baseContent) && isScriptContent(compareContent)) {
    return diffScriptsInline(
      normalizeScriptContent(baseContent),
      normalizeScriptContent(compareContent),
    );
  }

  if (
    isStoryboardContent(baseContent) &&
    isStoryboardContent(compareContent)
  ) {
    return diffStoryboardsInline(
      normalizeStoryboardContent(baseContent),
      normalizeStoryboardContent(compareContent),
    );
  }

  if (isWorldBibleContent(baseContent) && isWorldBibleContent(compareContent)) {
    return diffWorldBiblesInline(
      normalizeWorldBibleContent(baseContent),
      normalizeWorldBibleContent(compareContent),
    );
  }

  return diffJson(baseContent, compareContent);
}

function diffScriptsInline(
  base: ReturnType<typeof normalizeScriptContent>,
  compare: ReturnType<typeof normalizeScriptContent>,
): DiffEntry[] {
  const entries: DiffEntry[] = [];

  if (base.logline !== compare.logline) {
    entries.push({
      type: "modified",
      label: "Logline",
      details: ["Logline changed"],
    });
  }
  if (base.premise !== compare.premise) {
    entries.push({
      type: "modified",
      label: "Premise",
      details: ["Premise changed"],
    });
  }

  const baseChars = (base.characters ?? []).map((c) => c.name);
  const compareChars = (compare.characters ?? []).map((c) => c.name);
  const addedChars = compareChars.filter((n) => !baseChars.includes(n));
  const removedChars = baseChars.filter((n) => !compareChars.includes(n));
  if (addedChars.length || removedChars.length) {
    const details: string[] = [];
    if (addedChars.length) details.push(`+ ${addedChars.join(", ")}`);
    if (removedChars.length) details.push(`- ${removedChars.join(", ")}`);
    entries.push({ type: "modified", label: "Characters", details });
  }

  for (const scene of compare.scenes) {
    if (!base.scenes.find((s) => s.id === scene.id)) {
      entries.push({
        type: "added",
        label: `Scene: ${scene.heading || scene.id}`,
        details: [scene.synopsis || ""],
      });
    }
  }

  for (const scene of base.scenes) {
    if (!compare.scenes.find((s) => s.id === scene.id)) {
      entries.push({
        type: "removed",
        label: `Scene: ${scene.heading || scene.id}`,
        details: [scene.synopsis || ""],
      });
    }
  }

  for (const baseScene of base.scenes) {
    const compareScene = compare.scenes.find((s) => s.id === baseScene.id);
    if (!compareScene) continue;

    const details: string[] = [];
    if (baseScene.heading !== compareScene.heading)
      details.push("Heading changed");
    if (baseScene.synopsis !== compareScene.synopsis)
      details.push("Synopsis changed");
    if ((baseScene.directorNote ?? "") !== (compareScene.directorNote ?? ""))
      details.push("Director note changed");
    if (baseScene.dialogue.length !== compareScene.dialogue.length)
      details.push(
        `Dialogue count: ${baseScene.dialogue.length} -> ${compareScene.dialogue.length}`,
      );

    if (details.length) {
      entries.push({
        type: "modified",
        label: `Scene: ${baseScene.heading || baseScene.id}`,
        details,
      });
    }
  }

  return entries;
}

function diffStoryboardsInline(
  base: ReturnType<typeof normalizeStoryboardContent>,
  compare: ReturnType<typeof normalizeStoryboardContent>,
): DiffEntry[] {
  const entries: DiffEntry[] = [];

  if (base.overview !== compare.overview) {
    entries.push({
      type: "modified",
      label: "Overview",
      details: ["Overview changed"],
    });
  }

  const baseIds = new Set(base.shots.map((s) => s.id));
  const compareIds = new Set(compare.shots.map((s) => s.id));

  for (const shot of compare.shots) {
    if (!baseIds.has(shot.id)) {
      entries.push({
        type: "added",
        label: `Shot: ${shot.shotLabel || shot.id}`,
        details: [shot.visualDescription || ""],
      });
    }
  }

  for (const shot of base.shots) {
    if (!compareIds.has(shot.id)) {
      entries.push({
        type: "removed",
        label: `Shot: ${shot.shotLabel || shot.id}`,
        details: [shot.visualDescription || ""],
      });
    }
  }

  for (const baseShot of base.shots) {
    const compareShot = compare.shots.find((s) => s.id === baseShot.id);
    if (!compareShot) continue;

    const details: string[] = [];
    if (baseShot.shotLabel !== compareShot.shotLabel)
      details.push(
        `Shot label: ${baseShot.shotLabel} -> ${compareShot.shotLabel}`,
      );
    if (baseShot.framing !== compareShot.framing)
      details.push(`Framing: ${baseShot.framing} -> ${compareShot.framing}`);
    if (baseShot.cameraMove !== compareShot.cameraMove)
      details.push(
        `Camera move: ${baseShot.cameraMove} -> ${compareShot.cameraMove}`,
      );
    if (baseShot.durationSeconds !== compareShot.durationSeconds)
      details.push(
        `Duration: ${baseShot.durationSeconds}s -> ${compareShot.durationSeconds}s`,
      );
    if (baseShot.visualDescription !== compareShot.visualDescription)
      details.push("Visual description changed");
    if ((baseShot.actionDescription ?? "") !== (compareShot.actionDescription ?? ""))
      details.push("Action description changed");
    if ((baseShot.dialogue ?? "") !== (compareShot.dialogue ?? ""))
      details.push("Dialogue changed");
    if ((baseShot.notes ?? "") !== (compareShot.notes ?? ""))
      details.push("Notes changed");

    if (details.length) {
      entries.push({
        type: "modified",
        label: `Shot: ${baseShot.shotLabel || baseShot.id}`,
        details,
      });
    }
  }

  return entries;
}

function diffWorldBiblesInline(
  base: ReturnType<typeof normalizeWorldBibleContent>,
  compare: ReturnType<typeof normalizeWorldBibleContent>,
): DiffEntry[] {
  const entries: DiffEntry[] = [];

  const baseCharNames = base.characters.map((c) => c.name);
  const compareCharNames = compare.characters.map((c) => c.name);
  const addedChars = compareCharNames.filter((n) => !baseCharNames.includes(n));
  const removedChars = baseCharNames.filter((n) => !compareCharNames.includes(n));
  if (addedChars.length) {
    entries.push({
      type: "added",
      label: "Characters",
      details: addedChars,
    });
  }
  if (removedChars.length) {
    entries.push({
      type: "removed",
      label: "Characters",
      details: removedChars,
    });
  }

  const baseLocNames = base.locations.map((l) => l.name);
  const compareLocNames = compare.locations.map((l) => l.name);
  const addedLocs = compareLocNames.filter((n) => !baseLocNames.includes(n));
  const removedLocs = baseLocNames.filter((n) => !compareLocNames.includes(n));
  if (addedLocs.length) {
    entries.push({ type: "added", label: "Locations", details: addedLocs });
  }
  if (removedLocs.length) {
    entries.push({
      type: "removed",
      label: "Locations",
      details: removedLocs,
    });
  }

  return entries;
}

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
}: Props) {
  const { t } = useI18n();
  const queryClient = useQueryClient();

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
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  /* ── Mutations ── */
  const submitMutation = useMutation({
    mutationFn: (versionId: string) =>
      apiFetch(`/versions/${versionId}/submit`, { method: "POST" }),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.project(projectId),
      });
      queryClient.invalidateQueries({
        queryKey: queryKeys.projectVersions(projectId),
      });
    },
  });

  const approveMutation = useMutation({
    mutationFn: (versionId: string) =>
      apiFetch(`/versions/${versionId}/approve`, { method: "POST" }),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.project(projectId),
      });
      queryClient.invalidateQueries({
        queryKey: queryKeys.projectVersions(projectId),
      });
    },
  });

  const rejectMutation = useMutation({
    mutationFn: (versionId: string) =>
      apiFetch(`/versions/${versionId}/reject`, { method: "POST" }),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.project(projectId),
      });
      queryClient.invalidateQueries({
        queryKey: queryKeys.projectVersions(projectId),
      });
    },
  });

  const restoreMutation = useMutation({
    mutationFn: (versionId: string) =>
      apiFetch(`/versions/${versionId}/restore`, { method: "POST" }),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.project(projectId),
      });
      queryClient.invalidateQueries({
        queryKey: queryKeys.projectVersions(projectId),
      });
    },
  });

  const adoptMutation = useMutation({
    mutationFn: (versionId: string) =>
      apiFetch(`/versions/${versionId}/adopt`, { method: "POST" }),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.project(projectId),
      });
      queryClient.invalidateQueries({
        queryKey: queryKeys.projectVersions(projectId),
      });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (versionId: string) =>
      apiFetch(`/versions/${versionId}`, { method: "DELETE" }),
    onSuccess: () => {
      setConfirmDeleteId(null);
      queryClient.invalidateQueries({
        queryKey: queryKeys.project(projectId),
      });
      queryClient.invalidateQueries({
        queryKey: queryKeys.projectVersions(projectId),
      });
    },
  });

  /* ── Filtered & sorted versions ── */
  const filteredVersions = useMemo(() => {
    const sorted = [...versions].sort(
      (a, b) => b.versionNumber - a.versionNumber,
    );
    return sorted.filter((v) => {
      if (statusFilter !== "all" && v.status !== statusFilter) return false;
      if (searchQuery && !v.title.toLowerCase().includes(searchQuery.toLowerCase()))
        return false;
      return true;
    });
  }, [versions, statusFilter, searchQuery]);

  /* ── Selected version data ── */
  const selectedVersion = useMemo(
    () => versions.find((v) => v.id === selectedVersionId) ?? null,
    [versions, selectedVersionId],
  );

  /* ── Compare data ── */
  const compareBase = useMemo(
    () => (compareVersionIds ? versions.find((v) => v.id === compareVersionIds[0]) ?? null : null),
    [versions, compareVersionIds],
  );
  const compareTarget = useMemo(
    () => (compareVersionIds ? versions.find((v) => v.id === compareVersionIds[1]) ?? null : null),
    [versions, compareVersionIds],
  );

  const diffEntries = useMemo(() => {
    if (!compareBase?.content || !compareTarget?.content) return null;
    return computeDiff(compareBase.content, compareTarget.content);
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

    return (
      <div className="vmp-actions">
        {version.status === "draft" && (
          <>
            <button
              className="btn btn-secondary btn-sm"
              type="button"
              onClick={() => submitMutation.mutate(version.id)}
              disabled={submitMutation.isPending}
            >
              {submitMutation.isPending
                ? "..."
                : t("versionManagement.submitForReview")}
            </button>
            <button
              className="btn btn-danger btn-sm"
              type="button"
              onClick={() => deleteMutation.mutate(version.id)}
              disabled={deleteMutation.isPending}
            >
              {deleteMutation.isPending
                ? "..."
                : t("versionManagement.delete")}
            </button>
          </>
        )}
        {isPending && (
          <>
            <button
              className="btn btn-primary btn-sm"
              type="button"
              onClick={() => approveMutation.mutate(version.id)}
              disabled={approveMutation.isPending}
            >
              {approveMutation.isPending
                ? "..."
                : t("versionManagement.approve")}
            </button>
            <button
              className="btn btn-danger btn-sm"
              type="button"
              onClick={() => rejectMutation.mutate(version.id)}
              disabled={rejectMutation.isPending}
            >
              {rejectMutation.isPending
                ? "..."
                : t("versionManagement.reject")}
            </button>
          </>
        )}
        {version.status === "approved" && !isCurrent && (
          <>
            <button
              className="btn btn-primary btn-sm"
              type="button"
              onClick={() => adoptMutation.mutate(version.id)}
              disabled={adoptMutation.isPending}
            >
              {adoptMutation.isPending
                ? "..."
                : t("versionManagement.adopt")}
            </button>
            <button
              className="btn btn-secondary btn-sm"
              type="button"
              onClick={() => restoreMutation.mutate(version.id)}
              disabled={restoreMutation.isPending}
            >
              {restoreMutation.isPending
                ? "..."
                : t("versionManagement.restore")}
            </button>
          </>
        )}
        {version.status === "approved" && isCurrent && (
          <button
            className="btn btn-secondary btn-sm"
            type="button"
            onClick={() => restoreMutation.mutate(version.id)}
            disabled={restoreMutation.isPending}
          >
            {restoreMutation.isPending
              ? "..."
              : t("versionManagement.restore")}
          </button>
        )}
        {version.status === "rejected" && (
          <button
            className="btn btn-secondary btn-sm"
            type="button"
            onClick={() => restoreMutation.mutate(version.id)}
            disabled={restoreMutation.isPending}
          >
            {restoreMutation.isPending
              ? "..."
              : t("versionManagement.restore")}
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

    return (
      <div className="vmp-preview">
        <div className="vmp-preview__header">
          <div className="vmp-preview__info">
            <h3 className="vmp-preview__title">{selectedVersion.title}</h3>
            <span className="vmp-preview__meta">
              V{selectedVersion.versionNumber} ·{" "}
              {getRelativeTime(selectedVersion.createdAt, t)}
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
          <span className="vmp-left-header__count">{versions.length}</span>
        </div>

        <div className="vmp-filters">
          <select
            className="input vmp-filter-select"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
          >
            <option value="all">{t("versionManagement.filterAll")}</option>
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
                  className={`vmp-item${isSelected ? " vmp-item--selected" : ""}${confirmDeleteId === version.id ? " vmp-item--confirming" : ""}`}
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
                  {version.status === "draft" && !compareMode && confirmDeleteId !== version.id && (
                    <button
                      type="button"
                      className="vmp-item__delete"
                      title={t("versionManagement.delete")}
                      onClick={(e) => { e.stopPropagation(); setConfirmDeleteId(version.id); }}
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="3 6 5 6 21 6" />
                        <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                      </svg>
                    </button>
                  )}
                  {confirmDeleteId === version.id && (
                    <div className="vmp-item__confirm" onClick={(e) => e.stopPropagation()}>
                      <button
                        type="button"
                        className="vmp-item__confirm-btn vmp-item__confirm-btn--cancel"
                        onClick={() => setConfirmDeleteId(null)}
                      >
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                          <line x1="18" y1="6" x2="6" y2="18" />
                          <line x1="6" y1="6" x2="18" y2="18" />
                        </svg>
                      </button>
                      <button
                        type="button"
                        className="vmp-item__confirm-btn vmp-item__confirm-btn--ok"
                        disabled={deleteMutation.isPending}
                        onClick={() => deleteMutation.mutate(version.id)}
                      >
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                          <polyline points="20 6 9 17 4 12" />
                        </svg>
                      </button>
                    </div>
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
    </div>
  );
}
