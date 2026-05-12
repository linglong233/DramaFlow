"use client";

import type { ConversationDimension, ConversationDimensionStatus } from "@dramaflow/shared";
import { useI18n } from "../../lib/i18n";

const DIMENSION_ORDER: ConversationDimension[] = [
  "coreConflict",
  "protagonist",
  "supportingChars",
  "tone",
  "pacing",
  "constraints",
];

interface Props {
  dimensionStatus: Record<ConversationDimension, ConversationDimensionStatus>;
  onDimensionClick?: (dim: ConversationDimension) => void;
  disabled?: boolean;
}

function CheckIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}

export function DimensionTracker({ dimensionStatus, onDimensionClick, disabled }: Props) {
  const { t } = useI18n();

  function getLabel(dim: ConversationDimension): string {
    const labels: Record<ConversationDimension, string> = {
      coreConflict: t("conversation.dimensionCoreConflict"),
      protagonist: t("conversation.dimensionProtagonist"),
      supportingChars: t("conversation.dimensionSupportingChars"),
      tone: t("conversation.dimensionTone"),
      pacing: t("conversation.dimensionPacing"),
      constraints: t("conversation.dimensionConstraints"),
    };
    return labels[dim];
  }

  return (
    <div className="dim-tracker">
      {DIMENSION_ORDER.map((dim) => {
        const status = dimensionStatus[dim];
        const isConfirmed = status === "confirmed";
        const isDiscussing = status === "discussing";

        return (
          <button
            key={dim}
            className={`dim-tag${isConfirmed ? " dim-tag--confirmed" : ""}${isDiscussing ? " dim-tag--discussing" : ""}`}
            type="button"
            onClick={() => onDimensionClick?.(dim)}
            disabled={disabled || isConfirmed}
          >
            <span className="dim-tag__icon">
              {isConfirmed ? <CheckIcon /> : <span className="dim-tag__dot" />}
            </span>
            <span className="dim-tag__label">{getLabel(dim)}</span>
          </button>
        );
      })}
    </div>
  );
}
