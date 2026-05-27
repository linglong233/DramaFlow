/**
 * @fileoverview AI 任务服务
 * @module api/jobs
 *
 * 管理所有 AI 生成任务的生命周期：入队、领取、执行、完成/失败。
 * 支持剧本、分镜、大纲、图片、视频、TTS、导出等任务类型，
 * 以及 SSE 流式生成和批量操作。
 */

import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import type {
  BatchJobGroupRecord,
  ComposeShotInput,
  ComposeShotResult,
  CreateImageJobPayload,
  ExportFormat,
  ExportTimelineInput,
  GenerateMediaInput,
  GenerateScriptInput,
  GenerateStoryboardInput,
  GenerateSynopsisInput,
  GenerateTTSInput,
  ImageConfigSource,
  ImageGenerationConfig,
  ImageGenerationProvider,
  JobRecord,
  LlmConfigSource,
  JobStatus,
  JobType,
  LlmProviderConfig,
  MediaContent,
  NovelImportJobInput,
  PromptPreviewResult,
  ProviderEntry,
  RewriteSegmentInput,
  ScriptContent,
  ShotMediaBinding,
  StoryboardContent,
  VersionRecord,
  WorldBibleReferenceImageGenerateResponse,
  WorldBibleContent,
  EnhanceReferencePromptResponse,
  DocumentType,
  VideoGenerationProvider,
  VideoReferenceMode,
} from "@dramaflow/shared";

import { PrismaService } from "../common/prisma.service";
import { Prisma } from "@prisma/client";
import { jsonOutput, jsonInput, optionalJsonInput, iso, optionalIso } from "../common/prisma-json";
import { createId } from "../common/id";
import { NotificationService } from "../notifications/notification.service";
import { RealtimeEventsService } from "../realtime/realtime.events.service";
import { StorageService } from "../storage/storage.service";
import { WorkspaceService } from "../workspace/workspace.service";
import { ImpactService } from "../workspace/impact.service";
import { GoogleGeminiImageProvider } from "./google-gemini-image.provider";
import { OpenAiMediaProvider } from "./media-generation.provider";
import { SdWebuiImageProvider } from "./sd-webui-image.provider";
import { ComfyuiImageProvider } from "./comfyui-image.provider";
import { GrokMediaProvider } from "./grok-media.provider";
import { PromptBuilderService } from "./prompt-builder.service";
import { OpenAiCompatTextProvider, StreamChunk } from "./text-generation.provider";
import { TTSProviderService } from "./tts.provider";
import { ExportService } from "./export.service";
import { NovelImportService } from "./novel-import.service";
import {
  applyResolvedVideoReferencesToInput,
  buildBatchVideoReferenceInput,
  buildResolvedVideoReferences,
  getVideoReferenceTransport,
  type ResolvedVideoReferenceImage,
  type ResolvedVideoReferences,
  type VideoReferenceProviderKey,
} from "./video-reference.utils";
import { buildVideoReferenceDataUrl } from "./video-reference-data-url";
import { getVideoProviderAdapter } from "./video-providers/registry";
import type { VideoProviderConfig, VideoProviderJobState } from "./video-providers/types";
import { createPromptSnapshot } from "./prompting/prompt-contracts";
import { augmentVideoPromptWithReferenceMode } from "./prompting/media-prompt-builder";
import { SCRIPT_GENERATION_CONTRACT, STORYBOARD_GENERATION_CONTRACT } from "./prompting/text-contracts";

export type { StreamChunk };

type MediaJobInput = Omit<GenerateMediaInput, "shotId"> & {
  projectId: string;
  shotId: string;
  prompt?: string;
  configSource?: ImageConfigSource;
};

type MediaJobRequest = Omit<MediaJobInput, "shotId">;

type TextJobInputBase = {
  llmConfigSource?: LlmConfigSource;
};

type ScriptJobInput = GenerateScriptInput & TextJobInputBase;

type SynopsisJobInput = GenerateSynopsisInput & TextJobInputBase;

type StoryboardJobInput = GenerateStoryboardInput & TextJobInputBase;

type RewriteJobInput = RewriteSegmentInput & TextJobInputBase;

interface GeneratedMediaResult extends MediaContent {
  inlineBody?: Buffer | Uint8Array | string;
  fileExtension?: string;
}

interface ResolvedShotCompositionInput {
  storyboardVersionId?: string;
  shotHash?: string;
  duration: number;
  subtitleText?: string;
  videoVersionId?: string;
  videoAssetUrl?: string;
  audioVersionId?: string;
  audioAssetUrl?: string;
}

interface VideoJobState extends Record<string, unknown> {
  prompt: string;
  provider: string;
  providerVideoId?: string;
  providerStatus?: string;
  progress?: number;
  parameters: Record<string, unknown>;
  mode?: "provider" | "mock";
  note?: string;
  assetUrl?: string;
  mimeType?: string;
}

interface ResolvedImageExecution {
  providerKind: "legacy-openai" | "google-gemini" | "openai-compatible" | "stable-diffusion" | "comfyui" | "grok";
  configSource?: ImageConfigSource;
  config?: ImageGenerationConfig;
  model?: string;
  referenceImage?: {
    assetId: string;
    body: Uint8Array;
    mimeType: string;
  };
}

