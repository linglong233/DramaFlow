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
  canEditProject,
  canEditTimeline,
  canExportProject,
  canManageTenant,
  canRemoveTeamMember,
  canReviewProject,
  canTransitionVersionStatus,
  getSubmittedStatus,
  resolveContentReviewRequired,
  normalizeStoryboardContent,
  resolveReviewRequired,
  type AnchorType,
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
  type ProjectInviteSummary,
  type ProjectMemberRecord,
  type ProjectMemberSummary,
  type ProjectRole,
  type ProjectStatus,
  type ProjectWorkspaceSummaryPayload,
  type ReviewQueueVersionSummary,
  type ScriptContent,
  type StyleGuideProfile,
  type StoryboardContent,
  type TeamSettingsLlmConfig,
  type TeamSettingsResponse,
  type TeamInviteLinkRecord,
  type TeamInviteLinkSummary,
  type TeamMemberRecord,
  type TeamMemberSummary,
  type TeamRole,
  type TeamSummary,
  type TimelineClipRecord,
  type TimelineRecord,
  type TimelineSavePayload,
  type TimelineTrackRecord,
  type VersionRecord,
  type VersionStatus,
  type WorldBibleContent,
} from "@dramaflow/shared";

import { randomBytes } from "node:crypto";

import { DevDatabaseService } from "../common/dev-database.service";
import { LlmProviderService } from "../common/llm-provider.service";
import type { DevDatabase, ProjectInviteRecord } from "../common/database.types";
import { createId } from "../common/id";
import { NotificationService } from "../notifications/notification.service";
import { RealtimeEventsService } from "../realtime/realtime.events.service";
import { AuditService } from "./audit.service";

/** 操作者上下文，封装用户在团队和项目中的角色 */
interface ActorContext {
  userId: string;
  globalRole: "platform_super_admin" | "user";
  teamRoles: TeamRole[];
  projectRoles: ProjectRole[];
}

/** 工作区核心业务服务，聚合团队、项目、文档、版本、审核、世界观等操作 */
@Injectable()
export class WorkspaceService {
  constructor(
    @Inject(DevDatabaseService) private readonly database: DevDatabaseService,
    @Inject(LlmProviderService) private readonly llmProviderService: LlmProviderService,
    @Inject(AuditService) private readonly auditService: AuditService,
    @Inject(NotificationService) private readonly notificationService: NotificationService,
    @Inject(RealtimeEventsService) private readonly realtimeEvents: RealtimeEventsService,
  ) {}

  async listTeams(userId: string): Promise<TeamSummary[]> {
    return this.database.query((db) => {
      const user = this.mustFindUser(db, userId);
      const visibleTeams = user.globalRole === "platform_super_admin"
        ? [...db.teams]
        : db.teams.filter((team) => db.teamMembers.some((member) => member.teamId === team.id && member.userId === userId));

      return visibleTeams
        .sort((left, right) => left.name.localeCompare(right.name))
        .map((team) => this.buildTeamSummary(db, team, userId, user.globalRole));
    });
  }

  async getTeam(userId: string, teamId: string): Promise<TeamSummary> {
    return this.database.query((db) => {
      const user = this.mustFindUser(db, userId);
      const membership = db.teamMembers.find((item) => item.teamId === teamId && item.userId === userId);
      if (user.globalRole !== "platform_super_admin" && !membership) {
        throw new ForbiddenException("You do not have access to this team");
      }
      return this.buildTeamSummary(db, this.mustFindTeam(db, teamId), userId, user.globalRole);
    });
  }

  async getTeamSettings(userId: string, teamId: string): Promise<TeamSettingsResponse> {
    const actor = await this.getActor(userId, undefined, teamId);
    if (!canManageTenant(actor)) {
      throw new ForbiddenException("You do not have permission to view team settings");
    }

    return this.database.query((db) => this.buildTeamSettingsResponse(db, this.mustFindTeam(db, teamId), actor.userId, actor.globalRole));
  }

  async createTeam(userId: string, input: { name: string; slug?: string; defaultReviewPolicy?: "required" | "bypass" }) {
    const actor = await this.getActor(userId);
    const name = input.name.trim();
    if (!name) {
      throw new BadRequestException("Team name is required");
    }

    return this.database.mutate((db) => {
      const slug = (input.slug?.trim().toLowerCase() || name.toLowerCase().replace(/\s+/g, "-")).replace(/[^a-z0-9-]/g, "");
      if (db.teams.some((team) => team.slug === slug)) {
        throw new BadRequestException("Team slug already exists");
      }

      const now = new Date().toISOString();
      const team = {
        id: createId("team"),
        name,
        slug,
        defaultReviewPolicy: input.defaultReviewPolicy ?? "required",
        createdBy: actor.userId,
        createdAt: now,
        updatedAt: now,
      };
      const teamMember: TeamMemberRecord = {
        id: createId("tm"),
        teamId: team.id,
        userId: actor.userId,
        role: "tenant_owner",
        createdAt: now,
      };

      db.teams.push(team);
      db.teamMembers.push(teamMember);
      return team;
    });
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

    return this.database.mutate((db) => {
      const team = this.mustFindTeam(db, teamId);
      team.name = name;
      team.defaultReviewPolicy = input.defaultReviewPolicy;
      if (input.llmConfig !== undefined) {
        team.llmConfig = this.mergePersistedLlmConfig(team.llmConfig, input.llmConfig);
      }
      if (input.imageGenerationConfig !== undefined) {
        team.imageGenerationConfig = this.mergePersistedImageGenerationConfig(team.imageGenerationConfig, input.imageGenerationConfig);
      }
      if (input.imageProviders !== undefined) {
        team.imageProviders = input.imageProviders;
      }
      if (input.videoProviders !== undefined) {
        team.videoProviders = input.videoProviders;
      }
      if (input.defaultImageProvider !== undefined) {
        team.defaultImageProvider = input.defaultImageProvider;
      }
      if (input.defaultVideoProvider !== undefined) {
        team.defaultVideoProvider = input.defaultVideoProvider;
      }
      team.updatedAt = new Date().toISOString();
      return this.buildTeamSettingsResponse(db, team, actor.userId, actor.globalRole);
    });
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

    const team = await this.database.query((db) => this.mustFindTeam(db, teamId));
    return {
      models: await this.llmProviderService.listModels(
        this.mergeLlmConfig(team.llmConfig, draftConfig),
      ),
    };
  }

  async addTeamMember(userId: string, teamId: string, input: { email: string; role: TeamRole }) {
    const actor = await this.getActor(userId, undefined, teamId);
    if (!canManageTenant(actor)) {
      throw new ForbiddenException("Only tenant admins can add members");
    }

    return this.database.mutate((db) => {
      this.mustFindTeam(db, teamId);
      const user = db.users.find((item) => item.email === input.email.trim().toLowerCase());
      if (!user) {
        throw new NotFoundException("User not found");
      }

      const existing = db.teamMembers.find((member) => member.teamId === teamId && member.userId === user.id);
      if (existing) {
        existing.role = input.role;
        return this.buildTeamMemberSummary(db, existing);
      }

      const record: TeamMemberRecord = {
        id: createId("tm"),
        teamId,
        userId: user.id,
        role: input.role,
        createdAt: new Date().toISOString(),
      };
      db.teamMembers.push(record);
      return this.buildTeamMemberSummary(db, record);
    });
  }

  async removeTeamMember(userId: string, teamId: string, memberId: string) {
    const actor = await this.getActor(userId, undefined, teamId);

    return this.database.mutate((db) => {
      this.mustFindTeam(db, teamId);
      const memberIndex = db.teamMembers.findIndex((item) => item.id === memberId && item.teamId === teamId);
      if (memberIndex === -1) {
        throw new NotFoundException("Team member not found");
      }

      const member = db.teamMembers[memberIndex];
      if (member.userId === userId) {
        throw new BadRequestException("You cannot remove yourself from the team");
      }

      if (!canRemoveTeamMember(actor, member.role)) {
        throw new ForbiddenException("You do not have permission to remove this member");
      }

      db.teamMembers.splice(memberIndex, 1);
    });
  }

