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
  LlmProviderConfig,
  MediaContent,
  RewriteSegmentInput,
  ScriptContent,
  StoryboardContent,
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
