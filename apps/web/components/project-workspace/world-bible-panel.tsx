"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  normalizeWorldBibleContent,
  type CharacterProfile,
  type CharacterVoiceConfig,
  type LocationProfile,
  type StyleGuideProfile,
  type VoiceInfo,
  type WorldBibleContent,
} from "@dramaflow/shared";

import { useI18n } from "../../lib/i18n";
import { apiFetch, formatApiError } from "../../lib/api";
import { queryKeys } from "../../lib/query-keys";
import { InlineFeedback } from "../inline-feedback";

type WBTab = "characters" | "locations" | "style";

/* 闂佸啿鍘滈崑鎾绘煃閸忓浜鹃梺鍐插帨閸?inline icons 闂佸啿鍘滈崑鎾绘煃閸忓浜鹃梺鍐插帨閸?*/
function UserIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <circle cx="8" cy="5.5" r="3" stroke="currentColor" strokeWidth="1.3" />
      <path d="M2.5 14c0-3 2.5-5 5.5-5s5.5 2 5.5 5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
    </svg>
  );
}

function MapPinIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M8 1.5a4.5 4.5 0 014.5 4.5c0 3.5-4.5 8.5-4.5 8.5S3.5 9.5 3.5 6A4.5 4.5 0 018 1.5z" stroke="currentColor" strokeWidth="1.3" />
      <circle cx="8" cy="6" r="1.5" stroke="currentColor" strokeWidth="1" />
    </svg>
  );
}

function PaletteIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M8 1a7 7 0 100 14 3.5 3.5 0 010-7 3.5 3.5 0 000-7z" stroke="currentColor" strokeWidth="1.3" />
      <circle cx="5" cy="6" r="1" fill="currentColor" />
      <circle cx="8" cy="4.5" r="1" fill="currentColor" />
      <circle cx="11" cy="6" r="1" fill="currentColor" />
    </svg>
  );
}

function PlusIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
      <path d="M7 2v10M2 7h10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
      <path d="M3 4h8l-.7 8a1 1 0 01-1 .9H4.7a1 1 0 01-1-.9L3 4z" stroke="currentColor" strokeWidth="1.2" />
      <path d="M2.5 4h9M5.5 2h3" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
    </svg>
  );
}

function UploadIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
      <path d="M7 9V2.5M4.5 5L7 2.5 9.5 5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M2.5 9v2.5h9V9" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/* 闂佸啿鍘滈崑鎾绘煃閸忓浜鹃梺鍐插帨閸?Tag Input 闂佸啿鍘滈崑鎾绘煃閸忓浜鹃梺鍐插帨閸?*/
