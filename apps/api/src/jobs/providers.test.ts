/**
 * @fileoverview Provider 单元测试
 * @module api/jobs
 *
 * 验证各 AI Provider 的基本功能和接口实现。
 */

import test from "node:test";
import assert from "node:assert/strict";

import { GoogleGeminiImageProvider } from "./google-gemini-image.provider";
import { OpenAiMediaProvider } from "./media-generation.provider";
import { OpenAiCompatTextProvider } from "./text-generation.provider";
import {
  normalizeVideoReferenceMode,
  buildResolvedVideoReferences,
} from "./video-reference.utils";

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

test.afterEach(() => {
  process.env = { ...originalEnv };
  globalThis.fetch = originalFetch;
});

test("text provider throws when no API key is configured", async () => {
  delete process.env.OPENAI_COMPAT_API_KEY;

  const provider = new OpenAiCompatTextProvider();
  await assert.rejects(
    provider.generateScript(baseScriptInput),
    /API key is not configured/,
  );
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

test("text provider enables streaming when config requests it", async () => {
  process.env.OPENAI_COMPAT_API_KEY = "test-key";
  process.env.OPENAI_COMPAT_BASE_URL = "https://example.test/v1";
  process.env.OPENAI_TEXT_MODEL = "gpt-5.4";

  const sseBody = [
    JSON.stringify({ id: "chunk-1", choices: [] }),
    JSON.stringify({ id: "chunk-2", choices: [{ delta: { content: '{"logline":"SSE script",' } }] }),
    JSON.stringify({ id: "chunk-3", choices: [{ delta: { content: '"premise":"From a stream",' } }] }),
    JSON.stringify({ id: "chunk-4", choices: [{ delta: { content: '"characters":[],"scenes":[]}' } }] }),
  ].map((payload) => `data: ${payload}`).concat("data: [DONE]").join("\n\n");

  globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as { stream: boolean };
    assert.equal(body.stream, true);

    return new Response(sseBody, {
      status: 200,
      headers: { "content-type": "text/event-stream" },
    });
  }) as typeof fetch;

  const provider = new OpenAiCompatTextProvider();
  const script = await provider.generateScript(baseScriptInput, {
    provider: "openai-completions",
    stream: true,
  });

  assert.equal(script.logline, "SSE script");
  assert.equal(script.premise, "From a stream");
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

test("media provider throws when no API key is configured", async () => {
  delete process.env.OPENAI_COMPAT_API_KEY;
  const prevNodeEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = "production";

  try {
    const provider = new OpenAiMediaProvider();
    await assert.rejects(
      provider.generateImage({
        shotId: "shot-1-1",
        style: "Cinematic still",
        aspectRatio: "16:9",
        prompt: "A reveal on a rooftop at night",
      }),
      /API key is not configured/,
    );
  } finally {
    process.env.NODE_ENV = prevNodeEnv;
  }
});

test("google provider sends a text-only generateContent request for text-to-image", async () => {
  process.env.GOOGLE_IMAGE_API_KEY = "google-image-key";
  process.env.GOOGLE_IMAGE_MODEL = "gemini-3.1-flash-image-preview";
  process.env.GOOGLE_IMAGE_BASE_URL = "https://generativelanguage.googleapis.com/v1beta";

  let capturedUrl = "";
  let capturedBody: Record<string, unknown> | undefined;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    capturedUrl = String(input);
    capturedBody = JSON.parse(String(init?.body)) as Record<string, unknown>;

    return new Response(JSON.stringify({
      candidates: [
        {
          content: {
            parts: [
              {
                inlineData: {
                  data: Buffer.from("image-bytes").toString("base64"),
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
  }) as typeof fetch;

  const provider = new GoogleGeminiImageProvider();
  const result = await provider.generateImage({
    shotId: "shot-1",
    style: "cinematic",
    aspectRatio: "16:9",
    prompt: "A rainy rooftop confession",
  });

  assert.equal(capturedUrl, "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-image-preview:generateContent?key=google-image-key");
  assert.equal(result.model, "gemini-3.1-flash-image-preview");
  assert.equal(result.fileExtension, "png");
  assert.equal(Buffer.from(result.inlineBody as Uint8Array).toString(), "image-bytes");

  const body = capturedBody as {
    contents: Array<{ parts: Array<{ text?: string }> }>;
    generationConfig: {
      responseModalities: string[];
      imageConfig: { aspectRatio: string; imageSize: string };
    };
  };
  assert.equal(body.contents[0].parts.length, 1);
  assert.equal(body.contents[0].parts[0].text, "A rainy rooftop confession");
  assert.deepEqual(body.generationConfig.responseModalities, ["TEXT", "IMAGE"]);
  assert.equal(body.generationConfig.imageConfig.aspectRatio, "16:9");
  assert.equal(body.generationConfig.imageConfig.imageSize, "1K");
});

test("google provider includes inline reference image data for edit requests", async () => {
  process.env.GOOGLE_IMAGE_API_KEY = "google-image-key";

  let capturedBody: Record<string, unknown> | undefined;
  globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    capturedBody = JSON.parse(String(init?.body)) as Record<string, unknown>;

    return new Response(JSON.stringify({
      candidates: [
        {
          content: {
            parts: [
              {
                inlineData: {
                  data: Buffer.from("edited-image").toString("base64"),
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
  }) as typeof fetch;

  const provider = new GoogleGeminiImageProvider();
  await provider.generateImage({
    shotId: "shot-2",
    style: "cinematic",
    aspectRatio: "9:16",
    prompt: "Refine the costume silhouette",
    referenceImageAssetId: "asset-ref",
    referenceImage: {
      body: Uint8Array.from([1, 2, 3, 4]),
      mimeType: "image/png",
    },
  });

  const body = capturedBody as {
    contents: Array<{ parts: Array<{ text?: string; inline_data?: { mime_type?: string; data?: string } }> }>;
  };
  assert.equal(body.contents[0].parts.length, 2);
  assert.equal(body.contents[0].parts[0].text, "Refine the costume silhouette");
  assert.equal(body.contents[0].parts[1].inline_data?.mime_type, "image/png");
  assert.equal(body.contents[0].parts[1].inline_data?.data, Buffer.from([1, 2, 3, 4]).toString("base64"));
});

test("google provider throws a clear error when no API key is available", async () => {
  delete process.env.GOOGLE_IMAGE_API_KEY;
  delete process.env.GOOGLE_IMAGE_BASE_URL;
  delete process.env.GOOGLE_IMAGE_MODEL;

  const provider = new GoogleGeminiImageProvider();
  await assert.rejects(
    provider.generateImage({
      shotId: "shot-3",
      style: "cinematic",
      aspectRatio: "1:1",
      prompt: "A close-up portrait",
    }, {
      provider: "google-gemini",
      model: "gemini-3.1-flash-image-preview",
    }),
    /Google image API key is required/,
  );
});

test("google provider throws when the response does not contain inline image data", async () => {
  process.env.GOOGLE_IMAGE_API_KEY = "google-image-key";

  globalThis.fetch = (async () => {
    return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: "no image" }] } }] }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;

  const provider = new GoogleGeminiImageProvider();
  await assert.rejects(
    provider.generateImage({
      shotId: "shot-4",
      style: "cinematic",
      aspectRatio: "4:3",
      prompt: "A crowded control room",
    }),
    /did not include image data/,
  );
});

// =============================================
// 视频参考图工具函数测试
// =============================================

test("video reference mode defaults legacy referenceImageAssetId to single", async () => {
  assert.equal(normalizeVideoReferenceMode({ referenceImageAssetId: "asset-current" }), "single");
});

test("video reference mode defaults no references to none", async () => {
  assert.equal(normalizeVideoReferenceMode({}), "none");
});

test("resolved video references truncates multiple references to six urls", async () => {
  const resolved = await buildResolvedVideoReferences({
    input: {
      shotId: "shot-1",
      style: "cinematic",
      aspectRatio: "16:9",
      videoReferenceMode: "multiple",
      referenceImageAssetIds: ["a1", "a2", "a3", "a4", "a5", "a6", "a7"],
    },
    resolveAssetUrl: async (assetId) => `https://cdn.test/${assetId}.png`,
  });

  assert.equal(resolved.mode, "multiple");
  assert.deepEqual(resolved.referenceImageUrls, [
    "https://cdn.test/a1.png",
    "https://cdn.test/a2.png",
    "https://cdn.test/a3.png",
    "https://cdn.test/a4.png",
    "https://cdn.test/a5.png",
    "https://cdn.test/a6.png",
  ]);
});

test("resolved first_last references requires both frame assets", async () => {
  await assert.rejects(
    buildResolvedVideoReferences({
      input: {
        shotId: "shot-2",
        style: "cinematic",
        aspectRatio: "16:9",
        videoReferenceMode: "first_last",
        firstFrameAssetId: "first",
      },
      resolveAssetUrl: async (assetId) => `https://cdn.test/${assetId}.png`,
    }),
    /first_last video reference mode requires both firstFrameAssetId and lastFrameAssetId/,
  );
});

// =============================================
// 视频 Provider 适配器注册表测试
// =============================================

import { getVideoProviderAdapter } from "./video-providers/registry";

test("video provider registry resolves new provider adapters", () => {
  assert.equal(getVideoProviderAdapter("minimax").provider, "minimax");
  assert.equal(getVideoProviderAdapter("volcengine").provider, "volcengine");
  assert.equal(getVideoProviderAdapter("vidu").provider, "vidu");
  assert.equal(getVideoProviderAdapter("ali").provider, "ali");
});

test("video provider registry rejects unsupported provider ids", () => {
  assert.throws(
    () => getVideoProviderAdapter("not-a-provider" as never),
    /Unsupported video provider/,
  );
});