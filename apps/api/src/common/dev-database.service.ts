/**
 * @fileoverview 开发态 JSON 文件数据库服务
 * @module api/common
 *
 * 基于 JSON 文件的轻量级数据存储，用于开发和轻量部署场景。
 * 生产环境应迁移到 Prisma + PostgreSQL。
 *
 * 使用串行化写入队列（writeChain）保证数据一致性。
 */

import { Injectable, OnModuleInit } from "@nestjs/common";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join } from "node:path";
import type { ImageGenerationConfig, ProviderEntry } from "@dramaflow/shared";

import { createEmptyDatabase, type DevDatabase } from "./database.types";

/** 开发态 JSON 文件数据库服务，提供 query/mutate 两种数据访问模式 */
@Injectable()
export class DevDatabaseService implements OnModuleInit {
  private readonly dataDir = process.env.DATA_DIR ?? "apps/api/data";
  private readonly dataFileName = "dev-db.json";
  private writeChain = Promise.resolve();

  async onModuleInit(): Promise<void> {
    await this.ensureReady();
  }

  /**
   * 只读查询数据库
   * @param reader - 读取回调，接收当前数据库快照
   */
  async query<T>(reader: (db: DevDatabase) => T | Promise<T>): Promise<T> {
    await this.writeChain;
    await this.ensureReady();
    const db = await this.read();
    return reader(db);
  }

  /**
   * 写入操作数据库（串行化执行，结束后自动写入文件）
   * @param writer - 写入回调，可修改数据库内容
   */
  async mutate<T>(writer: (db: DevDatabase) => T | Promise<T>): Promise<T> {
    const operation = this.writeChain.then(async () => {
      await this.ensureReady();
      const db = await this.read();
      const result = await writer(db);
      db.updatedAt = new Date().toISOString();
      await this.write(db);
      return result;
    });

    this.writeChain = operation.then(
      () => undefined,
      () => undefined,
    );

    return operation;
  }

  /** 确保数据文件存在，不存在则初始化空数据库 */
  private async ensureReady(): Promise<void> {
    const filePath = this.getDataFilePath();
    await mkdir(dirname(filePath), { recursive: true });

    try {
      await readFile(filePath, "utf-8");
    } catch {
      await this.write(createEmptyDatabase());
    }
  }

  private async read(): Promise<DevDatabase> {
    const raw = await readFile(this.getDataFilePath(), "utf-8");
    const db = JSON.parse(raw) as DevDatabase;
    const { normalized } = this.normalize(db);

    return normalized;
  }

  private async write(db: DevDatabase): Promise<void> {
    await writeFile(this.getDataFilePath(), JSON.stringify(db, null, 2), "utf-8");
  }

  /**
   * 规范化数据库结构，确保所有数组字段存在并修复已知的乱码标题
   */
  private normalize(db: DevDatabase): { normalized: DevDatabase; changed: boolean } {
    let changed = false;

    const arrayFields: (keyof DevDatabase)[] = [
      "users", "refreshTokens", "teams", "teamMembers", "teamInviteLinks",
      "projects", "projectMembers", "projectInvites",
      "documents", "versions", "comments", "jobs", "assets",
      "notifications", "auditConfigs", "auditRecords", "batchJobs",
      "timelines", "exports",
    ];

    for (const field of arrayFields) {
      if (!Array.isArray(db[field])) {
        (db as unknown as Record<string, unknown>)[field] = [];
        changed = true;
      }
    }

    for (const document of db.documents) {
      const nextTitle = this.normalizeDocumentTitle(document.type, document.title);
      if (nextTitle !== document.title) {
        document.title = nextTitle;
        document.updatedAt = new Date().toISOString();
        changed = true;
      }
    }

    // 迁移旧 imageGenerationConfig → 新 imageProviders / videoProviders
    for (const user of db.users) {
      if (user.imageGenerationConfig && !user.imageProviders?.length) {
        const migrated = this.migrateImageGenerationConfig(user.imageGenerationConfig);
        user.imageProviders = migrated.imageProviders;
        user.videoProviders = migrated.videoProviders;
        user.defaultImageProvider = migrated.defaultImageProvider;
        user.defaultVideoProvider = migrated.defaultVideoProvider;
        changed = true;
      }
    }
    for (const team of db.teams) {
      if (team.imageGenerationConfig && !team.imageProviders?.length) {
        const migrated = this.migrateImageGenerationConfig(team.imageGenerationConfig);
        team.imageProviders = migrated.imageProviders;
        team.videoProviders = migrated.videoProviders;
        team.defaultImageProvider = migrated.defaultImageProvider;
        team.defaultVideoProvider = migrated.defaultVideoProvider;
        changed = true;
      }
    }

    return {
      normalized: db,
      changed,
    };
  }

