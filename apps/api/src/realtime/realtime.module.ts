/**
 * @fileoverview 实时通信模块
 * @module api/realtime
 *
 * 注册 WebSocket 网关和实时事件服务。
 */

import { Module } from "@nestjs/common";

import { CommonModule } from "../common/common.module";
import { RealtimeEventsService } from "./realtime.events.service";
import { RealtimeGateway } from "./realtime.gateway";

@Module({
  imports: [CommonModule],
  providers: [RealtimeGateway, RealtimeEventsService],
  exports: [RealtimeEventsService],
})
export class RealtimeModule {}