import type { LlmProviderConfig } from "@dramaflow/shared";

type LlmConfigSource = Partial<Pick<LlmProviderConfig, "provider" | "apiKey" | "baseUrl" | "model" | "stream">> & {
  hasApiKey?: boolean;
};

export interface LlmConfigDraft {
  provider: "openai-completions";
  apiKey: string;
  baseUrl: string;
  model: string;
  stream: boolean;
}

function normalizeText(value: string) {
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

export function toLlmConfigDraft(config?: LlmConfigSource): LlmConfigDraft {
  return {
    provider: (config?.provider as "openai-completions") ?? "openai-completions",
    apiKey: config?.apiKey ?? "",
    baseUrl: config?.baseUrl ?? "",
    model: config?.model ?? "",
    stream: config?.stream ?? false,
  };
}

export function buildLlmConfigPayload(
  draft: LlmConfigDraft,
  current?: LlmConfigSource,
): LlmProviderConfig | undefined {
  const apiKey = normalizeText(draft.apiKey);
  const baseUrl = normalizeText(draft.baseUrl);
  const model = normalizeText(draft.model);
  const normalized: LlmProviderConfig = {
    provider: draft.provider,
    ...(apiKey ? { apiKey } : {}),
    ...(baseUrl ? { baseUrl } : {}),
    ...(model ? { model } : {}),
    ...(draft.stream || current?.stream !== undefined ? { stream: draft.stream } : {}),
  };

  if (!normalized.apiKey && !normalized.baseUrl && !normalized.model && normalized.stream === undefined) {
    return undefined;
  }

  return normalized;
}
