/**
 * @fileoverview NestJS 根模块
 * @module api/app
 *
 * 组装所有功能模块，包括认证、工作区、任务、存储、管理后台、通知、实时等。
 * 同时配置静态文件服务以提供上传文件的 HTTP 访问。
 */

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

/** 上传文件存储目录 */
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