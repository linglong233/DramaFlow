/**
 * @fileoverview provider 配置启动校验
 * @module api/common/config-bootstrap
 *
 * 在 NestFactory 之前调用。MOCK_FALLBACK=false 且必填 key 缺失时 fail-fast；
 * NODE_ENV=test 跳过 fail-fast；MOCK_FALLBACK=true 仅警告。
 */

import type { ProviderHealth } from "@dramaflow/shared";

export type { ProviderChannelHealth, ProviderHealth } from "@dramaflow/shared";

export interface ValidationResult {
  health: ProviderHealth;
}

const PLACEHOLDER_VALUES = new Set([undefined, "", "replace-me"]);

function isRealValue(value: string | undefined): boolean {
  return !PLACEHOLDER_VALUES.has(value);
}

/** 计算各路径的配置状态 */
export function resolveProviderHealth(env: NodeJS.ProcessEnv): ProviderHealth {
  const openaiKey = env.OPENAI_COMPAT_API_KEY;
  const googleImageKey = env.GOOGLE_IMAGE_API_KEY;
  const sdBaseUrl = env.SD_WEBUI_BASE_URL;
  const comfyuiBaseUrl = env.COMFYUI_BASE_URL;

  const textConfigured = isRealValue(openaiKey);
  const imageConfigured =
    isRealValue(openaiKey) ||
    isRealValue(googleImageKey) ||
    isRealValue(sdBaseUrl) ||
    isRealValue(comfyuiBaseUrl);
  // 视频与 TTS 当前都走 OpenAI 兼容 key（sora / openai tts）
  const videoConfigured = isRealValue(openaiKey);
  const ttsConfigured = isRealValue(openaiKey);

  const mockFallback = env.OPENAI_COMPAT_MOCK_FALLBACK === "true";

  return {
    text: { configured: textConfigured },
    image: { configured: imageConfigured },
    video: { configured: videoConfigured },
    tts: { configured: ttsConfigured },
    mockFallback,
  };
}

/**
 * 校验 provider 配置。
 * NODE_ENV=test 时永远不抛错（避免破坏集成测试）。
 */
export function validateProviderConfig(env: NodeJS.ProcessEnv): ValidationResult {
  const health = resolveProviderHealth(env);

  if (env.NODE_ENV === "test") {
    return { health };
  }

  if (!health.mockFallback) {
    const missing: string[] = [];
    if (!health.text.configured) missing.push("text (OPENAI_COMPAT_API_KEY)");
    if (!health.image.configured) missing.push("image (OPENAI_COMPAT_API_KEY 或 GOOGLE_IMAGE_API_KEY 或 SD_WEBUI_BASE_URL 或 COMFYUI_BASE_URL)");
    if (!health.video.configured) missing.push("video (OPENAI_COMPAT_API_KEY)");
    if (!health.tts.configured) missing.push("tts (OPENAI_COMPAT_API_KEY)");

    if (missing.length > 0) {
      throw new Error(
        `\n[FATAL] AI providers not configured but OPENAI_COMPAT_MOCK_FALLBACK=false.\n` +
          `Missing: ${missing.join("; ")}\n` +
          `Either set the keys above, or set OPENAI_COMPAT_MOCK_FALLBACK=true to run with mock output.\n`
      );
    }
  } else {
    process.stdout.write(
      "\n⚠️  WARNING: OPENAI_COMPAT_MOCK_FALLBACK=true — AI output will be mock content, not real generation.\n\n"
    );
  }

  return { health };
}
