/**
 * @fileoverview 一次性导入脚本：将旧版 dev-db.json 数据迁移到 PostgreSQL
 *
 * 用法：
 *   npx tsx scripts/migrate-legacy-json.ts
 *
 * 环境变量：
 *   DATABASE_URL          — PostgreSQL 连接字符串（必填）
 *   LEGACY_DEV_DB_PATH    — 旧版 JSON 文件路径（可选，默认从 DATA_DIR 推导）
 *   DATA_DIR              — 数据目录（可选，默认 apps/api/data）
 */

import { readFile } from "node:fs/promises";
import { isAbsolute, join } from "node:path";

import { Prisma, PrismaClient } from "@prisma/client";

import type { DevDatabase } from "./legacy-database.types";

const prisma = new PrismaClient();

function resolveLegacyPath(): string {
  if (process.env.LEGACY_DEV_DB_PATH?.trim()) {
    return process.env.LEGACY_DEV_DB_PATH.trim();
  }
  const dataDir = process.env.DATA_DIR ?? "apps/api/data";
  const base = isAbsolute(dataDir) ? dataDir : join(process.cwd(), dataDir);
  return join(base, "dev-db.json");
}

async function readLegacyDatabase(): Promise<DevDatabase> {
  const raw = await readFile(resolveLegacyPath(), "utf-8");
  return JSON.parse(raw) as DevDatabase;
}

async function assertEmptyTarget(): Promise<void> {
  const counts = await Promise.all([
    prisma.user.count(),
    prisma.team.count(),
    prisma.project.count(),
    prisma.document.count(),
    prisma.version.count(),
    prisma.job.count(),
  ]);
  if (counts.some((count) => count > 0)) {
    throw new Error("Target PostgreSQL database is not empty. Refusing legacy JSON import.");
  }
}

// 类型安全的辅助工具
function nullableDate(value: string | null | undefined): Date | null {
  return value ? new Date(value) : null;
}

function json<T>(value: T): T {
  return value;
}

async function importUsers(tx: Prisma.TransactionClient, db: DevDatabase): Promise<void> {
  for (const user of db.users) {
    await tx.user.create({
      data: {
        id: user.id,
        email: user.email,
        displayName: user.displayName,
        passwordHash: user.passwordHash,
        globalRole: user.globalRole,
        llmConfig: json(user.llmConfig),
        imageGenerationConfig: json(user.imageGenerationConfig),
        imageProviders: json(user.imageProviders),
        videoProviders: json(user.videoProviders),
        defaultImageProvider: user.defaultImageProvider ?? null,
        defaultVideoProvider: user.defaultVideoProvider ?? null,
        createdAt: new Date(user.createdAt),
        updatedAt: new Date(user.updatedAt),
      },
    });
  }
  for (const token of db.refreshTokens) {
    await tx.refreshToken.create({
      data: {
        id: token.id,
        userId: token.userId,
        tokenHash: token.tokenHash,
        expiresAt: new Date(token.expiresAt),
        createdAt: new Date(token.createdAt),
      },
    });
  }
}

async function importTeams(tx: Prisma.TransactionClient, db: DevDatabase): Promise<void> {
  for (const team of db.teams) {
    await tx.team.create({
      data: {
        id: team.id,
        name: team.name,
        slug: team.slug,
        defaultReviewPolicy: team.defaultReviewPolicy,
        createdBy: team.createdBy,
        llmConfig: json(team.llmConfig),
        imageGenerationConfig: json(team.imageGenerationConfig),
        imageProviders: json(team.imageProviders),
        videoProviders: json(team.videoProviders),
        defaultImageProvider: team.defaultImageProvider ?? null,
        defaultVideoProvider: team.defaultVideoProvider ?? null,
        projectRolePermissionTemplates: json(team.projectRolePermissionTemplates),
        createdAt: new Date(team.createdAt),
        updatedAt: new Date(team.updatedAt),
      },
    });
  }
  for (const member of db.teamMembers) {
    await tx.teamMember.create({
      data: {
        id: member.id,
        teamId: member.teamId,
        userId: member.userId,
        role: member.role,
        createdAt: new Date(member.createdAt),
      },
    });
  }
  for (const link of db.teamInviteLinks) {
    await tx.teamInviteLink.create({
      data: {
        id: link.id,
        teamId: link.teamId,
        token: link.token,
        role: link.role,
        maxUses: link.maxUses,
        uses: link.uses,
        expiresAt: nullableDate(link.expiresAt),
        createdBy: link.createdBy,
        createdAt: new Date(link.createdAt),
      },
    });
  }
}

