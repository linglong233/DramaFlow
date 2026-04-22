/**
 * @fileoverview 素材库
 * @module web/components/project-workspace
 *
 * 时间线编辑器的素材库侧边面板。
 */

"use client";

import { useState, useRef } from "react";
import { useI18n } from "../../lib/i18n";
import { apiFetch } from "../../lib/api";
import type { ProjectWorkspacePayload } from "@dramaflow/shared";

type AssetTab = "video" | "audio" | "subtitle" | "image";

interface AssetItem {
  id: string;
  type: string;
  title: string;
  assetUrl?: string;
  mimeType?: string;
  duration?: number;
  textContent?: string;
  source: "ai" | "upload";
}

interface MediaLibraryProps {
  projectId: string;
  data: ProjectWorkspacePayload;
  onRefresh: () => void;
}

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
}

function extractAssets(data: ProjectWorkspacePayload): AssetItem[] {
  const assets: AssetItem[] = [];
  for (const doc of data.documents ?? []) {
    if (!["video", "audio", "subtitle", "image"].includes(doc.type)) continue;
    const version = doc.currentVersionId
      ? data.versions?.find((v) => v.id === doc.currentVersionId)
      : undefined;
    const content = version?.content as Record<string, unknown> | undefined;
    assets.push({
      id: doc.id,
      type: doc.type,
      title: doc.title,
      assetUrl: (content?.assetUrl as string) ?? undefined,
      mimeType: (content?.mimeType as string) ?? undefined,
      duration: (content?.duration as number) ?? undefined,
      textContent: (content?.text as string) ?? (typeof version?.content === "string" ? version.content as string : undefined),
      source: (content?.provider as string) === "upload" ? "upload" : "ai",
    });
  }
  return assets;
}

