/**
 * @fileoverview 影响议题 REST 控制器
 * @module api/workspace
 *
 * 提供影响议题的列表查询、详情、版本影响摘要，
 * 以及忽略 / 重新打开 / 解决 / 分配等状态流转端点。
 * 所有端点均需认证，并检查项目级权限。
 */

import {
  Body,
  Controller,
  Get,
  Inject,
  Param,
  Post,
  Query,
  UseGuards,
} from "@nestjs/common";
import type {
  AssignImpactIssuePayload,
  IgnoreImpactIssuePayload,
  ImpactIssueStatus,
  ImpactSeverity,
  ImpactTargetType,
  ResolveImpactIssuePayload,
} from "@dramaflow/shared";

import { AuthGuard } from "../common/auth.guard";
import { CurrentUser } from "../common/current-user.decorator";
import { ImpactService } from "./impact.service";
import { WorkspaceService } from "./workspace.service";

/** 影响议题控制器，聚合所有影响分析相关 REST 端点 */
@Controller()
@UseGuards(AuthGuard)
export class ImpactController {
  constructor(
    @Inject(ImpactService) private readonly impactService: ImpactService,
    @Inject(WorkspaceService) private readonly workspaceService: WorkspaceService,
  ) {}

  /** 分页查询项目影响议题，支持多维度过滤 */
  @Get("projects/:id/impact-issues")
  async listProjectIssues(
    @CurrentUser() user: { id: string },
    @Param("id") projectId: string,
    @Query("status") status?: ImpactIssueStatus,
    @Query("severity") severity?: ImpactSeverity,
    @Query("targetType") targetType?: ImpactTargetType,
    @Query("targetDocumentType") targetDocumentType?: string,
    @Query("assignedTo") assignedTo?: string,
    @Query("limit") limit?: string,
    @Query("offset") offset?: string,
  ) {
    await this.workspaceService.assertProjectPermission(
      user.id,
      projectId,
      "project.view",
      "You do not have permission to view project impacts",
    );
    return this.impactService.listProjectIssues(projectId, {
      status,
      severity,
      targetType,
      targetDocumentType,
      assignedTo,
      limit: limit ? Number(limit) : undefined,
      offset: offset ? Number(offset) : undefined,
    });
  }

  /** 获取单个影响议题详情 */
  @Get("impact-issues/:id")
  async getIssue(
    @CurrentUser() user: { id: string },
    @Param("id") issueId: string,
  ) {
    const projectId =
      await this.impactService.getIssueProjectId(issueId);
    await this.workspaceService.assertProjectPermission(
      user.id,
      projectId,
      "project.view",
      "You do not have permission to view this impact issue",
    );
    return this.impactService.getIssueDetail(issueId);
  }

  /** 获取版本影响摘要 */
  @Get("versions/:id/impact-summary")
  async getVersionSummary(
    @CurrentUser() user: { id: string },
    @Param("id") versionId: string,
  ) {
    const projectId =
      await this.impactService.getVersionProjectId(versionId);
    await this.workspaceService.assertProjectPermission(
      user.id,
      projectId,
      "project.view",
      "You do not have permission to view this version impact summary",
    );
    return this.impactService.getVersionImpactSummary(versionId);
  }

  /** 忽略影响议题 */
  @Post("impact-issues/:id/ignore")
  async ignoreIssue(
    @CurrentUser() user: { id: string },
    @Param("id") issueId: string,
    @Body() body: IgnoreImpactIssuePayload,
  ) {
    const projectId =
      await this.impactService.getIssueProjectId(issueId);
    await this.workspaceService.assertProjectPermission(
      user.id,
      projectId,
      "project.edit",
      "You do not have permission to ignore impact issues",
    );
    return this.impactService.ignoreIssue(issueId, user.id, body.reason);
  }

  /** 重新打开影响议题 */
  @Post("impact-issues/:id/reopen")
  async reopenIssue(
    @CurrentUser() user: { id: string },
    @Param("id") issueId: string,
  ) {
    const projectId =
      await this.impactService.getIssueProjectId(issueId);
    await this.workspaceService.assertProjectPermission(
      user.id,
      projectId,
      "project.edit",
      "You do not have permission to reopen impact issues",
    );
    return this.impactService.reopenIssue(issueId, user.id);
  }

  /** 解决影响议题 */
  @Post("impact-issues/:id/resolve")
  async resolveIssue(
    @CurrentUser() user: { id: string },
    @Param("id") issueId: string,
    @Body() body: ResolveImpactIssuePayload,
  ) {
    const projectId =
      await this.impactService.getIssueProjectId(issueId);
    await this.workspaceService.assertProjectPermission(
      user.id,
      projectId,
      "project.edit",
      "You do not have permission to resolve impact issues",
    );
    return this.impactService.resolveIssue(issueId, user.id, body.note);
  }

  /** 分配影响议题给指定成员 */
  @Post("impact-issues/:id/assign")
  async assignIssue(
    @CurrentUser() user: { id: string },
    @Param("id") issueId: string,
    @Body() body: AssignImpactIssuePayload,
  ) {
    const projectId =
      await this.impactService.getIssueProjectId(issueId);
    await this.workspaceService.assertProjectPermission(
      user.id,
      projectId,
      "project.edit",
      "You do not have permission to assign impact issues",
    );
    return this.impactService.assignIssue(issueId, user.id, body.assignedTo);
  }

  /** 接受影响建议 */
  @Post("impact-suggestions/:id/accept")
  async acceptSuggestion(@CurrentUser() user: { id: string }, @Param("id") suggestionId: string) {
    const projectId = await this.impactService.getSuggestionProjectId(suggestionId);
    await this.workspaceService.assertProjectPermission(user.id, projectId, "project.edit", "You do not have permission to accept impact suggestions");
    return this.impactService.acceptSuggestion(suggestionId, user.id);
  }

  /** 撤回已接受的影响建议 */
  @Post("impact-suggestions/:id/revert-acceptance")
  async revertSuggestionAcceptance(@CurrentUser() user: { id: string }, @Param("id") suggestionId: string) {
    const projectId = await this.impactService.getSuggestionProjectId(suggestionId);
    await this.workspaceService.assertProjectPermission(user.id, projectId, "project.edit", "You do not have permission to revert impact suggestions");
    return this.impactService.revertSuggestionAcceptance(suggestionId, user.id);
  }
}
