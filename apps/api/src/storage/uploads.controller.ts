/**
 * @fileoverview 上传控制器
 * @module api/storage
 *
 * 提供文件上传和上传目标创建的 REST 端点。
 */

import {
  Body,
  Controller,
  Get,
  Headers,
  Inject,
  Param,
  Post,
  Put,
  Req,
  UseGuards,
} from "@nestjs/common";
import type { Request } from "express";

import { AuthGuard } from "../common/auth.guard";
import { CurrentUser } from "../common/current-user.decorator";
import { StorageService } from "./storage.service";

@Controller()
export class UploadsController {
  constructor(@Inject(StorageService) private readonly storageService: StorageService) {}

  @Post("uploads")
  @UseGuards(AuthGuard)
  createUploadTarget(
    @CurrentUser() user: { id: string },
    @Body() body: { projectId: string; documentId?: string; versionId?: string; filename: string; contentType: string; sizeInBytes?: number },
  ) {
    return this.storageService.createUploadTarget(user.id, body);
  }

  @Put("uploads/direct/:key")
  @UseGuards(AuthGuard)
  async directUpload(
    @Param("key") key: string,
    @Headers("content-type") contentType: string,
    @Req() request: Request & { body: Buffer },
  ) {
    const decodedKey = decodeURIComponent(key);
    if (decodedKey.includes("..") || decodedKey.startsWith("/")) {
      throw new (await import("@nestjs/common")).BadRequestException("Invalid upload key");
    }
    return this.storageService.finalizeDirectUpload(decodedKey, contentType ?? "application/octet-stream", request.body);
  }

  @Get("assets/:id/url")
  @UseGuards(AuthGuard)
  getAssetUrl(@CurrentUser() user: { id: string }, @Param("id") assetId: string) {
    return this.storageService.getAssetUrl(user.id, assetId);
  }
}