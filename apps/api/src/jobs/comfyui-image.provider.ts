/**
 * @fileoverview ComfyUI 图片生成 Provider
 * @module api/jobs
 *
 * 通过 ComfyUI API 生成图片。
 */

import { Injectable, Logger } from "@nestjs/common";
import type { GenerateMediaInput, ImageGenerationConfig, MediaContent } from "@dramaflow/shared";

interface GeneratedImageContent extends MediaContent {
  inlineBody?: Buffer | Uint8Array | string;
  fileExtension?: string;
}

interface ComfyuiWorkflowNode {
  inputs: Record<string, unknown>;
  class_type: string;
  _meta?: { title?: string };
}

type ComfyuiWorkflow = Record<string, ComfyuiWorkflowNode>;

interface ComfyuiPromptResponse {
  prompt_id: string;
}

interface ComfyuiHistoryOutput {
  images?: Array<{ filename: string; subfolder: string; type: string }>;
}

interface ComfyuiHistoryStatus {
  status_str?: string;
  completed?: boolean;
}

interface ComfyuiHistoryResponse {
  status?: ComfyuiHistoryStatus;
  outputs?: Record<string, ComfyuiHistoryOutput>;
}

@Injectable()
export class ComfyuiImageProvider {
  private readonly logger = new Logger(ComfyuiImageProvider.name);

