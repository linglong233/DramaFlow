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
  isActiveImpactIssueStatus,
  type DependencyType,
  type DocumentRecord,
  type ImpactIssueDetailResponse,
  type ImpactIssueEventRecord,
  type ImpactIssueRecord,
  type ImpactIssueStatus,
  type ImpactSeverity,
  type ImpactSuggestionRecord,
  type ImpactTargetRecord,
  type ProjectImpactIssuesQuery,
  type ProjectImpactIssuesResponse,
  type VersionDependencyRecord,
  type VersionImpactSummary,
  type VersionRecord,
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

  // ─── 依赖记录与影响扫描 ─────────────────────────────────────────

  /** 记录版本的依赖关系：根据 metadata 中的来源版本建立依赖链 */
  async recordDependenciesForVersion(versionId: string): Promise<VersionDependencyRecord[]> {
    return this.database.mutate((db) => {
      const version = db.versions.find((item) => item.id === versionId);
      if (!version) return [];
      const document = db.documents.find((item) => item.id === version.documentId);
      if (!document) return [];

      db.versionDependencies = db.versionDependencies.filter((item) => item.targetVersionId !== versionId);

      const metadata = version.metadata ?? {};
      const created: VersionDependencyRecord[] = [];
      const add = (
        sourceVersionId: string | undefined,
        dependencyType: DependencyType,
        targetAnchorType?: VersionDependencyRecord["targetAnchorType"],
        targetAnchorId?: string,
        sourceSnapshotHash?: string,
        targetSnapshotHash?: string,
      ) => {
        if (!sourceVersionId) return;
        const sourceVersion = db.versions.find((item) => item.id === sourceVersionId);
        const sourceDocument = sourceVersion ? db.documents.find((item) => item.id === sourceVersion.documentId) : undefined;
        const now = new Date().toISOString();
        const dependency: VersionDependencyRecord = {
          id: createId("dependency"),
          projectId: document.projectId,
          sourceDocumentId: sourceDocument?.id,
          sourceVersionId,
          sourceDocumentType: sourceDocument?.type,
          targetDocumentId: document.id,
          targetVersionId: version.id,
          targetDocumentType: document.type,
          dependencyType,
          targetAnchorType,
          targetAnchorId,
          sourceSnapshotHash,
          targetSnapshotHash,
          promptSnapshot: typeof metadata.promptSnapshot === "string" ? metadata.promptSnapshot : undefined,
          provider: typeof metadata.provider === "string" ? metadata.provider : undefined,
          model: typeof metadata.model === "string" ? metadata.model : undefined,
          configSource: metadata.llmConfigSource === "team" || metadata.llmConfigSource === "personal" ? metadata.llmConfigSource : undefined,
          createdBy: version.createdBy,
          createdAt: now,
        };
        db.versionDependencies.push(dependency);
        created.push(dependency);
      };

      add(metadata.sourceWorldBibleVersionId as string | undefined, document.type === "synopsis" ? "world_bible_to_synopsis" : document.type === "script" ? "world_bible_to_script" : "world_bible_to_storyboard");
      add(metadata.sourceSynopsisVersionId as string | undefined, "synopsis_to_script");
      add(metadata.sourceScriptVersionId as string | undefined, "script_to_storyboard");
      add(
        metadata.sourceStoryboardVersionId as string | undefined,
        "storyboard_to_media",
        "shot",
        metadata.shotId as string | undefined,
        metadata.sourceShotHash as string | undefined,
        metadata.targetSnapshotHash as string | undefined,
      );

      if (created.length === 0 && metadata.source === "restore" && typeof metadata.restoredFromVersionId === "string") {
        const inherited = db.versionDependencies.filter((item) => item.targetVersionId === metadata.restoredFromVersionId);
        for (const dependency of inherited) {
          const copy: VersionDependencyRecord = {
            ...dependency,
            id: createId("dependency"),
            targetDocumentId: document.id,
            targetVersionId: version.id,
            targetDocumentType: document.type,
            dependencyType: "manual_inherited",
            createdBy: version.createdBy,
            createdAt: new Date().toISOString(),
          };
          db.versionDependencies.push(copy);
          created.push(copy);
        }
      }

      if (created.length === 0) {
        const dependency: VersionDependencyRecord = {
          id: createId("dependency"),
          projectId: document.projectId,
          targetDocumentId: document.id,
          targetVersionId: version.id,
          targetDocumentType: document.type,
          dependencyType: "manual_unlinked",
          createdBy: version.createdBy,
          createdAt: new Date().toISOString(),
        };
        db.versionDependencies.push(dependency);
        created.push(dependency);
      }

      return created;
    });
  }

  /** 版本采用后扫描下游影响，生成影响议题 */
  async scanAfterAdoption(input: {
    projectId: string;
    sourceDocumentId: string;
    previousSourceVersionId?: string;
    changedSourceVersionId: string;
    actorId: string;
  }): Promise<ImpactIssueRecord[]> {
    return this.database.mutate((db) => {
      const sourceDocument = db.documents.find((item) => item.id === input.sourceDocumentId);
      if (!sourceDocument) return [];

      const dependencies = db.versionDependencies.filter((dependency) =>
        dependency.projectId === input.projectId
        && dependency.sourceVersionId
        && dependency.sourceVersionId !== input.changedSourceVersionId
        && dependency.sourceDocumentId === input.sourceDocumentId,
      );

      const created: ImpactIssueRecord[] = [];
      for (const dependency of dependencies) {
        const targetVersion = db.versions.find((version) => version.id === dependency.targetVersionId);
        const targetDocument = db.documents.find((document) => document.id === dependency.targetDocumentId);
        if (!targetVersion || !targetDocument) continue;

        const activeTarget =
          targetDocument.currentVersionId === targetVersion.id
          || targetDocument.draftVersionId === targetVersion.id
          || targetDocument.type === "image"
          || targetDocument.type === "video"
          || targetDocument.type === "audio"
          || targetDocument.type === "subtitle";
        if (!activeTarget) continue;

        const title = this.buildIssueTitle(sourceDocument, targetDocument, targetVersion);
        const summary = `当前 ${sourceDocument.type} 版本从 ${dependency.sourceVersionId} 变更为 ${input.changedSourceVersionId}。${targetDocument.title} V${targetVersion.versionNumber} 基于旧版来源创建。`;
        const issue = this.createOrUpdateImpactIssue(db, {
          projectId: input.projectId,
          dependencyId: dependency.id,
          sourceDocumentId: sourceDocument.id,
          previousSourceVersionId: dependency.sourceVersionId,
          changedSourceVersionId: input.changedSourceVersionId,
          targetDocumentId: targetDocument.id,
          targetVersionId: targetVersion.id,
          dependencyType: dependency.dependencyType,
          severity: this.resolveSeverity(dependency, targetDocument, targetVersion),
          title,
          summary,
          targets: [{
            targetType: dependency.targetAnchorType === "shot" ? "shot" : "version",
            documentId: targetDocument.id,
            versionId: targetVersion.id,
            anchorId: dependency.targetAnchorId,
            label: dependency.targetAnchorId ? `${targetDocument.title} / ${dependency.targetAnchorId}` : `${targetDocument.title} V${targetVersion.versionNumber}`,
          }],
          actorId: input.actorId,
        });
        created.push(issue);
      }
      return created;
    });
  }

  /** 创建或更新影响议题（幂等） */
  private createOrUpdateImpactIssue(db: DevDatabase, input: CreateImpactInput): ImpactIssueRecord {
    const target = input.targets[0];
    const existing = db.impactIssues.find((issue) =>
      issue.projectId === input.projectId
      && issue.dependencyId === input.dependencyId
      && issue.changedSourceVersionId === input.changedSourceVersionId
      && issue.targetVersionId === input.targetVersionId
      && db.impactTargets.some((item) =>
        item.issueId === issue.id
        && item.targetType === target.targetType
        && item.anchorId === target.anchorId,
      ),
    );

    const now = new Date().toISOString();
    if (existing) {
      existing.title = input.title;
      existing.summary = input.summary;
      existing.severity = input.severity;
      existing.updatedAt = now;
      if (!isActiveImpactIssueStatus(existing.status) && existing.status !== "ignored") {
        existing.status = "open";
      }
      this.appendEvent(db, existing, "created", input.actorId, "来源变更后影响刷新");
      return existing;
    }

    const issue: ImpactIssueRecord = {
      id: createId("impact"),
      projectId: input.projectId,
      dependencyId: input.dependencyId,
      sourceDocumentId: input.sourceDocumentId,
      previousSourceVersionId: input.previousSourceVersionId,
      changedSourceVersionId: input.changedSourceVersionId,
      targetDocumentId: input.targetDocumentId,
      targetVersionId: input.targetVersionId,
      dependencyType: input.dependencyType,
      status: "open",
      severity: input.severity,
      title: input.title,
      summary: input.summary,
      createdBy: input.actorId,
      createdAt: now,
      updatedAt: now,
    };
    db.impactIssues.push(issue);

    for (const targetInput of input.targets) {
      db.impactTargets.push({
        id: createId("impact_target"),
        issueId: issue.id,
        projectId: input.projectId,
        targetType: targetInput.targetType,
        documentId: targetInput.documentId,
        versionId: targetInput.versionId,
        anchorId: targetInput.anchorId,
        label: targetInput.label,
        createdAt: now,
      });
    }

    this.appendEvent(db, issue, "created", input.actorId, input.summary);
    return issue;
  }

  /** 根据依赖类型和目标状态判断严重等级 */
  private resolveSeverity(
    dependency: VersionDependencyRecord,
    targetDocument: DocumentRecord,
    targetVersion: VersionRecord,
  ): ImpactSeverity {
    if (targetDocument.currentVersionId === targetVersion.id) return "high";
    if (dependency.dependencyType === "synopsis_to_script" || dependency.dependencyType === "script_to_storyboard") return "high";
    if (dependency.dependencyType === "manual_unlinked") return "low";
    return "medium";
  }

  /** 构建影响议题标题 */
  private buildIssueTitle(sourceDocument: DocumentRecord, targetDocument: DocumentRecord, targetVersion: VersionRecord): string {
    return `${targetDocument.title} V${targetVersion.versionNumber} 可能受更新的 ${sourceDocument.type} 影响`;
  }

  // ─── 建议任务与候选人接受 ──────────────────────────────────────

  /** 创建影响建议生成任务 */
  async createSuggestionJob(issueId: string, actorId: string, instruction?: string) {
    return this.database.mutate((db) => {
      const issue = this.mustFindIssue(db, issueId);
      const now = new Date().toISOString();
      const job = {
        id: createId("job"),
        type: "impact_suggestion" as const,
        status: "queued" as const,
        projectId: issue.projectId,
        documentId: issue.targetDocumentId,
        input: { issueId, instruction: instruction?.trim() || undefined },
        createdBy: actorId,
        createdAt: now,
        updatedAt: now,
      };
      db.jobs.push(job);
      return job;
    });
  }

  /** 构建建议生成的 LLM 提示词 */
  async buildSuggestionPrompt(issueId: string): Promise<{ system: string; prompt: string; projectId: string }> {
    return this.database.query((db) => {
      const issue = this.mustFindIssue(db, issueId);
      const targetVersion = db.versions.find((version) => version.id === issue.targetVersionId);
      const previousSource = issue.previousSourceVersionId ? db.versions.find((version) => version.id === issue.previousSourceVersionId) : undefined;
      const changedSource = db.versions.find((version) => version.id === issue.changedSourceVersionId);
      const targets = db.impactTargets.filter((target) => target.issueId === issue.id);
      return {
        projectId: issue.projectId,
        system: "You are a professional film production script supervisor. Analyze upstream changes and propose a safe candidate update. Return JSON with summary and suggestedContent.",
        prompt: [
          `Impact issue: ${issue.title}`,
          issue.summary,
          "",
          "Previous source version:",
          JSON.stringify(previousSource?.content ?? null, null, 2).slice(0, 5000),
          "",
          "Changed source version:",
          JSON.stringify(changedSource?.content ?? null, null, 2).slice(0, 5000),
          "",
          "Target content:",
          JSON.stringify(targetVersion?.content ?? null, null, 2).slice(0, 8000),
          "",
          "Targets:",
          JSON.stringify(targets, null, 2),
          "",
          "Return JSON: { \"summary\": string, \"suggestedContent\": any }.",
        ].join("\n"),
      };
    });
  }

  /** 存储生成的影响建议记录 */
  async storeSuggestion(input: {
    issueId: string;
    actorId: string;
    summary: string;
    suggestedContent?: unknown;
    promptSnapshot?: string;
    provider?: string;
    model?: string;
    createdJobId?: string;
  }): Promise<ImpactSuggestionRecord> {
    return this.database.mutate((db) => {
      const issue = this.mustFindIssue(db, input.issueId);
      const suggestion: ImpactSuggestionRecord = {
        id: createId("impact_suggestion"),
        issueId: issue.id,
        projectId: issue.projectId,
        status: "generated",
        summary: input.summary,
        suggestedContent: input.suggestedContent,
        promptSnapshot: input.promptSnapshot,
        provider: input.provider,
        model: input.model,
        createdJobId: input.createdJobId,
        createdBy: input.actorId,
        createdAt: new Date().toISOString(),
      };
      db.impactSuggestions.push(suggestion);
      issue.status = "suggested";
      issue.latestSuggestionId = suggestion.id;
      issue.updatedAt = new Date().toISOString();
      this.appendEvent(db, issue, "suggestion_created", input.actorId, input.summary);
      return suggestion;
    });
  }

  /** 接受影响建议：创建候选版本并更新状态 */
  async acceptSuggestion(suggestionId: string, actorId: string) {
    return this.database.mutate((db) => {
      const suggestion = db.impactSuggestions.find((item) => item.id === suggestionId);
      if (!suggestion) throw new NotFoundException("Impact suggestion not found");
      const issue = this.mustFindIssue(db, suggestion.issueId);
      if (suggestion.status !== "generated") {
        throw new BadRequestException("Only generated suggestions can be accepted");
      }
      if (!canTransitionImpactIssueStatus(issue.status, "accepted")) {
        throw new BadRequestException(`Cannot accept suggestion while impact issue is ${issue.status}`);
      }

      const targetDocument = db.documents.find((document) => document.id === issue.targetDocumentId);
      const targetVersion = db.versions.find((version) => version.id === issue.targetVersionId);
      if (!targetDocument || !targetVersion) {
        throw new NotFoundException("Suggestion target is not available");
      }

      const siblingVersions = db.versions.filter((version) => version.documentId === targetDocument.id);
      const nextVersionNumber = siblingVersions.reduce((max, version) => Math.max(max, version.versionNumber), 0) + 1;
      const now = new Date().toISOString();
      const createdVersion: VersionRecord = {
        id: createId("version"),
        documentId: targetDocument.id,
        versionNumber: nextVersionNumber,
        status: "draft",
        title: `${targetVersion.title} - Impact candidate`,
        content: suggestion.suggestedContent ?? targetVersion.content,
        metadata: {
          ...(targetVersion.metadata ?? {}),
          source: "impact-suggestion",
          impactIssueId: issue.id,
          impactSuggestionId: suggestion.id,
        },
        parentVersionId: targetVersion.id,
        createdBy: actorId,
        createdAt: now,
      };
      db.versions.push(createdVersion);
      for (const dependency of db.versionDependencies.filter((item) => item.targetVersionId === targetVersion.id)) {
        db.versionDependencies.push({
          ...dependency,
          id: createId("dependency"),
          targetDocumentId: targetDocument.id,
          targetVersionId: createdVersion.id,
          targetDocumentType: targetDocument.type,
          dependencyType: "manual_inherited",
          createdBy: actorId,
          createdAt: now,
        });
      }
      targetDocument.draftVersionId = createdVersion.id;
      targetDocument.updatedAt = now;

      suggestion.status = "accepted";
      suggestion.createdVersionId = createdVersion.id;
      suggestion.createdDocumentId = targetDocument.id;
      suggestion.acceptedBy = actorId;
      suggestion.acceptedAt = now;
      issue.status = "accepted";
      issue.acceptedSuggestionId = suggestion.id;
      issue.updatedAt = now;
      this.appendEvent(db, issue, "suggestion_accepted", actorId, `Created candidate version V${createdVersion.versionNumber}`);
      return { issue, suggestion, createdVersion };
    });
  }

  /** 撤回已接受的影响建议 */
  async revertSuggestionAcceptance(suggestionId: string, actorId: string) {
    return this.database.mutate((db) => {
      const suggestion = db.impactSuggestions.find((item) => item.id === suggestionId);
      if (!suggestion) throw new NotFoundException("Impact suggestion not found");
      const issue = this.mustFindIssue(db, suggestion.issueId);
      if (suggestion.status !== "accepted") {
        throw new BadRequestException("Only accepted suggestions can be reverted");
      }

      const now = new Date().toISOString();
      suggestion.status = "acceptance_reverted";
      suggestion.revertedBy = actorId;
      suggestion.revertedAt = now;
      issue.status = "suggested";
      issue.acceptedSuggestionId = undefined;
      issue.updatedAt = now;
      this.appendEvent(db, issue, "acceptance_reverted", actorId, "Suggestion acceptance reverted");
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
