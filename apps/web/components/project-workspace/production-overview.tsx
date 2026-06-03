/**
 * @fileoverview 制作总览组件
 * @module web/components/project-workspace
 *
 * 展示制作流水线各阶段状态、摘要指标、下一步建议和阻塞项。
 * 仅做导航，不直接执行业务动作。
 */

"use client";

import { useCallback } from "react";
import type { ProjectWorkspacePayload } from "@dramaflow/shared";

import { useI18n, type TranslateFn } from "../../lib/i18n";
import {
  useProductionOverview,
  type ProductionNavigationTarget,
  type ProductionStageStatus,
  type ProductionStage,
  type ProductionBlocker,
  type ProductionMetric,
} from "../../lib/hooks/use-production-overview";

// =============================================
// Props
// =============================================

interface Props {
  payload: ProjectWorkspacePayload;
  onNavigate: (target: ProductionNavigationTarget) => void;
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
}: {
  stage: ProductionStage;
  onNavigate: (target: ProductionNavigationTarget) => void;
}) {
  const handleClick = useCallback(() => {
    onNavigate(stage.navigation);
  }, [onNavigate, stage.navigation]);

  return (
    <div className={`production-overview__stage ${statusClassMap[stage.status]}`}>
      <div className="production-overview__stage-header">
        <span className={`production-overview__status-dot production-overview__status-dot--${stage.status}`} />
        <span className="production-overview__stage-title">{stage.title}</span>
      </div>
      <span className="production-overview__stage-summary">{stage.summary}</span>
      <span className="production-overview__stage-detail">{stage.detail}</span>
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

/** 单个阻塞项 */
function BlockerItem({
  blocker,
  onNavigate,
  t,
}: {
  blocker: ProductionBlocker;
  onNavigate: (target: ProductionNavigationTarget) => void;
  t: TranslateFn;
}) {
  const handleClick = useCallback(() => {
    onNavigate(blocker.navigation);
  }, [onNavigate, blocker.navigation]);

  return (
    <div className="production-overview__blocker">
      <div className="production-overview__blocker-info">
        <span className="production-overview__blocker-title">{blocker.title}</span>
        <span className="production-overview__blocker-detail">{blocker.detail}</span>
      </div>
      <button
        type="button"
        className="btn btn-ghost"
        onClick={handleClick}
      >
        {t("projectWorkspace.productionOverview.go" as Parameters<TranslateFn>[0])}
      </button>
    </div>
  );
}

// =============================================
// 主组件
// =============================================

export function ProductionOverview({ payload, onNavigate }: Props) {
  const { t } = useI18n();
  const overview = useProductionOverview(payload, t);

  return (
    <div className="production-overview">
      {/* ── 顶部标题 + 摘要 ── */}
      <div className="production-overview__header">
        <h2 className="production-overview__title">
          {t("projectWorkspace.productionOverview.title" as Parameters<TranslateFn>[0])}
        </h2>
        <span className="production-overview__project-name">{payload.project.name}</span>
        {payload.project.genre && (
          <span className="production-overview__project-genre">{payload.project.genre}</span>
        )}
      </div>

      {/* ── 摘要指标网格 ── */}
      <div className="production-overview__summary">
        {overview.summaryMetrics.map((metric) => (
          <MetricCard key={metric.label} metric={metric} />
        ))}
      </div>

      {/* ── 下一步建议 ── */}
      {overview.nextStage && (
        <div className="production-overview__next-section">
          <h3 className="production-overview__section-title">
            {t("projectWorkspace.productionOverview.nextStep" as Parameters<TranslateFn>[0])}
          </h3>
          <NextStageCard stage={overview.nextStage} onNavigate={onNavigate} t={t} />
        </div>
      )}

      {/* ── 生产线地图 ── */}
      <div className="production-overview__pipeline">
        {overview.stages.map((stage) => (
          <StageCard key={stage.key} stage={stage} onNavigate={onNavigate} />
        ))}
      </div>

      {/* ── 阻塞和待办清单 ── */}
      <div className="production-overview__blockers">
        <h3 className="production-overview__section-title">
          {t("projectWorkspace.productionOverview.blockersTitle" as Parameters<TranslateFn>[0])}
        </h3>
        {overview.blockers.length === 0 ? (
          <p className="production-overview__blockers-empty">
            {t("projectWorkspace.productionOverview.blockersEmpty" as Parameters<TranslateFn>[0])}
          </p>
        ) : (
          overview.blockers.map((blocker) => (
            <BlockerItem key={blocker.id} blocker={blocker} onNavigate={onNavigate} t={t} />
          ))
        )}
      </div>
    </div>
  );
}
