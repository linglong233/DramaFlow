"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  ImpactIssueDetailResponse,
  ImpactIssueStatus,
  ProjectImpactIssuesResponse,
  VersionImpactSummary,
} from "@dramaflow/shared";
import { apiFetch } from "../api";
import { queryKeys } from "../query-keys";

export function useProjectImpactIssues(projectId: string, status?: ImpactIssueStatus, enabled = true) {
  return useQuery({
    queryKey: queryKeys.projectImpactIssues(projectId, status),
    queryFn: () => apiFetch<ProjectImpactIssuesResponse>(
      `/projects/${projectId}/impact-issues${status ? `?status=${status}` : ""}`,
    ),
    enabled: Boolean(projectId) && enabled,
  });
}

export function useImpactIssue(issueId: string | null) {
  return useQuery({
    queryKey: issueId ? queryKeys.impactIssue(issueId) : ["impact-issue", "none"],
    queryFn: () => apiFetch<ImpactIssueDetailResponse>(`/impact-issues/${issueId}`),
    enabled: Boolean(issueId),
  });
}

export function useVersionImpactSummary(versionId: string | null) {
  return useQuery({
    queryKey: versionId ? queryKeys.versionImpactSummary(versionId) : ["version-impact-summary", "none"],
    queryFn: () => apiFetch<VersionImpactSummary>(`/versions/${versionId}/impact-summary`),
    enabled: Boolean(versionId),
  });
}

export function useImpactMutations(projectId: string) {
  const queryClient = useQueryClient();

  async function invalidateImpact() {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["project-impact-issues", projectId] }),
      queryClient.invalidateQueries({ queryKey: queryKeys.projectVersions(projectId) }),
      queryClient.invalidateQueries({ queryKey: queryKeys.project(projectId) }),
    ]);
  }

  const ignore = useMutation({
    mutationFn: (vars: { issueId: string; reason?: string }) =>
      apiFetch(`/impact-issues/${vars.issueId}/ignore`, { method: "POST", body: { reason: vars.reason } }),
    onSuccess: invalidateImpact,
  });

  const reopen = useMutation({
    mutationFn: (issueId: string) => apiFetch(`/impact-issues/${issueId}/reopen`, { method: "POST" }),
    onSuccess: invalidateImpact,
  });

  const resolve = useMutation({
    mutationFn: (vars: { issueId: string; note?: string }) =>
      apiFetch(`/impact-issues/${vars.issueId}/resolve`, { method: "POST", body: { note: vars.note } }),
    onSuccess: invalidateImpact,
  });

  const createSuggestion = useMutation({
    mutationFn: (vars: { issueId: string; instruction?: string }) =>
      apiFetch(`/impact-issues/${vars.issueId}/suggestions`, { method: "POST", body: { instruction: vars.instruction } }),
    onSuccess: invalidateImpact,
  });

  const acceptSuggestion = useMutation({
    mutationFn: (suggestionId: string) => apiFetch(`/impact-suggestions/${suggestionId}/accept`, { method: "POST" }),
    onSuccess: invalidateImpact,
  });

  const revertAcceptance = useMutation({
    mutationFn: (suggestionId: string) => apiFetch(`/impact-suggestions/${suggestionId}/revert-acceptance`, { method: "POST" }),
    onSuccess: invalidateImpact,
  });

  return { ignore, reopen, resolve, createSuggestion, acceptSuggestion, revertAcceptance };
}
