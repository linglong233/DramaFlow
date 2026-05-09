"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { VersionRecord } from "@dramaflow/shared";
import { apiFetch } from "../api";
import { queryKeys } from "../query-keys";

export function useVersionMutations(projectId: string) {
  const queryClient = useQueryClient();

  async function invalidateWorkspace() {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.project(projectId) }),
      queryClient.invalidateQueries({ queryKey: queryKeys.projectVersions(projectId) }),
    ]);
  }

  const create = useMutation({
    mutationFn: async (payload: { documentId: string; title: string; content: unknown; metadata?: Record<string, unknown> }) => {
      return apiFetch<Pick<VersionRecord, "id" | "versionNumber">>(
        `/documents/${payload.documentId}/versions`,
        { method: "POST", body: { title: payload.title, content: payload.content, metadata: payload.metadata } },
      );
    },
    onSuccess: async () => { await invalidateWorkspace(); },
  });

  const update = useMutation({
    mutationFn: async (payload: { versionId: string; content: unknown }) => {
      return apiFetch<Pick<VersionRecord, "id" | "versionNumber">>(
        `/versions/${payload.versionId}`,
        { method: "PATCH", body: { content: payload.content } },
      );
    },
    onSuccess: async () => { await invalidateWorkspace(); },
  });

  const submit = useMutation({
    mutationFn: (versionId: string) => apiFetch(`/versions/${versionId}/submit`, { method: "POST" }),
    onSuccess: async () => { await invalidateWorkspace(); },
  });

  const approve = useMutation({
    mutationFn: (vars: { versionId: string; comment?: string }) =>
      apiFetch(`/versions/${vars.versionId}/approve`, { method: "POST", body: { comment: vars.comment || undefined } }),
    onSuccess: async () => { await invalidateWorkspace(); },
  });

  const reject = useMutation({
    mutationFn: (vars: { versionId: string; comment?: string }) =>
      apiFetch(`/versions/${vars.versionId}/reject`, { method: "POST", body: { comment: vars.comment || undefined } }),
    onSuccess: async () => { await invalidateWorkspace(); },
  });

  const restore = useMutation({
    mutationFn: (versionId: string) => apiFetch(`/versions/${versionId}/restore`, { method: "POST" }),
    onSuccess: async () => { await invalidateWorkspace(); },
  });

  const adopt = useMutation({
    mutationFn: (versionId: string) => apiFetch(`/versions/${versionId}/adopt`, { method: "POST" }),
    onSuccess: async () => { await invalidateWorkspace(); },
  });

  const advanceToReview = useMutation({
    mutationFn: (vars: { versionId: string; comment?: string }) =>
      apiFetch(`/versions/${vars.versionId}/advance-to-review`, { method: "POST", body: { comment: vars.comment || undefined } }),
    onSuccess: async () => { await invalidateWorkspace(); },
  });

  const deleteVersion = useMutation({
    mutationFn: (versionId: string) => apiFetch(`/versions/${versionId}`, { method: "DELETE" }),
    onSuccess: async () => { await invalidateWorkspace(); },
  });

  return { create, update, submit, approve, reject, restore, adopt, advanceToReview, deleteVersion };
}
