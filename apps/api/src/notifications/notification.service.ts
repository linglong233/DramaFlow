import { Inject, Injectable } from "@nestjs/common";
import type { NotificationRecord, NotificationType } from "@dramaflow/shared";

import { DevDatabaseService } from "../common/dev-database.service";
import { RealtimeEventsService } from "../realtime/realtime.events.service";
import { createId } from "../common/id";

const MAX_NOTIFICATIONS_PER_USER = 500;
const PRUNE_AGE_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

export interface CreateNotificationParams {
  userId: string;
  projectId?: string;
  type: NotificationType;
  title: string;
  body: string;
  referenceId?: string;
  referenceType?: "job" | "version" | "comment";
}

@Injectable()
export class NotificationService {
  constructor(
    @Inject(DevDatabaseService) private readonly database: DevDatabaseService,
    @Inject(RealtimeEventsService) private readonly realtimeEvents: RealtimeEventsService,
  ) {}

  async createNotification(params: CreateNotificationParams): Promise<NotificationRecord | null> {
    try {
      const notification = await this.database.mutate((db) => {
        const record: NotificationRecord = {
          id: createId("ntf"),
          userId: params.userId,
          projectId: params.projectId,
          type: params.type,
          title: params.title,
          body: params.body,
          referenceId: params.referenceId,
          referenceType: params.referenceType,
          isRead: false,
          createdAt: new Date().toISOString(),
        };

        db.notifications.push(record);
        this.pruneUserNotifications(db.notifications, params.userId);
        return record;
      });

      const unreadCount = await this.getUnreadCount(params.userId);
      this.realtimeEvents.emitNotificationCreated(notification, unreadCount);
      return notification;
    } catch {
      // fire-and-forget: notification failures must not block primary operations
      return null;
    }
  }

  async createNotificationForMany(userIds: string[], params: Omit<CreateNotificationParams, "userId">): Promise<void> {
    for (const userId of userIds) {
      await this.createNotification({ ...params, userId });
    }
  }

  async listNotifications(userId: string, options: { unreadOnly?: boolean; limit?: number; offset?: number } = {}): Promise<{ notifications: NotificationRecord[]; total: number }> {
    return this.database.query((db) => {
      let items = db.notifications.filter((n) => n.userId === userId);

      if (options.unreadOnly) {
        items = items.filter((n) => !n.isRead);
      }

      items.sort((a, b) => b.createdAt.localeCompare(a.createdAt));

      const total = items.length;
      const offset = options.offset ?? 0;
      const limit = options.limit ?? 20;
      const notifications = items.slice(offset, offset + limit);

      return { notifications, total };
    });
  }

  async getUnreadCount(userId: string): Promise<number> {
    return this.database.query((db) =>
      db.notifications.filter((n) => n.userId === userId && !n.isRead).length,
    );
  }

  async markRead(userId: string, notificationId: string): Promise<void> {
    await this.database.mutate((db) => {
      const notification = db.notifications.find(
        (n) => n.id === notificationId && n.userId === userId,
      );
      if (notification) {
        notification.isRead = true;
      }
    });
  }

  async markAllRead(userId: string): Promise<void> {
    await this.database.mutate((db) => {
      for (const notification of db.notifications) {
        if (notification.userId === userId && !notification.isRead) {
          notification.isRead = true;
        }
      }
    });
  }

  private pruneUserNotifications(notifications: NotificationRecord[], userId: string): void {
    const now = Date.now();
    const cutoff = now - PRUNE_AGE_MS;

    for (let i = notifications.length - 1; i >= 0; i--) {
      const n = notifications[i];
      if (n.userId === userId && new Date(n.createdAt).getTime() < cutoff) {
        notifications.splice(i, 1);
      }
    }

    const userNotifications = notifications
      .map((n, idx) => ({ n, idx }))
      .filter(({ n }) => n.userId === userId);

    if (userNotifications.length > MAX_NOTIFICATIONS_PER_USER) {
      userNotifications.sort((a, b) => b.n.createdAt.localeCompare(a.n.createdAt));
      const toRemove = userNotifications.slice(MAX_NOTIFICATIONS_PER_USER);
      const removeIndices = new Set(toRemove.map(({ idx }) => idx));
      for (let i = notifications.length - 1; i >= 0; i--) {
        if (removeIndices.has(i)) {
          notifications.splice(i, 1);
        }
      }
    }
  }
}