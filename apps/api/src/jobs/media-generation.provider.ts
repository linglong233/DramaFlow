/**
 * @fileoverview OpenAI 媒体生成 Provider
 * @module api/jobs
 *
 * 通过 OpenAI 兼容接口生成图片和视频。
 */

import { Injectable } from "@nestjs/common";
import type {
  GenerateMediaInput,
  MediaContent,
  MediaGenerationProvider,
} from "@dramaflow/shared";

interface GeneratedMediaContent extends MediaContent {
  inlineBody?: Buffer | Uint8Array | string;
  fileExtension?: string;
}

interface RetrievedVideoContent {
  mimeType: string;
  assetUrl?: string;
  inlineBody?: Uint8Array;
  fileExtension?: string;
}

@Injectable()
export class OpenAiMediaProvider implements MediaGenerationProvider {
  private readonly apiKey = process.env.OPENAI_COMPAT_API_KEY;
  private readonly baseUrl = (process.env.OPENAI_COMPAT_BASE_URL ?? "https://api.openai.com/v1").replace(/\/$/, "");

  async generateImage(input: GenerateMediaInput & { prompt: string }, config?: import("@dramaflow/shared").LlmProviderConfig): Promise<GeneratedMediaContent> {
    const effectiveApiKey = config?.apiKey || this.apiKey;
    if (!effectiveApiKey || effectiveApiKey === "replace-me") {
      if (process.env.NODE_ENV !== "production") {
        return this.mockImage(input);
      }
      throw new Error("OpenAI image generation skipped: API key is not configured");
    }

    const effectiveBaseUrl = (config?.baseUrl || this.baseUrl).replace(/\/$/, "");
    const response = await fetch(`${effectiveBaseUrl}/images/generations`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${effectiveApiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: config?.model || process.env.MEDIA_IMAGE_MODEL || "gpt-image-1",
        prompt: input.prompt,
        size: input.aspectRatio === "16:9" ? "1536x1024" : "1024x1024",
      }),
    });

    if (!response.ok) {
      throw new Error(`OpenAI image generation failed with HTTP ${response.status}`);
    }

    const data = (await response.json()) as {
      data?: Array<{ url?: string; b64_json?: string }>;
    };
    const item = data.data?.[0];
    if (!item) {
      throw new Error("OpenAI image generation response did not include image data");
    }

    if (item.b64_json) {
      return {
        prompt: input.prompt,
        provider: "openai-image",
        mimeType: "image/png",
        parameters: { ...input } as Record<string, unknown>,
        inlineBody: Buffer.from(item.b64_json, "base64"),
        fileExtension: "png",
      };
    }

    return {
      prompt: input.prompt,
      provider: "openai-image",
      mimeType: "image/png",
      parameters: { ...input } as Record<string, unknown>,
      assetUrl: item.url,
    };
  }

  async generateVideo(input: GenerateMediaInput & { prompt: string }, config?: import("@dramaflow/shared").LlmProviderConfig): Promise<GeneratedMediaContent> {
    throw new Error("Synchronous video generation is not supported. Use createVideoJob instead.");
  }

  async createVideoJob(input: GenerateMediaInput & { prompt: string }, config?: import("@dramaflow/shared").LlmProviderConfig): Promise<GeneratedMediaContent> {
    const effectiveApiKey = config?.apiKey || this.apiKey;
    if (!effectiveApiKey || effectiveApiKey === "replace-me") {
      throw new Error("OpenAI video generation skipped: API key is not configured");
    }

    const effectiveBaseUrl = (config?.baseUrl || this.baseUrl).replace(/\/$/, "");
    try {
      const response = await fetch(`${effectiveBaseUrl}/videos`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${effectiveApiKey}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model: config?.model || process.env.MEDIA_VIDEO_MODEL || "sora-2",
          prompt: input.prompt,
          size: input.aspectRatio === "16:9" ? "1920x1080" : "1080x1080",
          duration: input.durationSeconds ?? 5,
          ...(input.referenceImageAssetId ? { image_url: (input as unknown as Record<string, unknown>).referenceImageUrl } : {}),
        }),
      });

      if (!response.ok) {
        throw new Error(`OpenAI video generation failed with HTTP ${response.status}`);
      }

      const data = await response.json() as Record<string, unknown>;
      return this.normalizeVideoJobState(data, input);
    } catch (error) {
      if (error instanceof Error && error.message.startsWith("OpenAI video generation")) {
        throw error;
      }
      const message = error instanceof Error ? error.message : "Unknown provider error";
      throw new Error(`OpenAI video generation request failed: ${message}`);
    }
  }

  async getVideoJob(providerVideoId: string, input: GenerateMediaInput & { prompt: string }, config?: import("@dramaflow/shared").LlmProviderConfig): Promise<GeneratedMediaContent> {
    if (providerVideoId.startsWith("mock:")) {
      throw new Error(`Cannot poll mock video job: ${providerVideoId}`);
    }

    const effectiveApiKey = config?.apiKey || this.apiKey;
    const effectiveBaseUrl = (config?.baseUrl || this.baseUrl).replace(/\/$/, "");

    const response = await fetch(`${effectiveBaseUrl}/videos/${encodeURIComponent(providerVideoId)}`, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${effectiveApiKey}`,
      },
    });

    if (!response.ok) {
      throw new Error(`Video status request failed: HTTP ${response.status}`);
    }

    const data = await response.json() as Record<string, unknown>;
    return this.normalizeVideoJobState({ ...data, id: data.id ?? providerVideoId }, input);
  }

  async downloadVideoContent(providerVideoId: string, config?: import("@dramaflow/shared").LlmProviderConfig): Promise<RetrievedVideoContent> {
    const effectiveApiKey = config?.apiKey || this.apiKey;
    const effectiveBaseUrl = (config?.baseUrl || this.baseUrl).replace(/\/$/, "");

    const response = await fetch(`${effectiveBaseUrl}/videos/${encodeURIComponent(providerVideoId)}/content`, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${effectiveApiKey}`,
      },
    });

    if (!response.ok) {
      throw new Error(`Video content request failed: HTTP ${response.status}`);
    }

    const contentType = response.headers.get("content-type") ?? "video/mp4";
    if (contentType.includes("application/json")) {
      const data = await response.json() as Record<string, unknown>;
      const assetUrl = this.extractUrl(data);
      if (!assetUrl) {
        throw new Error("Video content response did not include a downloadable URL");
      }

      return {
        mimeType: this.readString(data.mime_type) ?? "video/mp4",
        assetUrl,
      };
    }

    const body = new Uint8Array(await response.arrayBuffer());
    return {
      mimeType: contentType,
      inlineBody: body,
      fileExtension: this.inferFileExtension(contentType),
    };
  }

  private normalizeVideoJobState(raw: Record<string, unknown>, input: GenerateMediaInput & { prompt: string }): GeneratedMediaContent {
    const providerStatus = this.normalizeVideoStatus(this.readString(raw.status));
    const providerVideoId = this.readString(raw.id) ?? this.readString(raw.video_id) ?? `video-${Date.now()}`;
    const progress = this.readNumber(raw.progress) ?? this.inferProgress(providerStatus);
    const assetUrl = this.extractUrl(raw);
    const note = this.extractErrorMessage(raw);

    return {
      prompt: input.prompt,
      provider: "openai-video",
      mimeType: this.readString(raw.mime_type) ?? "video/mp4",
      parameters: { ...input } as Record<string, unknown>,
      providerVideoId,
      providerStatus,
      progress,
      assetUrl,
      mode: "provider",
      note,
    };
  }

  private mockImage(input: GenerateMediaInput & { prompt: string }): GeneratedMediaContent {
    const svg = `
      <svg xmlns="http://www.w3.org/2000/svg" width="1280" height="720" viewBox="0 0 1280 720">
        <defs>
          <linearGradient id="g" x1="0" x2="1" y1="0" y2="1">
            <stop offset="0%" stop-color="#11263b" />
            <stop offset="100%" stop-color="#f06d4f" />
          </linearGradient>
        </defs>
        <rect width="1280" height="720" fill="url(#g)" />
        <circle cx="980" cy="180" r="120" fill="rgba(255,255,255,0.14)" />
        <rect x="84" y="96" width="1112" height="528" rx="28" fill="rgba(10, 15, 28, 0.35)" stroke="rgba(255,255,255,0.18)" />
        <text x="120" y="180" fill="#fff4e8" font-size="28" font-family="Segoe UI, sans-serif">DramaFlow Mock Image</text>
        <text x="120" y="240" fill="#ffffff" font-size="44" font-family="Segoe UI, sans-serif">${this.escapeXml(input.prompt.slice(0, 60))}</text>
        <text x="120" y="310" fill="#d9e7ff" font-size="24" font-family="Segoe UI, sans-serif">Style: ${this.escapeXml(input.style)}</text>
        <text x="120" y="356" fill="#d9e7ff" font-size="24" font-family="Segoe UI, sans-serif">Aspect Ratio: ${this.escapeXml(input.aspectRatio)}</text>
        <text x="120" y="420" fill="#ffe5cf" font-size="22" font-family="Segoe UI, sans-serif">Shot: ${this.escapeXml(input.shotId)}</text>
      </svg>
    `.trim();

    return {
      prompt: input.prompt,
      provider: "mock-image",
      mimeType: "image/svg+xml",
      parameters: { ...input, mock: true } as Record<string, unknown>,
      inlineBody: svg,
      fileExtension: "svg",
    };
  }

  private mockVideo(input: GenerateMediaInput & { prompt: string }): GeneratedMediaContent {
    const payload = {
      kind: "mock-video-manifest",
      shotId: input.shotId,
      style: input.style,
      aspectRatio: input.aspectRatio,
      durationSeconds: input.durationSeconds ?? 5,
      prompt: input.prompt,
      beats: [
        "镜头从环境建立开始",
        "推进到角色情绪焦点",
        "以动作或表情结束镜头",
      ],
    };

    return {
      prompt: input.prompt,
      provider: "mock-video",
      mimeType: "application/json",
      parameters: { ...input, mock: true } as Record<string, unknown>,
      inlineBody: JSON.stringify(payload, null, 2),
      fileExtension: "json",
      providerVideoId: `mock:${input.shotId}`,
      providerStatus: "completed",
      progress: 100,
      mode: "mock",
    };
  }

  private mockVideoJob(input: GenerateMediaInput & { prompt: string }, note: string): GeneratedMediaContent {
    return {
      prompt: input.prompt,
      provider: "mock-video",
      mimeType: "application/json",
      parameters: { ...input, mock: true } as Record<string, unknown>,
      providerVideoId: `mock:${input.shotId}`,
      providerStatus: "completed",
      progress: 100,
      mode: "mock",
      note,
    };
  }

  private normalizeVideoStatus(status?: string) {
    if (!status) {
      return "queued";
    }

    const normalized = status.toLowerCase();
    if (["completed", "complete", "succeeded", "success"].includes(normalized)) {
      return "completed";
    }
    if (["failed", "error", "cancelled", "canceled"].includes(normalized)) {
      return "failed";
    }
    if (["in_progress", "processing", "running"].includes(normalized)) {
      return "running";
    }
    return "queued";
  }

  private inferProgress(status: string) {
    if (status === "completed") {
      return 100;
    }
    if (status === "running") {
      return 55;
    }
    if (status === "failed") {
      return 0;
    }
    return 10;
  }

  private inferFileExtension(contentType: string) {
    if (contentType.includes("mp4")) {
      return "mp4";
    }
    if (contentType.includes("webm")) {
      return "webm";
    }
    if (contentType.includes("quicktime")) {
      return "mov";
    }
    return "bin";
  }

  private extractUrl(raw: Record<string, unknown>) {
    const direct = ["url", "output_url", "download_url", "asset_url"]
      .map((key) => this.readString(raw[key]))
      .find((value) => Boolean(value));
    if (direct) {
      return direct;
    }

    const output = raw.output;
    if (Array.isArray(output)) {
      for (const item of output) {
        if (item && typeof item === "object") {
          const url = this.readString((item as Record<string, unknown>).url);
          if (url) {
            return url;
          }
        }
      }
    }

    return undefined;
  }

  private extractErrorMessage(raw: Record<string, unknown>) {
    if (typeof raw.error === "string") {
      return raw.error;
    }

    if (raw.error && typeof raw.error === "object") {
      return this.readString((raw.error as Record<string, unknown>).message);
    }

    return undefined;
  }

  private readString(value: unknown) {
    return typeof value === "string" && value.trim() ? value : undefined;
  }

  private readNumber(value: unknown) {
    return typeof value === "number" && Number.isFinite(value) ? value : undefined;
  }

  private escapeXml(value: string | undefined) {
    if (!value) return "";
    return value
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/\"/g, "&quot;")
      .replace(/'/g, "&apos;");
  }
}