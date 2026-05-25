/**
 * @fileoverview 视频参考图工具函数
 * @module api/jobs
 *
 * 将原始资产 ID 解析为归一化的参考图结构，供视频 Provider 适配器使用。
 * 支持 URL 和 Data URL 两种传输方式，按 Provider 类型自动选择。
 */

import type { GenerateMediaInput, VideoGenerationProvider, VideoReferenceMode } from "@dramaflow/shared";

export type VideoReferenceTransport = "url" | "data-url";
export type VideoReferenceProviderKey = VideoGenerationProvider | "legacy-openai";

/** 解析后的视频参考图资产对象 */
export interface ResolvedVideoReferenceImage {
  assetId: string;
  url: string;
  dataUrl?: string;
  mimeType: string;
  sizeInBytes?: number;
  dataUrlMimeType?: string;
  dataUrlSizeInBytes?: number;
}

/** 解析后的视频参考图结构 */
export interface ResolvedVideoReferences {
  mode: VideoReferenceMode;
  image?: ResolvedVideoReferenceImage;
  firstFrame?: ResolvedVideoReferenceImage;
  lastFrame?: ResolvedVideoReferenceImage;
  referenceImages: ResolvedVideoReferenceImage[];
  imageUrl?: string;
  firstFrameUrl?: string;
  lastFrameUrl?: string;
  referenceImageUrls: string[];
}

/** buildResolvedVideoReferences 的选项 */
export interface BuildResolvedVideoReferencesOptions {
  input: GenerateMediaInput;
  /** 将资产 ID 解析为结构化的参考图对象 */
  resolveAsset: (assetId: string, label: string) => Promise<ResolvedVideoReferenceImage>;
}

export interface ResolvedVideoReferenceInputFields {
  videoReferenceMode: VideoReferenceMode;
  referenceImageUrl?: string;
  firstFrameUrl?: string;
  lastFrameUrl?: string;
  referenceImageUrls?: string[];
}

export interface BatchVideoReferenceInput {
  videoReferenceMode: VideoReferenceMode;
  referenceImageAssetId?: string;
}

/** multiple 模式下最大参考图数量 */
const MAX_MULTIPLE_REFERENCES = 6;

/** 各视频 Provider 的默认传输方式 */
const VIDEO_REFERENCE_TRANSPORT_BY_PROVIDER: Record<VideoReferenceProviderKey, VideoReferenceTransport> = {
  grok: "data-url",
  "openai-compatible": "data-url",
  "legacy-openai": "data-url",
  minimax: "url",
  volcengine: "url",
  vidu: "url",
  ali: "url",
};

/** 获取指定视频 Provider 的参考图传输方式 */
export function getVideoReferenceTransport(provider: VideoReferenceProviderKey): VideoReferenceTransport {
  return VIDEO_REFERENCE_TRANSPORT_BY_PROVIDER[provider];
}

/**
 * 根据 input 中已有的字段推断 videoReferenceMode。
 * 优先使用显式指定的 mode，否则按字段存在情况自动推断。
 */
export function normalizeVideoReferenceMode(
  input: Pick<GenerateMediaInput, "videoReferenceMode" | "referenceImageAssetId" | "firstFrameAssetId" | "lastFrameAssetId" | "referenceImageAssetIds">,
): VideoReferenceMode {
  if (input.videoReferenceMode) return input.videoReferenceMode;
  if (input.referenceImageAssetId) return "single";
  if (input.firstFrameAssetId || input.lastFrameAssetId) return "first_last";
  if (input.referenceImageAssetIds?.length) return "multiple";
  return "none";
}

/**
 * 将 GenerateMediaInput 中的资产 ID 解析为完整的视频参考图结构。
 * 包含模式推断、结构化资产解析、数量截断等逻辑。
 */
