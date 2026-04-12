/**
 * @fileoverview 分镜编辑器
 * @module web/components/project-workspace
 *
 * 分镜场景和镜头的结构化编辑器。
 */

"use client";

import { useState } from "react";
import type { ProjectWorkspacePayload, StoryboardContent } from "@dramaflow/shared";
import { normalizeStoryboardContent } from "@dramaflow/shared";

import { useI18n } from "../../lib/i18n";
import { StoryboardWorkbench } from "./storyboard-workbench";

interface Props {
  initialContent?: StoryboardContent | null;
  onSave: (title: string, content: StoryboardContent) => void;
  onCancel: () => void;
  isSaving: boolean;
  projectId?: string;
  project?: ProjectWorkspacePayload;
}

export function StoryboardEditor({ initialContent, onSave, onCancel, isSaving, projectId, project }: Props) {
  const { t } = useI18n();
  const [title, setTitle] = useState(initialContent ? t("storyboardEditor.editVersionTitle") : t("storyboardEditor.newVersionTitle"));
  const [content, setContent] = useState<StoryboardContent>(() => normalizeStoryboardContent(initialContent ?? { overview: "", shots: [] }));

  function handleUploadJson(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }

    const reader = new FileReader();
    reader.onload = (loadEvent) => {
      try {
        const parsed = JSON.parse(String(loadEvent.target?.result ?? "{}"));
        setContent(normalizeStoryboardContent(parsed));
      } catch {
        // Ignore invalid JSON imports for now.
      }
    };
    reader.readAsText(file, "utf-8");
    event.target.value = "";
  }

  function handleSubmit() {
    onSave(title.trim() || t("storyboardEditor.newVersionTitle"), normalizeStoryboardContent(content));
  }

  return (
    <div className="se-root">
      <div className="se-header">
        <div className="se-header__left">
          <h2 className="se-header__title">{t("storyboardEditor.title")}</h2>
          <div className="se-header__actions">
            <label className="se-upload-btn">
              {t("storyboardEditor.uploadJson")}
              <input type="file" accept=".json" onChange={handleUploadJson} hidden />
            </label>
          </div>
        </div>
        <div className="se-header__right">
          <button className="btn btn-ghost btn-sm" type="button" onClick={onCancel}>{t("common.cancel")}</button>
          <button className="btn btn-primary btn-sm" type="button" onClick={handleSubmit} disabled={isSaving}>
            {isSaving ? t("storyboardEditor.saving") : t("storyboardEditor.saveAction")}
          </button>
        </div>
      </div>

      <div className="se-field">
        <label className="se-label">{t("storyboardEditor.versionTitleLabel")}</label>
        <input className="input se-input" value={title} onChange={(event) => setTitle(event.target.value)} placeholder={t("storyboardEditor.versionTitlePlaceholder")} />
      </div>

      <StoryboardWorkbench
        content={content}
        onChange={setContent}
        projectId={projectId}
        project={project}
        allowProjectMutations
      />
    </div>
  );
}