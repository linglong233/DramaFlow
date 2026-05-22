/**
 * @fileoverview 对话式生成服务
 * @module api/jobs
 *
 * 管理对话式 AI 生成的会话状态、QA 维度追踪和简报更新。
 */

import { Inject, Injectable, Logger, NotFoundException } from "@nestjs/common";
import type {
  ConversationBrief,
  ConversationDimension,
  ConversationDimensionStatus,
  ConversationMessage,
  ConversationSession,
  LlmConfigSource,
  LlmProviderConfig,
  WorldBibleContent,
} from "@dramaflow/shared";

import { DevDatabaseService } from "../common/dev-database.service";
import { createId } from "../common/id";
import { OpenAiCompatTextProvider, StreamChunk } from "./text-generation.provider";
import { WorkspaceService } from "../workspace/workspace.service";

const DIMENSIONS: ConversationDimension[] = [
  "coreConflict",
  "protagonist",
  "supportingChars",
  "tone",
  "pacing",
  "constraints",
];

const DIMENSION_LABELS: Record<ConversationDimension, string> = {
  coreConflict: "核心冲突",
  protagonist: "主角设定",
  supportingChars: "配角关系",
  tone: "故事基调",
  pacing: "集数节奏",
  constraints: "特殊要求",
};

const INITIAL_QUESTIONS: Record<ConversationDimension, string> = {
  coreConflict: "你想讲一个什么样的故事？核心矛盾或冲突是什么？",
  protagonist: "主角是什么样的人？他/她有什么核心动机或目标？",
  supportingChars: "有哪些关键配角？他们跟主角的关系是怎样的？",
  tone: "整体调性偏什么风格？比如悬疑、轻松、治愈、暗黑……",
  pacing: "计划拍多少集？每集大概多长时间？有没有特别想要的节奏感？",
  constraints: "有没有特殊限制或要求？比如审核敏感内容、预算限制、目标平台等。",
};

function emptyDimensionStatus(): Record<ConversationDimension, ConversationDimensionStatus> {
  return {
    coreConflict: "pending",
    protagonist: "pending",
    supportingChars: "pending",
    tone: "pending",
    pacing: "pending",
    constraints: "pending",
  };
}

function emptyBrief(): ConversationBrief {
  return {};
}

@Injectable()
export class ConversationService {
  private readonly logger = new Logger(ConversationService.name);

  constructor(
    @Inject(DevDatabaseService) private readonly database: DevDatabaseService,
    @Inject(OpenAiCompatTextProvider) private readonly textProvider: OpenAiCompatTextProvider,
    @Inject(WorkspaceService) private readonly workspaceService: WorkspaceService,
  ) {}

  async getOrCreateSession(
    userId: string,
    projectId: string,
    sessionId: string | undefined,
    targetDocType: "synopsis" | "script",
  ): Promise<ConversationSession> {
    await this.workspaceService.assertProjectPermission(
      userId,
      projectId,
      "project.view",
      "You do not have permission to view this project",
    );

    if (sessionId) {
      return this.getSessionForProject(userId, projectId, sessionId, "project.view");
    }

    const now = new Date().toISOString();
    const session: ConversationSession = {
      id: createId("conv"),
      projectId,
      messages: [],
      brief: emptyBrief(),
      dimensionStatus: emptyDimensionStatus(),
      targetDocType,
      createdBy: userId,
      createdAt: now,
      updatedAt: now,
    };

    await this.database.mutate((db) => {
      db.conversationSessions.push(session);
    });

    return session;
  }

  async getSessionForProject(
    userId: string,
    projectId: string,
    sessionId: string,
    permission: "project.view" | "project.edit" = "project.view",
  ): Promise<ConversationSession> {
    await this.workspaceService.assertProjectPermission(
      userId,
      projectId,
      permission,
      permission === "project.edit"
        ? "You do not have permission to edit this project"
        : "You do not have permission to view this project",
    );

    const session = await this.database.query((db) =>
      db.conversationSessions.find((s) => s.id === sessionId && s.projectId === projectId),
    );
    if (!session) {
      throw new NotFoundException("Conversation session not found");
    }
    return session;
  }

