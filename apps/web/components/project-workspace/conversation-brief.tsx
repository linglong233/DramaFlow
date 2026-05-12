"use client";

import type { ConversationBrief, ConversationDimension, ConversationDimensionStatus } from "@dramaflow/shared";
import { useI18n } from "../../lib/i18n";
import { DimensionTracker } from "./dimension-tracker";

interface Props {
  brief: ConversationBrief;
  dimensionStatus: Record<ConversationDimension, ConversationDimensionStatus>;
  canGenerate: boolean;
  isStreaming: boolean;
  onBriefFieldChange: (field: keyof ConversationBrief, value: string) => void;
  onDimensionClick: (dim: ConversationDimension) => void;
  onGenerate: () => void;
  targetDocType: "synopsis" | "script";
  generatedContent?: string | null;
  onEditGenerated?: () => void;
  onContinueConversation?: () => void;
}

export function ConversationBrief({
  brief,
  dimensionStatus,
  canGenerate,
  isStreaming,
  onBriefFieldChange,
  onDimensionClick,
  onGenerate,
  targetDocType,
  generatedContent,
  onEditGenerated,
  onContinueConversation,
}: Props) {
  const { t } = useI18n();

  const fields: Array<{ key: keyof ConversationBrief; label: string }> = [
    { key: "coreConflict", label: t("conversation.briefCoreConflict") },
    { key: "protagonist", label: t("conversation.briefProtagonist") },
    { key: "supportingChars", label: t("conversation.briefSupportingChars") },
    { key: "tone", label: t("conversation.briefTone") },
    { key: "pacing", label: t("conversation.briefPacing") },
    { key: "constraints", label: t("conversation.briefConstraints") },
  ];

  if (generatedContent) {
    return (
      <div className="conv-brief">
        <h4 className="conv-brief__title">{t("conversation.generatedResult")}</h4>
        <div className="conv-brief__result">
          <pre className="conv-brief__result-text">{generatedContent}</pre>
        </div>
        <div className="conv-brief__actions">
          {onEditGenerated && (
            <button className="btn btn-secondary btn-sm" type="button" onClick={onEditGenerated}>
              {t("conversation.editResult")}
            </button>
          )}
          {targetDocType === "synopsis" && onContinueConversation && (
            <button className="btn btn-primary btn-sm" type="button" onClick={onContinueConversation}>
              {t("conversation.confirmAndGenScript")}
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="conv-brief">
      <DimensionTracker
        dimensionStatus={dimensionStatus}
        onDimensionClick={onDimensionClick}
        disabled={isStreaming}
      />

      <div className="conv-brief__fields">
        {fields.map(({ key, label }) => (
          <div key={key} className="conv-brief__field">
            <label className="conv-brief__label">{label}</label>
            <textarea
              className="input conv-brief__textarea"
              rows={2}
              value={brief[key] ?? ""}
              onChange={(e) => onBriefFieldChange(key, e.target.value)}
              placeholder={label}
            />
          </div>
        ))}
      </div>

      <button
        className="gen-action-btn"
        type="button"
        onClick={onGenerate}
        disabled={!canGenerate || isStreaming}
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 2l2.4 7.2L22 12l-7.6 2.8L12 22l-2.4-7.2L2 12l7.6-2.8L12 2z" />
        </svg>
        {targetDocType === "synopsis"
          ? t("conversation.generateSynopsis")
          : t("conversation.generateScript")}
      </button>
    </div>
  );
}
