import { Module } from "@nestjs/common";

import { AuthModule } from "../auth/auth.module";
import { CommonModule } from "../common/common.module";
import { NotificationModule } from "../notifications/notification.module";
import { RealtimeModule } from "../realtime/realtime.module";
import { AuditService } from "./audit.service";
import { WorkspaceController } from "./workspace.controller";
import { WorkspaceService } from "./workspace.service";

@Module({
  imports: [CommonModule, AuthModule, NotificationModule, RealtimeModule],
  controllers: [WorkspaceController],
  providers: [WorkspaceService, AuditService],
  exports: [WorkspaceService, AuditService],
})
export class WorkspaceModule {}