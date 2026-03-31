import { Controller, Get, Inject, Param, Post } from "@nestjs/common";

import { JobsService } from "./jobs.service";

@Controller("internal/jobs")
export class InternalJobsController {
  constructor(@Inject(JobsService) private readonly jobsService: JobsService) {
    this.claimNextJob = this.claimNextJob.bind(this);
    this.processJob = this.processJob.bind(this);
  }

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