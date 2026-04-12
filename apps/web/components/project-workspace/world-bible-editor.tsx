/**
 * @fileoverview 世界观设定编辑器
 * @module web/components/project-workspace
 *
 * 角色、场景、风格指南等世界观要素的编辑管理。
 */

"use client";

import { useCallback, useState } from "react";
import {
  normalizeWorldBibleContent,
  type CharacterProfile,
  type CharacterVoiceConfig,
  type LocationProfile,
  type StyleGuideProfile,
  type WorldBibleContent,
} from "@dramaflow/shared";
import { useI18n } from "../../lib/i18n";
import { TagInput } from "./tiptap/node-views/shared/tag-input";
import { ReferenceImageUploader } from "./tiptap/node-views/shared/reference-image-uploader";
import { WorldBibleReferenceImageDialog } from "./world-bible-reference-image-dialog";

type WbTab = "characters" | "locations" | "styleGuide" | "voiceConfigs";

interface Props {
  initialContent?: WorldBibleContent | null;
  onSave: (title: string, content: WorldBibleContent) => void;
  onCancel: () => void;
  isSaving: boolean;
  projectId: string;
}

export function WorldBibleEditor({
  initialContent,
  onSave,
  onCancel,
  isSaving,
  projectId,
}: Props) {
  const { t } = useI18n();
  const normalized = initialContent
    ? normalizeWorldBibleContent(initialContent)
    : null;

  const [title, setTitle] = useState(
    normalized && normalized.characters.length > 0
      ? t("worldBible.titleFromExisting")
      : t("worldBible.titleManual"),
  );

  const [activeTab, setActiveTab] = useState<WbTab>("characters");
  const [content, setContent] = useState<WorldBibleContent>(
    normalized || { characters: [], locations: [], voiceConfigs: [] },
  );
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedVoiceIdx, setSelectedVoiceIdx] = useState<number | null>(null);

  // ── Character CRUD ──────────────────────────────────────────
  const addCharacter = () => {
    const id = `char-${Date.now()}`;
    const c: CharacterProfile = {
      id,
      name: `${t("worldBible.charEmpty")} ${content.characters.length + 1}`,
      appearance: "",
      tags: [],
      referenceImages: [],
      sortOrder: content.characters.length,
    };
    setContent((p) => ({ ...p, characters: [...p.characters, c] }));
    setSelectedId(id);
  };

  const updateCharacter = (id: string, u: Partial<CharacterProfile>) => {
    setContent((p) => ({
      ...p,
      characters: p.characters.map((c) => (c.id === id ? { ...c, ...u } : c)),
    }));
  };

  const deleteCharacter = (id: string) => {
    setContent((p) => ({
      ...p,
      characters: p.characters.filter((c) => c.id !== id),
    }));
    if (selectedId === id) setSelectedId(null);
  };

  // ── Location CRUD ───────────────────────────────────────────
  const addLocation = () => {
    const id = `loc-${Date.now()}`;
    const l: LocationProfile = {
      id,
      name: `${t("worldBible.locEmpty")} ${content.locations.length + 1}`,
      description: "",
      referenceImages: [],
      sortOrder: content.locations.length,
    };
    setContent((p) => ({ ...p, locations: [...p.locations, l] }));
    setSelectedId(id);
  };

  const updateLocation = (id: string, u: Partial<LocationProfile>) => {
    setContent((p) => ({
      ...p,
      locations: p.locations.map((l) => (l.id === id ? { ...l, ...u } : l)),
    }));
  };

  const deleteLocation = (id: string) => {
    setContent((p) => ({
      ...p,
      locations: p.locations.filter((l) => l.id !== id),
    }));
    if (selectedId === id) setSelectedId(null);
  };

  // ── Style Guide ─────────────────────────────────────────────
  const updateStyleGuide = (u: Partial<StyleGuideProfile>) => {
    setContent((p) => ({
      ...p,
      styleGuide: {
        ...(p.styleGuide || { visualStyle: "", referenceImages: [] }),
        ...u,
      },
    }));
  };

  // ── Voice Config CRUD ───────────────────────────────────────
  const addVoice = () => {
    const v: CharacterVoiceConfig = {
      characterId: "",
      ttsProvider: "default",
      voiceId: "",
      voiceName: "",
    };
    setContent((prev) => ({
      ...prev,
      voiceConfigs: [...(prev.voiceConfigs || []), v],
    }));
    setSelectedVoiceIdx((content.voiceConfigs || []).length);
  };

  const updateVoice = (idx: number, u: Partial<CharacterVoiceConfig>) => {
    setContent((p) => ({
      ...p,
      voiceConfigs: (p.voiceConfigs || []).map((v, i) =>
        i === idx ? { ...v, ...u } : v,
      ),
    }));
  };

  const deleteVoice = (idx: number) => {
    setContent((p) => ({
      ...p,
      voiceConfigs: (p.voiceConfigs || []).filter((_, i) => i !== idx),
    }));
    if (selectedVoiceIdx === idx) setSelectedVoiceIdx(null);
    else if (selectedVoiceIdx !== null && selectedVoiceIdx > idx)
      setSelectedVoiceIdx(selectedVoiceIdx - 1);
  };

  // ── Save ────────────────────────────────────────────────────
  const handleSubmit = useCallback(() => {
    onSave(title.trim() || t("worldBible.titleManual"), content);
  }, [content, title, onSave, t]);

  // ── Derived ─────────────────────────────────────────────────
  const selectedChar =
    activeTab === "characters"
      ? content.characters.find((c) => c.id === selectedId)
      : null;
  const selectedLoc =
    activeTab === "locations"
      ? content.locations.find((l) => l.id === selectedId)
      : null;
  const selectedVoice =
    activeTab === "voiceConfigs" && selectedVoiceIdx !== null
      ? (content.voiceConfigs || [])[selectedVoiceIdx]
      : null;
  const getCharName = (charId: string) =>
    content.characters.find((c) => c.id === charId)?.name || charId;

  const hasSelection = !!(selectedChar || selectedLoc || selectedVoice);

  // ── Time-of-day options ─────────────────────────────────────
  const todOptions = ["", "白天", "黄昏", "夜晚", "清晨"];

  return (
    <div className="se-root">
      {/* Header */}
      <div className="se-header">
        <div className="se-header__left">
          <h2 className="se-header__title">{t("worldBible.editorTitle")}</h2>
        </div>
        <div className="se-header__right">
          <button
            className="btn btn-ghost btn-sm"
            type="button"
            onClick={onCancel}
          >
            {t("scriptEditor.cancel")}
          </button>
          <button
            className="btn btn-primary btn-sm"
            type="button"
            onClick={handleSubmit}
            disabled={isSaving}
          >
            {isSaving
              ? t("scriptEditor.saving")
              : t("scriptEditor.saveAsNewVersion")}
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
          placeholder={t("worldBible.versionTitlePlaceholder")}
        />
      </div>

      {/* Tabs */}
      <div className="wb-tabs">
        <button
          className={`wb-tab${activeTab === "characters" ? " wb-tab--active" : ""}`}
          onClick={() => {
            setActiveTab("characters");
            setSelectedId(null);
          }}
        >
          {t("worldBible.tabCharacters")}
          {content.characters.length > 0 && (
            <span className="wb-tab__badge">{content.characters.length}</span>
          )}
        </button>
        <button
          className={`wb-tab${activeTab === "locations" ? " wb-tab--active" : ""}`}
          onClick={() => {
            setActiveTab("locations");
            setSelectedId(null);
          }}
        >
          {t("worldBible.tabLocations")}
          {content.locations.length > 0 && (
            <span className="wb-tab__badge">{content.locations.length}</span>
          )}
        </button>
        <button
          className={`wb-tab${activeTab === "styleGuide" ? " wb-tab--active" : ""}`}
          onClick={() => setActiveTab("styleGuide")}
        >
          {t("worldBible.tabStyle")}
        </button>
        <button
          className={`wb-tab${activeTab === "voiceConfigs" ? " wb-tab--active" : ""}`}
          onClick={() => {
            setActiveTab("voiceConfigs");
            setSelectedVoiceIdx(null);
          }}
        >
          {t("worldBible.addVoiceConfig")}
          {(content.voiceConfigs || []).length > 0 && (
            <span className="wb-tab__badge">
              {content.voiceConfigs!.length}
            </span>
          )}
        </button>
      </div>

      {/* Content area */}
      {activeTab === "styleGuide" ? (
        <div className="wb-style-full">
          <StyleGuideForm
            styleGuide={content.styleGuide}
            onUpdate={updateStyleGuide}
            t={t}
            projectId={projectId}
          />
        </div>
      ) : (
        <div className="wb-split">
          {/* ── Left: Card list ────────────────────── */}
          <div className="wb-list">
            {activeTab === "characters" && (
              <>
                <button className="wb-add-btn" onClick={addCharacter}>
                  + {t("worldBible.addCharacter")}
                </button>
                {content.characters.map((char) => (
                  <div
                    key={char.id}
                    className={`wb-card${selectedId === char.id ? " wb-card--selected" : ""}`}
                    onClick={() => setSelectedId(char.id)}
                  >
                    <div className="wb-card__icon wb-card__icon--char">
                      <CharIcon />
                    </div>
                    <div className="wb-card__body">
                      <div className="wb-card__name">{char.name}</div>
                      {char.tags.length > 0 && (
                        <div className="wb-card__sub">
                          {char.tags.slice(0, 3).join(", ")}
                          {char.tags.length > 3
                            ? ` +${char.tags.length - 3}`
                            : ""}
                        </div>
                      )}
                    </div>
                    <button
                      className="wb-card__delete"
                      onClick={(e) => {
                        e.stopPropagation();
                        deleteCharacter(char.id);
                      }}
                    >
                      ×
                    </button>
                  </div>
                ))}
                {content.characters.length === 0 && (
                  <div className="wb-list__empty">
                    <p>{t("worldBible.emptyCharacters")}</p>
                    <p className="wb-list__hint">
                      {t("worldBible.emptyCharactersHint")}
                    </p>
                  </div>
                )}
              </>
            )}

            {activeTab === "locations" && (
              <>
                <button className="wb-add-btn" onClick={addLocation}>
                  + {t("worldBible.addLocation")}
                </button>
                {content.locations.map((loc) => (
                  <div
                    key={loc.id}
                    className={`wb-card${selectedId === loc.id ? " wb-card--selected" : ""}`}
                    onClick={() => setSelectedId(loc.id)}
                  >
                    <div className="wb-card__icon wb-card__icon--loc">
                      <LocIcon />
                    </div>
                    <div className="wb-card__body">
                      <div className="wb-card__name">{loc.name}</div>
                      {loc.description && (
                        <div className="wb-card__sub">
                          {loc.description.length > 20
                            ? `${loc.description.slice(0, 20)}…`
                            : loc.description}
                        </div>
                      )}
                    </div>
                    <button
                      className="wb-card__delete"
                      onClick={(e) => {
                        e.stopPropagation();
                        deleteLocation(loc.id);
                      }}
                    >
                      ×
                    </button>
                  </div>
                ))}
                {content.locations.length === 0 && (
                  <div className="wb-list__empty">
                    <p>{t("worldBible.emptyLocations")}</p>
                    <p className="wb-list__hint">
                      {t("worldBible.emptyLocationsHint")}
                    </p>
                  </div>
                )}
              </>
            )}

            {activeTab === "voiceConfigs" && (
              <>
                <button className="wb-add-btn" onClick={addVoice}>
                  + {t("worldBible.addVoiceConfig")}
                </button>
                {(content.voiceConfigs || []).map((vc, idx) => (
                  <div
                    key={`vc-${idx}`}
                    className={`wb-card${selectedVoiceIdx === idx ? " wb-card--selected" : ""}`}
                    onClick={() => setSelectedVoiceIdx(idx)}
                  >
                    <div className="wb-card__icon wb-card__icon--voice">
                      <VoiceIcon />
                    </div>
                    <div className="wb-card__body">
                      <div className="wb-card__name">
                        {vc.characterId
                          ? getCharName(vc.characterId)
                          : t("worldBible.charEmpty")}
                      </div>
                      {vc.voiceName && (
                        <div className="wb-card__sub">{vc.voiceName}</div>
                      )}
                    </div>
                    <button
                      className="wb-card__delete"
                      onClick={(e) => {
                        e.stopPropagation();
                        deleteVoice(idx);
                      }}
                    >
                      ×
                    </button>
                  </div>
                ))}
                {(content.voiceConfigs || []).length === 0 &&
                  content.characters.length === 0 && (
                    <div className="wb-list__empty">
                      <p>{t("worldBible.emptyCharacters")}</p>
                    </div>
                  )}
              </>
            )}
          </div>

          {/* ── Right: Detail form ────────────────── */}
          <div className="wb-detail">
            {activeTab === "characters" && selectedChar && (
              <CharacterForm
                character={selectedChar}
                onUpdate={updateCharacter}
                t={t}
                projectId={projectId}
              />
            )}
            {activeTab === "locations" && selectedLoc && (
              <LocationForm
                location={selectedLoc}
                onUpdate={updateLocation}
                t={t}
                projectId={projectId}
              />
            )}
            {activeTab === "voiceConfigs" && selectedVoice &&
              selectedVoiceIdx !== null && (
                <VoiceConfigForm
                  config={selectedVoice}
                  characters={content.characters}
                  onUpdate={(u) => updateVoice(selectedVoiceIdx, u)}
                  t={t}
                />
              )}
            {!hasSelection && (
              <div className="wb-detail__empty">
                <p>{t("worldBible.editorPlaceholder")}</p>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════
   Sub-components: Icons
   ═══════════════════════════════════════════════════════════════ */

function CharIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      aria-hidden="true"
    >
      <circle cx="8" cy="5.5" r="3" stroke="currentColor" strokeWidth="1.3" />
      <path
        d="M2.5 14c0-3 2.5-5 5.5-5s5.5 2 5.5 5"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
      />
    </svg>
  );
}

function LocIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      aria-hidden="true"
    >
      <path
        d="M8 1.5a4.5 4.5 0 014.5 4.5c0 3.5-4.5 8.5-4.5 8.5S3.5 9.5 3.5 6A4.5 4.5 0 018 1.5z"
        stroke="currentColor"
        strokeWidth="1.3"
      />
      <circle
        cx="8"
        cy="6"
        r="1.5"
        stroke="currentColor"
        strokeWidth="1"
      />
    </svg>
  );
}

function VoiceIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      aria-hidden="true"
    >
      <path
        d="M3 6v4M6 4v8M9 3v10M12 5v6"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
      />
    </svg>
  );
}

