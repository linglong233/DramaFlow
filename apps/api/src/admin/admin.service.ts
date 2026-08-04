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

import { PrismaService } from "../common/prisma.service";
import { iso } from "../common/prisma-json";

interface TeamActorContext {
  userId: string;
  globalRole: "platform_super_admin" | "user";
  teamRoles: TeamRole[];
}

@Injectable()
export class AdminService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async getPlatformOverview(userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (user?.globalRole !== "platform_super_admin") {
      throw new ForbiddenException("Only platform administrators can view this dashboard");
    }

    const [users, teams, projects, queuedJobs, pendingReviewVersions, recentJobs, allTeams] = await this.prisma.$transaction([
      this.prisma.user.count(),
      this.prisma.team.count(),
      this.prisma.project.count(),
      this.prisma.job.count({ where: { status: { in: ["queued", "running"] } } }),
      this.prisma.version.count({ where: { status: { in: ["pending_review", "submitted"] } } }),
      this.prisma.job.findMany({ orderBy: { updatedAt: "desc" }, take: 10, select: { id: true, type: true, status: true, updatedAt: true } }),
      this.prisma.team.findMany({ select: { id: true, name: true, slug: true } }),
    ]);

    return {
      metrics: { users, teams, projects, queuedJobs, pendingReviewVersions },
      recentJobs: recentJobs.map((job) => ({
        id: job.id,
        type: job.type,
        status: job.status,
        updatedAt: iso(job.updatedAt),
      })),
      tenants: allTeams,
      storageDriver: process.env.STORAGE_DRIVER === "s3" ? "s3" : "local",
    };
  }

  async getTeamOverview(userId: string, teamId: string): Promise<TeamAdminOverviewResponse> {
    const actor = await this.getTeamActor(userId, teamId);
    if (!canManageTenant({
      userId: actor.userId,
      globalRole: actor.globalRole,
      teamRoles: actor.teamRoles,
      projectRoles: [],
    })) {
      throw new ForbiddenException("Only team administrators can view this dashboard");
    }

    const team = await this.mustFindTeam(teamId);
    const projects = await this.prisma.project.findMany({ where: { teamId } });

    const [teamSummary, members, projectInvites, pendingReviews] = await Promise.all([
      Promise.resolve(this.buildTeamSummary(team, actor)),
      this.getTeamMemberSummaries(teamId),
      this.getProjectInviteSummaries(projects.map((p) => p.id)),
      this.getReviewQueue(projects.map((p) => p.id)),
    ]);

    // 为所有项目一次性算出成员数（groupBy 走 (projectId,userId) 复合索引的 projectId 前缀）
    const memberCounts = await this.prisma.projectMember.groupBy({
      by: ["projectId"],
      where: { projectId: { in: projects.map((p) => p.id) } },
      _count: { _all: true },
    });
    const memberCountMap = new Map(memberCounts.map((row) => [row.projectId, row._count._all] as const));

    const projectsWithCounts = projects.map((project) => ({
      ...project,
      createdAt: iso(project.createdAt),
      updatedAt: iso(project.updatedAt),
      memberCount: memberCountMap.get(project.id) ?? 0,
    }));

    return {
      team: teamSummary,
      members,
      projects: projectsWithCounts,
      projectInvites,
      pendingReviews,
    };
  }

  async getTeamSettings(userId: string, teamId: string): Promise<TeamSettingsResponse> {
    const actor = await this.getTeamActor(userId, teamId);
    if (!canManageTenant({
      userId: actor.userId,
      globalRole: actor.globalRole,
      teamRoles: actor.teamRoles,
      projectRoles: [],
    })) {
      throw new ForbiddenException("You do not have permission to view team settings");
    }

    const team = await this.mustFindTeam(teamId);
    return this.buildTeamSettingsResponse(team, actor);
  }

  private async getTeamActor(userId: string, teamId: string): Promise<TeamActorContext> {
    const user = await this.mustFindUser(userId);
    const teamMembers = await this.prisma.teamMember.findMany({
      where: { teamId, userId },
    });
    return {
      userId,
      globalRole: user.globalRole,
      teamRoles: teamMembers.map((member) => member.role),
    };
  }

  private buildTeamSummary(
    team: { id: string; name: string; slug: string; defaultReviewPolicy: string; createdAt: Date; updatedAt: Date },
    actor: TeamActorContext,
  ): TeamSummary {
    return {
      id: team.id,
      name: team.name,
      slug: team.slug,
      defaultReviewPolicy: team.defaultReviewPolicy as TeamSummary["defaultReviewPolicy"],
      createdAt: iso(team.createdAt),
      updatedAt: iso(team.updatedAt),
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
    team: {
      id: string; name: string; slug: string; defaultReviewPolicy: string;
      createdAt: Date; updatedAt: Date; llmConfig: unknown; imageGenerationConfig: unknown;
    },
    actor: TeamActorContext,
  ): TeamSettingsResponse {
    return {
      ...this.buildTeamSummary(team, actor),
      llmConfig: this.buildTeamSettingsLlmConfig(team.llmConfig as Record<string, unknown> | undefined | null),
      imageGenerationConfig: this.buildImageGenerationSettingsConfig(team.imageGenerationConfig as ImageGenerationConfig | undefined | null),
    };
  }

  private buildTeamSettingsLlmConfig(config?: Record<string, unknown> | null): TeamSettingsLlmConfig | undefined {
    if (!config) {
      return undefined;
    }

    return {
      provider: config.provider as string,
      baseUrl: config.baseUrl as string | undefined,
      model: config.model as string | undefined,
      stream: config.stream as boolean | undefined,
      hasApiKey: Boolean(config.apiKey),
    };
  }

  private buildImageGenerationSettingsConfig(config?: ImageGenerationConfig | null): ImageGenerationSettingsConfig | undefined {
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

  private async getTeamMemberSummaries(teamId: string): Promise<TeamMemberSummary[]> {
    const teamMembers = await this.prisma.teamMember.findMany({
      where: { teamId },
      include: { user: { select: { displayName: true, email: true } } },
    });

    const summaries: TeamMemberSummary[] = teamMembers.map((member) => ({
      id: member.id,
      userId: member.userId,
      role: member.role,
      createdAt: iso(member.createdAt),
      displayName: member.user?.displayName ?? "Unknown",
      email: member.user?.email ?? "Unknown",
    }));

    return summaries.sort((left, right) => left.displayName.localeCompare(right.displayName));
  }

  private async getProjectInviteSummaries(projectIds: string[]): Promise<ProjectInviteSummary[]> {
    if (projectIds.length === 0) return [];

    const invites = await this.prisma.projectInvite.findMany({
      where: { projectId: { in: projectIds } },
    });

    const summaries = await Promise.all(
      invites.map(async (invite) => {
        const project = await this.mustFindProject(invite.projectId);
        return {
          id: invite.id,
          projectId: invite.projectId,
          projectName: project.name,
          email: invite.email,
          role: invite.role,
          status: invite.status,
          createdAt: iso(invite.createdAt),
          createdBy: invite.createdBy,
        } satisfies ProjectInviteSummary;
      }),
    );

    return summaries.sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  }

  private async getReviewQueue(projectIds: string[]): Promise<ReviewQueueVersionSummary[]> {
    if (projectIds.length === 0) return [];

    // 用关系过滤在 where 里按 projectIds 收窄，避免跨租户全表扫描 + JS 过滤；
    // 嵌套 include 一次性带出 document 和 project，消除双重 N+1。
    const versions = await this.prisma.version.findMany({
      where: {
        status: { in: ["pending_review", "submitted"] },
        document: { projectId: { in: projectIds } },
      },
      include: {
        document: {
          select: {
            id: true,
            title: true,
            project: { select: { id: true, name: true } },
          },
        },
      },
      orderBy: { createdAt: "desc" },
    });

    return versions.map((version) => ({
      id: version.id,
      title: version.title,
      status: version.status,
      versionNumber: version.versionNumber,
      createdAt: iso(version.createdAt),
      documentId: version.document.id,
      documentTitle: version.document.title,
      projectId: version.document.project.id,
      projectName: version.document.project.name,
    }));
  }

  private isReviewQueueStatus(status: VersionStatus) {
    return status === "pending_review" || status === "submitted";
  }

  private async mustFindDocument(documentId: string) {
    const document = await this.prisma.document.findUnique({ where: { id: documentId } });
    if (!document) {
      throw new NotFoundException("Document not found");
    }
    return document;
  }

  private async mustFindProject(projectId: string) {
    const project = await this.prisma.project.findUnique({ where: { id: projectId } });
    if (!project) {
      throw new NotFoundException("Project not found");
    }
    return project;
  }

  private async mustFindTeam(teamId: string) {
    const team = await this.prisma.team.findUnique({ where: { id: teamId } });
    if (!team) {
      throw new NotFoundException("Team not found");
    }
    return team;
  }

  private async mustFindUser(userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      throw new NotFoundException("User not found");
    }
    return user;
  }
}
