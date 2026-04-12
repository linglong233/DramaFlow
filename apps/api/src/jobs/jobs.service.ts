import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import type {
  BatchJobGroupRecord,
  CreateImageJobPayload,
  ExportTimelineInput,
  GenerateMediaInput,
  GenerateScriptInput,
  GenerateStoryboardInput,
  GenerateSynopsisInput,
  GenerateTTSInput,
  ImageConfigSource,
  ImageGenerationConfig,
  JobRecord,
  LlmConfigSource,
  JobStatus,
  JobType,
  LlmProviderConfig,
  MediaContent,
  PromptPreviewResult,
  RewriteSegmentInput,
  ScriptContent,
  StoryboardContent,
  WorldBibleContent,
} from "@dramaflow/shared";

import { DevDatabaseService } from "../common/dev-database.service";
import { createId } from "../common/id";
import { NotificationService } from "../notifications/notification.service";
import { RealtimeEventsService } from "../realtime/realtime.events.service";
import { StorageService } from "../storage/storage.service";
import { WorkspaceService } from "../workspace/workspace.service";
import { GoogleGeminiImageProvider } from "./google-gemini-image.provider";
import { OpenAiMediaProvider } from "./media-generation.provider";
import { SdWebuiImageProvider } from "./sd-webui-image.provider";
import { ComfyuiImageProvider } from "./comfyui-image.provider";
import { PromptBuilderService } from "./prompt-builder.service";
import { OpenAiCompatTextProvider, StreamChunk } from "./text-generation.provider";
import { TTSProviderService } from "./tts.provider";
import { ExportService } from "./export.service";

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
  providerKind: "legacy-openai" | "google-gemini" | "openai-compatible" | "stable-diffusion" | "comfyui";
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
    @Inject(DevDatabaseService) private readonly database: DevDatabaseService,
    @Inject(WorkspaceService) private readonly workspaceService: WorkspaceService,
    @Inject(StorageService) private readonly storageService: StorageService,
    @Inject(OpenAiCompatTextProvider) private readonly textProvider: OpenAiCompatTextProvider,
    @Inject(OpenAiMediaProvider) private readonly mediaProvider: OpenAiMediaProvider,
    @Inject(GoogleGeminiImageProvider) private readonly googleGeminiImageProvider: GoogleGeminiImageProvider,
    @Inject(SdWebuiImageProvider) private readonly sdWebuiProvider: SdWebuiImageProvider,
    @Inject(ComfyuiImageProvider) private readonly comfyuiProvider: ComfyuiImageProvider,
    @Inject(PromptBuilderService) private readonly promptBuilder: PromptBuilderService,
    @Inject(NotificationService) private readonly notificationService: NotificationService,
    @Inject(RealtimeEventsService) private readonly realtimeEvents: RealtimeEventsService,
    @Inject(TTSProviderService) private readonly ttsProvider: TTSProviderService,
    @Inject(ExportService) private readonly exportService: ExportService,
  ) {}

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

  async getJob(userId: string, jobId: string) {
    const job = await this.database.query((db) => db.jobs.find((item) => item.id === jobId));
    if (!job) {
      throw new NotFoundException("Job not found");
    }
    await this.assertProjectReadable(userId, job.projectId);
    return job;
  }

  async listProjectJobs(
    userId: string,
    projectId: string,
    options: { status?: JobStatus; type?: JobType; batchId?: string; limit?: number; offset?: number } = {},
  ): Promise<{ jobs: JobRecord[]; total: number }> {
    await this.assertProjectReadable(userId, projectId);

    return this.database.query((db) => {
      let items = db.jobs.filter((j) => j.projectId === projectId);

      if (options.status) {
        items = items.filter((j) => j.status === options.status);
      }
      if (options.type) {
        items = items.filter((j) => j.type === options.type);
      }
      if (options.batchId) {
        items = items.filter((j) => j.batchId === options.batchId);
      }

      items.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));

      const total = items.length;
      const offset = options.offset ?? 0;
      const limit = options.limit ?? 50;
      const jobs = items.slice(offset, offset + limit);

      return { jobs, total };
    });
  }

  async cancelJob(userId: string, jobId: string): Promise<JobRecord> {
    const job = await this.database.query((db) => db.jobs.find((item) => item.id === jobId));
    if (!job) {
      throw new NotFoundException("Job not found");
    }
    await this.assertProjectReadable(userId, job.projectId);

    if (job.status !== "queued") {
      throw new BadRequestException("Only queued jobs can be cancelled");
    }

    const cancelled = await this.mutateJobState(jobId, (liveJob) => {
      liveJob.status = "failed";
      liveJob.error = "Cancelled by user";
      liveJob.cancelledAt = new Date().toISOString();
    });
    if (cancelled.changed) {
      this.emitJobUpdated(cancelled.job);
    }
    return cancelled.job;
  }

  async retryJob(userId: string, jobId: string): Promise<JobRecord> {
    const job = await this.database.query((db) => db.jobs.find((item) => item.id === jobId));
    if (!job) {
      throw new NotFoundException("Job not found");
    }
    await this.assertProjectReadable(userId, job.projectId);

    if (job.status !== "failed") {
      throw new BadRequestException("Only failed jobs can be retried");
    }

    const maxRetries = job.maxRetries ?? 3;
    const retryCount = (job.retryCount ?? 0) + 1;
    if (retryCount > maxRetries) {
      throw new BadRequestException(`Maximum retry count (${maxRetries}) exceeded`);
    }

    const retried = await this.mutateJobState(jobId, (liveJob) => {
      liveJob.status = "queued";
      liveJob.error = undefined;
      liveJob.progress = undefined;
      liveJob.retryCount = retryCount;
      liveJob.cancelledAt = undefined;
    });
    if (retried.changed) {
      this.emitJobUpdated(retried.job);
    }
    return retried.job;
  }

  async createBatchImageJobs(
    userId: string,
    projectId: string,
    shotIds: string[],
  ): Promise<BatchJobGroupRecord> {
    await this.assertProjectReadable(userId, projectId);

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
        input: { projectId, style: "cinematic", aspectRatio: "16:9" },
      });
      if (job.batchId === undefined) {
        // Will set batchId after creating the batch group
        jobIds.push(job.id);
      }
    }

    const batchResult = await this.database.mutate((db) => {
      const batchId = createId("batch");
      const group: BatchJobGroupRecord = {
        id: batchId,
        projectId,
        jobIds,
        status: "running",
        createdBy: userId,
        createdAt: new Date().toISOString(),
      };
      const updatedJobs: JobRecord[] = [];
      db.batchJobs.push(group);

      // Tag each job with the batchId
      for (const jobId of jobIds) {
        const job = db.jobs.find((j) => j.id === jobId);
        if (job) {
          job.batchId = batchId;
          job.priority = job.priority ?? "normal";
          updatedJobs.push(job);
        }
      }

      return { group, updatedJobs };
    });

    batchResult.updatedJobs.forEach((job) => this.emitJobUpdated(job));
    return batchResult.group;
  }

  async createBatchVideoJobs(
    userId: string,
    projectId: string,
    shotIds: string[],
  ): Promise<BatchJobGroupRecord> {
    await this.assertProjectReadable(userId, projectId);

    const uniqueShotIds = Array.from(new Set(shotIds.filter(Boolean)));
    if (uniqueShotIds.length === 0) {
      throw new BadRequestException("At least one storyboard shot is required to create a batch video job");
    }

    const jobIds: string[] = [];
    for (const shotId of uniqueShotIds) {
      const job = await this.enqueueJob(userId, {
        type: "video_generation",
        projectId,
        shotId,
        input: { projectId, style: "cinematic", aspectRatio: "16:9" },
      });
      jobIds.push(job.id);
    }

    const batchResult = await this.database.mutate((db) => {
      const batchId = createId("batch");
      const group: BatchJobGroupRecord = {
        id: batchId,
        projectId,
        jobIds,
        status: "running",
        createdBy: userId,
        createdAt: new Date().toISOString(),
      };
      const updatedJobs: JobRecord[] = [];
      db.batchJobs.push(group);

      for (const jobId of jobIds) {
        const job = db.jobs.find((j) => j.id === jobId);
        if (job) {
          job.batchId = batchId;
          job.priority = job.priority ?? "normal";
          updatedJobs.push(job);
        }
      }

      return { group, updatedJobs };
    });

    batchResult.updatedJobs.forEach((job) => this.emitJobUpdated(job));
    return batchResult.group;
  }

  async getBatchStatus(userId: string, batchId: string) {
    return this.database.query((db) => {
      const batch = db.batchJobs.find((b) => b.id === batchId);
      if (!batch) {
        throw new NotFoundException("Batch not found");
      }

      const jobs = db.jobs.filter((j) => batch.jobIds.includes(j.id));
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
        createdAt: batch.createdAt,
        totalCount,
        completedCount,
        failedCount,
        runningCount,
      };
    });
  }

  async claimNextJob() {
    const result = await this.database.mutate((db) => {
      const now = new Date().toISOString();

      // Sort queued jobs by priority (high > normal > low), then by createdAt (oldest first)
      const priorityOrder: Record<string, number> = { high: 0, normal: 1, low: 2 };
      const queuedJobs = db.jobs
        .filter((item) => item.status === "queued")
        .sort((a, b) => {
          const pa = priorityOrder[a.priority ?? "normal"] ?? 1;
          const pb = priorityOrder[b.priority ?? "normal"] ?? 1;
          if (pa !== pb) return pa - pb;
          return a.createdAt.localeCompare(b.createdAt);
        });

      const queuedJob = queuedJobs[0];
      if (queuedJob) {
        queuedJob.status = "running";
        queuedJob.updatedAt = now;
        return { job: queuedJob, shouldEmit: true };
      }

      const runningVideoJob = db.jobs.find((item) => item.type === "video_generation" && item.status === "running" && this.shouldPollVideoJob(item));
      if (!runningVideoJob) {
        return null;
      }

      runningVideoJob.updatedAt = now;
      return { job: runningVideoJob, shouldEmit: false };
    });

    if (result?.shouldEmit) {
      this.emitJobUpdated(result.job);
    }

    return result?.job ?? null;
  }

  async processJob(jobId: string) {
    const job = await this.database.query((db) => db.jobs.find((item) => item.id === jobId));
    if (!job) {
      throw new NotFoundException("Job not found");
    }

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
        case "tts_generation":
          return await this.processTTSJob(job as unknown as JobRecord<GenerateTTSInput>);
        case "export_video":
          return await this.processExportJob(job as unknown as JobRecord<ExportTimelineInput>);
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
    const content = await this.textProvider.generateScript(job.input, config);
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
    const synopsisText = await this.textProvider.generateSynopsis(job.input, config);

    const document = await this.workspaceService.ensureDocumentForProject({
      projectId: job.projectId,
      type: "script",
      title: `${job.input.title} 剧本`,
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

  private async processStoryboardJob(job: JobRecord<StoryboardJobInput>) {
    const scriptVersion = await this.database.query((db) =>
      db.versions.find((item) => item.id === job.input.versionId),
    );
    if (!scriptVersion) {
      throw new NotFoundException("Source script version not found");
    }

    const script = scriptVersion.content as ScriptContent;
    const config = await this.resolveTextLlmConfig(job.createdBy, job.projectId, job.input.llmConfigSource);
    const resolvedModel = this.resolveTextModel(config);
    const content = await this.textProvider.generateStoryboard({
      ...job.input,
      script,
    }, config);
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
      || this.composeImagePrompt(promptPreview)
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
    } else {
      const config = await this.resolveLlmConfig(job.createdBy, job.projectId);
      generated = await this.mediaProvider.generateImage({ ...job.input, prompt }, config) as GeneratedMediaResult;
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

  async generateImageFromPrompt(
    userId: string,
    projectId: string,
    prompt: string,
    configSource: ImageConfigSource,
  ): Promise<{ buffer: Buffer; mimeType: string; provider: string; model?: string }> {
    const config = await this.resolveImageGenerationConfig(userId, projectId, configSource);
    const sourceLabel = configSource === "team" ? "team" : "personal";
    if (!config) {
      throw new BadRequestException(`The ${sourceLabel} image generation config is not set.`);
    }
    if (!config.apiKey?.trim()) {
      throw new BadRequestException(`The ${sourceLabel} image generation config is missing an API key.`);
    }
    if (!config.model?.trim()) {
      throw new BadRequestException(`The ${sourceLabel} image generation config is missing a model.`);
    }
    if (config.provider === "openai-compatible" && !config.baseUrl?.trim()) {
      throw new BadRequestException(`The ${sourceLabel} OpenAI-compatible image config is missing a base URL.`);
    }

    const input = { prompt, shotId: "char-ref", style: "portrait", aspectRatio: "1:1" };
    let generated: GeneratedMediaResult;

    if (config.provider === "google-gemini") {
      generated = await this.googleGeminiImageProvider.generateImage(input, config) as GeneratedMediaResult;
    } else if (config.provider === "openai-compatible") {
      generated = await this.mediaProvider.generateImage(input, this.toOpenAiImageLlmConfig(config)) as GeneratedMediaResult;
    } else if (config.provider === "stable-diffusion") {
      generated = await this.sdWebuiProvider.generateImage(input, config) as GeneratedMediaResult;
    } else if (config.provider === "comfyui") {
      generated = await this.comfyuiProvider.generateImage(input, config) as GeneratedMediaResult;
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
  ): Promise<{ assetUrl: string }> {
    const wb = await this.workspaceService.getWorldBible(userId, projectId);
    const character = wb.characters.find((c) => c.id === characterId);
    if (!character) {
      throw new NotFoundException("Character not found");
    }

    const result = await this.generateImageFromPrompt(userId, projectId, prompt, configSource);

    const filename = `char-ref-${characterId}-${Date.now()}.${result.mimeType.split("/")[1] || "png"}`;
    const stored = await this.storageService.storeGeneratedAsset(userId, {
      projectId,
      filename,
      contentType: result.mimeType,
      body: result.buffer,
    });

    return { assetUrl: stored.url! };
  }

  private async processVideoJob(job: JobRecord<MediaJobInput>) {
    const prompt = job.input.prompt?.trim() || `${job.shotId} ${job.input.style} video`;
    const config = await this.resolveLlmConfig(job.createdBy, job.projectId);
    const currentState = await this.database.query((db) => {
      const liveJob = db.jobs.find((item) => item.id === job.id);
      return liveJob ? this.toVideoJobState(liveJob.result, prompt, job.input) : null;
    });

    if (!currentState?.providerVideoId) {
      const created = this.toVideoJobState(await this.mediaProvider.createVideoJob({ ...job.input, prompt }, config), prompt, job.input);
      if (created.mode === "mock") {
        const generated = await this.mediaProvider.generateVideo({ ...job.input, prompt }, config) as GeneratedMediaResult;
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
      await this.mediaProvider.getVideoJob(currentState.providerVideoId, { ...job.input, prompt }, config),
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
      },
      createdBy: job.createdBy,
      status: "approved",
    });

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

    const asset = await this.database.mutate((db) => {
      const record = {
        id: createId("asset"),
        projectId: job.projectId,
        storageDriver: this.storageService.getDriver(),
        storageKey: `${mediaType}/${job.id}`,
        publicUrl: generated.assetUrl,
        mimeType: generated.mimeType,
        sizeInBytes: 0,
        createdBy: job.createdBy,
        createdAt: new Date().toISOString(),
      };
      db.assets.push(record);
      return record;
    });

    return {
      assetId: asset.id,
      assetUrl: generated.assetUrl,
    };
  }

  private async updateVideoJobProgress(jobId: string, state: VideoJobState) {
    const updated = await this.mutateJobState(jobId, (liveJob) => {
      liveJob.status = "running";
      liveJob.progress = state.progress;
      liveJob.result = {
        ...state,
      };
      liveJob.error = undefined;
    });
    if (updated.changed) {
      this.emitJobUpdated(updated.job);
    }
    return updated.job;
  }

  private async enqueueJob(
    userId: string,
    input: Pick<JobRecord, "type" | "projectId" | "documentId" | "shotId"> & { input: unknown },
  ) {
    const job = await this.database.mutate((db) => {
      const now = new Date().toISOString();
      const createdJob: JobRecord = {
        id: createId("job"),
        type: input.type,
        status: "queued",
        projectId: input.projectId,
        documentId: input.documentId,
        shotId: input.shotId,
        input: input.input as Record<string, unknown>,
        createdBy: userId,
        createdAt: now,
        updatedAt: now,
      };
      db.jobs.push(createdJob);
      return createdJob;
    });

    this.emitJobUpdated(job);
    return job;
  }

  private async completeJob(jobId: string, result: Record<string, unknown>) {
    const completed = await this.mutateJobState(jobId, (liveJob) => {
      liveJob.status = "completed";
      liveJob.result = result;
      liveJob.progress = 100;
      liveJob.error = undefined;
    });

    if (completed.changed) {
      this.emitJobUpdated(completed.job);
    }

    // Notify job creator of completion
    this.notificationService.createNotification({
      userId: completed.job.createdBy,
      projectId: completed.job.projectId,
      type: "task_completed",
      title: "Generation task completed",
      body: `${completed.job.type} task completed successfully`,
      referenceId: jobId,
      referenceType: "job",
    }).catch(() => {});

    return completed.job;
  }

  private async markJobRunning(
    jobId: string,
    options: { progress?: number; result?: Record<string, unknown> } = {},
  ) {
    const updated = await this.mutateJobState(jobId, (liveJob) => {
      liveJob.status = "running";
      if (options.progress !== undefined) {
        liveJob.progress = options.progress;
      }
      if (options.result !== undefined) {
        liveJob.result = options.result;
      }
      liveJob.error = undefined;
    });

    if (updated.changed) {
      this.emitJobUpdated(updated.job);
    }

    return updated.job;
  }

  private async failJob(jobId: string, message: string) {
    const failed = await this.mutateJobState(jobId, (liveJob) => {
      liveJob.status = "failed";
      liveJob.error = message;
    });

    if (failed.changed) {
      this.emitJobUpdated(failed.job);
    }

    return failed.job;
  }

  private async mutateJobState(jobId: string, mutate: (liveJob: JobRecord) => void) {
    return this.database.mutate((db) => {
      const liveJob = db.jobs.find((item) => item.id === jobId);
      if (!liveJob) {
        throw new NotFoundException("Job not found");
      }

      const before = this.createJobSnapshot(liveJob);
      mutate(liveJob);
      liveJob.updatedAt = new Date().toISOString();
      const after = this.createJobSnapshot(liveJob);
      return {
        job: liveJob,
        changed: before !== after,
      };
    });
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
    const worldBible = await this.database.query((db) => {
      const wbDoc = db.documents.find(
        (doc) => doc.projectId === projectId && doc.type === "world_bible",
      );
      if (!wbDoc || !wbDoc.currentVersionId) return null;
      const version = db.versions.find((v) => v.id === wbDoc.currentVersionId);
      if (!version?.content || typeof version.content !== "object") return null;
      return version.content as WorldBibleContent;
    });

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

  private async assertProjectReadable(userId: string, projectId: string) {
    const allowed = await this.database.query((db) => {
      const project = db.projects.find((item) => item.id === projectId);
      if (!project) {
        throw new NotFoundException("Project not found");
      }
      const user = db.users.find((item) => item.id === userId);
      const hasTeamAccess = db.teamMembers.some((member) => member.teamId === project.teamId && member.userId === userId);
      const hasProjectAccess = db.projectMembers.some((member) => member.projectId === projectId && member.userId === userId);
      return user?.globalRole === "platform_super_admin" || hasTeamAccess || hasProjectAccess;
    });

    if (!allowed) {
      throw new ForbiddenException("You do not have access to this project");
    }
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
    return this.database.query((db) => {
      const project = db.projects.find((p) => p.id === projectId);

      if (configSource === "personal") {
        return this.normalizeLlmConfig(
          db.users.find((u) => u.id === userId)?.llmConfig as LlmProviderConfig | undefined,
        );
      }

      if (configSource === "team") {
        return project
          ? this.normalizeLlmConfig(db.teams.find((t) => t.id === project.teamId)?.llmConfig as LlmProviderConfig | undefined)
          : undefined;
      }

      const teamConfig = project
        ? this.normalizeLlmConfig(db.teams.find((t) => t.id === project.teamId)?.llmConfig as LlmProviderConfig | undefined)
        : undefined;
      const userConfig = this.normalizeLlmConfig(
        db.users.find((u) => u.id === userId)?.llmConfig as LlmProviderConfig | undefined,
      );

      return this.mergeLlmConfig(userConfig, teamConfig);
    });
  }

  private async resolveTextLlmConfig(
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
    };

    if (!normalized.apiKey && !normalized.baseUrl && !normalized.model) {
      return undefined;
    }

    return normalized;
  }

  private async resolveImageGenerationConfig(
    userId: string,
    projectId: string,
    configSource: ImageConfigSource,
  ): Promise<ImageGenerationConfig | undefined> {
    return this.database.query((db) => {
      if (configSource === "personal") {
        return this.normalizeImageGenerationConfig(
          db.users.find((user) => user.id === userId)?.imageGenerationConfig,
        );
      }

      const project = db.projects.find((item) => item.id === projectId);
      if (!project) {
        throw new NotFoundException("Project not found");
      }

      return this.normalizeImageGenerationConfig(
        db.teams.find((team) => team.id === project.teamId)?.imageGenerationConfig,
      );
    });
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

    const config = await this.resolveImageGenerationConfig(job.createdBy, job.projectId, job.input.configSource);
    const sourceLabel = job.input.configSource === "team" ? "team" : "personal";
    if (!config) {
      throw new BadRequestException(`The ${sourceLabel} image generation config is not set.`);
    }
    if (!config.apiKey?.trim()) {
      throw new BadRequestException(`The ${sourceLabel} image generation config is missing an API key.`);
    }
    if (!config.model?.trim()) {
      throw new BadRequestException(`The ${sourceLabel} image generation config is missing a model.`);
    }
    if (config.provider === "openai-compatible" && !config.baseUrl?.trim()) {
      throw new BadRequestException(`The ${sourceLabel} OpenAI-compatible image config is missing a base URL.`);
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

  private composeImagePrompt(preview: PromptPreviewResult | null) {
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

  private toOpenAiImageLlmConfig(config: ImageGenerationConfig): LlmProviderConfig {
    return {
      provider: "openai-completions",
      apiKey: config.apiKey,
      baseUrl: config.baseUrl,
      model: config.model,
    };
  }

  // ===== TTS Jobs =====

  async listTTSVoices() {
    return { voices: await this.ttsProvider.listVoices() };
  }

  async createTTSJob(
    userId: string,
    shotId: string,
    input: { projectId: string; characterId: string; text: string },
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
      },
    });
  }

  async createSceneBatchTTSJobs(
    userId: string,
    sceneId: string,
    input: { projectId: string; shotIds?: string[] },
  ): Promise<BatchJobGroupRecord> {
    await this.assertProjectReadable(userId, input.projectId);

    const sceneShots = await this.database.query((db) => {
      const storyboardDoc = db.documents.find((document) => document.projectId === input.projectId && document.type === "storyboard");
      if (!storyboardDoc?.currentVersionId) {
        throw new NotFoundException("Storyboard not found for this project");
      }

      const storyboardVersion = db.versions.find((version) => version.id === storyboardDoc.currentVersionId);
      if (!storyboardVersion?.content || typeof storyboardVersion.content !== "object") {
        throw new NotFoundException("Storyboard content is not available");
      }

      const storyboard = storyboardVersion.content as StoryboardContent;
      const sceneShots = (storyboard.shots ?? []).filter((shot) => shot.sceneId === sceneId);
      if (sceneShots.length === 0) {
        throw new NotFoundException("No storyboard shots found for this scene");
      }

      const requestedShotIds = input.shotIds?.length
        ? new Set(input.shotIds.filter(Boolean))
        : null;
      return requestedShotIds
        ? sceneShots.filter((shot) => requestedShotIds.has(shot.id))
        : sceneShots;
    });

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

    const batchResult = await this.database.mutate((db) => {
      const batchId = createId("batch");
      const group: BatchJobGroupRecord = {
        id: batchId,
        projectId: input.projectId,
        jobIds,
        status: "running",
        createdBy: userId,
        createdAt: new Date().toISOString(),
      };
      const updatedJobs: JobRecord[] = [];
      db.batchJobs.push(group);

      for (const jobId of jobIds) {
        const job = db.jobs.find((item) => item.id === jobId);
        if (job) {
          job.batchId = batchId;
          job.priority = job.priority ?? "normal";
          updatedJobs.push(job);
        }
      }

      return { group, updatedJobs };
    });

    batchResult.updatedJobs.forEach((job) => this.emitJobUpdated(job));
    return batchResult.group;
  }

  private async processTTSJob(job: JobRecord<GenerateTTSInput>) {
    await this.markJobRunning(job.id, { progress: 10 });

    const llmConfig = await this.resolveLlmConfig(job.createdBy, job.projectId);
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

  private async resolveTTSVoice(
    projectId: string,
    characterId: string,
    llmConfig?: LlmProviderConfig,
  ) {
    const [worldBible, availableVoices] = await Promise.all([
      this.database.query((db) => {
        const worldBibleDoc = db.documents.find((document) => document.projectId === projectId && document.type === "world_bible");
        if (!worldBibleDoc?.currentVersionId) {
          return null;
        }
        const version = db.versions.find((item) => item.id === worldBibleDoc.currentVersionId);
        if (!version?.content || typeof version.content !== "object") {
          return null;
        }
        return version.content as WorldBibleContent;
      }),
      this.ttsProvider.listVoices(llmConfig),
    ]);

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
    await this.assertProjectReadable(userId, projectId);
    return this.enqueueJob(userId, {
      type: "export_video",
      projectId,
      input: { projectId, ...input },
    });
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

      for await (const chunk of this.textProvider.generateScriptStream(input, config)) {
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
      let finalResult: string | undefined;

      for await (const chunk of this.textProvider.generateSynopsisStream(input, config)) {
        yield chunk;
        if (chunk.type === "done" && chunk.result) {
          finalResult = chunk.result as string;
        }
      }

      if (finalResult) {
        const document = await this.workspaceService.ensureDocumentForProject({
          projectId,
          type: "script",
          title: `${input.title} 剧本`,
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
      const scriptVersion = await this.database.query((db) =>
        db.versions.find((item) => item.id === input.versionId),
      );
      if (!scriptVersion) {
        throw new Error("Source script version not found");
      }

      const script = scriptVersion.content as ScriptContent;
      const config = await this.resolveTextLlmConfig(userId, projectId, llmConfigSource);
      const resolvedModel = this.resolveTextModel(config);
      let finalResult: import("@dramaflow/shared").StoryboardContent | undefined;

      for await (const chunk of this.textProvider.generateStoryboardStream({ ...input, script }, config)) {
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
