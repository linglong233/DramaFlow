/**
 * @fileoverview 大纲编辑器
 * @module web/components/project-workspace
 *
 * 简洁的 textarea 编辑器，用于手动编辑大纲（synopsis）文档。
 */

"use client";

import { useEffect, useRef, useState } from "react";
import { useI18n } from "../../lib/i18n";

interface Props {
  initialContent: string | null;
  onSave: (title: string, content: string) => void;
  onCancel: () => void;
  isSaving: boolean;
}

export function SynopsisEditor({ initialContent, onSave, onCancel, isSaving }: Props) {
  const { t } = useI18n();
  const [title, setTitle] = useState(t("synopsisEditor.defaultTitle"));
  const [content, setContent] = useState(initialContent ?? "");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.focus();
    }
  }, []);

  function handleSave() {
    const trimmed = content.trim();
    if (!trimmed) return;
    onSave(title.trim() || t("synopsisEditor.defaultTitle"), trimmed);
  }

  return (
    <div className="editor-root">
      <div className="editor-toolbar">
        <input
          className="input editor-title-input"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder={t("synopsisEditor.titlePlaceholder")}
        />
      </div>
      <textarea
        ref={textareaRef}
        className="input editor-textarea"
        value={content}
        onChange={(e) => setContent(e.target.value)}
        placeholder={t("synopsisEditor.contentPlaceholder")}
        style={{
          flex: 1,
          minHeight: 400,
          resize: "vertical",
          fontFamily: "inherit",
          fontSize: 14,
          lineHeight: 1.8,
          whiteSpace: "pre-wrap",
        }}
      />
      <div className="editor-actions">
        <button className="btn btn-ghost" type="button" onClick={onCancel} disabled={isSaving}>
          {t("common.cancel")}
        </button>
        <button
          className="btn btn-primary"
          type="button"
          onClick={handleSave}
          disabled={isSaving || !content.trim()}
        >
          {isSaving ? t("common.submitting") : t("synopsisEditor.save")}
        </button>
      </div>
    </div>
  );
}
