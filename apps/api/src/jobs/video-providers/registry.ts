/**
 * @fileoverview 视频 Provider 适配器注册表
 * @module api/jobs/video-providers
 *
 * 根据 provider ID 查找对应的视频适配器实例。
 */

import type { VideoGenerationProvider } from "@dramaflow/shared";
import type { VideoProviderAdapter } from "./types";
import { MiniMaxVideoProviderAdapter } from "./minimax-video.provider";
import { VolcEngineVideoProviderAdapter } from "./volcengine-video.provider";
import { ViduVideoProviderAdapter } from "./vidu-video.provider";
import { AliVideoProviderAdapter } from "./ali-video.provider";

const adapters: Record<string, VideoProviderAdapter> = {
  minimax: new MiniMaxVideoProviderAdapter(),
  volcengine: new VolcEngineVideoProviderAdapter(),
  vidu: new ViduVideoProviderAdapter(),
  ali: new AliVideoProviderAdapter(),
};

export function getVideoProviderAdapter(provider: VideoGenerationProvider): VideoProviderAdapter {
  const adapter = adapters[provider];
  if (!adapter) {
    throw new Error(`Unsupported video provider: ${provider}`);
  }
  return adapter;
}
