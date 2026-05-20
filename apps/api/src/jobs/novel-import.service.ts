import { Injectable, Logger } from "@nestjs/common";
import type {
  LlmConfigSource,
  LlmProviderConfig,
  ScriptScene,
  WorldBibleContent,
} from "@dramaflow/shared";
import type { StreamChunk } from "./text-generation.provider";

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

@Injectable()
export class NovelImportService {
  private readonly logger = new Logger(NovelImportService.name);

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
