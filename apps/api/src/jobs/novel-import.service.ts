import { BadRequestException, ForbiddenException, Inject, Injectable, Logger, NotFoundException } from "@nestjs/common";
import type {
  CreateNovelImportSessionPayload,
  JobRecord,
  LlmConfigSource,
  LlmProviderConfig,
  NovelImportChunkRecord,
  NovelImportJobInput,
  NovelImportOptions,
  NovelImportSession,
  NovelImportStage,
  ScriptContent,
  ScriptScene,
  WorldBibleContent,
} from "@dramaflow/shared";
import { normalizeScriptContent, normalizeScriptScene, normalizeWorldBibleContent } from "@dramaflow/shared";
import { createId } from "../common/id";
import { DevDatabaseService } from "../common/dev-database.service";
import type { StreamChunk } from "./text-generation.provider";
import { WorkspaceService } from "../workspace/workspace.service";

export interface NovelImportInput {
  text: string;
  llmConfigSource?: LlmConfigSource;
}

export type NovelImportEvent =
  | { type: "progress"; phase: "chunking"; totalChunks: number }
  | { type: "progress"; phase: "worldBible"; message: string }
  | { type: "worldBible"; content: WorldBibleContent }
  | { type: "synopsis"; content: string }
  | { type: "progress"; phase: "script"; chunkIndex: number; totalChunks: number }
  | { type: "scenes"; chunkIndex: number; scenes: ScriptScene[] }
  | { type: "done"; worldBibleDocId: string; synopsisDocId: string; scriptDocId: string }
  | { type: "error"; error: string };

const MAX_NOVEL_IMPORT_CHARS = 500_000;

@Injectable()
export class NovelImportService {
  private readonly logger = new Logger(NovelImportService.name);

  constructor(
    @Inject(DevDatabaseService) private readonly database: DevDatabaseService,
    @Inject(WorkspaceService) private readonly workspaceService: WorkspaceService,
  ) {}

  async createSession(userId: string, projectId: string, payload: CreateNovelImportSessionPayload) {
    const text = payload.text.trim();
    if (!text) {
      throw new BadRequestException("Novel text cannot be empty");
    }
    if (text.length > MAX_NOVEL_IMPORT_CHARS) {
      throw new BadRequestException(`Novel text cannot exceed ${MAX_NOVEL_IMPORT_CHARS} characters`);
    }
    const targetEpisodeCount = Number(payload.targetEpisodeCount);
    const episodeDurationMinutes = Number(payload.episodeDurationMinutes);
    if (!Number.isInteger(targetEpisodeCount) || targetEpisodeCount < 1 || targetEpisodeCount > 100) {
      throw new BadRequestException("Target episode count must be between 1 and 100");
    }
    if (!Number.isFinite(episodeDurationMinutes) || episodeDurationMinutes <= 0 || episodeDurationMinutes > 60) {
      throw new BadRequestException("Episode duration must be between 1 and 60 minutes");
    }

    await this.assertProjectEditable(userId, projectId);
    const now = new Date().toISOString();
    const options: NovelImportOptions = {
      targetEpisodeCount,
      episodeDurationMinutes,
      genreStyle: payload.genreStyle.trim(),
      adaptationFocus: payload.adaptationFocus.trim(),
      llmConfigSource: payload.llmConfigSource,
    };
    const chunks = this.chunkSourceText(text);
    if (chunks.length === 0) {
      throw new BadRequestException("Novel text could not be split into chunks");
    }

    const session: NovelImportSession = {
      id: createId("novel_import"),
      projectId,
      createdBy: userId,
      status: "draft",
      stage: "setup",
      progress: 0,
      sourceText: text,
      options,
      chunks,
      createdAt: now,
      updatedAt: now,
    };

    return this.database.mutate((db) => {
      db.novelImportSessions.push(session);
      return session;
    });
  }

  async getLatestSession(userId: string, projectId: string) {
    await this.assertProjectReadable(userId, projectId);
    return this.database.query((db) => {
      const sessions = db.novelImportSessions
        .filter((session) => session.projectId === projectId && session.createdBy === userId && session.status !== "written")
        .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
      return sessions[0] ?? null;
    });
  }

