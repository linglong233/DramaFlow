/**
 * @fileoverview 分镜工作台
 * @module web/components/project-workspace
 *
 * 完整的分镜管理工作台，包含场景列表、镜头卡片和详情面板。
 */

"use client";

import { useEffect, useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { ImageConfigSource, ProjectWorkspacePayload, StoryboardContent, StoryboardShot } from "@dramaflow/shared";
import {
  STORYBOARD_FRAMING_OPTIONS,
  getStoryboardEstimatedDuration,
  getStoryboardSceneIds,
  normalizeScriptContent,
  normalizeStoryboardContent,
  normalizeWorldBibleContent,
} from "@dramaflow/shared";

import { apiFetch, formatApiError } from "../../lib/api";
import { useFeedback } from "../../lib/hooks";
import { useI18n } from "../../lib/i18n";
import { queryKeys } from "../../lib/query-keys";
import { InlineFeedback } from "../inline-feedback";
import { ShotCard } from "./shot-card";
import { StoryboardToolbar } from "./storyboard-toolbar";
import { ShotDetailDrawer } from "./shot-detail-drawer";
import { useProviderEntries } from "./provider-selector";

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

export function StoryboardWorkbench({ content, onChange, projectId, project, allowProjectMutations = true }: Props) {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const editable = Boolean(onChange);
  const canUseProject = Boolean(projectId && project);
  const canMutateProject = canUseProject && allowProjectMutations;
  const safeContent = useMemo(() => normalizeStoryboardContent(content), [content]);
  const safeWorldBible = useMemo(() => normalizeWorldBibleContent(project?.worldBible), [project?.worldBible]);

  const [selectedShotId, setSelectedShotId] = useState(safeContent.shots[0]?.id ?? "");
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [filter, setFilter] = useState<ShotFilter>("all");
  const [imageConfigSource, setImageConfigSource] = useState<ImageConfigSource>("team");
  const [ttsDrafts, setTtsDrafts] = useState<Record<string, { text: string; characterId: string }>>({});
  const { feedback, setFeedback } = useFeedback();
  const [selectedImageProvider, setSelectedImageProvider] = useState<string | undefined>();
  const [selectedVideoProvider, setSelectedVideoProvider] = useState<string | undefined>();

  const providerEntries = useProviderEntries(imageConfigSource, project?.team?.id);

  const characters = safeWorldBible.characters;
  const voiceConfigs = safeWorldBible.voiceConfigs ?? [];

  const charactersById = useMemo(() => new Map(characters.map((c) => [c.id, c])), [characters]);
  const versionsById = useMemo(() => new Map((project?.versions ?? []).map((v) => [v.id, v])), [project?.versions]);

  const versionsByDocument = useMemo(() => {
    const map = new Map<string, ProjectWorkspacePayload["versions"]>();
    for (const version of project?.versions ?? []) {
      const group = map.get(version.documentId) ?? [];
      group.push(version);
      map.set(version.documentId, group);
    }
    for (const group of map.values()) {
      group.sort((a, b) => b.versionNumber - a.versionNumber);
    }
    return map;
  }, [project?.versions]);

  const documentsByShot = useMemo(() => {
    const map = new Map<string, { image?: ProjectWorkspacePayload["documents"][number]; video?: ProjectWorkspacePayload["documents"][number]; audio?: ProjectWorkspacePayload["documents"][number] }>();
    for (const doc of project?.documents ?? []) {
      if (!doc.shotId || (doc.type !== "image" && doc.type !== "video" && doc.type !== "audio")) continue;
      const entry = map.get(doc.shotId) ?? {};
      if (doc.type === "image") entry.image = doc;
      if (doc.type === "video") entry.video = doc;
      if (doc.type === "audio") entry.audio = doc;
      map.set(doc.shotId, entry);
    }
    return map;
  }, [project?.documents]);

  const latestJobsByShot = useMemo(() => {
    const map = new Map<string, ShotJobMap>();
    const sorted = [...(project?.jobs ?? [])].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    for (const job of sorted) {
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
    const scriptDoc = project.documents.find((d) => d.type === "script");
    const scriptVer = project.versions.find((v) => v.id === scriptDoc?.currentVersionId);
    if (!scriptVer) return map;
    const scriptScenes = normalizeScriptContent(scriptVer.content).scenes;
    for (const scene of scriptScenes) {
      map.set(scene.id, scene.heading);
    }
    // Index-based fallback: when AI-generated sceneIds don't match script scene IDs,
    // map storyboard scenes to script scenes by position order.
    const storyboardSceneIds = getStoryboardSceneIds(safeContent);
    for (let i = 0; i < storyboardSceneIds.length && i < scriptScenes.length; i++) {
      const sbSceneId = storyboardSceneIds[i];
      if (!map.has(sbSceneId) && scriptScenes[i].heading) {
        map.set(sbSceneId, scriptScenes[i].heading);
      }
    }
    return map;
  }, [project, safeContent]);

  const shotStateById = useMemo(() => {
    const map = new Map<string, ShotProjectState>();
    for (const shot of safeContent.shots) {
      const docs = documentsByShot.get(shot.id) ?? {};
      const currentImage = docs.image?.currentVersionId ? versionsById.get(docs.image.currentVersionId) ?? null : null;
      const currentVideo = docs.video?.currentVersionId ? versionsById.get(docs.video.currentVersionId) ?? null : null;
      const currentAudio = docs.audio?.currentVersionId ? versionsById.get(docs.audio.currentVersionId) ?? null : null;
      const imageCandidates = docs.image ? versionsByDocument.get(docs.image.id) ?? [] : [];
      const videoCandidates = docs.video ? versionsByDocument.get(docs.video.id) ?? [] : [];
      const hasImage = Boolean((currentImage?.content as MediaVersionContent | undefined)?.assetUrl);
      const hasVideo = Boolean((currentVideo?.content as MediaVersionContent | undefined)?.assetUrl);
      const hasAudio = Boolean((currentAudio?.content as MediaVersionContent | undefined)?.assetUrl);
      const requiresTts = Boolean(shot.dialogue?.trim());
      const hasPendingCandidates = imageCandidates.some((c) => c.id !== docs.image?.currentVersionId)
        || videoCandidates.some((c) => c.id !== docs.video?.currentVersionId);

      map.set(shot.id, {
        imageDocument: docs.image ?? null,
        videoDocument: docs.video ?? null,
        audioDocument: docs.audio ?? null,
        currentImage, currentVideo, currentAudio,
        imageCandidates, videoCandidates,
        jobs: latestJobsByShot.get(shot.id) ?? {},
        hasImage, hasVideo, hasAudio,
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

  // Keep selectedShotId valid when filter changes
  useEffect(() => {
    if (visibleShots.some((s) => s.id === selectedShotId)) return;
    setSelectedShotId(visibleShots[0]?.id ?? "");
  }, [selectedShotId, visibleShots]);

  const selectedShot = safeContent.shots.find((s) => s.id === selectedShotId) ?? visibleShots[0] ?? null;
  const selectedState = selectedShot ? shotStateById.get(selectedShot.id) ?? null : null;
  const selectedDraft = selectedShot ? (ttsDrafts[selectedShot.id] ?? {
    text: selectedShot.dialogue ?? "",
    characterId: selectedShot.characterIds?.[0] ?? "",
  }) : null;

  // Selected scene for toolbar
  const selectedSceneId = selectedShot?.sceneId ?? visibleSceneGroups[0]?.sceneId ?? "";

  // Prev/next navigation within the visible shots list
  const selectedIndex = visibleShots.findIndex((s) => s.id === selectedShotId);
  const hasPrev = selectedIndex > 0;
  const hasNext = selectedIndex >= 0 && selectedIndex < visibleShots.length - 1;

  function updateContent(mutator: (current: StoryboardContent) => StoryboardContent) {
    if (!onChange) return;
    onChange(mutator(safeContent));
  }

  function updateShot(shotId: string, patch: Partial<StoryboardShot>) {
    updateContent((current) => ({
      ...current,
      shots: current.shots.map((s) => (s.id === shotId ? { ...s, ...patch } : s)),
    }));
  }

  function addScene(sceneId: string) {
    const shot = createEmptyShot(sceneId, 0);
    updateContent((current) => ({ ...current, shots: [...current.shots, shot] }));
    setSelectedShotId(shot.id);
  }

  function addShot(sceneId: string) {
    const sceneShots = safeContent.shots.filter((s) => s.sceneId === sceneId);
    const shot = createEmptyShot(sceneId, sceneShots.length);
    const insertIndex = safeContent.shots.reduce((last, s, i) => s.sceneId === sceneId ? i : last, -1);
    updateContent((current) => {
      const shots = [...current.shots];
      shots.splice(insertIndex + 1, 0, shot);
      return { ...current, shots };
    });
    setSelectedShotId(shot.id);
  }

  function moveShot(shotId: string, direction: -1 | 1) {
    updateContent((current) => {
      const index = current.shots.findIndex((s) => s.id === shotId);
      const target = index + direction;
      if (index < 0 || target < 0 || target >= current.shots.length) return current;
      const shots = [...current.shots];
      [shots[index], shots[target]] = [shots[target], shots[index]];
      return { ...current, shots };
    });
  }

  function removeShot(shotId: string) {
    updateContent((current) => ({ ...current, shots: current.shots.filter((s) => s.id !== shotId) }));
    setDrawerOpen(false);
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
      body: { projectId: requireProjectId(), style: "cinematic", aspectRatio: "16:9", configSource: imageConfigSource, prompt: prompt || undefined, providerId: selectedImageProvider },
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
      body: { projectId: requireProjectId(), style: "cinematic", aspectRatio: "16:9", durationSeconds: 5, prompt: prompt || undefined, referenceImageAssetId, providerId: selectedVideoProvider },
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
        shotIds: safeContent.shots.filter((s) => !shotStateById.get(s.id)?.hasImage).map((s) => s.id),
        configSource: imageConfigSource,
        providerId: selectedImageProvider,
      },
    }),
    onSuccess: async () => {
      setFeedback({ message: "Batch image job queued.", error: null });
      await invalidateWorkspace();
    },
    onError: setMutationError,
  });

  const batchSceneTts = useMutation({
    mutationFn: async () => {
      const sceneShots = safeContent.shots.filter((s) => s.sceneId === selectedSceneId);
      const eligibleShotIds = sceneShots.filter((s) => s.dialogue?.trim() && s.characterIds?.[0]).map((s) => s.id);
      return apiFetch(`/scenes/${selectedSceneId}/batch-tts-jobs`, {
        method: "POST",
        body: { projectId: requireProjectId(), shotIds: eligibleShotIds },
      });
    },
    onSuccess: async () => {
      setFeedback({ message: t("projectWorkspace.feedback.mediaJobSuccess", { label: "TTS", jobId: "queued" }), error: null });
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

  return (
    <div className="swb-root-v2">
      {/* Feedback */}
      <InlineFeedback message={feedback.message} error={feedback.error} />

      {/* Toolbar */}
      <StoryboardToolbar
        content={safeContent}
        editable={editable}
        canMutateProject={canMutateProject}
        filter={filter}
        onFilterChange={setFilter}
        onAddScene={addScene}
        onAddShot={addShot}
        onBatchGenerateImages={() => batchGenerateMissingImages.mutate()}
        isBatchPending={batchGenerateMissingImages.isPending}
        allImagesReady={safeContent.shots.every((s) => shotStateById.get(s.id)?.hasImage)}
        imageConfigSource={imageConfigSource}
        onImageConfigSourceChange={setImageConfigSource}
        sceneGroups={visibleSceneGroups.map((g) => ({ sceneId: g.sceneId, heading: g.heading }))}
        selectedSceneId={selectedSceneId}
        onSceneSelect={(sceneId) => {
          const firstShot = visibleShots.find((s) => s.sceneId === sceneId);
          if (firstShot) setSelectedShotId(firstShot.id);
        }}
        onBatchSceneTts={() => batchSceneTts.mutate()}
        isBatchTtsPending={batchSceneTts.isPending}
        hasEligibleTtsShots={safeContent.shots.filter((s) => s.sceneId === selectedSceneId).some((s) => s.dialogue?.trim() && s.characterIds?.[0])}
      />

      {/* Card grid */}
      <div className="swb-grid-scroll">
        {visibleSceneGroups.length === 0 ? (
          <div className="swb-empty">
            <p>{safeContent.shots.length === 0 ? t("storyboardWorkbench.noShotsYet") : t("storyboardWorkbench.noShotsMatchFilter")}</p>
            {editable && safeContent.shots.length === 0 && (
              <button className="btn btn-primary btn-sm" type="button" onClick={() => addScene(`scene-1`)}>
                {t("storyboardWorkbench.createFirstShot")}
              </button>
            )}
          </div>
        ) : (
          visibleSceneGroups.map((group, groupIndex) => (
            <div key={group.sceneId} className="swb-scene-group">
              <div className="swb-scene-group__header">
                <span className="swb-scene-group__index">{t("storyboardToolbar.scenePrefix", { index: String(groupIndex + 1) })}</span>
                <h4 className="swb-scene-group__heading">{group.heading || t("storyboardToolbar.untitledScene")}</h4>
                {editable && (
                  <button className="btn btn-ghost btn-sm" type="button" onClick={() => addShot(group.sceneId)}>
                    {t("storyboardWorkbench.addShot")}
                  </button>
                )}
              </div>
              <div className="swb-card-grid">
                {group.shots.map((shot) => {
                  const state = shotStateById.get(shot.id) ?? null;
                  const isSelected = selectedShot?.id === shot.id;
                  return (
                    <ShotCard
                      key={shot.id}
                      shot={shot}
                      state={state}
                      isSelected={isSelected}
                      onClick={() => {
                        setSelectedShotId(shot.id);
                        setDrawerOpen(true);
                      }}
                    />
                  );
                })}
              </div>
            </div>
          ))
        )}
      </div>

      {/* Detail drawer */}
      {drawerOpen && selectedShot && (
        <ShotDetailDrawer
          shot={selectedShot}
          state={selectedState}
          editable={editable}
          canMutateProject={canMutateProject}
          canUseProject={canUseProject}
          characters={characters.map((c) => ({ id: c.id, name: c.name }))}
          voiceConfigs={voiceConfigs.map((v) => ({ characterId: v.characterId, voiceName: v.voiceName }))}
          sceneHeadingMap={sceneHeadingMap}
          onShotUpdate={updateShot}
          onGenerateImage={(shotId, prompt) => generateImage.mutate({ shotId, prompt })}
          onGenerateVideo={(shotId, prompt, ref) => generateVideo.mutate({ shotId, prompt, referenceImageAssetId: ref })}
          onGenerateTts={(shotId, characterId, text) => generateTts.mutate({ shotId, characterId, text })}
          onAdoptVersion={(documentId, versionId) => adoptVersion.mutate({ documentId, versionId })}
          onMoveShot={moveShot}
          onRemoveShot={removeShot}
          isImagePending={generateImage.isPending}
          isVideoPending={generateVideo.isPending}
          isTtsPending={generateTts.isPending}
          isAdoptPending={adoptVersion.isPending}
          hasPrev={hasPrev}
          hasNext={hasNext}
          onPrev={() => {
            const prev = visibleShots[selectedIndex - 1];
            if (prev) setSelectedShotId(prev.id);
          }}
          onNext={() => {
            const next = visibleShots[selectedIndex + 1];
            if (next) setSelectedShotId(next.id);
          }}
          onClose={() => setDrawerOpen(false)}
          ttsDraft={selectedDraft}
          onTtsDraftChange={updateTtsDraft}
          imageProviders={providerEntries.imageProviders}
          videoProviders={providerEntries.videoProviders}
          defaultImageProvider={providerEntries.defaultImageProvider}
          defaultVideoProvider={providerEntries.defaultVideoProvider}
          selectedImageProvider={selectedImageProvider}
          selectedVideoProvider={selectedVideoProvider}
          onSelectedImageProviderChange={setSelectedImageProvider}
          onSelectedVideoProviderChange={setSelectedVideoProvider}
        />
      )}
    </div>
  );
}
