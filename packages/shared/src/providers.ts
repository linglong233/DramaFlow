import type {
  GenerateMediaInput,
  GenerateScriptInput,
  GenerateStoryboardInput,
  MediaContent,
  ScriptContent,
  StoryboardContent,
} from "./domain";

export interface TextGenerationProvider {
  generateScript(input: GenerateScriptInput): Promise<ScriptContent>;
  generateStoryboard(input: GenerateStoryboardInput & { script: ScriptContent }): Promise<StoryboardContent>;
}

export interface MediaGenerationProvider {
  generateImage(input: GenerateMediaInput & { prompt: string }): Promise<MediaContent>;
  generateVideo(input: GenerateMediaInput & { prompt: string }): Promise<MediaContent>;
}
