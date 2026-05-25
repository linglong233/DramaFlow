/**
 * @fileoverview Provider 配置工具（图片 & 视频通用）
 * @module web/lib
 *
 * 处理 ProviderEntry 的创建、转换和校验。
 * 同时提供旧 ImageGenerationConfig → 新 ProviderEntry 的迁移辅助。
 */

import type {
  ComfyuiConfig,
  ImageGenerationConfig,
  ImageGenerationProvider,
  ProviderEntry,
  SdWebuiConfig,
  VideoGenerationProvider,
  GrokConfig,
} from "@dramaflow/shared";

// =============================================
// Provider ID 生成
// =============================================

/** 生成唯一 Provider ID */
export function generateProviderId(prefix = "prov"): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

// =============================================
// ProviderEntry 表单 Draft
// =============================================

/** Provider 配置表单状态 */
export interface ProviderEntryDraft {
  id: string;
  provider: ImageGenerationProvider | VideoGenerationProvider;
  name: string;
  apiKey: string;
  baseUrl: string;
  model: string;
  sdConfig: SdWebuiConfig;
  comfyuiConfig: ComfyuiConfig;
  grokConfig: GrokConfig;
}

/** 图片 provider 的默认 model */
export function getDefaultImageProviderModel(provider: ImageGenerationProvider): string {
  switch (provider) {
    case "google-gemini": return "gemini-3.1-flash-image-preview";
    case "grok": return "grok-imagine-1.0";
    default: return "";
  }
}

/** 视频 provider 的默认 model */
export function getDefaultVideoProviderModel(provider: VideoGenerationProvider): string {
  switch (provider) {
    case "grok": return "grok-imagine-1.0-video";
    case "minimax": return "video-01";
    case "volcengine": return "doubao-seedance-1-5-pro-251215";
    case "vidu": return "viduq3-turbo";
    case "ali": return "wan2.6-i2v-flash";
    default: return "";
  }
}

/** 创建空白的图片 Provider 草稿 */
export function createImageProviderDraft(provider?: ImageGenerationProvider): ProviderEntryDraft {
  const p = provider ?? "google-gemini";
  return {
    id: generateProviderId("img"),
    provider: p,
    name: "",
    apiKey: "",
    baseUrl: "",
    model: getDefaultImageProviderModel(p),
    sdConfig: {},
    comfyuiConfig: {},
    grokConfig: {},
  };
}

/** 创建空白的视频 Provider 草稿 */
export function createVideoProviderDraft(provider?: VideoGenerationProvider): ProviderEntryDraft {
  const p = provider ?? "grok";
  return {
    id: generateProviderId("vid"),
    provider: p,
    name: "",
    apiKey: "",
    baseUrl: "",
    model: getDefaultVideoProviderModel(p),
    sdConfig: {},
    comfyuiConfig: {},
    grokConfig: {},
  };
}

/** 从 ProviderEntry 创建草稿（用于编辑已有条目） */
export function toProviderEntryDraft(entry: ProviderEntry): ProviderEntryDraft {
  return {
    id: entry.id,
    provider: entry.provider,
    name: entry.name ?? "",
    apiKey: entry.apiKey ?? "",
    baseUrl: entry.baseUrl ?? "",
    model: entry.model ?? "",
    sdConfig: entry.sdConfig ? { ...entry.sdConfig } : {},
    comfyuiConfig: entry.comfyuiConfig ? { ...entry.comfyuiConfig } : {},
    grokConfig: entry.grokConfig ? { ...entry.grokConfig } : {},
  };
}

/** 将草稿转换为 ProviderEntry（清除空值） */
export function buildProviderEntry(draft: ProviderEntryDraft): ProviderEntry {
  const entry: ProviderEntry = {
    id: draft.id,
    provider: draft.provider,
    ...(draft.name.trim() ? { name: draft.name.trim() } : {}),
    ...(draft.apiKey.trim() ? { apiKey: draft.apiKey.trim() } : {}),
    ...(draft.baseUrl.trim() ? { baseUrl: draft.baseUrl.trim() } : {}),
    ...(draft.model.trim() ? { model: draft.model.trim() } : {}),
  };

  if (draft.provider === "stable-diffusion" && hasNonEmptyValues(draft.sdConfig as Record<string, unknown>)) {
    entry.sdConfig = removeEmptyFields(draft.sdConfig);
  }
  if (draft.provider === "comfyui" && hasNonEmptyValues(draft.comfyuiConfig as Record<string, unknown>)) {
    entry.comfyuiConfig = removeEmptyFields(draft.comfyuiConfig);
  }
  if (draft.provider === "grok" && hasNonEmptyValues(draft.grokConfig as Record<string, unknown>)) {
    entry.grokConfig = removeEmptyFields(draft.grokConfig);
  }

  return entry;
}

// =============================================
// 旧格式迁移
// =============================================

