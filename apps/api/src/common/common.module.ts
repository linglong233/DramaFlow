import { Module } from "@nestjs/common";
import { JwtModule } from "@nestjs/jwt";

import { AuthGuard } from "./auth.guard";
import { DevDatabaseService } from "./dev-database.service";
import { LlmProviderService } from "./llm-provider.service";

@Module({
  imports: [JwtModule.register({})],
  providers: [DevDatabaseService, AuthGuard, LlmProviderService],
  exports: [DevDatabaseService, AuthGuard, JwtModule, LlmProviderService],
})
export class CommonModule {}