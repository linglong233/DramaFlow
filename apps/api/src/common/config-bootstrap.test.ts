/**
 * @fileoverview provider 配置校验单测
 * @module api/common/config-bootstrap.test
 */

import test from "node:test";
import assert from "node:assert/strict";

import { validateProviderConfig, type ProviderHealth } from "./config-bootstrap";

function env(overrides: Record<string, string | undefined> = {}): NodeJS.ProcessEnv {
  return { ...process.env, NODE_ENV: "test", ...overrides } as NodeJS.ProcessEnv;
}

test("validateProviderConfig: MOCK_FALLBACK=true 时缺 key 不抛错，返回 configured=false", () => {
  const result = validateProviderConfig(env({
    OPENAI_COMPAT_MOCK_FALLBACK: "true",
    OPENAI_COMPAT_API_KEY: "replace-me",
  }));
  const health: ProviderHealth = result.health;
  assert.equal(health.mockFallback, true);
  assert.equal(health.text.configured, false);
  assert.equal(health.image.configured, false);
});

test("validateProviderConfig: MOCK_FALLBACK=false 且 NODE_ENV=test 时跳过 fail-fast", () => {
  // NODE_ENV=test 始终跳过 fail-fast，只返回 health
  const result = validateProviderConfig(env({
    NODE_ENV: "test",
    OPENAI_COMPAT_MOCK_FALLBACK: "false",
    OPENAI_COMPAT_API_KEY: "replace-me",
  }));
  assert.equal(result.health.mockFallback, false);
  assert.equal(result.health.text.configured, false);
});

test("validateProviderConfig: 配了真 key 时 configured=true", () => {
  const result = validateProviderConfig(env({
    OPENAI_COMPAT_MOCK_FALLBACK: "false",
    OPENAI_COMPAT_API_KEY: "sk-real-key",
  }));
  assert.equal(result.health.text.configured, true);
  assert.equal(result.health.image.configured, true); // OpenAI image 共用 key
  assert.equal(result.health.video.configured, true); // OpenAI video (sora) 共用 key
  assert.equal(result.health.tts.configured, true);   // OpenAI tts 共用 key
});

test("validateProviderConfig: 仅配 SD_WEBUI 时 image configured=true 但 text=false", () => {
  const result = validateProviderConfig(env({
    OPENAI_COMPAT_MOCK_FALLBACK: "false",
    OPENAI_COMPAT_API_KEY: "replace-me",
    SD_WEBUI_BASE_URL: "http://localhost:7860",
  }));
  assert.equal(result.health.text.configured, false);
  assert.equal(result.health.image.configured, true);
});
