import { Injectable } from "@nestjs/common";
import type { GenerateMediaInput, ImageGenerationConfig, MediaContent } from "@dramaflow/shared";

interface ReferenceImageInput {
  body: Uint8Array;
  mimeType: string;
}

interface GoogleGeminiImageInput extends GenerateMediaInput {
  prompt: string;
  referenceImage?: ReferenceImageInput;
}

interface GeneratedImageContent extends MediaContent {
  inlineBody?: Buffer | Uint8Array | string;
  fileExtension?: string;
}

interface GeminiInlineData {
  data?: string;
  mimeType?: string;
}

@Injectable()
export class GoogleGeminiImageProvider {
  private readonly apiKey = process.env.GOOGLE_IMAGE_API_KEY;
  private readonly baseUrl = (process.env.GOOGLE_IMAGE_BASE_URL ?? "https://generativelanguage.googleapis.com/v1beta").replace(/\/$/, "");
  private readonly model = process.env.GOOGLE_IMAGE_MODEL ?? "gemini-3.1-flash-image-preview";

  async generateImage(input: GoogleGeminiImageInput, config?: ImageGenerationConfig): Promise<GeneratedImageContent> {
    const effectiveApiKey = config?.apiKey?.trim() || this.apiKey;
    const effectiveModel = config?.model?.trim() || this.model;
    const effectiveBaseUrl = (config?.baseUrl?.trim() || this.baseUrl).replace(/\/$/, "");

    if (!effectiveApiKey) {
      throw new Error("Google image API key is required");
    }

    const parts: Array<Record<string, unknown>> = [{ text: input.prompt }];
    if (input.referenceImage) {
      parts.push({
        inline_data: {
          mime_type: input.referenceImage.mimeType,
          data: Buffer.from(input.referenceImage.body).toString("base64"),
        },
      });
    }

    const response = await fetch(
      `${effectiveBaseUrl}/models/${encodeURIComponent(effectiveModel)}:generateContent?key=${encodeURIComponent(effectiveApiKey)}`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          contents: [{ role: "user", parts }],
          generationConfig: {
            responseModalities: ["TEXT", "IMAGE"],
            imageConfig: {
              aspectRatio: this.normalizeAspectRatio(input.aspectRatio),
              imageSize: "1K",
            },
          },
        }),
      },
    );

    const raw = await response.text();
    if (!response.ok) {
      throw new Error(`Google image generation failed with HTTP ${response.status}${raw ? `: ${raw}` : ""}`);
    }

    const payload = raw ? JSON.parse(raw) as Record<string, unknown> : {};
    const inlineData = this.findInlineData(payload);
    if (!inlineData?.data) {
      throw new Error("Google image generation response did not include image data");
    }

    const mimeType = inlineData.mimeType || "image/png";
    return {
      prompt: input.prompt,
      provider: "google-gemini-image",
      model: effectiveModel,
      mimeType,
      parameters: {
        shotId: input.shotId,
        style: input.style,
        aspectRatio: input.aspectRatio,
        durationSeconds: input.durationSeconds,
        referenceImageAssetId: input.referenceImageAssetId,
      },
      inlineBody: Buffer.from(inlineData.data, "base64"),
      fileExtension: this.inferFileExtension(mimeType),
    };
  }

  private normalizeAspectRatio(aspectRatio: string) {
    return ["1:1", "3:4", "4:3", "9:16", "16:9"].includes(aspectRatio)
      ? aspectRatio
      : "16:9";
  }

  private findInlineData(payload: Record<string, unknown>): GeminiInlineData | undefined {
    const candidates = Array.isArray(payload.candidates) ? payload.candidates : [];
    for (const candidate of candidates) {
      if (!candidate || typeof candidate !== "object") {
        continue;
      }

      const content = (candidate as Record<string, unknown>).content;
      if (!content || typeof content !== "object") {
        continue;
      }

      const parts = Array.isArray((content as Record<string, unknown>).parts)
        ? (content as Record<string, unknown>).parts as unknown[]
        : [];
      for (const part of parts) {
        if (!part || typeof part !== "object") {
          continue;
        }

        const record = part as Record<string, unknown>;
        const inlineData = (record.inlineData ?? record.inline_data) as Record<string, unknown> | undefined;
        if (!inlineData) {
          continue;
        }

        const data = typeof inlineData.data === "string" ? inlineData.data : undefined;
        const mimeType = typeof inlineData.mimeType === "string"
          ? inlineData.mimeType
          : typeof inlineData.mime_type === "string"
            ? inlineData.mime_type
            : undefined;
        if (data) {
          return { data, mimeType };
        }
      }
    }

    return undefined;
  }

  private inferFileExtension(mimeType: string) {
    if (mimeType.includes("png")) {
      return "png";
    }
    if (mimeType.includes("jpeg") || mimeType.includes("jpg")) {
      return "jpg";
    }
    if (mimeType.includes("webp")) {
      return "webp";
    }
    return "bin";
  }
}