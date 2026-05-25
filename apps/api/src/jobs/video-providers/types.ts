/**
 * @fileoverview 视频 Provider 适配器类型定义
 * @module api/jobs/video-providers
 *
 * 定义视频生成 Provider 的通用接口、输入输出类型和工具函数。
 */

import type { VideoGenerationProvider, VideoReferenceMode } from "@dramaflow/shared";
import type { ResolvedVideoReferences } from "../video-reference.utils";

export type NormalizedVideoProviderStatus = "queued" | "running" | "completed" | "failed";

export interface VideoProviderConfig {
  provider: VideoGenerationProvider;
  apiKey?: string;
  baseUrl?: string;
  model?: string;
}

export interface VideoProviderCreateInput {
  prompt: string;
  shotId: string;
  aspectRatio: string;
  durationSeconds?: number;
  config: VideoProviderConfig;
  references: ResolvedVideoReferences;
}

export interface VideoProviderPollInput {
  prompt: string;
  shotId: string;
  aspectRatio: string;
  durationSeconds?: number;
  config: VideoProviderConfig;
  references: ResolvedVideoReferences;
}

export interface VideoProviderJobState {
  provider: string;
  providerVideoId?: string;
  providerStatus: NormalizedVideoProviderStatus;
  progress: number;
  assetUrl?: string;
  mimeType: string;
  note?: string;
  raw?: Record<string, unknown>;
  parameters: Record<string, unknown>;
}

export interface VideoProviderAdapter {
  provider: VideoGenerationProvider;
  createJob(input: VideoProviderCreateInput): Promise<VideoProviderJobState>;
  pollJob?(providerVideoId: string, input: VideoProviderPollInput): Promise<VideoProviderJobState>;
}

export function joinProviderUrl(baseUrl: string | undefined, defaultBaseUrl: string, path: string): string {
  const base = (baseUrl || defaultBaseUrl).replace(/\/$/, "");
  const suffix = path.startsWith("/") ? path : `/${path}`;
  return `${base}${suffix}`;
}

export function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

export function normalizeStatus(value: unknown): NormalizedVideoProviderStatus {
  const status = String(value || "").toLowerCase();
  if (["completed", "complete", "succeeded", "success", "succeeded"].includes(status)) return "completed";
  if (["failed", "error", "cancelled", "canceled"].includes(status)) return "failed";
  if (["running", "processing", "in_progress", "pending", "queued"].includes(status)) return status === "queued" || status === "pending" ? "queued" : "running";
  return "running";
}

export function progressForStatus(status: NormalizedVideoProviderStatus): number {
  if (status === "completed") return 100;
  if (status === "failed") return 0;
  if (status === "queued") return 10;
  return 55;
}

export function serializeReferenceParameters(references: ResolvedVideoReferences): Record<string, unknown> {
  return {
    videoReferenceMode: references.mode satisfies VideoReferenceMode,
    ...(references.imageUrl ? { imageUrl: references.imageUrl } : {}),
    ...(references.firstFrameUrl ? { firstFrameUrl: references.firstFrameUrl } : {}),
    ...(references.lastFrameUrl ? { lastFrameUrl: references.lastFrameUrl } : {}),
    ...(references.referenceImageUrls.length ? { referenceImageUrls: references.referenceImageUrls } : {}),
    // 仅记录 data URL 的轻量元数据，不写入 data URL 字符串本身
    ...(references.image?.dataUrlSizeInBytes ? { imageDataUrlSizeInBytes: references.image.dataUrlSizeInBytes } : {}),
    ...(references.firstFrame?.dataUrlSizeInBytes ? { firstFrameDataUrlSizeInBytes: references.firstFrame.dataUrlSizeInBytes } : {}),
    ...(references.lastFrame?.dataUrlSizeInBytes ? { lastFrameDataUrlSizeInBytes: references.lastFrame.dataUrlSizeInBytes } : {}),
  };
}
