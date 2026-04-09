import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { access, copyFile, mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const isWindows = process.platform === "win32";
const inlineMode = !isWindows || process.env.DRAMAFLOW_START_INLINE === "1";
const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const launchServiceScript = path.join(rootDir, "scripts", "launch-service.mjs");
const sessionTimeoutMs = parsePositiveInteger(process.env.DRAMAFLOW_START_TIMEOUT_MS, 90_000);
const repoSlug = createRepoSlug(rootDir);
const sessionRootDir = path.join(os.tmpdir(), "dramaflow-startup", repoSlug);
const sessionDir = path.join(sessionRootDir, `session-${formatTimestamp()}-${process.pid}`);
const sessionFile = path.join(sessionDir, "session.json");
const npmRunner = resolveNpmRunner();

let attachedChildren = [];
let shuttingDown = false;

main().catch(async (error) => {
  await stopAttachedChildren(1);
  process.stdout.write(`${formatError(error)}\n`);
  process.exitCode = 1;
});

async function main() {
  await ensureEnvFile();
  await ensureCommandAvailable(process.execPath, ["--version"], "Node.js");
  await ensureCommandAvailable(npmRunner.command, [...npmRunner.baseArgs, "--version"], npmRunner.label);
  if (isWindows && !inlineMode) {
    await ensureCommandAvailable("powershell.exe", ["-NoProfile", "-Command", "$PSVersionTable.PSVersion.ToString()"], "PowerShell");
  }

  const envValues = await loadMergedEnvValues();
  const urls = resolveWorkspaceUrls(envValues);

  if (urls.api.port === urls.web.port) {
    throw new Error(
      `[DramaFlow] API and Web resolved to the same port (${urls.api.port}). Update APP_URL / API_URL before running start-all again.`,
    );
  }

  await cleanupStaleSessions(sessionRootDir);
  await mkdir(sessionDir, { recursive: true });

  await assertPortAvailable(urls.web.port, "Web", "APP_URL");
  await assertPortAvailable(urls.api.port, "API", "API_URL");

  await maybeInstallDependencies();
  await runCommand(npmRunner.command, [...npmRunner.baseArgs, "run", "build"], {
    cwd: rootDir,
    env: {
      ...process.env,
      NODE_ENV: "production",
    },
    label: "Building workspace",
  });

  await assertBuildOutputs();

  const session = createSessionDefinition(urls);
  await writeJson(sessionFile, session);
  await writeWindowsServiceLaunchers(session);

  if (inlineMode) {
    attachedChildren = await launchAttachedServices(session);
    setupAttachedSignalHandlers();
  } else {
    await launchWindowsServiceWindows(session);
  }

  await waitForReadiness(session);
  printSuccessSummary(session);

  if (inlineMode) {
    await waitForAttachedServices();
  }
}

function createRepoSlug(input) {
  const baseName = path.basename(input).replace(/[^a-zA-Z0-9._-]+/g, "-");
  const hash = createHash("sha1").update(input).digest("hex").slice(0, 8);
  return `${baseName}-${hash}`;
}

function resolveNpmRunner() {
  if (!isWindows) {
    return {
      command: "npm",
      baseArgs: [],
      label: "npm",
    };
  }

  const npmCliPath =
    process.env.npm_execpath ??
    process.env.NPM_CLI_JS ??
    path.join(path.dirname(process.execPath), "node_modules", "npm", "bin", "npm-cli.js");

  return {
    command: process.execPath,
    baseArgs: [npmCliPath],
    label: "npm.cmd",
  };
}

function formatTimestamp() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function parsePositiveInteger(rawValue, fallbackValue) {
  const parsed = Number(rawValue);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallbackValue;
  }

  return Math.floor(parsed);
}

async function ensureEnvFile() {
  const envPath = path.join(rootDir, ".env");
  const examplePath = path.join(rootDir, ".env.example");

  if (await exists(envPath)) {
    return;
  }

  if (!(await exists(examplePath))) {
    throw new Error("[DramaFlow] .env is missing and .env.example could not be found.");
  }

  process.stdout.write("[DramaFlow] .env not found. Copying from .env.example...\n");
  await copyFile(examplePath, envPath);
}

async function ensureCommandAvailable(command, args, label) {
  const result = spawnSync(command, args, { cwd: rootDir, stdio: "ignore" });
  if (result.error || result.status !== 0) {
    throw new Error(`[DramaFlow] ${label} was not found or could not be executed.`);
  }
}

