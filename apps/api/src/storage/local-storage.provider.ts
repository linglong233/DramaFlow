/**
 * @fileoverview 本地磁盘存储 Provider
 * @module api/storage
 *
 * 将文件存储到本地磁盘，用于开发和轻量部署。
 */

import { Injectable } from "@nestjs/common";
import { mkdir, readFile, rm, writeFile, copyFile } from "node:fs/promises";
import { dirname, isAbsolute, join } from "node:path";

import type {
  CreateUploadTargetInput,
  PutObjectInput,
  StorageProvider,
} from "@dramaflow/shared";

@Injectable()
export class LocalStorageProvider implements StorageProvider {
  private readonly uploadsDir = process.env.UPLOADS_DIR ?? "apps/api/uploads";
  private readonly publicBaseUrl = process.env.LOCAL_STORAGE_PUBLIC_URL ?? "http://localhost:4000/uploads";
  private readonly apiBaseUrl = process.env.API_URL ?? "http://localhost:4000";

  async putObject(input: PutObjectInput): Promise<{ key: string; publicUrl?: string }> {
    const path = this.resolvePath(input.key);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, input.body);
    return {
      key: input.key,
      publicUrl: await this.getObjectUrl(input.key),
    };
  }

  async getObjectUrl(key: string): Promise<string> {
    return `${this.publicBaseUrl}/${key}`;
  }

  async readObject(key: string): Promise<Uint8Array> {
    return readFile(this.resolvePath(key));
  }

  async deleteObject(key: string): Promise<void> {
    await rm(this.resolvePath(key), { force: true });
  }

  async copyObject(sourceKey: string, targetKey: string): Promise<{ key: string; publicUrl?: string }> {
    const sourcePath = this.resolvePath(sourceKey);
    const targetPath = this.resolvePath(targetKey);
    await mkdir(dirname(targetPath), { recursive: true });
    await copyFile(sourcePath, targetPath);
    return {
      key: targetKey,
      publicUrl: await this.getObjectUrl(targetKey),
    };
  }

  async createUploadTarget(input: CreateUploadTargetInput) {
    return {
      driver: "local" as const,
      key: input.key,
      method: "PUT" as const,
      url: `${this.apiBaseUrl}/uploads/direct/${encodeURIComponent(input.key)}`,
      headers: {
        "content-type": input.contentType,
      },
      publicUrl: await this.getObjectUrl(input.key),
    };
  }

  private resolvePath(key: string) {
    const basePath = isAbsolute(this.uploadsDir) ? this.uploadsDir : join(process.cwd(), this.uploadsDir);
    return join(basePath, key);
  }
}