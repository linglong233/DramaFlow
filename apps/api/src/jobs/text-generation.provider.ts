import { Injectable, Logger } from "@nestjs/common";
import type {
  GenerateScriptInput,
  GenerateStoryboardInput,
  ScriptContent,
  StoryboardContent,
  TextGenerationProvider,
} from "@dramaflow/shared";

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

@Injectable()
export class OpenAiCompatTextProvider implements TextGenerationProvider {
  private readonly logger = new Logger(OpenAiCompatTextProvider.name);
  private readonly apiKey = process.env.OPENAI_COMPAT_API_KEY;
  private readonly baseUrl = (process.env.OPENAI_COMPAT_BASE_URL ?? "https://api.openai.com/v1").replace(/\/$/, "");
  private readonly model = process.env.OPENAI_TEXT_MODEL ?? "gpt-4.1-mini";
  private readonly mockFallbackEnabled = (process.env.OPENAI_COMPAT_MOCK_FALLBACK ?? "true") !== "false";

  async generateScript(input: GenerateScriptInput): Promise<ScriptContent> {
    if (!this.apiKey || this.apiKey === "replace-me") {
      return this.mockScript(input);
    }

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
      mockFactory: () => this.mockScript(input),
    });
  }

  async generateStoryboard(
    input: GenerateStoryboardInput & { script: ScriptContent },
  ): Promise<StoryboardContent> {
    if (!this.apiKey || this.apiKey === "replace-me") {
      return this.mockStoryboard(input.script, input.cinematicStyle, input.shotDensity);
    }

    const prompt = [
      "Return JSON only.",
      "Generate a storyboard payload with fields overview and shots.",
      `Cinematic style: ${input.cinematicStyle}`,
      `Shot density: ${input.shotDensity}`,
      `Script JSON: ${JSON.stringify(input.script)}`,
    ].join("\n");

    return this.generateStructuredPayload({
      operation: "storyboard generation",
      prompt,
      systemPrompt: "You are a storyboard supervisor. Always return strict JSON.",
      temperature: 0.7,
      mockFactory: () => this.mockStoryboard(input.script, input.cinematicStyle, input.shotDensity),
    });
  }

  private async generateStructuredPayload<T>(options: {
    operation: string;
    prompt: string;
    systemPrompt: string;
    temperature: number;
    mockFactory: () => T;
  }): Promise<T> {
    try {
      const response = await fetch(`${this.baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model: this.model,
          temperature: options.temperature,
          stream: false,
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
        return parsed;
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

    try {
      return JSON.parse(raw) as T;
    } catch {
      const match = raw.match(/\{[\s\S]*\}$/);
      if (!match) {
        return undefined;
      }
      try {
        return JSON.parse(match[0]) as T;
      } catch {
        return undefined;
      }
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
          directorNote: `镜头语言保持${input.tone}，节奏往前顶。`,
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
        shotLabel: `${sceneIndex + 1}-${shotIndex}`,
        framing: shotIndex === 1 ? "大全景" : "近景",
        cameraMove: shotIndex === 1 ? "缓慢推进" : "手持轻晃",
        durationSeconds: shotDensity === "dense" ? 3 : 5,
        visualDescription: `${scene.synopsis}，采用${cinematicStyle}质感。`,
        dialogue: scene.dialogue[shotIndex - 1]?.line,
        soundDesign: shotIndex === 1 ? "环境底噪与远处车流" : "呼吸和衣料摩擦声",
        imagePrompt: `${scene.heading} ${scene.synopsis} ${cinematicStyle} still frame`,
        videoPrompt: `${scene.heading} ${scene.synopsis} ${cinematicStyle} motion shot`,
      }));
    });

    return {
      overview: `根据剧本生成的${cinematicStyle}分镜，共 ${shots.length} 个镜头。`,
      shots,
    };
  }
}