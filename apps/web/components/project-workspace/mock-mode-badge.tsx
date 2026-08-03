"use client";

import type { ProviderChannelHealth } from "@dramaflow/shared";

import type { TranslateFn } from "../../lib/i18n";

interface MockModeBadgeProps {
  t: TranslateFn;
  mockFallback: boolean;
  channel: ProviderChannelHealth | undefined;
}

/** 生成入口的 Mock 模式徽章：mockFallback=true 显示全局徽章；channel 未配置显示未配置徽章 */
export function MockModeBadge({ t, mockFallback, channel }: MockModeBadgeProps) {
  if (mockFallback) {
    return <span className="mock-mode-badge mock-mode-badge--mock">{t("mockBadge.mockMode")}</span>;
  }
  if (channel && !channel.configured) {
    return <span className="mock-mode-badge mock-mode-badge--unconfigured">{t("mockBadge.notConfigured")}</span>;
  }
  return null;
}
