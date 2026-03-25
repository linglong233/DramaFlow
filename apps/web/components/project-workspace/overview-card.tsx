import type { DocumentType, ReviewPolicyMode } from "@dramaflow/shared";

import { getDocumentTypeLabel, getReviewPolicyLabel, useI18n } from "../../lib/i18n";
import { SectionCard } from "../section-card";
import { StatusBadge } from "../status-badge";

interface OverviewCardProps {
  name: string;
  description: string;
  reviewPolicyMode: ReviewPolicyMode;
  membersCount: number;
  invitesCount: number;
  documentsCount: number;
  currentDocumentType?: DocumentType;
  pending: boolean;
  onReviewPolicyChange: (mode: ReviewPolicyMode) => void;
}

const reviewModes: ReviewPolicyMode[] = ["inherit", "required", "bypass"];

export function OverviewCard({
  name,
  description,
  reviewPolicyMode,
  membersCount,
  invitesCount,
  documentsCount,
  currentDocumentType,
  pending,
  onReviewPolicyChange,
}: OverviewCardProps) {
  const { t } = useI18n();

  return (
    <SectionCard className="section-card--hero">
      <div className="project-overview">
        <div className="stack stack--tight">
          <span className="kicker">{t("projectWorkspace.overview.kicker")}</span>
          <h1 className="page-title">{name}</h1>
          <p className="page-description">
            {description || t("projectWorkspace.overview.fallbackDescription")}
          </p>
        </div>

        <div className="project-overview__meta">
          <div className="metric-chip">
            <span className="muted">{t("projectWorkspace.overview.membersLabel")}</span>
            <strong>{membersCount}</strong>
          </div>
          <div className="metric-chip">
            <span className="muted">{t("projectWorkspace.overview.invitesLabel")}</span>
            <strong>{invitesCount}</strong>
          </div>
          <div className="metric-chip">
            <span className="muted">{t("projectWorkspace.overview.documentsLabel")}</span>
            <strong>{documentsCount}</strong>
          </div>
          <StatusBadge tone="info">
            {t("common.reviewPrefix", { value: getReviewPolicyLabel(t, reviewPolicyMode) })}
          </StatusBadge>
          {currentDocumentType ? (
            <StatusBadge tone="neutral">
              {t("common.currentPrefix", { value: getDocumentTypeLabel(t, currentDocumentType) })}
            </StatusBadge>
          ) : null}
        </div>
      </div>

      <div className="choice-row">
        {reviewModes.map((mode) => (
          <button
            key={mode}
            className={mode === reviewPolicyMode ? "choice-chip choice-chip--active" : "choice-chip"}
            type="button"
            disabled={pending}
            onClick={() => onReviewPolicyChange(mode)}
          >
            {getReviewPolicyLabel(t, mode)}
          </button>
        ))}
      </div>
    </SectionCard>
  );
}