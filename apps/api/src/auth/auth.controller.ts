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

const LOGIN_ATTEMPTS = new Map<string, { count: number; resetAt: number }>();
const MAX_LOGIN_ATTEMPTS = 10;
const LOGIN_WINDOW_MS = 15 * 60 * 1000;

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

@Controller("auth")
export class AuthController {
  constructor(@Inject(AuthService) private readonly authService: AuthService) {}

  @Post("register")
  register(
    @Body() body: { email: string; password: string; displayName: string },
  ) {
    return this.authService.register(body);
  }

  @Post("login")
  login(@Req() req: Request, @Body() body: { email: string; password: string }) {
    checkLoginRateLimit(req.ip ?? "unknown");
    return this.authService.login(body);
  }

  @Post("refresh")
  refresh(@Body() body: { refreshToken: string }) {
    return this.authService.refresh(body);
  }

  @Post("logout")
  logout(@Body() body: { refreshToken: string }) {
    return this.authService.logout(body);
  }

  @Post("forgot-password")
  forgotPassword(@Body() body: { email: string }) {
    return this.authService.forgotPassword(body.email);
  }

  @Post("reset-password")
  resetPassword(@Body() body: { token: string; nextPassword: string }) {
    return this.authService.resetPassword(body);
  }

  @Get("me")
  @UseGuards(AuthGuard)
  me(@CurrentUser() user: { id: string }) {
    return this.authService.getProfile(user.id);
  }

  @Patch("me")
  @UseGuards(AuthGuard)
  updateMe(
    @CurrentUser() user: { id: string },
    @Body() body: { displayName?: string; llmConfig?: import("@dramaflow/shared").LlmProviderConfig; imageGenerationConfig?: import("@dramaflow/shared").ImageGenerationConfig },
  ) {
    return this.authService.updateProfile(user.id, body);
  }

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