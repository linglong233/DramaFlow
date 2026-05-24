/**
 * @fileoverview 火山引擎（VolcEngine）视频 Provider 适配器
 * @module api/jobs/video-providers
 *
 * 实现 VolcEngine / Seedance 视频生成 API 的 createJob / pollJob 逻辑。
 * 使用 content 数组，duration 限制在 4-12 秒。
 */

import type { VideoProviderAdapter, VideoProviderCreateInput, VideoProviderJobState, VideoProviderPollInput } from "./types";
import { joinProviderUrl, normalizeStatus, progressForStatus, readString, serializeReferenceParameters } from "./types";

export class VolcEngineVideoProviderAdapter implements VideoProviderAdapter {
  readonly provider = "volcengine" as const;

  async createJob(input: VideoProviderCreateInput): Promise<VideoProviderJobState> {
    const promptText = `${input.prompt}  --ratio ${input.aspectRatio || "adaptive"}  --dur ${normalizeDuration(input.durationSeconds)}`;
    const content: Array<Record<string, unknown>> = [{ type: "text", text: promptText }];
    appendContentReferences(content, input.references);

    const response = await fetch(joinProviderUrl(input.config.baseUrl, "https://visual.volcengineapi.com", "/api/v3/contents/generations/tasks"), {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${input.config.apiKey ?? ""}`,
      },
      body: JSON.stringify({
        model: input.config.model || "doubao-seedance-1-5-pro-251215",
        content,
        generate_audio: true,
        ratio: input.aspectRatio || "adaptive",
        duration: normalizeDuration(input.durationSeconds),
        watermark: false,
      }),
    });
    const raw = await readJsonResponse(response, "VolcEngine video generation");
    return normalizeVolcEngineState(raw, input);
  }

  async pollJob(providerVideoId: string, input: VideoProviderPollInput): Promise<VideoProviderJobState> {
    const response = await fetch(joinProviderUrl(input.config.baseUrl, "https://visual.volcengineapi.com", `/api/v3/contents/generations/tasks/${encodeURIComponent(providerVideoId)}`), {
      method: "GET",
      headers: { authorization: `Bearer ${input.config.apiKey ?? ""}` },
    });
    const raw = await readJsonResponse(response, "VolcEngine video polling");
    return normalizeVolcEngineState({ ...raw, id: providerVideoId }, input);
  }
}

function normalizeDuration(duration?: number): number {
  const parsed = Math.round(Number(duration || 5));
  if (!Number.isFinite(parsed)) return 5;
  return Math.min(12, Math.max(4, parsed));
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

function normalizeVolcEngineState(raw: Record<string, unknown>, input: VideoProviderCreateInput | VideoProviderPollInput): VideoProviderJobState {
  const content = raw.content && typeof raw.content === "object" ? raw.content as Record<string, unknown> : {};
  const data = raw.data && typeof raw.data === "object" ? raw.data as Record<string, unknown> : {};
  const providerVideoId = readString(raw.id) ?? readString(raw.task_id) ?? readString(data.id);
  const videoUrl = readString(raw.video_url) ?? readString(content.video_url) ?? readString(data.video_url);
  const status = videoUrl ? "completed" : normalizeStatus(raw.status ?? data.status);
  return {
    provider: "volcengine-video",
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
