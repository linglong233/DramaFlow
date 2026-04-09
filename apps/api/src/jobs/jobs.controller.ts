import {
  Body,
  Controller,
  Get,
  Inject,
  Param,
  Post,
  Query,
  Res,
  UseGuards,
} from "@nestjs/common";
import type { Response } from "express";
import type {
  CreateImageJobPayload,
  CreateScriptJobPayload,
  CreateStoryboardJobPayload,
  CreateSynopsisJobPayload,
  JobStatus,
  JobType,
} from "@dramaflow/shared";

import { AuthGuard } from "../common/auth.guard";
import { CurrentUser } from "../common/current-user.decorator";
import { JobsService } from "./jobs.service";
import { PromptBuilderService } from "./prompt-builder.service";
import { ExportService } from "./export.service";

@Controller()
@UseGuards(AuthGuard)
export class JobsController {
  constructor(
    @Inject(JobsService) private readonly jobsService: JobsService,
    @Inject(PromptBuilderService) private readonly promptBuilder: PromptBuilderService,
    @Inject(ExportService) private readonly exportService: ExportService,
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

  @Post("shots/:id/video-jobs")
  createVideoJob(
    @CurrentUser() user: { id: string },
    @Param("id") shotId: string,
    @Body() body: { projectId: string; style: string; aspectRatio: string; prompt?: string; durationSeconds?: number; referenceImageAssetId?: string },
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

  // ===== SSE Streaming Endpoints =====

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

  private initSseResponse(res: Response) {
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    res.flushHeaders();
  }

  private writeSseEvent(res: Response, data: unknown) {
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  }

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

  // ===== Task Management =====

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
    @Body() body: { shotIds: string[] },
  ) {
    return this.jobsService.createBatchImageJobs(user.id, projectId, body.shotIds);
  }

  @Post("projects/:id/batch-video-jobs")
  createBatchVideoJobs(
    @CurrentUser() user: { id: string },
    @Param("id") projectId: string,
    @Body() body: { shotIds: string[] },
  ) {
    return this.jobsService.createBatchVideoJobs(user.id, projectId, body.shotIds);
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
    @Body() body: { projectId: string; characterId: string; text: string },
  ) {
    return this.jobsService.createTTSJob(user.id, shotId, body);
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
}