import { Module } from "@nestjs/common";
import { JwtModule } from "@nestjs/jwt";

import { AuthGuard } from "./auth.guard";
import { DevDatabaseService } from "./dev-database.service";

@Module({
  imports: [JwtModule.register({})],
  providers: [DevDatabaseService, AuthGuard],
  exports: [DevDatabaseService, AuthGuard, JwtModule],
})
export class CommonModule {}