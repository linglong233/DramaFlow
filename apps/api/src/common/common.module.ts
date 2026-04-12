/**
 * @fileoverview 通用基础设施模块
 * @module api/common
 *
 * 注册并导出全局基础设施服务：开发数据库、JWT 模块、认证守卫、LLM Provider 服务。
 */

import { Module } from "@nestjs/common";
import { JwtModule } from "@nestjs/jwt";

import { AuthGuard } from "./auth.guard";
import { DevDatabaseService } from "./dev-database.service";
import { LlmProviderService } from "./llm-provider.service";

@Module({
  imports: [JwtModule.register({})],
  providers: [DevDatabaseService, AuthGuard, LlmProviderService],
  exports: [DevDatabaseService, AuthGuard, JwtModule, LlmProviderService],
})
export class CommonModule {}