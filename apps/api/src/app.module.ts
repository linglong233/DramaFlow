import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { ServeStaticModule } from "@nestjs/serve-static";
import { join } from "node:path";

import { AdminModule } from "./admin/admin.module";
import { AppController } from "./app.controller";
import { AuthModule } from "./auth/auth.module";
import { CommonModule } from "./common/common.module";
import { JobsModule } from "./jobs/jobs.module";
import { NotificationModule } from "./notifications/notification.module";
import { RealtimeModule } from "./realtime/realtime.module";
import { StorageModule } from "./storage/storage.module";
import { WorkspaceModule } from "./workspace/workspace.module";

const uploadsDir = process.env.UPLOADS_DIR ?? "apps/api/uploads";

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    CommonModule,
    ServeStaticModule.forRoot({
      rootPath: join(process.cwd(), uploadsDir),
      serveRoot: "/uploads",
      serveStaticOptions: {
        index: false,
      },
    }),
    AuthModule,
    WorkspaceModule,
    JobsModule,
    StorageModule,
    RealtimeModule,
    AdminModule,
    NotificationModule,
  ],
  controllers: [AppController],
})
export class AppModule {}