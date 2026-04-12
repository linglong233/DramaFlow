/**
 * @fileoverview 内部任务控制器
 * @module api/jobs
 *
 * 提供 Worker 轮询用的内部接口，包括领取任务、执行任务和重试任务。
 * 使用 InternalApiKeyGuard 保护，不对外暴露。
 */

import { Controller, Get, Inject, Param, Post, UseGuards } from "@nestjs/common";

import { InternalApiKeyGuard } from "../common/internal-api-key.guard";
import { JobsService } from "./jobs.service";

/** 内部任务控制器，Worker 通过此接口领取和处理任务 */
@Controller("internal/jobs")
@UseGuards(InternalApiKeyGuard)
export class InternalJobsController {
  constructor(@Inject(JobsService) private readonly jobsService: JobsService) {}

  /** 领取下一个等待处理的任务（按优先级排序） */
  @Get("next")
  async claimNextJob() {
    const job = await this.jobsService.claimNextJob();
    return job ?? { job: null };
  }

  /** 执行指定任务 */
  @Post(":id/process")
  processJob(@Param("id") jobId: string) {
    return this.jobsService.processJob(jobId);
  }

  /** 重试失败任务（系统级调用） */
  @Post(":id/retry")
  async retryJob(@Param("id") jobId: string) {
    // Internal retry uses a system user ID; the retryJob method only checks job status
    return this.jobsService.retryJob("system", jobId);
  }
}