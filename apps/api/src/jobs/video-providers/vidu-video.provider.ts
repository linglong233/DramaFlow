/**
 * @fileoverview Vidu 视频 Provider 适配器
 * @module api/jobs/video-providers
 *
 * 实现 Vidu 视频生成 API 的 createJob / pollJob 逻辑。
 * Token 鉴权，使用 images 数组传递参考图。
 * pollJob 通过 GET /ent/v2/img2video/task/{task_id} 查询任务状态。
 */

import { DEFAULT_VIDEO_PROVIDER_MODELS } from "@dramaflow/shared";

import type { VideoProviderAdapter, VideoProviderCreateInput, VideoProviderJobState, VideoProviderPollInput } from "./types";
import { joinProviderUrl, normalizeStatus, progressForStatus, readString, serializeReferenceParameters } from "./types";

const VIDU_DEFAULT_BASE_URL = "https://api.vidu.com";

export class ViduVideoProviderAdapter implements VideoProviderAdapter {
  readonly provider = "vidu" as const;

  async createJob(input: VideoProviderCreateInput): Promise<VideoProviderJobState> {
    const images = collectImages(input.references);
    const response = await fetch(joinProviderUrl(input.config.baseUrl, VIDU_DEFAULT_BASE_URL, "/ent/v2/img2video"), {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Token ${input.config.apiKey ?? ""}`,
      },
      body: JSON.stringify({
        model: input.config.model || DEFAULT_VIDEO_PROVIDER_MODELS.vidu,
        prompt: input.prompt,
        images,
        ...(input.durationSeconds ? { duration: input.durationSeconds } : {}),
        resolution: "720p",
      }),
    });
    const rawText = await response.text();
    if (!response.ok) throw new Error(`Vidu video generation failed with HTTP ${response.status}: ${rawText.slice(0, 300)}`);
    const raw = rawText ? JSON.parse(rawText) as Record<string, unknown> : {};
    return normalizeViduState(raw, input);
  }

  async pollJob(providerVideoId: string, input: VideoProviderPollInput): Promise<VideoProviderJobState> {
    const response = await fetch(joinProviderUrl(input.config.baseUrl, VIDU_DEFAULT_BASE_URL, `/ent/v2/img2video/task/${encodeURIComponent(providerVideoId)}`), {
      method: "GET",
      headers: { authorization: `Token ${input.config.apiKey ?? ""}` },
    });
    const rawText = await response.text();
    if (!response.ok) throw new Error(`Vidu video polling failed with HTTP ${response.status}: ${rawText.slice(0, 300)}`);
    const raw = rawText ? JSON.parse(rawText) as Record<string, unknown> : {};
    return normalizeViduState({ ...raw, task_id: providerVideoId }, input);
  }
}

function collectImages(references: VideoProviderCreateInput["references"]): string[] {
  if (references.mode === "single" && references.imageUrl) return [references.imageUrl];
  if (references.mode === "first_last") return [references.firstFrameUrl, references.lastFrameUrl].filter((url): url is string => Boolean(url));
  if (references.mode === "multiple") return references.referenceImageUrls;
  return [];
}

/**
 * 归一化 Vidu 返回状态为通用 VideoProviderJobState。
 * Vidu 状态字段（按官方文档，若文档字段名不同需在此调整）：
 *   - state: "success" | "failed" | "processing" | "queueing"
 *   - video_url: 成功时的视频下载地址
 *   - err_msg: 失败时的错误信息
 */
function normalizeViduState(raw: Record<string, unknown>, input: VideoProviderCreateInput | VideoProviderPollInput): VideoProviderJobState {
  const providerVideoId = readString(raw.task_id) ?? readString(raw.id);
  const videoUrl = readString(raw.video_url);
  const viduState = readString(raw.state);
  let status: ReturnType<typeof normalizeStatus>;
  if (videoUrl) {
    status = "completed";
  } else if (viduState === "success") {
    status = "completed";
  } else if (viduState === "failed") {
    status = "failed";
  } else {
    status = normalizeStatus(viduState ?? raw.status);
  }
  return {
    provider: "vidu-video",
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
