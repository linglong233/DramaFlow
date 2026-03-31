import { Controller, Get, Inject, Param, UseGuards } from "@nestjs/common";

import { AuthGuard } from "../common/auth.guard";
import { CurrentUser } from "../common/current-user.decorator";
import { AdminService } from "./admin.service";

@Controller("admin")
@UseGuards(AuthGuard)
export class AdminController {
  constructor(@Inject(AdminService) private readonly adminService: AdminService) {
    this.getPlatformOverview = this.getPlatformOverview.bind(this);
    this.getTeamOverview = this.getTeamOverview.bind(this);
  }

  @Get("platform/overview")
  getPlatformOverview(@CurrentUser() user: { id: string }) {
    return this.adminService.getPlatformOverview(user.id);
  }

  @Get("teams/:id/overview")
  getTeamOverview(@CurrentUser() user: { id: string }, @Param("id") teamId: string) {
    return this.adminService.getTeamOverview(user.id, teamId);
  }
}