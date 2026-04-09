import { Injectable, Logger } from "@nestjs/common";
import type {
  GenerateScriptInput,
  GenerateStoryboardInput,
  GenerateSynopsisInput,
  RewriteSegmentInput,
  ScriptContent,
  StoryboardContent,
  TextGenerationProvider,
} from "@dramaflow/shared";
import { normalizeStoryboardContent } from "@dramaflow/shared";

interface OpenAiCompatMessage {
  content?: string | OpenAiCompatContentPart[];
}

interface OpenAiCompatChoice {
  message?: OpenAiCompatMessage;
  delta?: OpenAiCompatMessage;
  text?: string;
}

interface OpenAiCompatResponse {
  choices?: OpenAiCompatChoice[];
}

type OpenAiCompatContentPart = string | { text?: string };

export interface StreamChunk {
  type: "chunk" | "done" | "error";
  content?: string;
  result?: unknown;
  error?: string;
}

@Injectable()
export class OpenAiCompatTextProvider implements TextGenerationProvider {
  private readonly logger = new Logger(OpenAiCompatTextProvider.name);
  private readonly apiKey = process.env.OPENAI_COMPAT_API_KEY;
  private readonly baseUrl = (process.env.OPENAI_COMPAT_BASE_URL ?? "https://api.openai.com/v1").replace(/\/$/, "");
  private readonly model = process.env.OPENAI_TEXT_MODEL ?? "gpt-4.1-mini";
  private readonly mockFallbackEnabled = (process.env.OPENAI_COMPAT_MOCK_FALLBACK ?? "true") !== "false";

  async generateScript(input: GenerateScriptInput, config?: import("@dramaflow/shared").LlmProviderConfig): Promise<ScriptContent> {
    const effectiveApiKey = config?.apiKey || this.apiKey;
    if (!effectiveApiKey || effectiveApiKey === "replace-me") {
      return this.mockScript(input);
    }

    const effectiveBaseUrl = (config?.baseUrl || this.baseUrl).replace(/\/$/, "");
    const effectiveModel = config?.model || this.model;
    const useStreaming = config?.stream ?? false;

    const prompt = [
      "Return JSON only.",
      "Generate a short-drama script payload with the fields: logline, premise, characters, scenes.",
      `Title: ${input.title}`,
      `Genre: ${input.genre}`,
      `Premise: ${input.premise}`,
      `Episode goal: ${input.episodeGoal}`,
      `Tone: ${input.tone}`,
      `Audience: ${input.audience}`,
    ].join("\n");

    return this.generateStructuredPayload({
      operation: "script generation",
      prompt,
      systemPrompt: "You are a screenplay development assistant. Always return strict JSON.",
      temperature: 0.8,
      baseUrl: effectiveBaseUrl,
      apiKey: effectiveApiKey,
      model: effectiveModel,
      stream: useStreaming,
      mockFactory: () => this.mockScript(input),
    });
  }

