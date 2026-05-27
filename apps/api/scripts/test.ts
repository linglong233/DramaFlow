import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { NestFactory } from "@nestjs/core";
import express from "express";

import { PROJECT_PERMISSIONS } from "@dramaflow/shared";

import { AdminController } from "../src/admin/admin.controller";
import { AppModule } from "../src/app.module";
import { AuthController } from "../src/auth/auth.controller";
import { createEmptyDatabase } from "../src/common/database.types";
import { DevDatabaseService } from "../src/common/dev-database.service";
import { InternalJobsController } from "../src/jobs/internal-jobs.controller";
import { OpenAiMediaProvider } from "../src/jobs/media-generation.provider";
import { JobsController } from "../src/jobs/jobs.controller";
import { OpenAiCompatTextProvider } from "../src/jobs/text-generation.provider";
import { runPromptEvals } from "../src/jobs/prompting/prompt-evals";
import { UploadsController } from "../src/storage/uploads.controller";
import { WorkspaceController } from "../src/workspace/workspace.controller";

const originalFetch = globalThis.fetch;
const originalEnv = { ...process.env };
const baseScriptInput = {
  title: "Edge of Dawn",
  genre: "Urban Suspense",
  premise: "A director must rescue a collapsing production in one night.",
  episodeGoal: "Establish the central conflict.",
  tone: "Controlled and tense",
  audience: "Young urban viewers",
};

function restoreEnvironment() {
  for (const key of Object.keys(process.env)) {
    if (!(key in originalEnv)) {
      delete process.env[key];
    }
  }

  for (const [key, value] of Object.entries(originalEnv)) {
    if (value === undefined) {
      delete process.env[key];
      continue;
    }
    process.env[key] = value;
  }

  globalThis.fetch = originalFetch;
}

async function runCase(name: string, callback: () => Promise<void>) {
  restoreEnvironment();

  try {
    await callback();
    console.log(`api test passed: ${name}`);
  } finally {
    restoreEnvironment();
  }
}

async function withHttpApp<T>(callback: (baseUrl: string) => Promise<T>) {
  const tempRoot = await mkdtemp(join(tmpdir(), "dramaflow-api-test-"));
  process.env.DATA_DIR = join(tempRoot, "data");
  process.env.UPLOADS_DIR = join(tempRoot, "uploads");
  process.env.STORAGE_DRIVER = "local";
  process.env.JWT_ACCESS_SECRET = "test-access-secret";
  process.env.JWT_REFRESH_SECRET = "test-refresh-secret";

  const app = await NestFactory.create(AppModule, { logger: false });
  app.use("/uploads/direct", express.raw({ type: "*/*", limit: "100mb" }));

  try {
    await app.listen(0);

    const address = app.getHttpServer().address() as AddressInfo | null;
    if (!address) {
      throw new Error("Test server did not expose an address");
    }

    return await callback(`http://127.0.0.1:${address.port}`);
  } finally {
    await app.close();
    // Windows may hold file locks briefly after app.close(), retry cleanup
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        await rm(tempRoot, { recursive: true, force: true });
        break;
      } catch {
        if (attempt < 4) await new Promise((resolve) => setTimeout(resolve, 200));
      }
    }
  }
}

async function readResponse(response: Response) {
  const bodyText = await response.text();
  let json: unknown;

  if (bodyText) {
    try {
      json = JSON.parse(bodyText);
    } catch {
      json = undefined;
    }
  }

  return {
    status: response.status,
    bodyText,
    json,
  };
}

async function uploadTestAsset(
  baseUrl: string,
  accessToken: string,
  projectId: string,
  input: { filename: string; mimeType: string; body: string },
) {
  const createTarget = await originalFetch(`${baseUrl}/uploads`, {
    method: "POST",
    headers: {
      ...authHeaders(accessToken, true),
    },
    body: JSON.stringify({
      projectId,
      filename: input.filename,
      contentType: input.mimeType,
      sizeInBytes: Buffer.byteLength(input.body),
    }),
  });
  assert.equal(createTarget.status, 201);
  const payload = await createTarget.json() as {
    asset: { id: string };
    target: { key: string; publicUrl?: string; headers: Record<string, string> };
  };

  const directUpload = await originalFetch(`${baseUrl}/uploads/direct/${encodeURIComponent(payload.target.key)}`, {
    method: "PUT",
    headers: {
      ...payload.target.headers,
      ...authHeaders(accessToken),
    },
    body: input.body,
  });
  assert.equal(directUpload.status, 200);

  return {
    assetId: payload.asset.id,
    assetUrl: payload.target.publicUrl ?? `${baseUrl}/uploads/${payload.target.key}`,
  };
}

function parseSseEvents<T = Record<string, unknown>>(bodyText: string): T[] {
  return bodyText
    .split(/\n\n+/)
    .map((block) => block.trim())
    .filter(Boolean)
    .flatMap((block) => {
      const line = block.split(/\r?\n/).find((item) => item.trim().startsWith("data:"));
      if (!line) return [];
      const payload = line.trim().slice(5).trim();
      if (!payload || payload === "[DONE]") return [];
      return [JSON.parse(payload) as T];
    });
}

function lastDoneResult<T extends Record<string, unknown>>(bodyText: string): T {
  const events = parseSseEvents<{ type?: string; result?: T }>(bodyText);
  const done = events.filter((event) => event.type === "done").at(-1);
  assert.ok(done?.result, `Expected final done event in SSE body: ${bodyText}`);
  return done.result;
}

async function registerUser(baseUrl: string, input: { email: string; displayName: string; password?: string }) {
  const response = await originalFetch(`${baseUrl}/auth/register`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      email: input.email,
      password: input.password ?? "securepass123",
      displayName: input.displayName,
    }),
  });

  assert.equal(response.status, 201);
  return response.json() as Promise<{
    accessToken: string;
    user: { id: string; email: string };
  }>;
}

function authHeaders(accessToken: string, includeJson = false) {
  return {
    authorization: `Bearer ${accessToken}`,
    ...(includeJson ? { "content-type": "application/json" } : {}),
  };
}

async function listTeams(baseUrl: string, accessToken: string) {
  const response = await originalFetch(`${baseUrl}/teams`, {
    headers: authHeaders(accessToken),
  });

  assert.equal(response.status, 200);
  return response.json() as Promise<Array<{
    id: string;
    name: string;
    currentUserRole: string | null;
    canManage: boolean;
    llmConfig?: unknown;
  }>>;
}

async function listProjectVersions<T>(baseUrl: string, accessToken: string, projectId: string) {
  const response = await originalFetch(`${baseUrl}/projects/${projectId}/versions`, {
    headers: authHeaders(accessToken),
  });

  assert.equal(response.status, 200);
  const payload = await response.json() as { versions: T[] };
  return payload.versions;
}

function assertMethodsStayOnPrototype(controller: object, methodNames: string[]) {
  const prototype = Object.getPrototypeOf(controller) as Record<string, unknown>;
  const instance = controller as Record<string, unknown>;

  for (const methodName of methodNames) {
    assert.equal(
      Object.prototype.hasOwnProperty.call(controller, methodName),
      false,
      `${controller.constructor.name}.${methodName} should stay on the prototype`,
    );
    assert.equal(instance[methodName], prototype[methodName]);
  }
}

