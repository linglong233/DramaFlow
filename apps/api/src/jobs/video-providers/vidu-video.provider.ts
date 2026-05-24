/**
 * @fileoverview Vidu 视频 Provider 适配器
 * @module api/jobs/video-providers
 *
 * 实现 Vidu 视频生成 API 的 createJob / pollJob 逻辑。
 * Token 鉴权，使用 images 数组传递参考图。
 * 当前不支持 webhook，pollJob 返回 running 状态并附带提示说明。
 */

import type { VideoProviderAdapter, VideoProviderCreateInput, VideoProviderJobState, VideoProviderPollInput } from "./types";
import { joinProviderUrl, progressForStatus, readString, serializeReferenceParameters } from "./types";

export class ViduVideoProviderAdapter implements VideoProviderAdapter {
  readonly provider = "vidu" as const;

  async createJob(input: VideoProviderCreateInput): Promise<VideoProviderJobState> {
    const images = collectImages(input.references);
    const response = await fetch(joinProviderUrl(input.config.baseUrl, "https://api.vidu.com", "/ent/v2/img2video"), {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Token ${input.config.apiKey ?? ""}`,
      },
      body: JSON.stringify({
        model: input.config.model || "viduq3-turbo",
        prompt: input.prompt,
        images,
        ...(input.durationSeconds ? { duration: input.durationSeconds } : {}),
        resolution: "720p",
      }),
    });
    const rawText = await response.text();
    if (!response.ok) throw new Error(`Vidu video generation failed with HTTP ${response.status}: ${rawText.slice(0, 300)}`);
    const raw = rawText ? JSON.parse(rawText) as Record<string, unknown> : {};
    const providerVideoId = readString(raw.task_id) ?? readString(raw.id);
    return {
      provider: "vidu-video",
      providerVideoId,
      providerStatus: "running",
      progress: progressForStatus("running"),
      mimeType: "video/mp4",
      note: "Provider is waiting for callback; webhook is not enabled in this build.",
      raw,
      parameters: { prompt: input.prompt, aspectRatio: input.aspectRatio, durationSeconds: input.durationSeconds, ...serializeReferenceParameters(input.references) },
    };
  }

  async pollJob(providerVideoId: string, input: VideoProviderPollInput): Promise<VideoProviderJobState> {
    return {
      provider: "vidu-video",
      providerVideoId,
      providerStatus: "running",
      progress: progressForStatus("running"),
      mimeType: "video/mp4",
      note: "Provider is waiting for callback; webhook is not enabled in this build.",
      parameters: { prompt: input.prompt, aspectRatio: input.aspectRatio, durationSeconds: input.durationSeconds, ...serializeReferenceParameters(input.references) },
    };
  }
}

function collectImages(references: VideoProviderCreateInput["references"]): string[] {
  if (references.mode === "single" && references.imageUrl) return [references.imageUrl];
  if (references.mode === "first_last") return [references.firstFrameUrl, references.lastFrameUrl].filter((url): url is string => Boolean(url));
  if (references.mode === "multiple") return references.referenceImageUrls;
  return [];
}
