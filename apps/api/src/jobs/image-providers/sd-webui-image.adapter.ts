/**
 * @fileoverview Stable Diffusion WebUI 图片 provider 适配器
 * @module api/jobs/image-providers
 */

import type { ImageGenerationConfig } from "@dramaflow/shared";

import { SdWebuiImageProvider } from "../sd-webui-image.provider";
import type { ImageProviderAdapter, ImageProviderInput, ImageProviderResult } from "./types";

export class SdWebuiImageProviderAdapter implements ImageProviderAdapter {
  readonly provider = "stable-diffusion" as const;

  constructor(private readonly inner: SdWebuiImageProvider) {}

  async generateImage(input: ImageProviderInput, config: ImageGenerationConfig): Promise<ImageProviderResult> {
    return this.inner.generateImage(
      { prompt: input.prompt, shotId: input.shotId, style: input.style, aspectRatio: input.aspectRatio },
      config,
    );
  }
}
