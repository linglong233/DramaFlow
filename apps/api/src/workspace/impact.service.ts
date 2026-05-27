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
import { Prisma, type VersionDependency } from "@prisma/client";
import {
  canTransitionImpactIssueStatus,
  isActiveImpactIssueStatus,
  type DependencyAnchorType,
  type DependencyType,
  type DocumentRecord,
  type ImpactIssueDetailResponse,
  type ImpactIssueEventRecord,
  type ImpactIssueRecord,
  type ImpactIssueStatus,
  type ImpactSeverity,
  type ImpactSuggestionRecord,
  type ImpactTargetRecord,
  type ImpactTargetType,
  type LlmConfigSource,
  type ProjectImpactIssuesQuery,
  type ProjectImpactIssuesResponse,
  type PromptSnapshotRecord,
  type VersionDependencyRecord,
  type VersionImpactSummary,
  type VersionRecord,
} from "@dramaflow/shared";

import { PrismaService } from "../common/prisma.service";
import { jsonInput, jsonOutput, iso, optionalIso } from "../common/prisma-json";
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
    @Inject(PrismaService) private readonly prisma: PrismaService,
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
    // 构建动态 where 条件
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const where: Prisma.ImpactIssueWhereInput = { projectId } as any;

    if (query.status) where.status = query.status;
    if (query.severity) where.severity = query.severity;
    if (query.assignedTo) where.assignedTo = query.assignedTo;

    if (query.targetType) {
      const matchingIssueIds = await this.prisma.impactTarget.findMany({
        where: { projectId, targetType: query.targetType },
        select: { issueId: true },
      });
      const issueIds = [...new Set(matchingIssueIds.map((t) => t.issueId))];
      where.id = { in: issueIds };
    }

    if (query.targetDocumentType) {
      const matchingDocIds = await this.prisma.document.findMany({
        where: { projectId, type: query.targetDocumentType } as Prisma.DocumentWhereInput,
        select: { id: true },
      });
      const docIds = matchingDocIds.map((d) => d.id);
      where.targetDocumentId = { in: docIds };
    }

    const offset = query.offset ?? 0;
    const limit = query.limit ?? 50;

    const [issues, total] = await this.prisma.$transaction([
      this.prisma.impactIssue.findMany({
        where,
        orderBy: { updatedAt: "desc" },
        skip: offset,
        take: limit,
      }),
      this.prisma.impactIssue.count({ where }),
    ]);

    const mapped = [];
    for (const issue of issues) {
      mapped.push(await this.toIssueSummary(issue));
    }

    return { issues: mapped, total };
  }

  /** 获取单个影响议题的完整详情（含目标、建议、事件、依赖） */
  async getIssueDetail(
    issueId: string,
  ): Promise<ImpactIssueDetailResponse> {
    const issue = await this.prisma.impactIssue.findUnique({
      where: { id: issueId },
    });
    if (!issue) throw new NotFoundException("Impact issue not found");
    return this.buildIssueDetail(issue);
  }

  /** 获取版本影响摘要（统计 + 最新议题） */
  async getVersionImpactSummary(
    versionId: string,
  ): Promise<VersionImpactSummary> {
    await this.mustFindVersionProjectId(versionId);
    return this.buildVersionImpactSummary(versionId);
  }

  /** 根据议题 ID 获取所属项目 ID（用于鉴权） */
  async getIssueProjectId(issueId: string): Promise<string> {
    const issue = await this.mustFindIssue(issueId);
    return issue.projectId;
  }

  /** 根据版本 ID 获取所属项目 ID（用于鉴权） */
  async getVersionProjectId(versionId: string): Promise<string> {
    return this.mustFindVersionProjectId(versionId);
  }

  /** 根据建议 ID 获取所属项目 ID（用于鉴权） */
  async getSuggestionProjectId(suggestionId: string): Promise<string> {
    const suggestion = await this.prisma.impactSuggestion.findUnique({
      where: { id: suggestionId },
    });
    if (!suggestion)
      throw new NotFoundException("Impact suggestion not found");
    return suggestion.projectId;
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
    return this.prisma.$transaction(async (tx) => {
      const issue = await this.mustFindIssueTx(tx, issueId);
      await tx.impactIssue.update({
        where: { id: issueId },
        data: {
          assignedTo: assignedTo?.trim() || null,
          updatedAt: new Date(),
        },
      });
      await this.appendEventTx(tx, issue, "assigned", actorId, assignedTo ? `Assigned to ${assignedTo}` : "Assignment cleared");
      const updated = await tx.impactIssue.findUnique({ where: { id: issueId } });
      return this.buildIssueDetail(updated!);
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
    return this.prisma.$transaction(async (tx) => {
      const issue = await this.mustFindIssueTx(tx, issueId);
      if (!canTransitionImpactIssueStatus(issue.status as ImpactIssueStatus, nextStatus)) {
        throw new BadRequestException(
          `Cannot move impact issue from ${issue.status} to ${nextStatus}`,
        );
      }

      const now = new Date();

      const updateData: Prisma.ImpactIssueUpdateInput = {
        status: nextStatus,
        updatedAt: now,
      };

      // 忽略时记录忽略人和原因
      if (nextStatus === "ignored") {
        updateData.ignoredBy = actorId;
        updateData.ignoredAt = now;
        updateData.ignoreReason = note?.trim() || null;
      }

      // 解决时记录解决人和备注
      if (nextStatus === "resolved") {
        updateData.resolvedBy = actorId;
        updateData.resolvedAt = now;
        updateData.resolveNote = note?.trim() || null;
      }

      // 重新打开时清除所有关闭态字段，回退已接受的建议
      if (nextStatus === "open") {
        updateData.ignoredBy = null;
        updateData.ignoredAt = null;
        updateData.ignoreReason = null;
        updateData.resolvedBy = null;
        updateData.resolvedAt = null;
        updateData.resolveNote = null;
        if (issue.acceptedSuggestionId) {
          const acceptedSuggestion = await tx.impactSuggestion.findUnique({
            where: { id: issue.acceptedSuggestionId },
          });
          if (acceptedSuggestion?.status === "accepted") {
            await tx.impactSuggestion.update({
              where: { id: acceptedSuggestion.id },
              data: {
                status: "acceptance_reverted",
                revertedBy: actorId,
                revertedAt: now,
              },
            });
          }
          updateData.acceptedSuggestionId = null;
        }
      }

      await tx.impactIssue.update({
        where: { id: issueId },
        data: updateData,
      });

      await this.appendEventTx(tx, issue, eventType, actorId, note);

      const updated = await tx.impactIssue.findUnique({ where: { id: issueId } });
      return this.buildIssueDetail(updated!);
    });
  }

  // ─── 依赖记录与影响扫描 ─────────────────────────────────────────

  /** 记录版本的依赖关系：根据 metadata 中的来源版本建立依赖链 */
  async recordDependenciesForVersion(versionId: string): Promise<VersionDependencyRecord[]> {
    return this.prisma.$transaction(async (tx) => {
      const version = await tx.version.findUnique({ where: { id: versionId } });
      if (!version) return [];
      const document = await tx.document.findUnique({ where: { id: version.documentId } });
      if (!document) return [];

      // 删除目标版本的已有依赖
      await tx.versionDependency.deleteMany({
        where: { targetVersionId: versionId },
      });

      const metadata = jsonOutput<Record<string, unknown>>(version.metadata) ?? {};
      const created: VersionDependencyRecord[] = [];

      const add = async (
        sourceVersionId: string | undefined,
        dependencyType: DependencyType,
        targetAnchorType?: VersionDependencyRecord["targetAnchorType"],
        targetAnchorId?: string,
        sourceSnapshotHash?: string,
        targetSnapshotHash?: string,
      ) => {
        if (!sourceVersionId) return;
        const sourceVersion = await tx.version.findUnique({ where: { id: sourceVersionId } });
        const sourceDocument = sourceVersion ? await tx.document.findUnique({ where: { id: sourceVersion.documentId } }) : null;
        const now = new Date();
        const dependency = await tx.versionDependency.create({
          data: {
            id: createId("dependency"),
            projectId: document.projectId,
            sourceDocumentId: sourceDocument?.id ?? null,
            sourceVersionId,
            sourceDocumentType: sourceDocument?.type ?? null,
            targetDocumentId: document.id,
            targetVersionId: version.id,
            targetDocumentType: document.type,
            dependencyType,
            targetAnchorType: targetAnchorType ?? null,
            targetAnchorId: targetAnchorId ?? null,
            sourceSnapshotHash: sourceSnapshotHash ?? null,
            targetSnapshotHash: targetSnapshotHash ?? null,
            promptSnapshot: jsonInput(this.normalizePromptSnapshot(metadata.promptSnapshot)),
            provider: typeof metadata.provider === "string" ? metadata.provider : null,
            model: typeof metadata.model === "string" ? metadata.model : null,
            configSource: metadata.llmConfigSource === "team" || metadata.llmConfigSource === "personal" ? metadata.llmConfigSource : null,
            createdBy: version.createdBy,
            createdAt: now,
          },
        });
        created.push(this.mapDependency(dependency));
      };

      await add(metadata.sourceWorldBibleVersionId as string | undefined, document.type === "synopsis" ? "world_bible_to_synopsis" : document.type === "script" ? "world_bible_to_script" : "world_bible_to_storyboard");
      await add(metadata.sourceSynopsisVersionId as string | undefined, "synopsis_to_script");
      await add(metadata.sourceScriptVersionId as string | undefined, "script_to_storyboard");
      await add(
        metadata.sourceStoryboardVersionId as string | undefined,
        "storyboard_to_media",
        "shot",
        metadata.shotId as string | undefined,
        metadata.sourceShotHash as string | undefined,
        metadata.targetSnapshotHash as string | undefined,
      );

      if (created.length === 0 && metadata.source === "restore" && typeof metadata.restoredFromVersionId === "string") {
        const inherited = await tx.versionDependency.findMany({
          where: { targetVersionId: metadata.restoredFromVersionId },
        });
        for (const dependency of inherited) {
          const copy = await tx.versionDependency.create({
            data: {
              id: createId("dependency"),
              projectId: dependency.projectId,
              sourceDocumentId: dependency.sourceDocumentId,
              sourceVersionId: dependency.sourceVersionId,
              sourceDocumentType: dependency.sourceDocumentType,
              targetDocumentId: document.id,
              targetVersionId: version.id,
              targetDocumentType: document.type,
              dependencyType: "manual_inherited",
              targetAnchorType: dependency.targetAnchorType,
              targetAnchorId: dependency.targetAnchorId,
              sourceSnapshotHash: dependency.sourceSnapshotHash,
              targetSnapshotHash: dependency.targetSnapshotHash,
              promptSnapshot: dependency.promptSnapshot != null ? jsonInput(jsonOutput(dependency.promptSnapshot)) : undefined,
              provider: dependency.provider,
              model: dependency.model,
              configSource: dependency.configSource,
              createdBy: version.createdBy,
              createdAt: new Date(),
            },
          });
          created.push(this.mapDependency(copy));
        }
      }

      // 仅用于审计追溯，scanAfterAdoption 要求 sourceVersionId 有值，因此 manual_unlinked 不会触发影响扫描
      if (created.length === 0) {
        const dependency = await tx.versionDependency.create({
          data: {
            id: createId("dependency"),
            projectId: document.projectId,
            sourceDocumentId: null,
            sourceVersionId: null,
            sourceDocumentType: null,
            targetDocumentId: document.id,
            targetVersionId: version.id,
            targetDocumentType: document.type,
            dependencyType: "manual_unlinked",
            targetAnchorType: null,
            targetAnchorId: null,
            sourceSnapshotHash: null,
            targetSnapshotHash: null,
            promptSnapshot: Prisma.DbNull,
            provider: null,
            model: null,
            configSource: null,
            createdBy: version.createdBy,
            createdAt: new Date(),
          },
        });
        created.push(this.mapDependency(dependency));
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
    return this.prisma.$transaction(async (tx) => {
      const sourceDocument = await tx.document.findUnique({
        where: { id: input.sourceDocumentId },
      });
      if (!sourceDocument) return [];

      const dependencies = await tx.versionDependency.findMany({
        where: {
          projectId: input.projectId,
          sourceVersionId: { not: null },
          sourceDocumentId: input.sourceDocumentId,
        },
      });

      // 过滤 sourceVersionId 不等于 changedSourceVersionId
      const filtered = dependencies.filter(
        (d) => d.sourceVersionId && d.sourceVersionId !== input.changedSourceVersionId,
      );

      const created: ImpactIssueRecord[] = [];
      for (const dependency of filtered) {
        const targetVersion = await tx.version.findUnique({
          where: { id: dependency.targetVersionId },
        });
        const targetDocument = await tx.document.findUnique({
          where: { id: dependency.targetDocumentId },
        });
        if (!targetVersion || !targetDocument) continue;

        const activeTarget =
          targetDocument.currentVersionId === targetVersion.id
          || targetDocument.draftVersionId === targetVersion.id
          || targetDocument.type === "image"
          || targetDocument.type === "video"
          || targetDocument.type === "audio"
          || targetDocument.type === "subtitle";
        if (!activeTarget) continue;

        const title = this.buildIssueTitle(this.mapDocument(targetDocument), this.mapDocument(targetDocument), this.mapVersion(targetVersion));
        const summary = `当前 ${sourceDocument.type} 版本从 ${dependency.sourceVersionId} 变更为 ${input.changedSourceVersionId}。${targetDocument.title} V${targetVersion.versionNumber} 基于旧版来源创建。`;
        const issue = await this.createOrUpdateImpactIssueTx(tx, {
          projectId: input.projectId,
          dependencyId: dependency.id,
          sourceDocumentId: sourceDocument.id,
          previousSourceVersionId: dependency.sourceVersionId ?? undefined,
          changedSourceVersionId: input.changedSourceVersionId,
          targetDocumentId: targetDocument.id,
          targetVersionId: targetVersion.id,
          dependencyType: dependency.dependencyType as DependencyType,
          severity: this.resolveSeverity(this.mapDependency(dependency), this.mapDocument(targetDocument), this.mapVersion(targetVersion)),
          title,
          summary,
          targets: [{
            targetType: dependency.targetAnchorType === "shot" ? "shot" : "version",
            documentId: targetDocument.id,
            versionId: targetVersion.id,
            anchorId: dependency.targetAnchorId ?? undefined,
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
  private async createOrUpdateImpactIssueTx(
    tx: Prisma.TransactionClient,
    input: CreateImpactInput,
  ): Promise<ImpactIssueRecord> {
    const target = input.targets[0];

    // 查找匹配的已有议题
    const existingIssues = await tx.impactIssue.findMany({
      where: {
        projectId: input.projectId,
        dependencyId: input.dependencyId ?? null,
        changedSourceVersionId: input.changedSourceVersionId,
        targetVersionId: input.targetVersionId,
      },
      include: { targets: true },
    });

    const existing = existingIssues.find((issue) =>
      issue.targets.some((t) =>
        t.targetType === target.targetType
        && t.anchorId === (target.anchorId ?? null),
      ),
    );

    const now = new Date();
    if (existing) {
      const updateData: Prisma.ImpactIssueUpdateInput = {
        title: input.title,
        summary: input.summary,
        severity: input.severity,
        updatedAt: now,
      };
      if (!isActiveImpactIssueStatus(existing.status as ImpactIssueStatus) && existing.status !== "ignored") {
        updateData.status = "open";
      }
      await tx.impactIssue.update({
        where: { id: existing.id },
        data: updateData,
      });
      await this.appendEventTx(tx, { id: existing.id, projectId: existing.projectId } as ImpactIssueRecord, "created", input.actorId, "来源变更后影响刷新");
      const updated = await tx.impactIssue.findUnique({ where: { id: existing.id } });
      return this.mapIssue(updated!);
    }

    const issue = await tx.impactIssue.create({
      data: {
        id: createId("impact"),
        projectId: input.projectId,
        dependencyId: input.dependencyId ?? null,
        sourceDocumentId: input.sourceDocumentId ?? null,
        previousSourceVersionId: input.previousSourceVersionId ?? null,
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
      },
    });

    for (const targetInput of input.targets) {
      await tx.impactTarget.create({
        data: {
          id: createId("impact_target"),
          issueId: issue.id,
          projectId: input.projectId,
          targetType: targetInput.targetType,
          documentId: targetInput.documentId ?? null,
          versionId: targetInput.versionId ?? null,
          anchorId: targetInput.anchorId ?? null,
          label: targetInput.label ?? null,
          createdAt: now,
        },
      });
    }

    await this.appendEventTx(tx, this.mapIssue(issue), "created", input.actorId, input.summary);
    return this.mapIssue(issue);
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
    const issue = await this.mustFindIssue(issueId);
    const now = new Date();
    const job = await this.prisma.job.create({
      data: {
        id: createId("job"),
        type: "impact_suggestion",
        status: "queued",
        projectId: issue.projectId,
        documentId: issue.targetDocumentId,
        input: jsonInput({ issueId, instruction: instruction?.trim() || undefined }),
        createdBy: actorId,
        createdAt: now,
        updatedAt: now,
      },
    });
    return {
      id: job.id,
      type: job.type as "impact_suggestion",
      status: job.status as "queued",
      projectId: job.projectId,
      documentId: job.documentId ?? undefined,
      input: jsonOutput<{ issueId: string; instruction?: string }>(job.input),
      createdBy: job.createdBy,
      createdAt: iso(job.createdAt),
      updatedAt: iso(job.updatedAt),
    };
  }

  /** 构建建议生成的 LLM 提示词 */
  async buildSuggestionPrompt(issueId: string): Promise<{ system: string; prompt: string; projectId: string }> {
    const issue = await this.mustFindIssue(issueId);

    const [targetVersion, previousSource, changedSource, targets] = await Promise.all([
      this.prisma.version.findUnique({ where: { id: issue.targetVersionId } }),
      issue.previousSourceVersionId
        ? this.prisma.version.findUnique({ where: { id: issue.previousSourceVersionId } })
        : Promise.resolve(null),
      this.prisma.version.findUnique({ where: { id: issue.changedSourceVersionId } }),
      this.prisma.impactTarget.findMany({ where: { issueId: issue.id } }),
    ]);

    const mappedTargets = targets.map((t) => ({
      id: t.id,
      issueId: t.issueId,
      projectId: t.projectId,
      targetType: t.targetType as ImpactTargetType,
      documentId: t.documentId ?? undefined,
      versionId: t.versionId ?? undefined,
      anchorId: t.anchorId ?? undefined,
      label: t.label ?? undefined,
      createdAt: iso(t.createdAt),
    }));

    return {
      projectId: issue.projectId,
      system: "You are a professional film production script supervisor. Analyze upstream changes and propose a safe candidate update. Return JSON with summary and suggestedContent.",
      prompt: [
        `Impact issue: ${issue.title}`,
        issue.summary,
        "",
        "Previous source version:",
        JSON.stringify(previousSource ? jsonOutput(previousSource.content) : null, null, 2).slice(0, 5000),
        "",
        "Changed source version:",
        JSON.stringify(changedSource ? jsonOutput(changedSource.content) : null, null, 2).slice(0, 5000),
        "",
        "Target content:",
        JSON.stringify(targetVersion ? jsonOutput(targetVersion.content) : null, null, 2).slice(0, 8000),
        "",
        "Targets:",
        JSON.stringify(mappedTargets, null, 2),
        "",
        "Return JSON: { \"summary\": string, \"suggestedContent\": any }.",
      ].join("\n"),
    };
  }

  /** 存储生成的影响建议记录 */
  async storeSuggestion(input: {
    issueId: string;
    actorId: string;
    summary: string;
    suggestedContent?: unknown;
    promptSnapshot?: PromptSnapshotRecord;
    provider?: string;
    model?: string;
    createdJobId?: string;
  }): Promise<ImpactSuggestionRecord> {
    return this.prisma.$transaction(async (tx) => {
      const issue = await this.mustFindIssueTx(tx, input.issueId);
      const now = new Date();
      const suggestion = await tx.impactSuggestion.create({
        data: {
          id: createId("impact_suggestion"),
          issueId: issue.id,
          projectId: issue.projectId,
          status: "generated",
          summary: input.summary,
          suggestedContent: input.suggestedContent ? jsonInput(input.suggestedContent) : Prisma.DbNull,
          promptSnapshot: input.promptSnapshot ? jsonInput(input.promptSnapshot) : Prisma.DbNull,
          provider: input.provider ?? null,
          model: input.model ?? null,
          createdJobId: input.createdJobId ?? null,
          createdBy: input.actorId,
          createdAt: now,
        },
      });

      await tx.impactIssue.update({
        where: { id: issue.id },
        data: {
          status: "suggested",
          latestSuggestionId: suggestion.id,
          updatedAt: now,
        },
      });

      await this.appendEventTx(tx, issue, "suggestion_created", input.actorId, input.summary);

      return this.mapSuggestion(suggestion);
    });
  }

  /** 接受影响建议：创建候选版本并更新状态 */
  async acceptSuggestion(suggestionId: string, actorId: string) {
    return this.prisma.$transaction(async (tx) => {
      const suggestion = await tx.impactSuggestion.findUnique({
        where: { id: suggestionId },
      });
      if (!suggestion) throw new NotFoundException("Impact suggestion not found");
      const issue = await this.mustFindIssueTx(tx, suggestion.issueId);
      if (suggestion.status !== "generated") {
        throw new BadRequestException("Only generated suggestions can be accepted");
      }
      if (!canTransitionImpactIssueStatus(issue.status as ImpactIssueStatus, "accepted")) {
        throw new BadRequestException(`Cannot accept suggestion while impact issue is ${issue.status}`);
      }

      const targetDocument = await tx.document.findUnique({
        where: { id: issue.targetDocumentId },
      });
      const targetVersion = await tx.version.findUnique({
        where: { id: issue.targetVersionId },
      });
      if (!targetDocument || !targetVersion) {
        throw new NotFoundException("Suggestion target is not available");
      }

      // 计算下一个版本号
      const siblingVersions = await tx.version.findMany({
        where: { documentId: targetDocument.id },
        select: { versionNumber: true },
      });
      const nextVersionNumber = siblingVersions.reduce((max, v) => Math.max(max, v.versionNumber), 0) + 1;
      const now = new Date();

      const targetContent = jsonOutput(targetVersion.content);
      const suggestedContent = jsonOutput(suggestion.suggestedContent);
      const targetMetadata = jsonOutput<Record<string, unknown>>(targetVersion.metadata) ?? {};

      // 创建候选版本
      const createdVersion = await tx.version.create({
        data: {
          id: createId("version"),
          documentId: targetDocument.id,
          versionNumber: nextVersionNumber,
          status: "draft",
          title: `${targetVersion.title} - Impact candidate`,
          content: jsonInput(suggestedContent ?? targetContent),
          metadata: jsonInput({
            ...targetMetadata,
            source: "impact-suggestion",
            impactIssueId: issue.id,
            impactSuggestionId: suggestion.id,
          }),
          parentVersionId: targetVersion.id,
          createdBy: actorId,
          createdAt: now,
        },
      });

      // 复制依赖关系
      const existingDeps = await tx.versionDependency.findMany({
        where: { targetVersionId: targetVersion.id },
      });
      for (const dep of existingDeps) {
        await tx.versionDependency.create({
          data: {
            id: createId("dependency"),
            projectId: dep.projectId,
            sourceDocumentId: dep.sourceDocumentId,
            sourceVersionId: dep.sourceVersionId,
            sourceDocumentType: dep.sourceDocumentType,
            targetDocumentId: targetDocument.id,
            targetVersionId: createdVersion.id,
            targetDocumentType: targetDocument.type,
            dependencyType: "manual_inherited",
            targetAnchorType: dep.targetAnchorType,
            targetAnchorId: dep.targetAnchorId,
            sourceSnapshotHash: dep.sourceSnapshotHash,
            targetSnapshotHash: dep.targetSnapshotHash,
            promptSnapshot: dep.promptSnapshot != null ? jsonInput(jsonOutput(dep.promptSnapshot)) : undefined,
            provider: dep.provider,
            model: dep.model,
            configSource: dep.configSource,
            createdBy: actorId,
            createdAt: now,
          },
        });
      }

      // 更新文档草稿版本
      await tx.document.update({
        where: { id: targetDocument.id },
        data: { draftVersionId: createdVersion.id, updatedAt: now },
      });

      // 更新建议状态
      await tx.impactSuggestion.update({
        where: { id: suggestion.id },
        data: {
          status: "accepted",
          createdVersionId: createdVersion.id,
          createdDocumentId: targetDocument.id,
          acceptedBy: actorId,
          acceptedAt: now,
        },
      });

      // 更新议题状态
      await tx.impactIssue.update({
        where: { id: issue.id },
        data: {
          status: "accepted",
          acceptedSuggestionId: suggestion.id,
          updatedAt: now,
        },
      });

      await this.appendEventTx(tx, issue, "suggestion_accepted", actorId, `Created candidate version V${createdVersion.versionNumber}`);

      const updatedIssue = await tx.impactIssue.findUnique({ where: { id: issue.id } });
      return {
        issue: this.mapIssue(updatedIssue!),
        suggestion: this.mapSuggestion(suggestion),
        createdVersion: this.mapVersion(createdVersion),
      };
    });
  }

  /** 撤回已接受的影响建议 */
  async revertSuggestionAcceptance(suggestionId: string, actorId: string) {
    return this.prisma.$transaction(async (tx) => {
      const suggestion = await tx.impactSuggestion.findUnique({
        where: { id: suggestionId },
      });
      if (!suggestion) throw new NotFoundException("Impact suggestion not found");
      const issue = await this.mustFindIssueTx(tx, suggestion.issueId);
      if (suggestion.status !== "accepted") {
        throw new BadRequestException("Only accepted suggestions can be reverted");
      }

      const now = new Date();
      await tx.impactSuggestion.update({
        where: { id: suggestionId },
        data: {
          status: "acceptance_reverted",
          revertedBy: actorId,
          revertedAt: now,
        },
      });

      await tx.impactIssue.update({
        where: { id: issue.id },
        data: {
          status: "suggested",
          acceptedSuggestionId: null,
          updatedAt: now,
        },
      });

      await this.appendEventTx(tx, issue, "acceptance_reverted", actorId, "Suggestion acceptance reverted");

      const updatedIssue = await tx.impactIssue.findUnique({ where: { id: issue.id } });
      return this.buildIssueDetail(updatedIssue!);
    });
  }

  // ─── 摘要与辅助方法 ──────────────────────────────────────────

  /** 将议题记录转为列表摘要（包含目标列表） */
  private async toIssueSummary(issue: { id: string; projectId: string; dependencyType: string; status: string; severity: string; title: string; summary: string; assignedTo: string | null; changedSourceVersionId: string; targetDocumentId: string; targetVersionId: string; latestSuggestionId: string | null; acceptedSuggestionId: string | null; createdAt: Date; updatedAt: Date }) {
    const targets = await this.prisma.impactTarget.findMany({
      where: { issueId: issue.id },
    });
    return {
      id: issue.id,
      projectId: issue.projectId,
      dependencyType: issue.dependencyType as DependencyType,
      status: issue.status as ImpactIssueStatus,
      severity: issue.severity as ImpactSeverity,
      title: issue.title,
      summary: issue.summary,
      assignedTo: issue.assignedTo ?? undefined,
      changedSourceVersionId: issue.changedSourceVersionId,
      targetDocumentId: issue.targetDocumentId,
      targetVersionId: issue.targetVersionId,
      latestSuggestionId: issue.latestSuggestionId ?? undefined,
      acceptedSuggestionId: issue.acceptedSuggestionId ?? undefined,
      createdAt: iso(issue.createdAt),
      updatedAt: iso(issue.updatedAt),
      targets: targets.map((t) => ({
        id: t.id,
        issueId: t.issueId,
        projectId: t.projectId,
        targetType: t.targetType as ImpactTargetType,
        documentId: t.documentId ?? undefined,
        versionId: t.versionId ?? undefined,
        anchorId: t.anchorId ?? undefined,
        label: t.label ?? undefined,
        createdAt: iso(t.createdAt),
      })),
    };
  }

  /** 构建影响议题完整详情（含目标、建议、事件、依赖） */
  private async buildIssueDetail(
    issue: { id: string; projectId: string; dependencyId: string | null; sourceDocumentId: string | null; previousSourceVersionId: string | null; changedSourceVersionId: string; targetDocumentId: string; targetVersionId: string; dependencyType: string; status: string; severity: string; title: string; summary: string; assignedTo: string | null; latestSuggestionId: string | null; acceptedSuggestionId: string | null; ignoredBy: string | null; ignoredAt: Date | null; ignoreReason: string | null; resolvedBy: string | null; resolvedAt: Date | null; resolveNote: string | null; createdBy: string; createdAt: Date; updatedAt: Date },
  ): Promise<ImpactIssueDetailResponse> {
    const [targets, suggestions, events, dependencies] = await Promise.all([
      this.prisma.impactTarget.findMany({ where: { issueId: issue.id } }),
      this.prisma.impactSuggestion.findMany({ where: { issueId: issue.id } }),
      this.prisma.impactIssueEvent.findMany({ where: { issueId: issue.id } }),
      issue.dependencyId
        ? this.prisma.versionDependency.findMany({ where: { id: issue.dependencyId } })
        : Promise.resolve([]),
    ]);

    return {
      issue: this.mapIssue(issue),
      targets: targets.map((t) => ({
        id: t.id,
        issueId: t.issueId,
        projectId: t.projectId,
        targetType: t.targetType as ImpactTargetType,
        documentId: t.documentId ?? undefined,
        versionId: t.versionId ?? undefined,
        anchorId: t.anchorId ?? undefined,
        label: t.label ?? undefined,
        createdAt: iso(t.createdAt),
      })),
      suggestions: suggestions.map((s) => this.mapSuggestion(s)),
      events: events.map((e) => ({
        id: e.id,
        issueId: e.issueId,
        projectId: e.projectId,
        type: e.type as ImpactIssueEventRecord["type"],
        actorId: e.actorId,
        note: e.note ?? undefined,
        createdAt: iso(e.createdAt),
      })),
      dependencies: dependencies.map((d) => this.mapDependency(d)),
    };
  }

  /** 构建版本影响摘要（公开方法，供 WorkspaceService 调用） */
  async buildVersionImpactSummary(
    versionId: string,
  ): Promise<VersionImpactSummary> {
    const [issues, dependencies] = await Promise.all([
      this.prisma.impactIssue.findMany({
        where: { targetVersionId: versionId },
      }),
      this.prisma.versionDependency.findMany({
        where: { targetVersionId: versionId },
      }),
    ]);

    const summaries = [];
    const sortedIssues = [...issues].sort((left, right) =>
      right.updatedAt.getTime() - left.updatedAt.getTime(),
    );
    for (const issue of sortedIssues.slice(0, 5)) {
      summaries.push(await this.toIssueSummary(issue));
    }

    return {
      versionId,
      dependencies: dependencies.map((d) => this.mapDependency(d)),
      openCount: issues.filter((issue) => issue.status === "open").length,
      suggestedCount: issues.filter((issue) => issue.status === "suggested").length,
      acceptedCount: issues.filter((issue) => issue.status === "accepted").length,
      ignoredCount: issues.filter((issue) => issue.status === "ignored").length,
      resolvedCount: issues.filter((issue) => issue.status === "resolved").length,
      latestIssues: summaries,
    };
  }

  /** 标准化 promptSnapshot：接受字符串或对象 */
  private normalizePromptSnapshot(value: unknown): PromptSnapshotRecord | undefined {
    if (typeof value === "string") {
      return value;
    }
    if (value && typeof value === "object" && !Array.isArray(value)) {
      return value as Record<string, unknown>;
    }
    return undefined;
  }

  /** 追加影响议题事件记录（事务内） */
  private async appendEventTx(
    tx: Prisma.TransactionClient,
    issue: Pick<ImpactIssueRecord, "id" | "projectId">,
    type: ImpactIssueEventRecord["type"],
    actorId: string,
    note?: string,
  ): Promise<void> {
    await tx.impactIssueEvent.create({
      data: {
        id: createId("impact_event"),
        issueId: issue.id,
        projectId: issue.projectId,
        type,
        actorId,
        note: note?.trim() || null,
        createdAt: new Date(),
      },
    });
  }

  /** 查找影响议题，不存在则抛 404 */
  private async mustFindIssue(
    issueId: string,
  ): Promise<ImpactIssueRecord> {
    const issue = await this.prisma.impactIssue.findUnique({
      where: { id: issueId },
    });
    if (!issue) {
      throw new NotFoundException("Impact issue not found");
    }
    return this.mapIssue(issue);
  }

  /** 查找影响议题（事务内版本） */
  private async mustFindIssueTx(
    tx: Prisma.TransactionClient,
    issueId: string,
  ): Promise<ImpactIssueRecord> {
    const issue = await tx.impactIssue.findUnique({
      where: { id: issueId },
    });
    if (!issue) {
      throw new NotFoundException("Impact issue not found");
    }
    return this.mapIssue(issue);
  }

  /** 通过版本 ID 查找所属项目 ID，不存在则抛 404 */
  private async mustFindVersionProjectId(
    versionId: string,
  ): Promise<string> {
    const version = await this.prisma.version.findUnique({
      where: { id: versionId },
    });
    if (!version) {
      throw new NotFoundException("Version not found");
    }
    const document = await this.prisma.document.findUnique({
      where: { id: version.documentId },
    });
    if (!document) {
      throw new NotFoundException("Version document not found");
    }
    return document.projectId;
  }

  /** 映射 Prisma Issue 为共享类型 */
  private mapIssue(issue: {
    id: string; projectId: string; dependencyId: string | null;
    sourceDocumentId: string | null; previousSourceVersionId: string | null;
    changedSourceVersionId: string; targetDocumentId: string;
    targetVersionId: string; dependencyType: string; status: string;
    severity: string; title: string; summary: string;
    assignedTo: string | null; latestSuggestionId: string | null;
    acceptedSuggestionId: string | null; ignoredBy: string | null;
    ignoredAt: Date | null; ignoreReason: string | null;
    resolvedBy: string | null; resolvedAt: Date | null;
    resolveNote: string | null; createdBy: string;
    createdAt: Date; updatedAt: Date;
  }): ImpactIssueRecord {
    return {
      id: issue.id,
      projectId: issue.projectId,
      dependencyId: issue.dependencyId ?? undefined,
      sourceDocumentId: issue.sourceDocumentId ?? undefined,
      previousSourceVersionId: issue.previousSourceVersionId ?? undefined,
      changedSourceVersionId: issue.changedSourceVersionId,
      targetDocumentId: issue.targetDocumentId,
      targetVersionId: issue.targetVersionId,
      dependencyType: issue.dependencyType as DependencyType,
      status: issue.status as ImpactIssueStatus,
      severity: issue.severity as ImpactSeverity,
      title: issue.title,
      summary: issue.summary,
      assignedTo: issue.assignedTo ?? undefined,
      latestSuggestionId: issue.latestSuggestionId ?? undefined,
      acceptedSuggestionId: issue.acceptedSuggestionId ?? undefined,
      ignoredBy: issue.ignoredBy ?? undefined,
      ignoredAt: optionalIso(issue.ignoredAt),
      ignoreReason: issue.ignoreReason ?? undefined,
      resolvedBy: issue.resolvedBy ?? undefined,
      resolvedAt: optionalIso(issue.resolvedAt),
      resolveNote: issue.resolveNote ?? undefined,
      createdBy: issue.createdBy,
      createdAt: iso(issue.createdAt),
      updatedAt: iso(issue.updatedAt),
    };
  }

  /** 映射 Prisma Suggestion 为共享类型 */
  private mapSuggestion(suggestion: {
    id: string; issueId: string; projectId: string;
    status: string; summary: string; suggestedContent: unknown;
    promptSnapshot: unknown; provider: string | null; model: string | null;
    createdVersionId: string | null; createdDocumentId: string | null;
    createdJobId: string | null; acceptedBy: string | null;
    acceptedAt: Date | null; revertedBy: string | null;
    revertedAt: Date | null; createdBy: string; createdAt: Date;
  }): ImpactSuggestionRecord {
    return {
      id: suggestion.id,
      issueId: suggestion.issueId,
      projectId: suggestion.projectId,
      status: suggestion.status as ImpactSuggestionRecord["status"],
      summary: suggestion.summary,
      suggestedContent: jsonOutput(suggestion.suggestedContent) ?? undefined,
      promptSnapshot: jsonOutput<PromptSnapshotRecord>(suggestion.promptSnapshot) ?? undefined,
      provider: suggestion.provider ?? undefined,
      model: suggestion.model ?? undefined,
      createdVersionId: suggestion.createdVersionId ?? undefined,
      createdDocumentId: suggestion.createdDocumentId ?? undefined,
      createdJobId: suggestion.createdJobId ?? undefined,
      acceptedBy: suggestion.acceptedBy ?? undefined,
      acceptedAt: optionalIso(suggestion.acceptedAt),
      revertedBy: suggestion.revertedBy ?? undefined,
      revertedAt: optionalIso(suggestion.revertedAt),
      createdBy: suggestion.createdBy,
      createdAt: iso(suggestion.createdAt),
    };
  }

  /** 映射 Prisma Version 为共享类型 */
  private mapVersion(version: {
    id: string; documentId: string; versionNumber: number;
    status: string; title: string; content: unknown; metadata: unknown;
    parentVersionId: string | null; createdBy: string; createdAt: Date;
  }): VersionRecord {
    return {
      id: version.id,
      documentId: version.documentId,
      versionNumber: version.versionNumber,
      status: version.status as VersionRecord["status"],
      title: version.title,
      content: jsonOutput(version.content),
      metadata: jsonOutput(version.metadata) ?? undefined,
      parentVersionId: version.parentVersionId ?? undefined,
      createdBy: version.createdBy,
      createdAt: iso(version.createdAt),
    };
  }

  /** 映射 Prisma Document 为共享类型 */
  private mapDocument(document: {
    id: string; projectId: string; type: string; title: string;
    shotId: string | null; currentVersionId: string | null;
    draftVersionId: string | null; createdBy: string;
    createdAt: Date; updatedAt: Date;
  }): DocumentRecord {
    return {
      id: document.id,
      projectId: document.projectId,
      type: document.type as DocumentRecord["type"],
      title: document.title,
      shotId: document.shotId ?? undefined,
      currentVersionId: document.currentVersionId ?? undefined,
      draftVersionId: document.draftVersionId ?? undefined,
      createdBy: document.createdBy,
      createdAt: iso(document.createdAt),
      updatedAt: iso(document.updatedAt),
    };
  }

  /** 映射 Prisma VersionDependency 为共享类型 */
  private mapDependency(dep: {
    id: string; projectId: string; sourceDocumentId: string | null;
    sourceVersionId: string | null; sourceDocumentType: string | null;
    targetDocumentId: string; targetVersionId: string;
    targetDocumentType: string; dependencyType: string;
    targetAnchorType: string | null; targetAnchorId: string | null;
    sourceSnapshotHash: string | null; targetSnapshotHash: string | null;
    promptSnapshot: unknown; provider: string | null; model: string | null;
    configSource: string | null; createdBy: string; createdAt: Date;
  }): VersionDependencyRecord {
    return {
      id: dep.id,
      projectId: dep.projectId,
      sourceDocumentId: dep.sourceDocumentId ?? undefined,
      sourceVersionId: dep.sourceVersionId ?? undefined,
      sourceDocumentType: dep.sourceDocumentType as DocumentRecord["type"] | null ?? undefined,
      targetDocumentId: dep.targetDocumentId,
      targetVersionId: dep.targetVersionId,
      targetDocumentType: dep.targetDocumentType as DocumentRecord["type"],
      dependencyType: dep.dependencyType as DependencyType,
      targetAnchorType: dep.targetAnchorType as DependencyAnchorType | null ?? undefined,
      targetAnchorId: dep.targetAnchorId ?? undefined,
      sourceSnapshotHash: dep.sourceSnapshotHash ?? undefined,
      targetSnapshotHash: dep.targetSnapshotHash ?? undefined,
      promptSnapshot: jsonOutput<PromptSnapshotRecord>(dep.promptSnapshot) ?? undefined,
      provider: dep.provider ?? undefined,
      model: dep.model ?? undefined,
      configSource: dep.configSource as LlmConfigSource | null ?? undefined,
      createdBy: dep.createdBy,
      createdAt: iso(dep.createdAt),
    };
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
