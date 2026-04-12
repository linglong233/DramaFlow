/**
 * @fileoverview 审核服务
 * @module api/workspace
 *
 * 管理审核配置和审核记录，包括记录审核操作和发送相关通知。
 */

import { Injectable, Inject } from "@nestjs/common";
import type {
  AuditAction,
  AuditConfigRecord,
  AuditContentType,
  AuditRecordEntry,
  AuditRecordSummary,
  DocumentType,
  ProjectRole,
} from "@dramaflow/shared";

import { DevDatabaseService } from "../common/dev-database.service";
import { NotificationService } from "../notifications/notification.service";
import { createId } from "../common/id";

/** 审核服务，管理审核配置、记录审核操作并发送通知 */
@Injectable()
export class AuditService {
  constructor(
    @Inject(DevDatabaseService) private readonly database: DevDatabaseService,
    @Inject(NotificationService) private readonly notificationService: NotificationService,
  ) {}

  /** 获取项目的审核配置列表 */
  async getAuditConfigs(projectId: string): Promise<AuditConfigRecord[]> {
    return this.database.query((db) =>
      db.auditConfigs.filter((c) => c.projectId === projectId),
    );
  }

  /** 创建或更新审核配置 */
  async upsertAuditConfig(
    projectId: string,
    contentType: AuditContentType,
    input: { reviewRequired: boolean; autoApproveRoles?: ProjectRole[] },
  ): Promise<AuditConfigRecord> {
    return this.database.mutate((db) => {
      const existing = db.auditConfigs.find(
        (c) => c.projectId === projectId && c.contentType === contentType,
      );

      const now = new Date().toISOString();

      if (existing) {
        existing.reviewRequired = input.reviewRequired;
        existing.autoApproveRoles = input.autoApproveRoles ?? existing.autoApproveRoles;
        existing.updatedAt = now;
        return existing;
      }

      const config: AuditConfigRecord = {
        id: createId("acfg"),
        projectId,
        contentType,
        reviewRequired: input.reviewRequired,
        autoApproveRoles: input.autoApproveRoles ?? [],
        createdAt: now,
        updatedAt: now,
      };

      db.auditConfigs.push(config);
      return config;
    });
  }

  /** 记录审核操作并发送通知 */
  async recordAuditAction(params: {
    projectId: string;
    versionId: string;
    documentType: DocumentType;
    action: AuditAction;
    reviewerId: string;
    comment?: string;
  }): Promise<AuditRecordEntry> {
    const entry: AuditRecordEntry = {
      id: createId("aud"),
      projectId: params.projectId,
      versionId: params.versionId,
      documentType: params.documentType,
      action: params.action,
      reviewerId: params.reviewerId,
      comment: params.comment,
      createdAt: new Date().toISOString(),
    };

    await this.database.mutate((db) => {
      db.auditRecords.push(entry);
    });

    // 向相关用户发送审核通知
    await this.notifyAuditAction(params);

    return entry;
  }

  /** 查询项目审核记录（分页） */
  async listAuditRecords(
    projectId: string,
    options: { type?: DocumentType; limit?: number; offset?: number } = {},
  ): Promise<{ records: AuditRecordSummary[]; total: number }> {
    return this.database.query((db) => {
      let items = db.auditRecords.filter((r) => r.projectId === projectId);

      if (options.type) {
        items = items.filter((r) => r.documentType === options.type);
      }

      items.sort((a, b) => b.createdAt.localeCompare(a.createdAt));

      const total = items.length;
      const offset = options.offset ?? 0;
      const limit = options.limit ?? 20;
      const records = items.slice(offset, offset + limit).map((record) => this.toAuditRecordSummary(db, record));

      return { records, total };
    });
  }

  /** 获取指定版本的审核记录 */
  async getAuditRecordsForVersion(versionId: string): Promise<AuditRecordSummary[]> {
    return this.database.query((db) =>
      db.auditRecords
        .filter((r) => r.versionId === versionId)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        .map((record) => this.toAuditRecordSummary(db, record)),
    );
  }

  /** 将审核记录转换为包含审核人信息的摘要 */
  private toAuditRecordSummary(
    db: import("../common/database.types").DevDatabase,
    record: AuditRecordEntry,
  ): AuditRecordSummary {
    const reviewer = db.users.find((user) => user.id === record.reviewerId);
    return {
      id: record.id,
      projectId: record.projectId,
      versionId: record.versionId,
      documentType: record.documentType,
      action: record.action,
      comment: record.comment,
      createdAt: record.createdAt,
      reviewerDisplayName: reviewer?.displayName ?? "Unknown",
      reviewerEmail: reviewer?.email ?? "unknown@example.com",
    };
  }

  /** 根据审核操作类型发送通知（提交时通知审核员，通过/拒绝时通知更新人） */
  private async notifyAuditAction(params: {
    projectId: string;
    versionId: string;
    documentType: DocumentType;
    action: AuditAction;
    reviewerId: string;
  }): Promise<void> {
    const { projectId, versionId, action, reviewerId } = params;

    const data = await this.database.query((db) => {
      const version = db.versions.find((v) => v.id === versionId);
      const reviewer = db.users.find((u) => u.id === reviewerId);
      const projectMembers = db.projectMembers.filter((m) => m.projectId === projectId);
      const reviewerRoles: ProjectRole[] = ["project_admin", "reviewer"];
      const reviewerMembers = projectMembers.filter((m) => reviewerRoles.includes(m.role));

      return {
        versionCreatedBy: version?.createdBy,
        versionTitle: version?.title ?? "Unknown",
        reviewerName: reviewer?.displayName ?? "Unknown",
        reviewerMemberUserIds: reviewerMembers.map((m) => m.userId),
      };
    });

    if (action === "submitted") {
      // 通知审核员
      const recipientIds = data.reviewerMemberUserIds.filter((id) => id !== reviewerId);
      await this.notificationService.createNotificationForMany(recipientIds, {
        projectId,
        type: "review_submitted",
        title: "New version submitted for review",
        body: `"${data.versionTitle}" has been submitted for review by ${data.reviewerName}`,
        referenceId: versionId,
        referenceType: "version",
      });
    } else if (action === "approved" || action === "rejected") {
      // 通知版本创建者
      const type = action === "approved" ? "review_approved" as const : "review_rejected" as const;
      if (data.versionCreatedBy && data.versionCreatedBy !== reviewerId) {
        await this.notificationService.createNotification({
          userId: data.versionCreatedBy,
          projectId,
          type,
          title: `Version ${action}`,
          body: `"${data.versionTitle}" has been ${action} by ${data.reviewerName}`,
          referenceId: versionId,
          referenceType: "version",
        });
      }
    }
  }
}
