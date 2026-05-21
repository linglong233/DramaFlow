/**
 * @fileoverview 影响分析服务 — 读取、状态流转与辅助方法
 * @module api/workspace
 *
 * 提供影响议题的列表查询、详情读取、版本影响摘要，
 * 以及 open / ignored / resolved 状态流转。
 */

import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { createHash } from "node:crypto";
import {
  canTransitionImpactIssueStatus,
  type DependencyType,
  type ImpactIssueDetailResponse,
  type ImpactIssueEventRecord,
  type ImpactIssueRecord,
  type ImpactIssueStatus,
  type ImpactSeverity,
  type ImpactTargetRecord,
  type ProjectImpactIssuesQuery,
  type ProjectImpactIssuesResponse,
  type VersionDependencyRecord,
  type VersionImpactSummary,
} from "@dramaflow/shared";

import { DevDatabaseService } from "../common/dev-database.service";
import type { DevDatabase } from "../common/database.types";
import { createId } from "../common/id";

interface CreateImpactInput {
  projectId: string;
  dependencyId?: string;
  sourceDocumentId?: string;
  previousSourceVersionId?: string;
  changedSourceVersionId: string;
  targetDocumentId: string;
  targetVersionId: string;
  dependencyType: DependencyType;
  severity: ImpactSeverity;
  title: string;
  summary: string;
  targets: Array<
    Omit<ImpactTargetRecord, "id" | "issueId" | "projectId" | "createdAt">
  >;
  actorId: string;
}

@Injectable()
export class ImpactService {
  constructor(
    @Inject(DevDatabaseService) private readonly database: DevDatabaseService,
  ) {}

  /** 生成确定性哈希，用于依赖去重与幂等判断 */
  stableHash(value: unknown): string {
    return createHash("sha256")
      .update(this.stableStringify(value))
      .digest("hex")
      .slice(0, 16);
  }

  // ─── 读取方法 ────────────────────────────────────────────────

  /** 分页查询项目影响议题，支持多维度过滤 */
  async listProjectIssues(
    projectId: string,
    query: ProjectImpactIssuesQuery = {},
  ): Promise<ProjectImpactIssuesResponse> {
    return this.database.query((db) => {
      let issues = db.impactIssues.filter(
        (issue) => issue.projectId === projectId,
      );

      if (query.status)
        issues = issues.filter((issue) => issue.status === query.status);
      if (query.severity)
        issues = issues.filter((issue) => issue.severity === query.severity);
      if (query.assignedTo)
        issues = issues.filter(
          (issue) => issue.assignedTo === query.assignedTo,
        );
      if (query.targetType) {
        const issueIds = new Set(
          db.impactTargets
            .filter(
              (target) =>
                target.projectId === projectId &&
                target.targetType === query.targetType,
            )
            .map((target) => target.issueId),
        );
        issues = issues.filter((issue) => issueIds.has(issue.id));
      }
      if (query.targetDocumentType) {
        const documentIds = new Set(
          db.documents
            .filter(
              (document) =>
                document.projectId === projectId &&
                document.type === query.targetDocumentType,
            )
            .map((document) => document.id),
        );
        issues = issues.filter((issue) =>
          documentIds.has(issue.targetDocumentId),
        );
      }

      issues = [...issues].sort((left, right) =>
        right.updatedAt.localeCompare(left.updatedAt),
      );
      const total = issues.length;
      const offset = query.offset ?? 0;
      const limit = query.limit ?? 50;
      return {
        issues: issues
          .slice(offset, offset + limit)
          .map((issue) => this.toIssueSummary(db, issue)),
        total,
      };
    });
  }

  /** 获取单个影响议题的完整详情（含目标、建议、事件、依赖） */
  async getIssueDetail(
    issueId: string,
  ): Promise<ImpactIssueDetailResponse> {
    return this.database.query((db) => {
      const issue = this.mustFindIssue(db, issueId);
      return this.buildIssueDetail(db, issue);
    });
  }

  /** 获取版本影响摘要（统计 + 最新议题） */
  async getVersionImpactSummary(
    versionId: string,
  ): Promise<VersionImpactSummary> {
    return this.database.query((db) => {
      this.mustFindVersionProjectId(db, versionId);
      return this.buildVersionImpactSummary(db, versionId);
    });
  }

  /** 根据议题 ID 获取所属项目 ID（用于鉴权） */
  async getIssueProjectId(issueId: string): Promise<string> {
    return this.database.query(
      (db) => this.mustFindIssue(db, issueId).projectId,
    );
  }

