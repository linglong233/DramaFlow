/**
 * @fileoverview Google Gemini 图片 provider 适配器
 * @module api/jobs/image-providers
 *
 * 包装 GoogleGeminiImageProvider，透传 referenceImage（支持 img2img）。
 */

import type { ImageGenerationConfig } from "@dramaflow/shared";

import { GoogleGeminiImageProvider } from "../google-gemini-image.provider";
import type { ImageProviderAdapter, ImageProviderInput, ImageProviderResult } from "./types";

export class GeminiImageProviderAdapter implements ImageProviderAdapter {
  readonly provider = "google-gemini" as const;

  constructor(private readonly inner: GoogleGeminiImageProvider) {}

  async generateImage(input: ImageProviderInput, config: ImageGenerationConfig): Promise<ImageProviderResult> {
    return this.inner.generateImage(
      {
        prompt: input.prompt,
        shotId: input.shotId,
        style: input.style,
        aspectRatio: input.aspectRatio,
        referenceImage: input.referenceImage
          ? { body: input.referenceImage.body, mimeType: input.referenceImage.mimeType }
          : undefined,
      },
      config,
    );
  }
}