  /** 修复已知的文档标题乱码问题，使用 Unicode 转义序列确保正确编码 */
  private normalizeDocumentTitle(type: DevDatabase["documents"][number]["type"], title: string) {
    if (!this.looksCorrupted(title)) {
      return title;
    }

    if (type === "script") {
      return "\u4e3b\u5267\u672c";
    }

    if (type === "storyboard") {
      return "\u603b\u5206\u955c";
    }

    if (type === "world_bible") {
      return "\u4e16\u754c\u89c2\u8bbe\u5b9a";
    }

    return title;
  }

  /** 检测字符串是否包含乱码特征 */
  private looksCorrupted(value: string) {
    return value.includes("\u951f") || value.includes("\ufffd");
  }

  /** 将旧 ImageGenerationConfig 迁移为新的 imageProviders / videoProviders */
  private migrateImageGenerationConfig(
    old: ImageGenerationConfig,
  ): { imageProviders: ProviderEntry[]; videoProviders: ProviderEntry[]; defaultImageProvider?: string; defaultVideoProvider?: string } {
    const genId = (prefix: string) => `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

    const imageEntry: ProviderEntry = {
      id: genId("img"),
      provider: old.provider,
      name: `Default ${old.provider}`,
      ...(old.apiKey ? { apiKey: old.apiKey } : {}),
      ...(old.baseUrl ? { baseUrl: old.baseUrl } : {}),
      ...(old.model ? { model: old.model } : {}),
      ...(old.sdConfig ? { sdConfig: old.sdConfig } : {}),
      ...(old.comfyuiConfig ? { comfyuiConfig: old.comfyuiConfig } : {}),
      ...(old.grokConfig ? { grokConfig: old.grokConfig } : {}),
    };

    const result = {
      imageProviders: [imageEntry],
      defaultImageProvider: imageEntry.id,
      videoProviders: [] as ProviderEntry[],
      defaultVideoProvider: undefined as string | undefined,
    };

    if (old.provider === "grok" && old.grokConfig) {
      const videoEntry: ProviderEntry = {
        id: genId("vid"),
        provider: "grok",
        name: "Default Grok Video",
        ...(old.apiKey ? { apiKey: old.apiKey } : {}),
        ...(old.baseUrl ? { baseUrl: old.baseUrl } : {}),
        grokConfig: old.grokConfig,
      };
      result.videoProviders = [videoEntry];
      result.defaultVideoProvider = videoEntry.id;
    } else if (old.provider === "openai-compatible") {
      const videoEntry: ProviderEntry = {
        id: genId("vid"),
        provider: "openai-compatible",
        name: "Default OpenAI Video",
        ...(old.apiKey ? { apiKey: old.apiKey } : {}),
        ...(old.baseUrl ? { baseUrl: old.baseUrl } : {}),
        ...(old.model ? { model: old.model } : {}),
      };
      result.videoProviders = [videoEntry];
      result.defaultVideoProvider = videoEntry.id;
    }

    return result;
  }

  /** 获取数据库 JSON 文件的绝对路径 */
  private getDataFilePath(): string {
    if (isAbsolute(this.dataDir)) {
      return join(this.dataDir, this.dataFileName);
    }

    return join(process.cwd(), this.dataDir, this.dataFileName);
  }
}