  async getSession(userId: string, sessionId: string) {
    const session = await this.database.query((db) => db.novelImportSessions.find((item) => item.id === sessionId));
    if (!session) {
      throw new NotFoundException("Novel import session not found");
    }
    await this.assertProjectReadable(userId, session.projectId);
    return session;
  }

  async attachJob(userId: string, sessionId: string, jobId: string) {
    const session = await this.getSession(userId, sessionId);
    if (session.status === "queued" || session.status === "running" || session.status === "written") {
      throw new BadRequestException(`Cannot start a session with status "${session.status}"`);
    }
    return this.database.mutate((db) => {
      const live = this.mustFindSession(db, session.id);
      live.status = "queued";
      live.lastJobId = jobId;
      live.error = undefined;
      live.updatedAt = new Date().toISOString();
      return live;
    });
  }

  async cancelSession(userId: string, sessionId: string) {
    const session = await this.getSession(userId, sessionId);
    if (session.status === "written") {
      throw new BadRequestException("Written sessions cannot be cancelled");
    }
    return this.database.mutate((db) => {
      const live = this.mustFindSession(db, session.id);
      live.status = "cancelled";
      live.error = undefined;
      live.updatedAt = new Date().toISOString();
      return live;
    });
  }

  async processJob(
    job: JobRecord<NovelImportJobInput>,
    resolveLlmConfig: (userId: string, projectId: string, source?: LlmConfigSource) => Promise<LlmProviderConfig>,
    streamLlm: (systemPrompt: string, messages: Array<{ role: string; content: string }>, config?: LlmProviderConfig) => AsyncGenerator<StreamChunk>,
  ): Promise<Record<string, unknown>> {
    if (job.input.action === "runSession") {
      const session = await this.runSession(job.createdBy, job.input.sessionId, resolveLlmConfig, streamLlm);
      return { sessionId: session.id, status: session.status, stage: session.stage };
    }
    if (job.input.action === "retryChunk") {
      const session = await this.retryChunk(job.createdBy, job.input.sessionId, job.input.chunkIndex, resolveLlmConfig, streamLlm);
      return { sessionId: session.id, status: session.status, chunkIndex: job.input.chunkIndex };
    }
    const session = await this.rerunFromChunk(job.createdBy, job.input.sessionId, job.input.chunkIndex, resolveLlmConfig, streamLlm);
    return { sessionId: session.id, status: session.status, chunkIndex: job.input.chunkIndex };
  }

  private mustFindSession(db: { novelImportSessions: NovelImportSession[] }, sessionId: string) {
    const session = db.novelImportSessions.find((item) => item.id === sessionId);
    if (!session) {
      throw new NotFoundException("Novel import session not found");
    }
    return session;
  }

  // ===== Pipeline orchestration =====

  private async runSession(
    userId: string,
    sessionId: string,
    resolveLlmConfig: (userId: string, projectId: string, source?: LlmConfigSource) => Promise<LlmProviderConfig>,
    streamLlm: (systemPrompt: string, messages: Array<{ role: string; content: string }>, config?: LlmProviderConfig) => AsyncGenerator<StreamChunk>,
  ) {
    let session = await this.markSessionRunning(userId, sessionId, "adaptationPlan", 5);
    const config = await resolveLlmConfig(userId, session.projectId, session.options.llmConfigSource);

    if (!session.adaptationPlan) {
      const adaptationPlan = await this.generateAdaptationPlan(session, config, streamLlm);
      session = await this.updateSession(session.id, (live) => {
        live.adaptationPlan = adaptationPlan;
        live.stage = "worldBible";
        live.progress = 20;
      });
    }

    if (!session.worldBible) {
      const worldBible = await this.generateWorldBible(session, config, streamLlm);
      session = await this.updateSession(session.id, (live) => {
        live.worldBible = worldBible;
        live.stage = "synopsis";
        live.progress = 35;
      });
    }

    if (!session.synopsis) {
      const synopsis = await this.generateSynopsisForSession(session, config, streamLlm);
      session = await this.updateSession(session.id, (live) => {
        live.synopsis = synopsis;
        live.stage = "script";
        live.progress = 45;
      });
    }

    const startIndex = session.chunks.find((chunk) => chunk.status !== "completed" && chunk.status !== "stale")?.index ?? 0;
    session = await this.generateChunksFrom(session.id, startIndex, config, streamLlm, true);
    return this.updateSession(session.id, (live) => {
      live.status = "needs_review";
      live.stage = "review";
      live.progress = 100;
      live.scriptPreview = this.buildPreview(live);
      live.error = undefined;
    });
  }