/* ═══════════════════════════════════════════════════════════════
   Sub-components: Forms
   ═══════════════════════════════════════════════════════════════ */

type TFn = ReturnType<typeof useI18n>["t"];

function buildWorldBibleReferencePrompt(parts: Array<string | undefined>) {
  return parts
    .map((part) => part?.trim())
    .filter((part): part is string => Boolean(part))
    .join("\n");
}

function buildCharacterReferencePrompt(character: CharacterProfile) {
  return buildWorldBibleReferencePrompt([
    character.appearance,
  ]);
}

function buildLocationReferencePrompt(location: LocationProfile) {
  return buildWorldBibleReferencePrompt([
    location.name,
    location.description,
    location.lighting,
    location.timeOfDay,
  ]);
}

function buildStyleGuideReferencePrompt(styleGuide?: StyleGuideProfile) {
  return buildWorldBibleReferencePrompt([
    styleGuide?.visualStyle,
    styleGuide?.colorPalette,
    styleGuide?.compositionNote,
  ]);
}

function CharacterForm({
  character: char,
  onUpdate,
  t,
  projectId,
}: {
  character: CharacterProfile;
  onUpdate: (id: string, u: Partial<CharacterProfile>) => void;
  t: TFn;
  projectId: string;
}) {
  const [costumeKey, setCostumeKey] = useState("");
  const [costumeVal, setCostumeVal] = useState("");
  const [showImageGen, setShowImageGen] = useState(false);

  const addCostume = () => {
    if (!costumeKey.trim()) return;
    onUpdate(char.id, {
      costumes: { ...char.costumes, [costumeKey.trim()]: costumeVal.trim() },
    });
    setCostumeKey("");
    setCostumeVal("");
  };

  const removeCostume = (key: string) => {
    const next = { ...char.costumes };
    delete next[key];
    onUpdate(char.id, { costumes: next });
  };

  return (
    <div className="wb-form">
      <div className="wb-form__header">
        <CharIcon />
        <span>{char.name}</span>
      </div>

      <label className="wb-form__label">{t("worldBible.nameLabel")}</label>
      <input
        className="input wb-form__input"
        value={char.name}
        onChange={(e) => onUpdate(char.id, { name: e.target.value })}
        placeholder={t("worldBible.namePlaceholder")}
      />

      <label className="wb-form__label">
        {t("worldBible.appearanceLabel")}
      </label>
      <textarea
        className="input wb-form__textarea"
        value={char.appearance}
        onChange={(e) => onUpdate(char.id, { appearance: e.target.value })}
        placeholder={t("worldBible.appearancePlaceholder")}
        rows={3}
      />

      <label className="wb-form__label">
        {t("worldBible.personalityLabel")}
      </label>
      <textarea
        className="input wb-form__textarea"
        value={char.personality || ""}
        onChange={(e) => onUpdate(char.id, { personality: e.target.value })}
        placeholder={t("worldBible.personalityPlaceholder")}
        rows={2}
      />

      <label className="wb-form__label">{t("worldBible.tagsLabel")}</label>
      <TagInput
        tags={char.tags}
        onChange={(tags) => onUpdate(char.id, { tags })}
        placeholder={t("worldBible.tagsPlaceholder")}
      />

      <label className="wb-form__label">
        {t("worldBible.costumesLabel")}
      </label>
      <div className="wb-costume-list">
        {Object.entries(char.costumes || {}).map(([k, v]) => (
          <div key={k} className="wb-costume-row">
            <span className="wb-costume-key">{k}</span>
            <span className="wb-costume-val">{v}</span>
            <button
              className="wb-costume-remove"
              onClick={() => removeCostume(k)}
            >
              ×
            </button>
          </div>
        ))}
        <div className="wb-costume-add">
          <input
            className="input wb-form__input wb-form__input--sm"
            value={costumeKey}
            onChange={(e) => setCostumeKey(e.target.value)}
            placeholder={t("worldBible.costumesPlaceholder").split("=")[0]}
          />
          <span className="wb-costume-eq">=</span>
          <input
            className="input wb-form__input wb-form__input--sm"
            value={costumeVal}
            onChange={(e) => setCostumeVal(e.target.value)}
            placeholder="服装描述"
            onKeyDown={(e) => e.key === "Enter" && addCostume()}
          />
          <button className="wb-costume-add-btn" onClick={addCostume}>
            +
          </button>
        </div>
      </div>

      <label className="wb-form__label">
        {t("worldBible.referenceImagesLabel")}
      </label>
      <div style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
        <div style={{ flex: 1 }}>
          <ReferenceImageUploader
            images={char.referenceImages}
            onChange={(imgs) => onUpdate(char.id, { referenceImages: imgs })}
            projectId={projectId}
          />
        </div>
        <button
          className="btn btn-secondary"
          onClick={() => setShowImageGen(true)}
          title={t("worldBible.generateRefImageTitle")}
          style={{ whiteSpace: "nowrap", marginTop: 4 }}
        >
          ✦ {t("worldBible.generateRefImage")}
        </button>
      </div>

      {showImageGen && (
        <WorldBibleReferenceImageDialog
          generatePath={`/projects/${projectId}/world-bible/characters/${char.id}/generate-reference-image`}
          initialPrompt={buildCharacterReferencePrompt(char)}
          onImageGenerated={(assetUrl) => {
            onUpdate(char.id, {
              referenceImages: [...char.referenceImages, assetUrl],
            });
          }}
          onClose={() => setShowImageGen(false)}
        />
      )}
    </div>
  );
}

