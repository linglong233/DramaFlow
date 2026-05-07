"use client";

import { useQuery } from "@tanstack/react-query";
import type { TaskListResponse } from "@dramaflow/shared";
import { apiFetch } from "../api";
import { queryKeys } from "../query-keys";

interface UseActiveJobsOptions {
  projectId: string | null;
  enabled?: boolean;
  limit?: number;
  pollWhenActive?: boolean;
  pollInterval?: number;
}

export function useActiveJobs({
  projectId,
  enabled = true,
  limit = 100,
  pollWhenActive = false,
  pollInterval = 5000,
}: UseActiveJobsOptions) {
  return useQuery({
    queryKey: projectId ? queryKeys.projectJobs(projectId) : ["no-project"],
    queryFn: () => apiFetch<TaskListResponse>(`/projects/${projectId}/jobs?limit=${limit}`),
    enabled: !!projectId && enabled,
    refetchInterval: pollWhenActive
      ? (query) => {
          const data = query.state.data;
          if (!data) return false;
          const hasActive = data.jobs.some((j) => j.status === "queued" || j.status === "running");
          return hasActive ? pollInterval : false;
        }
      : undefined,
  });
}