  private async retryChunk(
    _userId: string,
    _sessionId: string,
    _chunkIndex: number,
    _resolveLlmConfig: (userId: string, projectId: string, source?: LlmConfigSource) => Promise<LlmProviderConfig>,
    _streamLlm: (systemPrompt: string, messages: Array<{ role: string; content: string }>, config?: LlmProviderConfig) => AsyncGenerator<StreamChunk>,
  ): Promise<NovelImportSession> {
    throw new Error("retryChunk not yet implemented");
  }

  private async rerunFromChunk(
    _userId: string,
    _sessionId: string,
    _chunkIndex: number,
    _resolveLlmConfig: (userId: string, projectId: string, source?: LlmConfigSource) => Promise<LlmProviderConfig>,
    _streamLlm: (systemPrompt: string, messages: Array<{ role: string; content: string }>, config?: LlmProviderConfig) => AsyncGenerator<StreamChunk>,
  ): Promise<NovelImportSession> {
    throw new Error("rerunFromChunk not yet implemented");
  }

  // ===== Session state helpers =====

  private async markSessionRunning(userId: string, sessionId: string, stage: NovelImportStage, progress: number) {
    const session = await this.getSession(userId, sessionId);
    if (session.status === "written") {
      throw new BadRequestException("Written sessions cannot be regenerated");
    }
    return this.updateSession(session.id, (live) => {
      if (live.status === "cancelled") {
        throw new Error("Novel import session was cancelled");
      }
      live.status = "running";
      live.stage = stage;
      live.progress = progress;
      live.error = undefined;
    });
  }

  private async updateSession(sessionId: string, mutate: (session: NovelImportSession) => void) {
    return this.database.mutate((db) => {
      const live = this.mustFindSession(db, sessionId);
      mutate(live);
      live.updatedAt = new Date().toISOString();
      return live;
    });
  }

  private async assertNotCancelled(sessionId: string) {
    const status = await this.database.query((db) => this.mustFindSession(db, sessionId).status);
    if (status === "cancelled") {
      throw new Error("Novel import session was cancelled");
    }
  }

  // ===== LLM helpers =====

  private async collectText(
    system: string,
    user: string,
    config: LlmProviderConfig,
    streamLlm: (systemPrompt: string, messages: Array<{ role: string; content: string }>, config?: LlmProviderConfig) => AsyncGenerator<StreamChunk>,
  ) {
    let full = "";
    for await (const chunk of streamLlm(system, [{ role: "user", content: user }], config)) {
      if (chunk.type === "error") {
        throw new Error(chunk.error ?? "LLM request failed");
      }
      if (chunk.type === "chunk" && chunk.content) {
        full += chunk.content;
      }
      if (chunk.type === "done" && typeof chunk.result === "string" && !full) {
        full = chunk.result;
      }
    }
    return full.trim();
  }

