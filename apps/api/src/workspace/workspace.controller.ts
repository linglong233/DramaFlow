/**
 * @fileoverview 工作区控制器
 * @module api/workspace
 *
 * 提供团队管理、项目 CRUD、文档版本管理、审核流、世界观设定、
 * 时间线、导出等 REST 端点。所有端点均需认证。
 */

import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  Param,
  Patch,
  Post,
  Put,
  Query,
  UseGuards,
} from "@nestjs/common";
import type { AuditContentType, DocumentType, ExportFormat, ProjectRole, TimelineTrackRecord } from "@dramaflow/shared";

import { CurrentUser } from "../common/current-user.decorator";
import { AuthGuard } from "../common/auth.guard";
import { AuditService } from "./audit.service";
import { WorkspaceService } from "./workspace.service";

/** 工作区控制器，聚合所有团队/项目/文档/版本/审核/时间线等 REST 端点 */
@Controller()
@UseGuards(AuthGuard)
export class WorkspaceController {
  constructor(
    @Inject(WorkspaceService) private readonly workspaceService: WorkspaceService,
    @Inject(AuditService) private readonly auditService: AuditService,
  ) {}

  @Get("teams")
  listTeams(@CurrentUser() user: { id: string }) {
    return this.workspaceService.listTeams(user.id);
  }

  @Get("teams/:id")
  getTeam(@CurrentUser() user: { id: string }, @Param("id") teamId: string) {
    return this.workspaceService.getTeam(user.id, teamId);
  }

  @Post("teams")
  createTeam(
    @CurrentUser() user: { id: string },
    @Body() body: { name: string; slug?: string; defaultReviewPolicy?: "required" | "bypass" },
  ) {
    return this.workspaceService.createTeam(user.id, body);
  }

  @Patch("teams/:id")
  updateTeam(
    @CurrentUser() user: { id: string },
    @Param("id") teamId: string,
    @Body() body: { name: string; defaultReviewPolicy: "required" | "bypass"; llmConfig?: import("@dramaflow/shared").LlmProviderConfig; imageGenerationConfig?: import("@dramaflow/shared").ImageGenerationConfig },
  ) {
    return this.workspaceService.updateTeam(user.id, teamId, body);
  }

  @Delete("teams/:id")
  @HttpCode(204)
  deleteTeam(
    @CurrentUser() user: { id: string },
    @Param("id") teamId: string,
  ) {
    return this.workspaceService.deleteTeam(user.id, teamId);
  }

  @Post("teams/:id/llm-models")
  @HttpCode(200)
  listTeamLlmModels(
    @CurrentUser() user: { id: string },
    @Param("id") teamId: string,
    @Body() body?: { llmConfig?: import("@dramaflow/shared").LlmProviderConfig },
  ) {
    return this.workspaceService.listTeamLlmModels(user.id, teamId, body?.llmConfig);
  }

  @Post("teams/:id/members")
  addTeamMember(
    @CurrentUser() user: { id: string },
    @Param("id") teamId: string,
    @Body() body: { email: string; role: "tenant_owner" | "tenant_admin" | "member" },
  ) {
    return this.workspaceService.addTeamMember(user.id, teamId, body);
  }

  @Delete("teams/:teamId/members/:memberId")
  @HttpCode(204)
  removeTeamMember(
    @CurrentUser() user: { id: string },
    @Param("teamId") teamId: string,
    @Param("memberId") memberId: string,
  ) {
    return this.workspaceService.removeTeamMember(user.id, teamId, memberId);
  }

  @Patch("teams/:teamId/members/:memberId")
  updateTeamMemberRole(
    @CurrentUser() user: { id: string },
    @Param("teamId") teamId: string,
    @Param("memberId") memberId: string,
    @Body() body: { role: "tenant_owner" | "tenant_admin" | "member" },
  ) {
    return this.workspaceService.updateTeamMemberRole(user.id, teamId, memberId, body.role);
  }

  @Post("teams/:id/invite-links")
  createTeamInviteLink(
    @CurrentUser() user: { id: string },
    @Param("id") teamId: string,
    @Body() body: { role: "tenant_owner" | "tenant_admin" | "member"; maxUses?: number; expiresInHours?: number },
  ) {
    return this.workspaceService.createTeamInviteLink(user.id, teamId, body);
  }

  @Get("teams/:id/invite-links")
  listTeamInviteLinks(
    @CurrentUser() user: { id: string },
    @Param("id") teamId: string,
  ) {
    return this.workspaceService.listTeamInviteLinks(user.id, teamId);
  }

  @Delete("teams/:teamId/invite-links/:linkId")
  @HttpCode(204)
  revokeTeamInviteLink(
    @CurrentUser() user: { id: string },
    @Param("teamId") teamId: string,
    @Param("linkId") linkId: string,
  ) {
    return this.workspaceService.revokeTeamInviteLink(user.id, teamId, linkId);
  }

