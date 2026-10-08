/**
 * @fileoverview 通知列表页
 * @module web/app/dashboard
 *
 * 展示用户的通知列表。
 */

"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { NotificationRecord, NotificationType } from "@dramaflow/shared";
import { apiFetch, formatApiError } from "../../../lib/api";
import { useI18n, type TranslationKey } from "../../../lib/i18n";
import { queryKeys } from "../../../lib/query-keys";
import { ErrorState } from "../../../components/error-state";
import { InlineFeedback } from "../../../components/inline-feedback";
import { LoadingSkeleton } from "../../../components/loading-skeleton";

interface NotificationsResponse {
  notifications: NotificationRecord[];
  total: number;
}

type FilterTab = "all" | "unread";

const PAGE_SIZE = 20;
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

function typeBadgeClass(type?: string): string {
  if (!type) return "notification-type-badge";
  return `notification-type-badge notification-type-badge--${type}`;
}

export default function NotificationsPage() {
  const { t, formatDate } = useI18n();
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState<FilterTab>("all");
  const [offset, setOffset] = useState(0);
  const [allItems, setAllItems] = useState<NotificationRecord[]>([]);

  const notificationsQuery = useQuery({
    queryKey: [...queryKeys.notifications, filter, offset],
    queryFn: async () => {
      const params = new URLSearchParams({
        limit: String(PAGE_SIZE),
        offset: String(offset),
      });
      if (filter === "unread") params.set("unreadOnly", "true");
      const result = await apiFetch<NotificationsResponse>(`/notifications?${params.toString()}`);
      return result;
    },
  });

  // Accumulate items when offset changes
  const currentPageItems = notificationsQuery.data?.notifications ?? [];
  const displayItems = offset === 0 ? currentPageItems : [...allItems, ...currentPageItems];

  const markAllRead = useMutation({
    mutationFn: () => apiFetch<void>("/notifications/mark-all-read", { method: "POST" }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.notifications });
      queryClient.invalidateQueries({ queryKey: queryKeys.unreadCount });
      setOffset(0);
      setAllItems([]);
    },
  });

  const markOneRead = useMutation({
    mutationFn: (id: string) => apiFetch<void>(`/notifications/${id}/read`, { method: "PATCH" }),
    onSuccess: (_, id) => {
      if (filter === "unread") {
        setOffset(0);
        setAllItems([]);
      } else {
        setAllItems((items) => items.map((item) => item.id === id ? { ...item, isRead: true } : item));
      }
      queryClient.invalidateQueries({ queryKey: queryKeys.notifications });
      queryClient.invalidateQueries({ queryKey: queryKeys.unreadCount });
    },
  });

  function handleFilterChange(tab: FilterTab) {
    setFilter(tab);
    setOffset(0);
    setAllItems([]);
  }

  function handleLoadMore() {
    setAllItems(displayItems);
    setOffset((prev) => prev + PAGE_SIZE);
  }

  return (
    <div className="notifications-page">
      <div className="notifications-page-header">
        <h1 className="notifications-page-title">{t("notifications.title")}</h1>
        <button
          className="btn btn-secondary btn-sm"
          type="button"
          onClick={() => markAllRead.mutate()}
          disabled={markAllRead.isPending || notificationsQuery.isPending}
        >
          {t("notifications.markAllRead")}
        </button>
      </div>

      <InlineFeedback error={markAllRead.error || markOneRead.error ? formatApiError(markAllRead.error ?? markOneRead.error, t) : null} />

      <div className="notifications-filter-tabs" role="group" aria-label={t("notifications.title")}>
        <button
          className={`notifications-filter-tab${filter === "all" ? " notifications-filter-tab--active" : ""}`}
          type="button"
          onClick={() => handleFilterChange("all")}
          aria-pressed={filter === "all"}
        >
          {t("notifications.filterAll")}
        </button>
        <button
          className={`notifications-filter-tab${filter === "unread" ? " notifications-filter-tab--active" : ""}`}
          type="button"
          onClick={() => handleFilterChange("unread")}
          aria-pressed={filter === "unread"}
        >
          {t("notifications.filterUnread")}
        </button>
      </div>

      <div className="notifications-list" aria-busy={notificationsQuery.isFetching}>
        {notificationsQuery.isLoading && offset === 0 && (
          <LoadingSkeleton rows={6} />
        )}

        {notificationsQuery.error && <ErrorState title={t("ui.loadFailed")} description={formatApiError(notificationsQuery.error, t)} action={<button type="button" className="btn btn-secondary" onClick={() => void notificationsQuery.refetch()}>{t("common.reload")}</button>} />}

        {!notificationsQuery.isLoading && !notificationsQuery.error && displayItems.length === 0 && (
          <div className="notifications-empty">
            {filter === "unread" ? t("notifications.noUnread") : t("notifications.emptyTitle")}
          </div>
        )}

        {displayItems.map((n) => (
          <button
            key={n.id}
            className={`notification-row${n.isRead ? "" : " notification-row--unread"}`}
            type="button"
            disabled={markOneRead.isPending && markOneRead.variables === n.id}
            onClick={() => {
              if (!n.isRead) markOneRead.mutate(n.id);
            }}
          >
            <div className="notification-row-left">
              {!n.isRead && <span className="notification-row-dot" aria-label={t("notifications.unreadDot")} />}
              <div className="notification-row-content">
                <div className="notification-row-title-line">
                  <span className="notification-row-title">{n.title}</span>
                  <span className={typeBadgeClass(n.type)}>{t(NOTIFICATION_TITLE_KEYS[n.type])}</span>
                </div>
                <div className="notification-row-body">{n.body}</div>
              </div>
            </div>
            <div className="notification-row-meta">
              <time className="notification-row-time" dateTime={n.createdAt}>{formatDate(n.createdAt, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}</time>
              <span className={`notification-row-status${n.isRead ? " notification-row-status--read" : ""}`}>
                {n.isRead ? t("notifications.statusRead") : t("notifications.statusUnread")}
              </span>
            </div>
          </button>
        ))}
      </div>

      {notificationsQuery.isFetching && offset > 0 && <p className="notifications-load-more" role="status">{t("notifications.loadingMore")}</p>}
      {displayItems.length < (notificationsQuery.data?.total ?? 0) && (
        <div className="notifications-load-more">
          <button
            className="btn btn-secondary"
            type="button"
            onClick={handleLoadMore}
            disabled={notificationsQuery.isFetching}
          >
            {notificationsQuery.isFetching ? t("notifications.loadingMore") : t("notifications.loadMore")}
          </button>
        </div>
      )}
    </div>
  );
}
