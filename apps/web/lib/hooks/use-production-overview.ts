import { useMemo } from "react";

import type { ProjectWorkspacePayload } from "@dramaflow/shared";

import type { TranslateFn } from "../i18n";

export {
  buildProductionOverviewModel,
  type ProductionAction,
  type ProductionActionType,
  type ProductionBlocker,
  type ProductionHealth,
  type ProductionHealthStatus,
  type ProductionMetric,
  type ProductionNavigationTarget,
  type ProductionOverviewModel,
  type ProductionReadinessCheck,
  type ProductionReadinessState,
  type ProductionRisk,
  type ProductionRiskSeverity,
  type ProductionShotCell,
  type ProductionShotCellState,
  type ProductionShotRow,
  type ProductionStage,
  type ProductionStageKey,
  type ProductionStageStatus,
} from "./production-cockpit-model";

import { buildProductionOverviewModel } from "./production-cockpit-model";

export function useProductionOverview(
  payload: ProjectWorkspacePayload,
  t: TranslateFn,
) {
  return useMemo(() => buildProductionOverviewModel(payload, t), [payload, t]);
}