  async getSession(userId: string, sessionId: string): Promise<ConversationSession> {
    const session = await this.database.query((db) =>
      db.conversationSessions.find((s) => s.id === sessionId),
    );
    if (!session) {
      throw new NotFoundException("Conversation session not found");
    }
    await this.workspaceService.assertProjectPermission(
      userId,
      session.projectId,
      "project.view",
      "You do not have permission to view this project",
    );
    return session;
  }

  async deleteSession(userId: string, projectId: string, sessionId: string): Promise<void> {
    await this.getSessionForProject(userId, projectId, sessionId, "project.edit");
    await this.database.mutate((db) => {
      const idx = db.conversationSessions.findIndex((s) => s.id === sessionId && s.projectId === projectId);
      if (idx >= 0) db.conversationSessions.splice(idx, 1);
    });
  }

  async appendMessage(sessionId: string, message: ConversationMessage): Promise<ConversationSession> {
    return this.database.mutate((db) => {
      const session = db.conversationSessions.find((s) => s.id === sessionId);
      if (!session) throw new NotFoundException("Conversation session not found");
      session.messages.push(message);
      session.updatedAt = new Date().toISOString();
      return { ...session, messages: [...session.messages] };
    });
  }

  async mergeBrief(
    sessionId: string,
    brief: ConversationBrief | undefined,
  ): Promise<ConversationSession> {
    const filtered = this.filterBrief(brief);
    return this.database.mutate((db) => {
      const session = db.conversationSessions.find((s) => s.id === sessionId);
      if (!session) throw new NotFoundException("Conversation session not found");
      session.brief = { ...session.brief, ...filtered };
      session.dimensionStatus = this.confirmDimensionsForBrief(session.dimensionStatus, filtered);
      session.updatedAt = new Date().toISOString();
      return {
        ...session,
        brief: { ...session.brief },
        dimensionStatus: { ...session.dimensionStatus },
        messages: [...session.messages],
      };
    });
  }

  async updateSessionState(
    sessionId: string,
    briefUpdates: ConversationBrief,
    dimensionStatus: Record<ConversationDimension, ConversationDimensionStatus>,
  ): Promise<ConversationSession> {
    return this.database.mutate((db) => {
      const session = db.conversationSessions.find((s) => s.id === sessionId);
      if (!session) throw new NotFoundException("Conversation session not found");
      session.brief = { ...session.brief, ...briefUpdates };
      session.dimensionStatus = { ...dimensionStatus };
      session.updatedAt = new Date().toISOString();
      return {
        ...session,
        brief: { ...session.brief },
        dimensionStatus: { ...session.dimensionStatus },
        messages: [...session.messages],
      };
    });
  }

  private filterBrief(brief?: ConversationBrief): ConversationBrief {
    if (!brief) return {};
    return Object.fromEntries(
      Object.entries(brief)
        .filter(([, value]) => typeof value === "string" && value.trim())
        .map(([key, value]) => [key, String(value).trim()]),
    ) as ConversationBrief;
  }

  private confirmDimensionsForBrief(
    current: Record<ConversationDimension, ConversationDimensionStatus>,
    brief: ConversationBrief,
  ): Record<ConversationDimension, ConversationDimensionStatus> {
    const next = { ...current };
    for (const key of Object.keys(brief) as ConversationDimension[]) {
      if (brief[key]?.trim()) {
        next[key] = "confirmed";
      }
    }
    return next;
  }

  /** Get the next dimension that needs discussion */
  getNextDimension(
    dimensionStatus: Record<ConversationDimension, ConversationDimensionStatus>,
    focusDimension?: ConversationDimension,
  ): ConversationDimension | null {
    if (focusDimension && dimensionStatus[focusDimension] !== "confirmed") {
      return focusDimension;
    }

    for (const dim of DIMENSIONS) {
      if (dimensionStatus[dim] !== "confirmed") return dim;
    }
    return null;
  }