async function loadMergedEnvValues() {
  const envPath = path.join(rootDir, ".env");
  const fileContents = await readFile(envPath, "utf8");
  const fileValues = parseDotEnv(fileContents);
  return {
    ...fileValues,
    ...process.env,
  };
}

function parseDotEnv(content) {
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

function resolveWorkspaceUrls(envValues) {
  const apiOrigin = normalizeOrigin(
    envValues.API_URL ?? envValues.NEXT_PUBLIC_API_URL ?? (envValues.PORT ? `http://localhost:${envValues.PORT}` : undefined),
    "http://localhost:4000",
  );
  const webOrigin = normalizeOrigin(envValues.APP_URL, "http://localhost:3000");
  const publicApiOrigin = normalizeOrigin(envValues.NEXT_PUBLIC_API_URL ?? apiOrigin, apiOrigin);

  return {
    api: {
      origin: apiOrigin,
      port: portFromOrigin(apiOrigin, 4000),
      healthUrl: `${apiOrigin}/health`,
      docsUrl: `${apiOrigin}/docs`,
    },
    web: {
      origin: webOrigin,
      port: portFromOrigin(webOrigin, 3000),
      loginUrl: `${webOrigin}/login`,
    },
    publicApiOrigin,
  };
}

function normalizeOrigin(rawValue, fallbackValue) {
  const input = rawValue && rawValue.trim() ? rawValue.trim() : fallbackValue;
  let url;
  try {
    url = new URL(input);
  } catch {
    throw new Error(`[DramaFlow] Invalid URL value: ${input}`);
  }

  if (!url.protocol || !/^https?:$/u.test(url.protocol)) {
    throw new Error(`[DramaFlow] Only http(s) URLs are supported for startup preflight: ${input}`);
  }

  if (!url.port) {
    url.port = url.protocol === "https:" ? "443" : "80";
  }

  return formatOrigin(url);
}

function portFromOrigin(origin, fallbackPort) {
  const url = new URL(origin);
  const parsed = Number(url.port);
  if (Number.isFinite(parsed) && parsed > 0) {
    return parsed;
  }

  return fallbackPort;
}

function formatOrigin(url) {
  return `${url.protocol}//${url.host}`;
}

async function cleanupStaleSessions(baseDir) {
  await mkdir(baseDir, { recursive: true });
  const entries = await readdir(baseDir, { withFileTypes: true });

  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }

    const fullPath = path.join(baseDir, entry.name);
    if (await isStaleSession(fullPath)) {
      await rm(fullPath, { recursive: true, force: true });
    }
  }
}

async function isStaleSession(fullPath) {
  const stateFiles = ["api.state.json", "web.state.json", "worker.state.json"];
  let foundState = false;
  let allTerminal = true;

  for (const fileName of stateFiles) {
    const statePath = path.join(fullPath, fileName);
    if (!(await exists(statePath))) {
      continue;
    }

    foundState = true;
    try {
      const payload = JSON.parse(await readFile(statePath, "utf8"));
      if (!["failed", "exited"].includes(payload?.status)) {
        allTerminal = false;
      }
    } catch {
      return true;
    }
  }

  if (foundState && allTerminal) {
    return true;
  }

  const stats = await stat(fullPath);
  return Date.now() - stats.mtimeMs > 12 * 60 * 60 * 1000;
}

async function assertPortAvailable(port, label, envName) {
  const probeOptions = [
    { host: "::", ipv6Only: false },
    { host: "0.0.0.0" },
  ];

  let lastCapabilityError = null;

  for (const options of probeOptions) {
    try {
      await probePort(port, label, envName, options);
      return;
    } catch (error) {
      const errorCode = error && typeof error === "object" && "code" in error ? error.code : undefined;
      if (["EAFNOSUPPORT", "EADDRNOTAVAIL"].includes(errorCode)) {
        lastCapabilityError = error;
        continue;
      }

      throw error;
    }
  }

  throw new Error(
    `[DramaFlow] Could not verify ${label} port ${port}: ${formatError(lastCapabilityError ?? new Error("No supported listen address was available."))}`,
  );
}

