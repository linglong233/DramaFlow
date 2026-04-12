/**
 * @fileoverview 认证模块
 * @module api/auth
 *
 * 注册认证控制器和服务，依赖 CommonModule 提供的 JWT 和数据库服务。
 */

import { Module } from "@nestjs/common";

import { CommonModule } from "../common/common.module";
import { AuthController } from "./auth.controller";
import { AuthService } from "./auth.service";

@Module({
  imports: [CommonModule],
  controllers: [AuthController],
  providers: [AuthService],
  exports: [AuthService],
})
export class AuthModule {}