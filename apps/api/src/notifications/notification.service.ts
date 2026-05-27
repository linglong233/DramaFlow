/**
 * @fileoverview 通知服务
 * @module api/notifications
 *
 * 管理通知的创建、查询、标记已读等操作。
 */

import { Inject, Injectable } from "@nestjs/common";
import type { NotificationRecord, NotificationType } from "@dramaflow/shared";

import { PrismaService } from "../common/prisma.service";
import { iso } from "../common/prisma-json";
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
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(RealtimeEventsService) private readonly realtimeEvents: RealtimeEventsService,
  ) {}

  async createNotification(params: CreateNotificationParams): Promise<NotificationRecord | null> {
    try {
      const notification = await this.prisma.notification.create({
        data: {
          id: createId("ntf"),
          userId: params.userId,
          projectId: params.projectId,
          type: params.type,
          title: params.title,
          body: params.body,
          referenceId: params.referenceId,
          referenceType: params.referenceType,
          isRead: false,
        },
      });

      await this.pruneUserNotifications(params.userId);

      const record: NotificationRecord = {
        ...notification,
        projectId: notification.projectId ?? undefined,
        referenceId: notification.referenceId ?? undefined,
        referenceType: (notification.referenceType as "job" | "version" | "comment") ?? undefined,
        createdAt: iso(notification.createdAt),
      };

      const unreadCount = await this.getUnreadCount(params.userId);
      this.realtimeEvents.emitNotificationCreated(record, unreadCount);
      return record;
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
    const where = {
      userId,
      ...(options.unreadOnly ? { isRead: false } : {}),
    };

    const [items, total] = await this.prisma.$transaction([
      this.prisma.notification.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: options.offset ?? 0,
        take: options.limit ?? 20,
      }),
      this.prisma.notification.count({ where }),
    ]);

    const notifications: NotificationRecord[] = items.map((n) => ({
      ...n,
      projectId: n.projectId ?? undefined,
      referenceId: n.referenceId ?? undefined,
      referenceType: (n.referenceType as "job" | "version" | "comment") ?? undefined,
      createdAt: iso(n.createdAt),
    }));

    return { notifications, total };
  }

  async getUnreadCount(userId: string): Promise<number> {
    return this.prisma.notification.count({
      where: { userId, isRead: false },
    });
  }

  async markRead(userId: string, notificationId: string): Promise<void> {
    await this.prisma.notification.updateMany({
      where: { id: notificationId, userId },
      data: { isRead: true },
    });
  }

  async markAllRead(userId: string): Promise<void> {
    await this.prisma.notification.updateMany({
      where: { userId, isRead: false },
      data: { isRead: true },
    });
  }

  private async pruneUserNotifications(userId: string): Promise<void> {
    const cutoff = new Date(Date.now() - PRUNE_AGE_MS);

    // 删除超过保留期限的通知
    await this.prisma.notification.deleteMany({
      where: {
        userId,
        createdAt: { lt: cutoff },
      },
    });

    // 如果用户通知数量超过上限，删除最旧的
    const userNotifications = await this.prisma.notification.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      select: { id: true },
    });

    if (userNotifications.length > MAX_NOTIFICATIONS_PER_USER) {
      const toRemove = userNotifications.slice(MAX_NOTIFICATIONS_PER_USER);
      await this.prisma.notification.deleteMany({
        where: { id: { in: toRemove.map((n) => n.id) } },
      });
    }
  }
}
