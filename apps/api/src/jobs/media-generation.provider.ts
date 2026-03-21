import { Injectable } from "@nestjs/common";
import type {
  GenerateMediaInput,
  MediaContent,
  MediaGenerationProvider,
} from "@dramaflow/shared";

interface GeneratedMediaContent extends MediaContent {
  inlineBody?: Buffer | string;
  fileExtension?: string;
}

@Injectable()
export class OpenAiMediaProvider implements MediaGenerationProvider {
  private readonly apiKey = process.env.OPENAI_COMPAT_API_KEY;
  private readonly baseUrl = (process.env.OPENAI_COMPAT_BASE_URL ?? "https://api.openai.com/v1").replace(/\/$/, "");

  async generateImage(input: GenerateMediaInput & { prompt: string }): Promise<GeneratedMediaContent> {
    if (!this.apiKey || this.apiKey === "replace-me") {
      return this.mockImage(input);
    }

    const response = await fetch(`${this.baseUrl}/images/generations`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: process.env.MEDIA_IMAGE_MODEL ?? "gpt-image-1",
        prompt: input.prompt,
        size: input.aspectRatio === "16:9" ? "1536x1024" : "1024x1024",
      }),
    });

    if (!response.ok) {
      return this.mockImage(input);
    }

    const data = (await response.json()) as {
      data?: Array<{ url?: string; b64_json?: string }>;
    };
    const item = data.data?.[0];
    if (!item) {
      return this.mockImage(input);
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

  async generateVideo(input: GenerateMediaInput & { prompt: string }): Promise<GeneratedMediaContent> {
    return this.mockVideo(input);
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
