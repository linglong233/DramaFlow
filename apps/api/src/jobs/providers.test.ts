/**
 * @fileoverview Provider 单元测试
 * @module api/jobs
 *
 * 验证各 AI Provider 的基本功能和接口实现。
 */

import test from "node:test";
import assert from "node:assert/strict";

import sharp from "sharp";
import { GoogleGeminiImageProvider } from "./google-gemini-image.provider";
import { GrokMediaProvider } from "./grok-media.provider";
import { JobsService } from "./jobs.service";
import { OpenAiMediaProvider } from "./media-generation.provider";
import { OpenAiCompatTextProvider } from "./text-generation.provider";
import {
  normalizeVideoReferenceMode,
  buildResolvedVideoReferences,
  buildBatchVideoReferenceInput,
  applyResolvedVideoReferencesToInput,
  getVideoReferenceTransport,
  redactVideoReferenceDataUrls,
} from "./video-reference.utils";
import { buildVideoReferenceDataUrl } from "./video-reference-data-url";
import {
  createPromptSnapshot,
  type PromptContract,
} from "./prompting/prompt-contracts";
import {
  renderPromptSections,
  summarizePromptInput,
} from "./prompting/prompt-renderer";
import {
  buildJsonRepairPrompt,
  extractJsonObject,
  validatePromptSchema,
} from "./prompting/structured-output";
import {
  SCRIPT_GENERATION_CONTRACT,
  STORYBOARD_GENERATION_CONTRACT,
} from "./prompting/text-contracts";

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

