/**
 * @fileoverview 阿里（Ali）视频 Provider 适配器
 * @module api/jobs/video-providers
 *
 * 实现阿里 DashScope 视频生成 API 的 createJob / pollJob 逻辑。
 * 使用 img_url / last_img_url 传递参考图，task_status 在嵌套 output 对象中。
 */

import type { VideoProviderAdapter, VideoProviderCreateInput, VideoProviderJobState, VideoProviderPollInput } from "./types";
import { joinProviderUrl, progressForStatus, readString, serializeReferenceParameters } from "./types";

type AliTaskStatus = "PENDING" | "RUNNING" | "SUCCEEDED" | "FAILED";

export class AliVideoProviderAdapter implements VideoProviderAdapter {
  readonly provider = "ali" as const;

  async createJob(input: VideoProviderCreateInput): Promise<VideoProviderJobState> {
    const model = input.config.model || "wan2.6-i2v-flash";
    const aliInput: Record<string, unknown> = {
      prompt: input.prompt,
    };
    if (input.references.mode === "single" && input.references.imageUrl) {
      aliInput.img_url = input.references.imageUrl;
    } else if (input.references.mode === "first_last") {
      if (input.references.firstFrameUrl) aliInput.img_url = input.references.firstFrameUrl;
      if (input.references.lastFrameUrl) aliInput.last_img_url = input.references.lastFrameUrl;
    } else if (input.references.mode === "multiple" && input.references.referenceImageUrls.length > 0) {
      aliInput.img_url = input.references.referenceImageUrls[0];
    }

    const resolution = input.aspectRatio === "16:9" ? "1080P" : "720P";

    const response = await fetch(joinProviderUrl(input.config.baseUrl, "https://dashscope.aliyuncs.com", "/api/v1/services/aigc/video-generation/video-synthesis"), {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${input.config.apiKey ?? ""}`,
        "x-dashscope-async": "enable",
      },
      body: JSON.stringify({
        model,
        input: aliInput,
        parameters: {
          resolution,
          ...(input.durationSeconds ? { duration: input.durationSeconds } : {}),
        },
      }),
    });
    const raw = await readJsonResponse(response, "Ali video generation");
    return normalizeAliState(raw, input);
  }

  async pollJob(providerVideoId: string, input: VideoProviderPollInput): Promise<VideoProviderJobState> {
    const response = await fetch(joinProviderUrl(input.config.baseUrl, "https://dashscope.aliyuncs.com", `/api/v1/tasks/${encodeURIComponent(providerVideoId)}`), {
      method: "GET",
      headers: { authorization: `Bearer ${input.config.apiKey ?? ""}` },
    });
    const raw = await readJsonResponse(response, "Ali video polling");
    return normalizeAliState(raw, input, providerVideoId);
  }
}

function normalizeAliStatus(value: unknown): "queued" | "running" | "completed" | "failed" {
  const status = String(value || "") as AliTaskStatus;
  if (status === "SUCCEEDED") return "completed";
  if (status === "FAILED") return "failed";
  if (status === "PENDING") return "queued";
  if (status === "RUNNING") return "running";
  return "running";
}

async function readJsonResponse(response: Response, label: string): Promise<Record<string, unknown>> {
  const rawText = await response.text();
  if (!response.ok) throw new Error(`${label} failed with HTTP ${response.status}: ${rawText.slice(0, 300)}`);
  return rawText ? JSON.parse(rawText) as Record<string, unknown> : {};
}

function normalizeAliState(raw: Record<string, unknown>, input: VideoProviderCreateInput | VideoProviderPollInput, fallbackId?: string): VideoProviderJobState {
  const output = raw.output && typeof raw.output === "object" ? raw.output as Record<string, unknown> : {};
  const providerVideoId = readString(output.task_id) ?? fallbackId;
  const taskStatus = output.task_status;
  const status = normalizeAliStatus(taskStatus);
  const videoUrl = readString(output.video_url);
  const finalStatus = videoUrl ? "completed" : status;

  return {
    provider: "ali-video",
    providerVideoId,
    providerStatus: finalStatus,
    progress: progressForStatus(finalStatus),
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
