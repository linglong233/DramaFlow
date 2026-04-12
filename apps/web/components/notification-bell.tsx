/**
 * @fileoverview 通知铃铛
 * @module web/components
 *
 * 导航栏的通知图标和未读计数。
 */

"use client";

import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "../lib/api";
import { queryKeys } from "../lib/query-keys";
import { useI18n } from "../lib/i18n";
import { useRealtime } from "./realtime-provider";

interface Notification {
  id: string;
  title: string;
  body: string;
  type?: string;
  isRead: boolean;
  createdAt: string;
}

interface NotificationsResponse {
  notifications: Notification[];
  total: number;
}

interface UnreadCountResponse {
  count: number;
}

export function NotificationBell() {
  const queryClient = useQueryClient();
  const { t } = useI18n();
  const { connected } = useRealtime();
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  function formatTimeAgo(dateStr: string): string {
    const now = Date.now();
    const then = new Date(dateStr).getTime();
    const seconds = Math.floor((now - then) / 1000);

    if (seconds < 60) return t("taskPanel.timeAgo.seconds", { count: Math.max(1, seconds) });
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return t("taskPanel.timeAgo.minutes", { count: minutes });
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return t("taskPanel.timeAgo.hours", { count: hours });
    const days = Math.floor(hours / 24);
    return t("taskPanel.timeAgo.days", { count: days });
  }

  const unreadQuery = useQuery({
    queryKey: queryKeys.unreadCount,
    queryFn: () => apiFetch<UnreadCountResponse>("/notifications/unread-count"),
    refetchInterval: connected ? false : 10000,
  });

  const notificationsQuery = useQuery({
    queryKey: queryKeys.notifications,
    queryFn: () => apiFetch<NotificationsResponse>("/notifications?limit=10"),
    enabled: open,
    refetchInterval: open && !connected ? 10000 : false,
  });

  const markAllRead = useMutation({
    mutationFn: () => apiFetch<void>("/notifications/mark-all-read", { method: "POST" }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.notifications });
      queryClient.invalidateQueries({ queryKey: queryKeys.unreadCount });
    },
  });

  const markOneRead = useMutation({
    mutationFn: (id: string) => apiFetch<void>(`/notifications/${id}/read`, { method: "PATCH" }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.notifications });
      queryClient.invalidateQueries({ queryKey: queryKeys.unreadCount });
    },
  });

  // Close dropdown when clicking outside
  useEffect(() => {
    if (!open) return;

    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [open]);

  const unreadCount = unreadQuery.data?.count ?? 0;
  const notifications = notificationsQuery.data?.notifications ?? [];

  return (
    <div className="notification-bell" ref={containerRef} style={{ position: "relative" }}>
      <button
        className="btn btn-ghost btn-sm notification-bell-trigger"
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        aria-label={`${t("notifications.bellLabel")}${unreadCount > 0 ? ` (${unreadCount})` : ""}`}
        aria-expanded={open}
        style={{
          position: "relative",
          width: 36,
          height: 36,
          padding: 0,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          borderRadius: "50%",
          background: open ? "var(--bg-sidebar-active)" : "transparent",
          transition: "all 0.2s ease",
        }}
      >
        <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
          <path
            d="M10 2a5 5 0 00-5 5v3l-1.3 2.6a.75.75 0 00.67 1.1h11.26a.75.75 0 00.67-1.1L15 10V7a5 5 0 00-5-5z"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <path
            d="M8 14a2 2 0 104 0"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
          />
        </svg>
        {unreadCount > 0 && (
          <span
            className="notification-badge"
            aria-hidden="true"
            style={{
              position: "absolute",
              top: 4,
              right: 6,
              background: "var(--danger-text)",
              color: "#fff",
              fontSize: "10px",
              fontWeight: 700,
              padding: "0 4px",
              height: "16px",
              minWidth: "16px",
              borderRadius: "8px",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              border: "2px solid var(--bg-surface)",
            }}
          >
            {unreadCount > 99 ? "99+" : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div
          className="notification-dropdown"
          style={{
            position: "absolute",
            top: "calc(100% + 8px)",
            right: 0,
            width: 360,
            background: "var(--bg-elevated)",
            border: "1px solid var(--border-strong)",
            borderRadius: "var(--radius-lg)",
            boxShadow: "var(--shadow-md), 0 0 0 1px rgba(255,255,255,0.05)",
            zIndex: "var(--z-popover)",
            display: "flex",
            flexDirection: "column",
            overflow: "hidden",
            animation: "dropdown-slide-down 0.15s ease-out forwards",
            transformOrigin: "top right",
          }}
        >
          <div
            className="notification-dropdown-header"
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              padding: "16px 20px",
              borderBottom: "1px solid var(--border-subtle)",
              background: "rgba(255, 255, 255, 0.02)",
            }}
          >
            <span
              className="notification-dropdown-title"
              style={{ fontSize: "15px", fontWeight: 600, color: "var(--text-primary)" }}
            >
              {t("notifications.title")}
            </span>
            {unreadCount > 0 && (
              <button
                className="btn btn-ghost btn-sm"
                type="button"
                onClick={() => markAllRead.mutate()}
                disabled={markAllRead.isPending}
                style={{ fontSize: "12px", color: "var(--accent)", padding: "4px 8px", height: "auto" }}
              >
                {t("notifications.markAllRead")}
              </button>
            )}
          </div>

          <div
            className="notification-dropdown-list"
            style={{
              maxHeight: 400,
              overflowY: "auto",
              display: "flex",
              flexDirection: "column",
            }}
          >
            {notificationsQuery.isLoading && (
              <div
                className="notification-dropdown-empty"
                style={{ padding: "32px", textAlign: "center", color: "var(--text-tertiary)", fontSize: "13px" }}
              >
                {t("common.loading")}
              </div>
            )}

            {!notificationsQuery.isLoading && notifications.length === 0 && (
              <div
                className="notification-dropdown-empty"
                style={{ padding: "48px 32px", textAlign: "center", display: "flex", flexDirection: "column", gap: 8 }}
              >
                <div style={{ color: "var(--text-secondary)", fontWeight: 500 }}>{t("notifications.emptyTitle")}</div>
                <div style={{ color: "var(--text-tertiary)", fontSize: "13px" }}>{t("notifications.emptyDescription")}</div>
              </div>
            )}

            {notifications.map((n) => {
               // Make an effort to use translated type, otherwise fallback to the raw title string.
               let rawTypeKey = `notifications.types.${n.type}`;
               // If type exists, we cast it, but if it doesn't match a real translation it will fall back to English key. We just use title if type is missing.
               const translatedTitle = n.type ? t(rawTypeKey as any) : n.title;
               // If translation returns the key itself, it means it's missing, so use n.title.
               const displayTitle = translatedTitle === rawTypeKey ? n.title : translatedTitle;

               return (
                <button
                  key={n.id}
                  className={`notification-item${n.isRead ? "" : " notification-item--unread"}`}
                  type="button"
                  onClick={() => {
                    if (!n.isRead) markOneRead.mutate(n.id);
                  }}
                  style={{
                    display: "flex",
                    alignItems: "flex-start",
                    gap: 12,
                    padding: "16px 20px",
                    background: n.isRead ? "transparent" : "rgba(56, 189, 248, 0.03)",
                    border: "none",
                    borderBottom: "1px solid var(--border-subtle)",
                    textAlign: "left",
                    cursor: "pointer",
                    transition: "background 0.15s ease",
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.background = n.isRead ? "var(--bg-sidebar-hover)" : "rgba(56, 189, 248, 0.08)";
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = n.isRead ? "transparent" : "rgba(56, 189, 248, 0.03)";
                  }}
                >
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                      <span style={{ fontSize: "14px", fontWeight: n.isRead ? 500 : 600, color: n.isRead ? "var(--text-secondary)" : "var(--text-primary)" }}>
                        {displayTitle}
                      </span>
                      {!n.isRead && (
                        <div style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--accent)", flexShrink: 0 }} />
                      )}
                    </div>
                    <div style={{ fontSize: "13px", color: "var(--text-secondary)", lineHeight: 1.5, marginBottom: 8, display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>
                      {n.body}
                    </div>
                    <div style={{ fontSize: "11px", color: "var(--text-tertiary)", fontWeight: 500 }}>
                      {formatTimeAgo(n.createdAt)}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
