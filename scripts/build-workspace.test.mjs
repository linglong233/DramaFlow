import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const buildWorkspaceSource = readFileSync(join(scriptDir, "build-workspace.mjs"), "utf8");

assert.ok(
  buildWorkspaceSource.includes(`"--workspace", "@dramaflow/web", "run", "build"`),
  "web builds must use the workspace build script so start-all receives complete Next.js production outputs",
);

assert.ok(
  buildWorkspaceSource.includes("Skipping api prisma generate (generated client is current)."),
  "api prisma generate should be skipped when the generated client already matches schema.prisma",
);

assert.doesNotMatch(
  buildWorkspaceSource,
  /--experimental-build-mode|nextCliPath/u,
  "web builds must not use Next.js experimental compile mode because it can hang and does not finalize BUILD_ID",
);

await test("terminates a build step that exceeds the configured timeout", async () => {
  const tempDir = mkdtempSync(join(tmpdir(), "dramaflow-build-workspace-"));
  const fakeNpmPath = join(tempDir, "fake-npm.mjs");

  writeFileSync(
    fakeNpmPath,
    [
      "const args = process.argv.slice(2);",
      "process.stdout.write(`[fake npm] ${args.join(\" \")}\\n`);",
      "if (args.includes(\"@dramaflow/web\")) {",
      "  setTimeout(() => {",
      "    process.stdout.write(\"[fake npm] web completed late\\n\");",
      "    process.exit(0);",
      "  }, 5000);",
      "} else {",
      "  process.exit(0);",
      "}",
      "",
    ].join("\n"),
    "utf8",
  );

  try {
    const result = await runBuildWorkspace(
      {
        ...process.env,
        DRAMAFLOW_BUILD_TIMEOUT_MS: "1000",
        npm_execpath: fakeNpmPath,
        NPM_CLI_JS: fakeNpmPath,
      },
      3000,
    );

    assert.notEqual(result.code, 0);
    assert.match(`${result.stdout}\n${result.stderr}`, /web build timed out after 1000ms/u);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

console.log("build workspace tests passed");

function runBuildWorkspace(env, deadlineMs) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [join(scriptDir, "build-workspace.mjs")], {
      cwd: join(scriptDir, ".."),
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    let settled = false;

    const deadline = setTimeout(() => {
      if (settled) {
        return;
      }

      settled = true;
      child.kill("SIGKILL");
      reject(new Error(`build script did not exit within ${deadlineMs}ms\nstdout:\n${stdout}\nstderr:\n${stderr}`));
    }, deadlineMs);

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");

    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });

    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });

    child.once("error", (error) => {
      if (settled) {
        return;
      }

      settled = true;
      clearTimeout(deadline);
      reject(error);
    });

    child.once("exit", (code, signal) => {
      if (settled) {
        return;
      }

      settled = true;
      clearTimeout(deadline);
      resolve({ code, signal, stdout, stderr });
    });
  });
}
