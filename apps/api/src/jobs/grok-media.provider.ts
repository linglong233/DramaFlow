/**
 * @fileoverview Grok (grok2api) 媒体生成 Provider
 * @module api/jobs
 *
 * 通过 grok2api 代理服务生成图片和视频。
 * grok2api 是 OpenAI 兼容的 FastAPI 代理，封装 Grok 的 AI 能力。
 *
 * 图片生成：POST {baseUrl}/v1/images/generations
 * 视频生成：POST {baseUrl}/v1/chat/completions (model: grok-imagine-1.0-video)
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

/** grok2api 图片生成响应 */
interface GrokImageResponse {
  created?: number;
  data?: Array<{ url?: string; b64_json?: string }>;
}

/** grok2api chat completions 响应 */
interface GrokChatResponse {
  id?: string;
  choices?: Array<{
    message?: { content?: string };
    finish_reason?: string;
  }>;
}

/** grok2api 视频配置 */
interface GrokVideoConfig {
  aspect_ratio?: string;
  video_length?: number;
  resolution?: string;
  preset?: string;
}

@Injectable()
export class GrokMediaProvider implements MediaGenerationProvider {

  async generateImage(
    input: GenerateMediaInput & { prompt: string },
    config?: import("@dramaflow/shared").LlmProviderConfig,
  ): Promise<GeneratedMediaContent> {
    const apiKey = config?.apiKey;
    if (!apiKey) {
      throw new Error("Grok image generation skipped: API key is not configured");
    }

    const baseUrl = (config?.baseUrl || "http://localhost:8000").replace(/\/$/, "");
    const model = config?.model || "grok-imagine-1.0";
    console.log(`[GrokMediaProvider] Generating image: ${baseUrl}/v1/images/generations, model=${model}`);

    let response: Response;
    try {
      response = await fetch(`${baseUrl}/v1/images/generations`, {
        method: "POST",
        headers: {
          ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model,
          prompt: input.prompt,
          n: 1,
          response_format: "url",
        }),
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      throw new Error(`Grok image generation request failed: ${message}`);
    }

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new Error(`Grok image generation failed with HTTP ${response.status}: ${body.slice(0, 500)}`);
    }

    const data = (await response.json()) as GrokImageResponse;
    const item = data.data?.[0];
    if (!item) {
      throw new Error("Grok image generation response had no data items");
    }

    if (item.url) {
      const imageUrl = this.ensureProtocol(item.url);
      console.log(`[GrokMediaProvider] Downloading image from: ${imageUrl}`);
      let imageResponse: Response;
      try {
        imageResponse = await fetch(imageUrl);
      } catch (err) {
        const message = err instanceof Error ? err.message : "Unknown error";
        throw new Error(`Grok image download failed: ${message}`);
      }
      if (!imageResponse.ok) {
        throw new Error(`Grok image download failed with HTTP ${imageResponse.status}`);
      }
      const body = new Uint8Array(await imageResponse.arrayBuffer());
      return {
        prompt: input.prompt,
        provider: "grok-image",
        mimeType: "image/png",
        parameters: { ...input } as Record<string, unknown>,
        inlineBody: body,
        fileExtension: "png",
      };
    }

    if (item.b64_json) {
      return {
        prompt: input.prompt,
        provider: "grok-image",
        mimeType: "image/png",
        parameters: { ...input } as Record<string, unknown>,
        inlineBody: Buffer.from(item.b64_json, "base64"),
        fileExtension: "png",
      };
    }

    throw new Error("Grok image generation response had no usable image data");
  }

