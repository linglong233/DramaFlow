"use client";

import { useEffect, useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { ImageConfigSource, ProjectWorkspacePayload, StoryboardContent, StoryboardShot } from "@dramaflow/shared";
import {
  STORYBOARD_CAMERA_MOVE_OPTIONS,
  STORYBOARD_FRAMING_OPTIONS,
  getStoryboardCameraMoveLabel,
  getStoryboardEstimatedDuration,
  getStoryboardFramingLabel,
  getStoryboardSceneIds,
  getStoryboardShotAudioSummary,
  getStoryboardShotVisualSummary,
  normalizeScriptContent,
  normalizeStoryboardContent,
  normalizeWorldBibleContent,
} from "@dramaflow/shared";

import { apiFetch, formatApiError } from "../../lib/api";
import { getJobStatusLabel, useI18n } from "../../lib/i18n";
import { queryKeys } from "../../lib/query-keys";
import { InlineFeedback } from "../inline-feedback";

interface Props {
  content: StoryboardContent;
  onChange?: (content: StoryboardContent) => void;
  projectId?: string;
  project?: ProjectWorkspacePayload;
  allowProjectMutations?: boolean;
}

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

type ShotFilter = "all" | "unfinished" | "candidates";

type ShotJobMap = {
  image?: ProjectWorkspacePayload["jobs"][number];
  video?: ProjectWorkspacePayload["jobs"][number];
  tts?: ProjectWorkspacePayload["jobs"][number];
};

interface ShotProjectState {
  imageDocument: ProjectWorkspacePayload["documents"][number] | null;
  videoDocument: ProjectWorkspacePayload["documents"][number] | null;
  audioDocument: ProjectWorkspacePayload["documents"][number] | null;
  currentImage: ProjectWorkspacePayload["versions"][number] | null;
  currentVideo: ProjectWorkspacePayload["versions"][number] | null;
  currentAudio: ProjectWorkspacePayload["versions"][number] | null;
  imageCandidates: ProjectWorkspacePayload["versions"];
  videoCandidates: ProjectWorkspacePayload["versions"];
  jobs: ShotJobMap;
  hasImage: boolean;
  hasVideo: boolean;
  hasAudio: boolean;
  hasPendingCandidates: boolean;
  isFinished: boolean;
}

const COPY = {
  zh: {
    title: "分镜工作台",
    subtitle: "在左侧浏览分镜列表，并在右侧检查媒体、任务与提示词字段。",
    filters: {
      all: "所有分镜",
      unfinished: "未完成",
      candidates: "有候选待定",
    },
    columns: {
      visual: "画面内容",
      audio: "音频 / 对白",
      notes: "备注",
    },
    stats: {
      scenes: "场次",
      shots: "镜头",
      duration: "预估时长",
      images: "图片",
      videos: "视频",
      audios: "配音",
    },
    sceneBatch: "按场次批量配音",
    addScene: "添加场次",
    addShot: "添加分镜",
    createFirstShot: "创建首个分镜",
    noShots: "暂无分镜内容。",
    noSelection: "点击左侧列表选择一个分镜以在此处查看详情。",
    noFilteredShots: "没有符合当前筛选条件的分镜。",
    sceneFallback: "未绑定剧本场次",
    inspector: "分镜监视器",
    adoptedMedia: "当前采用媒体",
    emptyMedia: "暂未采用任何图片或视频。",
    production: "内容生成",
    jobStatus: "任务状态",
    ttsPanel: "角色配音",
    promptPanel: "AI 提示词配置",
    imageCandidates: "图片候选集",
    videoCandidates: "视频候选集",
    emptyCandidates: "暂无候选版本",
    adopt: "采用",
    adopted: "当前采用",
    noJob: "无任务",
    selected: "已选中",
    readonly: "历史版本为只读模式。由于系统限制，媒体状态仍反映当前主干的媒体。",
    ttsCharacter: "配音角色",
    ttsText: "配音文本",
    voice: "发声参数",
    noCharacter: "未指定角色",
    actionDescription: "动作描述",
    imagePrompt: "画面提示词",
    videoPrompt: "视频提示词",
    characterIds: "关联角色",
    moveUp: "上移",
    moveDown: "下移",
    deleteShot: "删除分镜",
    overviewFallback: "暂无分镜概述内容。",
    generateTts: "生成配音",
  },
  en: {
    title: "Storyboard Workbench",
    subtitle: "Scan the shot list on the left and inspect media, jobs, and prompt fields on the right.",
    filters: {
      all: "All shots",
      unfinished: "Unfinished",
      candidates: "Pending candidates",
    },
    columns: {
      visual: "Visual Content",
      audio: "Audio / Dialogue",
      notes: "Notes",
    },
    stats: {
      scenes: "Scenes",
      shots: "Shots",
      duration: "Estimated",
      images: "Images",
      videos: "Videos",
      audios: "TTS",
    },
    sceneBatch: "Batch TTS by scene",
    addScene: "Add scene",
    addShot: "Add shot",
    createFirstShot: "Create first shot",
    noShots: "No storyboard shots yet.",
    noSelection: "Select a shot on the left to inspect it here.",
    noFilteredShots: "No shots match the current filter.",
    sceneFallback: "No linked script scene",
    inspector: "Shot Inspector",
    adoptedMedia: "Adopted Media",
    emptyMedia: "No adopted image or video yet.",
    production: "Shot Production",
    jobStatus: "Job Status",
    ttsPanel: "TTS and Character",
    promptPanel: "AI Prompt Fields",
    imageCandidates: "Image Candidates",
    videoCandidates: "Video Candidates",
    emptyCandidates: "No candidate versions yet",
    adopt: "Adopt",
    adopted: "Adopted",
    noJob: "No job yet",
    selected: "Selected",
    readonly: "Historical versions are read-only. Media state still reflects the current project.",
    ttsCharacter: "TTS Character",
    ttsText: "TTS Text",
    voice: "Current Voice",
    noCharacter: "No character mapped",
    actionDescription: "Action",
    imagePrompt: "Image Prompt",
    videoPrompt: "Video Prompt",
    characterIds: "Characters",
    moveUp: "Move up",
    moveDown: "Move down",
    deleteShot: "Delete shot",
    overviewFallback: "No storyboard overview yet.",
    generateTts: "Generate TTS",
  },
} as const;


function createShotId(sceneId: string, index: number) {
  return `shot-${sceneId}-${index + 1}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

function createEmptyShot(sceneId: string, index: number): StoryboardShot {
  return {
    id: createShotId(sceneId, index),
    sceneId,
    shotLabel: `${sceneId.replace(/^scene-/, "S")}-${index + 1}`,
    framing: "MS",
    cameraMove: "static",
    durationSeconds: 3,
    visualDescription: "",
    actionDescription: "",
    dialogue: "",
    soundDesign: "",
    notes: "",
    characterIds: [],
  };
}

function formatDuration(value: number, locale: "zh" | "en") {
  const seconds = Math.max(0, Math.round(value));
  if (seconds < 60) {
    return `${seconds}s`;
  }
  const minutes = Math.floor(seconds / 60);
  const remain = seconds % 60;
  return `${minutes}m ${remain}s`;
}

function CandidateList({
  title,
  candidates,
  currentVersionId,
  onAdopt,
  canAdopt,
  isPending,
  emptyLabel,
  adoptLabel,
  adoptedLabel,
}: {
  title: string;
  candidates: ProjectWorkspacePayload["versions"];
  currentVersionId?: string;
  onAdopt: (versionId: string) => void;
  canAdopt: boolean;
  isPending: boolean;
  emptyLabel: string;
  adoptLabel: string;
  adoptedLabel: string;
}) {
  return (
    <div className="swb-panel">
      <div className="swb-panel__header">
        <h4>{title}</h4>
      </div>
      {candidates.length === 0 ? (
        <div className="swb-empty-inline">{emptyLabel}</div>
      ) : (
        <div className="swb-candidates">
          {candidates.map((candidate) => {
            const content = (candidate.content ?? {}) as MediaVersionContent;
            const adopted = candidate.id === currentVersionId;
            return (
              <div key={candidate.id} className="swb-candidate">
                <div className="swb-candidate__meta">
                  <strong>{candidate.title}</strong>
                  <span className="muted">V{candidate.versionNumber}{content.model ? ` 闂?${content.model}` : ""}</span>
                </div>
                <button
                  className="btn btn-ghost btn-sm"
                  type="button"
                  disabled={!canAdopt || isPending || adopted}
                  onClick={() => onAdopt(candidate.id)}
                >
                  {adopted ? adoptedLabel : adoptLabel}
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function StatusRow({
  label,
  job,
  formatDate,
  statusLabel,
  emptyLabel,
}: {
  label: string;
  job?: ProjectWorkspacePayload["jobs"][number];
  formatDate: (value: string, options?: Intl.DateTimeFormatOptions) => string;
  statusLabel: (status: ProjectWorkspacePayload["jobs"][number]["status"]) => string;
  emptyLabel: string;
}) {
  if (!job) {
    return (
      <div className="swb-status-row">
        <span className="swb-status-row__label">{label}</span>
        <span className="muted">{emptyLabel}</span>
      </div>
    );
  }

  return (
    <div className="swb-status-row">
      <div className="swb-status-row__main">
        <span className="swb-status-row__label">{label}</span>
        <span className={`swb-status-pill swb-status-pill--${job.status}`}>{statusLabel(job.status)}</span>
      </div>
      <div className="swb-status-row__meta">
        {typeof job.progress === "number" ? <span>{job.progress}%</span> : null}
        <span>{formatDate(job.updatedAt, { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })}</span>
      </div>
      {job.error ? <div className="swb-status-row__error">{job.error}</div> : null}
    </div>
  );
}

export function StoryboardWorkbench({ content, onChange, projectId, project, allowProjectMutations = true }: Props) {
  const { t, locale, formatDate } = useI18n();
  const queryClient = useQueryClient();
  const language = locale === "en" ? "en" : "zh";
  const copy = COPY[language];
  const editable = Boolean(onChange);
  const canUseProject = Boolean(projectId && project);
  const canMutateProject = canUseProject && allowProjectMutations;
  const safeContent = useMemo(() => normalizeStoryboardContent(content), [content]);
  const safeWorldBible = useMemo(() => normalizeWorldBibleContent(project?.worldBible), [project?.worldBible]);

  const [selectedShotId, setSelectedShotId] = useState(safeContent.shots[0]?.id ?? "");
  const [filter, setFilter] = useState<ShotFilter>("all");
  const [newSceneId, setNewSceneId] = useState("");
  const [imageConfigSource, setImageConfigSource] = useState<ImageConfigSource>("team");
  const [ttsDrafts, setTtsDrafts] = useState<Record<string, { text: string; characterId: string }>>({});
  const [feedback, setFeedback] = useState<{ message: string | null; error: string | null }>({ message: null, error: null });

  const characters = safeWorldBible.characters;
  const voiceConfigs = safeWorldBible.voiceConfigs ?? [];

  const charactersById = useMemo(() => new Map(characters.map((character) => [character.id, character])), [characters]);
  const voiceConfigsByCharacterId = useMemo(() => new Map(voiceConfigs.map((config) => [config.characterId, config])), [voiceConfigs]);
  const versionsById = useMemo(() => new Map((project?.versions ?? []).map((version) => [version.id, version])), [project?.versions]);

  const versionsByDocument = useMemo(() => {
    const map = new Map<string, ProjectWorkspacePayload["versions"]>();
    for (const version of project?.versions ?? []) {
      const group = map.get(version.documentId) ?? [];
      group.push(version);
      map.set(version.documentId, group);
    }
    for (const group of map.values()) {
      group.sort((left, right) => right.versionNumber - left.versionNumber);
    }
    return map;
  }, [project?.versions]);

  const documentsByShot = useMemo(() => {
    const map = new Map<string, { image?: ProjectWorkspacePayload["documents"][number]; video?: ProjectWorkspacePayload["documents"][number]; audio?: ProjectWorkspacePayload["documents"][number] }>();
    for (const document of project?.documents ?? []) {
      if (!document.shotId || (document.type !== "image" && document.type !== "video" && document.type !== "audio")) {
        continue;
      }
      const entry = map.get(document.shotId) ?? {};
      if (document.type === "image") entry.image = document;
      if (document.type === "video") entry.video = document;
      if (document.type === "audio") entry.audio = document;
      map.set(document.shotId, entry);
    }
    return map;
  }, [project?.documents]);

  const latestJobsByShot = useMemo(() => {
    const map = new Map<string, ShotJobMap>();
    const sortedJobs = [...(project?.jobs ?? [])].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
    for (const job of sortedJobs) {
      if (!job.shotId) continue;
      const entry = map.get(job.shotId) ?? {};
      if (job.type === "image_generation" && !entry.image) entry.image = job;
      if (job.type === "video_generation" && !entry.video) entry.video = job;
      if (job.type === "tts_generation" && !entry.tts) entry.tts = job;
      map.set(job.shotId, entry);
    }
    return map;
  }, [project?.jobs]);

  const sceneHeadingMap = useMemo(() => {
    const map = new Map<string, string>();
    if (!project) return map;
    const scriptDocument = project.documents.find((document) => document.type === "script");
    const scriptVersion = project.versions.find((version) => version.id === scriptDocument?.currentVersionId);
    if (!scriptVersion) return map;
    for (const scene of normalizeScriptContent(scriptVersion.content).scenes) {
      map.set(scene.id, scene.heading);
    }
    return map;
  }, [project]);
  const shotStateById = useMemo(() => {
    const map = new Map<string, ShotProjectState>();
    for (const shot of safeContent.shots) {
      const documents = documentsByShot.get(shot.id) ?? {};
      const currentImage = documents.image?.currentVersionId ? versionsById.get(documents.image.currentVersionId) ?? null : null;
      const currentVideo = documents.video?.currentVersionId ? versionsById.get(documents.video.currentVersionId) ?? null : null;
      const currentAudio = documents.audio?.currentVersionId ? versionsById.get(documents.audio.currentVersionId) ?? null : null;
      const imageCandidates = documents.image ? versionsByDocument.get(documents.image.id) ?? [] : [];
      const videoCandidates = documents.video ? versionsByDocument.get(documents.video.id) ?? [] : [];
      const hasImage = Boolean((currentImage?.content as MediaVersionContent | undefined)?.assetUrl);
      const hasVideo = Boolean((currentVideo?.content as MediaVersionContent | undefined)?.assetUrl);
      const hasAudio = Boolean((currentAudio?.content as MediaVersionContent | undefined)?.assetUrl);
      const requiresTts = Boolean(shot.dialogue?.trim());
      const hasPendingCandidates = imageCandidates.some((candidate) => candidate.id !== documents.image?.currentVersionId)
        || videoCandidates.some((candidate) => candidate.id !== documents.video?.currentVersionId);

      map.set(shot.id, {
        imageDocument: documents.image ?? null,
        videoDocument: documents.video ?? null,
        audioDocument: documents.audio ?? null,
        currentImage,
        currentVideo,
        currentAudio,
        imageCandidates,
        videoCandidates,
        jobs: latestJobsByShot.get(shot.id) ?? {},
        hasImage,
        hasVideo,
        hasAudio,
        hasPendingCandidates,
        isFinished: hasImage && hasVideo && (!requiresTts || hasAudio),
      });
    }
    return map;
  }, [safeContent.shots, documentsByShot, latestJobsByShot, versionsByDocument, versionsById]);

  const visibleShots = useMemo(() => safeContent.shots.filter((shot) => {
    const state = shotStateById.get(shot.id);
    if (!state) return filter === "all";
    if (filter === "unfinished") return !state.isFinished;
    if (filter === "candidates") return state.hasPendingCandidates;
    return true;
  }), [safeContent.shots, filter, shotStateById]);

  const visibleSceneGroups = useMemo(() => {
    const map = new Map<string, StoryboardShot[]>();
    for (const shot of visibleShots) {
      const group = map.get(shot.sceneId) ?? [];
      group.push(shot);
      map.set(shot.sceneId, group);
    }
    return Array.from(map.entries()).map(([sceneId, shots]) => ({ sceneId, heading: sceneHeadingMap.get(sceneId), shots }));
  }, [sceneHeadingMap, visibleShots]);

  const summary = useMemo(() => {
    let imageReady = 0;
    let videoReady = 0;
    let audioReady = 0;
    for (const shot of safeContent.shots) {
      const state = shotStateById.get(shot.id);
      if (!state) continue;
      if (state.hasImage) imageReady += 1;
      if (state.hasVideo) videoReady += 1;
      if (state.hasAudio) audioReady += 1;
    }
    return {
      sceneCount: getStoryboardSceneIds(safeContent).length,
      shotCount: safeContent.shots.length,
      duration: getStoryboardEstimatedDuration(safeContent),
      imageReady,
      videoReady,
      audioReady,
    };
  }, [safeContent, shotStateById]);

  useEffect(() => {
    if (visibleShots.some((shot) => shot.id === selectedShotId)) return;
    setSelectedShotId(visibleShots[0]?.id ?? "");
  }, [selectedShotId, visibleShots]);

  const selectedShot = safeContent.shots.find((shot) => shot.id === selectedShotId) ?? visibleShots[0] ?? null;
  const selectedState = selectedShot ? shotStateById.get(selectedShot.id) ?? null : null;
  const selectedCharacters = selectedShot?.characterIds?.length ? selectedShot.characterIds : characters.map((character) => character.id);
  const selectedDraft = selectedShot ? (ttsDrafts[selectedShot.id] ?? {
    text: selectedShot.dialogue ?? "",
    characterId: selectedShot.characterIds?.[0] ?? "",
  }) : null;
  const selectedVoice = selectedDraft?.characterId ? voiceConfigsByCharacterId.get(selectedDraft.characterId) : undefined;

  function updateContent(mutator: (current: StoryboardContent) => StoryboardContent) {
    if (!onChange) return;
    onChange(mutator(safeContent));
  }

  function updateShot(shotId: string, patch: Partial<StoryboardShot>) {
    updateContent((current) => ({
      ...current,
      shots: current.shots.map((shot) => (shot.id === shotId ? { ...shot, ...patch } : shot)),
    }));
  }

  function addScene() {
    const sceneId = newSceneId.trim() || `scene-${getStoryboardSceneIds(safeContent).length + 1}`;
    const shot = createEmptyShot(sceneId, 0);
    updateContent((current) => ({ ...current, shots: [...current.shots, shot] }));
    setSelectedShotId(shot.id);
    setNewSceneId("");
  }

  function addShot(sceneId: string) {
    const sceneShots = safeContent.shots.filter((shot) => shot.sceneId === sceneId);
    const shot = createEmptyShot(sceneId, sceneShots.length);
    const insertIndex = safeContent.shots.reduce((lastIndex, currentShot, index) => currentShot.sceneId === sceneId ? index : lastIndex, -1);
    updateContent((current) => {
      const shots = [...current.shots];
      shots.splice(insertIndex + 1, 0, shot);
      return { ...current, shots };
    });
    setSelectedShotId(shot.id);
  }

  function moveShot(shotId: string, direction: -1 | 1) {
    updateContent((current) => {
      const index = current.shots.findIndex((shot) => shot.id === shotId);
      const target = index + direction;
      if (index < 0 || target < 0 || target >= current.shots.length) return current;
      const shots = [...current.shots];
      [shots[index], shots[target]] = [shots[target], shots[index]];
      return { ...current, shots };
    });
  }

  function removeShot(shotId: string) {
    updateContent((current) => ({ ...current, shots: current.shots.filter((shot) => shot.id !== shotId) }));
  }

  async function invalidateWorkspace() {
    if (!projectId) return;
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.project(projectId) }),
      queryClient.invalidateQueries({ queryKey: queryKeys.projectVersions(projectId) }),
      queryClient.invalidateQueries({ queryKey: queryKeys.projectJobs(projectId) }),
    ]);
  }

  function requireProjectId() {
    if (!projectId) throw new Error("Project context is required");
    return projectId;
  }

  function setMutationError(error: unknown) {
    setFeedback({ message: null, error: formatApiError(error, t, "projectWorkspace.feedback.mediaJobFailed") });
  }

  const generateImage = useMutation({
    mutationFn: async ({ shotId, prompt }: { shotId: string; prompt?: string }) => apiFetch(`/shots/${shotId}/image-jobs`, {
      method: "POST",
      body: {
        projectId: requireProjectId(),
        style: "cinematic",
        aspectRatio: "16:9",
        configSource: imageConfigSource,
        prompt: prompt || undefined,
      },
    }),
    onSuccess: async () => {
      setFeedback({ message: t("projectWorkspace.feedback.mediaJobSuccess", { label: "Image", jobId: "queued" }), error: null });
      await invalidateWorkspace();
    },
    onError: setMutationError,
  });

  const generateVideo = useMutation({
    mutationFn: async ({ shotId, prompt, referenceImageAssetId }: { shotId: string; prompt?: string; referenceImageAssetId?: string }) => apiFetch(`/shots/${shotId}/video-jobs`, {
      method: "POST",
      body: {
        projectId: requireProjectId(),
        style: "cinematic",
        aspectRatio: "16:9",
        durationSeconds: 5,
        prompt: prompt || undefined,
        referenceImageAssetId,
      },
    }),
    onSuccess: async () => {
      setFeedback({ message: t("projectWorkspace.feedback.mediaJobSuccess", { label: "Video", jobId: "queued" }), error: null });
      await invalidateWorkspace();
    },
    onError: setMutationError,
  });

  const generateTts = useMutation({
    mutationFn: async ({ shotId, characterId, text }: { shotId: string; characterId: string; text: string }) => apiFetch(`/shots/${shotId}/tts-jobs`, {
      method: "POST",
      body: { projectId: requireProjectId(), characterId, text },
    }),
    onSuccess: async () => {
      setFeedback({ message: t("projectWorkspace.feedback.mediaJobSuccess", { label: "TTS", jobId: "queued" }), error: null });
      await invalidateWorkspace();
    },
    onError: setMutationError,
  });

  const batchGenerateMissingImages = useMutation({
    mutationFn: async () => apiFetch(`/projects/${requireProjectId()}/batch-image-jobs`, {
      method: "POST",
      body: {
        shotIds: safeContent.shots.filter((shot) => !shotStateById.get(shot.id)?.hasImage).map((shot) => shot.id),
      },
    }),
    onSuccess: async () => {
      setFeedback({ message: "Batch image job queued.", error: null });
      await invalidateWorkspace();
    },
    onError: setMutationError,
  });

  const batchSceneTts = useMutation({
    mutationFn: async ({ sceneId, shotIds }: { sceneId: string; shotIds: string[] }) => apiFetch(`/scenes/${sceneId}/batch-tts-jobs`, {
      method: "POST",
      body: { projectId: requireProjectId(), shotIds },
    }),
    onSuccess: async () => {
      setFeedback({ message: "Scene batch TTS queued.", error: null });
      await invalidateWorkspace();
    },
    onError: setMutationError,
  });

  const adoptVersion = useMutation({
    mutationFn: async ({ documentId, versionId }: { documentId: string; versionId: string }) => apiFetch(`/documents/${documentId}/adopt-version`, {
      method: "POST",
      body: { versionId },
    }),
    onSuccess: async () => {
      setFeedback({ message: "Candidate adopted.", error: null });
      await invalidateWorkspace();
    },
    onError: setMutationError,
  });

  function renderVisualCell(shot: StoryboardShot) {
    if (!editable) {
      return <div className="swb-cell-copy">{getStoryboardShotVisualSummary(shot) || <span className="muted">-</span>}</div>;
    }

    return (
      <div className="swb-cell-stack">
        <textarea
          className="input swb-cell-textarea"
          rows={2}
          value={shot.visualDescription}
          onChange={(event) => updateShot(shot.id, { visualDescription: event.target.value })}
          placeholder="Composition, light, subject"
        />
        <textarea
          className="input swb-cell-textarea swb-cell-textarea--subtle"
          rows={2}
          value={shot.actionDescription ?? ""}
          onChange={(event) => updateShot(shot.id, { actionDescription: event.target.value })}
          placeholder={copy.actionDescription}
        />
      </div>
    );
  }

  function renderAudioCell(shot: StoryboardShot) {
    if (!editable) {
      return <div className="swb-cell-copy">{getStoryboardShotAudioSummary(shot) || <span className="muted">-</span>}</div>;
    }

    return (
      <div className="swb-cell-stack">
        <textarea
          className="input swb-cell-textarea"
          rows={2}
          value={shot.dialogue ?? ""}
          onChange={(event) => updateShot(shot.id, { dialogue: event.target.value })}
          placeholder={t("storyboardEditor.dialoguePlaceholder")}
        />
        <textarea
          className="input swb-cell-textarea swb-cell-textarea--subtle"
          rows={2}
          value={shot.soundDesign ?? ""}
          onChange={(event) => updateShot(shot.id, { soundDesign: event.target.value })}
          placeholder={t("storyboardEditor.soundDesignPlaceholder")}
        />
      </div>
    );
  }

  function updateTtsDraft(field: "text" | "characterId", value: string) {
    if (!selectedShot) return;
    setTtsDrafts((current) => ({
      ...current,
      [selectedShot.id]: {
        text: field === "text" ? value : selectedDraft?.text ?? selectedShot.dialogue ?? "",
        characterId: field === "characterId" ? value : selectedDraft?.characterId ?? selectedShot.characterIds?.[0] ?? "",
      },
    }));
  }
  return (
    <div className={`swb-root${editable ? " swb-root--editable" : ""}`}>
      <div className="swb-overview">
        <div className="swb-overview__header">
          <div>
            <p className="swb-overview__eyebrow">{copy.title}</p>
            <h3>{copy.subtitle}</h3>
          </div>
          <InlineFeedback message={feedback.message} error={feedback.error} />
        </div>
        {editable ? (
          <textarea
            className="input swb-overview__input"
            rows={3}
            value={safeContent.overview}
            onChange={(event) => updateContent((current) => ({ ...current, overview: event.target.value }))}
            placeholder={t("storyboardEditor.overviewPlaceholder")}
          />
        ) : (
          <p className="swb-overview__copy">{safeContent.overview || copy.overviewFallback}</p>
        )}
      </div>

      <div className="swb-summary">
        <div className="swb-summary__stats">
          <div className="swb-stat"><span>{copy.stats.scenes}</span><strong>{summary.sceneCount}</strong></div>
          <div className="swb-stat"><span>{copy.stats.shots}</span><strong>{summary.shotCount}</strong></div>
          <div className="swb-stat"><span>{copy.stats.duration}</span><strong>{formatDuration(summary.duration, language)}</strong></div>
          <div className="swb-stat"><span>{copy.stats.images}</span><strong>{summary.imageReady}</strong></div>
          <div className="swb-stat"><span>{copy.stats.videos}</span><strong>{summary.videoReady}</strong></div>
          <div className="swb-stat"><span>{copy.stats.audios}</span><strong>{summary.audioReady}</strong></div>
        </div>
        <div className="swb-summary__actions">
          <div className="swb-filter-row">
            <button className={`swb-filter-chip${filter === "all" ? " swb-filter-chip--active" : ""}`} type="button" onClick={() => setFilter("all")}>{copy.filters.all}</button>
            <button className={`swb-filter-chip${filter === "unfinished" ? " swb-filter-chip--active" : ""}`} type="button" onClick={() => setFilter("unfinished")}>{copy.filters.unfinished}</button>
            <button className={`swb-filter-chip${filter === "candidates" ? " swb-filter-chip--active" : ""}`} type="button" onClick={() => setFilter("candidates")}>{copy.filters.candidates}</button>
          </div>
          {editable ? (
            <div className="swb-scene-create">
              <input className="input" value={newSceneId} onChange={(event) => setNewSceneId(event.target.value)} placeholder={t("storyboardEditor.newSceneIdPlaceholder")} />
              <button className="btn btn-secondary btn-sm" type="button" onClick={addScene}>{copy.addScene}</button>
            </div>
          ) : null}
          {canUseProject ? (
            <div className="swb-batch-actions">
              <label className="swb-inline-select">
                <span>{t("projectWorkspace.media.imageConfigSourceLabel")}</span>
                <select value={imageConfigSource} onChange={(event) => setImageConfigSource(event.target.value as ImageConfigSource)} disabled={!canMutateProject}>
                  <option value="team">{t("projectWorkspace.media.imageConfigSourceTeam")}</option>
                  <option value="personal">{t("projectWorkspace.media.imageConfigSourcePersonal")}</option>
                </select>
              </label>
              <button
                className="btn btn-primary btn-sm"
                type="button"
                disabled={!canMutateProject || batchGenerateMissingImages.isPending || safeContent.shots.every((shot) => shotStateById.get(shot.id)?.hasImage)}
                onClick={() => batchGenerateMissingImages.mutate()}
              >
                {batchGenerateMissingImages.isPending ? t("common.submitting") : t("projectWorkspace.media.batchGenerateMissingImages")}
              </button>
            </div>
          ) : null}
        </div>
      </div>

      {canUseProject && visibleSceneGroups.length > 0 ? (
        <div className="swb-scene-batches">
          <span className="swb-scene-batches__label">{copy.sceneBatch}</span>
          <div className="swb-scene-batches__list">
            {visibleSceneGroups.map((group) => {
              const eligibleShotIds = group.shots.filter((shot) => Boolean(shot.dialogue?.trim())).map((shot) => shot.id);
              return (
                <button
                  key={group.sceneId}
                  className="btn btn-ghost btn-sm"
                  type="button"
                  disabled={!canMutateProject || batchSceneTts.isPending || eligibleShotIds.length === 0}
                  onClick={() => batchSceneTts.mutate({ sceneId: group.sceneId, shotIds: eligibleShotIds })}
                >
                  {(group.heading || group.sceneId).slice(0, 24)}
                </button>
              );
            })}
          </div>
        </div>
      ) : null}

      <div className="swb-shell">
        <div className="swb-board">
          {visibleSceneGroups.length === 0 ? (
            <div className="swb-empty">
              <p>{safeContent.shots.length === 0 ? copy.noShots : copy.noFilteredShots}</p>
              {editable && safeContent.shots.length === 0 ? <button className="btn btn-primary btn-sm" type="button" onClick={addScene}>{copy.createFirstShot}</button> : null}
            </div>
          ) : visibleSceneGroups.map((group, groupIndex) => (
            <section key={group.sceneId} className="swb-scene">
              <header className="swb-scene__header">
                <div>
                  <span className="swb-scene__index">{t("storyboardEditor.scenePrefix")} {groupIndex + 1}</span>
                  <h4>{group.heading || copy.sceneFallback}</h4>
                  <p>{group.sceneId}</p>
                </div>
                {editable ? <button className="btn btn-ghost btn-sm" type="button" onClick={() => addShot(group.sceneId)}>{copy.addShot}</button> : null}
              </header>

              <div className="swb-table-wrap">
                <table className="swb-table">
                  <thead>
                    <tr>
                      <th>{t("storyboardEditor.shotLabelField")}</th>
                      <th>{t("storyboardEditor.framingLabel")}</th>
                      <th>{t("storyboardEditor.cameraMoveLabel")}</th>
                      <th>{copy.columns.visual}</th>
                      <th>{copy.columns.audio}</th>
                      <th>{t("storyboardEditor.durationLabel")}</th>
                      <th>{copy.columns.notes}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {group.shots.map((shot) => {
                      const isSelected = selectedShot?.id === shot.id;
                      return (
                        <tr key={shot.id} className={`swb-table__row${isSelected ? " swb-table__row--selected" : ""}`} onClick={() => setSelectedShotId(shot.id)}>
                          <td>
                            {editable ? (
                              <input className="input swb-cell-input" value={shot.shotLabel} onChange={(event) => updateShot(shot.id, { shotLabel: event.target.value })} />
                            ) : (
                              <div className="swb-shot-anchor"><strong>{shot.shotLabel}</strong>{isSelected ? <span>{copy.selected}</span> : null}</div>
                            )}
                          </td>
                          <td>
                            {editable ? (
                              <select className="input swb-cell-input" value={shot.framing} onChange={(event) => updateShot(shot.id, { framing: event.target.value })}>
                                {STORYBOARD_FRAMING_OPTIONS.map((option) => <option key={option} value={option}>{getStoryboardFramingLabel(option, locale === "en" ? "en" : "zh-CN")}</option>)}
                              </select>
                            ) : <span className="swb-token">{getStoryboardFramingLabel(shot.framing, locale === "en" ? "en" : "zh-CN")}</span>}
                          </td>
                          <td>
                            {editable ? (
                              <select className="input swb-cell-input" value={shot.cameraMove} onChange={(event) => updateShot(shot.id, { cameraMove: event.target.value })}>
                                {STORYBOARD_CAMERA_MOVE_OPTIONS.map((option) => <option key={option} value={option}>{getStoryboardCameraMoveLabel(option, locale === "en" ? "en" : "zh-CN")}</option>)}
                              </select>
                            ) : <span className="swb-token swb-token--subtle">{getStoryboardCameraMoveLabel(shot.cameraMove, locale === "en" ? "en" : "zh-CN")}</span>}
                          </td>
                          <td>{renderVisualCell(shot)}</td>
                          <td>{renderAudioCell(shot)}</td>
                          <td>
                            {editable ? (
                              <input className="input swb-cell-input" type="number" min={1} step={1} value={shot.durationSeconds} onChange={(event) => updateShot(shot.id, { durationSeconds: Number(event.target.value) || 1 })} />
                            ) : <span>{formatDuration(shot.durationSeconds, language)}</span>}
                          </td>
                          <td>
                            {editable ? (
                              <textarea className="input swb-cell-textarea swb-cell-textarea--compact" rows={3} value={shot.notes ?? ""} onChange={(event) => updateShot(shot.id, { notes: event.target.value })} placeholder={copy.columns.notes} />
                            ) : <div className="swb-cell-copy">{shot.notes || <span className="muted">-</span>}</div>}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              <div className="swb-mobile-list">
                {group.shots.map((shot) => {
                  const isSelected = selectedShot?.id === shot.id;
                  return (
                    <button key={shot.id} className={`swb-mobile-card${isSelected ? " swb-mobile-card--selected" : ""}`} type="button" onClick={() => setSelectedShotId(shot.id)}>
                      <div className="swb-mobile-card__top"><strong>{shot.shotLabel}</strong><span>{formatDuration(shot.durationSeconds, language)}</span></div>
                      <div className="swb-mobile-card__meta"><span>{getStoryboardFramingLabel(shot.framing, locale === "en" ? "en" : "zh-CN")}</span><span>{getStoryboardCameraMoveLabel(shot.cameraMove, locale === "en" ? "en" : "zh-CN")}</span></div>
                      <div className="swb-mobile-card__body">
                        <div><span>{copy.columns.visual}</span><p>{getStoryboardShotVisualSummary(shot) || "-"}</p></div>
                        <div><span>{copy.columns.audio}</span><p>{getStoryboardShotAudioSummary(shot) || "-"}</p></div>
                  {editable ? <textarea className="input" rows={3} value={selectedShot.notes ?? ""} onChange={(event) => updateShot(selectedShot.id, { notes: event.target.value })} /> : <div className="swb-static-field">{selectedShot.notes || "-"}</div>}
                      </div>
                    </button>
                  );
                })}
              </div>
            </section>
          ))}
        </div>

        <aside className="swb-inspector">
          {selectedShot ? (
            <>
              <div className="swb-inspector__header">
                <div>
                  <p className="swb-inspector__eyebrow">{copy.inspector}</p>
                  <h3>{selectedShot.shotLabel}</h3>
                  <p>{sceneHeadingMap.get(selectedShot.sceneId) || copy.sceneFallback}<span> / {selectedShot.sceneId}</span></p>
                </div>
                {!canMutateProject && canUseProject ? <span className="swb-token swb-token--subtle">{copy.readonly}</span> : null}
              </div>

              <div className="swb-panel">
                <div className="swb-panel__header"><h4>{copy.adoptedMedia}</h4></div>
                <div className="swb-preview">
                  {(selectedState?.currentVideo?.content as MediaVersionContent | undefined)?.assetUrl ? (
                    <video controls playsInline className="swb-preview__media"><source src={(selectedState?.currentVideo?.content as MediaVersionContent | undefined)?.assetUrl} type={(selectedState?.currentVideo?.content as MediaVersionContent | undefined)?.mimeType ?? "video/mp4"} /></video>
                  ) : (selectedState?.currentImage?.content as MediaVersionContent | undefined)?.assetUrl ? (
                    <img className="swb-preview__media" src={(selectedState?.currentImage?.content as MediaVersionContent | undefined)?.assetUrl} alt={selectedShot.shotLabel} />
                  ) : (
                    <div className="swb-preview__empty">{copy.emptyMedia}</div>
                  )}
                </div>
                {(selectedState?.currentAudio?.content as MediaVersionContent | undefined)?.assetUrl ? <audio controls src={(selectedState?.currentAudio?.content as MediaVersionContent | undefined)?.assetUrl} className="swb-audio-player" /> : null}
              </div>

              {canUseProject ? (
                <>
                  <div className="swb-panel">
                    <div className="swb-panel__header"><h4>{copy.production}</h4></div>
                    <div className="swb-production-actions">
                      <button className="btn btn-secondary btn-sm" type="button" disabled={!canMutateProject || generateImage.isPending} onClick={() => generateImage.mutate({ shotId: selectedShot.id, prompt: selectedShot.imagePrompt })}>{generateImage.isPending ? t("common.submitting") : t("projectWorkspace.media.genImage")}</button>
                      <button className="btn btn-primary btn-sm" type="button" disabled={!canMutateProject || generateVideo.isPending} onClick={() => generateVideo.mutate({ shotId: selectedShot.id, prompt: selectedShot.videoPrompt, referenceImageAssetId: (selectedState?.currentImage?.content as MediaVersionContent | undefined)?.assetId })}>{generateVideo.isPending ? t("common.submitting") : t("projectWorkspace.media.genVideo")}</button>
                      <button className="btn btn-ghost btn-sm" type="button" disabled={!canMutateProject || !selectedDraft?.characterId || !selectedDraft.text.trim() || generateTts.isPending} onClick={() => selectedDraft && generateTts.mutate({ shotId: selectedShot.id, characterId: selectedDraft.characterId, text: selectedDraft.text.trim() })}>{generateTts.isPending ? t("common.submitting") : copy.generateTts}</button>
                    </div>
                  </div>

                  <div className="swb-panel">
                    <div className="swb-panel__header"><h4>{copy.jobStatus}</h4></div>
                    <div className="swb-status-list">
                      <StatusRow label="Image" job={selectedState?.jobs.image} formatDate={formatDate} statusLabel={(status) => getJobStatusLabel(t, status)} emptyLabel={copy.noJob} />
                      <StatusRow label="Video" job={selectedState?.jobs.video} formatDate={formatDate} statusLabel={(status) => getJobStatusLabel(t, status)} emptyLabel={copy.noJob} />
                      <StatusRow label="TTS" job={selectedState?.jobs.tts} formatDate={formatDate} statusLabel={(status) => getJobStatusLabel(t, status)} emptyLabel={copy.noJob} />
                    </div>
                  </div>
                </>
              ) : null}

              <div className="swb-panel">
                <div className="swb-panel__header"><h4>{copy.ttsPanel}</h4></div>
                <label className="swb-field"><span className="swb-field__label">{copy.ttsCharacter}</span>
                  <select className="input" value={selectedDraft?.characterId ?? ""} onChange={(event) => updateTtsDraft("characterId", event.target.value)}>
                    {selectedCharacters.length === 0 ? <option value="">{copy.noCharacter}</option> : null}
                    {selectedCharacters.map((characterId) => <option key={characterId} value={characterId}>{charactersById.get(characterId)?.name ?? characterId}</option>)}
                  </select>
                </label>
                <label className="swb-field"><span className="swb-field__label">{copy.voice}</span><div className="swb-static-field">{(selectedState?.currentAudio?.content as MediaVersionContent | undefined)?.voiceName ?? selectedVoice?.voiceName ?? copy.noCharacter}</div></label>
                <label className="swb-field"><span className="swb-field__label">{copy.ttsText}</span>
                  <textarea className="input" rows={4} value={selectedDraft?.text ?? ""} onChange={(event) => updateTtsDraft("text", event.target.value)} placeholder={t("storyboardEditor.dialoguePlaceholder")} />
                </label>
              </div>

              <div className="swb-panel">
                <div className="swb-panel__header"><h4>{copy.promptPanel}</h4></div>
                <label className="swb-field"><span className="swb-field__label">{copy.characterIds}</span>
                  {editable ? <input className="input" value={selectedShot.characterIds?.join(", ") ?? ""} onChange={(event) => updateShot(selectedShot.id, { characterIds: event.target.value.split(",").map((item) => item.trim()).filter(Boolean) })} /> : <div className="swb-static-field">{(selectedShot.characterIds ?? []).map((characterId) => charactersById.get(characterId)?.name ?? characterId).join(", ") || "-"}</div>}
                </label>
                <label className="swb-field"><span className="swb-field__label">{copy.actionDescription}</span>
                  {editable ? <textarea className="input" rows={3} value={selectedShot.actionDescription ?? ""} onChange={(event) => updateShot(selectedShot.id, { actionDescription: event.target.value })} /> : <div className="swb-static-field">{selectedShot.actionDescription || "-"}</div>}
                </label>
                <label className="swb-field"><span className="swb-field__label">{copy.columns.notes}</span>
                  {editable ? <textarea className="input" rows={3} value={selectedShot.notes ?? ""} onChange={(event) => updateShot(selectedShot.id, { notes: event.target.value })} /> : <div className="swb-static-field">{selectedShot.notes || "-"}</div>}
                </label>
                <label className="swb-field"><span className="swb-field__label">{copy.imagePrompt}</span>
                  {editable ? <textarea className="input" rows={4} value={selectedShot.imagePrompt ?? ""} onChange={(event) => updateShot(selectedShot.id, { imagePrompt: event.target.value })} /> : <div className="swb-static-field swb-static-field--mono">{selectedShot.imagePrompt || "-"}</div>}
                </label>
                <label className="swb-field"><span className="swb-field__label">{copy.videoPrompt}</span>
                  {editable ? <textarea className="input" rows={4} value={selectedShot.videoPrompt ?? ""} onChange={(event) => updateShot(selectedShot.id, { videoPrompt: event.target.value })} /> : <div className="swb-static-field swb-static-field--mono">{selectedShot.videoPrompt || "-"}</div>}
                </label>
              </div>

              {canUseProject ? (
                <>
                  <CandidateList
                    title={copy.imageCandidates}
                    candidates={selectedState?.imageCandidates ?? []}
                    currentVersionId={selectedState?.imageDocument?.currentVersionId}
                    onAdopt={(versionId) => selectedState?.imageDocument && adoptVersion.mutate({ documentId: selectedState.imageDocument.id, versionId })}
                    canAdopt={Boolean(canMutateProject && selectedState?.imageDocument)}
                    isPending={adoptVersion.isPending}
                    emptyLabel={copy.emptyCandidates}
                    adoptLabel={copy.adopt}
                    adoptedLabel={copy.adopted}
                  />
                  <CandidateList
                    title={copy.videoCandidates}
                    candidates={selectedState?.videoCandidates ?? []}
                    currentVersionId={selectedState?.videoDocument?.currentVersionId}
                    onAdopt={(versionId) => selectedState?.videoDocument && adoptVersion.mutate({ documentId: selectedState.videoDocument.id, versionId })}
                    canAdopt={Boolean(canMutateProject && selectedState?.videoDocument)}
                    isPending={adoptVersion.isPending}
                    emptyLabel={copy.emptyCandidates}
                    adoptLabel={copy.adopt}
                    adoptedLabel={copy.adopted}
                  />
                </>
              ) : null}

              {editable ? (
                <div className="swb-panel swb-panel--danger">
                  <div className="swb-panel__header"><h4>{copy.inspector}</h4></div>
                  <div className="swb-editor-actions">
                    <button className="btn btn-ghost btn-sm" type="button" onClick={() => moveShot(selectedShot.id, -1)}>{copy.moveUp}</button>
                    <button className="btn btn-ghost btn-sm" type="button" onClick={() => moveShot(selectedShot.id, 1)}>{copy.moveDown}</button>
                    <button className="btn btn-danger btn-sm" type="button" onClick={() => removeShot(selectedShot.id)}>{copy.deleteShot}</button>
                  </div>
                </div>
              ) : null}
            </>
          ) : (
            <div className="swb-empty swb-empty--inspector"><p>{copy.noSelection}</p></div>
          )}
        </aside>
      </div>
    </div>
  );
}
