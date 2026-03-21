import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import {
  canEditProject,
  canReviewProject,
  canTransitionVersionStatus,
  getSubmittedStatus,
  resolveReviewRequired,
  type AnchorType,
  type DocumentRecord,
  type DocumentType,
  type ProjectMemberRecord,
  type ProjectRole,
  type TeamMemberRecord,
  type TeamRole,
  type VersionRecord,
  type VersionStatus,
} from "@dramaflow/shared";

import { DevDatabaseService } from "../common/dev-database.service";
import type { DevDatabase, ProjectInviteRecord } from "../common/database.types";
import { createId } from "../common/id";

interface ActorContext {
  userId: string;
  globalRole: "platform_super_admin" | "user";
  teamRoles: TeamRole[];
  projectRoles: ProjectRole[];
}

@Injectable()
export class WorkspaceService {
  constructor(private readonly database: DevDatabaseService) {}

  async listTeams(userId: string) {
    return this.database.query((db) => {
      const teamIds = db.teamMembers
        .filter((member) => member.userId === userId)
        .map((member) => member.teamId);

      return db.teams.filter((team) => teamIds.includes(team.id));
    });
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

  async addTeamMember(userId: string, teamId: string, input: { email: string; role: TeamRole }) {
    const actor = await this.getActor(userId, undefined, teamId);
    if (actor.globalRole !== "platform_super_admin" && !actor.teamRoles.some((role) => role === "tenant_owner" || role === "tenant_admin")) {
      throw new ForbiddenException("Only tenant admins can add members");
    }

    return this.database.mutate((db) => {
      const user = db.users.find((item) => item.email === input.email.trim().toLowerCase());
      if (!user) {
        throw new NotFoundException("User not found");
      }

      const existing = db.teamMembers.find((member) => member.teamId === teamId && member.userId === user.id);
      if (existing) {
        return existing;
      }

      const record: TeamMemberRecord = {
        id: createId("tm"),
        teamId,
        userId: user.id,
        role: input.role,
        createdAt: new Date().toISOString(),
      };
      db.teamMembers.push(record);
      return record;
    });
  }

  async listProjects(userId: string) {
    return this.database.query((db) => {
      const teamIds = db.teamMembers.filter((member) => member.userId === userId).map((member) => member.teamId);
      const projectIds = db.projectMembers.filter((member) => member.userId === userId).map((member) => member.projectId);

      return db.projects.filter((project) => teamIds.includes(project.teamId) || projectIds.includes(project.id));
    });
  }

  async createProject(
    userId: string,
    input: { teamId: string; name: string; description?: string; reviewPolicyMode?: "inherit" | "required" | "bypass" },
  ) {
    await this.getActor(userId, undefined, input.teamId);

    return this.database.mutate((db) => {
      const teamMembership = db.teamMembers.find((member) => member.teamId === input.teamId && member.userId === userId);
      if (!teamMembership) {
        throw new ForbiddenException("You must join the team before creating a project");
      }

      const now = new Date().toISOString();
      const project = {
        id: createId("project"),
        teamId: input.teamId,
        name: input.name.trim(),
        description: input.description?.trim() ?? "",
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
      );

      return project;
    });
  }

  async getProject(userId: string, projectId: string) {
    return this.database.query((db) => {
      this.assertProjectReadable(db, projectId, userId);
      const project = this.mustFindProject(db, projectId);
      return {
        project,
        members: db.projectMembers.filter((member) => member.projectId === projectId),
        invites: db.projectInvites.filter((invite) => invite.projectId === projectId),
        documents: db.documents.filter((document) => document.projectId === projectId),
        versions: db.versions.filter((version) => {
          const document = db.documents.find((item) => item.id === version.documentId);
          return document?.projectId === projectId;
        }),
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

  async inviteProjectMember(userId: string, projectId: string, input: { email: string; role: ProjectRole }) {
    const actor = await this.getActor(userId, projectId);
    if (!canEditProject(actor)) {
      throw new ForbiddenException("Only project editors can invite collaborators");
    }

    return this.database.mutate((db) => {
      const invite: ProjectInviteRecord = {
        id: createId("invite"),
        projectId,
        email: input.email.trim().toLowerCase(),
        role: input.role,
        createdBy: userId,
        status: "pending",
        createdAt: new Date().toISOString(),
      };
      db.projectInvites.push(invite);
      return invite;
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

  async submitVersion(userId: string, versionId: string) {
    const version = await this.database.query((db) => this.mustFindVersion(db, versionId));
    const document = await this.database.query((db) => this.mustFindDocument(db, version.documentId));
    const actor = await this.getActor(userId, document.projectId);
    if (!canEditProject(actor)) {
      throw new ForbiddenException("You do not have permission to submit versions");
    }

    return this.database.mutate((db) => {
      const liveVersion = this.mustFindVersion(db, versionId);
      const liveDocument = this.mustFindDocument(db, liveVersion.documentId);
      const project = this.mustFindProject(db, liveDocument.projectId);
      const team = db.teams.find((item) => item.id === project.teamId);
      if (!team) {
        throw new NotFoundException("Team not found");
      }

      const nextStatus = getSubmittedStatus(resolveReviewRequired(team.defaultReviewPolicy, project.reviewPolicyMode));
      if (!canTransitionVersionStatus(liveVersion.status, nextStatus)) {
        throw new BadRequestException(`Cannot submit a version in status ${liveVersion.status}`);
      }

      liveVersion.status = nextStatus;
      return liveVersion;
    });
  }

  async approveVersion(userId: string, versionId: string) {
    return this.reviewVersion(userId, versionId, "approved");
  }

  async rejectVersion(userId: string, versionId: string) {
    return this.reviewVersion(userId, versionId, "rejected");
  }

  async listComments(userId: string, versionId: string) {
    return this.database.query((db) => {
      const version = this.mustFindVersion(db, versionId);
      const document = this.mustFindDocument(db, version.documentId);
      this.assertProjectReadable(db, document.projectId, userId);
      return db.comments.filter((comment) => comment.versionId === versionId);
    });
  }

  async addComment(
    userId: string,
    versionId: string,
    input: { body: string; anchorType: AnchorType; anchorId?: string },
  ) {
    return this.database.mutate((db) => {
      const version = this.mustFindVersion(db, versionId);
      const document = this.mustFindDocument(db, version.documentId);
      this.assertProjectReadable(db, document.projectId, userId);

      const now = new Date().toISOString();
      const comment = {
        id: createId("comment"),
        versionId,
        authorId: userId,
        body: input.body.trim(),
        anchorType: input.anchorType,
        anchorId: input.anchorId,
        resolved: false,
        createdAt: now,
        updatedAt: now,
      };

      db.comments.push(comment);
      return comment;
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

      const now = new Date().toISOString();
      const version: VersionRecord = {
        id: createId("version"),
        documentId: document.id,
        versionNumber: (latestVersion?.versionNumber ?? 0) + 1,
        status: options.status ?? "draft",
        title: options.title,
        content: options.content,
        metadata: options.metadata,
        parentVersionId: latestVersion?.id,
        createdBy: options.createdBy,
        createdAt: now,
      };

      document.currentVersionId = version.id;
      document.updatedAt = now;
      db.versions.push(version);
      return version;
    });
  }

  private async reviewVersion(userId: string, versionId: string, nextStatus: "approved" | "rejected") {
    const version = await this.database.query((db) => this.mustFindVersion(db, versionId));
    const document = await this.database.query((db) => this.mustFindDocument(db, version.documentId));
    const actor = await this.getActor(userId, document.projectId);
    if (!canReviewProject(actor)) {
      throw new ForbiddenException("You do not have permission to review this version");
    }

    return this.database.mutate((db) => {
      const liveVersion = this.mustFindVersion(db, versionId);
      if (!canTransitionVersionStatus(liveVersion.status, nextStatus)) {
        throw new BadRequestException(`Cannot move version from ${liveVersion.status} to ${nextStatus}`);
      }
      liveVersion.status = nextStatus;
      return liveVersion;
    });
  }

  private async getActor(userId: string, projectId?: string, teamId?: string): Promise<ActorContext> {
    return this.database.query((db) => {
      const user = db.users.find((item) => item.id === userId);
      if (!user) {
        throw new NotFoundException("User not found");
      }

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

  private assertProjectReadable(db: DevDatabase, projectId: string, userId: string) {
    const project = this.mustFindProject(db, projectId);
    const hasTeamAccess = db.teamMembers.some((member) => member.teamId === project.teamId && member.userId === userId);
    const hasProjectAccess = db.projectMembers.some((member) => member.projectId === projectId && member.userId === userId);
    const user = db.users.find((item) => item.id === userId);

    if (user?.globalRole !== "platform_super_admin" && !hasTeamAccess && !hasProjectAccess) {
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
}
