import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { access, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const isWindows = process.platform === "win32";
const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const npmRunner = resolveNpmRunner();
const buildStepTimeoutMs = parsePositiveInteger(process.env.DRAMAFLOW_BUILD_TIMEOUT_MS, 10 * 60 * 1000);
const prismaSchemaPath = path.join(rootDir, "apps", "api", "prisma", "schema.prisma");
const prismaGeneratedClientEntry = path.join(rootDir, "node_modules", ".prisma", "client", "index.js");
const prismaSchemaHashPath = path.join(rootDir, "node_modules", ".prisma", "client", ".dramaflow-schema.sha256");

main().catch((error) => {
  process.stderr.write(`${formatError(error)}\n`);
  process.exitCode = 1;
});

async function main() {
  await runStep("shared build", npmRunner.command, [...npmRunner.baseArgs, "--workspace", "@dramaflow/shared", "run", "build"], rootDir);
  const prismaGenerateState = await getPrismaGenerateState();
  if (prismaGenerateState.shouldGenerate) {
    await runStep("api prisma generate", npmRunner.command, [...npmRunner.baseArgs, "--workspace", "@dramaflow/api", "run", "prisma:generate"], rootDir);
    await writePrismaSchemaHash(prismaGenerateState.schemaHash);
  } else {
    process.stdout.write("[DramaFlow] Skipping api prisma generate (generated client is current).\n");
  }
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

async function getPrismaGenerateState() {
  const schemaHash = createHash("sha256").update(await readFile(prismaSchemaPath)).digest("hex");
  if (!(await exists(prismaGeneratedClientEntry))) {
    return { shouldGenerate: true, schemaHash };
  }

  if ((await readTextIfExists(prismaSchemaHashPath))?.trim() === schemaHash) {
    return { shouldGenerate: false, schemaHash };
  }

  const [schemaStats, clientStats] = await Promise.all([stat(prismaSchemaPath), stat(prismaGeneratedClientEntry)]);
  if (clientStats.mtimeMs >= schemaStats.mtimeMs) {
    await writePrismaSchemaHash(schemaHash);
    return { shouldGenerate: false, schemaHash };
  }

  return { shouldGenerate: true, schemaHash };
}

async function writePrismaSchemaHash(schemaHash) {
  await writeFile(prismaSchemaHashPath, `${schemaHash}\n`, "utf8");
}

async function readTextIfExists(filePath) {
  try {
    return await readFile(filePath, "utf8");
  } catch {
    return null;
  }
}

async function exists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
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
