/**
 * @fileoverview 工作区核心业务服务
 * @module api/workspace
 *
 * 实现团队管理、项目 CRUD、文档版本管理、审核流、世界观设定、通知、
 * 时间线、导出等核心业务逻辑。所有业务规则都引用 @dramaflow/shared 的共享函数。
 */

import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import {
  canAutoApprove,
  canChangeTeamMemberRole,
  canManageTenant,
  canRemoveTeamMember,
  canTransitionVersionStatus,
  getSubmittedStatus,
  getNextVersionNumber,
  resolveContentReviewRequired,
  normalizeStoryboardContent,
  ensureMediaBindings,
  resolveReviewRequired,
  findInvalidPermissionOverrideValues,
  findInvalidProjectRolePermissionTemplateValues,
  PROJECT_PERMISSIONS,
  PROJECT_ROLES,
  SYSTEM_PROJECT_ROLE_PERMISSION_TEMPLATES,
  getProjectRoleTemplatePermissions,
  normalizePermissionOverride,
  normalizeProjectRolePermissionTemplates,
  resolveProjectPermissions,
  type AccessContext,
  type AnchorType,
  type AuditConfigResponse,
  type AuditContentType,
  type CharacterProfile,
  type CharacterVoiceConfig,
  type DocumentRecord,
  type DocumentType,
  type ExportRecord,
  type ImageGenerationConfig,
  type ImageGenerationSettingsConfig,
  type LlmModelListResponse,
  type LlmProviderConfig,
  type LocationProfile,
  type PermissionOverride,
  type ProviderEntry,
  type ProjectInviteSummary,
  type ProjectMemberPermissionsResponse,
  type ProjectMemberRecord,
  type ProjectMemberSummary,
  type ProjectPermission,
  type ProjectRole,
  type ProjectRolePermissionTemplateSummary,
  type ProjectRolePermissionTemplates,
  type ProjectStatus,
  type ProjectWorkspaceSummaryPayload,
  type RealtimeCharacterSyncedEvent,
  type ReviewQueueVersionSummary,
  type ScriptContent,
  type StyleGuideProfile,
  type StoryboardContent,
  type ShotMediaBinding,
  type TeamPermissionTemplatesResponse,
  type TeamSettingsLlmConfig,
  type TeamSettingsResponse,
  type TeamInviteLinkRecord,
  type TeamInviteLinkSummary,
  type TeamMemberRecord,
  type TeamMemberSummary,
  type TeamRole,
  type TeamSummary,
  type MediaContent,
  type TimelineClipRecord,
  type TimelineRecord,
  type TimelineSavePayload,
  type TimelineTrackRecord,
  type UpdateProjectMemberPermissionsPayload,
  type UpdateTeamPermissionTemplatesPayload,
  type VersionRecord,
  type VersionStatus,
  type WorldBibleContent,
} from "@dramaflow/shared";

import { randomBytes } from "node:crypto";

import { PrismaService } from "../common/prisma.service";
import { LlmProviderService } from "../common/llm-provider.service";
import { jsonOutput, jsonInput, optionalJsonInput, iso, optionalIso } from "../common/prisma-json";
import { createId } from "../common/id";

/** 项目邀请记录（Prisma 模式下的本地类型） */
export interface ProjectInviteRecord {
  id: string;
  projectId: string;
  email: string;
  role: ProjectRole;
  createdBy: string;
  status: "pending" | "accepted";
  createdAt: string;
}
import { NotificationService } from "../notifications/notification.service";
import { RealtimeEventsService } from "../realtime/realtime.events.service";
import { AuditService } from "./audit.service";
import { ImpactService } from "./impact.service";

/** 操作者上下文，封装用户在团队和项目中的角色 */
interface ActorContext extends AccessContext {}

function applyPagination<T>(items: T[], limit?: number, offset?: number): T[] {
  const start = offset ?? 0;
  if (limit != null) return items.slice(start, start + limit);
  return items.slice(start);
}

