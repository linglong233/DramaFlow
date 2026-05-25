/**
 * @fileoverview Provider 单元测试
 * @module api/jobs
 *
 * 验证各 AI Provider 的基本功能和接口实现。
 */

import test from "node:test";
import assert from "node:assert/strict";

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
      firstFrameUrl: "https://cdn.test/first.png",
      lastFrameUrl: "https://cdn.test/last.png",
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
      imageUrl: "https://cdn.test/frame.png",
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
      firstFrameUrl: "https://cdn.test/first.png",
      lastFrameUrl: "https://cdn.test/last.png",
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
      firstFrameUrl: "https://cdn.test/first.png",
      lastFrameUrl: "https://cdn.test/last.png",
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

test("media provider sends normalized video reference urls", async () => {
  let capturedBody: Record<string, unknown> | undefined;
  globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    capturedBody = JSON.parse(String(init?.body));
    return new Response(JSON.stringify({
      id: "video-job-1",
      status: "queued",
    }), { status: 200 });
  }) as typeof fetch;

  const provider = new OpenAiMediaProvider();
  await provider.createVideoJob({
    shotId: "shot-1",
    style: "cinematic",
    aspectRatio: "16:9",
    durationSeconds: 5,
    prompt: "A clean camera move",
    videoReferenceMode: "first_last",
    firstFrameUrl: "https://cdn.test/first.png",
    lastFrameUrl: "https://cdn.test/last.png",
    referenceImageUrls: ["https://cdn.test/ref.png"],
  } as never, {
    provider: "openai-completions",
    apiKey: "key",
    baseUrl: "https://openai.test",
    model: "sora-2",
  });

  assert.equal(capturedBody?.reference_mode, "first_last");
  assert.equal(capturedBody?.first_frame_url, "https://cdn.test/first.png");
  assert.equal(capturedBody?.last_frame_url, "https://cdn.test/last.png");
  assert.deepEqual(capturedBody?.reference_image_urls, ["https://cdn.test/ref.png"]);
});

// =============================================
// Grok 视频 Provider 参考图 URL 字段测试
// =============================================

test("grok video provider sends normalized video reference images", async () => {
  let capturedBody: Record<string, unknown> | undefined;
  let fetchCount = 0;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
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
    // Second fetch: video download
    return new Response(new Uint8Array([1, 2, 3, 4]), { status: 200 });
  }) as typeof fetch;

  const provider = new GrokMediaProvider();
  await provider.generateVideo({
    shotId: "shot-1",
    style: "cinematic",
    aspectRatio: "16:9",
    durationSeconds: 5,
    prompt: "A clean camera move",
    videoReferenceMode: "multiple",
    firstFrameUrl: "https://cdn.test/first.png",
    lastFrameUrl: "https://cdn.test/last.png",
    referenceImageUrls: [
      "https://cdn.test/ref-1.png",
      "https://cdn.test/ref-2.png",
    ],
  } as never, {
    provider: "openai-completions",
    apiKey: "key",
    baseUrl: "https://grok.test",
    model: "grok-imagine-1.0-video",
  });

  const messages = capturedBody?.messages as Array<{ content: Array<Record<string, unknown>> }>;
  const content = messages[0].content;
  const imageUrls = content
    .filter((part) => part.type === "image_url")
    .map((part) => ((part.image_url as Record<string, unknown>).url));

  assert.deepEqual(imageUrls, [
    "https://cdn.test/first.png",
    "https://cdn.test/last.png",
    "https://cdn.test/ref-1.png",
    "https://cdn.test/ref-2.png",
  ]);
});

// =============================================
// JobsService OpenAI 视频路径参考图字段测试
// =============================================

test("jobs service passes resolved first_last references to openai video provider", async () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const service = Object.create(JobsService.prototype) as any;
  let capturedInput: Record<string, unknown> | undefined;

  service.database = {
    query: async (reader: (db: { jobs: Array<{ id: string; result?: unknown }> }) => unknown) =>
      reader({ jobs: [{ id: "job-openai-video" }] }),
  };
  service.storageService = {
    getAssetUrl: async (_userId: string, assetId: string) => ({
      url: `https://cdn.test/${assetId}.png`,
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
    ) => Promise<unknown>;
  }).processVideoJobOpenAi(job, "A clean camera move", {
    provider: "openai-completions",
    apiKey: "key",
    baseUrl: "https://openai.test",
    model: "sora-2",
  });

  assert.equal(capturedInput?.videoReferenceMode, "first_last");
  assert.equal(capturedInput?.firstFrameUrl, "https://cdn.test/asset-first.png");
  assert.equal(capturedInput?.lastFrameUrl, "https://cdn.test/asset-last.png");
});