test("text provider sends rendered prompt contract metadata and parses structured payload", async () => {
  process.env.OPENAI_COMPAT_API_KEY = "test-key";
  process.env.OPENAI_COMPAT_BASE_URL = "https://example.test/v1";
  process.env.OPENAI_TEXT_MODEL = "gpt-test";

  let capturedBody: Record<string, unknown> | undefined;
  globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    capturedBody = JSON.parse(String(init?.body));
    return new Response(JSON.stringify({
      choices: [
        {
          message: {
            content: JSON.stringify({
              logline: "A test logline",
              premise: "A test premise",
              characters: [{ name: "Lin", profile: "Lead" }],
              scenes: [{ id: "scene-1", heading: "INT. ROOM - NIGHT", synopsis: "A clue.", characters: ["Lin"], dialogue: [], directorNote: "tight" }],
            }),
          },
        },
      ],
    }), { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;

  const provider = new OpenAiCompatTextProvider();
  const rendered = SCRIPT_GENERATION_CONTRACT.render({
    title: "Pilot",
    genre: "Suspense",
    premise: "A secret.",
    episodeGoal: "Reveal it.",
    tone: "tense",
    audience: "mobile viewers",
  });

  const result = await provider.generateStructuredFromRenderedPrompt({
    operation: "script generation",
    rendered,
    schema: SCRIPT_GENERATION_CONTRACT.schema!,
    temperature: 0.8,
    config: {
      provider: "openai-completions",
      apiKey: "test-key",
      baseUrl: "https://example.test/v1",
      model: "gpt-test",
    },
    mockFactory: () => ({ logline: "", premise: "", characters: [], scenes: [] }),
    transformResult: SCRIPT_GENERATION_CONTRACT.validate,
  });

  const messages = capturedBody?.messages as Array<{ role: string; content: string }>;
  assert.equal(messages[0].content, rendered.system);
  assert.equal(messages[1].content, rendered.user);
  assert.equal(capturedBody?.response_format && typeof capturedBody.response_format, "object");
  assert.equal(result.content.logline, "A test logline");
  assert.equal(result.validation.ok, true);
  assert.equal(result.rendered.metadata.contractId, "script.generation.v1");
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

test("resolved video references keeps structured image objects and url compatibility fields", async () => {
  const resolved = await buildResolvedVideoReferences({
    input: {
      shotId: "shot-1",
      style: "cinematic",
      aspectRatio: "16:9",
      videoReferenceMode: "multiple",
      referenceImageAssetIds: ["a1", "a2", "a3", "a4", "a5", "a6", "a7"],
    },
    resolveAsset: async (assetId) => ({
      assetId,
      url: `https://cdn.test/${assetId}.png`,
      dataUrl: `data:image/jpeg;base64,${assetId}`,
      mimeType: "image/png",
      dataUrlMimeType: "image/jpeg",
      dataUrlSizeInBytes: 128,
    }),
  });

  assert.equal(resolved.mode, "multiple");
  assert.equal(resolved.referenceImages.length, 6);
  assert.equal(resolved.referenceImages[0].assetId, "a1");
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
      resolveAsset: async (assetId) => ({
        assetId,
        url: `https://cdn.test/${assetId}.png`,
        mimeType: "image/png",
      }),
    }),
    /first_last video reference mode requires both firstFrameAssetId and lastFrameAssetId/,
  );
});

test("batch video reference input defaults omitted mode with current image to single", () => {
  assert.deepEqual(buildBatchVideoReferenceInput("asset-current"), {
    videoReferenceMode: "single",
    referenceImageAssetId: "asset-current",
  });
});

test("batch video reference input downgrades to none without current image", () => {
  assert.deepEqual(buildBatchVideoReferenceInput(undefined), {
    videoReferenceMode: "none",
  });
});

test("batch video reference input respects explicit none", () => {
  assert.deepEqual(buildBatchVideoReferenceInput("asset-current", "none"), {
    videoReferenceMode: "none",
  });
});

test("provider input fields include first_last resolved urls", () => {
  const input = applyResolvedVideoReferencesToInput(
    {
      shotId: "shot-1",
      style: "cinematic",
      aspectRatio: "16:9",
      prompt: "A controlled camera move",
    },
    {
      mode: "first_last",
      firstFrame: {
        assetId: "asset-first",
        url: "https://cdn.test/first.png",
        mimeType: "image/png",
      },
      lastFrame: {
        assetId: "asset-last",
        url: "https://cdn.test/last.png",
        mimeType: "image/png",
      },
      firstFrameUrl: "https://cdn.test/first.png",
      lastFrameUrl: "https://cdn.test/last.png",
      referenceImages: [],
      referenceImageUrls: [],
    },
  );

  assert.equal(input.videoReferenceMode, "first_last");
  assert.equal(input.firstFrameUrl, "https://cdn.test/first.png");
  assert.equal(input.lastFrameUrl, "https://cdn.test/last.png");
  assert.equal("referenceImageUrl" in input, false);
});

test("provider input fields include multiple resolved urls", () => {
  const input = applyResolvedVideoReferencesToInput(
    {
      shotId: "shot-1",
      style: "cinematic",
      aspectRatio: "16:9",
      prompt: "A controlled camera move",
    },
    {
      mode: "multiple",
      referenceImages: [
        { assetId: "ref-1", url: "https://cdn.test/ref-1.png", mimeType: "image/png" },
        { assetId: "ref-2", url: "https://cdn.test/ref-2.png", mimeType: "image/png" },
      ],
      referenceImageUrls: [
        "https://cdn.test/ref-1.png",
        "https://cdn.test/ref-2.png",
      ],
    },
  );

  assert.equal(input.videoReferenceMode, "multiple");
  assert.deepEqual(input.referenceImageUrls, [
    "https://cdn.test/ref-1.png",
    "https://cdn.test/ref-2.png",
  ]);
  assert.equal("firstFrameUrl" in input, false);
});

test("provider input fields can select data URL transport", () => {
  const input = applyResolvedVideoReferencesToInput(
    {
      shotId: "shot-1",
      style: "cinematic",
      aspectRatio: "16:9",
      prompt: "A controlled camera move",
    },
    {
      mode: "single",
      image: {
        assetId: "asset-current",
        url: "https://cdn.test/current.png",
        dataUrl: "data:image/jpeg;base64,current",
        mimeType: "image/png",
        dataUrlMimeType: "image/jpeg",
        dataUrlSizeInBytes: 128,
      },
      referenceImages: [],
      imageUrl: "https://cdn.test/current.png",
      referenceImageUrls: [],
    },
    "data-url",
  );

  assert.equal(input.videoReferenceMode, "single");
  assert.equal(input.referenceImageUrl, "data:image/jpeg;base64,current");
});

test("provider input fields fall back to url when data URL is unavailable", () => {
  const input = applyResolvedVideoReferencesToInput(
    {
      shotId: "shot-1",
      style: "cinematic",
      aspectRatio: "16:9",
      prompt: "A controlled camera move",
    },
    {
      mode: "single",
      image: {
        assetId: "asset-current",
        url: "https://cdn.test/current.png",
        mimeType: "image/png",
      },
      referenceImages: [],
      imageUrl: "https://cdn.test/current.png",
      referenceImageUrls: [],
    },
    "data-url",
  );

  assert.equal(input.referenceImageUrl, "https://cdn.test/current.png");
});

test("video reference transport defaults are provider aware", () => {
  assert.equal(getVideoReferenceTransport("grok"), "data-url");
  assert.equal(getVideoReferenceTransport("openai-compatible"), "data-url");
  assert.equal(getVideoReferenceTransport("legacy-openai"), "data-url");
  assert.equal(getVideoReferenceTransport("minimax"), "url");
  assert.equal(getVideoReferenceTransport("volcengine"), "url");
  assert.equal(getVideoReferenceTransport("vidu"), "url");
  assert.equal(getVideoReferenceTransport("ali"), "url");
});

test("video reference parameter redaction removes data URL payloads", () => {
  const redacted = redactVideoReferenceDataUrls({
    referenceImageUrl: "data:image/jpeg;base64,current",
    firstFrameUrl: "https://cdn.test/first.png",
    referenceImageUrls: [
      "data:image/jpeg;base64,one",
      "https://cdn.test/two.png",
    ],
  });

  assert.equal(redacted.referenceImageUrl, "[data-url omitted]");
  assert.equal(redacted.firstFrameUrl, "https://cdn.test/first.png");
  assert.deepEqual(redacted.referenceImageUrls, [
    "[data-url omitted]",
    "https://cdn.test/two.png",
  ]);
});

// =============================================
// 视频参考图 Data URL 压缩工具测试
// =============================================

test("video reference data URL helper compresses image buffers", async () => {
  const source = await sharp({
    create: {
      width: 64,
      height: 32,
      channels: 3,
      background: "#336699",
    },
  }).png().toBuffer();

  const result = await buildVideoReferenceDataUrl(source, "image/png", {
    maxDimension: 32,
    jpegQuality: 80,
    maxBytes: 512 * 1024,
  });

  assert.equal(result.mimeType, "image/jpeg");
  assert.match(result.dataUrl, /^data:image\/jpeg;base64,/);
  assert.ok(result.sizeInBytes > 0);
  assert.ok(result.sizeInBytes <= 512 * 1024);
});

test("video reference data URL helper rejects oversized compressed output", async () => {
  const source = await sharp({
    create: {
      width: 16,
      height: 16,
      channels: 3,
      background: "#cc6633",
    },
  }).png().toBuffer();

  await assert.rejects(
    buildVideoReferenceDataUrl(source, "image/png", {
      maxDimension: 16,
      jpegQuality: 90,
      maxBytes: 8,
    }),
    /Video reference image is too large after compression/,
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

// =============================================
// 视频 Provider 适配器请求与轮询测试
// =============================================

import { MiniMaxVideoProviderAdapter } from "./video-providers/minimax-video.provider";
import { VolcEngineVideoProviderAdapter } from "./video-providers/volcengine-video.provider";
import { ViduVideoProviderAdapter } from "./video-providers/vidu-video.provider";
import { AliVideoProviderAdapter } from "./video-providers/ali-video.provider";

function videoAdapterInput(overrides: Partial<import("./video-providers/types").VideoProviderCreateInput> = {}) {
  return {
    prompt: "A character walks into the rain",
    shotId: "shot-1",
    aspectRatio: "16:9",
    durationSeconds: 5,
    config: {
      provider: "minimax" as const,
      apiKey: "key",
      baseUrl: "https://provider.test",
      model: "model-a",
    },
    references: {
      mode: "single" as const,
      image: {
        assetId: "asset-frame",
        url: "https://cdn.test/frame.png",
        mimeType: "image/png",
      },
      imageUrl: "https://cdn.test/frame.png",
      referenceImages: [],
      referenceImageUrls: [],
    },
    ...overrides,
  };
}

test("minimax video adapter sends content array with reference image", async () => {
  let capturedUrl = "";
  let capturedBody: Record<string, unknown> | undefined;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    capturedUrl = String(input);
    capturedBody = JSON.parse(String(init?.body));
    return new Response(JSON.stringify({ task_id: "mini-task-1", status: "processing" }), { status: 200 });
  }) as typeof fetch;

  const adapter = new MiniMaxVideoProviderAdapter();
  const state = await adapter.createJob(videoAdapterInput());

  assert.equal(capturedUrl, "https://provider.test/v1/video_generation");
  assert.equal(state.providerVideoId, "mini-task-1");
  const body = capturedBody as { content: Array<{ type: string; role?: string; image_url?: { url: string } }> };
  assert.equal(body.content[0].type, "text");
  assert.equal(body.content[1].role, "reference_image");
  assert.equal(body.content[1].image_url?.url, "https://cdn.test/frame.png");
});

// URL-only 适配器回归测试：确保即使存在 data URL 也只使用普通 URL
test("url-only video adapters keep using url even when structured data URL exists", async () => {
  let capturedBody: Record<string, unknown> | undefined;
  globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    capturedBody = JSON.parse(String(init?.body));
    return new Response(JSON.stringify({ task_id: "mini-task-1", status: "processing" }), { status: 200 });
  }) as typeof fetch;

  const adapter = new MiniMaxVideoProviderAdapter();
  const state = await adapter.createJob(videoAdapterInput({
    references: {
      mode: "single",
      image: {
        assetId: "asset-frame",
        url: "https://cdn.test/frame.png",
        dataUrl: "data:image/jpeg;base64,frame",
        mimeType: "image/png",
        dataUrlMimeType: "image/jpeg",
        dataUrlSizeInBytes: 128,
      },
      imageUrl: "https://cdn.test/frame.png",
      referenceImages: [],
      referenceImageUrls: [],
    },
  }));

  const body = capturedBody as { content: Array<{ image_url?: { url: string } }> };
  assert.equal(body.content[1].image_url?.url, "https://cdn.test/frame.png");
  assert.equal(JSON.stringify(state.parameters).includes("data:image/"), false);
});

