/**
 * @fileoverview 镜头详情弹窗
 * @module web/components/project-workspace
 *
 * 居中双栏弹窗，左侧媒体生产区，右侧文字信息区。
 */

"use client";

import { useEffect, useCallback, useState } from "react";
import { createPortal } from "react-dom";
import type {
  ProjectWorkspacePayload,
  ProviderEntry,
  StoryboardShot,
} from "@dramaflow/shared";
import {
  STORYBOARD_CAMERA_MOVE_OPTIONS,
  STORYBOARD_FRAMING_OPTIONS,
  getStoryboardCameraMoveLabel,
  getStoryboardFramingLabel,
} from "@dramaflow/shared";

import { getJobStatusLabel, useI18n } from "../../lib/i18n";
import { useDebouncedField } from "../../lib/hooks";
import { apiFetch } from "../../lib/api";
import { ProviderSelector } from "./provider-selector";
import { CandidateThumbnailGrid } from "./candidate-thumbnail-grid";
import { CandidateLightbox } from "./candidate-lightbox";

interface MediaVersionContent {
  assetId?: string;
  assetUrl?: string;
  mimeType?: string;
  model?: string;
  duration?: number;
  voiceName?: string;
  voiceId?: string;
  ttsProvider?: string;
}

type VersionItem = ProjectWorkspacePayload["versions"][number];

type ShotJobMap = {
  image?: ProjectWorkspacePayload["jobs"][number];
  video?: ProjectWorkspacePayload["jobs"][number];
  tts?: ProjectWorkspacePayload["jobs"][number];
};

interface ShotProjectState {
  imageDocument: ProjectWorkspacePayload["documents"][number] | null;
  videoDocument: ProjectWorkspacePayload["documents"][number] | null;
  audioDocument: ProjectWorkspacePayload["documents"][number] | null;
  currentImage: VersionItem | null;
  currentVideo: VersionItem | null;
  currentAudio: VersionItem | null;
  imageCandidates: ProjectWorkspacePayload["versions"];
  videoCandidates: ProjectWorkspacePayload["versions"];
  jobs: ShotJobMap;
  hasImage: boolean;
  hasVideo: boolean;
  hasAudio: boolean;
  hasPendingCandidates: boolean;
  isFinished: boolean;
}

interface Props {
  visible: boolean;
  shot: StoryboardShot;
  state: ShotProjectState | null;
  projectId?: string;
  editable: boolean;
  canMutateProject: boolean;
  canUseProject: boolean;
  characters: { id: string; name: string }[];
  voiceConfigs: { characterId: string; voiceName: string }[];
  sceneHeadingMap: Map<string, string>;
  shotPositionInScene?: number;
  sceneShotCount?: number;
  onShotUpdate: (shotId: string, patch: Partial<StoryboardShot>) => void;
  onGenerateImage: (shotId: string, prompt?: string) => void;
  onGenerateVideo: (shotId: string, prompt?: string, referenceImageAssetId?: string) => void;
  onGenerateTts: (shotId: string, characterId: string, text: string) => void;
  onAdoptVersion: (documentId: string, versionId: string) => void;
  onSelectMediaVersion?: (shotId: string, mediaType: "image" | "video" | "audio", versionId: string) => void;
  onSubtitleChange?: (shotId: string, subtitle: string) => void;
  currentSubtitle?: string;
  onMoveShot: (shotId: string, direction: -1 | 1) => void;
  onRemoveShot: (shotId: string) => void;
  isImagePending: boolean;
  isVideoPending: boolean;
  isTtsPending: boolean;
  isAdoptPending: boolean;
  hasPrev: boolean;
  hasNext: boolean;
  onPrev: () => void;
  onNext: () => void;
  onClose: () => void;
  ttsDraft: { text: string; characterId: string } | null;
  onTtsDraftChange: (field: "text" | "characterId", value: string) => void;
  imageProviders?: ProviderEntry[];
  videoProviders?: ProviderEntry[];
  defaultImageProvider?: string;
  defaultVideoProvider?: string;
  selectedImageProvider?: string;
  selectedVideoProvider?: string;
  onSelectedImageProviderChange?: (id: string | undefined) => void;
  onSelectedVideoProviderChange?: (id: string | undefined) => void;
}

function CloseIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
      <path d="M2 2l10 10M12 2L2 12" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}

function ChevronLeftIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
      <path d="M7.5 2.5L4 6l3.5 3.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function ChevronRightIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
      <path d="M4.5 2.5L8 6l-3.5 3.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function StatusDot({ status }: { status: string }) {
  const color = status === "completed" ? "var(--success-bg, #34d399)"
    : status === "running" ? "var(--warning-bg, #38bdf8)"
    : status === "failed" ? "var(--danger-bg, #f87171)"
    : "var(--text-tertiary)";
  return (
    <span style={{
      width: 6, height: 6, borderRadius: "50%", backgroundColor: color,
      display: "inline-block", flexShrink: 0,
      boxShadow: status === "running" ? "0 0 6px rgba(56,189,248,0.4)" : undefined,
      animation: status === "running" ? "uw-pulse 1.5s ease-in-out infinite" : undefined,
    }} />
  );
}

function DebouncedTextarea({ value, onChange, rows, disabled, placeholder }: {
  value: string; onChange: (v: string) => void; rows: number; disabled?: boolean; placeholder?: string;
}) {
  const [draft, setDraft] = useDebouncedField(value, onChange);
  return (
    <textarea
      className="input"
      rows={rows}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      disabled={disabled}
      placeholder={placeholder}
    />
  );
}