  async updateTeamMemberRole(userId: string, teamId: string, memberId: string, newRole: TeamRole) {
    const actor = await this.getActor(userId, undefined, teamId);

    return this.database.mutate((db) => {
      this.mustFindTeam(db, teamId);
      const member = db.teamMembers.find((item) => item.id === memberId && item.teamId === teamId);
      if (!member) {
        throw new NotFoundException("Team member not found");
      }

      if (member.role === newRole) {
        return this.buildTeamMemberSummary(db, member);
      }

      if (!canChangeTeamMemberRole(actor, member.role, newRole)) {
        throw new ForbiddenException("You do not have permission to change this member's role");
      }

      if (member.role === "tenant_owner") {
        const otherOwners = db.teamMembers.filter(
          (item) => item.teamId === teamId && item.role === "tenant_owner" && item.id !== memberId,
        );
        if (otherOwners.length === 0) {
          throw new BadRequestException("Cannot downgrade the only owner. Transfer ownership first.");
        }
      }

      member.role = newRole;
      return this.buildTeamMemberSummary(db, member);
    });
  }

  async deleteTeam(userId: string, teamId: string) {
    const actor = await this.getActor(userId, undefined, teamId);
    if (actor.globalRole !== "platform_super_admin" && !actor.teamRoles.includes("tenant_owner")) {
      throw new ForbiddenException("Only the team owner can delete the team");
    }

    return this.database.mutate((db) => {
      const teamIndex = db.teams.findIndex((item) => item.id === teamId);
      if (teamIndex === -1) {
        throw new NotFoundException("Team not found");
      }

      db.teamMembers = db.teamMembers.filter((item) => item.teamId !== teamId);
      db.teamInviteLinks = db.teamInviteLinks.filter((item) => item.teamId !== teamId);

      const projectIds = db.projects.filter((item) => item.teamId === teamId).map((item) => item.id);
      db.projectMembers = db.projectMembers.filter((item) => !projectIds.includes(item.projectId));
      db.projectInvites = db.projectInvites.filter((item) => !projectIds.includes(item.projectId));

      db.teams.splice(teamIndex, 1);
    });
  }

  async createTeamInviteLink(userId: string, teamId: string, input: { role: TeamRole; maxUses?: number; expiresInHours?: number }) {
    const actor = await this.getActor(userId, undefined, teamId);
    if (!canManageTenant(actor)) {
      throw new ForbiddenException("Only team admins can create invite links");
    }

    return this.database.mutate((db) => {
      this.mustFindTeam(db, teamId);
      const token = randomBytes(24).toString("base64url");
      const now = new Date();
      const expiresAt = input.expiresInHours
        ? new Date(now.getTime() + input.expiresInHours * 3600_000).toISOString()
        : null;

      const record: TeamInviteLinkRecord = {
        id: createId("til"),
        teamId,
        token,
        role: input.role,
        maxUses: input.maxUses ?? 0,
        uses: 0,
        expiresAt,
        createdBy: userId,
        createdAt: now.toISOString(),
      };

      db.teamInviteLinks.push(record);

      const user = this.mustFindUser(db, userId);
      return {
        id: record.id,
        token: record.token,
        role: record.role,
        maxUses: record.maxUses,
        uses: record.uses,
        expiresAt: record.expiresAt,
        createdAt: record.createdAt,
        createdByName: user.displayName,
      } satisfies TeamInviteLinkSummary;
    });
  }

  async listTeamInviteLinks(userId: string, teamId: string): Promise<TeamInviteLinkSummary[]> {
    const actor = await this.getActor(userId, undefined, teamId);
    if (!canManageTenant(actor)) {
      throw new ForbiddenException("Only team admins can view invite links");
    }

    return this.database.query((db) => {
      this.mustFindTeam(db, teamId);
      const links = db.teamInviteLinks.filter((item) => item.teamId === teamId);
      return links.map((link) => {
        const user = db.users.find((u) => u.id === link.createdBy);
        return {
          id: link.id,
          token: link.token,
          role: link.role,
          maxUses: link.maxUses,
          uses: link.uses,
          expiresAt: link.expiresAt,
          createdAt: link.createdAt,
          createdByName: user?.displayName ?? "Unknown",
        };
      });
    });
  }

  async revokeTeamInviteLink(userId: string, teamId: string, linkId: string) {
    const actor = await this.getActor(userId, undefined, teamId);
    if (!canManageTenant(actor)) {
      throw new ForbiddenException("Only team admins can revoke invite links");
    }

    return this.database.mutate((db) => {
      const index = db.teamInviteLinks.findIndex((item) => item.id === linkId && item.teamId === teamId);
      if (index === -1) {
        throw new NotFoundException("Invite link not found");
      }
      db.teamInviteLinks.splice(index, 1);
    });
  }

  async getTeamInviteLinkInfo(token: string) {
    return this.database.query((db) => {
      const link = db.teamInviteLinks.find((item) => item.token === token);
      if (!link) {
        throw new NotFoundException("Invite link not found or has been revoked");
      }

      const team = db.teams.find((t) => t.id === link.teamId);
      if (!team) {
        throw new NotFoundException("The team associated with this link no longer exists");
      }

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
    });
  }

  async acceptTeamInviteLink(userId: string, token: string) {
    return this.database.mutate((db) => {
      const user = this.mustFindUser(db, userId);
      const link = db.teamInviteLinks.find((item) => item.token === token);
      if (!link) {
        throw new NotFoundException("Invite link not found or has been revoked");
      }

      const team = db.teams.find((t) => t.id === link.teamId);
      if (!team) {
        throw new NotFoundException("The team associated with this link no longer exists");
      }

      const now = new Date();
      if (link.expiresAt && new Date(link.expiresAt) < now) {
        throw new BadRequestException("This invite link has expired");
      }
      if (link.maxUses > 0 && link.uses >= link.maxUses) {
        throw new BadRequestException("This invite link has reached its usage limit");
      }

      const existing = db.teamMembers.find((item) => item.teamId === link.teamId && item.userId === userId);
      if (existing) {
        return { teamId: link.teamId, teamName: team.name, alreadyMember: true };
      }

      const record: TeamMemberRecord = {
        id: createId("tm"),
        teamId: link.teamId,
        userId,
        role: link.role,
        createdAt: now.toISOString(),
      };
      db.teamMembers.push(record);
      link.uses += 1;

      return { teamId: link.teamId, teamName: team.name, alreadyMember: false };
    });
  }

  async listProjects(userId: string) {
    return this.database.query((db) => {
      const user = this.mustFindUser(db, userId);
      if (user.globalRole === "platform_super_admin") {
        return [...db.projects].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
      }

      const teamIds = db.teamMembers.filter((member) => member.userId === userId).map((member) => member.teamId);
      const projectIds = db.projectMembers.filter((member) => member.userId === userId).map((member) => member.projectId);

      return db.projects
        .filter((project) => teamIds.includes(project.teamId) || projectIds.includes(project.id))
        .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
    });
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

    return this.database.mutate((db) => {
      const teamMembership = db.teamMembers.find((member) => member.teamId === teamId && member.userId === userId);
      const user = this.mustFindUser(db, userId);
      if (user.globalRole !== "platform_super_admin" && !teamMembership) {
        throw new ForbiddenException("You must join the team before creating a project");
      }

      const now = new Date().toISOString();
      const project = {
        id: createId("project"),
        teamId,
        name: input.name.trim(),
        description: input.description?.trim() ?? "",
        genre: input.genre?.trim(),
        coverUrl: input.coverUrl?.trim(),
        status: input.status ?? "draft" as ProjectStatus,
        reviewPolicyMode: input.reviewPolicyMode ?? "inherit",
        createdBy: userId,
        createdAt: now,
        updatedAt: now,
      };
      db.projects.push(project);
      db.projectMembers.push({
        id: createId("pm"),
        projectId: project.id,
        userId,
        role: "project_admin",
        createdAt: now,
      });

      db.documents.push(
        {
          id: createId("doc"),
          projectId: project.id,
          type: "script",
          title: "主剧本",
          createdBy: userId,
          createdAt: now,
          updatedAt: now,
        },
        {
          id: createId("doc"),
          projectId: project.id,
          type: "storyboard",
          title: "总分镜",
          createdBy: userId,
          createdAt: now,
          updatedAt: now,
        },
        {
          id: createId("doc"),
          projectId: project.id,
          type: "world_bible",
          title: "世界观设定",
          createdBy: userId,
          createdAt: now,
          updatedAt: now,
        },
      );

      return project;
    });
  }