export function MediaLibrary({ projectId, data, onRefresh }: MediaLibraryProps) {
  const { t } = useI18n();
  const [activeTab, setActiveTab] = useState<AssetTab>("video");
  const [previewAsset, setPreviewAsset] = useState<AssetItem | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const allAssets = extractAssets(data);
  const filteredAssets = allAssets.filter((a) => a.type === activeTab);

  const tabs: { key: AssetTab }[] = [
    { key: "video" },
    { key: "audio" },
    { key: "subtitle" },
    { key: "image" },
  ];

  const acceptTypes: Record<AssetTab, string> = {
    video: "video/*",
    audio: "audio/*",
    subtitle: ".srt,.txt,.vtt",
    image: "image/*",
  };

  function handleDragStart(e: React.DragEvent, asset: AssetItem) {
    e.dataTransfer.setData("application/json", JSON.stringify(asset));
    e.dataTransfer.effectAllowed = "copy";
  }

  async function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setIsUploading(true);

    try {
      const { asset, target } = await apiFetch<{ asset: { id: string }; target: { driver: string; key: string; url?: string; publicUrl?: string } }>(
        "/uploads",
        {
          method: "POST",
          body: {
            projectId,
            filename: file.name,
            contentType: file.type,
            sizeInBytes: file.size,
          },
        },
      );

      const uploadUrl = target.driver === "local"
        ? `/api/uploads/direct/${target.key}`
        : target.url;
      await fetch(uploadUrl!, { method: "PUT", body: file });

      await apiFetch(`/projects/${projectId}/assets`, {
        method: "POST",
        body: {
          type: activeTab,
          title: file.name,
          filename: file.name,
          assetId: asset.id,
          assetUrl: target.publicUrl ?? `/assets/${asset.id}/url`,
          mimeType: file.type,
          sizeInBytes: file.size,
        },
      });

      onRefresh();
    } catch (err) {
      console.error("Upload failed:", err);
    } finally {
      setIsUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  return (
    <div className="ml-root">
      <div className="ml-header">
        <span className="ml-title">{t("projectWorkspace.mediaLibrary.title")}</span>
      </div>

      <div className="ml-tabs">
        {tabs.map((tab) => (
          <button
            key={tab.key}
            className={`ml-tab${activeTab === tab.key ? " ml-tab--active" : ""}`}
            onClick={() => { setActiveTab(tab.key); setPreviewAsset(null); }}
            type="button"
          >
            {t(`projectWorkspace.mediaLibrary.tabs.${tab.key}`)}
          </button>
        ))}
      </div>

      <div className="ml-assets">
        {filteredAssets.length === 0 ? (
          <div className="ml-empty">{t("projectWorkspace.mediaLibrary.empty")}</div>
        ) : (
          filteredAssets.map((asset) => (
            <div
              key={asset.id}
              className={`ml-card${previewAsset?.id === asset.id ? " ml-card--previewing" : ""}`}
              draggable
              onDragStart={(e) => handleDragStart(e, asset)}
              onClick={() => setPreviewAsset(previewAsset?.id === asset.id ? null : asset)}
            >
              <div className="ml-card-thumb">
                {asset.type === "video" && (
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <polygon points="5 3 19 12 5 21 5 3" />
                  </svg>
                )}
                {asset.type === "audio" && (
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M9 18V5l12-2v13" /><circle cx="6" cy="18" r="3" /><circle cx="18" cy="16" r="3" />
                  </svg>
                )}
                {asset.type === "image" && asset.assetUrl && (
                  <img src={asset.assetUrl} alt={asset.title} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                )}
                {(asset.type === "image" && !asset.assetUrl) && (
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <rect x="3" y="3" width="18" height="18" rx="2" />
                    <circle cx="8.5" cy="8.5" r="1.5" />
                    <path d="M21 15l-5-5L5 21" />
                  </svg>
                )}
                {asset.type === "subtitle" && (
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <rect x="2" y="4" width="20" height="16" rx="2" />
                    <path d="M6 12h4M14 12h4M8 16h8" />
                  </svg>
                )}
              </div>
              <div className="ml-card-info">
                <span className="ml-card-name">{asset.title}</span>
                <div className="ml-card-meta">
                  <span className={`ml-card-source ml-card-source--${asset.source}`}>
                    {asset.source === "ai"
                      ? t("projectWorkspace.mediaLibrary.sourceAI")
                      : t("projectWorkspace.mediaLibrary.sourceUpload")}
                  </span>
                  {asset.duration != null && (
                    <span className="ml-card-duration">{formatDuration(asset.duration)}</span>
                  )}
                </div>
              </div>
            </div>
          ))
        )}
      </div>

      {previewAsset && (
        <div className="ml-preview">
          <div className="ml-preview-header">
            <span>{t("projectWorkspace.mediaLibrary.preview")}</span>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setPreviewAsset(null)}>&times;</button>
          </div>
          <div className="ml-preview-content">
            {previewAsset.type === "video" && previewAsset.assetUrl && (
              <video src={previewAsset.assetUrl} controls style={{ width: "100%", maxHeight: 160 }} />
            )}
            {previewAsset.type === "audio" && previewAsset.assetUrl && (
              <audio src={previewAsset.assetUrl} controls style={{ width: "100%" }} />
            )}
            {previewAsset.type === "image" && previewAsset.assetUrl && (
              <img src={previewAsset.assetUrl} alt={previewAsset.title} style={{ width: "100%" }} />
            )}
            {previewAsset.type === "subtitle" && previewAsset.textContent && (
              <div style={{ whiteSpace: "pre-wrap", fontSize: 12, maxHeight: 120, overflow: "auto" }}>
                {previewAsset.textContent}
              </div>
            )}
          </div>
        </div>
      )}

      <div className="ml-upload">
        <input
          ref={fileInputRef}
          type="file"
          accept={acceptTypes[activeTab]}
          onChange={handleUpload}
          style={{ display: "none" }}
        />
        <button
          className="btn btn-secondary btn-sm"
          type="button"
          disabled={isUploading}
          onClick={() => fileInputRef.current?.click()}
          style={{ width: "100%" }}
        >
          {isUploading ? "..." : t("projectWorkspace.mediaLibrary.upload")}
        </button>
      </div>
    </div>
  );
}
