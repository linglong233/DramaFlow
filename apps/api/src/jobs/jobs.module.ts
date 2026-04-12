/**
 * @fileoverview AI 任务模块
 * @module api/jobs
 *
 * 组装 AI 生成任务相关的所有服务和 Provider：
 * 剧本/分镜/大纲生成、图片生成、视频生成、TTS、导出等。
 */

import { Module } from "@nestjs/common";

import { AuthModule } from "../auth/auth.module";
import { CommonModule } from "../common/common.module";
import { NotificationModule } from "../notifications/notification.module";
import { RealtimeModule } from "../realtime/realtime.module";
import { StorageModule } from "../storage/storage.module";
import { WorkspaceModule } from "../workspace/workspace.module";
import { InternalJobsController } from "./internal-jobs.controller";
import { JobsController } from "./jobs.controller";
import { JobsService } from "./jobs.service";
import { OpenAiMediaProvider } from "./media-generation.provider";
import { OpenAiCompatTextProvider } from "./text-generation.provider";
import { PromptBuilderService } from "./prompt-builder.service";
import { TTSProviderService } from "./tts.provider";
import { ExportService } from "./export.service";
import { GoogleGeminiImageProvider } from "./google-gemini-image.provider";
import { SdWebuiImageProvider } from "./sd-webui-image.provider";
import { ComfyuiImageProvider } from "./comfyui-image.provider";

@Module({
  imports: [CommonModule, AuthModule, WorkspaceModule, StorageModule, NotificationModule, RealtimeModule],
  controllers: [JobsController, InternalJobsController],
  providers: [JobsService, OpenAiCompatTextProvider, OpenAiMediaProvider, GoogleGeminiImageProvider, SdWebuiImageProvider, ComfyuiImageProvider, PromptBuilderService, TTSProviderService, ExportService],
  exports: [JobsService, PromptBuilderService],
})
export class JobsModule {}