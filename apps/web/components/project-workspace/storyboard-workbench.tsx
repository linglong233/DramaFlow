/**
 * @fileoverview 分镜工作台
 * @module web/components/project-workspace
 *
 * 完整的分镜管理工作台，包含场景列表、镜头卡片和详情面板。
 */

"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { DndContext, closestCenter, PointerSensor, KeyboardSensor, useSensor, useSensors } from "@dnd-kit/core";
import { SortableContext, useSortable, arrayMove, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { ImageConfigSource, ProjectWorkspacePayload, StoryboardContent, StoryboardShot, ShotMediaBinding } from "@dramaflow/shared";
import {
  STORYBOARD_FRAMING_OPTIONS,
  ensureMediaBindings,
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
import { ShotDetailModal } from "./shot-detail-modal";
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

function SortableShotCard({ shot, state, isSelected, multiSelected, onClick, onDoubleClick, onQuickEdit }: {
  shot: StoryboardShot;
  state: ShotProjectState | null;
  isSelected: boolean;
  multiSelected: boolean;
  onClick: (e: React.MouseEvent) => void;
  onDoubleClick: () => void;
  onQuickEdit: (field: string, value: number) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: shot.id });
  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
  };
  return (
    <ShotCard
      ref={setNodeRef}
      shot={shot}
      state={state}
      isSelected={isSelected}
      multiSelected={multiSelected}
      isDragging={isDragging}
      style={style}
      onClick={onClick}
      onDoubleClick={onDoubleClick}
      onQuickEdit={onQuickEdit}
      dragHandleProps={listeners}
      {...attributes}
    />
  );
}

