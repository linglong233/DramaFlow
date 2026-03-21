import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  UseGuards,
} from "@nestjs/common";

import { CurrentUser } from "../common/current-user.decorator";
import { AuthGuard } from "../common/auth.guard";
import { WorkspaceService } from "./workspace.service";

@Controller()
@UseGuards(AuthGuard)
export class WorkspaceController {
  constructor(private readonly workspaceService: WorkspaceService) {}

  @Get("teams")
  listTeams(@CurrentUser() user: { id: string }) {
    return this.workspaceService.listTeams(user.id);
  }

  @Post("teams")
  createTeam(
    @CurrentUser() user: { id: string },
    @Body() body: { name: string; slug?: string; defaultReviewPolicy?: "required" | "bypass" },
  ) {
    return this.workspaceService.createTeam(user.id, body);
  }

  @Post("teams/:id/members")
  addTeamMember(
    @CurrentUser() user: { id: string },
    @Param("id") teamId: string,
    @Body() body: { email: string; role: "tenant_owner" | "tenant_admin" | "member" },
  ) {
    return this.workspaceService.addTeamMember(user.id, teamId, body);
  }

  @Get("projects")
  listProjects(@CurrentUser() user: { id: string }) {
    return this.workspaceService.listProjects(user.id);
  }

  @Post("projects")
  createProject(
    @CurrentUser() user: { id: string },
    @Body() body: { teamId: string; name: string; description?: string; reviewPolicyMode?: "inherit" | "required" | "bypass" },
  ) {
    return this.workspaceService.createProject(user.id, body);
  }

  @Get("projects/:id")
  getProject(@CurrentUser() user: { id: string }, @Param("id") projectId: string) {
    return this.workspaceService.getProject(user.id, projectId);
  }

  @Patch("projects/:id/review-policy")
  updateReviewPolicy(
    @CurrentUser() user: { id: string },
    @Param("id") projectId: string,
    @Body() body: { reviewPolicyMode: "inherit" | "required" | "bypass" },
  ) {
    return this.workspaceService.updateProjectReviewPolicy(user.id, projectId, body.reviewPolicyMode);
  }

  @Post("projects/:id/invites")
  inviteProjectMember(
    @CurrentUser() user: { id: string },
    @Param("id") projectId: string,
    @Body() body: { email: string; role: "project_admin" | "director" | "writer" | "artist" | "reviewer" | "viewer" },
  ) {
    return this.workspaceService.inviteProjectMember(user.id, projectId, body);
  }

  @Get("documents/:id/versions")
  listVersions(@CurrentUser() user: { id: string }, @Param("id") documentId: string) {
    return this.workspaceService.listVersions(user.id, documentId);
  }

  @Post("documents/:id/versions")
  createVersion(
    @CurrentUser() user: { id: string },
    @Param("id") documentId: string,
    @Body() body: { title: string; content: unknown; metadata?: Record<string, unknown> },
  ) {
    return this.workspaceService.createVersion(user.id, documentId, body);
  }

  @Post("versions/:id/submit")
  submitVersion(@CurrentUser() user: { id: string }, @Param("id") versionId: string) {
    return this.workspaceService.submitVersion(user.id, versionId);
  }

  @Post("versions/:id/approve")
  approveVersion(@CurrentUser() user: { id: string }, @Param("id") versionId: string) {
    return this.workspaceService.approveVersion(user.id, versionId);
  }

  @Post("versions/:id/reject")
  rejectVersion(@CurrentUser() user: { id: string }, @Param("id") versionId: string) {
    return this.workspaceService.rejectVersion(user.id, versionId);
  }

  @Get("versions/:id/comments")
  listComments(@CurrentUser() user: { id: string }, @Param("id") versionId: string) {
    return this.workspaceService.listComments(user.id, versionId);
  }

  @Post("versions/:id/comments")
  addComment(
    @CurrentUser() user: { id: string },
    @Param("id") versionId: string,
    @Body() body: { body: string; anchorType: "document" | "scene" | "shot" | "asset"; anchorId?: string },
  ) {
    return this.workspaceService.addComment(user.id, versionId, body);
  }
}
