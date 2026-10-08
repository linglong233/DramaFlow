/**
 * @fileoverview 通知铃铛
 * @module web/components
 */

"use client";

import { useEffect, useId, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { NotificationRecord, NotificationType } from "@dramaflow/shared";
import Link from "next/link";
import { apiFetch } from "../lib/api";
import { queryKeys } from "../lib/query-keys";
import { useI18n, type TranslationKey } from "../lib/i18n";
import { useRealtime } from "./realtime-provider";

interface NotificationsResponse {
  notifications: NotificationRecord[];
  total: number;
}

interface UnreadCountResponse {
  count: number;
}

const NOTIFICATION_TITLE_KEYS: Record<NotificationType, TranslationKey> = {
  task_completed: "notifications.types.task_completed",
  task_failed: "notifications.types.task_failed",
  review_submitted: "notifications.types.review_submitted",
  review_approved: "notifications.types.review_approved",
  review_rejected: "notifications.types.review_rejected",
  comment_added: "notifications.types.comment_added",
  comment_reply: "notifications.types.comment_reply",
  member_invited: "notifications.types.member_invited",
};

export function NotificationBell() {
  const queryClient = useQueryClient();
  const { t, formatDate } = useI18n();
  const { connected } = useRealtime();
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelId = useId();
  const titleId = useId();

  function formatTimeAgo(dateStr: string): string {
    const seconds = Math.floor((Date.now() - new Date(dateStr).getTime()) / 1000);
    if (seconds < 60) return t("taskPanel.timeAgo.seconds", { count: Math.max(1, seconds) });
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return t("taskPanel.timeAgo.minutes", { count: minutes });
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return t("taskPanel.timeAgo.hours", { count: hours });
    return t("taskPanel.timeAgo.days", { count: Math.floor(hours / 24) });
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

  function refreshNotifications() {
    void queryClient.invalidateQueries({ queryKey: queryKeys.notifications });
    void queryClient.invalidateQueries({ queryKey: queryKeys.unreadCount });
  }

  const markAllRead = useMutation({
    mutationFn: () => apiFetch<void>("/notifications/mark-all-read", { method: "POST" }),
    onSuccess: refreshNotifications,
  });

  const markOneRead = useMutation({
    mutationFn: (id: string) => apiFetch<void>(`/notifications/${id}/read`, { method: "PATCH" }),
    onSuccess: refreshNotifications,
  });

  useEffect(() => {
    if (!open) return;
    function handlePointerOutside(event: PointerEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("pointerdown", handlePointerOutside);
    return () => document.removeEventListener("pointerdown", handlePointerOutside);
  }, [open]);

  function closePanel() {
    setOpen(false);
    triggerRef.current?.focus();
  }

  const unreadCount = unreadQuery.data?.count ?? 0;
  const notifications = notificationsQuery.data?.notifications ?? [];
  const updating = markAllRead.isPending || markOneRead.isPending;

  return (
    <div
      className="notification-bell"
      ref={containerRef}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
          setOpen(false);
        }
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape" && open) {
          event.preventDefault();
          event.stopPropagation();
          closePanel();
        }
      }}
    >
      <button
        ref={triggerRef}
        className="btn btn-ghost notification-bell-trigger"
        type="button"
        onClick={() => setOpen((previous) => !previous)}
        aria-label={`${t("notifications.bellLabel")}${unreadCount > 0 ? ` (${unreadCount})` : ""}`}
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
      >
        <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
          <path d="M10 2a5 5 0 00-5 5v3l-1.3 2.6a.75.75 0 00.67 1.1h11.26a.75.75 0 00.67-1.1L15 10V7a5 5 0 00-5-5z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M8 14a2 2 0 104 0" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
        {unreadCount > 0 ? <span className="notification-badge" aria-hidden="true">{unreadCount > 99 ? "99+" : unreadCount}</span> : null}
      </button>

      {open ? (
        <section id={panelId} className="notification-dropdown" aria-labelledby={titleId}>
          <div className="notification-dropdown-header">
            <h2 id={titleId} className="notification-dropdown-title">{t("notifications.title")}</h2>
            <div className="notification-dropdown-actions">
              {unreadCount > 0 ? (
                <button
                  className="btn btn-ghost btn-sm"
                  type="button"
                  onClick={() => {
                    markOneRead.reset();
                    markAllRead.mutate();
                  }}
                  disabled={updating}
                >
                  {t("notifications.markAllRead")}
                </button>
              ) : null}
              <button className="notification-dropdown-close" type="button" aria-label={t("common.close")} onClick={closePanel}>
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden="true">
                  <path d="m4 4 8 8M12 4l-8 8" />
                </svg>
              </button>
            </div>
          </div>

          {markAllRead.isError || markOneRead.isError ? (
            <p className="notification-dropdown-error" role="alert">{t("notifications.updateError")}</p>
          ) : null}

          <div className="notification-dropdown-list" aria-busy={notificationsQuery.isLoading}>
            {notificationsQuery.isLoading ? (
              <div className="notification-dropdown-empty" role="status">{t("notifications.loading")}</div>
            ) : null}

            {notificationsQuery.isError ? (
              <div className="notification-dropdown-empty" role="alert">
                <p>{t("notifications.loadError")}</p>
                <button className="secondary-btn" type="button" onClick={() => void notificationsQuery.refetch()} disabled={notificationsQuery.isFetching}>
                  {t("common.reload")}
                </button>
              </div>
            ) : null}

            {!notificationsQuery.isLoading && !notificationsQuery.isError && notifications.length === 0 ? (
              <div className="notification-dropdown-empty">
                <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M4 4h16v16H4zM4 14h5l1 2h4l1-2h5" />
                </svg>
                <strong>{t("notifications.emptyTitle")}</strong>
                <p>{t("notifications.emptyDescription")}</p>
              </div>
            ) : null}

            {notifications.map((notification) => {
              const titleKey = NOTIFICATION_TITLE_KEYS[notification.type];
              const displayTitle = titleKey ? t(titleKey) : notification.title;
              return (
                <button
                  key={notification.id}
                  className={`notification-item${notification.isRead ? "" : " notification-item--unread"}`}
                  type="button"
                  onClick={() => {
                    if (!notification.isRead && !updating) {
                      markAllRead.reset();
                      markOneRead.mutate(notification.id);
                    }
                  }}
                  aria-disabled={updating || notification.isRead}
                  aria-label={`${displayTitle}. ${notification.body}. ${notification.isRead ? t("notifications.statusRead") : t("notifications.markRead")}`}
                >
                  <span className="notification-item__heading">
                    <span>{displayTitle}</span>
                    <span className="notification-item__status">{notification.isRead ? t("notifications.statusRead") : t("notifications.statusUnread")}</span>
                  </span>
                  <span className="notification-item__body">{notification.body}</span>
                  <time className="notification-item__time" dateTime={notification.createdAt} title={formatDate(notification.createdAt)}>
                    {formatTimeAgo(notification.createdAt)}
                  </time>
                </button>
              );
            })}
          </div>
          <Link className="notification-dropdown-view-all" href="/dashboard/notifications" onClick={() => setOpen(false)}>
            {t("notifications.viewAll")}
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M3 8h10m-4-4 4 4-4 4" />
            </svg>
          </Link>
        </section>
      ) : null}
    </div>
  );
}