async function probePort(port, label, envName, options) {
  await new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();

    server.on("error", (error) => {
      if (error && typeof error === "object" && "code" in error && ["EADDRINUSE", "EACCES"].includes(error.code)) {
        reject(
          new Error(
            `[DramaFlow] ${label} port ${port} is not available. Update ${envName} in .env or stop the existing process before running start-all again.`,
          ),
        );
        return;
      }

      reject(error);
    });

    server.listen(
      {
        port,
        host: options.host,
        ipv6Only: options.ipv6Only,
        exclusive: true,
      },
      () => {
        server.close((closeError) => {
          if (closeError) {
            reject(new Error(`[DramaFlow] Could not close the temporary ${label} port probe: ${formatError(closeError)}`));
            return;
          }

          resolve();
        });
      },
    );
  });
}

async function maybeInstallDependencies() {
  const nodeModulesPath = path.join(rootDir, "node_modules");
  if (await exists(nodeModulesPath)) {
    return;
  }

  await runCommand(npmRunner.command, [...npmRunner.baseArgs, "install"], {
    cwd: rootDir,
    label: "Installing dependencies",
  });
}

async function runCommand(command, args, options) {
  process.stdout.write(`[DramaFlow] ${options.label}...\n`);

  await new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env ?? process.env,
      stdio: "inherit",
      shell: false,
    });

    child.once("error", (error) => {
      reject(new Error(`[DramaFlow] ${options.label} failed to start: ${formatError(error)}`));
    });

    child.once("exit", (code, signal) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(new Error(`[DramaFlow] ${options.label} failed with ${describeExit(code, signal)}.`));
    });
  });
}

async function assertBuildOutputs() {
  const expectedFiles = [
    path.join(rootDir, "apps", "web", ".next", "BUILD_ID"),
    path.join(rootDir, "apps", "api", "dist", "apps", "api", "src", "main.js"),
    path.join(rootDir, "apps", "worker", "dist", "index.js"),
  ];

  for (const filePath of expectedFiles) {
    if (!(await exists(filePath))) {
      throw new Error(`[DramaFlow] Build output is missing: ${path.relative(rootDir, filePath)}`);
    }
  }
}

function createSessionDefinition(urls) {
  return {
    rootDir,
    sessionDir,
    createdAt: new Date().toISOString(),
    timeoutMs: sessionTimeoutMs,
    urls,
    services: {
      api: {
        title: "DramaFlow API",
        kind: "api",
        command: npmRunner.command,
        args: [...npmRunner.baseArgs, "--workspace", "@dramaflow/api", "run", "start"],
        envOverrides: {
          APP_URL: urls.web.origin,
          API_URL: urls.api.origin,
          NEXT_PUBLIC_API_URL: urls.publicApiOrigin,
          PORT: String(urls.api.port),
        },
      },
      web: {
        title: "DramaFlow Web",
        kind: "web",
        command: npmRunner.command,
        args: [...npmRunner.baseArgs, "--workspace", "@dramaflow/web", "run", "start"],
        envOverrides: {
          NODE_ENV: "production",
          APP_URL: urls.web.origin,
          API_URL: urls.api.origin,
          NEXT_PUBLIC_API_URL: urls.publicApiOrigin,
          PORT: String(urls.web.port),
        },
      },
      worker: {
        title: "DramaFlow Worker",
        kind: "worker",
        command: npmRunner.command,
        args: [...npmRunner.baseArgs, "--workspace", "@dramaflow/worker", "run", "start"],
        envOverrides: {
          APP_URL: urls.web.origin,
          API_URL: urls.api.origin,
          NEXT_PUBLIC_API_URL: urls.publicApiOrigin,
        },
      },
    },
  };
}

async function launchAttachedServices(session) {
  const children = [];
  for (const serviceName of ["api", "web", "worker"]) {
    process.stdout.write(`[DramaFlow] Launching ${session.services[serviceName].title} in attached mode...\n`);
    const child = spawn(process.execPath, [launchServiceScript, "--session", session.sessionDir, "--service", serviceName], {
      cwd: rootDir,
      stdio: "inherit",
      env: process.env,
      shell: false,
    });

    children.push({ name: serviceName, process: child });
  }

  return children;
}

