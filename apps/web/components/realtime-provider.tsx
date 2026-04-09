"use client";

import type { ReactNode } from "react";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { RealtimeNotificationCreatedEvent } from "@dramaflow/shared";
import { io, type Socket } from "socket.io-client";

import { getApiBaseUrl } from "../lib/api";
import { queryKeys } from "../lib/query-keys";
import { useSession } from "../lib/use-session";

interface NotificationListCache {
  notifications: RealtimeNotificationCreatedEvent["notification"][];
  total: number;
}

interface RealtimeContextValue {
  socket: Socket | null;
  connected: boolean;
  available: boolean;
  subscribeProject: (projectId: string) => void;
  unsubscribeProject: (projectId: string) => void;
}

const RealtimeContext = createContext<RealtimeContextValue | null>(null);

export function RealtimeProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const { session, ready } = useSession();
  const [socket, setSocket] = useState<Socket | null>(null);
  const [connected, setConnected] = useState(false);
  const subscribedProjectsRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!ready) {
      return;
    }

    if (!session?.accessToken) {
      setSocket((current) => {
        current?.disconnect();
        return null;
      });
      setConnected(false);
      return;
    }

    const nextSocket = io(getApiBaseUrl(), {
      transports: ["websocket"],
      auth: {
        token: session.accessToken,
      },
    });

    function handleConnect() {
      setConnected(true);
      for (const projectId of subscribedProjectsRef.current) {
        nextSocket.emit("project.subscribe", { projectId });
      }
    }

    function handleDisconnect() {
      setConnected(false);
    }

    function handleNotificationCreated(event: RealtimeNotificationCreatedEvent) {
      queryClient.setQueryData<{ count: number }>(queryKeys.unreadCount, {
        count: event.unreadCount,
      });
      queryClient.setQueryData<NotificationListCache>(queryKeys.notifications, (current) => {
        const existingNotifications = current?.notifications ?? [];
        const nextNotifications = [
          event.notification,
          ...existingNotifications.filter((notification) => notification.id !== event.notification.id),
        ];
        const limit = current?.notifications.length ?? 10;
        return {
          notifications: nextNotifications.slice(0, limit),
          total: Math.max(current?.total ?? 0, nextNotifications.length),
        };
      });
    }

    nextSocket.on("connect", handleConnect);
    nextSocket.on("disconnect", handleDisconnect);
    nextSocket.on("notification.created", handleNotificationCreated);

    setSocket(nextSocket);

    return () => {
      nextSocket.off("connect", handleConnect);
      nextSocket.off("disconnect", handleDisconnect);
      nextSocket.off("notification.created", handleNotificationCreated);
      nextSocket.disconnect();
      setSocket((current) => (current === nextSocket ? null : current));
      setConnected(false);
    };
  }, [queryClient, ready, session?.accessToken]);

  const subscribeProject = useCallback((projectId: string) => {
    if (!projectId) {
      return;
    }

    subscribedProjectsRef.current.add(projectId);
    if (socket?.connected) {
      socket.emit("project.subscribe", { projectId });
    }
  }, [socket]);

  const unsubscribeProject = useCallback((projectId: string) => {
    if (!projectId) {
      return;
    }

    subscribedProjectsRef.current.delete(projectId);
    if (socket?.connected) {
      socket.emit("project.unsubscribe", { projectId });
    }
  }, [socket]);

  const value = useMemo<RealtimeContextValue>(() => ({
    socket,
    connected,
    available: ready && Boolean(session?.accessToken),
    subscribeProject,
    unsubscribeProject,
  }), [connected, ready, session?.accessToken, socket, subscribeProject, unsubscribeProject]);

  return (
    <RealtimeContext.Provider value={value}>
      {children}
    </RealtimeContext.Provider>
  );
}

export function useRealtime() {
  const context = useContext(RealtimeContext);
  if (!context) {
    throw new Error("useRealtime must be used within RealtimeProvider");
  }
  return context;
}