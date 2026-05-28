import { spawn, spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const isWindows = process.platform === "win32";
const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const npmRunner = resolveNpmRunner();
const buildStepTimeoutMs = parsePositiveInteger(process.env.DRAMAFLOW_BUILD_TIMEOUT_MS, 10 * 60 * 1000);

main().catch((error) => {
  process.stderr.write(`${formatError(error)}\n`);
  process.exitCode = 1;
});

async function main() {
  await runStep("shared build", npmRunner.command, [...npmRunner.baseArgs, "--workspace", "@dramaflow/shared", "run", "build"], rootDir);
  await runOptionalStep("api prisma generate", npmRunner.command, [...npmRunner.baseArgs, "--workspace", "@dramaflow/api", "run", "prisma:generate"], rootDir);
  await runStep("api build", npmRunner.command, [...npmRunner.baseArgs, "--workspace", "@dramaflow/api", "run", "build"], rootDir);
  await runStep("worker build", npmRunner.command, [...npmRunner.baseArgs, "--workspace", "@dramaflow/worker", "run", "build"], rootDir);

  await runStep("web build", npmRunner.command, [...npmRunner.baseArgs, "--workspace", "@dramaflow/web", "run", "build"], rootDir);
}

function resolveNpmRunner() {
  if (!isWindows) {
    return {
      command: "npm",
      baseArgs: [],
    };
  }

  const npmCliPath =
    process.env.npm_execpath ??
    process.env.NPM_CLI_JS ??
    path.join(path.dirname(process.execPath), "node_modules", "npm", "bin", "npm-cli.js");

  return {
    command: process.execPath,
    baseArgs: [npmCliPath],
  };
}

async function runOptionalStep(label, command, args, cwd) {
  try {
    await runStep(label, command, args, cwd);
  } catch {
    process.stdout.write(`[DramaFlow] ${label} failed — continuing (existing generated client is valid when schema unchanged).\n`);
  }
}

async function runStep(label, command, args, cwd) {
  process.stdout.write(`[DramaFlow] Running ${label}...\n`);

  await new Promise((resolve, reject) => {
    let settled = false;
    const child = spawn(command, args, {
      cwd,
      env: { ...process.env, NODE_ENV: "production" },
      stdio: "inherit",
      shell: false,
    });

    const timeout = setTimeout(() => {
      if (settled) {
        return;
      }

      settled = true;
      killProcessTree(child);
      reject(new Error(`[DramaFlow] ${label} timed out after ${buildStepTimeoutMs}ms.`));
    }, buildStepTimeoutMs);

    child.once("error", (error) => {
      if (settled) {
        return;
      }

      settled = true;
      clearTimeout(timeout);
      reject(new Error(`[DramaFlow] Could not start ${label}: ${formatError(error)}`));
    });

    child.once("exit", (code, signal) => {
      if (settled) {
        return;
      }

      settled = true;
      clearTimeout(timeout);
      if (code === 0) {
        resolve();
        return;
      }

      reject(new Error(`[DramaFlow] ${label} failed with ${describeExit(code, signal)}.`));
    });
  });
}

function parsePositiveInteger(rawValue, fallbackValue) {
  const parsed = Number(rawValue);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallbackValue;
  }

  return Math.floor(parsed);
}

function killProcessTree(child) {
  if (!child.pid) {
    return;
  }

  if (isWindows) {
    spawnSync("taskkill.exe", ["/pid", String(child.pid), "/t", "/f"], { stdio: "ignore" });
  }

  if (!child.killed) {
    child.kill(isWindows ? "SIGKILL" : "SIGTERM");
  }
}

function describeExit(code, signal) {
  if (signal) {
    return `signal ${signal}`;
  }

  return `exit code ${code ?? "unknown"}`;
}

function formatError(error) {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}
