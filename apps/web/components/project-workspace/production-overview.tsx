/**
 * @fileoverview 制作总览组件
 * @module web/components/project-workspace
 *
 * 展示制作流水线各阶段状态、摘要指标、下一步建议和阻塞项。
 * 仅做导航，不直接执行业务动作。
 */

"use client";

import { useCallback, useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { ProjectWorkspacePayload } from "@dramaflow/shared";

import { apiFetch, formatApiError } from "../../lib/api";
import { useI18n, type TranslateFn } from "../../lib/i18n";
import { queryKeys } from "../../lib/query-keys";
import {
  useProductionOverview,
  type ProductionAction,
  type ProductionNavigationTarget,
  type ProductionRisk,
  type ProductionShotCell,
  type ProductionShotRow,
  type ProductionStageStatus,
  type ProductionStage,
  type ProductionMetric,
} from "../../lib/hooks/use-production-overview";

// =============================================
// Props
// =============================================

interface Props {
  projectId: string;
  payload: ProjectWorkspacePayload;
  onNavigate: (target: ProductionNavigationTarget) => void;
  onFeedback?: (feedback: { message: string | null; error: string | null }) => void;
}

// =============================================
// 状态 -> CSS class 映射
// =============================================

const statusClassMap: Record<ProductionStageStatus, string> = {
  not_started: "production-overview__stage--not-started",
  in_progress: "production-overview__stage--in-progress",
  needs_action: "production-overview__stage--needs-action",
  blocked: "production-overview__stage--blocked",
  completed: "production-overview__stage--completed",
};

function getStatusLabel(status: ProductionStageStatus, t: TranslateFn): string {
  switch (status) {
    case "not_started":
      return t("projectWorkspace.productionOverview.status.notStarted" as Parameters<TranslateFn>[0]);
    case "in_progress":
      return t("projectWorkspace.productionOverview.status.inProgress" as Parameters<TranslateFn>[0]);
    case "needs_action":
      return t("projectWorkspace.productionOverview.status.needsAction" as Parameters<TranslateFn>[0]);
    case "blocked":
      return t("projectWorkspace.productionOverview.status.blocked" as Parameters<TranslateFn>[0]);
    case "completed":
      return t("projectWorkspace.productionOverview.status.completed" as Parameters<TranslateFn>[0]);
  }
}

type ProductionShotFilter =
  | "all"
  | "missing_image"
  | "missing_video"
  | "missing_audio"
  | "missing_composition"
  | "failed_job"
  | "ready_for_timeline";

const SHOT_FILTERS: ProductionShotFilter[] = [
  "all",
  "missing_image",
  "missing_video",
  "missing_audio",
  "missing_composition",
  "failed_job",
  "ready_for_timeline",
];

// =============================================
// 子组件
// =============================================

/** 单个摘要指标 */
function MetricCard({ metric }: { metric: ProductionMetric }) {
  return (
    <div className="production-overview__metric">
      <span className="production-overview__metric-value">{metric.value}</span>
      <span className="production-overview__metric-label">{metric.label}</span>
    </div>
  );
}

/** 下一步建议卡片 */
function NextStageCard({
  stage,
  onNavigate,
  t,
}: {
  stage: ProductionStage;
  onNavigate: (target: ProductionNavigationTarget) => void;
  t: TranslateFn;
}) {
  const handleClick = useCallback(() => {
    onNavigate(stage.navigation);
  }, [onNavigate, stage.navigation]);

  return (
    <div className="production-overview__next">
      <div className="production-overview__next-info">
        <span className="production-overview__next-stage">{stage.title}</span>
        <span className="production-overview__next-summary">{stage.summary}</span>
      </div>
      <button
        type="button"
        className="btn btn-primary"
        onClick={handleClick}
      >
        {stage.primaryAction}
      </button>
    </div>
  );
}

/** 单个流水线阶段节点 */
function StageCard({
  stage,
  onNavigate,
  t,
}: {
  stage: ProductionStage;
  onNavigate: (target: ProductionNavigationTarget) => void;
  t: TranslateFn;
}) {
  const handleClick = useCallback(() => {
    onNavigate(stage.navigation);
  }, [onNavigate, stage.navigation]);

  return (
    <div className={`production-overview__stage ${statusClassMap[stage.status]}`}>
      <div className="production-overview__stage-header">
        <span className={`production-overview__status-dot production-overview__status-dot--${stage.status}`} />
        <span className="production-overview__stage-title">{stage.title}</span>
        <span className="production-overview__stage-status">{getStatusLabel(stage.status, t)}</span>
      </div>
      <span className="production-overview__stage-summary">{stage.summary}</span>
      <span className="production-overview__stage-detail">{stage.detail}</span>
      <div className="production-overview__stage-metrics">
        {stage.metrics.map((metric) => (
          <span className="production-overview__stage-metric" key={metric.label}>
            <span className="production-overview__stage-metric-value">{metric.value}</span>
            <span className="production-overview__stage-metric-label">{metric.label}</span>
          </span>
        ))}
      </div>
      <button
        type="button"
        className="btn btn-secondary"
        onClick={handleClick}
      >
        {stage.primaryAction}
      </button>
    </div>
  );
}

function HealthHeader({
  payload,
  overview,
}: {
  payload: ProjectWorkspacePayload;
  overview: ReturnType<typeof useProductionOverview>;
}) {
  return (
    <div className={`production-overview__health production-overview__health--${overview.health.status}`}>
      <div>
        <h2 className="production-overview__title">{payload.project.name}</h2>
        <span className="production-overview__project-genre">{payload.project.genre || payload.project.status}</span>
      </div>
      <div className="production-overview__health-score">
        <span className="production-overview__health-value">{overview.health.score}</span>
        <span className="production-overview__health-label">{overview.health.label}</span>
      </div>
      <span className="production-overview__health-detail">{overview.health.detail}</span>
    </div>
  );
}

function RiskQueue({
  risks,
  onAction,
  isPending,
}: {
  risks: ProductionRisk[];
  onAction: (action: ProductionAction) => void;
  isPending: boolean;
}) {
  return (
    <div className="production-overview__risk-queue">
      {risks.slice(0, 8).map((risk) => (
        <div key={risk.id} className={`production-overview__risk production-overview__risk--${risk.severity}`}>
          <div className="production-overview__risk-info">
            <span className="production-overview__risk-title">{risk.title}</span>
            <span className="production-overview__risk-detail">{risk.detail}</span>
          </div>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            disabled={isPending || Boolean(risk.action.disabledReason)}
            onClick={() => onAction(risk.action)}
          >
            {risk.action.label}
          </button>
        </div>
      ))}
    </div>
  );
}

function CellBadge({ cell }: { cell: ProductionShotCell }) {
  return (
    <span className={`production-overview__cell production-overview__cell--${cell.state}`} title={cell.detail}>
      {cell.label}
    </span>
  );
}

function ShotProductionMatrix({
  rows,
  selectedShotIds,
  onToggle,
  onOpen,
}: {
  rows: ProductionShotRow[];
  selectedShotIds: Set<string>;
  onToggle: (shotId: string) => void;
  onOpen: (action: ProductionAction) => void;
}) {
  return (
    <div className="production-overview__matrix">
      <div className="production-overview__matrix-row production-overview__matrix-row--head">
        <span />
        <span>Shot</span>
        <span>Scene</span>
        <span>Image</span>
        <span>Video</span>
        <span>Audio</span>
        <span>Subtitle</span>
        <span>Comp</span>
        <span>Timeline</span>
        <span />
      </div>
      {rows.map((row) => (
        <div key={row.shotId} className="production-overview__matrix-row">
          <label className="production-overview__matrix-check">
            <input
              type="checkbox"
              checked={selectedShotIds.has(row.shotId)}
              onChange={() => onToggle(row.shotId)}
            />
          </label>
          <span className="production-overview__matrix-shot">{row.shotLabel}</span>
          <span className="production-overview__matrix-scene">{row.sceneId}</span>
          <CellBadge cell={row.image} />
          <CellBadge cell={row.video} />
          <CellBadge cell={row.audio} />
          <CellBadge cell={row.subtitle} />
          <CellBadge cell={row.composition} />
          <CellBadge cell={row.timeline} />
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => onOpen(row.action)}>
            {row.action.label}
          </button>
        </div>
      ))}
    </div>
  );
}

