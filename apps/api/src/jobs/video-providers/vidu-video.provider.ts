/**
 * @fileoverview Vidu 视频 Provider 适配器（占位）
 * @module api/jobs/video-providers
 */

import type { VideoProviderAdapter, VideoProviderCreateInput, VideoProviderJobState } from "./types";

export class ViduVideoProviderAdapter implements VideoProviderAdapter {
  readonly provider = "vidu" as const;

  async createJob(_input: VideoProviderCreateInput): Promise<VideoProviderJobState> {
    throw new Error("Vidu video adapter createJob is not implemented");
  }
}
