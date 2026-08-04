/**
 * @fileoverview 图片生成 Provider 适配器统一接口
 * @module api/jobs/image-providers
 *
 * 把原本散落在 JobsService.processImageJob / generateImageFromPrompt 里的
 * if/else 按 providerKind 硬编码分发，收敛为注册表模式（对齐 video-providers/registry.ts）。
 *
 * 各底层图片 provider 的 generateImage 签名不完全一致：
 * - gemini / sd-webui / comfyui 接受 ImageGenerationConfig；
 * - openai-compatible / grok 接受 LlmProviderConfig，需要转换。
 * adapter 在内部吸收这一差异，对外暴露统一的 (input, ImageGenerationConfig) 签名。
 */

import type {
  ImageGenerationConfig,
  ImageGenerationProvider,
  LlmProviderConfig,
  MediaContent,
} from "@dramaflow/shared";

/** 图片生成的统一输入 */
export interface ImageProviderInput {
  prompt: string;
  shotId: string;
  style: string;
  aspectRatio: string;
  negativePrompt?: string;
  /**
   * 参考图（img2img）。仅 google-gemini / stable-diffusion / comfyui 支持；
   * 不支持的 adapter 会忽略此字段（调用方应在外层把不支持 provider 的参考图
   * 折叠进 prompt，见 jobs.service.generateImageFromPrompt）。
   */
  referenceImage?: { body: Uint8Array; mimeType: string };
  /** 透传到底层 provider 的额外 job input（如 MediaJobInput 的字段） */
  jobInput?: Record<string, unknown>;
}

/** 图片生成的统一输出（与 JobsService.GeneratedMediaResult 结构等价） */
export interface ImageProviderResult extends MediaContent {
  inlineBody?: Buffer | Uint8Array | string;
  fileExtension?: string;
}

/**
 * 图片 provider 适配器接口。每个 adapter 包装一个底层 provider 类，
 * 把 config 类型差异吸收在内部。
 */
export interface ImageProviderAdapter {
  readonly provider: ImageGenerationProvider;
  generateImage(input: ImageProviderInput, config: ImageGenerationConfig): Promise<ImageProviderResult>;
}

// === 共享 config 转换工具（供 openai-compatible / grok adapter 复用） ===

/** 把 ImageGenerationConfig 转成 OpenAI 兼容路径所需的 LlmProviderConfig */
export function toOpenAiImageLlmConfig(config: ImageGenerationConfig): LlmProviderConfig {
  return {
    provider: "openai-completions",
    apiKey: config.apiKey,
    baseUrl: config.baseUrl,
    model: config.model,
  };
}

/** 把 ImageGenerationConfig 转成 Grok 路径所需的 LlmProviderConfig */
export function toGrokLlmConfig(config: ImageGenerationConfig): LlmProviderConfig {
  return {
    provider: "grok",
    apiKey: config.apiKey,
    baseUrl: config.baseUrl,
    model: config.model || config.grokConfig?.model || "grok-imagine-1.0",
  };
}
