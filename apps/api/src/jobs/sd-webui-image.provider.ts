import { Injectable } from "@nestjs/common";
import type { GenerateMediaInput, ImageGenerationConfig, MediaContent } from "@dramaflow/shared";

interface GeneratedImageContent extends MediaContent {
  inlineBody?: Buffer | Uint8Array | string;
  fileExtension?: string;
}

interface SdTxt2ImgRequest {
  prompt: string;
  negative_prompt: string;
  sampler_name: string;
  steps: number;
  cfg_scale: number;
  width: number;
  height: number;
  sd_model_checkpoint?: string;
  clip_skip: number;
  send_images: boolean;
  save_images: boolean;
}

interface SdTxt2ImgResponse {
  images: string[];
  parameters?: Record<string, unknown>;
  info?: string;
}

const DEFAULT_SAMPLER_NAME = "DPM++ 2M Karras";
const DEFAULT_STEPS = 20;
const DEFAULT_CFG_SCALE = 7;
const DEFAULT_CLIP_SKIP = 1;

const ASPECT_RATIO_SIZES: Record<string, [number, number]> = {
  "16:9": [1344, 768],
  "9:16": [768, 1344],
  "4:3": [1024, 768],
  "3:4": [768, 1024],
  "1:1": [1024, 1024],
};

@Injectable()
export class SdWebuiImageProvider {
  private readonly baseUrl = (process.env.SD_WEBUI_BASE_URL ?? "http://localhost:7860").replace(/\/$/, "");
  private readonly apiKey = process.env.SD_WEBUI_API_KEY;

  async generateImage(
    input: GenerateMediaInput & { prompt: string },
    config?: ImageGenerationConfig,
  ): Promise<GeneratedImageContent> {
    const effectiveBaseUrl = (config?.baseUrl?.trim() || this.baseUrl).replace(/\/$/, "");
    const effectiveApiKey = config?.apiKey?.trim() || this.apiKey;

    const sdConfig = config?.sdConfig;
    const samplerName = sdConfig?.samplerName || DEFAULT_SAMPLER_NAME;
    const steps = sdConfig?.steps ?? DEFAULT_STEPS;
    const cfgScale = sdConfig?.cfgScale ?? DEFAULT_CFG_SCALE;
    const clipSkip = sdConfig?.clipSkip ?? DEFAULT_CLIP_SKIP;
    const sdModelCheckpoint = sdConfig?.sdModelCheckpoint;

    const [width, height] = this.resolveSize(input.aspectRatio, sdConfig?.width, sdConfig?.height);

    const headers: Record<string, string> = {
      "content-type": "application/json",
    };
    if (effectiveApiKey) {
      headers["Authorization"] = `Bearer ${effectiveApiKey}`;
    }

    const body: SdTxt2ImgRequest = {
      prompt: input.prompt,
      negative_prompt: "",
      sampler_name: samplerName,
      steps,
      cfg_scale: cfgScale,
      width,
      height,
      clip_skip: clipSkip,
      send_images: true,
      save_images: false,
    };

    if (sdModelCheckpoint) {
      body.sd_model_checkpoint = sdModelCheckpoint;
    }

    let response: Response;
    try {
      response = await fetch(`${effectiveBaseUrl}/sdapi/v1/txt2img`, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      throw new Error(`SD WebUI is unreachable at ${effectiveBaseUrl}: ${message}`);
    }

    const raw = await response.text();
    if (!response.ok) {
      throw new Error(
        `SD WebUI image generation failed with HTTP ${response.status}${raw ? `: ${raw}` : ""}`,
      );
    }

    let payload: SdTxt2ImgResponse;
    try {
      payload = JSON.parse(raw) as SdTxt2ImgResponse;
    } catch {
      throw new Error(`SD WebUI returned invalid JSON: ${raw.slice(0, 200)}`);
    }

    const imageData = payload.images?.[0];
    if (!imageData) {
      throw new Error("SD WebUI response did not include image data");
    }

    return {
      prompt: input.prompt,
      provider: "sd-webui",
      model: sdModelCheckpoint || "stable-diffusion",
      mimeType: "image/png",
      parameters: {
        shotId: input.shotId,
        style: input.style,
        aspectRatio: input.aspectRatio,
        durationSeconds: input.durationSeconds,
        referenceImageAssetId: input.referenceImageAssetId,
        samplerName,
        steps,
        cfgScale,
        width,
        height,
        clipSkip,
      },
      inlineBody: Buffer.from(imageData, "base64"),
      fileExtension: "png",
    };
  }

  private resolveSize(
    aspectRatio?: string,
    configWidth?: number,
    configHeight?: number,
  ): [number, number] {
    if (configWidth && configHeight) {
      return [configWidth, configHeight];
    }

    if (aspectRatio && aspectRatio in ASPECT_RATIO_SIZES) {
      return ASPECT_RATIO_SIZES[aspectRatio];
    }

    return ASPECT_RATIO_SIZES["16:9"];
  }
}
