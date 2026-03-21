import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  UseGuards,
} from "@nestjs/common";

import { AuthGuard } from "../common/auth.guard";
import { CurrentUser } from "../common/current-user.decorator";
import { JobsService } from "./jobs.service";

@Controller()
@UseGuards(AuthGuard)
export class JobsController {
  constructor(private readonly jobsService: JobsService) {}

  @Post("projects/:id/script-jobs")
  createScriptJob(
    @CurrentUser() user: { id: string },
    @Param("id") projectId: string,
    @Body() body: { title: string; genre: string; premise: string; episodeGoal: string; tone: string; audience: string },
  ) {
    return this.jobsService.createScriptJob(user.id, projectId, body);
  }

  @Post("projects/:id/storyboard-jobs")
  createStoryboardJob(
    @CurrentUser() user: { id: string },
    @Param("id") projectId: string,
    @Body() body: { documentId: string; versionId: string; cinematicStyle: string; shotDensity: "sparse" | "balanced" | "dense" },
  ) {
    return this.jobsService.createStoryboardJob(user.id, projectId, body);
  }

  @Post("shots/:id/image-jobs")
  createImageJob(
    @CurrentUser() user: { id: string },
    @Param("id") shotId: string,
    @Body() body: { projectId: string; style: string; aspectRatio: string; prompt?: string; referenceImageAssetId?: string },
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

  @Get("jobs/:id")
  getJob(@CurrentUser() user: { id: string }, @Param("id") jobId: string) {
    return this.jobsService.getJob(user.id, jobId);
  }
}
