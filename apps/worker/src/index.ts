const apiUrl = (process.env.API_URL ?? "http://localhost:4000").replace(/\/$/, "");
const pollIntervalMs = Number(process.env.WORKER_POLL_INTERVAL_MS ?? 4000);
const internalApiKey = process.env.INTERNAL_API_KEY ?? "dramaflow-internal-key";
const internalHeaders: Record<string, string> = { "x-internal-key": internalApiKey };
let running = false;

async function tick() {
  if (running) {
    return;
  }

  running = true;
  try {
    const claimResponse = await fetch(`${apiUrl}/internal/jobs/next`, { headers: internalHeaders });
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
    const processResponse = await fetch(`${apiUrl}/internal/jobs/${job.id}/process`, {
      method: "POST",
      headers: internalHeaders,
    });

    if (!processResponse.ok) {
      const body = await processResponse.text();
      process.stdout.write(`[worker] job ${job.id} failed: ${body}\n`);

      // Auto-retry if within retry limits
      const retryCount = job.retryCount ?? 0;
      const maxRetries = job.maxRetries ?? 3;
      if (retryCount < maxRetries) {
        process.stdout.write(`[worker] requesting retry for ${job.id} (attempt ${retryCount + 1}/${maxRetries})\n`);
        try {
          const retryResponse = await fetch(`${apiUrl}/internal/jobs/${job.id}/retry`, {
            method: "POST",
            headers: internalHeaders,
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
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stdout.write(`[worker] error: ${message}\n`);
  } finally {
    running = false;
  }
}

process.stdout.write(`[worker] polling ${apiUrl} every ${pollIntervalMs}ms\n`);
void tick();
setInterval(() => {
  void tick();
}, pollIntervalMs);