  private parseStrictJson<T>(raw: string): T {
    const cleaned = raw.trim().replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/```\s*$/i, "").trim();
    return JSON.parse(cleaned) as T;
  }

  // ===== Generation methods =====

  private async generateAdaptationPlan(
    session: NovelImportSession,
    config: LlmProviderConfig,
    streamLlm: (systemPrompt: string, messages: Array<{ role: string; content: string }>, config?: LlmProviderConfig) => AsyncGenerator<StreamChunk>,
  ) {
    return this.collectText(
      "You are a short drama adaptation planner. Write concise Chinese planning notes.",
      [
        "请为小说改编短剧制定轻量改编计划。",
        `目标集数：${session.options.targetEpisodeCount}`,
        `单集时长：${session.options.episodeDurationMinutes} 分钟`,
        `剧种/风格：${session.options.genreStyle}`,
        `改编侧重点：${session.options.adaptationFocus}`,
        "必须包含：主要人物、核心冲突、目标集数结构、类型基调、全书剧情弧线。",
        `\n小说片段：\n${session.sourceText.slice(0, 12000)}`,
      ].join("\n"),
      config,
      streamLlm,
    );
  }

  private async generateWorldBible(
    session: NovelImportSession,
    config: LlmProviderConfig,
    streamLlm: (systemPrompt: string, messages: Array<{ role: string; content: string }>, config?: LlmProviderConfig) => AsyncGenerator<StreamChunk>,
  ) {
    const raw = await this.collectText(
      "You are a story analyst. Always return strict JSON.",
      [
        "从小说和改编计划中提取世界观。",
        'Return JSON with shape: { "characters": [{ "id": "char-N", "name": "...", "appearance": "...", "personality": "...", "tags": [], "referenceImages": [], "sortOrder": N }], "locations": [{ "id": "loc-N", "name": "...", "description": "...", "referenceImages": [], "sortOrder": N }], "styleGuide": { "visualStyle": "..." } }',
        `\n改编计划：\n${session.adaptationPlan ?? ""}`,
        `\n小说片段：\n${session.sourceText.slice(0, 16000)}`,
      ].join("\n"),
      config,
      streamLlm,
    );
    try {
      return normalizeWorldBibleContent(this.parseStrictJson(raw));
    } catch (error) {
      await this.updateSession(session.id, (live) => {
        live.status = "failed";
        live.stage = "worldBible";
        live.error = `World bible JSON parse failed: ${error instanceof Error ? error.message : "Unknown error"}`;
      });
      throw error;
    }
  }

  private async generateSynopsisForSession(
    session: NovelImportSession,
    config: LlmProviderConfig,
    streamLlm: (systemPrompt: string, messages: Array<{ role: string; content: string }>, config?: LlmProviderConfig) => AsyncGenerator<StreamChunk>,
  ) {
    return this.collectText(
      "You are a screenplay development assistant. Write Chinese markdown.",
      [
        "基于小说、改编计划和世界观，生成结构化短剧大纲。",
        "必须包含：故事概览、人物介绍、分集/节拍大纲。",
        `\n改编计划：\n${session.adaptationPlan ?? ""}`,
        `\n世界观：\n${JSON.stringify(session.worldBible ?? {}, null, 2)}`,
        `\n小说片段：\n${session.sourceText.slice(0, 16000)}`,
      ].join("\n"),
      config,
      streamLlm,
    );
  }

  private async generateChunkScenesForSession(
    session: NovelImportSession,
    chunkIndex: number,
    previousSummary: string,
    config: LlmProviderConfig,
    streamLlm: (systemPrompt: string, messages: Array<{ role: string; content: string }>, config?: LlmProviderConfig) => AsyncGenerator<StreamChunk>,
  ): Promise<{ scenes: ScriptScene[]; summary: string; continuityNotes: string; rawOutput: string }> {
    const chunk = session.chunks[chunkIndex];
    if (!chunk) {
      throw new BadRequestException(`Chunk ${chunkIndex} does not exist`);
    }
    const futureHints = session.chunks
      .slice(chunkIndex + 1, chunkIndex + 3)
      .map((item) => item.summary ? `后续块 ${item.index + 1}: ${item.summary}` : "")
      .filter(Boolean)
      .join("\n");
    const raw = await this.collectText(
      "You are a screenplay development assistant. Always return strict JSON.",
      [
        "把当前小说分块改编成短剧剧本场景。",
        'Return JSON: { "scenes": [{ "id": "scene-N", "heading": "...", "synopsis": "...", "characters": ["name"], "dialogue": [{ "speaker": "...", "line": "..." }], "directorNote": "..." }], "summary": "2-3 sentence summary", "continuityNotes": "notes for following chunks" }',
        `\n改编计划：\n${session.adaptationPlan ?? ""}`,
        `\n世界观：\n${this.formatWorldBibleContext(session.worldBible)}`,
        previousSummary ? `\n上一块摘要：\n${previousSummary}` : "",
        futureHints ? `\n后续参考：\n${futureHints}` : "",
        `\n当前分块：\n${chunk.text}`,
      ].filter(Boolean).join("\n"),
      config,
      streamLlm,
    );
    const parsed = this.parseStrictJson<{ scenes?: unknown[]; summary?: unknown; continuityNotes?: unknown }>(raw);
    return {
      scenes: (parsed.scenes ?? []).map((scene, index) => normalizeScriptScene(scene, index + chunkIndex * 100)),
      summary: typeof parsed.summary === "string" ? parsed.summary : "",
      continuityNotes: typeof parsed.continuityNotes === "string" ? parsed.continuityNotes : "",
      rawOutput: raw,
    };
  }

  private formatWorldBibleContext(worldBible?: WorldBibleContent) {
    if (!worldBible) return "";
    const characters = worldBible.characters.map((item) => `${item.name}: ${item.appearance}`).join("；");
    const locations = worldBible.locations.map((item) => `${item.name}: ${item.description}`).join("；");
    return [`角色：${characters}`, `场景：${locations}`, worldBible.styleGuide?.visualStyle ? `风格：${worldBible.styleGuide.visualStyle}` : ""]
      .filter(Boolean)
      .join("\n");
  }

  // ===== Chunk generation loop =====

  private async generateChunksFrom(
    sessionId: string,
    startIndex: number,
    config: LlmProviderConfig,
    streamLlm: (systemPrompt: string, messages: Array<{ role: string; content: string }>, config?: LlmProviderConfig) => AsyncGenerator<StreamChunk>,
    includeFollowing: boolean,
  ) {
    let session = await this.database.query((db) => this.mustFindSession(db, sessionId));
    let previousSummary = startIndex > 0 ? session.chunks[startIndex - 1]?.summary ?? "" : "";
    const endExclusive = includeFollowing ? session.chunks.length : Math.min(startIndex + 1, session.chunks.length);

    for (let index = startIndex; index < endExclusive; index++) {
      await this.assertNotCancelled(sessionId);
      session = await this.updateSession(sessionId, (live) => {
        live.status = "running";
        live.stage = "script";
        live.progress = Math.min(95, 45 + Math.round((index / Math.max(1, live.chunks.length)) * 50));
        const chunk = live.chunks[index];
        if (chunk) {
          chunk.status = "running";
          chunk.error = undefined;
          chunk.startedAt = new Date().toISOString();
        }
      });

      try {
        const result = await this.generateChunkScenesForSession(session, index, previousSummary, config, streamLlm);
        previousSummary = result.summary;
        session = await this.updateSession(sessionId, (live) => {
          const chunk = live.chunks[index]!;
          chunk.status = "completed";
          chunk.scenes = result.scenes;
          chunk.summary = result.summary;
          chunk.continuityNotes = result.continuityNotes;
          chunk.rawOutput = result.rawOutput;
          chunk.error = undefined;
          chunk.completedAt = new Date().toISOString();
          live.scriptPreview = this.buildPreview(live);
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unknown error";
        await this.updateSession(sessionId, (live) => {
          const chunk = live.chunks[index];
          if (chunk) {
            chunk.status = "failed";
            chunk.error = message;
            chunk.completedAt = new Date().toISOString();
          }
          live.status = "failed";
          live.error = message;
        });
        throw error;
      }
    }

    return this.database.query((db) => this.mustFindSession(db, sessionId));
  }

  private buildPreview(session: NovelImportSession): ScriptContent {
    const characters = (session.worldBible?.characters ?? []).map((character) => ({
      name: character.name,
      profile: character.summary || character.appearance || character.personality || "",
      worldBibleCharId: character.id,
    }));
    return normalizeScriptContent({
      logline: session.synopsis?.split(/\r?\n/).find((line) => line.trim()) ?? "",
      premise: session.adaptationPlan ?? "",
      characters,
      scenes: session.chunks.flatMap((chunk) => chunk.scenes),
    });
  }

  chunkSourceText(text: string): NovelImportChunkRecord[] {
    const normalized = text.replace(/\r\n/g, "\n").trim();
    const chapterPattern = /^(第[零一二三四五六七八九十百千万\d]+[章回节][^\n]*|Chapter\s+\d+[^\n]*|CHAPTER\s+\d+[^\n]*)/gim;
    const matches = [...normalized.matchAll(chapterPattern)];
    if (matches.length >= 2) {
      return matches.map((match, index) => {
        const start = match.index ?? 0;
        const end = index + 1 < matches.length ? matches[index + 1]!.index! : normalized.length;
        const chunkText = normalized.slice(start, end).trim();
        return {
          index,
          title: match[1]?.trim(),
          text: chunkText,
          status: "pending" as const,
          scenes: [],
        };
      }).filter((chunk) => chunk.text)
        .map((chunk, correctedIndex) => ({ ...chunk, index: correctedIndex }));
    }

    const targetSize = 3000;
    const chunks: NovelImportChunkRecord[] = [];
    let pos = 0;
    while (pos < normalized.length) {
      let end = Math.min(pos + targetSize, normalized.length);
      if (end < normalized.length) {
        const nextBreak = normalized.indexOf("\n\n", end);
        if (nextBreak !== -1 && nextBreak < end + 600) {
          end = nextBreak + 2;
        }
      }
      const chunkText = normalized.slice(pos, end).trim();
      if (chunkText) {
        chunks.push({
          index: chunks.length,
          text: chunkText,
          status: "pending" as const,
          scenes: [],
        });
      }
      pos = end;
    }
    return chunks;
  }

  private async assertProjectReadable(userId: string, projectId: string) {
    const allowed = await this.database.query((db) => {
      const project = db.projects.find((item) => item.id === projectId);
      if (!project) return false;
      return db.projectMembers.some((member) => member.projectId === projectId && member.userId === userId);
    });
    if (!allowed) {
      throw new ForbiddenException("You do not have permission to access this project");
    }
  }

  private async assertProjectEditable(userId: string, projectId: string) {
    const allowed = await this.database.query((db) => {
      const project = db.projects.find((item) => item.id === projectId);
      if (!project) return false;
      const member = db.projectMembers.find((item) => item.projectId === projectId && item.userId === userId);
      return Boolean(member && member.role !== "viewer");
    });
    if (!allowed) {
      throw new ForbiddenException("You do not have permission to edit this project");
    }
  }

  chunkText(text: string): string[] {
    const chapterPattern = /^(?:第[零一二三四五六七八九十百千万\d]+[章回节]|Chapter\s+\d+|CHAPTER\s+\d+)/gm;
    const matches = [...text.matchAll(chapterPattern)];

    if (matches.length >= 2) {
      const chunks: string[] = [];
      for (let i = 0; i < matches.length; i++) {
        const start = matches[i].index!;
        const end = i + 1 < matches.length ? matches[i + 1].index! : text.length;
        chunks.push(text.slice(start, end).trim());
      }
      return chunks.filter((c) => c.length > 0);
    }

    const targetSize = 3000;
    const chunks: string[] = [];
    let pos = 0;
    while (pos < text.length) {
      let end = Math.min(pos + targetSize, text.length);
      if (end < text.length) {
        const nextNewline = text.indexOf("\n", end);
        if (nextNewline !== -1 && nextNewline < end + 500) {
          end = nextNewline + 1;
        }
      }
      const chunk = text.slice(pos, end).trim();
      if (chunk.length > 0) chunks.push(chunk);
      pos = end;
    }
    return chunks;
  }

  async *streamNovelImport(
    userId: string,
    projectId: string,
    input: NovelImportInput,
    workspaceService: any,
    resolveLlmConfig: (userId: string, projectId: string, source?: LlmConfigSource) => Promise<LlmProviderConfig>,
    streamLlm: (systemPrompt: string, messages: Array<{ role: string; content: string }>, config?: LlmProviderConfig) => AsyncGenerator<StreamChunk>,
    shouldAbort: () => boolean = () => false,
  ): AsyncGenerator<NovelImportEvent> {
    const chunks = this.chunkText(input.text);
    if (chunks.length === 0) {
      yield { type: "error", error: "文本为空或无法分块" };
      return;
    }
    yield { type: "progress", phase: "chunking", totalChunks: chunks.length };

    try {
      const config = await resolveLlmConfig(userId, projectId, input.llmConfigSource);

      // Phase 2a: World bible extraction (use first 3 chunks for extraction input)
      const wbChunks = chunks.slice(0, Math.min(chunks.length, 3)).join("\n\n");

      yield { type: "progress", phase: "worldBible", message: "提取角色与场景..." };
      const worldBible = await this.extractWorldBible(wbChunks, config, streamLlm);
      yield { type: "worldBible", content: worldBible };

      // Build world bible context string — used for ALL chunks
      const hasWb = worldBible.characters.length > 0 || worldBible.locations.length > 0;
      const wbContext = hasWb ? [
        "## 项目世界观",
        worldBible.characters.length > 0 ? `角色：${worldBible.characters.map((c) => `${c.name}（${c.appearance}）`).join("；")}` : "",
        worldBible.locations.length > 0 ? `场景：${worldBible.locations.map((l) => `${l.name}（${l.description}）`).join("；")}` : "",
      ].filter(Boolean).join("\n") : "";

      // Phase 2b: Synopsis
      if (shouldAbort()) { yield { type: "error", error: "导入已取消" }; return; }
      yield { type: "progress", phase: "worldBible", message: "生成大纲..." };
      const synopsis = await this.generateSynopsis(wbChunks, worldBible, config, streamLlm);
      yield { type: "synopsis", content: synopsis };

      // Phase 3: Script generation chunk by chunk
      const allScenes: ScriptScene[] = [];
      let prevSummary = "";

      for (let i = 0; i < chunks.length; i++) {
        if (shouldAbort()) {
          yield { type: "error", error: "导入已取消" };
          return;
        }

        yield { type: "progress", phase: "script", chunkIndex: i, totalChunks: chunks.length };

        const result = await this.generateChunkScenes(chunks[i], wbContext, prevSummary, config, streamLlm);
        allScenes.push(...result.scenes);
        prevSummary = result.summary;
        yield { type: "scenes", chunkIndex: i, scenes: result.scenes };
      }

      // Save documents
      const wbDoc = await workspaceService.ensureDocumentForProject({
        projectId, type: "world_bible", title: "AI 世界观", createdBy: userId,
      });
      await workspaceService.createVersionForDocument({
        documentId: wbDoc.id, title: "从小说提取的世界观", content: worldBible,
        metadata: { sourceJobType: "novel_import" }, createdBy: userId, status: "approved",
      });

      const synopsisDoc = await workspaceService.ensureDocumentForProject({
        projectId, type: "synopsis", title: "AI 大纲", createdBy: userId,
      });
      await workspaceService.createVersionForDocument({
        documentId: synopsisDoc.id, title: "从小说生成的大纲", content: synopsis,
        metadata: { sourceJobType: "novel_import" }, createdBy: userId, status: "approved",
      });

      const scriptContent = {
        logline: "",
        premise: "",
        characters: worldBible.characters.map((c) => ({ name: c.name, profile: c.appearance })),
        scenes: allScenes,
      };
      const scriptDoc = await workspaceService.ensureDocumentForProject({
        projectId, type: "script", title: "AI 剧本", createdBy: userId,
      });
      await workspaceService.createVersionForDocument({
        documentId: scriptDoc.id, title: "从小说生成的剧本", content: scriptContent,
        metadata: { sourceJobType: "novel_import" }, createdBy: userId, status: "approved",
      });

      yield {
        type: "done",
        worldBibleDocId: wbDoc.id,
        synopsisDocId: synopsisDoc.id,
        scriptDocId: scriptDoc.id,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      yield { type: "error", error: message };
    }
  }

  private async extractWorldBible(
    text: string,
    config: LlmProviderConfig,
    streamLlm: (system: string, messages: Array<{ role: string; content: string }>, cfg?: LlmProviderConfig) => AsyncGenerator<StreamChunk>,
  ): Promise<WorldBibleContent> {
    const system = "You are a story analyst. Always return strict JSON.";
    const user = [
      "Analyze the following text and extract a world bible.",
      'Return JSON with this shape: { "characters": [{ "id": "char-N", "name": "...", "appearance": "...", "personality": "...", "tags": [], "referenceImages": [], "sortOrder": N }], "locations": [{ "id": "loc-N", "name": "...", "description": "...", "referenceImages": [], "sortOrder": N }], "styleGuide": { "visualStyle": "..." } }',
      "Extract ALL named characters with their physical appearance and personality.",
      "Extract ALL named locations with descriptions.",
      "Infer the overall visual style.",
      "If a field is unknown, use an empty string.",
      `\n\nText:\n${text}`,
    ].join("\n");

    let full = "";
    for await (const chunk of streamLlm(system, [{ role: "user", content: user }], config)) {
      if (chunk.type === "chunk" && chunk.content) full += chunk.content;
    }
    try {
      const parsed = JSON.parse(full);
      return {
        characters: Array.isArray(parsed.characters) ? parsed.characters : [],
        locations: Array.isArray(parsed.locations) ? parsed.locations : [],
        styleGuide: parsed.styleGuide ?? undefined,
      };
    } catch {
      return { characters: [], locations: [] };
    }
  }

  private async generateSynopsis(
    text: string,
    worldBible: WorldBibleContent,
    config: LlmProviderConfig,
    streamLlm: (system: string, messages: Array<{ role: string; content: string }>, cfg?: LlmProviderConfig) => AsyncGenerator<StreamChunk>,
  ): Promise<string> {
    const system = "You are a screenplay development assistant. Generate detailed synopses for short dramas.";
    const user = [
      "Based on the following text and world bible, generate a structured synopsis.",
      "Include: story overview, character introductions, and a beat-by-beat outline.",
      "Write in Chinese.",
      `\n\n## 世界观`,
      worldBible.characters.length > 0 ? `角色：${worldBible.characters.map((c) => c.name).join("、")}` : "",
      worldBible.locations.length > 0 ? `场景：${worldBible.locations.map((l) => l.name).join("、")}` : "",
      `\n\n## 原文片段\n${text.slice(0, 8000)}`,
    ].filter(Boolean).join("\n");