@Injectable()
export class JobsService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(WorkspaceService) private readonly workspaceService: WorkspaceService,
    @Inject(StorageService) private readonly storageService: StorageService,
    @Inject(OpenAiCompatTextProvider) private readonly textProvider: OpenAiCompatTextProvider,
    @Inject(OpenAiMediaProvider) private readonly mediaProvider: OpenAiMediaProvider,
    @Inject(GoogleGeminiImageProvider) private readonly googleGeminiImageProvider: GoogleGeminiImageProvider,
    @Inject(SdWebuiImageProvider) private readonly sdWebuiProvider: SdWebuiImageProvider,
    @Inject(ComfyuiImageProvider) private readonly comfyuiProvider: ComfyuiImageProvider,
    @Inject(GrokMediaProvider) private readonly grokMediaProvider: GrokMediaProvider,
    @Inject(PromptBuilderService) private readonly promptBuilder: PromptBuilderService,
    @Inject(NotificationService) private readonly notificationService: NotificationService,
    @Inject(RealtimeEventsService) private readonly realtimeEvents: RealtimeEventsService,
    @Inject(TTSProviderService) private readonly ttsProvider: TTSProviderService,
    @Inject(ExportService) private readonly exportService: ExportService,
    @Inject(NovelImportService) private readonly novelImportService: NovelImportService,
    @Inject(ImpactService) private readonly impactService: ImpactService,
  ) {}

  private toJobRecord<TInput = Record<string, unknown>, TResult = Record<string, unknown>>(job: any): JobRecord<TInput, TResult> {
    return {
      id: job.id, type: job.type, status: job.status,
      projectId: job.projectId,
      documentId: job.documentId ?? undefined,
      shotId: job.shotId ?? undefined,
      input: jsonOutput<TInput>(job.input),
      result: job.result == null ? undefined : jsonOutput<TResult>(job.result),
      error: job.error ?? undefined,
      progress: job.progress ?? undefined,
      retryCount: job.retryCount ?? undefined,
      maxRetries: job.maxRetries ?? undefined,
      priority: job.priority ?? undefined,
      cancelledAt: optionalIso(job.cancelledAt),
      batchId: job.batchId ?? undefined,
      createdBy: job.createdBy,
      createdAt: iso(job.createdAt),
      updatedAt: iso(job.updatedAt),
    };
  }

  private async updateJobState(jobId: string, data: any): Promise<JobRecord> {
    const job = await this.prisma.job.update({
      where: { id: jobId },
      data: { ...data, updatedAt: new Date() },
    });
    const record = this.toJobRecord(job);
    this.emitJobUpdated(record);
    return record;
  }

  async createScriptJob(userId: string, projectId: string, input: ScriptJobInput) {
    await this.assertProjectReadable(userId, projectId);
    return this.enqueueJob(userId, {
      type: "script_generation",
      projectId,
      input,
    });
  }

  async createStoryboardJob(
    userId: string,
    projectId: string,
    input: StoryboardJobInput,
  ) {
    await this.assertProjectReadable(userId, projectId);
    return this.enqueueJob(userId, {
      type: "storyboard_generation",
      projectId,
      documentId: input.documentId,
      input,
    });
  }

  async createImageJob(userId: string, shotId: string, input: CreateImageJobPayload) {
    const payload: MediaJobInput = { ...input, shotId };
    await this.assertProjectReadable(userId, payload.projectId);
    return this.enqueueJob(userId, {
      type: "image_generation",
      projectId: payload.projectId,
      shotId,
      input: payload,
    });
  }

  async createVideoJob(userId: string, shotId: string, input: MediaJobRequest) {
    const payload: MediaJobInput = { ...input, shotId };
    await this.assertProjectReadable(userId, payload.projectId);
    return this.enqueueJob(userId, {
      type: "video_generation",
      projectId: payload.projectId,
      shotId,
      input: payload,
    });
  }

  async createSynopsisJob(
    userId: string,
    projectId: string,
    input: SynopsisJobInput,
  ) {
    await this.assertProjectReadable(userId, projectId);
    return this.enqueueJob(userId, {
      type: "synopsis_generation",
      projectId,
      input,
    });
  }

  async createRewriteJob(
    userId: string,
    projectId: string,
    input: RewriteJobInput,
  ) {
    await this.assertProjectReadable(userId, projectId);
    return this.enqueueJob(userId, {
      type: "rewrite_segment",
      projectId,
      documentId: input.documentId,
      input,
    });
  }

  async createShotRegenerateJob(
    userId: string,
    shotId: string,
    input: { projectId: string; fields: string[]; llmConfigSource?: LlmConfigSource },
  ) {
    await this.assertProjectReadable(userId, input.projectId);
    return this.enqueueJob(userId, {
      type: "shot_regenerate",
      projectId: input.projectId,
      shotId,
      input,
    });
  }

  async createNovelImportJob(
    userId: string,
    projectId: string,
    input: NovelImportJobInput,
  ) {
    await this.assertProjectReadable(userId, projectId);
    return this.enqueueJob(userId, {
      type: "novel_import",
      projectId,
      input,
    });
  }

  /** 创建影响建议生成任务 */
  async createImpactSuggestionJob(userId: string, issueId: string, instruction?: string) {
    const projectId = await this.impactService.getIssueProjectId(issueId);
    await this.workspaceService.assertProjectPermission(
      userId,
      projectId,
      "project.edit",
      "You do not have permission to create impact suggestion jobs",
    );
    const job = await this.impactService.createSuggestionJob(issueId, userId, instruction);
    this.emitJobUpdated(job);
    return job;
  }

  async getJob(userId: string, jobId: string) {
    const job = await this.prisma.job.findUnique({ where: { id: jobId } });
    if (!job) {
      throw new NotFoundException("Job not found");
    }
    await this.assertProjectReadable(userId, job.projectId);
    return this.toJobRecord(job);
  }

  async listProjectJobs(
    userId: string,
    projectId: string,
    options: { status?: JobStatus; type?: JobType; batchId?: string; limit?: number; offset?: number } = {},
  ): Promise<{ jobs: JobRecord[]; total: number }> {
    await this.assertProjectReadable(userId, projectId);

    const where: any = { projectId };
    if (options.status) where.status = options.status;
    if (options.type) where.type = options.type;
    if (options.batchId) where.batchId = options.batchId;

    const offset = options.offset ?? 0;
    const limit = options.limit ?? 50;

    const [rows, total] = await Promise.all([
      this.prisma.job.findMany({
        where,
        orderBy: { updatedAt: "desc" },
        skip: offset,
        take: limit,
      }),
      this.prisma.job.count({ where }),
    ]);

    return { jobs: rows.map((j) => this.toJobRecord(j)), total };
  }

  async cancelJob(userId: string, jobId: string): Promise<JobRecord> {
    const job = await this.prisma.job.findUnique({ where: { id: jobId } });
    if (!job) {
      throw new NotFoundException("Job not found");
    }
    await this.workspaceService.assertProjectPermission(
      userId,
      job.projectId,
      "job.manage",
      "You do not have permission to manage project jobs",
    );

    if (job.status !== "queued") {
      throw new BadRequestException("Only queued jobs can be cancelled");
    }

    const record = await this.updateJobState(jobId, {
      status: "failed",
      error: "Cancelled by user",
      cancelledAt: new Date(),
    });
    return record;
  }

  async retryJob(userId: string, jobId: string): Promise<JobRecord> {
    const job = await this.prisma.job.findUnique({ where: { id: jobId } });
    if (!job) {
      throw new NotFoundException("Job not found");
    }
    await this.workspaceService.assertProjectPermission(
      userId,
      job.projectId,
      "job.manage",
      "You do not have permission to manage project jobs",
    );

    if (job.status !== "failed") {
      throw new BadRequestException("Only failed jobs can be retried");
    }

    const maxRetries = job.maxRetries ?? 3;
    const retryCount = (job.retryCount ?? 0) + 1;
    if (retryCount > maxRetries) {
      throw new BadRequestException(`Maximum retry count (${maxRetries}) exceeded`);
    }

    const record = await this.updateJobState(jobId, {
      status: "queued",
      error: null,
      progress: null,
      retryCount,
      cancelledAt: null,
    });
    return record;
  }

  async createBatchImageJobs(
    userId: string,
    projectId: string,
    shotIds: string[],
    configSource?: ImageConfigSource,
    providerId?: string,
  ): Promise<BatchJobGroupRecord> {
    await this.workspaceService.assertProjectPermission(
      userId,
      projectId,
      "job.manage",
      "You do not have permission to manage project jobs",
    );

    const uniqueShotIds = Array.from(new Set(shotIds.filter(Boolean)));
    if (uniqueShotIds.length === 0) {
      throw new BadRequestException("At least one storyboard shot is required to create a batch image job");
    }

    const jobIds: string[] = [];
    for (const shotId of uniqueShotIds) {
      const job = await this.enqueueJob(userId, {
        type: "image_generation",
        projectId,
        shotId,
        input: { projectId, shotId, style: "cinematic", aspectRatio: "16:9", configSource, providerId },
      });
      if (job.batchId === undefined) {
        // Will set batchId after creating the batch group
        jobIds.push(job.id);
      }
    }

    const batchResult = await this.prisma.$transaction(async (tx) => {
      const batchId = createId("batch");
      const group: BatchJobGroupRecord = {
        id: batchId,
        projectId,
        jobIds,
        status: "running",
        createdBy: userId,
        createdAt: new Date().toISOString(),
      };

      await tx.batchJobGroup.create({
        data: {
          id: batchId,
          projectId,
          jobIds,
          status: "running",
          createdBy: userId,
        },
      });

      const updatedJobs: JobRecord[] = [];
      for (const jId of jobIds) {
        const updated = await tx.job.update({
          where: { id: jId },
          data: { batchId, priority: "normal", updatedAt: new Date() },
        });
        updatedJobs.push(this.toJobRecord(updated));
      }

      return { group, updatedJobs };
    });

    batchResult.updatedJobs.forEach((job) => this.emitJobUpdated(job));
    return batchResult.group;
  }

  /**
   * 查找分镜当前采用的图片资产 ID
   * 通过查找该分镜关联的 image 类型文档的当前版本获取 assetId
   */
  private async findCurrentImageAssetIdForShot(
    projectId: string,
    shotId: string,
  ): Promise<string | undefined> {
    const imageDoc = await this.prisma.document.findFirst({
      where: { projectId, type: "image", shotId },
    });
    const versionId = imageDoc?.currentVersionId;
    if (!versionId) return undefined;
    const version = await this.prisma.version.findUnique({ where: { id: versionId } });
    if (!version?.content || typeof version.content !== "object")
      return undefined;
    const content = jsonOutput<{ assetId?: unknown }>(version.content);
    return typeof content.assetId === "string" && content.assetId.trim()
      ? content.assetId
      : undefined;
  }

  async createBatchVideoJobs(
    userId: string,
    projectId: string,
    shotIds: string[],
    configSource?: ImageConfigSource,
    providerId?: string,
    videoReferenceMode: VideoReferenceMode = "single",
  ): Promise<BatchJobGroupRecord> {
    await this.workspaceService.assertProjectPermission(
      userId,
      projectId,
      "job.manage",
      "You do not have permission to manage project jobs",
    );

    const uniqueShotIds = Array.from(new Set(shotIds.filter(Boolean)));
    if (uniqueShotIds.length === 0) {
      throw new BadRequestException("At least one storyboard shot is required to create a batch video job");
    }

    // 查找每个分镜当前采用的图片资产，用于视频参考图推断
    const imageAssetByShot = new Map<string, string>();
    for (const sId of uniqueShotIds) {
      const assetId = await this.findCurrentImageAssetIdForShot(projectId, sId);
      if (assetId) imageAssetByShot.set(sId, assetId);
    }

    const jobIds: string[] = [];
    for (const shotId of uniqueShotIds) {
      const referenceImageAssetId = imageAssetByShot.get(shotId);
      const referenceInput = buildBatchVideoReferenceInput(referenceImageAssetId, videoReferenceMode);
      const job = await this.enqueueJob(userId, {
        type: "video_generation",
        projectId,
        shotId,
        input: {
          projectId,
          shotId,
          style: "cinematic",
          aspectRatio: "16:9",
          configSource,
          providerId,
          ...referenceInput,
        },
      });
      jobIds.push(job.id);
    }

    const batchResult = await this.prisma.$transaction(async (tx) => {
      const batchId = createId("batch");
      const group: BatchJobGroupRecord = {
        id: batchId,
        projectId,
        jobIds,
        status: "running",
        createdBy: userId,
        createdAt: new Date().toISOString(),
      };

      await tx.batchJobGroup.create({
        data: {
          id: batchId,
          projectId,
          jobIds,
          status: "running",
          createdBy: userId,
        },
      });

      const updatedJobs: JobRecord[] = [];
      for (const jId of jobIds) {
        const updated = await tx.job.update({
          where: { id: jId },
          data: { batchId, priority: "normal", updatedAt: new Date() },
        });
        updatedJobs.push(this.toJobRecord(updated));
      }

      return { group, updatedJobs };
    });

    batchResult.updatedJobs.forEach((job) => this.emitJobUpdated(job));
    return batchResult.group;
  }

  async getBatchStatus(userId: string, batchId: string) {
    const batch = await this.prisma.batchJobGroup.findUnique({ where: { id: batchId } });
    if (!batch) {
      throw new NotFoundException("Batch not found");
    }

    const jobs = await this.prisma.job.findMany({
      where: { id: { in: batch.jobIds } },
    });
    const completedCount = jobs.filter((j) => j.status === "completed").length;
    const failedCount = jobs.filter((j) => j.status === "failed").length;
    const runningCount = jobs.filter((j) => j.status === "running").length;
    const totalCount = batch.jobIds.length;

    let status: BatchJobGroupRecord["status"] = "running";
    if (completedCount + failedCount === totalCount) {
      status = failedCount > 0 ? "partial_failure" : "completed";
    }

    return {
      id: batch.id,
      projectId: batch.projectId,
      jobIds: batch.jobIds,
      status,
      createdAt: iso(batch.createdAt),
      totalCount,
      completedCount,
      failedCount,
      runningCount,
    };
  }

  async claimNextJob() {
    // Sort queued jobs by priority (high > normal > low), then by createdAt (oldest first)
    const rows = await this.prisma.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM "Job"
      WHERE status = 'queued'
      ORDER BY
        CASE COALESCE(priority, 'normal')
          WHEN 'high' THEN 0
          WHEN 'normal' THEN 1
          WHEN 'low' THEN 2
        END,
        "createdAt" ASC
      LIMIT 1
      FOR UPDATE SKIP LOCKED
    `;
    const queuedJobId = rows[0]?.id;
    if (queuedJobId) {
      const updated = await this.prisma.job.update({
        where: { id: queuedJobId },
        data: { status: "running", updatedAt: new Date() },
      });
      const record = this.toJobRecord(updated);
      this.emitJobUpdated(record);
      return record;
    }

    // Poll running video jobs
    const runningVideoJobs = await this.prisma.job.findMany({
      where: { type: "video_generation", status: "running" },
      orderBy: { updatedAt: "asc" },
      take: 20,
    });
    const pollable = runningVideoJobs.map((j) => this.toJobRecord(j)).find((j) => this.shouldPollVideoJob(j));
    if (!pollable) return null;

    const touched = await this.prisma.job.update({
      where: { id: pollable.id },
      data: { updatedAt: new Date() },
    });
    return this.toJobRecord(touched);
  }

  async processJob(jobId: string) {
    const rawJob = await this.prisma.job.findUnique({ where: { id: jobId } });
    if (!rawJob) {
      throw new NotFoundException("Job not found");
    }
    const job = this.toJobRecord(rawJob);

    try {
      switch (job.type) {
        case "script_generation":
          return await this.processScriptJob(job as unknown as JobRecord<ScriptJobInput>);
        case "synopsis_generation":
          return await this.processSynopsisJob(job as unknown as JobRecord<SynopsisJobInput>);
        case "storyboard_generation":
          return await this.processStoryboardJob(job as unknown as JobRecord<StoryboardJobInput>);
        case "image_generation":
          return await this.processImageJob(job as unknown as JobRecord<MediaJobInput>);
        case "video_generation":
          return await this.processVideoJob(job as unknown as JobRecord<MediaJobInput>);
        case "rewrite_segment":
          return await this.processRewriteJob(job as unknown as JobRecord<RewriteJobInput>);
        case "shot_regenerate":
          return await this.processShotRegenerateJob(job as unknown as JobRecord<{ projectId: string; fields: string[]; llmConfigSource?: LlmConfigSource }>);
        case "tts_generation":
          return await this.processTTSJob(job as unknown as JobRecord<GenerateTTSInput>);
        case "export_video":
          return await this.processExportJob(job as unknown as JobRecord<ExportTimelineInput>);
        case "shot_composition":
          return await this.processShotCompositionJob(job as unknown as JobRecord<ComposeShotInput>);
        case "novel_import":
          return await this.processNovelImportJob(job as unknown as JobRecord<NovelImportJobInput>);
        case "impact_suggestion":
          return await this.processImpactSuggestionJob(job as unknown as JobRecord<{ issueId: string; instruction?: string }>);
        default:
          throw new Error(`Unsupported job type: ${job.type}`);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      await this.failJob(jobId, message);

      // Notify job creator of failure
      this.notificationService.createNotification({
        userId: job.createdBy,
        projectId: job.projectId,
        type: "task_failed",
        title: "Generation task failed",
        body: `${job.type} task failed: ${message}`,
        referenceId: jobId,
        referenceType: "job",
      }).catch(() => {});

      throw error;
    }
  }

  private async processScriptJob(job: JobRecord<ScriptJobInput>) {
    const config = await this.resolveTextLlmConfig(job.createdBy, job.projectId, job.input.llmConfigSource);
    const resolvedModel = this.resolveTextModel(config);
    const worldBible = await this.getWorldBible(job.createdBy, job.projectId);
    const worldBibleRef = await this.getCurrentVersionReference(job.projectId, "world_bible");
    const enrichedInput = { ...job.input };
    const worldBibleContext = worldBible ? this.formatWorldBiblePrompt(worldBible) : undefined;
    const renderedPrompt = SCRIPT_GENERATION_CONTRACT.render({
      ...enrichedInput,
      worldBibleContext,
    });
    const structured = await this.textProvider.generateStructuredFromRenderedPrompt({
      operation: "script generation",
      rendered: renderedPrompt,
      schema: SCRIPT_GENERATION_CONTRACT.schema!,
      temperature: 0.8,
      config,
      mockFactory: () => this.mockScriptFallback(enrichedInput),
      transformResult: SCRIPT_GENERATION_CONTRACT.validate,
    });
    const content = structured.content;
    const enrichedContent = await this.autoMatchWorldBible(job.projectId, content);
    const document = await this.workspaceService.ensureDocumentForProject({
      projectId: job.projectId,
      type: "script",
      title: `${job.input.title} 剧本`,
      createdBy: job.createdBy,
    });
    const version = await this.workspaceService.createVersionForDocument({
      documentId: document.id,
      title: `${job.input.title} - AI 初稿`,
      content: enrichedContent,
      metadata: {
        sourceJobId: job.id,
        provider: resolvedModel,
        model: resolvedModel,
        ...(job.input.llmConfigSource ? { llmConfigSource: job.input.llmConfigSource } : {}),
        ...(worldBibleRef?.version.id ? { sourceWorldBibleVersionId: worldBibleRef.version.id } : {}),
        ...(job.input.sourceSynopsisVersionId ? { sourceSynopsisVersionId: job.input.sourceSynopsisVersionId } : {}),
        promptSnapshot: createPromptSnapshot({
          contractId: structured.rendered.metadata.contractId,
          contractVersion: structured.rendered.metadata.contractVersion,
          provider: resolvedModel,
          model: resolvedModel,
          renderedSystemPrompt: structured.rendered.system,
          renderedUserPrompt: structured.rendered.user,
          inputSummary: structured.rendered.metadata.inputSummary,
          schemaVersion: SCRIPT_GENERATION_CONTRACT.schema?.id,
          outputValidation: structured.validation,
        }),
      },
      createdBy: job.createdBy,
      status: "approved",
    });

    return this.completeJob(job.id, {
      documentId: document.id,
      versionId: version.id,
      content: enrichedContent,
      model: resolvedModel,
      ...(job.input.llmConfigSource ? { llmConfigSource: job.input.llmConfigSource } : {}),
    });
  }

  private async processSynopsisJob(job: JobRecord<SynopsisJobInput>) {
    const config = await this.resolveTextLlmConfig(job.createdBy, job.projectId, job.input.llmConfigSource);
    const resolvedModel = this.resolveTextModel(config);
    const worldBible = await this.getWorldBible(job.createdBy, job.projectId);
    const worldBibleRef = await this.getCurrentVersionReference(job.projectId, "world_bible");
    const enrichedInput = { ...job.input };
    if (worldBible) {
      const wbPrompt = this.formatWorldBiblePrompt(worldBible);
      enrichedInput.constraints = [job.input.constraints, wbPrompt].filter(Boolean).join("\n");
    }
    const synopsisText = await this.textProvider.generateSynopsis(enrichedInput, config);

    const document = await this.workspaceService.ensureDocumentForProject({
      projectId: job.projectId,
      type: "synopsis",
      title: `${job.input.title} 大纲`,
      createdBy: job.createdBy,
    });

    const version = await this.workspaceService.createVersionForDocument({
      documentId: document.id,
      title: `${job.input.title} - AI 大纲`,
      content: synopsisText,
      metadata: {
        sourceJobId: job.id,
        provider: resolvedModel,
        model: resolvedModel,
        ...(job.input.llmConfigSource ? { llmConfigSource: job.input.llmConfigSource } : {}),
        ...(worldBibleRef?.version.id ? { sourceWorldBibleVersionId: worldBibleRef.version.id } : {}),
        promptSnapshot: JSON.stringify(enrichedInput),
      },
      createdBy: job.createdBy,
      status: "approved",
    });

    return this.completeJob(job.id, {
      synopsis: synopsisText,
      documentId: document.id,
      versionId: version.id,
      model: resolvedModel,
      ...(job.input.llmConfigSource ? { llmConfigSource: job.input.llmConfigSource } : {}),
    });
  }

  private async processRewriteJob(job: JobRecord<RewriteJobInput>) {
    const config = await this.resolveTextLlmConfig(job.createdBy, job.projectId, job.input.llmConfigSource);
    const rewritten = await this.textProvider.rewriteSegment(job.input, config);
    const resolvedModel = this.resolveTextModel(config);
    return this.completeJob(job.id, {
      rewrittenText: rewritten,
      originalText: job.input.originalText,
      instruction: job.input.instruction,
      model: resolvedModel,
      ...(job.input.llmConfigSource ? { llmConfigSource: job.input.llmConfigSource } : {}),
    });
  }

  /** 处理影响建议生成任务 */
  private async processImpactSuggestionJob(job: JobRecord<{ issueId: string; instruction?: string }>) {
    const promptData = await this.impactService.buildSuggestionPrompt(job.input.issueId);
    const config = await this.resolveTextLlmConfig(job.createdBy, promptData.projectId);
    const model = this.resolveTextModel(config);
    const response = await this.textProvider.rewriteSegment({
      documentId: job.documentId ?? "",
      originalText: `${promptData.system}\n\n${promptData.prompt}`,
      instruction: job.input.instruction || "Create a safe candidate update for this impact issue.",
    }, config);

    let parsed: { summary?: string; suggestedContent?: unknown };
    try {
      const cleaned = response.trim().replace(/^```(?:json)?\s*\n?/i, "").replace(/\n?```\s*$/i, "");
      parsed = JSON.parse(cleaned) as { summary?: string; suggestedContent?: unknown };
    } catch {
      parsed = { summary: response, suggestedContent: undefined };
    }

    const suggestion = await this.impactService.storeSuggestion({
      issueId: job.input.issueId,
      actorId: job.createdBy,
      summary: parsed.summary?.trim() || "Impact suggestion generated",
      suggestedContent: parsed.suggestedContent,
      promptSnapshot: `${promptData.system}\n\n${promptData.prompt}`,
      provider: "openai-completions",
      model,
      createdJobId: job.id,
    });

    return this.completeJob(job.id, {
      issueId: job.input.issueId,
      suggestionId: suggestion.id,
      summary: suggestion.summary,
      model,
    });
  }

  private async processShotRegenerateJob(job: JobRecord<{ projectId: string; fields: string[]; llmConfigSource?: LlmConfigSource }>) {
    const config = await this.resolveTextLlmConfig(job.createdBy, job.projectId, job.input.llmConfigSource);
    const resolvedModel = this.resolveTextModel(config);

    // Gather full context: script + storyboard + world bible
    const scriptDoc = await this.prisma.document.findFirst({ where: { projectId: job.projectId, type: "script" } });
    const scriptVer = scriptDoc?.currentVersionId
      ? await this.prisma.version.findUnique({ where: { id: scriptDoc.currentVersionId } })
      : undefined;
    const script = scriptVer ? jsonOutput<ScriptContent>(scriptVer.content) : undefined;

    const sbDoc = await this.prisma.document.findFirst({ where: { projectId: job.projectId, type: "storyboard" } });
    const sbVer = sbDoc?.currentVersionId
      ? await this.prisma.version.findUnique({ where: { id: sbDoc.currentVersionId } })
      : undefined;
    const storyboard = sbVer ? jsonOutput<StoryboardContent>(sbVer.content) : undefined;

    const wbDoc = await this.prisma.document.findFirst({ where: { projectId: job.projectId, type: "world_bible" } });
    const wbVer = wbDoc?.currentVersionId
      ? await this.prisma.version.findUnique({ where: { id: wbDoc.currentVersionId } })
      : undefined;
    const worldBible = wbVer ? jsonOutput<WorldBibleContent>(wbVer.content) : undefined;

    const shots = storyboard?.shots ?? [];
    const targetIndex = shots.findIndex((s) => s.id === job.shotId);
    const targetShot = shots[targetIndex] ?? null;
    const prevShot = targetIndex > 0 ? shots[targetIndex - 1] : null;
    const nextShot = targetIndex < shots.length - 1 ? shots[targetIndex + 1] : null;

    if (!targetShot) {
      throw new NotFoundException(`Shot ${job.shotId} not found in storyboard`);
    }

    const fields = job.input.fields;
    const effectiveBaseUrl = (config?.baseUrl || this.textProvider.getBaseUrl()).replace(/\/$/, "");
    const effectiveApiKey = config?.apiKey || this.textProvider.getApiKey();

    // Mock fallback when no API key
    if (!effectiveApiKey || effectiveApiKey === "replace-me") {
      const mockResult: Record<string, string> = {};
      for (const f of fields) {
        mockResult[f] = `(regenerated) ${(targetShot as unknown as Record<string, unknown>)[f] ?? ""}`;
      }
      return this.completeJob(job.id, {
        ...mockResult,
        shotId: job.shotId,
        model: "mock",
      });
    }

    const systemPrompt = `You are a professional storyboard screenwriter. Regenerate specific fields of a storyboard shot. Return ONLY a valid JSON object with these fields: ${fields.join(", ")}. No markdown fences, no explanation.`;

    const prompt = [
      `Regenerate these fields for a storyboard shot: ${fields.join(", ")}`,
      "",
      "=== SCRIPT ===",
      script ? JSON.stringify(script, null, 2).slice(0, 4000) : "(no script)",
      worldBible ? `\n=== WORLD BIBLE ===\n${JSON.stringify(worldBible, null, 2).slice(0, 2000)}` : "",
      "",
      "=== TARGET SHOT ===",
      JSON.stringify(targetShot, null, 2),
      "",
      prevShot ? `=== PREVIOUS SHOT ===\n${JSON.stringify(prevShot, null, 2)}` : "(first shot in sequence)",
      nextShot ? `\n=== NEXT SHOT ===\n${JSON.stringify(nextShot, null, 2)}` : "(last shot in sequence)",
      "",
      `Return ONLY a JSON object with fields: ${fields.join(", ")}`,
    ].join("\n");

    const response = await fetch(`${effectiveBaseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${effectiveApiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: resolvedModel,
        temperature: 0.8,
        stream: false,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: prompt },
        ],
      }),
    });

    if (!response.ok) {
      throw new Error(`LLM request failed: HTTP ${response.status}`);
    }

    const data = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
    const raw = data.choices?.[0]?.message?.content ?? "";
    let parsed: Record<string, string>;
    try {
      const cleaned = raw.trim().replace(/^```(?:json)?\s*\n?/i, "").replace(/\n?```\s*$/i, "");
      parsed = JSON.parse(cleaned);
    } catch {
      throw new Error(`Failed to parse regeneration result: ${raw.slice(0, 200)}`);
    }

    return this.completeJob(job.id, {
      ...parsed,
      shotId: job.shotId,
      model: resolvedModel,
      ...(job.input.llmConfigSource ? { llmConfigSource: job.input.llmConfigSource } : {}),
    });
  }

  private async processStoryboardJob(job: JobRecord<StoryboardJobInput>) {
    const rawScriptVersion = await this.prisma.version.findUnique({ where: { id: job.input.versionId } });
    if (!rawScriptVersion) {
      throw new NotFoundException("Source script version not found");
    }

    const scriptVersion = jsonOutput<VersionRecord>(rawScriptVersion);

    const script = scriptVersion.content as ScriptContent;
    const config = await this.resolveTextLlmConfig(job.createdBy, job.projectId, job.input.llmConfigSource);
    const resolvedModel = this.resolveTextModel(config);
    const worldBible = await this.getWorldBible(job.createdBy, job.projectId);
    const worldBibleRef = await this.getCurrentVersionReference(job.projectId, "world_bible");
    const worldBibleContext = worldBible ? this.formatWorldBiblePrompt(worldBible) : undefined;
    const enrichedStoryboardInput = { ...job.input };
    const renderedPrompt = STORYBOARD_GENERATION_CONTRACT.render({
      ...enrichedStoryboardInput,
      script,
      worldBibleContext,
    });
    const structured = await this.textProvider.generateStructuredFromRenderedPrompt({
      operation: "storyboard generation",
      rendered: renderedPrompt,
      schema: STORYBOARD_GENERATION_CONTRACT.schema!,
      temperature: 0.7,
      config,
      mockFactory: () => ({ overview: "", shots: [] }),
      transformResult: STORYBOARD_GENERATION_CONTRACT.validate,
    });
    const content = structured.content;
    const document = await this.workspaceService.ensureDocumentForProject({
      projectId: job.projectId,
      type: "storyboard",
      title: "AI 分镜",
      createdBy: job.createdBy,
    });
    const version = await this.workspaceService.createVersionForDocument({
      documentId: job.input.documentId || document.id,
      title: "AI 分镜初稿",
      content,
      metadata: {
        sourceJobId: job.id,
        sourceScriptVersionId: job.input.versionId,
        provider: resolvedModel,
        model: resolvedModel,
        ...(job.input.llmConfigSource ? { llmConfigSource: job.input.llmConfigSource } : {}),
        ...(worldBibleRef?.version.id ? { sourceWorldBibleVersionId: worldBibleRef.version.id } : {}),
        promptSnapshot: createPromptSnapshot({
          contractId: structured.rendered.metadata.contractId,
          contractVersion: structured.rendered.metadata.contractVersion,
          provider: resolvedModel,
          model: resolvedModel,
          renderedSystemPrompt: structured.rendered.system,
          renderedUserPrompt: structured.rendered.user,
          inputSummary: structured.rendered.metadata.inputSummary,
          schemaVersion: STORYBOARD_GENERATION_CONTRACT.schema?.id,
          outputValidation: structured.validation,
        }),
      },
      createdBy: job.createdBy,
      status: "approved",
    });

    return this.completeJob(job.id, {
      documentId: version.documentId,
      versionId: version.id,
      content,
      model: resolvedModel,
      ...(job.input.llmConfigSource ? { llmConfigSource: job.input.llmConfigSource } : {}),
    });
  }

  private async processImageJob(job: JobRecord<MediaJobInput>) {
    const promptPreview = job.input.prompt?.trim()
      ? null
      : await this.promptBuilder.previewPrompt(job.projectId, job.input.shotId);
    const prompt = job.input.prompt?.trim()
      || this.composeMediaPrompt(promptPreview)
      || `${job.input.shotId} ${job.input.style} image`;
    const execution = await this.resolveImageExecution(job);

    let generated: GeneratedMediaResult;
    if (execution.providerKind === "google-gemini") {
      generated = await this.googleGeminiImageProvider.generateImage({
        ...job.input,
        prompt,
        referenceImage: execution.referenceImage
          ? {
              body: execution.referenceImage.body,
              mimeType: execution.referenceImage.mimeType,
            }
          : undefined,
      }, execution.config) as GeneratedMediaResult;
    } else if (execution.providerKind === "openai-compatible") {
      generated = await this.mediaProvider.generateImage(
        { ...job.input, prompt },
        this.toOpenAiImageLlmConfig(execution.config!),
      ) as GeneratedMediaResult;
    } else if (execution.providerKind === "stable-diffusion") {
      generated = await this.sdWebuiProvider.generateImage(
        { ...job.input, prompt },
        execution.config,
      ) as GeneratedMediaResult;
    } else if (execution.providerKind === "comfyui") {
      generated = await this.comfyuiProvider.generateImage(
        { ...job.input, prompt },
        execution.config,
      ) as GeneratedMediaResult;
    } else if (execution.providerKind === "grok") {
      generated = await this.grokMediaProvider.generateImage(
        { ...job.input, prompt },
        this.toGrokLlmConfig(execution.config!),
      ) as GeneratedMediaResult;
    } else {
      const config = await this.resolveLlmConfig(job.createdBy, job.projectId);
      try {
        generated = await this.mediaProvider.generateImage({ ...job.input, prompt }, config) as GeneratedMediaResult;
      } catch (error) {
        if (process.env.NODE_ENV !== "production") {
          const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="720"><rect width="1280" height="720" fill="#222"/><text x="40" y="80" fill="#fff" font-size="28">DramaFlow Mock Image</text><text x="40" y="140" fill="#ccc" font-size="20">Shot: ${job.input.shotId ?? "unknown"}</text></svg>`;
          generated = {
            prompt,
            provider: "mock-image",
            mimeType: "image/svg+xml",
            parameters: { ...job.input, mock: true } as Record<string, unknown>,
            inlineBody: svg,
            fileExtension: "svg",
            model: "mock",
          };
        } else {
          throw error;
        }
      }
      execution.model = config?.model?.trim() || process.env.MEDIA_IMAGE_MODEL || "gpt-image-1";
    }

    generated = {
      ...generated,
      model: generated.model ?? execution.model,
      configSource: execution.configSource,
      parameters: {
        ...generated.parameters,
        ...(execution.configSource ? { configSource: execution.configSource } : {}),
      },
    };

    return this.finalizeMediaJob(job, "image", prompt, generated);
  }

  async enhanceReferencePrompt(
    userId: string,
    projectId: string,
    prompt: string,
    type: "character" | "location" | "styleGuide",
    configSource: ImageConfigSource = "team",
  ): Promise<EnhanceReferencePromptResponse> {
    const originalPrompt = prompt;

    const typeInstructions: Record<string, string> = {
      character:
        "You are an expert at writing image generation prompts for character portraits. Enhance the following description into a detailed, professional image generation prompt. Focus on: facial features, hair, body type, clothing, pose, expression, and artistic style. Output ONLY the enhanced prompt, no explanation.",
      location:
        "You are an expert at writing image generation prompts for scenic environments. Enhance the following description into a detailed, professional image generation prompt. Focus on: atmosphere, lighting, perspective, weather, time of day, and architectural details. Output ONLY the enhanced prompt, no explanation.",
      styleGuide:
        "You are an expert at writing image generation prompts that capture visual art styles. Enhance the following description into a detailed, professional image generation prompt. Focus on: color palette, brush strokes, composition, mood, and artistic techniques. Output ONLY the enhanced prompt, no explanation.",
    };

    const systemPrompt = typeInstructions[type] ?? typeInstructions.character;

    const config = await (async () => {
      const project = await this.prisma.project.findUnique({ where: { id: projectId } });
      if (configSource === "personal") {
        const user = await this.prisma.user.findUnique({ where: { id: userId } });
        return jsonOutput<LlmProviderConfig | undefined>(user?.llmConfig);
      }
      const team = project ? await this.prisma.team.findUnique({ where: { id: project.teamId } }) : undefined;
      return jsonOutput<LlmProviderConfig | undefined>(team?.llmConfig);
    })();

    if (!config?.apiKey || !config?.baseUrl) {
      throw new BadRequestException("LLM provider not configured for prompt enhancement");
    }

    const model = config.model || "gpt-4o";
    const response = await fetch(`${config.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: prompt },
        ],
        temperature: 0.7,
        max_tokens: 1024,
      }),
    });

    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new BadRequestException(`LLM enhancement failed: ${text.slice(0, 200)}`);
    }

    const data = await response.json();
    const enhancedPrompt = data.choices?.[0]?.message?.content?.trim() ?? originalPrompt;

    return { enhancedPrompt, originalPrompt };
  }

  async generateImageFromPrompt(
    userId: string,
    projectId: string,
    prompt: string,
    configSource: ImageConfigSource,
    providerId?: string,
    referenceImageAssetId?: string,
    negativePrompt?: string,
  ): Promise<{ buffer: Buffer; mimeType: string; provider: string; model?: string }> {
    await this.assertProjectReadable(userId, projectId);
    const sourceLabel = configSource === "team" ? "team" : "personal";

    // Resolve reference image buffer if assetId provided
    let referenceImageBuffer: Buffer | undefined;
    if (referenceImageAssetId) {
      try {
        const assetInfo = await this.storageService.getAssetBuffer(userId, referenceImageAssetId);
        if (assetInfo) {
          referenceImageBuffer = Buffer.isBuffer(assetInfo.body)
            ? assetInfo.body
            : Buffer.from(assetInfo.body);
        }
      } catch { /* reference image not available */ }
    }

    // 优先从新 provider 列表解析
    let config: ImageGenerationConfig | undefined;
    const entry = await this.resolveProviderEntry("image", providerId, userId, projectId, configSource);
    if (entry) {
      config = this.providerEntryToConfig(entry);
    } else {
      config = await this.resolveImageGenerationConfig(userId, projectId, configSource);
    }
    if (!config) {
      throw new BadRequestException(`The ${sourceLabel} image generation config is not set.`);
    }
    if (!config.provider) {
      throw new BadRequestException(`The ${sourceLabel} image generation config is missing a provider.`);
    }
    // API key required for cloud providers, optional for local (SD WebUI, ComfyUI)
    const needsApiKey = config.provider === "google-gemini" || config.provider === "openai-compatible" || config.provider === "grok";
    if (needsApiKey && !config.apiKey?.trim()) {
      throw new BadRequestException(`The ${sourceLabel} image generation config is missing an API key.`);
    }
    if (needsApiKey && !config.model?.trim()) {
      throw new BadRequestException(`The ${sourceLabel} image generation config is missing a model.`);
    }
    if (config.provider === "openai-compatible" && !config.baseUrl?.trim()) {
      throw new BadRequestException(`The ${sourceLabel} OpenAI-compatible image config is missing a base URL.`);
    }
    if (config.provider === "grok" && !config.baseUrl?.trim()) {
      throw new BadRequestException(`The ${sourceLabel} Grok image config is missing a base URL.`);
    }

    // For providers that don't support img2img, append reference note to prompt
    const providersWithImg2Img = ["google-gemini", "stable-diffusion", "comfyui"];
    let effectivePrompt = prompt;
    if (referenceImageBuffer && !providersWithImg2Img.includes(config.provider)) {
      effectivePrompt = `${prompt}\n\nReference: Use this image as a style and composition guide.`;
      referenceImageBuffer = undefined; // Don't pass to unsupported providers
    }

    const input = { prompt: effectivePrompt, shotId: "char-ref", style: "portrait", aspectRatio: "1:1", referenceImageBuffer, negativePrompt };
    let generated: GeneratedMediaResult;

    if (config.provider === "google-gemini") {
      generated = await this.googleGeminiImageProvider.generateImage(input, config) as GeneratedMediaResult;
    } else if (config.provider === "openai-compatible") {
      generated = await this.mediaProvider.generateImage(input, this.toOpenAiImageLlmConfig(config)) as GeneratedMediaResult;
    } else if (config.provider === "stable-diffusion") {
      generated = await this.sdWebuiProvider.generateImage(input, config) as GeneratedMediaResult;
    } else if (config.provider === "comfyui") {
      generated = await this.comfyuiProvider.generateImage(input, config) as GeneratedMediaResult;
    } else if (config.provider === "grok") {
      generated = await this.grokMediaProvider.generateImage(input, this.toGrokLlmConfig(config)) as GeneratedMediaResult;
    } else {
      throw new BadRequestException(`Unsupported image provider: ${config.provider}`);
    }

    const inlineBody = generated.inlineBody
      ? (Buffer.isBuffer(generated.inlineBody)
          ? generated.inlineBody
          : generated.inlineBody instanceof Uint8Array
            ? Buffer.from(generated.inlineBody)
            : Buffer.from(generated.inlineBody as string))
      : null;

    if (!inlineBody) {
      throw new Error("Image generation did not return inline body");
    }

    return {
      buffer: inlineBody,
      mimeType: generated.mimeType,
      provider: generated.provider,
      model: generated.model ?? config.model,
    };
  }

  async generateCharacterReferenceImage(
    userId: string,
    projectId: string,
    characterId: string,
    prompt: string,
    configSource: ImageConfigSource = "team",
    providerId?: string,
    referenceImageAssetId?: string,
    negativePrompt?: string,
  ): Promise<WorldBibleReferenceImageGenerateResponse> {
    const wb = await this.workspaceService.getWorldBible(userId, projectId);
    const character = wb.characters.find((c) => c.id === characterId);
    if (!character) {
      throw new NotFoundException("Character not found");
    }

    return this.generateWorldBibleReferenceImage(
      userId,
      projectId,
      `char-ref-${characterId}`,
      prompt,
      configSource,
      providerId,
      referenceImageAssetId,
      negativePrompt,
    );
  }

  async generateLocationReferenceImage(
    userId: string,
    projectId: string,
    locationId: string,
    prompt: string,
    configSource: ImageConfigSource = "team",
    providerId?: string,
    referenceImageAssetId?: string,
    negativePrompt?: string,
  ): Promise<WorldBibleReferenceImageGenerateResponse> {
    const wb = await this.workspaceService.getWorldBible(userId, projectId);
    const location = wb.locations.find((item) => item.id === locationId);
    if (!location) {
      throw new NotFoundException("Location not found");
    }

    return this.generateWorldBibleReferenceImage(
      userId,
      projectId,
      `location-ref-${locationId}`,
      prompt,
      configSource,
      providerId,
      referenceImageAssetId,
      negativePrompt,
    );
  }

  async generateStyleGuideReferenceImage(
    userId: string,
    projectId: string,
    prompt: string,
    configSource: ImageConfigSource = "team",
    providerId?: string,
    referenceImageAssetId?: string,
    negativePrompt?: string,
  ): Promise<WorldBibleReferenceImageGenerateResponse> {
    return this.generateWorldBibleReferenceImage(
      userId,
      projectId,
      "style-guide-ref",
      prompt,
      configSource,
      providerId,
      referenceImageAssetId,
      negativePrompt,
    );
  }

  private async generateWorldBibleReferenceImage(
    userId: string,
    projectId: string,
    filenamePrefix: string,
    prompt: string,
    configSource: ImageConfigSource,
    providerId?: string,
    referenceImageAssetId?: string,
    negativePrompt?: string,
  ): Promise<WorldBibleReferenceImageGenerateResponse> {
    const result = await this.generateImageFromPrompt(
      userId, projectId, prompt, configSource, providerId,
      referenceImageAssetId, negativePrompt,
    );

    const filename = `${filenamePrefix}-${Date.now()}.${result.mimeType.split("/")[1] || "png"}`;
    const stored = await this.storageService.storeGeneratedAsset(userId, {
      projectId,
      filename,
      contentType: result.mimeType,
      body: result.buffer,
    });

    return {
      assetUrl: stored.url!,
      assetId: stored.asset.id,
      prompt,
    };
  }

  private async processVideoJob(job: JobRecord<MediaJobInput>) {
    const suppliedPrompt = job.input.prompt?.trim();
    const prompt = suppliedPrompt
      ? augmentVideoPromptWithReferenceMode(suppliedPrompt, job.input.videoReferenceMode ?? "none")
      : await this.composeVideoPromptForJob(job)
        || `${job.shotId} ${job.input.style} video`;

    // 优先从新 video provider 列表解析
    if (job.input.configSource) {
      const videoEntry = await this.resolveProviderEntry("video", job.input.providerId, job.createdBy, job.projectId, job.input.configSource);
      if (videoEntry) {
        const videoConfig = this.providerEntryToConfig(videoEntry);

        // 适配器路由：minimax / volcengine / vidu / ali
        if (videoEntry.provider === "minimax" || videoEntry.provider === "volcengine" || videoEntry.provider === "vidu" || videoEntry.provider === "ali") {
          const adapter = getVideoProviderAdapter(videoEntry.provider as VideoGenerationProvider);
          const config = this.providerEntryToVideoProviderConfig(videoEntry);
          const references = await this.resolveVideoReferences(job, videoEntry.provider as VideoReferenceProviderKey);
          const liveJob = await this.prisma.job.findUnique({ where: { id: job.id } });
          const currentState = liveJob ? this.toVideoJobState(jsonOutput(liveJob.result), prompt, job.input) : null;
          const adapterState = currentState?.providerVideoId && adapter.pollJob
            ? await adapter.pollJob(currentState.providerVideoId, {
                prompt,
                shotId: job.input.shotId,
                aspectRatio: job.input.aspectRatio,
                durationSeconds: job.input.durationSeconds,
                config,
                references,
              })
            : await adapter.createJob({
                prompt,
                shotId: job.input.shotId,
                aspectRatio: job.input.aspectRatio,
                durationSeconds: job.input.durationSeconds,
                config,
                references,
              });
          const state = this.toVideoJobStateFromAdapter(adapterState, prompt, job.input);
          if (adapterState.providerStatus !== "completed") {
            if (adapterState.providerStatus === "failed") {
              throw new Error(adapterState.note ?? `${adapterState.provider} video generation failed`);
            }
            return this.updateVideoJobProgress(job.id, state);
          }
          return this.finalizeProviderVideo(job, state);
        }

        if (videoEntry.provider === "grok") {
          const grokLlmConfig = this.toGrokLlmConfig(videoConfig);
          const inputWithConfig = {
            ...await this.buildVideoProviderInput(job, prompt, "grok"),
            grokConfig: videoConfig.grokConfig,
          };
          const generated = await this.grokMediaProvider.generateVideo(inputWithConfig, grokLlmConfig) as GeneratedMediaResult;
          return this.finalizeMediaJob(job, "video", prompt, {
            ...generated,
            configSource: job.input.configSource,
            parameters: { ...generated.parameters, configSource: job.input.configSource },
          });
        }
        // OpenAI-compatible video path
        const openAiConfig = this.toOpenAiImageLlmConfig(videoConfig);
        return this.processVideoJobOpenAi(job, prompt, openAiConfig, "openai-compatible");
      }

      // 向下兼容：从旧 imageGenerationConfig 检查 Grok
      const imageConfig = await this.resolveImageGenerationConfig(job.createdBy, job.projectId, job.input.configSource);
      if (imageConfig?.provider === "grok") {
        const grokLlmConfig = this.toGrokLlmConfig(imageConfig);
        const inputWithConfig = {
          ...await this.buildVideoProviderInput(job, prompt, "grok"),
          grokConfig: imageConfig.grokConfig,
        };
        const generated = await this.grokMediaProvider.generateVideo(inputWithConfig, grokLlmConfig) as GeneratedMediaResult;
        return this.finalizeMediaJob(job, "video", prompt, {
          ...generated,
          configSource: job.input.configSource,
          parameters: { ...generated.parameters, configSource: job.input.configSource },
        });
      }
    }

    // 原有 OpenAI 兼容视频生成路径（异步轮询）
    const config = await this.resolveLlmConfig(job.createdBy, job.projectId);
    if (!config) {
      throw new BadRequestException("LLM config is required for video generation.");
    }
    return this.processVideoJobOpenAi(job, prompt, config, "legacy-openai");
  }

  /** OpenAI 兼容视频生成路径（异步轮询） */
  private async processVideoJobOpenAi(
    job: JobRecord<MediaJobInput>,
    prompt: string,
    config: LlmProviderConfig,
    providerKey: VideoReferenceProviderKey = "legacy-openai",
  ) {
    const providerInput = await this.buildVideoProviderInput(job, prompt, providerKey);

    const liveJob = await this.prisma.job.findUnique({ where: { id: job.id } });
    const currentState = liveJob ? this.toVideoJobState(jsonOutput(liveJob.result), prompt, job.input) : null;

    if (!currentState?.providerVideoId) {
      const created = this.toVideoJobState(await this.mediaProvider.createVideoJob(providerInput, config), prompt, job.input);
      if (created.mode === "mock") {
        const generated = await this.mediaProvider.generateVideo(providerInput, config) as GeneratedMediaResult;
        return this.finalizeMediaJob(job, "video", prompt, {
          ...generated,
          providerVideoId: created.providerVideoId,
          providerStatus: "completed",
          progress: 100,
          mode: "mock",
          note: created.note,
        });
      }

      if (!this.isProviderComplete(created.providerStatus)) {
        return this.updateVideoJobProgress(job.id, created);
      }

      return this.finalizeProviderVideo(job, created);
    }

    const refreshed = this.toVideoJobState(
      await this.mediaProvider.getVideoJob(currentState.providerVideoId, providerInput, config),
      prompt,
      job.input,
    );

    if (this.isProviderFailed(refreshed.providerStatus)) {
      throw new Error(refreshed.note ?? `Video generation failed with status ${refreshed.providerStatus}`);
    }

    if (!this.isProviderComplete(refreshed.providerStatus)) {
      return this.updateVideoJobProgress(job.id, refreshed);
    }

    return this.finalizeProviderVideo(job, refreshed);
  }

  private async finalizeProviderVideo(job: JobRecord<MediaJobInput>, state: VideoJobState) {
    const config = await this.resolveLlmConfig(job.createdBy, job.projectId);
    if (state.mode === "mock") {
      const generated = await this.mediaProvider.generateVideo({ ...job.input, prompt: state.prompt }, config) as GeneratedMediaResult;
      return this.finalizeMediaJob(job, "video", state.prompt, {
        ...generated,
        providerVideoId: state.providerVideoId,
        providerStatus: "completed",
        progress: 100,
        mode: "mock",
        note: state.note,
      });
    }

    let generated: GeneratedMediaResult;
    if (state.assetUrl) {
      generated = {
        prompt: state.prompt,
        provider: state.provider,
        mimeType: state.mimeType ?? "video/mp4",
        parameters: state.parameters,
        assetUrl: state.assetUrl,
        providerVideoId: state.providerVideoId,
        providerStatus: state.providerStatus,
        progress: 100,
        mode: state.mode,
        note: state.note,
      };
    } else {
      const downloaded = await this.mediaProvider.downloadVideoContent(state.providerVideoId!, config);
      generated = {
        prompt: state.prompt,
        provider: state.provider,
        mimeType: downloaded.mimeType,
        parameters: state.parameters,
        assetUrl: downloaded.assetUrl,
        inlineBody: downloaded.inlineBody,
        fileExtension: downloaded.fileExtension,
        providerVideoId: state.providerVideoId,
        providerStatus: state.providerStatus,
        progress: 100,
        mode: state.mode,
        note: state.note,
      };
    }

    return this.finalizeMediaJob(job, "video", state.prompt, generated);
  }

  private async finalizeMediaJob(
    job: JobRecord<MediaJobInput>,
    mediaType: "image" | "video",
    prompt: string,
    generated: GeneratedMediaResult,
  ) {
    // 查找当前分镜版本和对应镜头信息，用于记录依赖元数据
    const storyboardDocument = await this.prisma.document.findFirst({ where: { projectId: job.projectId, type: "storyboard" } });
    const storyboardVersion = storyboardDocument?.currentVersionId
      ? await this.prisma.version.findUnique({ where: { id: storyboardDocument.currentVersionId } })
      : undefined;
    const storyboardContent = storyboardVersion
      ? jsonOutput<StoryboardContent | undefined>(storyboardVersion.content)
      : undefined;
    const sourceShot = storyboardContent?.shots?.find((shot) => shot.id === job.shotId);
    const storyboardRef = {
      versionId: storyboardVersion?.id,
      shotHash: sourceShot ? this.impactService.stableHash(sourceShot) : undefined,
    };

    const assetReference = await this.persistMediaArtifact(job, generated, mediaType);
    const document = await this.workspaceService.ensureDocumentForProject({
      projectId: job.projectId,
      type: mediaType,
      title: mediaType === "image" ? `${job.shotId} 参考图` : `${job.shotId} 预演视频`,
      createdBy: job.createdBy,
      shotId: job.shotId,
    });
    const version = await this.workspaceService.createVersionForDocument({
      documentId: document.id,
      title: `${mediaType === "image" ? "AI 图像" : "AI 视频"} ${job.shotId}`,
      content: {
        prompt,
        assetId: assetReference.assetId,
        assetUrl: assetReference.assetUrl,
        provider: generated.provider,
        model: generated.model,
        mimeType: generated.mimeType,
        parameters: generated.parameters,
        providerVideoId: generated.providerVideoId,
        providerStatus: generated.providerStatus,
        progress: generated.progress,
        mode: generated.mode,
        note: generated.note,
        configSource: generated.configSource,
      },
      metadata: {
        sourceJobId: job.id,
        shotId: job.shotId,
        provider: generated.provider,
        model: generated.model,
        configSource: generated.configSource,
        providerVideoId: generated.providerVideoId,
        providerStatus: generated.providerStatus,
        progress: generated.progress,
        mode: generated.mode,
        note: generated.note,
        ...(storyboardRef.versionId ? { sourceStoryboardVersionId: storyboardRef.versionId } : {}),
        ...(storyboardRef.shotHash ? { sourceShotHash: storyboardRef.shotHash, targetSnapshotHash: storyboardRef.shotHash } : {}),
        promptSnapshot: prompt,
      },
      createdBy: job.createdBy,
      status: "approved",
    });

    if (job.shotId) {
      await this.workspaceService.bindMediaToStoryboardDraft(
        job.projectId,
        job.shotId,
        mediaType,
        version.id,
        job.createdBy,
      );
    }

    return this.completeJob(job.id, {
      documentId: document.id,
      versionId: version.id,
      asset: assetReference,
      provider: generated.provider,
      model: generated.model,
      configSource: generated.configSource,
      providerVideoId: generated.providerVideoId,
      providerStatus: generated.providerStatus,
      progress: generated.progress,
      mode: generated.mode,
      note: generated.note,
    });
  }

  private async persistMediaArtifact(
    job: JobRecord<MediaJobInput>,
    generated: GeneratedMediaResult,
    mediaType: "image" | "video",
  ) {
    if (generated.inlineBody) {
      const inlineBody = Buffer.isBuffer(generated.inlineBody)
        ? generated.inlineBody
        : generated.inlineBody instanceof Uint8Array
          ? Buffer.from(generated.inlineBody)
          : generated.inlineBody;
      const stored = await this.storageService.storeGeneratedAsset(job.createdBy, {
        projectId: job.projectId,
        filename: `${job.shotId}.${generated.fileExtension ?? (mediaType === "image" ? "svg" : "mp4")}`,
        contentType: generated.mimeType,
        body: inlineBody,
      });

      return {
        assetId: stored.asset.id,
        assetUrl: stored.url,
      };
    }

    const now = new Date();
    const asset = await this.prisma.asset.create({
      data: {
        id: createId("asset"),
        projectId: job.projectId,
        storageDriver: this.storageService.getDriver(),
        storageKey: `${mediaType}/${job.id}`,
        publicUrl: generated.assetUrl,
        mimeType: generated.mimeType,
        sizeInBytes: 0,
        createdBy: job.createdBy,
        createdAt: now,
      },
    });

    return {
      assetId: asset.id,
      assetUrl: generated.assetUrl,
    };
  }

  private async updateVideoJobProgress(jobId: string, state: VideoJobState) {
    const record = await this.updateJobState(jobId, {
      status: "running",
      progress: state.progress,
      result: jsonInput({ ...state }),
      error: null,
    });
    return record;
  }

  private async enqueueJob(
    userId: string,
    input: Pick<JobRecord, "type" | "projectId" | "documentId" | "shotId"> & { input: unknown },
  ) {
    const now = new Date();
    const job = await this.prisma.job.create({
      data: {
        id: createId("job"),
        type: input.type,
        status: "queued",
        projectId: input.projectId,
        documentId: input.documentId,
        shotId: input.shotId,
        input: jsonInput(input.input ?? {}),
        retryCount: 0,
        maxRetries: 3,
        priority: "normal",
        createdBy: userId,
        createdAt: now,
        updatedAt: now,
      },
    });
    const record = this.toJobRecord(job);
    this.emitJobUpdated(record);
    return record;
  }

  private async completeJob(jobId: string, result: Record<string, unknown>) {
    const record = await this.updateJobState(jobId, {
      status: "completed",
      result: jsonInput(result),
      progress: 100,
      error: null,
    });

    // Notify job creator of completion
    this.notificationService.createNotification({
      userId: record.createdBy,
      projectId: record.projectId,
      type: "task_completed",
      title: "Generation task completed",
      body: `${record.type} task completed successfully`,
      referenceId: jobId,
      referenceType: "job",
    }).catch(() => {});

    return record;
  }

  private async markJobRunning(
    jobId: string,
    options: { progress?: number; result?: Record<string, unknown> } = {},
  ) {
    const data: any = { status: "running", error: null };
    if (options.progress !== undefined) {
      data.progress = options.progress;
    }
    if (options.result !== undefined) {
      data.result = jsonInput(options.result);
    }
    const record = await this.updateJobState(jobId, data);
    return record;
  }

  private async failJob(jobId: string, message: string) {
    const record = await this.updateJobState(jobId, {
      status: "failed",
      error: message,
    });
    return record;
  }

  private async mutateJobState(jobId: string, mutate: (liveJob: JobRecord) => void) {
    const rawJob = await this.prisma.job.findUnique({ where: { id: jobId } });
    if (!rawJob) {
      throw new NotFoundException("Job not found");
    }

    const liveJob = this.toJobRecord(rawJob);
    const before = this.createJobSnapshot(liveJob);
    mutate(liveJob);
    liveJob.updatedAt = new Date().toISOString();
    const after = this.createJobSnapshot(liveJob);

    const changed = before !== after;
    if (changed) {
      const updated = await this.prisma.job.update({
        where: { id: jobId },
        data: {
          status: liveJob.status,
          error: liveJob.error ?? null,
          progress: liveJob.progress ?? null,
          result: liveJob.result ? jsonInput(liveJob.result) : Prisma.JsonNull,
          retryCount: liveJob.retryCount ?? null,
          cancelledAt: liveJob.cancelledAt ? new Date(liveJob.cancelledAt) : null,
          batchId: liveJob.batchId ?? null,
          updatedAt: new Date(),
        },
      });
      const record = this.toJobRecord(updated);
      this.emitJobUpdated(record);
      return { job: record, changed };
    }

    return { job: liveJob, changed: false };
  }

  private emitJobUpdated(job: JobRecord | null | undefined) {
    if (!job) {
      return;
    }

    this.realtimeEvents.emitJobUpdated(job);
  }

  private createJobSnapshot(job: JobRecord): string {
    return JSON.stringify({
      status: job.status,
      progress: job.progress,
      error: job.error,
      result: job.result ?? null,
      batchId: job.batchId,
      retryCount: job.retryCount,
      cancelledAt: job.cancelledAt,
    });
  }
  private async autoMatchWorldBible(projectId: string, content: ScriptContent): Promise<ScriptContent> {
    const wbDoc = await this.prisma.document.findFirst({ where: { projectId, type: "world_bible" } });
    if (!wbDoc?.currentVersionId) return content;
    const version = await this.prisma.version.findUnique({ where: { id: wbDoc.currentVersionId } });
    if (!version?.content || typeof version.content !== "object") return content;
    const worldBible = jsonOutput<WorldBibleContent>(version.content);

    if (!worldBible) return content;

    const matchedCharacters = content.characters.map((c) => {
      const match = worldBible.characters.find(
        (wb) => wb.name.toLowerCase() === c.name.toLowerCase(),
      );
      if (match) {
        return { ...c, worldBibleCharId: match.id };
      }
      return c;
    });

    const matchedScenes = content.scenes.map((scene) => {
      const headingLower = scene.heading.toLowerCase();
      const match = worldBible.locations.find(
        (loc) => headingLower.includes(loc.name.toLowerCase()),
      );
      if (match) {
        return { ...scene, locationId: match.id };
      }
      return scene;
    });

    return { ...content, characters: matchedCharacters, scenes: matchedScenes };
  }

  private async getWorldBible(userId: string, projectId: string): Promise<WorldBibleContent | null> {
    try {
      return await this.workspaceService.getWorldBible(userId, projectId);
    } catch { return null; }
  }

  private mockScriptFallback(input: { title: string; premise: string }): import("@dramaflow/shared").ScriptContent {
    return {
      logline: input.title,
      premise: input.premise,
      characters: [],
      scenes: [],
    };
  }

  private formatWorldBiblePrompt(worldBible: WorldBibleContent | null): string {
    if (!worldBible) return "";
    const parts: string[] = [];
    if (worldBible.characters.length > 0)
      parts.push(`角色：${worldBible.characters.map((c) => `${c.name}（${c.appearance}）`).join("；")}`);
    if (worldBible.locations.length > 0)
      parts.push(`场景：${worldBible.locations.map((l) => `${l.name}（${l.description}）`).join("；")}`);
    if (worldBible.styleGuide?.visualStyle)
      parts.push(`风格：${worldBible.styleGuide.visualStyle}`);
    return parts.length > 0 ? `\n## 项目世界观\n${parts.join("\n")}` : "";
  }

  private shouldPollVideoJob(job: JobRecord) {
    const state = this.toVideoJobState(job.result, undefined, undefined);
    return !this.isProviderComplete(state?.providerStatus);
  }

  private isProviderComplete(status?: string) {
    return status === "completed";
  }

  private isProviderFailed(status?: string) {
    return status === "failed";
  }

  private toVideoJobState(result: unknown, prompt?: string, input?: GenerateMediaInput): VideoJobState {
    const record = result && typeof result === "object" && !Array.isArray(result)
      ? result as Record<string, unknown>
      : {};

    return {
      prompt: typeof record.prompt === "string" ? record.prompt : prompt ?? "",
      provider: typeof record.provider === "string" ? record.provider : "mock-video",
      providerVideoId: typeof record.providerVideoId === "string" ? record.providerVideoId : undefined,
      providerStatus: typeof record.providerStatus === "string" ? record.providerStatus : undefined,
      progress: typeof record.progress === "number" ? record.progress : undefined,
      parameters: (record.parameters && typeof record.parameters === "object" && !Array.isArray(record.parameters)
        ? record.parameters
        : (input ? { ...input } : {})) as Record<string, unknown>,
      mode: record.mode === "provider" || record.mode === "mock" ? record.mode : undefined,
      note: typeof record.note === "string" ? record.note : undefined,
      assetUrl: typeof record.assetUrl === "string" ? record.assetUrl : undefined,
      mimeType: typeof record.mimeType === "string" ? record.mimeType : undefined,
    };
  }

  /** 将适配器返回的 VideoProviderJobState 转换为内部 VideoJobState */
  private toVideoJobStateFromAdapter(
    state: VideoProviderJobState,
    prompt: string,
    input: MediaJobInput,
  ): VideoJobState {
    return {
      prompt,
      provider: state.provider,
      providerVideoId: state.providerVideoId,
      providerStatus: state.providerStatus,
      progress: state.progress,
      parameters: {
        ...input,
        ...state.parameters,
      },
      mode: "provider",
      note: state.note,
      assetUrl: state.assetUrl,
      mimeType: state.mimeType,
    };
  }

  private async assertProjectReadable(userId: string, projectId: string) {
    await this.workspaceService.assertProjectPermission(
      userId,
      projectId,
      "project.view",
      "You do not have access to this project",
    );
  }

  private normalizeLlmConfig(
    config?: import("@dramaflow/shared").LlmProviderConfig,
  ): import("@dramaflow/shared").LlmProviderConfig | undefined {
    if (!config) {
      return undefined;
    }

    const normalized: import("@dramaflow/shared").LlmProviderConfig = {
      provider: config.provider,
      apiKey: config.apiKey?.trim() || undefined,
      baseUrl: config.baseUrl?.trim() || undefined,
      model: config.model?.trim() || undefined,
      ...(config.stream !== undefined ? { stream: config.stream } : {}),
    };

    if (!normalized.apiKey && !normalized.baseUrl && !normalized.model && normalized.stream === undefined) {
      return undefined;
    }

    return normalized;
  }

  private mergeLlmConfig(
    base?: import("@dramaflow/shared").LlmProviderConfig,
    override?: import("@dramaflow/shared").LlmProviderConfig,
  ): import("@dramaflow/shared").LlmProviderConfig | undefined {
    const normalizedBase = this.normalizeLlmConfig(base);
    const normalizedOverride = this.normalizeLlmConfig(override);

    if (!normalizedBase && !normalizedOverride) {
      return undefined;
    }

    return {
      provider: normalizedOverride?.provider ?? normalizedBase?.provider ?? "openai-completions",
      apiKey: normalizedOverride?.apiKey ?? normalizedBase?.apiKey,
      baseUrl: normalizedOverride?.baseUrl ?? normalizedBase?.baseUrl,
      model: normalizedOverride?.model ?? normalizedBase?.model,
      ...(normalizedOverride?.stream !== undefined
        ? { stream: normalizedOverride.stream }
        : normalizedBase?.stream !== undefined
          ? { stream: normalizedBase.stream }
          : {}),
    };
  }

  private async resolveLlmConfig(userId: string, projectId: string, configSource?: LlmConfigSource): Promise<LlmProviderConfig | undefined> {
    const project = await this.prisma.project.findUnique({ where: { id: projectId } });
    const [user, team] = await Promise.all([
      this.prisma.user.findUnique({ where: { id: userId } }),
      project ? this.prisma.team.findUnique({ where: { id: project.teamId } }) : Promise.resolve(null),
    ]);

    if (configSource === "personal") {
      return this.normalizeLlmConfig(jsonOutput<LlmProviderConfig | undefined>(user?.llmConfig));
    }

    if (configSource === "team") {
      return this.normalizeLlmConfig(jsonOutput<LlmProviderConfig | undefined>(team?.llmConfig));
    }

    const teamConfig = this.normalizeLlmConfig(jsonOutput<LlmProviderConfig | undefined>(team?.llmConfig));
    const userConfig = this.normalizeLlmConfig(jsonOutput<LlmProviderConfig | undefined>(user?.llmConfig));

    return this.mergeLlmConfig(userConfig, teamConfig);
  }

  public async resolveTextLlmConfig(
    userId: string,
    projectId: string,
    configSource?: LlmConfigSource,
  ): Promise<LlmProviderConfig | undefined> {
    const config = await this.resolveLlmConfig(userId, projectId, configSource);

    if (!configSource) {
      return config;
    }

    const sourceLabel = configSource === "team" ? "team" : "personal";
    if (!config) {
      throw new BadRequestException(`The ${sourceLabel} text generation config is not set.`);
    }
    if (!config.apiKey?.trim()) {
      throw new BadRequestException(`The ${sourceLabel} text generation config is missing an API key.`);
    }

    return config;
  }

  private resolveTextModel(config?: LlmProviderConfig) {
    return config?.model?.trim() || process.env.OPENAI_TEXT_MODEL || "mock-text";
  }

  private normalizeImageGenerationConfig(config?: ImageGenerationConfig): ImageGenerationConfig | undefined {
    if (!config?.provider) {
      return undefined;
    }

    const normalized: ImageGenerationConfig = {
      provider: config.provider,
      apiKey: config.apiKey?.trim() || undefined,
      baseUrl: config.baseUrl?.trim() || undefined,
      model: config.model?.trim() || undefined,
      sdConfig: config.provider === "stable-diffusion" ? config.sdConfig : undefined,
      comfyuiConfig: config.provider === "comfyui" ? config.comfyuiConfig : undefined,
    };

    if (!normalized.apiKey && !normalized.baseUrl && !normalized.model && !normalized.sdConfig && !normalized.comfyuiConfig) {
      return undefined;
    }

    return normalized;
  }

  private async resolveImageGenerationConfig(
    userId: string,
    projectId: string,
    configSource: ImageConfigSource,
  ): Promise<ImageGenerationConfig | undefined> {
    if (configSource === "personal") {
      const user = await this.prisma.user.findUnique({ where: { id: userId } });
      return this.normalizeImageGenerationConfig(
        jsonOutput<ImageGenerationConfig | undefined>(user?.imageGenerationConfig),
      );
    }

    const project = await this.prisma.project.findUnique({ where: { id: projectId } });
    if (!project) {
      throw new NotFoundException("Project not found");
    }

    const team = await this.prisma.team.findUnique({ where: { id: project.teamId } });
    return this.normalizeImageGenerationConfig(
      jsonOutput<ImageGenerationConfig | undefined>(team?.imageGenerationConfig),
    );
  }

  /** 从新的 provider 列表中解析 ProviderEntry */
  private async resolveProviderEntry(
    type: "image" | "video",
    providerId: string | undefined,
    userId: string,
    projectId: string,
    configSource: ImageConfigSource,
  ): Promise<ProviderEntry | undefined> {
    const isPersonal = configSource === "personal";
    let record: { imageProviders?: any; videoProviders?: any; defaultImageProvider?: string | null; defaultVideoProvider?: string | null } | null;

    if (isPersonal) {
      const user = await this.prisma.user.findUnique({ where: { id: userId } });
      record = user ? {
        imageProviders: jsonOutput<any>(user.imageProviders),
        videoProviders: jsonOutput<any>(user.videoProviders),
        defaultImageProvider: user.defaultImageProvider,
        defaultVideoProvider: user.defaultVideoProvider,
      } : null;
    } else {
      const project = await this.prisma.project.findUnique({ where: { id: projectId } });
      if (!project) throw new NotFoundException("Project not found");
      const team = await this.prisma.team.findUnique({ where: { id: project.teamId } });
      record = team ? {
        imageProviders: jsonOutput<any>(team.imageProviders),
        videoProviders: jsonOutput<any>(team.videoProviders),
        defaultImageProvider: team.defaultImageProvider,
        defaultVideoProvider: team.defaultVideoProvider,
      } : null;
    }

    if (!record) return undefined;

    const providers: ProviderEntry[] | undefined = type === "image" ? record.imageProviders : record.videoProviders;
    const defaultId = type === "image" ? record.defaultImageProvider : record.defaultVideoProvider;

    if (!providers?.length) return undefined;

    if (providerId) {
      return providers.find((p) => p.id === providerId);
    }

    if (defaultId) {
      return providers.find((p) => p.id === defaultId);
    }

    return providers[0];
  }

  /** 将 ProviderEntry 转换为 ImageGenerationConfig（兼容现有 provider 实例） */
  private providerEntryToConfig(entry: ProviderEntry): ImageGenerationConfig {
    return {
      provider: entry.provider as ImageGenerationProvider,
      apiKey: entry.apiKey,
      baseUrl: entry.baseUrl,
      model: entry.model,
      sdConfig: entry.sdConfig,
      comfyuiConfig: entry.comfyuiConfig,
      grokConfig: entry.grokConfig,
    };
  }

  /** 将 ProviderEntry 转换为 VideoProviderConfig（适配器路由用） */
  private providerEntryToVideoProviderConfig(entry: ProviderEntry): VideoProviderConfig {
    return {
      provider: entry.provider as VideoGenerationProvider,
      apiKey: entry.apiKey,
      baseUrl: entry.baseUrl,
      model: entry.model,
    };
  }

  private async resolveImageExecution(job: JobRecord<MediaJobInput>): Promise<ResolvedImageExecution> {
    if (!job.input.configSource) {
      if (job.input.referenceImageAssetId) {
        throw new BadRequestException("Reference-image editing requires selecting a team or personal image config.");
      }

      return {
        providerKind: "legacy-openai",
      };
    }

    // 优先从新 provider 列表解析
    let config: ImageGenerationConfig | undefined;
    const entry = await this.resolveProviderEntry("image", job.input.providerId, job.createdBy, job.projectId, job.input.configSource);
    if (entry) {
      config = this.providerEntryToConfig(entry);
    } else {
      config = await this.resolveImageGenerationConfig(job.createdBy, job.projectId, job.input.configSource);
    }

    const sourceLabel = job.input.configSource === "team" ? "team" : "personal";
    if (!config) {
      throw new BadRequestException(`The ${sourceLabel} image generation config is not set.`);
    }
    const needsApiKey = config.provider === "google-gemini" || config.provider === "openai-compatible" || config.provider === "grok";
    if (needsApiKey && !config.apiKey?.trim()) {
      throw new BadRequestException(`The ${sourceLabel} image generation config is missing an API key.`);
    }
    if (needsApiKey && !config.model?.trim()) {
      throw new BadRequestException(`The ${sourceLabel} image generation config is missing a model.`);
    }
    if (config.provider === "openai-compatible" && !config.baseUrl?.trim()) {
      throw new BadRequestException(`The ${sourceLabel} OpenAI-compatible image config is missing a base URL.`);
    }
    if (config.provider === "grok" && !config.baseUrl?.trim()) {
      throw new BadRequestException(`The ${sourceLabel} Grok image config is missing a base URL.`);
    }

    let referenceImage: ResolvedImageExecution["referenceImage"];
    if (job.input.referenceImageAssetId) {
      if (config.provider !== "google-gemini") {
        throw new BadRequestException("Reference-image editing is currently only available with the Google Nano Banana 2 provider.");
      }

      const asset = await this.storageService.getAssetBuffer(job.createdBy, job.input.referenceImageAssetId);
      referenceImage = {
        assetId: asset.asset.id,
        body: asset.body,
        mimeType: asset.mimeType,
      };
    }

    return {
      providerKind: config.provider,
      configSource: job.input.configSource,
      config,
      model: config.model,
      referenceImage,
    };
  }

  private composeMediaPrompt(preview: PromptPreviewResult | null) {
    if (!preview) {
      return "";
    }

    const positivePrompt = preview.positivePrompt.trim();
    const negativePrompt = preview.negativePrompt.trim();
    return [
      positivePrompt,
      negativePrompt ? `Negative prompt: ${negativePrompt}` : "",
    ].filter(Boolean).join("\n");
  }

  private async composeVideoPromptForJob(job: JobRecord<MediaJobInput>) {
    const preview = await this.promptBuilder.previewVideoPrompt(
      job.projectId,
      job.input.shotId,
      job.input.videoReferenceMode ?? "none",
    );
    return this.composeMediaPrompt(preview);
  }

  private toOpenAiImageLlmConfig(config: ImageGenerationConfig): LlmProviderConfig {
    return {
      provider: "openai-completions",
      apiKey: config.apiKey,
      baseUrl: config.baseUrl,
      model: config.model,
    };
  }

  private toGrokLlmConfig(config: ImageGenerationConfig): LlmProviderConfig {
    return {
      provider: "grok",
      apiKey: config.apiKey,
      baseUrl: config.baseUrl,
      model: config.model || config.grokConfig?.model || "grok-imagine-1.0",
    };
  }

  private async resolveReferenceImageUrl(userId: string, assetId: string): Promise<string | undefined> {
    try {
      const result = await this.storageService.getAssetUrl(userId, assetId);
      return result.url;
    } catch {
      return undefined;
    }
  }

  /** 解析资产为结构化的视频参考图对象，按需附带 Data URL */
  private async resolveVideoReferenceImageStrict(
    userId: string,
    assetId: string,
    label: string,
    includeDataUrl: boolean,
  ): Promise<ResolvedVideoReferenceImage> {
    const urlResult = await this.storageService.getAssetUrl(userId, assetId);
    if (!urlResult.url) {
      throw new BadRequestException(`Video reference ${label} could not be resolved to a URL.`);
    }
    if (!urlResult.asset.mimeType.startsWith("image/")) {
      throw new BadRequestException(`Video reference ${label} must be an image asset.`);
    }

    const resolved: ResolvedVideoReferenceImage = {
      assetId: urlResult.asset.id,
      url: urlResult.url,
      mimeType: urlResult.asset.mimeType,
      sizeInBytes: urlResult.asset.sizeInBytes,
    };

    if (!includeDataUrl) {
      return resolved;
    }

    const bufferResult = await this.storageService.getAssetBuffer(userId, assetId);
    if (!bufferResult.mimeType.startsWith("image/")) {
      throw new BadRequestException(`Video reference ${label} must be an image asset.`);
    }
    const dataUrl = await buildVideoReferenceDataUrl(bufferResult.body, bufferResult.mimeType);
    return {
      ...resolved,
      dataUrl: dataUrl.dataUrl,
      dataUrlMimeType: dataUrl.mimeType,
      dataUrlSizeInBytes: dataUrl.sizeInBytes,
    };
  }

  /** 解析视频参考图资产 ID 为完整结构 */
  private resolveVideoReferences(
    job: JobRecord<MediaJobInput>,
    providerKey: VideoReferenceProviderKey,
  ): Promise<ResolvedVideoReferences> {
    const transport = getVideoReferenceTransport(providerKey);
    return buildResolvedVideoReferences({
      input: {
        shotId: job.input.shotId,
        style: job.input.style,
        aspectRatio: job.input.aspectRatio,
        durationSeconds: job.input.durationSeconds,
        referenceImageAssetId: job.input.referenceImageAssetId,
        providerId: job.input.providerId,
        videoReferenceMode: job.input.videoReferenceMode,
        firstFrameAssetId: job.input.firstFrameAssetId,
        lastFrameAssetId: job.input.lastFrameAssetId,
        referenceImageAssetIds: job.input.referenceImageAssetIds,
      },
      resolveAsset: (assetId, label) =>
        this.resolveVideoReferenceImageStrict(job.createdBy, assetId, label, transport === "data-url"),
    });
  }

  /** 构建归一化的视频 Provider 输入（包含解析后的参考图 URL 字段） */
  private async buildVideoProviderInput(
    job: JobRecord<MediaJobInput>,
    prompt: string,
    providerKey: VideoReferenceProviderKey = "legacy-openai",
  ): Promise<MediaJobInput & {
    prompt: string;
    videoReferenceMode: VideoReferenceMode;
    referenceImageUrl?: string;
    firstFrameUrl?: string;
    lastFrameUrl?: string;
    referenceImageUrls?: string[];
  }> {
    const transport = getVideoReferenceTransport(providerKey);
    const references = await this.resolveVideoReferences(job, providerKey);
    return applyResolvedVideoReferencesToInput({ ...job.input, prompt }, references, transport);
  }

  // ===== TTS Jobs =====

  async listTTSVoices() {
    return { voices: await this.ttsProvider.listVoices() };
  }

  async createTTSJob(
    userId: string,
    shotId: string,
    input: { projectId: string; characterId: string; text: string; configSource?: ImageConfigSource },
  ) {
    await this.assertProjectReadable(userId, input.projectId);
    return this.enqueueJob(userId, {
      type: "tts_generation",
      projectId: input.projectId,
      shotId,
      input: {
        shotId,
        characterId: input.characterId,
        text: input.text,
        projectId: input.projectId,
        configSource: input.configSource,
      },
    });
  }

  async createSceneBatchTTSJobs(
    userId: string,
    sceneId: string,
    input: { projectId: string; shotIds?: string[] },
  ): Promise<BatchJobGroupRecord> {
    await this.assertProjectReadable(userId, input.projectId);

    const storyboardDoc = await this.prisma.document.findFirst({ where: { projectId: input.projectId, type: "storyboard" } });
    const storyboardVersionId = storyboardDoc?.currentVersionId ?? storyboardDoc?.draftVersionId;
    if (!storyboardVersionId) {
      throw new NotFoundException("Storyboard not found for this project");
    }

    const storyboardVersion = await this.prisma.version.findUnique({ where: { id: storyboardVersionId } });
    if (!storyboardVersion?.content || typeof storyboardVersion.content !== "object") {
      throw new NotFoundException("Storyboard content is not available");
    }

    const storyboard = jsonOutput<StoryboardContent>(storyboardVersion.content);
    const allSceneShots = (storyboard.shots ?? []).filter((shot) => shot.sceneId === sceneId);
    if (allSceneShots.length === 0) {
      throw new NotFoundException("No storyboard shots found for this scene");
    }

    const requestedShotIds = input.shotIds?.length
      ? new Set(input.shotIds.filter(Boolean))
      : null;
    const sceneShots = requestedShotIds
      ? allSceneShots.filter((shot) => requestedShotIds.has(shot.id))
      : allSceneShots;

    const eligibleShots = sceneShots.filter((shot) => shot.dialogue?.trim() && shot.characterIds?.[0]);
    if (eligibleShots.length === 0) {
      throw new BadRequestException("No eligible shots with dialogue and character voice targets were found for this scene");
    }

    const jobIds: string[] = [];
    for (const shot of eligibleShots) {
      const job = await this.createTTSJob(userId, shot.id, {
        projectId: input.projectId,
        characterId: shot.characterIds![0],
        text: shot.dialogue!.trim(),
      });
      jobIds.push(job.id);
    }

    const batchResult = await this.prisma.$transaction(async (tx) => {
      const batchId = createId("batch");
      const group: BatchJobGroupRecord = {
        id: batchId,
        projectId: input.projectId,
        jobIds,
        status: "running",
        createdBy: userId,
        createdAt: new Date().toISOString(),
      };

      await tx.batchJobGroup.create({
        data: {
          id: batchId,
          projectId: input.projectId,
          jobIds,
          status: "running",
          createdBy: userId,
        },
      });

      const updatedJobs: JobRecord[] = [];
      for (const jId of jobIds) {
        const updated = await tx.job.update({
          where: { id: jId },
          data: { batchId, priority: "normal", updatedAt: new Date() },
        });
        updatedJobs.push(this.toJobRecord(updated));
      }

      return { group, updatedJobs };
    });

    batchResult.updatedJobs.forEach((job) => this.emitJobUpdated(job));
    return batchResult.group;
  }

  private async processTTSJob(job: JobRecord<GenerateTTSInput>) {
    await this.markJobRunning(job.id, { progress: 10 });

    const llmConfig = await this.resolveLlmConfig(job.createdBy, job.projectId, job.input.configSource);
    const voiceConfig = await this.resolveTTSVoice(job.projectId, job.input.characterId, llmConfig);
    const result = await this.ttsProvider.synthesize(
      {
        text: job.input.text,
        voiceId: voiceConfig.voiceId,
        speed: voiceConfig.settings?.speed,
      },
      llmConfig,
    );

    const fileName = `tts_${job.shotId}_${Date.now()}.${result.fileExtension}`;
    const stored = await this.storageService.storeGeneratedAsset(job.createdBy, {
      projectId: job.projectId,
      filename: fileName,
      contentType: result.mimeType,
      body: result.audioBuffer,
    });

    const document = await this.workspaceService.ensureDocumentForProject({
      projectId: job.projectId,
      type: "audio",
      title: `Audio - ${job.shotId}`,
      createdBy: job.createdBy,
      shotId: job.shotId,
    });

    const audioContent = {
      assetId: stored.asset.id,
      assetUrl: stored.url,
      mimeType: result.mimeType,
      duration: result.duration,
      characterId: job.input.characterId,
      voiceId: voiceConfig.voiceId,
      voiceName: voiceConfig.voiceName,
      ttsProvider: voiceConfig.ttsProvider,
    };

    const version = await this.workspaceService.createVersionForDocument({
      documentId: document.id,
      title: `TTS ${job.shotId}`,
      content: audioContent,
      metadata: {
        source: "tts",
        characterId: job.input.characterId,
        voiceId: voiceConfig.voiceId,
        voiceName: voiceConfig.voiceName,
        ttsProvider: voiceConfig.ttsProvider,
      },
      createdBy: job.createdBy,
      status: "approved",
    });

    return this.completeJob(job.id, {
      documentId: document.id,
      versionId: version.id,
      assetId: stored.asset.id,
      assetUrl: stored.url,
      mimeType: result.mimeType,
      duration: result.duration,
      characterId: job.input.characterId,
      voiceId: voiceConfig.voiceId,
      voiceName: voiceConfig.voiceName,
      ttsProvider: voiceConfig.ttsProvider,
    });
  }

  /** 根据项目ID和文档类型查找当前版本引用 */
  private async getCurrentVersionReference(projectId: string, type: DocumentType) {
    const document = await this.prisma.document.findFirst({ where: { projectId, type } });
    if (!document?.currentVersionId) return null;
    const version = await this.prisma.version.findUnique({ where: { id: document.currentVersionId } });
    return document && version ? { document, version } : null;
  }

  private async resolveTTSVoice(
    projectId: string,
    characterId: string,
    llmConfig?: LlmProviderConfig,
  ) {
    const [rawWorldBible, availableVoices] = await Promise.all([
      (async () => {
        const worldBibleDoc = await this.prisma.document.findFirst({ where: { projectId, type: "world_bible" } });
        if (!worldBibleDoc?.currentVersionId) return null;
        const version = await this.prisma.version.findUnique({ where: { id: worldBibleDoc.currentVersionId } });
        if (!version?.content || typeof version.content !== "object") return null;
        return jsonOutput<WorldBibleContent>(version.content);
      })(),
      this.ttsProvider.listVoices(llmConfig),
    ]);
    const worldBible = rawWorldBible;

    const savedVoice = worldBible?.voiceConfigs?.find((config) => config.characterId === characterId);
    if (savedVoice) {
      const matchedVoice = availableVoices.find((voice) => voice.id === savedVoice.voiceId);
      return {
        ...savedVoice,
        voiceName: matchedVoice?.name ?? savedVoice.voiceName,
        ttsProvider: matchedVoice?.provider ?? savedVoice.ttsProvider,
      };
    }

    const fallbackVoice = availableVoices[0];
    return {
      characterId,
      ttsProvider: fallbackVoice?.provider ?? "default",
      voiceId: fallbackVoice?.id ?? "default",
      voiceName: fallbackVoice?.name ?? "Default Voice",
    };
  }

  // ===== Export Jobs =====

  async createExportJob(
    userId: string,
    projectId: string,
    input: { resolution: string; fps: number; bitrate?: string; format: import("@dramaflow/shared").ExportFormat; allowMockFallback?: boolean },
  ) {
    await this.workspaceService.assertProjectPermission(
      userId,
      projectId,
      "export.create",
      "You do not have permission to export this project",
    );
    return this.enqueueJob(userId, {
      type: "export_video",
      projectId,
      input: { projectId, ...input },
    });
  }

  // ===== Shot Composition Jobs =====

  async createShotCompositionJob(
    userId: string,
    shotId: string,
    input: Omit<ComposeShotInput, "shotId">,
  ) {
    await this.workspaceService.assertProjectPermission(
      userId,
      input.projectId,
      "job.manage",
      "You do not have permission to create shot composition jobs",
    );
    const resolved = await this.resolveShotCompositionInput(input.projectId, shotId);
    if (!resolved.videoVersionId || !resolved.videoAssetUrl) {
      throw new BadRequestException("Shot video is required before composition");
    }
    return this.enqueueJob(userId, {
      type: "shot_composition",
      projectId: input.projectId,
      shotId,
      input: {
        ...input,
        shotId,
        resolution: input.resolution || "1080x1920",
        fps: input.fps || 30,
        format: input.format || "mp4",
      },
    });
  }

  private async resolveShotCompositionInput(projectId: string, shotId: string): Promise<ResolvedShotCompositionInput> {
    const storyboardDocument = await this.prisma.document.findFirst({ where: { projectId, type: "storyboard" } });
    const storyboardVersionId = storyboardDocument?.currentVersionId ?? storyboardDocument?.draftVersionId;
    const storyboardVersion = storyboardVersionId
      ? await this.prisma.version.findUnique({ where: { id: storyboardVersionId } })
      : undefined;
    const storyboard = storyboardVersion ? jsonOutput<StoryboardContent | undefined>(storyboardVersion.content) : undefined;
    const shot = storyboard?.shots?.find((item) => item.id === shotId);
    if (!shot) {
      throw new NotFoundException("Storyboard shot not found");
    }

    const binding = (storyboard?.mediaBindings?.[shotId] ?? {}) as ShotMediaBinding;
    const [videoDocument, audioDocument] = await Promise.all([
      this.prisma.document.findFirst({ where: { projectId, type: "video", shotId } }),
      this.prisma.document.findFirst({ where: { projectId, type: "audio", shotId } }),
    ]);
    const videoVersionId = binding.videoVersionId ?? videoDocument?.currentVersionId;
    const audioVersionId = binding.audioVersionId ?? audioDocument?.currentVersionId;
    const [videoVersion, audioVersion] = await Promise.all([
      videoVersionId ? this.prisma.version.findUnique({ where: { id: videoVersionId } }) : Promise.resolve(null),
      audioVersionId ? this.prisma.version.findUnique({ where: { id: audioVersionId } }) : Promise.resolve(null),
    ]);
    const videoContent = videoVersion ? jsonOutput<MediaContent | undefined>(videoVersion.content) : undefined;
    const audioContent = audioVersion ? jsonOutput<{ assetUrl?: string; duration?: number } | undefined>(audioVersion.content) : undefined;

    return {
      storyboardVersionId: storyboardVersion?.id,
      shotHash: this.impactService.stableHash(shot),
      duration: Number(shot.durationSeconds || audioContent?.duration || 3),
      subtitleText: binding.subtitle?.trim() || shot.dialogue?.trim() || undefined,
      videoVersionId: videoVersionId ?? undefined,
      videoAssetUrl: typeof videoContent?.assetUrl === "string" ? videoContent.assetUrl : undefined,
      audioVersionId: audioVersionId ?? undefined,
      audioAssetUrl: typeof audioContent?.assetUrl === "string" ? audioContent.assetUrl : undefined,
    };
  }

  private async processShotCompositionJob(job: JobRecord<ComposeShotInput>) {
    await this.markJobRunning(job.id, { progress: 5 });
    const resolved = await this.resolveShotCompositionInput(job.projectId, job.shotId!);
    if (!resolved.videoVersionId || !resolved.videoAssetUrl) {
      throw new BadRequestException("Shot video is required before composition");
    }

    const rendered = await this.exportService.composeShot(
      job.createdBy,
      {
        projectId: job.projectId,
        shotId: job.shotId!,
        videoAssetUrl: resolved.videoAssetUrl,
        audioAssetUrl: resolved.audioAssetUrl,
        subtitleText: resolved.subtitleText,
        duration: resolved.duration,
        resolution: job.input.resolution,
        fps: job.input.fps,
        format: job.input.format,
        allowMockFallback: job.input.allowMockFallback,
      },
      (percent) => {
        void this.markJobRunning(job.id, { progress: percent });
      },
    );

    const document = await this.workspaceService.ensureDocumentForProject({
      projectId: job.projectId,
      type: "video",
      title: `合成镜头 - ${job.shotId}`,
      createdBy: job.createdBy,
      shotId: job.shotId,
    });

    const version = await this.workspaceService.createGeneratedVersionForDocument({
      userId: job.createdBy,
      documentId: document.id,
      title: `合成镜头 ${job.shotId}`,
      content: {
        prompt: "",
        assetId: rendered.assetId,
        assetUrl: rendered.assetUrl,
        provider: "ffmpeg",
        mimeType: rendered.mimeType,
        parameters: {
          resolution: job.input.resolution,
          fps: job.input.fps,
          format: job.input.format,
        },
        mode: rendered.mode,
      },
      metadata: {
        source: "shot_composition",
        sourceJobId: job.id,
        shotId: job.shotId,
        sourceVideoVersionId: resolved.videoVersionId,
        sourceAudioVersionId: resolved.audioVersionId,
        sourceSubtitle: resolved.subtitleText,
        sourceStoryboardVersionId: resolved.storyboardVersionId,
        sourceShotHash: resolved.shotHash,
        mode: rendered.mode,
        fileSize: rendered.fileSize,
      },
    });

    const result: ComposeShotResult = {
      documentId: document.id,
      versionId: version.id,
      assetId: rendered.assetId,
      assetUrl: rendered.assetUrl,
      mimeType: rendered.mimeType,
      duration: rendered.duration,
      mode: rendered.mode,
    };

    return this.completeJob(job.id, result as unknown as Record<string, unknown>);
  }

  private async processExportJob(job: JobRecord<ExportTimelineInput>) {
    await this.markJobRunning(job.id, { progress: 0 });

    const timeline = await this.workspaceService.getTimeline(job.createdBy, job.projectId);

    const onProgress = async (percent: number) => {
      await this.markJobRunning(job.id, { progress: percent });
    };

    const exportRecord = await this.exportService.exportTimeline(
      job.createdBy,
      timeline,
      job.input,
      job.id,
      onProgress,
    );

    const finalStatus = exportRecord.status === "completed" ? "completed" : "failed";
    const finalJob = await this.mutateJobState(job.id, (liveJob) => {
      liveJob.status = finalStatus;
      liveJob.progress = finalStatus === "completed" ? 100 : undefined;
      liveJob.result = { exportId: exportRecord.id, outputUrl: exportRecord.outputUrl };
      liveJob.error = finalStatus === "failed" ? "Export failed" : undefined;
    });
    if (finalJob.changed) {
      this.emitJobUpdated(finalJob.job);
    }

    this.notificationService.createNotification({
      userId: job.createdBy,
      projectId: job.projectId,
      type: finalStatus === "completed" ? "task_completed" : "task_failed",
      title: finalStatus === "completed" ? "Video export completed" : "Video export failed",
      body: `Project exported as ${job.input.format}`,
      referenceId: job.id,
      referenceType: "job",
    });
  }

  private async processNovelImportJob(job: JobRecord<NovelImportJobInput>) {
    const result = await this.novelImportService.processJob(
      job,
      (uid, pid, source) => this.resolveTextLlmConfig(uid, pid, source).then((config) => {
        if (!config) {
          throw new Error("LLM config is not available");
        }
        return config;
      }),
      (system, messages, config) => this.textProvider.streamChat(system, messages, config),
    );

    return this.completeJob(job.id, result);
  }

  // ===== SSE Streaming Methods =====

  async *streamScriptJob(
    userId: string,
    projectId: string,
    input: GenerateScriptInput,
    llmConfigSource?: LlmConfigSource,
  ): AsyncGenerator<StreamChunk> {
    await this.assertProjectReadable(userId, projectId);
    const job = await this.enqueueJob(userId, {
      type: "script_generation",
      projectId,
      input: { ...input, llmConfigSource },
    });

    await this.markJobRunning(job.id);

    try {
      const config = await this.resolveTextLlmConfig(userId, projectId, llmConfigSource);
      const resolvedModel = this.resolveTextModel(config);
      let finalResult: ScriptContent | undefined;

      // Inject synopsis context if a source version was provided
      const enrichedInput = { ...input };
      if (input.sourceSynopsisVersionId) {
        const synopsisVersion = await this.prisma.version.findUnique({ where: { id: input.sourceSynopsisVersionId } });
        if (synopsisVersion) {
          const synopsisContent = typeof synopsisVersion.content === "string"
            ? synopsisVersion.content
            : JSON.stringify(synopsisVersion.content, null, 2);
          enrichedInput.premise = `${input.premise}\n\n---\nSynopsis reference:\n${synopsisContent}`;
        }
      }

      // Inject world bible context
      const worldBible = await this.getWorldBible(userId, projectId);
      const worldBibleRef = await this.getCurrentVersionReference(projectId, "world_bible");
      if (worldBible) {
        const wbPrompt = this.formatWorldBiblePrompt(worldBible);
        enrichedInput.premise = `${enrichedInput.premise}\n${wbPrompt}`;
      }

      for await (const chunk of this.textProvider.generateScriptStream(enrichedInput, config)) {
        yield chunk;
        if (chunk.type === "done" && chunk.result) {
          finalResult = chunk.result as ScriptContent;
        }
      }

      if (finalResult) {
        const enrichedResult = await this.autoMatchWorldBible(projectId, finalResult);
        const document = await this.workspaceService.ensureDocumentForProject({
          projectId,
          type: "script",
          title: `${input.title} 剧本`,
          createdBy: userId,
        });
        const version = await this.workspaceService.createVersionForDocument({
          documentId: document.id,
          title: `${input.title} - AI 初稿`,
          content: enrichedResult,
          metadata: {
            sourceJobId: job.id,
            provider: resolvedModel,
            model: resolvedModel,
            ...(llmConfigSource ? { llmConfigSource } : {}),
            ...(worldBibleRef?.version.id ? { sourceWorldBibleVersionId: worldBibleRef.version.id } : {}),
            ...(input.sourceSynopsisVersionId ? { sourceSynopsisVersionId: input.sourceSynopsisVersionId } : {}),
            promptSnapshot: createPromptSnapshot({
              contractId: SCRIPT_GENERATION_CONTRACT.id,
              contractVersion: SCRIPT_GENERATION_CONTRACT.version,
              provider: resolvedModel,
              model: resolvedModel,
              inputSummary: JSON.stringify({ title: enrichedInput.title, premise: enrichedInput.premise?.slice(0, 200) }),
              schemaVersion: SCRIPT_GENERATION_CONTRACT.schema?.id,
            }),
          },
          createdBy: userId,
          status: "approved",
        });

        await this.completeJob(job.id, {
          documentId: document.id,
          versionId: version.id,
          content: enrichedResult,
          model: resolvedModel,
          ...(llmConfigSource ? { llmConfigSource } : {}),
        });

        yield {
          type: "done",
          result: {
            jobId: job.id,
            documentId: document.id,
            versionId: version.id,
            content: enrichedResult,
            model: resolvedModel,
            ...(llmConfigSource ? { llmConfigSource } : {}),
          },
        };
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      await this.failJob(job.id, message);
      yield { type: "error", error: message };
    }
  }

  async *streamSynopsisJob(
    userId: string,
    projectId: string,
    input: GenerateSynopsisInput,
    llmConfigSource?: LlmConfigSource,
  ): AsyncGenerator<StreamChunk> {
    await this.assertProjectReadable(userId, projectId);
    const job = await this.enqueueJob(userId, {
      type: "synopsis_generation",
      projectId,
      input: { ...input, llmConfigSource },
    });

    await this.markJobRunning(job.id);

    try {
      const config = await this.resolveTextLlmConfig(userId, projectId, llmConfigSource);
      const resolvedModel = this.resolveTextModel(config);
      const worldBible = await this.getWorldBible(userId, projectId);
      const worldBibleRef = await this.getCurrentVersionReference(projectId, "world_bible");
      const enrichedInput = { ...input };
      if (worldBible) {
        const wbPrompt = this.formatWorldBiblePrompt(worldBible);
        enrichedInput.constraints = [input.constraints, wbPrompt].filter(Boolean).join("\n");
      }
      let finalResult: string | undefined;

      for await (const chunk of this.textProvider.generateSynopsisStream(enrichedInput, config)) {
        yield chunk;
        if (chunk.type === "done" && chunk.result) {
          finalResult = chunk.result as string;
        }
      }

      if (finalResult) {
        const document = await this.workspaceService.ensureDocumentForProject({
          projectId,
          type: "synopsis",
          title: `${input.title} 大纲`,
          createdBy: userId,
        });

        const version = await this.workspaceService.createVersionForDocument({
          documentId: document.id,
          title: `${input.title} - AI 大纲`,
          content: finalResult,
          metadata: {
            sourceJobId: job.id,
            provider: resolvedModel,
            model: resolvedModel,
            ...(llmConfigSource ? { llmConfigSource } : {}),
            ...(worldBibleRef?.version.id ? { sourceWorldBibleVersionId: worldBibleRef.version.id } : {}),
            promptSnapshot: JSON.stringify(enrichedInput),
          },
          createdBy: userId,
          status: "approved",
        });

        await this.completeJob(job.id, {
          synopsis: finalResult,
          documentId: document.id,
          versionId: version.id,
          model: resolvedModel,
          ...(llmConfigSource ? { llmConfigSource } : {}),
        });
        yield {
          type: "done",
          result: {
            jobId: job.id,
            synopsis: finalResult,
            documentId: document.id,
            versionId: version.id,
            model: resolvedModel,
            ...(llmConfigSource ? { llmConfigSource } : {}),
          },
        };
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      await this.failJob(job.id, message);
      yield { type: "error", error: message };
    }
  }

  async *streamStoryboardJob(
    userId: string,
    projectId: string,
    input: GenerateStoryboardInput,
    llmConfigSource?: LlmConfigSource,
  ): AsyncGenerator<StreamChunk> {
    await this.assertProjectReadable(userId, projectId);
    const job = await this.enqueueJob(userId, {
      type: "storyboard_generation",
      projectId,
      documentId: input.documentId,
      input: { ...input, llmConfigSource },
    });

    await this.markJobRunning(job.id);

    try {
      const rawScriptVersion = await this.prisma.version.findUnique({ where: { id: input.versionId } });
      if (!rawScriptVersion) {
        throw new Error("Source script version not found");
      }

      const scriptVersion = jsonOutput<VersionRecord>(rawScriptVersion);

      const script = scriptVersion.content as ScriptContent;
      const config = await this.resolveTextLlmConfig(userId, projectId, llmConfigSource);
      const resolvedModel = this.resolveTextModel(config);
      const worldBible = await this.getWorldBible(userId, projectId);
      const worldBibleRef = await this.getCurrentVersionReference(projectId, "world_bible");
      const enrichedStoryboardInput = { ...input };
      if (worldBible && (worldBible.characters.length > 0 || worldBible.locations.length > 0 || worldBible.styleGuide?.visualStyle)) {
        const wbParts: string[] = [input.cinematicStyle, "", "## 项目世界观"];
        if (worldBible.characters.length > 0) {
          wbParts.push(`角色：${worldBible.characters.map((c) => `${c.name} (id: "${c.id}")`).join("；")}`);
        }
        if (worldBible.locations.length > 0) {
          wbParts.push(`场景：${worldBible.locations.map((l) => `${l.name}（${l.description}）`).join("；")}`);
        }
        if (worldBible.styleGuide?.visualStyle) {
          wbParts.push(`风格：${worldBible.styleGuide.visualStyle}`);
        }
        if (worldBible.characters.length > 0) {
          wbParts.push("", `IMPORTANT: For each shot, populate characterIds with the actual character IDs listed above. Only include characters who appear in the shot.`);
        }
        enrichedStoryboardInput.cinematicStyle = wbParts.filter(Boolean).join("\n");
      }
      let finalResult: import("@dramaflow/shared").StoryboardContent | undefined;

      for await (const chunk of this.textProvider.generateStoryboardStream({ ...enrichedStoryboardInput, script }, config)) {
        yield chunk;
        if (chunk.type === "done" && chunk.result) {
          finalResult = chunk.result as import("@dramaflow/shared").StoryboardContent;
        }
      }

      if (finalResult) {
        const document = await this.workspaceService.ensureDocumentForProject({
          projectId,
          type: "storyboard",
          title: "AI 分镜",
          createdBy: userId,
        });
        const version = await this.workspaceService.createVersionForDocument({
          documentId: input.documentId || document.id,
          title: "AI 分镜初稿",
          content: finalResult,
          metadata: {
            sourceJobId: job.id,
            sourceScriptVersionId: input.versionId,
            provider: resolvedModel,
            model: resolvedModel,
            ...(llmConfigSource ? { llmConfigSource } : {}),
            ...(worldBibleRef?.version.id ? { sourceWorldBibleVersionId: worldBibleRef.version.id } : {}),
            promptSnapshot: createPromptSnapshot({
              contractId: STORYBOARD_GENERATION_CONTRACT.id,
              contractVersion: STORYBOARD_GENERATION_CONTRACT.version,
              provider: resolvedModel,
              model: resolvedModel,
              inputSummary: JSON.stringify({ cinematicStyle: enrichedStoryboardInput.cinematicStyle, shotDensity: enrichedStoryboardInput.shotDensity }),
              schemaVersion: STORYBOARD_GENERATION_CONTRACT.schema?.id,
            }),
          },
          createdBy: userId,
          status: "approved",
        });

        await this.completeJob(job.id, {
          documentId: version.documentId,
          versionId: version.id,
          content: finalResult,
          model: resolvedModel,
          ...(llmConfigSource ? { llmConfigSource } : {}),
        });

        yield {
          type: "done",
          result: {
            jobId: job.id,
            documentId: version.documentId,
            versionId: version.id,
            content: finalResult,
            model: resolvedModel,
            ...(llmConfigSource ? { llmConfigSource } : {}),
          },
        };
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      await this.failJob(job.id, message);
      yield { type: "error", error: message };
    }
  }

  async *streamRewriteJob(
    userId: string,
    projectId: string,
    input: RewriteSegmentInput,
    llmConfigSource?: LlmConfigSource,
  ): AsyncGenerator<StreamChunk> {
    await this.assertProjectReadable(userId, projectId);
    const job = await this.enqueueJob(userId, {
      type: "rewrite_segment",
      projectId,
      documentId: input.documentId,
      input: { ...input, llmConfigSource },
    });

    await this.markJobRunning(job.id);

    try {
      const config = await this.resolveTextLlmConfig(userId, projectId, llmConfigSource);
      let finalResult: string | undefined;

      for await (const chunk of this.textProvider.rewriteSegmentStream(input, config)) {
        yield chunk;
        if (chunk.type === "done" && chunk.result) {
          finalResult = chunk.result as string;
        }
      }

      if (finalResult) {
        await this.completeJob(job.id, {
          rewrittenText: finalResult,
          originalText: input.originalText,
          instruction: input.instruction,
          model: this.resolveTextModel(config),
          ...(llmConfigSource ? { llmConfigSource } : {}),
        });

        yield {
          type: "done",
          result: {
            jobId: job.id,
            rewrittenText: finalResult,
            model: this.resolveTextModel(config),
            ...(llmConfigSource ? { llmConfigSource } : {}),
          },
        };
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      await this.failJob(job.id, message);
      yield { type: "error", error: message };
    }
  }
}