  async generateVideo(
    input: GenerateMediaInput & { prompt: string },
    config?: import("@dramaflow/shared").LlmProviderConfig,
  ): Promise<GeneratedMediaContent> {
    const apiKey = config?.apiKey;
    if (!apiKey) {
      throw new Error("Grok video generation skipped: API key is not configured");
    }

    const baseUrl = (config?.baseUrl || "http://localhost:8000").replace(/\/$/, "");
    const grokConfig = (input as unknown as Record<string, unknown>).grokConfig as
      | import("@dramaflow/shared").GrokConfig
      | undefined;
    const videoModel = grokConfig?.videoModel || "grok-imagine-1.0-video";

    const videoConfig: GrokVideoConfig = {
      aspect_ratio: grokConfig?.aspectRatio || this.mapAspectRatio(input.aspectRatio),
      video_length: grokConfig?.videoLength || input.durationSeconds || 6,
      resolution: grokConfig?.resolution || "HD",
      preset: "normal",
    };

    // 构建 messages：支持图生视频
    const messages: Array<Record<string, unknown>> = [];

    if (input.referenceImageAssetId) {
      const imageUrl = (input as unknown as Record<string, unknown>).referenceImageUrl as string | undefined;
      if (imageUrl) {
        messages.push({
          role: "user",
          content: [
            { type: "image_url", image_url: { url: imageUrl } },
            { type: "text", text: input.prompt },
          ],
        });
      }
    }

    if (messages.length === 0) {
      messages.push({ role: "user", content: input.prompt });
    }

    const response = await fetch(`${baseUrl}/v1/chat/completions`, {
      method: "POST",
      headers: {
        ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: videoModel,
        messages,
        stream: false,
        video_config: videoConfig,
      }),
    });

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new Error(`Grok video generation failed with HTTP ${response.status}: ${body.slice(0, 500)}`);
    }

    const data = (await response.json()) as GrokChatResponse;
    const content = data.choices?.[0]?.message?.content;
    if (!content) {
      throw new Error("Grok video generation response had no content");
    }

    // 从 HTML <video> 标签中提取视频 URL
    const videoUrl = this.extractVideoUrl(content);
    if (!videoUrl) {
      throw new Error("Grok video generation response did not include a video URL");
    }

    const videoResponse = await fetch(this.ensureProtocol(videoUrl));
    if (!videoResponse.ok) {
      throw new Error(`Grok video download failed with HTTP ${videoResponse.status}`);
    }

    const body = new Uint8Array(await videoResponse.arrayBuffer());
    return {
      prompt: input.prompt,
      provider: "grok-video",
      mimeType: "video/mp4",
      parameters: { ...input } as Record<string, unknown>,
      inlineBody: body,
      fileExtension: "mp4",
    };
  }

  /** 确保URL包含协议头（grok2api 返回的URL可能缺少 https://） */
  private ensureProtocol(url: string): string {
    if (url.startsWith("http://") || url.startsWith("https://")) {
      return url;
    }
    return `https://${url}`;
  }

  /** 从 grok2api 返回的 HTML content 中提取视频 URL */
  private extractVideoUrl(content: string): string | undefined {
    const match = content.match(/<source[^>]+src="([^"]+)"/);
    return match?.[1];
  }

  /** 将画面比例映射到 grok2api 支持的格式 */
  private mapAspectRatio(aspectRatio?: string): string {
    const supported = ["16:9", "9:16", "1:1", "2:3", "3:2"];
    if (aspectRatio && supported.includes(aspectRatio)) {
      return aspectRatio;
    }
    return "16:9";
  }

  private mockImage(input: GenerateMediaInput & { prompt: string }): GeneratedMediaContent {
    const svg = `
      <svg xmlns="http://www.w3.org/2000/svg" width="1280" height="720" viewBox="0 0 1280 720">
        <defs>
          <linearGradient id="g" x1="0" x2="1" y1="0" y2="1">
            <stop offset="0%" stop-color="#1a1a2e" />
            <stop offset="100%" stop-color="#e94560" />
          </linearGradient>
        </defs>
        <rect width="1280" height="720" fill="url(#g)" />
        <circle cx="980" cy="180" r="120" fill="rgba(255,255,255,0.14)" />
        <rect x="84" y="96" width="1112" height="528" rx="28" fill="rgba(10, 15, 28, 0.35)" stroke="rgba(255,255,255,0.18)" />
        <text x="120" y="180" fill="#fff4e8" font-size="28" font-family="Segoe UI, sans-serif">Grok Mock Image</text>
        <text x="120" y="240" fill="#ffffff" font-size="44" font-family="Segoe UI, sans-serif">${this.escapeXml(input.prompt.slice(0, 60))}</text>
        <text x="120" y="310" fill="#d9e7ff" font-size="24" font-family="Segoe UI, sans-serif">Style: ${this.escapeXml(input.style)}</text>
        <text x="120" y="356" fill="#d9e7ff" font-size="24" font-family="Segoe UI, sans-serif">Aspect Ratio: ${this.escapeXml(input.aspectRatio)}</text>
        <text x="120" y="420" fill="#ffe5cf" font-size="22" font-family="Segoe UI, sans-serif">Shot: ${this.escapeXml(input.shotId)}</text>
      </svg>
    `.trim();

    return {
      prompt: input.prompt,
      provider: "mock-grok-image",
      mimeType: "image/svg+xml",
      parameters: { ...input, mock: true } as Record<string, unknown>,
      inlineBody: svg,
      fileExtension: "svg",
    };
  }

  private mockVideo(input: GenerateMediaInput & { prompt: string }): GeneratedMediaContent {
    const payload = {
      kind: "mock-grok-video-manifest",
      shotId: input.shotId,
      style: input.style,
      aspectRatio: input.aspectRatio,
      durationSeconds: input.durationSeconds ?? 6,
      prompt: input.prompt,
      beats: [
        "镜头从环境建立开始",
        "推进到角色情绪焦点",
        "以动作或表情结束镜头",
      ],
    };

    return {
      prompt: input.prompt,
      provider: "mock-grok-video",
      mimeType: "application/json",
      parameters: { ...input, mock: true } as Record<string, unknown>,
      inlineBody: JSON.stringify(payload, null, 2),
      fileExtension: "json",
      providerVideoId: `mock:grok:${input.shotId}`,
      providerStatus: "completed",
      progress: 100,
      mode: "mock",
    };
  }

  private escapeXml(value: string) {
    return value
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&apos;");
  }
}
