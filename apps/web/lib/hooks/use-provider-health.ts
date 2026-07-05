"use client";

import { useQuery } from "@tanstack/react-query";

import { apiFetch } from "../api";

export interface ProviderChannelHealth {
  configured: boolean;
}

export interface ProviderHealth {
  text: ProviderChannelHealth;
  image: ProviderChannelHealth;
  video: ProviderChannelHealth;
  tts: ProviderChannelHealth;
  mockFallback: boolean;
}

/** 拉 /health/providers，缓存 60s */
export function useProviderHealth() {
  return useQuery({
    queryKey: ["provider-health"],
    queryFn: () => apiFetch<ProviderHealth>("/health/providers"),
    staleTime: 60_000,
    retry: 1,
  });
}
