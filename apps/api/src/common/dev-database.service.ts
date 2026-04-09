import { Injectable, OnModuleInit } from "@nestjs/common";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join } from "node:path";

import { createEmptyDatabase, type DevDatabase } from "./database.types";

@Injectable()
export class DevDatabaseService implements OnModuleInit {
  private readonly dataDir = process.env.DATA_DIR ?? "apps/api/data";
  private readonly dataFileName = "dev-db.json";
  private writeChain = Promise.resolve();

  async onModuleInit(): Promise<void> {
    await this.ensureReady();
  }

  async query<T>(reader: (db: DevDatabase) => T | Promise<T>): Promise<T> {
    await this.writeChain;
    await this.ensureReady();
    const db = await this.read();
    return reader(db);
  }

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

    return {
      normalized: db,
      changed,
    };
  }

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

  private looksCorrupted(value: string) {
    return value.includes("\u951f") || value.includes("\ufffd");
  }

  private getDataFilePath(): string {
    if (isAbsolute(this.dataDir)) {
      return join(this.dataDir, this.dataFileName);
    }

    return join(process.cwd(), this.dataDir, this.dataFileName);
  }
}