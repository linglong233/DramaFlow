"use client";

import { useQuery } from "@tanstack/react-query";
import type { ProjectWorkspaceSummaryPayload } from "@dramaflow/shared";
import { apiFetch } from "../api";
import { queryKeys } from "../query-keys";

export function useProject(projectId: string) {
  return useQuery({
    queryKey: queryKeys.project(projectId),
    queryFn: () => apiFetch<ProjectWorkspaceSummaryPayload>(`/projects/${projectId}`),
  });
}
