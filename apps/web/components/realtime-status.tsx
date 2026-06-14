/**
 * @fileoverview 实时连接状态指示器
 * @module web/components
 *
 * 在顶栏展示 WebSocket 实时连接状态，让用户知道长任务期间是否会收到实时推送。
 */

"use client";

import { useI18n } from "../lib/i18n";
import { useRealtime } from "./realtime-provider";

type RealtimeState = "connected" | "reconnecting" | "offline";

export function RealtimeStatus() {
  const { t } = useI18n();
  const { connected, available } = useRealtime();

  let state: RealtimeState;
  if (!available) {
    state = "offline";
  } else if (connected) {
    state = "connected";
  } else {
    state = "reconnecting";
  }

  const label =
    state === "connected"
      ? t("common.realtimeConnected")
      : state === "reconnecting"
        ? t("common.realtimeReconnecting")
        : t("common.realtimeOffline");

  // 仅在非连接态给出悬浮提示，避免已连接时多余信息
  const hint = state !== "connected" ? t("common.realtimeReconnectingHint") : undefined;

  return (
    <span
      className={`realtime-status realtime-status--${state}`}
      title={hint}
      role="status"
      aria-label={label}
    >
      <span className={`realtime-status__dot realtime-status__dot--${state}`} aria-hidden="true" />
      <span className="realtime-status__label">{label}</span>
    </span>
  );
}