  /** Build the initial AI greeting with first question */
  buildInitialMessage(): ConversationMessage {
    return {
      role: "ai",
      content: `你好！我是你的短剧创作助手。在开始生成之前，我想先了解你的故事想法。\n\n${INITIAL_QUESTIONS.coreConflict}`,
    };
  }

  /** Build a follow-up question for a specific dimension */
  buildDimensionQuestion(dimension: ConversationDimension): string {
    return INITIAL_QUESTIONS[dimension];
  }

  /** Count confirmed dimensions */
  countConfirmed(status: Record<ConversationDimension, ConversationDimensionStatus>): number {
    return DIMENSIONS.filter((d) => status[d] === "confirmed").length;
  }

  /** Build QA system prompt */
  buildQaSystemPrompt(
    dimensionStatus: Record<ConversationDimension, ConversationDimensionStatus>,
    brief: ConversationBrief,
    worldBible?: WorldBibleContent | null,
    focusDimension?: ConversationDimension,
  ): string {
    const confirmedDims = DIMENSIONS.filter((d) => dimensionStatus[d] === "confirmed");
    const pendingDims = DIMENSIONS.filter((d) => dimensionStatus[d] !== "confirmed");

    const focus = this.getNextDimension(dimensionStatus, focusDimension);

    const briefSummary = Object.entries(brief)
      .filter(([, v]) => v?.trim())
      .map(([k, v]) => `- ${DIMENSION_LABELS[k as ConversationDimension]}：${v}`)
      .join("\n");

    const wbContext = worldBible
      ? [
          "\n\n## 项目世界观参考",
          worldBible.characters.length > 0
            ? `已有角色：${worldBible.characters.map((c) => c.name).join("、")}`
            : "",
          worldBible.locations.length > 0
            ? `已有场景地点：${worldBible.locations.map((l) => l.name).join("、")}`
            : "",
          worldBible.styleGuide?.visualStyle
            ? `视觉风格：${worldBible.styleGuide.visualStyle}`
            : "",
        ].filter(Boolean).join("\n")
      : "";

    return [
      "你是 DramaFlow 的短剧编剧助手。你的任务是通过自然对话，帮助用户梳理短剧创作思路。",
      "",
      "## 行为规则",
      "1. 每次只问一个问题，等用户回答后再追问或推进到下一个维度",
      "2. 如果用户一次回答覆盖了多个维度，自动识别并标记，不要重复问",
      "3. 如果用户主动聊到未覆盖的维度，顺势深入，不打断",
      "4. 回复要简短自然，像跟编剧搭档聊天一样",
      "5. 每次回复包含三部分：简短回应 → 提炼用户说的要点 → 提出下一个问题",
      "",
      "## 你的回复格式（严格遵守 JSON）",
      "每次回复必须是如下 JSON 格式：",
      "```json",
      '{',
      '  "reply": "你对用户说的话（自然对话文本）",',
      '  "briefUpdates": {',
      '    "coreConflict": "从对话中提炼的核心冲突（可选）",',
      '    "protagonist": "主角设定（可选）",',
      '    "supportingChars": "配角关系（可选）",',
      '    "tone": "故事基调（可选）",',
      '    "pacing": "集数节奏（可选）",',
      '    "constraints": "特殊要求（可选）"',
      "  }",
      "}",
      "```",
      "只填写你从用户回复中明确获知的字段，不要猜测。",
      "",
      focus ? `## 当前优先讨论维度\n${DIMENSION_LABELS[focus]}：${INITIAL_QUESTIONS[focus]}` : "",
      "## 当前状态",
      `已确认维度：${confirmedDims.map((d) => DIMENSION_LABELS[d]).join("、") || "无"}`,
      `待讨论维度：${pendingDims.map((d) => DIMENSION_LABELS[d]).join("、") || "全部已确认"}`,
      briefSummary ? `\n## 当前简报\n${briefSummary}` : "",
      worldBible ? wbContext : "",
    ].filter(Boolean).join("\n");
  }

