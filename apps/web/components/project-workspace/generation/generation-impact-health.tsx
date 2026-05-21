"use client";

import type { ProjectWorkspacePayload } from "@dramaflow/shared";
import { useI18n } from "../../../lib/i18n";

interface Props {
  project: ProjectWorkspacePayload;
  sourceVersionId?: string;
}

export function GenerationImpactHealth({ project, sourceVersionId }: Props) {
  const { t } = useI18n();
  const sourceVersion = sourceVersionId
    ? project.versions.find((version) => version.id === sourceVersionId)
    : null;
  const impactSummary = sourceVersion?.impactSummary;
  const activeCount = impactSummary
    ? impactSummary.openCount + impactSummary.suggestedCount + impactSummary.acceptedCount
    : 0;

  if (!sourceVersion || activeCount === 0) {
    return (
      <div className="impact-health impact-health--ok">
        {t("impact.health.ok")}
      </div>
    );
  }

  return (
    <div className="impact-health impact-health--warning">
      {t("impact.health.warning", {
        version: `V${sourceVersion.versionNumber}`,
        count: activeCount,
      })}
    </div>
  );
}