  @Get("invite-links/:token")
  getInviteLinkInfo(
    @CurrentUser() user: { id: string },
    @Param("token") token: string,
  ) {
    return this.workspaceService.getTeamInviteLinkInfo(token);
  }

  @Post("invite-links/:token/accept")
  acceptInviteLink(
    @CurrentUser() user: { id: string },
    @Param("token") token: string,
  ) {
    return this.workspaceService.acceptTeamInviteLink(user.id, token);
  }

  @Get("projects")
  listProjects(@CurrentUser() user: { id: string }) {
    return this.workspaceService.listProjects(user.id);
  }

  @Post("projects")
  createProject(
    @CurrentUser() user: { id: string },
    @Body() body: { teamId?: string; name: string; description?: string; genre?: string; coverUrl?: string; status?: import("@dramaflow/shared").ProjectStatus; reviewPolicyMode?: "inherit" | "required" | "bypass" },
  ) {
    return this.workspaceService.createProject(user.id, body);
  }

  @Get("projects/:id")
  getProject(@CurrentUser() user: { id: string }, @Param("id") projectId: string) {
    return this.workspaceService.getProject(user.id, projectId);
  }

  @Get("projects/:id/versions")
  listProjectVersions(
    @CurrentUser() user: { id: string },
    @Param("id") projectId: string,
    @Query("limit") limit?: string,
    @Query("offset") offset?: string,
  ) {
    return this.workspaceService.listProjectVersions(user.id, projectId, limit ? Number(limit) : undefined, offset ? Number(offset) : undefined);
  }

  @Get("project-invites/pending")
  listPendingProjectInvites(@CurrentUser() user: { id: string }) {
    return this.workspaceService.listPendingProjectInvites(user.id);
  }

  @Post("project-invites/:id/accept")
  acceptProjectInvite(@CurrentUser() user: { id: string }, @Param("id") inviteId: string) {
    return this.workspaceService.acceptProjectInvite(user.id, inviteId);
  }

  @Patch("projects/:id/review-policy")
  updateReviewPolicy(
    @CurrentUser() user: { id: string },
    @Param("id") projectId: string,
    @Body() body: { reviewPolicyMode: "inherit" | "required" | "bypass" },
  ) {
    return this.workspaceService.updateProjectReviewPolicy(user.id, projectId, body.reviewPolicyMode);
  }

  @Patch("projects/:id")
  updateProject(
    @CurrentUser() user: { id: string },
    @Param("id") projectId: string,
    @Body() body: { name?: string; description?: string; genre?: string; coverUrl?: string; status?: import("@dramaflow/shared").ProjectStatus; reviewPolicyMode?: "inherit" | "required" | "bypass" },
  ) {
    return this.workspaceService.updateProject(user.id, projectId, body);
  }

  @Delete("projects/:id")
  @HttpCode(204)
  deleteProject(
    @CurrentUser() user: { id: string },
    @Param("id") projectId: string,
  ) {
    return this.workspaceService.deleteProject(user.id, projectId);
  }

  @Post("projects/:id/invites")
  inviteProjectMember(
    @CurrentUser() user: { id: string },
    @Param("id") projectId: string,
    @Body() body: { email: string; role: "project_admin" | "director" | "writer" | "artist" | "reviewer" | "viewer" },
  ) {
    return this.workspaceService.inviteProjectMember(user.id, projectId, body);
  }

  @Post("projects/:id/members")
  addProjectMember(
    @CurrentUser() user: { id: string },
    @Param("id") projectId: string,
    @Body() body: { email: string; role: "project_admin" | "director" | "writer" | "artist" | "reviewer" | "viewer" },
  ) {
    return this.workspaceService.addProjectMember(user.id, projectId, body);
  }

  @Get("documents/:id/versions")
  listVersions(
    @CurrentUser() user: { id: string },
    @Param("id") documentId: string,
    @Query("limit") limit?: string,
    @Query("offset") offset?: string,
  ) {
    return this.workspaceService.listVersions(user.id, documentId, limit ? Number(limit) : undefined, offset ? Number(offset) : undefined);
  }

  @Post("documents/:id/adopt-version")
  adoptVersion(
    @CurrentUser() user: { id: string },
    @Param("id") documentId: string,
    @Body() body: { versionId: string },
  ) {
    return this.workspaceService.adoptDocumentVersion(user.id, documentId, body.versionId);
  }

  @Post("documents/:id/versions")
  createVersion(
    @CurrentUser() user: { id: string },
    @Param("id") documentId: string,
    @Body() body: { title: string; content: unknown; metadata?: Record<string, unknown> },
  ) {
    return this.workspaceService.createVersion(user.id, documentId, body);
  }

