/**
 * @fileoverview 上游版本自动感知选择器
 * @module web/components/project-workspace/generation
 *
 * 在生成面板中显示可选的上游版本列表（如剧本生成时选择大纲版本）。
 */

"use client";

import { useMemo } from "react";
import type { ProjectWorkspacePayload } from "@dramaflow/shared";

import { useI18n } from "../../../lib/i18n";
import type { TranslationKey } from "../../../lib/i18n/messages";
import type { SourcePickerConfig } from "./generator-registry";

interface Props {
  config: SourcePickerConfig;
  project: ProjectWorkspacePayload;
  value?: string;
  onChange: (versionId: string) => void;
}

export function SourcePicker({ config, project, value, onChange }: Props) {
  const { t } = useI18n();

  const versions = useMemo(() => {
    const doc = project.documents.find((d) => d.type === config.sourceType);
    if (!doc) return [];
    return project.versions
      .filter((v) => v.documentId === doc.id)
      .sort((a, b) => b.versionNumber - a.versionNumber);
  }, [project, config.sourceType]);

  if (versions.length === 0) {
    return (
      <div className="gen-source-picker gen-source-picker--empty">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" /></svg>
        <span>{t(config.emptyHintKey as TranslationKey)}</span>
      </div>
    );
  }

  return (
    <div className="gen-source-picker">
      <label className="form-label">{t(config.labelKey as TranslationKey)}</label>
      <select
        className="input"
        value={value ?? versions[0]?.id ?? ""}
        onChange={(e) => onChange(e.target.value)}
      >
        {versions.map((v) => (
          <option key={v.id} value={v.id}>
            {t("projectWorkspace.generate.sourceVersionOption", {
              versionNumber: v.versionNumber,
              title: v.title || "",
            })}
          </option>
        ))}
      </select>
    </div>
  );
}
