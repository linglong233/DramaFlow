import { Controller, Get, Param, Post } from "@nestjs/common";

import { JobsService } from "./jobs.service";

@Controller("internal/jobs")
export class InternalJobsController {
  constructor(private readonly jobsService: JobsService) {}

  @Get("next")
  async claimNextJob() {
    const job = await this.jobsService.claimNextJob();
    return job ?? { job: null };
  }

  @Post(":id/process")
  processJob(@Param("id") jobId: string) {
    return this.jobsService.processJob(jobId);
  }
}