  @Patch("versions/:id")
  updateVersion(
    @CurrentUser() user: { id: string },
    @Param("id") versionId: string,
    @Body() body: { title?: string; content?: unknown },
  ) {
    return this.workspaceService.updateVersion(user.id, versionId, body);
  }

  @Delete("versions/:id")
  @HttpCode(204)
  deleteVersion(
    @CurrentUser() user: { id: string },
    @Param("id") versionId: string,
  ) {
    return this.workspaceService.deleteVersion(user.id, versionId);
  }

  @Post("versions/:id/submit")
  submitVersion(@CurrentUser() user: { id: string }, @Param("id") versionId: string) {
    return this.workspaceService.submitVersion(user.id, versionId);
  }

  @Post("versions/:id/approve")
  approveVersion(
    @CurrentUser() user: { id: string },
    @Param("id") versionId: string,
    @Body() body?: { comment?: string },
  ) {
    return this.workspaceService.approveVersion(user.id, versionId, body?.comment);
  }

  @Post("versions/:id/reject")
  rejectVersion(
    @CurrentUser() user: { id: string },
    @Param("id") versionId: string,
    @Body() body?: { comment?: string },
  ) {
    return this.workspaceService.rejectVersion(user.id, versionId, body?.comment);
  }

  @Post("versions/:id/restore")
  restoreVersion(@CurrentUser() user: { id: string }, @Param("id") versionId: string) {
    return this.workspaceService.restoreVersion(user.id, versionId);
  }

  @Post("versions/:id/adopt")
  adoptVersionById(@CurrentUser() user: { id: string }, @Param("id") versionId: string) {
    return this.workspaceService.adoptVersionById(user.id, versionId);
  }

  @Post("versions/:id/advance-to-review")
  advanceToReview(
    @CurrentUser() user: { id: string },
    @Param("id") versionId: string,
    @Body() body?: { comment?: string },
  ) {
    return this.workspaceService.advanceVersionToReview(user.id, versionId, body?.comment);
  }

  @Patch("versions/:id/media-binding")
  updateDraftMediaBinding(
    @CurrentUser() user: { id: string },
    @Param("id") versionId: string,
    @Body() body: { shotId: string; binding: Partial<import("@dramaflow/shared").ShotMediaBinding> },
  ) {
    return this.workspaceService.updateDraftMediaBinding(
      user.id,
      versionId,
      body.shotId,
      body.binding,
    );
  }

  @Get("versions/:id/comments")
  listComments(@CurrentUser() user: { id: string }, @Param("id") versionId: string) {
    return this.workspaceService.listComments(user.id, versionId);
  }

  @Post("versions/:id/comments")
  addComment(
    @CurrentUser() user: { id: string },
    @Param("id") versionId: string,
    @Body() body: { body: string; parentId?: string; anchorType: "document" | "scene" | "shot" | "asset"; anchorId?: string },
  ) {
    return this.workspaceService.addComment(user.id, versionId, body);
  }

  @Get("projects/:id/world-bible")
  getWorldBible(@CurrentUser() user: { id: string }, @Param("id") projectId: string) {
    return this.workspaceService.getWorldBible(user.id, projectId);
  }

  @Patch("projects/:id/world-bible")
  updateWorldBible(
    @CurrentUser() user: { id: string },
    @Param("id") projectId: string,
    @Body() body: { characters?: unknown[]; locations?: unknown[]; styleGuide?: unknown },
  ) {
    return this.workspaceService.updateWorldBible(user.id, projectId, body as import("@dramaflow/shared").WorldBibleContent);
  }

  @Post("projects/:id/world-bible/characters")
  addCharacter(
    @CurrentUser() user: { id: string },
    @Param("id") projectId: string,
    @Body() body: { name: string; appearance: string; personality?: string; tags?: string[]; referenceImages?: string[]; costumes?: Record<string, string> },
  ) {
    return this.workspaceService.addCharacter(user.id, projectId, body);
  }

  @Patch("projects/:projectId/world-bible/characters/:characterId")
  updateCharacter(
    @CurrentUser() user: { id: string },
    @Param("projectId") projectId: string,
    @Param("characterId") characterId: string,
    @Body() body: { name?: string; appearance?: string; personality?: string; tags?: string[]; referenceImages?: string[]; costumes?: Record<string, string> },
  ) {
    return this.workspaceService.updateCharacter(user.id, projectId, characterId, body);
  }

  @Delete("projects/:projectId/world-bible/characters/:characterId")
  @HttpCode(204)
  deleteCharacter(
    @CurrentUser() user: { id: string },
    @Param("projectId") projectId: string,
    @Param("characterId") characterId: string,
  ) {
    return this.workspaceService.deleteCharacter(user.id, projectId, characterId);
  }

