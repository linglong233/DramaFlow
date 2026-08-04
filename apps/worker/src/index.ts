/**
 * @fileoverview Worker 轮询主入口
 * @module worker
 *
 * 轻量级任务 Worker，通过定时轮询 API 的内部接口领取并执行 AI 生成任务。
 * 支持失败自动重试和进度追踪。
 *
 * 可靠性设计：
 * - 所有 fetch 都有超时（AbortSignal.timeout）和 try/catch 兜底，网络抖动不会
 *   让 tick 抛出 unhandledRejection，从而避免 Node 24 默认 `--unhandled-rejections=throw`
 *   导致进程崩溃。
 * - 监听 SIGTERM/SIGINT 做优雅退出：停止调度新 tick、等待当前 tick 完成（最长 5s）。
 * - 兜底监听 unhandledRejection/uncaughtException，写日志后退出，避免被 Node 静默击杀。
 *
 * 副作用启动（首次 tick + setInterval）仅在脚本被直接运行时触发，
 * 被 require/import 时不自动启动，便于单元测试驱动 tick()。
 */

import type { JobRecord } from "@dramaflow/shared";

/** Worker 运行所需的配置（从 env 派生，导出便于测试注入） */
export interface WorkerConfig {
  apiUrl: string;
  pollIntervalMs: number;
  fetchTimeoutMs: number;
  headers: Record<string, string>;
}

/** 从 process.env 解析 WorkerConfig */
export function resolveWorkerConfig(env: NodeJS.ProcessEnv = process.env): WorkerConfig {
  const apiUrl = (env.API_URL ?? "http://localhost:4000").replace(/\/$/, "");
  const pollIntervalMs = Number(env.WORKER_POLL_INTERVAL_MS ?? 4000);
  const fetchTimeoutMs = Number(env.WORKER_FETCH_TIMEOUT_MS ?? 30000);
  const internalApiKey = env.INTERNAL_API_KEY ?? "dramaflow-internal-key";
  return {
    apiUrl,
    pollIntervalMs,
    fetchTimeoutMs,
    headers: { "x-internal-key": internalApiKey },
  };
}

/** tick 内部使用的"软失败"响应，把网络错误/超时降级为统一形状，避免 reject 冒泡 */
interface SoftResponse {
  ok: boolean;
  status: number;
  body: string;
}

/**
 * 统一的 fetch 封装：注入内部鉴权头、应用超时、把任意失败降级为软响应。
 *
 * 之所以返回 SoftResponse 而非抛错：tick 的每一阶段都是"尽力而为"的轮询，网络错误
 * 应当被记录后让本次 tick 平静结束，下个周期重试，而不是冒泡成 unhandledRejection。
 */
async function fetchSoft(config: WorkerConfig, url: string, init?: RequestInit): Promise<SoftResponse> {
  try {
    const response = await fetch(url, {
      ...init,
      headers: { ...config.headers, ...(init?.headers ?? {}) },
      signal: AbortSignal.timeout(config.fetchTimeoutMs),
    });
    const body = await response.text();
    return { ok: response.ok, status: response.status, body };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    process.stdout.write(`[worker] request to ${url} failed: ${msg}\n`);
    return { ok: false, status: 0, body: "" };
  }
}

