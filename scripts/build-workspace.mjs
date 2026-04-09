import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const isWindows = process.platform === "win32";
const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const webDir = path.join(rootDir, "apps", "web");
const nextCliPath = path.join(rootDir, "node_modules", "next", "dist", "bin", "next");
const npmRunner = resolveNpmRunner();

main().catch((error) => {
  process.stderr.write(`${formatError(error)}\n`);
  process.exitCode = 1;
});

async function main() {
  await runStep("shared build", npmRunner.command, [...npmRunner.baseArgs, "--workspace", "@dramaflow/shared", "run", "build"], rootDir);
  await runStep("api build", npmRunner.command, [...npmRunner.baseArgs, "--workspace", "@dramaflow/api", "run", "build"], rootDir);
  await runStep("worker build", npmRunner.command, [...npmRunner.baseArgs, "--workspace", "@dramaflow/worker", "run", "build"], rootDir);

  if (isWindows) {
    await runStep(
      "web build",
      process.execPath,
      [nextCliPath, "build", "--experimental-build-mode", "compile"],
      webDir,
    );
    return;
  }

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

async function runStep(label, command, args, cwd) {
  process.stdout.write(`[DramaFlow] Running ${label}...\n`);

  await new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env: process.env,
      stdio: "inherit",
      shell: false,
    });

    child.once("error", (error) => {
      reject(new Error(`[DramaFlow] Could not start ${label}: ${formatError(error)}`));
    });

    child.once("exit", (code, signal) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(new Error(`[DramaFlow] ${label} failed with ${describeExit(code, signal)}.`));
    });
  });
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