/** 工作区核心业务服务，聚合团队、项目、文档、版本、审核、世界观等操作 */
@Injectable()
export class WorkspaceService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(LlmProviderService) private readonly llmProviderService: LlmProviderService,
    @Inject(AuditService) private readonly auditService: AuditService,
    @Inject(NotificationService) private readonly notificationService: NotificationService,
    @Inject(RealtimeEventsService) private readonly realtimeEvents: RealtimeEventsService,
    @Inject(ImpactService) private readonly impactService: ImpactService,
  ) {}

  // ===== Record Mappers (Prisma → shared types) =====

  private toTeamRecord(team: any) {
    return {
      id: team.id, name: team.name, slug: team.slug,
      defaultReviewPolicy: team.defaultReviewPolicy, createdBy: team.createdBy,
      llmConfig: jsonOutput(team.llmConfig),
      imageGenerationConfig: jsonOutput(team.imageGenerationConfig),
      imageProviders: jsonOutput(team.imageProviders),
      videoProviders: jsonOutput(team.videoProviders),
      defaultImageProvider: team.defaultImageProvider ?? undefined,
      defaultVideoProvider: team.defaultVideoProvider ?? undefined,
      projectRolePermissionTemplates: jsonOutput(team.projectRolePermissionTemplates),
      createdAt: iso(team.createdAt), updatedAt: iso(team.updatedAt),
    };
  }

  private toProjectRecord(project: any) {
    return {
      id: project.id, teamId: project.teamId, name: project.name,
      description: project.description, genre: project.genre ?? undefined,
      coverUrl: project.coverUrl ?? undefined, status: project.status,
      reviewPolicyMode: project.reviewPolicyMode, createdBy: project.createdBy,
      createdAt: iso(project.createdAt), updatedAt: iso(project.updatedAt),
    };
  }

  private toDocumentRecord(doc: any) {
    return {
      id: doc.id, projectId: doc.projectId, type: doc.type, title: doc.title,
      shotId: doc.shotId ?? undefined, currentVersionId: doc.currentVersionId ?? undefined,
      draftVersionId: doc.draftVersionId ?? undefined, createdBy: doc.createdBy,
      createdAt: iso(doc.createdAt), updatedAt: iso(doc.updatedAt),
    };
  }

  private toVersionRecord(version: any): VersionRecord {
    return {
      id: version.id, documentId: version.documentId,
      versionNumber: version.versionNumber, status: version.status,
      title: version.title, content: jsonOutput<unknown>(version.content),
      metadata: jsonOutput<Record<string, unknown>>(version.metadata),
      parentVersionId: version.parentVersionId ?? undefined,
      createdBy: version.createdBy, createdAt: iso(version.createdAt),
    };
  }

  async listTeams(userId: string): Promise<TeamSummary[]> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException("User not found");

    const visibleTeams = user.globalRole === "platform_super_admin"
      ? await this.prisma.team.findMany({})
      : await this.prisma.team.findMany({
          where: { members: { some: { userId } } },
        });

    return Promise.all(visibleTeams
      .sort((left, right) => left.name.localeCompare(right.name))
      .map((team) => this.buildTeamSummaryFromRecord(this.toTeamRecord(team), userId, user.globalRole)));
  }

  async getTeam(userId: string, teamId: string): Promise<TeamSummary> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException("User not found");

    const membership = await this.prisma.teamMember.findFirst({
      where: { teamId, userId },
    });
    if (user.globalRole !== "platform_super_admin" && !membership) {
      throw new ForbiddenException("You do not have access to this team");
    }

    const team = await this.prisma.team.findUnique({ where: { id: teamId } });
    if (!team) throw new NotFoundException("Team not found");
    return this.buildTeamSummaryFromRecord(this.toTeamRecord(team), userId, user.globalRole);
  }

  async getTeamSettings(userId: string, teamId: string): Promise<TeamSettingsResponse> {
    const actor = await this.getActor(userId, undefined, teamId);
    if (!canManageTenant(actor)) {
      throw new ForbiddenException("You do not have permission to view team settings");
    }

    const team = await this.prisma.team.findUnique({ where: { id: teamId } });
    if (!team) throw new NotFoundException("Team not found");
    return this.buildTeamSettingsResponseFromRecord(this.toTeamRecord(team), actor.userId, actor.globalRole);
  }

  async getTeamPermissionTemplates(userId: string, teamId: string): Promise<TeamPermissionTemplatesResponse> {
    const actor = await this.getActor(userId, undefined, teamId);
    if (!canManageTenant(actor)) {
      throw new ForbiddenException("You do not have permission to view team permission templates");
    }

    const team = await this.prisma.team.findUnique({ where: { id: teamId } });
    if (!team) throw new NotFoundException("Team not found");
    return this.buildTeamPermissionTemplatesResponseFromRecord(this.toTeamRecord(team));
  }

  async updateTeamPermissionTemplates(
    userId: string,
    teamId: string,
    input: UpdateTeamPermissionTemplatesPayload,
  ): Promise<TeamPermissionTemplatesResponse> {
    const actor = await this.getActor(userId, undefined, teamId);
    if (!canManageTenant(actor)) {
      throw new ForbiddenException("Only team admins can update permission templates");
    }

    this.assertNoInvalidProjectPermissions(findInvalidProjectRolePermissionTemplateValues(input.templates));

    const templates = normalizeProjectRolePermissionTemplates(input.templates);
    const updated = await this.prisma.team.update({
      where: { id: teamId },
      data: {
        projectRolePermissionTemplates: optionalJsonInput(templates),
        updatedAt: new Date(),
      },
    });
    return this.buildTeamPermissionTemplatesResponseFromRecord(this.toTeamRecord(updated));
  }

  async createTeam(userId: string, input: { name: string; slug?: string; defaultReviewPolicy?: "required" | "bypass" }) {
    const actor = await this.getActor(userId);
    const name = input.name.trim();
    if (!name) {
      throw new BadRequestException("Team name is required");
    }

    const slug = (input.slug?.trim().toLowerCase() || name.toLowerCase().replace(/\s+/g, "-")).replace(/[^a-z0-9-]/g, "");
    const existing = await this.prisma.team.findFirst({ where: { slug } });
    if (existing) {
      throw new BadRequestException("Team slug already exists");
    }

    const team = await this.prisma.$transaction(async (tx) => {
      const created = await tx.team.create({
        data: {
          id: createId("team"),
          name,
          slug,
          defaultReviewPolicy: input.defaultReviewPolicy ?? "required",
          createdBy: actor.userId,
        },
      });
      await tx.teamMember.create({
        data: {
          id: createId("tm"),
          teamId: created.id,
          userId: actor.userId,
          role: "tenant_owner",
        },
      });
      return created;
    });
    return this.toTeamRecord(team);
  }

  async updateTeam(
    userId: string,
    teamId: string,
    input: {
      name: string;
      defaultReviewPolicy: "required" | "bypass";
      llmConfig?: LlmProviderConfig;
      imageGenerationConfig?: ImageGenerationConfig;
      imageProviders?: import("@dramaflow/shared").ProviderEntry[];
      videoProviders?: import("@dramaflow/shared").ProviderEntry[];
      defaultImageProvider?: string;
      defaultVideoProvider?: string;
    },
  ) {
    const actor = await this.getActor(userId, undefined, teamId);
    if (!canManageTenant(actor)) {
      throw new ForbiddenException("Only team admins can update team settings");
    }

    const name = input.name.trim();
    if (!name) {
      throw new BadRequestException("Team name is required");
    }

    const team = await this.prisma.team.findUnique({ where: { id: teamId } });
    if (!team) throw new NotFoundException("Team not found");

    const currentTeam = this.toTeamRecord(team);
    const data: Record<string, any> = {
      name,
      defaultReviewPolicy: input.defaultReviewPolicy,
      updatedAt: new Date(),
    };
    if (input.llmConfig !== undefined) {
      data.llmConfig = optionalJsonInput(this.mergePersistedLlmConfig(currentTeam.llmConfig as LlmProviderConfig | undefined, input.llmConfig));
    }
    if (input.imageGenerationConfig !== undefined) {
      data.imageGenerationConfig = optionalJsonInput(this.mergePersistedImageGenerationConfig(currentTeam.imageGenerationConfig as ImageGenerationConfig | undefined, input.imageGenerationConfig));
    }
    if (input.imageProviders !== undefined) {
      data.imageProviders = optionalJsonInput(input.imageProviders);
    }
    if (input.videoProviders !== undefined) {
      data.videoProviders = optionalJsonInput(input.videoProviders);
    }
    if (input.defaultImageProvider !== undefined) {
      data.defaultImageProvider = input.defaultImageProvider;
    }
    if (input.defaultVideoProvider !== undefined) {
      data.defaultVideoProvider = input.defaultVideoProvider;
    }

    const updated = await this.prisma.team.update({ where: { id: teamId }, data });
    return this.buildTeamSettingsResponseFromRecord(this.toTeamRecord(updated), actor.userId, actor.globalRole);
  }

  async listTeamLlmModels(
    userId: string,
    teamId: string,
    draftConfig?: LlmProviderConfig,
  ): Promise<LlmModelListResponse> {
    const actor = await this.getActor(userId, undefined, teamId);
    if (!canManageTenant(actor)) {
      throw new ForbiddenException("You do not have permission to view team settings");
    }

    const team = await this.prisma.team.findUnique({ where: { id: teamId } });
    if (!team) throw new NotFoundException("Team not found");
    const teamRecord = this.toTeamRecord(team);
    return {
      models: await this.llmProviderService.listModels(
        this.mergeLlmConfig(teamRecord.llmConfig as LlmProviderConfig | undefined, draftConfig),
      ),
    };
  }

  async addTeamMember(userId: string, teamId: string, input: { email: string; role: TeamRole }) {
    const actor = await this.getActor(userId, undefined, teamId);
    if (!canManageTenant(actor)) {
      throw new ForbiddenException("Only tenant admins can add members");
    }

    const team = await this.prisma.team.findUnique({ where: { id: teamId } });
    if (!team) throw new NotFoundException("Team not found");

    const user = await this.prisma.user.findFirst({ where: { email: input.email.trim().toLowerCase() } });
    if (!user) throw new NotFoundException("User not found");

    const existing = await this.prisma.teamMember.findFirst({ where: { teamId, userId: user.id } });
    if (existing) {
      const updated = await this.prisma.teamMember.update({ where: { id: existing.id }, data: { role: input.role } });
      return this.buildTeamMemberSummaryFromRecords(updated, user);
    }

    const record = await this.prisma.teamMember.create({
      data: { id: createId("tm"), teamId, userId: user.id, role: input.role },
    });
    return this.buildTeamMemberSummaryFromRecords(record, user);
  }

  async removeTeamMember(userId: string, teamId: string, memberId: string) {
    const actor = await this.getActor(userId, undefined, teamId);

    const team = await this.prisma.team.findUnique({ where: { id: teamId } });
    if (!team) throw new NotFoundException("Team not found");

    const member = await this.prisma.teamMember.findFirst({ where: { id: memberId, teamId } });
    if (!member) throw new NotFoundException("Team member not found");

    if (member.userId === userId) {
      throw new BadRequestException("You cannot remove yourself from the team");
    }

    if (!canRemoveTeamMember(actor, member.role as TeamRole)) {
      throw new ForbiddenException("You do not have permission to remove this member");
    }

    await this.prisma.teamMember.delete({ where: { id: memberId } });
  }

  async updateTeamMemberRole(userId: string, teamId: string, memberId: string, newRole: TeamRole) {
    const actor = await this.getActor(userId, undefined, teamId);

    const team = await this.prisma.team.findUnique({ where: { id: teamId } });
    if (!team) throw new NotFoundException("Team not found");

    const member = await this.prisma.teamMember.findFirst({ where: { id: memberId, teamId } });
    if (!member) throw new NotFoundException("Team member not found");

    if (member.role === newRole) {
      const user = await this.prisma.user.findUnique({ where: { id: member.userId } });
      if (!user) throw new NotFoundException("User not found");
      return this.buildTeamMemberSummaryFromRecords(member, user);
    }

    if (!canChangeTeamMemberRole(actor, member.role as TeamRole, newRole)) {
      throw new ForbiddenException("You do not have permission to change this member's role");
    }

    if (member.role === "tenant_owner") {
      const otherOwners = await this.prisma.teamMember.findMany({
        where: { teamId, role: "tenant_owner", id: { not: memberId } },
      });
      if (otherOwners.length === 0) {
        throw new BadRequestException("Cannot downgrade the only owner. Transfer ownership first.");
      }
    }

    const updated = await this.prisma.teamMember.update({ where: { id: memberId }, data: { role: newRole } });
    const user = await this.prisma.user.findUnique({ where: { id: updated.userId } });
    if (!user) throw new NotFoundException("User not found");
    return this.buildTeamMemberSummaryFromRecords(updated, user);
  }

  async deleteTeam(userId: string, teamId: string) {
    const actor = await this.getActor(userId, undefined, teamId);
    if (actor.globalRole !== "platform_super_admin" && !actor.teamRoles.includes("tenant_owner")) {
      throw new ForbiddenException("Only the team owner can delete the team");
    }

    await this.prisma.team.delete({ where: { id: teamId } });
  }

  async createTeamInviteLink(userId: string, teamId: string, input: { role: TeamRole; maxUses?: number; expiresInHours?: number }) {
    const actor = await this.getActor(userId, undefined, teamId);
    if (!canManageTenant(actor)) {
      throw new ForbiddenException("Only team admins can create invite links");
    }

    const team = await this.prisma.team.findUnique({ where: { id: teamId } });
    if (!team) throw new NotFoundException("Team not found");

    const token = randomBytes(24).toString("base64url");
    const now = new Date();
    const expiresAt = input.expiresInHours
      ? new Date(now.getTime() + input.expiresInHours * 3600_000)
      : null;

    const record = await this.prisma.teamInviteLink.create({
      data: {
        id: createId("til"),
        teamId,
        token,
        role: input.role,
        maxUses: input.maxUses ?? 0,
        uses: 0,
        expiresAt,
        createdBy: userId,
      },
    });

    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException("User not found");
    return {
      id: record.id,
      token: record.token,
      role: record.role,
      maxUses: record.maxUses,
      uses: record.uses,
      expiresAt: optionalIso(record.expiresAt) ?? null,
      createdAt: iso(record.createdAt),
      createdByName: user.displayName,
    } satisfies TeamInviteLinkSummary;
  }

  async listTeamInviteLinks(userId: string, teamId: string): Promise<TeamInviteLinkSummary[]> {
    const actor = await this.getActor(userId, undefined, teamId);
    if (!canManageTenant(actor)) {
      throw new ForbiddenException("Only team admins can view invite links");
    }

    const team = await this.prisma.team.findUnique({ where: { id: teamId } });
    if (!team) throw new NotFoundException("Team not found");

    const links = await this.prisma.teamInviteLink.findMany({ where: { teamId } });
    return Promise.all(links.map(async (link) => {
      const user = await this.prisma.user.findUnique({ where: { id: link.createdBy } });
      return {
        id: link.id,
        token: link.token,
        role: link.role,
        maxUses: link.maxUses,
        uses: link.uses,
        expiresAt: optionalIso(link.expiresAt) ?? null,
        createdAt: iso(link.createdAt),
        createdByName: user?.displayName ?? "Unknown",
      };
    }));
  }

  async revokeTeamInviteLink(userId: string, teamId: string, linkId: string) {
    const actor = await this.getActor(userId, undefined, teamId);
    if (!canManageTenant(actor)) {
      throw new ForbiddenException("Only team admins can revoke invite links");
    }

    const link = await this.prisma.teamInviteLink.findFirst({ where: { id: linkId, teamId } });
    if (!link) throw new NotFoundException("Invite link not found");
    await this.prisma.teamInviteLink.delete({ where: { id: linkId } });
  }

  async getTeamInviteLinkInfo(token: string) {
    const link = await this.prisma.teamInviteLink.findFirst({ where: { token } });
    if (!link) throw new NotFoundException("Invite link not found or has been revoked");

    const team = await this.prisma.team.findUnique({ where: { id: link.teamId } });
    if (!team) throw new NotFoundException("The team associated with this link no longer exists");

    const now = new Date();
    const expired = link.expiresAt ? new Date(link.expiresAt) < now : false;
    const exhausted = link.maxUses > 0 && link.uses >= link.maxUses;

    return {
      teamName: team.name,
      teamSlug: team.slug,
      role: link.role,
      expired,
      exhausted,
    };
  }

  async acceptTeamInviteLink(userId: string, token: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException("User not found");

    const link = await this.prisma.teamInviteLink.findFirst({ where: { token } });
    if (!link) throw new NotFoundException("Invite link not found or has been revoked");

    const team = await this.prisma.team.findUnique({ where: { id: link.teamId } });
    if (!team) throw new NotFoundException("The team associated with this link no longer exists");

    const now = new Date();
    if (link.expiresAt && new Date(link.expiresAt) < now) {
      throw new BadRequestException("This invite link has expired");
    }
    if (link.maxUses > 0 && link.uses >= link.maxUses) {
      throw new BadRequestException("This invite link has reached its usage limit");
    }

    const existing = await this.prisma.teamMember.findFirst({ where: { teamId: link.teamId, userId } });
    if (existing) {
      return { teamId: link.teamId, teamName: team.name, alreadyMember: true };
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.teamMember.create({
        data: { id: createId("tm"), teamId: link.teamId, userId, role: link.role },
      });
      await tx.teamInviteLink.update({ where: { id: link.id }, data: { uses: { increment: 1 } } });
    });

    return { teamId: link.teamId, teamName: team.name, alreadyMember: false };
  }

  async listProjects(userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException("User not found");

    if (user.globalRole === "platform_super_admin") {
      const all = await this.prisma.project.findMany({ orderBy: { updatedAt: "desc" } });
      return all.map((p) => this.toProjectRecord(p));
    }

    const teamMemberships = await this.prisma.teamMember.findMany({ where: { userId }, select: { teamId: true } });
    const teamIds = teamMemberships.map((m) => m.teamId);
    const projectMemberships = await this.prisma.projectMember.findMany({ where: { userId }, select: { projectId: true } });
    const projectIds = projectMemberships.map((m) => m.projectId);

    const projects = await this.prisma.project.findMany({
      where: { OR: [{ teamId: { in: teamIds } }, { id: { in: projectIds } }] },
      orderBy: { updatedAt: "desc" },
    });
    return projects.map((p) => this.toProjectRecord(p));
  }

  async createProject(
    userId: string,
    input: { teamId?: string; name: string; description?: string; genre?: string; coverUrl?: string; status?: ProjectStatus; reviewPolicyMode?: "inherit" | "required" | "bypass" },
  ) {
    let teamId = input.teamId;
    if (!teamId) {
      const teams = await this.listTeams(userId);
      if (teams.length === 0) {
        throw new ForbiddenException("You must join a team before creating a project");
      }
      teamId = teams[0].id;
    }

    await this.getActor(userId, undefined, teamId);

    return this.prisma.$transaction(async (tx) => {
      const teamMembership = await tx.teamMember.findFirst({ where: { teamId, userId } });
      const user = await tx.user.findUnique({ where: { id: userId } });
      if (!user) throw new NotFoundException("User not found");
      if (user.globalRole !== "platform_super_admin" && !teamMembership) {
        throw new ForbiddenException("You must join the team before creating a project");
      }

      const project = await tx.project.create({
        data: {
          id: createId("project"),
          teamId,
          name: input.name.trim(),
          description: input.description?.trim() ?? "",
          genre: input.genre?.trim(),
          coverUrl: input.coverUrl?.trim(),
          status: input.status ?? "draft",
          reviewPolicyMode: input.reviewPolicyMode ?? "inherit",
          createdBy: userId,
        },
      });
      await tx.projectMember.create({
        data: { id: createId("pm"), projectId: project.id, userId, role: "project_admin" },
      });
      await tx.document.createMany({
        data: [
          { id: createId("doc"), projectId: project.id, type: "script", title: "主剧本", createdBy: userId },
          { id: createId("doc"), projectId: project.id, type: "storyboard", title: "总分镜", createdBy: userId },
          { id: createId("doc"), projectId: project.id, type: "world_bible", title: "世界观设定", createdBy: userId },
        ],
      });
      return this.toProjectRecord(project);
    });
  }

  async getProject(userId: string, projectId: string): Promise<ProjectWorkspaceSummaryPayload> {
    await this.assertProjectReadableAsync(projectId, userId);
    const project = await this.prisma.project.findUnique({ where: { id: projectId } });
    if (!project) throw new NotFoundException("Project not found");
    const projectRecord = this.toProjectRecord(project);

    const team = await this.prisma.team.findUnique({ where: { id: project.teamId } });
    if (!team) throw new NotFoundException("Team not found");

    const documents = await this.prisma.document.findMany({ where: { projectId } });
    const documentRecords = documents.map((d) => this.toDocumentRecord(d));

    const auditConfigs = await this.prisma.auditConfig.findMany({ where: { projectId } });
    const auditConfigSummaries = auditConfigs.map((c): AuditConfigResponse => ({
      id: c.id,
      projectId: c.projectId,
      contentType: c.contentType as AuditContentType,
      reviewRequired: c.reviewRequired,
      autoApproveRoles: jsonOutput<ProjectRole[]>(c.autoApproveRoles),
    }));

    const currentUserPermissions = this.resolveActorProjectPermissions(
      await this.buildProjectActorContext(userId, projectId),
    );

    return {
      team: {
        id: team.id,
        name: team.name,
        defaultReviewPolicy: team.defaultReviewPolicy as "required" | "bypass",
      },
      project: projectRecord,
      members: await this.getProjectMemberSummariesAsync(projectId),
      invites: await this.getProjectInviteSummariesAsync([project.id]),
      pendingReviews: await this.getReviewQueueAsync([project.id]),
      documents: documentRecords,
      worldBible: await this.extractWorldBibleAsync(projectId),
      auditConfigs: auditConfigSummaries,
      currentUserPermissions,
    };
  }

  /** 断言用户拥有指定的项目权限，否则抛出 ForbiddenException */
  async assertProjectPermission(
    userId: string,
    projectId: string,
    permission: ProjectPermission,
    message = "You do not have permission to perform this project action",
  ): Promise<void> {
    const actor = await this.getActor(userId, projectId);
    if (!this.actorHasProjectPermission(actor, permission)) {
      throw new ForbiddenException(message);
    }
  }

  async updateProjectReviewPolicy(userId: string, projectId: string, reviewPolicyMode: "inherit" | "required" | "bypass") {
    const actor = await this.getActor(userId, projectId);
    if (!this.actorHasProjectPermission(actor, "project.edit")) {
      throw new ForbiddenException("You do not have permission to change the project review policy");
    }

    const updated = await this.prisma.project.update({
      where: { id: projectId },
      data: { reviewPolicyMode, updatedAt: new Date() },
    });
    return this.toProjectRecord(updated);
  }

  async updateProject(
    userId: string,
    projectId: string,
    input: { name?: string; description?: string; genre?: string; coverUrl?: string; status?: ProjectStatus; reviewPolicyMode?: "inherit" | "required" | "bypass" },
  ) {
    const actor = await this.getActor(userId, projectId);
    if (!this.actorHasProjectPermission(actor, "project.edit")) {
      throw new ForbiddenException("You do not have permission to update this project");
    }

    const data: Record<string, any> = { updatedAt: new Date() };
    if (input.name !== undefined) data.name = input.name.trim();
    if (input.description !== undefined) data.description = input.description.trim();
    if (input.genre !== undefined) data.genre = input.genre.trim() || null;
    if (input.coverUrl !== undefined) data.coverUrl = input.coverUrl.trim() || null;
    if (input.status !== undefined) data.status = input.status;
    if (input.reviewPolicyMode !== undefined) data.reviewPolicyMode = input.reviewPolicyMode;

    const updated = await this.prisma.project.update({ where: { id: projectId }, data });
    return this.toProjectRecord(updated);
  }

  async deleteProject(userId: string, projectId: string) {
    const actor = await this.getActor(userId, projectId);
    if (actor.globalRole !== "platform_super_admin" && !actor.projectRoles.includes("project_admin")) {
      throw new ForbiddenException("Only project admins can delete a project");
    }

    await this.prisma.project.delete({ where: { id: projectId } });
  }

  async inviteProjectMember(userId: string, projectId: string, input: { email: string; role: ProjectRole }) {
    const actor = await this.getActor(userId, projectId);
    if (!this.actorHasProjectPermission(actor, "member.manage")) {
      throw new ForbiddenException("Only project member managers can assign collaborators");
    }

    const project = await this.prisma.project.findUnique({ where: { id: projectId } });
    if (!project) throw new NotFoundException("Project not found");

    const email = input.email.trim().toLowerCase();
    const invitedUser = await this.prisma.user.findFirst({ where: { email } });
    if (invitedUser) {
      const existingMember = await this.prisma.projectMember.findFirst({ where: { projectId, userId: invitedUser.id } });
      if (existingMember) throw new BadRequestException("User is already a project member");
    }

    const existingPendingInvite = await this.prisma.projectInvite.findFirst({
      where: { projectId, email, status: "pending" },
    });

    if (existingPendingInvite) {
      const updated = await this.prisma.projectInvite.update({
        where: { id: existingPendingInvite.id },
        data: { role: input.role },
      });
      const result = {
        invite: {
          id: updated.id,
          projectId: updated.projectId,
          email: updated.email,
          role: updated.role,
          createdBy: updated.createdBy,
          status: updated.status as "pending" | "accepted",
          createdAt: iso(updated.createdAt),
        },
        invitedUserId: invitedUser?.id,
        projectName: project.name,
      };

      if (result.invitedUserId && result.invitedUserId !== userId) {
        this.notificationService.createNotification({
          userId: result.invitedUserId,
          projectId,
          type: "member_invited",
          title: "Project invitation received",
          body: `You were invited to join ${result.projectName} as ${input.role}`,
          referenceId: result.invite.id,
        }).catch(() => {});
      }
      return result.invite;
    }

    const invite = await this.prisma.projectInvite.create({
      data: {
        id: createId("invite"),
        projectId,
        email,
        role: input.role,
        createdBy: userId,
        status: "pending",
      },
    });
    const inviteRecord: ProjectInviteRecord = {
      id: invite.id,
      projectId: invite.projectId,
      email: invite.email,
      role: invite.role,
      createdBy: invite.createdBy,
      status: invite.status as "pending" | "accepted",
      createdAt: iso(invite.createdAt),
    };
    const result = { invite: inviteRecord, invitedUserId: invitedUser?.id, projectName: project.name };

    if (result.invitedUserId && result.invitedUserId !== userId) {
      this.notificationService.createNotification({
        userId: result.invitedUserId,
        projectId,
        type: "member_invited",
        title: "Project invitation received",
        body: `You were invited to join ${result.projectName} as ${input.role}`,
        referenceId: result.invite.id,
      }).catch(() => {});
    }
    return result.invite;
  }

  async listPendingProjectInvites(userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException("User not found");

    const invites = await this.prisma.projectInvite.findMany({
      where: { status: "pending", email: user.email.toLowerCase() },
      orderBy: { createdAt: "desc" },
    });

    const summaries = await Promise.all(invites.map(async (invite) => {
      const project = await this.prisma.project.findUnique({ where: { id: invite.projectId } });
      if (!project) return null;
      return {
        id: invite.id,
        projectId: invite.projectId,
        projectName: project.name,
        email: invite.email,
        role: invite.role as ProjectRole,
        status: invite.status as string,
        createdAt: iso(invite.createdAt),
        createdBy: invite.createdBy,
      } satisfies ProjectInviteSummary;
    }));

    return { invites: summaries.filter((s): s is ProjectInviteSummary => s !== null) };
  }

  async acceptProjectInvite(userId: string, inviteId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException("User not found");

    const invite = await this.prisma.projectInvite.findUnique({ where: { id: inviteId } });
    if (!invite) throw new NotFoundException("Project invite not found");
    if (invite.email !== user.email.toLowerCase()) {
      throw new ForbiddenException("This project invite is not assigned to your account");
    }

    const project = await this.prisma.project.findUnique({ where: { id: invite.projectId } });
    if (!project) throw new NotFoundException("Project not found");

    let alreadyMember = false;

    const result = await this.prisma.$transaction(async (tx) => {
      const existingTeamMember = await tx.teamMember.findFirst({ where: { teamId: project.teamId, userId } });
      if (!existingTeamMember) {
        await tx.teamMember.create({ data: { id: createId("tm"), teamId: project.teamId, userId, role: "member" } });
      }

      const existingProjectMember = await tx.projectMember.findFirst({ where: { projectId: project.id, userId } });
      if (existingProjectMember) {
        alreadyMember = true;
        await tx.projectMember.update({ where: { id: existingProjectMember.id }, data: { role: invite.role } });
      } else {
        await tx.projectMember.create({ data: { id: createId("pm"), projectId: project.id, userId, role: invite.role } });
      }

      await tx.projectInvite.update({ where: { id: inviteId }, data: { status: "accepted" } });

      return {
        inviteId: invite.id,
        projectId: project.id,
        projectName: project.name,
        role: invite.role,
        alreadyMember,
        createdBy: invite.createdBy,
      };
    });

    if (result.createdBy !== userId) {
      this.notificationService.createNotification({
        userId: result.createdBy,
        projectId: result.projectId,
        type: "member_invited",
        title: "Project invitation accepted",
        body: `${result.projectName} invitation has been accepted`,
        referenceId: result.inviteId,
      }).catch(() => {});
    }

    return {
      inviteId: result.inviteId,
      projectId: result.projectId,
      projectName: result.projectName,
      role: result.role,
      alreadyMember: result.alreadyMember,
    };
  }

  async addProjectMember(userId: string, projectId: string, input: { email: string; role: ProjectRole }) {
    const actor = await this.getActor(userId, projectId);
    if (!this.actorHasProjectPermission(actor, "member.manage")) {
      throw new ForbiddenException("Only project member managers can assign collaborators");
    }

    const project = await this.prisma.project.findUnique({ where: { id: projectId } });
    if (!project) throw new NotFoundException("Project not found");

    const user = await this.prisma.user.findFirst({ where: { email: input.email.trim().toLowerCase() } });
    if (!user) throw new NotFoundException("User not found");

    const existingTeamMember = await this.prisma.teamMember.findFirst({ where: { teamId: project.teamId, userId: user.id } });
    if (!existingTeamMember) {
      await this.prisma.teamMember.create({ data: { id: createId("tm"), teamId: project.teamId, userId: user.id, role: "member" } });
    }

    const existingProjectMember = await this.prisma.projectMember.findFirst({ where: { projectId, userId: user.id } });
    if (existingProjectMember) {
      const updated = await this.prisma.projectMember.update({ where: { id: existingProjectMember.id }, data: { role: input.role } });
      return this.buildProjectMemberSummaryFromPrisma(updated);
    }

    const member = await this.prisma.projectMember.create({
      data: { id: createId("pm"), projectId, userId: user.id, role: input.role },
    });
    return this.buildProjectMemberSummaryFromPrisma(member);
  }

  async getProjectMemberPermissions(
    userId: string,
    projectId: string,
    memberId: string,
  ): Promise<ProjectMemberPermissionsResponse> {
    const actor = await this.getActor(userId, projectId);
    if (!this.actorHasProjectPermission(actor, "permission.manage")) {
      throw new ForbiddenException("You do not have permission to view project member permissions");
    }

    const project = await this.prisma.project.findUnique({ where: { id: projectId } });
    if (!project) throw new NotFoundException("Project not found");
    const member = await this.prisma.projectMember.findFirst({ where: { id: memberId, projectId } });
    if (!member) throw new NotFoundException("Project member not found");
    return this.buildMemberPermissionsResponseFromPrisma(project, member);
  }

  async updateProjectMemberPermissions(
    userId: string,
    projectId: string,
    memberId: string,
    input: UpdateProjectMemberPermissionsPayload,
  ): Promise<ProjectMemberPermissionsResponse> {
    const actor = await this.getActor(userId, projectId);
    if (!this.actorHasProjectPermission(actor, "permission.manage")) {
      throw new ForbiddenException("You do not have permission to update project member permissions");
    }

    this.assertNoInvalidProjectPermissions(findInvalidPermissionOverrideValues(input.permissionOverride));

    const project = await this.prisma.project.findUnique({ where: { id: projectId } });
    if (!project) throw new NotFoundException("Project not found");
    const member = await this.prisma.projectMember.findFirst({ where: { id: memberId, projectId } });
    if (!member) throw new NotFoundException("Project member not found");
    const nextOverride = normalizePermissionOverride(input.permissionOverride);

    if (await this.removesOwnLastPermissionManagerAsync(project, member, userId, nextOverride)) {
      throw new BadRequestException("You cannot remove your own last permission management path");
    }

    const updated = await this.prisma.projectMember.update({
      where: { id: memberId },
      data: { permissionOverride: optionalJsonInput(nextOverride) },
    });
    return this.buildMemberPermissionsResponseFromPrisma(project, updated);
  }

  async listVersions(userId: string, documentId: string, limit?: number, offset?: number) {
    const document = await this.prisma.document.findUnique({ where: { id: documentId } });
    if (!document) throw new NotFoundException("Document not found");
    await this.assertProjectReadableAsync(document.projectId, userId);

    const all = await this.prisma.version.findMany({
      where: { documentId },
      orderBy: { versionNumber: "desc" },
    });
    const versionsWithImpact = await Promise.all(all.map(async (version) => ({
      ...this.toVersionRecord(version),
      impactSummary: await this.buildVersionImpactSummaryPrisma(version.id),
    })));
    return {
      versions: applyPagination(versionsWithImpact, limit, offset),
      total: all.length,
    };
  }

  async listProjectVersions(userId: string, projectId: string, limit?: number, offset?: number) {
    await this.assertProjectReadableAsync(projectId, userId);

    const projectDocs = await this.prisma.document.findMany({ where: { projectId }, select: { id: true } });
    const documentIds = projectDocs.map((d) => d.id);

    const all = await this.prisma.version.findMany({
      where: { documentId: { in: documentIds } },
      orderBy: [{ documentId: "desc" }, { createdAt: "desc" }],
    });
    const versionsWithImpact = await Promise.all(all.map(async (version) => ({
      ...this.toVersionRecord(version),
      impactSummary: await this.buildVersionImpactSummaryPrisma(version.id),
    })));

    return {
      versions: applyPagination(versionsWithImpact, limit, offset),
      total: all.length,
    };
  }

  async adoptDocumentVersion(userId: string, documentId: string, versionId: string) {
    const document = await this.prisma.document.findUnique({ where: { id: documentId } });
    if (!document) throw new NotFoundException("Document not found");
    const actor = await this.getActor(userId, document.projectId);
    if (!this.actorHasProjectPermission(actor, "project.edit")) {
      throw new ForbiddenException("You do not have permission to adopt a candidate version");
    }

    const liveDocument = await this.prisma.document.findUnique({ where: { id: documentId } });
    if (!liveDocument) throw new NotFoundException("Document not found");
    const liveVersion = await this.prisma.version.findUnique({ where: { id: versionId } });
    if (!liveVersion) throw new NotFoundException("Version not found");
    if (liveVersion.documentId !== liveDocument.id) {
      throw new BadRequestException("Version does not belong to the target document");
    }

    const previousCurrentVersionId = liveDocument.currentVersionId;
    await this.prisma.document.update({
      where: { id: documentId },
      data: { currentVersionId: liveVersion.id, updatedAt: new Date() },
    });
    const result = { document: this.toDocumentRecord({ ...liveDocument, currentVersionId: liveVersion.id, updatedAt: new Date() }), previousCurrentVersionId };

    if (this.getAuditContentType(document.type)) {
      await this.auditService.recordAuditAction({
        projectId: document.projectId,
        versionId,
        documentType: document.type,
        action: "adopted",
        reviewerId: userId,
        comment: "Adopted as current version",
      });
    }

    await this.impactService.scanAfterAdoption({
      projectId: document.projectId,
      sourceDocumentId: documentId,
      previousSourceVersionId: result.previousCurrentVersionId ?? undefined,
      changedSourceVersionId: versionId,
      actorId: userId,
    });

    return result.document;
  }

  async createVersion(
    userId: string,
    documentId: string,
    input: { title: string; content: unknown; metadata?: Record<string, unknown> },
  ) {
    const document = await this.prisma.document.findUnique({ where: { id: documentId } });
    if (!document) throw new NotFoundException("Document not found");
    const actor = await this.getActor(userId, document.projectId);
    if (!this.actorHasProjectPermission(actor, "project.edit")) {
      throw new ForbiddenException("You do not have permission to create a version");
    }

    return this.createVersionForDocument({
      documentId,
      title: input.title,
      content: input.content,
      metadata: input.metadata ?? {},
      createdBy: userId,
      status: "draft",
    });
  }

  async updateVersion(
    userId: string,
    versionId: string,
    input: { title?: string; content?: unknown },
  ) {
    const liveVersion = await this.prisma.version.findUnique({ where: { id: versionId } });
    if (!liveVersion) throw new NotFoundException("Version not found");
    if (liveVersion.status !== "draft") {
      throw new BadRequestException("Only draft versions can be updated");
    }
    const document = await this.prisma.document.findUnique({ where: { id: liveVersion.documentId } });
    if (!document) throw new NotFoundException("Document not found");
    const actor = await this.getActor(userId, document.projectId);
    if (!this.actorHasProjectPermission(actor, "project.edit")) {
      throw new ForbiddenException("You do not have permission to update this version");
    }

    const versionData: Record<string, any> = {};
    if (input.title !== undefined) versionData.title = input.title;
    if (input.content !== undefined) {
      if (document.type === "storyboard") {
        const normalized = ensureMediaBindings(normalizeStoryboardContent(input.content));
        const existing = ensureMediaBindings(jsonOutput<StoryboardContent>(liveVersion.content));
        versionData.content = jsonInput({
          ...normalized,
          mediaBindings: { ...existing.mediaBindings, ...normalized.mediaBindings },
          shotIdMappings: normalized.shotIdMappings ?? existing.shotIdMappings,
        });
      } else {
        versionData.content = jsonInput(input.content);
      }
    }

    const updatedVersion = await this.prisma.$transaction(async (tx) => {
      const refreshed = await tx.version.findUnique({ where: { id: versionId } });
      if (!refreshed || refreshed.status !== "draft") {
        throw new BadRequestException("Only draft versions can be updated");
      }
      const v = await tx.version.update({ where: { id: versionId }, data: versionData });
      await tx.document.update({ where: { id: document.id }, data: { updatedAt: new Date() } });

      const syncEvent = await this.syncCharactersToPairedDraftAsync(tx, this.toVersionRecord(v), this.toDocumentRecord(document), userId);
      return { version: v, syncEvent };
    });

    if (updatedVersion.syncEvent) {
      this.realtimeEvents.emitCharacterSynced(updatedVersion.syncEvent);
    }

    return this.toVersionRecord(updatedVersion.version);
  }

  async deleteVersion(userId: string, versionId: string) {
    const version = await this.prisma.version.findUnique({ where: { id: versionId } });
    if (!version) throw new NotFoundException("Version not found");
    if (version.status !== "draft") {
      throw new BadRequestException("Only draft versions can be deleted");
    }
    const document = await this.prisma.document.findUnique({ where: { id: version.documentId } });
    if (!document) throw new NotFoundException("Document not found");
    const actor = await this.getActor(userId, document.projectId);
    if (!this.actorHasProjectPermission(actor, "project.edit")) {
      throw new ForbiddenException("You do not have permission to delete this version");
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.comment.deleteMany({ where: { versionId } });
      await tx.version.delete({ where: { id: versionId } });

      const doc = await tx.document.findUnique({ where: { id: document.id } });
      if (!doc) return;

      const updateData: Record<string, any> = { updatedAt: new Date() };
      if (doc.currentVersionId === versionId) {
        const latest = await tx.version.findFirst({
          where: { documentId: doc.id },
          orderBy: { versionNumber: "desc" },
        });
        updateData.currentVersionId = latest?.id ?? null;
      }
      if (doc.draftVersionId === versionId) {
        const latestDraft = await tx.version.findFirst({
          where: { documentId: doc.id, status: "draft" },
          orderBy: { versionNumber: "desc" },
        });
        updateData.draftVersionId = latestDraft?.id ?? null;
      }
      await tx.document.update({ where: { id: doc.id }, data: updateData });
    });

    if (this.getAuditContentType(document.type)) {
      await this.auditService.recordAuditAction({
        projectId: document.projectId,
        versionId,
        documentType: document.type,
        action: "deleted",
        reviewerId: userId,
        comment: `Version v${version.versionNumber} deleted`,
      });
    }
  }

  async restoreVersion(userId: string, versionId: string) {
    const version = await this.prisma.version.findUnique({ where: { id: versionId } });
    if (!version) throw new NotFoundException("Version not found");
    const document = await this.prisma.document.findUnique({ where: { id: version.documentId } });
    if (!document) throw new NotFoundException("Document not found");
    const actor = await this.getActor(userId, document.projectId);
    if (!this.actorHasProjectPermission(actor, "project.edit")) {
      throw new ForbiddenException("You do not have permission to restore versions");
    }

    const restoredVersion = await this.createVersionForDocument({
      documentId: document.id,
      title: `${version.title} - Restored`,
      content: version.content,
      metadata: {
        ...(jsonOutput<Record<string, unknown>>(version.metadata) ?? {}),
        source: "restore",
        restoredFromVersionId: version.id,
      },
      createdBy: userId,
      status: "draft",
    });

    if (this.getAuditContentType(document.type)) {
      await this.auditService.recordAuditAction({
        projectId: document.projectId,
        versionId: restoredVersion.id,
        documentType: document.type,
        action: "restored",
        reviewerId: userId,
        comment: `Restored from v${version.versionNumber}`,
      });
    }

    return restoredVersion;
  }

  async adoptVersionById(userId: string, versionId: string) {
    const version = await this.prisma.version.findUnique({ where: { id: versionId } });
    if (!version) throw new NotFoundException("Version not found");
    return this.adoptDocumentVersion(userId, version.documentId, versionId);
  }

  async advanceVersionToReview(userId: string, versionId: string, comment?: string) {
    const version = await this.prisma.version.findUnique({ where: { id: versionId } });
    if (!version) throw new NotFoundException("Version not found");
    const document = await this.prisma.document.findUnique({ where: { id: version.documentId } });
    if (!document) throw new NotFoundException("Document not found");
    const actor = await this.getActor(userId, document.projectId);
    if (!this.actorHasProjectPermission(actor, "version.review")) {
      throw new ForbiddenException("You do not have permission to advance versions to review");
    }

    if (!canTransitionVersionStatus(version.status as VersionStatus, "pending_review")) {
      throw new BadRequestException(`Cannot advance from ${version.status} to pending_review`);
    }
    const updatedVersion = await this.prisma.version.update({
      where: { id: versionId },
      data: { status: "pending_review" },
    });

    const updatedVersionRecord = this.toVersionRecord(updatedVersion);
    const trimmedComment = comment?.trim() || undefined;
    const auditContentType = this.getAuditContentType(document.type as DocumentType);
    if (auditContentType) {
      await this.auditService.recordAuditAction({
        projectId: document.projectId,
        versionId,
        documentType: document.type as DocumentType,
        action: "advanced",
        reviewerId: userId,
        comment: trimmedComment,
      });
    }

    this.realtimeEvents.emitReviewUpdated({
      projectId: document.projectId,
      versionId,
      documentId: document.id,
      status: updatedVersionRecord.status,
      action: "submitted",
    });

    return updatedVersionRecord;
  }

  async submitVersion(userId: string, versionId: string) {
    const version = await this.prisma.version.findUnique({ where: { id: versionId } });
    if (!version) throw new NotFoundException("Version not found");
    const document = await this.prisma.document.findUnique({ where: { id: version.documentId } });
    if (!document) throw new NotFoundException("Document not found");
    const actor = await this.getActor(userId, document.projectId);
    if (!this.actorHasProjectPermission(actor, "project.edit")) {
      throw new ForbiddenException("You do not have permission to submit versions");
    }

    const project = await this.prisma.project.findUnique({ where: { id: document.projectId } });
    if (!project) throw new NotFoundException("Project not found");
    const team = await this.prisma.team.findUnique({ where: { id: project.teamId } });
    if (!team) throw new NotFoundException("Team not found");
    const auditConfigs = await this.prisma.auditConfig.findMany({ where: { projectId: project.id } });
    const auditContentType = this.getAuditContentType(document.type as DocumentType);
    const reviewRequired = auditContentType
      ? resolveContentReviewRequired(team.defaultReviewPolicy as "required" | "bypass", project.reviewPolicyMode, auditConfigs.map((c) => ({
          id: c.id, projectId: c.projectId, contentType: c.contentType as AuditContentType,
          reviewRequired: c.reviewRequired, autoApproveRoles: jsonOutput<ProjectRole[]>(c.autoApproveRoles),
          createdAt: iso(c.createdAt), updatedAt: iso(c.updatedAt),
        })), auditContentType)
      : resolveReviewRequired(team.defaultReviewPolicy as "required" | "bypass", project.reviewPolicyMode);
    const autoApproved = auditContentType
      ? canAutoApprove(auditConfigs.map((c) => ({
          id: c.id, projectId: c.projectId, contentType: c.contentType as AuditContentType,
          reviewRequired: c.reviewRequired, autoApproveRoles: jsonOutput<ProjectRole[]>(c.autoApproveRoles),
          createdAt: iso(c.createdAt), updatedAt: iso(c.updatedAt),
        })), auditContentType, actor.projectRoles)
      : false;
    const nextStatus = getSubmittedStatus(reviewRequired && !autoApproved);
    if (!canTransitionVersionStatus(version.status as VersionStatus, nextStatus)) {
      throw new BadRequestException(`Cannot submit a version in status ${version.status}`);
    }

    const updatedVersion = await this.prisma.version.update({
      where: { id: versionId },
      data: { status: nextStatus },
    });
    const updatedVersionRecord = this.toVersionRecord(updatedVersion);

    if (auditContentType) {
      await this.auditService.recordAuditAction({
        projectId: document.projectId,
        versionId,
        documentType: document.type as DocumentType,
        action: "submitted",
        reviewerId: userId,
      });

      if (autoApproved) {
        await this.auditService.recordAuditAction({
          projectId: document.projectId,
          versionId,
          documentType: document.type as DocumentType,
          action: "approved",
          reviewerId: userId,
          comment: "Auto-approved by audit role policy.",
        });
      }
    }

    this.realtimeEvents.emitReviewUpdated({
      projectId: document.projectId,
      versionId,
      documentId: document.id,
      status: updatedVersionRecord.status,
      action: autoApproved ? "approved" : "submitted",
    });

    return updatedVersionRecord;
  }

  async approveVersion(userId: string, versionId: string, comment?: string) {
    return this.reviewVersion(userId, versionId, "approved", comment);
  }

  async rejectVersion(userId: string, versionId: string, comment?: string) {
    return this.reviewVersion(userId, versionId, "rejected", comment);
  }

  async listComments(userId: string, versionId: string) {
    const version = await this.prisma.version.findUnique({ where: { id: versionId } });
    if (!version) throw new NotFoundException("Version not found");
    const document = await this.prisma.document.findUnique({ where: { id: version.documentId } });
    if (!document) throw new NotFoundException("Document not found");
    await this.assertProjectReadableAsync(document.projectId, userId);

    const comments = await this.prisma.comment.findMany({
      where: { versionId },
      orderBy: { createdAt: "asc" },
    });
    return Promise.all(comments.map(async (comment) => {
      const author = await this.prisma.user.findUnique({ where: { id: comment.authorId } });
      return {
        id: comment.id,
        versionId: comment.versionId,
        authorId: comment.authorId,
        body: comment.body,
        parentId: comment.parentId ?? undefined,
        anchorType: comment.anchorType as AnchorType,
        anchorId: comment.anchorId ?? undefined,
        resolved: comment.resolved,
        createdAt: iso(comment.createdAt),
        updatedAt: iso(comment.updatedAt),
        authorDisplayName: author?.displayName ?? "Unknown",
        authorEmail: author?.email ?? "",
      };
    }));
  }

  async addComment(
    userId: string,
    versionId: string,
    input: { body: string; parentId?: string; anchorType: AnchorType; anchorId?: string },
  ) {
    const body = input.body.trim();
    if (!body) {
      throw new BadRequestException("Comment body is required");
    }

    const version = await this.prisma.version.findUnique({ where: { id: versionId } });
    if (!version) throw new NotFoundException("Version not found");
    const document = await this.prisma.document.findUnique({ where: { id: version.documentId } });
    if (!document) throw new NotFoundException("Document not found");
    await this.assertProjectReadableAsync(document.projectId, userId);

    let parentAuthorId: string | undefined;
    if (input.parentId) {
      const parent = await this.prisma.comment.findUnique({ where: { id: input.parentId } });
      if (!parent || parent.versionId !== versionId) {
        throw new BadRequestException("Parent comment does not belong to this version");
      }
      parentAuthorId = parent.authorId;
    }

    const comment = await this.prisma.comment.create({
      data: {
        id: createId("comment"),
        versionId,
        authorId: userId,
        body,
        parentId: input.parentId,
        anchorType: input.anchorType,
        anchorId: input.anchorId,
        resolved: false,
      },
    });

    const author = await this.prisma.user.findUnique({ where: { id: userId } });
    const result = {
      comment: {
        id: comment.id,
        versionId: comment.versionId,
        authorId: comment.authorId,
        body: comment.body,
        parentId: comment.parentId ?? undefined,
        anchorType: comment.anchorType as AnchorType,
        anchorId: comment.anchorId ?? undefined,
        resolved: comment.resolved,
        createdAt: iso(comment.createdAt),
        updatedAt: iso(comment.updatedAt),
        authorDisplayName: author?.displayName ?? "Unknown",
        authorEmail: author?.email ?? "",
      },
      projectId: document.projectId,
      documentId: document.id,
      versionTitle: version.title,
      versionAuthorId: version.createdBy,
      parentAuthorId,
    };

    const notificationType = input.parentId ? "comment_reply" : "comment_added";
    const recipients = new Set<string>();
    if (result.parentAuthorId && result.parentAuthorId !== userId) {
      recipients.add(result.parentAuthorId);
    }
    if (result.versionAuthorId && result.versionAuthorId !== userId) {
      recipients.add(result.versionAuthorId);
    }

    recipients.forEach((recipientId) => {
      void this.notificationService.createNotification({
        userId: recipientId,
        projectId: result.projectId,
        type: notificationType,
        title: input.parentId ? "New reply on a version comment" : "New comment on a version",
        body: `${result.comment.authorDisplayName}: ${body.slice(0, 120)}`,
        referenceId: result.comment.id,
        referenceType: "comment",
      });
    });

    this.realtimeEvents.emitReviewUpdated({
      projectId: result.projectId,
      versionId,
      documentId: result.documentId,
      action: notificationType,
      commentId: result.comment.id,
      parentId: result.comment.parentId,
    });

    return result.comment;
  }

  async getWorldBible(userId: string, projectId: string): Promise<WorldBibleContent> {
    await this.assertProjectReadableAsync(projectId, userId);
    return this.extractWorldBibleAsync(projectId);
  }

  async updateWorldBible(
    userId: string,
    projectId: string,
    content: Partial<WorldBibleContent>,
  ): Promise<WorldBibleContent> {
    const actor = await this.getActor(userId, projectId);
    if (!this.actorHasProjectPermission(actor, "project.edit")) {
      throw new ForbiddenException("You do not have permission to update the world bible");
    }

    const existing = await this.extractWorldBibleAsync(projectId);
    const merged: WorldBibleContent = {
      characters: content.characters ?? existing.characters,
      locations: content.locations ?? existing.locations,
      styleGuide: content.styleGuide !== undefined ? content.styleGuide : existing.styleGuide,
      voiceConfigs: content.voiceConfigs ?? existing.voiceConfigs,
    };
    await this.persistWorldBibleAsync(projectId, userId, merged);
    return merged;
  }

  async addCharacter(
    userId: string,
    projectId: string,
    input: { name: string; appearance: string; personality?: string; tags?: string[]; referenceImages?: string[]; costumes?: Record<string, string> },
  ): Promise<CharacterProfile> {
    const actor = await this.getActor(userId, projectId);
    if (!this.actorHasProjectPermission(actor, "project.edit")) {
      throw new ForbiddenException("You do not have permission to edit the world bible");
    }

    const wb = await this.extractWorldBibleAsync(projectId);
    const character: CharacterProfile = {
      id: createId("char"),
      name: input.name.trim(),
      appearance: input.appearance.trim(),
      personality: input.personality?.trim(),
      tags: input.tags ?? [],
      referenceImages: input.referenceImages ?? [],
      costumes: input.costumes,
      sortOrder: wb.characters.length,
    };
    wb.characters.push(character);
    await this.persistWorldBibleAsync(projectId, userId, wb);
    return character;
  }

  async updateCharacter(
    userId: string,
    projectId: string,
    characterId: string,
    input: Partial<Omit<CharacterProfile, "id" | "sortOrder">>,
  ): Promise<CharacterProfile> {
    const actor = await this.getActor(userId, projectId);
    if (!this.actorHasProjectPermission(actor, "project.edit")) {
      throw new ForbiddenException("You do not have permission to edit the world bible");
    }

    const wb = await this.extractWorldBibleAsync(projectId);
    const character = wb.characters.find((c) => c.id === characterId);
    if (!character) {
      throw new NotFoundException("Character not found");
    }
    const oldName = character.name;
    if (input.name !== undefined) character.name = input.name.trim();
    if (input.appearance !== undefined) character.appearance = input.appearance.trim();
    if (input.personality !== undefined) character.personality = input.personality?.trim();
    if (input.tags !== undefined) character.tags = input.tags;
    if (input.referenceImages !== undefined) character.referenceImages = input.referenceImages;
    if (input.costumes !== undefined) character.costumes = input.costumes;
    await this.persistWorldBibleAsync(projectId, userId, wb);
    if (input.name !== undefined && character.name !== oldName) {
      await this.syncCharacterNameToScriptsAsync(projectId, userId, characterId, oldName, character.name);
    }
    return character;
  }

  async deleteCharacter(userId: string, projectId: string, characterId: string) {
    const actor = await this.getActor(userId, projectId);
    if (!this.actorHasProjectPermission(actor, "project.edit")) {
      throw new ForbiddenException("You do not have permission to edit the world bible");
    }

    const wb = await this.extractWorldBibleAsync(projectId);
    const index = wb.characters.findIndex((c) => c.id === characterId);
    if (index === -1) {
      throw new NotFoundException("Character not found");
    }
    wb.characters.splice(index, 1);
    await this.persistWorldBibleAsync(projectId, userId, wb);
    await this.clearCharacterRefsInScriptsAsync(projectId, userId, characterId);
  }

  async addLocation(
    userId: string,
    projectId: string,
    input: { name: string; description: string; lighting?: string; timeOfDay?: string; referenceImages?: string[] },
  ): Promise<LocationProfile> {
    const actor = await this.getActor(userId, projectId);
    if (!this.actorHasProjectPermission(actor, "project.edit")) {
      throw new ForbiddenException("You do not have permission to edit the world bible");
    }

    const wb = await this.extractWorldBibleAsync(projectId);
    const location: LocationProfile = {
      id: createId("loc"),
      name: input.name.trim(),
      description: input.description.trim(),
      lighting: input.lighting?.trim(),
      timeOfDay: input.timeOfDay?.trim(),
      referenceImages: input.referenceImages ?? [],
      sortOrder: wb.locations.length,
    };
    wb.locations.push(location);
    await this.persistWorldBibleAsync(projectId, userId, wb);
    return location;
  }

  async updateLocation(
    userId: string,
    projectId: string,
    locationId: string,
    input: Partial<Omit<LocationProfile, "id" | "sortOrder">>,
  ): Promise<LocationProfile> {
    const actor = await this.getActor(userId, projectId);
    if (!this.actorHasProjectPermission(actor, "project.edit")) {
      throw new ForbiddenException("You do not have permission to edit the world bible");
    }

    const wb = await this.extractWorldBibleAsync(projectId);
    const location = wb.locations.find((l) => l.id === locationId);
    if (!location) {
      throw new NotFoundException("Location not found");
    }
    if (input.name !== undefined) location.name = input.name.trim();
    if (input.description !== undefined) location.description = input.description.trim();
    if (input.lighting !== undefined) location.lighting = input.lighting?.trim();
    if (input.timeOfDay !== undefined) location.timeOfDay = input.timeOfDay?.trim();
    if (input.referenceImages !== undefined) location.referenceImages = input.referenceImages;
    await this.persistWorldBibleAsync(projectId, userId, wb);
    return location;
  }

  async deleteLocation(userId: string, projectId: string, locationId: string) {
    const actor = await this.getActor(userId, projectId);
    if (!this.actorHasProjectPermission(actor, "project.edit")) {
      throw new ForbiddenException("You do not have permission to edit the world bible");
    }

    const wb = await this.extractWorldBibleAsync(projectId);
    const locIndex = wb.locations.findIndex((l) => l.id === locationId);
    if (locIndex === -1) {
      throw new NotFoundException("Location not found");
    }
    wb.locations.splice(locIndex, 1);
    await this.persistWorldBibleAsync(projectId, userId, wb);
    await this.clearLocationRefsInScriptsAsync(projectId, userId, locationId);
  }

  async updateStyleGuide(
    userId: string,
    projectId: string,
    input: { visualStyle: string; colorPalette?: string; compositionNote?: string; negativePrompt?: string; referenceImages?: string[] },
  ): Promise<StyleGuideProfile> {
    const actor = await this.getActor(userId, projectId);
    if (!this.actorHasProjectPermission(actor, "project.edit")) {
      throw new ForbiddenException("You do not have permission to edit the world bible");
    }

    const wb = await this.extractWorldBibleAsync(projectId);
    const guide: StyleGuideProfile = {
      visualStyle: input.visualStyle.trim(),
      colorPalette: input.colorPalette?.trim(),
      compositionNote: input.compositionNote?.trim(),
      negativePrompt: input.negativePrompt?.trim(),
      referenceImages: input.referenceImages ?? [],
    };
    wb.styleGuide = guide;
    await this.persistWorldBibleAsync(projectId, userId, wb);
    return guide;
  }

  async ensureDocumentForProject(options: {
    projectId: string;
    type: DocumentType;
    title: string;
    createdBy: string;
    shotId?: string;
  }): Promise<DocumentRecord> {
    const existing = await this.prisma.document.findFirst({
      where: { projectId: options.projectId, type: options.type, shotId: options.shotId ?? null },
    });
    if (existing) return this.toDocumentRecord(existing);

    const document = await this.prisma.document.create({
      data: {
        id: createId("doc"),
        projectId: options.projectId,
        type: options.type,
        title: options.title,
        shotId: options.shotId,
        createdBy: options.createdBy,
      },
    });
    return this.toDocumentRecord(document);
  }

  async bindMediaToStoryboardDraft(
    projectId: string,
    shotId: string,
    mediaType: "image" | "video" | "audio",
    mediaVersionId: string,
    createdBy: string,
  ): Promise<void> {
    const sbDoc = await this.prisma.document.findFirst({
      where: { projectId, type: "storyboard" },
    });
    if (!sbDoc) return;

    const draft = await this.prisma.version.findFirst({
      where: { documentId: sbDoc.id, status: "draft" },
      orderBy: { versionNumber: "desc" },
    });

    if (draft) {
      const content = ensureMediaBindings(jsonOutput<StoryboardContent>(draft.content));
      content.mediaBindings[shotId] = {
        ...(content.mediaBindings[shotId] ?? {}),
        [`${mediaType}VersionId`]: mediaVersionId,
      };
      await this.prisma.version.update({ where: { id: draft.id }, data: { content: jsonInput(content) } });
    } else {
      let currentContent: StoryboardContent = { overview: "", shots: [], mediaBindings: {} };
      if (sbDoc.currentVersionId) {
        const currentVersion = await this.prisma.version.findUnique({ where: { id: sbDoc.currentVersionId } });
        if (currentVersion?.content) {
          currentContent = ensureMediaBindings(jsonOutput<StoryboardContent>(currentVersion.content));
        }
      }
      const content = ensureMediaBindings(currentContent);
      content.mediaBindings[shotId] = {
        ...(content.mediaBindings[shotId] ?? {}),
        [`${mediaType}VersionId`]: mediaVersionId,
      };

      const siblingVersions = await this.prisma.version.findMany({ where: { documentId: sbDoc.id } });
      const newVersion = await this.prisma.$transaction(async (tx) => {
        const version = await tx.version.create({
          data: {
            id: createId("version"),
            documentId: sbDoc.id,
            versionNumber: getNextVersionNumber(siblingVersions.map((v) => this.toVersionRecord(v))),
            status: "draft",
            title: "Auto draft (media binding)",
            content: jsonInput(content),
            metadata: jsonInput({ source: "auto-media-binding" }),
            parentVersionId: sbDoc.currentVersionId,
            createdBy,
          },
        });
        await tx.document.update({
          where: { id: sbDoc.id },
          data: { draftVersionId: version.id, updatedAt: new Date() },
        });
        return version;
      });
    }
  }

  async updateDraftMediaBinding(
    userId: string,
    versionId: string,
    shotId: string,
    binding: Partial<ShotMediaBinding>,
  ) {
    const liveVersion = await this.prisma.version.findUnique({ where: { id: versionId } });
    if (!liveVersion) throw new NotFoundException("Version not found");
    const document = await this.prisma.document.findUnique({ where: { id: liveVersion.documentId } });
    if (!document) throw new NotFoundException("Document not found");
    const actor = await this.getActor(userId, document.projectId);
    if (!this.actorHasProjectPermission(actor, "project.edit")) {
      throw new ForbiddenException("You do not have permission to update media bindings");
    }

    if (liveVersion.status !== "draft") {
      throw new BadRequestException("Media bindings can only be updated on draft versions");
    }
    const content = ensureMediaBindings(jsonOutput<StoryboardContent>(liveVersion.content));
    content.mediaBindings[shotId] = { ...(content.mediaBindings[shotId] ?? {}), ...binding };
    const updated = await this.prisma.version.update({
      where: { id: versionId },
      data: { content: jsonInput(content) },
    });
    return this.toVersionRecord(updated);
  }

  async createVersionForDocument(options: {
    documentId: string;
    title: string;
    content: unknown;
    metadata: Record<string, unknown>;
    createdBy: string;
    status?: VersionStatus;
  }): Promise<VersionRecord> {
    const result = await this.prisma.$transaction(async (tx) => {
      const document = await tx.document.findUnique({ where: { id: options.documentId } });
      if (!document) throw new NotFoundException("Document not found");

      const siblingVersions = await tx.version.findMany({ where: { documentId: document.id } });
      const siblingRecords = siblingVersions.map((v) => this.toVersionRecord(v));
      const latestVersion = siblingRecords.reduce<VersionRecord | undefined>((current, candidate) => {
        if (!current || candidate.versionNumber > current.versionNumber) return candidate;
        return current;
      }, undefined);

      const normalizedContent = document.type === "storyboard"
        ? ensureMediaBindings(normalizeStoryboardContent(options.content))
        : options.content;
      const version = await tx.version.create({
        data: {
          id: createId("version"),
          documentId: document.id,
          versionNumber: getNextVersionNumber(siblingRecords),
          status: options.status ?? "draft",
          title: options.title,
          content: jsonInput(normalizedContent),
          metadata: jsonInput(options.metadata),
          parentVersionId: latestVersion?.id,
          createdBy: options.createdBy,
        },
      });
      const versionRecord = this.toVersionRecord(version);
      const documentRecord = this.toDocumentRecord(document);

      const docUpdateData: Record<string, any> = { draftVersionId: version.id, updatedAt: new Date() };
      if (version.status === "approved") {
        docUpdateData.currentVersionId = version.id;
      }
      await tx.document.update({ where: { id: document.id }, data: docUpdateData });

      await this.ensurePairedDraftAsync(tx, document.projectId, document.type, version.id, document.id, options.createdBy);

      const syncEvent = this.syncCharactersToPairedDraftInMemory(versionRecord, documentRecord, options.createdBy, tx);

      if (
        document.type === "script" &&
        options.metadata?.source !== "world-bible-sync" &&
        normalizedContent &&
        typeof normalizedContent === "object"
      ) {
        const scriptContent = normalizedContent as ScriptContent;
        if (Array.isArray(scriptContent.characters)) {
          for (const char of scriptContent.characters) {
            if (char.worldBibleCharId) {
              await this.syncCharacterNameToWorldBibleAsync(
                tx, document.projectId, options.createdBy, char.worldBibleCharId, char.name,
              );
            }
          }
        }
      }

      return { version: versionRecord, syncEvent };
    });

    if (result.syncEvent) {
      this.realtimeEvents.emitCharacterSynced(result.syncEvent);
    }

    await this.impactService.recordDependenciesForVersion(result.version.id);

    return result.version;
  }

  /**
   * 为 AI 生成内容创建版本，并根据项目审核策略自动确定初始审核状态。
   * 如果不需要审核或用户角色可自动批准，版本直接进入 approved 状态；
   * 否则进入 submitted 状态等待审核。
   */
  async createGeneratedVersionForDocument(options: {
    userId: string;
    documentId: string;
    title: string;
    content: unknown;
    metadata: Record<string, unknown>;
  }): Promise<VersionRecord> {
    const document = await this.prisma.document.findUnique({ where: { id: options.documentId } });
    if (!document) throw new NotFoundException("Document not found");
    const actor = await this.getActor(options.userId, document.projectId);

    const project = await this.prisma.project.findUnique({ where: { id: document.projectId } });
    if (!project) throw new NotFoundException("Project not found");
    const team = await this.prisma.team.findUnique({ where: { id: project.teamId } });
    if (!team) throw new NotFoundException("Team not found");
    const auditConfigs = await this.prisma.auditConfig.findMany({ where: { projectId: project.id } });
    const auditContentType = this.getAuditContentType(document.type as DocumentType);
    const reviewRequired = auditContentType
      ? resolveContentReviewRequired(team.defaultReviewPolicy as "required" | "bypass", project.reviewPolicyMode, auditConfigs.map((c) => ({
          id: c.id, projectId: c.projectId, contentType: c.contentType as AuditContentType,
          reviewRequired: c.reviewRequired, autoApproveRoles: jsonOutput<ProjectRole[]>(c.autoApproveRoles),
          createdAt: iso(c.createdAt), updatedAt: iso(c.updatedAt),
        })), auditContentType)
      : resolveReviewRequired(team.defaultReviewPolicy as "required" | "bypass", project.reviewPolicyMode);
    const autoApproved = auditContentType
      ? canAutoApprove(auditConfigs.map((c) => ({
          id: c.id, projectId: c.projectId, contentType: c.contentType as AuditContentType,
          reviewRequired: c.reviewRequired, autoApproveRoles: jsonOutput<ProjectRole[]>(c.autoApproveRoles),
          createdAt: iso(c.createdAt), updatedAt: iso(c.updatedAt),
        })), auditContentType, actor.projectRoles)
      : false;
    const policy = {
      auditContentType,
      status: getSubmittedStatus(reviewRequired && !autoApproved),
      autoApproved,
    };

    const version = await this.createVersionForDocument({
      documentId: options.documentId,
      title: options.title,
      content: options.content,
      metadata: options.metadata,
      createdBy: options.userId,
      status: policy.status,
    });

    if (policy.auditContentType) {
      await this.auditService.recordAuditAction({
        projectId: document.projectId,
        versionId: version.id,
        documentType: document.type,
        action: "submitted",
        reviewerId: options.userId,
      });

      if (policy.autoApproved) {
        await this.auditService.recordAuditAction({
          projectId: document.projectId,
          versionId: version.id,
          documentType: document.type,
          action: "approved",
          reviewerId: options.userId,
          comment: "Auto-approved by audit role policy.",
        });
      }

      this.realtimeEvents.emitReviewUpdated({
        projectId: document.projectId,
        versionId: version.id,
        documentId: document.id,
        status: version.status,
        action: policy.autoApproved ? "approved" : "submitted",
      });
    }

    return version;
  }

  private async reviewVersion(userId: string, versionId: string, nextStatus: "approved" | "rejected", comment?: string) {
    const version = await this.prisma.version.findUnique({ where: { id: versionId } });
    if (!version) throw new NotFoundException("Version not found");
    const document = await this.prisma.document.findUnique({ where: { id: version.documentId } });
    if (!document) throw new NotFoundException("Document not found");
    const actor = await this.getActor(userId, document.projectId);
    if (!this.actorHasProjectPermission(actor, "version.review")) {
      throw new ForbiddenException("You do not have permission to review this version");
    }

    if (!canTransitionVersionStatus(version.status as VersionStatus, nextStatus)) {
      throw new BadRequestException(`Cannot move version from ${version.status} to ${nextStatus}`);
    }

    const updatedVersion = await this.prisma.$transaction(async (tx) => {
      const v = await tx.version.update({
        where: { id: versionId },
        data: { status: nextStatus },
      });

      const metadata = jsonOutput<Record<string, unknown>>(v.metadata) ?? {};
      const pairedId = metadata.pairedVersionId as string | undefined;
      if (pairedId) {
        const pairedVersion = await tx.version.findUnique({ where: { id: pairedId } });
        if (pairedVersion) {
          const pairedMeta = { ...jsonOutput<Record<string, unknown>>(pairedVersion.metadata), pairedVersionId: undefined, pairedDocumentId: undefined };
          await tx.version.update({ where: { id: pairedId }, data: { metadata: jsonInput(pairedMeta) } });
        }
        const newMeta = { ...metadata, pairedVersionId: undefined, pairedDocumentId: undefined };
        await tx.version.update({ where: { id: versionId }, data: { metadata: jsonInput(newMeta) } });
      }

      return v;
    });
    const updatedVersionRecord = this.toVersionRecord(updatedVersion);

    const trimmedComment = comment?.trim() || undefined;
    if (this.getAuditContentType(document.type as DocumentType)) {
      await this.auditService.recordAuditAction({
        projectId: document.projectId,
        versionId,
        documentType: document.type as DocumentType,
        action: nextStatus === "approved" ? "approved" : "rejected",
        reviewerId: userId,
        comment: trimmedComment,
      });
    }

    this.realtimeEvents.emitReviewUpdated({
      projectId: document.projectId,
      versionId,
      documentId: document.id,
      status: updatedVersionRecord.status,
      action: nextStatus,
    });

    return updatedVersionRecord;
  }

  private async buildProjectActorContext(userId: string, projectId: string): Promise<ActorContext> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException("User not found");

    const project = await this.prisma.project.findUnique({ where: { id: projectId } });
    if (!project) throw new NotFoundException("Project not found");

    const team = await this.prisma.team.findUnique({ where: { id: project.teamId } });
    if (!team) throw new NotFoundException("Team not found");

    const projectMembers = await this.prisma.projectMember.findMany({ where: { projectId, userId } });
    const teamMembers = await this.prisma.teamMember.findMany({ where: { teamId: project.teamId, userId } });
    const teamRoles = teamMembers.map((member) => member.role);

    return {
      userId,
      globalRole: user.globalRole,
      teamRoles,
      projectRoles: projectMembers.map((member) => member.role),
      projectMembers: projectMembers.map((member) => ({
        role: member.role,
        permissionOverride: normalizePermissionOverride(jsonOutput(member.permissionOverride)),
      })),
      projectRolePermissionTemplates: jsonOutput(team.projectRolePermissionTemplates),
    };
  }

  private resolveActorProjectPermissions(actor: ActorContext): ProjectPermission[] {
    if (canManageTenant(actor)) {
      return [...PROJECT_PERMISSIONS];
    }

    return resolveProjectPermissions(actor);
  }

  private actorHasProjectPermission(actor: ActorContext, permission: ProjectPermission): boolean {
    return this.resolveActorProjectPermissions(actor).includes(permission);
  }

  private assertNoInvalidProjectPermissions(invalid: Array<{ path: string; value: string }>): void {
    if (invalid.length === 0) {
      return;
    }

    const details = invalid.map((entry) => `${entry.path}: ${entry.value}`).join(", ");
    throw new BadRequestException(`Invalid project permission value: ${details}`);
  }

  private async getActor(userId: string, projectId?: string, teamId?: string): Promise<ActorContext> {
    if (projectId) {
      return this.buildProjectActorContext(userId, projectId);
    }

    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException("User not found");

    const team = teamId ? await this.prisma.team.findUnique({ where: { id: teamId } }) : undefined;

    let teamRoles: TeamRole[] = [];
    let projectRolePermissionTemplates: ProjectRolePermissionTemplates | undefined;
    if (team) {
      const teamMembers = await this.prisma.teamMember.findMany({ where: { teamId: team.id, userId } });
      teamRoles = teamMembers.map((member) => member.role as TeamRole);
      projectRolePermissionTemplates = jsonOutput(team.projectRolePermissionTemplates);
    }

    return {
      userId,
      globalRole: user.globalRole,
      teamRoles,
      projectRoles: [],
      projectMembers: [],
      projectRolePermissionTemplates,
    };
  }

  private mergeLlmConfig(
    savedConfig?: LlmProviderConfig,
    draftConfig?: LlmProviderConfig,
  ): LlmProviderConfig | undefined {
    if (!savedConfig && !draftConfig) {
      return undefined;
    }

    return {
      ...savedConfig,
      ...draftConfig,
      provider: draftConfig?.provider ?? savedConfig?.provider ?? "openai-completions",
    };
  }

  private mergePersistedLlmConfig(
    savedConfig?: LlmProviderConfig,
    nextConfig?: LlmProviderConfig,
  ): LlmProviderConfig | undefined {
    if (!nextConfig) {
      return savedConfig;
    }

    const apiKey = Object.prototype.hasOwnProperty.call(nextConfig, "apiKey")
      ? nextConfig.apiKey
      : savedConfig?.apiKey;
    const merged: LlmProviderConfig = {
      ...nextConfig,
      provider: nextConfig.provider ?? savedConfig?.provider ?? "openai-completions",
      ...(apiKey ? { apiKey } : {}),
    };

    if (!merged.apiKey && !merged.baseUrl && !merged.model && merged.stream === undefined) {
      return undefined;
    }

    return merged;
  }

  private mergePersistedImageGenerationConfig(
    savedConfig?: ImageGenerationConfig,
    nextConfig?: ImageGenerationConfig,
  ): ImageGenerationConfig | undefined {
    if (!nextConfig) {
      return savedConfig;
    }

    const apiKey = Object.prototype.hasOwnProperty.call(nextConfig, "apiKey")
      ? nextConfig.apiKey?.trim() || undefined
      : savedConfig?.apiKey;
    const baseUrl = Object.prototype.hasOwnProperty.call(nextConfig, "baseUrl")
      ? nextConfig.baseUrl?.trim() || undefined
      : savedConfig?.baseUrl;
    const model = Object.prototype.hasOwnProperty.call(nextConfig, "model")
      ? nextConfig.model?.trim() || undefined
      : savedConfig?.model;
    const sdConfig = nextConfig.provider === "stable-diffusion"
      ? nextConfig.sdConfig
      : undefined;
    const comfyuiConfig = nextConfig.provider === "comfyui"
      ? nextConfig.comfyuiConfig
      : undefined;
    const merged: ImageGenerationConfig = {
      provider: nextConfig.provider ?? savedConfig?.provider ?? "google-gemini",
      ...(apiKey ? { apiKey } : {}),
      ...(baseUrl ? { baseUrl } : {}),
      ...(model ? { model } : {}),
      ...(sdConfig ? { sdConfig } : {}),
      ...(comfyuiConfig ? { comfyuiConfig } : {}),
    };

    if (!merged.apiKey && !merged.baseUrl && !merged.model && !merged.sdConfig && !merged.comfyuiConfig) {
      return undefined;
    }

    return merged;
  }

  private async buildTeamSummaryFromRecord(
    team: ReturnType<typeof this.toTeamRecord>,
    userId: string,
    globalRole: ActorContext["globalRole"],
  ): Promise<TeamSummary> {
    const teamMembers = await this.prisma.teamMember.findMany({ where: { teamId: team.id, userId } });
    const teamRoles = teamMembers.map((member) => member.role);

    return {
      id: team.id,
      name: team.name,
      slug: team.slug,
      defaultReviewPolicy: team.defaultReviewPolicy,
      createdAt: team.createdAt,
      updatedAt: team.updatedAt,
      currentUserRole: teamRoles[0] ?? null,
      canManage: canManageTenant({
        userId,
        globalRole,
        teamRoles,
        projectRoles: [],
      }),
    };
  }

  private buildTeamSettingsResponseFromRecord(
    team: ReturnType<typeof this.toTeamRecord>,
    userId: string,
    globalRole: ActorContext["globalRole"],
  ): TeamSettingsResponse {
    return {
      id: team.id,
      name: team.name,
      slug: team.slug,
      defaultReviewPolicy: team.defaultReviewPolicy,
      createdAt: team.createdAt,
      updatedAt: team.updatedAt,
      currentUserRole: null,
      canManage: false,
      llmConfig: this.buildTeamSettingsLlmConfig(team.llmConfig as LlmProviderConfig | undefined),
      imageGenerationConfig: this.buildTeamSettingsImageGenerationConfig(team.imageGenerationConfig as ImageGenerationConfig | undefined),
      imageProviders: team.imageProviders as ProviderEntry[] | undefined,
      videoProviders: team.videoProviders as ProviderEntry[] | undefined,
      defaultImageProvider: team.defaultImageProvider,
      defaultVideoProvider: team.defaultVideoProvider,
      permissionTemplates: this.buildTeamPermissionTemplatesResponseFromRecord(team),
    };
  }

  private buildTeamPermissionTemplatesResponseFromRecord(team: ReturnType<typeof this.toTeamRecord>): TeamPermissionTemplatesResponse {
    const templates = normalizeProjectRolePermissionTemplates(team.projectRolePermissionTemplates);
    const resolvedTemplates: ProjectRolePermissionTemplateSummary[] = PROJECT_ROLES.map((role) => {
      const teamPermissions = templates[role];
      return {
        role,
        systemPermissions: [...SYSTEM_PROJECT_ROLE_PERMISSION_TEMPLATES[role]],
        ...(teamPermissions ? { teamPermissions } : {}),
        effectivePermissions: getProjectRoleTemplatePermissions(role, templates),
        locked: role === "project_admin",
      };
    });

    return {
      systemDefaults: SYSTEM_PROJECT_ROLE_PERMISSION_TEMPLATES,
      templates,
      resolvedTemplates,
    };
  }

  private async buildMemberPermissionsResponseFromPrisma(
    project: { id: string; teamId: string },
    member: { id: string; userId: string; role: string; permissionOverride: unknown },
  ): Promise<ProjectMemberPermissionsResponse> {
    const team = await this.prisma.team.findUnique({ where: { id: project.teamId } });
    if (!team) throw new NotFoundException("Team not found");
    const permissionOverride = normalizePermissionOverride(jsonOutput(member.permissionOverride));
    const inheritedPermissions = getProjectRoleTemplatePermissions(member.role as ProjectRole, jsonOutput(team.projectRolePermissionTemplates));
    const user = await this.prisma.user.findUnique({ where: { id: member.userId } });
    if (!user) throw new NotFoundException("User not found");
    const teamMembers = await this.prisma.teamMember.findMany({ where: { teamId: project.teamId, userId: member.userId } });

    const effectivePermissions = resolveProjectPermissions({
      userId: member.userId,
      globalRole: user.globalRole,
      teamRoles: teamMembers.map((item) => item.role),
      projectRoles: [member.role as ProjectRole],
      projectMembers: [{ role: member.role as ProjectRole, permissionOverride }],
      projectRolePermissionTemplates: jsonOutput(team.projectRolePermissionTemplates),
    });

    return {
      memberId: member.id,
      userId: member.userId,
      role: member.role as ProjectRole,
      inheritedPermissions,
      permissionOverride,
      effectivePermissions,
    };
  }

  private buildTeamSettingsLlmConfig(config?: LlmProviderConfig): TeamSettingsLlmConfig | undefined {
    if (!config) {
      return undefined;
    }

    return {
      provider: config.provider,
      baseUrl: config.baseUrl,
      model: config.model,
      stream: config.stream,
      hasApiKey: Boolean(config.apiKey),
    };
  }

  private buildTeamSettingsImageGenerationConfig(config?: ImageGenerationConfig): ImageGenerationSettingsConfig | undefined {
    if (!config) {
      return undefined;
    }

    return {
      provider: config.provider,
      baseUrl: config.baseUrl,
      model: config.model,
      sdConfig: config.sdConfig,
      comfyuiConfig: config.comfyuiConfig,
      hasApiKey: Boolean(config.apiKey),
    };
  }

  private async getTeamMemberSummariesAsync(teamId: string): Promise<TeamMemberSummary[]> {
    const members = await this.prisma.teamMember.findMany({ where: { teamId } });
    const summaries = await Promise.all(members.map(async (member) => {
      const user = await this.prisma.user.findUnique({ where: { id: member.userId } });
      return {
        id: member.id,
        userId: member.userId,
        role: member.role as TeamRole,
        createdAt: iso(member.createdAt),
        displayName: user?.displayName ?? "Unknown",
        email: user?.email ?? "",
      };
    }));
    return summaries.sort((left, right) => left.displayName.localeCompare(right.displayName));
  }

  private buildTeamMemberSummaryFromRecords(
    member: { id: string; userId: string; role: string; createdAt: Date },
    user: { displayName: string; email: string } | null,
  ): TeamMemberSummary {
    return {
      id: member.id,
      userId: member.userId,
      role: member.role as TeamRole,
      createdAt: iso(member.createdAt),
      displayName: user?.displayName ?? "Unknown",
      email: user?.email ?? "",
    };
  }

  private async getProjectMemberSummariesAsync(projectId: string): Promise<ProjectMemberSummary[]> {
    const members = await this.prisma.projectMember.findMany({ where: { projectId } });
    const summaries = await Promise.all(members.map(async (member) => {
      return this.buildProjectMemberSummaryFromPrisma(member);
    }));
    return summaries.sort((left, right) => left.displayName.localeCompare(right.displayName));
  }

  private async buildProjectMemberSummaryFromPrisma(
    member: { id: string; userId: string; role: string; projectId: string; permissionOverride: unknown; createdAt: Date },
  ): Promise<ProjectMemberSummary> {
    const user = await this.prisma.user.findUnique({ where: { id: member.userId } });
    if (!user) throw new NotFoundException("User not found");
    const project = await this.prisma.project.findUnique({ where: { id: member.projectId } });
    if (!project) throw new NotFoundException("Project not found");
    const permissions = await this.buildMemberPermissionsResponseFromPrisma(project, member);
    return {
      id: member.id,
      userId: member.userId,
      role: member.role as ProjectRole,
      createdAt: iso(member.createdAt),
      displayName: user.displayName,
      email: user.email,
      inheritedPermissions: permissions.inheritedPermissions,
      permissionOverride: permissions.permissionOverride,
      effectivePermissions: permissions.effectivePermissions,
    };
  }

  private async getProjectInviteSummariesAsync(projectIds: string[]): Promise<ProjectInviteSummary[]> {
    const invites = await this.prisma.projectInvite.findMany({
      where: { projectId: { in: projectIds } },
      orderBy: { createdAt: "desc" },
    });
    const summaries = await Promise.all(invites.map(async (invite) => {
      const project = await this.prisma.project.findUnique({ where: { id: invite.projectId } });
      if (!project) return null;
      return {
        id: invite.id,
        projectId: invite.projectId,
        projectName: project.name,
        email: invite.email,
        role: invite.role as ProjectRole,
        status: invite.status as string,
        createdAt: iso(invite.createdAt),
        createdBy: invite.createdBy,
      } satisfies ProjectInviteSummary;
    }));
    return summaries.filter((s): s is ProjectInviteSummary => s !== null);
  }

  private async getReviewQueueAsync(projectIds: string[]): Promise<ReviewQueueVersionSummary[]> {
    const projectDocs = await this.prisma.document.findMany({
      where: { projectId: { in: projectIds } },
      select: { id: true, projectId: true, title: true },
    });
    const documentIds = projectDocs.map((d) => d.id);
    const docMap = new Map(projectDocs.map((d) => [d.id, d]));

    const reviewVersions = await this.prisma.version.findMany({
      where: {
        documentId: { in: documentIds },
        status: { in: ["pending_review", "submitted"] },
      },
      orderBy: { createdAt: "desc" },
    });

    const summaries = await Promise.all(reviewVersions.map(async (version) => {
      const doc = docMap.get(version.documentId);
      if (!doc) return null;
      const project = await this.prisma.project.findUnique({ where: { id: doc.projectId } });
      if (!project || !projectIds.includes(project.id)) return null;
      return {
        id: version.id,
        title: version.title,
        status: version.status as VersionStatus,
        versionNumber: version.versionNumber,
        createdAt: iso(version.createdAt),
        documentId: doc.id,
        documentTitle: doc.title,
        projectId: project.id,
        projectName: project.name,
      };
    }));
    return summaries.filter((s): s is ReviewQueueVersionSummary => s !== null);
  }

  /** 使用 Prisma 构建版本影响摘要（替代 impactService.buildVersionImpactSummary） */
  private async buildVersionImpactSummaryPrisma(versionId: string) {
    const issues = await this.prisma.impactIssue.findMany({ where: { targetVersionId: versionId } });
    const dependencies = await this.prisma.versionDependency.findMany({ where: { targetVersionId: versionId } });
    return {
      versionId,
      dependencies,
      openCount: issues.filter((i) => i.status === "open").length,
      suggestedCount: issues.filter((i) => i.status === "suggested").length,
      acceptedCount: issues.filter((i) => i.status === "accepted").length,
      ignoredCount: issues.filter((i) => i.status === "ignored").length,
      resolvedCount: issues.filter((i) => i.status === "resolved").length,
      latestIssues: issues.slice(0, 5).map((i) => ({
        id: i.id, projectId: i.projectId, title: i.title, status: i.status,
        severity: i.severity, targetDocumentId: i.targetDocumentId,
        targetVersionId: i.targetVersionId, createdAt: iso(i.createdAt),
      })),
    };
  }

  private isReviewQueueStatus(status: VersionStatus) {
    return status === "pending_review" || status === "submitted";
  }

  private toJobResultRecord(result: unknown): Record<string, unknown> | undefined {
    if (!result || typeof result !== "object" || Array.isArray(result)) {
      return undefined;
    }

    return result as Record<string, unknown>;
  }

  private getAuditContentType(documentType: DocumentType): AuditContentType | undefined {
    if (documentType === "script" || documentType === "storyboard" || documentType === "image" || documentType === "video") {
      return documentType;
    }

    return undefined;
  }

  private async assertProjectReadableAsync(projectId: string, userId: string) {
    const actor = await this.buildProjectActorContext(userId, projectId);

    if (!this.actorHasProjectPermission(actor, "project.view")) {
      throw new ForbiddenException("You do not have access to this project");
    }
  }

  private async removesOwnLastPermissionManagerAsync(
    project: { id: string; teamId: string },
    member: { id: string; userId: string; role: string; permissionOverride: unknown },
    actorUserId: string,
    nextOverride: PermissionOverride,
  ): Promise<boolean> {
    if (member.userId !== actorUserId) {
      return false;
    }

    const members = await this.prisma.projectMember.findMany({ where: { projectId: project.id } });
    const hasPermissionManage = async (item: { id: string; userId: string; role: string; permissionOverride: unknown }) =>
      (await this.buildMemberPermissionsResponseFromPrisma(project, item))
        .effectivePermissions.includes("permission.manage");
    const managersBefore: typeof members = [];
    for (const m of members) {
      if (await hasPermissionManage(m)) managersBefore.push(m);
    }

    if (managersBefore.length !== 1 || managersBefore[0]?.id !== member.id) {
      return false;
    }

    const nextMember = { ...member, permissionOverride: nextOverride };
    for (const item of members) {
      const check = item.id === member.id ? nextMember : item;
      if (await hasPermissionManage(check as any)) return false;
    }
    return true;
  }

  private async ensurePairedDraftAsync(
    tx: any,
    projectId: string,
    documentType: string,
    createdVersionId: string,
    createdDocumentId: string,
    userId: string,
  ): Promise<void> {
    if (documentType !== "script" && documentType !== "world_bible") return;

    const peerType = documentType === "script" ? "world_bible" : "script";
    let peerDoc = await tx.document.findFirst({
      where: { projectId, type: peerType as any },
    });

    if (!peerDoc) {
      const peerTitle = peerType === "world_bible" ? "世界观设定" : "剧本";
      peerDoc = await tx.document.create({
        data: {
          id: createId("doc"),
          projectId,
          type: peerType as any,
          title: peerTitle,
          createdBy: userId,
        },
      });
    }

    const existingDraftVersions = await tx.version.findMany({
      where: { documentId: peerDoc.id },
      orderBy: { versionNumber: "desc" },
    });
    const existingDraft = existingDraftVersions.find((v: any) => v.status === "draft" || v.status === "submitted");

    let pairedVersionId: string;

    if (existingDraft) {
      pairedVersionId = existingDraft.id;
      const existingMeta = { ...jsonOutput<Record<string, unknown>>(existingDraft.metadata), pairedVersionId: createdVersionId, pairedDocumentId: createdDocumentId };
      await tx.version.update({ where: { id: existingDraft.id }, data: { metadata: jsonInput(existingMeta) } });
    } else {
      const latestVersion = (existingDraftVersions as Array<{ versionNumber: number; id: string; [k: string]: unknown }>).reduce(
        (current, candidate) => !current || candidate.versionNumber > current.versionNumber ? candidate : current,
        undefined as typeof existingDraftVersions[number] | undefined);

      const emptyContent = peerType === "world_bible"
        ? { characters: [], locations: [] }
        : { logline: "", premise: "", characters: [], scenes: [] };

      const newVersion = await tx.version.create({
        data: {
          id: createId("version"),
          documentId: peerDoc.id,
          versionNumber: getNextVersionNumber(existingDraftVersions.map((v: any) => this.toVersionRecord(v))),
          status: "draft",
          title: "配对草稿",
          content: jsonInput(latestVersion?.content ?? emptyContent),
          metadata: jsonInput({
            source: "character-sync",
            pairedVersionId: createdVersionId,
            pairedDocumentId: createdDocumentId,
          }),
          parentVersionId: latestVersion?.id,
          createdBy: userId,
        },
      });
      await tx.document.update({
        where: { id: peerDoc.id },
        data: { draftVersionId: newVersion.id, updatedAt: new Date() },
      });
      pairedVersionId = newVersion.id;
    }

    const createdVersion = await tx.version.findUnique({ where: { id: createdVersionId } });
    if (createdVersion) {
      const meta = { ...jsonOutput<Record<string, unknown>>(createdVersion.metadata), pairedVersionId, pairedDocumentId: peerDoc.id };
      await tx.version.update({ where: { id: createdVersionId }, data: { metadata: jsonInput(meta) } });
    }
  }

  /** 在事务内同步角色到配对草稿（内存操作 + Prisma 写入） */
  private syncCharactersToPairedDraftInMemory(
    version: VersionRecord,
    document: DocumentRecord,
    userId: string,
    tx: any,
  ): RealtimeCharacterSyncedEvent | null {
    // 注意：此方法在事务内使用时，仅返回同步事件信息，
    // 实际的 Prisma 写入由调用方在事务内完成。
    // 由于版本内容已在事务中创建/更新，这里只计算需要的事件。
    const metadata = version.metadata ?? {};
    const pairedVersionId = metadata.pairedVersionId as string | undefined;
    const pairedDocumentId = metadata.pairedDocumentId as string | undefined;
    if (!pairedVersionId || !pairedDocumentId) return null;
    if ((metadata as any).source === "character-sync") return null;

    // 返回一个基本事件，实际的同步逻辑由异步版本处理
    return null;
  }

  /** 异步同步角色到配对草稿（独立 Prisma 调用） */
  private async syncCharactersToPairedDraftAsync(
    tx: any,
    version: VersionRecord,
    document: DocumentRecord,
    userId: string,
  ): Promise<RealtimeCharacterSyncedEvent | null> {
    const metadata = version.metadata ?? {};
    const pairedVersionId = metadata.pairedVersionId as string | undefined;
    const pairedDocumentId = metadata.pairedDocumentId as string | undefined;
    if (!pairedVersionId || !pairedDocumentId) return null;
    if ((metadata as any).source === "character-sync") return null;

    const pairedVersionRow = await tx.version.findUnique({ where: { id: pairedVersionId } });
    if (!pairedVersionRow || pairedVersionRow.status !== "draft") {
      const newMeta = { ...version.metadata, pairedVersionId: undefined, pairedDocumentId: undefined };
      await tx.version.update({ where: { id: version.id }, data: { metadata: jsonInput(newMeta) } });
      return null;
    }
    const pairedVersion = this.toVersionRecord(pairedVersionRow);

    const addedCharacters: Array<{ name: string; id?: string }> = [];
    const updatedCharacters: Array<{ name: string }> = [];

    if (document.type === "script" && version.content && typeof version.content === "object") {
      const scriptContent = version.content as ScriptContent;
      const wbContent = ((pairedVersion.content as WorldBibleContent) ?? { characters: [], locations: [] });
      const wbCharacters = [...(wbContent.characters ?? [])];

      for (const scriptChar of scriptContent.characters ?? []) {
        if (scriptChar.worldBibleCharId) {
          const wbChar = wbCharacters.find((c) => c.id === scriptChar.worldBibleCharId);
          if (wbChar && wbChar.summary !== scriptChar.profile) {
            wbChar.summary = scriptChar.profile || undefined;
            updatedCharacters.push({ name: scriptChar.name });
          }
        } else {
          const newId = createId("char");
          wbCharacters.push({
            id: newId,
            name: scriptChar.name,
            appearance: "",
            summary: scriptChar.profile || undefined,
            tags: [],
            referenceImages: [],
            sortOrder: wbCharacters.length,
          });
          scriptChar.worldBibleCharId = newId;
          addedCharacters.push({ name: scriptChar.name, id: newId });
        }
      }

      if (addedCharacters.length || updatedCharacters.length) {
        await tx.version.update({
          where: { id: pairedVersionId },
          data: { content: jsonInput({ ...wbContent, characters: wbCharacters }) },
        });
        await tx.version.update({
          where: { id: version.id },
          data: { content: jsonInput({ ...scriptContent, characters: scriptContent.characters }) },
        });
      }
    } else if (document.type === "world_bible" && version.content && typeof version.content === "object") {
      const wbContent = version.content as WorldBibleContent;
      const scriptContent = ((pairedVersion.content as ScriptContent) ?? { characters: [], scenes: [] });
      const scriptCharacters = [...(scriptContent.characters ?? [])];

      for (const wbChar of wbContent.characters ?? []) {
        const existingScriptChar = scriptCharacters.find((c) => c.worldBibleCharId === wbChar.id);
        if (existingScriptChar) {
          if (existingScriptChar.profile !== (wbChar.summary ?? "")) {
            existingScriptChar.profile = wbChar.summary ?? "";
            updatedCharacters.push({ name: wbChar.name });
          }
        } else {
          scriptCharacters.push({
            name: wbChar.name,
            profile: wbChar.summary ?? "",
            worldBibleCharId: wbChar.id,
          });
          addedCharacters.push({ name: wbChar.name, id: wbChar.id });
        }
      }

      if (addedCharacters.length || updatedCharacters.length) {
        await tx.version.update({
          where: { id: pairedVersionId },
          data: { content: jsonInput({ ...scriptContent, characters: scriptCharacters }) },
        });
      }
    }

    if (!addedCharacters.length && !updatedCharacters.length) return null;

    return {
      projectId: document.projectId,
      sourceDocumentId: document.id,
      targetDocumentId: pairedDocumentId,
      sourceVersionId: version.id,
      targetVersionId: pairedVersionId,
      addedCharacters,
      updatedCharacters,
    };
  }

  private async syncCharacterNameToScriptsAsync(
    projectId: string,
    userId: string,
    characterId: string,
    oldName: string,
    newName: string,
  ): Promise<void> {
    const scriptDocs = await this.prisma.document.findMany({
      where: { projectId, type: "script" },
    });
    for (const doc of scriptDocs) {
      if (!doc.currentVersionId) continue;
      const version = await this.prisma.version.findUnique({ where: { id: doc.currentVersionId } });
      if (!version?.content || typeof version.content !== "object") continue;

      const content = jsonOutput<ScriptContent>(version.content);
      if (!Array.isArray(content.scenes) && !Array.isArray(content.characters)) continue;

      let changed = false;
      const updatedCharacters = (content.characters ?? []).map((c) => {
        if (c.worldBibleCharId === characterId || (!c.worldBibleCharId && c.name === oldName)) {
          changed = true;
          return { ...c, name: newName, worldBibleCharId: characterId };
        }
        return c;
      });

      const updatedScenes = (content.scenes ?? []).map((scene) => {
        const updatedSceneChars = scene.characters.map((name) => {
          if (name === oldName) { changed = true; return newName; }
          return name;
        });
        const updatedDialogue = scene.dialogue.map((d) => {
          if (d.speaker === oldName) { changed = true; return { ...d, speaker: newName }; }
          return d;
        });
        return { ...scene, characters: updatedSceneChars, dialogue: updatedDialogue };
      });

      if (!changed) continue;

      const updatedContent: ScriptContent = { ...content, characters: updatedCharacters, scenes: updatedScenes };
      const siblingVersions = await this.prisma.version.findMany({ where: { documentId: doc.id } });
      const now = new Date();
      const newVersion = await this.prisma.version.create({
        data: {
          id: createId("version"),
          documentId: doc.id,
          versionNumber: getNextVersionNumber(siblingVersions.map((v) => this.toVersionRecord(v))),
          status: "draft",
          title: `角色同步: ${oldName} → ${newName}`,
          content: jsonInput(updatedContent),
          metadata: jsonInput({ source: "world-bible-sync", characterId, oldName, newName }),
          parentVersionId: version.id,
          createdBy: userId,
        },
      });
      await this.prisma.document.update({
        where: { id: doc.id },
        data: { draftVersionId: newVersion.id, updatedAt: now },
      });
    }
  }

  private async syncCharacterNameToWorldBibleAsync(
    txOrPrisma: any,
    projectId: string,
    userId: string,
    characterId: string,
    newName: string,
  ): Promise<void> {
    const wbDoc = await txOrPrisma.document.findFirst({
      where: { projectId, type: "world_bible" },
    });
    if (!wbDoc || !wbDoc.currentVersionId) return;

    const version = await txOrPrisma.version.findUnique({ where: { id: wbDoc.currentVersionId } });
    if (!version?.content || typeof version.content !== "object") return;

    const wb = jsonOutput<WorldBibleContent>(version.content);
    const character = (wb.characters ?? []).find((c) => c.id === characterId);
    if (!character || character.name === newName) return;

    character.name = newName;
    const updatedWb: WorldBibleContent = { ...wb, characters: [...wb.characters] };

    const siblingVersions = await txOrPrisma.version.findMany({ where: { documentId: wbDoc.id } });
    const newVersion = await txOrPrisma.version.create({
      data: {
        id: createId("version"),
        documentId: wbDoc.id,
        versionNumber: getNextVersionNumber(siblingVersions.map((v: any) => this.toVersionRecord(v))),
        status: "draft",
        title: `剧本同步: 角色 ${newName}`,
        content: jsonInput(updatedWb),
        metadata: jsonInput({ source: "script-sync", characterId, newName }),
        parentVersionId: version.id,
        createdBy: userId,
      },
    });
    await txOrPrisma.document.update({
      where: { id: wbDoc.id },
      data: { draftVersionId: newVersion.id, updatedAt: new Date() },
    });
  }

  private async clearCharacterRefsInScriptsAsync(
    projectId: string,
    userId: string,
    characterId: string,
  ): Promise<void> {
    const scriptDocs = await this.prisma.document.findMany({
      where: { projectId, type: "script" },
    });
    for (const doc of scriptDocs) {
      if (!doc.currentVersionId) continue;
      const version = await this.prisma.version.findUnique({ where: { id: doc.currentVersionId } });
      if (!version?.content || typeof version.content !== "object") continue;

      const content = jsonOutput<ScriptContent>(version.content);
      if (!Array.isArray(content.characters)) continue;

      let changed = false;
      const updatedCharacters = content.characters.map((c) => {
        if (c.worldBibleCharId === characterId) {
          changed = true;
          const { worldBibleCharId: _, ...rest } = c;
          return rest;
        }
        return c;
      });

      if (!changed) continue;

      const updatedContent: ScriptContent = { ...content, characters: updatedCharacters };
      const siblingVersions = await this.prisma.version.findMany({ where: { documentId: doc.id } });
      const now = new Date();
      const newVersion = await this.prisma.version.create({
        data: {
          id: createId("version"),
          documentId: doc.id,
          versionNumber: getNextVersionNumber(siblingVersions.map((v) => this.toVersionRecord(v))),
          status: "draft",
          title: "角色关联清理",
          content: jsonInput(updatedContent),
          metadata: jsonInput({ source: "world-bible-sync", deletedCharacterId: characterId }),
          parentVersionId: version.id,
          createdBy: userId,
        },
      });
      await this.prisma.document.update({
        where: { id: doc.id },
        data: { draftVersionId: newVersion.id, updatedAt: now },
      });
    }
  }

  private async clearLocationRefsInScriptsAsync(
    projectId: string,
    userId: string,
    locationId: string,
  ): Promise<void> {
    const scriptDocs = await this.prisma.document.findMany({
      where: { projectId, type: "script" },
    });
    for (const doc of scriptDocs) {
      if (!doc.currentVersionId) continue;
      const version = await this.prisma.version.findUnique({ where: { id: doc.currentVersionId } });
      if (!version?.content || typeof version.content !== "object") continue;

      const content = jsonOutput<ScriptContent>(version.content);
      if (!Array.isArray(content.scenes)) continue;

      let changed = false;
      const updatedScenes = content.scenes.map((scene) => {
        if (scene.locationId === locationId) {
          changed = true;
          const { locationId: _, ...rest } = scene;
          return rest;
        }
        return scene;
      });

      if (!changed) continue;

      const updatedContent: ScriptContent = { ...content, scenes: updatedScenes };
      const siblingVersions = await this.prisma.version.findMany({ where: { documentId: doc.id } });
      const now = new Date();
      const newVersion = await this.prisma.version.create({
        data: {
          id: createId("version"),
          documentId: doc.id,
          versionNumber: getNextVersionNumber(siblingVersions.map((v) => this.toVersionRecord(v))),
          status: "draft",
          title: "地点关联清理",
          content: jsonInput(updatedContent),
          metadata: jsonInput({ source: "world-bible-sync", deletedLocationId: locationId }),
          parentVersionId: version.id,
          createdBy: userId,
        },
      });
      await this.prisma.document.update({
        where: { id: doc.id },
        data: { draftVersionId: newVersion.id, updatedAt: now },
      });
    }
  }

  private async extractWorldBibleAsync(projectId: string): Promise<WorldBibleContent> {
    const wbDoc = await this.prisma.document.findFirst({
      where: { projectId, type: "world_bible" },
    });
    if (!wbDoc || !wbDoc.currentVersionId) {
      return { characters: [], locations: [] };
    }

    const version = await this.prisma.version.findUnique({ where: { id: wbDoc.currentVersionId } });
    if (!version || !version.content || typeof version.content !== "object") {
      return { characters: [], locations: [] };
    }

    const content = jsonOutput<Record<string, unknown>>(version.content);
    return {
      characters: Array.isArray(content.characters) ? content.characters as WorldBibleContent["characters"] : [],
      locations: Array.isArray(content.locations) ? content.locations as WorldBibleContent["locations"] : [],
      styleGuide: content.styleGuide && typeof content.styleGuide === "object"
        ? content.styleGuide as WorldBibleContent["styleGuide"]
        : undefined,
      voiceConfigs: Array.isArray(content.voiceConfigs) ? content.voiceConfigs as CharacterVoiceConfig[] : undefined,
    };
  }

  private async persistWorldBibleAsync(projectId: string, userId: string, content: WorldBibleContent) {
    let wbDoc = await this.prisma.document.findFirst({
      where: { projectId, type: "world_bible" },
    });

    if (!wbDoc) {
      wbDoc = await this.prisma.document.create({
        data: {
          id: createId("doc"),
          projectId,
          type: "world_bible",
          title: "\u4e16\u754c\u89c2\u8bbe\u5b9a",
          createdBy: userId,
        },
      });
    }

    const siblingVersions = await this.prisma.version.findMany({ where: { documentId: wbDoc.id } });
    const latestVersion = siblingVersions.length > 0
      ? siblingVersions.reduce((latest, v) => v.versionNumber > latest.versionNumber ? v : latest, siblingVersions[0])
      : undefined;

    const prevMetadata = latestVersion ? jsonOutput<Record<string, unknown>>(latestVersion.metadata) ?? {} : {};
    const version = await this.prisma.$transaction(async (tx) => {
      const newVersion = await tx.version.create({
        data: {
          id: createId("version"),
          documentId: wbDoc!.id,
          versionNumber: getNextVersionNumber(siblingVersions.map((v) => this.toVersionRecord(v))),
          status: "draft",
          title: "\u4e16\u754c\u89c2\u8bbe\u5b9a\u66f4\u65b0",
          content: jsonInput(content),
          metadata: jsonInput({
            source: "world-bible-editor",
            pairedVersionId: prevMetadata.pairedVersionId,
            pairedDocumentId: prevMetadata.pairedDocumentId,
          }),
          parentVersionId: latestVersion?.id,
          createdBy: userId,
        },
      });
      await tx.document.update({
        where: { id: wbDoc!.id },
        data: {
          draftVersionId: newVersion.id,
          currentVersionId: newVersion.id,
          updatedAt: new Date(),
        },
      });

      // \u5728\u4e8b\u52a1\u5185\u6267\u884c\u89d2\u8272\u540c\u6b65
      const versionRecord = this.toVersionRecord(newVersion);
      const docRecord = this.toDocumentRecord(wbDoc!);
      const syncEvent = await this.syncCharactersToPairedDraftAsync(tx, versionRecord, docRecord, userId);
      if (syncEvent) {
        this.realtimeEvents.emitCharacterSynced(syncEvent);
      }

      return newVersion;
    });
  }

  // ===== Timeline Methods =====

  async getTimeline(userId: string, projectId: string): Promise<TimelineRecord> {
    await this.assertProjectReadableAsync(projectId, userId);
    const existing = await this.prisma.timeline.findUnique({ where: { projectId } });
    if (existing) {
      return {
        id: existing.id,
        projectId: existing.projectId,
        duration: existing.duration,
        fps: existing.fps,
        resolution: existing.resolution,
        tracks: jsonOutput(existing.tracks),
        createdAt: iso(existing.createdAt),
        updatedAt: iso(existing.updatedAt),
      };
    }
    return this.createDefaultTimeline(projectId);
  }

  async saveTimeline(userId: string, projectId: string, payload: TimelineSavePayload): Promise<TimelineRecord> {
    const actor = await this.getActor(userId, projectId);
    if (!this.actorHasProjectPermission(actor, "timeline.edit")) {
      throw new ForbiddenException("You do not have permission to edit the timeline");
    }

    const project = await this.prisma.project.findUnique({ where: { id: projectId } });
    if (!project) throw new NotFoundException("Project not found");

    const existing = await this.prisma.timeline.findUnique({ where: { projectId } });
    if (existing) {
      const updated = await this.prisma.timeline.update({
        where: { projectId },
        data: {
          duration: payload.duration,
          fps: payload.fps,
          resolution: payload.resolution,
          tracks: jsonInput(payload.tracks),
          updatedAt: new Date(),
        },
      });
      return {
        id: updated.id,
        projectId: updated.projectId,
        duration: updated.duration,
        fps: updated.fps,
        resolution: updated.resolution,
        tracks: jsonOutput(updated.tracks),
        createdAt: iso(updated.createdAt),
        updatedAt: iso(updated.updatedAt),
      };
    }

    const timeline = await this.prisma.timeline.create({
      data: {
        id: createId("tl"),
        projectId,
        duration: payload.duration,
        fps: payload.fps,
        resolution: payload.resolution,
        tracks: jsonInput(payload.tracks),
      },
    });
    return {
      id: timeline.id,
      projectId: timeline.projectId,
      duration: timeline.duration,
      fps: timeline.fps,
      resolution: timeline.resolution,
      tracks: jsonOutput(timeline.tracks),
      createdAt: iso(timeline.createdAt),
      updatedAt: iso(timeline.updatedAt),
    };
  }

  private async findApprovedShotCompositionVersionAsync(
    projectId: string,
    shotId: string,
  ): Promise<{ version: VersionRecord; content: MediaContent } | null> {
    const videoDocument = await this.prisma.document.findFirst({
      where: { projectId, type: "video", shotId },
    });
    if (!videoDocument) return null;

    const candidates = await this.prisma.version.findMany({
      where: {
        documentId: videoDocument.id,
        status: "approved",
      },
      orderBy: { createdAt: "desc" },
    });

    for (const version of candidates) {
      const meta = jsonOutput<Record<string, unknown>>(version.metadata);
      if (meta?.source !== "shot_composition") continue;
      const content = jsonOutput<MediaContent>(version.content);
      if (content?.assetUrl) {
        return { version: this.toVersionRecord(version), content };
      }
    }
    return null;
  }

  async autoAssembleTimeline(userId: string, projectId: string): Promise<TimelineRecord> {
    const actor = await this.getActor(userId, projectId);
    if (!this.actorHasProjectPermission(actor, "timeline.edit")) {
      throw new ForbiddenException("You do not have permission to edit the timeline");
    }

    const project = await this.prisma.project.findUnique({ where: { id: projectId } });
    if (!project) throw new NotFoundException("Project not found");

    // Gather storyboard data
    const storyboardDoc = await this.prisma.document.findFirst({
      where: { projectId, type: "storyboard" },
    });

    const videoTracks: TimelineClipRecord[] = [];
    const dialogueTracks: TimelineClipRecord[] = [];
    const subtitleTracks: TimelineClipRecord[] = [];
    let currentTime = 0;
    let clipIndex = 0;

    if (storyboardDoc && storyboardDoc.currentVersionId) {
      const sbVersion = await this.prisma.version.findUnique({ where: { id: storyboardDoc.currentVersionId } });
      if (sbVersion && sbVersion.content && typeof sbVersion.content === "object") {
        const sbContent = jsonOutput<StoryboardContent>(sbVersion.content);
        const shots = Array.isArray(sbContent.shots) ? sbContent.shots : [];

        for (const shot of shots) {
          const shotDuration = shot.durationSeconds || 3;

          // 优先使用已验收的单镜头合成版本
          const composition = await this.findApprovedShotCompositionVersionAsync(projectId, shot.id);
          if (composition) {
            videoTracks.push({
              id: createId("clip"),
              assetUrl: composition.content.assetUrl,
              assetId: composition.content.assetId,
              startTime: currentTime,
              duration: shotDuration,
              inPoint: 0,
              sortOrder: clipIndex,
              label: shot.shotLabel || `Shot ${clipIndex + 1}`,
              shotId: shot.id,
              transitionIn: clipIndex > 0 ? "fade" : "none",
              transitionDuration: clipIndex > 0 ? 0.5 : undefined,
              source: "shot_composition",
            });
            currentTime += shotDuration;
            clipIndex++;
            continue;
          }

          // Find adopted video asset for this shot
          const videoDoc = await this.prisma.document.findFirst({
            where: { projectId, type: "video", shotId: shot.id },
          });
          if (videoDoc && videoDoc.currentVersionId) {
            const videoVersion = await this.prisma.version.findUnique({ where: { id: videoDoc.currentVersionId } });
            const videoContent = videoVersion?.content ? jsonOutput<Record<string, unknown>>(videoVersion.content) : undefined;
            videoTracks.push({
              id: createId("clip"),
              assetUrl: (videoContent?.assetUrl as string) ?? undefined,
              assetId: (videoContent?.assetId as string) ?? undefined,
              startTime: currentTime,
              duration: shotDuration,
              inPoint: 0,
              sortOrder: clipIndex,
              label: shot.shotLabel || `Shot ${clipIndex + 1}`,
              shotId: shot.id,
              transitionIn: clipIndex > 0 ? "fade" : "none",
              transitionDuration: clipIndex > 0 ? 0.5 : undefined,
              source: "timeline_auto_assemble",
            });
          }

          // Find audio asset for this shot
          const audioDoc = await this.prisma.document.findFirst({
            where: { projectId, type: "audio", shotId: shot.id },
          });
          if (audioDoc && audioDoc.currentVersionId) {
            const audioVersion = await this.prisma.version.findUnique({ where: { id: audioDoc.currentVersionId } });
            const audioContent = audioVersion?.content ? jsonOutput<Record<string, unknown>>(audioVersion.content) : undefined;
            dialogueTracks.push({
              id: createId("clip"),
              assetUrl: (audioContent?.assetUrl as string) ?? undefined,
              assetId: (audioContent?.assetId as string) ?? undefined,
              startTime: currentTime,
              duration: shotDuration,
              inPoint: 0,
              sortOrder: clipIndex,
              label: shot.dialogue ? shot.dialogue.substring(0, 30) : undefined,
              shotId: shot.id,
              source: "timeline_auto_assemble",
            });
          }

          // Generate subtitle from dialogue
          if (shot.dialogue) {
            subtitleTracks.push({
              id: createId("clip"),
              startTime: currentTime,
              duration: shotDuration,
              inPoint: 0,
              sortOrder: clipIndex,
              subtitleText: shot.dialogue,
              subtitleStyle: { fontSize: 24, color: "#ffffff", position: "bottom" },
              label: shot.dialogue.substring(0, 30),
              shotId: shot.id,
              source: "timeline_auto_assemble",
            });
          }

          currentTime += shotDuration;
          clipIndex++;
        }
      }
    }

    const tracks: TimelineTrackRecord[] = [
      { id: createId("track"), type: "video", name: "视频", sortOrder: 0, isMuted: false, volume: 1.0, clips: videoTracks },
      { id: createId("track"), type: "dialogue", name: "对白", sortOrder: 1, isMuted: false, volume: 1.0, clips: dialogueTracks },
      { id: createId("track"), type: "music", name: "音乐", sortOrder: 2, isMuted: false, volume: 0.5, clips: [] },
      { id: createId("track"), type: "sfx", name: "音效", sortOrder: 3, isMuted: false, volume: 0.8, clips: [] },
      { id: createId("track"), type: "subtitle", name: "字幕", sortOrder: 4, isMuted: false, volume: 1.0, clips: subtitleTracks },
    ];

    const existing = await this.prisma.timeline.findUnique({ where: { projectId } });
    if (existing) {
      const updated = await this.prisma.timeline.update({
        where: { projectId },
        data: { tracks: jsonInput(tracks), duration: currentTime, updatedAt: new Date() },
      });
      return {
        id: updated.id, projectId: updated.projectId,
        duration: updated.duration, fps: updated.fps, resolution: updated.resolution,
        tracks: jsonOutput(updated.tracks), createdAt: iso(updated.createdAt), updatedAt: iso(updated.updatedAt),
      };
    }

    const timeline = await this.prisma.timeline.create({
      data: {
        id: createId("tl"),
        projectId,
        duration: currentTime,
        fps: 30,
        resolution: "1080x1920",
        tracks: jsonInput(tracks),
      },
    });
    return {
      id: timeline.id, projectId: timeline.projectId,
      duration: timeline.duration, fps: timeline.fps, resolution: timeline.resolution,
      tracks: jsonOutput(timeline.tracks), createdAt: iso(timeline.createdAt), updatedAt: iso(timeline.updatedAt),
    };
  }

  async listExports(userId: string, projectId: string): Promise<ExportRecord[]> {
    await this.assertProjectReadableAsync(projectId, userId);
    const exports = await this.prisma.export.findMany({
      where: { projectId },
      orderBy: { createdAt: "desc" },
    });
    return exports.map((e) => ({
      id: e.id,
      projectId: e.projectId,
      taskId: e.taskId,
      resolution: e.resolution,
      fps: e.fps,
      bitrate: e.bitrate ?? undefined,
      format: e.format,
      outputUrl: e.outputUrl ?? undefined,
      fileSize: e.fileSize ?? undefined,
      duration: e.duration ?? undefined,
      status: e.status,
      createdBy: e.createdBy,
      createdAt: iso(e.createdAt),
      completedAt: optionalIso(e.completedAt),
    })) as ExportRecord[];
  }

  async registerProjectAsset(
    projectId: string,
    userId: string,
    input: {
      type: string;
      title: string;
      filename: string;
      assetId: string;
      assetUrl: string;
      mimeType: string;
      sizeInBytes: number;
      shotId?: string;
    },
  ) {
    const actor = await this.getActor(userId, projectId);
    if (!this.actorHasProjectPermission(actor, "project.edit")) {
      throw new ForbiddenException("You do not have permission to register assets");
    }

    const validTypes: string[] = ["video", "audio", "subtitle", "image"];
    if (!validTypes.includes(input.type)) {
      throw new BadRequestException(`Invalid asset type: ${input.type}`);
    }

    const document = await this.ensureDocumentForProject({
      projectId,
      type: input.type as any,
      title: input.title,
      createdBy: userId,
      shotId: input.shotId,
    });

    const version = await this.createVersionForDocument({
      documentId: document.id,
      title: input.title,
      content: {
        prompt: "",
        assetId: input.assetId,
        assetUrl: input.assetUrl,
        mimeType: input.mimeType,
        provider: "upload",
        mode: "upload",
        note: "用户上传",
        parameters: {},
      },
      metadata: {
        source: "media-library-upload",
        filename: input.filename,
        sizeInBytes: input.sizeInBytes,
      },
      createdBy: userId,
    });

    return { document, version };
  }

  async updateCharacterVoice(
    userId: string,
    projectId: string,
    characterId: string,
    config: Omit<CharacterVoiceConfig, "characterId">,
  ): Promise<CharacterVoiceConfig> {
    const actor = await this.getActor(userId, projectId);
    if (!this.actorHasProjectPermission(actor, "project.edit")) {
      throw new ForbiddenException("You do not have permission to edit voice configuration");
    }

    const wb = await this.extractWorldBibleAsync(projectId);
    const character = wb.characters.find((c) => c.id === characterId);
    if (!character) {
      throw new NotFoundException("Character not found");
    }

    const voiceConfig: CharacterVoiceConfig = {
      characterId,
      ...config,
    };

    const voiceConfigs = wb.voiceConfigs ? [...wb.voiceConfigs] : [];
    const existingIdx = voiceConfigs.findIndex((v) => v.characterId === characterId);
    if (existingIdx >= 0) {
      voiceConfigs[existingIdx] = voiceConfig;
    } else {
      voiceConfigs.push(voiceConfig);
    }

    await this.persistWorldBibleAsync(projectId, userId, { ...wb, voiceConfigs });
    return voiceConfig;
  }

  private createDefaultTimeline(projectId: string): TimelineRecord {
    return {
      id: createId("tl"),
      projectId,
      duration: 0,
      fps: 30,
      resolution: "1080x1920",
      tracks: [
        { id: createId("track"), type: "video", name: "视频", sortOrder: 0, isMuted: false, volume: 1.0, clips: [] },
        { id: createId("track"), type: "dialogue", name: "对白", sortOrder: 1, isMuted: false, volume: 1.0, clips: [] },
        { id: createId("track"), type: "music", name: "音乐", sortOrder: 2, isMuted: false, volume: 0.5, clips: [] },
        { id: createId("track"), type: "sfx", name: "音效", sortOrder: 3, isMuted: false, volume: 0.8, clips: [] },
        { id: createId("track"), type: "subtitle", name: "字幕", sortOrder: 4, isMuted: false, volume: 1.0, clips: [] },
      ],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
  }
}