async function importProjects(tx: Prisma.TransactionClient, db: DevDatabase): Promise<void> {
  for (const project of db.projects) {
    await tx.project.create({
      data: {
        id: project.id,
        teamId: project.teamId,
        name: project.name,
        description: project.description,
        genre: project.genre ?? null,
        coverUrl: project.coverUrl ?? null,
        status: project.status,
        reviewPolicyMode: project.reviewPolicyMode,
        createdBy: project.createdBy,
        createdAt: new Date(project.createdAt),
        updatedAt: new Date(project.updatedAt),
      },
    });
  }
  for (const member of db.projectMembers) {
    await tx.projectMember.create({
      data: {
        id: member.id,
        projectId: member.projectId,
        userId: member.userId,
        role: member.role,
        permissionOverride: json(member.permissionOverride),
        createdAt: new Date(member.createdAt),
      },
    });
  }
  for (const invite of db.projectInvites) {
    await tx.projectInvite.create({
      data: {
        id: invite.id,
        projectId: invite.projectId,
        email: invite.email,
        role: invite.role,
        createdBy: invite.createdBy,
        status: invite.status,
        createdAt: new Date(invite.createdAt),
      },
    });
  }
}

async function importDocuments(tx: Prisma.TransactionClient, db: DevDatabase): Promise<void> {
  for (const doc of db.documents) {
    await tx.document.create({
      data: {
        id: doc.id,
        projectId: doc.projectId,
        type: doc.type,
        title: doc.title,
        shotId: doc.shotId ?? null,
        currentVersionId: doc.currentVersionId ?? null,
        draftVersionId: doc.draftVersionId ?? null,
        createdBy: doc.createdBy,
        createdAt: new Date(doc.createdAt),
        updatedAt: new Date(doc.updatedAt),
      },
    });
  }
  for (const version of db.versions) {
    await tx.version.create({
      data: {
        id: version.id,
        documentId: version.documentId,
        versionNumber: version.versionNumber,
        status: version.status,
        title: version.title,
        content: json(version.content),
        metadata: json(version.metadata),
        parentVersionId: version.parentVersionId ?? null,
        createdBy: version.createdBy,
        createdAt: new Date(version.createdAt),
      },
    });
  }
}

