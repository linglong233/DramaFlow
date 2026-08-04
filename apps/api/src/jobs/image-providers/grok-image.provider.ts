/**
 * @fileoverview Grok 图片 provider 适配器
 * @module api/jobs/image-providers
 *
 * 包装 GrokMediaProvider 的图片路径，内部把 ImageGenerationConfig 转成 LlmProviderConfig。
 */

import type { ImageGenerationConfig } from "@dramaflow/shared";

import { GrokMediaProvider } from "../grok-media.provider";
import { toGrokLlmConfig, type ImageProviderAdapter, type ImageProviderInput, type ImageProviderResult } from "./types";

export class GrokImageProviderAdapter implements ImageProviderAdapter {
  readonly provider = "grok" as const;

  constructor(private readonly inner: GrokMediaProvider) {}

  async generateImage(input: ImageProviderInput, config: ImageGenerationConfig): Promise<ImageProviderResult> {
    return this.inner.generateImage(
      { prompt: input.prompt, shotId: input.shotId, style: input.style, aspectRatio: input.aspectRatio },
      toGrokLlmConfig(config),
    );
  }
}
