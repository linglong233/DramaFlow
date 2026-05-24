/**
 * @fileoverview MiniMax 视频 Provider 适配器（占位）
 * @module api/jobs/video-providers
 */

import type { VideoProviderAdapter, VideoProviderCreateInput, VideoProviderJobState } from "./types";

export class MiniMaxVideoProviderAdapter implements VideoProviderAdapter {
  readonly provider = "minimax" as const;

  async createJob(_input: VideoProviderCreateInput): Promise<VideoProviderJobState> {
    throw new Error("MiniMax video adapter createJob is not implemented");
  }
}
