/**
 * @fileoverview AI 任务控制器
 * @module api/jobs
 *
 * 提供 AI 生成任务创建、SSE 流式生成、任务管理、批量操作、
 * TTS、导出等 REST 端点。
 */

import {
  Body,
  Controller,
  Get,
  Inject,
  Param,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from "@nestjs/common";
import type { Request, Response } from "express";
import type {
  CreateImageJobPayload,
  CreateNovelImportSessionPayload,
  CreateScriptJobPayload,
  CreateStoryboardJobPayload,
  CreateSynopsisJobPayload,
  ConversationGeneratePayload,
  ConversationMessagePayload,
  EnhanceReferencePromptRequest,
  ImageConfigSource,
  JobStatus,
  JobType,
  LlmConfigSource,
  WorldBibleReferenceImageGenerateRequest,
} from "@dramaflow/shared";

import { AuthGuard } from "../common/auth.guard";
import { CurrentUser } from "../common/current-user.decorator";
import { JobsService } from "./jobs.service";
import { PromptBuilderService } from "./prompt-builder.service";
import { ExportService } from "./export.service";
import { ConversationService } from "./conversation.service";
import { NovelImportService } from "./novel-import.service";
import { OpenAiCompatTextProvider } from "./text-generation.provider";
import { WorkspaceService } from "../workspace/workspace.service";

/** AI 任务控制器，处理生成任务、流式响应、批量操作等 */
@Controller()
@UseGuards(AuthGuard)
export class JobsController {
  constructor(
    @Inject(JobsService) private readonly jobsService: JobsService,
    @Inject(PromptBuilderService) private readonly promptBuilder: PromptBuilderService,
    @Inject(ExportService) private readonly exportService: ExportService,
    @Inject(ConversationService) private readonly conversationService: ConversationService,
    @Inject(NovelImportService) private readonly novelImportService: NovelImportService,
    @Inject(OpenAiCompatTextProvider) private readonly textProvider: OpenAiCompatTextProvider,
    @Inject(WorkspaceService) private readonly workspaceService: WorkspaceService,
  ) {}

  @Post("projects/:id/script-jobs")
  createScriptJob(
    @CurrentUser() user: { id: string },
    @Param("id") projectId: string,
    @Body() body: CreateScriptJobPayload,
  ) {
    return this.jobsService.createScriptJob(user.id, projectId, body);
  }

  @Post("projects/:id/storyboard-jobs")
  createStoryboardJob(
    @CurrentUser() user: { id: string },
    @Param("id") projectId: string,
    @Body() body: CreateStoryboardJobPayload,
  ) {
    return this.jobsService.createStoryboardJob(user.id, projectId, body);
  }

  @Post("shots/:id/image-jobs")
  createImageJob(
    @CurrentUser() user: { id: string },
    @Param("id") shotId: string,
    @Body() body: CreateImageJobPayload,
  ) {
    return this.jobsService.createImageJob(user.id, shotId, body);
  }

  @Post("projects/:projectId/world-bible/enhance-reference-prompt")
  enhanceReferencePrompt(
    @CurrentUser() user: { id: string },
    @Param("projectId") projectId: string,
    @Body() body: EnhanceReferencePromptRequest,
  ) {
    return this.jobsService.enhanceReferencePrompt(
      user.id, projectId, body.prompt, body.type,
      body.configSource ?? "team",
    );
  }

  @Post("projects/:projectId/world-bible/characters/:characterId/generate-reference-image")
  generateCharacterRefImage(
    @CurrentUser() user: { id: string },
    @Param("projectId") projectId: string,
    @Param("characterId") characterId: string,
    @Body() body: WorldBibleReferenceImageGenerateRequest,
  ) {
    return this.jobsService.generateCharacterReferenceImage(
      user.id,
      projectId,
      characterId,
      body.prompt,
      body.configSource ?? "team",
      body.providerId,
      body.referenceImageAssetId,
      body.negativePrompt,
    );
  }

  @Post("projects/:projectId/world-bible/locations/:locationId/generate-reference-image")
  generateLocationRefImage(
    @CurrentUser() user: { id: string },
    @Param("projectId") projectId: string,
    @Param("locationId") locationId: string,
    @Body() body: WorldBibleReferenceImageGenerateRequest,
  ) {
    return this.jobsService.generateLocationReferenceImage(
      user.id,
      projectId,
      locationId,
      body.prompt,
      body.configSource ?? "team",
      body.providerId,
      body.referenceImageAssetId,
      body.negativePrompt,
    );
  }

  @Post("projects/:projectId/world-bible/style-guide/generate-reference-image")
  generateStyleGuideRefImage(
    @CurrentUser() user: { id: string },
    @Param("projectId") projectId: string,
    @Body() body: WorldBibleReferenceImageGenerateRequest,
  ) {
    return this.jobsService.generateStyleGuideReferenceImage(
      user.id,
      projectId,
      body.prompt,
      body.configSource ?? "team",
      body.providerId,
      body.referenceImageAssetId,
      body.negativePrompt,
    );
  }

  @Post("shots/:id/video-jobs")
  createVideoJob(
    @CurrentUser() user: { id: string },
    @Param("id") shotId: string,
    @Body() body: { projectId: string; style: string; aspectRatio: string; prompt?: string; durationSeconds?: number; referenceImageAssetId?: string; configSource?: ImageConfigSource; providerId?: string },
  ) {
    return this.jobsService.createVideoJob(user.id, shotId, body);
  }

  @Post("projects/:id/synopsis-jobs")
  createSynopsisJob(
    @CurrentUser() user: { id: string },
    @Param("id") projectId: string,
    @Body() body: CreateSynopsisJobPayload,
  ) {
    return this.jobsService.createSynopsisJob(user.id, projectId, body);
  }

  @Post("projects/:id/rewrite-jobs")
  createRewriteJob(
    @CurrentUser() user: { id: string },
    @Param("id") projectId: string,
    @Body() body: { originalText: string; instruction: string; context?: string; documentId: string },
  ) {
    return this.jobsService.createRewriteJob(user.id, projectId, body);
  }

  // ===== SSE 流式生成端点 =====

  @Post("projects/:id/script-jobs/stream")
  async streamScriptJob(
    @CurrentUser() user: { id: string },
    @Param("id") projectId: string,
    @Body() body: CreateScriptJobPayload,
    @Res() res: Response,
  ) {
    const { llmConfigSource, ...input } = body;
    this.initSseResponse(res);
    for await (const chunk of this.jobsService.streamScriptJob(user.id, projectId, input, llmConfigSource)) {
      this.writeSseEvent(res, chunk);
    }
    this.endSseResponse(res);
  }

  @Post("projects/:id/synopsis-jobs/stream")
  async streamSynopsisJob(
    @CurrentUser() user: { id: string },
    @Param("id") projectId: string,
    @Body() body: CreateSynopsisJobPayload,
    @Res() res: Response,
  ) {
    const { llmConfigSource, ...input } = body;
    this.initSseResponse(res);
    for await (const chunk of this.jobsService.streamSynopsisJob(user.id, projectId, input, llmConfigSource)) {
      this.writeSseEvent(res, chunk);
    }
    this.endSseResponse(res);
  }

  @Post("projects/:id/storyboard-jobs/stream")
  async streamStoryboardJob(
    @CurrentUser() user: { id: string },
    @Param("id") projectId: string,
    @Body() body: CreateStoryboardJobPayload,
    @Res() res: Response,
  ) {
    const { llmConfigSource, ...input } = body;
    this.initSseResponse(res);
    for await (const chunk of this.jobsService.streamStoryboardJob(user.id, projectId, input, llmConfigSource)) {
      this.writeSseEvent(res, chunk);
    }
    this.endSseResponse(res);
  }

  @Post("projects/:id/novel-import-sessions")
  async createNovelImportSession(
    @CurrentUser() user: { id: string },
    @Param("id") projectId: string,
    @Body() body: CreateNovelImportSessionPayload,
  ) {
    const session = await this.novelImportService.createSession(user.id, projectId, body);
    return { session };
  }

  @Get("projects/:id/novel-import-sessions/latest")
  async getLatestNovelImportSession(
    @CurrentUser() user: { id: string },
    @Param("id") projectId: string,
  ) {
    const session = await this.novelImportService.getLatestSession(user.id, projectId);
    return { session };
  }

  @Get("novel-import-sessions/:id")
  async getNovelImportSession(
    @CurrentUser() user: { id: string },
    @Param("id") sessionId: string,
  ) {
    const session = await this.novelImportService.getSession(user.id, sessionId);
    return { session };
  }

  @Post("projects/:id/novel-import/stream")
  async streamNovelImport(
    @CurrentUser() user: { id: string },
    @Param("id") projectId: string,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    const body = req.body as { text: string; llmConfigSource?: LlmConfigSource };
    if (!body?.text?.trim()) {
      res.status(400).json({ message: "文本不能为空" });
      return;
    }

    let aborted = false;
    const closeHandler = () => { aborted = true; };
    req.on("close", closeHandler);

    const { llmConfigSource, ...input } = body;
    this.initSseResponse(res);
    for await (const event of this.novelImportService.streamNovelImport(
      user.id,
      projectId,
      input,
      this.workspaceService,
      (uid: string, pid: string, src?: LlmConfigSource) => this.jobsService.resolveTextLlmConfig(uid, pid, src).then((c) => c!),
      (sys: string, msgs: Array<{ role: string; content: string }>, cfg?: any) => this.textProvider.streamChat(sys, msgs, cfg),
      () => aborted,
    )) {
      if (aborted) break;
      this.writeSseEvent(res, event);
    }
    req.off("close", closeHandler);
    if (!aborted) {
      this.endSseResponse(res);
    } else if (!res.writableEnded) {
      res.end();
    }
  }

  @Post("projects/:id/rewrite-jobs/stream")
  async streamRewriteJob(
    @CurrentUser() user: { id: string },
    @Param("id") projectId: string,
    @Body() body: { originalText: string; instruction: string; context?: string; documentId: string },
    @Res() res: Response,
  ) {
    this.initSseResponse(res);
    for await (const chunk of this.jobsService.streamRewriteJob(user.id, projectId, body)) {
      this.writeSseEvent(res, chunk);
    }
    this.endSseResponse(res);
  }

  /** 初始化 SSE 响应头 */
  private initSseResponse(res: Response) {
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    res.flushHeaders();
  }

  /** 写入单条 SSE 事件 */
  private writeSseEvent(res: Response, data: unknown) {
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  }

  /** 结束 SSE 响应 */
  private endSseResponse(res: Response) {
    res.write("data: [DONE]\n\n");
    res.end();
  }

  @Get("jobs/:id")
  getJob(@CurrentUser() user: { id: string }, @Param("id") jobId: string) {
    return this.jobsService.getJob(user.id, jobId);
  }

  @Post("shots/:id/preview-prompt")
  previewPrompt(
    @CurrentUser() user: { id: string },
    @Param("id") shotId: string,
    @Body() body: { projectId: string },
  ) {
    return this.promptBuilder.previewPrompt(body.projectId, shotId);
  }

  @Post("shots/:id/preview-video-prompt")
  previewVideoPrompt(
    @CurrentUser() user: { id: string },
    @Param("id") shotId: string,
    @Body() body: { projectId: string },
  ) {
    return this.promptBuilder.previewVideoPrompt(body.projectId, shotId);
  }

  // ===== 任务管理 =====

  @Get("projects/:id/jobs")
  listProjectJobs(
    @CurrentUser() user: { id: string },
    @Param("id") projectId: string,
    @Query("status") status?: JobStatus,
    @Query("type") type?: JobType,
    @Query("batchId") batchId?: string,
    @Query("limit") limit?: string,
    @Query("offset") offset?: string,
  ) {
    return this.jobsService.listProjectJobs(user.id, projectId, {
      status,
      type,
      batchId,
      limit: limit ? parseInt(limit, 10) : undefined,
      offset: offset ? parseInt(offset, 10) : undefined,
    });
  }

  @Post("jobs/:id/cancel")
  cancelJob(@CurrentUser() user: { id: string }, @Param("id") jobId: string) {
    return this.jobsService.cancelJob(user.id, jobId);
  }

  @Post("jobs/:id/retry")
  retryJob(@CurrentUser() user: { id: string }, @Param("id") jobId: string) {
    return this.jobsService.retryJob(user.id, jobId);
  }

  @Post("projects/:id/batch-image-jobs")
  createBatchImageJobs(
    @CurrentUser() user: { id: string },
    @Param("id") projectId: string,
    @Body() body: { shotIds: string[]; configSource?: string; providerId?: string },
  ) {
    return this.jobsService.createBatchImageJobs(user.id, projectId, body.shotIds, body.configSource as any, body.providerId);
  }

  @Post("projects/:id/batch-video-jobs")
  createBatchVideoJobs(
    @CurrentUser() user: { id: string },
    @Param("id") projectId: string,
    @Body() body: { shotIds: string[]; configSource?: string; providerId?: string },
  ) {
    return this.jobsService.createBatchVideoJobs(user.id, projectId, body.shotIds, body.configSource as any, body.providerId);
  }

  @Get("batch-jobs/:batchId")
  getBatchStatus(
    @CurrentUser() user: { id: string },
    @Param("batchId") batchId: string,
  ) {
    return this.jobsService.getBatchStatus(user.id, batchId);
  }

  // ===== TTS =====

  @Get("tts/voices")
  listVoices() {
    return this.jobsService.listTTSVoices();
  }

  @Post("shots/:id/tts-jobs")
  createTTSJob(
    @CurrentUser() user: { id: string },
    @Param("id") shotId: string,
    @Body() body: { projectId: string; characterId: string; text: string; configSource?: ImageConfigSource },
  ) {
    return this.jobsService.createTTSJob(user.id, shotId, body);
  }

  @Post("shots/:id/regenerate-jobs")
  createShotRegenerateJob(
    @CurrentUser() user: { id: string },
    @Param("id") shotId: string,
    @Body() body: { projectId: string; fields: string[]; llmConfigSource?: LlmConfigSource },
  ) {
    return this.jobsService.createShotRegenerateJob(user.id, shotId, body);
  }

  @Post("scenes/:id/batch-tts-jobs")
  createSceneBatchTTSJobs(
    @CurrentUser() user: { id: string },
    @Param("id") sceneId: string,
    @Body() body: { projectId: string; shotIds?: string[] },
  ) {
    return this.jobsService.createSceneBatchTTSJobs(user.id, sceneId, body);
  }

  // ===== Export =====

  @Get("export/capabilities")
  async getExportCapabilities() {
    const ffmpegAvailable = await this.exportService.checkFfmpegAvailable();
    return { ffmpegAvailable };
  }

  @Post("projects/:id/export-jobs")
  createExportJob(
    @CurrentUser() user: { id: string },
    @Param("id") projectId: string,
    @Body() body: { resolution: string; fps: number; bitrate?: string; format: import("@dramaflow/shared").ExportFormat; allowMockFallback?: boolean },
  ) {
    return this.jobsService.createExportJob(user.id, projectId, body);
  }

  // ===== 对话式生成 =====

  @Post("projects/:id/conversation-jobs/message")
  async streamConversationMessage(
    @CurrentUser() user: { id: string },
    @Param("id") projectId: string,
    @Body() body: ConversationMessagePayload,
    @Res() res: Response,
  ) {
    const { llmConfigSource, ...rest } = body;

    const session = await this.conversationService.getOrCreateSession(
      user.id, projectId, body.sessionId, body.targetDocType,
    );

    // First message — send AI greeting
    if (session.messages.length === 0 && !body.content.trim()) {
      const greeting = this.conversationService.buildInitialMessage();
      await this.conversationService.appendMessage(session.id, greeting);
      this.initSseResponse(res);
      this.writeSseEvent(res, {
        sessionId: session.id,
        message: greeting,
        brief: session.brief,
        dimensionStatus: session.dimensionStatus,
      });
      this.endSseResponse(res);
      return;
    }

    // Append user message
    const userMessage = { role: "user" as const, content: body.content };
    await this.conversationService.appendMessage(session.id, userMessage);

    // Resolve LLM config
    const config = await this.conversationService.resolveTextLlmConfig(
      user.id, projectId, llmConfigSource as LlmConfigSource | undefined,
    );

    // Get world bible
    const worldBible = await this.getWorldBible(user.id, projectId);

    this.initSseResponse(res);

    let accumulated = "";
    for await (const chunk of this.conversationService.streamQaResponse(session, config, worldBible)) {
      if (chunk.type === "chunk" && chunk.content) {
        accumulated += chunk.content;
      }
      this.writeSseEvent(res, chunk);
    }

    // Parse AI response to extract brief updates
    const parsed = this.parseQaResponse(accumulated);
    if (parsed) {
      const newStatus = { ...session.dimensionStatus };

      // Update brief
      if (Object.keys(parsed.briefUpdates).length > 0) {
        await this.conversationService.updateSessionBrief(session.id, parsed.briefUpdates);
        for (const key of Object.keys(parsed.briefUpdates) as Array<keyof typeof parsed.briefUpdates>) {
          if (parsed.briefUpdates[key]?.trim() && newStatus[key as keyof typeof newStatus] === "pending") {
            newStatus[key as keyof typeof newStatus] = "confirmed";
          }
        }
        await this.conversationService.updateDimensionStatus(session.id, newStatus);
      }

      // Append AI message
      await this.conversationService.appendMessage(session.id, {
        role: "ai",
        content: parsed.reply || accumulated,
      });

      // Send final state update
      this.writeSseEvent(res, {
        sessionId: session.id,
        brief: { ...session.brief, ...parsed.briefUpdates },
        dimensionStatus: newStatus,
      });
    }

    this.endSseResponse(res);
  }

  @Post("projects/:id/conversation-jobs/generate")
  async streamConversationGenerate(
    @CurrentUser() user: { id: string },
    @Param("id") projectId: string,
    @Body() body: ConversationGeneratePayload,
    @Res() res: Response,
  ) {
    const session = await this.conversationService.getSession(user.id, body.sessionId);
    const config = await this.conversationService.resolveTextLlmConfig(
      user.id, projectId, body.llmConfigSource as LlmConfigSource | undefined,
    );
    const worldBible = await this.getWorldBible(user.id, projectId);

    this.initSseResponse(res);

    let accumulated = "";
    for await (const chunk of this.conversationService.streamGeneration(session, config, worldBible)) {
      if (chunk.type === "chunk" && chunk.content) {
        accumulated += chunk.content;
      }
      this.writeSseEvent(res, chunk);
    }

    // Save generated content as document version
    const { normalizeScriptContent, normalizeStoryboardContent } = await import("@dramaflow/shared");
    let content: unknown = accumulated;
    if (session.targetDocType === "script") {
      try {
        content = normalizeScriptContent(JSON.parse(accumulated));
      } catch { /* keep raw */ }
    }

    const docType = session.targetDocType === "script" ? "script" : "synopsis";
    const document = await this.workspaceService.ensureDocumentForProject({
      projectId,
      type: docType,
      title: `${session.brief.coreConflict ?? "未命名"} ${docType === "script" ? "剧本" : "大纲"}`,
      createdBy: user.id,
    });
    const version = await this.workspaceService.createVersionForDocument({
      documentId: document.id,
      title: `${session.brief.coreConflict ?? "未命名"} - 对话式${docType === "script" ? "剧本" : "大纲"}`,
      content,
      metadata: { source: "conversational", conversationSessionId: session.id },
      createdBy: user.id,
      status: "approved",
    });

    this.writeSseEvent(res, {
      type: "done",
      result: {
        documentId: document.id,
        versionId: version.id,
        content,
      },
    });

    this.endSseResponse(res);
  }

  @Get("projects/:id/conversation-jobs/:sessionId")
  async getConversationSession(
    @CurrentUser() user: { id: string },
    @Param("id") projectId: string,
    @Param("sessionId") sessionId: string,
  ) {
    return this.conversationService.getSession(user.id, sessionId);
  }

  @Post("projects/:id/conversation-jobs/:sessionId/delete")
  async deleteConversationSession(
    @CurrentUser() user: { id: string },
    @Param("id") projectId: string,
    @Param("sessionId") sessionId: string,
  ) {
    await this.conversationService.deleteSession(sessionId);
    return { ok: true };
  }

  private parseQaResponse(raw: string): { reply: string; briefUpdates: Record<string, string> } | null {
    try {
      const cleaned = raw.trim().replace(/^```(?:json)?\s*\n?/i, "").replace(/\n?```\s*$/i, "");
      const parsed = JSON.parse(cleaned);
      if (typeof parsed === "object" && parsed !== null) {
        return {
          reply: typeof parsed.reply === "string" ? parsed.reply : raw,
          briefUpdates: typeof parsed.briefUpdates === "object" && parsed.briefUpdates !== null
            ? Object.fromEntries(
                Object.entries(parsed.briefUpdates as Record<string, unknown>)
                  .filter(([, v]) => typeof v === "string" && v.trim())
                  .map(([k, v]) => [k, v as string]),
              )
            : {},
        };
      }
    } catch { /* not JSON, return null */ }
    return null;
  }

  private async getWorldBible(userId: string, projectId: string): Promise<import("@dramaflow/shared").WorldBibleContent | null> {
    try {
      return await this.workspaceService.getWorldBible(userId, projectId);
    } catch {
      return null;
    }
  }
}
