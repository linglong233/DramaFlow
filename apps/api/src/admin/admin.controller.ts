import { Controller, Get, Param, UseGuards } from "@nestjs/common";

import { AuthGuard } from "../common/auth.guard";
import { CurrentUser } from "../common/current-user.decorator";
import { AdminService } from "./admin.service";

@Controller("admin")
@UseGuards(AuthGuard)
export class AdminController {
  constructor(private readonly adminService: AdminService) {}

  @Get("platform/overview")
  getPlatformOverview(@CurrentUser() user: { id: string }) {
    return this.adminService.getPlatformOverview(user.id);
  }

  @Get("teams/:id/overview")
  getTeamOverview(@CurrentUser() user: { id: string }, @Param("id") teamId: string) {
    return this.adminService.getTeamOverview(user.id, teamId);
  }
}