export async function buildResolvedVideoReferences(
  options: BuildResolvedVideoReferencesOptions,
): Promise<ResolvedVideoReferences> {
  const mode = normalizeVideoReferenceMode(options.input);

  if (mode === "none") {
    return { mode, referenceImages: [], referenceImageUrls: [] };
  }

  if (mode === "single") {
    if (!options.input.referenceImageAssetId) {
      throw new Error("single video reference mode requires referenceImageAssetId");
    }
    const image = await options.resolveAsset(options.input.referenceImageAssetId, "referenceImageAssetId");
    return {
      mode,
      image,
      referenceImages: [],
      imageUrl: image.url,
      referenceImageUrls: [],
    };
  }

  if (mode === "first_last") {
    if (!options.input.firstFrameAssetId || !options.input.lastFrameAssetId) {
      throw new Error("first_last video reference mode requires both firstFrameAssetId and lastFrameAssetId");
    }
    const firstFrame = await options.resolveAsset(options.input.firstFrameAssetId, "firstFrameAssetId");
    const lastFrame = await options.resolveAsset(options.input.lastFrameAssetId, "lastFrameAssetId");
    return {
      mode,
      firstFrame,
      lastFrame,
      referenceImages: [],
      firstFrameUrl: firstFrame.url,
      lastFrameUrl: lastFrame.url,
      referenceImageUrls: [],
    };
  }

  const assetIds = Array.from(new Set(options.input.referenceImageAssetIds ?? [])).slice(0, MAX_MULTIPLE_REFERENCES);
  if (assetIds.length === 0) {
    throw new Error("multiple video reference mode requires at least one referenceImageAssetIds item");
  }
  const referenceImages = await Promise.all(
    assetIds.map((assetId, index) => options.resolveAsset(assetId, `referenceImageAssetIds[${index}]`)),
  );
  return {
    mode,
    referenceImages,
    referenceImageUrls: referenceImages.map((image) => image.url),
  };
}

export function buildBatchVideoReferenceInput(
  referenceImageAssetId: string | undefined,
  requestedMode: VideoReferenceMode = "single",
): BatchVideoReferenceInput {
  if (requestedMode === "single" && referenceImageAssetId) {
    return {
      videoReferenceMode: "single",
      referenceImageAssetId,
    };
  }

  return {
    videoReferenceMode: "none",
  };
}

/** 根据传输方式选择参考图值（data URL 或普通 URL） */
export function selectVideoReferenceValue(
  image: ResolvedVideoReferenceImage | undefined,
  transport: VideoReferenceTransport,
): string | undefined {
  if (!image) return undefined;
  if (transport === "data-url" && image.dataUrl) return image.dataUrl;
  return image.url;
}

export function toResolvedVideoReferenceInputFields(
  references: ResolvedVideoReferences,
  transport: VideoReferenceTransport = "url",
): ResolvedVideoReferenceInputFields {
  const referenceImageUrl = selectVideoReferenceValue(references.image, transport);
  const firstFrameUrl = selectVideoReferenceValue(references.firstFrame, transport);
  const lastFrameUrl = selectVideoReferenceValue(references.lastFrame, transport);
  const referenceImageUrls = references.referenceImages
    .map((image) => selectVideoReferenceValue(image, transport))
    .filter((url): url is string => Boolean(url));

  return {
    videoReferenceMode: references.mode,
    ...(referenceImageUrl ? { referenceImageUrl } : {}),
    ...(firstFrameUrl ? { firstFrameUrl } : {}),
    ...(lastFrameUrl ? { lastFrameUrl } : {}),
    ...(referenceImageUrls.length ? { referenceImageUrls } : {}),
  };
}

export function applyResolvedVideoReferencesToInput<T extends object>(
  input: T,
  references: ResolvedVideoReferences,
  transport: VideoReferenceTransport = "url",
): T & ResolvedVideoReferenceInputFields {
  return {
    ...input,
    ...toResolvedVideoReferenceInputFields(references, transport),
  };
}

function redactVideoReferenceValue(value: unknown): unknown {
  if (typeof value === "string" && value.startsWith("data:image/")) {
    return "[data-url omitted]";
  }
  if (Array.isArray(value)) {
    return value.map((item) => redactVideoReferenceValue(item));
  }
  return value;
}

export function redactVideoReferenceDataUrls<T extends Record<string, unknown>>(parameters: T): Record<string, unknown> {
  const redacted: Record<string, unknown> = { ...parameters };
  for (const key of ["referenceImageUrl", "firstFrameUrl", "lastFrameUrl", "referenceImageUrls"]) {
    if (Object.prototype.hasOwnProperty.call(redacted, key)) {
      redacted[key] = redactVideoReferenceValue(redacted[key]);
    }
  }
  return redacted;
}
