import assert from "node:assert/strict";

import { createEmptyDatabase } from "../src/common/database.types";
import { OpenAiMediaProvider } from "../src/jobs/media-generation.provider";
import { InternalJobsController } from "../src/jobs/internal-jobs.controller";
import { OpenAiCompatTextProvider } from "../src/jobs/text-generation.provider";

const originalFetch = globalThis.fetch;
const originalEnv = { ...process.env };
const baseScriptInput = {
  title: "追光夜行",
  genre: "都市悬疑",
  premise: "导演要在最后一晚救回流产项目",
  episodeGoal: "搭建首集冲突",
  tone: "克制、紧张",
  audience: "年轻都市观众",
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

async function main() {
  const db = createEmptyDatabase();
  assert.equal(db.users.length, 0);
  assert.equal(db.projects.length, 0);

  await runCase("mock script fallback without API key", async () => {
    delete process.env.OPENAI_COMPAT_API_KEY;

    const provider = new OpenAiCompatTextProvider();
    const script = await provider.generateScript(baseScriptInput);

    assert.ok(script.logline.includes("追光夜行"));
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
                logline: "真实剧本",
                premise: "真实前提",
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

    assert.equal(script.logline, "真实剧本");
    assert.equal(script.premise, "真实前提");
    assert.equal(script.scenes.length, 0);
  });

  await runCase("SSE text response", async () => {
    process.env.OPENAI_COMPAT_API_KEY = "test-key";
    process.env.OPENAI_COMPAT_BASE_URL = "https://example.test/v1";
    process.env.OPENAI_TEXT_MODEL = "gpt-5.4";

    const sseBody = [
      JSON.stringify({ id: "chunk-1", choices: [] }),
      JSON.stringify({ id: "chunk-2", choices: [{ delta: { content: '{"logline":"SSE 剧本",' } }] }),
      JSON.stringify({ id: "chunk-3", choices: [{ delta: { content: '"premise":"来自流式返回",' } }] }),
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

    assert.equal(script.logline, "SSE 剧本");
    assert.equal(script.premise, "来自流式返回");
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

  await runCase("internal jobs controller keeps service context bound", async () => {
    const calls: string[] = [];
    const controller = new InternalJobsController({
      claimNextJob: async () => {
        calls.push("claim");
        return { id: "job_1", status: "queued" };
      },
      processJob: async (jobId: string) => {
        calls.push(`process:${jobId}`);
        return { id: jobId, status: "completed" };
      },
    } as never);

    const detachedClaim = controller.claimNextJob;
    const detachedProcess = controller.processJob;

    const claimed = await detachedClaim();
    const processed = await detachedProcess("job_1");

    assert.deepEqual(claimed, { id: "job_1", status: "queued" });
    assert.deepEqual(processed, { id: "job_1", status: "completed" });
    assert.deepEqual(calls, ["claim", "process:job_1"]);
  });
  await runCase("mock image generation", async () => {
    const mediaProvider = new OpenAiMediaProvider();
    const image = await mediaProvider.generateImage({
      shotId: "shot-1-1",
      style: "电影剧照",
      aspectRatio: "16:9",
      prompt: "天台上的回头镜头",
    });

    assert.equal(image.mimeType.startsWith("image"), true);
    assert.ok(image.provider.length > 0);
  });

  console.log("api tests passed");
}

void main();