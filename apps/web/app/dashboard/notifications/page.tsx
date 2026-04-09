"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "../../../lib/api";
import { queryKeys } from "../../../lib/query-keys";

interface Notification {
  id: string;
  title: string;
  body: string;
  type?: string;
  read: boolean;
  createdAt: string;
}

type FilterTab = "all" | "unread";

const PAGE_SIZE = 20;

function formatTimestamp(dateStr: string): string {
  const date = new Date(dateStr);
  return date.toLocaleString();
}

function typeBadgeClass(type?: string): string {
  if (!type) return "notification-type-badge";
  return `notification-type-badge notification-type-badge--${type}`;
}

export default function NotificationsPage() {
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState<FilterTab>("all");
  const [offset, setOffset] = useState(0);
  const [allItems, setAllItems] = useState<Notification[]>([]);

  const notificationsQuery = useQuery({
    queryKey: [...queryKeys.notifications, filter, offset],
    queryFn: async () => {
      const params = new URLSearchParams({
        limit: String(PAGE_SIZE),
        offset: String(offset),
      });
      if (filter === "unread") params.set("unread", "true");
      const result = await apiFetch<Notification[]>(`/notifications?${params.toString()}`);
      return result;
    },
  });

  // Accumulate items when offset changes
  const currentPageItems = notificationsQuery.data ?? [];
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
    onSuccess: () => {
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
        <h1 className="notifications-page-title">Notifications</h1>
        <button
          className="btn btn-secondary btn-sm"
          type="button"
          onClick={() => markAllRead.mutate()}
          disabled={markAllRead.isPending}
        >
          Mark all read
        </button>
      </div>

      <div className="notifications-filter-tabs">
        <button
          className={`notifications-filter-tab${filter === "all" ? " notifications-filter-tab--active" : ""}`}
          type="button"
          onClick={() => handleFilterChange("all")}
        >
          All
        </button>
        <button
          className={`notifications-filter-tab${filter === "unread" ? " notifications-filter-tab--active" : ""}`}
          type="button"
          onClick={() => handleFilterChange("unread")}
        >
          Unread
        </button>
      </div>

      <div className="notifications-list">
        {notificationsQuery.isLoading && offset === 0 && (
          <div className="notifications-empty">Loading notifications...</div>
        )}

        {!notificationsQuery.isLoading && displayItems.length === 0 && (
          <div className="notifications-empty">
            {filter === "unread" ? "No unread notifications" : "No notifications yet"}
          </div>
        )}

        {displayItems.map((n) => (
          <button
            key={n.id}
            className={`notification-row${n.read ? "" : " notification-row--unread"}`}
            type="button"
            onClick={() => {
              if (!n.read) markOneRead.mutate(n.id);
            }}
          >
            <div className="notification-row-left">
              {!n.read && <span className="notification-row-dot" aria-label="Unread" />}
              <div className="notification-row-content">
                <div className="notification-row-title-line">
                  <span className="notification-row-title">{n.title}</span>
                  {n.type && <span className={typeBadgeClass(n.type)}>{n.type}</span>}
                </div>
                <div className="notification-row-body">{n.body}</div>
              </div>
            </div>
            <div className="notification-row-meta">
              <span className="notification-row-time">{formatTimestamp(n.createdAt)}</span>
              <span className={`notification-row-status${n.read ? " notification-row-status--read" : ""}`}>
                {n.read ? "Read" : "Unread"}
              </span>
            </div>
          </button>
        ))}
      </div>

      {currentPageItems.length >= PAGE_SIZE && (
        <div className="notifications-load-more">
          <button
            className="btn btn-secondary"
            type="button"
            onClick={handleLoadMore}
            disabled={notificationsQuery.isFetching}
          >
            {notificationsQuery.isFetching ? "Loading..." : "Load more"}
          </button>
        </div>
      )}
    </div>
  );
}
