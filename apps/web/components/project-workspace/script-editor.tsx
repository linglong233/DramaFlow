/**
 * @fileoverview 剧本编辑器
 * @module web/components/project-workspace
 *
 * 纯文本模式的剧本编辑器。
 */

"use client";

import { useState } from "react";
import { normalizeScriptContent, type ScriptContent, type ScriptScene } from "@dramaflow/shared";
import { useI18n } from "../../lib/i18n";

interface Props {
  initialContent?: ScriptContent | null;
  onSave: (title: string, content: ScriptContent) => void;
  onCancel: () => void;
  isSaving: boolean;
}

function generateId() {
  return `scene-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function emptyScene(): ScriptScene {
  return {
    id: generateId(),
    heading: "",
    synopsis: "",
    characters: [],
    dialogue: [],
    directorNote: "",
  };
}

function emptyContent(): ScriptContent {
  return {
    logline: "",
    premise: "",
    characters: [],
    scenes: [emptyScene()],
  };
}

export function ScriptEditor({ initialContent, onSave, onCancel, isSaving }: Props) {
  const { t } = useI18n();
  const [title, setTitle] = useState(initialContent ? t("scriptEditor.titleFromExisting") : t("scriptEditor.titleManual"));
  const [content, setContent] = useState<ScriptContent>(() => initialContent ? normalizeScriptContent(initialContent) : emptyContent());
  const [expandedScenes, setExpandedScenes] = useState<Set<string>>(
    new Set(content.scenes.map((s) => s.id)),
  );
  const [charInput, setCharInput] = useState({ name: "", profile: "" });

  function updateContent(patch: Partial<ScriptContent>) {
    setContent((prev) => ({ ...prev, ...patch }));
  }

  function updateScene(sceneId: string, patch: Partial<ScriptScene>) {
    setContent((prev) => ({
      ...prev,
      scenes: prev.scenes.map((s) => (s.id === sceneId ? { ...s, ...patch } : s)),
    }));
  }

  function addScene() {
    const scene = emptyScene();
    setContent((prev) => ({ ...prev, scenes: [...prev.scenes, scene] }));
    setExpandedScenes((prev) => new Set(prev).add(scene.id));
  }

  function removeScene(sceneId: string) {
    setContent((prev) => ({ ...prev, scenes: prev.scenes.filter((s) => s.id !== sceneId) }));
  }

  function moveScene(sceneId: string, dir: -1 | 1) {
    setContent((prev) => {
      const idx = prev.scenes.findIndex((s) => s.id === sceneId);
      if (idx < 0) return prev;
      const target = idx + dir;
      if (target < 0 || target >= prev.scenes.length) return prev;
      const next = [...prev.scenes];
      [next[idx], next[target]] = [next[target], next[idx]];
      return { ...prev, scenes: next };
    });
  }

  function toggleScene(sceneId: string) {
    setExpandedScenes((prev) => {
      const next = new Set(prev);
      if (next.has(sceneId)) next.delete(sceneId);
      else next.add(sceneId);
      return next;
    });
  }

  function addDialogue(sceneId: string) {
    updateScene(sceneId, {
      dialogue: [
        ...(content.scenes.find((s) => s.id === sceneId)?.dialogue ?? []),
        { speaker: "", line: "" },
      ],
    });
  }

  function updateDialogue(sceneId: string, idx: number, field: "speaker" | "line", value: string) {
    const scene = content.scenes.find((s) => s.id === sceneId);
    if (!scene) return;
    const dialogue = scene.dialogue.map((d, i) => (i === idx ? { ...d, [field]: value } : d));
    updateScene(sceneId, { dialogue });
  }

  function removeDialogue(sceneId: string, idx: number) {
    const scene = content.scenes.find((s) => s.id === sceneId);
    if (!scene) return;
    updateScene(sceneId, { dialogue: scene.dialogue.filter((_, i) => i !== idx) });
  }

  function addCharacter() {
    if (!charInput.name.trim()) return;
    updateContent({
      characters: [...content.characters, { name: charInput.name.trim(), profile: charInput.profile.trim() }],
    });
    setCharInput({ name: "", profile: "" });
  }

  function removeCharacter(idx: number) {
    updateContent({ characters: content.characters.filter((_, i) => i !== idx) });
  }

  function handleUploadJson(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (evt) => {
      try {
        const parsed = JSON.parse(evt.target?.result as string);
        const normalized = normalizeScriptContent(parsed);
        const nextContent = normalized.scenes.length > 0 || normalized.characters.length > 0 || normalized.logline || normalized.premise
          ? normalized
          : emptyContent();
        setContent(nextContent);
        setExpandedScenes(new Set(nextContent.scenes.map((s: ScriptScene) => s.id)));
      } catch {
        // silently ignore invalid JSON
      }
    };
    reader.readAsText(file);
    e.target.value = "";
  }

  function handleSubmit() {
    const cleaned: ScriptContent = {
      logline: content.logline.trim(),
      premise: content.premise.trim(),
      characters: content.characters.filter((c) => c.name.trim()),
      scenes: content.scenes.map((s) => ({
        ...s,
        heading: s.heading.trim(),
        synopsis: s.synopsis.trim(),
        dialogue: s.dialogue.filter((d) => d.speaker.trim() || d.line.trim()),
      })),
    };
    onSave(title.trim() || t("scriptEditor.titleManual"), cleaned);
  }

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
          <button className="btn btn-ghost btn-sm" type="button" onClick={onCancel}>{t("scriptEditor.cancel")}</button>
          <button className="btn btn-primary btn-sm" type="button" onClick={handleSubmit} disabled={isSaving}>
            {isSaving ? t("scriptEditor.saving") : t("scriptEditor.saveAsNewVersion")}
          </button>
        </div>
      </div>

      {/* Version title */}
      <div className="se-field">
        <label className="se-label">{t("scriptEditor.versionTitle")}</label>
        <input className="input se-input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder={t("scriptEditor.versionTitlePlaceholder")} />
      </div>

      {/* Logline & Premise */}
      <div className="se-grid-2">
        <div className="se-field">
          <label className="se-label">{t("scriptEditor.logline")}</label>
          <textarea className="input se-textarea" rows={2} value={content.logline} onChange={(e) => updateContent({ logline: e.target.value })} placeholder={t("scriptEditor.loglinePlaceholder")} />
        </div>
        <div className="se-field">
          <label className="se-label">{t("scriptEditor.premise")}</label>
          <textarea className="input se-textarea" rows={2} value={content.premise} onChange={(e) => updateContent({ premise: e.target.value })} placeholder={t("scriptEditor.premisePlaceholder")} />
        </div>
      </div>

      {/* Characters */}
      <div className="se-section">
        <div className="se-section__head">
          <span className="se-section__title">{t("scriptEditor.characters")} ({content.characters.length})</span>
        </div>
        {content.characters.length > 0 && (
          <div className="se-char-list">
            {content.characters.map((c, i) => (
              <div key={i} className="se-char-row">
                <strong>{c.name}</strong>
                <span className="muted">{c.profile}</span>
                <button className="se-remove-btn" type="button" onClick={() => removeCharacter(i)} aria-label={t("scriptEditor.deleteLabel")}>x</button>
              </div>
            ))}
          </div>
        )}
        <div className="se-add-row">
          <input className="input se-input-sm" placeholder={t("scriptEditor.characterName")} value={charInput.name} onChange={(e) => setCharInput((p) => ({ ...p, name: e.target.value }))} style={{ flex: 1 }} />
          <input className="input se-input-sm" placeholder={t("scriptEditor.characterProfile")} value={charInput.profile} onChange={(e) => setCharInput((p) => ({ ...p, profile: e.target.value }))} style={{ flex: 2 }} />
          <button className="btn btn-secondary btn-sm" type="button" onClick={addCharacter} disabled={!charInput.name.trim()}>{t("scriptEditor.addCharacter")}</button>
        </div>
      </div>

      {/* Scenes */}
      <div className="se-section">
        <div className="se-section__head">
          <span className="se-section__title">{t("scriptEditor.scenes")} ({content.scenes.length})</span>
          <button className="se-inline-action" type="button" onClick={addScene}>{t("scriptEditor.addScene")}</button>
        </div>

        <div className="se-scene-list">
          {content.scenes.map((scene, si) => {
            const isExpanded = expandedScenes.has(scene.id);
            return (
              <div key={scene.id} className="se-scene">
                <div className="se-scene__header" onClick={() => toggleScene(scene.id)}>
                  <div className="se-scene__header-left">
                    <span className="se-scene__number">{t("scriptEditor.sceneNumber", { index: si + 1 })}</span>
                    <span className="se-scene__heading-preview">{scene.heading || t("scriptEditor.unnamed")}</span>
                  </div>
                  <div className="se-scene__header-right">
                    <button className="se-icon-btn" type="button" onClick={(e) => { e.stopPropagation(); moveScene(scene.id, -1); }} disabled={si === 0} aria-label={t("scriptEditor.moveUp")}>Up</button>
                    <button className="se-icon-btn" type="button" onClick={(e) => { e.stopPropagation(); moveScene(scene.id, 1); }} disabled={si === content.scenes.length - 1} aria-label={t("scriptEditor.moveDown")}>Down</button>
                    <button className="se-icon-btn se-icon-btn--danger" type="button" onClick={(e) => { e.stopPropagation(); removeScene(scene.id); }} aria-label={t("scriptEditor.deleteLabel")}>x</button>
                    <span className="se-chevron">{isExpanded ? "v" : ">"}</span>
                  </div>
                </div>

                {isExpanded && (
                  <div className="se-scene__body">
                    <div className="se-grid-2">
                      <div className="se-field">
                        <label className="se-label">{t("scriptEditor.sceneTitle")}</label>
                        <input className="input se-input" value={scene.heading} onChange={(e) => updateScene(scene.id, { heading: e.target.value })} placeholder={t("scriptEditor.sceneTitlePlaceholder")} />
                      </div>
                      <div className="se-field">
                        <label className="se-label">{t("scriptEditor.sceneCharacters")}</label>
                        <input className="input se-input" value={scene.characters.join(", ")} onChange={(e) => updateScene(scene.id, { characters: e.target.value.split(",").map((s) => s.trim()).filter(Boolean) })} placeholder={t("scriptEditor.sceneCharactersPlaceholder")} />
                      </div>
                    </div>
                    <div className="se-field">
                      <label className="se-label">{t("scriptEditor.sceneSynopsis")}</label>
                      <textarea className="input se-textarea" rows={2} value={scene.synopsis} onChange={(e) => updateScene(scene.id, { synopsis: e.target.value })} placeholder={t("scriptEditor.sceneSynopsisPlaceholder")} />
                    </div>
                    <div className="se-field">
                      <label className="se-label">{t("scriptEditor.directorNote")}</label>
                      <input className="input se-input" value={scene.directorNote ?? ""} onChange={(e) => updateScene(scene.id, { directorNote: e.target.value })} placeholder={t("scriptEditor.directorNotePlaceholder")} />
                    </div>

                    {/* Dialogue */}
                    <div className="se-dialogue-section">
                      <div className="se-section__head">
                        <span className="se-label">{t("scriptEditor.dialogue")} ({scene.dialogue.length})</span>
                        <button className="se-inline-action" type="button" onClick={() => addDialogue(scene.id)}>{t("scriptEditor.addDialogue")}</button>
                      </div>
                      {scene.dialogue.map((d, di) => (
                        <div key={di} className="se-dialogue-row">
                          <input className="input se-input-sm" style={{ width: 100, flexShrink: 0 }} value={d.speaker} onChange={(e) => updateDialogue(scene.id, di, "speaker", e.target.value)} placeholder={t("scriptEditor.speakerPlaceholder")} />
                          <input className="input se-input-sm" style={{ flex: 1 }} value={d.line} onChange={(e) => updateDialogue(scene.id, di, "line", e.target.value)} placeholder={t("scriptEditor.linePlaceholder")} />
                          <button className="se-remove-btn" type="button" onClick={() => removeDialogue(scene.id, di)} aria-label={t("scriptEditor.deleteLabel")}>x</button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