  async generateImage(
    input: GenerateMediaInput & { prompt: string },
    config?: ImageGenerationConfig,
  ): Promise<GeneratedImageContent> {
    const effectiveBaseUrl = (
      config?.baseUrl?.trim() ||
      process.env.COMFYUI_BASE_URL ||
      "http://localhost:8188"
    ).replace(/\/$/, "");

    const effectiveApiKey =
      config?.apiKey?.trim() || process.env.COMFYUI_API_KEY;

    const comfyuiConfig = config?.comfyuiConfig;
    const { width, height } = this.resolveDimensions(input.aspectRatio, comfyuiConfig);

    const negativePrompt =
      (input as any).negativePrompt ||
      "lowres, bad anatomy, bad hands, text, error, missing fingers, extra digit, fewer digits, cropped, worst quality, low quality, normal quality, jpeg artifacts, signature, watermark, blur, blurry";

    let refFilename: string | undefined;
    if ((input as any).referenceImageBuffer) {
      refFilename = `dramaflow_ref_${Date.now()}.png`;
      const uploadForm = new FormData();
      uploadForm.append(
        "image",
        new Blob([(input as any).referenceImageBuffer]),
        refFilename,
      );
      uploadForm.append("overwrite", "true");
      await fetch(`${effectiveBaseUrl}/upload/image`, {
        method: "POST",
        body: uploadForm,
      });
    }

    let workflow: ComfyuiWorkflow;

    if (comfyuiConfig?.workflowJson?.trim()) {
      workflow = this.resolveCustomWorkflow(
        comfyuiConfig.workflowJson,
        input.prompt,
        negativePrompt,
      );
      // TODO: wire ref image into custom workflow
    } else {
      workflow = this.buildDefaultWorkflow(input.prompt, negativePrompt, {
        samplerName: comfyuiConfig?.samplerName,
        steps: comfyuiConfig?.steps,
        cfgScale: comfyuiConfig?.cfgScale,
        width,
        height,
        checkpointName: comfyuiConfig?.checkpointName,
        refFilename,
      });
    }

    const headers: Record<string, string> = {
      "content-type": "application/json",
    };
    if (effectiveApiKey) {
      headers["Authorization"] = `Bearer ${effectiveApiKey}`;
    }

    // Submit prompt
    const submitResponse = await fetch(`${effectiveBaseUrl}/prompt`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        prompt: workflow,
        client_id: "dramaflow",
      }),
    });

    if (!submitResponse.ok) {
      const text = await submitResponse.text();
      throw new Error(
        `ComfyUI prompt submission failed with HTTP ${submitResponse.status}${text ? `: ${text}` : ""}`,
      );
    }

    const submitData = (await submitResponse.json()) as ComfyuiPromptResponse;
    const promptId = submitData.prompt_id;
    if (!promptId) {
      throw new Error("ComfyUI did not return a prompt_id");
    }

    // Poll history until completion
    const history = await this.pollHistory(
      effectiveBaseUrl,
      promptId,
      headers,
    );

    // Extract output image info
    const imageInfo = this.extractOutputImage(history);
    if (!imageInfo) {
      throw new Error(
        `ComfyUI completed but produced no images for prompt ${promptId}`,
      );
    }

    // Download the image
    const downloadUrl = `${effectiveBaseUrl}/view?filename=${encodeURIComponent(imageInfo.filename)}&subfolder=${encodeURIComponent(imageInfo.subfolder)}&type=${encodeURIComponent(imageInfo.type)}`;
    const imageResponse = await fetch(downloadUrl, { headers });

    if (!imageResponse.ok) {
      throw new Error(
        `ComfyUI image download failed with HTTP ${imageResponse.status}`,
      );
    }

    const imageBuffer = Buffer.from(await imageResponse.arrayBuffer());
    const checkpointName = comfyuiConfig?.checkpointName || this.extractCheckpointFromWorkflow(workflow);

    return {
      prompt: input.prompt,
      provider: "comfyui",
      model: checkpointName || "comfyui-default",
      mimeType: "image/png",
      parameters: {
        shotId: input.shotId,
        style: input.style,
        aspectRatio: input.aspectRatio,
        durationSeconds: input.durationSeconds,
        referenceImageAssetId: input.referenceImageAssetId,
      },
      inlineBody: imageBuffer,
      fileExtension: "png",
    };
  }

  // ---------------------------------------------------------------------------
  // Default workflow builder
  // ---------------------------------------------------------------------------

  buildDefaultWorkflow(
    prompt: string,
    negativePrompt: string,
    params: {
      samplerName?: string;
      steps?: number;
      cfgScale?: number;
      width: number;
      height: number;
      checkpointName?: string;
      refFilename?: string;
    },
  ): ComfyuiWorkflow {
    const seed = Math.floor(Math.random() * 2_147_483_647);

    const workflow: ComfyuiWorkflow = {
      "4": {
        inputs: {
          ckpt_name: params.checkpointName || "model.safetensors",
        },
        class_type: "CheckpointLoaderSimple",
        _meta: { title: "Load Checkpoint" },
      },
      "6": {
        inputs: {
          text: prompt,
          clip: ["4", 1],
        },
        class_type: "CLIPTextEncode",
        _meta: { title: "dramaflow-prompt" },
      },
      "7": {
        inputs: {
          text: negativePrompt,
          clip: ["4", 1],
        },
        class_type: "CLIPTextEncode",
        _meta: { title: "dramaflow-negative-prompt" },
      },
      "5": {
        inputs: {
          width: params.width,
          height: params.height,
          batch_size: 1,
        },
        class_type: "EmptyLatentImage",
        _meta: { title: "Empty Latent Image" },
      },
      "3": {
        inputs: {
          seed,
          steps: params.steps ?? 20,
          cfg: params.cfgScale ?? 8,
          sampler_name: params.samplerName ?? "euler",
          scheduler: "normal",
          model: ["4", 0],
          positive: ["6", 0],
          negative: ["7", 0],
          latent_image: ["5", 0],
        },
        class_type: "KSampler",
        _meta: { title: "KSampler" },
      },
      "8": {
        inputs: {
          samples: ["3", 0],
          vae: ["4", 2],
        },
        class_type: "VAEDecode",
        _meta: { title: "VAE Decode" },
      },
      "9": {
        inputs: {
          images: ["8", 0],
          filename_prefix: "DramaFlow",
        },
        class_type: "SaveImage",
        _meta: { title: "Save Image" },
      },
    };

    if (params.refFilename) {
      // Add a LoadImage node for the reference image
      workflow["ref_img"] = {
        inputs: {
          image: params.refFilename,
        },
        class_type: "LoadImage",
        _meta: { title: "Load Reference Image" },
      };

      // Add a VAEEncode node to convert the reference image to latent space
      workflow["ref_vae"] = {
        inputs: {
          pixels: ["ref_img", 0],
          vae: ["4", 2],
        },
        class_type: "VAEEncode",
        _meta: { title: "VAE Encode Reference" },
      };

      // Wire the reference latent into the KSampler instead of EmptyLatentImage
      workflow["3"].inputs.latent_image = ["ref_vae", 0];

      // Use a lower denoise strength for img2img
      workflow["3"].inputs.denoise = 0.6;
    }

    return workflow;
  }

  // ---------------------------------------------------------------------------
  // Custom workflow resolution
  // ---------------------------------------------------------------------------

  private resolveCustomWorkflow(
    workflowJson: string,
    prompt: string,
    negativePrompt: string,
  ): ComfyuiWorkflow {
    let workflow: ComfyuiWorkflow;
    try {
      workflow = JSON.parse(workflowJson) as ComfyuiWorkflow;
    } catch {
      throw new Error(
        "ComfyUI custom workflow JSON is invalid. Please check the workflow configuration.",
      );
    }

    let injectedPrompt = false;
    let injectedNegative = false;

    for (const nodeId of Object.keys(workflow)) {
      const node = workflow[nodeId];
      if (!node?._meta?.title) continue;

      if (node._meta.title === "dramaflow-prompt") {
        node.inputs = { ...node.inputs, text: prompt };
        injectedPrompt = true;
      } else if (node._meta.title === "dramaflow-negative-prompt") {
        node.inputs = { ...node.inputs, text: negativePrompt };
        injectedNegative = true;
      }
    }

    if (!injectedPrompt && !injectedNegative) {
      this.logger.warn(
        "Custom workflow has no nodes titled 'dramaflow-prompt' or 'dramaflow-negative-prompt'. Falling back to default workflow.",
      );
      return this.buildDefaultWorkflow(prompt, negativePrompt, {
        width: 1344,
        height: 768,
      });
    }

    return workflow;
  }

  // ---------------------------------------------------------------------------
  // History polling
  // ---------------------------------------------------------------------------

  private async pollHistory(
    baseUrl: string,
    promptId: string,
    headers: Record<string, string>,
  ): Promise<ComfyuiHistoryResponse> {
    const maxWaitMs = 180_000; // 3 minutes
    const intervalMs = 2_000;
    const startTime = Date.now();

    while (Date.now() - startTime < maxWaitMs) {
      const response = await fetch(`${baseUrl}/history/${encodeURIComponent(promptId)}`, {
        method: "GET",
        headers,
      });

      if (!response.ok) {
        throw new Error(
          `ComfyUI history request failed with HTTP ${response.status}`,
        );
      }

      const data = (await response.json()) as Record<string, unknown>;
      const entry = data[promptId] as ComfyuiHistoryResponse | undefined;

      if (entry) {
        const isCompleted =
          entry.status?.completed === true ||
          entry.status?.status_str === "success" ||
          (entry.outputs && Object.keys(entry.outputs).length > 0);

        if (isCompleted) {
          return entry;
        }

        const hasFailed =
          entry.status?.status_str === "error" ||
          entry.status?.status_str === "failed";
        if (hasFailed) {
          throw new Error(
            `ComfyUI prompt ${promptId} failed with status: ${entry.status?.status_str}`,
          );
        }
      }

      await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }

    throw new Error(
      `ComfyUI prompt ${promptId} timed out after ${maxWaitMs / 1000} seconds`,
    );
  }

  // ---------------------------------------------------------------------------
  // Output extraction
  // ---------------------------------------------------------------------------

  private extractOutputImage(
    history: ComfyuiHistoryResponse,
  ): { filename: string; subfolder: string; type: string } | undefined {
    if (!history.outputs) {
      return undefined;
    }

    for (const nodeId of Object.keys(history.outputs)) {
      const output = history.outputs[nodeId];
      if (output?.images && output.images.length > 0) {
        return output.images[0];
      }
    }

    return undefined;
  }

  // ---------------------------------------------------------------------------
  // Dimension helpers
  // ---------------------------------------------------------------------------

  private resolveDimensions(
    aspectRatio?: string,
    config?: { width?: number; height?: number },
  ): { width: number; height: number } {
    if (config?.width && config?.height) {
      return { width: config.width, height: config.height };
    }

    const sizeMap: Record<string, [number, number]> = {
      "16:9": [1344, 768],
      "9:16": [768, 1344],
      "4:3": [1024, 768],
      "3:4": [768, 1024],
      "1:1": [1024, 1024],
    };

    const [width, height] = sizeMap[aspectRatio ?? ""] ?? [1344, 768];
    return { width, height };
  }

  private extractCheckpointFromWorkflow(workflow: ComfyuiWorkflow): string | undefined {
    for (const nodeId of Object.keys(workflow)) {
      const node = workflow[nodeId];
      if (node.class_type === "CheckpointLoaderSimple" && typeof node.inputs.ckpt_name === "string") {
        return node.inputs.ckpt_name;
      }
    }
    return undefined;
  }
}
