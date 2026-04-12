/**
 * @fileoverview 平台管理后台模块
 * @module api/admin
 *
 * 注册管理后台控制器和服务。
 */

import { Module } from "@nestjs/common";

import { AuthModule } from "../auth/auth.module";
import { CommonModule } from "../common/common.module";
import { AdminController } from "./admin.controller";
import { AdminService } from "./admin.service";

@Module({
  imports: [CommonModule, AuthModule],
  controllers: [AdminController],
  providers: [AdminService],
})
export class AdminModule {}