/**
 * @fileoverview 任务取消 / 重试 mutation
 * @module web/lib/hooks
 *
 * 封装 POST /jobs/:id/cancel 与 /jobs/:id/retry，成功后失效项目任务缓存。
 */

"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";

import { apiFetch } from "../api";
import { queryKeys } from "../query-keys";

export function useJobMutations(projectId?: string) {
  const queryClient = useQueryClient();

  function invalidateJobs() {
    if (!projectId) {
      return;
    }
    void queryClient.invalidateQueries({ queryKey: queryKeys.projectJobs(projectId) });
  }

  const cancel = useMutation({
    mutationFn: (jobId: string) => apiFetch(`/jobs/${jobId}/cancel`, { method: "POST" }),
    onSuccess: () => invalidateJobs(),
  });

  const retry = useMutation({
    mutationFn: (jobId: string) => apiFetch(`/jobs/${jobId}/retry`, { method: "POST" }),
    onSuccess: () => invalidateJobs(),
  });

  return { cancel, retry };
}
