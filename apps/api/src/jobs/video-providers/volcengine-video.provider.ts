/**
 * @fileoverview 火山引擎（VolcEngine）视频 Provider 适配器（占位）
 * @module api/jobs/video-providers
 */

import type { VideoProviderAdapter, VideoProviderCreateInput, VideoProviderJobState } from "./types";

export class VolcEngineVideoProviderAdapter implements VideoProviderAdapter {
  readonly provider = "volcengine" as const;

  async createJob(_input: VideoProviderCreateInput): Promise<VideoProviderJobState> {
    throw new Error("VolcEngine video adapter createJob is not implemented");
  }
}