function LocationForm({
  location: loc,
  onUpdate,
  t,
  projectId,
}: {
  location: LocationProfile;
  onUpdate: (id: string, u: Partial<LocationProfile>) => void;
  t: TFn;
  projectId: string;
}) {
  const [showImageGen, setShowImageGen] = useState(false);

  const todOptions = ["", "白天", "黄昏", "夜晚", "清晨"];

  return (
    <div className="wb-form">
      <div className="wb-form__header">
        <LocIcon />
        <span>{loc.name}</span>
      </div>

      <label className="wb-form__label">{t("worldBible.nameLabel")}</label>
      <input
        className="input wb-form__input"
        value={loc.name}
        onChange={(e) => onUpdate(loc.id, { name: e.target.value })}
        placeholder={t("worldBible.locationNamePlaceholder")}
      />

      <label className="wb-form__label">
        {t("worldBible.locationDescLabel")}
      </label>
      <textarea
        className="input wb-form__textarea"
        value={loc.description}
        onChange={(e) => onUpdate(loc.id, { description: e.target.value })}
        placeholder={t("worldBible.locationDescPlaceholder")}
        rows={3}
      />

      <label className="wb-form__label">
        {t("worldBible.lightingLabel")}
      </label>
      <input
        className="input wb-form__input"
        value={loc.lighting || ""}
        onChange={(e) => onUpdate(loc.id, { lighting: e.target.value })}
        placeholder={t("worldBible.lightingPlaceholder")}
      />

      <label className="wb-form__label">
        {t("worldBible.timeOfDayLabel")}
      </label>
      <select
        className="input wb-form__select"
        value={loc.timeOfDay || ""}
        onChange={(e) => onUpdate(loc.id, { timeOfDay: e.target.value })}
      >
        {todOptions.map((opt) => (
          <option key={opt} value={opt}>
            {opt || t("worldBible.timeOfDayPlaceholder")}
          </option>
        ))}
      </select>

      <label className="wb-form__label">
        {t("worldBible.referenceImagesLabel")}
      </label>
      <div style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
        <div style={{ flex: 1 }}>
          <ReferenceImageUploader
            images={loc.referenceImages}
            onChange={(imgs) => onUpdate(loc.id, { referenceImages: imgs })}
            projectId={projectId}
          />
        </div>
        <button
          className="btn btn-secondary"
          onClick={() => setShowImageGen(true)}
          title={t("worldBible.generateRefImageTitle")}
          style={{ whiteSpace: "nowrap", marginTop: 4 }}
        >
          ✦ {t("worldBible.generateRefImage")}
        </button>
      </div>

      {showImageGen && (
        <WorldBibleReferenceImageDialog
          generatePath={`/projects/${projectId}/world-bible/locations/${loc.id}/generate-reference-image`}
          initialPrompt={buildLocationReferencePrompt(loc)}
          onImageGenerated={(assetUrl) => {
            onUpdate(loc.id, {
              referenceImages: [...loc.referenceImages, assetUrl],
            });
          }}
          onClose={() => setShowImageGen(false)}
        />
      )}
    </div>
  );
}