  /** 根据版本 ID 获取所属项目 ID（用于鉴权） */
  async getVersionProjectId(versionId: string): Promise<string> {
    return this.database.query((db) =>
      this.mustFindVersionProjectId(db, versionId),
    );
  }

  /** 根据建议 ID 获取所属项目 ID（用于鉴权） */
  async getSuggestionProjectId(suggestionId: string): Promise<string> {
    return this.database.query((db) => {
      const suggestion = db.impactSuggestions.find(
        (item) => item.id === suggestionId,
      );
      if (!suggestion)
        throw new NotFoundException("Impact suggestion not found");
      return suggestion.projectId;
    });
  }

  // ─── 状态流转方法 ────────────────────────────────────────────

  /** 忽略影响议题 */
  async ignoreIssue(
    issueId: string,
    actorId: string,
    reason?: string,
  ): Promise<ImpactIssueDetailResponse> {
    return this.transitionIssue(issueId, actorId, "ignored", "ignored", reason);
  }

  /** 重新打开影响议题 */
  async reopenIssue(
    issueId: string,
    actorId: string,
  ): Promise<ImpactIssueDetailResponse> {
    return this.transitionIssue(issueId, actorId, "open", "reopened");
  }

  /** 解决影响议题 */
  async resolveIssue(
    issueId: string,
    actorId: string,
    note?: string,
  ): Promise<ImpactIssueDetailResponse> {
    return this.transitionIssue(issueId, actorId, "resolved", "resolved", note);
  }

  /** 分配影响议题给指定成员（传空则清除分配） */
  async assignIssue(
    issueId: string,
    actorId: string,
    assignedTo?: string,
  ): Promise<ImpactIssueDetailResponse> {
    return this.database.mutate((db) => {
      const issue = this.mustFindIssue(db, issueId);
      issue.assignedTo = assignedTo?.trim() || undefined;
      issue.updatedAt = new Date().toISOString();
      this.appendEvent(
        db,
        issue,
        "assigned",
        actorId,
        assignedTo ? `Assigned to ${assignedTo}` : "Assignment cleared",
      );
      return this.buildIssueDetail(db, issue);
    });
  }

  /** 通用状态流转 — 校验合法性后更新字段并追加事件 */
  private async transitionIssue(
    issueId: string,
    actorId: string,
    nextStatus: ImpactIssueStatus,
    eventType: ImpactIssueEventRecord["type"],
    note?: string,
  ): Promise<ImpactIssueDetailResponse> {
    return this.database.mutate((db) => {
      const issue = this.mustFindIssue(db, issueId);
      if (!canTransitionImpactIssueStatus(issue.status, nextStatus)) {
        throw new BadRequestException(
          `Cannot move impact issue from ${issue.status} to ${nextStatus}`,
        );
      }

      const now = new Date().toISOString();
      issue.status = nextStatus;
      issue.updatedAt = now;

      // 忽略时记录忽略人和原因
      if (nextStatus === "ignored") {
        issue.ignoredBy = actorId;
        issue.ignoredAt = now;
        issue.ignoreReason = note?.trim() || undefined;
      }

      // 解决时记录解决人和备注
      if (nextStatus === "resolved") {
        issue.resolvedBy = actorId;
        issue.resolvedAt = now;
        issue.resolveNote = note?.trim() || undefined;
      }

      // 重新打开时清除所有关闭态字段，回退已接受的建议
      if (nextStatus === "open") {
        issue.ignoredBy = undefined;
        issue.ignoredAt = undefined;
        issue.ignoreReason = undefined;
        issue.resolvedBy = undefined;
        issue.resolvedAt = undefined;
        issue.resolveNote = undefined;
        if (issue.acceptedSuggestionId) {
          const acceptedSuggestion = db.impactSuggestions.find(
            (suggestion) => suggestion.id === issue.acceptedSuggestionId,
          );
          if (acceptedSuggestion?.status === "accepted") {
            acceptedSuggestion.status = "acceptance_reverted";
            acceptedSuggestion.revertedBy = actorId;
            acceptedSuggestion.revertedAt = now;
          }
          issue.acceptedSuggestionId = undefined;
        }
      }

      this.appendEvent(db, issue, eventType, actorId, note);
      return this.buildIssueDetail(db, issue);
    });
  }

  // ─── 摘要与辅助方法 ──────────────────────────────────────────

