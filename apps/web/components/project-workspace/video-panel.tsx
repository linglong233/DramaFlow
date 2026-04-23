/**
 * @fileoverview 视频面板
 * @module web/components/project-workspace
 *
 * 视频资产的管理和预览面板。
 */

"use client";

import { useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type {
  ImageConfigSource,
  ProjectWorkspacePayload,
} from "@dramaflow/shared";

type VersionItem = Pick<
  import("@dramaflow/shared").VersionRecord,
  "id" | "title" | "versionNumber" | "status" | "content" | "createdAt"
>;

import { apiFetch } from "../../lib/api";
import { useI18n } from "../../lib/i18n";
import { queryKeys } from "../../lib/query-keys";

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
}

interface Props {
  projectId: string;
  documentId: string;
  shotId?: string;
  currentVersion: VersionItem | null;
  candidates: VersionItem[];
  videoJob?: ProjectWorkspacePayload["jobs"][number];
  referenceImageAssetId?: string;
}

export function VideoPanel({
  projectId,
  documentId,
  shotId,
  currentVersion,
  candidates,
  videoJob,
  referenceImageAssetId,
}: Props) {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [previewVersionId, setPreviewVersionId] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);

  const currentContent = (currentVersion?.content ?? {}) as MediaVersionContent;

  // Find the version being previewed (either a clicked candidate or the current)
  const previewVersion = previewVersionId
    ? candidates.find((v) => v.id === previewVersionId) ?? currentVersion
    : currentVersion;
  const previewContent = (previewVersion?.content ?? {}) as MediaVersionContent;

  const invalidate = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.project(projectId) }),
      queryClient.invalidateQueries({ queryKey: queryKeys.projectVersions(projectId) }),
      queryClient.invalidateQueries({ queryKey: queryKeys.projectJobs(projectId) }),
    ]);
  };

  const generateVideo = useMutation({
    mutationFn: () => {
      if (!shotId) throw new Error("No shot linked to this video document");
      return apiFetch(`/shots/${shotId}/video-jobs`, {
        method: "POST",
        body: {
          projectId,
          style: "cinematic",
          aspectRatio: "16:9",
          durationSeconds: 5,
          referenceImageAssetId,
        },
      });
    },
    onSuccess: () => invalidate(),
  });

  const adoptVersion = useMutation({
    mutationFn: ({ versionId }: { versionId: string }) =>
      apiFetch(`/documents/${documentId}/adopt-version`, {
        method: "POST",
        body: { versionId },
      }),
    onSuccess: () => invalidate(),
  });

  const handleUpload = async (file: File) => {
    setUploading(true);
    try {
      // 1. Create upload target
      const { asset, target } = await apiFetch<{
        asset: { id: string };
        target: { driver: string; key: string; url: string; method: string; publicUrl?: string };
      }>("/uploads", {
        method: "POST",
        body: {
          projectId,
          documentId,
          filename: file.name,
          contentType: file.type,
          sizeInBytes: file.size,
        },
      });

      // 2. Upload file to target
      if (target.driver === "local") {
        await apiFetch(`/uploads/direct/${target.key}`, {
          method: "PUT",
          body: file,
          headers: { "content-type": file.type },
        });
      } else {
        await fetch(target.url, {
          method: target.method,
          body: file,
          headers: { "content-type": file.type },
        });
      }

      // 3. Create version with the uploaded asset
      const assetUrl = target.publicUrl ?? `/assets/${asset.id}/url`;
      await apiFetch(`/documents/${documentId}/versions`, {
        method: "POST",
        body: {
          title: `Upload: ${file.name}`,
          content: {
            prompt: "",
            assetId: asset.id,
            assetUrl,
            mimeType: file.type,
            provider: "upload",
            mode: "upload",
            note: t("videoPanel.uploadNote"),
            parameters: {},
          },
        },
      });

      await invalidate();
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const isVideoJobPending = generateVideo.isPending;
  const jobStatus = videoJob?.status;
  const jobProgress = videoJob?.progress;

  return (
    <div className="video-panel">
      {/* Video Player */}
      <div className="video-panel__player-wrap">
        {previewContent.assetUrl && previewContent.mimeType?.startsWith("video/") ? (
          <video key={previewContent.assetUrl} controls playsInline className="video-panel__player">
            <source src={previewContent.assetUrl} type={previewContent.mimeType} />
          </video>
        ) : (
          <div className="video-panel__empty">
            <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: 0.25 }}>
              <polygon points="5 3 19 12 5 21 5 3" />
            </svg>
            <p>{t("videoPanel.emptyHint")}</p>
          </div>
        )}
      </div>

      {/* Metadata bar */}
      {previewContent.assetUrl && (
        <div className="video-panel__meta">
          <span className="video-panel__meta-tag">
            {previewContent.mode === "upload" ? t("videoPanel.uploadTag") : `${t("videoPanel.aiTag")}${previewContent.model ? ` - ${previewContent.model}` : ""}`}
          </span>
          {previewContent.duration && (
            <span className="video-panel__meta-tag">{previewContent.duration}s</span>
          )}
        </div>
      )}

      {/* Action bar */}
      <div className="video-panel__actions">
        <input
          ref={fileInputRef}
          type="file"
          accept="video/*"
          style={{ display: "none" }}
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) handleUpload(file);
          }}
        />
        <button
          className="btn btn-secondary btn-sm"
          type="button"
          disabled={uploading}
          onClick={() => fileInputRef.current?.click()}
        >
          {uploading ? t("videoPanel.uploading") : t("videoPanel.uploadAction")}
        </button>
        {shotId && (
          <button
            className="btn btn-primary btn-sm"
            type="button"
            disabled={isVideoJobPending}
            onClick={() => generateVideo.mutate()}
          >
            {isVideoJobPending ? t("videoPanel.submitting") : t("videoPanel.generateAction")}
          </button>
        )}
      </div>

      {/* Job status */}
      {jobStatus && (
        <div className="video-panel__job-status">
          <span className={`video-panel__job-dot video-panel__job-dot--${jobStatus}`} />
          <span className="video-panel__job-label">
            {t("videoPanel.jobStatus", { status: jobStatus ?? "" })}
            {typeof jobProgress === "number" ? ` (${jobProgress}%)` : ""}
          </span>
          {typeof jobProgress === "number" && jobProgress < 100 && (
            <div className="video-panel__progress-bar">
              <div className="video-panel__progress-fill" style={{ width: `${jobProgress}%` }} />
            </div>
          )}
        </div>
      )}

      {/* Candidates list */}
      {candidates.length > 1 && (
        <div className="video-panel__candidates">
          <h4 className="video-panel__candidates-title">{t("videoPanel.versionsTitle", { count: candidates.length })}</h4>
          <div className="video-panel__candidates-list">
            {candidates.map((candidate) => {
              const content = (candidate.content ?? {}) as MediaVersionContent;
              const isAdopted = candidate.id === currentVersion?.id;
              const isPreviewing = candidate.id === previewVersionId;

              return (
                <div
                  key={candidate.id}
                  className={`video-panel__candidate${isPreviewing ? " video-panel__candidate--previewing" : ""}`}
                  onClick={() => setPreviewVersionId(isPreviewing ? null : candidate.id)}
                >
                  <div className="video-panel__candidate-info">
                    <span className="video-panel__candidate-source">
                      {content.mode === "upload" ? t("videoPanel.uploadTag") : `${t("videoPanel.aiTag")}${content.model ? ` - ${content.model}` : ""}`}
                    </span>
                    <span className="video-panel__candidate-time">
                      v{candidate.versionNumber} &middot; {new Date(candidate.createdAt).toLocaleDateString()}
                    </span>
                  </div>
                  <button
                    className={`btn btn-sm ${isAdopted ? "btn-ghost" : "btn-secondary"}`}
                    type="button"
                    disabled={isAdopted || adoptVersion.isPending}
                    onClick={(e) => {
                      e.stopPropagation();
                      adoptVersion.mutate({ versionId: candidate.id });
                    }}
                  >
                    {isAdopted ? t("videoPanel.adoptedAction") : t("videoPanel.adoptAction")}
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