  /** Build generation prompt from conversation history and brief */
  buildGenerationPrompt(
    brief: ConversationBrief,
    messages: ConversationMessage[],
    targetDocType: "synopsis" | "script",
    worldBible?: WorldBibleContent | null,
  ): string {
    const briefSection = Object.entries(brief)
      .filter(([, v]) => v?.trim())
      .map(([k, v]) => `${DIMENSION_LABELS[k as ConversationDimension]}：${v}`)
      .join("\n");

    const conversationSection = messages
      .map((message) => `${message.role === "ai" ? "AI" : "用户"}：${message.content}`)
      .join("\n");

    const wbSection = worldBible
      ? [
          "\n## 项目世界观",
          worldBible.characters.length > 0
            ? `角色：${worldBible.characters.map((c) => `${c.name}（${c.appearance}）`).join("；")}`
            : "",
          worldBible.locations.length > 0
            ? `场景：${worldBible.locations.map((l) => `${l.name}（${l.description}）`).join("；")}`
            : "",
          worldBible.styleGuide?.visualStyle ? `风格：${worldBible.styleGuide.visualStyle}` : "",
        ].filter(Boolean).join("\n")
      : "";

    if (targetDocType === "synopsis") {
      return [
        "根据以下创作简报和对话历史，生成一份详细的短剧大纲。",
        "大纲应包含：故事概述、角色介绍、每集的 beat-by-beat 梗概。",
        "返回纯文本格式的大纲内容。",
        "",
        "## 创作简报",
        briefSection,
        "",
        "## 对话历史",
        conversationSection,
        wbSection,
      ].filter(Boolean).join("\n");
    }

    return [
      "Return JSON only.",
      "根据以下创作简报和对话历史，生成一个短剧剧本 payload。",
      "包含字段：logline, premise, characters, scenes。",
      "每个角色包含 name 和 profile。",
      "每个场景包含 id, heading, synopsis, characters, dialogue（speaker + line）, directorNote。",
      "",
      "## 创作简报",
      briefSection,
      "",
      "## 对话历史",
      conversationSection,
      wbSection,
    ].filter(Boolean).join("\n");
  }

  /** Stream QA response */
  async *streamQaResponse(
    session: ConversationSession,
    config: LlmProviderConfig | undefined,
    worldBible?: WorldBibleContent | null,
    focusDimension?: ConversationDimension,
  ): AsyncGenerator<StreamChunk> {
    const systemPrompt = this.buildQaSystemPrompt(session.dimensionStatus, session.brief, worldBible, focusDimension);
    const chatMessages = session.messages.map((m) => ({
      role: m.role === "ai" ? "assistant" : "user",
      content: m.content,
    }));

    yield* this.textProvider.streamChat(systemPrompt, chatMessages, config);
  }

  /** Stream generation from conversation */
  async *streamGeneration(
    session: ConversationSession,
    config: LlmProviderConfig | undefined,
    worldBible?: WorldBibleContent | null,
    targetDocType: "synopsis" | "script" = session.targetDocType,
  ): AsyncGenerator<StreamChunk> {
    const prompt = this.buildGenerationPrompt(session.brief, session.messages, targetDocType, worldBible);

    if (targetDocType === "synopsis") {
      yield* this.textProvider.streamPlainText({
        operation: "conversational synopsis generation",
        prompt,
        systemPrompt: "你是一位专业的短剧编剧。根据用户的创作需求生成详细大纲。",
        temperature: 0.8,
        baseUrl: (config?.baseUrl || this.textProvider.getBaseUrl()).replace(/\/$/, ""),
        apiKey: config?.apiKey || this.textProvider.getApiKey() || "replace-me",
        model: config?.model || this.textProvider.getModel(),
        mockFactory: () => this.mockSynopsisFromBrief(session),
      });
    } else {
      yield* this.textProvider.streamStructuredPayload({
        operation: "conversational script generation",
        prompt,
        systemPrompt: "You are a screenplay development assistant. Always return strict JSON.",
        temperature: 0.8,
        baseUrl: (config?.baseUrl || this.textProvider.getBaseUrl()).replace(/\/$/, ""),
        apiKey: config?.apiKey || this.textProvider.getApiKey() || "replace-me",
        model: config?.model || this.textProvider.getModel(),
        mockFactory: () => this.mockScriptFromBrief(session),
      });
    }
  }

