/**
 * @fileoverview 平台管理后台服务
 * @module api/admin
 *
 * 实现平台概览统计、团队概览和团队设置读取等管理功能。
 */

import {
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import {
  canManageTenant,
  type ImageGenerationConfig,
  type ImageGenerationSettingsConfig,
  type ProjectInviteSummary,
  type ReviewQueueVersionSummary,
  type TeamAdminOverviewResponse,
  type TeamMemberSummary,
  type TeamSettingsLlmConfig,
  type TeamSettingsResponse,
  type TeamSummary,
  type TeamRole,
  type VersionStatus,
} from "@dramaflow/shared";

import { DevDatabaseService } from "../common/dev-database.service";
import type { DevDatabase } from "../common/database.types";

interface TeamActorContext {
  userId: string;
  globalRole: "platform_super_admin" | "user";
  teamRoles: TeamRole[];
}

@Injectable()
export class AdminService {
  constructor(@Inject(DevDatabaseService) private readonly database: DevDatabaseService) {}

  async getPlatformOverview(userId: string) {
    const user = await this.database.query((db) => db.users.find((item) => item.id === userId));
    if (user?.globalRole !== "platform_super_admin") {
      throw new ForbiddenException("Only platform administrators can view this dashboard");
    }

    return this.database.query((db) => ({
      metrics: {
        users: db.users.length,
        teams: db.teams.length,
        projects: db.projects.length,
        queuedJobs: db.jobs.filter((job) => job.status === "queued" || job.status === "running").length,
        pendingReviewVersions: db.versions.filter((version) => version.status === "pending_review" || version.status === "submitted").length,
      },
      recentJobs: db.jobs.slice(-10).reverse().map((job) => ({
        id: job.id,
        type: job.type,
        status: job.status,
        updatedAt: job.updatedAt,
      })),
      tenants: db.teams.map((team) => ({
        id: team.id,
        name: team.name,
        slug: team.slug,
      })),
      storageDriver: process.env.STORAGE_DRIVER === "s3" ? "s3" : "local",
    }));
  }

  async getTeamOverview(userId: string, teamId: string): Promise<TeamAdminOverviewResponse> {
    return this.database.query((db) => {
      const actor = this.getTeamActor(db, userId, teamId);
      if (!canManageTenant({
        userId: actor.userId,
        globalRole: actor.globalRole,
        teamRoles: actor.teamRoles,
        projectRoles: [],
      })) {
        throw new ForbiddenException("Only team administrators can view this dashboard");
      }

      const team = this.mustFindTeam(db, teamId);
      const projects = db.projects.filter((project) => project.teamId === teamId);
      return {
        team: this.buildTeamSummary(db, team, actor),
        members: this.getTeamMemberSummaries(db, teamId),
        projects: projects.map((project) => ({
          ...project,
          memberCount: db.projectMembers.filter((member) => member.projectId === project.id).length,
        })),
        projectInvites: this.getProjectInviteSummaries(db, projects.map((project) => project.id)),
        pendingReviews: this.getReviewQueue(db, projects.map((project) => project.id)),
      };
    });
  }

  async getTeamSettings(userId: string, teamId: string): Promise<TeamSettingsResponse> {
    return this.database.query((db) => {
      const actor = this.getTeamActor(db, userId, teamId);
      if (!canManageTenant({
        userId: actor.userId,
        globalRole: actor.globalRole,
        teamRoles: actor.teamRoles,
        projectRoles: [],
      })) {
        throw new ForbiddenException("You do not have permission to view team settings");
      }

      return this.buildTeamSettingsResponse(db, this.mustFindTeam(db, teamId), actor);
    });
  }

  private getTeamActor(db: DevDatabase, userId: string, teamId: string): TeamActorContext {
    const user = this.mustFindUser(db, userId);
    return {
      userId,
      globalRole: user.globalRole,
      teamRoles: db.teamMembers
        .filter((member) => member.teamId === teamId && member.userId === userId)
        .map((member) => member.role),
    };
  }

  private buildTeamSummary(
    db: DevDatabase,
    team: DevDatabase["teams"][number],
    actor: TeamActorContext,
  ): TeamSummary {
    return {
      id: team.id,
      name: team.name,
      slug: team.slug,
      defaultReviewPolicy: team.defaultReviewPolicy,
      createdAt: team.createdAt,
      updatedAt: team.updatedAt,
      currentUserRole: actor.teamRoles[0] ?? null,
      canManage: canManageTenant({
        userId: actor.userId,
        globalRole: actor.globalRole,
        teamRoles: actor.teamRoles,
        projectRoles: [],
      }),
    };
  }

  private buildTeamSettingsResponse(
    db: DevDatabase,
    team: DevDatabase["teams"][number],
    actor: TeamActorContext,
  ): TeamSettingsResponse {
    return {
      ...this.buildTeamSummary(db, team, actor),
      llmConfig: this.buildTeamSettingsLlmConfig(team.llmConfig),
      imageGenerationConfig: this.buildImageGenerationSettingsConfig(team.imageGenerationConfig),
    };
  }

  private buildTeamSettingsLlmConfig(config?: DevDatabase["teams"][number]["llmConfig"]): TeamSettingsLlmConfig | undefined {
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

  private buildImageGenerationSettingsConfig(config?: ImageGenerationConfig): ImageGenerationSettingsConfig | undefined {
    if (!config) {
      return undefined;
    }

    return {
      provider: config.provider,
      baseUrl: config.baseUrl,
      model: config.model,
      hasApiKey: Boolean(config.apiKey),
    };
  }

  private getTeamMemberSummaries(db: DevDatabase, teamId: string): TeamMemberSummary[] {
    return db.teamMembers
      .filter((member) => member.teamId === teamId)
      .map((member) => {
        const user = this.mustFindUser(db, member.userId);
        return {
          id: member.id,
          userId: member.userId,
          role: member.role,
          createdAt: member.createdAt,
          displayName: user.displayName,
          email: user.email,
        } satisfies TeamMemberSummary;
      })
      .sort((left, right) => left.displayName.localeCompare(right.displayName));
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
        } satisfies ProjectInviteSummary;
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
        } satisfies ReviewQueueVersionSummary;
      })
      .filter((version) => projectIds.includes(version.projectId))
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  }

  private isReviewQueueStatus(status: VersionStatus) {
    return status === "pending_review" || status === "submitted";
  }

  private mustFindDocument(db: DevDatabase, documentId: string) {
    const document = db.documents.find((item) => item.id === documentId);
    if (!document) {
      throw new NotFoundException("Document not found");
    }
    return document;
  }

  private mustFindProject(db: DevDatabase, projectId: string) {
    const project = db.projects.find((item) => item.id === projectId);
    if (!project) {
      throw new NotFoundException("Project not found");
    }
    return project;
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
}
