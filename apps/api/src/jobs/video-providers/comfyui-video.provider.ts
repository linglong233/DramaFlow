/**
 * @fileoverview ComfyUI MiniMax H3 视频 Provider 适配器
 * @module api/jobs/video-providers
 *
 * 通过 ComfyUI 原生 API 调用 MiniMax H3 的 T2V、I2V 和 R2V 工作流。
 * 适配器只向 JobsService 暴露 createJob / pollJob，ComfyUI 节点图、参考图上传、
 * 历史记录解析和视频下载都收敛在这里。
 */

import type { ComfyuiConfig } from "@dramaflow/shared";

import type {
  ResolvedVideoReferenceImage,
  ResolvedVideoReferences,
} from "../video-reference.utils";
import {
  redactVideoReferenceDataUrls,
} from "../video-reference.utils";
import type {
  VideoProviderAdapter,
  VideoProviderCreateInput,
  VideoProviderJobState,
  VideoProviderPollInput,
} from "./types";
import {
  normalizeStatus,
  progressForStatus,
  serializeReferenceParameters,
} from "./types";

interface ComfyuiWorkflowNode {
  inputs: Record<string, unknown>;
  class_type: string;
  _meta?: { title?: string };
}

type ComfyuiWorkflow = Record<string, ComfyuiWorkflowNode>;

interface ComfyuiPromptResponse {
  prompt_id?: string;
}

interface ComfyuiSavedOutput {
  filename: string;
  subfolder: string;
  type: string;
}

interface ComfyuiHistoryOutput {
  images?: ComfyuiSavedOutput[];
  videos?: ComfyuiSavedOutput[];
  video?: ComfyuiSavedOutput;
}

interface ComfyuiHistoryStatus {
  status_str?: string;
  completed?: boolean;
}

interface ComfyuiHistoryResponse {
  status?: ComfyuiHistoryStatus;
  outputs?: Record<string, ComfyuiHistoryOutput>;
}

interface UploadedReference {
  image: ResolvedVideoReferenceImage;
  filename: string;
}

const DEFAULT_BASE_URL = "http://localhost:8188";
const FPS = 24;
const DEFAULT_VIDEO_MODEL = "minimax_h3_fl2va_pruned_int8_convrot.safetensors";
const DEFAULT_REFERENCE_MODEL = "minimax_h3_ref2va_pruned_int8_convrot.safetensors";
const DEFAULT_TEXT_ENCODER = "qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors";
const DEFAULT_VIDEO_VAE = "minimax_h3_video_vae_fp16.safetensors";
const DEFAULT_AUDIO_VAE = "minimax_h3_audio_vae_fp32.safetensors";
const DEFAULT_VIDEO_LORA = "minimax_h3_fl2v_turbo_8step_v1.0_comfyui_bf16.safetensors";
const DEFAULT_REFERENCE_LORA = "minimax_h3_ref2v_turbo_4step_v0.1_comfyui_bf16.safetensors";

export class ComfyuiVideoProviderAdapter implements VideoProviderAdapter {
  readonly provider = "comfyui" as const;

  async createJob(input: VideoProviderCreateInput): Promise<VideoProviderJobState> {
    const runtime = this.resolveRuntime(input.config.baseUrl, input.config.apiKey);
    const uploadedReferences = await this.uploadReferences(
      runtime.baseUrl,
      runtime.headers,
      input.references,
    );
    const workflow = this.buildWorkflow(input, uploadedReferences);

    const response = await fetch(`${runtime.baseUrl}/prompt`, {
      method: "POST",
      headers: {
        ...runtime.headers,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        prompt: workflow,
        client_id: `dramaflow-${input.shotId}`,
      }),
    });
    const data = await this.readJsonResponse<ComfyuiPromptResponse>(response, "ComfyUI H3 prompt submission");
    if (!data.prompt_id) {
      throw new Error("ComfyUI did not return a prompt_id for the H3 video job");
    }

