/**
 * @fileoverview MiniMax 视频 Provider 适配器
 * @module api/jobs/video-providers
 *
 * 实现 MiniMax 视频生成 API 的 createJob / pollJob 逻辑。
 * 使用 content 数组传递 prompt 和参考图，Bearer token 鉴权。
 */

import type { VideoProviderAdapter, VideoProviderCreateInput, VideoProviderJobState, VideoProviderPollInput } from "./types";
import { joinProviderUrl, normalizeStatus, progressForStatus, readString, serializeReferenceParameters } from "./types";

export class MiniMaxVideoProviderAdapter implements VideoProviderAdapter {
  readonly provider = "minimax" as const;

  async createJob(input: VideoProviderCreateInput): Promise<VideoProviderJobState> {
    const promptText = `${input.prompt}  --ratio ${input.aspectRatio || "16:9"}  --dur ${input.durationSeconds || 5}`;
    const content: Array<Record<string, unknown>> = [{ type: "text", text: promptText }];
    appendContentReferences(content, input.references);

    const response = await fetch(joinProviderUrl(input.config.baseUrl, "https://api.minimax.chat", "/v1/video_generation"), {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${input.config.apiKey ?? ""}`,
      },
      body: JSON.stringify({
        model: input.config.model || "video-01",
        content,
      }),
    });
    const raw = await readJsonResponse(response, "MiniMax video generation");
    return normalizeMiniMaxState(raw, input);
  }

  async pollJob(providerVideoId: string, input: VideoProviderPollInput): Promise<VideoProviderJobState> {
    const response = await fetch(joinProviderUrl(input.config.baseUrl, "https://api.minimax.chat", `/v1/video_generation/task/${encodeURIComponent(providerVideoId)}`), {
      method: "GET",
      headers: { authorization: `Bearer ${input.config.apiKey ?? ""}` },
    });
    const raw = await readJsonResponse(response, "MiniMax video polling");
    return normalizeMiniMaxState({ ...raw, task_id: providerVideoId }, input);
  }
}

function appendContentReferences(content: Array<Record<string, unknown>>, references: VideoProviderCreateInput["references"]): void {
  if (references.mode === "single" && references.imageUrl) {
    content.push({ type: "image_url", image_url: { url: references.imageUrl }, role: "reference_image" });
  } else if (references.mode === "first_last") {
    if (references.firstFrameUrl) content.push({ type: "image_url", image_url: { url: references.firstFrameUrl }, role: "first_frame" });
    if (references.lastFrameUrl) content.push({ type: "image_url", image_url: { url: references.lastFrameUrl }, role: "last_frame" });
  } else if (references.mode === "multiple") {
    for (const url of references.referenceImageUrls) {
      content.push({ type: "image_url", image_url: { url }, role: "reference_image" });
    }
  }
}

async function readJsonResponse(response: Response, label: string): Promise<Record<string, unknown>> {
  const rawText = await response.text();
  if (!response.ok) throw new Error(`${label} failed with HTTP ${response.status}: ${rawText.slice(0, 300)}`);
  return rawText ? JSON.parse(rawText) as Record<string, unknown> : {};
}

function normalizeMiniMaxState(raw: Record<string, unknown>, input: VideoProviderCreateInput | VideoProviderPollInput): VideoProviderJobState {
  const data = raw.data && typeof raw.data === "object" ? raw.data as Record<string, unknown> : {};
  const providerVideoId = readString(raw.task_id) ?? readString(raw.id) ?? readString(data.id);
  const videoUrl = readString(raw.video_url) ?? readString(data.video_url);
  const status = videoUrl ? "completed" : normalizeStatus(raw.status ?? data.status);
  return {
    provider: "minimax-video",
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
