/**
 * @fileoverview 媒体画布面板
 * @module web/components/project-workspace
 *
 * 图片和视频资产的可视化管理画布。
 */

"use client";

import { useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  normalizeStoryboardContent,
  normalizeWorldBibleContent,
  type ImageConfigSource,
  type ProjectWorkspacePayload,
} from "@dramaflow/shared";

import { apiFetch } from "../../lib/api";
import { useI18n } from "../../lib/i18n";
import { queryKeys } from "../../lib/query-keys";
import { ProviderSelector, useProviderEntries } from "./provider-selector";

interface Props {
  projectId: string;
  project: ProjectWorkspacePayload;
}

interface MediaVersionContent {
  assetId?: string;
  assetUrl?: string;
  prompt?: string;
  mimeType?: string;
  mode?: string;
  note?: string;
  providerStatus?: string;
  progress?: number;
  configSource?: ImageConfigSource;
  model?: string;
  duration?: number;
  voiceName?: string;
  characterId?: string;
}

export function MediaCanvasPanel({ projectId, project }: Props) {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const [imageConfigSource, setImageConfigSource] = useState<ImageConfigSource>("team");
  const [ttsState, setTtsState] = useState<Record<string, { text: string; characterId: string }>>({});
  const [selectedImageProvider, setSelectedImageProvider] = useState<string | undefined>();
  const [selectedVideoProvider, setSelectedVideoProvider] = useState<string | undefined>();

  const providerEntries = useProviderEntries(imageConfigSource, project.team?.id);
  const storyboardDoc = project.documents.find((document) => document.type === "storyboard");
  const storyboardVersion = project.versions.find((version) => version.id === storyboardDoc?.currentVersionId);
  const storyboardContent = useMemo(() => normalizeStoryboardContent(storyboardVersion?.content), [storyboardVersion?.content]);
  const shots = storyboardContent.shots;

  const versionsByDocument = useMemo(() => {
    const map = new Map<string, typeof project.versions>();
    for (const version of project.versions) {
      const group = map.get(version.documentId) ?? [];
      group.push(version);
      map.set(version.documentId, group);
    }
    for (const group of map.values()) {
      group.sort((left, right) => right.versionNumber - left.versionNumber);
    }
    return map;
  }, [project.versions]);

  const worldBible = useMemo(() => normalizeWorldBibleContent(project.worldBible), [project.worldBible]);
  const characters = worldBible.characters;
  const charactersById = useMemo(() => new Map(characters.map((character) => [character.id, character])), [characters]);

  const sceneGroups = useMemo(() => {
    const map = new Map<string, typeof shots>();
    for (const shot of shots) {
      const group = map.get(shot.sceneId) ?? [];
      group.push(shot);
      map.set(shot.sceneId, group);
    }
    return Array.from(map.entries());
  }, [shots]);

  const latestJobsByShot = useMemo(() => {
    const map = new Map<string, { image?: ProjectWorkspacePayload["jobs"][number]; video?: ProjectWorkspacePayload["jobs"][number]; tts?: ProjectWorkspacePayload["jobs"][number] }>();
    const sorted = [...project.jobs].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
    for (const job of sorted) {
      if (!job.shotId) continue;
      const current = map.get(job.shotId) ?? {};
      if (job.type === "image_generation" && !current.image) current.image = job;
      if (job.type === "video_generation" && !current.video) current.video = job;
      if (job.type === "tts_generation" && !current.tts) current.tts = job;
      map.set(job.shotId, current);
    }
    return map;
  }, [project.jobs]);

  const invalidateWorkspace = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.project(projectId) }),
      queryClient.invalidateQueries({ queryKey: queryKeys.projectVersions(projectId) }),
      queryClient.invalidateQueries({ queryKey: queryKeys.projectJobs(projectId) }),
    ]);
  };

  const generateImage = useMutation({
    mutationFn: ({ shotId }: { shotId: string }) => apiFetch(`/shots/${shotId}/image-jobs`, {
      method: "POST",
      body: {
        projectId,
        style: "cinematic",
        aspectRatio: "16:9",
        configSource: imageConfigSource,
        providerId: selectedImageProvider,
      },
    }),
    onSuccess: () => invalidateWorkspace(),
  });

  const generateVideo = useMutation({
    mutationFn: ({ shotId, referenceImageAssetId }: { shotId: string; referenceImageAssetId?: string }) => apiFetch(`/shots/${shotId}/video-jobs`, {
      method: "POST",
      body: { projectId, style: "cinematic", aspectRatio: "16:9", durationSeconds: 5, referenceImageAssetId, providerId: selectedVideoProvider },
    }),
    onSuccess: () => invalidateWorkspace(),
  });

  const generateTts = useMutation({
    mutationFn: ({ shotId, characterId, text }: { shotId: string; characterId: string; text: string }) =>
      apiFetch(`/shots/${shotId}/tts-jobs`, { method: "POST", body: { projectId, characterId, text } }),
    onSuccess: () => invalidateWorkspace(),
  });

  const batchSceneTts = useMutation({
    mutationFn: ({ sceneId, shotIds }: { sceneId: string; shotIds: string[] }) =>
      apiFetch(`/scenes/${sceneId}/batch-tts-jobs`, { method: "POST", body: { projectId, shotIds } }),
    onSuccess: () => invalidateWorkspace(),
  });

  const adoptVersion = useMutation({
    mutationFn: ({ documentId, versionId }: { documentId: string; versionId: string }) =>
      apiFetch(`/documents/${documentId}/adopt-version`, { method: "POST", body: { versionId } }),
    onSuccess: () => invalidateWorkspace(),
  });

  const batchGenerateMissingImages = useMutation({
    mutationFn: () => {
      const shotIds = shots
        .filter((shot) => !getCurrentVersion(shot.id, "image"))
        .map((shot) => shot.id);
      return apiFetch(`/projects/${projectId}/batch-image-jobs`, { method: "POST", body: { shotIds } });
    },
    onSuccess: () => invalidateWorkspace(),
  });

  function getDocument(shotId: string, type: "image" | "video" | "audio") {
    return project.documents.find((item) => item.shotId === shotId && item.type === type) ?? null;
  }

  function getCurrentVersion(shotId: string, type: "image" | "video" | "audio") {
    const document = getDocument(shotId, type);
    if (!document?.currentVersionId) return null;
    return project.versions.find((version) => version.id === document.currentVersionId) ?? null;
  }

  function getCandidates(shotId: string, type: "image" | "video") {
    const document = getDocument(shotId, type);
    if (!document) return [];
    return versionsByDocument.get(document.id) ?? [];
  }

  function getTtsDraft(shotId: string, fallbackText: string, fallbackCharacterId: string) {
    return ttsState[shotId] ?? { text: fallbackText, characterId: fallbackCharacterId };
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <div style={{ padding: "var(--space-4) var(--space-8)", display: "flex", justifyContent: "space-between", gap: "var(--space-4)", flexWrap: "wrap", alignItems: "center" }}>
        <div style={{ display: "flex", gap: "var(--space-3)", alignItems: "center", flexWrap: "wrap" }}>
          <label className="wb-field" style={{ marginBottom: 0, minWidth: 220 }}>
            <span>{t("projectWorkspace.media.imageConfigSourceLabel")}</span>
            <select value={imageConfigSource} onChange={(event) => setImageConfigSource(event.target.value as ImageConfigSource)}>
              <option value="team">{t("projectWorkspace.media.imageConfigSourceTeam")}</option>
              <option value="personal">{t("projectWorkspace.media.imageConfigSourcePersonal")}</option>
            </select>
          </label>
          <button
            className="btn btn-primary btn-sm"
            type="button"
            onClick={() => batchGenerateMissingImages.mutate()}
            disabled={batchGenerateMissingImages.isPending || shots.every((shot) => Boolean(getCurrentVersion(shot.id, "image")))}
          >
            {batchGenerateMissingImages.isPending ? t("common.submitting") : t("projectWorkspace.media.batchGenerateMissingImages")}
          </button>
        </div>

        <div style={{ display: "flex", gap: "var(--space-2)", flexWrap: "wrap", alignItems: "center" }}>
          {sceneGroups.map(([sceneId, sceneShots]) => {
            const eligibleShotIds = sceneShots.filter((shot) => shot.dialogue?.trim() && shot.characterIds?.[0]).map((shot) => shot.id);
            return (
              <button
                key={sceneId}
                className="btn btn-secondary btn-sm"
                type="button"
                disabled={batchSceneTts.isPending || eligibleShotIds.length === 0}
                onClick={() => batchSceneTts.mutate({ sceneId, shotIds: eligibleShotIds })}
              >
                {batchSceneTts.isPending ? t("common.submitting") : `Scene ${sceneId.slice(-4)} TTS`}
              </button>
            );
          })}
        </div>
      </div>

      <div style={{ flex: 1, padding: "0 var(--space-8) var(--space-8)", overflowY: "auto" }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(360px, 1fr))", gap: "var(--space-6)" }}>
          {shots.length === 0 ? (
            <div className="glass-panel" style={{ padding: "var(--space-6)", textAlign: "center" }}>
              {t("projectWorkspace.media.noShotsHint")}
            </div>
          ) : shots.map((shot) => {
            const imageDocument = getDocument(shot.id, "image");
            const videoDocument = getDocument(shot.id, "video");
            const audioDocument = getDocument(shot.id, "audio");
            const currentImage = (getCurrentVersion(shot.id, "image")?.content ?? {}) as MediaVersionContent;
            const currentVideo = (getCurrentVersion(shot.id, "video")?.content ?? {}) as MediaVersionContent;
            const currentAudio = (getCurrentVersion(shot.id, "audio")?.content ?? {}) as MediaVersionContent;
            const imageCandidates = getCandidates(shot.id, "image");
            const videoCandidates = getCandidates(shot.id, "video");
            const jobs = latestJobsByShot.get(shot.id) ?? {};
            const draft = getTtsDraft(shot.id, shot.dialogue ?? "", shot.characterIds?.[0] ?? "");
            const referenceImageAssetId = currentImage.assetId;

            return (
              <div key={shot.id} className="glass-panel" style={{ padding: "var(--space-4)", display: "flex", flexDirection: "column", gap: "var(--space-4)" }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: "var(--space-3)", alignItems: "flex-start" }}>
                  <div>
                    <div style={{ fontSize: "0.8rem", color: "var(--text-secondary)", fontWeight: 700 }}>{shot.shotLabel}</div>
                    <div style={{ fontSize: "1rem", fontWeight: 700 }}>{shot.visualDescription}</div>
                  </div>
                  <div className="muted text-sm">{shot.durationSeconds}s</div>
                </div>

                <div style={{ aspectRatio: "16 / 9", borderRadius: "var(--radius-md)", overflow: "hidden", background: "rgba(255,255,255,0.04)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                  {currentVideo.assetUrl && currentVideo.mimeType?.startsWith("video/") ? (
                    <video controls style={{ width: "100%", height: "100%", objectFit: "cover" }}>
                      <source src={currentVideo.assetUrl} type={currentVideo.mimeType} />
                    </video>
                  ) : currentImage.assetUrl && currentImage.mimeType?.startsWith("image/") ? (
                    <img src={currentImage.assetUrl} alt={shot.shotLabel} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                  ) : (
                    <div className="muted text-sm">{t("projectWorkspace.media.awaitingGeneration")}</div>
                  )}
                </div>

                <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: "var(--space-2)" }}>
                  <div style={{ display: "flex", gap: "var(--space-2)", alignItems: "center" }}>
                    <button className="btn btn-secondary btn-sm" type="button" disabled={generateImage.isPending} onClick={() => generateImage.mutate({ shotId: shot.id })}>
                      {generateImage.isPending ? t("common.submitting") : t("projectWorkspace.media.genImage")}
                    </button>
                    <ProviderSelector type="image" providers={providerEntries.imageProviders} defaultProviderId={providerEntries.defaultImageProvider} value={selectedImageProvider} onChange={setSelectedImageProvider} />
                  </div>
                  <div style={{ display: "flex", gap: "var(--space-2)", alignItems: "center" }}>
                    <button className="btn btn-primary btn-sm" type="button" disabled={generateVideo.isPending} onClick={() => generateVideo.mutate({ shotId: shot.id, referenceImageAssetId })}>
                      {generateVideo.isPending ? t("common.submitting") : t("projectWorkspace.media.genVideo")}
                    </button>
                    <ProviderSelector type="video" providers={providerEntries.videoProviders} defaultProviderId={providerEntries.defaultVideoProvider} value={selectedVideoProvider} onChange={setSelectedVideoProvider} />
                  </div>
                </div>

                {(jobs.image || jobs.video) ? (
                  <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                    {jobs.image ? <div className="muted text-sm">Image job: {jobs.image.status}</div> : null}
                    {jobs.video ? <div className="muted text-sm">Video job: {jobs.video.status} {typeof jobs.video.progress === "number" ? `(${jobs.video.progress}%)` : ""}</div> : null}
                  </div>
                ) : null}

                <CandidateList
                  title="Image candidates"
                  documentId={imageDocument?.id}
                  currentVersionId={imageDocument?.currentVersionId}
                  candidates={imageCandidates}
                  onAdopt={(versionId) => imageDocument && adoptVersion.mutate({ documentId: imageDocument.id, versionId })}
                  isPending={adoptVersion.isPending}
                />

                <CandidateList
                  title="Video candidates"
                  documentId={videoDocument?.id}
                  currentVersionId={videoDocument?.currentVersionId}
                  candidates={videoCandidates}
                  onAdopt={(versionId) => videoDocument && adoptVersion.mutate({ documentId: videoDocument.id, versionId })}
                  isPending={adoptVersion.isPending}
                />

                <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)", padding: "var(--space-3)", borderRadius: "var(--radius-md)", border: "1px solid var(--border-subtle)" }}>
                  <div style={{ fontWeight: 700 }}>TTS</div>
                  <select
                    value={draft.characterId}
                    onChange={(event) => setTtsState((current) => ({ ...current, [shot.id]: { ...draft, characterId: event.target.value } }))}
                  >
                    {shot.characterIds?.length ? null : <option value="">No character mapped</option>}
                    {(shot.characterIds ?? []).map((characterId) => (
                      <option key={characterId} value={characterId}>{charactersById.get(characterId)?.name ?? characterId}</option>
                    ))}
                  </select>
                  <textarea
                    className="input"
                    value={draft.text}
                    onChange={(event) => setTtsState((current) => ({ ...current, [shot.id]: { ...draft, text: event.target.value } }))}
                    placeholder="Dialogue for TTS"
                    style={{ minHeight: 88, resize: "none" }}
                  />
                  <button
                    className="btn btn-secondary btn-sm"
                    type="button"
                    disabled={generateTts.isPending || !draft.characterId || !draft.text.trim()}
                    onClick={() => generateTts.mutate({ shotId: shot.id, characterId: draft.characterId, text: draft.text.trim() })}
                  >
                    {generateTts.isPending ? t("common.submitting") : "Generate TTS"}
                  </button>
                  {jobs.tts ? <div className="muted text-sm">TTS job: {jobs.tts.status}</div> : null}
                  {currentAudio.assetUrl ? (
                    <audio controls src={currentAudio.assetUrl} style={{ width: "100%" }} />
                  ) : null}
                  {currentAudio.voiceName ? <div className="muted text-sm">Current voice: {currentAudio.voiceName}</div> : null}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function CandidateList({
  title,
  documentId,
  currentVersionId,
  candidates,
  onAdopt,
  isPending,
}: {
  title: string;
  documentId?: string;
  currentVersionId?: string;
  candidates: ProjectWorkspacePayload["versions"];
  onAdopt: (versionId: string) => void;
  isPending: boolean;
}) {
  if (!documentId || candidates.length === 0) {
    return null;
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)", padding: "var(--space-3)", borderRadius: "var(--radius-md)", border: "1px solid var(--border-subtle)" }}>
      <div style={{ fontWeight: 700 }}>{title}</div>
      {candidates.map((candidate) => {
        const content = (candidate.content ?? {}) as MediaVersionContent;
        const adopted = candidate.id === currentVersionId;
        return (
          <div key={candidate.id} style={{ display: "flex", justifyContent: "space-between", gap: "var(--space-3)", alignItems: "center", padding: "var(--space-2) 0", borderTop: "1px solid rgba(255,255,255,0.04)" }}>
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <strong>{candidate.title}</strong>
              <span className="muted text-sm">V{candidate.versionNumber} {content.model ? `? ${content.model}` : ""}</span>
            </div>
            <button className="btn btn-ghost btn-sm" type="button" disabled={isPending || adopted} onClick={() => onAdopt(candidate.id)}>
              {adopted ? "Adopted" : "Adopt"}
            </button>
          </div>
        );
      })}
    </div>
  );
}
