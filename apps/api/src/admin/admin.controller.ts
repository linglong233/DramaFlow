/**
 * @fileoverview 平台管理后台控制器
 * @module api/admin
 *
 * 提供平台概览、团队概览和团队设置查询端点。
 */

import { Controller, Get, Inject, Param, UseGuards } from "@nestjs/common";

import { AuthGuard } from "../common/auth.guard";
import { CurrentUser } from "../common/current-user.decorator";
import { AdminService } from "./admin.service";

@Controller("admin")
@UseGuards(AuthGuard)
export class AdminController {
  constructor(@Inject(AdminService) private readonly adminService: AdminService) {}

  @Get("platform/overview")
  getPlatformOverview(@CurrentUser() user: { id: string }) {
    return this.adminService.getPlatformOverview(user.id);
  }

  @Get("teams/:id/overview")
  getTeamOverview(@CurrentUser() user: { id: string }, @Param("id") teamId: string) {
    return this.adminService.getTeamOverview(user.id, teamId);
  }

  @Get("teams/:id/settings")
  getTeamSettings(@CurrentUser() user: { id: string }, @Param("id") teamId: string) {
    return this.adminService.getTeamSettings(user.id, teamId);
  }
}