  async generateStoryboard(
    input: GenerateStoryboardInput & { script: ScriptContent },
    config?: import("@dramaflow/shared").LlmProviderConfig,
  ): Promise<StoryboardContent> {
    const effectiveApiKey = config?.apiKey || this.apiKey;
    if (!effectiveApiKey || effectiveApiKey === "replace-me") {
      return this.mockStoryboard(input.script, input.cinematicStyle, input.shotDensity);
    }

    const effectiveBaseUrl = (config?.baseUrl || this.baseUrl).replace(/\/$/, "");
    const effectiveModel = config?.model || this.model;
    const useStreaming = config?.stream ?? false;

    const prompt = [
      "Return JSON only.",
      "Generate a storyboard payload with fields overview and shots.",
      "Use the exact outer shape: { overview: string, shots: StoryboardShot[] }.",
      "Each shot must include: id, sceneId, shotLabel, framing, cameraMove, durationSeconds, visualDescription.",
      "Each shot may also include: actionDescription, dialogue, soundDesign, notes, imagePrompt, videoPrompt, characterIds.",
      "Use normalized framing values such as ECU, CU, MCU, MS, MLS, LS, ELS, OTS, POV, bird-eye, low-angle, dutch-angle.",
      "Use normalized cameraMove values such as static, pan-left, pan-right, tilt-up, tilt-down, dolly-in, dolly-out, tracking, crane-up, crane-down, handheld, steadicam, whip-pan, zoom-in, zoom-out.",
      "Keep shotLabel concise, director-friendly, and sortable, such as 1A, 1B, 2A.",
      "Preserve the source scene ids from the script in sceneId whenever possible.",
      "visualDescription should describe composition, lighting, and subjects. actionDescription should describe blocking or character motion. notes should hold director reminders or editorial concerns.",
      `Cinematic style: ${input.cinematicStyle}`,
      `Shot density: ${input.shotDensity}`,
      `Script JSON: ${JSON.stringify(input.script)}`,
    ].join("\n");

    return this.generateStructuredPayload({
      operation: "storyboard generation",
      prompt,
      systemPrompt: "You are a storyboard supervisor. Always return strict JSON.",
      temperature: 0.7,
      baseUrl: effectiveBaseUrl,
      apiKey: effectiveApiKey,
      model: effectiveModel,
      stream: useStreaming,
      mockFactory: () => this.mockStoryboard(input.script, input.cinematicStyle, input.shotDensity),
      transformResult: normalizeStoryboardContent,
    });
  }

  async generateSynopsis(input: GenerateSynopsisInput, config?: import("@dramaflow/shared").LlmProviderConfig): Promise<string> {
    const effectiveApiKey = config?.apiKey || this.apiKey;
    if (!effectiveApiKey || effectiveApiKey === "replace-me") {
      return this.mockSynopsis(input);
    }

    const effectiveBaseUrl = (config?.baseUrl || this.baseUrl).replace(/\/$/, "");
    const effectiveModel = config?.model || this.model;
    const useStreaming = config?.stream ?? false;

    const prompt = [
      "Return a long-form synopsis text.",
      "Generate a structured screenplay synopsis/outline for a short drama.",
      `Title: ${input.title}`,
      `Genre: ${input.genre}`,
      `Theme: ${input.theme}`,
      `Keywords: ${input.keywords.join(", ")}`,
      `Episode count: ${input.episodeCount}`,
      input.constraints ? `Constraints: ${input.constraints}` : "",
      "Include a brief overview, character introductions, and a beat-by-beat outline of each episode.",
    ].filter(Boolean).join("\n");

    try {
      const response = await fetch(`${effectiveBaseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${effectiveApiKey}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model: effectiveModel,
          temperature: 0.8,
          stream: useStreaming,
          messages: [
            { role: "system", content: "You are a screenplay development assistant. Generate detailed synopses for short dramas." },
            { role: "user", content: prompt },
          ],
        }),
      });

      if (!response.ok) {
        return this.handleFailure("synopsis generation", `HTTP ${response.status}`, () => this.mockSynopsis(input));
      }

      const raw = await this.extractResponseContent(response);
      return raw ?? this.mockSynopsis(input);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      return this.handleFailure("synopsis generation", message, () => this.mockSynopsis(input));
    }
  }

  async rewriteSegment(input: RewriteSegmentInput, config?: import("@dramaflow/shared").LlmProviderConfig): Promise<string> {
    const effectiveApiKey = config?.apiKey || this.apiKey;
    if (!effectiveApiKey || effectiveApiKey === "replace-me") {
      return this.mockRewrite(input);
    }

    const effectiveBaseUrl = (config?.baseUrl || this.baseUrl).replace(/\/$/, "");
    const effectiveModel = config?.model || this.model;
    const useStreaming = config?.stream ?? false;

    const prompt = [
      "Rewrite the following text segment according to the user's instruction.",
      "Return only the rewritten text, without any explanation or wrapping.",
      `\n--- ORIGINAL TEXT ---\n${input.originalText}`,
      `\n--- INSTRUCTION ---\n${input.instruction}`,
      input.context ? `\n--- CONTEXT ---\n${input.context}` : "",
    ].filter(Boolean).join("\n");

    try {
      const response = await fetch(`${effectiveBaseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${effectiveApiKey}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model: effectiveModel,
          temperature: 0.7,
          stream: useStreaming,
          messages: [
            { role: "system", content: "You are a screenplay editing assistant. Rewrite text exactly as instructed while preserving the overall tone and format." },
            { role: "user", content: prompt },
          ],
        }),
      });

