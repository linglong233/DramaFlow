-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "GlobalRole" AS ENUM ('platform_super_admin', 'user');

-- CreateEnum
CREATE TYPE "TeamRole" AS ENUM ('tenant_owner', 'tenant_admin', 'member');

-- CreateEnum
CREATE TYPE "ProjectRole" AS ENUM ('project_admin', 'director', 'writer', 'artist', 'reviewer', 'viewer');

-- CreateEnum
CREATE TYPE "ProjectPermission" AS ENUM ('project_view', 'project_edit', 'version_review', 'job_manage', 'timeline_edit', 'export_create', 'member_manage', 'permission_manage');

-- CreateEnum
CREATE TYPE "ReviewPolicyMode" AS ENUM ('inherit', 'required', 'bypass');

-- CreateEnum
CREATE TYPE "ProjectStatus" AS ENUM ('draft', 'in_progress', 'completed', 'archived');

-- CreateEnum
CREATE TYPE "DocumentType" AS ENUM ('synopsis', 'script', 'storyboard', 'image', 'video', 'audio', 'subtitle', 'world_bible');

-- CreateEnum
CREATE TYPE "VersionStatus" AS ENUM ('draft', 'submitted', 'pending_review', 'approved', 'rejected');

-- CreateEnum
CREATE TYPE "AnchorType" AS ENUM ('document', 'scene', 'shot', 'asset');

-- CreateEnum
CREATE TYPE "JobType" AS ENUM ('script_generation', 'synopsis_generation', 'storyboard_generation', 'image_generation', 'video_generation', 'rewrite_segment', 'tts_generation', 'export_video', 'shot_regenerate', 'novel_import', 'impact_suggestion', 'shot_composition');

-- CreateEnum
CREATE TYPE "JobStatus" AS ENUM ('queued', 'running', 'completed', 'failed');

-- CreateEnum
CREATE TYPE "JobPriority" AS ENUM ('low', 'normal', 'high');

-- CreateEnum
CREATE TYPE "AuditContentType" AS ENUM ('script', 'storyboard', 'image', 'video');

-- CreateEnum
CREATE TYPE "AuditAction" AS ENUM ('submitted', 'advanced', 'approved', 'rejected', 'adopted', 'restored', 'deleted');

-- CreateEnum
CREATE TYPE "NotificationType" AS ENUM ('task_completed', 'task_failed', 'review_submitted', 'review_approved', 'review_rejected', 'comment_added', 'comment_reply', 'member_invited');

-- CreateEnum
CREATE TYPE "ProjectInviteStatus" AS ENUM ('pending', 'accepted');

-- CreateEnum
CREATE TYPE "DependencyType" AS ENUM ('world_bible_to_synopsis', 'world_bible_to_script', 'world_bible_to_storyboard', 'synopsis_to_script', 'script_to_storyboard', 'storyboard_to_media', 'manual_inherited', 'manual_unlinked');

-- CreateEnum
CREATE TYPE "DependencyAnchorType" AS ENUM ('document', 'scene', 'shot', 'asset');

-- CreateEnum
CREATE TYPE "ImpactIssueStatus" AS ENUM ('open', 'suggested', 'accepted', 'ignored', 'resolved');

-- CreateEnum
CREATE TYPE "ImpactSeverity" AS ENUM ('low', 'medium', 'high');

-- CreateEnum
CREATE TYPE "ImpactTargetType" AS ENUM ('version', 'scene', 'shot', 'media_candidate', 'timeline_clip');

-- CreateEnum
CREATE TYPE "ImpactSuggestionStatus" AS ENUM ('generated', 'accepted', 'acceptance_reverted');

-- CreateEnum
CREATE TYPE "ImpactIssueEventType" AS ENUM ('created', 'ignored', 'reopened', 'suggestion_created', 'suggestion_accepted', 'acceptance_reverted', 'resolved', 'assigned');

-- CreateEnum
CREATE TYPE "BatchJobStatus" AS ENUM ('running', 'completed', 'partial_failure');

-- CreateEnum
CREATE TYPE "ExportFormat" AS ENUM ('mp4', 'mov', 'webm');

-- CreateEnum
CREATE TYPE "ExportStatus" AS ENUM ('pending', 'processing', 'completed', 'failed');

-- CreateEnum
CREATE TYPE "NovelImportStatus" AS ENUM ('draft', 'queued', 'running', 'needs_review', 'failed', 'cancelled', 'written');

