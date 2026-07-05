/**
 * @fileoverview Worker 轮询主入口
 * @module worker
 *
 * 轻量级任务 Worker，通过定时轮询 API 的内部接口领取并执行 AI 生成任务。
 * 支持失败自动重试和进度追踪。
 *
 * 副作用启动（首次 tick + setInterval）仅在脚本被直接运行时触发，
 * 被 require/import 时不自动启动，便于单元测试驱动 tick()。
 */

/** Worker 运行所需的配置（从 env 派生，导出便于测试注入） */
export interface WorkerConfig {
  apiUrl: string;
  pollIntervalMs: number;
  headers: Record<string, string>;
}

/** 从 process.env 解析 WorkerConfig */
export function resolveWorkerConfig(env: NodeJS.ProcessEnv = process.env): WorkerConfig {
  const apiUrl = (env.API_URL ?? "http://localhost:4000").replace(/\/$/, "");
  const pollIntervalMs = Number(env.WORKER_POLL_INTERVAL_MS ?? 4000);
  const internalApiKey = env.INTERNAL_API_KEY ?? "dramaflow-internal-key";
  return {
    apiUrl,
    pollIntervalMs,
    headers: { "x-internal-key": internalApiKey },
  };
}

/** 单次轮询周期：领取任务 → 执行 → 处理结果 / 重试 */
export async function tick(config: WorkerConfig): Promise<void> {
  const claimResponse = await fetch(`${config.apiUrl}/internal/jobs/next`, { headers: config.headers });
  if (!claimResponse.ok) {
    process.stdout.write(`[worker] failed to claim job: ${claimResponse.status}\n`);
    return;
  }

  const raw = await claimResponse.text();
  const payload = raw.trim();
  if (!payload) {
    process.stdout.write("[worker] idle\n");
    return;
  }

  const job = JSON.parse(payload) as { id?: string; type?: string; retryCount?: number; maxRetries?: number } | null;
  if (!job?.id) {
    process.stdout.write("[worker] idle\n");
    return;
  }

  process.stdout.write(`[worker] processing ${job.id} (${job.type})\n`);
  const processResponse = await fetch(`${config.apiUrl}/internal/jobs/${job.id}/process`, {
    method: "POST",
    headers: config.headers,
  });

  if (!processResponse.ok) {
    const body = await processResponse.text();
    process.stdout.write(`[worker] job ${job.id} failed: ${body}\n`);

    // 在重试限制内自动重试
    const retryCount = job.retryCount ?? 0;
    const maxRetries = job.maxRetries ?? 3;
    if (retryCount < maxRetries) {
      process.stdout.write(`[worker] requesting retry for ${job.id} (attempt ${retryCount + 1}/${maxRetries})\n`);
      try {
        const retryResponse = await fetch(`${config.apiUrl}/internal/jobs/${job.id}/retry`, {
          method: "POST",
          headers: config.headers,
        });
        if (retryResponse.ok) {
          process.stdout.write(`[worker] retry queued for ${job.id}\n`);
        } else {
          process.stdout.write(`[worker] retry request failed for ${job.id}: ${retryResponse.status}\n`);
        }
      } catch (retryError) {
        const msg = retryError instanceof Error ? retryError.message : String(retryError);
        process.stdout.write(`[worker] retry request error for ${job.id}: ${msg}\n`);
      }
    }

    return;
  }

  const processed = await processResponse.json() as { status?: string; result?: Record<string, unknown> };
  if (processed.status === "running") {
    const progress = typeof processed.result?.progress === "number" ? ` ${processed.result.progress}%` : "";
    process.stdout.write(`[worker] job ${job.id} still running${progress}\n`);
    return;
  }

  process.stdout.write(`[worker] job ${job.id} completed\n`);
}

/** 启动轮询循环（仅在直接运行时执行） */
function startPolling(): void {
  const config = resolveWorkerConfig();
  process.stdout.write(`[worker] polling ${config.apiUrl} every ${config.pollIntervalMs}ms\n`);
  void tick(config);
  setInterval(() => {
    void tick(config);
  }, config.pollIntervalMs);
}

// CommonJS 惯用法：仅在被直接运行时启动副作用，被 require 时不启动
if (require.main === module) {
  startPolling();
}
