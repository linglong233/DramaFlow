"use client";

import { useQuery } from "@tanstack/react-query";
import type { ProjectVersionsResponse } from "@dramaflow/shared";
import { apiFetch } from "../api";
import { queryKeys } from "../query-keys";

export function useProjectVersions(projectId: string, enabled: boolean = true) {
  return useQuery({
    queryKey: queryKeys.projectVersions(projectId),
    queryFn: () => apiFetch<ProjectVersionsResponse>(`/projects/${projectId}/versions`),
    enabled,
  });
}
