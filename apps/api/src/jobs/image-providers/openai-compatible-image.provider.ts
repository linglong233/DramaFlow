/**
 * @fileoverview OpenAI 兼容图片 provider 适配器
 * @module api/jobs/image-providers
 *
 * 包装 OpenAiMediaProvider，内部把 ImageGenerationConfig 转成 LlmProviderConfig。
 */

import type { ImageGenerationConfig } from "@dramaflow/shared";

import { OpenAiMediaProvider } from "../media-generation.provider";
import { toOpenAiImageLlmConfig, type ImageProviderAdapter, type ImageProviderInput, type ImageProviderResult } from "./types";

export class OpenAiCompatibleImageProviderAdapter implements ImageProviderAdapter {
  readonly provider = "openai-compatible" as const;

  constructor(private readonly inner: OpenAiMediaProvider) {}

  async generateImage(input: ImageProviderInput, config: ImageGenerationConfig): Promise<ImageProviderResult> {
    return this.inner.generateImage(
      { prompt: input.prompt, shotId: input.shotId, style: input.style, aspectRatio: input.aspectRatio },
      toOpenAiImageLlmConfig(config),
    );
  }
}
