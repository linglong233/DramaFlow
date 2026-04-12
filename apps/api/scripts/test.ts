import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { NestFactory } from "@nestjs/core";
import express from "express";

import { AdminController } from "../src/admin/admin.controller";
import { AppModule } from "../src/app.module";
import { AuthController } from "../src/auth/auth.controller";
import { createEmptyDatabase } from "../src/common/database.types";
import { InternalJobsController } from "../src/jobs/internal-jobs.controller";
import { OpenAiMediaProvider } from "../src/jobs/media-generation.provider";
import { JobsController } from "../src/jobs/jobs.controller";
import { OpenAiCompatTextProvider } from "../src/jobs/text-generation.provider";
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
    await rm(tempRoot, { recursive: true, force: true });
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

  await runCase("mock script fallback without API key", async () => {
    delete process.env.OPENAI_COMPAT_API_KEY;

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
      "getJob",
    ]);
    assertMethodsStayOnPrototype(new UploadsController({} as never), [
      "createUploadTarget",
      "directUpload",
      "getAssetUrl",
    ]);
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
      const teamId = teams[0].id;

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
      const teamId = teams[0].id;

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
      assert.equal(submittedReviewVersion.status, "pending_review");

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

  await runCase("scene batch TTS uses saved character voice config and audio versions can be adopted", async () => {
    await withHttpApp(async (baseUrl) => {
      const owner = await registerUser(baseUrl, {
        email: "tts-owner@example.com",
        displayName: "TTS Owner",
      });
      const jsonHeaders = authHeaders(owner.accessToken, true);
      const readHeaders = authHeaders(owner.accessToken);

      const teams = await listTeams(baseUrl, owner.accessToken);
      const teamId = teams[0].id;

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

  console.log("api tests passed");
}

void main();