test("volcengine video adapter sends first and last frame roles", async () => {
  let capturedBody: Record<string, unknown> | undefined;
  globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    capturedBody = JSON.parse(String(init?.body));
    return new Response(JSON.stringify({ id: "volc-task-1", status: "queued" }), { status: 200 });
  }) as typeof fetch;

  const adapter = new VolcEngineVideoProviderAdapter();
  await adapter.createJob(videoAdapterInput({
    config: { provider: "volcengine", apiKey: "key", baseUrl: "https://volc.test", model: "seedance" },
    references: {
      mode: "first_last",
      firstFrame: {
        assetId: "asset-first",
        url: "https://cdn.test/first.png",
        mimeType: "image/png",
      },
      lastFrame: {
        assetId: "asset-last",
        url: "https://cdn.test/last.png",
        mimeType: "image/png",
      },
      firstFrameUrl: "https://cdn.test/first.png",
      lastFrameUrl: "https://cdn.test/last.png",
      referenceImages: [],
      referenceImageUrls: [],
    },
  }));

  const body = capturedBody as { content: Array<{ role?: string; image_url?: { url: string } }> };
  assert.equal(body.content[1].role, "first_frame");
  assert.equal(body.content[2].role, "last_frame");
});

test("vidu video adapter returns running note when poll is unavailable", async () => {
  const adapter = new ViduVideoProviderAdapter();
  const state = await adapter.pollJob!("vidu-task-1", videoAdapterInput({
    config: { provider: "vidu", apiKey: "key", baseUrl: "https://vidu.test", model: "viduq3-turbo" },
  }));

  assert.equal(state.providerStatus, "running");
  assert.match(state.note ?? "", /webhook is not enabled/);
});