  @Post("projects/:id/world-bible/locations")
  addLocation(
    @CurrentUser() user: { id: string },
    @Param("id") projectId: string,
    @Body() body: { name: string; description: string; lighting?: string; timeOfDay?: string; referenceImages?: string[] },
  ) {
    return this.workspaceService.addLocation(user.id, projectId, body);
  }

  @Patch("projects/:projectId/world-bible/locations/:locationId")
  updateLocation(
    @CurrentUser() user: { id: string },
    @Param("projectId") projectId: string,
    @Param("locationId") locationId: string,
    @Body() body: { name?: string; description?: string; lighting?: string; timeOfDay?: string; referenceImages?: string[] },
  ) {
    return this.workspaceService.updateLocation(user.id, projectId, locationId, body);
  }

  @Delete("projects/:projectId/world-bible/locations/:locationId")
  @HttpCode(204)
  deleteLocation(
    @CurrentUser() user: { id: string },
    @Param("projectId") projectId: string,
    @Param("locationId") locationId: string,
  ) {
    return this.workspaceService.deleteLocation(user.id, projectId, locationId);
  }

  @Patch("projects/:id/world-bible/style-guide")
  updateStyleGuide(
    @CurrentUser() user: { id: string },
    @Param("id") projectId: string,
    @Body() body: { visualStyle: string; colorPalette?: string; compositionNote?: string; negativePrompt?: string; referenceImages?: string[] },
  ) {
    return this.workspaceService.updateStyleGuide(user.id, projectId, body);
  }

  // ===== 审核配置 =====

  @Get("projects/:id/audit-configs")
  getAuditConfigs(
    @CurrentUser() user: { id: string },
    @Param("id") projectId: string,
  ) {
    return this.auditService.getAuditConfigs(projectId);
  }

  @Patch("projects/:id/audit-configs/:contentType")
  upsertAuditConfig(
    @CurrentUser() user: { id: string },
    @Param("id") projectId: string,
    @Param("contentType") contentType: AuditContentType,
    @Body() body: { reviewRequired: boolean; autoApproveRoles?: ProjectRole[] },
  ) {
    return this.auditService.upsertAuditConfig(projectId, contentType, body);
  }

  @Get("projects/:id/audit-records")
  listAuditRecords(
    @CurrentUser() user: { id: string },
    @Param("id") projectId: string,
    @Query("type") type?: DocumentType,
    @Query("limit") limit?: string,
    @Query("offset") offset?: string,
  ) {
    return this.auditService.listAuditRecords(projectId, {
      type,
      limit: limit ? parseInt(limit, 10) : undefined,
      offset: offset ? parseInt(offset, 10) : undefined,
    });
  }

  @Get("versions/:id/audit-records")
  getVersionAuditRecords(
    @CurrentUser() user: { id: string },
    @Param("id") versionId: string,
  ) {
    return this.auditService.getAuditRecordsForVersion(versionId);
  }

  // ===== 时间线 =====

  @Get("projects/:id/timeline")
  getTimeline(@CurrentUser() user: { id: string }, @Param("id") projectId: string) {
    return this.workspaceService.getTimeline(user.id, projectId);
  }

  @Put("projects/:id/timeline")
  saveTimeline(
    @CurrentUser() user: { id: string },
    @Param("id") projectId: string,
    @Body() body: { duration: number; fps: number; resolution: string; tracks: TimelineTrackRecord[] },
  ) {
    return this.workspaceService.saveTimeline(user.id, projectId, body);
  }

  @Post("projects/:id/timeline/auto-assemble")
  autoAssembleTimeline(
    @CurrentUser() user: { id: string },
    @Param("id") projectId: string,
  ) {
    return this.workspaceService.autoAssembleTimeline(user.id, projectId);
  }

  // ===== 角色语音配置 =====

  @Patch("projects/:projectId/world-bible/characters/:characterId/voice")
  updateCharacterVoice(
    @CurrentUser() user: { id: string },
    @Param("projectId") projectId: string,
    @Param("characterId") characterId: string,
    @Body() body: { ttsProvider: string; voiceId: string; voiceName: string; settings?: { speed?: number; emotion?: string; volume?: number } },
  ) {
    return this.workspaceService.updateCharacterVoice(user.id, projectId, characterId, body);
  }

  @Post("projects/:id/assets")
  registerAsset(
    @CurrentUser() user: { id: string },
    @Param("id") projectId: string,
    @Body() body: {
      type: string;
      title: string;
      filename: string;
      assetId: string;
      assetUrl: string;
      mimeType: string;
      sizeInBytes: number;
    },
  ) {
    return this.workspaceService.registerProjectAsset(
      projectId,
      user.id,
      body,
    );
  }

  // ===== 导出 =====

  @Get("projects/:id/exports")
  listExports(@CurrentUser() user: { id: string }, @Param("id") projectId: string) {
    return this.workspaceService.listExports(user.id, projectId);
  }
}