function StyleGuideForm({
  styleGuide,
  onUpdate,
  t,
  projectId,
}: {
  styleGuide: StyleGuideProfile | undefined;
  onUpdate: (u: Partial<StyleGuideProfile>) => void;
  t: TFn;
  projectId: string;
}) {
  const sg = styleGuide || { visualStyle: "", referenceImages: [] };
  const [showImageGen, setShowImageGen] = useState(false);

  return (
    <div className="wb-form">
      <div className="wb-form__header">
        <span className="wb-form__title">{t("worldBible.styleLabel")}</span>
      </div>
      <p className="wb-form__desc">{t("worldBible.emptyStyleHint")}</p>

      <label className="wb-form__label">
        {t("worldBible.visualStyleLabel")}
      </label>
      <textarea
        className="input wb-form__textarea"
        value={sg.visualStyle}
        onChange={(e) => onUpdate({ visualStyle: e.target.value })}
        placeholder={t("worldBible.visualStylePlaceholder")}
        rows={3}
      />

      <label className="wb-form__label">
        {t("worldBible.colorPaletteLabel")}
      </label>
      <input
        className="input wb-form__input"
        value={sg.colorPalette || ""}
        onChange={(e) => onUpdate({ colorPalette: e.target.value })}
        placeholder={t("worldBible.colorPalettePlaceholder")}
      />

      <label className="wb-form__label">
        {t("worldBible.compositionNoteLabel")}
      </label>
      <textarea
        className="input wb-form__textarea"
        value={sg.compositionNote || ""}
        onChange={(e) => onUpdate({ compositionNote: e.target.value })}
        placeholder={t("worldBible.compositionNotePlaceholder")}
        rows={2}
      />

      <label className="wb-form__label">
        {t("worldBible.negativePromptLabel")}
      </label>
      <textarea
        className="input wb-form__textarea"
        value={sg.negativePrompt || ""}
        onChange={(e) => onUpdate({ negativePrompt: e.target.value })}
        placeholder={t("worldBible.negativePromptPlaceholder")}
        rows={2}
      />

      <label className="wb-form__label">
        {t("worldBible.referenceImagesLabel")}
      </label>
      <div style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
        <div style={{ flex: 1 }}>
          <ReferenceImageUploader
            images={sg.referenceImages || []}
            onChange={(imgs) => onUpdate({ referenceImages: imgs })}
            projectId={projectId}
          />
        </div>
        <button
          className="btn btn-secondary"
          onClick={() => setShowImageGen(true)}
          title={t("worldBible.generateRefImageTitle")}
          style={{ whiteSpace: "nowrap", marginTop: 4 }}
        >
          ✦ {t("worldBible.generateRefImage")}
        </button>
      </div>

      {showImageGen && (
        <WorldBibleReferenceImageDialog
          generatePath={`/projects/${projectId}/world-bible/style-guide/generate-reference-image`}
          initialPrompt={buildStyleGuideReferencePrompt(styleGuide)}
          onImageGenerated={(assetUrl) => {
            onUpdate({
              referenceImages: [...(sg.referenceImages || []), assetUrl],
            });
          }}
          onClose={() => setShowImageGen(false)}
        />
      )}
    </div>
  );
}

