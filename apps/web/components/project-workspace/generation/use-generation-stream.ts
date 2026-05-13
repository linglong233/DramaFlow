/**
 * @fileoverview 共享的 SSE 流式生成 hook
 * @module web/components/project-workspace/generation
 *
 * 封装所有生成类型共用的流式处理逻辑：状态管理、SSE 连接、缓存失效。
 */

"use client";

import { useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";

import { apiStreamFetch } from "../../../lib/api";
import { queryKeys } from "../../../lib/query-keys";

export interface GenerationStreamResult {
  text: string;
  result: Record<string, unknown> | null;
}

export function useGenerationStream(projectId: string) {
  const queryClient = useQueryClient();
  const abortRef = useRef<AbortController | null>(null);
  const [streamingText, setStreamingText] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);

  async function invalidateCaches() {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.project(projectId) }),
      queryClient.invalidateQueries({ queryKey: queryKeys.projectVersions(projectId) }),
      queryClient.invalidateQueries({ queryKey: queryKeys.projectJobs(projectId) }),
    ]);
  }

  async function startStream(
    endpoint: string,
    body: Record<string, unknown>,
  ): Promise<GenerationStreamResult> {
    setStreamingText("");
    setIsStreaming(true);

    const controller = new AbortController();
    abortRef.current = controller;

    let accumulated = "";
    let streamResult: Record<string, unknown> | null = null;

    try {
      for await (const chunk of apiStreamFetch(endpoint, {
        method: "POST",
        signal: controller.signal,
        body,
      })) {
        if (chunk.type === "chunk" && chunk.content) {
          accumulated += chunk.content;
          setStreamingText(accumulated);
        } else if (chunk.type === "done" && chunk.result) {
          streamResult = chunk.result;
        } else if (chunk.type === "error") {
          throw new Error(chunk.error);
        }
      }
    } finally {
      setIsStreaming(false);
      abortRef.current = null;
      setStreamingText("");
      await invalidateCaches();
    }

    return { text: accumulated, result: streamResult };
  }

  function stopStream() {
    abortRef.current?.abort();
    abortRef.current = null;
    setIsStreaming(false);
  }

  return { streamingText, isStreaming, startStream, stopStream };
}