    const parameters = this.buildParameters(input);
    return {
      provider: this.provider,
      providerVideoId: data.prompt_id,
      providerStatus: "queued",
      progress: 10,
      mimeType: "video/mp4",
      raw: { promptId: data.prompt_id },
      parameters,
    };
  }

  async pollJob(
    providerVideoId: string,
    input: VideoProviderPollInput,
  ): Promise<VideoProviderJobState> {
    const runtime = this.resolveRuntime(input.config.baseUrl, input.config.apiKey);
    const response = await fetch(
      `${runtime.baseUrl}/history/${encodeURIComponent(providerVideoId)}`,
      { headers: runtime.headers },
    );
    const historyData = await this.readJsonResponse<Record<string, ComfyuiHistoryResponse>>(
      response,
      "ComfyUI H3 history polling",
    );
    const history = historyData[providerVideoId];

    if (!history) {
      return this.runningState(providerVideoId, input, "queued");
    }

    const statusValue = history.status?.status_str;
    if (statusValue === "error" || statusValue === "failed") {
      return {
        provider: this.provider,
        providerVideoId,
        providerStatus: "failed",
        progress: 0,
        mimeType: "video/mp4",
        note: `ComfyUI H3 prompt ${providerVideoId} failed with status: ${statusValue}`,
        raw: { promptId: providerVideoId, status: statusValue },
        parameters: this.buildParameters(input),
      };
    }

    const output = this.extractVideoOutput(history);
    if (!output) {
      const normalizedStatus = normalizeStatus(statusValue);
      if (normalizedStatus === "completed") {
        return {
          provider: this.provider,
          providerVideoId,
          providerStatus: "failed",
          progress: 0,
          mimeType: "video/mp4",
          note: `ComfyUI H3 prompt ${providerVideoId} completed without a saved video output`,
          raw: { promptId: providerVideoId, status: statusValue },
          parameters: this.buildParameters(input),
        };
      }
      return this.runningState(providerVideoId, input, normalizedStatus);
    }

    const downloadUrl = this.buildViewUrl(runtime.baseUrl, output);
    const videoResponse = await fetch(downloadUrl, { headers: runtime.headers });
    if (!videoResponse.ok) {
      const text = await videoResponse.text();
      throw new Error(
        `ComfyUI H3 video download failed with HTTP ${videoResponse.status}${text ? `: ${text.slice(0, 300)}` : ""}`,
      );
    }

    const body = new Uint8Array(await videoResponse.arrayBuffer());
    const mimeType = this.normalizeMimeType(videoResponse.headers.get("content-type"), output.filename);
    return {
      provider: this.provider,
      providerVideoId,
      providerStatus: "completed",
      progress: 100,
      assetUrl: downloadUrl,
      mimeType,
      inlineBody: body,
      fileExtension: this.extensionForMimeType(mimeType, output.filename),
      raw: {
        promptId: providerVideoId,
        output: {
          filename: output.filename,
          subfolder: output.subfolder,
          type: output.type,
        },
      },
      parameters: this.buildParameters(input),
    };
  }

  private resolveRuntime(baseUrl?: string, apiKey?: string): {
    baseUrl: string;
    headers: Record<string, string>;
  } {
    const resolvedBaseUrl = (
      baseUrl?.trim()
      || process.env.COMFYUI_BASE_URL
      || DEFAULT_BASE_URL
    ).replace(/\/$/, "");
    const resolvedApiKey = apiKey?.trim() || process.env.COMFYUI_API_KEY?.trim();

    return {
      baseUrl: resolvedBaseUrl,
      headers: resolvedApiKey ? { Authorization: `Bearer ${resolvedApiKey}` } : {},
    };
  }

  private buildWorkflow(
    input: VideoProviderCreateInput,
    uploadedReferences: UploadedReference[],
  ): ComfyuiWorkflow {
    const workflowJson = input.config.comfyuiConfig?.workflowJson?.trim();
    if (workflowJson) {
      return this.resolveCustomWorkflow(workflowJson, input, uploadedReferences);
    }

    return this.buildDefaultWorkflow(input, uploadedReferences);
  }

  private buildDefaultWorkflow(
    input: VideoProviderCreateInput,
    uploadedReferences: UploadedReference[],
  ): ComfyuiWorkflow {
    const isReferenceToVideo = input.references.mode === "multiple";
    const config = input.config.comfyuiConfig;
    const { width, height } = this.resolveDimensions(input.aspectRatio, config);
    const length = this.resolveFrameLength(input.durationSeconds);
    const seed = Math.floor(Math.random() * 2_147_483_647);
    const steps = config?.steps ?? (isReferenceToVideo ? 4 : 8);
    const samplerName = config?.samplerName?.trim() || "res_multistep";
    const diffusionModel = isReferenceToVideo ? DEFAULT_REFERENCE_MODEL : DEFAULT_VIDEO_MODEL;
    const loraName = isReferenceToVideo ? DEFAULT_REFERENCE_LORA : DEFAULT_VIDEO_LORA;
    const prompt = this.buildH3Prompt(input.prompt, input.references);

    const h3Inputs: Record<string, unknown> = isReferenceToVideo
      ? {
          clip: ["df_clip", 0],
          vae: ["df_video_vae", 0],
          audio_vae: ["df_audio_vae", 0],
          prompt,
          width,
          height,
          length,
          ref_image_size: "match",
        }
      : {
          clip: ["df_clip", 0],
          vae: ["df_video_vae", 0],
          prompt,
          width,
          height,
          length,
        };

    const workflow: ComfyuiWorkflow = {
      df_unet: {
        inputs: {
          unet_name: diffusionModel,
          weight_dtype: "default",
        },
        class_type: "UNETLoader",
      },
      df_lora: {
        inputs: {
          lora_name: loraName,
          strength_model: 1,
          model: ["df_unet", 0],
        },
        class_type: "LoraLoaderModelOnly",
      },
      df_clip: {
        inputs: {
          clip_name: DEFAULT_TEXT_ENCODER,
          type: "minimax",
          device: "default",
        },
        class_type: "CLIPLoader",
      },
      df_video_vae: {
        inputs: { vae_name: DEFAULT_VIDEO_VAE },
        class_type: "VAELoader",
      },
      df_audio_vae: {
        inputs: { vae_name: DEFAULT_AUDIO_VAE },
        class_type: "VAELoader",
      },
      df_noise: {
        inputs: {
          noise_seed: seed,
          control_after_generate: "fixed",
        },
        class_type: "RandomNoise",
      },
      df_sampler: {
        inputs: { sampler_name: samplerName },
        class_type: "KSamplerSelect",
      },
      df_scheduler: {
        inputs: {
          scheduler: "simple",
          steps,
          denoise: 1,
          model: ["df_lora", 0],
        },
        class_type: "BasicScheduler",
      },
      df_h3: {
        inputs: h3Inputs,
        class_type: isReferenceToVideo ? "MiniMaxH3ReferenceToVideo" : "MiniMaxH3ImageToVideo",
      },
      df_guider: {
        inputs: {
          model: ["df_lora", 0],
          conditioning: ["df_h3", 0],
        },
        class_type: "BasicGuider",
      },
      df_sampler_advanced: {
        inputs: {
          noise: ["df_noise", 0],
          guider: ["df_guider", 0],
          sampler: ["df_sampler", 0],
          sigmas: ["df_scheduler", 0],
          latent_image: ["df_h3", 1],
        },
        class_type: "SamplerCustomAdvanced",
      },
      df_video_decode: {
        inputs: {
          samples: ["df_sampler_advanced", 0],
          vae: ["df_video_vae", 0],
        },
        class_type: "VAEDecode",
      },
      df_audio_decode: {
        inputs: {
          samples: ["df_sampler_advanced", 0],
          vae: ["df_audio_vae", 0],
        },
        class_type: "VAEDecodeAudio",
      },
      df_create_video: {
        inputs: {
          images: ["df_video_decode", 0],
          audio: ["df_audio_decode", 0],
          fps: FPS,
          bit_depth: 8,
        },
        class_type: "CreateVideo",
      },
      df_save_video: {
        inputs: {
          video: ["df_create_video", 0],
          filename_prefix: "video/DramaFlow",
          format: {
            format: "mp4",
            codec: {
              codec: "h264",
              encoding: { encoding: "auto" },
            },
          },
        },
        class_type: "SaveVideo",
      },
    };

    this.attachReferences(workflow, input.references, uploadedReferences);
    return workflow;
  }

  private resolveCustomWorkflow(
    workflowJson: string,
    input: VideoProviderCreateInput,
    uploadedReferences: UploadedReference[],
  ): ComfyuiWorkflow {
    let parsed: unknown;
    try {
      parsed = JSON.parse(workflowJson);
    } catch {
      throw new Error("ComfyUI video workflow JSON is invalid. Please check the workflow configuration.");
    }

    if (!parsed || Array.isArray(parsed) || typeof parsed !== "object") {
      throw new Error("ComfyUI video workflow JSON must be an API-format node map.");
    }
    if (Array.isArray((parsed as { nodes?: unknown }).nodes)) {
      throw new Error("ComfyUI video workflow JSON must use API format. The UI workflow graph is not accepted by /prompt.");
    }

    const workflow = parsed as ComfyuiWorkflow;
    const { width, height } = this.resolveDimensions(input.aspectRatio, input.config.comfyuiConfig);
    const length = this.resolveFrameLength(input.durationSeconds);
    const mode = input.references.mode;
    const expectedClassType = mode === "multiple"
      ? "MiniMaxH3ReferenceToVideo"
      : "MiniMaxH3ImageToVideo";
    const h3Node = Object.values(workflow).find((node) => node?.class_type === expectedClassType);
    if (!h3Node) {
      throw new Error(`ComfyUI workflow must contain ${expectedClassType} for video reference mode ${mode}.`);
    }

    h3Node.inputs = {
      ...h3Node.inputs,
      prompt: this.buildH3Prompt(input.prompt, input.references),
      width,
      height,
      length,
    };
    this.attachReferences(workflow, input.references, uploadedReferences, h3Node);
    return workflow;
  }

  private attachReferences(
    workflow: ComfyuiWorkflow,
    references: ResolvedVideoReferences,
    uploadedReferences: UploadedReference[],
    h3Node?: ComfyuiWorkflowNode,
  ): void {
    const node = h3Node ?? workflow.df_h3;
    if (!node) {
      throw new Error("ComfyUI H3 workflow does not contain a video conditioning node.");
    }

    if (references.mode === "multiple") {
      if (node.class_type !== "MiniMaxH3ReferenceToVideo") {
        throw new Error("MiniMax H3 multiple-image references require MiniMaxH3ReferenceToVideo.");
      }

      for (const key of Object.keys(node.inputs)) {
        if (/^ref_images\.ref_image_\d+$/.test(key)) {
          delete node.inputs[key];
        }
      }
      for (const [index, uploaded] of uploadedReferences.entries()) {
        const nodeId = this.addLoadImageNode(workflow, `dramaflow_ref_${index}`, uploaded.filename);
        node.inputs[`ref_images.ref_image_${index}`] = [nodeId, 0];
      }
      node.inputs.ref_image_size = "match";
      return;
    }

    if (node.class_type !== "MiniMaxH3ImageToVideo") {
      throw new Error("MiniMax H3 first/last-frame references require MiniMaxH3ImageToVideo.");
    }

    delete node.inputs.first_frame;
    delete node.inputs.last_frame;

    if (references.mode === "single") {
      const uploaded = uploadedReferences[0];
      if (!uploaded) {
        throw new Error("MiniMax H3 single reference mode requires one uploaded image.");
      }
      const nodeId = this.addLoadImageNode(workflow, "dramaflow_ref_first", uploaded.filename);
      node.inputs.first_frame = [nodeId, 0];
      return;
    }

    if (references.mode === "first_last") {
      const first = uploadedReferences[0];
      const last = uploadedReferences[1];
      if (!first || !last) {
        throw new Error("MiniMax H3 first_last reference mode requires two uploaded images.");
      }
      const firstNodeId = this.addLoadImageNode(workflow, "dramaflow_ref_first", first.filename);
      const lastNodeId = this.addLoadImageNode(workflow, "dramaflow_ref_last", last.filename);
      node.inputs.first_frame = [firstNodeId, 0];
      node.inputs.last_frame = [lastNodeId, 0];
    }
  }

  private addLoadImageNode(workflow: ComfyuiWorkflow, preferredId: string, filename: string): string {
    let nodeId = preferredId;
    let suffix = 2;
    while (workflow[nodeId]) {
      nodeId = `${preferredId}_${suffix}`;
      suffix += 1;
    }
    workflow[nodeId] = {
      inputs: { image: filename },
      class_type: "LoadImage",
    };
    return nodeId;
  }

  private async uploadReferences(
    baseUrl: string,
    headers: Record<string, string>,
    references: ResolvedVideoReferences,
  ): Promise<UploadedReference[]> {
    const images = references.mode === "single"
      ? (references.image ? [references.image] : [])
      : references.mode === "first_last"
        ? [references.firstFrame, references.lastFrame].filter((image): image is ResolvedVideoReferenceImage => Boolean(image))
        : references.mode === "multiple"
          ? references.referenceImages
          : [];

    const uploaded: UploadedReference[] = [];
    for (const [index, image] of images.entries()) {
      const filename = `dramaflow_h3_${Date.now()}_${index}.${this.extensionForMimeType(image.dataUrlMimeType || image.mimeType)}`;
      const body = await this.readReferenceBody(image);
      const form = new FormData();
      form.append(
        "image",
        new Blob([body as unknown as BlobPart], { type: image.dataUrlMimeType || image.mimeType }),
        filename,
      );
      form.append("overwrite", "true");

      const response = await fetch(`${baseUrl}/upload/image`, {
        method: "POST",
        headers,
        body: form,
      });
      if (!response.ok) {
        const text = await response.text();
        throw new Error(
          `ComfyUI H3 reference image upload failed with HTTP ${response.status}${text ? `: ${text.slice(0, 300)}` : ""}`,
        );
      }
      uploaded.push({ image, filename });
    }
    return uploaded;
  }

  private async readReferenceBody(
    image: ResolvedVideoReferenceImage,
  ): Promise<Uint8Array> {
    if (image.dataUrl) {
      const match = /^data:[^;,]+;base64,(.+)$/s.exec(image.dataUrl);
      if (!match) {
        throw new Error(`ComfyUI H3 reference ${image.assetId} has an unsupported data URL`);
      }
      return new Uint8Array(Buffer.from(match[1], "base64"));
    }

    const response = await fetch(image.url);
    if (!response.ok) {
      throw new Error(`ComfyUI H3 reference image download failed with HTTP ${response.status}`);
    }
    return new Uint8Array(await response.arrayBuffer());
  }

  private extractVideoOutput(history: ComfyuiHistoryResponse): ComfyuiSavedOutput | undefined {
    for (const output of Object.values(history.outputs ?? {})) {
      const saved = [
        ...(output.images ?? []),
        ...(output.videos ?? []),
        ...(output.video ? [output.video] : []),
      ];
      const video = saved.find((item) => {
        const filename = item.filename.toLowerCase();
        return filename.endsWith(".mp4") || filename.endsWith(".mkv") || filename.endsWith(".webm");
      });
      if (video) return video;
    }
    return undefined;
  }

  private buildViewUrl(baseUrl: string, output: ComfyuiSavedOutput): string {
    return `${baseUrl}/view?filename=${encodeURIComponent(output.filename)}&subfolder=${encodeURIComponent(output.subfolder)}&type=${encodeURIComponent(output.type)}`;
  }

  private buildParameters(
    input: VideoProviderCreateInput | VideoProviderPollInput,
  ): Record<string, unknown> {
    const references = redactVideoReferenceDataUrls(serializeReferenceParameters(input.references));
    const config = input.config.comfyuiConfig;
    const { width, height } = this.resolveDimensions(input.aspectRatio, config);
    const mode = input.references.mode === "multiple" ? "minimax-h3-r2v" : "minimax-h3-fl2va";
    return {
      prompt: input.prompt,
      aspectRatio: input.aspectRatio,
      durationSeconds: input.durationSeconds,
      width,
      height,
      length: this.resolveFrameLength(input.durationSeconds),
      fps: FPS,
      workflow: config?.workflowJson?.trim() ? "custom" : mode,
      ...references,
    };
  }

  private buildH3Prompt(prompt: string, references: ResolvedVideoReferences): string {
    if (references.mode !== "multiple" || references.referenceImages.length === 0 || /<Picture\s+\d+>/.test(prompt)) {
      return prompt;
    }
    const tags = references.referenceImages.map((_image, index) => `<Picture ${index + 1}>`).join(", ");
    return `${prompt}\nReference images in order: ${tags}. Use these exact picture tags when referring to the references.`;
  }

  private runningState(
    providerVideoId: string,
    input: VideoProviderPollInput,
    status: ReturnType<typeof normalizeStatus>,
  ): VideoProviderJobState {
    return {
      provider: this.provider,
      providerVideoId,
      providerStatus: status,
      progress: progressForStatus(status),
      mimeType: "video/mp4",
      raw: { promptId: providerVideoId, status },
      parameters: this.buildParameters(input),
    };
  }

  private resolveDimensions(
    aspectRatio: string,
    config?: Pick<ComfyuiConfig, "width" | "height">,
  ): { width: number; height: number } {
    if (config?.width && config.height) {
      return {
        width: this.alignDimension(config.width),
        height: this.alignDimension(config.height),
      };
    }

    const sizeMap: Record<string, [number, number]> = {
      "16:9": [768, 432],
      "9:16": [432, 768],
      "4:3": [640, 480],
      "3:4": [480, 640],
      "1:1": [576, 576],
    };
    const [width, height] = sizeMap[aspectRatio] ?? sizeMap["16:9"];
    return { width, height };
  }

  private alignDimension(value: number): number {
    return Math.max(32, Math.round(value / 32) * 32);
  }

  private resolveFrameLength(durationSeconds?: number): number {
    const seconds = durationSeconds && durationSeconds > 0 ? durationSeconds : 5;
    const frames = Math.max(5, Math.round(seconds * FPS));
    return frames + ((5 - (frames % 17) + 17) % 17);
  }

  private normalizeMimeType(contentType: string | null, filename: string): string {
    const normalized = contentType?.split(";", 1)[0]?.trim();
    if (normalized && normalized !== "application/octet-stream") return normalized;
    const extension = filename.toLowerCase().split(".").pop();
    if (extension === "webm") return "video/webm";
    if (extension === "mkv") return "video/x-matroska";
    return "video/mp4";
  }

  private extensionForMimeType(mimeType: string, filename?: string): string {
    const normalized = mimeType.toLowerCase();
    if (normalized === "video/webm") return "webm";
    if (normalized === "video/x-matroska") return "mkv";
    if (normalized === "video/mp4") return "mp4";
    const extension = filename?.toLowerCase().split(".").pop();
    return extension && /^[a-z0-9]+$/.test(extension) ? extension : "mp4";
  }

  private async readJsonResponse<T>(response: Response, label: string): Promise<T> {
    const text = await response.text();
    if (!response.ok) {
      throw new Error(`${label} failed with HTTP ${response.status}${text ? `: ${text.slice(0, 300)}` : ""}`);
    }
    return (text ? JSON.parse(text) : {}) as T;
  }
}