async function importOperationalRecords(tx: Prisma.TransactionClient, db: DevDatabase): Promise<void> {
  for (const comment of db.comments) {
    await tx.comment.create({
      data: {
        id: comment.id,
        versionId: comment.versionId,
        authorId: comment.authorId,
        body: comment.body,
        parentId: comment.parentId ?? null,
        anchorType: comment.anchorType,
        anchorId: comment.anchorId ?? null,
        resolved: comment.resolved,
        createdAt: new Date(comment.createdAt),
        updatedAt: new Date(comment.updatedAt),
      },
    });
  }

  for (const job of db.jobs) {
    await tx.job.create({
      data: {
        id: job.id,
        type: job.type,
        status: job.status,
        projectId: job.projectId,
        documentId: job.documentId ?? null,
        shotId: job.shotId ?? null,
        input: json(job.input),
        result: job.result ? json(job.result) : null,
        error: job.error ?? null,
        progress: job.progress ?? null,
        retryCount: job.retryCount ?? null,
        maxRetries: job.maxRetries ?? null,
        priority: job.priority ?? null,
        cancelledAt: nullableDate(job.cancelledAt),
        batchId: job.batchId ?? null,
        createdBy: job.createdBy,
        createdAt: new Date(job.createdAt),
        updatedAt: new Date(job.updatedAt),
      },
    });
  }

  for (const asset of db.assets) {
    await tx.asset.create({
      data: {
        id: asset.id,
        projectId: asset.projectId,
        documentId: asset.documentId ?? null,
        versionId: asset.versionId ?? null,
        storageDriver: asset.storageDriver,
        storageKey: asset.storageKey,
        publicUrl: asset.publicUrl ?? null,
        mimeType: asset.mimeType,
        sizeInBytes: asset.sizeInBytes,
        createdBy: asset.createdBy,
        createdAt: new Date(asset.createdAt),
      },
    });
  }

  for (const notification of db.notifications) {
    await tx.notification.create({
      data: {
        id: notification.id,
        userId: notification.userId,
        projectId: notification.projectId ?? null,
        type: notification.type,
        title: notification.title,
        body: notification.body,
        referenceId: notification.referenceId ?? null,
        referenceType: notification.referenceType ?? null,
        isRead: notification.isRead,
        createdAt: new Date(notification.createdAt),
      },
    });
  }

  for (const config of db.auditConfigs) {
    await tx.auditConfig.create({
      data: {
        id: config.id,
        projectId: config.projectId,
        contentType: config.contentType,
        reviewRequired: config.reviewRequired,
        autoApproveRoles: json(config.autoApproveRoles),
        createdAt: new Date(config.createdAt),
        updatedAt: new Date(config.updatedAt),
      },
    });
  }

  for (const record of db.auditRecords) {
    await tx.auditRecord.create({
      data: {
        id: record.id,
        projectId: record.projectId,
        versionId: record.versionId,
        documentType: record.documentType,
        action: record.action,
        reviewerId: record.reviewerId,
        comment: record.comment ?? null,
        createdAt: new Date(record.createdAt),
      },
    });
  }

  for (const dep of db.versionDependencies) {
    await tx.versionDependency.create({
      data: {
        id: dep.id,
        projectId: dep.projectId,
        sourceDocumentId: dep.sourceDocumentId ?? null,
        sourceVersionId: dep.sourceVersionId ?? null,
        sourceDocumentType: dep.sourceDocumentType ?? null,
        targetDocumentId: dep.targetDocumentId,
        targetVersionId: dep.targetVersionId,
        targetDocumentType: dep.targetDocumentType,
        dependencyType: dep.dependencyType,
        targetAnchorType: dep.targetAnchorType ?? null,
        targetAnchorId: dep.targetAnchorId ?? null,
        sourceSnapshotHash: dep.sourceSnapshotHash ?? null,
        targetSnapshotHash: dep.targetSnapshotHash ?? null,
        promptSnapshot: json(dep.promptSnapshot),
        provider: dep.provider ?? null,
        model: dep.model ?? null,
        configSource: dep.configSource ?? null,
        createdBy: dep.createdBy,
        createdAt: new Date(dep.createdAt),
      },
    });
  }

  for (const issue of db.impactIssues) {
    await tx.impactIssue.create({
      data: {
        id: issue.id,
        projectId: issue.projectId,
        dependencyId: issue.dependencyId ?? null,
        sourceDocumentId: issue.sourceDocumentId ?? null,
        previousSourceVersionId: issue.previousSourceVersionId ?? null,
        changedSourceVersionId: issue.changedSourceVersionId,
        targetDocumentId: issue.targetDocumentId,
        targetVersionId: issue.targetVersionId,
        dependencyType: issue.dependencyType,
        status: issue.status,
        severity: issue.severity,
        title: issue.title,
        summary: issue.summary,
        assignedTo: issue.assignedTo ?? null,
        latestSuggestionId: issue.latestSuggestionId ?? null,
        acceptedSuggestionId: issue.acceptedSuggestionId ?? null,
        ignoredBy: issue.ignoredBy ?? null,
        ignoredAt: nullableDate(issue.ignoredAt),
        ignoreReason: issue.ignoreReason ?? null,
        resolvedBy: issue.resolvedBy ?? null,
        resolvedAt: nullableDate(issue.resolvedAt),
        resolveNote: issue.resolveNote ?? null,
        createdBy: issue.createdBy,
        createdAt: new Date(issue.createdAt),
        updatedAt: new Date(issue.updatedAt),
      },
    });
  }

  for (const target of db.impactTargets) {
    await tx.impactTarget.create({
      data: {
        id: target.id,
        issueId: target.issueId,
        projectId: target.projectId,
        targetType: target.targetType,
        documentId: target.documentId ?? null,
        versionId: target.versionId ?? null,
        anchorId: target.anchorId ?? null,
        label: target.label ?? null,
        createdAt: new Date(target.createdAt),
      },
    });
  }

  for (const suggestion of db.impactSuggestions) {
    await tx.impactSuggestion.create({
      data: {
        id: suggestion.id,
        issueId: suggestion.issueId,
        projectId: suggestion.projectId,
        status: suggestion.status,
        summary: suggestion.summary,
        suggestedContent: suggestion.suggestedContent ? json(suggestion.suggestedContent) : null,
        promptSnapshot: suggestion.promptSnapshot ? json(suggestion.promptSnapshot) : null,
        provider: suggestion.provider ?? null,
        model: suggestion.model ?? null,
        createdVersionId: suggestion.createdVersionId ?? null,
        createdDocumentId: suggestion.createdDocumentId ?? null,
        createdJobId: suggestion.createdJobId ?? null,
        acceptedBy: suggestion.acceptedBy ?? null,
        acceptedAt: nullableDate(suggestion.acceptedAt),
        revertedBy: suggestion.revertedBy ?? null,
        revertedAt: nullableDate(suggestion.revertedAt),
        createdBy: suggestion.createdBy,
        createdAt: new Date(suggestion.createdAt),
      },
    });
  }

  for (const event of db.impactIssueEvents) {
    await tx.impactIssueEvent.create({
      data: {
        id: event.id,
        issueId: event.issueId,
        projectId: event.projectId,
        type: event.type,
        actorId: event.actorId,
        note: event.note ?? null,
        createdAt: new Date(event.createdAt),
      },
    });
  }

  for (const batch of db.batchJobs) {
    await tx.batchJobGroup.create({
      data: {
        id: batch.id,
        projectId: batch.projectId,
        jobIds: batch.jobIds,
        status: batch.status,
        createdBy: batch.createdBy,
        createdAt: new Date(batch.createdAt),
      },
    });
  }

  for (const timeline of db.timelines) {
    await tx.timeline.create({
      data: {
        id: timeline.id,
        projectId: timeline.projectId,
        duration: timeline.duration,
        fps: timeline.fps,
        resolution: timeline.resolution,
        tracks: json(timeline.tracks),
        createdAt: new Date(timeline.createdAt),
        updatedAt: new Date(timeline.updatedAt),
      },
    });
  }

  for (const exp of db.exports) {
    await tx.export.create({
      data: {
        id: exp.id,
        projectId: exp.projectId,
        taskId: exp.taskId,
        resolution: exp.resolution,
        fps: exp.fps,
        bitrate: exp.bitrate ?? null,
        format: exp.format,
        outputUrl: exp.outputUrl ?? null,
        fileSize: exp.fileSize ?? null,
        duration: exp.duration ?? null,
        status: exp.status,
        createdBy: exp.createdBy,
        createdAt: new Date(exp.createdAt),
        completedAt: nullableDate(exp.completedAt),
      },
    });
  }

  for (const session of db.conversationSessions) {
    await tx.conversationSession.create({
      data: {
        id: session.id,
        projectId: session.projectId,
        messages: json(session.messages),
        brief: json(session.brief),
        dimensionStatus: json(session.dimensionStatus),
        targetDocType: session.targetDocType,
        createdBy: session.createdBy,
        createdAt: new Date(session.createdAt),
        updatedAt: new Date(session.updatedAt),
      },
    });
  }

  for (const session of db.novelImportSessions) {
    await tx.novelImportSession.create({
      data: {
        id: session.id,
        projectId: session.projectId,
        createdBy: session.createdBy,
        status: session.status,
        stage: session.stage,
        progress: session.progress,
        sourceText: session.sourceText,
        options: json(session.options),
        chunks: json(session.chunks),
        adaptationPlan: session.adaptationPlan ?? null,
        worldBible: session.worldBible ? json(session.worldBible) : null,
        synopsis: session.synopsis ?? null,
        scriptPreview: session.scriptPreview ? json(session.scriptPreview) : null,
        writeResult: session.writeResult ? json(session.writeResult) : null,
        lastJobId: session.lastJobId ?? null,
        error: session.error ?? null,
        createdAt: new Date(session.createdAt),
        updatedAt: new Date(session.updatedAt),
      },
    });
  }
}

