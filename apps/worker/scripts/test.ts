/**
 * @fileoverview Worker 轮询行为单测
 * @module worker/scripts/test
 *
 * 通过 mock fetch 并真实驱动 worker 的 tick()，验证领取/处理/重试/5xx 退避等行为。
 * 重点：测试驱动源码导出的 tick()，而非重复 fetch 协议形状。
 */

import test from "node:test";
import assert from "node:assert/strict";

import { tick, resolveWorkerConfig, type WorkerConfig } from "../src/index";

// === mock helpers ===

const originalFetch = globalThis.fetch;

interface MockResponse {
  status: number;
  body: string;
}

/** 记录所有 fetch 调用的 URL，用于断言 worker 真实命中的端点。 */
let capturedUrls: string[] = [];

/**
 * 安装按 URL 子串路由的 mock fetch。
 * 命中第一个匹配 pattern 的 handler，未匹配返回 404 空响应。
 */
function installMock(responses: Record<string, () => Promise<MockResponse>>): void {
  capturedUrls = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    capturedUrls.push(url);
    for (const [pattern, handler] of Object.entries(responses)) {
      if (url.includes(pattern)) {
        const { status, body } = await handler();
        return new Response(body, { status });
      }
    }
    return new Response("", { status: 404 });
  }) as typeof fetch;
}

function restoreFetch(): void {
  globalThis.fetch = originalFetch;
  capturedUrls = [];
}

const testConfig: WorkerConfig = {
  apiUrl: "http://test-api",
  pollIntervalMs: 4000,
  headers: { "x-internal-key": "test-key" },
};

// === tests ===

test("tick: 空响应（无任务）→ 只调用 /next，不调用 /process", async () => {
  const calls: string[] = [];
  installMock({
    "/internal/jobs/next": async () => {
      calls.push("next");
      return { status: 200, body: "" };
    },
    "/process": async () => {
      calls.push("process");
      return { status: 200, body: JSON.stringify({ status: "succeeded" }) };
    },
  });
  try {
    await tick(testConfig);
    assert.ok(calls.includes("next"), "应调用 /internal/jobs/next");
    assert.ok(!calls.includes("process"), "空响应时不应调用 /process");
  } finally {
    restoreFetch();
  }
});

test("tick: 返回任务 → 应依次调用 /next 和 /process", async () => {
  installMock({
    "/internal/jobs/next": async () => ({
      status: 200,
      body: JSON.stringify({ id: "job-1", type: "script_generation", retryCount: 0, maxRetries: 3 }),
    }),
    "/process": async () => ({ status: 200, body: JSON.stringify({ status: "succeeded" }) }),
  });
  try {
    await tick(testConfig);
    // 验证调用顺序：next 必须在 process 之前
    const nextIdx = capturedUrls.findIndex((u) => u.includes("/internal/jobs/next"));
    const processIdx = capturedUrls.findIndex((u) => u.includes("/process"));
    assert.notEqual(nextIdx, -1, "应调用 /next");
    assert.notEqual(processIdx, -1, "应调用 /process");
    assert.ok(nextIdx < processIdx, "/next 必须在 /process 之前");
    // process URL 应包含正确的 job id
    assert.ok(capturedUrls[processIdx].includes("/internal/jobs/job-1/process"), "process URL 应含 job id");
  } finally {
    restoreFetch();
  }
});

test("tick: /process 返回 5xx 且 retryCount < maxRetries → 应调用 /retry", async () => {
  installMock({
    "/internal/jobs/next": async () => ({
      status: 200,
      body: JSON.stringify({ id: "job-2", type: "image_generation", retryCount: 1, maxRetries: 3 }),
    }),
    "/process": async () => ({ status: 500, body: "server error" }),
    "/retry": async () => ({ status: 200, body: JSON.stringify({ ok: true }) }),
  });
  try {
    await tick(testConfig);
    const retryIdx = capturedUrls.findIndex((u) => u.includes("/internal/jobs/job-2/retry"));
    assert.notEqual(retryIdx, -1, "5xx 且可重试时应调用 /retry");
  } finally {
    restoreFetch();
  }
});

test("tick: /process 返回 5xx 但 retryCount >= maxRetries → 不调用 /retry", async () => {
  installMock({
    "/internal/jobs/next": async () => ({
      status: 200,
      body: JSON.stringify({ id: "job-3", type: "video_generation", retryCount: 3, maxRetries: 3 }),
    }),
    "/process": async () => ({ status: 500, body: "server error" }),
    "/retry": async () => ({ status: 200, body: JSON.stringify({ ok: true }) }),
  });
  try {
    await tick(testConfig);
    const retryIdx = capturedUrls.findIndex((u) => u.includes("/internal/jobs/job-3/retry"));
    assert.equal(retryIdx, -1, "达到 maxRetries 后不应再调用 /retry");
  } finally {
    restoreFetch();
  }
});

test("tick: /process 返回 status=running → 不重试，正常返回", async () => {
  installMock({
    "/internal/jobs/next": async () => ({
      status: 200,
      body: JSON.stringify({ id: "job-4", type: "video_generation", retryCount: 0, maxRetries: 3 }),
    }),
    "/process": async () => ({ status: 200, body: JSON.stringify({ status: "running", result: { progress: 50 } }) }),
    "/retry": async () => ({ status: 200, body: JSON.stringify({ ok: true }) }),
  });
  try {
    await tick(testConfig);
    const retryIdx = capturedUrls.findIndex((u) => u.includes("/retry"));
    assert.equal(retryIdx, -1, "running 状态不应触发 /retry");
  } finally {
    restoreFetch();
  }
});

test("tick: /next 返回 5xx → 不崩溃，不调用 /process", async () => {
  installMock({
    "/internal/jobs/next": async () => ({ status: 500, body: "server error" }),
    "/process": async () => ({ status: 200, body: JSON.stringify({ status: "succeeded" }) }),
  });
  try {
    // 不应抛错
    await tick(testConfig);
    const processIdx = capturedUrls.findIndex((u) => u.includes("/process"));
    assert.equal(processIdx, -1, "/next 失败时不应调用 /process");
  } finally {
    restoreFetch();
  }
});

test("resolveWorkerConfig: 从 env 正确解析", () => {
  const config = resolveWorkerConfig({
    API_URL: "https://api.example.com/",
    WORKER_POLL_INTERVAL_MS: "2000",
    INTERNAL_API_KEY: "secret-key",
  });
  assert.equal(config.apiUrl, "https://api.example.com"); // 末尾 / 被去掉
  assert.equal(config.pollIntervalMs, 2000);
  assert.equal(config.headers["x-internal-key"], "secret-key");
});

test("resolveWorkerConfig: 应用默认值", () => {
  const config = resolveWorkerConfig({});
  assert.equal(config.apiUrl, "http://localhost:4000");
  assert.equal(config.pollIntervalMs, 4000);
  assert.equal(config.headers["x-internal-key"], "dramaflow-internal-key");
});
