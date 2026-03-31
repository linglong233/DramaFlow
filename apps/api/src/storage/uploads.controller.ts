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
  constructor(@Inject(StorageService) private readonly storageService: StorageService) {
    this.createUploadTarget = this.createUploadTarget.bind(this);
    this.directUpload = this.directUpload.bind(this);
    this.getAssetUrl = this.getAssetUrl.bind(this);
  }

  @Post("uploads")
  @UseGuards(AuthGuard)
  createUploadTarget(
    @CurrentUser() user: { id: string },
    @Body() body: { projectId: string; documentId?: string; versionId?: string; filename: string; contentType: string; sizeInBytes?: number },
  ) {
    return this.storageService.createUploadTarget(user.id, body);
  }

  @Put("uploads/direct/:key")
  async directUpload(
    @Param("key") key: string,
    @Headers("content-type") contentType: string,
    @Req() request: Request & { body: Buffer },
  ) {
    return this.storageService.finalizeDirectUpload(decodeURIComponent(key), contentType ?? "application/octet-stream", request.body);
  }

  @Get("assets/:id/url")
  @UseGuards(AuthGuard)
  getAssetUrl(@CurrentUser() user: { id: string }, @Param("id") assetId: string) {
    return this.storageService.getAssetUrl(user.id, assetId);
  }
}