test("ali video adapter maps last frame to last_img_url", async () => {
  let capturedBody: Record<string, unknown> | undefined;
  globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    capturedBody = JSON.parse(String(init?.body));
    return new Response(JSON.stringify({ output: { task_status: "PENDING", task_id: "ali-task-1" } }), { status: 200 });
  }) as typeof fetch;

  const adapter = new AliVideoProviderAdapter();
  await adapter.createJob(videoAdapterInput({
    config: { provider: "ali", apiKey: "key", baseUrl: "https://dashscope.test", model: "wan2.6-i2v-flash" },
    references: {
      mode: "first_last",
      firstFrame: {
        assetId: "asset-first",
        url: "https://cdn.test/first.png",
        mimeType: "image/png",
      },
      lastFrame: {
        assetId: "asset-last",
        url: "https://cdn.test/last.png",
        mimeType: "image/png",
      },
      firstFrameUrl: "https://cdn.test/first.png",
      lastFrameUrl: "https://cdn.test/last.png",
      referenceImages: [],
      referenceImageUrls: [],
    },
  }));

  const body = capturedBody as {
    input: { img_url?: string; last_img_url?: string; resolution?: string };
    parameters?: { resolution?: string; duration?: number };
  };
  assert.equal(body.input.img_url, "https://cdn.test/first.png");
  assert.equal(body.input.last_img_url, "https://cdn.test/last.png");
  assert.equal(body.input.resolution, undefined);
  assert.equal(body.parameters?.resolution, "1080P");
  assert.equal(body.parameters?.duration, 5);
});

