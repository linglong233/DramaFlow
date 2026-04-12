/**
 * @fileoverview 实时事件服务
 * @module api/realtime
 *
 * 向已订阅的客户端广播任务更新、审核状态变更等实时事件。
 */

import { Inject, Injectable } from "@nestjs/common";
import type { JobRecord, NotificationRecord, RealtimeReviewUpdatedEvent } from "@dramaflow/shared";

import { RealtimeGateway } from "./realtime.gateway";

@Injectable()
export class RealtimeEventsService {
  constructor(@Inject(RealtimeGateway) private readonly gateway: RealtimeGateway) {}

  emitJobUpdated(job: JobRecord): void {
    this.gateway.emitJobUpdated({
      projectId: job.projectId,
      job: {
        id: job.id,
        type: job.type,
        status: job.status,
        shotId: job.shotId,
        updatedAt: job.updatedAt,
        error: job.error,
        progress: job.progress,
        batchId: job.batchId,
        retryCount: job.retryCount,
        result: this.toJobResultRecord(job.result),
      },
    });
  }

  emitReviewUpdated(event: RealtimeReviewUpdatedEvent): void {
    this.gateway.emitReviewUpdated(event);
  }

  emitNotificationCreated(notification: NotificationRecord, unreadCount: number): void {
    this.gateway.emitNotificationCreated(notification.userId, {
      notification: {
        id: notification.id,
        userId: notification.userId,
        projectId: notification.projectId,
        type: notification.type,
        title: notification.title,
        body: notification.body,
        referenceId: notification.referenceId,
        referenceType: notification.referenceType,
        isRead: notification.isRead,
        createdAt: notification.createdAt,
      },
      unreadCount,
    });
  }

  private toJobResultRecord(result: unknown): Record<string, unknown> | undefined {
    if (!result || typeof result !== "object" || Array.isArray(result)) {
      return undefined;
    }

    return result as Record<string, unknown>;
  }
}