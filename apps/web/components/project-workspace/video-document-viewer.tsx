"use client";

import { useMemo } from "react";
import {
  normalizeStoryboardContent,
  type ProjectWorkspacePayload,
  type StoryboardShot,
} from "@dramaflow/shared";

type VersionItem = Pick<
  import("@dramaflow/shared").VersionRecord,
  "id" | "title" | "versionNumber" | "status" | "content" | "createdAt"
>;

import { ShotReferencePanel } from "./shot-reference-panel";
import { VideoPanel } from "./video-panel";

interface Props {
  projectId: string;
  documentId: string;
  shotId?: string;
  project: ProjectWorkspacePayload;
}

export function VideoDocumentViewer({ projectId, documentId, shotId, project }: Props) {
  // Find storyboard shot for reference panel
  const shot: StoryboardShot | null = useMemo(() => {
    if (!shotId) return null;
    const storyboardDoc = project.documents.find((d) => d.type === "storyboard");
    if (!storyboardDoc?.currentVersionId) return null;
    const storyboardVersion = project.versions.find((v) => v.id === storyboardDoc.currentVersionId);
    if (!storyboardVersion) return null;
    const content = normalizeStoryboardContent(storyboardVersion.content);
    return content.shots.find((s) => s.id === shotId) ?? null;
  }, [shotId, project.documents, project.versions]);

  // Find the video document and its versions
  const videoDoc = useMemo(
    () => project.documents.find((d) => d.id === documentId),
    [project.documents, documentId],
  );

  const currentVersion = useMemo(() => {
    if (!videoDoc?.currentVersionId) return null;
    return project.versions.find((v) => v.id === videoDoc.currentVersionId) ?? null;
  }, [videoDoc, project.versions]);

  const candidates = useMemo(() => {
    if (!videoDoc) return [] as VersionItem[];
    return [...project.versions.filter((v) => v.documentId === videoDoc.id)].sort(
      (a, b) => b.versionNumber - a.versionNumber,
    );
  }, [videoDoc, project.versions]);

  // Find reference image for the shot
  const imageUrl = useMemo(() => {
    if (!shotId) return undefined;
    const imageDoc = project.documents.find((d) => d.shotId === shotId && d.type === "image");
    if (!imageDoc?.currentVersionId) return undefined;
    const imageVersion = project.versions.find((v) => v.id === imageDoc.currentVersionId);
    if (!imageVersion) return undefined;
    const content = imageVersion.content as { assetUrl?: string } | null;
    return content?.assetUrl;
  }, [shotId, project.documents, project.versions]);

  // Find latest video job for this shot
  const videoJob = useMemo(() => {
    if (!shotId) return undefined;
    const sorted = [...project.jobs]
      .filter((j) => j.shotId === shotId && j.type === "video_generation")
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    return sorted[0];
  }, [shotId, project.jobs]);

  // Find reference image asset ID for video generation
  const referenceImageAssetId = useMemo(() => {
    if (!shotId) return undefined;
    const imageDoc = project.documents.find((d) => d.shotId === shotId && d.type === "image");
    if (!imageDoc?.currentVersionId) return undefined;
    const imageVersion = project.versions.find((v) => v.id === imageDoc.currentVersionId);
    const content = imageVersion?.content as { assetId?: string } | null;
    return content?.assetId;
  }, [shotId, project.documents, project.versions]);

  return (
    <div className="video-document-viewer">
      <ShotReferencePanel shot={shot} imageUrl={imageUrl} />
      <VideoPanel
        projectId={projectId}
        documentId={documentId}
        shotId={shotId}
        currentVersion={currentVersion}
        candidates={candidates}
        videoJob={videoJob}
        referenceImageAssetId={referenceImageAssetId}
      />
    </div>
  );
}
