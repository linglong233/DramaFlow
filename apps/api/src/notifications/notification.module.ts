/**
 * @fileoverview 通知模块
 * @module api/notifications
 *
 * 注册通知控制器和服务。
 */

import { Module } from "@nestjs/common";

import { CommonModule } from "../common/common.module";
import { RealtimeModule } from "../realtime/realtime.module";
import { NotificationController } from "./notification.controller";
import { NotificationService } from "./notification.service";

@Module({
  imports: [CommonModule, RealtimeModule],
  controllers: [NotificationController],
  providers: [NotificationService],
  exports: [NotificationService],
})
export class NotificationModule {}