// =============================================
// 主组件
// =============================================

export function ProductionOverview({ projectId, payload, onNavigate, onFeedback }: Props) {
  const { t } = useI18n();
  const overview = useProductionOverview(payload, t);
  const queryClient = useQueryClient();
  const [shotFilter, setShotFilter] = useState<ProductionShotFilter>("all");
  const [selectedShotIds, setSelectedShotIds] = useState<Set<string>>(new Set());

  const invalidateProductionQueries = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: queryKeys.project(projectId) });
    void queryClient.invalidateQueries({ queryKey: queryKeys.projectJobs(projectId) });
    void queryClient.invalidateQueries({ queryKey: queryKeys.projectVersions(projectId) });
    void queryClient.invalidateQueries({ queryKey: queryKeys.timeline(projectId) });
    void queryClient.invalidateQueries({ queryKey: queryKeys.exports(projectId) });
  }, [projectId, queryClient]);

  const actionMutation = useMutation({
    mutationFn: async (action: ProductionAction) => {
      if (action.disabledReason) {
        throw new Error(action.disabledReason);
      }
      if (action.type === "batch_image") {
        return apiFetch(`/projects/${projectId}/batch-image-jobs`, {
          method: "POST",
          body: { shotIds: action.shotIds ?? [], configSource: "team" },
        });
      }
      if (action.type === "batch_video") {
        return apiFetch(`/projects/${projectId}/batch-video-jobs`, {
          method: "POST",
          body: { shotIds: action.shotIds ?? [], configSource: "team" },
        });
      }
      if (action.type === "retry_job" && action.jobId) {
        return apiFetch(`/jobs/${action.jobId}/retry`, { method: "POST" });
      }
      if (action.type === "navigate" && action.navigation) {
        onNavigate(action.navigation);
        return null;
      }
      return null;
    },
    onSuccess: (_result, action) => {
      if (action.type !== "navigate") {
        onFeedback?.({
          message: t("projectWorkspace.productionOverview.feedback.actionQueued" as Parameters<TranslateFn>[0]),
          error: null,
        });
        invalidateProductionQueries();
        setSelectedShotIds(new Set());
      }
    },
    onError: (error) => {
      onFeedback?.({
        message: null,
        error: formatApiError(error, t, "projectWorkspace.productionOverview.feedback.actionFailed" as Parameters<TranslateFn>[0]),
      });
    },
  });

  const visibleRows = useMemo(() => {
    return overview.shotRows.filter((row) => {
      if (shotFilter === "all") return true;
      if (shotFilter === "missing_image") return row.image.state === "missing" || row.image.state === "failed";
      if (shotFilter === "missing_video") return row.video.state === "missing" || row.video.state === "failed";
      if (shotFilter === "missing_audio") return row.audio.state === "missing" || row.audio.state === "failed";
      if (shotFilter === "missing_composition") return row.composition.state === "missing" || row.composition.state === "failed" || row.composition.state === "review";
      if (shotFilter === "failed_job") return row.latestJob?.status === "failed";
      if (shotFilter === "ready_for_timeline") return row.video.state === "ready" && row.timeline.state !== "ready";
      return true;
    });
  }, [overview.shotRows, shotFilter]);

  const selectedRows = useMemo(
    () => overview.shotRows.filter((row) => selectedShotIds.has(row.shotId)),
    [overview.shotRows, selectedShotIds],
  );

  const selectedBatchImageAction = useMemo<ProductionAction | null>(() => {
    const shotIds = selectedRows
      .filter((row) => row.image.state === "missing" || row.image.state === "failed")
      .map((row) => row.shotId);
    if (shotIds.length === 0) return null;
    const baseAction = overview.actionQueue.find((action) => action.type === "batch_image");
    return baseAction ? { ...baseAction, shotIds } : null;
  }, [overview.actionQueue, selectedRows]);

  const selectedBatchVideoAction = useMemo<ProductionAction | null>(() => {
    const shotIds = selectedRows
      .filter((row) => row.image.state === "ready" && (row.video.state === "missing" || row.video.state === "failed"))
      .map((row) => row.shotId);
    if (shotIds.length === 0) return null;
    const baseAction = overview.actionQueue.find((action) => action.type === "batch_video");
    return baseAction ? { ...baseAction, shotIds } : null;
  }, [overview.actionQueue, selectedRows]);

  return (
    <div className="production-overview">
      <HealthHeader payload={payload} overview={overview} />

      <div className="production-overview__summary">
        {overview.summaryMetrics.map((metric) => (
          <MetricCard key={metric.label} metric={metric} />
        ))}
      </div>

      {overview.nextStage && (
        <div className="production-overview__next-section">
          <h3 className="production-overview__section-title">
            {t("projectWorkspace.productionOverview.nextStep" as Parameters<TranslateFn>[0])}
          </h3>
          <NextStageCard stage={overview.nextStage} onNavigate={onNavigate} t={t} />
        </div>
      )}

      <div className="production-overview__pipeline">
        {overview.stages.map((stage) => (
          <StageCard key={stage.key} stage={stage} onNavigate={onNavigate} t={t} />
        ))}
      </div>

      <div className="production-overview__split">
        <section className="production-overview__panel">
          <h3 className="production-overview__section-title">
            {t("projectWorkspace.productionOverview.risk.title" as Parameters<TranslateFn>[0])}
          </h3>
          {overview.risks.length > 0 ? (
            <RiskQueue
              risks={overview.risks}
              onAction={(action) => actionMutation.mutate(action)}
              isPending={actionMutation.isPending}
            />
          ) : (
            <p className="production-overview__blockers-empty">
              {t("projectWorkspace.productionOverview.risk.empty" as Parameters<TranslateFn>[0])}
            </p>
          )}
        </section>

        <section className="production-overview__panel">
          <h3 className="production-overview__section-title">
            {t("projectWorkspace.productionOverview.readiness.title" as Parameters<TranslateFn>[0])}
          </h3>
          <div className="production-overview__readiness">
            {overview.readinessChecks.map((check) => (
              <button
                key={check.id}
                type="button"
                className={`production-overview__readiness-row production-overview__readiness-row--${check.state}`}
                onClick={() => check.action.navigation && onNavigate(check.action.navigation)}
              >
                <span>{check.title}</span>
                <span>{check.detail}</span>
              </button>
            ))}
          </div>
        </section>
      </div>

      <section className="production-overview__panel">
        <div className="production-overview__matrix-header">
          <h3 className="production-overview__section-title">
            {t("projectWorkspace.productionOverview.matrix.title" as Parameters<TranslateFn>[0])}
          </h3>
          <div className="production-overview__filters">
            {SHOT_FILTERS.map((filter) => (
              <button
                key={filter}
                type="button"
                className={`production-overview__filter${shotFilter === filter ? " production-overview__filter--active" : ""}`}
                onClick={() => setShotFilter(filter)}
              >
                {t(`projectWorkspace.productionOverview.filters.${filter}` as Parameters<TranslateFn>[0])}
              </button>
            ))}
          </div>
        </div>

        {selectedShotIds.size > 0 && (
          <div className="production-overview__action-bar">
            <span>{t("projectWorkspace.productionOverview.actions.selectedShots" as Parameters<TranslateFn>[0], { count: String(selectedShotIds.size) })}</span>
            {selectedBatchImageAction && (
              <button type="button" className="btn btn-primary btn-sm" disabled={actionMutation.isPending || Boolean(selectedBatchImageAction.disabledReason)} onClick={() => actionMutation.mutate(selectedBatchImageAction)}>
                {selectedBatchImageAction.label}
              </button>
            )}
            {selectedBatchVideoAction && (
              <button type="button" className="btn btn-primary btn-sm" disabled={actionMutation.isPending || Boolean(selectedBatchVideoAction.disabledReason)} onClick={() => actionMutation.mutate(selectedBatchVideoAction)}>
                {selectedBatchVideoAction.label}
              </button>
            )}
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setSelectedShotIds(new Set())}>
              {t("projectWorkspace.productionOverview.actions.clearSelection" as Parameters<TranslateFn>[0])}
            </button>
          </div>
        )}

        <ShotProductionMatrix
          rows={visibleRows}
          selectedShotIds={selectedShotIds}
          onToggle={(shotId) => {
            setSelectedShotIds((current) => {
              const next = new Set(current);
              if (next.has(shotId)) next.delete(shotId);
              else next.add(shotId);
              return next;
            });
          }}
          onOpen={(action) => actionMutation.mutate(action)}
        />
      </section>
    </div>
  );
}