  async getProject(userId: string, projectId: string): Promise<ProjectWorkspaceSummaryPayload> {
    return this.database.query((db) => {
      this.assertProjectReadable(db, projectId, userId);
      const project = this.mustFindProject(db, projectId);
      const team = this.mustFindTeam(db, project.teamId);
      const documents = db.documents.filter((document) => document.projectId === projectId);

      const auditConfigs = db.auditConfigs
        .filter((c) => c.projectId === projectId)
        .map((c) => ({
          id: c.id,
          projectId: c.projectId,
          contentType: c.contentType,
          reviewRequired: c.reviewRequired,
          autoApproveRoles: c.autoApproveRoles,
        }));

      return {
        team: {
          id: team.id,
          name: team.name,
          defaultReviewPolicy: team.defaultReviewPolicy,
        },
        project,
        members: this.getProjectMemberSummaries(db, projectId),
        invites: this.getProjectInviteSummaries(db, [project.id]),
        pendingReviews: this.getReviewQueue(db, [project.id]),
        documents,
        worldBible: this.extractWorldBible(db, projectId),
        auditConfigs,
      };
    });
  }

  async updateProjectReviewPolicy(userId: string, projectId: string, reviewPolicyMode: "inherit" | "required" | "bypass") {
    const actor = await this.getActor(userId, projectId);
    if (!canEditProject(actor)) {
      throw new ForbiddenException("You do not have permission to change the project review policy");
    }

    return this.database.mutate((db) => {
      const project = this.mustFindProject(db, projectId);
      project.reviewPolicyMode = reviewPolicyMode;
      project.updatedAt = new Date().toISOString();
      return project;
    });
  }

  async updateProject(
    userId: string,
    projectId: string,
    input: { name?: string; description?: string; genre?: string; coverUrl?: string; status?: ProjectStatus; reviewPolicyMode?: "inherit" | "required" | "bypass" },
  ) {
    const actor = await this.getActor(userId, projectId);
    if (!canEditProject(actor)) {
      throw new ForbiddenException("You do not have permission to update this project");
    }

    return this.database.mutate((db) => {
      const project = this.mustFindProject(db, projectId);
      if (input.name !== undefined) project.name = input.name.trim();
      if (input.description !== undefined) project.description = input.description.trim();
      if (input.genre !== undefined) project.genre = input.genre.trim() || undefined;
      if (input.coverUrl !== undefined) project.coverUrl = input.coverUrl.trim() || undefined;
      if (input.status !== undefined) project.status = input.status;
      if (input.reviewPolicyMode !== undefined) project.reviewPolicyMode = input.reviewPolicyMode;
      project.updatedAt = new Date().toISOString();
      return project;
    });
  }

  async deleteProject(userId: string, projectId: string) {
    const actor = await this.getActor(userId, projectId);
    if (actor.globalRole !== "platform_super_admin" && !actor.projectRoles.includes("project_admin")) {
      throw new ForbiddenException("Only project admins can delete a project");
    }

    return this.database.mutate((db) => {
      const projectIndex = db.projects.findIndex((item) => item.id === projectId);
      if (projectIndex === -1) {
        throw new NotFoundException("Project not found");
      }

      db.projectMembers = db.projectMembers.filter((item) => item.projectId !== projectId);
      db.projectInvites = db.projectInvites.filter((item) => item.projectId !== projectId);

      const documentIds = db.documents.filter((item) => item.projectId === projectId).map((item) => item.id);
      db.versions = db.versions.filter((item) => !documentIds.includes(item.documentId));
      db.comments = db.comments.filter((item) => {
        const version = db.versions.find((v) => v.id === item.versionId);
        return !version || !documentIds.includes(version.documentId);
      });
      db.documents = db.documents.filter((item) => item.projectId !== projectId);
      db.jobs = db.jobs.filter((item) => item.projectId !== projectId);

      db.projects.splice(projectIndex, 1);
    });
  }

  async inviteProjectMember(userId: string, projectId: string, input: { email: string; role: ProjectRole }) {
    const actor = await this.getActor(userId, projectId);
    if (!canEditProject(actor)) {
      throw new ForbiddenException("Only project editors can invite collaborators");
    }

    const result = await this.database.mutate((db) => {
      const project = this.mustFindProject(db, projectId);
      const email = input.email.trim().toLowerCase();
      const invitedUser = db.users.find((item) => item.email === email);
      if (invitedUser && db.projectMembers.some((member) => member.projectId === projectId && member.userId === invitedUser.id)) {
        throw new BadRequestException("User is already a project member");
      }

      const existingPendingInvite = db.projectInvites.find((item) => item.projectId === projectId && item.email === email && item.status === "pending");
      if (existingPendingInvite) {
        existingPendingInvite.role = input.role;
        return {
          invite: existingPendingInvite,
          invitedUserId: invitedUser?.id,
          projectName: project.name,
        };
      }

      const invite: ProjectInviteRecord = {
        id: createId("invite"),
        projectId,
        email,
        role: input.role,
        createdBy: userId,
        status: "pending",
        createdAt: new Date().toISOString(),
      };
      db.projectInvites.push(invite);
      return {
        invite,
        invitedUserId: invitedUser?.id,
        projectName: project.name,
      };
    });

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
    return this.database.query((db) => {
      const user = this.mustFindUser(db, userId);
      const invites = db.projectInvites
        .filter((invite) => invite.status === "pending" && invite.email === user.email.toLowerCase())
        .map((invite) => {
          const project = this.mustFindProject(db, invite.projectId);
          return {
            id: invite.id,
            projectId: invite.projectId,
            projectName: project.name,
            email: invite.email,
            role: invite.role,
            status: invite.status,
            createdAt: invite.createdAt,
            createdBy: invite.createdBy,
          } satisfies ProjectInviteSummary;
        })
        .sort((left, right) => right.createdAt.localeCompare(left.createdAt));

      return { invites };
    });
  }

