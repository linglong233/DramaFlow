/**
 * @fileoverview 图片生成配置工具
 * @module web/lib
 *
 * 图片生成 Provider 的配置解析和表单辅助。
 */

import type { ImageGenerationConfig, ImageGenerationProvider } from "@dramaflow/shared";

type ImageConfigSource = Partial<Pick<ImageGenerationConfig, "provider" | "apiKey" | "baseUrl" | "model">> & {
  hasApiKey?: boolean;
};

export interface ImageGenerationConfigDraft {
  provider: ImageGenerationProvider;
  apiKey: string;
  baseUrl: string;
  model: string;
}

function normalizeText(value: string) {
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

export function toImageGenerationConfigDraft(config?: ImageConfigSource): ImageGenerationConfigDraft {
  const defaultModel = config?.provider === "google-gemini"
    ? "gemini-3.1-flash-image-preview"
    : "";

  return {
    provider: config?.provider ?? "google-gemini",
    apiKey: config?.apiKey ?? "",
    baseUrl: config?.baseUrl ?? "",
    model: config?.model ?? defaultModel,
  };
}

export function buildImageGenerationConfigPayload(
  draft: ImageGenerationConfigDraft,
): ImageGenerationConfig | undefined {
  const apiKey = normalizeText(draft.apiKey);
  const baseUrl = draft.provider === "openai-compatible"
    ? normalizeText(draft.baseUrl)
    : undefined;
  const model = normalizeText(draft.model);

  const normalized: ImageGenerationConfig = {
    provider: draft.provider,
    ...(apiKey ? { apiKey } : {}),
    ...(baseUrl ? { baseUrl } : {}),
    ...(model ? { model } : {}),
  };

  if (!normalized.apiKey && !normalized.baseUrl && !normalized.model) {
    return undefined;
  }

  return normalized;
}