function CharacterTagInput({ value, characters, disabled, onChange }: {
  value: string[];
  characters: { id: string; name: string }[];
  disabled: boolean;
  onChange: (ids: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const selected = value.length > 0 ? value : [];
  const available = characters.filter((c) => !selected.includes(c.id));

  return (
    <div className="sm-char-tags">
      {selected.map((id) => {
        const ch = characters.find((c) => c.id === id);
        return (
          <span key={id} className="sm-char-tag">
            {ch?.name ?? id}
            {!disabled && (
              <button type="button" className="sm-char-tag__remove" onClick={() => onChange(selected.filter((x) => x !== id))}>
                ×
              </button>
            )}
          </span>
        );
      })}
      {!disabled && available.length > 0 && (
        <div className="sm-char-add">
          <button type="button" className="sm-char-add__btn" onClick={() => setOpen(!open)}>
            + {open ? "▲" : "▼"}
          </button>
          {open && (
            <div className="sm-char-add__dropdown">
              {available.map((ch) => (
                <button
                  key={ch.id}
                  type="button"
                  className="sm-char-add__option"
                  onClick={() => { onChange([...selected, ch.id]); setOpen(false); }}
                >
                  {ch.name}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function ShotDetailModal({
  visible,
  shot,
  state,
  projectId,
  editable,
  canMutateProject,
  canUseProject,
  characters,
  voiceConfigs,
  sceneHeadingMap,
  shotPositionInScene,
  sceneShotCount,
  onShotUpdate,
  onGenerateImage,
  onGenerateVideo,
  onGenerateTts,
  onAdoptVersion,
  onSelectMediaVersion,
  onSubtitleChange,
  currentSubtitle,
  onMoveShot,
  onRemoveShot,
  isImagePending,
  isVideoPending,
  isTtsPending,
  isAdoptPending,
  hasPrev,
  hasNext,
  onPrev,
  onNext,
  onClose,
  ttsDraft,
  onTtsDraftChange,
  imageProviders,
  videoProviders,
  defaultImageProvider,
  defaultVideoProvider,
  selectedImageProvider,
  selectedVideoProvider,
  onSelectedImageProviderChange,
  onSelectedVideoProviderChange,
}: Props) {
  const { t, locale, formatDate } = useI18n();
  const lang = locale === "en" ? "en" : "zh-CN";
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [mounted, setMounted] = useState(visible);
  const [closing, setClosing] = useState(false);
  const [promptsExpanded, setPromptsExpanded] = useState(false);
  const [mediaTab, setMediaTab] = useState<"image" | "video">("image");
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  const [imagePromptPreview, setImagePromptPreview] = useState<string | null>(null);
  const [videoPromptPreview, setVideoPromptPreview] = useState<string | null>(null);

  useEffect(() => {
    if (visible) {
      setMounted(true);
      setClosing(false);
      document.body.style.overflow = "hidden";
    } else if (mounted) {
      document.body.style.overflow = "";
      setClosing(true);
      const timer = setTimeout(() => {
        setMounted(false);
        setClosing(false);
      }, 120);
      return () => clearTimeout(timer);
    }
  }, [visible, mounted]);

  useEffect(() => () => { document.body.style.overflow = ""; }, []);

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    const inEditor = e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement;
    if (e.key === "Escape") {
      if (confirmDelete) { setConfirmDelete(false); return; }
      onClose();
      return;
    }
    if (inEditor) return;
    if (e.key === "ArrowLeft" && hasPrev) { e.preventDefault(); onPrev(); }
    else if (e.key === "ArrowRight" && hasNext) { e.preventDefault(); onNext(); }
  }, [onClose, confirmDelete, hasPrev, hasNext, onPrev, onNext]);

  useEffect(() => {
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [handleKeyDown]);

  const voiceConfigsByCharacterId = new Map(voiceConfigs.map((v) => [v.characterId, v]));
  const selectedCharacters = shot.characterIds?.length ? shot.characterIds : characters.map((c) => c.id);
  const selectedVoice = ttsDraft?.characterId ? voiceConfigsByCharacterId.get(ttsDraft.characterId) : undefined;

  const sceneHeading = sceneHeadingMap.get(shot.sceneId) || t("storyboardToolbar.untitledScene");
  const framingLabel = getStoryboardFramingLabel(shot.framing, lang);
  const cameraLabel = getStoryboardCameraMoveLabel(shot.cameraMove, lang);

  const currentImageUrl = (state?.currentImage?.content as MediaVersionContent | undefined)?.assetUrl;
  const currentVideoUrl = (state?.currentVideo?.content as MediaVersionContent | undefined)?.assetUrl;
  const currentVideoMime = (state?.currentVideo?.content as MediaVersionContent | undefined)?.mimeType ?? "video/mp4";
  const currentAudioUrl = (state?.currentAudio?.content as MediaVersionContent | undefined)?.assetUrl;
  const currentVoiceName = (state?.currentAudio?.content as MediaVersionContent | undefined)?.voiceName ?? selectedVoice?.voiceName;

  useEffect(() => {
    setConfirmDelete(false);
    setMediaTab(currentImageUrl ? "image" : "video");
  }, [shot.id, currentImageUrl]);

  useEffect(() => {
    if (!promptsExpanded || !projectId) return;
    apiFetch<{ positivePrompt?: string }>(`/shots/${shot.id}/preview-prompt`, {
      method: "POST",
      body: { projectId },
    })
      .then((data) => setImagePromptPreview(data.positivePrompt ?? ""))
      .catch(() => setImagePromptPreview(""));

    apiFetch<{ positivePrompt?: string }>(`/shots/${shot.id}/preview-video-prompt`, {
      method: "POST",
      body: { projectId },
    })
      .then((data) => setVideoPromptPreview(data.positivePrompt ?? ""))
      .catch(() => setVideoPromptPreview(""));
  }, [promptsExpanded, shot.id, projectId]);

  function renderField(label: string, value: string, field: keyof StoryboardShot, rows = 3) {
    return (
      <label className="sm-field">
        <span className="sm-field__label">{label}</span>
        {editable ? (
          <DebouncedTextarea
            value={value}
            onChange={(v) => onShotUpdate(shot.id, { [field]: v })}
            rows={rows}
          />
        ) : (
          <div className="sm-field__static">{value || "—"}</div>
        )}
      </label>
    );
  }

  function renderJobRow(label: string, job?: ShotJobMap["image"]) {
    if (!job) return null;
    return (
      <div className="sm-job-item">
        <StatusDot status={job.status} />
        <span className="sm-job-item__label">{label}</span>
        <span className="sm-job-item__status">{getJobStatusLabel(t, job.status)}</span>
        {typeof job.progress === "number" && (
          <div className="sm-job-item__progress">
            <div className="sm-job-item__progress-bar" style={{ width: `${job.progress}%` }} />
          </div>
        )}
        {job.error && <span className="sm-job-item__error">{job.error}</span>}
      </div>
    );
  }

  if (!mounted) return null;

  const imageCandidateCount = state?.imageCandidates?.length ?? 0;
  const videoCandidateCount = state?.videoCandidates?.length ?? 0;

  const currentCandidates = mediaTab === "image" ? (state?.imageCandidates ?? []) : (state?.videoCandidates ?? []);
  const currentDocumentId = mediaTab === "image" ? state?.imageDocument?.id : state?.videoDocument?.id;
  const currentVersionId = mediaTab === "image" ? state?.imageDocument?.currentVersionId : state?.videoDocument?.currentVersionId;
  const currentJob = mediaTab === "image" ? state?.jobs.image : state?.jobs.video;

  return createPortal(
    <div className={`sm-overlay${closing ? " sm-overlay--closing" : ""}`} onClick={closing ? undefined : onClose}>
      <div className={`sm-dialog${closing ? " sm-dialog--closing" : ""}`} onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="sm-header">
          <div className="sm-header__nav">
            <button className="btn btn-ghost btn-sm" type="button" disabled={!hasPrev} onClick={onPrev}>
              <ChevronLeftIcon />
            </button>
            <span className="sm-header__shot-label">{shot.shotLabel}</span>
            <button className="btn btn-ghost btn-sm" type="button" disabled={!hasNext} onClick={onNext}>
              <ChevronRightIcon />
            </button>
          </div>
          <span className="sm-header__meta">
            {framingLabel} · {cameraLabel} · {sceneHeading}
            {shotPositionInScene != null && sceneShotCount != null && (
              <span className="sm-header__position">
                {" "}({shotPositionInScene}/{sceneShotCount})
              </span>
            )}
          </span>
          <button className="sm-header__close" type="button" onClick={onClose}>
            <CloseIcon />
          </button>
        </div>

        {/* Body: two columns */}
        <div className="sm-body">
          {/* Left column: Unified Media Workspace */}
          <div className="sm-col sm-col--left">
            {/* Tab bar with count badges */}
            <div className="sm-media-tabs">
              <button
                type="button"
                className={`sm-media-tab${mediaTab === "image" ? " sm-media-tab--active" : ""}`}
                onClick={() => setMediaTab("image")}
              >
                {t("shotDetailDrawer.imageJob")}
                {currentImageUrl && <span className="sm-media-tab__dot" />}
                {imageCandidateCount > 0 && <span className="sm-media-tab__count">{imageCandidateCount}</span>}
              </button>
              <button
                type="button"
                className={`sm-media-tab${mediaTab === "video" ? " sm-media-tab--active" : ""}`}
                onClick={() => setMediaTab("video")}
              >
                {t("shotDetailDrawer.videoJob")}
                {currentVideoUrl && <span className="sm-media-tab__dot" />}
                {videoCandidateCount > 0 && <span className="sm-media-tab__count">{videoCandidateCount}</span>}
              </button>
            </div>

            {/* Preview driven by tab */}
            <div className="sm-preview">
              {mediaTab === "image" ? (
                currentImageUrl ? (
                  <img className="sm-preview__media" src={currentImageUrl} alt={shot.shotLabel} />
                ) : (
                  <div className="sm-preview__empty">{t("shotDetailDrawer.noImageYet")}</div>
                )
              ) : (
                currentVideoUrl ? (
                  <video key={currentVideoUrl} controls playsInline className="sm-preview__media">
                    <source src={currentVideoUrl} type={currentVideoMime} />
                  </video>
                ) : (
                  <div className="sm-preview__empty">{t("shotDetailDrawer.noVideoYet")}</div>
                )
              )}
            </div>

            {/* Audio + Subtitle (always visible) */}
            {currentAudioUrl && <audio controls src={currentAudioUrl} className="sm-audio-player" />}
            {editable && onSubtitleChange && (
              <label className="sm-field">
                <span className="sm-field__label">{t("shotDetailDrawer.subtitleLabel")}</span>
                <textarea
                  className="input"
                  rows={2}
                  value={currentSubtitle ?? ""}
                  onChange={(e) => onSubtitleChange(shot.id, e.target.value)}
                  placeholder={t("shotDetailDrawer.subtitlePlaceholder")}
                />
              </label>
            )}

            {/* Generate row driven by tab */}
            {canUseProject && (
              <div className="sm-generate-row">
                {mediaTab === "image" ? (
                  <>
                    <button className="btn btn-secondary btn-sm" type="button" disabled={!canMutateProject || isImagePending} onClick={() => onGenerateImage(shot.id, shot.imagePrompt)}>
                      {isImagePending ? t("common.submitting") : t("shotDetailDrawer.generateImage")}
                    </button>
                    <ProviderSelector
                      type="image"
                      providers={imageProviders ?? []}
                      defaultProviderId={defaultImageProvider}
                      value={selectedImageProvider}
                      onChange={(id) => onSelectedImageProviderChange?.(id)}
                    />
                  </>
                ) : (
                  <>
                    <button className="btn btn-primary btn-sm" type="button" disabled={!canMutateProject || isVideoPending} onClick={() => onGenerateVideo(shot.id, shot.videoPrompt, (state?.currentImage?.content as MediaVersionContent | undefined)?.assetId)}>
                      {isVideoPending ? t("common.submitting") : t("shotDetailDrawer.generateVideo")}
                    </button>
                    <ProviderSelector
                      type="video"
                      providers={videoProviders ?? []}
                      defaultProviderId={defaultVideoProvider}
                      value={selectedVideoProvider}
                      onChange={(id) => onSelectedVideoProviderChange?.(id)}
                    />
                  </>
                )}
              </div>
            )}

            {/* Job status driven by tab */}
            {canUseProject && currentJob && (
              <div className="sm-job-inline">
                {renderJobRow(mediaTab === "image" ? "Img" : "Vid", currentJob)}
              </div>
            )}

            {/* Candidates grid driven by tab */}
            {currentCandidates.length > 0 && (
              <CandidateThumbnailGrid
                candidates={currentCandidates}
                currentVersionId={currentVersionId}
                mediaType={mediaTab}
                canMutateProject={canMutateProject}
                isAdoptPending={isAdoptPending}
                canSelect={Boolean(canMutateProject && onSelectMediaVersion)}
                onThumbnailClick={(candidate) => {
                  const idx = currentCandidates.findIndex((c) => c.id === candidate.id);
                  if (idx >= 0) setLightboxIndex(idx);
                }}
                onAdopt={(candidate) => {
                  if (currentDocumentId) onAdoptVersion(currentDocumentId, candidate.id);
                }}
                onSelect={onSelectMediaVersion ? (candidate) => {
                  onSelectMediaVersion(shot.id, mediaTab, candidate.id);
                } : undefined}
              />
            )}
          </div>

          {/* Right column: Text Information Zone */}
          <div className="sm-col sm-col--right">
            {/* ① Basic Info Card */}
            <div className="sm-card">
              <div className="sm-form-grid">
                <label className="sm-field">
                  <span className="sm-field__label">{t("storyboardEditor.shotLabelField")}</span>
                  {editable ? (
                    <input className="input" value={shot.shotLabel} onChange={(e) => onShotUpdate(shot.id, { shotLabel: e.target.value })} />
                  ) : (
                    <div className="sm-field__static">{shot.shotLabel}</div>
                  )}
                </label>
                <label className="sm-field">
                  <span className="sm-field__label">{t("storyboardEditor.framingLabel")}</span>
                  {editable ? (
                    <select className="input" value={shot.framing} onChange={(e) => onShotUpdate(shot.id, { framing: e.target.value })}>
                      {STORYBOARD_FRAMING_OPTIONS.map((o) => <option key={o} value={o}>{getStoryboardFramingLabel(o, lang)}</option>)}
                    </select>
                  ) : (
                    <div className="sm-field__static">{framingLabel}</div>
                  )}
                </label>
                <label className="sm-field">
                  <span className="sm-field__label">{t("storyboardEditor.cameraMoveLabel")}</span>
                  {editable ? (
                    <select className="input" value={shot.cameraMove} onChange={(e) => onShotUpdate(shot.id, { cameraMove: e.target.value })}>
                      {STORYBOARD_CAMERA_MOVE_OPTIONS.map((o) => <option key={o} value={o}>{getStoryboardCameraMoveLabel(o, lang)}</option>)}
                    </select>
                  ) : (
                    <div className="sm-field__static">{cameraLabel}</div>
                  )}
                </label>
                <label className="sm-field">
                  <span className="sm-field__label">{t("storyboardEditor.durationLabel")}</span>
                  {editable ? (
                    <input className="input" type="number" min={1} step={1} value={shot.durationSeconds} onChange={(e) => onShotUpdate(shot.id, { durationSeconds: Number(e.target.value) || 1 })} />
                  ) : (
                    <div className="sm-field__static">{shot.durationSeconds}s</div>
                  )}
                </label>
              </div>
            </div>

            {/* ② Shot Content Card (merged descriptions + auxiliary) */}
            <div className="sm-card sm-shot-content">
              {renderField(t("shotReference.visualLabel"), shot.visualDescription, "visualDescription", 4)}
              <div className="sm-field-divider" />
              {renderField(t("shotReference.actionLabel"), shot.actionDescription ?? "", "actionDescription", 3)}
              <div className="sm-field-divider" />
              {renderField(t("storyboardEditor.dialogueLabel"), shot.dialogue ?? "", "dialogue", 3)}
              <div className="sm-field-divider" />
              {renderField(t("storyboardEditor.soundDesignLabel"), shot.soundDesign ?? "", "soundDesign", 2)}
              <div className="sm-field-divider" />
              <label className="sm-field">
                <span className="sm-field__label">{t("shotDetailDrawer.charactersLabel")}</span>
                {editable ? (
                  <CharacterTagInput
                    value={shot.characterIds ?? []}
                    characters={characters}
                    disabled={false}
                    onChange={(ids) => onShotUpdate(shot.id, { characterIds: ids })}
                  />
                ) : (
                  <div className="sm-field__static">
                    {(shot.characterIds ?? []).map((cid) => characters.find((c) => c.id === cid)?.name ?? cid).join(", ") || "—"}
                  </div>
                )}
              </label>
              <div className="sm-field-divider" />
              {renderField(t("shotReference.notesLabel"), shot.notes ?? "", "notes", 2)}
            </div>

            {/* ③ TTS Card (moved from left column) */}
            <div className="sm-card sm-tts">
              <h4 className="sm-section__title">TTS</h4>
              {canUseProject && state?.jobs.tts && renderJobRow("TTS", state?.jobs.tts)}
              <div style={{ display: "flex", gap: "var(--space-3)" }}>
                <label className="sm-field" style={{ flex: 1 }}>
                  <span className="sm-field__label">{t("shotDetailDrawer.characterLabel")}</span>
                  <select
                    className="input"
                    value={ttsDraft?.characterId ?? ""}
                    onChange={(e) => onTtsDraftChange("characterId", e.target.value)}
                    disabled={!editable}
                  >
                    {selectedCharacters.length === 0 && <option value="">{t("versionView.noCharacter")}</option>}
                    {selectedCharacters.map((cid) => (
                      <option key={cid} value={cid}>{characters.find((c) => c.id === cid)?.name ?? cid}</option>
                    ))}
                  </select>
                </label>
                <label className="sm-field" style={{ flex: 1 }}>
                  <span className="sm-field__label">{t("shotDetailDrawer.voiceLabel")}</span>
                  <div className="sm-field__static">{currentVoiceName || t("versionView.noCharacter")}</div>
                </label>
              </div>
              <label className="sm-field">
                <span className="sm-field__label">{t("shotDetailDrawer.ttsTextLabel")}</span>
                <textarea
                  className="input"
                  rows={3}
                  value={ttsDraft?.text ?? ""}
                  onChange={(e) => onTtsDraftChange("text", e.target.value)}
                  disabled={!editable}
                  placeholder={t("storyboardEditor.dialoguePlaceholder")}
                />
              </label>
              {canUseProject && (
                <button
                  className="btn btn-secondary btn-sm"
                  type="button"
                  disabled={!canMutateProject || !ttsDraft?.characterId || !ttsDraft.text.trim() || isTtsPending}
                  onClick={() => ttsDraft && onGenerateTts(shot.id, ttsDraft.characterId, ttsDraft.text.trim())}
                >
                  {isTtsPending ? t("common.submitting") : t("shotDetailDrawer.generateTts")}
                </button>
              )}
            </div>

            {/* ④ Prompts Card (collapsible) */}
            <div className="sm-card">
              <button
                className="sm-collapsible-toggle"
                type="button"
                onClick={() => setPromptsExpanded(!promptsExpanded)}
              >
                <span>{t("shotDetailDrawer.tabPrompts")}</span>
                <span className="sm-collapsible-arrow">{promptsExpanded ? "▲" : "▼"}</span>
              </button>
              {promptsExpanded && (
                <>
                  {renderField(t("shotDetailDrawer.imagePrompt"), shot.imagePrompt ?? imagePromptPreview ?? "", "imagePrompt", 5)}
                  {renderField(t("shotDetailDrawer.videoPrompt"), shot.videoPrompt ?? videoPromptPreview ?? "", "videoPrompt", 5)}
                </>
              )}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="sm-footer">
          {editable && (
            <div style={{ display: "flex", gap: "var(--space-1)" }}>
              <button className="btn btn-ghost btn-sm" type="button" onClick={() => onMoveShot(shot.id, -1)}>{t("shotDetailDrawer.up")}</button>
              <button className="btn btn-ghost btn-sm" type="button" onClick={() => onMoveShot(shot.id, 1)}>{t("shotDetailDrawer.down")}</button>
              <button className="btn btn-danger btn-sm" type="button" onClick={() => {
                if (!confirmDelete) { setConfirmDelete(true); return; }
                onRemoveShot(shot.id);
              }}
              style={confirmDelete ? { animation: "uw-pulse 1s ease-in-out infinite" } : undefined}
              >
                {confirmDelete ? t("shotDetailDrawer.confirmDelete") : t("shotDetailDrawer.delete")}
              </button>
            </div>
          )}
          <div style={{ display: "flex", gap: "var(--space-2)", marginLeft: "auto" }}>
            <button className="btn btn-ghost btn-sm" type="button" disabled={!hasPrev} onClick={onPrev}>
              <ChevronLeftIcon /> {t("shotDetailDrawer.prev")}
            </button>
            <button className="btn btn-ghost btn-sm" type="button" disabled={!hasNext} onClick={onNext}>
              {t("shotDetailDrawer.next")} <ChevronRightIcon />
            </button>
          </div>
        </div>
      </div>

      {/* Candidate Lightbox */}
      {lightboxIndex != null && currentCandidates[lightboxIndex] && (
        <CandidateLightbox
          candidate={currentCandidates[lightboxIndex]}
          allCandidates={currentCandidates}
          currentIndex={lightboxIndex}
          canMutateProject={canMutateProject}
          isAdoptPending={isAdoptPending}
          mediaType={mediaTab}
          documentId={currentDocumentId}
          currentVersionId={currentVersionId}
          onAdopt={(docId, versionId) => onAdoptVersion(docId, versionId)}
          onSelect={onSelectMediaVersion ? (versionId) => {
            onSelectMediaVersion(shot.id, mediaTab, versionId);
          } : undefined}
          onClose={() => setLightboxIndex(null)}
          onNavigate={(idx) => setLightboxIndex(idx)}
        />
      )}
    </div>,
    document.body,
  );
}
