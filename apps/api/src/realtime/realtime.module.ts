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