// =============================================
// OpenAI 视频 Provider 参考图 URL 字段测试
// =============================================

test("media provider sends data URL references but redacts stored parameters", async () => {
  let capturedBody: Record<string, unknown> | undefined;
  globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    capturedBody = JSON.parse(String(init?.body));
    return new Response(JSON.stringify({
      id: "video-job-1",
      status: "queued",
    }), { status: 200 });
  }) as typeof fetch;

  const provider = new OpenAiMediaProvider();
  const state = await provider.createVideoJob({
    shotId: "shot-1",
    style: "cinematic",
    aspectRatio: "16:9",
    durationSeconds: 5,
    prompt: "A clean camera move",
    videoReferenceMode: "single",
    referenceImageUrl: "data:image/jpeg;base64,current",
  } as never, {
    provider: "openai-completions",
    apiKey: "key",
    baseUrl: "https://openai.test",
    model: "sora-2",
  });

  assert.equal(capturedBody?.image_url, "data:image/jpeg;base64,current");
  assert.equal(state.parameters.referenceImageUrl, "[data-url omitted]");
});

// =============================================
// Grok 视频 Provider 参考图 URL 字段测试
// =============================================

test("grok video provider sends data URL references but redacts stored parameters", async () => {
  let capturedBody: Record<string, unknown> | undefined;
  let fetchCount = 0;
  globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    fetchCount++;
    if (fetchCount === 1) {
      capturedBody = JSON.parse(String(init?.body));
      return new Response(JSON.stringify({
        choices: [
          {
            message: {
              content: '<video><source src="https://cdn.test/video.mp4" type="video/mp4"></video>',
            },
          },
        ],
      }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    return new Response(new Uint8Array([1, 2, 3, 4]), { status: 200 });
  }) as typeof fetch;

  const provider = new GrokMediaProvider();
  const generated = await provider.generateVideo({
    shotId: "shot-1",
    style: "cinematic",
    aspectRatio: "16:9",
    durationSeconds: 5,
    prompt: "A clean camera move",
    videoReferenceMode: "multiple",
    referenceImageUrls: [
      "data:image/jpeg;base64,ref-1",
      "https://cdn.test/ref-2.png",
    ],
  } as never, {
    provider: "openai-completions",
    apiKey: "key",
    baseUrl: "https://grok.test",
    model: "grok-imagine-1.0-video",
  });

  const messages = capturedBody?.messages as Array<{ content: Array<Record<string, unknown>> }>;
  const imageUrls = messages[0].content
    .filter((part) => part.type === "image_url")
    .map((part) => ((part.image_url as Record<string, unknown>).url));

  assert.deepEqual(imageUrls, [
    "data:image/jpeg;base64,ref-1",
    "https://cdn.test/ref-2.png",
  ]);
  assert.deepEqual(generated.parameters.referenceImageUrls, [
    "[data-url omitted]",
    "https://cdn.test/ref-2.png",
  ]);
});

// =============================================
// JobsService OpenAI 视频路径参考图字段测试
// =============================================

test("jobs service passes compressed first_last data URLs to openai video provider", async () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const service = Object.create(JobsService.prototype) as any;
  const source = await sharp({
    create: {
      width: 32,
      height: 32,
      channels: 3,
      background: "#224466",
    },
  }).png().toBuffer();
  let capturedInput: Record<string, unknown> | undefined;

  service.database = {
    query: async (reader: (db: { jobs: Array<{ id: string; result?: unknown }> }) => unknown) =>
      reader({ jobs: [{ id: "job-openai-video" }] }),
  };
  service.storageService = {
    getAssetUrl: async (_userId: string, assetId: string) => ({
      asset: {
        id: assetId,
        mimeType: "image/png",
        sizeInBytes: source.byteLength,
      },
      url: `https://cdn.test/${assetId}.png`,
    }),
    getAssetBuffer: async (_userId: string, assetId: string) => ({
      asset: {
        id: assetId,
        mimeType: "image/png",
        sizeInBytes: source.byteLength,
      },
      body: source,
      mimeType: "image/png",
    }),
  };
  service.mediaProvider = {
    createVideoJob: async (input: Record<string, unknown>) => {
      capturedInput = input;
      return {
        prompt: input.prompt,
        provider: "openai-video",
        providerVideoId: "provider-video-1",
        providerStatus: "queued",
        progress: 10,
        parameters: input,
        mimeType: "video/mp4",
      };
    },
  };
  service.updateVideoJobProgress = async (_jobId: string, _state: unknown) => ({} as Record<string, unknown>);

  const job = {
    id: "job-openai-video",
    type: "video_generation",
    status: "queued",
    projectId: "project-1",
    shotId: "shot-1",
    createdBy: "user-1",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    progress: 0,
    input: {
      projectId: "project-1",
      shotId: "shot-1",
      style: "cinematic",
      aspectRatio: "16:9",
      durationSeconds: 5,
      videoReferenceMode: "first_last",
      firstFrameAssetId: "asset-first",
      lastFrameAssetId: "asset-last",
    },
  };

  await (service as unknown as {
    processVideoJobOpenAi: (
      job: unknown,
      prompt: string,
      config: { provider: string; apiKey: string; baseUrl: string; model: string },
      providerKey?: "legacy-openai" | "openai-compatible",
    ) => Promise<unknown>;
  }).processVideoJobOpenAi(job, "A clean camera move", {
    provider: "openai-completions",
    apiKey: "key",
    baseUrl: "https://openai.test",
    model: "sora-2",
  }, "openai-compatible");

  assert.equal(capturedInput?.videoReferenceMode, "first_last");
  assert.match(String(capturedInput?.firstFrameUrl), /^data:image\/jpeg;base64,/);
  assert.match(String(capturedInput?.lastFrameUrl), /^data:image\/jpeg;base64,/);
});

