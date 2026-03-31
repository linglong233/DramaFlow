import {
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import type {
  GenerateMediaInput,
  GenerateScriptInput,
  GenerateStoryboardInput,
  JobRecord,
  MediaContent,
  ScriptContent,
} from "@dramaflow/shared";

import { DevDatabaseService } from "../common/dev-database.service";
import { createId } from "../common/id";
import { StorageService } from "../storage/storage.service";
import { WorkspaceService } from "../workspace/workspace.service";
import { OpenAiMediaProvider } from "./media-generation.provider";
import { OpenAiCompatTextProvider } from "./text-generation.provider";

type MediaJobInput = Omit<GenerateMediaInput, "shotId"> & {
  projectId: string;
  shotId: string;
  prompt?: string;
};

type MediaJobRequest = Omit<MediaJobInput, "shotId">;

interface GeneratedMediaResult extends MediaContent {
  inlineBody?: Buffer | string;
  fileExtension?: string;
}

@Injectable()
export class JobsService {
  constructor(
    @Inject(DevDatabaseService) private readonly database: DevDatabaseService,
    @Inject(WorkspaceService) private readonly workspaceService: WorkspaceService,
    @Inject(StorageService) private readonly storageService: StorageService,
    @Inject(OpenAiCompatTextProvider) private readonly textProvider: OpenAiCompatTextProvider,
    @Inject(OpenAiMediaProvider) private readonly mediaProvider: OpenAiMediaProvider,
  ) {}

  async createScriptJob(userId: string, projectId: string, input: GenerateScriptInput) {
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
    input: GenerateStoryboardInput,
  ) {
    await this.assertProjectReadable(userId, projectId);
    return this.enqueueJob(userId, {
      type: "storyboard_generation",
      projectId,
      documentId: input.documentId,
      input,
    });
  }

  async createImageJob(userId: string, shotId: string, input: MediaJobRequest) {
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

  async getJob(userId: string, jobId: string) {
    const job = await this.database.query((db) => db.jobs.find((item) => item.id === jobId));
    if (!job) {
      throw new NotFoundException("Job not found");
    }
    await this.assertProjectReadable(userId, job.projectId);
    return job;
  }

  async claimNextJob() {
    return this.database.mutate((db) => {
      const job = db.jobs.find((item) => item.status === "queued");
      if (!job) {
        return null;
      }
      job.status = "running";
      job.updatedAt = new Date().toISOString();
      return job;
    });
  }

  async processJob(jobId: string) {
    const job = await this.database.query((db) => db.jobs.find((item) => item.id === jobId));
    if (!job) {
      throw new NotFoundException("Job not found");
    }

    try {
      switch (job.type) {
        case "script_generation":
          return await this.processScriptJob(job as unknown as JobRecord<GenerateScriptInput>);
        case "storyboard_generation":
          return await this.processStoryboardJob(job as unknown as JobRecord<GenerateStoryboardInput>);
        case "image_generation":
          return await this.processMediaJob(job as unknown as JobRecord<MediaJobInput>, "image");
        case "video_generation":
          return await this.processMediaJob(job as unknown as JobRecord<MediaJobInput>, "video");
        default:
          throw new Error(`Unsupported job type: ${job.type}`);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      await this.database.mutate((db) => {
        const liveJob = db.jobs.find((item) => item.id === jobId);
        if (liveJob) {
          liveJob.status = "failed";
          liveJob.error = message;
          liveJob.updatedAt = new Date().toISOString();
        }
      });
      throw error;
    }
  }

  private async processScriptJob(job: JobRecord<GenerateScriptInput>) {
    const content = await this.textProvider.generateScript(job.input);
    const document = await this.workspaceService.ensureDocumentForProject({
      projectId: job.projectId,
      type: "script",
      title: `${job.input.title} 剧本`,
      createdBy: job.createdBy,
    });
    const version = await this.workspaceService.createVersionForDocument({
      documentId: document.id,
      title: `${job.input.title} - AI 初稿`,
      content,
      metadata: {
        sourceJobId: job.id,
        provider: process.env.OPENAI_TEXT_MODEL ?? "mock-text",
      },
      createdBy: job.createdBy,
      status: "approved",
    });

    return this.completeJob(job.id, {
      documentId: document.id,
      versionId: version.id,
      content,
    });
  }

  private async processStoryboardJob(job: JobRecord<GenerateStoryboardInput>) {
    const scriptVersion = await this.database.query((db) =>
      db.versions.find((item) => item.id === job.input.versionId),
    );
    if (!scriptVersion) {
      throw new NotFoundException("Source script version not found");
    }

    const script = scriptVersion.content as ScriptContent;
    const content = await this.textProvider.generateStoryboard({
      ...job.input,
      script,
    });
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
      },
      createdBy: job.createdBy,
      status: "approved",
    });

    return this.completeJob(job.id, {
      documentId: version.documentId,
      versionId: version.id,
      content,
    });
  }

  private async processMediaJob(job: JobRecord<MediaJobInput>, mediaType: "image" | "video") {
    const prompt = job.input.prompt?.trim() || `${job.shotId} ${job.input.style} ${mediaType}`;
    const generated = mediaType === "image"
      ? (await this.mediaProvider.generateImage({ ...job.input, prompt }) as GeneratedMediaResult)
      : (await this.mediaProvider.generateVideo({ ...job.input, prompt }) as GeneratedMediaResult);

    const assetReference = await this.persistMediaArtifact(job, generated, mediaType);
    const document = await this.workspaceService.ensureDocumentForProject({
      projectId: job.projectId,
      type: mediaType,
      title: `${job.shotId} ${mediaType === "image" ? "参考图" : "预演视频"}`,
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
        mimeType: generated.mimeType,
        parameters: generated.parameters,
      },
      metadata: {
        sourceJobId: job.id,
        shotId: job.shotId,
      },
      createdBy: job.createdBy,
      status: "approved",
    });

    return this.completeJob(job.id, {
      documentId: document.id,
      versionId: version.id,
      asset: assetReference,
    });
  }

  private async persistMediaArtifact(
    job: JobRecord<MediaJobInput>,
    generated: GeneratedMediaResult,
    mediaType: "image" | "video",
  ) {
    if (generated.inlineBody) {
      const stored = await this.storageService.storeGeneratedAsset(job.createdBy, {
        projectId: job.projectId,
        filename: `${job.shotId}.${generated.fileExtension ?? (mediaType === "image" ? "svg" : "json")}`,
        contentType: generated.mimeType,
        body: generated.inlineBody,
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

  private async enqueueJob(
    userId: string,
    input: Pick<JobRecord, "type" | "projectId" | "documentId" | "shotId"> & { input: unknown },
  ) {
    return this.database.mutate((db) => {
      const now = new Date().toISOString();
      const job: JobRecord = {
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
      db.jobs.push(job);
      return job;
    });
  }

  private async completeJob(jobId: string, result: Record<string, unknown>) {
    return this.database.mutate((db) => {
      const liveJob = db.jobs.find((item) => item.id === jobId);
      if (!liveJob) {
        throw new NotFoundException("Job not found");
      }

      liveJob.status = "completed";
      liveJob.result = result;
      liveJob.updatedAt = new Date().toISOString();
      return liveJob;
    });
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
}