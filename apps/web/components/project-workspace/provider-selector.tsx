/**
 * @fileoverview Provider 选择器组件
 * @module web/components/project-workspace
 *
 * 用于生成时选择图片/视频 Provider 的小型下拉组件。
 */

"use client";

import { useEffect, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import type { ImageConfigSource, ProviderEntry } from "@dramaflow/shared";

import { apiFetch } from "../../lib/api";
import { IMAGE_PROVIDER_LABELS, VIDEO_PROVIDER_LABELS } from "../../lib/image-config";

// =============================================
// Hook: 按 configSource 获取 Provider 列表
// =============================================

interface ProviderListResult {
  imageProviders: ProviderEntry[];
  videoProviders: ProviderEntry[];
  defaultImageProvider?: string;
  defaultVideoProvider?: string;
}

/** 根据 configSource 获取个人或团队的 Provider 列表 */
export function useProviderEntries(
  configSource: ImageConfigSource,
  teamId?: string,
): ProviderListResult {
  const profileQuery = useQuery({
    queryKey: ["auth_me"],
    queryFn: () =>
      apiFetch<{
        imageProviders?: ProviderEntry[];
        videoProviders?: ProviderEntry[];
        defaultImageProvider?: string;
        defaultVideoProvider?: string;
      }>("/auth/me"),
    enabled: configSource === "personal",
    staleTime: 60_000,
  });

  const teamQuery = useQuery({
    queryKey: ["team-settings", teamId],
    queryFn: () =>
      apiFetch<{
        imageProviders?: ProviderEntry[];
        videoProviders?: ProviderEntry[];
        defaultImageProvider?: string;
        defaultVideoProvider?: string;
      }>(`/admin/teams/${teamId}/settings`),
    enabled: configSource === "team" && Boolean(teamId),
    staleTime: 60_000,
  });

  const data = configSource === "personal" ? profileQuery.data : teamQuery.data;

  return useMemo(
    () => ({
      imageProviders: data?.imageProviders ?? [],
      videoProviders: data?.videoProviders ?? [],
      defaultImageProvider: data?.defaultImageProvider,
      defaultVideoProvider: data?.defaultVideoProvider,
    }),
    [data],
  );
}

// =============================================
// Component: ProviderSelector
// =============================================

interface ProviderSelectorProps {
  type: "image" | "video";
  providers: ProviderEntry[];
  defaultProviderId?: string;
  value?: string;
  onChange: (providerId: string | undefined) => void;
}

/**
 * Provider 选择下拉框。
 * 当 providers 数量为 0 或 1 时返回 null（无需选择）。
 */
export function ProviderSelector({
  type,
  providers,
  defaultProviderId,
  value,
  onChange,
}: ProviderSelectorProps) {
  const labels = type === "image" ? IMAGE_PROVIDER_LABELS : VIDEO_PROVIDER_LABELS;

  // 当 options <=1 时不渲染
  if (providers.length <= 1) return null;

  // 自动同步默认值：首次挂载或 defaultProviderId 变化时
  const effectiveDefault = defaultProviderId && providers.some((p) => p.id === defaultProviderId)
    ? defaultProviderId
    : providers[0]?.id;

  useEffect(() => {
    if (value === undefined) {
      onChange(effectiveDefault);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const selected = value ?? effectiveDefault ?? "";

  return (
    <select
      className="input"
      style={{ fontSize: "0.8rem", padding: "2px 6px", maxWidth: 160 }}
      value={selected}
      onChange={(e) => onChange(e.target.value || undefined)}
    >
      {providers.map((entry) => (
        <option key={entry.id} value={entry.id}>
          {entry.name || labels[entry.provider as keyof typeof labels] || entry.provider}
        </option>
      ))}
    </select>
  );
}
