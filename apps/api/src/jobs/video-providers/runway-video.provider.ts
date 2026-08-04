/**
 * @fileoverview Runway 视频 Provider 适配器
 * @module api/jobs/video-providers
 *
 * 实现 RunwayML 官方 API 的 createJob / pollJob 逻辑。
 * 文档：https://docs.dev.runwayml.com/api/
 *   - POST /v1/image_to_video（参考图模式）
 *   - POST /v1/text_to_video（纯文本）
 *   - GET  /v1/tasks/{id}（轮询，状态大写：PENDING/RUNNING/SUCCEEDED/FAILED/CANCELED）
 * 认证：Bearer API key。
 */

import { DEFAULT_VIDEO_PROVIDER_MODELS } from "@dramaflow/shared";

import type { VideoProviderAdapter, VideoProviderCreateInput, VideoProviderJobState, VideoProviderPollInput } from "./types";
import { joinProviderUrl, progressForStatus, readString, serializeReferenceParameters } from "./types";

const RUNWAY_DEFAULT_BASE_URL = "https://api.dev.runwayml.com";

/** Runway 任务状态使用大写枚举，需独立归一化（normalizeStatus 默认按小写匹配） */
function normalizeRunwayStatus(raw: unknown, hasOutput: boolean): "queued" | "running" | "completed" | "failed" {
  if (hasOutput) return "completed";
  const status = String(raw || "").toUpperCase();
  if (status === "SUCCEEDED") return "completed";
  if (status === "FAILED" || status === "CANCELED") return "failed";
  if (status === "PENDING" || status === "THROTTLED") return "queued";
  // RUNNING 或未知
  return "running";
}

export class RunwayVideoProviderAdapter implements VideoProviderAdapter {
  readonly provider = "runway" as const;

  async createJob(input: VideoProviderCreateInput): Promise<VideoProviderJobState> {
    const hasReference = input.references.mode !== "none";
    const path = hasReference ? "/v1/image_to_video" : "/v1/text_to_video";

    // Runway image_to_video 用 promptImage（单图），text_to_video 用 promptText
    const body: Record<string, unknown> = {
      model: input.config.model || DEFAULT_VIDEO_PROVIDER_MODELS.runway,
      promptText: input.prompt,
      ...(input.durationSeconds ? { duration: input.durationSeconds } : {}),
    };
    if (hasReference) {
      const refImage = pickSingleReferenceUrl(input.references);
      if (refImage) body.promptImage = refImage;
    }

    const response = await fetch(joinProviderUrl(input.config.baseUrl, RUNWAY_DEFAULT_BASE_URL, path), {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${input.config.apiKey ?? ""}`,
        "X-Runway-Version": "2024-11-06",
      },
      body: JSON.stringify(body),
    });
    const rawText = await response.text();
    if (!response.ok) throw new Error(`Runway video generation failed with HTTP ${response.status}: ${rawText.slice(0, 300)}`);
    const raw = rawText ? JSON.parse(rawText) as Record<string, unknown> : {};
    return normalizeRunwayState(raw, input);
  }

  async pollJob(providerVideoId: string, input: VideoProviderPollInput): Promise<VideoProviderJobState> {
    const response = await fetch(joinProviderUrl(input.config.baseUrl, RUNWAY_DEFAULT_BASE_URL, `/v1/tasks/${encodeURIComponent(providerVideoId)}`), {
      method: "GET",
      headers: {
        authorization: `Bearer ${input.config.apiKey ?? ""}`,
        "X-Runway-Version": "2024-11-06",
      },
    });
    const rawText = await response.text();
    if (!response.ok) throw new Error(`Runway video polling failed with HTTP ${response.status}: ${rawText.slice(0, 300)}`);
    const raw = rawText ? JSON.parse(rawText) as Record<string, unknown> : {};
    return normalizeRunwayState(raw, input);
  }
}

/** 从参考图对象提取单张 URL（Runway image_to_video 仅支持单图） */
function pickSingleReferenceUrl(references: VideoProviderCreateInput["references"]): string | undefined {
  if (references.mode === "single" && references.imageUrl) return references.imageUrl;
  if (references.mode === "first_last") return references.firstFrameUrl ?? references.lastFrameUrl;
  if (references.mode === "multiple" && references.referenceImageUrls.length > 0) return references.referenceImageUrls[0];
  return undefined;
}

function normalizeRunwayState(raw: Record<string, unknown>, input: VideoProviderCreateInput | VideoProviderPollInput): VideoProviderJobState {
  const providerVideoId = readString(raw.id) ?? readString(raw.taskId);
  // output 可能是字符串 URL 或数组
  const output = raw.output;
  let videoUrl: string | undefined;
  if (typeof output === "string") {
    videoUrl = output;
  } else if (Array.isArray(output) && output.length > 0 && typeof output[0] === "string") {
    videoUrl = output[0];
  } else if (output && typeof output === "object") {
    videoUrl = readString((output as Record<string, unknown>).url);
  }
  const status = normalizeRunwayStatus(raw.status, Boolean(videoUrl));
  const failure = readString(raw.failure) ?? readString(raw.failureCode);
  return {
    provider: "runway-video",
    providerVideoId,
    providerStatus: status,
    progress: progressForStatus(status),
    assetUrl: videoUrl,
    mimeType: "video/mp4",
    raw,
    parameters: {
      prompt: input.prompt,
      aspectRatio: input.aspectRatio,
      durationSeconds: input.durationSeconds,
      ...serializeReferenceParameters(input.references),
    },
  };
}
