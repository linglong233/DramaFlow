/**
 * @fileoverview 镜头详情弹窗 — 三栏布局
 * @module web/components/project-workspace
 *
 * 左栏：可编辑元数据 + 镜头导航 + 操作按钮
 * 中栏：媒体工作区（图片/视频预览、候选、生成）
 * 右栏：镜头内容 + TTS（含音频+字幕）+ 提示词（联动媒体 Tab）
 */

"use client";

import { useEffect, useCallback, useState } from "react";
import { createPortal } from "react-dom";
import type {
  ImageConfigSource,
  ProjectWorkspacePayload,
  ProviderEntry,
  StoryboardShot,
  VideoReferenceMode,
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
import { RegenerateOverlay, type RegenFieldEntry } from "./regenerate-overlay";

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

interface GenerateVideoRequest {
  shotId: string;
  prompt?: string;
  videoReferenceMode?: VideoReferenceMode;
  referenceImageAssetId?: string;
  firstFrameAssetId?: string;
  lastFrameAssetId?: string;
  referenceImageAssetIds?: string[];
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
  sceneShots: Array<{ id: string; shotLabel: string }>;
  onNavigateToShot: (shotId: string) => void;
  onShotUpdate: (shotId: string, patch: Partial<StoryboardShot>) => void;
  onGenerateImage: (shotId: string, prompt?: string) => void;
  onGenerateVideo: (request: GenerateVideoRequest) => void;
  onGenerateTts: (shotId: string, characterId: string, text: string) => void;
  onAdoptVersion: (documentId: string, versionId: string) => void;
  onUseMediaVersionForShot?: (shotId: string, mediaType: "image" | "video" | "audio", versionId: string) => void;
  onSubtitleChange?: (shotId: string, subtitle: string) => void;
  currentSubtitle?: string;
  onMoveShot: (shotId: string, direction: -1 | 1) => void;
  onRemoveShot: (shotId: string) => void;
  isImagePending: boolean;
  isVideoPending: boolean;
  isTtsPending: boolean;
  isAdoptPending: boolean;
  isSetCurrentUsePending: boolean;
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
  imageConfigSource?: ImageConfigSource;
  ttsConfigSource?: ImageConfigSource;
  onImageConfigSourceChange?: (source: ImageConfigSource) => void;
  onTtsConfigSourceChange?: (source: ImageConfigSource) => void;
  llmConfigSource?: ImageConfigSource;
  onLlmConfigSourceChange?: (source: ImageConfigSource) => void;
}

function CloseIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M1 1l12 12M13 1L1 13" />
    </svg>
  );
}

function ChevronLeftIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M9 2L4 7l5 5" />
    </svg>
  );
}

function ChevronRightIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M5 2l5 5-5 5" />
    </svg>
  );
}

function RegenIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round">
      <path d="M1.5 7a5.5 5.5 0 019.37-3.9M12.5 7a5.5 5.5 0 01-9.37 3.9" />
      <path d="M10.5 1.5v2.5h-2.5M3.5 12.5v-2.5h2.5" />
    </svg>
  );
}

type RegenFieldKey = "framing" | "cameraMove" | "durationSeconds" | "visualDescription" | "actionDescription" | "dialogue" | "soundDesign" | "notes" | "imagePrompt" | "videoPrompt";

function StatusDot({ status }: { status: string }) {
  const color =
    status === "completed" ? "#22c55e" :
    status === "failed" ? "#ef4444" :
    "#eab308";
  const pulse = status === "running" || status === "queued";
  return (
    <span
      style={{
        display: "inline-block",
        width: 7,
        height: 7,
        borderRadius: "50%",
        background: color,
        flexShrink: 0,
        animation: pulse ? "uw-pulse 1.5s ease-in-out infinite" : undefined,
      }}
    />
  );
}

function DebouncedTextarea({
  value,
  onChange,
  rows = 3,
}: {
  value: string;
  onChange: (v: string) => void;
  rows?: number;
}) {
  const [draft, setDraft] = useDebouncedField(value, onChange);
  return (
    <textarea
      className="input"
      rows={rows}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
    />
  );
}

