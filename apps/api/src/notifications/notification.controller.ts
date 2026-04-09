import {
  Controller,
  Get,
  Inject,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from "@nestjs/common";
import type { UserRecord } from "@dramaflow/shared";

import { AuthGuard } from "../common/auth.guard";
import { CurrentUser } from "../common/current-user.decorator";
import { NotificationService } from "./notification.service";

@Controller("notifications")
@UseGuards(AuthGuard)
export class NotificationController {
  constructor(@Inject(NotificationService) private readonly notificationService: NotificationService) {}

  @Get()
  async list(
    @CurrentUser() user: UserRecord,
    @Query("unreadOnly") unreadOnly?: string,
    @Query("limit") limit?: string,
    @Query("offset") offset?: string,
  ) {
    return this.notificationService.listNotifications(user.id, {
      unreadOnly: unreadOnly === "true",
      limit: limit ? parseInt(limit, 10) : undefined,
      offset: offset ? parseInt(offset, 10) : undefined,
    });
  }

  @Get("unread-count")
  async unreadCount(@CurrentUser() user: UserRecord) {
    const count = await this.notificationService.getUnreadCount(user.id);
    return { count };
  }

  @Patch(":id/read")
  async markRead(
    @CurrentUser() user: UserRecord,
    @Param("id") id: string,
  ) {
    await this.notificationService.markRead(user.id, id);
    return { ok: true };
  }

  @Post("mark-all-read")
  async markAllRead(@CurrentUser() user: UserRecord) {
    await this.notificationService.markAllRead(user.id);
    return { ok: true };
  }
}
