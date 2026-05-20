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
  ScriptScene,
  WorldBibleContent,
} from "@dramaflow/shared";
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
    _resolveLlmConfig: (userId: string, projectId: string, source?: LlmConfigSource) => Promise<LlmProviderConfig>,
    _streamLlm: (systemPrompt: string, messages: Array<{ role: string; content: string }>, config?: LlmProviderConfig) => AsyncGenerator<StreamChunk>,
  ): Promise<Record<string, unknown>> {
    const session = await this.database.mutate((db) => {
      const live = this.mustFindSession(db, job.input.sessionId);
      if (live.status === "cancelled") {
        throw new Error("Novel import session was cancelled");
      }
      live.status = "running";
      live.updatedAt = new Date().toISOString();
      return live;
    });
    return { sessionId: session.id, action: job.input.action };
  }

  private mustFindSession(db: { novelImportSessions: NovelImportSession[] }, sessionId: string) {
    const session = db.novelImportSessions.find((item) => item.id === sessionId);
    if (!session) {
      throw new NotFoundException("Novel import session not found");
    }
    return session;
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