-- CreateEnum
CREATE TYPE "NovelImportStage" AS ENUM ('setup', 'chunking', 'adaptationPlan', 'worldBible', 'synopsis', 'script', 'review', 'write');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "globalRole" "GlobalRole" NOT NULL,
    "llmConfig" JSONB,
    "imageGenerationConfig" JSONB,
    "imageProviders" JSONB,
    "videoProviders" JSONB,
    "defaultImageProvider" TEXT,
    "defaultVideoProvider" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RefreshToken" (
    "id" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "userId" TEXT NOT NULL,

    CONSTRAINT "RefreshToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Team" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "defaultReviewPolicy" "ReviewPolicyMode" NOT NULL,
    "createdBy" TEXT NOT NULL,
    "llmConfig" JSONB,
    "imageGenerationConfig" JSONB,
    "imageProviders" JSONB,
    "videoProviders" JSONB,
    "defaultImageProvider" TEXT,
    "defaultVideoProvider" TEXT,
    "projectRolePermissionTemplates" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Team_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TeamMember" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "role" "TeamRole" NOT NULL,
    "teamId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,

    CONSTRAINT "TeamMember_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TeamInviteLink" (
    "id" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "role" "TeamRole" NOT NULL,
    "maxUses" INTEGER NOT NULL,
    "uses" INTEGER NOT NULL,
    "expiresAt" TIMESTAMP(3),
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TeamInviteLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Project" (
    "id" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "genre" TEXT,
    "coverUrl" TEXT,
    "status" "ProjectStatus" NOT NULL,
    "reviewPolicyMode" "ReviewPolicyMode" NOT NULL,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Project_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProjectInvite" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "role" "ProjectRole" NOT NULL,
    "createdBy" TEXT NOT NULL,
    "status" "ProjectInviteStatus" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProjectInvite_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProjectMember" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "role" "ProjectRole" NOT NULL,
    "projectId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "permissionOverride" JSONB,

    CONSTRAINT "ProjectMember_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Document" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "type" "DocumentType" NOT NULL,
    "title" TEXT NOT NULL,
    "shotId" TEXT,
    "currentVersionId" TEXT,
    "draftVersionId" TEXT,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Document_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Version" (
    "id" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "versionNumber" INTEGER NOT NULL,
    "status" "VersionStatus" NOT NULL,
    "title" TEXT NOT NULL,
    "content" JSONB NOT NULL,
    "metadata" JSONB NOT NULL,
    "parentVersionId" TEXT,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Version_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Comment" (
    "id" TEXT NOT NULL,
    "versionId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "parentId" TEXT,
    "anchorType" "AnchorType" NOT NULL,
    "anchorId" TEXT,
    "resolved" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Comment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Job" (
    "id" TEXT NOT NULL,
    "type" "JobType" NOT NULL,
    "status" "JobStatus" NOT NULL,
    "projectId" TEXT NOT NULL,
    "documentId" TEXT,
    "shotId" TEXT,
    "input" JSONB NOT NULL,
    "result" JSONB,
    "error" TEXT,
    "progress" INTEGER,
    "retryCount" INTEGER,
    "maxRetries" INTEGER,
    "priority" "JobPriority",
    "cancelledAt" TIMESTAMP(3),
    "batchId" TEXT,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Job_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Asset" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "documentId" TEXT,
    "versionId" TEXT,
    "storageDriver" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "publicUrl" TEXT,
    "mimeType" TEXT NOT NULL,
    "sizeInBytes" INTEGER NOT NULL,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Asset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditConfig" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "contentType" "AuditContentType" NOT NULL,
    "reviewRequired" BOOLEAN NOT NULL,
    "autoApproveRoles" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AuditConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditRecord" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "versionId" TEXT NOT NULL,
    "documentType" "DocumentType" NOT NULL,
    "action" "AuditAction" NOT NULL,
    "reviewerId" TEXT NOT NULL,
    "comment" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "projectId" TEXT,
    "type" "NotificationType" NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "referenceId" TEXT,
    "referenceType" TEXT,
    "isRead" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BatchJobGroup" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "jobIds" TEXT[],
    "status" "BatchJobStatus" NOT NULL,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BatchJobGroup_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Timeline" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "duration" DOUBLE PRECISION NOT NULL,
    "fps" INTEGER NOT NULL,
    "resolution" TEXT NOT NULL,
    "tracks" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Timeline_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Export" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "resolution" TEXT NOT NULL,
    "fps" INTEGER NOT NULL,
    "bitrate" TEXT,
    "format" "ExportFormat" NOT NULL,
    "outputUrl" TEXT,
    "fileSize" INTEGER,
    "duration" DOUBLE PRECISION,
    "status" "ExportStatus" NOT NULL,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "Export_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VersionDependency" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "sourceDocumentId" TEXT,
    "sourceVersionId" TEXT,
    "sourceDocumentType" "DocumentType",
    "targetDocumentId" TEXT NOT NULL,
    "targetVersionId" TEXT NOT NULL,
    "targetDocumentType" "DocumentType" NOT NULL,
    "dependencyType" "DependencyType" NOT NULL,
    "targetAnchorType" "DependencyAnchorType",
    "targetAnchorId" TEXT,
    "sourceSnapshotHash" TEXT,
    "targetSnapshotHash" TEXT,
    "promptSnapshot" JSONB,
    "provider" TEXT,
    "model" TEXT,
    "configSource" TEXT,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VersionDependency_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ImpactIssue" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "dependencyId" TEXT,
    "sourceDocumentId" TEXT,
    "previousSourceVersionId" TEXT,
    "changedSourceVersionId" TEXT NOT NULL,
    "targetDocumentId" TEXT NOT NULL,
    "targetVersionId" TEXT NOT NULL,
    "dependencyType" "DependencyType" NOT NULL,
    "status" "ImpactIssueStatus" NOT NULL,
    "severity" "ImpactSeverity" NOT NULL,
    "title" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "assignedTo" TEXT,
    "latestSuggestionId" TEXT,
    "acceptedSuggestionId" TEXT,
    "ignoredBy" TEXT,
    "ignoredAt" TIMESTAMP(3),
    "ignoreReason" TEXT,
    "resolvedBy" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "resolveNote" TEXT,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ImpactIssue_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ImpactTarget" (
    "id" TEXT NOT NULL,
    "issueId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "targetType" "ImpactTargetType" NOT NULL,
    "documentId" TEXT,
    "versionId" TEXT,
    "anchorId" TEXT,
    "label" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ImpactTarget_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ImpactSuggestion" (
    "id" TEXT NOT NULL,
    "issueId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "status" "ImpactSuggestionStatus" NOT NULL,
    "summary" TEXT NOT NULL,
    "suggestedContent" JSONB,
    "promptSnapshot" JSONB,
    "provider" TEXT,
    "model" TEXT,
    "createdVersionId" TEXT,
    "createdDocumentId" TEXT,
    "createdJobId" TEXT,
    "acceptedBy" TEXT,
    "acceptedAt" TIMESTAMP(3),
    "revertedBy" TEXT,
    "revertedAt" TIMESTAMP(3),
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ImpactSuggestion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ImpactIssueEvent" (
    "id" TEXT NOT NULL,
    "issueId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "type" "ImpactIssueEventType" NOT NULL,
    "actorId" TEXT NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ImpactIssueEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConversationSession" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "messages" JSONB NOT NULL,
    "brief" JSONB NOT NULL,
    "dimensionStatus" JSONB NOT NULL,
    "targetDocType" TEXT NOT NULL,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ConversationSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NovelImportSession" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "createdBy" TEXT NOT NULL,
    "status" "NovelImportStatus" NOT NULL,
    "stage" "NovelImportStage" NOT NULL,
    "progress" INTEGER NOT NULL,
    "sourceText" TEXT NOT NULL,
    "options" JSONB NOT NULL,
    "chunks" JSONB NOT NULL,
    "adaptationPlan" TEXT,
    "worldBible" JSONB,
    "synopsis" TEXT,
    "scriptPreview" JSONB,
    "writeResult" JSONB,
    "lastJobId" TEXT,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NovelImportSession_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "RefreshToken_userId_idx" ON "RefreshToken"("userId");

-- CreateIndex
CREATE INDEX "RefreshToken_expiresAt_idx" ON "RefreshToken"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "Team_slug_key" ON "Team"("slug");

-- CreateIndex
CREATE INDEX "TeamMember_userId_idx" ON "TeamMember"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "TeamMember_teamId_userId_key" ON "TeamMember"("teamId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "TeamInviteLink_token_key" ON "TeamInviteLink"("token");

-- CreateIndex
CREATE INDEX "TeamInviteLink_teamId_idx" ON "TeamInviteLink"("teamId");

-- CreateIndex
CREATE INDEX "TeamInviteLink_expiresAt_idx" ON "TeamInviteLink"("expiresAt");

-- CreateIndex
CREATE INDEX "Project_teamId_idx" ON "Project"("teamId");

-- CreateIndex
CREATE INDEX "Project_status_idx" ON "Project"("status");

-- CreateIndex
CREATE INDEX "Project_updatedAt_idx" ON "Project"("updatedAt");

-- CreateIndex
CREATE INDEX "ProjectInvite_projectId_idx" ON "ProjectInvite"("projectId");

-- CreateIndex
CREATE INDEX "ProjectInvite_email_idx" ON "ProjectInvite"("email");

-- CreateIndex
CREATE INDEX "ProjectMember_userId_idx" ON "ProjectMember"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "ProjectMember_projectId_userId_key" ON "ProjectMember"("projectId", "userId");

-- CreateIndex
CREATE INDEX "Document_projectId_type_idx" ON "Document"("projectId", "type");

-- CreateIndex
CREATE INDEX "Document_shotId_idx" ON "Document"("shotId");

-- CreateIndex
CREATE INDEX "Document_currentVersionId_idx" ON "Document"("currentVersionId");

-- CreateIndex
CREATE INDEX "Document_draftVersionId_idx" ON "Document"("draftVersionId");

-- CreateIndex
CREATE INDEX "Version_documentId_status_createdAt_idx" ON "Version"("documentId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "Version_createdAt_idx" ON "Version"("createdAt");

-- CreateIndex
CREATE INDEX "Version_parentVersionId_idx" ON "Version"("parentVersionId");

-- CreateIndex
CREATE UNIQUE INDEX "Version_documentId_versionNumber_key" ON "Version"("documentId", "versionNumber");

-- CreateIndex
CREATE INDEX "Comment_versionId_parentId_idx" ON "Comment"("versionId", "parentId");

-- CreateIndex
CREATE INDEX "Comment_authorId_idx" ON "Comment"("authorId");

-- CreateIndex
CREATE INDEX "Job_projectId_status_updatedAt_idx" ON "Job"("projectId", "status", "updatedAt");

-- CreateIndex
CREATE INDEX "Job_status_priority_createdAt_idx" ON "Job"("status", "priority", "createdAt");

-- CreateIndex
CREATE INDEX "Job_documentId_idx" ON "Job"("documentId");

-- CreateIndex
CREATE INDEX "Job_shotId_idx" ON "Job"("shotId");

-- CreateIndex
CREATE INDEX "Job_batchId_idx" ON "Job"("batchId");

-- CreateIndex
CREATE INDEX "Asset_projectId_idx" ON "Asset"("projectId");

-- CreateIndex
CREATE INDEX "Asset_documentId_idx" ON "Asset"("documentId");

-- CreateIndex
CREATE INDEX "Asset_versionId_idx" ON "Asset"("versionId");

-- CreateIndex
CREATE UNIQUE INDEX "AuditConfig_projectId_contentType_key" ON "AuditConfig"("projectId", "contentType");

-- CreateIndex
CREATE INDEX "AuditRecord_projectId_createdAt_idx" ON "AuditRecord"("projectId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditRecord_versionId_idx" ON "AuditRecord"("versionId");

-- CreateIndex
CREATE INDEX "Notification_userId_isRead_createdAt_idx" ON "Notification"("userId", "isRead", "createdAt");

-- CreateIndex
CREATE INDEX "Notification_projectId_idx" ON "Notification"("projectId");

-- CreateIndex
CREATE INDEX "BatchJobGroup_projectId_createdAt_idx" ON "BatchJobGroup"("projectId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Timeline_projectId_key" ON "Timeline"("projectId");

-- CreateIndex
CREATE INDEX "Export_projectId_createdAt_idx" ON "Export"("projectId", "createdAt");

-- CreateIndex
CREATE INDEX "Export_taskId_idx" ON "Export"("taskId");

-- CreateIndex
CREATE INDEX "VersionDependency_projectId_idx" ON "VersionDependency"("projectId");

-- CreateIndex
CREATE INDEX "VersionDependency_sourceVersionId_idx" ON "VersionDependency"("sourceVersionId");

-- CreateIndex
CREATE INDEX "VersionDependency_targetVersionId_idx" ON "VersionDependency"("targetVersionId");

-- CreateIndex
CREATE INDEX "VersionDependency_targetDocumentId_idx" ON "VersionDependency"("targetDocumentId");

-- CreateIndex
CREATE INDEX "ImpactIssue_projectId_status_updatedAt_idx" ON "ImpactIssue"("projectId", "status", "updatedAt");

-- CreateIndex
CREATE INDEX "ImpactIssue_targetVersionId_idx" ON "ImpactIssue"("targetVersionId");

-- CreateIndex
CREATE INDEX "ImpactIssue_changedSourceVersionId_idx" ON "ImpactIssue"("changedSourceVersionId");

-- CreateIndex
CREATE INDEX "ImpactTarget_issueId_idx" ON "ImpactTarget"("issueId");

-- CreateIndex
CREATE INDEX "ImpactTarget_projectId_idx" ON "ImpactTarget"("projectId");

-- CreateIndex
CREATE INDEX "ImpactSuggestion_issueId_idx" ON "ImpactSuggestion"("issueId");

-- CreateIndex
CREATE INDEX "ImpactSuggestion_projectId_idx" ON "ImpactSuggestion"("projectId");

-- CreateIndex
CREATE INDEX "ImpactSuggestion_createdJobId_idx" ON "ImpactSuggestion"("createdJobId");

-- CreateIndex
CREATE INDEX "ImpactIssueEvent_issueId_createdAt_idx" ON "ImpactIssueEvent"("issueId", "createdAt");

-- CreateIndex
CREATE INDEX "ImpactIssueEvent_projectId_idx" ON "ImpactIssueEvent"("projectId");

-- CreateIndex
CREATE INDEX "ConversationSession_projectId_updatedAt_idx" ON "ConversationSession"("projectId", "updatedAt");

-- CreateIndex
CREATE INDEX "ConversationSession_createdBy_idx" ON "ConversationSession"("createdBy");

-- CreateIndex
CREATE INDEX "NovelImportSession_projectId_updatedAt_idx" ON "NovelImportSession"("projectId", "updatedAt");

-- CreateIndex
CREATE INDEX "NovelImportSession_createdBy_idx" ON "NovelImportSession"("createdBy");

-- CreateIndex
CREATE INDEX "NovelImportSession_lastJobId_idx" ON "NovelImportSession"("lastJobId");

-- AddForeignKey
ALTER TABLE "RefreshToken" ADD CONSTRAINT "RefreshToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeamMember" ADD CONSTRAINT "TeamMember_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeamMember" ADD CONSTRAINT "TeamMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeamInviteLink" ADD CONSTRAINT "TeamInviteLink_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Project" ADD CONSTRAINT "Project_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectInvite" ADD CONSTRAINT "ProjectInvite_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectMember" ADD CONSTRAINT "ProjectMember_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectMember" ADD CONSTRAINT "ProjectMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Document" ADD CONSTRAINT "Document_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Version" ADD CONSTRAINT "Version_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "Document"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Version" ADD CONSTRAINT "Version_parentVersionId_fkey" FOREIGN KEY ("parentVersionId") REFERENCES "Version"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Comment" ADD CONSTRAINT "Comment_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "Version"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Comment" ADD CONSTRAINT "Comment_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "Comment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Job" ADD CONSTRAINT "Job_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Asset" ADD CONSTRAINT "Asset_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditConfig" ADD CONSTRAINT "AuditConfig_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditRecord" ADD CONSTRAINT "AuditRecord_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditRecord" ADD CONSTRAINT "AuditRecord_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "Version"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BatchJobGroup" ADD CONSTRAINT "BatchJobGroup_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Timeline" ADD CONSTRAINT "Timeline_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Export" ADD CONSTRAINT "Export_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VersionDependency" ADD CONSTRAINT "VersionDependency_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImpactIssue" ADD CONSTRAINT "ImpactIssue_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImpactTarget" ADD CONSTRAINT "ImpactTarget_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImpactTarget" ADD CONSTRAINT "ImpactTarget_issueId_fkey" FOREIGN KEY ("issueId") REFERENCES "ImpactIssue"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImpactSuggestion" ADD CONSTRAINT "ImpactSuggestion_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImpactSuggestion" ADD CONSTRAINT "ImpactSuggestion_issueId_fkey" FOREIGN KEY ("issueId") REFERENCES "ImpactIssue"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImpactIssueEvent" ADD CONSTRAINT "ImpactIssueEvent_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImpactIssueEvent" ADD CONSTRAINT "ImpactIssueEvent_issueId_fkey" FOREIGN KEY ("issueId") REFERENCES "ImpactIssue"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConversationSession" ADD CONSTRAINT "ConversationSession_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NovelImportSession" ADD CONSTRAINT "NovelImportSession_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