export function StoryboardWorkbench({ content, onChange, projectId, project, allowProjectMutations = true }: Props) {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const editable = Boolean(onChange);
  const canUseProject = Boolean(projectId && project);
  const canMutateProject = canUseProject && allowProjectMutations;
  const safeContent = useMemo(() => ensureMediaBindings(normalizeStoryboardContent(content)), [content]);
  const safeWorldBible = useMemo(() => normalizeWorldBibleContent(project?.worldBible), [project?.worldBible]);

  const [selectedShotId, setSelectedShotId] = useState(safeContent.shots[0]?.id ?? "");
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [filter, setFilter] = useState<ShotFilter>("all");
  const [imageConfigSource, setImageConfigSource] = useState<ImageConfigSource>("team");
  const [ttsDrafts, setTtsDrafts] = useState<Record<string, { text: string; characterId: string }>>({});
  const { feedback, setFeedback } = useFeedback();
  const gridRef = useRef<HTMLDivElement>(null);
  const [selectedShotIds, setSelectedShotIds] = useState<Set<string>>(new Set());
  const [focusedShotIndex, setFocusedShotIndex] = useState(0);
  const lastSelectedIndex = useRef(-1);

  const dndSensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor),
  );

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
    const reverseMappings = new Map<string, string>();
    if (safeContent.shotIdMappings) {
      for (const [oldId, newId] of Object.entries(safeContent.shotIdMappings)) {
        reverseMappings.set(newId, oldId);
      }
    }

    const map = new Map<string, ShotProjectState>();
    for (const shot of safeContent.shots) {
      const binding: ShotMediaBinding | undefined = safeContent.mediaBindings[shot.id]
        ?? (reverseMappings.has(shot.id) ? safeContent.mediaBindings[reverseMappings.get(shot.id)!] : undefined);
      const docs = documentsByShot.get(shot.id)
        ?? (reverseMappings.has(shot.id) ? documentsByShot.get(reverseMappings.get(shot.id)!) : undefined)
        ?? {};

      const effectiveImgVerId = binding?.imageVersionId ?? docs.image?.currentVersionId ?? docs.image?.draftVersionId;
      const effectiveVidVerId = binding?.videoVersionId ?? docs.video?.currentVersionId ?? docs.video?.draftVersionId;
      const effectiveAudVerId = binding?.audioVersionId ?? docs.audio?.currentVersionId ?? docs.audio?.draftVersionId;
      const currentImage = effectiveImgVerId ? versionsById.get(effectiveImgVerId) ?? null : null;
      const currentVideo = effectiveVidVerId ? versionsById.get(effectiveVidVerId) ?? null : null;
      const currentAudio = effectiveAudVerId ? versionsById.get(effectiveAudVerId) ?? null : null;

      const imageCandidates = docs.image ? versionsByDocument.get(docs.image.id) ?? [] : [];
      const videoCandidates = docs.video ? versionsByDocument.get(docs.video.id) ?? [] : [];
      const hasImage = Boolean((currentImage?.content as MediaVersionContent | undefined)?.assetUrl);
      const hasVideo = Boolean((currentVideo?.content as MediaVersionContent | undefined)?.assetUrl);
      const hasAudio = Boolean((currentAudio?.content as MediaVersionContent | undefined)?.assetUrl);
      const requiresTts = Boolean(shot.dialogue?.trim());
      const hasPendingCandidates = imageCandidates.some((c) => c.id !== effectiveImgVerId)
        || videoCandidates.some((c) => c.id !== effectiveVidVerId);

      const shotJobs = latestJobsByShot.get(shot.id)
        ?? (reverseMappings.has(shot.id) ? latestJobsByShot.get(reverseMappings.get(shot.id)!) : undefined)
        ?? {};

      map.set(shot.id, {
        imageDocument: docs.image ?? null,
        videoDocument: docs.video ?? null,
        audioDocument: docs.audio ?? null,
        currentImage, currentVideo, currentAudio,
        imageCandidates, videoCandidates,
        jobs: shotJobs,
        hasImage, hasVideo, hasAudio,
        hasPendingCandidates,
        isFinished: hasImage && hasVideo && (!requiresTts || hasAudio),
      });
    }
    return map;
  }, [safeContent, documentsByShot, latestJobsByShot, versionsByDocument, versionsById]);

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

  // Scroll selected card into view when navigating with drawer open
  useEffect(() => {
    if (!drawerOpen || !selectedShotId) return;
    const el = document.querySelector(`[data-shot-id="${selectedShotId}"]`);
    if (el) el.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "nearest" });
  }, [selectedShotId, drawerOpen]);

  const selectedShot = safeContent.shots.find((s) => s.id === selectedShotId) ?? visibleShots[0] ?? null;
  const selectedState = selectedShot ? shotStateById.get(selectedShot.id) ?? null : null;
  const selectedDraft = selectedShot ? (ttsDrafts[selectedShot.id] ?? {
    text: selectedShot.dialogue ?? "",
    characterId: selectedShot.characterIds?.[0] ?? "",
  }) : null;

  // Selected scene for toolbar
  const selectedSceneId = selectedShot?.sceneId ?? visibleSceneGroups[0]?.sceneId ?? "";

  // Filter counts (based on all shots, not current filter)
  const unfinishedCount = safeContent.shots.filter((s) => !shotStateById.get(s.id)?.isFinished).length;
  const candidatesCount = safeContent.shots.filter((s) => shotStateById.get(s.id)?.hasPendingCandidates).length;

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

  const multiSelectActive = selectedShotIds.size > 1;

  function handleDragEnd(event: { active: { id: string | number }; over: { id: string | number } | null }) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const activeShot = safeContent.shots.find((s) => s.id === active.id);
    const overShot = safeContent.shots.find((s) => s.id === over.id);
    if (!activeShot || !overShot || activeShot.sceneId !== overShot.sceneId) return;
    const oldIndex = safeContent.shots.findIndex((s) => s.id === active.id);
    const newIndex = safeContent.shots.findIndex((s) => s.id === over.id);
    updateContent((current) => ({ ...current, shots: arrayMove(current.shots, oldIndex, newIndex) }));
  }

  function handleCardClick(shot: StoryboardShot, index: number, e: React.MouseEvent) {
    if (e.shiftKey && lastSelectedIndex.current >= 0) {
      const start = Math.min(lastSelectedIndex.current, index);
      const end = Math.max(lastSelectedIndex.current, index);
      setSelectedShotIds(new Set(visibleShots.slice(start, end + 1).map((s) => s.id)));
      return;
    }
    if (e.ctrlKey || e.metaKey) {
      setSelectedShotIds((prev) => {
        const next = new Set(prev);
        if (next.has(shot.id)) next.delete(shot.id);
        else next.add(shot.id);
        return next;
      });
      lastSelectedIndex.current = index;
      return;
    }
    setSelectedShotIds(new Set());
    lastSelectedIndex.current = index;
    setSelectedShotId(shot.id);
    setDrawerOpen(true);
  }

  function handleGridKeyDown(e: React.KeyboardEvent) {
    if (e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;
    const total = visibleShots.length;
    if (total === 0) return;
    let next = focusedShotIndex;
    if (e.key === "ArrowRight") { next = (focusedShotIndex + 1) % total; e.preventDefault(); }
    else if (e.key === "ArrowLeft") { next = (focusedShotIndex - 1 + total) % total; e.preventDefault(); }
    else if (e.key === "Enter") {
      const shot = visibleShots[focusedShotIndex];
      if (shot) { setSelectedShotId(shot.id); setDrawerOpen(true); }
      return;
    }
    else return;
    setFocusedShotIndex(next);
    const el = gridRef.current?.querySelector(`[data-shot-id="${visibleShots[next]?.id}"]`) as HTMLElement | null;
    el?.focus();
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
      setFeedback({ message: t("storyboardWorkbench.batchImageJobQueued"), error: null });
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
      setFeedback({ message: t("storyboardWorkbench.candidateAdopted"), error: null });
      await invalidateWorkspace();
    },
    onError: setMutationError,
  });

  const storyboardDocId = project?.documents.find((d) => d.type === "storyboard")?.id;
  const storyboardDraftVersionId = storyboardDocId
    ? project?.versions.find((v) => v.documentId === storyboardDocId && v.status === "draft")?.id
    : undefined;

  const selectMediaVersion = useMutation({
    mutationFn: async ({ shotId, mediaType, versionId }: { shotId: string; mediaType: "image" | "video" | "audio"; versionId: string }) => {
      if (!storyboardDraftVersionId) throw new Error("No storyboard draft version");
      return apiFetch(`/versions/${storyboardDraftVersionId}/media-binding`, {
        method: "PATCH",
        body: { shotId, binding: { [`${mediaType}VersionId`]: versionId } },
      });
    },
    onSuccess: async () => {
      setFeedback({ message: t("shotDetailDrawer.mediaSelected"), error: null });
      await invalidateWorkspace();
    },
    onError: setMutationError,
  });

  const handleSubtitleChange = useCallback((shotId: string, subtitle: string) => {
    if (!onChange) return;
    const updated = { ...safeContent };
    updated.mediaBindings = { ...updated.mediaBindings, [shotId]: { ...(updated.mediaBindings[shotId] ?? {}), subtitle } };
    onChange(updated);
  }, [onChange, safeContent]);

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
          requestAnimationFrame(() => {
            document.getElementById(`scene-group-${sceneId}`)
              ?.scrollIntoView({ behavior: "smooth", block: "start" });
          });
        }}
        onBatchSceneTts={() => batchSceneTts.mutate()}
        isBatchTtsPending={batchSceneTts.isPending}
        hasEligibleTtsShots={safeContent.shots.filter((s) => s.sceneId === selectedSceneId).some((s) => s.dialogue?.trim() && s.characterIds?.[0])}
        unfinishedCount={unfinishedCount}
        candidatesCount={candidatesCount}
      />

      {/* Card grid */}
      <div className="swb-grid-scroll" ref={gridRef} onKeyDown={handleGridKeyDown}>
        {multiSelectActive && (
          <div className="swb-multi-bar">
            <span>{t("storyboardWorkbench.multiSelected", { count: String(selectedShotIds.size) })}</span>
            <button className="btn btn-ghost btn-sm" type="button" onClick={() => setSelectedShotIds(new Set())}>
              {t("common.cancel")}
            </button>
            {editable && (
              <button className="btn btn-danger btn-sm" type="button" onClick={() => {
                updateContent((current) => ({ ...current, shots: current.shots.filter((s) => !selectedShotIds.has(s.id)) }));
                setSelectedShotIds(new Set());
              }}>
                {t("shotDetailDrawer.delete")}
              </button>
            )}
          </div>
        )}
        <DndContext sensors={dndSensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
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
              <div key={group.sceneId} className="swb-scene-group" id={`scene-group-${group.sceneId}`}>
                <div className="swb-scene-group__header">
                  <span className="swb-scene-group__index">{t("storyboardToolbar.scenePrefix", { index: String(groupIndex + 1) })}</span>
                  <h4 className="swb-scene-group__heading">{group.heading || t("storyboardToolbar.untitledScene")}</h4>
                  {editable && (
                    <button className="btn btn-ghost btn-sm" type="button" onClick={() => addShot(group.sceneId)}>
                      {t("storyboardWorkbench.addShot")}
                    </button>
                  )}
                </div>
                <SortableContext items={group.shots.map((s) => s.id)} strategy={verticalListSortingStrategy}>
                  <div className="swb-card-grid">
                    {group.shots.map((shot) => {
                      const state = shotStateById.get(shot.id) ?? null;
                      const isSelected = selectedShot?.id === shot.id;
                      const shotIndex = visibleShots.findIndex((s) => s.id === shot.id);
                      return (
                        <SortableShotCard
                          key={shot.id}
                          shot={shot}
                          state={state}
                          isSelected={isSelected}
                          multiSelected={selectedShotIds.has(shot.id)}
                          onClick={(e) => handleCardClick(shot, shotIndex, e)}
                          onDoubleClick={() => {
                            setSelectedShotId(shot.id);
                            setDrawerOpen(true);
                          }}
                          onQuickEdit={(field, value) => updateShot(shot.id, { [field]: value })}
                        />
                      );
                    })}
                  </div>
                </SortableContext>
              </div>
            ))
          )}
        </DndContext>
      </div>

      {/* Detail modal */}
      {selectedShot && (
        <ShotDetailModal
          visible={drawerOpen}
          shot={selectedShot}
          state={selectedState}
          projectId={projectId}
          editable={editable}
          canMutateProject={canMutateProject}
          canUseProject={canUseProject}
          characters={characters.map((c) => ({ id: c.id, name: c.name }))}
          voiceConfigs={voiceConfigs.map((v) => ({ characterId: v.characterId, voiceName: v.voiceName }))}
          sceneHeadingMap={sceneHeadingMap}
          shotPositionInScene={(() => {
            const sceneShots = safeContent.shots.filter((s) => s.sceneId === selectedShot?.sceneId);
            const idx = sceneShots.findIndex((s) => s.id === selectedShotId);
            return idx >= 0 ? idx + 1 : undefined;
          })()}
          sceneShotCount={(() => {
            return safeContent.shots.filter((s) => s.sceneId === selectedShot?.sceneId).length || undefined;
          })()}
          onShotUpdate={updateShot}
          onGenerateImage={(shotId, prompt) => generateImage.mutate({ shotId, prompt })}
          onGenerateVideo={(shotId, prompt, ref) => generateVideo.mutate({ shotId, prompt, referenceImageAssetId: ref })}
          onGenerateTts={(shotId, characterId, text) => generateTts.mutate({ shotId, characterId, text })}
          onAdoptVersion={(documentId, versionId) => adoptVersion.mutate({ documentId, versionId })}
          onSelectMediaVersion={storyboardDraftVersionId ? (shotId, mediaType, versionId) => selectMediaVersion.mutate({ shotId, mediaType, versionId }) : undefined}
          onSubtitleChange={editable ? handleSubtitleChange : undefined}
          currentSubtitle={selectedShotId ? safeContent.mediaBindings[selectedShotId]?.subtitle : undefined}
          onMoveShot={moveShot}
          onRemoveShot={removeShot}
          isImagePending={generateImage.isPending && generateImage.variables?.shotId === selectedShotId}
          isVideoPending={generateVideo.isPending && generateVideo.variables?.shotId === selectedShotId}
          isTtsPending={generateTts.isPending && generateTts.variables?.shotId === selectedShotId}
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
