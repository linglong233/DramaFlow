/**
 * @fileoverview 认证控制器
 * @module api/auth
 *
 * 提供用户注册、登录、令牌刷新、登出、密码重置和个人信息管理端点。
 */

import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Patch,
  Post,
  Req,
  UseGuards,
} from "@nestjs/common";
import type { Request } from "express";

import { CurrentUser } from "../common/current-user.decorator";
import { AuthGuard } from "../common/auth.guard";
import { AuthService } from "./auth.service";

/** 登录试次限制记录（基于 IP 的内存级限流） */
const LOGIN_ATTEMPTS = new Map<string, { count: number; resetAt: number }>();
const MAX_LOGIN_ATTEMPTS = 10;
const LOGIN_WINDOW_MS = 15 * 60 * 1000;

/** 检查登录速率限制，超过限制抛出异常 */
function checkLoginRateLimit(ip: string) {
  const now = Date.now();
  const record = LOGIN_ATTEMPTS.get(ip);

  if (!record || now > record.resetAt) {
    LOGIN_ATTEMPTS.set(ip, { count: 1, resetAt: now + LOGIN_WINDOW_MS });
    return;
  }

  record.count += 1;
  if (record.count > MAX_LOGIN_ATTEMPTS) {
    throw new (require("@nestjs/common").BadRequestException)(
      "Too many login attempts. Please try again later.",
    );
  }
}

/** 认证控制器，处理所有用户身份相关的 HTTP 请求 */
@Controller("auth")
export class AuthController {
  constructor(@Inject(AuthService) private readonly authService: AuthService) {}

  /** POST /auth/register - 用户注册 */
  @Post("register")
  register(
    @Body() body: { email: string; password: string; displayName: string },
  ) {
    return this.authService.register(body);
  }

  /** POST /auth/login - 用户登录（含速率限制） */
  @Post("login")
  login(@Req() req: Request, @Body() body: { email: string; password: string }) {
    checkLoginRateLimit(req.ip ?? "unknown");
    return this.authService.login(body);
  }

  /** POST /auth/refresh - 刷新访问令牌 */
  @Post("refresh")
  refresh(@Body() body: { refreshToken: string }) {
    return this.authService.refresh(body);
  }

  /** POST /auth/logout - 用户登出 */
  @Post("logout")
  logout(@Body() body: { refreshToken: string }) {
    return this.authService.logout(body);
  }

  /** POST /auth/forgot-password - 发起密码重置 */
  @Post("forgot-password")
  forgotPassword(@Body() body: { email: string }) {
    return this.authService.forgotPassword(body.email);
  }

  /** POST /auth/reset-password - 执行密码重置 */
  @Post("reset-password")
  resetPassword(@Body() body: { token: string; nextPassword: string }) {
    return this.authService.resetPassword(body);
  }

  /** GET /auth/me - 获取当前用户信息 */
  @Get("me")
  @UseGuards(AuthGuard)
  me(@CurrentUser() user: { id: string }) {
    return this.authService.getProfile(user.id);
  }

  /** PATCH /auth/me - 更新当前用户信息 */
  @Patch("me")
  @UseGuards(AuthGuard)
  updateMe(
    @CurrentUser() user: { id: string },
    @Body() body: {
      displayName?: string;
      llmConfig?: import("@dramaflow/shared").LlmProviderConfig;
      imageGenerationConfig?: import("@dramaflow/shared").ImageGenerationConfig;
      imageProviders?: import("@dramaflow/shared").ProviderEntry[];
      videoProviders?: import("@dramaflow/shared").ProviderEntry[];
      defaultImageProvider?: string;
      defaultVideoProvider?: string;
    },
  ) {
    return this.authService.updateProfile(user.id, body);
  }

  /** POST /auth/me/llm-models - 查询当前用户可用的 LLM 模型列表 */
  @Post("me/llm-models")
  @HttpCode(200)
  @UseGuards(AuthGuard)
  listMyLlmModels(
    @CurrentUser() user: { id: string },
    @Body() body?: { llmConfig?: import("@dramaflow/shared").LlmProviderConfig },
  ) {
    return this.authService.listAvailableModels(user.id, body?.llmConfig);
  }
}