  /** Resolve LLM config from team/personal settings */
  async resolveTextLlmConfig(
    userId: string,
    projectId: string,
    configSource?: LlmConfigSource,
  ): Promise<LlmProviderConfig | undefined> {
    const config = await this.database.query((db) => {
      const project = db.projects.find((p) => p.id === projectId);

      if (configSource === "personal") {
        const userConfig = db.users.find((u) => u.id === userId)?.llmConfig as LlmProviderConfig | undefined;
        return this.normalizeLlmConfig(userConfig);
      }

      if (configSource === "team") {
        const teamConfig = project
          ? this.normalizeLlmConfig(db.teams.find((t) => t.id === project.teamId)?.llmConfig as LlmProviderConfig | undefined)
          : undefined;
        return teamConfig;
      }

      const teamConfig = project
        ? this.normalizeLlmConfig(db.teams.find((t) => t.id === project.teamId)?.llmConfig as LlmProviderConfig | undefined)
        : undefined;
      const userConfig = this.normalizeLlmConfig(
        db.users.find((u) => u.id === userId)?.llmConfig as LlmProviderConfig | undefined,
      );

      return this.mergeLlmConfig(userConfig, teamConfig);
    });

    return config;
  }

  private normalizeLlmConfig(config?: LlmProviderConfig): LlmProviderConfig | undefined {
    if (!config) return undefined;
    const normalized: LlmProviderConfig = {
      provider: config.provider,
      apiKey: config.apiKey?.trim() || undefined,
      baseUrl: config.baseUrl?.trim() || undefined,
      model: config.model?.trim() || undefined,
      ...(config.stream !== undefined ? { stream: config.stream } : {}),
    };
    if (!normalized.apiKey && !normalized.baseUrl && !normalized.model && normalized.stream === undefined) return undefined;
    return normalized;
  }

  private mergeLlmConfig(
    base?: LlmProviderConfig,
    override?: LlmProviderConfig,
  ): LlmProviderConfig | undefined {
    const b = this.normalizeLlmConfig(base);
    const o = this.normalizeLlmConfig(override);
    if (!b && !o) return undefined;
    return {
      provider: o?.provider ?? b?.provider ?? "openai-completions",
      apiKey: o?.apiKey ?? b?.apiKey,
      baseUrl: o?.baseUrl ?? b?.baseUrl,
      model: o?.model ?? b?.model,
      ...(o?.stream !== undefined ? { stream: o.stream } : b?.stream !== undefined ? { stream: b.stream } : {}),
    };
  }

  private mockSynopsisFromBrief(session: ConversationSession): string {
    const b = session.brief;
    return [
      `《${b.coreConflict ?? "未命名"}》大纲`,
      "",
      `核心冲突：${b.coreConflict ?? "待定"}`,
      `主角：${b.protagonist ?? "待定"}`,
      `配角：${b.supportingChars ?? "待定"}`,
      `基调：${b.tone ?? "待定"}`,
      `节奏：${b.pacing ?? "待定"}`,
      "",
      "第1集：开篇——建立核心矛盾与人物关系。",
      "第2集：推进——冲突升级，角色面临抉择。",
      "第3集：高潮——矛盾爆发，故事走向结局。",
      "",
      "（以上为模拟生成，真实环境将基于对话历史生成详细大纲）",
    ].join("\n");
  }

  private mockScriptFromBrief(session: ConversationSession) {
    const b = session.brief;
    return {
      logline: b.coreConflict ?? "短剧故事",
      premise: b.coreConflict ?? "故事前提",
      characters: [
        { name: "主角", profile: b.protagonist ?? "主角设定" },
      ],
      scenes: [
        {
          id: "scene-1",
          heading: "内景 / 未知地点 / 日",
          synopsis: "开场建立核心冲突。",
          characters: ["主角"],
          dialogue: [{ speaker: "主角", line: "事情不应该这样发展。" }],
          directorNote: `${b.tone ?? "标准"}基调`,
        },
      ],
    };
  }
}
