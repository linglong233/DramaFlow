import { Module } from "@nestjs/common";

import { AuthModule } from "../auth/auth.module";
import { CommonModule } from "../common/common.module";
import { WorkspaceController } from "./workspace.controller";
import { WorkspaceService } from "./workspace.service";

@Module({
  imports: [CommonModule, AuthModule],
  controllers: [WorkspaceController],
  providers: [WorkspaceService],
  exports: [WorkspaceService],
})
export class WorkspaceModule {}