// =============================================
// Prompt Contract Core 和 Renderer 测试
// =============================================

test("prompt renderer emits stable tagged sections", () => {
  const rendered = renderPromptSections({
    task: "Generate a script.",
    rules: ["Return JSON only.", "Use Chinese dialogue."],
    projectContext: "World bible context.",
    sourceContent: "Source synopsis.",
    outputSchema: "{ logline, premise, characters, scenes }",
    qualityBar: ["Scenes must be playable.", "Characters must stay consistent."],
  });

  assert.ok(rendered.includes("<task>\nGenerate a script.\n</task>"));
  assert.ok(rendered.includes("<rules>\n- Return JSON only.\n- Use Chinese dialogue.\n</rules>"));
  assert.ok(rendered.includes("<project_context>\nWorld bible context.\n</project_context>"));
  assert.ok(rendered.includes("<source_content>\nSource synopsis.\n</source_content>"));
  assert.ok(rendered.includes("<output_schema>\n{ logline, premise, characters, scenes }\n</output_schema>"));
  assert.ok(rendered.includes("<quality_bar>\n- Scenes must be playable.\n- Characters must stay consistent.\n</quality_bar>"));
});

test("prompt snapshot records contract version and rendered prompts", () => {
  const snapshot = createPromptSnapshot({
    contractId: "script.generation.v1",
    contractVersion: "1.0.0",
    provider: "openai-completions",
    model: "gpt-4.1-mini",
    renderedSystemPrompt: "system",
    renderedUserPrompt: "user",
    inputSummary: summarizePromptInput({ title: "Pilot", premise: "A secret" }),
    schemaVersion: "script.v1",
    outputValidation: { ok: true, errors: [] },
  });

  assert.equal(snapshot.contractId, "script.generation.v1");
  assert.equal(snapshot.contractVersion, "1.0.0");
  assert.equal(snapshot.model, "gpt-4.1-mini");
  assert.equal(snapshot.outputValidation?.ok, true);
});