function CharacterTagInput({
  value,
  characters,
  disabled,
  onChange,
}: {
  value: string[];
  characters: { id: string; name: string }[];
  disabled: boolean;
  onChange: (ids: string[]) => void;
}) {
  const [showAdd, setShowAdd] = useState(false);
  const remaining = characters.filter((c) => !value.includes(c.id));

  return (
    <div className="sm-char-tags">
      {value.map((cid) => {
        const ch = characters.find((c) => c.id === cid);
        return (
          <span key={cid} className="sm-char-tag">
            {ch?.name ?? cid}
            {!disabled && (
              <button type="button" className="sm-char-tag__remove" onClick={() => onChange(value.filter((id) => id !== cid))}>
                ×
              </button>
            )}
          </span>
        );
      })}
      {!disabled && remaining.length > 0 && (
        <span className="sm-char-add">
          <button type="button" className="sm-char-add__btn" onClick={() => setShowAdd(!showAdd)}>
            + {showAdd ? "▲" : ""}
          </button>
          {showAdd && (
            <div className="sm-char-add__dropdown">
              {remaining.map((ch) => (
                <button
                  key={ch.id}
                  type="button"
                  className="sm-char-add__option"
                  onClick={() => {
                    onChange([...value, ch.id]);
                    setShowAdd(false);
                  }}
                >
                  {ch.name}
                </button>
              ))}
            </div>
          )}
        </span>
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
  sceneShots,
  onNavigateToShot,
  onShotUpdate,
  onGenerateImage,
  onGenerateVideo,
  onGenerateTts,
  onAdoptVersion,
  onUseMediaVersionForShot,
  onSubtitleChange,
  currentSubtitle,
  onMoveShot,
  onRemoveShot,
  isImagePending,
  isVideoPending,
  isTtsPending,
  isAdoptPending,
  isSetCurrentUsePending,
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
  imageConfigSource = "team",
  ttsConfigSource = "team",
  onImageConfigSourceChange,
  onTtsConfigSourceChange,
  llmConfigSource = "team",
  onLlmConfigSourceChange,
}: Props) {
  const { t, locale } = useI18n();
  const lang = locale === "en" ? "en" : "zh-CN";
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [mounted, setMounted] = useState(visible);
  const [closing, setClosing] = useState(false);
  const [mediaTab, setMediaTab] = useState<"image" | "video">("image");
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  const [imagePromptPreview, setImagePromptPreview] = useState<string | null>(null);
  const [videoPromptPreview, setVideoPromptPreview] = useState<string | null>(null);
  const [regenFields, setRegenFields] = useState<RegenFieldEntry[] | null>(null);

  // 视频参考模式状态
  const currentImageAssetId = (state?.currentImage?.content as MediaVersionContent | undefined)?.assetId;
  const imageCandidateOptions = (state?.imageCandidates ?? [])
    .map((version) => {
      const content = version.content as MediaVersionContent | undefined;
      return content?.assetId ? { versionId: version.id, assetId: content.assetId, label: version.title || `v${version.versionNumber}` } : null;
    })
    .filter((item): item is { versionId: string; assetId: string; label: string } => Boolean(item));

  const [videoReferenceMode, setVideoReferenceMode] = useState<VideoReferenceMode>(currentImageAssetId ? "single" : "none");
  const [lastFrameAssetId, setLastFrameAssetId] = useState("");
  const [multiReferenceAssetIds, setMultiReferenceAssetIds] = useState<string[]>([]);

  useEffect(() => {
    setVideoReferenceMode(currentImageAssetId ? "single" : "none");
    setLastFrameAssetId("");
    setMultiReferenceAssetIds([]);
  }, [shot.id, currentImageAssetId]);

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

  // Fetch prompt previews on mount and shot change
  useEffect(() => {
    if (!projectId) return;
    apiFetch<{ positivePrompt?: string }>(`/shots/${shot.id}/preview-prompt`, {
      method: "POST",
      body: { projectId },
    })
      .then((data) => setImagePromptPreview(data.positivePrompt ?? ""))
      .catch(() => setImagePromptPreview(""));

    apiFetch<{ positivePrompt?: string }>(`/shots/${shot.id}/preview-video-prompt`, {
      method: "POST",
      body: { projectId, videoReferenceMode },
    })
      .then((data) => setVideoPromptPreview(data.positivePrompt ?? ""))
      .catch(() => setVideoPromptPreview(""));
  }, [shot.id, projectId, videoReferenceMode]);

  function renderField(label: string, value: string, field: keyof StoryboardShot, rows = 3) {
    return (
      <label className="sm-field">
        <span className="sm-field__label-row">
          <span className="sm-field__label">{label}</span>
          {canUseProject && editable && (
            <button
              className="regen-field-btn"
              type="button"
              title={t("shotDetailDrawer.regenerateField")}
              disabled={Boolean(regenFields)}
              onClick={() => openRegen(field as RegenFieldKey)}
            >
              <RegenIcon />
            </button>
          )}
        </span>
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

  function getFieldLabel(field: RegenFieldKey): string {
    const map: Record<RegenFieldKey, string> = {
      framing: t("storyboardEditor.framingLabel"),
      cameraMove: t("storyboardEditor.cameraMoveLabel"),
      durationSeconds: t("storyboardEditor.durationLabel"),
      visualDescription: t("shotReference.visualLabel"),
      actionDescription: t("shotReference.actionLabel"),
      dialogue: t("storyboardEditor.dialogueLabel"),
      soundDesign: t("storyboardEditor.soundDesignLabel"),
      notes: t("shotReference.notesLabel"),
      imagePrompt: mediaTab === "image" ? "图片提示词" : "视频提示词",
      videoPrompt: "视频提示词",
    };
    return map[field] ?? field;
  }

  function getShotFieldValue(field: RegenFieldKey): string {
    return String(shot[field as keyof StoryboardShot] ?? "");
  }

  function openRegen(...fields: RegenFieldKey[]) {
    setRegenFields(
      fields.map((f) => ({
        field: f,
        label: getFieldLabel(f),
        oldValue: getShotFieldValue(f),
      })),
    );
  }

  function openRegenAll() {
    setRegenFields(
      (["visualDescription", "actionDescription", "dialogue", "soundDesign", "notes"] as RegenFieldKey[]).map((f) => ({
        field: f,
        label: getFieldLabel(f),
        oldValue: getShotFieldValue(f),
      })),
    );
  }

  function handleRegenAdopt(patch: Record<string, string>) {
    onShotUpdate(shot.id, patch);
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
  const currentUseVersionId = mediaTab === "image" ? state?.currentImage?.id : state?.currentVideo?.id;
  const baselineVersionId = mediaTab === "image" ? state?.imageDocument?.currentVersionId : state?.videoDocument?.currentVersionId;
  const currentJob = mediaTab === "image" ? state?.jobs.image : state?.jobs.video;

  const promptValue = mediaTab === "image"
    ? (shot.imagePrompt ?? imagePromptPreview ?? "")
    : (shot.videoPrompt ?? videoPromptPreview ?? "");
  const promptField = mediaTab === "image" ? "imagePrompt" : "videoPrompt";

  return createPortal(
    <div className={`sm-overlay${closing ? " sm-overlay--closing" : ""}`} onClick={closing ? undefined : onClose}>
      <div className={`sm-dialog${closing ? " sm-dialog--closing" : ""}`} onClick={(e) => e.stopPropagation()}>
        {/* Header — simplified */}
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
          <span className="sm-header__scene">
            {sceneHeading}
            {shotPositionInScene != null && sceneShotCount != null && (
              <span className="sm-header__position"> ({shotPositionInScene}/{sceneShotCount})</span>
            )}
          </span>
          <button className="sm-header__close" type="button" onClick={onClose}>
            <CloseIcon />
          </button>
        </div>

        {/* Meta strip — visible only on medium breakpoint (900-1299px) */}
        <div className="sm-meta-strip">
          <div className="sm-meta-strip__field">
            <span className="sm-meta-strip__label">{t("storyboardEditor.shotLabelField")}</span>
            {editable ? (
              <input className="input" style={{ width: 60, fontSize: 12 }} value={shot.shotLabel} onChange={(e) => onShotUpdate(shot.id, { shotLabel: e.target.value })} />
            ) : (
              <span className="sm-meta-strip__value">{shot.shotLabel}</span>
            )}
          </div>
          <div className="sm-meta-strip__field">
            <span className="sm-meta-strip__label">{t("storyboardEditor.framingLabel")}</span>
            {editable ? (
              <select className="input" style={{ fontSize: 12 }} value={shot.framing} onChange={(e) => onShotUpdate(shot.id, { framing: e.target.value })}>
                {STORYBOARD_FRAMING_OPTIONS.map((o) => <option key={o} value={o}>{getStoryboardFramingLabel(o, lang)}</option>)}
              </select>
            ) : (
              <span className="sm-meta-strip__value">{framingLabel}</span>
            )}
          </div>
          <div className="sm-meta-strip__field">
            <span className="sm-meta-strip__label">{t("storyboardEditor.cameraMoveLabel")}</span>
            {editable ? (
              <select className="input" style={{ fontSize: 12 }} value={shot.cameraMove} onChange={(e) => onShotUpdate(shot.id, { cameraMove: e.target.value })}>
                {STORYBOARD_CAMERA_MOVE_OPTIONS.map((o) => <option key={o} value={o}>{getStoryboardCameraMoveLabel(o, lang)}</option>)}
              </select>
            ) : (
              <span className="sm-meta-strip__value">{cameraLabel}</span>
            )}
          </div>
          <div className="sm-meta-strip__field">
            <span className="sm-meta-strip__label">{t("storyboardEditor.durationLabel")}</span>
            {editable ? (
              <input className="input" type="number" min={1} step={1} style={{ width: 50, fontSize: 12 }} value={shot.durationSeconds} onChange={(e) => onShotUpdate(shot.id, { durationSeconds: Number(e.target.value) || 1 })} />
            ) : (
              <span className="sm-meta-strip__value">{shot.durationSeconds}s</span>
            )}
          </div>
        </div>

        {/* Body: three columns */}
        <div className="sm-body">

          {/* ═══ Left column: Metadata + Nav + Actions ═══ */}
          <div className="sm-col sm-col--left">
            <h4 className="sm-section__title">镜头属性</h4>

            <label className="sm-field">
              <span className="sm-field__label">{t("storyboardEditor.shotLabelField")}</span>
              {editable ? (
                <input className="input" value={shot.shotLabel} onChange={(e) => onShotUpdate(shot.id, { shotLabel: e.target.value })} />
              ) : (
                <div className="sm-field__static">{shot.shotLabel}</div>
              )}
            </label>

            <label className="sm-field">
              <span className="sm-field__label-row">
                <span className="sm-field__label">{t("storyboardEditor.framingLabel")}</span>
                {canUseProject && editable && (
                  <button className="regen-field-btn" type="button" title={t("shotDetailDrawer.regenerateField")} disabled={Boolean(regenFields)} onClick={() => openRegen("framing")}><RegenIcon /></button>
                )}
              </span>
              {editable ? (
                <select className="input" value={shot.framing} onChange={(e) => onShotUpdate(shot.id, { framing: e.target.value })}>
                  {STORYBOARD_FRAMING_OPTIONS.map((o) => <option key={o} value={o}>{getStoryboardFramingLabel(o, lang)}</option>)}
                </select>
              ) : (
                <div className="sm-field__static">{framingLabel}</div>
              )}
            </label>

            <label className="sm-field">
              <span className="sm-field__label-row">
                <span className="sm-field__label">{t("storyboardEditor.cameraMoveLabel")}</span>
                {canUseProject && editable && (
                  <button className="regen-field-btn" type="button" title={t("shotDetailDrawer.regenerateField")} disabled={Boolean(regenFields)} onClick={() => openRegen("cameraMove")}><RegenIcon /></button>
                )}
              </span>
              {editable ? (
                <select className="input" value={shot.cameraMove} onChange={(e) => onShotUpdate(shot.id, { cameraMove: e.target.value })}>
                  {STORYBOARD_CAMERA_MOVE_OPTIONS.map((o) => <option key={o} value={o}>{getStoryboardCameraMoveLabel(o, lang)}</option>)}
                </select>
              ) : (
                <div className="sm-field__static">{cameraLabel}</div>
              )}
            </label>

            <label className="sm-field">
              <span className="sm-field__label-row">
                <span className="sm-field__label">{t("storyboardEditor.durationLabel")}</span>
                {canUseProject && editable && (
                  <button className="regen-field-btn" type="button" title={t("shotDetailDrawer.regenerateField")} disabled={Boolean(regenFields)} onClick={() => openRegen("durationSeconds")}><RegenIcon /></button>
                )}
              </span>
              {editable ? (
                <input className="input" type="number" min={1} step={1} value={shot.durationSeconds} onChange={(e) => onShotUpdate(shot.id, { durationSeconds: Number(e.target.value) || 1 })} />
              ) : (
                <div className="sm-field__static">{shot.durationSeconds}s</div>
              )}
            </label>

            <label className="sm-field">
              <span className="sm-field__label">场景</span>
              <div className="sm-field__static">{sceneHeading}</div>
            </label>

            {/* Shot navigation pills */}
            {sceneShots.length > 1 && (
              <div className="sm-shot-nav">
                {sceneShots.map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    className={`sm-shot-nav__pill${s.id === shot.id ? " sm-shot-nav__pill--active" : ""}`}
                    onClick={() => onNavigateToShot(s.id)}
                  >
                    {s.shotLabel}
                  </button>
                ))}
              </div>
            )}

            {/* Action buttons */}
            {editable && (
              <div className="sm-actions">
                <button className="btn btn-ghost btn-sm" type="button" onClick={() => onMoveShot(shot.id, -1)}>
                  {t("shotDetailDrawer.up")}
                </button>
                <button className="btn btn-ghost btn-sm" type="button" onClick={() => onMoveShot(shot.id, 1)}>
                  {t("shotDetailDrawer.down")}
                </button>
                <button
                  className="btn btn-danger btn-sm"
                  type="button"
                  onClick={() => {
                    if (!confirmDelete) { setConfirmDelete(true); return; }
                    onRemoveShot(shot.id);
                  }}
                  style={confirmDelete ? { animation: "uw-pulse 1s ease-in-out infinite" } : undefined}
                >
                  {confirmDelete ? t("shotDetailDrawer.confirmDelete") : t("shotDetailDrawer.delete")}
                </button>
              </div>
            )}
          </div>

          {/* ═══ Center column: Media Workspace ═══ */}
          <div className="sm-col sm-col--center">
            {/* Media tabs */}
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

            {/* Preview */}
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

            {/* Generate row */}
            {canUseProject && (
              <div className="sm-generate-row">
                {mediaTab === "image" ? (
                  <>
                    <button className="btn btn-secondary btn-sm" type="button" disabled={!canMutateProject || isImagePending} onClick={() => onGenerateImage(shot.id, shot.imagePrompt)}>
                      {isImagePending ? t("common.submitting") : t("shotDetailDrawer.generateImage")}
                    </button>
                    <select
                      className="input sm-config-source-select"
                      value={imageConfigSource}
                      onChange={(e) => onImageConfigSourceChange?.(e.target.value as ImageConfigSource)}
                    >
                      <option value="team">{t("projectWorkspace.media.imageConfigSourceTeam")}</option>
                      <option value="personal">{t("projectWorkspace.media.imageConfigSourcePersonal")}</option>
                    </select>
                    <button
                      className="btn btn-ghost btn-sm"
                      type="button"
                      disabled={!canMutateProject || !editable || Boolean(regenFields)}
                      onClick={openRegenAll}
                    >
                      <RegenIcon /> {t("shotDetailDrawer.regenerateAll")}
                    </button>
                    <select
                      className="input sm-config-source-select"
                      value={llmConfigSource}
                      onChange={(e) => onLlmConfigSourceChange?.(e.target.value as ImageConfigSource)}
                    >
                      <option value="team">{t("projectWorkspace.media.imageConfigSourceTeam")}</option>
                      <option value="personal">{t("projectWorkspace.media.imageConfigSourcePersonal")}</option>
                    </select>
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
                    <button className="btn btn-primary btn-sm" type="button"
                      disabled={!canMutateProject || isVideoPending || (videoReferenceMode === "first_last" && (!currentImageAssetId || !lastFrameAssetId))}
                      onClick={() => onGenerateVideo({
                        shotId: shot.id,
                        prompt: shot.videoPrompt,
                        videoReferenceMode,
                        ...(videoReferenceMode === "single" && currentImageAssetId ? { referenceImageAssetId: currentImageAssetId } : {}),
                        ...(videoReferenceMode === "first_last" && currentImageAssetId && lastFrameAssetId ? { firstFrameAssetId: currentImageAssetId, lastFrameAssetId } : {}),
                        ...(videoReferenceMode === "multiple" && multiReferenceAssetIds.length ? { referenceImageAssetIds: multiReferenceAssetIds.slice(0, 6) } : {}),
                      })}
                    >
                      {isVideoPending ? t("common.submitting") : t("shotDetailDrawer.generateVideo")}
                    </button>
                    <select
                      className="input sm-config-source-select"
                      value={videoReferenceMode}
                      onChange={(e) => setVideoReferenceMode(e.target.value as VideoReferenceMode)}
                    >
                      <option value="none">{t("shotDetailDrawer.videoReferenceNone")}</option>
                      <option value="single" disabled={!currentImageAssetId}>{t("shotDetailDrawer.videoReferenceCurrent")}</option>
                      <option value="first_last" disabled={!currentImageAssetId || imageCandidateOptions.length === 0}>{t("shotDetailDrawer.videoReferenceFirstLast")}</option>
                      <option value="multiple" disabled={imageCandidateOptions.length === 0}>{t("shotDetailDrawer.videoReferenceMultiple")}</option>
                    </select>
                    {videoReferenceMode === "first_last" && (
                      <select
                        className="input sm-config-source-select"
                        value={lastFrameAssetId}
                        onChange={(e) => setLastFrameAssetId(e.target.value)}
                      >
                        <option value="">{t("shotDetailDrawer.videoReferenceLastFrame")}</option>
                        {imageCandidateOptions.map((item) => (
                          <option key={item.versionId} value={item.assetId}>{item.label}</option>
                        ))}
                      </select>
                    )}
                    {videoReferenceMode === "multiple" && (
                      <select
                        className="input sm-config-source-select"
                        value=""
                        onChange={(e) => {
                          const value = e.target.value;
                          if (value && !multiReferenceAssetIds.includes(value) && multiReferenceAssetIds.length < 6) {
                            setMultiReferenceAssetIds([...multiReferenceAssetIds, value]);
                          }
                        }}
                      >
                        <option value="">{t("shotDetailDrawer.videoReferenceAdd")}</option>
                        {imageCandidateOptions.map((item) => (
                          <option key={item.versionId} value={item.assetId}>{item.label}</option>
                        ))}
                      </select>
                    )}
                    {videoReferenceMode === "multiple" && multiReferenceAssetIds.length > 0 && (
                      <div className="sm-char-tags">
                        {multiReferenceAssetIds.map((assetId) => (
                          <span key={assetId} className="sm-char-tag">
                            {imageCandidateOptions.find((item) => item.assetId === assetId)?.label ?? assetId}
                            <button type="button" className="sm-char-tag__remove" onClick={() => setMultiReferenceAssetIds(multiReferenceAssetIds.filter((item) => item !== assetId))}>
                              ×
                            </button>
                          </span>
                        ))}
                      </div>
                    )}
                    <select
                      className="input sm-config-source-select"
                      value={imageConfigSource}
                      onChange={(e) => onImageConfigSourceChange?.(e.target.value as ImageConfigSource)}
                    >
                      <option value="team">{t("projectWorkspace.media.imageConfigSourceTeam")}</option>
                      <option value="personal">{t("projectWorkspace.media.imageConfigSourcePersonal")}</option>
                    </select>
                    <button
                      className="btn btn-ghost btn-sm"
                      type="button"
                      disabled={!canMutateProject || !editable || Boolean(regenFields)}
                      onClick={openRegenAll}
                    >
                      <RegenIcon /> {t("shotDetailDrawer.regenerateAll")}
                    </button>
                    <select
                      className="input sm-config-source-select"
                      value={llmConfigSource}
                      onChange={(e) => onLlmConfigSourceChange?.(e.target.value as ImageConfigSource)}
                    >
                      <option value="team">{t("projectWorkspace.media.imageConfigSourceTeam")}</option>
                      <option value="personal">{t("projectWorkspace.media.imageConfigSourcePersonal")}</option>
                    </select>
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

            {/* Job status */}
            {canUseProject && currentJob && (
              <div className="sm-job-inline">
                {renderJobRow(mediaTab === "image" ? "Img" : "Vid", currentJob)}
              </div>
            )}

            {/* Candidates */}
            {currentCandidates.length > 0 && (
              <CandidateThumbnailGrid
                candidates={currentCandidates}
                currentUseVersionId={currentUseVersionId}
                baselineVersionId={baselineVersionId}
                mediaType={mediaTab}
                canMutateProject={canMutateProject}
                isSetCurrentUsePending={isSetCurrentUsePending}
                isAdoptPending={isAdoptPending}
                canUseForShot={Boolean(canMutateProject && onUseMediaVersionForShot)}
                onThumbnailClick={(candidate) => {
                  const idx = currentCandidates.findIndex((c) => c.id === candidate.id);
                  if (idx >= 0) setLightboxIndex(idx);
                }}
                onAdoptAsBaseline={(candidate) => {
                  if (currentDocumentId) onAdoptVersion(currentDocumentId, candidate.id);
                }}
                onUseForShot={onUseMediaVersionForShot ? (candidate) => {
                  onUseMediaVersionForShot(shot.id, mediaTab, candidate.id);
                } : undefined}
              />
            )}
          </div>

          {/* ═══ Right column: Prompt (fixed) + Content + TTS (scrollable) ═══ */}
          <div className="sm-col sm-col--right">

            {/* Fixed prompt card at top — does not scroll */}
            <div className={`sm-card sm-card--prompt${mediaTab === "video" ? " sm-card--prompt--video" : ""}`}>
              <h4 className={`sm-card__accent-title${mediaTab === "video" ? " sm-card__accent-title--prompt-video" : " sm-card__accent-title--prompt"}`}>
                <span>{mediaTab === "image" ? "图片提示词" : "视频提示词"}</span>
                {canUseProject && editable && (
                  <button className="regen-field-btn" type="button" title={t("shotDetailDrawer.regenerateField")} disabled={Boolean(regenFields)} onClick={() => openRegen(mediaTab === "image" ? "imagePrompt" : "videoPrompt")}><RegenIcon /></button>
                )}
              </h4>
              <label className="sm-field">
                {editable ? (
                  <DebouncedTextarea
                    value={promptValue}
                    onChange={(v) => onShotUpdate(shot.id, { [promptField]: v })}
                    rows={3}
                  />
                ) : (
                  <div className="sm-field__static" style={{ maxHeight: "80px", overflowY: "auto" }}>{promptValue || "—"}</div>
                )}
              </label>
            </div>

            {/* Scrollable content area */}
            <div className="sm-right-scroll">

              {/* Card 1: 镜头内容 */}
              <div className="sm-card sm-card--content">
                <h4 className="sm-card__accent-title sm-card__accent-title--content">
                  镜头内容
                </h4>
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

              {/* Card 2: 语音合成 */}
              <div className="sm-card sm-card--tts">
                <h4 className="sm-card__accent-title sm-card__accent-title--tts">
                  语音合成
                </h4>
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
                  <div className="sm-generate-row">
                    <button
                      className="btn btn-secondary btn-sm"
                      type="button"
                      disabled={!canMutateProject || !ttsDraft?.characterId || !ttsDraft.text.trim() || isTtsPending}
                      onClick={() => ttsDraft && onGenerateTts(shot.id, ttsDraft.characterId, ttsDraft.text.trim())}
                    >
                      {isTtsPending ? t("common.submitting") : t("shotDetailDrawer.generateTts")}
                    </button>
                    <select
                      className="input sm-config-source-select"
                      value={ttsConfigSource}
                      onChange={(e) => onTtsConfigSourceChange?.(e.target.value as ImageConfigSource)}
                    >
                      <option value="team">{t("projectWorkspace.media.imageConfigSourceTeam")}</option>
                      <option value="personal">{t("projectWorkspace.media.imageConfigSourcePersonal")}</option>
                    </select>
                  </div>
                )}

                {/* TTS audio player */}
                {currentAudioUrl && <audio controls src={currentAudioUrl} className="sm-audio-player" />}

                {/* Subtitle */}
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
              </div>
            </div>
          </div>
        </div>

        {/* Regenerate Overlay */}
        {regenFields && (
          <RegenerateOverlay
            shotId={shot.id}
            projectId={projectId}
            fields={regenFields}
            defaultLlmConfigSource={llmConfigSource}
            onLlmConfigSourceChange={onLlmConfigSourceChange}
            onAdopt={handleRegenAdopt}
            onClose={() => setRegenFields(null)}
          />
        )}
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
          isSetCurrentUsePending={isSetCurrentUsePending}
          currentUseVersionId={currentUseVersionId}
          baselineVersionId={baselineVersionId}
          onAdoptAsBaseline={(docId, versionId) => onAdoptVersion(docId, versionId)}
          onUseForShot={onUseMediaVersionForShot ? (versionId) => {
            onUseMediaVersionForShot(shot.id, mediaTab, versionId);
          } : undefined}
          onClose={() => setLightboxIndex(null)}
          onNavigate={(idx) => setLightboxIndex(idx)}
        />
      )}
    </div>,
    document.body,
  );
}