async function printCounts(): Promise<void> {
  const counts = {
    users: await prisma.user.count(),
    teams: await prisma.team.count(),
    projects: await prisma.project.count(),
    documents: await prisma.document.count(),
    versions: await prisma.version.count(),
    jobs: await prisma.job.count(),
    assets: await prisma.asset.count(),
  };
  console.log(JSON.stringify(counts, null, 2));
}

async function assertNoInvalidRows(label: string, query: Prisma.Sql): Promise<void> {
  const rows = await prisma.$queryRaw<Array<{ id: string }>>(query);
  if (rows.length > 0) {
    const sampleIds = rows.slice(0, 10).map((row) => row.id).join(", ");
    throw new Error(`${label}: ${rows.length} invalid row(s). Sample IDs: ${sampleIds}`);
  }
}

async function validateImportedDatabase(): Promise<void> {
  await assertNoInvalidRows("Projects without teams", Prisma.sql`
    SELECT p.id FROM "Project" p
    LEFT JOIN "Team" t ON t.id = p."teamId"
    WHERE t.id IS NULL
  `);
  await assertNoInvalidRows("Documents without projects", Prisma.sql`
    SELECT d.id FROM "Document" d
    LEFT JOIN "Project" p ON p.id = d."projectId"
    WHERE p.id IS NULL
  `);
  await assertNoInvalidRows("Versions without documents", Prisma.sql`
    SELECT v.id FROM "Version" v
    LEFT JOIN "Document" d ON d.id = v."documentId"
    WHERE d.id IS NULL
  `);
  await assertNoInvalidRows("Documents with invalid current versions", Prisma.sql`
    SELECT d.id FROM "Document" d
    LEFT JOIN "Version" v ON v.id = d."currentVersionId" AND v."documentId" = d.id
    WHERE d."currentVersionId" IS NOT NULL AND v.id IS NULL
  `);
  await assertNoInvalidRows("Documents with invalid draft versions", Prisma.sql`
    SELECT d.id FROM "Document" d
    LEFT JOIN "Version" v ON v.id = d."draftVersionId" AND v."documentId" = d.id
    WHERE d."draftVersionId" IS NOT NULL AND v.id IS NULL
  `);
  await assertNoInvalidRows("Comments without versions", Prisma.sql`
    SELECT c.id FROM "Comment" c
    LEFT JOIN "Version" v ON v.id = c."versionId"
    WHERE v.id IS NULL
  `);
  await assertNoInvalidRows("Comments with invalid parents", Prisma.sql`
    SELECT c.id FROM "Comment" c
    LEFT JOIN "Comment" parent ON parent.id = c."parentId"
    WHERE c."parentId" IS NOT NULL AND parent.id IS NULL
  `);
  await assertNoInvalidRows("Jobs without projects", Prisma.sql`
    SELECT j.id FROM "Job" j
    LEFT JOIN "Project" p ON p.id = j."projectId"
    WHERE p.id IS NULL
  `);
  await assertNoInvalidRows("Jobs with invalid documents", Prisma.sql`
    SELECT j.id FROM "Job" j
    LEFT JOIN "Document" d ON d.id = j."documentId" AND d."projectId" = j."projectId"
    WHERE j."documentId" IS NOT NULL AND d.id IS NULL
  `);
  await assertNoInvalidRows("Assets without projects", Prisma.sql`
    SELECT a.id FROM "Asset" a
    LEFT JOIN "Project" p ON p.id = a."projectId"
    WHERE p.id IS NULL
  `);
  await assertNoInvalidRows("Assets with invalid documents", Prisma.sql`
    SELECT a.id FROM "Asset" a
    LEFT JOIN "Document" d ON d.id = a."documentId" AND d."projectId" = a."projectId"
    WHERE a."documentId" IS NOT NULL AND d.id IS NULL
  `);
  await assertNoInvalidRows("Assets with invalid versions", Prisma.sql`
    SELECT a.id FROM "Asset" a
    LEFT JOIN "Version" v ON v.id = a."versionId"
    WHERE a."versionId" IS NOT NULL AND v.id IS NULL
  `);
  await assertNoInvalidRows("Audit configs without projects", Prisma.sql`
    SELECT ac.id FROM "AuditConfig" ac
    LEFT JOIN "Project" p ON p.id = ac."projectId"
    WHERE p.id IS NULL
  `);
  await assertNoInvalidRows("Audit records without projects", Prisma.sql`
    SELECT ar.id FROM "AuditRecord" ar
    LEFT JOIN "Project" p ON p.id = ar."projectId"
    WHERE p.id IS NULL
  `);
  await assertNoInvalidRows("Audit records without versions", Prisma.sql`
    SELECT ar.id FROM "AuditRecord" ar
    LEFT JOIN "Version" v ON v.id = ar."versionId"
    WHERE v.id IS NULL
  `);
  await assertNoInvalidRows("Notifications without users", Prisma.sql`
    SELECT n.id FROM "Notification" n
    LEFT JOIN "User" u ON u.id = n."userId"
    WHERE u.id IS NULL
  `);
  await assertNoInvalidRows("Notifications with invalid projects", Prisma.sql`
    SELECT n.id FROM "Notification" n
    LEFT JOIN "Project" p ON p.id = n."projectId"
    WHERE n."projectId" IS NOT NULL AND p.id IS NULL
  `);
  await assertNoInvalidRows("Batch job groups without projects", Prisma.sql`
    SELECT b.id FROM "BatchJobGroup" b
    LEFT JOIN "Project" p ON p.id = b."projectId"
    WHERE p.id IS NULL
  `);
  await assertNoInvalidRows("Timelines without projects", Prisma.sql`
    SELECT t.id FROM "Timeline" t
    LEFT JOIN "Project" p ON p.id = t."projectId"
    WHERE p.id IS NULL
  `);
  await assertNoInvalidRows("Exports without projects", Prisma.sql`
    SELECT e.id FROM "Export" e
    LEFT JOIN "Project" p ON p.id = e."projectId"
    WHERE p.id IS NULL
  `);
  await assertNoInvalidRows("Version dependencies without projects", Prisma.sql`
    SELECT vd.id FROM "VersionDependency" vd
    LEFT JOIN "Project" p ON p.id = vd."projectId"
    WHERE p.id IS NULL
  `);
  await assertNoInvalidRows("Version dependencies with invalid source documents", Prisma.sql`
    SELECT vd.id FROM "VersionDependency" vd
    LEFT JOIN "Document" d ON d.id = vd."sourceDocumentId" AND d."projectId" = vd."projectId"
    WHERE vd."sourceDocumentId" IS NOT NULL AND d.id IS NULL
  `);
  await assertNoInvalidRows("Version dependencies with invalid source versions", Prisma.sql`
    SELECT vd.id FROM "VersionDependency" vd
    LEFT JOIN "Version" v ON v.id = vd."sourceVersionId"
    WHERE vd."sourceVersionId" IS NOT NULL AND v.id IS NULL
  `);
  await assertNoInvalidRows("Version dependencies with invalid target documents", Prisma.sql`
    SELECT vd.id FROM "VersionDependency" vd
    LEFT JOIN "Document" d ON d.id = vd."targetDocumentId" AND d."projectId" = vd."projectId"
    WHERE d.id IS NULL
  `);
  await assertNoInvalidRows("Version dependencies with invalid target versions", Prisma.sql`
    SELECT vd.id FROM "VersionDependency" vd
    LEFT JOIN "Version" v ON v.id = vd."targetVersionId"
    WHERE v.id IS NULL
  `);
  await assertNoInvalidRows("Impact issues without projects", Prisma.sql`
    SELECT ii.id FROM "ImpactIssue" ii
    LEFT JOIN "Project" p ON p.id = ii."projectId"
    WHERE p.id IS NULL
  `);
  await assertNoInvalidRows("Impact issues with invalid dependencies", Prisma.sql`
    SELECT ii.id FROM "ImpactIssue" ii
    LEFT JOIN "VersionDependency" vd ON vd.id = ii."dependencyId"
    WHERE ii."dependencyId" IS NOT NULL AND vd.id IS NULL
  `);
  await assertNoInvalidRows("Impact issues with invalid target documents", Prisma.sql`
    SELECT ii.id FROM "ImpactIssue" ii
    LEFT JOIN "Document" d ON d.id = ii."targetDocumentId" AND d."projectId" = ii."projectId"
    WHERE d.id IS NULL
  `);
  await assertNoInvalidRows("Impact issues with invalid target versions", Prisma.sql`
    SELECT ii.id FROM "ImpactIssue" ii
    LEFT JOIN "Version" v ON v.id = ii."targetVersionId"
    WHERE v.id IS NULL
  `);
  await assertNoInvalidRows("Impact issues with invalid changed source versions", Prisma.sql`
    SELECT ii.id FROM "ImpactIssue" ii
    LEFT JOIN "Version" v ON v.id = ii."changedSourceVersionId"
    WHERE v.id IS NULL
  `);
  await assertNoInvalidRows("Impact targets without issues", Prisma.sql`
    SELECT it.id FROM "ImpactTarget" it
    LEFT JOIN "ImpactIssue" ii ON ii.id = it."issueId"
    WHERE ii.id IS NULL
  `);
  await assertNoInvalidRows("Impact targets with invalid projects", Prisma.sql`
    SELECT it.id FROM "ImpactTarget" it
    LEFT JOIN "Project" p ON p.id = it."projectId"
    WHERE p.id IS NULL
  `);
  await assertNoInvalidRows("Impact targets with invalid documents", Prisma.sql`
    SELECT it.id FROM "ImpactTarget" it
    LEFT JOIN "Document" d ON d.id = it."documentId" AND d."projectId" = it."projectId"
    WHERE it."documentId" IS NOT NULL AND d.id IS NULL
  `);
  await assertNoInvalidRows("Impact targets with invalid versions", Prisma.sql`
    SELECT it.id FROM "ImpactTarget" it
    LEFT JOIN "Version" v ON v.id = it."versionId"
    WHERE it."versionId" IS NOT NULL AND v.id IS NULL
  `);
  await assertNoInvalidRows("Impact suggestions without issues", Prisma.sql`
    SELECT s.id FROM "ImpactSuggestion" s
    LEFT JOIN "ImpactIssue" ii ON ii.id = s."issueId"
    WHERE ii.id IS NULL
  `);
  await assertNoInvalidRows("Impact suggestions with invalid projects", Prisma.sql`
    SELECT s.id FROM "ImpactSuggestion" s
    LEFT JOIN "Project" p ON p.id = s."projectId"
    WHERE p.id IS NULL
  `);
  await assertNoInvalidRows("Impact suggestions with invalid jobs", Prisma.sql`
    SELECT s.id FROM "ImpactSuggestion" s
    LEFT JOIN "Job" j ON j.id = s."createdJobId"
    WHERE s."createdJobId" IS NOT NULL AND j.id IS NULL
  `);
  await assertNoInvalidRows("Impact issue events without issues", Prisma.sql`
    SELECT e.id FROM "ImpactIssueEvent" e
    LEFT JOIN "ImpactIssue" ii ON ii.id = e."issueId"
    WHERE ii.id IS NULL
  `);
  await assertNoInvalidRows("Impact issue events with invalid projects", Prisma.sql`
    SELECT e.id FROM "ImpactIssueEvent" e
    LEFT JOIN "Project" p ON p.id = e."projectId"
    WHERE p.id IS NULL
  `);
  await assertNoInvalidRows("Conversation sessions without projects", Prisma.sql`
    SELECT cs.id FROM "ConversationSession" cs
    LEFT JOIN "Project" p ON p.id = cs."projectId"
    WHERE p.id IS NULL
  `);
  await assertNoInvalidRows("Novel import sessions without projects", Prisma.sql`
    SELECT ns.id FROM "NovelImportSession" ns
    LEFT JOIN "Project" p ON p.id = ns."projectId"
    WHERE p.id IS NULL
  `);
}

async function main(): Promise<void> {
  console.log("Reading legacy database...");
  const db = await readLegacyDatabase();
  console.log(`Found ${db.users.length} users, ${db.projects.length} projects, ${db.documents.length} documents`);

  console.log("Checking target database...");
  await assertEmptyTarget();

  console.log("Importing records...");
  await prisma.$transaction(async (tx) => {
    await importUsers(tx, db);
    await importTeams(tx, db);
    await importProjects(tx, db);
    await importDocuments(tx, db);
    await importOperationalRecords(tx, db);
  });

  console.log("Validating imported records...");
  await validateImportedDatabase();

  console.log("Import complete. Record counts:");
  await printCounts();
}

void main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
