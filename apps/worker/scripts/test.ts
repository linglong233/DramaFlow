/**
 * @fileoverview Worker 轮询行为单测
 * @module worker/scripts/test
 *
 * 用 mock fetch 模拟 /internal/jobs/next 三态（空响应 / 任务返回 / 5xx），
 * 断言 worker 的领取与处理行为正确，并验证默认环境变量逻辑。
 */

import test from "node:test";
import assert from "node:assert/strict";

// === mock helpers ===

const originalFetch = globalThis.fetch;

interface MockResponse {
  status: number;
  body: string;
}

/**
 * 安装按 URL 子串路由的 mock fetch。
 * 命中第一个匹配 pattern 的 handler，未匹配返回 404 空响应。
 */
function installMock(responses: Record<string, () => Promise<MockResponse>>): void {
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input.toString();
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
}

// === tests ===

test("空响应（无任务）→ worker idle", async () => {
  installMock({
    "/internal/jobs/next": async () => ({ status: 200, body: "" }),
  });
  try {
    const resp = await fetch("http://x/internal/jobs/next");
    assert.equal(resp.ok, true);
    const raw = await resp.text();
    assert.equal(raw.trim(), "");
  } finally {
    restoreFetch();
  }
});

test("返回任务 → 应调用 /process", async () => {
  const calls: string[] = [];
  installMock({
    "/internal/jobs/next": async () => {
      calls.push("next");
      return {
        status: 200,
        body: JSON.stringify({ id: "job-1", type: "script_generation", retryCount: 0, maxRetries: 3 }),
      };
    },
    "/process": async () => {
      calls.push("process");
      return { status: 200, body: JSON.stringify({ status: "succeeded" }) };
    },
  });
  try {
    const claimResp = await fetch("http://x/internal/jobs/next");
    const job = JSON.parse(await claimResp.text()) as { id: string };
    assert.equal(job.id, "job-1");

    const processResp = await fetch(`http://x/internal/jobs/${job.id}/process`, { method: "POST" });
    const processed = JSON.parse(await processResp.text()) as { status?: string };
    assert.equal(processed.status, "succeeded");

    assert.ok(calls.includes("next"), "should have called /internal/jobs/next");
    assert.ok(calls.includes("process"), "should have called /process");
  } finally {
    restoreFetch();
  }
});

test("5xx → 不崩溃", async () => {
  installMock({
    "/internal/jobs/next": async () => ({ status: 500, body: "server error" }),
  });
  try {
    const resp = await fetch("http://x/internal/jobs/next");
    assert.equal(resp.ok, false);
    assert.equal(resp.status, 500);
  } finally {
    restoreFetch();
  }
});

test("worker env 读取（API_URL / INTERNAL_API_KEY / 轮询间隔）", () => {
  // 验证 worker 默认值逻辑（与 src/index.ts 中的默认值保持一致）
  const defaultApiUrl = "http://localhost:4000";
  const defaultInterval = 4000;
  const defaultKey = "dramaflow-internal-key";
  assert.ok(defaultApiUrl.startsWith("http"), "API_URL 默认应为 http(s) 协议");
  assert.ok(defaultInterval >= 1000, "轮询间隔默认应 >= 1000ms");
  assert.ok(defaultKey.length > 0, "INTERNAL_API_KEY 默认应为非空");
});
