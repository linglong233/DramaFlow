/**
 * @fileoverview 镜头参考面板
 * @module web/components/project-workspace
 *
 * 镜头图片参考和资产管理。
 */

"use client";

import type { StoryboardShot } from "@dramaflow/shared";

import { useI18n } from "../../lib/i18n";

interface Props {
  shot: StoryboardShot | null;
  imageUrl?: string;
}

export function ShotReferencePanel({ shot, imageUrl }: Props) {
  const { t } = useI18n();

  if (!shot) {
    return (
      <div className="shot-ref-panel shot-ref-panel--empty">
        <div className="shot-ref-panel__placeholder">
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: 0.3 }}>
            <rect x="2" y="2" width="20" height="20" rx="2" />
            <circle cx="12" cy="12" r="3" />
          </svg>
          <p style={{ color: "var(--text-secondary)", fontSize: "0.85rem", textAlign: "center" }}>
            {t("shotReference.emptyHint")}
          </p>
        </div>
      </div>
    );
  }

  const fields: Array<{ label: string; value?: string | number | null }> = [
    { label: t("shotReference.shotLabel"), value: shot.shotLabel },
    { label: t("shotReference.framingLabel"), value: shot.framing },
    { label: t("shotReference.cameraMoveLabel"), value: shot.cameraMove },
    { label: t("shotReference.durationLabel"), value: shot.durationSeconds ? `${shot.durationSeconds}s` : null },
    { label: t("shotReference.visualLabel"), value: shot.visualDescription },
    { label: t("shotReference.actionLabel"), value: shot.actionDescription },
    { label: t("shotReference.dialogueLabel"), value: shot.dialogue },
    { label: t("shotReference.soundLabel"), value: shot.soundDesign },
    { label: t("shotReference.notesLabel"), value: shot.notes },
  ];

  return (
    <div className="shot-ref-panel">
      {imageUrl && (
        <div className="shot-ref-panel__image">
          <img src={imageUrl} alt={shot.shotLabel} />
        </div>
      )}

      <div className="shot-ref-panel__fields">
        {fields.map(
          (field) =>
            field.value && (
              <div key={field.label} className="shot-ref-panel__field">
                <span className="shot-ref-panel__label">{field.label}</span>
                <span className="shot-ref-panel__value">{field.value}</span>
              </div>
            ),
        )}
      </div>
    </div>
  );
}