    let full = "";
    for await (const chunk of streamLlm(system, [{ role: "user", content: user }], config)) {
      if (chunk.type === "chunk" && chunk.content) full += chunk.content;
    }
    return full;
  }

  private async generateChunkScenes(
    chunk: string,
    worldBibleContext: string,
    prevSummary: string,
    config: LlmProviderConfig,
    streamLlm: (system: string, messages: Array<{ role: string; content: string }>, cfg?: LlmProviderConfig) => AsyncGenerator<StreamChunk>,
  ): Promise<{ scenes: ScriptScene[]; summary: string }> {
    const system = "You are a screenplay development assistant. Always return strict JSON.";
    const user = [
      "Convert the following text into screenplay scenes.",
      'Return JSON: { "scenes": [{ "id": "scene-N", "heading": "...", "synopsis": "...", "characters": ["name"], "dialogue": [{ "speaker": "...", "line": "..." }], "directorNote": "..." }], "summary": "2-3 sentence summary of what happened" }',
      "Each scene should have a unique id like scene-1, scene-2.",
      "Extract dialogue as speaker/line pairs.",
      worldBibleContext,
      prevSummary ? `\nPrevious context: ${prevSummary}` : "",
      `\n\nText:\n${chunk}`,
    ].filter(Boolean).join("\n");

    let full = "";
    for await (const ch of streamLlm(system, [{ role: "user", content: user }], config)) {
      if (ch.type === "chunk" && ch.content) full += ch.content;
    }
    try {
      const parsed = JSON.parse(full);
      return {
        scenes: Array.isArray(parsed.scenes) ? parsed.scenes : [],
        summary: typeof parsed.summary === "string" ? parsed.summary : "",
      };
    } catch {
      return { scenes: [], summary: "" };
    }
  }
}