async function writeWindowsServiceLaunchers(session) {
  if (!isWindows) {
    return;
  }

  const launchDebug = {
    rootDir,
    sessionDir: session.sessionDir,
    generatedAt: new Date().toISOString(),
    launchMode: "powershell-start-process",
    services: {},
  };

  for (const serviceName of ["api", "web", "worker"]) {
    const launcherPath = getWindowsServiceLauncherPath(session.sessionDir, serviceName);
    const launcherLines = [
      "@echo off",
      "setlocal EnableExtensions",
      `title ${session.services[serviceName].title}`,
      `cd /d "${rootDir}"`,
      `"${process.execPath}" "${launchServiceScript}" --session "${session.sessionDir}" --service ${serviceName}`,
      "set \"EXIT_CODE=%ERRORLEVEL%\"",
      "if not \"%EXIT_CODE%\"==\"0\" (",
      "  echo.",
      `  echo [DramaFlow] ${session.services[serviceName].title} exited with code %EXIT_CODE%.`,
      "  pause",
      ")",
      "exit /b %EXIT_CODE%",
      "",
    ];

    await writeFile(launcherPath, launcherLines.join("\r\n"), "utf8");
    launchDebug.services[serviceName] = {
      title: session.services[serviceName].title,
      launcherPath,
      shellCommand: [process.env.ComSpec ?? "cmd.exe", "/d", "/k", `"${launcherPath}"`],
    };
  }

  await writeJson(path.join(session.sessionDir, "launch-debug.json"), launchDebug);
}

function getWindowsServiceLauncherPath(currentSessionDir, serviceName) {
  return path.join(currentSessionDir, `launch-${serviceName}.cmd`);
}

async function launchWindowsServiceWindows(session) {
  for (const serviceName of ["api", "web", "worker"]) {
    const launcherPath = getWindowsServiceLauncherPath(session.sessionDir, serviceName);
    const commandProcessor = process.env.ComSpec ?? "cmd.exe";
    const powershellScript = [
      "$ErrorActionPreference = 'Stop'",
      `$launcherPath = ${toPowerShellSingleQuotedString(launcherPath)}`,
      `$workingDirectory = ${toPowerShellSingleQuotedString(rootDir)}`,
      `$commandProcessor = ${toPowerShellSingleQuotedString(commandProcessor)}`,
      "Start-Process -FilePath $commandProcessor -WorkingDirectory $workingDirectory -ArgumentList @('/d', '/k', ('\"' + $launcherPath + '\"'))",
    ].join("; ");

    process.stdout.write(`[DramaFlow] Opening ${session.services[serviceName].title} window...\n`);

    await new Promise((resolve, reject) => {
      const child = spawn("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", powershellScript], {
        cwd: rootDir,
        stdio: "inherit",
        env: process.env,
        shell: false,
      });

      child.once("error", (error) => {
        reject(new Error(`[DramaFlow] Could not open the ${capitalize(serviceName)} window: ${formatError(error)}`));
      });

      child.once("exit", (code) => {
        if (code === 0) {
          resolve();
          return;
        }

        reject(
          new Error(
            `[DramaFlow] Could not open the ${capitalize(serviceName)} window. See ${path.join(session.sessionDir, "launch-debug.json")} for launch details.`,
          ),
        );
      });
    });
  }
}

