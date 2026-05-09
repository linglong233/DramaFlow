/**
 * @fileoverview 镜头详情抽屉
 * @module web/components/project-workspace
 *
 * 展示和编辑镜头详细信息的侧边抽屉。
 */

"use client";

import { useEffect, useCallback, useState } from "react";
import type {
  ImageConfigSource,
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
import { ProviderSelector } from "./provider-selector";

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

type DrawerTab = "text" | "media" | "prompts" | "tts";

interface Props {
  shot: StoryboardShot;
  state: ShotProjectState | null;
  editable: boolean;
  canMutateProject: boolean;
  canUseProject: boolean;
  characters: { id: string; name: string }[];
  voiceConfigs: { characterId: string; voiceName: string }[];
  sceneHeadingMap: Map<string, string>;
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
  const color = status === "completed" ? "#34d399"
    : status === "running" ? "#38bdf8"
    : status === "failed" ? "#f87171"
    : "#a1a1aa";
  return (
    <span style={{
      width: 6, height: 6, borderRadius: "50%", backgroundColor: color,
      display: "inline-block", flexShrink: 0,
      boxShadow: status === "running" ? "0 0 6px rgba(56,189,248,0.4)" : undefined,
      animation: status === "running" ? "uw-pulse 1.5s ease-in-out infinite" : undefined,
    }} />
  );
}

export function ShotDetailDrawer({
  shot,
  state,
  editable,
  canMutateProject,
  canUseProject,
  characters,
  voiceConfigs,
  sceneHeadingMap,
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
  const [activeTab, setActiveTab] = useState<DrawerTab>("text");

  // Close on Esc
  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (e.key === "Escape") onClose();
  }, [onClose]);

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

  const tabLabels: { key: DrawerTab; label: string }[] = [
    { key: "text", label: t("shotDetailDrawer.tabText") },
    { key: "media", label: t("shotDetailDrawer.tabMedia") },
    { key: "prompts", label: t("shotDetailDrawer.tabPrompts") },
    { key: "tts", label: t("shotDetailDrawer.tabTts") },
  ];

  function renderField(label: string, value: string, field: keyof StoryboardShot, rows = 3) {
    return (
      <label className="drawer-field">
        <span className="drawer-field__label">{label}</span>
        {editable ? (
          <textarea
            className="input"
            rows={rows}
            value={value}
            onChange={(e) => onShotUpdate(shot.id, { [field]: e.target.value })}
          />
        ) : (
          <div className="drawer-field__static">{value || "—"}</div>
        )}
      </label>
    );
  }

  function renderJobRow(label: string, job?: ShotJobMap["image"]) {
    if (!job) {
      return (
        <div className="drawer-job-row">
          <span className="drawer-job-row__label">{label}</span>
          <span style={{ color: "var(--text-tertiary)", fontSize: 12 }}>—</span>
        </div>
      );
    }
    return (
      <div className="drawer-job-row">
        <div className="drawer-job-row__main">
          <StatusDot status={job.status} />
          <span className="drawer-job-row__label">{label}</span>
          <span className="drawer-job-row__status">{getJobStatusLabel(t, job.status)}</span>
        </div>
        {typeof job.progress === "number" && (
          <div className="drawer-job-row__progress">
            <div className="drawer-job-row__progress-bar" style={{ width: `${job.progress}%` }} />
          </div>
        )}
        {job.error && <div className="drawer-job-row__error">{job.error}</div>}
      </div>
    );
  }

  function renderCandidates(
    title: string,
    candidates: ProjectWorkspacePayload["versions"],
    currentVersionId: string | undefined,
    documentId: string | undefined,
    mediaType?: "image" | "video" | "audio",
  ) {
    if (!candidates.length) return null;
    return (
      <div className="drawer-section">
        <h4 className="drawer-section__title">{title}</h4>
        <div className="drawer-candidates">
          {candidates.map((candidate) => {
            const content = (candidate.content ?? {}) as MediaVersionContent;
            const adopted = candidate.id === currentVersionId;
            const canSelect = canMutateProject && onSelectMediaVersion && mediaType && !adopted;
            return (
              <div key={candidate.id} className="drawer-candidate">
                <div className="drawer-candidate__info">
                  <strong>{candidate.title}</strong>
                  <span>V{candidate.versionNumber}{content.model ? ` · ${content.model}` : ""}</span>
                </div>
                <div style={{ display: "flex", gap: "var(--space-2)" }}>
                  {canSelect && (
                    <button
                      className="btn btn-primary btn-sm"
                      type="button"
                      onClick={() => onSelectMediaVersion!(shot.id, mediaType!, candidate.id)}
                    >
                      {t("shotDetailDrawer.select")}
                    </button>
                  )}
                  <button
                    className="btn btn-ghost btn-sm"
                    type="button"
                    disabled={!canMutateProject || isAdoptPending || adopted}
                    onClick={() => documentId && onAdoptVersion(documentId, candidate.id)}
                  >
                    {adopted ? t("shotDetailDrawer.adopted") : t("shotDetailDrawer.adopt")}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  function renderTextTab() {
    return (
      <div className="drawer-scroll">
        {/* Shot basic info */}
        <div className="drawer-section">
          <div className="drawer-form-row">
            <label className="drawer-field">
              <span className="drawer-field__label">{t("storyboardEditor.shotLabelField")}</span>
              {editable ? (
                <input className="input" value={shot.shotLabel} onChange={(e) => onShotUpdate(shot.id, { shotLabel: e.target.value })} />
              ) : (
                <div className="drawer-field__static">{shot.shotLabel}</div>
              )}
            </label>
            <label className="drawer-field">
              <span className="drawer-field__label">{t("storyboardEditor.framingLabel")}</span>
              {editable ? (
                <select className="input" value={shot.framing} onChange={(e) => onShotUpdate(shot.id, { framing: e.target.value })}>
                  {STORYBOARD_FRAMING_OPTIONS.map((o) => <option key={o} value={o}>{getStoryboardFramingLabel(o, lang)}</option>)}
                </select>
              ) : (
                <div className="drawer-field__static">{framingLabel}</div>
              )}
            </label>
          </div>
          <div className="drawer-form-row">
            <label className="drawer-field">
              <span className="drawer-field__label">{t("storyboardEditor.cameraMoveLabel")}</span>
              {editable ? (
                <select className="input" value={shot.cameraMove} onChange={(e) => onShotUpdate(shot.id, { cameraMove: e.target.value })}>
                  {STORYBOARD_CAMERA_MOVE_OPTIONS.map((o) => <option key={o} value={o}>{getStoryboardCameraMoveLabel(o, lang)}</option>)}
                </select>
              ) : (
                <div className="drawer-field__static">{cameraLabel}</div>
              )}
            </label>
            <label className="drawer-field">
              <span className="drawer-field__label">{t("storyboardEditor.durationLabel")}</span>
              {editable ? (
                <input className="input" type="number" min={1} step={1} value={shot.durationSeconds} onChange={(e) => onShotUpdate(shot.id, { durationSeconds: Number(e.target.value) || 1 })} />
              ) : (
                <div className="drawer-field__static">{shot.durationSeconds}s</div>
              )}
            </label>
          </div>
        </div>

        {/* Text fields */}
        <div className="drawer-section">
          {renderField(t("shotReference.visualLabel"), shot.visualDescription, "visualDescription", 4)}
          {renderField(t("shotReference.actionLabel"), shot.actionDescription ?? "", "actionDescription", 3)}
          {renderField(t("storyboardEditor.dialogueLabel"), shot.dialogue ?? "", "dialogue", 3)}
          {renderField(t("storyboardEditor.soundDesignLabel"), shot.soundDesign ?? "", "soundDesign", 2)}
          {renderField(t("shotReference.notesLabel"), shot.notes ?? "", "notes", 2)}
        </div>

        {/* Characters */}
        <div className="drawer-section">
          <label className="drawer-field">
            <span className="drawer-field__label">{t("shotDetailDrawer.charactersLabel")}</span>
            {editable ? (
              <input className="input" value={shot.characterIds?.join(", ") ?? ""} onChange={(e) => onShotUpdate(shot.id, { characterIds: e.target.value.split(",").map((s) => s.trim()).filter(Boolean) })} />
            ) : (
              <div className="drawer-field__static">
                {(shot.characterIds ?? []).map((cid) => characters.find((c) => c.id === cid)?.name ?? cid).join(", ") || "—"}
              </div>
            )}
          </label>
        </div>
      </div>
    );
  }

  function renderMediaTab() {
    return (
      <div className="drawer-scroll">
        {/* Preview */}
        <div className="drawer-section">
          <h4 className="drawer-section__title">{t("shotDetailDrawer.previewTitle")}</h4>
          <div className="drawer-preview">
            {currentVideoUrl ? (
              <video controls playsInline className="drawer-preview__media">
                <source src={currentVideoUrl} type={currentVideoMime} />
              </video>
            ) : currentImageUrl ? (
              <img className="drawer-preview__media" src={currentImageUrl} alt={shot.shotLabel} />
            ) : (
              <div className="drawer-preview__empty">{t("shotDetailDrawer.noMediaYet")}</div>
            )}
          </div>
          {currentAudioUrl && <audio controls src={currentAudioUrl} className="drawer-audio-player" />}
        </div>

        {/* Subtitle */}
        {editable && onSubtitleChange && (
          <div className="drawer-section">
            <label className="drawer-field">
              <span className="drawer-field__label">{t("shotDetailDrawer.subtitleLabel")}</span>
              <textarea
                className="input"
                rows={2}
                value={currentSubtitle ?? ""}
                onChange={(e) => onSubtitleChange(shot.id, e.target.value)}
                placeholder={t("shotDetailDrawer.subtitlePlaceholder")}
              />
            </label>
          </div>
        )}

        {/* Generate buttons */}
        {canUseProject && (
          <div className="drawer-section">
            <h4 className="drawer-section__title">{t("shotDetailDrawer.generateTitle")}</h4>
            <div className="drawer-actions">
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
            </div>
          </div>
        )}

        {/* Job status */}
        {canUseProject && (
          <div className="drawer-section">
            <h4 className="drawer-section__title">{t("shotDetailDrawer.jobStatusTitle")}</h4>
            {renderJobRow(t("shotDetailDrawer.imageJob"), state?.jobs.image)}
            {renderJobRow(t("shotDetailDrawer.videoJob"), state?.jobs.video)}
            {renderJobRow(t("shotDetailDrawer.ttsJob"), state?.jobs.tts)}
          </div>
        )}

        {/* Candidates */}
        {canUseProject && (
          <>
            {renderCandidates(t("shotDetailDrawer.imageCandidates"), state?.imageCandidates ?? [], state?.imageDocument?.currentVersionId, state?.imageDocument?.id, "image")}
            {renderCandidates(t("shotDetailDrawer.videoCandidates"), state?.videoCandidates ?? [], state?.videoDocument?.currentVersionId, state?.videoDocument?.id, "video")}
          </>
        )}
      </div>
    );
  }

  function renderPromptsTab() {
    return (
      <div className="drawer-scroll">
        <div className="drawer-section">
          {renderField(t("shotDetailDrawer.imagePrompt"), shot.imagePrompt ?? "", "imagePrompt", 5)}
          {renderField(t("shotDetailDrawer.videoPrompt"), shot.videoPrompt ?? "", "videoPrompt", 5)}
        </div>
        {canUseProject && editable && (
          <div className="drawer-section">
            <div className="drawer-actions">
              <button className="btn btn-secondary btn-sm" type="button" disabled={!canMutateProject || isImagePending} onClick={() => onGenerateImage(shot.id, shot.imagePrompt)}>
                {isImagePending ? t("common.submitting") : t("shotDetailDrawer.regenerateImage")}
              </button>
              <ProviderSelector
                type="image"
                providers={imageProviders ?? []}
                defaultProviderId={defaultImageProvider}
                value={selectedImageProvider}
                onChange={(id) => onSelectedImageProviderChange?.(id)}
              />
              <button className="btn btn-primary btn-sm" type="button" disabled={!canMutateProject || isVideoPending} onClick={() => onGenerateVideo(shot.id, shot.videoPrompt, (state?.currentImage?.content as MediaVersionContent | undefined)?.assetId)}>
                {isVideoPending ? t("common.submitting") : t("shotDetailDrawer.regenerateVideo")}
              </button>
              <ProviderSelector
                type="video"
                providers={videoProviders ?? []}
                defaultProviderId={defaultVideoProvider}
                value={selectedVideoProvider}
                onChange={(id) => onSelectedVideoProviderChange?.(id)}
              />
            </div>
          </div>
        )}
      </div>
    );
  }

  function renderTtsTab() {
    return (
      <div className="drawer-scroll">
        <div className="drawer-section">
          <label className="drawer-field">
            <span className="drawer-field__label">{t("shotDetailDrawer.characterLabel")}</span>
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
          <label className="drawer-field">
            <span className="drawer-field__label">{t("shotDetailDrawer.voiceLabel")}</span>
            <div className="drawer-field__static">{currentVoiceName || t("versionView.noCharacter")}</div>
          </label>
          <label className="drawer-field">
            <span className="drawer-field__label">{t("shotDetailDrawer.ttsTextLabel")}</span>
            <textarea
              className="input"
              rows={4}
              value={ttsDraft?.text ?? ""}
              onChange={(e) => onTtsDraftChange("text", e.target.value)}
              disabled={!editable}
              placeholder={t("storyboardEditor.dialoguePlaceholder")}
            />
          </label>
        </div>

        {canUseProject && (
          <div className="drawer-section">
            <div className="drawer-actions">
              <button
                className="btn btn-primary btn-sm"
                type="button"
                disabled={!canMutateProject || !ttsDraft?.characterId || !ttsDraft.text.trim() || isTtsPending}
                onClick={() => ttsDraft && onGenerateTts(shot.id, ttsDraft.characterId, ttsDraft.text.trim())}
              >
                {isTtsPending ? t("common.submitting") : t("shotDetailDrawer.generateTts")}
              </button>
            </div>
            {renderJobRow(t("shotDetailDrawer.ttsJob"), state?.jobs.tts)}
          </div>
        )}

        {currentAudioUrl && (
          <div className="drawer-section">
            <h4 className="drawer-section__title">{t("shotDetailDrawer.previewTitle")}</h4>
            <audio controls src={currentAudioUrl} className="drawer-audio-player" />
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="drawer-overlay" onClick={onClose}>
      <div className="drawer" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="drawer-header">
          <div className="drawer-header__info">
            <span className="drawer-header__shot-label">{shot.shotLabel}</span>
            <span className="drawer-header__meta">
              {framingLabel} · {cameraLabel} · {sceneHeading}
            </span>
          </div>
          <button className="drawer-header__close" type="button" onClick={onClose}>
            <CloseIcon />
          </button>
        </div>

        {/* Tabs */}
        <div className="drawer-tabs" role="tablist">
          {tabLabels.map((tab) => (
            <button
              key={tab.key}
              className={`drawer-tab${activeTab === tab.key ? " drawer-tab--active" : ""}`}
              role="tab"
              aria-selected={activeTab === tab.key}
              type="button"
              onClick={() => setActiveTab(tab.key)}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Tab content */}
        {activeTab === "text" && renderTextTab()}
        {activeTab === "media" && renderMediaTab()}
        {activeTab === "prompts" && renderPromptsTab()}
        {activeTab === "tts" && renderTtsTab()}

        {/* Footer navigation */}
        <div className="drawer-footer">
          <button
            className="btn btn-ghost btn-sm"
            type="button"
            disabled={!hasPrev}
            onClick={onPrev}
          >
            <ChevronLeftIcon /> {t("shotDetailDrawer.prev")}
          </button>
          {editable && (
            <div style={{ display: "flex", gap: "var(--space-1)" }}>
              <button className="btn btn-ghost btn-sm" type="button" onClick={() => onMoveShot(shot.id, -1)}>{t("shotDetailDrawer.up")}</button>
              <button className="btn btn-ghost btn-sm" type="button" onClick={() => onMoveShot(shot.id, 1)}>{t("shotDetailDrawer.down")}</button>
              <button className="btn btn-danger btn-sm" type="button" onClick={() => onRemoveShot(shot.id)}>{t("shotDetailDrawer.delete")}</button>
            </div>
          )}
          <button
            className="btn btn-ghost btn-sm"
            type="button"
            disabled={!hasNext}
            onClick={onNext}
          >
            {t("shotDetailDrawer.next")} <ChevronRightIcon />
          </button>
        </div>
      </div>
    </div>
  );
}