async function main() {
  const db = createEmptyDatabase();
  assert.equal(db.users.length, 0);
  assert.equal(db.projects.length, 0);

  await runCase("dev database normalizes missing conversation sessions", async () => {
    const tempRoot = await mkdtemp(join(tmpdir(), "dramaflow-db-normalize-"));
    const previousDataDir = process.env.DATA_DIR;
    process.env.DATA_DIR = join(tempRoot, "data");

    try {
      await mkdir(process.env.DATA_DIR, { recursive: true });
      const legacyDb = createEmptyDatabase() as Record<string, unknown>;
      delete legacyDb.conversationSessions;
      await writeFile(
        join(process.env.DATA_DIR, "dev-db.json"),
        JSON.stringify(legacyDb, null, 2),
        "utf-8",
      );

      const database = new DevDatabaseService();
      const count = await database.query((db) => db.conversationSessions.length);
      assert.equal(count, 0);
    } finally {
      if (previousDataDir === undefined) {
        delete process.env.DATA_DIR;
      } else {
        process.env.DATA_DIR = previousDataDir;
      }
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  await runCase("mock script fallback without API key", async () => {
    process.env.OPENAI_COMPAT_API_KEY = "test-key";
    process.env.OPENAI_COMPAT_BASE_URL = "https://example.test/v1";
    process.env.OPENAI_COMPAT_MOCK_FALLBACK = "true";

    const provider = new OpenAiCompatTextProvider();
    const script = await provider.generateScript(baseScriptInput);

    assert.ok(script.logline.includes("Edge of Dawn"));
    assert.ok(script.scenes.length >= 1);
  });

  await runCase("standard JSON text response", async () => {
    process.env.OPENAI_COMPAT_API_KEY = "test-key";
    process.env.OPENAI_COMPAT_BASE_URL = "https://example.test/v1";
    process.env.OPENAI_TEXT_MODEL = "moonshotai/kimi-k2-instruct";

    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      assert.equal(String(input), "https://example.test/v1/chat/completions");

      const body = JSON.parse(String(init?.body)) as {
        model: string;
        stream: boolean;
        response_format: { type: string };
      };
      assert.equal(body.model, "moonshotai/kimi-k2-instruct");
      assert.equal(body.stream, false);
      assert.equal(body.response_format.type, "json_object");

      return new Response(JSON.stringify({
        choices: [
          {
            message: {
              content: JSON.stringify({
                logline: "Real script",
                premise: "Real premise",
                characters: [],
                scenes: [],
              }),
            },
          },
        ],
      }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as typeof fetch;

    const provider = new OpenAiCompatTextProvider();
    const script = await provider.generateScript(baseScriptInput);

    assert.equal(script.logline, "Real script");
    assert.equal(script.premise, "Real premise");
    assert.equal(script.scenes.length, 0);
  });

  await runCase("SSE text response", async () => {
    process.env.OPENAI_COMPAT_API_KEY = "test-key";
    process.env.OPENAI_COMPAT_BASE_URL = "https://example.test/v1";
    process.env.OPENAI_TEXT_MODEL = "gpt-5.4";

    const sseBody = [
      JSON.stringify({ id: "chunk-1", choices: [] }),
      JSON.stringify({ id: "chunk-2", choices: [{ delta: { content: '{"logline":"SSE script",' } }] }),
      JSON.stringify({ id: "chunk-3", choices: [{ delta: { content: '"premise":"From a stream",' } }] }),
      JSON.stringify({ id: "chunk-4", choices: [{ delta: { content: '"characters":[],"scenes":[]}' } }] }),
    ].map((payload) => `data: ${payload}`).concat("data: [DONE]").join("\n\n");

    globalThis.fetch = (async () => {
      return new Response(sseBody, {
        status: 200,
        headers: { "content-type": "text/event-stream" },
      });
    }) as typeof fetch;

    const provider = new OpenAiCompatTextProvider();
    const script = await provider.generateScript(baseScriptInput);

    assert.equal(script.logline, "SSE script");
    assert.equal(script.premise, "From a stream");
    assert.equal(script.characters.length, 0);
  });

  await runCase("disabled mock fallback surfaces provider failures", async () => {
    process.env.OPENAI_COMPAT_API_KEY = "test-key";
    process.env.OPENAI_COMPAT_BASE_URL = "https://example.test/v1";
    process.env.OPENAI_COMPAT_MOCK_FALLBACK = "false";

    globalThis.fetch = (async () => {
      return new Response(JSON.stringify({ choices: [] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as typeof fetch;

    const provider = new OpenAiCompatTextProvider();

    await assert.rejects(
      provider.generateScript(baseScriptInput),
      /response did not contain parseable JSON content/,
    );
  });

  await runCase("controller instances preserve prototype methods", async () => {
    assertMethodsStayOnPrototype(new AuthController({} as never), [
      "register",
      "login",
      "refresh",
      "logout",
      "forgotPassword",
      "resetPassword",
      "me",
      "updateMe",
      "listMyLlmModels",
    ]);
    assertMethodsStayOnPrototype(new WorkspaceController({} as never), [
      "listTeams",
      "getTeam",
      "createTeam",
      "updateTeam",
      "listTeamLlmModels",
      "addTeamMember",
      "listProjects",
      "createProject",
      "getProject",
      "updateReviewPolicy",
      "inviteProjectMember",
      "addProjectMember",
      "listVersions",
      "createVersion",
      "submitVersion",
      "approveVersion",
      "rejectVersion",
      "listComments",
      "addComment",
      "getTeamPermissionTemplates",
      "updateTeamPermissionTemplates",
      "getProjectMemberPermissions",
      "updateProjectMemberPermissions",
    ]);
    assertMethodsStayOnPrototype(new AdminController({} as never), [
      "getPlatformOverview",
      "getTeamOverview",
      "getTeamSettings",
    ]);
    assertMethodsStayOnPrototype(new InternalJobsController({} as never), [
      "claimNextJob",
      "processJob",
    ]);
    assertMethodsStayOnPrototype(new JobsController({} as never), [
      "createScriptJob",
      "createStoryboardJob",
      "createImageJob",
      "generateCharacterRefImage",
      "generateLocationRefImage",
      "generateStyleGuideRefImage",
      "createVideoJob",
      "createNovelImportSession",
      "getLatestNovelImportSession",
      "getNovelImportSession",
      "startNovelImportSession",
      "cancelNovelImportSession",
      "retryNovelImportChunk",
      "rerunNovelImportFollowingChunks",
      "writeNovelImportDrafts",
      "createShotCompositionJob",
      "getJob",
    ]);
    assertMethodsStayOnPrototype(new UploadsController({} as never), [
      "createUploadTarget",
      "directUpload",
      "getAssetUrl",
    ]);
  });

  await runCase("novel import session creation chunks text and latest restores it", async () => {
    await withHttpApp(async (baseUrl) => {
      const user = await registerUser(baseUrl, {
        email: "novel-import@example.com",
        displayName: "Novel Importer",
      });

      const teams = await listTeams(baseUrl, user.accessToken);
      const projectResponse = await originalFetch(`${baseUrl}/projects`, {
        method: "POST",
        headers: authHeaders(user.accessToken, true),
        body: JSON.stringify({
          teamId: teams[0]?.id,
          name: "Novel Project",
          genre: "都市悬疑",
        }),
      });
      assert.equal(projectResponse.status, 201);
      const project = await projectResponse.json() as { id: string };

      const createResponse = await originalFetch(`${baseUrl}/projects/${project.id}/novel-import-sessions`, {
        method: "POST",
        headers: authHeaders(user.accessToken, true),
        body: JSON.stringify({
          text: "第一章 门后\n她推开门。\n\n第二章 来电\n电话响了。",
          targetEpisodeCount: 12,
          episodeDurationMinutes: 2,
          genreStyle: "都市悬疑",
          adaptationFocus: "强化反转",
          llmConfigSource: "team",
        }),
      });
      assert.equal(createResponse.status, 201);
      const created = await createResponse.json() as {
        session: {
          id: string;
          status: string;
          stage: string;
          sourceText: string;
          chunks: Array<{ index: number; title?: string; text: string; status: string }>;
        };
      };
      assert.equal(created.session.status, "draft");
      assert.equal(created.session.stage, "setup");
      assert.equal(created.session.sourceText.includes("第一章"), true);
      assert.equal(created.session.chunks.length, 2);
      assert.equal(created.session.chunks[0]?.title, "第一章 门后");
      assert.equal(created.session.chunks[1]?.status, "pending");

      const latestResponse = await originalFetch(`${baseUrl}/projects/${project.id}/novel-import-sessions/latest`, {
        headers: authHeaders(user.accessToken),
      });
      assert.equal(latestResponse.status, 200);
      const latest = await latestResponse.json() as { session: { id: string } | null };
      assert.equal(latest.session?.id, created.session.id);

      const getResponse = await originalFetch(`${baseUrl}/novel-import-sessions/${created.session.id}`, {
        headers: authHeaders(user.accessToken),
      });
      assert.equal(getResponse.status, 200);
    });
  });

  await runCase("novel import session start queues a worker job and cancel marks session", async () => {
    await withHttpApp(async (baseUrl) => {
      const user = await registerUser(baseUrl, {
        email: "novel-start@example.com",
        displayName: "Novel Starter",
      });
      const teams = await listTeams(baseUrl, user.accessToken);
      const projectResponse = await originalFetch(`${baseUrl}/projects`, {
        method: "POST",
        headers: authHeaders(user.accessToken, true),
        body: JSON.stringify({ teamId: teams[0]?.id, name: "Queued Novel" }),
      });
      assert.equal(projectResponse.status, 201);
      const project = await projectResponse.json() as { id: string };

      const sessionResponse = await originalFetch(`${baseUrl}/projects/${project.id}/novel-import-sessions`, {
        method: "POST",
        headers: authHeaders(user.accessToken, true),
        body: JSON.stringify({
          text: "第一章\n她推开门。\n\n第二章\n电话响了。",
          targetEpisodeCount: 8,
          episodeDurationMinutes: 2,
          genreStyle: "悬疑",
          adaptationFocus: "保留核心反转",
        }),
      });
      assert.equal(sessionResponse.status, 201);
      const created = await sessionResponse.json() as { session: { id: string } };

      const startResponse = await originalFetch(`${baseUrl}/novel-import-sessions/${created.session.id}/start`, {
        method: "POST",
        headers: authHeaders(user.accessToken, true),
      });
      assert.equal(startResponse.status, 201);
      const started = await startResponse.json() as {
        session: { status: string; lastJobId?: string };
        job: { id: string; type: string; status: string; input: { action: string; sessionId: string } };
      };
      assert.equal(started.session.status, "queued");
      assert.equal(started.job.type, "novel_import");
      assert.equal(started.job.input.action, "runSession");
      assert.equal(started.job.input.sessionId, created.session.id);
      assert.equal(started.session.lastJobId, started.job.id);

      const cancelResponse = await originalFetch(`${baseUrl}/novel-import-sessions/${created.session.id}/cancel`, {
        method: "POST",
        headers: authHeaders(user.accessToken, true),
      });
      assert.equal(cancelResponse.status, 201);
      const cancelled = await cancelResponse.json() as { session: { status: string; stage: string } };
      assert.equal(cancelled.session.status, "cancelled");
    });
  });

  await runCase("novel import worker generates preview without writing drafts", async () => {
    process.env.OPENAI_COMPAT_API_KEY = "test-key";
    process.env.OPENAI_COMPAT_BASE_URL = "https://example.test/v1";
    process.env.OPENAI_TEXT_MODEL = "gpt-test";

    const replies = [
      "主要人物：林夏。核心冲突：她发现门后秘密。目标集数：8。",
      JSON.stringify({
        characters: [{ id: "char-1", name: "林夏", appearance: "短发，黑色风衣", personality: "冷静", tags: ["主角"], referenceImages: [], sortOrder: 0 }],
        locations: [{ id: "loc-1", name: "旧公寓", description: "昏暗狭窄", referenceImages: [], sortOrder: 0 }],
        styleGuide: { visualStyle: "冷峻都市悬疑" },
      }),
      "## 故事概览\n林夏在旧公寓发现秘密。\n\n## 分集大纲\n1. 门后秘密。",
      JSON.stringify({
        scenes: [{
          id: "scene-1",
          heading: "INT. 旧公寓 - 夜",
          synopsis: "林夏推开门。",
          characters: ["林夏"],
          dialogue: [{ speaker: "林夏", line: "谁在那里？" }],
          directorNote: "低光推进。",
        }],
        summary: "林夏进入旧公寓。",
        continuityNotes: "她还不知道来电者身份。",
      }),
      JSON.stringify({
        scenes: [{
          id: "scene-2",
          heading: "INT. 旧公寓 - 夜",
          synopsis: "电话响起。",
          characters: ["林夏"],
          dialogue: [{ speaker: "来电者", line: "别回头。" }],
          directorNote: "电话铃声压迫。",
        }],
        summary: "神秘来电警告林夏。",
        continuityNotes: "下一段揭示来电者。",
      }),
    ];

    globalThis.fetch = (async () => {
      const content = replies.shift() ?? "{}";
      const sseBody = [
        `data: ${JSON.stringify({ choices: [{ delta: { content } }] })}`,
        "data: [DONE]",
      ].join("\n\n");
      return new Response(sseBody, {
        status: 200,
        headers: { "content-type": "text/event-stream" },
      });
    }) as typeof fetch;

    await withHttpApp(async (baseUrl) => {
      const user = await registerUser(baseUrl, {
        email: "novel-worker@example.com",
        displayName: "Novel Worker",
      });
      const updateProfileResponse = await originalFetch(`${baseUrl}/auth/me`, {
        method: "PATCH",
        headers: authHeaders(user.accessToken, true),
        body: JSON.stringify({
          llmConfig: {
            provider: "openai-completions",
            apiKey: "test-key",
            baseUrl: "https://example.test/v1",
            model: "gpt-test",
            stream: true,
          },
        }),
      });
      assert.equal(updateProfileResponse.status, 200);
      const teams = await listTeams(baseUrl, user.accessToken);
      const projectResponse = await originalFetch(`${baseUrl}/projects`, {
        method: "POST",
        headers: authHeaders(user.accessToken, true),
        body: JSON.stringify({ teamId: teams[0]?.id, name: "Worker Novel" }),
      });
      assert.equal(projectResponse.status, 201);
      const project = await projectResponse.json() as { id: string };

      const sessionResponse = await originalFetch(`${baseUrl}/projects/${project.id}/novel-import-sessions`, {
        method: "POST",
        headers: authHeaders(user.accessToken, true),
        body: JSON.stringify({
          text: "第一章\n她推开门。\n\n第二章\n电话响了。",
          targetEpisodeCount: 8,
          episodeDurationMinutes: 2,
          genreStyle: "都市悬疑",
          adaptationFocus: "强化悬念",
          llmConfigSource: "personal",
        }),
      });
      const { session } = await sessionResponse.json() as { session: { id: string } };

      const startResponse = await originalFetch(`${baseUrl}/novel-import-sessions/${session.id}/start`, {
        method: "POST",
        headers: authHeaders(user.accessToken, true),
      });
      const { job } = await startResponse.json() as { job: { id: string } };

      const processResponse = await originalFetch(`${baseUrl}/internal/jobs/${job.id}/process`, {
        method: "POST",
        headers: { "x-internal-key": process.env.INTERNAL_API_KEY ?? "dramaflow-internal-key" },
      });
      assert.equal(processResponse.status, 201);

      const getResponse = await originalFetch(`${baseUrl}/novel-import-sessions/${session.id}`, {
        headers: authHeaders(user.accessToken),
      });
      const loaded = await getResponse.json() as {
        session: {
          status: string;
          stage: string;
          adaptationPlan?: string;
          worldBible?: { characters: Array<{ name: string }> };
          synopsis?: string;
          scriptPreview?: { scenes: Array<{ id: string }> };
          writeResult?: unknown;
        };
      };
      assert.equal(loaded.session.status, "needs_review");
      assert.equal(loaded.session.stage, "review");
      assert.equal(loaded.session.adaptationPlan?.includes("林夏"), true);
      assert.equal(loaded.session.worldBible?.characters[0]?.name, "林夏");
      assert.equal(loaded.session.synopsis?.includes("故事概览"), true);
      assert.equal(loaded.session.scriptPreview?.scenes.length, 2);
      assert.equal(loaded.session.writeResult, undefined);
    });
  });

  await runCase("novel import retry rerun and write drafts are recoverable", async () => {
    process.env.OPENAI_COMPAT_API_KEY = "test-key";
    process.env.OPENAI_COMPAT_BASE_URL = "https://example.test/v1";
    process.env.OPENAI_TEXT_MODEL = "gpt-test";

    const replies = [
      "主要人物：林夏。核心冲突：她发现门后秘密。目标集数：8。",
      JSON.stringify({
        characters: [{ id: "char-1", name: "林夏", appearance: "短发，黑色风衣", personality: "冷静", tags: ["主角"], referenceImages: [], sortOrder: 0 }],
        locations: [{ id: "loc-1", name: "旧公寓", description: "昏暗狭窄", referenceImages: [], sortOrder: 0 }],
        styleGuide: { visualStyle: "冷峻都市悬疑" },
      }),
      "## 故事概览\n林夏发现门后秘密。",
      JSON.stringify({
        scenes: [{ id: "scene-1", heading: "INT. 旧公寓 - 夜", synopsis: "林夏进门。", characters: ["林夏"], dialogue: [], directorNote: "压低环境声。" }],
        summary: "第一块初稿。",
        continuityNotes: "电话即将响起。",
      }),
      JSON.stringify({
        scenes: [{ id: "scene-2", heading: "INT. 旧公寓 - 夜", synopsis: "电话响起。", characters: ["林夏"], dialogue: [], directorNote: "电话铃声突出。" }],
        summary: "第二块初稿。",
        continuityNotes: "秘密升级。",
      }),
      JSON.stringify({
        scenes: [{ id: "scene-1r", heading: "INT. 旧公寓 - 夜", synopsis: "林夏发现门缝血迹。", characters: ["林夏"], dialogue: [], directorNote: "特写门缝。" }],
        summary: "重试后的第一块。",
        continuityNotes: "后续必须接血迹线索。",
      }),
      JSON.stringify({
        scenes: [{ id: "scene-1rr", heading: "INT. 旧公寓 - 夜", synopsis: "林夏确认血迹。", characters: ["林夏"], dialogue: [], directorNote: "手持镜头。" }],
        summary: "重跑后的第一块。",
        continuityNotes: "电话接血迹线索。",
      }),
      JSON.stringify({
        scenes: [{ id: "scene-2rr", heading: "INT. 旧公寓 - 夜", synopsis: "来电者提到血迹。", characters: ["林夏"], dialogue: [{ speaker: "来电者", line: "你已经看见了。" }], directorNote: "铃声戛然而止。" }],
        summary: "重跑后的第二块。",
        continuityNotes: "进入下一幕追查。",
      }),
    ];

    globalThis.fetch = (async () => {
      const content = replies.shift() ?? "{}";
      const sseBody = [
        `data: ${JSON.stringify({ choices: [{ delta: { content } }] })}`,
        "data: [DONE]",
      ].join("\n\n");
      return new Response(sseBody, {
        status: 200,
        headers: { "content-type": "text/event-stream" },
      });
    }) as typeof fetch;

    await withHttpApp(async (baseUrl) => {
      const processInternalJob = async (jobId: string) => {
        const response = await originalFetch(`${baseUrl}/internal/jobs/${jobId}/process`, {
          method: "POST",
          headers: { "x-internal-key": process.env.INTERNAL_API_KEY ?? "dramaflow-internal-key" },
        });
        assert.equal(response.status, 201);
        return response.json() as Promise<{ id: string; status: string }>;
      };

      const loadSession = async (accessToken: string, sessionId: string) => {
        const response = await originalFetch(`${baseUrl}/novel-import-sessions/${sessionId}`, {
          headers: authHeaders(accessToken),
        });
        assert.equal(response.status, 200);
        return response.json() as Promise<{
          session: {
            id: string;
            chunks: Array<{ index: number; status: string; summary?: string }>;
            writeResult?: {
              worldBibleVersionId: string;
              synopsisVersionId: string;
              scriptVersionId: string;
            };
          };
        }>;
      };

      const user = await registerUser(baseUrl, {
        email: "novel-retry@example.com",
        displayName: "Novel Retry",
      });

      const updateProfileResponse = await originalFetch(`${baseUrl}/auth/me`, {
        method: "PATCH",
        headers: authHeaders(user.accessToken, true),
        body: JSON.stringify({
          llmConfig: {
            provider: "openai-completions",
            apiKey: "test-key",
            baseUrl: "https://example.test/v1",
            model: "gpt-test",
            stream: true,
          },
        }),
      });
      assert.equal(updateProfileResponse.status, 200);

      const teams = await listTeams(baseUrl, user.accessToken);
      const projectResponse = await originalFetch(`${baseUrl}/projects`, {
        method: "POST",
        headers: authHeaders(user.accessToken, true),
        body: JSON.stringify({ teamId: teams[0]?.id, name: "Retry Novel" }),
      });
      assert.equal(projectResponse.status, 201);
      const project = await projectResponse.json() as { id: string };

      const sessionResponse = await originalFetch(`${baseUrl}/projects/${project.id}/novel-import-sessions`, {
        method: "POST",
        headers: authHeaders(user.accessToken, true),
        body: JSON.stringify({
          text: "第一章\n她推开门。\n\n第二章\n电话响了。",
          targetEpisodeCount: 8,
          episodeDurationMinutes: 2,
          genreStyle: "都市悬疑",
          adaptationFocus: "强化悬念",
          llmConfigSource: "personal",
        }),
      });
      assert.equal(sessionResponse.status, 201);
      const created = await sessionResponse.json() as { session: { id: string } };

      const startResponse = await originalFetch(`${baseUrl}/novel-import-sessions/${created.session.id}/start`, {
        method: "POST",
        headers: authHeaders(user.accessToken, true),
      });
      assert.equal(startResponse.status, 201);
      const started = await startResponse.json() as { job: { id: string } };
      await processInternalJob(started.job.id);

      const retryResponse = await originalFetch(`${baseUrl}/novel-import-sessions/${created.session.id}/chunks/0/retry`, {
        method: "POST",
        headers: authHeaders(user.accessToken, true),
      });
      assert.equal(retryResponse.status, 201);
      const retry = await retryResponse.json() as { job: { id: string } };
      await processInternalJob(retry.job.id);
      const afterRetry = await loadSession(user.accessToken, created.session.id);
      assert.equal(afterRetry.session.chunks[0]?.summary, "重试后的第一块。");
      assert.equal(afterRetry.session.chunks[1]?.status, "stale");

      const rerunResponse = await originalFetch(`${baseUrl}/novel-import-sessions/${created.session.id}/chunks/0/rerun-following`, {
        method: "POST",
        headers: authHeaders(user.accessToken, true),
      });
      assert.equal(rerunResponse.status, 201);
      const rerun = await rerunResponse.json() as { job: { id: string } };
      await processInternalJob(rerun.job.id);
      const afterRerun = await loadSession(user.accessToken, created.session.id);
      assert.equal(afterRerun.session.chunks.every((chunk) => chunk.status === "completed"), true);

      const writeResponse = await originalFetch(`${baseUrl}/novel-import-sessions/${created.session.id}/write-drafts`, {
        method: "POST",
        headers: authHeaders(user.accessToken, true),
      });
      assert.equal(writeResponse.status, 201);
      const writeResult = await writeResponse.json() as {
        writeResult: { worldBibleVersionId: string; synopsisVersionId: string; scriptVersionId: string };
      };

      const duplicateWriteResponse = await originalFetch(`${baseUrl}/novel-import-sessions/${created.session.id}/write-drafts`, {
        method: "POST",
        headers: authHeaders(user.accessToken, true),
      });
      assert.equal(duplicateWriteResponse.status, 201);
      const duplicateWrite = await duplicateWriteResponse.json() as {
        writeResult: { worldBibleVersionId: string; synopsisVersionId: string; scriptVersionId: string };
      };
      assert.equal(writeResult.writeResult.scriptVersionId, duplicateWrite.writeResult.scriptVersionId);

      const versions = await listProjectVersions<{ id: string; status: string }>(baseUrl, user.accessToken, project.id);
      const scriptVersion = versions.find((version) => version.id === writeResult.writeResult.scriptVersionId);
      const worldBibleVersion = versions.find((version) => version.id === writeResult.writeResult.worldBibleVersionId);
      const synopsisVersion = versions.find((version) => version.id === writeResult.writeResult.synopsisVersionId);
      assert.equal(scriptVersion?.status, "draft");
      assert.equal(worldBibleVersion?.status, "draft");
      assert.equal(synopsisVersion?.status, "draft");
    });
  });

  await runCase("auth upload and llm setting routes respect guard, model list routes work, and stream config persists", async () => {
    await withHttpApp(async (baseUrl) => {
      const registerResponse = await originalFetch(`${baseUrl}/auth/register`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          email: "director@example.com",
          password: "securepass123",
          displayName: "Director",
        }),
      });
      assert.equal(registerResponse.status, 201);

      const registerPayload = await registerResponse.json() as {
        accessToken: string;
        user: { id: string; email: string };
      };
      assert.equal(typeof registerPayload.accessToken, "string");
      assert.equal(registerPayload.user.email, "director@example.com");

      const authHeaders = {
        authorization: `Bearer ${registerPayload.accessToken}`,
      };

      const meResponse = await originalFetch(`${baseUrl}/auth/me`, {
        headers: authHeaders,
      });
      assert.equal(meResponse.status, 200);

      const mePayload = await meResponse.json() as { id: string; email: string };
      assert.equal(mePayload.id, registerPayload.user.id);
      assert.equal(mePayload.email, registerPayload.user.email);

      const updateProfileResponse = await originalFetch(`${baseUrl}/auth/me`, {
        method: "PATCH",
        headers: {
          ...authHeaders,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          displayName: "Director Stream",
          llmConfig: {
            provider: "openai-completions",
            apiKey: "profile-model-key",
            baseUrl: "https://example.test/v1/",
            stream: true,
          },
        }),
      });
      assert.equal(updateProfileResponse.status, 200);

      const updatedProfile = await updateProfileResponse.json() as {
        displayName: string;
        llmConfig?: { stream?: boolean };
      };
      assert.equal(updatedProfile.displayName, "Director Stream");
      assert.equal(updatedProfile.llmConfig?.stream, true);

      const teamsResponse = await originalFetch(`${baseUrl}/teams`, {
        headers: authHeaders,
      });
      assert.equal(teamsResponse.status, 200);
      const teams = await teamsResponse.json() as Array<{ id: string }>;
      assert.ok(teams.length > 0);

      const teamId = teams[0].id;
      const teamResponse = await originalFetch(`${baseUrl}/teams/${teamId}`, {
        headers: authHeaders,
      });
      assert.equal(teamResponse.status, 200);
      const team = await teamResponse.json() as {
        name: string;
        defaultReviewPolicy: "required" | "bypass";
      };

      const updateTeamResponse = await originalFetch(`${baseUrl}/teams/${teamId}`, {
        method: "PATCH",
        headers: {
          ...authHeaders,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          name: team.name,
          defaultReviewPolicy: team.defaultReviewPolicy,
          llmConfig: {
            provider: "openai-completions",
            model: "gpt-5.4",
            stream: true,
          },
        }),
      });
      assert.equal(updateTeamResponse.status, 200);

      const updatedTeam = await updateTeamResponse.json() as {
        llmConfig?: { model?: string; stream?: boolean };
      };
      assert.equal(updatedTeam.llmConfig?.model, "gpt-5.4");
      assert.equal(updatedTeam.llmConfig?.stream, true);

      const providerRequests: string[] = [];
      globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
        if (String(input) === "https://example.test/v1/models") {
          providerRequests.push(new Headers(init?.headers).get("authorization") ?? "");
          return new Response(JSON.stringify({
            object: "list",
            data: [
              { id: "gpt-5.4", created: 1710000001, owned_by: "openai" },
              { id: "gpt-4.1-mini", created: 1710000000, owned_by: "openai" },
              { id: "gpt-4.1-mini", created: 1710000000, owned_by: "openai" },
            ],
          }), {
            status: 200,
            headers: { "content-type": "application/json" },
          });
        }

        return originalFetch(input, init ? { ...init, headers: new Headers(init.headers ?? {}) } : init);
      }) as typeof fetch;

      const profileModelsResponse = await originalFetch(`${baseUrl}/auth/me/llm-models`, {
        method: "POST",
        headers: {
          ...authHeaders,
          "content-type": "application/json",
        },
        body: JSON.stringify({}),
      });
      assert.equal(profileModelsResponse.status, 200);
      const profileModels = await profileModelsResponse.json() as {
        models: Array<{ id: string; ownedBy?: string }>;
      };
      assert.deepEqual(profileModels.models.map((model) => model.id), ["gpt-4.1-mini", "gpt-5.4"]);
      assert.equal(profileModels.models[0].ownedBy, "openai");

      const teamModelsResponse = await originalFetch(`${baseUrl}/teams/${teamId}/llm-models`, {
        method: "POST",
        headers: {
          ...authHeaders,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          llmConfig: {
            provider: "openai-completions",
            apiKey: "team-model-key",
            baseUrl: "https://example.test/v1/",
          },
        }),
      });
      assert.equal(teamModelsResponse.status, 200);
      const teamModels = await teamModelsResponse.json() as {
        models: Array<{ id: string }>;
      };
      assert.deepEqual(teamModels.models.map((model) => model.id), ["gpt-4.1-mini", "gpt-5.4"]);
      assert.deepEqual(providerRequests, ["Bearer profile-model-key", "Bearer team-model-key"]);

      const unauthorizedMe = await readResponse(await originalFetch(`${baseUrl}/auth/me`));
      assert.equal(unauthorizedMe.status, 401);
      assert.equal(unauthorizedMe.bodyText.includes("Cannot read properties of undefined"), false);
      assert.equal((unauthorizedMe.json as { message?: string } | undefined)?.message, "Missing bearer token");

      const unauthorizedPatchMe = await readResponse(await originalFetch(`${baseUrl}/auth/me`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ displayName: "Updated Director" }),
      }));
      assert.equal(unauthorizedPatchMe.status, 401);

      const unauthorizedProfileModels = await readResponse(await originalFetch(`${baseUrl}/auth/me/llm-models`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      }));
      assert.equal(unauthorizedProfileModels.status, 401);

      const unauthorizedUploadTarget = await readResponse(await originalFetch(`${baseUrl}/uploads`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          projectId: "project_missing",
          filename: "scene.txt",
          contentType: "text/plain",
        }),
      }));
      assert.equal(unauthorizedUploadTarget.status, 401);

      const unauthorizedDirectUpload = await readResponse(await originalFetch(`${baseUrl}/uploads/direct/test-file.txt`, {
        method: "PUT",
        headers: { "content-type": "text/plain" },
        body: "draft payload",
      }));
      assert.equal(unauthorizedDirectUpload.status, 401);

      const unauthorizedAssetUrl = await readResponse(await originalFetch(`${baseUrl}/assets/asset_missing/url`));
      assert.equal(unauthorizedAssetUrl.status, 401);

      const unauthorizedTeamModels = await readResponse(await originalFetch(`${baseUrl}/teams/${teamId}/llm-models`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      }));
      assert.equal(unauthorizedTeamModels.status, 401);
      assert.equal(providerRequests.length, 2);
    });
  });

  await runCase("team admin permissions keep overview and settings isolated", async () => {
    await withHttpApp(async (baseUrl) => {
      const platformAdmin = await registerUser(baseUrl, {
        email: "platform@example.com",
        displayName: "Platform Admin",
      });
      const owner = await registerUser(baseUrl, {
        email: "owner@example.com",
        displayName: "Owner",
      });
      const member = await registerUser(baseUrl, {
        email: "member@example.com",
        displayName: "Member",
      });
      const tenantAdmin = await registerUser(baseUrl, {
        email: "tenant-admin@example.com",
        displayName: "Tenant Admin",
      });

      const ownerTeams = await listTeams(baseUrl, owner.accessToken);
      assert.equal(ownerTeams.length > 0, true);
      const sharedTeamId = ownerTeams[0].id;

      const ownerTeamResponse = await originalFetch(`${baseUrl}/teams/${sharedTeamId}`, {
        headers: authHeaders(owner.accessToken),
      });
      assert.equal(ownerTeamResponse.status, 200);
      const ownerTeam = await ownerTeamResponse.json() as {
        name: string;
        defaultReviewPolicy: "required" | "bypass";
        currentUserRole: string | null;
        canManage: boolean;
        llmConfig?: unknown;
      };
      assert.equal(ownerTeam.currentUserRole, "tenant_owner");
      assert.equal(ownerTeam.canManage, true);
      assert.equal("llmConfig" in ownerTeam, false);

      const configureTeamResponse = await originalFetch(`${baseUrl}/teams/${sharedTeamId}`, {
        method: "PATCH",
        headers: authHeaders(owner.accessToken, true),
        body: JSON.stringify({
          name: ownerTeam.name,
          defaultReviewPolicy: ownerTeam.defaultReviewPolicy,
          llmConfig: {
            provider: "openai-completions",
            apiKey: "team-secret-key",
            baseUrl: "https://example.test/v1/",
            model: "gpt-5.4",
            stream: true,
          },
        }),
      });
      assert.equal(configureTeamResponse.status, 200);
      const configuredTeam = await configureTeamResponse.json() as {
        llmConfig?: {
          model?: string;
          stream?: boolean;
          hasApiKey?: boolean;
          apiKey?: string;
        };
      };
      assert.equal(configuredTeam.llmConfig?.model, "gpt-5.4");
      assert.equal(configuredTeam.llmConfig?.stream, true);
      assert.equal(configuredTeam.llmConfig?.hasApiKey, true);
      assert.equal("apiKey" in (configuredTeam.llmConfig ?? {}), false);

      const addMemberResponse = await originalFetch(`${baseUrl}/teams/${sharedTeamId}/members`, {
        method: "POST",
        headers: authHeaders(owner.accessToken, true),
        body: JSON.stringify({ email: "member@example.com", role: "member" }),
      });
      assert.equal(addMemberResponse.ok, true);

      const addTenantAdminResponse = await originalFetch(`${baseUrl}/teams/${sharedTeamId}/members`, {
        method: "POST",
        headers: authHeaders(owner.accessToken, true),
        body: JSON.stringify({ email: "tenant-admin@example.com", role: "tenant_admin" }),
      });
      assert.equal(addTenantAdminResponse.ok, true);

      const memberTeamResponse = await originalFetch(`${baseUrl}/teams/${sharedTeamId}`, {
        headers: authHeaders(member.accessToken),
      });
      assert.equal(memberTeamResponse.status, 200);
      const memberTeam = await memberTeamResponse.json() as {
        currentUserRole: string | null;
        canManage: boolean;
        llmConfig?: { apiKey?: string };
      };
      assert.equal(memberTeam.currentUserRole, "member");
      assert.equal(memberTeam.canManage, false);
      assert.equal("llmConfig" in memberTeam, false);

      const memberTeams = await listTeams(baseUrl, member.accessToken);
      const memberSharedTeam = memberTeams.find((team) => team.id === sharedTeamId);
      assert.ok(memberSharedTeam);
      assert.equal(memberSharedTeam.canManage, false);
      assert.equal("llmConfig" in memberSharedTeam, false);

      const memberOverview = await readResponse(await originalFetch(`${baseUrl}/admin/teams/${sharedTeamId}/overview`, {
        headers: authHeaders(member.accessToken),
      }));
      assert.equal(memberOverview.status, 403);

      const memberSettings = await readResponse(await originalFetch(`${baseUrl}/admin/teams/${sharedTeamId}/settings`, {
        headers: authHeaders(member.accessToken),
      }));
      assert.equal(memberSettings.status, 403);

      const memberUpdate = await readResponse(await originalFetch(`${baseUrl}/teams/${sharedTeamId}`, {
        method: "PATCH",
        headers: authHeaders(member.accessToken, true),
        body: JSON.stringify({
          name: ownerTeam.name,
          defaultReviewPolicy: ownerTeam.defaultReviewPolicy,
        }),
      }));
      assert.equal(memberUpdate.status, 403);

      const tenantAdminOverviewResponse = await originalFetch(`${baseUrl}/admin/teams/${sharedTeamId}/overview`, {
        headers: authHeaders(tenantAdmin.accessToken),
      });
      assert.equal(tenantAdminOverviewResponse.status, 200);
      const tenantAdminOverview = await tenantAdminOverviewResponse.json() as {
        team: {
          currentUserRole: string | null;
          canManage: boolean;
        };
      };
      assert.equal(tenantAdminOverview.team.currentUserRole, "tenant_admin");
      assert.equal(tenantAdminOverview.team.canManage, true);

      const tenantAdminSettingsResponse = await originalFetch(`${baseUrl}/admin/teams/${sharedTeamId}/settings`, {
        headers: authHeaders(tenantAdmin.accessToken),
      });
      assert.equal(tenantAdminSettingsResponse.status, 200);
      const tenantAdminSettings = await tenantAdminSettingsResponse.json() as {
        currentUserRole: string | null;
        canManage: boolean;
        llmConfig?: {
          model?: string;
          stream?: boolean;
          hasApiKey?: boolean;
          apiKey?: string;
        };
      };
      assert.equal(tenantAdminSettings.currentUserRole, "tenant_admin");
      assert.equal(tenantAdminSettings.canManage, true);
      assert.equal(tenantAdminSettings.llmConfig?.model, "gpt-5.4");
      assert.equal(tenantAdminSettings.llmConfig?.stream, true);
      assert.equal(tenantAdminSettings.llmConfig?.hasApiKey, true);
      assert.equal("apiKey" in (tenantAdminSettings.llmConfig ?? {}), false);

      const tenantAdminUpdateResponse = await originalFetch(`${baseUrl}/teams/${sharedTeamId}`, {
        method: "PATCH",
        headers: authHeaders(tenantAdmin.accessToken, true),
        body: JSON.stringify({
          name: "Owner Updated Team",
          defaultReviewPolicy: "required",
          llmConfig: {
            provider: "openai-completions",
            baseUrl: "https://example.test/v1/",
            model: "gpt-5.4-mini",
            stream: false,
          },
        }),
      });
      assert.equal(tenantAdminUpdateResponse.status, 200);
      const tenantAdminUpdatedTeam = await tenantAdminUpdateResponse.json() as {
        name: string;
        defaultReviewPolicy: "required" | "bypass";
        llmConfig?: {
          model?: string;
          stream?: boolean;
          hasApiKey?: boolean;
          apiKey?: string;
        };
      };
      assert.equal(tenantAdminUpdatedTeam.name, "Owner Updated Team");
      assert.equal(tenantAdminUpdatedTeam.defaultReviewPolicy, "required");
      assert.equal(tenantAdminUpdatedTeam.llmConfig?.model, "gpt-5.4-mini");
      assert.equal(tenantAdminUpdatedTeam.llmConfig?.stream, false);
      assert.equal(tenantAdminUpdatedTeam.llmConfig?.hasApiKey, true);
      assert.equal("apiKey" in (tenantAdminUpdatedTeam.llmConfig ?? {}), false);

      const ownerSettingsAfterUpdateResponse = await originalFetch(`${baseUrl}/admin/teams/${sharedTeamId}/settings`, {
        headers: authHeaders(owner.accessToken),
      });
      assert.equal(ownerSettingsAfterUpdateResponse.status, 200);
      const ownerSettingsAfterUpdate = await ownerSettingsAfterUpdateResponse.json() as {
        llmConfig?: {
          model?: string;
          stream?: boolean;
          hasApiKey?: boolean;
        };
      };
      assert.equal(ownerSettingsAfterUpdate.llmConfig?.model, "gpt-5.4-mini");
      assert.equal(ownerSettingsAfterUpdate.llmConfig?.stream, false);
      assert.equal(ownerSettingsAfterUpdate.llmConfig?.hasApiKey, true);

      const platformOverviewResponse = await originalFetch(`${baseUrl}/admin/teams/${sharedTeamId}/overview`, {
        headers: authHeaders(platformAdmin.accessToken),
      });
      assert.equal(platformOverviewResponse.status, 200);

      const platformSettingsResponse = await originalFetch(`${baseUrl}/admin/teams/${sharedTeamId}/settings`, {
        headers: authHeaders(platformAdmin.accessToken),
      });
      assert.equal(platformSettingsResponse.status, 200);
      const platformSettings = await platformSettingsResponse.json() as {
        canManage: boolean;
        llmConfig?: {
          model?: string;
          hasApiKey?: boolean;
          apiKey?: string;
        };
      };
      assert.equal(platformSettings.canManage, true);
      assert.equal(platformSettings.llmConfig?.model, "gpt-5.4-mini");
      assert.equal(platformSettings.llmConfig?.hasApiKey, true);
      assert.equal("apiKey" in (platformSettings.llmConfig ?? {}), false);
    });
  });

  await runCase("image generation settings persist and image jobs honor config source", async () => {
    await withHttpApp(async (baseUrl) => {
      const owner = await registerUser(baseUrl, {
        email: "image-owner@example.com",
        displayName: "Image Owner",
      });
      const jsonHeaders = authHeaders(owner.accessToken, true);
      const readOnlyHeaders = authHeaders(owner.accessToken);

      const teams = await listTeams(baseUrl, owner.accessToken);
      assert.equal(teams.length > 0, true);
      const teamId = teams[0].id;

      const teamResponse = await originalFetch(`${baseUrl}/teams/${teamId}`, {
        headers: { ...readOnlyHeaders },
      });
      assert.equal(teamResponse.status, 200);
      const team = await teamResponse.json() as {
        name: string;
        defaultReviewPolicy: "required" | "bypass";
      };

      const updateProfileResponse = await originalFetch(`${baseUrl}/auth/me`, {
        method: "PATCH",
        headers: { ...jsonHeaders },
        body: JSON.stringify({
          imageGenerationConfig: {
            provider: "google-gemini",
            apiKey: "personal-image-key",
            model: "gemini-personal",
          },
        }),
      });
      assert.equal(updateProfileResponse.status, 200);
      const updatedProfile = await updateProfileResponse.json() as {
        imageGenerationConfig?: {
          provider?: string;
          apiKey?: string;
          model?: string;
        };
      };
      assert.equal(updatedProfile.imageGenerationConfig?.provider, "google-gemini");
      assert.equal(updatedProfile.imageGenerationConfig?.apiKey, "personal-image-key");
      assert.equal(updatedProfile.imageGenerationConfig?.model, "gemini-personal");

      const updateTeamResponse = await originalFetch(`${baseUrl}/teams/${teamId}`, {
        method: "PATCH",
        headers: { ...jsonHeaders },
        body: JSON.stringify({
          name: team.name,
          defaultReviewPolicy: team.defaultReviewPolicy,
          imageGenerationConfig: {
            provider: "google-gemini",
            apiKey: "team-image-key",
            model: "gemini-team",
          },
        }),
      });
      assert.equal(updateTeamResponse.status, 200);
      const updatedTeam = await updateTeamResponse.json() as {
        imageGenerationConfig?: {
          provider?: string;
          model?: string;
          hasApiKey?: boolean;
          apiKey?: string;
        };
      };
      assert.equal(updatedTeam.imageGenerationConfig?.provider, "google-gemini");
      assert.equal(updatedTeam.imageGenerationConfig?.model, "gemini-team");
      assert.equal(updatedTeam.imageGenerationConfig?.hasApiKey, true);
      assert.equal("apiKey" in (updatedTeam.imageGenerationConfig ?? {}), false);

      const adminSettingsResponse = await originalFetch(`${baseUrl}/admin/teams/${teamId}/settings`, {
        headers: { ...readOnlyHeaders },
      });
      assert.equal(adminSettingsResponse.status, 200);
      const adminSettings = await adminSettingsResponse.json() as {
        imageGenerationConfig?: {
          provider?: string;
          model?: string;
          hasApiKey?: boolean;
          apiKey?: string;
        };
      };
      assert.equal(adminSettings.imageGenerationConfig?.provider, "google-gemini");
      assert.equal(adminSettings.imageGenerationConfig?.model, "gemini-team");
      assert.equal(adminSettings.imageGenerationConfig?.hasApiKey, true);
      assert.equal("apiKey" in (adminSettings.imageGenerationConfig ?? {}), false);

      const createProjectResponse = await originalFetch(`${baseUrl}/projects`, {
        method: "POST",
        headers: { ...jsonHeaders },
        body: JSON.stringify({
          teamId,
          name: "Image Generation Project",
          description: "Prompt builder image test",
          reviewPolicyMode: "bypass",
        }),
      });
      assert.equal(createProjectResponse.status, 201);
      const createdProject = await createProjectResponse.json() as { id: string };

      const projectResponse = await originalFetch(`${baseUrl}/projects/${createdProject.id}`, {
        headers: { ...readOnlyHeaders },
      });
      assert.equal(projectResponse.status, 200);
      const projectPayload = await projectResponse.json() as {
        documents: Array<{ id: string; type: string }>;
      };
      const storyboardDocument = projectPayload.documents.find((document) => document.type === "storyboard");
      assert.ok(storyboardDocument);

      const storyboardVersionResponse = await originalFetch(`${baseUrl}/documents/${storyboardDocument.id}/versions`, {
        method: "POST",
        headers: { ...jsonHeaders },
        body: JSON.stringify({
          title: "Image provider storyboard",
          content: {
            overview: "Two shots for image generation testing",
            shots: [
              {
                id: "shot-team",
                sceneId: "scene-1",
                shotLabel: "1A",
                framing: "MS",
                cameraMove: "static",
                durationSeconds: 3,
                visualDescription: "A lone director on a rainy rooftop",
              },
              {
                id: "shot-personal",
                sceneId: "scene-1",
                shotLabel: "1B",
                framing: "CU",
                cameraMove: "static",
                durationSeconds: 3,
                visualDescription: "A close-up of determined eyes under neon rain",
              },
            ],
          },
          metadata: { source: "test" },
        }),
      });
      assert.equal(storyboardVersionResponse.status, 201);

      const providerRequests: Array<{ url: string; body: Record<string, unknown> }> = [];
      globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.startsWith("https://generativelanguage.googleapis.com/")) {
          const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
          providerRequests.push({ url, body });
          return new Response(JSON.stringify({
            candidates: [
              {
                content: {
                  parts: [
                    {
                      inlineData: {
                        data: Buffer.from(`provider-image-${providerRequests.length}`).toString("base64"),
                        mimeType: "image/png",
                      },
                    },
                  ],
                },
              },
            ],
          }), {
            status: 200,
            headers: { "content-type": "application/json" },
          });
        }

        return originalFetch(input, init ? { ...init, headers: new Headers(init.headers ?? {}) } : init);
      }) as typeof fetch;

      const teamJobResponse = await readResponse(await originalFetch(`${baseUrl}/shots/shot-team/image-jobs`, {
        method: "POST",
        headers: { ...jsonHeaders },
        body: JSON.stringify({
          projectId: createdProject.id,
          style: "cinematic",
          aspectRatio: "16:9",
          configSource: "team",
        }),
      }));
      assert.equal(teamJobResponse.status, 201, teamJobResponse.bodyText);
      const teamJob = teamJobResponse.json as { id: string };

      const processTeamResponse = await originalFetch(`${baseUrl}/internal/jobs/${teamJob.id}/process`, {
        method: "POST",
        headers: { "x-internal-key": process.env.INTERNAL_API_KEY ?? "dramaflow-internal-key" },
      });
      assert.equal(processTeamResponse.ok, true);

      const personalJobResponse = await originalFetch(`${baseUrl}/shots/shot-personal/image-jobs`, {
        method: "POST",
        headers: { ...jsonHeaders },
        body: JSON.stringify({
          projectId: createdProject.id,
          style: "cinematic",
          aspectRatio: "16:9",
          configSource: "personal",
        }),
      });
      assert.equal(personalJobResponse.status, 201);
      const personalJob = await personalJobResponse.json() as { id: string };

      const processPersonalResponse = await originalFetch(`${baseUrl}/internal/jobs/${personalJob.id}/process`, {
        method: "POST",
        headers: { "x-internal-key": process.env.INTERNAL_API_KEY ?? "dramaflow-internal-key" },
      });
      assert.equal(processPersonalResponse.ok, true);

      assert.equal(providerRequests.length, 2);
      assert.equal(providerRequests[0].url, "https://generativelanguage.googleapis.com/v1beta/models/gemini-team:generateContent?key=team-image-key");
      assert.equal(providerRequests[1].url, "https://generativelanguage.googleapis.com/v1beta/models/gemini-personal:generateContent?key=personal-image-key");

      const teamProviderBody = providerRequests[0].body as {
        contents: Array<{ parts: Array<{ text?: string }> }>;
      };
      const promptText = teamProviderBody.contents[0]?.parts[0]?.text ?? "";
      assert.equal(promptText.includes("A lone director on a rainy rooftop"), true);
      assert.equal(promptText.includes("Negative prompt:"), true);
      assert.equal(promptText.includes("shot-team cinematic image"), false);

      const teamJobRecordResponse = await originalFetch(`${baseUrl}/jobs/${teamJob.id}`, {
        headers: { ...readOnlyHeaders },
      });
      assert.equal(teamJobRecordResponse.status, 200);
      const teamJobRecord = await teamJobRecordResponse.json() as {
        result?: {
          configSource?: string;
          model?: string;
          versionId?: string;
        };
      };
      assert.equal(teamJobRecord.result?.configSource, "team");
      assert.equal(teamJobRecord.result?.model, "gemini-team");
      assert.equal(typeof teamJobRecord.result?.versionId, "string");

      const personalJobRecordResponse = await originalFetch(`${baseUrl}/jobs/${personalJob.id}`, {
        headers: { ...readOnlyHeaders },
      });
      assert.equal(personalJobRecordResponse.status, 200);
      const personalJobRecord = await personalJobRecordResponse.json() as {
        result?: {
          configSource?: string;
          model?: string;
          versionId?: string;
        };
      };
      assert.equal(personalJobRecord.result?.configSource, "personal");
      assert.equal(personalJobRecord.result?.model, "gemini-personal");
      assert.equal(typeof personalJobRecord.result?.versionId, "string");

      const refreshedProjectResponse = await originalFetch(`${baseUrl}/projects/${createdProject.id}`, {
        headers: { ...readOnlyHeaders },
      });
      assert.equal(refreshedProjectResponse.status, 200);
      const refreshedProject = await refreshedProjectResponse.json() as {
        documents: Array<{ id: string; type: string; shotId?: string; currentVersionId?: string }>;
      };
      const refreshedVersions = await listProjectVersions<{ id: string; metadata?: Record<string, unknown>; content?: Record<string, unknown> }>(
        baseUrl,
        owner.accessToken,
        createdProject.id,
      );
      const teamImageDocument = refreshedProject.documents.find((document) => document.type === "image" && document.shotId === "shot-team");
      assert.ok(teamImageDocument?.currentVersionId);
      const teamImageVersion = refreshedVersions.find((version) => version.id === teamImageDocument?.currentVersionId);
      assert.ok(teamImageVersion);
      assert.equal(teamImageVersion?.metadata?.configSource, "team");
      assert.equal(teamImageVersion?.metadata?.model, "gemini-team");
      assert.equal(teamImageVersion?.content?.configSource, "team");
      assert.equal(teamImageVersion?.content?.model, "gemini-team");
      assert.equal(typeof teamImageVersion?.content?.assetId, "string");
    });
  });

  await runCase("world bible reference image routes support locations and style guide prompts", async () => {
    await withHttpApp(async (baseUrl) => {
      const owner = await registerUser(baseUrl, {
        email: "world-bible-image-owner@example.com",
        displayName: "World Bible Image Owner",
      });
      const jsonHeaders = authHeaders(owner.accessToken, true);
      const readOnlyHeaders = authHeaders(owner.accessToken);

      const teams = await listTeams(baseUrl, owner.accessToken);
      assert.equal(teams.length > 0, true);
      const teamId = teams[0].id;

      const teamResponse = await originalFetch(`${baseUrl}/teams/${teamId}`, {
        headers: { ...readOnlyHeaders },
      });
      assert.equal(teamResponse.status, 200);
      const team = await teamResponse.json() as {
        name: string;
        defaultReviewPolicy: "required" | "bypass";
      };

      const updateProfileResponse = await originalFetch(`${baseUrl}/auth/me`, {
        method: "PATCH",
        headers: { ...jsonHeaders },
        body: JSON.stringify({
          imageGenerationConfig: {
            provider: "google-gemini",
            apiKey: "world-bible-personal-key",
            model: "gemini-world-bible-personal",
          },
        }),
      });
      assert.equal(updateProfileResponse.status, 200);

      const updateTeamResponse = await originalFetch(`${baseUrl}/teams/${teamId}`, {
        method: "PATCH",
        headers: { ...jsonHeaders },
        body: JSON.stringify({
          name: team.name,
          defaultReviewPolicy: team.defaultReviewPolicy,
          imageGenerationConfig: {
            provider: "google-gemini",
            apiKey: "world-bible-team-key",
            model: "gemini-world-bible-team",
          },
        }),
      });
      assert.equal(updateTeamResponse.status, 200);

      const createProjectResponse = await originalFetch(`${baseUrl}/projects`, {
        method: "POST",
        headers: { ...jsonHeaders },
        body: JSON.stringify({
          teamId,
          name: "World Bible Reference Images",
          description: "Reference image generation for locations and style guide",
          reviewPolicyMode: "bypass",
        }),
      });
      assert.equal(createProjectResponse.status, 201);
      const createdProject = await createProjectResponse.json() as { id: string };

      const createLocationResponse = await originalFetch(`${baseUrl}/projects/${createdProject.id}/world-bible/locations`, {
        method: "POST",
        headers: { ...jsonHeaders },
        body: JSON.stringify({
          name: "Abandoned Factory",
          description: "Rusty machinery, damp concrete, fog drifting through broken windows.",
          lighting: "Cold moonlight with a few flickering tungsten practicals.",
          timeOfDay: "night",
        }),
      });
      assert.equal(createLocationResponse.status, 201);
      const location = await createLocationResponse.json() as { id: string };

      const providerRequests: Array<{
        url: string;
        prompt: string;
      }> = [];
      globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.startsWith("https://generativelanguage.googleapis.com/")) {
          const body = JSON.parse(String(init?.body)) as {
            contents: Array<{ parts: Array<{ text?: string }> }>;
          };
          providerRequests.push({
            url,
            prompt: body.contents[0]?.parts[0]?.text ?? "",
          });
          return new Response(JSON.stringify({
            candidates: [
              {
                content: {
                  parts: [
                    {
                      inlineData: {
                        data: Buffer.from(`world-bible-image-${providerRequests.length}`).toString("base64"),
                        mimeType: "image/png",
                      },
                    },
                  ],
                },
              },
            ],
          }), {
            status: 200,
            headers: { "content-type": "application/json" },
          });
        }

        return originalFetch(input, init ? { ...init, headers: new Headers(init.headers ?? {}) } : init);
      }) as typeof fetch;

      const locationPrompt = "Abandoned factory interior, wet concrete floor, cold moonlight, cinematic wide environment.";
      const locationReferenceResponse = await readResponse(await originalFetch(
        `${baseUrl}/projects/${createdProject.id}/world-bible/locations/${location.id}/generate-reference-image`,
        {
          method: "POST",
          headers: { ...jsonHeaders },
          body: JSON.stringify({
            prompt: locationPrompt,
            configSource: "team",
          }),
        },
      ));
      assert.equal(locationReferenceResponse.status, 201, locationReferenceResponse.bodyText);
      const locationReference = locationReferenceResponse.json as { assetUrl?: string };
      assert.equal(typeof locationReference.assetUrl, "string");

      const stylePrompt = "Neo-noir palette, reflective surfaces, dramatic diagonals, glossy rain-soaked highlights.";
      const styleReferenceResponse = await readResponse(await originalFetch(
        `${baseUrl}/projects/${createdProject.id}/world-bible/style-guide/generate-reference-image`,
        {
          method: "POST",
          headers: { ...jsonHeaders },
          body: JSON.stringify({
            prompt: stylePrompt,
            configSource: "personal",
          }),
        },
      ));
      assert.equal(styleReferenceResponse.status, 201, styleReferenceResponse.bodyText);
      const styleReference = styleReferenceResponse.json as { assetUrl?: string };
      assert.equal(typeof styleReference.assetUrl, "string");

      assert.equal(providerRequests.length, 2);
      assert.equal(providerRequests[0].url, "https://generativelanguage.googleapis.com/v1beta/models/gemini-world-bible-team:generateContent?key=world-bible-team-key");
      assert.equal(providerRequests[1].url, "https://generativelanguage.googleapis.com/v1beta/models/gemini-world-bible-personal:generateContent?key=world-bible-personal-key");
      assert.equal(providerRequests[0].prompt, locationPrompt);
      assert.equal(providerRequests[1].prompt, stylePrompt);
      assert.equal(providerRequests[0].prompt.length > 0, true);
      assert.equal(providerRequests[1].prompt.length > 0, true);
    });
  });

  await runCase("text generation jobs honor llm config source", async () => {
    await withHttpApp(async (baseUrl) => {
      const owner = await registerUser(baseUrl, {
        email: "text-owner@example.com",
        displayName: "Text Owner",
      });
      const jsonHeaders = authHeaders(owner.accessToken, true);
      const readOnlyHeaders = authHeaders(owner.accessToken);

      const teams = await listTeams(baseUrl, owner.accessToken);
      assert.equal(teams.length > 0, true);
      const teamId = teams[0].id;

      const teamResponse = await originalFetch(`${baseUrl}/teams/${teamId}`, {
        headers: { ...readOnlyHeaders },
      });
      assert.equal(teamResponse.status, 200);
      const team = await teamResponse.json() as {
        name: string;
        defaultReviewPolicy: "required" | "bypass";
      };

      const updateProfileResponse = await originalFetch(`${baseUrl}/auth/me`, {
        method: "PATCH",
        headers: { ...jsonHeaders },
        body: JSON.stringify({
          llmConfig: {
            provider: "openai-completions",
            apiKey: "personal-text-key",
            baseUrl: "https://example.test/v1",
            model: "personal-text-model",
            stream: false,
          },
        }),
      });
      assert.equal(updateProfileResponse.status, 200);

      const updateTeamResponse = await originalFetch(`${baseUrl}/teams/${teamId}`, {
        method: "PATCH",
        headers: { ...jsonHeaders },
        body: JSON.stringify({
          name: team.name,
          defaultReviewPolicy: team.defaultReviewPolicy,
          llmConfig: {
            provider: "openai-completions",
            apiKey: "team-text-key",
            baseUrl: "https://example.test/v1",
            model: "team-text-model",
            stream: false,
          },
        }),
      });
      assert.equal(updateTeamResponse.status, 200);

      const createProjectResponse = await originalFetch(`${baseUrl}/projects`, {
        method: "POST",
        headers: { ...jsonHeaders },
        body: JSON.stringify({
          teamId,
          name: "Text Generation Project",
          description: "LLM source selector test",
          reviewPolicyMode: "bypass",
        }),
      });
      assert.equal(createProjectResponse.status, 201);
      const createdProject = await createProjectResponse.json() as { id: string };

      const providerRequests: Array<{
        authorization: string | null;
        model: string;
        stream: boolean | undefined;
        prompt: string;
      }> = [];

      globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url === "https://example.test/v1/chat/completions") {
          const headers = new Headers(init?.headers);
          const body = JSON.parse(String(init?.body)) as {
            model: string;
            stream?: boolean;
            messages: Array<{ role: string; content: string }>;
          };
          const prompt = body.messages.find((message) => message.role === "user")?.content ?? "";

          providerRequests.push({
            authorization: headers.get("authorization"),
            model: body.model,
            stream: body.stream,
            prompt,
          });

          const content = prompt.includes("Generate a storyboard payload")
            ? JSON.stringify({
                overview: "Personal storyboard",
                shots: [
                  {
                    shotNumber: "1A",
                    sceneId: "scene-1",
                    shotSize: "medium shot",
                    cameraMovement: "push in",
                    durationSeconds: 3,
                    visualDescription: "Rainy rooftop reveal",
                    actionDescription: "The director steps into the rain and scans the skyline.",
                    notes: "Keep the skyline backlight alive.",
                  },
                ],
              })
            : prompt.includes("Return a long-form synopsis text.")
              ? "Selected config synopsis"
              : JSON.stringify({
                  logline: "Selected config script",
                  premise: "Selected config premise",
                  characters: [],
                  scenes: [
                    {
                      id: "scene-1",
                      heading: "INT. STUDIO - NIGHT",
                      synopsis: "A director regroups the team.",
                      characters: [],
                      dialogue: [],
                    },
                  ],
                });

          return new Response(JSON.stringify({
            choices: [
              {
                message: {
                  content,
                },
              },
            ],
          }), {
            status: 200,
            headers: { "content-type": "application/json" },
          });
        }

        return originalFetch(input, init ? { ...init, headers: new Headers(init.headers ?? {}) } : init);
      }) as typeof fetch;

      const scriptJobResponse = await originalFetch(`${baseUrl}/projects/${createdProject.id}/script-jobs`, {
        method: "POST",
        headers: { ...jsonHeaders },
        body: JSON.stringify({
          ...baseScriptInput,
          llmConfigSource: "team",
        }),
      });
      assert.equal(scriptJobResponse.status, 201);
      const scriptJob = await scriptJobResponse.json() as { id: string };

      const processScriptResponse = await originalFetch(`${baseUrl}/internal/jobs/${scriptJob.id}/process`, {
        method: "POST",
        headers: { "x-internal-key": process.env.INTERNAL_API_KEY ?? "dramaflow-internal-key" },
      });
      assert.equal(processScriptResponse.ok, true);

      assert.equal(providerRequests.length, 1);
      assert.equal(providerRequests[0].authorization, "Bearer team-text-key");
      assert.equal(providerRequests[0].model, "team-text-model");
      assert.equal(providerRequests[0].stream, false);
      assert.equal(providerRequests[0].prompt.includes("Title: Edge of Dawn"), true);

      const scriptJobRecordResponse = await readResponse(await originalFetch(`${baseUrl}/jobs/${scriptJob.id}`, {
        headers: { ...readOnlyHeaders },
      }));
      assert.equal(scriptJobRecordResponse.status, 200, scriptJobRecordResponse.bodyText);
      const scriptJobRecord = scriptJobRecordResponse.json as {
        result?: {
          llmConfigSource?: string;
          model?: string;
          versionId?: string;
        };
      };
      assert.equal(scriptJobRecord.result?.llmConfigSource, "team");
      assert.equal(scriptJobRecord.result?.model, "team-text-model");
      assert.equal(typeof scriptJobRecord.result?.versionId, "string");

      const projectAfterScriptResponse = await originalFetch(`${baseUrl}/projects/${createdProject.id}`, {
        headers: { ...readOnlyHeaders },
      });
      assert.equal(projectAfterScriptResponse.status, 200);
      const projectAfterScript = await projectAfterScriptResponse.json() as {
        documents: Array<{ id: string; type: string; currentVersionId?: string }>;
      };
      const projectAfterScriptVersions = await listProjectVersions<{ id: string; metadata?: Record<string, unknown> }>(
        baseUrl,
        owner.accessToken,
        createdProject.id,
      );
      const scriptDocument = projectAfterScript.documents.find((document) => document.type === "script");
      assert.ok(scriptDocument);
      assert.ok(scriptDocument.currentVersionId);
      const scriptVersionId = scriptDocument.currentVersionId;
      const scriptVersion = projectAfterScriptVersions.find((version) => version.id === scriptVersionId);
      assert.equal(scriptVersion?.metadata?.llmConfigSource, "team");
      assert.equal(scriptVersion?.metadata?.model, "team-text-model");

      const storyboardDocument = projectAfterScript.documents.find((document) => document.type === "storyboard");
      assert.ok(storyboardDocument);
      const storyboardDocumentId = storyboardDocument.id;

      const storyboardStreamResponse = await originalFetch(`${baseUrl}/projects/${createdProject.id}/storyboard-jobs/stream`, {
        method: "POST",
        headers: { ...jsonHeaders },
        body: JSON.stringify({
          documentId: storyboardDocumentId,
          versionId: scriptVersionId,
          cinematicStyle: "Moody handheld tension",
          shotDensity: "balanced",
          llmConfigSource: "personal",
        }),
      });
      assert.equal(storyboardStreamResponse.ok, true);
      const storyboardStreamText = await storyboardStreamResponse.text();
      assert.match(storyboardStreamText, /Personal storyboard/);

      assert.equal(providerRequests.length, 2);
      assert.equal(providerRequests[1].authorization, "Bearer personal-text-key");
      assert.equal(providerRequests[1].model, "personal-text-model");
      assert.equal(providerRequests[1].stream, true);

      const projectAfterStoryboardResponse = await originalFetch(`${baseUrl}/projects/${createdProject.id}`, {
        headers: { ...readOnlyHeaders },
      });
      assert.equal(projectAfterStoryboardResponse.status, 200);
      const projectAfterStoryboard = await projectAfterStoryboardResponse.json() as {
        documents: Array<{ id: string; type: string; currentVersionId?: string }>;
      };
      const projectAfterStoryboardVersions = await listProjectVersions<{ id: string; metadata?: Record<string, unknown>; content?: { shots?: Array<{ framing?: string; cameraMove?: string; actionDescription?: string; notes?: string }> } }>(
        baseUrl,
        owner.accessToken,
        createdProject.id,
      );
      const refreshedStoryboardDocument = projectAfterStoryboard.documents.find((document) => document.type === "storyboard");
      assert.ok(refreshedStoryboardDocument);
      assert.ok(refreshedStoryboardDocument.currentVersionId);
      const storyboardVersionId = refreshedStoryboardDocument.currentVersionId;
      const storyboardVersion = projectAfterStoryboardVersions.find((version) => version.id === storyboardVersionId);
      assert.equal(storyboardVersion?.metadata?.llmConfigSource, "personal");
      assert.equal(storyboardVersion?.metadata?.model, "personal-text-model");
      assert.equal(storyboardVersion?.content?.shots?.[0]?.framing, "MS");
      assert.equal(storyboardVersion?.content?.shots?.[0]?.cameraMove, "dolly-in");
      assert.equal(storyboardVersion?.content?.shots?.[0]?.actionDescription, "The director steps into the rain and scans the skyline.");
      assert.equal(storyboardVersion?.content?.shots?.[0]?.notes, "Keep the skyline backlight alive.");

      const clearProfileResponse = await originalFetch(`${baseUrl}/auth/me`, {
        method: "PATCH",
        headers: { ...jsonHeaders },
        body: JSON.stringify({
          llmConfig: {
            provider: "openai-completions",
            baseUrl: "https://example.test/v1",
            model: "personal-no-key",
            stream: false,
          },
        }),
      });
      assert.equal(clearProfileResponse.status, 200);

      const failedSynopsisResponse = await originalFetch(`${baseUrl}/projects/${createdProject.id}/synopsis-jobs/stream`, {
        method: "POST",
        headers: { ...jsonHeaders },
        body: JSON.stringify({
          title: "Broken Source",
          genre: "Suspense",
          theme: "Trust",
          keywords: ["choice"],
          episodeCount: 1,
          llmConfigSource: "personal",
        }),
      });
      assert.equal(failedSynopsisResponse.ok, true);
      const failedSynopsisText = await failedSynopsisResponse.text();
      assert.match(failedSynopsisText, /The personal text generation config is missing an API key\./);
      assert.equal(providerRequests.length, 2);
    });
  });
  await runCase("conversation message stream preserves session state and latest user message", async () => {
    await withHttpApp(async (baseUrl) => {
      const owner = await registerUser(baseUrl, {
        email: "conversation-owner@example.com",
        displayName: "Conversation Owner",
      });
      const teams = await listTeams(baseUrl, owner.accessToken);
      const teamId = teams[0].id;
      const jsonHeaders = authHeaders(owner.accessToken, true);

      const teamResponse = await originalFetch(`${baseUrl}/teams/${teamId}`, {
        headers: authHeaders(owner.accessToken),
      });
      assert.equal(teamResponse.status, 200);
      const team = await teamResponse.json() as { name: string; defaultReviewPolicy: "required" | "bypass" };

      const updateTeamResponse = await originalFetch(`${baseUrl}/teams/${teamId}`, {
        method: "PATCH",
        headers: jsonHeaders,
        body: JSON.stringify({
          name: team.name,
          defaultReviewPolicy: team.defaultReviewPolicy,
          llmConfig: {
            provider: "openai-completions",
            apiKey: "conversation-key",
            baseUrl: "https://example.test/v1",
            model: "conversation-model",
            stream: false,
          },
        }),
      });
      assert.equal(updateTeamResponse.status, 200);

      const createProjectResponse = await originalFetch(`${baseUrl}/projects`, {
        method: "POST",
        headers: jsonHeaders,
        body: JSON.stringify({
          teamId,
          name: "Conversation Project",
          genre: "都市悬疑",
          reviewPolicyMode: "bypass",
        }),
      });
      assert.equal(createProjectResponse.status, 201);
      const project = await createProjectResponse.json() as { id: string };

      const providerRequests: Array<{
        messages: Array<{ role: string; content: string }>;
        systemPrompt: string;
      }> = [];

      globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
        if (String(input) !== "https://example.test/v1/chat/completions") {
          return originalFetch(input, init ? { ...init, headers: new Headers(init.headers ?? {}) } : init);
        }

        const body = JSON.parse(String(init?.body)) as {
          messages: Array<{ role: string; content: string }>;
        };
        providerRequests.push({
          messages: body.messages,
          systemPrompt: body.messages.find((message) => message.role === "system")?.content ?? "",
        });

        const latestUser = body.messages.filter((message) => message.role === "user").at(-1)?.content ?? "";
        const content = latestUser.includes("主角是被停职的女导演")
          ? JSON.stringify({
              reply: "这个主角有清晰的职业压力。她和谁形成最强冲突？",
              briefUpdates: { protagonist: "被停职的女导演，想在一夜内证明自己" },
            })
          : JSON.stringify({
              reply: "核心冲突很明确。主角是谁？",
              briefUpdates: { coreConflict: "停职导演必须在一夜内救回失控项目" },
            });

        return new Response(JSON.stringify({
          choices: [{ message: { content } }],
        }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }) as typeof fetch;

      const firstResponse = await originalFetch(`${baseUrl}/projects/${project.id}/conversation-jobs/message`, {
        method: "POST",
        headers: jsonHeaders,
        body: JSON.stringify({
          content: "一个停职导演必须在一夜内救回失控项目。",
          targetDocType: "synopsis",
          llmConfigSource: "team",
        }),
      });
      assert.equal(firstResponse.status, 201);
      const firstBody = await firstResponse.text();
      const firstResult = lastDoneResult<{
        sessionId: string;
        message: { role: string; content: string };
        brief: { coreConflict?: string };
        dimensionStatus: { coreConflict?: string };
      }>(firstBody);

      assert.equal(typeof firstResult.sessionId, "string");
      assert.equal(firstResult.message.content, "核心冲突很明确。主角是谁？");
      assert.equal(firstResult.brief.coreConflict, "停职导演必须在一夜内救回失控项目");
      assert.equal(firstResult.dimensionStatus.coreConflict, "confirmed");
      assert.equal(providerRequests[0].messages.some((message) => message.content.includes("停职导演必须")), true);

      const secondResponse = await originalFetch(`${baseUrl}/projects/${project.id}/conversation-jobs/message`, {
        method: "POST",
        headers: jsonHeaders,
        body: JSON.stringify({
          sessionId: firstResult.sessionId,
          content: "主角是被停职的女导演，想证明自己。",
          targetDocType: "synopsis",
          focusDimension: "protagonist",
          llmConfigSource: "team",
        }),
      });
      assert.equal(secondResponse.status, 201);
      const secondBody = await secondResponse.text();
      const secondResult = lastDoneResult<{
        sessionId: string;
        brief: { coreConflict?: string; protagonist?: string };
        dimensionStatus: { protagonist?: string };
      }>(secondBody);

      assert.equal(secondResult.sessionId, firstResult.sessionId);
      assert.equal(secondResult.brief.coreConflict, "停职导演必须在一夜内救回失控项目");
      assert.equal(secondResult.brief.protagonist, "被停职的女导演，想在一夜内证明自己");
      assert.equal(secondResult.dimensionStatus.protagonist, "confirmed");
      assert.equal(providerRequests[1].messages.some((message) => message.content.includes("主角是被停职的女导演")), true);
      assert.equal(providerRequests[1].systemPrompt.includes("主角设定"), true);
    });
  });

  await runCase("conversation generation merges brief saves provider result and enforces permissions", async () => {
    await withHttpApp(async (baseUrl) => {
      const owner = await registerUser(baseUrl, {
        email: "conversation-generate-owner@example.com",
        displayName: "Conversation Generate Owner",
      });
      const outsider = await registerUser(baseUrl, {
        email: "conversation-outsider@example.com",
        displayName: "Conversation Outsider",
      });
      const teams = await listTeams(baseUrl, owner.accessToken);
      const teamId = teams[0].id;
      const ownerJsonHeaders = authHeaders(owner.accessToken, true);
      const outsiderJsonHeaders = authHeaders(outsider.accessToken, true);

      const teamResponse = await originalFetch(`${baseUrl}/teams/${teamId}`, {
        headers: authHeaders(owner.accessToken),
      });
      assert.equal(teamResponse.status, 200);
      const team = await teamResponse.json() as { name: string; defaultReviewPolicy: "required" | "bypass" };

      const updateTeamResponse = await originalFetch(`${baseUrl}/teams/${teamId}`, {
        method: "PATCH",
        headers: ownerJsonHeaders,
        body: JSON.stringify({
          name: team.name,
          defaultReviewPolicy: team.defaultReviewPolicy,
          llmConfig: {
            provider: "openai-completions",
            apiKey: "conversation-generate-key",
            baseUrl: "https://example.test/v1",
            model: "conversation-generate-model",
            stream: false,
          },
        }),
      });
      assert.equal(updateTeamResponse.status, 200);

      const createProjectResponse = await originalFetch(`${baseUrl}/projects`, {
        method: "POST",
        headers: ownerJsonHeaders,
        body: JSON.stringify({
          teamId,
          name: "Conversation Generate Project",
          genre: "都市悬疑",
          reviewPolicyMode: "bypass",
        }),
      });
      assert.equal(createProjectResponse.status, 201);
      const project = await createProjectResponse.json() as { id: string };

      const providerPrompts: string[] = [];
      globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
        if (String(input) !== "https://example.test/v1/chat/completions") {
          return originalFetch(input, init ? { ...init, headers: new Headers(init.headers ?? {}) } : init);
        }

        const body = JSON.parse(String(init?.body)) as {
          messages: Array<{ role: string; content: string }>;
        };
        const prompt = body.messages.find((message) => message.role === "user")?.content ?? "";
        providerPrompts.push(prompt);

        const content = prompt.includes("短剧剧本 payload")
          ? JSON.stringify({
              logline: "Manual brief script",
              premise: "Manual brief premise",
              characters: [{ name: "林夏", profile: "被停职的女导演" }],
              scenes: [
                {
                  id: "scene-1",
                  heading: "内景 / 剪辑室 / 夜",
                  synopsis: "林夏决定反击。",
                  characters: ["林夏"],
                  dialogue: [{ speaker: "林夏", line: "我会把这一夜拍完。" }],
                },
              ],
            })
          : JSON.stringify({
              reply: "先记录核心冲突。",
              briefUpdates: { coreConflict: "停职导演一夜救项目" },
            });

        return new Response(JSON.stringify({
          choices: [{ message: { content } }],
        }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }) as typeof fetch;

      const messageResponse = await originalFetch(`${baseUrl}/projects/${project.id}/conversation-jobs/message`, {
        method: "POST",
        headers: ownerJsonHeaders,
        body: JSON.stringify({
          content: "停职导演一夜救项目。",
          targetDocType: "synopsis",
          llmConfigSource: "team",
        }),
      });
      assert.equal(messageResponse.status, 201);
      const messageResult = lastDoneResult<{ sessionId: string }>(await messageResponse.text());

      const outsiderGetResponse = await originalFetch(`${baseUrl}/projects/${project.id}/conversation-jobs/${messageResult.sessionId}`, {
        headers: authHeaders(outsider.accessToken),
      });
      assert.equal(outsiderGetResponse.status, 403);

      const generateResponse = await originalFetch(`${baseUrl}/projects/${project.id}/conversation-jobs/generate`, {
        method: "POST",
        headers: ownerJsonHeaders,
        body: JSON.stringify({
          sessionId: messageResult.sessionId,
          targetDocType: "script",
          brief: {
            protagonist: "林夏，手握关键素材的女导演",
            tone: "冷峻、快节奏",
            pacing: "12集，每集2分钟",
          },
          llmConfigSource: "team",
        }),
      });
      assert.equal(generateResponse.status, 201);
      const generateResult = lastDoneResult<{
        documentId: string;
        versionId: string;
        content: {
          logline?: string;
          characters?: Array<{ name: string; profile: string }>;
          scenes?: Array<{ dialogue?: Array<{ speaker: string; line: string }> }>;
        };
      }>(await generateResponse.text());

      assert.equal(generateResult.content.logline, "Manual brief script");
      assert.equal(generateResult.content.characters?.[0]?.name, "林夏");
      assert.equal(generateResult.content.scenes?.[0]?.dialogue?.[0]?.line, "我会把这一夜拍完。");
      assert.equal(providerPrompts.some((prompt) => prompt.includes("林夏，手握关键素材的女导演")), true);
      assert.equal(providerPrompts.some((prompt) => prompt.includes("停职导演一夜救项目")), true);

      const projectVersions = await listProjectVersions<{
        id: string;
        metadata?: Record<string, unknown>;
        content?: { logline?: string };
      }>(baseUrl, owner.accessToken, project.id);
      const savedVersion = projectVersions.find((version) => version.id === generateResult.versionId);
      assert.equal(savedVersion?.metadata?.source, "conversational");
      assert.equal(savedVersion?.metadata?.conversationSessionId, messageResult.sessionId);
      assert.equal(savedVersion?.content?.logline, "Manual brief script");

      const outsiderDeleteResponse = await originalFetch(`${baseUrl}/projects/${project.id}/conversation-jobs/${messageResult.sessionId}/delete`, {
        method: "POST",
        headers: outsiderJsonHeaders,
      });
      assert.equal(outsiderDeleteResponse.status, 403);
    });
  });

  await runCase("project invites support acceptance and threaded comments", async () => {
    await withHttpApp(async (baseUrl) => {
      const owner = await registerUser(baseUrl, {
        email: "invite-owner@example.com",
        displayName: "Invite Owner",
      });
      const collaborator = await registerUser(baseUrl, {
        email: "invite-collab@example.com",
        displayName: "Invite Collaborator",
      });

      const ownerJsonHeaders = authHeaders(owner.accessToken, true);
      const ownerReadHeaders = authHeaders(owner.accessToken);
      const collaboratorJsonHeaders = authHeaders(collaborator.accessToken, true);
      const collaboratorReadHeaders = authHeaders(collaborator.accessToken);

      const teams = await listTeams(baseUrl, owner.accessToken);
      assert.equal(teams.length > 0, true);
      const teamId = teams.find((t) => t.currentUserRole === "tenant_owner")?.id ?? teams[0].id;

      const createProjectResponse = await originalFetch(`${baseUrl}/projects`, {
        method: "POST",
        headers: { ...ownerJsonHeaders },
        body: JSON.stringify({
          teamId,
          name: "Invite Acceptance Project",
          description: "Invite acceptance test",
          reviewPolicyMode: "bypass",
        }),
      });
      assert.equal(createProjectResponse.status, 201);
      const createdProject = await createProjectResponse.json() as { id: string };

      const inviteResponse = await originalFetch(`${baseUrl}/projects/${createdProject.id}/invites`, {
        method: "POST",
        headers: { ...ownerJsonHeaders },
        body: JSON.stringify({
          email: "invite-collab@example.com",
          role: "reviewer",
        }),
      });
      assert.equal(inviteResponse.status, 201);
      const invite = await inviteResponse.json() as { id: string };

      const pendingInvitesResponse = await originalFetch(`${baseUrl}/project-invites/pending`, {
        headers: { ...collaboratorReadHeaders },
      });
      assert.equal(pendingInvitesResponse.status, 200);
      const pendingInvites = await pendingInvitesResponse.json() as {
        invites: Array<{ id: string; projectId: string; role: string }>;
      };
      assert.equal(pendingInvites.invites.length, 1);
      assert.equal(pendingInvites.invites[0].id, invite.id);

      const acceptResponse = await originalFetch(`${baseUrl}/project-invites/${invite.id}/accept`, {
        method: "POST",
        headers: { ...collaboratorReadHeaders },
      });
      assert.equal(acceptResponse.status, 201);
      const acceptedInvite = await acceptResponse.json() as {
        inviteId: string;
        projectId: string;
        role: string;
        alreadyMember: boolean;
      };
      assert.equal(acceptedInvite.inviteId, invite.id);
      assert.equal(acceptedInvite.projectId, createdProject.id);
      assert.equal(acceptedInvite.role, "reviewer");
      assert.equal(acceptedInvite.alreadyMember, false);

      const emptyPendingResponse = await originalFetch(`${baseUrl}/project-invites/pending`, {
        headers: { ...collaboratorReadHeaders },
      });
      assert.equal(emptyPendingResponse.status, 200);
      const emptyPending = await emptyPendingResponse.json() as { invites: unknown[] };
      assert.equal(emptyPending.invites.length, 0);

      const projectVisibleResponse = await originalFetch(`${baseUrl}/projects/${createdProject.id}`, {
        headers: { ...collaboratorReadHeaders },
      });
      assert.equal(projectVisibleResponse.status, 200);
      const projectVisible = await projectVisibleResponse.json() as {
        documents: Array<{ id: string; type: string }>;
      };
      const scriptDocument = projectVisible.documents.find((document) => document.type === "script");
      assert.ok(scriptDocument);

      const createVersionResponse = await originalFetch(`${baseUrl}/documents/${scriptDocument.id}/versions`, {
        method: "POST",
        headers: { ...ownerJsonHeaders },
        body: JSON.stringify({
          title: "Invite Thread Version",
          content: {
            logline: "Invite test",
            premise: "A new collaborator joins the project.",
            characters: [],
            scenes: [],
          },
          metadata: { source: "test" },
        }),
      });
      assert.equal(createVersionResponse.status, 201);
      const version = await createVersionResponse.json() as { id: string };

      const rootCommentResponse = await originalFetch(`${baseUrl}/versions/${version.id}/comments`, {
        method: "POST",
        headers: { ...ownerJsonHeaders },
        body: JSON.stringify({
          body: "Please review this version.",
          anchorType: "document",
        }),
      });
      assert.equal(rootCommentResponse.status, 201);
      const rootComment = await rootCommentResponse.json() as { id: string };

      const replyResponse = await originalFetch(`${baseUrl}/versions/${version.id}/comments`, {
        method: "POST",
        headers: { ...collaboratorJsonHeaders },
        body: JSON.stringify({
          body: "Looks good, I left one reply.",
          parentId: rootComment.id,
          anchorType: "document",
        }),
      });
      assert.equal(replyResponse.status, 201);
      const replyComment = await replyResponse.json() as { parentId?: string };
      assert.equal(replyComment.parentId, rootComment.id);

      const commentsResponse = await originalFetch(`${baseUrl}/versions/${version.id}/comments`, {
        headers: { ...ownerReadHeaders },
      });
      assert.equal(commentsResponse.status, 200);
      const comments = await commentsResponse.json() as Array<{ id: string; parentId?: string; authorDisplayName: string }>;
      assert.equal(comments.length, 2);
      assert.equal(comments[1].parentId, rootComment.id);
      assert.equal(comments[1].authorDisplayName, "Invite Collaborator");
    });
  });

  await runCase("audit configs support auto-approve and review comments", async () => {
    await withHttpApp(async (baseUrl) => {
      const owner = await registerUser(baseUrl, {
        email: "audit-owner@example.com",
        displayName: "Audit Owner",
      });
      const jsonHeaders = authHeaders(owner.accessToken, true);
      const readHeaders = authHeaders(owner.accessToken);

      const teams = await listTeams(baseUrl, owner.accessToken);
      assert.equal(teams.length > 0, true);
      const teamId = teams.find((t) => t.currentUserRole === "tenant_owner")?.id ?? teams[0].id;

      const createProjectResponse = await originalFetch(`${baseUrl}/projects`, {
        method: "POST",
        headers: { ...jsonHeaders },
        body: JSON.stringify({
          teamId,
          name: "Audit Policy Project",
          description: "Audit policy test",
          reviewPolicyMode: "inherit",
        }),
      });
      assert.equal(createProjectResponse.status, 201);
      const createdProject = await createProjectResponse.json() as { id: string };

      const projectResponse = await originalFetch(`${baseUrl}/projects/${createdProject.id}`, {
        headers: readHeaders,
      });
      assert.equal(projectResponse.status, 200);
      const project = await projectResponse.json() as {
        documents: Array<{ id: string; type: string }>;
      };
      const scriptDocument = project.documents.find((document) => document.type === "script");
      assert.ok(scriptDocument);

      const upsertAutoApproveResponse = await originalFetch(`${baseUrl}/projects/${createdProject.id}/audit-configs/script`, {
        method: "PATCH",
        headers: { ...jsonHeaders },
        body: JSON.stringify({
          reviewRequired: true,
          autoApproveRoles: ["project_admin"],
        }),
      });
      assert.equal(upsertAutoApproveResponse.status, 200);

      const autoVersionResponse = await originalFetch(`${baseUrl}/documents/${scriptDocument.id}/versions`, {
        method: "POST",
        headers: { ...jsonHeaders },
        body: JSON.stringify({
          title: "Auto Approved Version",
          content: {
            logline: "Auto approve",
            premise: "Auto approved by role.",
            characters: [],
            scenes: [],
          },
          metadata: { source: "audit-test" },
        }),
      });
      assert.equal(autoVersionResponse.status, 201);
      const autoVersion = await autoVersionResponse.json() as { id: string };

      const submitAutoResponse = await originalFetch(`${baseUrl}/versions/${autoVersion.id}/submit`, {
        method: "POST",
        headers: readHeaders,
      });
      assert.equal(submitAutoResponse.status, 201);
      const submittedAutoVersion = await submitAutoResponse.json() as { status: string };
      assert.equal(submittedAutoVersion.status, "approved");

      const autoAuditRecordsResponse = await originalFetch(`${baseUrl}/versions/${autoVersion.id}/audit-records`, {
        headers: readHeaders,
      });
      assert.equal(autoAuditRecordsResponse.status, 200);
      const autoAuditRecords = await autoAuditRecordsResponse.json() as Array<{ action: string; comment?: string }>;
      assert.equal(autoAuditRecords.some((record) => record.action === "submitted"), true);
      assert.equal(autoAuditRecords.some((record) => record.action === "approved" && record.comment === "Auto-approved by audit role policy."), true);

      const upsertManualReviewResponse = await originalFetch(`${baseUrl}/projects/${createdProject.id}/audit-configs/script`, {
        method: "PATCH",
        headers: { ...jsonHeaders },
        body: JSON.stringify({
          reviewRequired: true,
          autoApproveRoles: [],
        }),
      });
      assert.equal(upsertManualReviewResponse.status, 200);

      const reviewVersionResponse = await originalFetch(`${baseUrl}/documents/${scriptDocument.id}/versions`, {
        method: "POST",
        headers: { ...jsonHeaders },
        body: JSON.stringify({
          title: "Manual Review Version",
          content: {
            logline: "Manual review",
            premise: "Requires explicit approval.",
            characters: [],
            scenes: [],
          },
          metadata: { source: "audit-test" },
        }),
      });
      assert.equal(reviewVersionResponse.status, 201);
      const reviewVersion = await reviewVersionResponse.json() as { id: string };

      const submitReviewResponse = await originalFetch(`${baseUrl}/versions/${reviewVersion.id}/submit`, {
        method: "POST",
        headers: readHeaders,
      });
      assert.equal(submitReviewResponse.status, 201);
      const submittedReviewVersion = await submitReviewResponse.json() as { status: string };
      assert.equal(submittedReviewVersion.status, "submitted");

      const approveResponse = await originalFetch(`${baseUrl}/versions/${reviewVersion.id}/approve`, {
        method: "POST",
        headers: { ...jsonHeaders },
        body: JSON.stringify({ comment: "LGTM with one minor note." }),
      });
      assert.equal(approveResponse.status, 201);
      const approvedVersion = await approveResponse.json() as { status: string };
      assert.equal(approvedVersion.status, "approved");

      const approvedAuditResponse = await originalFetch(`${baseUrl}/versions/${reviewVersion.id}/audit-records`, {
        headers: readHeaders,
      });
      assert.equal(approvedAuditResponse.status, 200);
      const approvedAuditRecords = await approvedAuditResponse.json() as Array<{ action: string; comment?: string }>;
      assert.equal(approvedAuditRecords.some((record) => record.action === "approved" && record.comment === "LGTM with one minor note."), true);
    });
  });

  await runCase("project permission endpoints resolve templates and member overrides", async () => {
    await withHttpApp(async (baseUrl) => {
      const owner = await registerUser(baseUrl, {
        email: "permission-owner@example.com",
        displayName: "Permission Owner",
      });
      const writer = await registerUser(baseUrl, {
        email: "permission-writer@example.com",
        displayName: "Permission Writer",
      });
      const ownerJsonHeaders = authHeaders(owner.accessToken, true);
      const writerJsonHeaders = authHeaders(writer.accessToken, true);
      const teams = await listTeams(baseUrl, owner.accessToken);
      assert.equal(teams.length > 0, true);
      const teamId = teams.find((t) => t.currentUserRole === "tenant_owner")?.id ?? teams[0].id;

      const projectResponse = await originalFetch(`${baseUrl}/projects`, {
        method: "POST",
        headers: ownerJsonHeaders,
        body: JSON.stringify({ teamId, name: "Permission Endpoint Project" }),
      });
      assert.equal(projectResponse.status, 201);
      const project = await projectResponse.json() as { id: string };

      const addWriterResponse = await originalFetch(`${baseUrl}/projects/${project.id}/members`, {
        method: "POST",
        headers: ownerJsonHeaders,
        body: JSON.stringify({ email: writer.user.email, role: "writer" }),
      });
      assert.equal(addWriterResponse.status, 201);
      const writerMember = await addWriterResponse.json() as { id: string; effectivePermissions: string[] };
      assert.equal(writerMember.effectivePermissions.includes("project.edit"), true);

      const getTemplatesResponse = await originalFetch(`${baseUrl}/teams/${teamId}/permission-templates`, {
        headers: authHeaders(owner.accessToken),
      });
      assert.equal(getTemplatesResponse.status, 200);
      const defaultTemplates = await getTemplatesResponse.json() as {
        resolvedTemplates: Array<{ role: string; effectivePermissions: string[]; locked: boolean }>;
      };
      const directorTemplate = defaultTemplates.resolvedTemplates.find((item) => item.role === "director");
      assert.equal(directorTemplate?.effectivePermissions.includes("version.review"), true);

      const invalidTemplatesResponse = await readResponse(await originalFetch(`${baseUrl}/teams/${teamId}/permission-templates`, {
        method: "PUT",
        headers: ownerJsonHeaders,
        body: JSON.stringify({
          templates: {
            writer: ["project.view", "version.review", "bad.permission"],
          },
        }),
      }));
      assert.equal(invalidTemplatesResponse.status, 400);
      assert.equal(invalidTemplatesResponse.bodyText.includes("bad.permission"), true);
      assert.equal(invalidTemplatesResponse.bodyText.includes("templates.writer[2]"), true);

      const updateTemplatesResponse = await originalFetch(`${baseUrl}/teams/${teamId}/permission-templates`, {
        method: "PUT",
        headers: ownerJsonHeaders,
        body: JSON.stringify({
          templates: {
            writer: ["project.view", "version.review"],
          },
        }),
      });
      assert.equal(updateTemplatesResponse.status, 200);
      const updatedTemplates = await updateTemplatesResponse.json() as {
        templates: { writer: string[] };
        resolvedTemplates: Array<{ role: string; effectivePermissions: string[] }>;
      };
      assert.deepEqual(updatedTemplates.templates.writer, ["project.view", "version.review"]);

      const deniedTemplateResponse = await originalFetch(`${baseUrl}/teams/${teamId}/permission-templates`, {
        method: "PUT",
        headers: writerJsonHeaders,
        body: JSON.stringify({ templates: { viewer: ["project.view", "project.edit"] } }),
      });
      assert.equal(deniedTemplateResponse.status, 403);

      const getMemberPermissionsResponse = await originalFetch(`${baseUrl}/projects/${project.id}/members/${writerMember.id}/permissions`, {
        headers: authHeaders(owner.accessToken),
      });
      assert.equal(getMemberPermissionsResponse.status, 200);
      const memberPermissions = await getMemberPermissionsResponse.json() as {
        inheritedPermissions: string[];
        permissionOverride: { allow: string[]; deny: string[] };
        effectivePermissions: string[];
      };
      assert.deepEqual(memberPermissions.inheritedPermissions, ["project.view", "version.review"]);
      assert.deepEqual(memberPermissions.permissionOverride, { allow: [], deny: [] });

      const invalidMemberPermissionsResponse = await readResponse(await originalFetch(`${baseUrl}/projects/${project.id}/members/${writerMember.id}/permissions`, {
        method: "PUT",
        headers: ownerJsonHeaders,
        body: JSON.stringify({
          permissionOverride: {
            allow: ["job.manage", "bad.permission"],
            deny: ["version.review"],
          },
        }),
      }));
      assert.equal(invalidMemberPermissionsResponse.status, 400);
      assert.equal(invalidMemberPermissionsResponse.bodyText.includes("bad.permission"), true);
      assert.equal(invalidMemberPermissionsResponse.bodyText.includes("permissionOverride.allow[1]"), true);

      const updateMemberPermissionsResponse = await originalFetch(`${baseUrl}/projects/${project.id}/members/${writerMember.id}/permissions`, {
        method: "PUT",
        headers: ownerJsonHeaders,
        body: JSON.stringify({
          permissionOverride: {
            allow: ["job.manage"],
            deny: ["version.review"],
          },
        }),
      });
      assert.equal(updateMemberPermissionsResponse.status, 200);
      const updatedMemberPermissions = await updateMemberPermissionsResponse.json() as {
        permissionOverride: { allow: string[]; deny: string[] };
        effectivePermissions: string[];
      };
      assert.deepEqual(updatedMemberPermissions.permissionOverride, {
        allow: ["job.manage"],
        deny: ["version.review"],
      });
      assert.equal(updatedMemberPermissions.effectivePermissions.includes("job.manage"), true);
      assert.equal(updatedMemberPermissions.effectivePermissions.includes("version.review"), false);
    });
  });

  await runCase("scene batch TTS uses saved character voice config and audio versions can be adopted", async () => {
    await withHttpApp(async (baseUrl) => {
      const owner = await registerUser(baseUrl, {
        email: "tts-owner@example.com",
        displayName: "TTS Owner",
      });
      const jsonHeaders = authHeaders(owner.accessToken, true);
      const readHeaders = authHeaders(owner.accessToken);

      const teams = await listTeams(baseUrl, owner.accessToken);
      assert.equal(teams.length > 0, true);
      const teamId = teams.find((t) => t.currentUserRole === "tenant_owner")?.id ?? teams[0].id;

      const createProjectResponse = await originalFetch(`${baseUrl}/projects`, {
        method: "POST",
        headers: { ...jsonHeaders },
        body: JSON.stringify({
          teamId,
          name: "TTS Voice Project",
          description: "TTS workflow test",
          reviewPolicyMode: "bypass",
        }),
      });
      assert.equal(createProjectResponse.status, 201);
      const createdProject = await createProjectResponse.json() as { id: string };

      const characterResponse = await originalFetch(`${baseUrl}/projects/${createdProject.id}/world-bible/characters`, {
        method: "POST",
        headers: { ...jsonHeaders },
        body: JSON.stringify({
          name: "Narrator",
          appearance: "Voice over host",
        }),
      });
      assert.equal(characterResponse.status, 201);
      const character = await characterResponse.json() as { id: string };

      const voiceConfigResponse = await originalFetch(`${baseUrl}/projects/${createdProject.id}/world-bible/characters/${character.id}/voice`, {
        method: "PATCH",
        headers: { ...jsonHeaders },
        body: JSON.stringify({
          ttsProvider: "mock",
          voiceId: "mock-narrator",
          voiceName: "Mock Narrator",
          settings: { speed: 1.2 },
        }),
      });
      assert.equal(voiceConfigResponse.status, 200);

      const projectResponse = await originalFetch(`${baseUrl}/projects/${createdProject.id}`, {
        headers: readHeaders,
      });
      assert.equal(projectResponse.status, 200);
      const project = await projectResponse.json() as {
        documents: Array<{ id: string; type: string; shotId?: string; currentVersionId?: string }>;
      };
      const storyboardDocument = project.documents.find((document) => document.type === "storyboard");
      assert.ok(storyboardDocument);

      const storyboardVersionResponse = await originalFetch(`${baseUrl}/documents/${storyboardDocument.id}/versions`, {
        method: "POST",
        headers: { ...jsonHeaders },
        body: JSON.stringify({
          title: "Storyboard with dialogue",
          content: {
            overview: "TTS scene",
            shots: [
              {
                id: "shot-tts-1",
                sceneId: "scene-tts-1",
                shotLabel: "1A",
                framing: "MS",
                cameraMove: "static",
                durationSeconds: 3,
                visualDescription: "Narrator in front of the camera",
                dialogue: "Welcome to the show.",
                characterIds: [character.id],
              },
              {
                id: "shot-tts-2",
                sceneId: "scene-tts-1",
                shotLabel: "1B",
                framing: "CU",
                cameraMove: "push-in",
                durationSeconds: 4,
                visualDescription: "Narrator leans in",
                dialogue: "Today we explore a new scene.",
                characterIds: [character.id],
              },
            ],
          },
          metadata: { source: "tts-test" },
        }),
      });
      assert.equal(storyboardVersionResponse.status, 201);

      const batchTtsResponse = await originalFetch(`${baseUrl}/scenes/scene-tts-1/batch-tts-jobs`, {
        method: "POST",
        headers: { ...jsonHeaders },
        body: JSON.stringify({ projectId: createdProject.id }),
      });
      assert.equal(batchTtsResponse.status, 201);
      const batchTts = await batchTtsResponse.json() as { jobIds: string[] };
      assert.equal(batchTts.jobIds.length, 2);

      for (const jobId of batchTts.jobIds) {
        const processResponse = await originalFetch(`${baseUrl}/internal/jobs/${jobId}/process`, {
          method: "POST",
          headers: { "x-internal-key": process.env.INTERNAL_API_KEY ?? "dramaflow-internal-key" },
        });
        assert.equal(processResponse.ok, true);
      }

      const jobsResponse = await originalFetch(`${baseUrl}/projects/${createdProject.id}/jobs?type=tts_generation`, {
        headers: readHeaders,
      });
      assert.equal(jobsResponse.status, 200);
      const jobsPayload = await jobsResponse.json() as { jobs: Array<{ id: string; result?: { voiceId?: string } }> };
      assert.equal(jobsPayload.jobs.length, 2);
      assert.equal(jobsPayload.jobs.every((job) => job.result?.voiceId === "mock-narrator"), true);

      const projectAfterTtsResponse = await originalFetch(`${baseUrl}/projects/${createdProject.id}`, {
        headers: readHeaders,
      });
      assert.equal(projectAfterTtsResponse.status, 200);
      const projectAfterTts = await projectAfterTtsResponse.json() as {
        documents: Array<{ id: string; type: string; shotId?: string; currentVersionId?: string }>;
      };
      const projectAfterTtsVersions = await listProjectVersions<{ id: string; documentId: string; content?: { voiceId?: string } }>(
        baseUrl,
        owner.accessToken,
        createdProject.id,
      );
      const audioDocument = projectAfterTts.documents.find((document) => document.type === "audio" && document.shotId === "shot-tts-1");
      assert.ok(audioDocument);
      const audioVersion = projectAfterTtsVersions.find((version) => version.id === audioDocument.currentVersionId);
      assert.equal(audioVersion?.content?.voiceId, "mock-narrator");

      const imageJobOneResponse = await originalFetch(`${baseUrl}/shots/shot-tts-1/image-jobs`, {
        method: "POST",
        headers: { ...jsonHeaders },
        body: JSON.stringify({
          projectId: createdProject.id,
          style: "cinematic",
          aspectRatio: "16:9",
        }),
      });
      assert.equal(imageJobOneResponse.status, 201);
      const imageJobOne = await imageJobOneResponse.json() as { id: string };
      let processImageResponse = await originalFetch(`${baseUrl}/internal/jobs/${imageJobOne.id}/process`, {
        method: "POST",
        headers: { "x-internal-key": process.env.INTERNAL_API_KEY ?? "dramaflow-internal-key" },
      });
      assert.equal(processImageResponse.ok, true);

      const imageJobTwoResponse = await originalFetch(`${baseUrl}/shots/shot-tts-1/image-jobs`, {
        method: "POST",
        headers: { ...jsonHeaders },
        body: JSON.stringify({
          projectId: createdProject.id,
          style: "cinematic",
          aspectRatio: "16:9",
          prompt: "Alternative composition",
        }),
      });
      assert.equal(imageJobTwoResponse.status, 201);
      const imageJobTwo = await imageJobTwoResponse.json() as { id: string };
      processImageResponse = await originalFetch(`${baseUrl}/internal/jobs/${imageJobTwo.id}/process`, {
        method: "POST",
        headers: { "x-internal-key": process.env.INTERNAL_API_KEY ?? "dramaflow-internal-key" },
      });
      assert.equal(processImageResponse.ok, true);

      const projectWithCandidatesResponse = await originalFetch(`${baseUrl}/projects/${createdProject.id}`, {
        headers: readHeaders,
      });
      assert.equal(projectWithCandidatesResponse.status, 200);
      const projectWithCandidates = await projectWithCandidatesResponse.json() as {
        documents: Array<{ id: string; type: string; shotId?: string; currentVersionId?: string }>;
      };
      const projectCandidateVersions = await listProjectVersions<{ id: string; documentId: string; versionNumber: number }>(
        baseUrl,
        owner.accessToken,
        createdProject.id,
      );
      const imageDocument = projectWithCandidates.documents.find((document) => document.type === "image" && document.shotId === "shot-tts-1");
      assert.ok(imageDocument);
      const imageVersions = projectCandidateVersions
        .filter((version) => version.documentId === imageDocument.id)
        .sort((left, right) => left.versionNumber - right.versionNumber);
      assert.equal(imageVersions.length, 2);
      assert.equal(imageDocument.currentVersionId, imageVersions[1].id);

      const adoptResponse = await originalFetch(`${baseUrl}/documents/${imageDocument.id}/adopt-version`, {
        method: "POST",
        headers: { ...jsonHeaders },
        body: JSON.stringify({ versionId: imageVersions[0].id }),
      });
      assert.equal(adoptResponse.status, 201);

      const adoptedProjectResponse = await originalFetch(`${baseUrl}/projects/${createdProject.id}`, {
        headers: readHeaders,
      });
      assert.equal(adoptedProjectResponse.status, 200);
      const adoptedProject = await adoptedProjectResponse.json() as {
        documents: Array<{ id: string; type: string; shotId?: string; currentVersionId?: string }>;
      };
      const adoptedImageDocument = adoptedProject.documents.find((document) => document.type === "image" && document.shotId === "shot-tts-1");
      assert.equal(adoptedImageDocument?.currentVersionId, imageVersions[0].id);
    });
  });

  await runCase("project permissions enforce review member job timeline and export actions", async () => {
    await withHttpApp(async (baseUrl) => {
      const owner = await registerUser(baseUrl, { email: "enforce-owner@example.com", displayName: "Enforce Owner" });
      const director = await registerUser(baseUrl, { email: "enforce-director@example.com", displayName: "Enforce Director" });
      const writer = await registerUser(baseUrl, { email: "enforce-writer@example.com", displayName: "Enforce Writer" });
      const viewer = await registerUser(baseUrl, { email: "enforce-viewer@example.com", displayName: "Enforce Viewer" });
      const tenantAdmin = await registerUser(baseUrl, { email: "enforce-tenant-admin@example.com", displayName: "Enforce Tenant Admin" });
      const ownerJsonHeaders = authHeaders(owner.accessToken, true);
      const directorJsonHeaders = authHeaders(director.accessToken, true);
      const writerJsonHeaders = authHeaders(writer.accessToken, true);
      const viewerJsonHeaders = authHeaders(viewer.accessToken, true);

      const teams = await listTeams(baseUrl, owner.accessToken);
      assert.equal(teams.length > 0, true);
      const teamId = teams.find((t) => t.currentUserRole === "tenant_owner")?.id ?? teams[0].id;

      const addTenantAdminResponse = await originalFetch(`${baseUrl}/teams/${teamId}/members`, {
        method: "POST",
        headers: ownerJsonHeaders,
        body: JSON.stringify({ email: tenantAdmin.user.email, role: "tenant_admin" }),
      });
      assert.equal(addTenantAdminResponse.status, 201);

      const projectResponse = await originalFetch(`${baseUrl}/projects`, {
        method: "POST",
        headers: ownerJsonHeaders,
        body: JSON.stringify({ teamId, name: "Enforcement Project", reviewPolicyMode: "required" }),
      });
      assert.equal(projectResponse.status, 201);
      const project = await projectResponse.json() as { id: string };

      const addDirectorResponse = await originalFetch(`${baseUrl}/projects/${project.id}/members`, {
        method: "POST",
        headers: ownerJsonHeaders,
        body: JSON.stringify({ email: director.user.email, role: "director" }),
      });
      assert.equal(addDirectorResponse.status, 201);
      const directorMember = await addDirectorResponse.json() as { id: string };

      const addWriterResponse = await originalFetch(`${baseUrl}/projects/${project.id}/members`, {
        method: "POST",
        headers: ownerJsonHeaders,
        body: JSON.stringify({ email: writer.user.email, role: "writer" }),
      });
      assert.equal(addWriterResponse.status, 201);
      const writerMember = await addWriterResponse.json() as { id: string };

      const addViewerResponse = await originalFetch(`${baseUrl}/projects/${project.id}/members`, {
        method: "POST",
        headers: ownerJsonHeaders,
        body: JSON.stringify({ email: viewer.user.email, role: "viewer" }),
      });
      assert.equal(addViewerResponse.status, 201);
      const viewerMember = await addViewerResponse.json() as { id: string };

      const projectPayloadResponse = await originalFetch(`${baseUrl}/projects/${project.id}`, {
        headers: authHeaders(owner.accessToken),
      });
      assert.equal(projectPayloadResponse.status, 200);
      const projectPayload = await projectPayloadResponse.json() as {
        documents: Array<{ id: string; type: string }>;
      };
      const scriptDocument = projectPayload.documents.find((document) => document.type === "script");
      assert.ok(scriptDocument);

      const viewerWorkspaceBeforeDenyResponse = await originalFetch(`${baseUrl}/projects/${project.id}`, {
        headers: authHeaders(viewer.accessToken),
      });
      assert.equal(viewerWorkspaceBeforeDenyResponse.status, 200);

      const viewerProjectVersionsBeforeDenyResponse = await originalFetch(`${baseUrl}/projects/${project.id}/versions`, {
        headers: authHeaders(viewer.accessToken),
      });
      assert.equal(viewerProjectVersionsBeforeDenyResponse.status, 200);

      const viewerDocumentVersionsBeforeDenyResponse = await originalFetch(`${baseUrl}/documents/${scriptDocument.id}/versions`, {
        headers: authHeaders(viewer.accessToken),
      });
      assert.equal(viewerDocumentVersionsBeforeDenyResponse.status, 200);

      const viewerJobsBeforeDenyResponse = await originalFetch(`${baseUrl}/projects/${project.id}/jobs`, {
        headers: authHeaders(viewer.accessToken),
      });
      assert.equal(viewerJobsBeforeDenyResponse.status, 200);

      const tenantAdminWorkspaceResponse = await originalFetch(`${baseUrl}/projects/${project.id}`, {
        headers: authHeaders(tenantAdmin.accessToken),
      });
      assert.equal(tenantAdminWorkspaceResponse.status, 200);
      const tenantAdminWorkspace = await tenantAdminWorkspaceResponse.json() as { currentUserPermissions: string[] };
      assert.deepEqual(tenantAdminWorkspace.currentUserPermissions, PROJECT_PERMISSIONS);

      const denyViewerReadResponse = await originalFetch(`${baseUrl}/projects/${project.id}/members/${viewerMember.id}/permissions`, {
        method: "PUT",
        headers: ownerJsonHeaders,
        body: JSON.stringify({ permissionOverride: { allow: [], deny: ["project.view"] } }),
      });
      assert.equal(denyViewerReadResponse.status, 200);

      const viewerWorkspaceAfterDenyResponse = await originalFetch(`${baseUrl}/projects/${project.id}`, {
        headers: authHeaders(viewer.accessToken),
      });
      assert.equal(viewerWorkspaceAfterDenyResponse.status, 403);

      const viewerProjectVersionsAfterDenyResponse = await originalFetch(`${baseUrl}/projects/${project.id}/versions`, {
        headers: authHeaders(viewer.accessToken),
      });
      assert.equal(viewerProjectVersionsAfterDenyResponse.status, 403);

      const viewerDocumentVersionsAfterDenyResponse = await originalFetch(`${baseUrl}/documents/${scriptDocument.id}/versions`, {
        headers: authHeaders(viewer.accessToken),
      });
      assert.equal(viewerDocumentVersionsAfterDenyResponse.status, 403);

      const viewerJobsAfterDenyResponse = await originalFetch(`${baseUrl}/projects/${project.id}/jobs`, {
        headers: authHeaders(viewer.accessToken),
      });
      assert.equal(viewerJobsAfterDenyResponse.status, 403);

      const versionResponse = await originalFetch(`${baseUrl}/documents/${scriptDocument.id}/versions`, {
        method: "POST",
        headers: ownerJsonHeaders,
        body: JSON.stringify({
          title: "Manual Review",
          content: { logline: "Permission review", premise: "A test.", characters: [], scenes: [] },
        }),
      });
      assert.equal(versionResponse.status, 201);
      const version = await versionResponse.json() as { id: string };

      const submitResponse = await originalFetch(`${baseUrl}/versions/${version.id}/submit`, {
        method: "POST",
        headers: authHeaders(owner.accessToken),
      });
      assert.equal(submitResponse.status, 201);

      const directorApproveResponse = await originalFetch(`${baseUrl}/versions/${version.id}/approve`, {
        method: "POST",
        headers: directorJsonHeaders,
        body: JSON.stringify({ comment: "Director approved." }),
      });
      assert.equal(directorApproveResponse.status, 201);

      const deniedOverrideResponse = await originalFetch(`${baseUrl}/projects/${project.id}/members/${directorMember.id}/permissions`, {
        method: "PUT",
        headers: ownerJsonHeaders,
        body: JSON.stringify({ permissionOverride: { allow: [], deny: ["version.review"] } }),
      });
      assert.equal(deniedOverrideResponse.status, 200);

      const secondVersionResponse = await originalFetch(`${baseUrl}/documents/${scriptDocument.id}/versions`, {
        method: "POST",
        headers: ownerJsonHeaders,
        body: JSON.stringify({
          title: "Denied Review",
          content: { logline: "Denied", premise: "A test.", characters: [], scenes: [] },
        }),
      });
      assert.equal(secondVersionResponse.status, 201);
      const secondVersion = await secondVersionResponse.json() as { id: string };
      await originalFetch(`${baseUrl}/versions/${secondVersion.id}/submit`, {
        method: "POST",
        headers: authHeaders(owner.accessToken),
      });

      const deniedDirectorApproveResponse = await originalFetch(`${baseUrl}/versions/${secondVersion.id}/approve`, {
        method: "POST",
        headers: directorJsonHeaders,
        body: JSON.stringify({ comment: "Should fail." }),
      });
      assert.equal(deniedDirectorApproveResponse.status, 403);

      const allowWriterReviewResponse = await originalFetch(`${baseUrl}/projects/${project.id}/members/${writerMember.id}/permissions`, {
        method: "PUT",
        headers: ownerJsonHeaders,
        body: JSON.stringify({ permissionOverride: { allow: ["version.review"], deny: [] } }),
      });
      assert.equal(allowWriterReviewResponse.status, 200);

      const writerApproveResponse = await originalFetch(`${baseUrl}/versions/${secondVersion.id}/approve`, {
        method: "POST",
        headers: writerJsonHeaders,
        body: JSON.stringify({ comment: "Writer approved by override." }),
      });
      assert.equal(writerApproveResponse.status, 201);

      const viewerAddMemberResponse = await originalFetch(`${baseUrl}/projects/${project.id}/members`, {
        method: "POST",
        headers: viewerJsonHeaders,
        body: JSON.stringify({ email: "nobody@example.com", role: "viewer" }),
      });
      assert.equal(viewerAddMemberResponse.status, 403);

      const viewerBatchResponse = await originalFetch(`${baseUrl}/projects/${project.id}/batch-image-jobs`, {
        method: "POST",
        headers: viewerJsonHeaders,
        body: JSON.stringify({ shotIds: ["shot-permission-1"] }),
      });
      assert.equal(viewerBatchResponse.status, 403);

      const viewerExportResponse = await originalFetch(`${baseUrl}/projects/${project.id}/export-jobs`, {
        method: "POST",
        headers: viewerJsonHeaders,
        body: JSON.stringify({ resolution: "1080x1920", fps: 30, format: "mp4" }),
      });
      assert.equal(viewerExportResponse.status, 403);

      const ownerWorkspaceResponse = await originalFetch(`${baseUrl}/projects/${project.id}`, {
        headers: authHeaders(owner.accessToken),
      });
      assert.equal(ownerWorkspaceResponse.status, 200);
      const ownerWorkspace = await ownerWorkspaceResponse.json() as { currentUserPermissions: string[] };
      assert.equal(ownerWorkspace.currentUserPermissions.includes("permission.manage"), true);
    });
  });

  await runCase("structured prompt snapshots are preserved in impact dependencies", async () => {
    await withHttpApp(async (baseUrl) => {
      const owner = await registerUser(baseUrl, {
        email: "prompt-snapshot-owner@example.com",
        displayName: "Prompt Snapshot Owner",
      });
      const jsonHeaders = authHeaders(owner.accessToken, true);
      const readHeaders = authHeaders(owner.accessToken);

      const teams = await listTeams(baseUrl, owner.accessToken);
      assert.equal(teams.length > 0, true);
      const teamId = teams.find((team) => team.currentUserRole === "tenant_owner")?.id ?? teams[0].id;

      const projectResponse = await originalFetch(`${baseUrl}/projects`, {
        method: "POST",
        headers: jsonHeaders,
        body: JSON.stringify({
          teamId,
          name: "Prompt Snapshot Audit Project",
          reviewPolicyMode: "bypass",
        }),
      });
      assert.equal(projectResponse.status, 201);
      const project = await projectResponse.json() as { id: string };

      const workspaceResponse = await originalFetch(`${baseUrl}/projects/${project.id}`, {
        headers: readHeaders,
      });
      assert.equal(workspaceResponse.status, 200);
      const workspace = await workspaceResponse.json() as {
        documents: Array<{ id: string; type: string }>;
      };
      const scriptDocument = workspace.documents.find((document) => document.type === "script");
      const storyboardDocument = workspace.documents.find((document) => document.type === "storyboard");
      assert.ok(scriptDocument);
      assert.ok(storyboardDocument);

      const scriptVersionResponse = await originalFetch(`${baseUrl}/documents/${scriptDocument.id}/versions`, {
        method: "POST",
        headers: jsonHeaders,
        body: JSON.stringify({
          title: "Source Script",
          content: {
            logline: "A prompt audit source.",
            premise: "A test.",
            characters: [],
            scenes: [],
          },
          metadata: { source: "prompt-snapshot-test" },
        }),
      });
      assert.equal(scriptVersionResponse.status, 201);
      const scriptVersion = await scriptVersionResponse.json() as { id: string };

      const storyboardVersionResponse = await originalFetch(`${baseUrl}/documents/${storyboardDocument.id}/versions`, {
        method: "POST",
        headers: jsonHeaders,
        body: JSON.stringify({
          title: "Storyboard From Script",
          content: {
            overview: "Prompt audit storyboard.",
            shots: [],
          },
          metadata: {
            sourceScriptVersionId: scriptVersion.id,
            provider: "gpt-test",
            model: "gpt-test",
            promptSnapshot: {
              contractId: "storyboard.generation.v1",
              contractVersion: "1.0.0",
              schemaVersion: "storyboard.v1",
            },
          },
        }),
      });
      assert.equal(storyboardVersionResponse.status, 201);
      const storyboardVersion = await storyboardVersionResponse.json() as { id: string };

      const summaryResponse = await originalFetch(`${baseUrl}/versions/${storyboardVersion.id}/impact-summary`, {
        headers: readHeaders,
      });
      assert.equal(summaryResponse.status, 200);
      const summary = await summaryResponse.json() as {
        dependencies: Array<{ promptSnapshot?: unknown }>;
      };
      assert.equal(summary.dependencies.length, 1);
      const promptSnapshot = summary.dependencies[0].promptSnapshot as Record<string, unknown>;
      assert.equal(promptSnapshot.contractId, "storyboard.generation.v1");
      assert.equal(promptSnapshot.contractVersion, "1.0.0");
      assert.equal(promptSnapshot.schemaVersion, "storyboard.v1");
    });
  });

  await runCase("shot composition requires a selected or current video asset", async () => {
    await withHttpApp(async (baseUrl) => {
      const owner = await registerUser(baseUrl, { email: "compose-missing-video@example.com", displayName: "Compose Missing Video" });
      const jsonHeaders = authHeaders(owner.accessToken, true);
      const teams = await listTeams(baseUrl, owner.accessToken);
      const teamId = teams.find((t) => t.currentUserRole === "tenant_owner")?.id ?? teams[0].id;

      const createProjectResponse = await originalFetch(`${baseUrl}/projects`, {
        method: "POST",
        headers: { ...jsonHeaders },
        body: JSON.stringify({
          teamId,
          name: "Composition Missing Video",
          description: "Composition should fail without video",
          reviewPolicyMode: "bypass",
        }),
      });
      assert.equal(createProjectResponse.status, 201);
      const project = await createProjectResponse.json() as { id: string };

      const workspaceResponse = await originalFetch(`${baseUrl}/projects/${project.id}`, {
        headers: authHeaders(owner.accessToken),
      });
      assert.equal(workspaceResponse.status, 200);
      const workspace = await workspaceResponse.json() as { documents: Array<{ id: string; type: string }> };
      const storyboardDocument = workspace.documents.find((document) => document.type === "storyboard");
      assert.ok(storyboardDocument);

      const versionResponse = await originalFetch(`${baseUrl}/documents/${storyboardDocument.id}/versions`, {
        method: "POST",
        headers: { ...jsonHeaders },
        body: JSON.stringify({
          title: "Storyboard",
          content: {
            overview: "Composition test",
            shots: [{
              id: "shot-compose-missing-video",
              sceneId: "scene-compose",
              shotLabel: "1A",
              framing: "MS",
              cameraMove: "static",
              durationSeconds: 3,
              visualDescription: "A shot without generated video",
              dialogue: "This should not compose.",
            }],
            mediaBindings: {},
          },
          metadata: { source: "composition-test" },
        }),
      });
      assert.equal(versionResponse.status, 201);

      const compositionResponse = await originalFetch(`${baseUrl}/shots/shot-compose-missing-video/composition-jobs`, {
        method: "POST",
        headers: { ...jsonHeaders },
        body: JSON.stringify({
          projectId: project.id,
          resolution: "1080x1920",
          fps: 30,
          format: "mp4",
        }),
      });
      assert.equal(compositionResponse.status, 400);
      const errorText = await compositionResponse.text();
      assert.match(errorText, /Shot video is required before composition/);
    });
  });

  await runCase("timeline auto assembly prefers approved shot compositions", async () => {
    await withHttpApp(async (baseUrl) => {
      const owner = await registerUser(baseUrl, { email: "compose-timeline@example.com", displayName: "Compose Timeline" });
      const jsonHeaders = authHeaders(owner.accessToken, true);
      const readHeaders = authHeaders(owner.accessToken);
      const teams = await listTeams(baseUrl, owner.accessToken);
      const teamId = teams.find((t) => t.currentUserRole === "tenant_owner")?.id ?? teams[0].id;

      const createProjectResponse = await originalFetch(`${baseUrl}/projects`, {
        method: "POST",
        headers: { ...jsonHeaders },
        body: JSON.stringify({
          teamId,
          name: "Composition Timeline",
          description: "Timeline should prefer approved composition",
          reviewPolicyMode: "bypass",
        }),
      });
      assert.equal(createProjectResponse.status, 201);
      const project = await createProjectResponse.json() as { id: string };

      const workspaceResponse = await originalFetch(`${baseUrl}/projects/${project.id}`, { headers: readHeaders });
      const workspace = await workspaceResponse.json() as { documents: Array<{ id: string; type: string }> };
      const storyboardDocument = workspace.documents.find((document) => document.type === "storyboard");
      assert.ok(storyboardDocument);

      await originalFetch(`${baseUrl}/documents/${storyboardDocument.id}/versions`, {
        method: "POST",
        headers: { ...jsonHeaders },
        body: JSON.stringify({
          title: "Storyboard",
          content: {
            overview: "Timeline composition",
            shots: [{
              id: "shot-compose-timeline",
              sceneId: "scene-compose",
              shotLabel: "1A",
              framing: "MS",
              cameraMove: "static",
              durationSeconds: 3,
              visualDescription: "A composed shot",
              dialogue: "This audio should already be burned in.",
            }],
            mediaBindings: {},
          },
          metadata: { source: "composition-timeline-test" },
        }),
      });

      // 提交 storyboard 版本使其成为 currentVersion
      const workspaceAfterVersionResponse = await originalFetch(`${baseUrl}/projects/${project.id}`, { headers: readHeaders });
      const workspaceAfterVersion = await workspaceAfterVersionResponse.json() as {
        documents: Array<{ id: string; type: string; draftVersionId?: string }>;
      };
      const sbDoc = workspaceAfterVersion.documents.find((document) => document.type === "storyboard");
      if (sbDoc?.draftVersionId) {
        const submitStoryboardResponse = await originalFetch(`${baseUrl}/versions/${sbDoc.draftVersionId}/submit`, {
          method: "POST",
          headers: readHeaders,
        });
        assert.equal(submitStoryboardResponse.status, 201);
      }

      const uploadedVideo = await uploadTestAsset(baseUrl, owner.accessToken, project.id, {
        filename: "raw-video.mp4",
        mimeType: "video/mp4",
        body: "raw-video",
      });
      const registerVideoResponse = await originalFetch(`${baseUrl}/projects/${project.id}/assets`, {
        method: "POST",
        headers: { ...jsonHeaders },
        body: JSON.stringify({
          type: "video",
          title: "Raw Video",
          filename: "raw-video.mp4",
          assetId: uploadedVideo.assetId,
          assetUrl: uploadedVideo.assetUrl,
          mimeType: "video/mp4",
          sizeInBytes: 9,
          shotId: "shot-compose-timeline",
        }),
      });
      assert.equal(registerVideoResponse.status, 201);
      const registeredVideo = await registerVideoResponse.json() as { version: { id: string } };

      // 提交并自动验收上传的视频版本，使其成为 currentVersion
      const submitVideoResponse = await originalFetch(`${baseUrl}/versions/${registeredVideo.version.id}/submit`, {
        method: "POST",
        headers: readHeaders,
      });
      assert.equal(submitVideoResponse.status, 201);

      const compositionJobResponse = await originalFetch(`${baseUrl}/shots/shot-compose-timeline/composition-jobs`, {
        method: "POST",
        headers: { ...jsonHeaders },
        body: JSON.stringify({
          projectId: project.id,
          resolution: "1080x1920",
          fps: 30,
          format: "mp4",
          allowMockFallback: true,
        }),
      });
      assert.equal(compositionJobResponse.status, 201);
      const compositionJob = await compositionJobResponse.json() as { id: string };
      const processResponse = await originalFetch(`${baseUrl}/internal/jobs/${compositionJob.id}/process`, {
        method: "POST",
        headers: { "x-internal-key": process.env.INTERNAL_API_KEY ?? "dramaflow-internal-key" },
      });
      assert.equal(processResponse.ok, true);

      const timelineResponse = await originalFetch(`${baseUrl}/projects/${project.id}/timeline/auto-assemble`, {
        method: "POST",
        headers: readHeaders,
      });
      assert.equal(timelineResponse.status, 201);
      const timeline = await timelineResponse.json() as { tracks: Array<{ type: string; clips: Array<{ source?: string; shotId?: string }> }> };
      const videoTrack = timeline.tracks.find((track) => track.type === "video");
      const dialogueTrack = timeline.tracks.find((track) => track.type === "dialogue");
      const subtitleTrack = timeline.tracks.find((track) => track.type === "subtitle");
      assert.equal(videoTrack?.clips.length, 1);
      assert.equal(videoTrack?.clips[0]?.source, "shot_composition");
      assert.equal(dialogueTrack?.clips.length, 0);
      assert.equal(subtitleTrack?.clips.length, 0);
    });
  });

  await runCase("mock image generation", async () => {
    const mediaProvider = new OpenAiMediaProvider();
    const image = await mediaProvider.generateImage({
      shotId: "shot-1-1",
      style: "Cinematic still",
      aspectRatio: "16:9",
      prompt: "A reveal on a rooftop at night",
    });

    assert.equal(image.mimeType.startsWith("image"), true);
    assert.ok(image.provider.length > 0);
  });

  {
    const result = runPromptEvals();
    assert.equal(result.ok, true, result.errors.join("\n"));
    console.log("api test passed: prompt contracts deterministic evals");
  }

  console.log("api tests passed");
}

void main();