function toPowerShellSingleQuotedString(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

async function waitForReadiness(session) {
  const deadline = Date.now() + session.timeoutMs;
  let lastSnapshot = null;

  while (Date.now() < deadline) {
    const states = await loadServiceStates(session.sessionDir);
    lastSnapshot = states;

    throwIfServiceFailedBeforeReady(session.sessionDir, "api", states.api);
    throwIfServiceFailedBeforeReady(session.sessionDir, "web", states.web);
    throwIfServiceFailedBeforeReady(session.sessionDir, "worker", states.worker);

    const [apiReady, webReady] = await Promise.all([
      checkHttpReady(session.urls.api.healthUrl),
      checkHttpReady(session.urls.web.origin),
    ]);
    const workerReady = states.worker?.status === "ready";

    if (apiReady && webReady && workerReady) {
      return;
    }

    await sleep(500);
  }

  const details = formatStateSummary(lastSnapshot);
  throw new Error(
    `[DramaFlow] Timed out after ${Math.round(session.timeoutMs / 1000)}s waiting for API /health, Web, and Worker readiness.${details ? ` ${details}` : ""}`,
  );
}

function throwIfServiceFailedBeforeReady(currentSessionDir, serviceName, state) {
  if (!state) {
    return;
  }

  if (state.status === "failed") {
    throw new Error(
      `[DramaFlow] ${capitalize(serviceName)} failed during startup. See ${path.join(currentSessionDir, `${serviceName}.log`)} for details.`,
    );
  }

  if (state.status === "exited" && !state.readyAt) {
    throw new Error(
      `[DramaFlow] ${capitalize(serviceName)} exited before becoming ready. See ${path.join(currentSessionDir, `${serviceName}.log`)} for details.`,
    );
  }
}

async function loadServiceStates(currentSessionDir) {
  const result = {};
  for (const serviceName of ["api", "web", "worker"]) {
    const statePath = path.join(currentSessionDir, `${serviceName}.state.json`);
    if (!(await exists(statePath))) {
      result[serviceName] = null;
      continue;
    }

    try {
      result[serviceName] = JSON.parse(await readFile(statePath, "utf8"));
    } catch {
      result[serviceName] = { status: "failed", detail: "State file could not be parsed." };
    }
  }

  return result;
}

async function checkHttpReady(targetUrl) {
  try {
    const response = await fetch(targetUrl, {
      method: "GET",
      signal: AbortSignal.timeout(2_000),
    });

    return response.ok;
  } catch {
    return false;
  }
}

function printSuccessSummary(session) {
  process.stdout.write("\n");
  process.stdout.write("[DramaFlow] API, Web, and Worker are ready.\n");
  process.stdout.write(`[DramaFlow] Web: ${session.urls.web.origin}\n`);
  process.stdout.write(`[DramaFlow] Login: ${session.urls.web.loginUrl}\n`);
  process.stdout.write(`[DramaFlow] API: ${session.urls.api.healthUrl}\n`);
  process.stdout.write(`[DramaFlow] Swagger: ${session.urls.api.docsUrl}\n`);
  process.stdout.write(`[DramaFlow] Startup logs: ${session.sessionDir}\n`);
  if (inlineMode) {
    process.stdout.write("[DramaFlow] Press Ctrl+C to stop all three services.\n");
  } else {
    process.stdout.write("[DramaFlow] Windows service windows remain open for live logs and diagnosis.\n");
  }
  process.stdout.write("\n");
}

function setupAttachedSignalHandlers() {
  for (const signal of ["SIGINT", "SIGTERM"]) {
    process.on(signal, () => {
      void stopAttachedChildren(signal === "SIGINT" ? 0 : 1);
    });
  }
}

async function waitForAttachedServices() {
  if (attachedChildren.length === 0) {
    return;
  }

  const exitInfo = await Promise.race(
    attachedChildren.map(
      ({ name, process: child }) =>
        new Promise((resolve) => {
          child.once("exit", (code, signal) => {
            resolve({ name, code, signal });
          });
        }),
    ),
  );

  if (shuttingDown) {
    return;
  }

  process.stderr.write(
    `\n[DramaFlow] ${capitalize(exitInfo.name)} stopped with ${describeExit(exitInfo.code, exitInfo.signal)}. Shutting down the remaining services...\n`,
  );
  await stopAttachedChildren(exitInfo.code === 0 ? 0 : 1);
}

async function stopAttachedChildren(exitCode) {
  if (shuttingDown) {
    return;
  }

  shuttingDown = true;
  const children = attachedChildren;
  attachedChildren = [];

  for (const { process: child } of children) {
    if (!child.killed) {
      child.kill("SIGTERM");
    }
  }

  if (children.length > 0) {
    await Promise.all(
      children.map(
        ({ process: child }) =>
          new Promise((resolve) => {
            const timeout = setTimeout(() => {
              if (!child.killed) {
                child.kill("SIGKILL");
              }
            }, 5_000);

            child.once("exit", () => {
              clearTimeout(timeout);
              resolve();
            });
          }),
      ),
    );
  }

  process.exitCode = exitCode;
}

function formatStateSummary(states) {
  if (!states) {
    return "";
  }

  const parts = [];
  for (const serviceName of ["api", "web", "worker"]) {
    const state = states[serviceName];
    if (!state?.status) {
      continue;
    }

    parts.push(`${serviceName}=${state.status}`);
  }

  return parts.length > 0 ? `Latest markers: ${parts.join(", ")}.` : "";
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

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function exists(targetPath) {
  try {
    await access(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function writeJson(targetPath, value) {
  await writeFile(targetPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function formatError(error) {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}
