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

import { PrismaService } from "../common/prisma.service";
import { jsonInput, jsonOutput, iso } from "../common/prisma-json";
import { NotificationService } from "../notifications/notification.service";
import { createId } from "../common/id";

/** 审核服务，管理审核配置、记录审核操作并发送通知 */
@Injectable()
export class AuditService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(NotificationService) private readonly notificationService: NotificationService,
  ) {}

  /** 获取项目的审核配置列表 */
  async getAuditConfigs(projectId: string): Promise<AuditConfigRecord[]> {
    const configs = await this.prisma.auditConfig.findMany({
      where: { projectId },
    });
    return configs.map((c) => ({
      id: c.id,
      projectId: c.projectId,
      contentType: c.contentType as AuditContentType,
      reviewRequired: c.reviewRequired,
      autoApproveRoles: jsonOutput<ProjectRole[]>(c.autoApproveRoles),
      createdAt: iso(c.createdAt),
      updatedAt: iso(c.updatedAt),
    }));
  }

  /** 创建或更新审核配置 */
  async upsertAuditConfig(
    projectId: string,
    contentType: AuditContentType,
    input: { reviewRequired: boolean; autoApproveRoles?: ProjectRole[] },
  ): Promise<AuditConfigRecord> {
    const result = await this.prisma.auditConfig.upsert({
      where: { projectId_contentType: { projectId, contentType } },
      update: {
        reviewRequired: input.reviewRequired,
        autoApproveRoles: jsonInput(input.autoApproveRoles ?? []),
        updatedAt: new Date(),
      },
      create: {
        id: createId("acfg"),
        projectId,
        contentType,
        reviewRequired: input.reviewRequired,
        autoApproveRoles: jsonInput(input.autoApproveRoles ?? []),
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });
    return {
      id: result.id,
      projectId: result.projectId,
      contentType: result.contentType as AuditContentType,
      reviewRequired: result.reviewRequired,
      autoApproveRoles: jsonOutput<ProjectRole[]>(result.autoApproveRoles),
      createdAt: iso(result.createdAt),
      updatedAt: iso(result.updatedAt),
    };
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
    const entry = await this.prisma.auditRecord.create({
      data: {
        id: createId("aud"),
        projectId: params.projectId,
        versionId: params.versionId,
        documentType: params.documentType,
        action: params.action,
        reviewerId: params.reviewerId,
        comment: params.comment,
        createdAt: new Date(),
      },
    });

    // 向相关用户发送审核通知
    await this.notifyAuditAction(params);

    return {
      id: entry.id,
      projectId: entry.projectId,
      versionId: entry.versionId,
      documentType: entry.documentType as DocumentType,
      action: entry.action as AuditAction,
      reviewerId: entry.reviewerId,
      comment: entry.comment ?? undefined,
      createdAt: iso(entry.createdAt),
    };
  }

  /** 查询项目审核记录（分页） */
  async listAuditRecords(
    projectId: string,
    options: { type?: DocumentType; limit?: number; offset?: number } = {},
  ): Promise<{ records: AuditRecordSummary[]; total: number }> {
    const where: any = { projectId };
    if (options.type) {
      where.documentType = options.type;
    }

    const offset = options.offset ?? 0;
    const limit = options.limit ?? 20;

    const [records, total] = await this.prisma.$transaction([
      this.prisma.auditRecord.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: offset,
        take: limit,
      }),
      this.prisma.auditRecord.count({ where }),
    ]);

    const summaries: AuditRecordSummary[] = [];
    for (const record of records) {
      summaries.push(await this.toAuditRecordSummary(record));
    }

    return { records: summaries, total };
  }

  /** 获取指定版本的审核记录 */
  async getAuditRecordsForVersion(versionId: string): Promise<AuditRecordSummary[]> {
    const records = await this.prisma.auditRecord.findMany({
      where: { versionId },
      orderBy: { createdAt: "desc" },
    });

    const summaries: AuditRecordSummary[] = [];
    for (const record of records) {
      summaries.push(await this.toAuditRecordSummary(record));
    }
    return summaries;
  }

  /** 将审核记录转换为包含审核人信息的摘要 */
  private async toAuditRecordSummary(
    record: { id: string; projectId: string; versionId: string; documentType: string; action: string; comment: string | null; createdAt: Date; reviewerId: string },
  ): Promise<AuditRecordSummary> {
    const reviewer = await this.prisma.user.findUnique({
      where: { id: record.reviewerId },
    });
    return {
      id: record.id,
      projectId: record.projectId,
      versionId: record.versionId,
      documentType: record.documentType as DocumentType,
      action: record.action as AuditAction,
      comment: record.comment ?? undefined,
      createdAt: iso(record.createdAt),
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

    const [version, reviewer, reviewerMembers] = await Promise.all([
      this.prisma.version.findUnique({ where: { id: versionId } }),
      this.prisma.user.findUnique({ where: { id: reviewerId } }),
      this.prisma.projectMember.findMany({
        where: {
          projectId,
          role: { in: ["project_admin", "reviewer"] },
        },
      }),
    ]);

    const data = {
      versionCreatedBy: version?.createdBy ?? undefined,
      versionTitle: version?.title ?? "Unknown",
      reviewerName: reviewer?.displayName ?? "Unknown",
      reviewerMemberUserIds: reviewerMembers.map((m) => m.userId),
    };

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
