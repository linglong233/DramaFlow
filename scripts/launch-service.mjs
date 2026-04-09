import { spawn } from "node:child_process";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const args = parseArgs(process.argv.slice(2));
const sessionDir = args.session;
const serviceName = args.service;

if (!sessionDir || !serviceName) {
  process.stderr.write("[DramaFlow] launch-service requires --session and --service.\n");
  process.exit(1);
}

const sessionFile = path.join(sessionDir, "session.json");
const stateFile = path.join(sessionDir, `${serviceName}.state.json`);
const logFile = path.join(sessionDir, `${serviceName}.log`);

let child = null;
let readyTimer = null;
let readyWritten = false;
let shuttingDown = false;

main().catch(async (error) => {
  await writeState({
    status: "failed",
    detail: formatError(error),
  });
  process.stderr.write(`[DramaFlow] ${capitalize(serviceName)} wrapper failed: ${formatError(error)}\n`);
  process.exitCode = 1;
});

async function main() {
  if (!(await exists(sessionFile))) {
    throw new Error(`Session file is missing: ${sessionFile}`);
  }

  const session = JSON.parse(await readFile(sessionFile, "utf8"));
  const service = session?.services?.[serviceName];
  if (!service) {
    throw new Error(`Unknown service "${serviceName}".`);
  }

  const envFileValues = await loadDotEnv(path.join(session.rootDir, ".env"));
  const childEnv = {
    ...envFileValues,
    ...process.env,
    ...service.envOverrides,
  };

  await mkdir(path.dirname(logFile), { recursive: true });
  await writeState({
    status: "starting",
    detail: `${service.command} ${service.args.join(" ")}`,
  });

  process.stdout.write(`[DramaFlow][${serviceName}] Starting ${service.command} ${service.args.join(" ")}\n`);

  child = spawn(service.command, service.args, {
    cwd: session.rootDir,
    env: childEnv,
    stdio: ["ignore", "pipe", "pipe"],
    shell: false,
  });

  child.once("error", async (error) => {
    await clearReadyTimer();
    await writeState({
      status: "failed",
      detail: `Failed to spawn child process: ${formatError(error)}`,
    });
    process.exitCode = 1;
  });

  await writeState({
    status: "starting",
    childPid: child.pid,
    detail: `${service.command} ${service.args.join(" ")}`,
  });

  const recentOutput = [];

  const handleChunk = async (streamName, chunk) => {
    const text = chunk.toString("utf8");
    recentOutput.push(text);
    if (recentOutput.length > 32) {
      recentOutput.shift();
    }

    await appendLog(`[${streamName}] ${text}`);
    if (streamName === "stderr") {
      process.stderr.write(text);
    } else {
      process.stdout.write(text);
    }

    await maybeMarkReady(service.kind, recentOutput.join(""));
  };

  child.stdout?.on("data", (chunk) => {
    void handleChunk("stdout", chunk);
  });
  child.stderr?.on("data", (chunk) => {
    void handleChunk("stderr", chunk);
  });

  for (const signal of ["SIGINT", "SIGTERM"]) {
    process.on(signal, () => {
      void forwardSignal(signal);
    });
  }

  await new Promise((resolve) => {
    child.once("exit", async (code, signal) => {
      await clearReadyTimer();

      const nextState = readyWritten
        ? {
            status: "exited",
            childPid: child?.pid,
            detail: `Service stopped with ${describeExit(code, signal)}.`,
          }
        : {
            status: "failed",
            childPid: child?.pid,
            detail: `Service stopped before readiness with ${describeExit(code, signal)}.`,
          };

      await writeState(nextState);
      process.exitCode = code ?? 1;
      resolve();
    });
  });
}

function parseArgs(values) {
  const result = {};
  for (let index = 0; index < values.length; index += 1) {
    const current = values[index];
    if (!current.startsWith("--")) {
      continue;
    }

    result[current.slice(2)] = values[index + 1];
    index += 1;
  }

  return result;
}

async function loadDotEnv(filePath) {
  if (!(await exists(filePath))) {
    return {};
  }

  const content = await readFile(filePath, "utf8");
  const values = {};
  for (const rawLine of content.split(/\r?\n/u)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) {
      continue;
    }

    const match = line.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/u);
    if (!match) {
      continue;
    }

    const [, key, rawValue] = match;
    let value = rawValue.trim();
    if ((value.startsWith("\"") && value.endsWith("\"")) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }

    values[key] = value;
  }

  return values;
}

async function maybeMarkReady(kind, combinedOutput) {
  if (readyWritten) {
    return;
  }

  if (kind === "api" && combinedOutput.includes("DramaFlow API listening on")) {
    await writeReady("Detected API listening banner.");
    return;
  }

  if (kind === "web" && (combinedOutput.includes("Ready in") || combinedOutput.includes("Local:"))) {
    await writeReady("Detected Next.js startup banner.");
    return;
  }

  if (kind === "worker" && combinedOutput.includes("[worker] polling")) {
    if (!readyTimer) {
      readyTimer = setTimeout(() => {
        void writeReady("Detected worker polling banner and short stability window.");
      }, 2_000);
    }
  }
}

async function writeReady(detail) {
  if (readyWritten) {
    return;
  }

  readyWritten = true;
  await clearReadyTimer();
  await writeState({
    status: "ready",
    childPid: child?.pid,
    readyAt: new Date().toISOString(),
    detail,
  });
}

async function clearReadyTimer() {
  if (!readyTimer) {
    return;
  }

  clearTimeout(readyTimer);
  readyTimer = null;
}

async function forwardSignal(signal) {
  if (shuttingDown) {
    return;
  }

  shuttingDown = true;
  if (child && !child.killed) {
    child.kill(signal);
  }
}

async function appendLog(text) {
  await writeFile(logFile, text, { encoding: "utf8", flag: "a" });
}

async function writeState(nextState) {
  const currentState = (await readExistingState()) ?? {};
  const payload = {
    service: serviceName,
    updatedAt: new Date().toISOString(),
    ...currentState,
    ...nextState,
  };

  await writeFile(stateFile, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

async function readExistingState() {
  if (!(await exists(stateFile))) {
    return null;
  }

  try {
    return JSON.parse(await readFile(stateFile, "utf8"));
  } catch {
    return null;
  }
}

async function exists(targetPath) {
  try {
    await access(targetPath);
    return true;
  } catch {
    return false;
  }
}

function describeExit(code, signal) {
  if (signal) {
    return `signal ${signal}`;
  }

  return `exit code ${code ?? "unknown"}`;
}

function capitalize(value) {
  return value.slice(0, 1).toUpperCase() + value.slice(1);
}

function formatError(error) {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}