      if (!response.ok) {
        return this.handleFailure("rewrite segment", `HTTP ${response.status}`, () => this.mockRewrite(input));
      }

      const raw = await this.extractResponseContent(response);
      return raw ?? this.mockRewrite(input);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      return this.handleFailure("rewrite segment", message, () => this.mockRewrite(input));
    }
  }

  private async generateStructuredPayload<T>(options: {
    operation: string;
    prompt: string;
    systemPrompt: string;
    temperature: number;
    baseUrl: string;
    apiKey: string;
    model: string;
    stream: boolean;
    mockFactory: () => T;
    transformResult?: (result: T) => T;
  }): Promise<T> {
    try {
      const response = await fetch(`${options.baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${options.apiKey}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model: options.model,
          temperature: options.temperature,
          stream: options.stream,
          response_format: { type: "json_object" },
          messages: [
            {
              role: "system",
              content: options.systemPrompt,
            },
            {
              role: "user",
              content: options.prompt,
            },
          ],
        }),
      });

      if (!response.ok) {
        return this.handleFailure(
          options.operation,
          `HTTP ${response.status}: ${await response.text()}`,
          options.mockFactory,
        );
      }

      const raw = await this.extractResponseContent(response);
      const parsed = this.parseJson<T>(raw);
      if (parsed) {
        return options.transformResult ? options.transformResult(parsed) : parsed;
      }

      return this.handleFailure(
        options.operation,
        "response did not contain parseable JSON content",
        options.mockFactory,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown provider error";
      return this.handleFailure(options.operation, message, options.mockFactory);
    }
  }

  private async extractResponseContent(response: Response) {
    const contentType = response.headers.get("content-type") ?? "";
    if (contentType.includes("text/event-stream")) {
      return this.extractSseContent(await response.text());
    }

    const data = await response.json() as OpenAiCompatResponse;
    return this.extractChoiceContent(data.choices);
  }

  private extractSseContent(raw: string) {
    let content = "";

    for (const line of raw.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("data:")) {
        continue;
      }

      const payload = trimmed.slice(5).trim();
      if (!payload || payload === "[DONE]") {
        continue;
      }

      try {
        const data = JSON.parse(payload) as OpenAiCompatResponse;
        const chunk = this.extractChoiceContent(data.choices);
        if (chunk) {
          content += chunk;
        }
      } catch {
        continue;
      }
    }

    return content || undefined;
  }

  private extractChoiceContent(choices?: OpenAiCompatChoice[]) {
    for (const choice of choices ?? []) {
      const content = this.normalizeContent(choice.message?.content)
        ?? this.normalizeContent(choice.delta?.content)
        ?? choice.text;

      if (content) {
        return content;
      }
    }

    return undefined;
  }

  private normalizeContent(content?: string | OpenAiCompatContentPart[]) {
    if (typeof content === "string") {
      return content;
    }

    if (!Array.isArray(content)) {
      return undefined;
    }

    const value = content.map((part) => {
      if (typeof part === "string") {
        return part;
      }
      return typeof part.text === "string" ? part.text : "";
    }).join("");

    return value || undefined;
  }

  private handleFailure<T>(operation: string, reason: string, mockFactory: () => T): T {
    if (this.mockFallbackEnabled) {
      this.logger.warn(`${operation} falling back to mock data: ${reason}`);
      return mockFactory();
    }

    throw new Error(`OpenAI-compatible ${operation} failed: ${reason}`);
  }

  private parseJson<T>(raw?: string): T | undefined {
    if (!raw) {
      return undefined;
    }

    // Strip markdown code fences that LLMs sometimes add
    let cleaned = raw.trim();
    const fenceMatch = cleaned.match(/^```(?:json)?\s*\n?([\s\S]*?)\n?```\s*$/i);
    if (fenceMatch) {
      cleaned = fenceMatch[1].trim();
    }

    try {
      return JSON.parse(cleaned) as T;
    } catch {
      // Try to extract the outermost JSON object
      const objStart = cleaned.indexOf("{");
      const objEnd = cleaned.lastIndexOf("}");
      if (objStart === -1 || objEnd === -1 || objEnd <= objStart) {
        return undefined;
      }
      try {
        return JSON.parse(cleaned.slice(objStart, objEnd + 1)) as T;
      } catch {
        return undefined;
      }
    }
  }

  // ===== Streaming generators =====

  async *generateScriptStream(
    input: GenerateScriptInput,
    config?: import("@dramaflow/shared").LlmProviderConfig,
  ): AsyncGenerator<StreamChunk> {
    const effectiveApiKey = config?.apiKey || this.apiKey;
    if (!effectiveApiKey || effectiveApiKey === "replace-me") {
      const mock = this.mockScript(input);
      yield { type: "chunk", content: JSON.stringify(mock, null, 2) };
      yield { type: "done", result: mock };
      return;
    }

    const effectiveBaseUrl = (config?.baseUrl || this.baseUrl).replace(/\/$/, "");
    const effectiveModel = config?.model || this.model;

    const prompt = [
      "Return JSON only.",
      "Generate a short-drama script payload with the fields: logline, premise, characters, scenes.",
      `Title: ${input.title}`,
      `Genre: ${input.genre}`,
      `Premise: ${input.premise}`,
      `Episode goal: ${input.episodeGoal}`,
      `Tone: ${input.tone}`,
      `Audience: ${input.audience}`,
    ].join("\n");

    yield* this.streamStructuredPayload({
      operation: "script generation",
      prompt,
      systemPrompt: "You are a screenplay development assistant. Always return strict JSON.",
      temperature: 0.8,
      baseUrl: effectiveBaseUrl,
      apiKey: effectiveApiKey,
      model: effectiveModel,
      mockFactory: () => this.mockScript(input),
    });
  }

  async *generateStoryboardStream(
    input: GenerateStoryboardInput & { script: ScriptContent },
    config?: import("@dramaflow/shared").LlmProviderConfig,
  ): AsyncGenerator<StreamChunk> {
    const effectiveApiKey = config?.apiKey || this.apiKey;
    if (!effectiveApiKey || effectiveApiKey === "replace-me") {
      const mock = this.mockStoryboard(input.script, input.cinematicStyle, input.shotDensity);
      yield { type: "chunk", content: JSON.stringify(mock, null, 2) };
      yield { type: "done", result: mock };
      return;
    }

    const effectiveBaseUrl = (config?.baseUrl || this.baseUrl).replace(/\/$/, "");
    const effectiveModel = config?.model || this.model;

    const prompt = [
      "Return JSON only.",
      "Generate a storyboard payload with fields overview and shots.",
      "Use the exact outer shape: { overview: string, shots: StoryboardShot[] }.",
      "Each shot must include: id, sceneId, shotLabel, framing, cameraMove, durationSeconds, visualDescription.",
      "Each shot may also include: actionDescription, dialogue, soundDesign, notes, imagePrompt, videoPrompt, characterIds.",
      "Use normalized framing values such as ECU, CU, MCU, MS, MLS, LS, ELS, OTS, POV, bird-eye, low-angle, dutch-angle.",
      "Use normalized cameraMove values such as static, pan-left, pan-right, tilt-up, tilt-down, dolly-in, dolly-out, tracking, crane-up, crane-down, handheld, steadicam, whip-pan, zoom-in, zoom-out.",
      "Keep shotLabel concise, director-friendly, and sortable, such as 1A, 1B, 2A.",
      "Preserve the source scene ids from the script in sceneId whenever possible.",
      "visualDescription should describe composition, lighting, and subjects. actionDescription should describe blocking or character motion. notes should hold director reminders or editorial concerns.",
      `Cinematic style: ${input.cinematicStyle}`,
      `Shot density: ${input.shotDensity}`,
      `Script JSON: ${JSON.stringify(input.script)}`,
    ].join("\n");

    yield* this.streamStructuredPayload({
      operation: "storyboard generation",
      prompt,
      systemPrompt: "You are a storyboard supervisor. Always return strict JSON.",
      temperature: 0.7,
      baseUrl: effectiveBaseUrl,
      apiKey: effectiveApiKey,
      model: effectiveModel,
      mockFactory: () => this.mockStoryboard(input.script, input.cinematicStyle, input.shotDensity),
      transformResult: normalizeStoryboardContent,
    });
  }

  async *generateSynopsisStream(
    input: GenerateSynopsisInput,
    config?: import("@dramaflow/shared").LlmProviderConfig,
  ): AsyncGenerator<StreamChunk> {
    const effectiveApiKey = config?.apiKey || this.apiKey;
    if (!effectiveApiKey || effectiveApiKey === "replace-me") {
      const mock = this.mockSynopsis(input);
      yield { type: "chunk", content: mock };
      yield { type: "done", result: mock };
      return;
    }

    const effectiveBaseUrl = (config?.baseUrl || this.baseUrl).replace(/\/$/, "");
    const effectiveModel = config?.model || this.model;

    const prompt = [
      "Return a long-form synopsis text.",
      "Generate a structured screenplay synopsis/outline for a short drama.",
      `Title: ${input.title}`,
      `Genre: ${input.genre}`,
      `Theme: ${input.theme}`,
      `Keywords: ${input.keywords.join(", ")}`,
      `Episode count: ${input.episodeCount}`,
      input.constraints ? `Constraints: ${input.constraints}` : "",
      "Include a brief overview, character introductions, and a beat-by-beat outline of each episode.",
    ].filter(Boolean).join("\n");

    yield* this.streamPlainText({
      operation: "synopsis generation",
      prompt,
      systemPrompt: "You are a screenplay development assistant. Generate detailed synopses for short dramas.",
      temperature: 0.8,
      baseUrl: effectiveBaseUrl,
      apiKey: effectiveApiKey,
      model: effectiveModel,
      mockFactory: () => this.mockSynopsis(input),
    });
  }

  async *rewriteSegmentStream(
    input: RewriteSegmentInput,
    config?: import("@dramaflow/shared").LlmProviderConfig,
  ): AsyncGenerator<StreamChunk> {
    const effectiveApiKey = config?.apiKey || this.apiKey;
    if (!effectiveApiKey || effectiveApiKey === "replace-me") {
      const mock = this.mockRewrite(input);
      yield { type: "chunk", content: mock };
      yield { type: "done", result: mock };
      return;
    }

    const effectiveBaseUrl = (config?.baseUrl || this.baseUrl).replace(/\/$/, "");
    const effectiveModel = config?.model || this.model;

    const prompt = [
      "Rewrite the following text segment according to the user's instruction.",
      "Return only the rewritten text, without any explanation or wrapping.",
      `\n--- ORIGINAL TEXT ---\n${input.originalText}`,
      `\n--- INSTRUCTION ---\n${input.instruction}`,
      input.context ? `\n--- CONTEXT ---\n${input.context}` : "",
    ].filter(Boolean).join("\n");

    yield* this.streamPlainText({
      operation: "rewrite segment",
      prompt,
      systemPrompt: "You are a screenplay editing assistant. Rewrite text exactly as instructed while preserving the overall tone and format.",
      temperature: 0.7,
      baseUrl: effectiveBaseUrl,
      apiKey: effectiveApiKey,
      model: effectiveModel,
      mockFactory: () => this.mockRewrite(input),
    });
  }

  private async *streamStructuredPayload<T>(options: {
    operation: string;
    prompt: string;
    systemPrompt: string;
    temperature: number;
    baseUrl: string;
    apiKey: string;
    model: string;
    mockFactory: () => T;
    transformResult?: (result: T) => T;
  }): AsyncGenerator<StreamChunk> {
    const fetchOptions = { ...options, responseFormat: { type: "json_object" as const } };
    let accumulated = "";
    try {
      for await (const chunk of this.fetchSseChunks(fetchOptions)) {
        accumulated += chunk;
        yield { type: "chunk", content: chunk };
      }

      const parsed = this.parseJson<T>(accumulated);
      if (parsed) {
        const transformed = options.transformResult ? options.transformResult(parsed) : parsed;
        yield { type: "done", result: transformed };
      } else {
        this.logger.warn(`${options.operation} stream did not produce valid JSON, falling back to mock`);
        if (this.mockFallbackEnabled) {
          const mock = options.mockFactory();
          yield { type: "done", result: mock };
        } else {
          yield { type: "error", error: `${options.operation}: response did not contain parseable JSON` };
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      if (this.mockFallbackEnabled) {
        this.logger.warn(`${options.operation} stream error, falling back to mock: ${message}`);
        const mock = options.mockFactory();
        yield { type: "chunk", content: JSON.stringify(mock, null, 2) };
        yield { type: "done", result: mock };
      } else {
        yield { type: "error", error: `${options.operation} failed: ${message}` };
      }
    }
  }

  private async *streamPlainText(options: {
    operation: string;
    prompt: string;
    systemPrompt: string;
    temperature: number;
    baseUrl: string;
    apiKey: string;
    model: string;
    mockFactory: () => string;
  }): AsyncGenerator<StreamChunk> {
    let accumulated = "";
    try {
      for await (const chunk of this.fetchSseChunks(options)) {
        accumulated += chunk;
        yield { type: "chunk", content: chunk };
      }

      yield { type: "done", result: accumulated || options.mockFactory() };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      if (this.mockFallbackEnabled) {
        this.logger.warn(`${options.operation} stream error, falling back to mock: ${message}`);
        const mock = options.mockFactory();
        yield { type: "chunk", content: mock };
        yield { type: "done", result: mock };
      } else {
        yield { type: "error", error: `${options.operation} failed: ${message}` };
      }
    }
  }

  private async *fetchSseChunks(options: {
    prompt: string;
    systemPrompt: string;
    temperature: number;
    baseUrl: string;
    apiKey: string;
    model: string;
    responseFormat?: { type: string };
  }): AsyncGenerator<string> {
    const body: Record<string, unknown> = {
      model: options.model,
      temperature: options.temperature,
      stream: true,
      messages: [
        { role: "system", content: options.systemPrompt },
        { role: "user", content: options.prompt },
      ],
    };
    if (options.responseFormat) {
      body.response_format = options.responseFormat;
    }
    const response = await fetch(`${options.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${options.apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${await response.text()}`);
    }

    const contentType = response.headers.get("content-type") ?? "";

    // If the API returned a non-streaming response despite stream:true
    if (!contentType.includes("text/event-stream")) {
      const data = await response.json() as OpenAiCompatResponse;
      const content = this.extractChoiceContent(data.choices);
      if (content) {
        yield content;
      }
      return;
    }

    // Parse SSE stream incrementally
    const reader = response.body?.getReader();
    if (!reader) {
      throw new Error("Response body is not readable");
    }

    const decoder = new TextDecoder();
    let buffer = "";

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split(/\r?\n/);
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed.startsWith("data:")) continue;

          const payload = trimmed.slice(5).trim();
          if (!payload || payload === "[DONE]") continue;

          try {
            const data = JSON.parse(payload) as OpenAiCompatResponse;
            const chunk = this.extractChoiceContent(data.choices);
            if (chunk) {
              yield chunk;
            }
          } catch {
            // skip unparseable chunks
          }
        }
      }

      // Process remaining buffer
      if (buffer.trim()) {
        const trimmed = buffer.trim();
        if (trimmed.startsWith("data:")) {
          const payload = trimmed.slice(5).trim();
          if (payload && payload !== "[DONE]") {
            try {
              const data = JSON.parse(payload) as OpenAiCompatResponse;
              const chunk = this.extractChoiceContent(data.choices);
              if (chunk) {
                yield chunk;
              }
            } catch {
              // skip
            }
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
  }

  private mockScript(input: GenerateScriptInput): ScriptContent {
    return {
      logline: `${input.genre}短剧《${input.title}》讲述主角在${input.premise}中完成${input.episodeGoal}的过程。`,
      premise: input.premise,
      characters: [
        {
          name: "林夏",
          profile: `冷静的导演型主角，整体调性偏${input.tone}`,
        },
        {
          name: "顾言",
          profile: `推动情节的搭档角色，面向${input.audience}观众提供情绪抓手。`,
        },
      ],
      scenes: [
        {
          id: "scene-1",
          heading: "内景 / 创作室 / 夜",
          synopsis: "主角接到一条改变项目走向的消息。",
          characters: ["林夏", "顾言"],
          dialogue: [
            { speaker: "林夏", line: "这次我们不能再按旧办法拍。" },
            { speaker: "顾言", line: "那就把风险拍成亮点。" },
          ],
          directorNote: `镜头语言保持${input.tone}，节奏持续向前。`,
        },
        {
          id: "scene-2",
          heading: "外景 / 城市天台 / 凌晨",
          synopsis: "两位角色在高处重新确认目标与关系。",
          characters: ["林夏", "顾言"],
          dialogue: [
            { speaker: "林夏", line: "如果今天成了，我们就有下一集。" },
            { speaker: "顾言", line: "那就从这一镜开始，别回头。" },
          ],
          directorNote: "加入高反差夜景与风声，制造临界感。",
        },
      ],
    };
  }

  private mockStoryboard(script: ScriptContent, cinematicStyle: string, shotDensity: string): StoryboardContent {
    const shots = script.scenes.flatMap((scene, sceneIndex) => {
      return [1, 2].map((shotIndex) => ({
        id: `shot-${sceneIndex + 1}-${shotIndex}`,
        sceneId: scene.id,
        shotLabel: `${sceneIndex + 1}${shotIndex === 1 ? "A" : "B"}`,
        framing: shotIndex === 1 ? "LS" : "CU",
        cameraMove: shotIndex === 1 ? "dolly-in" : "handheld",
        durationSeconds: shotDensity === "dense" ? 3 : 5,
        visualDescription: `${scene.synopsis}，采用${cinematicStyle}质感。`,
        actionDescription: shotIndex === 1 ? "角色进入画面并建立空间关系。" : "角色在情绪节点上停顿，给表演留出呼吸。",
        dialogue: scene.dialogue[shotIndex - 1]?.line,
        soundDesign: shotIndex === 1 ? "环境底噪与远处车流" : "呼吸和衣料摩擦声",
        notes: shotIndex === 1 ? "用作场景建立镜头。" : "优先照顾表演节奏与眼神。",
        imagePrompt: `${scene.heading} ${scene.synopsis} ${cinematicStyle} still frame`,
        videoPrompt: `${scene.heading} ${scene.synopsis} ${cinematicStyle} motion shot`,
      }));
    });

    return normalizeStoryboardContent({
      overview: `根据剧本生成的${cinematicStyle}分镜，共 ${shots.length} 个镜头。`,
      shots,
    });
  }
  private mockSynopsis(input: GenerateSynopsisInput): string {
    return [
      `《${input.title}》大纲`,
      ``,
      `类型：${input.genre}`,
      `主题：${input.theme}`,
      `关键字：${input.keywords.join("、")}`,
      ``,
      `故事概述：`,
      `在一个充满${input.theme}的背景下，主角面临着重大抉择。故事围绕${input.keywords[0] ?? "核心冲突"}展开，通过${input.episodeCount}集的篇幅层层递进。`,
      ``,
      ...Array.from({ length: input.episodeCount }, (_, i) =>
        `第${i + 1}集：${i === 0 ? "开篇——建立人物关系与核心矛盾。" : i === input.episodeCount - 1 ? "终章——所有线索汇聚，矛盾爆发，主角做出最终选择。" : `第${i + 1}章——情节推进，新角色加入，紧张感升级。`}`
      ),
      input.constraints ? `\n约束说明：${input.constraints}` : "",
    ].filter(Boolean).join("\n");
  }

  private mockRewrite(input: RewriteSegmentInput): string {
    return `[AI 重写结果 - 指令: ${input.instruction}]\n\n${input.originalText}\n\n（以上为模拟重写结果，真实环境将调用 LLM API）`;
  }
}