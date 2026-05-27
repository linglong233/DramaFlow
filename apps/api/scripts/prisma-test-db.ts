import { spawnSync } from "node:child_process";
import { PrismaClient } from "@prisma/client";

export async function resetPrismaTestDatabase(): Promise<PrismaClient> {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is required for API tests after Prisma migration");
  }

  const migrate = spawnSync(
    process.platform === "win32" ? "npm.cmd" : "npm",
    ["--workspace", "@dramaflow/api", "run", "prisma:migrate:deploy"],
    { stdio: "inherit", env: process.env },
  );
  if (migrate.status !== 0) {
    throw new Error("Prisma migration failed for API tests");
  }

  const prisma = new PrismaClient();
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
