/**
 * @fileoverview 存储服务
 * @module api/storage
 *
 * 提供文件上传、下载和删除的统一接口。
 */

import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import type { StorageProvider } from "@dramaflow/shared";

import { PrismaService } from "../common/prisma.service";
import { iso } from "../common/prisma-json";
import { createId } from "../common/id";
import { LocalStorageProvider } from "./local-storage.provider";
import { S3StorageProvider } from "./s3-storage.provider";

@Injectable()
export class StorageService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(LocalStorageProvider) private readonly localStorage: LocalStorageProvider,
    @Inject(S3StorageProvider) private readonly s3Storage: S3StorageProvider,
  ) {}

  async createUploadTarget(
    userId: string,
    input: { projectId: string; documentId?: string; versionId?: string; filename: string; contentType: string; sizeInBytes?: number },
  ) {
    await this.assertProjectReadable(userId, input.projectId);
    const safeName = input.filename.replace(/[^a-zA-Z0-9._-]/g, "-");
    const key = `${input.projectId}/uploads/${Date.now()}-${safeName}`;
    const provider = this.getProvider();
    const target = await provider.createUploadTarget({
      key,
      contentType: input.contentType,
    });

    const asset = await this.prisma.asset.create({
      data: {
        id: createId("asset"),
        projectId: input.projectId,
        documentId: input.documentId,
        versionId: input.versionId,
        storageDriver: target.driver,
        storageKey: key,
        publicUrl: target.publicUrl,
        mimeType: input.contentType,
        sizeInBytes: input.sizeInBytes ?? 0,
        createdBy: userId,
      },
    });

    return { asset: { ...asset, createdAt: iso(asset.createdAt) }, target };
  }

  async finalizeDirectUpload(key: string, contentType: string, body: Buffer) {
    if (this.getDriver() !== "local") {
      throw new BadRequestException("Direct uploads are only supported in local storage mode");
    }

    const stored = await this.localStorage.putObject({ key, body, contentType });
    const asset = await this.prisma.asset.findFirst({ where: { storageKey: key } });
    if (asset) {
      await this.prisma.asset.update({
        where: { id: asset.id },
        data: {
          publicUrl: stored.publicUrl,
          sizeInBytes: body.byteLength,
          mimeType: contentType,
        },
      });
    }

    return stored;
  }

  async storeGeneratedAsset(
    userId: string,
    input: { projectId: string; documentId?: string; versionId?: string; filename: string; contentType: string; body: Buffer | string },
  ) {
    const provider = this.getProvider();
    const key = `${input.projectId}/generated/${Date.now()}-${input.filename.replace(/[^a-zA-Z0-9._-]/g, "-")}`;
    const stored = await provider.putObject({
      key,
      body: input.body,
      contentType: input.contentType,
    });

    const sizeInBytes = Buffer.isBuffer(input.body)
      ? input.body.byteLength
      : Buffer.byteLength(input.body);

    const asset = await this.prisma.asset.create({
      data: {
        id: createId("asset"),
        projectId: input.projectId,
        documentId: input.documentId,
        versionId: input.versionId,
        storageDriver: this.getDriver(),
        storageKey: stored.key,
        publicUrl: stored.publicUrl,
        mimeType: input.contentType,
        sizeInBytes,
        createdBy: userId,
      },
    });

    return { asset: { ...asset, createdAt: iso(asset.createdAt) }, url: stored.publicUrl };
  }

  async getAssetUrl(userId: string, assetId: string) {
    const asset = await this.prisma.asset.findUnique({ where: { id: assetId } });
    if (!asset) {
      throw new NotFoundException("Asset not found");
    }
    await this.assertProjectReadable(userId, asset.projectId);

    const mappedAsset = { ...asset, createdAt: iso(asset.createdAt) };
    return {
      asset: mappedAsset,
      url: asset.publicUrl ?? (await this.getProvider(asset.storageDriver as "local" | "s3").getObjectUrl(asset.storageKey)),
    };
  }

  async getAssetBuffer(userId: string, assetId: string) {
    const asset = await this.prisma.asset.findUnique({ where: { id: assetId } });
    if (!asset) {
      throw new NotFoundException("Asset not found");
    }

    await this.assertProjectReadable(userId, asset.projectId);
    if (!asset.mimeType.startsWith("image/") && !asset.mimeType.startsWith("video/")) {
      throw new BadRequestException("Only image and video assets can be used as generation references");
    }

    try {
      const body = await this.getProvider(asset.storageDriver as "local" | "s3").readObject(asset.storageKey);
      return {
        asset: { ...asset, createdAt: iso(asset.createdAt) },
        body,
        mimeType: asset.mimeType,
      };
    } catch (error) {
      const assetUrl = asset.publicUrl;
      if (assetUrl && /^https?:\/\//.test(assetUrl)) {
        const response = await fetch(assetUrl);
        if (!response.ok) {
          throw new NotFoundException(`Asset content request failed with HTTP ${response.status}`);
        }

        return {
          asset: { ...asset, createdAt: iso(asset.createdAt) },
          body: new Uint8Array(await response.arrayBuffer()),
          mimeType: response.headers.get("content-type") ?? asset.mimeType,
        };
      }

      const message = error instanceof Error ? error.message : "Unknown asset read error";
      throw new NotFoundException(`Failed to read asset content: ${message}`);
    }
  }

  getDriver(): "local" | "s3" {
    return process.env.STORAGE_DRIVER === "s3" ? "s3" : "local";
  }

  private getProvider(driver = this.getDriver()): StorageProvider {
    return driver === "s3" ? this.s3Storage : this.localStorage;
  }

  private async assertProjectReadable(userId: string, projectId: string) {
    const project = await this.prisma.project.findUnique({ where: { id: projectId } });
    if (!project) {
      throw new NotFoundException("Project not found");
    }
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (user?.globalRole === "platform_super_admin") return;

    const [teamMember, projectMember] = await this.prisma.$transaction([
      this.prisma.teamMember.findFirst({ where: { teamId: project.teamId, userId } }),
      this.prisma.projectMember.findFirst({ where: { projectId, userId } }),
    ]);

    if (!teamMember && !projectMember) {
      throw new ForbiddenException("You do not have access to this asset");
    }
  }
}
