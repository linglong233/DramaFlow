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
  return {
    provider: config?.provider ?? "google-gemini",
    apiKey: config?.apiKey ?? "",
    baseUrl: config?.baseUrl ?? "",
    model: config?.model ?? (config?.provider === "openai-compatible" ? "" : "gemini-3.1-flash-image-preview"),
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