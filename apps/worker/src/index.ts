const apiUrl = (process.env.API_URL ?? "http://localhost:4000").replace(/\/$/, "");
const pollIntervalMs = Number(process.env.WORKER_POLL_INTERVAL_MS ?? 4000);
let running = false;

async function tick() {
  if (running) {
    return;
  }

  running = true;
  try {
    const claimResponse = await fetch(`${apiUrl}/internal/jobs/next`);
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

    const job = JSON.parse(payload) as { id?: string; type?: string } | null;
    if (!job?.id) {
      process.stdout.write("[worker] idle\n");
      return;
    }

    process.stdout.write(`[worker] processing ${job.id} (${job.type})\n`);
    const processResponse = await fetch(`${apiUrl}/internal/jobs/${job.id}/process`, {
      method: "POST",
    });

    if (!processResponse.ok) {
      const body = await processResponse.text();
      process.stdout.write(`[worker] job ${job.id} failed: ${body}\n`);
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