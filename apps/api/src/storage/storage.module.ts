/**
 * @fileoverview 存储模块
 * @module api/storage
 *
 * 根据环境变量注册本地或 S3 存储 Provider。
 */

import { Module } from "@nestjs/common";

import { AuthModule } from "../auth/auth.module";
import { CommonModule } from "../common/common.module";
import { LocalStorageProvider } from "./local-storage.provider";
import { S3StorageProvider } from "./s3-storage.provider";
import { StorageService } from "./storage.service";
import { UploadsController } from "./uploads.controller";

@Module({
  imports: [CommonModule, AuthModule],
  controllers: [UploadsController],
  providers: [StorageService, LocalStorageProvider, S3StorageProvider],
  exports: [StorageService],
})
export class StorageModule {}
