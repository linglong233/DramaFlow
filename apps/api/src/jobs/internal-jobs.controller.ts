import { Controller, Get, Inject, Param, Post, UseGuards } from "@nestjs/common";

import { InternalApiKeyGuard } from "../common/internal-api-key.guard";
import { JobsService } from "./jobs.service";

@Controller("internal/jobs")
@UseGuards(InternalApiKeyGuard)
export class InternalJobsController {
  constructor(@Inject(JobsService) private readonly jobsService: JobsService) {}

  @Get("next")
  async claimNextJob() {
    const job = await this.jobsService.claimNextJob();
    return job ?? { job: null };
  }

  @Post(":id/process")
  processJob(@Param("id") jobId: string) {
    return this.jobsService.processJob(jobId);
  }

  @Post(":id/retry")
  async retryJob(@Param("id") jobId: string) {
    // Internal retry uses a system user ID; the retryJob method only checks job status
    return this.jobsService.retryJob("system", jobId);
  }
}