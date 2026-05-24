/**
 * @fileoverview 视频参考图工具函数
 * @module api/jobs
 *
 * 将原始资产 ID 解析为归一化的参考图结构，供视频 Provider 适配器使用。
 */

import type { GenerateMediaInput, VideoReferenceMode } from "@dramaflow/shared";

/** 解析后的视频参考图结构 */
export interface ResolvedVideoReferences {
  mode: VideoReferenceMode;
  /** single 模式下的参考图 URL */
  imageUrl?: string;
  /** first_last 模式下的首帧 URL */
  firstFrameUrl?: string;
  /** first_last 模式下的尾帧 URL */
  lastFrameUrl?: string;
  /** multiple 模式下的参考图 URL 列表 */
  referenceImageUrls: string[];
}

/** buildResolvedVideoReferences 的选项 */
export interface BuildResolvedVideoReferencesOptions {
  input: GenerateMediaInput;
  /** 将资产 ID 解析为可访问的 URL */
  resolveAssetUrl: (assetId: string, label: string) => Promise<string>;
}

/** multiple 模式下最大参考图数量 */
const MAX_MULTIPLE_REFERENCES = 6;

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
 * 包含模式推断、资产 URL 解析、数量截断等逻辑。
 */
export async function buildResolvedVideoReferences(
  options: BuildResolvedVideoReferencesOptions,
): Promise<ResolvedVideoReferences> {
  const mode = normalizeVideoReferenceMode(options.input);

  if (mode === "none") {
    return { mode, referenceImageUrls: [] };
  }

  if (mode === "single") {
    if (!options.input.referenceImageAssetId) {
      throw new Error("single video reference mode requires referenceImageAssetId");
    }
    return {
      mode,
      imageUrl: await options.resolveAssetUrl(options.input.referenceImageAssetId, "referenceImageAssetId"),
      referenceImageUrls: [],
    };
  }

  if (mode === "first_last") {
    if (!options.input.firstFrameAssetId || !options.input.lastFrameAssetId) {
      throw new Error("first_last video reference mode requires both firstFrameAssetId and lastFrameAssetId");
    }
    return {
      mode,
      firstFrameUrl: await options.resolveAssetUrl(options.input.firstFrameAssetId, "firstFrameAssetId"),
      lastFrameUrl: await options.resolveAssetUrl(options.input.lastFrameAssetId, "lastFrameAssetId"),
      referenceImageUrls: [],
    };
  }

  // mode === "multiple"
  const assetIds = Array.from(new Set(options.input.referenceImageAssetIds ?? [])).slice(0, MAX_MULTIPLE_REFERENCES);
  if (assetIds.length === 0) {
    throw new Error("multiple video reference mode requires at least one referenceImageAssetIds item");
  }
  return {
    mode,
    referenceImageUrls: await Promise.all(
      assetIds.map((assetId, index) => options.resolveAssetUrl(assetId, `referenceImageAssetIds[${index}]`)),
    ),
  };
}
