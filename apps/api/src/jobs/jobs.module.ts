import { Module } from "@nestjs/common";

import { AuthModule } from "../auth/auth.module";
import { CommonModule } from "../common/common.module";
import { StorageModule } from "../storage/storage.module";
import { WorkspaceModule } from "../workspace/workspace.module";
import { InternalJobsController } from "./internal-jobs.controller";
import { JobsController } from "./jobs.controller";
import { JobsService } from "./jobs.service";
import { OpenAiMediaProvider } from "./media-generation.provider";
import { OpenAiCompatTextProvider } from "./text-generation.provider";

@Module({
  imports: [CommonModule, AuthModule, WorkspaceModule, StorageModule],
  controllers: [JobsController, InternalJobsController],
  providers: [JobsService, OpenAiCompatTextProvider, OpenAiMediaProvider],
  exports: [JobsService],
})
export class JobsModule {}