/** 单次轮询周期：领取任务 → 执行 → 处理结果 / 重试 */
export async function tick(config: WorkerConfig): Promise<void> {
  const claimResponse = await fetchSoft(config, `${config.apiUrl}/internal/jobs/next`);
  if (!claimResponse.ok) {
    process.stdout.write(`[worker] failed to claim job: ${claimResponse.status}\n`);
    return;
  }

  const payload = claimResponse.body.trim();
  if (!payload) {
    process.stdout.write("[worker] idle\n");
    return;
  }

  const job = JSON.parse(payload) as Pick<JobRecord, "id" | "type" | "retryCount" | "maxRetries"> | null;
  if (!job?.id) {
    process.stdout.write("[worker] idle\n");
    return;
  }

  process.stdout.write(`[worker] processing ${job.id} (${job.type})\n`);
  const processResponse = await fetchSoft(config, `${config.apiUrl}/internal/jobs/${job.id}/process`, {
    method: "POST",
  });

  if (!processResponse.ok) {
    process.stdout.write(`[worker] job ${job.id} failed: ${processResponse.body || processResponse.status}\n`);

    // 在重试限制内自动重试（status=0 表示网络错误/超时，与 5xx 一并视为可重试失败）
    const retryCount = job.retryCount ?? 0;
    const maxRetries = job.maxRetries ?? 3;
    if (retryCount < maxRetries) {
      process.stdout.write(`[worker] requesting retry for ${job.id} (attempt ${retryCount + 1}/${maxRetries})\n`);
      const retryResponse = await fetchSoft(config, `${config.apiUrl}/internal/jobs/${job.id}/retry`, {
        method: "POST",
      });
      if (retryResponse.ok) {
        process.stdout.write(`[worker] retry queued for ${job.id}\n`);
      } else {
        process.stdout.write(`[worker] retry request failed for ${job.id}: ${retryResponse.status}\n`);
      }
    }

    return;
  }

  let processed: { status?: string; result?: Record<string, unknown> } = {};
  try {
    processed = JSON.parse(processResponse.body) as typeof processed;
  } catch {
    process.stdout.write(`[worker] job ${job.id} returned unparseable body, treating as completed\n`);
    return;
  }
  if (processed.status === "running") {
    const progress = typeof processed.result?.progress === "number" ? ` ${processed.result.progress}%` : "";
    process.stdout.write(`[worker] job ${job.id} still running${progress}\n`);
    return;
  }

  process.stdout.write(`[worker] job ${job.id} completed\n`);
}

/** 当前正在执行的 tick，用于优雅退出时等待 */
let currentTick: Promise<void> | null = null;
/** setInterval 句柄，用于优雅退出时停止调度 */
let intervalId: NodeJS.Timeout | null = null;

/** 启动轮询循环（仅在直接运行时执行） */
function startPolling(): void {
  const config = resolveWorkerConfig();
  process.stdout.write(`[worker] polling ${config.apiUrl} every ${config.pollIntervalMs}ms\n`);

  const scheduleNext = (): void => {
    currentTick = tick(config).finally(() => {
      currentTick = null;
    });
  };

  scheduleNext();
  intervalId = setInterval(scheduleNext, config.pollIntervalMs);

  setupGracefulShutdown();
}

let shutdownStarted = false;
function gracefulShutdown(signal: NodeJS.Signals): void {
  if (shutdownStarted) return;
  shutdownStarted = true;
  process.stdout.write(`[worker] received ${signal}, shutting down gracefully\n`);

  if (intervalId) {
    clearInterval(intervalId);
    intervalId = null;
  }

  // 等待当前 tick 完成，最长 5 秒后强退，避免卡死容器编排的终止宽限期
  const forceExit = setTimeout(() => {
    process.stdout.write("[worker] graceful shutdown timeout, forcing exit\n");
    process.exit(1);
  }, 5000);
  forceExit.unref();

  if (currentTick) {
    currentTick.finally(() => {
      clearTimeout(forceExit);
      process.exit(0);
    });
  } else {
    clearTimeout(forceExit);
    process.exit(0);
  }
}

function setupGracefulShutdown(): void {
  process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
  process.on("SIGINT", () => gracefulShutdown("SIGINT"));
  process.on("unhandledRejection", (reason) => {
    const msg = reason instanceof Error ? reason.message : String(reason);
    process.stderr.write(`[worker] unhandledRejection: ${msg}\n`);
    process.exit(1);
  });
  process.on("uncaughtException", (err) => {
    process.stderr.write(`[worker] uncaughtException: ${err.stack || err.message}\n`);
    process.exit(1);
  });
}

// CommonJS 惯用法：仅在被直接运行时启动副作用，被 require 时不启动
if (require.main === module) {
  startPolling();
}
