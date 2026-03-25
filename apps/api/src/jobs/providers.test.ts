import test from "node:test";
import assert from "node:assert/strict";

import { OpenAiMediaProvider } from "./media-generation.provider";
import { OpenAiCompatTextProvider } from "./text-generation.provider";

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

test.afterEach(() => {
  process.env = { ...originalEnv };
  globalThis.fetch = originalFetch;
});

test("text provider falls back to mock script content when no API key exists", async () => {
  delete process.env.OPENAI_COMPAT_API_KEY;

  const provider = new OpenAiCompatTextProvider();
  const script = await provider.generateScript(baseScriptInput);

  assert.ok(script.logline.includes("追光夜行"));
  assert.ok(script.scenes.length >= 1);
});

test("text provider parses standard JSON chat completion responses", async () => {
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

test("text provider parses SSE chat completion responses", async () => {
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

test("text provider throws when mock fallback is disabled and provider output is invalid", async () => {
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

test("media provider mock image returns inline SVG payload", async () => {
  const provider = new OpenAiMediaProvider();
  const result = await provider.generateImage({
    shotId: "shot-1-1",
    style: "电影剧照",
    aspectRatio: "16:9",
    prompt: "天台上的回头镜头",
  });

  assert.equal(result.provider.includes("image"), true);
  assert.equal(result.mimeType.startsWith("image"), true);
});