function TagInput({ tags, onChange, placeholder }: { tags: string[]; onChange: (tags: string[]) => void; placeholder: string }) {
  const [input, setInput] = useState("");

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter" && input.trim()) {
      e.preventDefault();
      if (!tags.includes(input.trim())) {
        onChange([...tags, input.trim()]);
      }
      setInput("");
    }
    if (e.key === "Backspace" && !input && tags.length) {
      onChange(tags.slice(0, -1));
    }
  }

  return (
    <div className="wb-tag-input">
      {tags.map((tag) => (
        <span key={tag} className="wb-tag">
          {tag}
          <button type="button" className="wb-tag-remove" onClick={() => onChange(tags.filter((t) => t !== tag))}>x</button>
        </span>
      ))}
      <input
        value={input}
        onChange={(e) => setInput(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder={tags.length === 0 ? placeholder : ""}
        className="wb-tag-input-field"
      />
    </div>
  );
}

/* 闂佸啿鍘滈崑鎾绘煃閸忓浜鹃梺鍐插帨閸?Reference Image Uploader 闂佸啿鍘滈崑鎾绘煃閸忓浜鹃梺鍐插帨閸?*/
function ReferenceImageUploader({
  images,
  onChange,
  projectId,
}: {
  images: string[];
  onChange: (images: string[]) => void;
  projectId: string;
}) {
  const { t } = useI18n();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  async function handleUpload(file: File) {
    setUploading(true);
    try {
      const targetRes = await apiFetch<{ asset: { id: string }; target: { publicUrl?: string; method: string; url: string; driver: string } }>(
        "/uploads",
        { method: "POST", body: { projectId, filename: file.name, contentType: file.type, sizeInBytes: file.size } },
      );

      if (targetRes.target.driver === "local") {
        const key = targetRes.target.url.replace(/.*\/uploads\/direct\//, "");
        const buffer = await file.arrayBuffer();
        const uploadRes = await fetch(`${process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000"}/uploads/direct/${encodeURIComponent(key)}`, {
          method: "PUT",
          headers: {
            "Content-Type": file.type,
            Authorization: `Bearer ${typeof window !== "undefined" ? JSON.parse(localStorage.getItem("session") || "{}").accessToken : ""}`,
          },
          body: buffer,
        });
        if (!uploadRes.ok) throw new Error("Upload failed");
        const result = await uploadRes.json();
        onChange([...images, result.publicUrl || targetRes.target.publicUrl || `/uploads/${key}`]);
      } else {
        await fetch(targetRes.target.url, { method: targetRes.target.method, body: file, headers: { "Content-Type": file.type } });
        onChange([...images, targetRes.target.publicUrl || ""]);
      }
    } catch {
      // Silently handle upload failure
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="wb-ref-images">
      {images.map((url, i) => (
        <div key={`${url}-${i}`} className="wb-ref-image-thumb">
          <img src={url} alt="" />
          <button
            type="button"
            className="wb-ref-image-remove"
            onClick={() => onChange(images.filter((_, idx) => idx !== i))}
          >x</button>
        </div>
      ))}
      <button
        type="button"
        className="wb-ref-image-add"
        onClick={() => fileInputRef.current?.click()}
        disabled={uploading}
      >
        {uploading ? "..." : <><UploadIcon /> {t("worldBible.uploadReferenceImage")}</>}
      </button>
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        style={{ display: "none" }}
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void handleUpload(file);
          e.target.value = "";
        }}
      />
    </div>
  );
}

/* 闂佸啿鍘滈崑鎾绘煃閸忓浜鹃梺鍐插帨閸?Character Edit Card 闂佸啿鍘滈崑鎾绘煃閸忓浜鹃梺鍐插帨閸?*/
function CharacterCard({
  character,
  projectId,
  voiceConfig,
  voices,
  isSavingVoice,
  onSave,
  onSaveVoice,
  onDelete,
}: {
  character: CharacterProfile;
  projectId: string;
  voiceConfig?: CharacterVoiceConfig;
  voices: VoiceInfo[];
  isSavingVoice: boolean;
  onSave: (id: string, data: Partial<CharacterProfile>) => void;
  onSaveVoice: (id: string, data: Omit<CharacterVoiceConfig, "characterId">) => void;
  onDelete: (id: string) => void;
}) {
  const { t } = useI18n();
  const [expanded, setExpanded] = useState(false);
  const [name, setName] = useState(character.name);
  const [appearance, setAppearance] = useState(character.appearance);
  const [personality, setPersonality] = useState(character.personality || "");
  const [tags, setTags] = useState(character.tags);
  const [referenceImages, setReferenceImages] = useState(character.referenceImages);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [voiceId, setVoiceId] = useState(voiceConfig?.voiceId ?? voices[0]?.id ?? "");
  const [voiceSpeed, setVoiceSpeed] = useState(String(voiceConfig?.settings?.speed ?? 1));

  useEffect(() => {
    setVoiceId(voiceConfig?.voiceId ?? voices[0]?.id ?? "");
    setVoiceSpeed(String(voiceConfig?.settings?.speed ?? 1));
  }, [voiceConfig?.settings?.speed, voiceConfig?.voiceId, voices]);

  const selectedVoice = useMemo(
    () => voices.find((voice) => voice.id === voiceId) ?? null,
    [voiceId, voices],
  );

  return (
    <div className={`wb-card${expanded ? " wb-card--expanded" : ""}`}>
      <button type="button" className="wb-card-header" onClick={() => setExpanded(!expanded)}>
        <span className="wb-card-avatar"><UserIcon /></span>
        <span className="wb-card-title">{character.name}</span>
        {tags.length > 0 && <span className="wb-card-badge">{tags[0]}</span>}
        <span className="wb-card-chevron">{expanded ? "Collapse" : "Expand"}</span>
      </button>

      {expanded && (
        <div className="wb-card-body">
          <label className="wb-field">
            <span>{t("worldBible.nameLabel")}</span>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder={t("worldBible.namePlaceholder")} />
          </label>

          <label className="wb-field">
            <span>{t("worldBible.appearanceLabel")}</span>
            <textarea rows={3} value={appearance} onChange={(e) => setAppearance(e.target.value)} placeholder={t("worldBible.appearancePlaceholder")} />
          </label>

          <label className="wb-field">
            <span>{t("worldBible.personalityLabel")}</span>
            <input value={personality} onChange={(e) => setPersonality(e.target.value)} placeholder={t("worldBible.personalityPlaceholder")} />
          </label>

          <div className="wb-field">
            <span>{t("worldBible.tagsLabel")}</span>
            <TagInput tags={tags} onChange={setTags} placeholder={t("worldBible.tagsPlaceholder")} />
          </div>

          <div className="wb-field">
            <span>{t("worldBible.referenceImagesLabel")}</span>
            <ReferenceImageUploader
              images={referenceImages}
              onChange={setReferenceImages}
              projectId={projectId}
            />
          </div>

          <div className="wb-field" style={{ gap: "var(--space-2)" }}>
            <span>Voice</span>
            <select value={voiceId} onChange={(event) => setVoiceId(event.target.value)} disabled={voices.length === 0}>
              {voices.length === 0 ? <option value="">No voices available</option> : null}
              {voices.map((voice) => (
                <option key={voice.id} value={voice.id}>{voice.name} ({voice.provider})</option>
              ))}
            </select>
            <label className="wb-field" style={{ marginBottom: 0 }}>
              <span>Speed</span>
              <input type="number" min="0.5" max="2" step="0.1" value={voiceSpeed} onChange={(event) => setVoiceSpeed(event.target.value)} />
            </label>
            {selectedVoice?.sampleUrl ? (
              <audio controls src={selectedVoice.sampleUrl} style={{ width: "100%" }} />
            ) : (
              <div className="muted text-sm">Sample preview is not available for this voice.</div>
            )}
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              disabled={isSavingVoice || !voiceId}
              onClick={() => onSaveVoice(character.id, {
                ttsProvider: selectedVoice?.provider ?? voiceConfig?.ttsProvider ?? "default",
                voiceId,
                voiceName: selectedVoice?.name ?? voiceConfig?.voiceName ?? voiceId,
                sampleUrl: selectedVoice?.sampleUrl,
                settings: {
                  speed: Number.isFinite(Number(voiceSpeed)) ? Number(voiceSpeed) : 1,
                },
              })}
            >
              {isSavingVoice ? t("common.submitting") : "Save voice"}
            </button>
          </div>

          <div className="wb-card-actions">
            <button
              type="button"
              className="btn btn-primary btn-sm"
              onClick={() => onSave(character.id, { name, appearance, personality: personality || undefined, tags, referenceImages })}
            >
              {t("worldBible.saveChanges")}
            </button>
            {confirmDelete ? (
              <button type="button" className="btn btn-danger btn-sm" onClick={() => onDelete(character.id)}>
                {t("worldBible.deleteConfirm")}
              </button>
            ) : (
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setConfirmDelete(true)}>
                <TrashIcon />
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function LocationCard({
  location,
  projectId,
  onSave,
  onDelete,
}: {
  location: LocationProfile;
  projectId: string;
  onSave: (id: string, data: Partial<LocationProfile>) => void;
  onDelete: (id: string) => void;
}) {
  const { t } = useI18n();
  const [expanded, setExpanded] = useState(false);
  const [name, setName] = useState(location.name);
  const [description, setDescription] = useState(location.description);
  const [lighting, setLighting] = useState(location.lighting || "");
  const [timeOfDay, setTimeOfDay] = useState(location.timeOfDay || "");
  const [referenceImages, setReferenceImages] = useState(location.referenceImages);
  const [confirmDelete, setConfirmDelete] = useState(false);

  return (
    <div className={`wb-card${expanded ? " wb-card--expanded" : ""}`}>
      <button type="button" className="wb-card-header" onClick={() => setExpanded(!expanded)}>
        <span className="wb-card-avatar"><MapPinIcon /></span>
        <span className="wb-card-title">{location.name}</span>
        {timeOfDay && <span className="wb-card-badge">{timeOfDay}</span>}
        <span className="wb-card-chevron">{expanded ? "Collapse" : "Expand"}</span>
      </button>

      {expanded && (
        <div className="wb-card-body">
          <label className="wb-field">
            <span>{t("worldBible.nameLabel")}</span>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder={t("worldBible.locationNamePlaceholder")} />
          </label>

          <label className="wb-field">
            <span>{t("worldBible.locationDescLabel")}</span>
            <textarea rows={3} value={description} onChange={(e) => setDescription(e.target.value)} placeholder={t("worldBible.locationDescPlaceholder")} />
          </label>

          <label className="wb-field">
            <span>{t("worldBible.lightingLabel")}</span>
            <input value={lighting} onChange={(e) => setLighting(e.target.value)} placeholder={t("worldBible.lightingPlaceholder")} />
          </label>

          <label className="wb-field">
            <span>{t("worldBible.timeOfDayLabel")}</span>
            <input value={timeOfDay} onChange={(e) => setTimeOfDay(e.target.value)} placeholder={t("worldBible.timeOfDayPlaceholder")} />
          </label>

          <div className="wb-field">
            <span>{t("worldBible.referenceImagesLabel")}</span>
            <ReferenceImageUploader
              images={referenceImages}
              onChange={setReferenceImages}
              projectId={projectId}
            />
          </div>

          <div className="wb-card-actions">
            <button
              type="button"
              className="btn btn-primary btn-sm"
              onClick={() => onSave(location.id, { name, description, lighting: lighting || undefined, timeOfDay: timeOfDay || undefined, referenceImages })}
            >
              {t("worldBible.saveChanges")}
            </button>
            {confirmDelete ? (
              <button type="button" className="btn btn-danger btn-sm" onClick={() => onDelete(location.id)}>
                {t("worldBible.deleteConfirm")}
              </button>
            ) : (
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setConfirmDelete(true)}>
                <TrashIcon />
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/* 闂佸啿鍘滈崑鎾绘煃閸忓浜鹃梺鍐插帨閸?Style Guide Form 闂佸啿鍘滈崑鎾绘煃閸忓浜鹃梺鍐插帨閸?*/
function StyleGuideForm({
  initial,
  projectId,
  onSave,
}: {
  initial?: StyleGuideProfile;
  projectId: string;
  onSave: (data: StyleGuideProfile) => void;
}) {
  const { t } = useI18n();
  const [visualStyle, setVisualStyle] = useState(initial?.visualStyle || "");
  const [colorPalette, setColorPalette] = useState(initial?.colorPalette || "");
  const [compositionNote, setCompositionNote] = useState(initial?.compositionNote || "");
  const [negativePrompt, setNegativePrompt] = useState(initial?.negativePrompt || "");
  const [referenceImages, setReferenceImages] = useState(initial?.referenceImages || []);

  useEffect(() => {
    if (initial) {
      setVisualStyle(initial.visualStyle || "");
      setColorPalette(initial.colorPalette || "");
      setCompositionNote(initial.compositionNote || "");
      setNegativePrompt(initial.negativePrompt || "");
      setReferenceImages(initial.referenceImages || []);
    }
  }, [initial]);

  return (
    <div className="wb-style-form">
      <label className="wb-field">
        <span>{t("worldBible.visualStyleLabel")}</span>
        <textarea rows={3} value={visualStyle} onChange={(e) => setVisualStyle(e.target.value)} placeholder={t("worldBible.visualStylePlaceholder")} />
      </label>

      <label className="wb-field">
        <span>{t("worldBible.colorPaletteLabel")}</span>
        <input value={colorPalette} onChange={(e) => setColorPalette(e.target.value)} placeholder={t("worldBible.colorPalettePlaceholder")} />
      </label>

      <label className="wb-field">
        <span>{t("worldBible.compositionNoteLabel")}</span>
        <input value={compositionNote} onChange={(e) => setCompositionNote(e.target.value)} placeholder={t("worldBible.compositionNotePlaceholder")} />
      </label>

      <label className="wb-field">
        <span>{t("worldBible.negativePromptLabel")}</span>
        <textarea rows={2} value={negativePrompt} onChange={(e) => setNegativePrompt(e.target.value)} placeholder={t("worldBible.negativePromptPlaceholder")} />
      </label>

      <div className="wb-field">
        <span>{t("worldBible.referenceImagesLabel")}</span>
        <ReferenceImageUploader
          images={referenceImages}
          onChange={setReferenceImages}
          projectId={projectId}
        />
      </div>

      <button
        type="button"
        className="btn btn-primary btn-sm"
        onClick={() => onSave({ visualStyle, colorPalette: colorPalette || undefined, compositionNote: compositionNote || undefined, negativePrompt: negativePrompt || undefined, referenceImages })}
        disabled={!visualStyle.trim()}
      >
        {t("worldBible.saveChanges")}
      </button>
    </div>
  );
}

/* 闂佸啿鍘滈崑鎾绘煃閸忓浜鹃梺鍐插帨閸?Main Panel 闂佸啿鍘滈崑鎾绘煃閸忓浜鹃梺鍐插帨閸?*/
export function WorldBiblePanel({
  projectId,
  worldBible,
}: {
  projectId: string;
  worldBible?: WorldBibleContent;
}) {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<WBTab>("characters");
  const [feedback, setFeedback] = useState<{ message: string | null; error: string | null }>({ message: null, error: null });
  const [showNewCharacter, setShowNewCharacter] = useState(false);
  const [showNewLocation, setShowNewLocation] = useState(false);

  const voicesQuery = useQuery<{ voices: VoiceInfo[] }>({
    queryKey: queryKeys.ttsVoices,
    queryFn: () => apiFetch("/tts/voices"),
  });

  // New character form
  const [newCharName, setNewCharName] = useState("");
  const [newCharAppearance, setNewCharAppearance] = useState("");

  // New location form
  const [newLocName, setNewLocName] = useState("");
  const [newLocDesc, setNewLocDesc] = useState("");

  const data = useMemo<WorldBibleContent>(
    () => normalizeWorldBibleContent(worldBible ?? { characters: [], locations: [] }),
    [worldBible],
  );

  const invalidate = useCallback(() => {
    void Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.project(projectId) }),
      queryClient.invalidateQueries({ queryKey: queryKeys.projectVersions(projectId) }),
    ]);
  }, [queryClient, projectId]);

  const addCharMutation = useMutation({
    mutationFn: (body: { name: string; appearance: string }) =>
      apiFetch(`/projects/${projectId}/world-bible/characters`, { method: "POST", body }),
    onSuccess: () => {
      setFeedback({ message: t("worldBible.saveSuccess"), error: null });
      setShowNewCharacter(false);
      setNewCharName("");
      setNewCharAppearance("");
      invalidate();
    },
    onError: (err) => setFeedback({ message: null, error: formatApiError(err, t, "worldBible.saveFailed") }),
  });

  const updateCharMutation = useMutation({
    mutationFn: ({ id, data: body }: { id: string; data: Partial<CharacterProfile> }) =>
      apiFetch(`/projects/${projectId}/world-bible/characters/${id}`, { method: "PATCH", body }),
    onSuccess: () => { setFeedback({ message: t("worldBible.saveSuccess"), error: null }); invalidate(); },
    onError: (err) => setFeedback({ message: null, error: formatApiError(err, t, "worldBible.saveFailed") }),
  });

  const updateVoiceMutation = useMutation({
    mutationFn: ({ id, data: body }: { id: string; data: Omit<CharacterVoiceConfig, "characterId"> }) =>
      apiFetch(`/projects/${projectId}/world-bible/characters/${id}/voice`, { method: "PATCH", body }),
    onSuccess: () => { setFeedback({ message: t("worldBible.saveSuccess"), error: null }); invalidate(); },
    onError: (err) => setFeedback({ message: null, error: formatApiError(err, t, "worldBible.saveFailed") }),
  });

  const deleteCharMutation = useMutation({
    mutationFn: (id: string) =>
      apiFetch(`/projects/${projectId}/world-bible/characters/${id}`, { method: "DELETE" }),
    onSuccess: () => { setFeedback({ message: t("worldBible.deleteSuccess"), error: null }); invalidate(); },
    onError: (err) => setFeedback({ message: null, error: formatApiError(err, t, "worldBible.deleteFailed") }),
  });

  const addLocMutation = useMutation({
    mutationFn: (body: { name: string; description: string }) =>
      apiFetch(`/projects/${projectId}/world-bible/locations`, { method: "POST", body }),
    onSuccess: () => {
      setFeedback({ message: t("worldBible.saveSuccess"), error: null });
      setShowNewLocation(false);
      setNewLocName("");
      setNewLocDesc("");
      invalidate();
    },
    onError: (err) => setFeedback({ message: null, error: formatApiError(err, t, "worldBible.saveFailed") }),
  });

  const updateLocMutation = useMutation({
    mutationFn: ({ id, data: body }: { id: string; data: Partial<LocationProfile> }) =>
      apiFetch(`/projects/${projectId}/world-bible/locations/${id}`, { method: "PATCH", body }),
    onSuccess: () => { setFeedback({ message: t("worldBible.saveSuccess"), error: null }); invalidate(); },
    onError: (err) => setFeedback({ message: null, error: formatApiError(err, t, "worldBible.saveFailed") }),
  });

  const deleteLocMutation = useMutation({
    mutationFn: (id: string) =>
      apiFetch(`/projects/${projectId}/world-bible/locations/${id}`, { method: "DELETE" }),
    onSuccess: () => { setFeedback({ message: t("worldBible.deleteSuccess"), error: null }); invalidate(); },
    onError: (err) => setFeedback({ message: null, error: formatApiError(err, t, "worldBible.deleteFailed") }),
  });

  const updateStyleMutation = useMutation({
    mutationFn: (body: StyleGuideProfile) =>
      apiFetch(`/projects/${projectId}/world-bible/style-guide`, { method: "PATCH", body }),
    onSuccess: () => { setFeedback({ message: t("worldBible.saveSuccess"), error: null }); invalidate(); },
    onError: (err) => setFeedback({ message: null, error: formatApiError(err, t, "worldBible.saveFailed") }),
  });

  const voices = voicesQuery.data?.voices ?? [];

  const tabs: { key: WBTab; label: string; icon: React.FC; count?: number }[] = [
    { key: "characters", label: t("worldBible.tabCharacters"), icon: UserIcon, count: data.characters.length },
    { key: "locations", label: t("worldBible.tabLocations"), icon: MapPinIcon, count: data.locations.length },
    { key: "style", label: t("worldBible.tabStyle"), icon: PaletteIcon },
  ];

  return (
    <div className="wb-panel animate-fade-in">
      <div className="wb-header">
        <h2 className="wb-title">{t("worldBible.title")}</h2>
        <p className="wb-description">{t("worldBible.description")}</p>
      </div>

      <InlineFeedback message={feedback.message} error={feedback.error} />

      <div className="wb-tabs">
        {tabs.map((item) => (
          <button
            key={item.key}
            type="button"
            className={`wb-tab${tab === item.key ? " wb-tab--active" : ""}`}
            onClick={() => setTab(item.key)}
          >
            <item.icon />
            {item.label}
            {item.count !== undefined && <span className="wb-tab-count">{item.count}</span>}
          </button>
        ))}
      </div>

      <div className="wb-content">
        {/* Characters */}
        {tab === "characters" && (
          <div className="wb-section">
            <div className="wb-section-toolbar">
              <button type="button" className="btn btn-primary btn-sm" onClick={() => setShowNewCharacter(true)}>
                <PlusIcon /> {t("worldBible.addCharacter")}
              </button>
            </div>

            {showNewCharacter && (
              <div className="wb-card wb-card--new wb-card--expanded">
                <div className="wb-card-body">
                  <label className="wb-field">
                    <span>{t("worldBible.nameLabel")}</span>
                    <input value={newCharName} onChange={(e) => setNewCharName(e.target.value)} placeholder={t("worldBible.namePlaceholder")} autoFocus />
                  </label>
                  <label className="wb-field">
                    <span>{t("worldBible.appearanceLabel")}</span>
                    <textarea rows={3} value={newCharAppearance} onChange={(e) => setNewCharAppearance(e.target.value)} placeholder={t("worldBible.appearancePlaceholder")} />
                  </label>
                  <div className="wb-card-actions">
                    <button
                      type="button"
                      className="btn btn-primary btn-sm"
                      disabled={!newCharName.trim() || !newCharAppearance.trim() || addCharMutation.isPending}
                      onClick={() => addCharMutation.mutate({ name: newCharName, appearance: newCharAppearance })}
                    >
                      {addCharMutation.isPending ? t("worldBible.saving") : t("worldBible.saveChanges")}
                    </button>
                    <button type="button" className="btn btn-ghost btn-sm" onClick={() => setShowNewCharacter(false)}>
                      {t("common.cancel")}
                    </button>
                  </div>
                </div>
              </div>
            )}

            {data.characters.length === 0 && !showNewCharacter && (
              <div className="wb-empty">
                <UserIcon />
                <p className="wb-empty-title">{t("worldBible.emptyCharacters")}</p>
                <p className="wb-empty-hint">{t("worldBible.emptyCharactersHint")}</p>
              </div>
            )}

            <div className="wb-card-list">
              {data.characters.map((char) => (
                <CharacterCard
                  key={char.id}
                  character={char}
                  projectId={projectId}
                  voiceConfig={data.voiceConfigs?.find((config) => config.characterId === char.id)}
                  voices={voices}
                  isSavingVoice={updateVoiceMutation.isPending}
                  onSave={(id, d) => updateCharMutation.mutate({ id, data: d })}
                  onSaveVoice={(id, d) => updateVoiceMutation.mutate({ id, data: d })}
                  onDelete={(id) => deleteCharMutation.mutate(id)}
                />
              ))}
            </div>
          </div>
        )}

        {/* Locations */}
        {tab === "locations" && (
          <div className="wb-section">
            <div className="wb-section-toolbar">
              <button type="button" className="btn btn-primary btn-sm" onClick={() => setShowNewLocation(true)}>
                <PlusIcon /> {t("worldBible.addLocation")}
              </button>
            </div>

            {showNewLocation && (
              <div className="wb-card wb-card--new wb-card--expanded">
                <div className="wb-card-body">
                  <label className="wb-field">
                    <span>{t("worldBible.nameLabel")}</span>
                    <input value={newLocName} onChange={(e) => setNewLocName(e.target.value)} placeholder={t("worldBible.locationNamePlaceholder")} autoFocus />
                  </label>
                  <label className="wb-field">
                    <span>{t("worldBible.locationDescLabel")}</span>
                    <textarea rows={3} value={newLocDesc} onChange={(e) => setNewLocDesc(e.target.value)} placeholder={t("worldBible.locationDescPlaceholder")} />
                  </label>
                  <div className="wb-card-actions">
                    <button
                      type="button"
                      className="btn btn-primary btn-sm"
                      disabled={!newLocName.trim() || !newLocDesc.trim() || addLocMutation.isPending}
                      onClick={() => addLocMutation.mutate({ name: newLocName, description: newLocDesc })}
                    >
                      {addLocMutation.isPending ? t("worldBible.saving") : t("worldBible.saveChanges")}
                    </button>
                    <button type="button" className="btn btn-ghost btn-sm" onClick={() => setShowNewLocation(false)}>
                      {t("common.cancel")}
                    </button>
                  </div>
                </div>
              </div>
            )}

            {data.locations.length === 0 && !showNewLocation && (
              <div className="wb-empty">
                <MapPinIcon />
                <p className="wb-empty-title">{t("worldBible.emptyLocations")}</p>
                <p className="wb-empty-hint">{t("worldBible.emptyLocationsHint")}</p>
              </div>
            )}

            <div className="wb-card-list">
              {data.locations.map((loc) => (
                <LocationCard
                  key={loc.id}
                  location={loc}
                  projectId={projectId}
                  onSave={(id, d) => updateLocMutation.mutate({ id, data: d })}
                  onDelete={(id) => deleteLocMutation.mutate(id)}
                />
              ))}
            </div>
          </div>
        )}

        {/* Style Guide */}
        {tab === "style" && (
          <div className="wb-section">
            {data.styleGuide ? (
              <StyleGuideForm
                initial={data.styleGuide}
                projectId={projectId}
                onSave={(guide) => updateStyleMutation.mutate(guide)}
              />
            ) : (
              <div className="wb-empty">
                <PaletteIcon />
                <p className="wb-empty-title">{t("worldBible.emptyStyle")}</p>
                <p className="wb-empty-hint">{t("worldBible.emptyStyleHint")}</p>
                <button
                  type="button"
                  className="btn btn-primary btn-sm"
                  style={{ marginTop: "var(--space-4)" }}
                  onClick={() => updateStyleMutation.mutate({ visualStyle: "", referenceImages: [] })}
                >
                  {t("worldBible.editStyleGuide")}
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
