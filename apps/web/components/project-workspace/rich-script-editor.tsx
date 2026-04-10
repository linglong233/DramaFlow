"use client";

import { useCallback, useState } from "react";
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import { normalizeScriptContent, type ScriptContent, type ScriptContent as ScriptContentType } from "@dramaflow/shared";
import { useI18n } from "../../lib/i18n";
import { SceneHeading } from "./tiptap/extensions/scene-heading";
import { DialogueBlock } from "./tiptap/extensions/dialogue-block";
import { DirectorNote } from "./tiptap/extensions/director-note";
import { scriptContentToTiptap, tiptapToScriptContent } from "./tiptap/converters";

interface Props {
  initialContent?: ScriptContent | null;
  onSave: (title: string, content: ScriptContent) => void;
  onCancel: () => void;
  isSaving: boolean;
}

export function RichScriptEditor({ initialContent, onSave, onCancel, isSaving }: Props) {
  const { t } = useI18n();
  const normalized = initialContent ? normalizeScriptContent(initialContent) : null;

  const [title, setTitle] = useState(
    normalized ? t("scriptEditor.titleFromExisting") : t("scriptEditor.titleManual"),
  );
  const [logline, setLogline] = useState(normalized?.logline ?? "");
  const [premise, setPremise] = useState(normalized?.premise ?? "");
  const [characters, setCharacters] = useState<ScriptContent["characters"]>(
    normalized?.characters ?? [],
  );
  const [charInput, setCharInput] = useState({ name: "", profile: "" });

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: false, // We use our own scene heading
      }),
      Placeholder.configure({
        placeholder: t("richScriptEditor.editorPlaceholder"),
      }),
      SceneHeading,
      DialogueBlock,
      DirectorNote,
    ],
    content: normalized ? scriptContentToTiptap(normalized) : { type: "doc", content: [{ type: "paragraph" }] },
    editorProps: {
      attributes: {
        class: "tiptap-editor",
      },
    },
  });

  const addCharacter = useCallback(() => {
    if (!charInput.name.trim()) return;
    setCharacters((prev) => [
      ...prev,
      { name: charInput.name.trim(), profile: charInput.profile.trim() },
    ]);
    setCharInput({ name: "", profile: "" });
  }, [charInput]);

  const removeCharacter = useCallback((idx: number) => {
    setCharacters((prev) => prev.filter((_, i) => i !== idx));
  }, []);

  const handleUploadJson = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (evt) => {
        try {
          const parsed = normalizeScriptContent(JSON.parse(evt.target?.result as string));
          setLogline(parsed.logline);
          setPremise(parsed.premise);
          setCharacters(parsed.characters);
          if (editor && parsed.scenes.length > 0) {
            editor.commands.setContent(scriptContentToTiptap(parsed));
          }
        } catch {
          // silently ignore invalid JSON
        }
      };
      reader.readAsText(file);
      e.target.value = "";
    },
    [editor],
  );

  const handleSubmit = useCallback(() => {
    if (!editor) return;
    const doc = editor.getJSON();
    const content = tiptapToScriptContent(doc, { logline, premise, characters });
    onSave(title.trim() || t("scriptEditor.titleManual"), content);
  }, [editor, title, logline, premise, characters, onSave, t]);

  if (!editor) return null;

  return (
    <div className="se-root">
      {/* Header */}
      <div className="se-header">
        <div className="se-header__left">
          <h2 className="se-header__title">{t("scriptEditor.heading")}</h2>
          <div className="se-header__actions">
            <label className="se-upload-btn">
              {t("scriptEditor.uploadJson")}
              <input type="file" accept=".json" onChange={handleUploadJson} hidden />
            </label>
          </div>
        </div>
        <div className="se-header__right">
          <button className="btn btn-ghost btn-sm" type="button" onClick={onCancel}>
            {t("scriptEditor.cancel")}
          </button>
          <button className="btn btn-primary btn-sm" type="button" onClick={handleSubmit} disabled={isSaving}>
            {isSaving ? t("scriptEditor.saving") : t("scriptEditor.saveAsNewVersion")}
          </button>
        </div>
      </div>

      {/* Version title */}
      <div className="se-field">
        <label className="se-label">{t("scriptEditor.versionTitle")}</label>
        <input
          className="input se-input"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder={t("scriptEditor.versionTitlePlaceholder")}
        />
      </div>

      {/* Logline & Premise */}
      <div className="se-grid-2">
        <div className="se-field">
          <label className="se-label">{t("scriptEditor.logline")}</label>
          <textarea
            className="input se-textarea"
            rows={2}
            value={logline}
            onChange={(e) => setLogline(e.target.value)}
            placeholder={t("scriptEditor.loglinePlaceholder")}
          />
        </div>
        <div className="se-field">
          <label className="se-label">{t("scriptEditor.premise")}</label>
          <textarea
            className="input se-textarea"
            rows={2}
            value={premise}
            onChange={(e) => setPremise(e.target.value)}
            placeholder={t("scriptEditor.premisePlaceholder")}
          />
        </div>
      </div>

      {/* Characters */}
      <div className="se-section">
        <div className="se-section__head">
          <span className="se-section__title">
            {t("scriptEditor.characters")} ({characters.length})
          </span>
        </div>
        {characters.length > 0 && (
          <div className="se-char-list">
            {characters.map((c, i) => (
              <div key={i} className="se-char-row">
                <strong>{c.name}</strong>
                <span className="muted">{c.profile}</span>
                <button
                  className="se-remove-btn"
                  type="button"
                  onClick={() => removeCharacter(i)}
                  aria-label={t("scriptEditor.deleteLabel")}
                >
                  x
                </button>
              </div>
            ))}
          </div>
        )}
        <div className="se-add-row">
          <input
            className="input se-input-sm"
            placeholder={t("scriptEditor.characterName")}
            value={charInput.name}
            onChange={(e) => setCharInput((p) => ({ ...p, name: e.target.value }))}
            style={{ flex: 1 }}
          />
          <input
            className="input se-input-sm"
            placeholder={t("scriptEditor.characterProfile")}
            value={charInput.profile}
            onChange={(e) => setCharInput((p) => ({ ...p, profile: e.target.value }))}
            style={{ flex: 2 }}
          />
          <button
            className="btn btn-secondary btn-sm"
            type="button"
            onClick={addCharacter}
            disabled={!charInput.name.trim()}
          >
            {t("scriptEditor.addCharacter")}
          </button>
        </div>
      </div>

      {/* Toolbar */}
      <div className="tiptap-toolbar">
        <button
          type="button"
          className={`tiptap-toolbar__btn${editor.isActive("sceneHeading") ? " tiptap-toolbar__btn--active" : ""}`}
          onClick={() => editor.chain().focus().toggleSceneHeading().run()}
          title={t("richScriptEditor.sceneHeading")}
        >
          S
        </button>
        <button
          type="button"
          className={`tiptap-toolbar__btn${editor.isActive("bold") ? " tiptap-toolbar__btn--active" : ""}`}
          onClick={() => editor.chain().focus().toggleBold().run()}
          title={t("richScriptEditor.bold")}
        >
          B
        </button>
        <button
          type="button"
          className={`tiptap-toolbar__btn${editor.isActive("italic") ? " tiptap-toolbar__btn--active" : ""}`}
          onClick={() => editor.chain().focus().toggleItalic().run()}
          title={t("richScriptEditor.italic")}
        >
          I
        </button>
        <span className="tiptap-toolbar__divider" />
        <button
          type="button"
          className={`tiptap-toolbar__btn${editor.isActive("dialogueBlock") ? " tiptap-toolbar__btn--active" : ""}`}
          onClick={() => editor.chain().focus().setDialogueBlock({ speaker: "" }).run()}
          title={t("richScriptEditor.dialogue")}
        >
          D
        </button>
        <button
          type="button"
          className={`tiptap-toolbar__btn${editor.isActive("directorNote") ? " tiptap-toolbar__btn--active" : ""}`}
          onClick={() => editor.chain().focus().toggleDirectorNote().run()}
          title={t("richScriptEditor.directorNote")}
        >
          N
        </button>
        <span className="tiptap-toolbar__divider" />
        <button
          type="button"
          className="tiptap-toolbar__btn"
          onClick={() => editor.chain().focus().undo().run()}
          disabled={!editor.can().undo()}
          title={t("richScriptEditor.undo")}
        >
          &#x21A9;
        </button>
        <button
          type="button"
          className="tiptap-toolbar__btn"
          onClick={() => editor.chain().focus().redo().run()}
          disabled={!editor.can().redo()}
          title={t("richScriptEditor.redo")}
        >
          &#x21AA;
        </button>
      </div>

      {/* TipTap Editor */}
      <div className="tiptap-root">
        <EditorContent editor={editor} />
      </div>
    </div>
  );
}
