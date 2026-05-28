import { spawnSync } from "node:child_process";

import { PrismaClient } from "@prisma/client";

const DEFAULT_TEST_DATABASE_URL = "postgresql://dramaflow:dramaflow@localhost:5432/dramaflow_test?schema=public";
const FORBIDDEN_DATABASE_NAME_PATTERN = /(prod|production|live)/i;

export function getTestDatabaseUrl(): string {
  return process.env.TEST_DATABASE_URL?.trim() || DEFAULT_TEST_DATABASE_URL;
}

function getDatabaseName(databaseUrl: string): string {
  let parsed: URL;
  try {
    parsed = new URL(databaseUrl);
  } catch {
    throw new Error("Invalid PostgreSQL test database URL");
  }

  const databaseName = decodeURIComponent(parsed.pathname.replace(/^\/+/, ""));
  if (!databaseName) {
    throw new Error("PostgreSQL test database URL must include a database name");
  }
  return databaseName;
}

function getAllowlistedDatabaseNames(): Set<string> {
  return new Set(
    (process.env.DRAMAFLOW_TEST_DATABASE_NAMES ?? "")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean),
  );
}

export function assertSafeTestDatabaseUrl(databaseUrl: string | undefined): string {
  if (!databaseUrl?.trim()) {
    throw new Error("TEST_DATABASE_URL is required for API tests");
  }

  const trimmed = databaseUrl.trim();
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new Error("Invalid PostgreSQL test database URL");
  }
  if (parsed.protocol !== "postgresql:" && parsed.protocol !== "postgres:") {
    throw new Error("API tests require a PostgreSQL TEST_DATABASE_URL");
  }

  const databaseName = getDatabaseName(trimmed);
  if (FORBIDDEN_DATABASE_NAME_PATTERN.test(databaseName)) {
    throw new Error(`Refusing to reset unsafe test database name: ${databaseName}`);
  }

  const allowlistedNames = getAllowlistedDatabaseNames();
  if (!/test/i.test(databaseName) && !allowlistedNames.has(databaseName)) {
    throw new Error(
      `Refusing to reset database "${databaseName}". Use a database name containing "test" or add it to DRAMAFLOW_TEST_DATABASE_NAMES.`,
    );
  }

  return trimmed;
}

export async function resetPrismaTestDatabase(): Promise<PrismaClient> {
  const databaseUrl = assertSafeTestDatabaseUrl(process.env.DATABASE_URL);

  const migrate = spawnSync(
    process.platform === "win32" ? "npm.cmd" : "npm",
    ["--workspace", "@dramaflow/api", "run", "prisma:migrate:deploy"],
    {
      stdio: "inherit",
      env: {
        ...process.env,
        DATABASE_URL: databaseUrl,
      },
    },
  );
  if (migrate.status !== 0) {
    throw new Error("Prisma migration failed for API tests");
  }

  const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
  await prisma.$executeRawUnsafe(`
    TRUNCATE TABLE
      "ImpactIssueEvent", "ImpactSuggestion", "ImpactTarget", "ImpactIssue",
      "VersionDependency", "AuditRecord", "AuditConfig", "Comment",
      "Notification", "Export", "Timeline", "BatchJobGroup", "Asset",
      "Job", "Version", "Document", "ProjectInvite", "ProjectMember",
      "Project", "TeamInviteLink", "TeamMember", "RefreshToken", "Team", "User",
      "ConversationSession", "NovelImportSession"
    RESTART IDENTITY CASCADE
  `);
  return prisma;
}