test("prompt contract render returns metadata with id and version", () => {
  const contract: PromptContract<{ title: string }, { title: string }> = {
    id: "unit.test.v1",
    version: "1.0.0",
    task: "Unit test",
    outputKind: "json",
    render: (input) => ({
      system: "system",
      user: renderPromptSections({ task: `Title: ${input.title}` }),
      metadata: {
        contractId: "unit.test.v1",
        contractVersion: "1.0.0",
        inputSummary: summarizePromptInput(input),
      },
    }),
  };

  const rendered = contract.render({ title: "Pilot" });
  assert.equal(rendered.metadata.contractId, "unit.test.v1");
  assert.equal(rendered.metadata.contractVersion, "1.0.0");
  assert.ok(rendered.user.includes("Pilot"));
});

// =============================================
// 结构化输出校验、JSON 提取与修复提示词测试
// =============================================

test("structured output validator reports missing required fields and invalid enums", () => {
  const schema = {
    id: "storyboard.v1",
    type: "object" as const,
    required: ["overview", "shots"],
    properties: {
      overview: { id: "overview", type: "string" as const },
      shots: {
        id: "shots",
        type: "array" as const,
        items: {
          id: "shot",
          type: "object" as const,
          required: ["framing"],
          properties: {
            framing: { id: "framing", type: "string" as const, enum: ["CU", "MS", "LS"] },
          },
        },
      },
    },
  };

  const result = validatePromptSchema({ shots: [{ framing: "BAD" }] }, schema);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((error) => error.includes("overview")));
  assert.ok(result.errors.some((error) => error.includes("framing")));
});

test("structured output helper extracts JSON from fenced model output", () => {
  const parsed = extractJsonObject<{ ok: boolean }>("```json\n{\"ok\":true}\n```");
  assert.deepEqual(parsed, { ok: true });
});

test("json repair prompt asks only to repair the existing payload", () => {
  const prompt = buildJsonRepairPrompt({
    schemaName: "script.v1",
    schemaText: "{ logline: string }",
    rawOutput: "{ bad json",
    errors: ["Invalid JSON"],
  });

  assert.ok(prompt.includes("Repair the JSON only."));
  assert.ok(prompt.includes("Do not rewrite, expand, summarize, or invent story content."));
  assert.ok(prompt.includes("Invalid JSON"));
  assert.ok(prompt.includes("{ bad json"));
});

// =============================================
// 脚本与分镜提示词契约测试
// =============================================

test("script prompt contract renders tagged context and schema", () => {
  const rendered = SCRIPT_GENERATION_CONTRACT.render({
    title: "Edge of Dawn",
    genre: "Urban suspense",
    premise: "A producer finds a hidden threat.",
    episodeGoal: "Expose the conspiracy.",
    tone: "tense",
    audience: "young urban viewers",
    worldBibleContext: "Character: Lin, precise and exhausted.",
  });

  assert.equal(rendered.metadata.contractId, "script.generation.v1");
  assert.equal(SCRIPT_GENERATION_CONTRACT.schema?.id, "script.v1");
  assert.ok(rendered.user.includes("<task>"));
  assert.ok(rendered.user.includes("<project_context>"));
  assert.ok(rendered.user.includes("<output_schema>"));
  assert.ok(rendered.user.includes("logline"));
});

test("storyboard prompt contract includes scene rules and normalized enums", () => {
  const rendered = STORYBOARD_GENERATION_CONTRACT.render({
    cinematicStyle: "noir neon realism",
    shotDensity: "dense",
    script: {
      logline: "A secret breaks a team.",
      premise: "A tense short drama.",
      characters: [{ name: "Lin", profile: "detective" }],
      scenes: [
        {
          id: "scene-1",
          heading: "INT. OFFICE - NIGHT",
          synopsis: "Lin finds a clue.",
          characters: ["Lin"],
          dialogue: [],
          directorNote: "quiet",
        },
      ],
    },
    worldBibleContext: "Character id char-lin belongs to Lin.",
  });

  assert.equal(rendered.metadata.contractId, "storyboard.generation.v1");
  assert.equal(STORYBOARD_GENERATION_CONTRACT.schema?.id, "storyboard.v1");
  assert.ok(rendered.user.includes("Multiple shots in the same scene MUST share the same sceneId."));
  assert.ok(rendered.user.includes("CU"));
  assert.ok(rendered.user.includes("dolly-in"));
});