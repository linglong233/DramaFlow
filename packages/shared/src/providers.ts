/**
 * @fileoverview AI 生成 Provider 接口定义
 * @module shared/providers
 *
 * 定义文本生成和媒体生成的 Provider 抽象接口。
 * 后端的具体实现类需要实现这些接口。
 */

import type {
  GenerateMediaInput,
  GenerateScriptInput,
  GenerateStoryboardInput,
  GenerateSynopsisInput,
  ImageGenerationProvider,
  LlmProviderConfig,
  MediaContent,
  RewriteSegmentInput,
  ScriptContent,
  StoryboardContent,
  VideoGenerationProvider,
} from "./domain";

/** 文本生成 Provider 接口（剧本、大纲、分镜、改写） */
export interface TextGenerationProvider {
  /** 生成完整剧本 */
  generateScript(input: GenerateScriptInput, config?: LlmProviderConfig): Promise<ScriptContent>;
  /** 根据剧本生成分镜 */
  generateStoryboard(input: GenerateStoryboardInput & { script: ScriptContent }, config?: LlmProviderConfig): Promise<StoryboardContent>;
  /** 生成故事大纲 */
  generateSynopsis(input: GenerateSynopsisInput, config?: LlmProviderConfig): Promise<string>;
  /** 改写文本片段 */
  rewriteSegment(input: RewriteSegmentInput, config?: LlmProviderConfig): Promise<string>;
}

/** 媒体生成 Provider 接口（图片、视频） */
export interface MediaGenerationProvider {
  /** 生成图片 */
  generateImage(input: GenerateMediaInput & { prompt: string }, config?: LlmProviderConfig): Promise<MediaContent>;
  /** 生成视频 */
  generateVideo(input: GenerateMediaInput & { prompt: string }, config?: LlmProviderConfig): Promise<MediaContent>;
}

/**
 * AI provider 配置健康度。
 *
 * `configured` 仅反映对应路径的 key 是否存在（非空、非占位），
 * 不保证 key 有效；运行时调用失败仍可能发生。
 *
 * 此类型是后端 `/health/providers` 端点与前端 `useProviderHealth` hook
 * 的共享契约，避免前后端各自声明导致 desync。
 */
export interface ProviderChannelHealth {
  configured: boolean;
}

export interface ProviderHealth {
  text: ProviderChannelHealth;
  image: ProviderChannelHealth;
  video: ProviderChannelHealth;
  tts: ProviderChannelHealth;
  mockFallback: boolean;
}

/**
 * 各视频 provider 的默认 model。前端展示与后端 adapter 请求共用此单一来源，
 * 避免两侧字符串漂移。运行时若用户/团队配置了具体 model，应优先于本默认值。
 */
export const DEFAULT_VIDEO_PROVIDER_MODELS: Record<VideoGenerationProvider, string> = {
  "grok": "grok-imagine-1.0-video",
  "minimax": "video-01",
  "volcengine": "doubao-seedance-1-5-pro-251215",
  "vidu": "viduq3-turbo",
  "ali": "wan2.6-i2v-flash",
  "runway": "gen3a_turbo",
  "openai-compatible": "",
  "comfyui": "minimax-h3",
};

/**
 * 各图片 provider 的默认 model。注意 openai-compatible 的默认是 "gpt-image-1"
 * （与后端 media-generation.provider / jobs.service 的 fallback 对齐）。
 * 运行时 MEDIA_IMAGE_MODEL env 仍可作为更高优先级的覆盖（由调用方处理）。
 */
export const DEFAULT_IMAGE_PROVIDER_MODELS: Record<ImageGenerationProvider, string> = {
  "google-gemini": "gemini-3.1-flash-image-preview",
  "grok": "grok-imagine-1.0",
  "openai-compatible": "gpt-image-1",
  "stable-diffusion": "",
  "comfyui": "",
};