/** 将旧的 ImageGenerationConfig 迁移为图片 + 视频 ProviderEntry */
export function migrateImageGenerationConfig(
  old: ImageGenerationConfig | undefined,
): { imageProviders: ProviderEntry[]; videoProviders: ProviderEntry[]; defaultImageProvider?: string; defaultVideoProvider?: string } {
  if (!old) return { imageProviders: [], videoProviders: [] };

  const imageEntry: ProviderEntry = {
    id: generateProviderId("img"),
    provider: old.provider,
    ...(old.apiKey ? { apiKey: old.apiKey } : {}),
    ...(old.baseUrl ? { baseUrl: old.baseUrl } : {}),
    ...(old.model ? { model: old.model } : {}),
    ...(old.sdConfig ? { sdConfig: old.sdConfig } : {}),
    ...(old.comfyuiConfig ? { comfyuiConfig: old.comfyuiConfig } : {}),
    ...(old.grokConfig ? { grokConfig: old.grokConfig } : {}),
    name: `Default ${old.provider}`,
  };

  const result: ReturnType<typeof migrateImageGenerationConfig> = {
    imageProviders: [imageEntry],
    defaultImageProvider: imageEntry.id,
    videoProviders: [],
  };

  if (old.provider === "grok" && old.grokConfig) {
    const videoEntry: ProviderEntry = {
      id: generateProviderId("vid"),
      provider: "grok",
      name: "Default Grok Video",
      ...(old.apiKey ? { apiKey: old.apiKey } : {}),
      ...(old.baseUrl ? { baseUrl: old.baseUrl } : {}),
      grokConfig: old.grokConfig,
    };
    result.videoProviders = [videoEntry];
    result.defaultVideoProvider = videoEntry.id;
  } else if (old.provider === "openai-compatible") {
    const videoEntry: ProviderEntry = {
      id: generateProviderId("vid"),
      provider: "openai-compatible",
      name: "Default OpenAI Video",
      ...(old.apiKey ? { apiKey: old.apiKey } : {}),
      ...(old.baseUrl ? { baseUrl: old.baseUrl } : {}),
      ...(old.model ? { model: old.model } : {}),
    };
    result.videoProviders = [videoEntry];
    result.defaultVideoProvider = videoEntry.id;
  }

  return result;
}

// =============================================
// 向下兼容：旧 ImageGenerationConfig 草稿工具
// =============================================

type LegacyConfigSource = Partial<Pick<ImageGenerationConfig, "provider" | "apiKey" | "baseUrl" | "model">> & {
  hasApiKey?: boolean;
};

export interface ImageGenerationConfigDraft {
  provider: ImageGenerationProvider;
  apiKey: string;
  baseUrl: string;
  model: string;
}

/** @deprecated 使用 toProviderEntryDraft 替代 */
export function toImageGenerationConfigDraft(config?: LegacyConfigSource): ImageGenerationConfigDraft {
  const defaultModel = config?.provider === "google-gemini"
    ? "gemini-3.1-flash-image-preview"
    : config?.provider === "grok"
    ? "grok-imagine-1.0"
    : "";

  return {
    provider: config?.provider ?? "google-gemini",
    apiKey: config?.apiKey ?? "",
    baseUrl: config?.baseUrl ?? "",
    model: config?.model ?? defaultModel,
  };
}

function normalizeText(value: string) {
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

/** @deprecated 使用 buildProviderEntry 替代 */
export function buildImageGenerationConfigPayload(
  draft: ImageGenerationConfigDraft,
): ImageGenerationConfig | undefined {
  const apiKey = normalizeText(draft.apiKey);
  const baseUrl = draft.provider === "openai-compatible" || draft.provider === "grok"
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

// =============================================
// Provider 显示标签
// =============================================

/** 图片 Provider 显示名称 */
export const IMAGE_PROVIDER_LABELS: Record<ImageGenerationProvider, string> = {
  "google-gemini": "Google Gemini",
  "openai-compatible": "OpenAI Compatible",
  "stable-diffusion": "Stable Diffusion WebUI",
  "comfyui": "ComfyUI",
  "grok": "Grok (grok2api)",
};

/** 视频 Provider 显示名称 */
export const VIDEO_PROVIDER_LABELS: Record<VideoGenerationProvider, string> = {
  "grok": "Grok (grok2api)",
  "openai-compatible": "OpenAI Compatible",
  "minimax": "MiniMax",
  "volcengine": "VolcEngine / Seedance",
  "vidu": "Vidu",
  "ali": "Ali DashScope",
};

// =============================================
// 内部工具
// =============================================

function hasNonEmptyValues(obj: Record<string, unknown>): boolean {
  return Object.values(obj as Record<string, unknown>).some((v) => v !== undefined && v !== null && v !== "");
}

function removeEmptyFields<T>(obj: T): T {
  const result = { ...obj } as Record<string, unknown>;
  for (const key of Object.keys(result)) {
    if (result[key] === undefined || result[key] === null || result[key] === "") {
      delete result[key];
    }
  }
  return result as T;
}
