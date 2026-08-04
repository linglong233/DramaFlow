/**
 * @fileoverview ComfyUI 图片 provider 适配器
 * @module api/jobs/image-providers
 */

import type { ImageGenerationConfig } from "@dramaflow/shared";

import { ComfyuiImageProvider } from "../comfyui-image.provider";
import type { ImageProviderAdapter, ImageProviderInput, ImageProviderResult } from "./types";

export class ComfyuiImageProviderAdapter implements ImageProviderAdapter {
  readonly provider = "comfyui" as const;

  constructor(private readonly inner: ComfyuiImageProvider) {}

  async generateImage(input: ImageProviderInput, config: ImageGenerationConfig): Promise<ImageProviderResult> {
    return this.inner.generateImage(
      { prompt: input.prompt, shotId: input.shotId, style: input.style, aspectRatio: input.aspectRatio },
      config,
    );
  }
}