  /** 将议题记录转为列表摘要（包含目标列表） */
  private toIssueSummary(db: DevDatabase, issue: ImpactIssueRecord) {
    return {
      id: issue.id,
      projectId: issue.projectId,
      dependencyType: issue.dependencyType,
      status: issue.status,
      severity: issue.severity,
      title: issue.title,
      summary: issue.summary,
      assignedTo: issue.assignedTo,
      changedSourceVersionId: issue.changedSourceVersionId,
      targetDocumentId: issue.targetDocumentId,
      targetVersionId: issue.targetVersionId,
      latestSuggestionId: issue.latestSuggestionId,
      acceptedSuggestionId: issue.acceptedSuggestionId,
      createdAt: issue.createdAt,
      updatedAt: issue.updatedAt,
      targets: db.impactTargets.filter(
        (target) => target.issueId === issue.id,
      ),
    };
  }

  /** 构建影响议题完整详情（含目标、建议、事件、依赖） */
  private buildIssueDetail(
    db: DevDatabase,
    issue: ImpactIssueRecord,
  ): ImpactIssueDetailResponse {
    return {
      issue,
      targets: db.impactTargets.filter(
        (target) => target.issueId === issue.id,
      ),
      suggestions: db.impactSuggestions.filter(
        (suggestion) => suggestion.issueId === issue.id,
      ),
      events: db.impactIssueEvents.filter(
        (event) => event.issueId === issue.id,
      ),
      dependencies: db.versionDependencies.filter(
        (dependency) => dependency.id === issue.dependencyId,
      ),
    };
  }

  /** 构建版本影响摘要（公开方法，供 WorkspaceService 调用） */
  buildVersionImpactSummary(
    db: DevDatabase,
    versionId: string,
  ): VersionImpactSummary {
    const issues = db.impactIssues.filter(
      (issue) => issue.targetVersionId === versionId,
    );
    return {
      versionId,
      dependencies: db.versionDependencies.filter(
        (dependency) => dependency.targetVersionId === versionId,
      ),
      openCount: issues.filter((issue) => issue.status === "open").length,
      suggestedCount: issues.filter((issue) => issue.status === "suggested")
        .length,
      acceptedCount: issues.filter((issue) => issue.status === "accepted")
        .length,
      ignoredCount: issues.filter((issue) => issue.status === "ignored").length,
      resolvedCount: issues.filter((issue) => issue.status === "resolved")
        .length,
      latestIssues: issues
        .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
        .slice(0, 5)
        .map((issue) => this.toIssueSummary(db, issue)),
    };
  }

  /** 追加影响议题事件记录 */
  private appendEvent(
    db: DevDatabase,
    issue: ImpactIssueRecord,
    type: ImpactIssueEventRecord["type"],
    actorId: string,
    note?: string,
  ): void {
    db.impactIssueEvents.push({
      id: createId("impact_event"),
      issueId: issue.id,
      projectId: issue.projectId,
      type,
      actorId,
      note: note?.trim() || undefined,
      createdAt: new Date().toISOString(),
    });
  }

  /** 查找影响议题，不存在则抛 404 */
  private mustFindIssue(
    db: DevDatabase,
    issueId: string,
  ): ImpactIssueRecord {
    const issue = db.impactIssues.find((item) => item.id === issueId);
    if (!issue) {
      throw new NotFoundException("Impact issue not found");
    }
    return issue;
  }

  /** 通过版本 ID 查找所属项目 ID，不存在则抛 404 */
  private mustFindVersionProjectId(
    db: DevDatabase,
    versionId: string,
  ): string {
    const version = db.versions.find((item) => item.id === versionId);
    if (!version) {
      throw new NotFoundException("Version not found");
    }
    const document = db.documents.find(
      (item) => item.id === version.documentId,
    );
    if (!document) {
      throw new NotFoundException("Version document not found");
    }
    return document.projectId;
  }

  /** 确定性 JSON 序列化（键排序），用于哈希计算 */
  private stableStringify(value: unknown): string {
    if (value === null || typeof value !== "object") {
      return JSON.stringify(value);
    }
    if (Array.isArray(value)) {
      return `[${value.map((item) => this.stableStringify(item)).join(",")}]`;
    }
    const object = value as Record<string, unknown>;
    return `{${Object.keys(object)
      .sort()
      .map(
        (key) =>
          `${JSON.stringify(key)}:${this.stableStringify(object[key])}`,
      )
      .join(",")}}`;
  }
}
