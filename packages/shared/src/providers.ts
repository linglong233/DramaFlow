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

export interface TextGenerationProvider {
  generateScript(input: GenerateScriptInput, config?: LlmProviderConfig): Promise<ScriptContent>;
  generateStoryboard(input: GenerateStoryboardInput & { script: ScriptContent }, config?: LlmProviderConfig): Promise<StoryboardContent>;
  generateSynopsis(input: GenerateSynopsisInput, config?: LlmProviderConfig): Promise<string>;
  rewriteSegment(input: RewriteSegmentInput, config?: LlmProviderConfig): Promise<string>;
}

export interface MediaGenerationProvider {
  generateImage(input: GenerateMediaInput & { prompt: string }, config?: LlmProviderConfig): Promise<MediaContent>;
  generateVideo(input: GenerateMediaInput & { prompt: string }, config?: LlmProviderConfig): Promise<MediaContent>;
}