function VoiceConfigForm({
  config,
  characters,
  onUpdate,
  t,
}: {
  config: CharacterVoiceConfig;
  characters: CharacterProfile[];
  onUpdate: (u: Partial<CharacterVoiceConfig>) => void;
  t: TFn;
}) {
  return (
    <div className="wb-form">
      <div className="wb-form__header">
        <VoiceIcon />
        <span>
          {config.characterId
            ? characters.find((c) => c.id === config.characterId)?.name ||
              config.characterId
            : t("worldBible.voiceEmpty")}
        </span>
      </div>

      <label className="wb-form__label">{t("worldBible.charLabel")}</label>
      <select
        className="input wb-form__select"
        value={config.characterId}
        onChange={(e) => onUpdate({ characterId: e.target.value })}
      >
        <option value="">{t("worldBible.charEmpty")}</option>
        {characters.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
          </option>
        ))}
      </select>

      <label className="wb-form__label">TTS Provider</label>
      <input
        className="input wb-form__input"
        value={config.ttsProvider}
        onChange={(e) => onUpdate({ ttsProvider: e.target.value })}
        placeholder="default"
      />

      <label className="wb-form__label">Voice ID</label>
      <input
        className="input wb-form__input"
        value={config.voiceId}
        onChange={(e) => onUpdate({ voiceId: e.target.value })}
      />

      <label className="wb-form__label">Voice Name</label>
      <input
        className="input wb-form__input"
        value={config.voiceName}
        onChange={(e) => onUpdate({ voiceName: e.target.value })}
      />

      <label className="wb-form__label">{t("worldBible.speedLabel")}</label>
      <div className="wb-slider-row">
        <input
          type="range"
          min="0.5"
          max="2"
          step="0.1"
          value={config.settings?.speed ?? 1}
          onChange={(e) =>
            onUpdate({
              settings: { ...config.settings, speed: Number(e.target.value) },
            })
          }
          className="wb-slider"
        />
        <span className="wb-slider-val">
          {config.settings?.speed ?? 1}
        </span>
      </div>

      <label className="wb-form__label">Emotion</label>
      <input
        className="input wb-form__input"
        value={config.settings?.emotion || ""}
        onChange={(e) =>
          onUpdate({
            settings: { ...config.settings, emotion: e.target.value },
          })
        }
      />

      <label className="wb-form__label">Volume</label>
      <div className="wb-slider-row">
        <input
          type="range"
          min="0"
          max="100"
          step="1"
          value={config.settings?.volume ?? 100}
          onChange={(e) =>
            onUpdate({
              settings: { ...config.settings, volume: Number(e.target.value) },
            })
          }
          className="wb-slider"
        />
        <span className="wb-slider-val">
          {config.settings?.volume ?? 100}
        </span>
      </div>
    </div>
  );
}
