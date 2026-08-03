"use client";

import { useQuery } from "@tanstack/react-query";

import type { ProviderHealth } from "@dramaflow/shared";

import { apiFetch } from "../api";

/** 拉 /health/providers，缓存 60s */
export function useProviderHealth() {
  return useQuery({
    queryKey: ["provider-health"],
    queryFn: () => apiFetch<ProviderHealth>("/health/providers"),
    staleTime: 60_000,
    retry: 1,
  });
}
