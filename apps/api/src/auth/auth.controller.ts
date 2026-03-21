import {
  Body,
  Controller,
  Get,
  Post,
  UseGuards,
} from "@nestjs/common";

import { CurrentUser } from "../common/current-user.decorator";
import { AuthGuard } from "../common/auth.guard";
import { AuthService } from "./auth.service";

@Controller("auth")
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post("register")
  register(
    @Body() body: { email: string; password: string; displayName: string },
  ) {
    return this.authService.register(body);
  }

  @Post("login")
  login(@Body() body: { email: string; password: string }) {
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
}
