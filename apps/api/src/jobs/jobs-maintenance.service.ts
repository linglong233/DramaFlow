/**
 * @fileoverview 任务维护服务（后台清理）
 * @module api/jobs
 *
 * 通过 @nestjs/schedule 的 @Interval 定时器驱动 JobsService.reapStaleJobs()，
 * 回收 worker 崩溃后滞留的 running 任务。
 *
 * 注意：多实例部署时，reaper 应只在一个实例上运行，避免重复回收。
 * 通过 REAP_STALE_JOBS_ENABLED=false 在其余实例上关闭（默认 true，单实例部署无需配置）。
 * 测试环境下（NODE_ENV=test）默认关闭，避免污染单测。
 */

import { Inject, Injectable, Logger } from "@nestjs/common";
import { Interval } from "@nestjs/schedule";

import { JobsService } from "./jobs.service";

@Injectable()
export class JobsMaintenanceService {
  private readonly logger = new Logger(JobsMaintenanceService.name);

  constructor(@Inject(JobsService) private readonly jobsService: JobsService) {}

  /**
   * 默认每 60 秒执行一次 reap。
   * 间隔可通过 JOB_REAP_INTERVAL_MS 配置。
   */
  @Interval(Number(process.env.JOB_REAP_INTERVAL_MS ?? 60000))
  async runReaper(): Promise<void> {
    if (!this.isEnabled()) return;
    try {
      const { reaped } = await this.jobsService.reapStaleJobs();
      if (reaped > 0) {
        this.logger.warn(`Reaped ${reaped} stalled job(s)`);
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      this.logger.error(`Reaper failed: ${msg}`);
    }
  }

  private isEnabled(): boolean {
    if (process.env.NODE_ENV === "test") return false;
    return process.env.REAP_STALE_JOBS_ENABLED !== "false";
  }
}
