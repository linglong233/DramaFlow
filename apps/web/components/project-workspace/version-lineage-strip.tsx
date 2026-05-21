"use client";

import type { VersionImpactSummary } from "@dramaflow/shared";
import { useI18n } from "../../lib/i18n";

interface Props {
  summary?: VersionImpactSummary;
  onViewIssues?: () => void;
}

export function VersionLineageStrip({ summary, onViewIssues }: Props) {
  const { t } = useI18n();
  if (!summary) return null;

  const activeCount = summary.openCount + summary.suggestedCount + summary.acceptedCount;
  const dependencyLabels = summary.dependencies
    .filter((dependency) => dependency.sourceVersionId)
    .map((dependency) => `${dependency.sourceDocumentType ?? "source"} ${dependency.sourceVersionId?.slice(0, 8)}`);

  return (
    <div className={`lineage-strip${activeCount > 0 ? " lineage-strip--warning" : ""}`}>
      <div className="lineage-strip__main">
        <span className="lineage-strip__label">{t("impact.lineage.basedOn")}</span>
        <span className="lineage-strip__sources">
          {dependencyLabels.length > 0 ? dependencyLabels.join(" · ") : t("impact.lineage.unlinked")}
        </span>
      </div>
      <div className="lineage-strip__meta">
        <span>{t("impact.lineage.activeCount", { count: activeCount })}</span>
        {summary.ignoredCount > 0 ? <span>{t("impact.lineage.ignoredCount", { count: summary.ignoredCount })}</span> : null}
        {onViewIssues && activeCount > 0 ? (
          <button className="btn btn-secondary btn-sm" type="button" onClick={onViewIssues}>
            {t("impact.actions.view")}
          </button>
        ) : null}
      </div>
    </div>
  );
}
