import {
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";

import { DevDatabaseService } from "../common/dev-database.service";

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
        queuedJobs: db.jobs.filter((job) => job.status === "queued").length,
        pendingReviewVersions: db.versions.filter((version) => version.status === "pending_review").length,
      },
      recentJobs: db.jobs.slice(-10).reverse(),
      tenants: db.teams,
      storageDriver: process.env.STORAGE_DRIVER ?? "local",
    }));
  }

  async getTeamOverview(userId: string, teamId: string) {
    return this.database.query((db) => {
      const user = db.users.find((item) => item.id === userId);
      const membership = db.teamMembers.find((item) => item.teamId === teamId && item.userId === userId);
      if (user?.globalRole !== "platform_super_admin" && !membership) {
        throw new ForbiddenException("You do not have access to this team dashboard");
      }

      const team = db.teams.find((item) => item.id === teamId);
      if (!team) {
        throw new NotFoundException("Team not found");
      }

      const projects = db.projects.filter((project) => project.teamId === teamId);
      return {
        team,
        members: db.teamMembers.filter((item) => item.teamId === teamId),
        projects,
        projectInvites: db.projectInvites.filter((invite) => projects.some((project) => project.id === invite.projectId)),
        pendingReviews: db.versions.filter((version) => {
          const document = db.documents.find((doc) => doc.id === version.documentId);
          return version.status === "pending_review" && projects.some((project) => project.id === document?.projectId);
        }),
      };
    });
  }
}