  async acceptProjectInvite(userId: string, inviteId: string) {
    const result = await this.database.mutate((db) => {
      const user = this.mustFindUser(db, userId);
      const invite = db.projectInvites.find((item) => item.id === inviteId);
      if (!invite) {
        throw new NotFoundException("Project invite not found");
      }
      if (invite.email !== user.email.toLowerCase()) {
        throw new ForbiddenException("This project invite is not assigned to your account");
      }

      const project = this.mustFindProject(db, invite.projectId);
      let alreadyMember = false;

      const existingTeamMember = db.teamMembers.find((member) => member.teamId === project.teamId && member.userId === userId);
      if (!existingTeamMember) {
        db.teamMembers.push({
          id: createId("tm"),
          teamId: project.teamId,
          userId,
          role: "member",
          createdAt: new Date().toISOString(),
        });
      }

      const existingProjectMember = db.projectMembers.find((member) => member.projectId === project.id && member.userId === userId);
      if (existingProjectMember) {
        alreadyMember = true;
        existingProjectMember.role = invite.role;
      } else {
        db.projectMembers.push({
          id: createId("pm"),
          projectId: project.id,
          userId,
          role: invite.role,
          createdAt: new Date().toISOString(),
        });
      }

      invite.status = "accepted";

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
    if (!canEditProject(actor)) {
      throw new ForbiddenException("Only project editors can assign collaborators");
    }

    return this.database.mutate((db) => {
      const project = this.mustFindProject(db, projectId);
      const user = db.users.find((item) => item.email === input.email.trim().toLowerCase());
      if (!user) {
        throw new NotFoundException("User not found");
      }

      const existingTeamMember = db.teamMembers.find((member) => member.teamId === project.teamId && member.userId === user.id);
      if (!existingTeamMember) {
        db.teamMembers.push({
          id: createId("tm"),
          teamId: project.teamId,
          userId: user.id,
          role: "member",
          createdAt: new Date().toISOString(),
        });
      }

      const existingProjectMember = db.projectMembers.find((member) => member.projectId === projectId && member.userId === user.id);
      if (existingProjectMember) {
        existingProjectMember.role = input.role;
        return this.buildProjectMemberSummary(db, existingProjectMember);
      }

      const member: ProjectMemberRecord = {
        id: createId("pm"),
        projectId,
        userId: user.id,
        role: input.role,
        createdAt: new Date().toISOString(),
      };
      db.projectMembers.push(member);
      return this.buildProjectMemberSummary(db, member);
    });
  }

  async listVersions(userId: string, documentId: string) {
    return this.database.query((db) => {
      const document = this.mustFindDocument(db, documentId);
      this.assertProjectReadable(db, document.projectId, userId);
      return db.versions
        .filter((version) => version.documentId === documentId)
        .sort((left, right) => right.versionNumber - left.versionNumber);
    });
  }

  async listProjectVersions(userId: string, projectId: string) {
    return this.database.query((db) => {
      this.assertProjectReadable(db, projectId, userId);
      const documentIds = db.documents
        .filter((document) => document.projectId === projectId)
        .map((document) => document.id);

      return {
        versions: db.versions
          .filter((version) => documentIds.includes(version.documentId))
          .sort((left, right) => {
            if (left.documentId === right.documentId) {
              return right.versionNumber - left.versionNumber;
            }
            return right.createdAt.localeCompare(left.createdAt);
          }),
      };
    });
  }

  async adoptDocumentVersion(userId: string, documentId: string, versionId: string) {
    const document = await this.database.query((db) => this.mustFindDocument(db, documentId));
    const actor = await this.getActor(userId, document.projectId);
    if (!canEditProject(actor)) {
      throw new ForbiddenException("You do not have permission to adopt a candidate version");
    }

    return this.database.mutate((db) => {
      const liveDocument = this.mustFindDocument(db, documentId);
      const liveVersion = this.mustFindVersion(db, versionId);
      if (liveVersion.documentId !== liveDocument.id) {
        throw new BadRequestException("Version does not belong to the target document");
      }

      liveDocument.currentVersionId = liveVersion.id;
      liveDocument.updatedAt = new Date().toISOString();
      return liveDocument;
    });
  }

  async createVersion(
    userId: string,
    documentId: string,
    input: { title: string; content: unknown; metadata?: Record<string, unknown> },
  ) {
    const document = await this.database.query((db) => this.mustFindDocument(db, documentId));
    const actor = await this.getActor(userId, document.projectId);
    if (!canEditProject(actor)) {
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
    const version = await this.database.query((db) => this.mustFindVersion(db, versionId));
    if (version.status !== "draft") {
      throw new BadRequestException("Only draft versions can be updated");
    }
    const document = await this.database.query((db) => this.mustFindDocument(db, version.documentId));
    const actor = await this.getActor(userId, document.projectId);
    if (!canEditProject(actor)) {
      throw new ForbiddenException("You do not have permission to update this version");
    }

    return this.database.mutate((db) => {
      const liveVersion = this.mustFindVersion(db, versionId);
      if (liveVersion.status !== "draft") {
        throw new BadRequestException("Only draft versions can be updated");
      }
      const liveDocument = this.mustFindDocument(db, liveVersion.documentId);
      if (input.title !== undefined) liveVersion.title = input.title;
      if (input.content !== undefined) {
        liveVersion.content = liveDocument.type === "storyboard"
          ? normalizeStoryboardContent(input.content)
          : input.content;
      }
      liveDocument.updatedAt = new Date().toISOString();
      return liveVersion;
    });
  }

  async deleteVersion(userId: string, versionId: string) {
    const version = await this.database.query((db) => this.mustFindVersion(db, versionId));
    if (version.status !== "draft") {
      throw new BadRequestException("Only draft versions can be deleted");
    }
    const document = await this.database.query((db) => this.mustFindDocument(db, version.documentId));
    const actor = await this.getActor(userId, document.projectId);
    if (!canEditProject(actor)) {
      throw new ForbiddenException("You do not have permission to delete this version");
    }

    return this.database.mutate((db) => {
      const liveVersion = this.mustFindVersion(db, versionId);
      if (liveVersion.status !== "draft") {
        throw new BadRequestException("Only draft versions can be deleted");
      }
      const liveDocument = this.mustFindDocument(db, liveVersion.documentId);

      // Remove the version
      const versionIndex = db.versions.findIndex((v) => v.id === versionId);
      if (versionIndex !== -1) db.versions.splice(versionIndex, 1);

      // Remove associated comments
      db.comments = db.comments.filter((c) => c.versionId !== versionId);

      // If the document pointed to this version, fall back to the latest remaining version
      if (liveDocument.currentVersionId === versionId) {
        const remaining = db.versions
          .filter((v) => v.documentId === liveDocument.id)
          .sort((a, b) => b.versionNumber - a.versionNumber);
        liveDocument.currentVersionId = remaining[0]?.id;
        liveDocument.updatedAt = new Date().toISOString();
      }
    });
  }

  async restoreVersion(userId: string, versionId: string) {
    const version = await this.database.query((db) => this.mustFindVersion(db, versionId));
    const document = await this.database.query((db) => this.mustFindDocument(db, version.documentId));
    const actor = await this.getActor(userId, document.projectId);
    if (!canEditProject(actor)) {
      throw new ForbiddenException("You do not have permission to restore versions");
    }

    return this.createVersionForDocument({
      documentId: document.id,
      title: `${version.title} - Restored`,
      content: version.content,
      metadata: {
        ...(version.metadata ?? {}),
        source: "restore",
        restoredFromVersionId: version.id,
      },
      createdBy: userId,
      status: "draft",
    });
  }

  async submitVersion(userId: string, versionId: string) {
    const version = await this.database.query((db) => this.mustFindVersion(db, versionId));
    const document = await this.database.query((db) => this.mustFindDocument(db, version.documentId));
    const actor = await this.getActor(userId, document.projectId);
    if (!canEditProject(actor)) {
      throw new ForbiddenException("You do not have permission to submit versions");
    }

    const updated = await this.database.mutate((db) => {
      const liveVersion = this.mustFindVersion(db, versionId);
      const liveDocument = this.mustFindDocument(db, liveVersion.documentId);
      const project = this.mustFindProject(db, liveDocument.projectId);
      const team = this.mustFindTeam(db, project.teamId);
      const auditConfigs = db.auditConfigs.filter((config) => config.projectId === project.id);
      const auditContentType = this.getAuditContentType(liveDocument.type);
      const reviewRequired = auditContentType
        ? resolveContentReviewRequired(team.defaultReviewPolicy, project.reviewPolicyMode, auditConfigs, auditContentType)
        : resolveReviewRequired(team.defaultReviewPolicy, project.reviewPolicyMode);
      const autoApproved = auditContentType
        ? canAutoApprove(auditConfigs, auditContentType, actor.projectRoles)
        : false;
      const nextStatus = getSubmittedStatus(reviewRequired && !autoApproved);
      if (!canTransitionVersionStatus(liveVersion.status, nextStatus)) {
        throw new BadRequestException(`Cannot submit a version in status ${liveVersion.status}`);
      }

      liveVersion.status = nextStatus;
      return {
        version: liveVersion,
        auditContentType,
        autoApproved,
      };
    });

    if (updated.auditContentType) {
      await this.auditService.recordAuditAction({
        projectId: document.projectId,
        versionId,
        documentType: document.type,
        action: "submitted",
        reviewerId: userId,
      });

      if (updated.autoApproved) {
        await this.auditService.recordAuditAction({
          projectId: document.projectId,
          versionId,
          documentType: document.type,
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
      status: updated.version.status,
      action: updated.autoApproved ? "approved" : "submitted",
    });

    return updated.version;
  }

  async approveVersion(userId: string, versionId: string, comment?: string) {
    return this.reviewVersion(userId, versionId, "approved", comment);
  }

  async rejectVersion(userId: string, versionId: string, comment?: string) {
    return this.reviewVersion(userId, versionId, "rejected", comment);
  }

  async listComments(userId: string, versionId: string) {
    return this.database.query((db) => {
      const version = this.mustFindVersion(db, versionId);
      const document = this.mustFindDocument(db, version.documentId);
      this.assertProjectReadable(db, document.projectId, userId);
      return db.comments
        .filter((comment) => comment.versionId === versionId)
        .sort((left, right) => left.createdAt.localeCompare(right.createdAt))
        .map((comment) => {
          const author = this.mustFindUser(db, comment.authorId);
          return {
            ...comment,
            authorDisplayName: author.displayName,
            authorEmail: author.email,
          };
        });
    });
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

    const result = await this.database.mutate((db) => {
      const version = this.mustFindVersion(db, versionId);
      const document = this.mustFindDocument(db, version.documentId);
      this.assertProjectReadable(db, document.projectId, userId);

      let parentAuthorId: string | undefined;
      if (input.parentId) {
        const parent = db.comments.find((comment) => comment.id === input.parentId);
        if (!parent || parent.versionId !== versionId) {
          throw new BadRequestException("Parent comment does not belong to this version");
        }
        parentAuthorId = parent.authorId;
      }

      const now = new Date().toISOString();
      const comment = {
        id: createId("comment"),
        versionId,
        authorId: userId,
        body,
        parentId: input.parentId,
        anchorType: input.anchorType,
        anchorId: input.anchorId,
        resolved: false,
        createdAt: now,
        updatedAt: now,
      };

      db.comments.push(comment);
      const author = this.mustFindUser(db, userId);
      return {
        comment: {
          ...comment,
          authorDisplayName: author.displayName,
          authorEmail: author.email,
        },
        projectId: document.projectId,
        documentId: document.id,
        versionTitle: version.title,
        versionAuthorId: version.createdBy,
        parentAuthorId,
      };
    });

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
    return this.database.query((db) => {
      this.assertProjectReadable(db, projectId, userId);
      return this.extractWorldBible(db, projectId);
    });
  }

  async updateWorldBible(
    userId: string,
    projectId: string,
    content: Partial<WorldBibleContent>,
  ): Promise<WorldBibleContent> {
    const actor = await this.getActor(userId, projectId);
    if (!canEditProject(actor)) {
      throw new ForbiddenException("You do not have permission to update the world bible");
    }

    return this.database.mutate((db) => {
      const existing = this.extractWorldBible(db, projectId);
      const merged: WorldBibleContent = {
        characters: content.characters ?? existing.characters,
        locations: content.locations ?? existing.locations,
        styleGuide: content.styleGuide !== undefined ? content.styleGuide : existing.styleGuide,
        voiceConfigs: content.voiceConfigs ?? existing.voiceConfigs,
      };
      this.persistWorldBible(db, projectId, userId, merged);
      return merged;
    });
  }

  async addCharacter(
    userId: string,
    projectId: string,
    input: { name: string; appearance: string; personality?: string; tags?: string[]; referenceImages?: string[]; costumes?: Record<string, string> },
  ): Promise<CharacterProfile> {
    const actor = await this.getActor(userId, projectId);
    if (!canEditProject(actor)) {
      throw new ForbiddenException("You do not have permission to edit the world bible");
    }

    return this.database.mutate((db) => {
      const wb = this.extractWorldBible(db, projectId);
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
      this.persistWorldBible(db, projectId, userId, wb);
      return character;
    });
  }

  async updateCharacter(
    userId: string,
    projectId: string,
    characterId: string,
    input: Partial<Omit<CharacterProfile, "id" | "sortOrder">>,
  ): Promise<CharacterProfile> {
    const actor = await this.getActor(userId, projectId);
    if (!canEditProject(actor)) {
      throw new ForbiddenException("You do not have permission to edit the world bible");
    }

    return this.database.mutate((db) => {
      const wb = this.extractWorldBible(db, projectId);
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
      this.persistWorldBible(db, projectId, userId, wb);
      if (input.name !== undefined && character.name !== oldName) {
        this.syncCharacterNameToScripts(db, projectId, userId, characterId, oldName, character.name);
      }
      return character;
    });
  }

  async deleteCharacter(userId: string, projectId: string, characterId: string) {
    const actor = await this.getActor(userId, projectId);
    if (!canEditProject(actor)) {
      throw new ForbiddenException("You do not have permission to edit the world bible");
    }

    return this.database.mutate((db) => {
      const wb = this.extractWorldBible(db, projectId);
      const index = wb.characters.findIndex((c) => c.id === characterId);
      if (index === -1) {
        throw new NotFoundException("Character not found");
      }
      wb.characters.splice(index, 1);
      this.persistWorldBible(db, projectId, userId, wb);
      this.clearCharacterRefsInScripts(db, projectId, userId, characterId);
    });
  }

  async addLocation(
    userId: string,
    projectId: string,
    input: { name: string; description: string; lighting?: string; timeOfDay?: string; referenceImages?: string[] },
  ): Promise<LocationProfile> {
    const actor = await this.getActor(userId, projectId);
    if (!canEditProject(actor)) {
      throw new ForbiddenException("You do not have permission to edit the world bible");
    }

    return this.database.mutate((db) => {
      const wb = this.extractWorldBible(db, projectId);
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
      this.persistWorldBible(db, projectId, userId, wb);
      return location;
    });
  }

  async updateLocation(
    userId: string,
    projectId: string,
    locationId: string,
    input: Partial<Omit<LocationProfile, "id" | "sortOrder">>,
  ): Promise<LocationProfile> {
    const actor = await this.getActor(userId, projectId);
    if (!canEditProject(actor)) {
      throw new ForbiddenException("You do not have permission to edit the world bible");
    }

    return this.database.mutate((db) => {
      const wb = this.extractWorldBible(db, projectId);
      const location = wb.locations.find((l) => l.id === locationId);
      if (!location) {
        throw new NotFoundException("Location not found");
      }
      if (input.name !== undefined) location.name = input.name.trim();
      if (input.description !== undefined) location.description = input.description.trim();
      if (input.lighting !== undefined) location.lighting = input.lighting?.trim();
      if (input.timeOfDay !== undefined) location.timeOfDay = input.timeOfDay?.trim();
      if (input.referenceImages !== undefined) location.referenceImages = input.referenceImages;
      this.persistWorldBible(db, projectId, userId, wb);
      return location;
    });
  }

  async deleteLocation(userId: string, projectId: string, locationId: string) {
    const actor = await this.getActor(userId, projectId);
    if (!canEditProject(actor)) {
      throw new ForbiddenException("You do not have permission to edit the world bible");
    }

    return this.database.mutate((db) => {
      const wb = this.extractWorldBible(db, projectId);
      const index = wb.locations.findIndex((l) => l.id === locationId);
      if (index === -1) {
        throw new NotFoundException("Location not found");
      }
      wb.locations.splice(index, 1);
      this.persistWorldBible(db, projectId, userId, wb);
      this.clearLocationRefsInScripts(db, projectId, userId, locationId);
    });
  }

  async updateStyleGuide(
    userId: string,
    projectId: string,
    input: { visualStyle: string; colorPalette?: string; compositionNote?: string; negativePrompt?: string; referenceImages?: string[] },
  ): Promise<StyleGuideProfile> {
    const actor = await this.getActor(userId, projectId);
    if (!canEditProject(actor)) {
      throw new ForbiddenException("You do not have permission to edit the world bible");
    }

    return this.database.mutate((db) => {
      const wb = this.extractWorldBible(db, projectId);
      const guide: StyleGuideProfile = {
        visualStyle: input.visualStyle.trim(),
        colorPalette: input.colorPalette?.trim(),
        compositionNote: input.compositionNote?.trim(),
        negativePrompt: input.negativePrompt?.trim(),
        referenceImages: input.referenceImages ?? [],
      };
      wb.styleGuide = guide;
      this.persistWorldBible(db, projectId, userId, wb);
      return guide;
    });
  }

  async ensureDocumentForProject(options: {
    projectId: string;
    type: DocumentType;
    title: string;
    createdBy: string;
    shotId?: string;
  }): Promise<DocumentRecord> {
    return this.database.mutate((db) => {
      const existing = db.documents.find(
        (document) =>
          document.projectId === options.projectId &&
          document.type === options.type &&
          document.shotId === options.shotId,
      );
      if (existing) {
        return existing;
      }

      const now = new Date().toISOString();
      const document: DocumentRecord = {
        id: createId("doc"),
        projectId: options.projectId,
        type: options.type,
        title: options.title,
        shotId: options.shotId,
        createdBy: options.createdBy,
        createdAt: now,
        updatedAt: now,
      };
      db.documents.push(document);
      return document;
    });
  }

  async createVersionForDocument(options: {
    documentId: string;
    title: string;
    content: unknown;
    metadata: Record<string, unknown>;
    createdBy: string;
    status?: VersionStatus;
  }): Promise<VersionRecord> {
    return this.database.mutate((db) => {
      const document = this.mustFindDocument(db, options.documentId);
      const siblingVersions = db.versions.filter((version) => version.documentId === document.id);
      const latestVersion = siblingVersions.reduce<VersionRecord | undefined>((current, candidate) => {
        if (!current || candidate.versionNumber > current.versionNumber) {
          return candidate;
        }
        return current;
      }, undefined);

      const normalizedContent = document.type === "storyboard"
        ? normalizeStoryboardContent(options.content)
        : options.content;
      const now = new Date().toISOString();
      const version: VersionRecord = {
        id: createId("version"),
        documentId: document.id,
        versionNumber: (latestVersion?.versionNumber ?? 0) + 1,
        status: options.status ?? "draft",
        title: options.title,
        content: normalizedContent,
        metadata: options.metadata,
        parentVersionId: latestVersion?.id,
        createdBy: options.createdBy,
        createdAt: now,
      };

      document.currentVersionId = version.id;
      document.updatedAt = now;
      db.versions.push(version);

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
              this.syncCharacterNameToWorldBible(
                db, document.projectId, options.createdBy, char.worldBibleCharId, char.name,
              );
            }
          }
        }
      }

      return version;
    });
  }

  private async reviewVersion(userId: string, versionId: string, nextStatus: "approved" | "rejected", comment?: string) {
    const version = await this.database.query((db) => this.mustFindVersion(db, versionId));
    const document = await this.database.query((db) => this.mustFindDocument(db, version.documentId));
    const actor = await this.getActor(userId, document.projectId);
    if (!canReviewProject(actor)) {
      throw new ForbiddenException("You do not have permission to review this version");
    }

    const updatedVersion = await this.database.mutate((db) => {
      const liveVersion = this.mustFindVersion(db, versionId);
      if (!canTransitionVersionStatus(liveVersion.status, nextStatus)) {
        throw new BadRequestException(`Cannot move version from ${liveVersion.status} to ${nextStatus}`);
      }
      liveVersion.status = nextStatus;
      return liveVersion;
    });

    const trimmedComment = comment?.trim() || undefined;
    if (this.getAuditContentType(document.type)) {
      await this.auditService.recordAuditAction({
        projectId: document.projectId,
        versionId,
        documentType: document.type,
        action: nextStatus === "approved" ? "approved" : "rejected",
        reviewerId: userId,
        comment: trimmedComment,
      });
    }

    this.realtimeEvents.emitReviewUpdated({
      projectId: document.projectId,
      versionId,
      documentId: document.id,
      status: updatedVersion.status,
      action: nextStatus,
    });

    return updatedVersion;
  }

  private async getActor(userId: string, projectId?: string, teamId?: string): Promise<ActorContext> {
    return this.database.query((db) => {
      const user = this.mustFindUser(db, userId);
      const resolvedProjectId = projectId;
      const resolvedTeamId = teamId ?? (resolvedProjectId ? this.mustFindProject(db, resolvedProjectId).teamId : undefined);
      return {
        userId,
        globalRole: user.globalRole,
        teamRoles: resolvedTeamId
          ? db.teamMembers.filter((member) => member.teamId === resolvedTeamId && member.userId === userId).map((member) => member.role)
          : [],
        projectRoles: resolvedProjectId
          ? db.projectMembers.filter((member) => member.projectId === resolvedProjectId && member.userId === userId).map((member) => member.role)
          : [],
      };
    });
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

  private buildTeamSummary(
    db: DevDatabase,
    team: DevDatabase["teams"][number],
    userId: string,
    globalRole: ActorContext["globalRole"],
  ): TeamSummary {
    const teamRoles = db.teamMembers
      .filter((member) => member.teamId === team.id && member.userId === userId)
      .map((member) => member.role);

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

  private buildTeamSettingsResponse(
    db: DevDatabase,
    team: DevDatabase["teams"][number],
    userId: string,
    globalRole: ActorContext["globalRole"],
  ): TeamSettingsResponse {
    return {
      ...this.buildTeamSummary(db, team, userId, globalRole),
      llmConfig: this.buildTeamSettingsLlmConfig(team.llmConfig),
      imageGenerationConfig: this.buildTeamSettingsImageGenerationConfig(team.imageGenerationConfig),
      imageProviders: team.imageProviders,
      videoProviders: team.videoProviders,
      defaultImageProvider: team.defaultImageProvider,
      defaultVideoProvider: team.defaultVideoProvider,
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

  private getTeamMemberSummaries(db: DevDatabase, teamId: string): TeamMemberSummary[] {

    return db.teamMembers
      .filter((member) => member.teamId === teamId)
      .map((member) => this.buildTeamMemberSummary(db, member))
      .sort((left, right) => left.displayName.localeCompare(right.displayName));
  }

  private buildTeamMemberSummary(db: DevDatabase, member: TeamMemberRecord): TeamMemberSummary {
    const user = this.mustFindUser(db, member.userId);
    return {
      id: member.id,
      userId: member.userId,
      role: member.role,
      createdAt: member.createdAt,
      displayName: user.displayName,
      email: user.email,
    };
  }

  private getProjectMemberSummaries(db: DevDatabase, projectId: string): ProjectMemberSummary[] {
    return db.projectMembers
      .filter((member) => member.projectId === projectId)
      .map((member) => this.buildProjectMemberSummary(db, member))
      .sort((left, right) => left.displayName.localeCompare(right.displayName));
  }

  private buildProjectMemberSummary(db: DevDatabase, member: ProjectMemberRecord): ProjectMemberSummary {
    const user = this.mustFindUser(db, member.userId);
    return {
      id: member.id,
      userId: member.userId,
      role: member.role,
      createdAt: member.createdAt,
      displayName: user.displayName,
      email: user.email,
    };
  }

  private getProjectInviteSummaries(db: DevDatabase, projectIds: string[]): ProjectInviteSummary[] {
    return db.projectInvites
      .filter((invite) => projectIds.includes(invite.projectId))
      .map((invite) => {
        const project = this.mustFindProject(db, invite.projectId);
        return {
          id: invite.id,
          projectId: invite.projectId,
          projectName: project.name,
          email: invite.email,
          role: invite.role,
          status: invite.status,
          createdAt: invite.createdAt,
          createdBy: invite.createdBy,
        };
      })
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  }

  private getReviewQueue(db: DevDatabase, projectIds: string[]): ReviewQueueVersionSummary[] {
    return db.versions
      .filter((version) => this.isReviewQueueStatus(version.status))
      .map((version) => {
        const document = this.mustFindDocument(db, version.documentId);
        const project = this.mustFindProject(db, document.projectId);
        return {
          id: version.id,
          title: version.title,
          status: version.status,
          versionNumber: version.versionNumber,
          createdAt: version.createdAt,
          documentId: document.id,
          documentTitle: document.title,
          projectId: project.id,
          projectName: project.name,
        };
      })
      .filter((version) => projectIds.includes(version.projectId))
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
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

  private assertProjectReadable(db: DevDatabase, projectId: string, userId: string) {
    const project = this.mustFindProject(db, projectId);
    const hasTeamAccess = db.teamMembers.some((member) => member.teamId === project.teamId && member.userId === userId);
    const hasProjectAccess = db.projectMembers.some((member) => member.projectId === projectId && member.userId === userId);
    const user = this.mustFindUser(db, userId);

    if (user.globalRole !== "platform_super_admin" && !hasTeamAccess && !hasProjectAccess) {
      throw new ForbiddenException("You do not have access to this project");
    }
  }

  private mustFindProject(db: DevDatabase, projectId: string) {
    const project = db.projects.find((item) => item.id === projectId);
    if (!project) {
      throw new NotFoundException("Project not found");
    }
    return project;
  }

  private mustFindDocument(db: DevDatabase, documentId: string) {
    const document = db.documents.find((item) => item.id === documentId);
    if (!document) {
      throw new NotFoundException("Document not found");
    }
    return document;
  }

  private mustFindVersion(db: DevDatabase, versionId: string) {
    const version = db.versions.find((item) => item.id === versionId);
    if (!version) {
      throw new NotFoundException("Version not found");
    }
    return version;
  }

  private mustFindTeam(db: DevDatabase, teamId: string) {
    const team = db.teams.find((item) => item.id === teamId);
    if (!team) {
      throw new NotFoundException("Team not found");
    }
    return team;
  }

  private mustFindUser(db: DevDatabase, userId: string) {
    const user = db.users.find((item) => item.id === userId);
    if (!user) {
      throw new NotFoundException("User not found");
    }
    return user;
  }

  private syncCharacterNameToScripts(
    db: DevDatabase,
    projectId: string,
    userId: string,
    characterId: string,
    oldName: string,
    newName: string,
  ): void {
    const scriptDocs = db.documents.filter(
      (doc) => doc.projectId === projectId && doc.type === "script",
    );
    for (const doc of scriptDocs) {
      if (!doc.currentVersionId) continue;
      const version = db.versions.find((v) => v.id === doc.currentVersionId);
      if (!version?.content || typeof version.content !== "object") continue;

      const content = version.content as ScriptContent;
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
      const siblingVersions = db.versions.filter((v) => v.documentId === doc.id);
      const latestNumber = siblingVersions.reduce((max, v) => Math.max(max, v.versionNumber), 0);
      const now = new Date().toISOString();
      const newVersion: VersionRecord = {
        id: createId("version"),
        documentId: doc.id,
        versionNumber: latestNumber + 1,
        status: "approved",
        title: `角色同步: ${oldName} → ${newName}`,
        content: updatedContent,
        metadata: { source: "world-bible-sync", characterId, oldName, newName },
        parentVersionId: version.id,
        createdBy: userId,
        createdAt: now,
      };
      db.versions.push(newVersion);
      doc.currentVersionId = newVersion.id;
      doc.updatedAt = now;
    }
  }

  private syncCharacterNameToWorldBible(
    db: DevDatabase,
    projectId: string,
    userId: string,
    characterId: string,
    newName: string,
  ): void {
    const wbDoc = db.documents.find(
      (doc) => doc.projectId === projectId && doc.type === "world_bible",
    );
    if (!wbDoc || !wbDoc.currentVersionId) return;

    const version = db.versions.find((v) => v.id === wbDoc.currentVersionId);
    if (!version?.content || typeof version.content !== "object") return;

    const wb = version.content as WorldBibleContent;
    const character = (wb.characters ?? []).find((c) => c.id === characterId);
    if (!character || character.name === newName) return;

    character.name = newName;
    const updatedWb: WorldBibleContent = { ...wb, characters: [...wb.characters] };

    const siblingVersions = db.versions.filter((v) => v.documentId === wbDoc.id);
    const latestNumber = siblingVersions.reduce((max, v) => Math.max(max, v.versionNumber), 0);
    const now = new Date().toISOString();
    const newVersion: VersionRecord = {
      id: createId("version"),
      documentId: wbDoc.id,
      versionNumber: latestNumber + 1,
      status: "approved",
      title: `剧本同步: 角色 ${newName}`,
      content: updatedWb,
      metadata: { source: "script-sync", characterId, newName },
      parentVersionId: version.id,
      createdBy: userId,
      createdAt: now,
    };
    db.versions.push(newVersion);
    wbDoc.currentVersionId = newVersion.id;
    wbDoc.updatedAt = now;
  }

  private clearCharacterRefsInScripts(
    db: DevDatabase,
    projectId: string,
    userId: string,
    characterId: string,
  ): void {
    const scriptDocs = db.documents.filter(
      (doc) => doc.projectId === projectId && doc.type === "script",
    );
    for (const doc of scriptDocs) {
      if (!doc.currentVersionId) continue;
      const version = db.versions.find((v) => v.id === doc.currentVersionId);
      if (!version?.content || typeof version.content !== "object") continue;

      const content = version.content as ScriptContent;
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
      const siblingVersions = db.versions.filter((v) => v.documentId === doc.id);
      const latestNumber = siblingVersions.reduce((max, v) => Math.max(max, v.versionNumber), 0);
      const now = new Date().toISOString();
      const newVersion: VersionRecord = {
        id: createId("version"),
        documentId: doc.id,
        versionNumber: latestNumber + 1,
        status: "approved",
        title: "角色关联清理",
        content: updatedContent,
        metadata: { source: "world-bible-sync", deletedCharacterId: characterId },
        parentVersionId: version.id,
        createdBy: userId,
        createdAt: now,
      };
      db.versions.push(newVersion);
      doc.currentVersionId = newVersion.id;
      doc.updatedAt = now;
    }
  }

  private clearLocationRefsInScripts(
    db: DevDatabase,
    projectId: string,
    userId: string,
    locationId: string,
  ): void {
    const scriptDocs = db.documents.filter(
      (doc) => doc.projectId === projectId && doc.type === "script",
    );
    for (const doc of scriptDocs) {
      if (!doc.currentVersionId) continue;
      const version = db.versions.find((v) => v.id === doc.currentVersionId);
      if (!version?.content || typeof version.content !== "object") continue;

      const content = version.content as ScriptContent;
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
      const siblingVersions = db.versions.filter((v) => v.documentId === doc.id);
      const latestNumber = siblingVersions.reduce((max, v) => Math.max(max, v.versionNumber), 0);
      const now = new Date().toISOString();
      const newVersion: VersionRecord = {
        id: createId("version"),
        documentId: doc.id,
        versionNumber: latestNumber + 1,
        status: "approved",
        title: "地点关联清理",
        content: updatedContent,
        metadata: { source: "world-bible-sync", deletedLocationId: locationId },
        parentVersionId: version.id,
        createdBy: userId,
        createdAt: now,
      };
      db.versions.push(newVersion);
      doc.currentVersionId = newVersion.id;
      doc.updatedAt = now;
    }
  }

  private extractWorldBible(db: DevDatabase, projectId: string): WorldBibleContent {
    const wbDoc = db.documents.find(
      (doc) => doc.projectId === projectId && doc.type === "world_bible",
    );
    if (!wbDoc || !wbDoc.currentVersionId) {
      return { characters: [], locations: [] };
    }

    const version = db.versions.find((v) => v.id === wbDoc.currentVersionId);
    if (!version || !version.content || typeof version.content !== "object") {
      return { characters: [], locations: [] };
    }

    const content = version.content as Record<string, unknown>;
    return {
      characters: Array.isArray(content.characters) ? content.characters as WorldBibleContent["characters"] : [],
      locations: Array.isArray(content.locations) ? content.locations as WorldBibleContent["locations"] : [],
      styleGuide: content.styleGuide && typeof content.styleGuide === "object"
        ? content.styleGuide as WorldBibleContent["styleGuide"]
        : undefined,
      voiceConfigs: Array.isArray(content.voiceConfigs) ? content.voiceConfigs as CharacterVoiceConfig[] : undefined,
    };
  }

  private persistWorldBible(db: DevDatabase, projectId: string, userId: string, content: WorldBibleContent) {
    let wbDoc = db.documents.find(
      (doc) => doc.projectId === projectId && doc.type === "world_bible",
    );

    const now = new Date().toISOString();

    if (!wbDoc) {
      wbDoc = {
        id: createId("doc"),
        projectId,
        type: "world_bible",
        title: "\u4e16\u754c\u89c2\u8bbe\u5b9a",
        createdBy: userId,
        createdAt: now,
        updatedAt: now,
      };
      db.documents.push(wbDoc);
    }

    const siblingVersions = db.versions.filter((v) => v.documentId === wbDoc!.id);
    const latestNumber = siblingVersions.reduce((max, v) => Math.max(max, v.versionNumber), 0);

    const version: VersionRecord = {
      id: createId("version"),
      documentId: wbDoc.id,
      versionNumber: latestNumber + 1,
      status: "approved",
      title: "\u4e16\u754c\u89c2\u8bbe\u5b9a\u66f4\u65b0",
      content,
      metadata: { source: "world-bible-editor" },
      parentVersionId: siblingVersions.length > 0
        ? siblingVersions.reduce((latest, v) => v.versionNumber > latest.versionNumber ? v : latest, siblingVersions[0]).id
        : undefined,
      createdBy: userId,
      createdAt: now,
    };

    db.versions.push(version);
    wbDoc.currentVersionId = version.id;
    wbDoc.updatedAt = now;
  }

  // ===== Timeline Methods =====

  async getTimeline(userId: string, projectId: string): Promise<TimelineRecord> {
    return this.database.query((db) => {
      this.assertProjectReadable(db, projectId, userId);
      const existing = db.timelines.find((t) => t.projectId === projectId);
      if (existing) return existing;
      return this.createDefaultTimeline(projectId);
    });
  }

  async saveTimeline(userId: string, projectId: string, payload: TimelineSavePayload): Promise<TimelineRecord> {
    const actor = await this.getActor(userId, projectId);
    if (!canEditTimeline(actor)) {
      throw new ForbiddenException("You do not have permission to edit the timeline");
    }

    return this.database.mutate((db) => {
      this.mustFindProject(db, projectId);
      const now = new Date().toISOString();
      let existing = db.timelines.find((t) => t.projectId === projectId);

      if (existing) {
        existing.duration = payload.duration;
        existing.fps = payload.fps;
        existing.resolution = payload.resolution;
        existing.tracks = payload.tracks;
        existing.updatedAt = now;
        return existing;
      }

      const timeline: TimelineRecord = {
        id: createId("tl"),
        projectId,
        duration: payload.duration,
        fps: payload.fps,
        resolution: payload.resolution,
        tracks: payload.tracks,
        createdAt: now,
        updatedAt: now,
      };
      db.timelines.push(timeline);
      return timeline;
    });
  }

  async autoAssembleTimeline(userId: string, projectId: string): Promise<TimelineRecord> {
    const actor = await this.getActor(userId, projectId);
    if (!canEditTimeline(actor)) {
      throw new ForbiddenException("You do not have permission to edit the timeline");
    }

    return this.database.mutate((db) => {
      this.mustFindProject(db, projectId);
      const now = new Date().toISOString();

      // Gather storyboard data
      const storyboardDoc = db.documents.find(
        (d) => d.projectId === projectId && d.type === "storyboard",
      );

      const videoTracks: TimelineClipRecord[] = [];
      const dialogueTracks: TimelineClipRecord[] = [];
      const subtitleTracks: TimelineClipRecord[] = [];
      let currentTime = 0;
      let clipIndex = 0;

      if (storyboardDoc && storyboardDoc.currentVersionId) {
        const sbVersion = db.versions.find((v) => v.id === storyboardDoc.currentVersionId);
        if (sbVersion && sbVersion.content && typeof sbVersion.content === "object") {
          const sbContent = sbVersion.content as StoryboardContent;
          const shots = Array.isArray(sbContent.shots) ? sbContent.shots : [];

          for (const shot of shots) {
            const shotDuration = shot.durationSeconds || 3;

            // Find adopted video asset for this shot
            const videoDoc = db.documents.find(
              (d) => d.projectId === projectId && d.type === "video" && d.shotId === shot.id,
            );
            if (videoDoc && videoDoc.currentVersionId) {
              const videoVersion = db.versions.find((v) => v.id === videoDoc.currentVersionId);
              const videoContent = videoVersion?.content as Record<string, unknown> | undefined;
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
              });
            }

            // Find audio asset for this shot
            const audioDoc = db.documents.find(
              (d) => d.projectId === projectId && d.type === "audio" && d.shotId === shot.id,
            );
            if (audioDoc && audioDoc.currentVersionId) {
              const audioVersion = db.versions.find((v) => v.id === audioDoc.currentVersionId);
              const audioContent = audioVersion?.content as Record<string, unknown> | undefined;
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

      const existing = db.timelines.find((t) => t.projectId === projectId);
      if (existing) {
        existing.tracks = tracks;
        existing.duration = currentTime;
        existing.updatedAt = now;
        return existing;
      }

      const timeline: TimelineRecord = {
        id: createId("tl"),
        projectId,
        duration: currentTime,
        fps: 30,
        resolution: "1080x1920",
        tracks,
        createdAt: now,
        updatedAt: now,
      };
      db.timelines.push(timeline);
      return timeline;
    });
  }

  async listExports(userId: string, projectId: string): Promise<ExportRecord[]> {
    return this.database.query((db) => {
      this.assertProjectReadable(db, projectId, userId);
      return db.exports
        .filter((e) => e.projectId === projectId)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    });
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
    },
  ) {
    const actor = await this.getActor(userId, projectId);
    if (!canEditProject(actor)) {
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
    if (!canEditProject(actor)) {
      throw new ForbiddenException("You do not have permission to edit voice configuration");
    }

    return this.database.mutate((db) => {
      const wb = this.extractWorldBible(db, projectId);
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

      this.persistWorldBible(db, projectId, userId, { ...wb, voiceConfigs });
      return voiceConfig;
    });
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
