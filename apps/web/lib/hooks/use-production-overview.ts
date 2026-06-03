/**
 * @fileoverview 制作总览派生 hook
 * @module web/lib/hooks/use-production-overview
 *
 * 从 ProjectWorkspacePayload 派生制作流水线 10 个阶段的状态，
 * 包含阶段统计、阻塞项、下一步建议等。
 */

import { useMemo } from "react";

import {
  normalizeScriptContent,
  normalizeStoryboardContent,
  normalizeWorldBibleContent,
  type DocumentType,
  type JobType,
  type ProjectWorkspacePayload,
} from "@dramaflow/shared";

import type { TranslateFn } from "../i18n";

// =============================================
// 类型定义
// =============================================

export type ProductionStageKey =
  | "project_info"
  | "world_bible"
  | "synopsis"
  | "script"
  | "storyboard"
  | "image"
  | "video"
  | "audio_subtitle"
  | "shot_composition"
  | "timeline_export";

export type ProductionStageStatus =
  | "not_started"
  | "in_progress"
  | "needs_action"
  | "blocked"
  | "completed";

export interface ProductionNavigationTarget {
  mode: "overview" | "document" | "info" | "tasks" | "timeline";
  documentType?: "world_bible" | "synopsis" | "script" | "storyboard";
  subTab?: "view" | "edit" | "generate" | "versions" | "novelImport";
}

export interface ProductionMetric {
  label: string;
  value: string;
}

export interface ProductionBlocker {
  id: string;
  stageKey: ProductionStageKey;
  title: string;
  detail: string;
  navigation: ProductionNavigationTarget;
}

export interface ProductionStage {
  key: ProductionStageKey;
  status: ProductionStageStatus;
  title: string;
  summary: string;
  detail: string;
  primaryAction: string;
  navigation: ProductionNavigationTarget;
  blockers: ProductionBlocker[];
  metrics: ProductionMetric[];
}

export interface ProductionOverviewModel {
  stages: ProductionStage[];
  summaryMetrics: ProductionMetric[];
  nextStage: ProductionStage | null;
  blockers: ProductionBlocker[];
}

// =============================================
// 内部类型
// =============================================

interface MediaVersionContent {
  assetUrl?: string;
  assetId?: string;
  mimeType?: string;
}

interface ShotProductionStats {
  shotCount: number;
  imageReadyCount: number;
  videoReadyCount: number;
  dialogueShotCount: number;
  audioReadyCount: number;
  subtitleReadyCount: number;
  compositionApprovedCount: number;
  compositionReviewCount: number;
  compositionNeedsActionCount: number;
}

// =============================================
// Helper 函数
// =============================================

/** 按 type 查找第一个匹配的文档 */
function getDocumentByType(
  payload: ProjectWorkspacePayload,
  type: DocumentType,
) {
  return payload.documents.find((d) => d.type === type);
}

/** 获取指定文档 ID 的当前版本（优先 currentVersionId） */
function getCurrentVersion(
  payload: ProjectWorkspacePayload,
  documentId?: string,
) {
  if (!documentId) return undefined;
  const doc = payload.documents.find((d) => d.id === documentId);
  if (!doc?.currentVersionId) return undefined;
  return payload.versions.find((v) => v.id === doc.currentVersionId);
}

/** 获取指定文档的所有版本 */
function getVersionsForDocument(
  payload: ProjectWorkspacePayload,
  documentId?: string,
) {
  if (!documentId) return [];
  return payload.versions.filter((v) => v.documentId === documentId);
}

/** 获取指定类型最近的 job（按 updatedAt 降序） */
function getLatestJobByType(
  payload: ProjectWorkspacePayload,
  type: JobType,
) {
  const jobs = payload.jobs.filter((j) => j.type === type);
  if (jobs.length === 0) return undefined;
  jobs.sort(
    (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
  );
  return jobs[0];
}

/** 获取指定类型的活跃 job（queued 或 running） */
function getActiveJobsByType(
  payload: ProjectWorkspacePayload,
  type: JobType,
) {
  return payload.jobs.filter(
    (j) => j.type === type && (j.status === "queued" || j.status === "running"),
  );
}

/** 获取指定类型的失败 job */
function getFailedJobsByType(
  payload: ProjectWorkspacePayload,
  type: JobType,
) {
  return payload.jobs.filter((j) => j.type === type && j.status === "failed");
}

/** 判断版本是否有可用的资产 URL */
function hasAssetUrl(version: { content: unknown } | undefined): boolean {
  if (!version || !version.content) return false;
  const c = version.content as MediaVersionContent | undefined;
  return Boolean(c?.assetUrl);
}

function hasPermission(
  payload: ProjectWorkspacePayload,
  permission: ProjectWorkspacePayload["currentUserPermissions"][number],
): boolean {
  return payload.currentUserPermissions.includes(permission);
}

function canGenerateDocuments(payload: ProjectWorkspacePayload): boolean {
  return hasPermission(payload, "project.edit") && hasPermission(payload, "job.manage");
}

function viewDocumentAction(t: TranslateFn): string {
  return t("projectWorkspace.productionOverview.actions.viewDocument" as Parameters<TranslateFn>[0]);
}

function viewStoryboardAction(t: TranslateFn): string {
  return t("projectWorkspace.productionOverview.actions.viewStoryboard" as Parameters<TranslateFn>[0]);
}

// =============================================
// 分镜与素材统计
// =============================================

function computeShotProductionStats(
  payload: ProjectWorkspacePayload,
): ShotProductionStats {
  // 获取当前分镜版本
  const storyboardDoc = getDocumentByType(payload, "storyboard");
  const storyboardVersion = getCurrentVersion(payload, storyboardDoc?.id);
  const storyboardContent = normalizeStoryboardContent(storyboardVersion?.content);

  const shots = storyboardContent.shots;
  const mediaBindings = storyboardContent.mediaBindings;

  let imageReadyCount = 0;
  let videoReadyCount = 0;
  let dialogueShotCount = 0;
  let audioReadyCount = 0;
  let subtitleReadyCount = 0;
  let compositionApprovedCount = 0;
  let compositionReviewCount = 0;
  let compositionNeedsActionCount = 0;

  for (const shot of shots) {
    const hasDialogue = Boolean(shot.dialogue?.trim());

    // 图片资产
    const imageDoc = payload.documents.find(
      (d) => d.type === "image" && d.shotId === shot.id,
    );
    const imageVersion = getCurrentVersion(payload, imageDoc?.id);
    if (imageDoc && hasAssetUrl(imageVersion)) {
      imageReadyCount++;
    }

    // 视频资产
    const videoDoc = payload.documents.find(
      (d) => d.type === "video" && d.shotId === shot.id,
    );
    const videoVersion = getCurrentVersion(payload, videoDoc?.id);
    if (videoDoc && hasAssetUrl(videoVersion)) {
      videoReadyCount++;
    }

    // 音频资产与字幕（仅含对白的镜头）
    if (hasDialogue) {
      dialogueShotCount++;

      const audioDoc = payload.documents.find(
        (d) => d.type === "audio" && d.shotId === shot.id,
      );
      const audioVersion = getCurrentVersion(payload, audioDoc?.id);
      if (audioDoc && hasAssetUrl(audioVersion)) {
        audioReadyCount++;
      }

      // 字幕可用：mediaBindings 有 subtitle 且非空，或 shot.dialogue 非空
      const subtitleText =
        mediaBindings[shot.id]?.subtitle?.trim() || shot.dialogue?.trim();
      if (subtitleText) {
        subtitleReadyCount++;
      }
    }

    // 镜头合成状态
    if (videoDoc) {
      const videoVersions = getVersionsForDocument(payload, videoDoc.id);
      const compositionApproved = videoVersions.some(
        (v) =>
          v.metadata?.source === "shot_composition" &&
          v.status === "approved" &&
          hasAssetUrl(v),
      );
      const compositionReview = videoVersions.some(
        (v) =>
          v.metadata?.source === "shot_composition" &&
          (v.status === "submitted" || v.status === "pending_review"),
      );
      const compositionNeedsAction = videoVersions.some(
        (v) =>
          v.metadata?.source === "shot_composition" &&
          (v.status === "submitted" || v.status === "pending_review" || v.status === "rejected"),
      );

      if (compositionApproved) compositionApprovedCount++;
      if (compositionReview) compositionReviewCount++;
      if (compositionNeedsAction) compositionNeedsActionCount++;
    }
  }

  return {
    shotCount: shots.length,
    imageReadyCount,
    videoReadyCount,
    dialogueShotCount,
    audioReadyCount,
    subtitleReadyCount,
    compositionApprovedCount,
    compositionReviewCount,
    compositionNeedsActionCount,
  };
}

// =============================================
// 10 个阶段派生
// =============================================

function buildStages(
  payload: ProjectWorkspacePayload,
  t: TranslateFn,
  stats: ShotProductionStats,
): ProductionStage[] {
  return [
    buildProjectInfoStage(payload, t),
    buildWorldBibleStage(payload, t),
    buildSynopsisStage(payload, t),
    buildScriptStage(payload, t),
    buildStoryboardStage(payload, t),
    buildImageStage(payload, t, stats),
    buildVideoStage(payload, t, stats),
    buildAudioSubtitleStage(payload, t, stats),
    buildShotCompositionStage(payload, t, stats),
    buildTimelineExportStage(payload, t, stats),
  ];
}

// ---------- 1. project_info ----------

function buildProjectInfoStage(
  payload: ProjectWorkspacePayload,
  t: TranslateFn,
): ProductionStage {
  const { name, description, genre } = payload.project;
  const hasName = Boolean(name?.trim());
  const hasDescOrGenre = Boolean(description?.trim()) || Boolean(genre?.trim());

  const status: ProductionStageStatus = (hasName && hasDescOrGenre) ? "completed" : "needs_action";
  const canEditProject = hasPermission(payload, "project.edit");

  return {
    key: "project_info",
    status,
    title: t("projectWorkspace.productionOverview.stages.projectInfo.title" as Parameters<TranslateFn>[0]),
    summary: t("projectWorkspace.productionOverview.stages.projectInfo.summary" as Parameters<TranslateFn>[0]),
    detail: status === "completed"
      ? t("projectWorkspace.productionOverview.stages.projectInfo.detailComplete" as Parameters<TranslateFn>[0])
      : t("projectWorkspace.productionOverview.stages.projectInfo.detailIncomplete" as Parameters<TranslateFn>[0]),
    primaryAction: canEditProject
      ? t("projectWorkspace.productionOverview.stages.projectInfo.action" as Parameters<TranslateFn>[0])
      : t("projectWorkspace.productionOverview.actions.viewProject" as Parameters<TranslateFn>[0]),
    navigation: { mode: "info" as const },
    blockers: [],
    metrics: [
      { label: t("projectWorkspace.productionOverview.stages.projectInfo.metricName" as Parameters<TranslateFn>[0]), value: hasName ? "1" : "0" },
      { label: t("projectWorkspace.productionOverview.stages.projectInfo.metricGenre" as Parameters<TranslateFn>[0]), value: genre?.trim() ? "1" : "0" },
    ],
  };
}

// ---------- 2. world_bible ----------

function buildWorldBibleStage(
  payload: ProjectWorkspacePayload,
  t: TranslateFn,
): ProductionStage {
  const doc = getDocumentByType(payload, "world_bible");
  const currentVersion = getCurrentVersion(payload, doc?.id);
  const worldBible = payload.worldBible ?? (currentVersion ? normalizeWorldBibleContent(currentVersion.content) : undefined);

  const hasCharacters = Boolean(worldBible?.characters?.length);
  const hasLocations = Boolean(worldBible?.locations?.length);
  const hasStyleGuide = Boolean(worldBible?.styleGuide);
  const hasAnyContent = hasCharacters || hasLocations || hasStyleGuide;

  let status: ProductionStageStatus;
  const hasCurrentVersion = Boolean(doc?.currentVersionId);
  const hasDraftVersion = Boolean(doc?.draftVersionId);
  const canEditProject = hasPermission(payload, "project.edit");

  if (hasCurrentVersion && hasAnyContent) {
    status = "completed";
  } else if (hasDraftVersion && !hasCurrentVersion) {
    status = "in_progress";
  } else if (doc && !hasAnyContent) {
    status = "needs_action";
  } else {
    status = "not_started";
  }

  return {
    key: "world_bible",
    status,
    title: t("projectWorkspace.productionOverview.stages.worldBible.title" as Parameters<TranslateFn>[0]),
    summary: t("projectWorkspace.productionOverview.stages.worldBible.summary" as Parameters<TranslateFn>[0]),
    detail: status === "completed"
      ? t("projectWorkspace.productionOverview.stages.worldBible.detailComplete" as Parameters<TranslateFn>[0], {
          count: String(
            (worldBible?.characters?.length ?? 0) +
            (worldBible?.locations?.length ?? 0) +
            (worldBible?.styleGuide ? 1 : 0),
          ),
        })
      : t("projectWorkspace.productionOverview.stages.worldBible.detailIncomplete" as Parameters<TranslateFn>[0]),
    primaryAction: canEditProject
      ? t("projectWorkspace.productionOverview.stages.worldBible.action" as Parameters<TranslateFn>[0])
      : viewDocumentAction(t),
    navigation: canEditProject
      ? { mode: "document", documentType: "world_bible", subTab: "edit" }
      : { mode: "document", documentType: "world_bible", subTab: "view" },
    blockers: [],
    metrics: [
      { label: t("projectWorkspace.productionOverview.stages.worldBible.metricCharacters" as Parameters<TranslateFn>[0]), value: String(worldBible?.characters?.length ?? 0) },
      { label: t("projectWorkspace.productionOverview.stages.worldBible.metricLocations" as Parameters<TranslateFn>[0]), value: String(worldBible?.locations?.length ?? 0) },
    ],
  };
}

// ---------- 3. synopsis ----------

function buildSynopsisStage(
  payload: ProjectWorkspacePayload,
  t: TranslateFn,
): ProductionStage {
  const doc = getDocumentByType(payload, "synopsis");
  const currentVersion = getCurrentVersion(payload, doc?.id);
  const synopsisJob = getLatestJobByType(payload, "synopsis_generation");
  const activeJobs = getActiveJobsByType(payload, "synopsis_generation");
  const failedJobs = getFailedJobsByType(payload, "synopsis_generation");

  const hasCurrentVersion = Boolean(doc?.currentVersionId);
  const content = currentVersion ? normalizeScriptContent(currentVersion.content) : undefined;
  const hasContent = Boolean(content?.logline?.trim()) || Boolean(content?.premise?.trim())
    || Boolean(content?.scenes?.length);

  let status: ProductionStageStatus;
  if (hasCurrentVersion && hasContent) {
    status = "completed";
  } else if (activeJobs.length > 0 || (doc?.draftVersionId && !hasCurrentVersion)) {
    status = "in_progress";
  } else if (failedJobs.length > 0 && !hasCurrentVersion) {
    status = "needs_action";
  } else {
    status = "not_started";
  }

  const canGenerate = canGenerateDocuments(payload);
  const navigation: ProductionNavigationTarget = hasCurrentVersion
    ? { mode: "document", documentType: "synopsis", subTab: "view" }
    : canGenerate
      ? { mode: "document", documentType: "synopsis", subTab: "generate" }
      : { mode: "document", documentType: "synopsis", subTab: "view" };
  const primaryAction = hasCurrentVersion || !canGenerate
    ? viewDocumentAction(t)
    : t("projectWorkspace.productionOverview.stages.synopsis.action" as Parameters<TranslateFn>[0]);

  return {
    key: "synopsis",
    status,
    title: t("projectWorkspace.productionOverview.stages.synopsis.title" as Parameters<TranslateFn>[0]),
    summary: t("projectWorkspace.productionOverview.stages.synopsis.summary" as Parameters<TranslateFn>[0]),
    detail: status === "completed"
      ? t("projectWorkspace.productionOverview.stages.synopsis.detailComplete" as Parameters<TranslateFn>[0])
      : synopsisJob?.status === "failed"
        ? t("projectWorkspace.productionOverview.stages.synopsis.detailFailed" as Parameters<TranslateFn>[0])
        : t("projectWorkspace.productionOverview.stages.synopsis.detailIncomplete" as Parameters<TranslateFn>[0]),
    primaryAction,
    navigation,
    blockers: [],
    metrics: [
      { label: t("projectWorkspace.productionOverview.stages.synopsis.metricScenes" as Parameters<TranslateFn>[0]), value: String(content?.scenes?.length ?? 0) },
    ],
  };
}

// ---------- 4. script ----------

function buildScriptStage(
  payload: ProjectWorkspacePayload,
  t: TranslateFn,
): ProductionStage {
  const doc = getDocumentByType(payload, "script");
  const currentVersion = getCurrentVersion(payload, doc?.id);
  const scriptJob = getLatestJobByType(payload, "script_generation");
  const activeJobs = getActiveJobsByType(payload, "script_generation");
  const failedJobs = getFailedJobsByType(payload, "script_generation");

  // 检查大纲是否缺失
  const synopsisDoc = getDocumentByType(payload, "synopsis");
  const synopsisVersion = getCurrentVersion(payload, synopsisDoc?.id);
  const synopsisMissing = !synopsisDoc || !synopsisVersion;

  const hasCurrentVersion = Boolean(doc?.currentVersionId);
  const content = currentVersion ? normalizeScriptContent(currentVersion.content) : undefined;
  const sceneCount = content?.scenes?.length ?? 0;

  let status: ProductionStageStatus;
  const blockers: ProductionBlocker[] = [];

  if (hasCurrentVersion && sceneCount > 0) {
    status = "completed";
  } else if (synopsisMissing) {
    status = "blocked";
    blockers.push({
      id: "script:blocker:synopsis_missing",
      stageKey: "script",
      title: t("projectWorkspace.productionOverview.stages.script.blockerSynopsisTitle" as Parameters<TranslateFn>[0]),
      detail: t("projectWorkspace.productionOverview.stages.script.blockerSynopsisDetail" as Parameters<TranslateFn>[0]),
      navigation: { mode: "document", documentType: "synopsis", subTab: "generate" },
    });
  } else if (activeJobs.length > 0 || (doc?.draftVersionId && !hasCurrentVersion)) {
    status = "in_progress";
  } else if (failedJobs.length > 0 && !hasCurrentVersion) {
    status = "needs_action";
  } else {
    status = "not_started";
  }

  const canGenerate = canGenerateDocuments(payload);
  const navigation: ProductionNavigationTarget = hasCurrentVersion
    ? { mode: "document", documentType: "script", subTab: "view" }
    : canGenerate
      ? { mode: "document", documentType: "script", subTab: "generate" }
      : { mode: "document", documentType: "script", subTab: "view" };
  const primaryAction = hasCurrentVersion || !canGenerate
    ? viewDocumentAction(t)
    : t("projectWorkspace.productionOverview.stages.script.action" as Parameters<TranslateFn>[0]);

  return {
    key: "script",
    status,
    title: t("projectWorkspace.productionOverview.stages.script.title" as Parameters<TranslateFn>[0]),
    summary: t("projectWorkspace.productionOverview.stages.script.summary" as Parameters<TranslateFn>[0]),
    detail: status === "completed"
      ? t("projectWorkspace.productionOverview.stages.script.detailComplete" as Parameters<TranslateFn>[0], { scenes: String(sceneCount) })
      : t("projectWorkspace.productionOverview.stages.script.detailIncomplete" as Parameters<TranslateFn>[0]),
    primaryAction,
    navigation,
    blockers,
    metrics: [
      { label: t("projectWorkspace.productionOverview.stages.script.metricScenes" as Parameters<TranslateFn>[0]), value: String(sceneCount) },
    ],
  };
}

// ---------- 5. storyboard ----------

function buildStoryboardStage(
  payload: ProjectWorkspacePayload,
  t: TranslateFn,
): ProductionStage {
  const doc = getDocumentByType(payload, "storyboard");
  const currentVersion = getCurrentVersion(payload, doc?.id);
  const storyboardJob = getLatestJobByType(payload, "storyboard_generation");
  const activeJobs = getActiveJobsByType(payload, "storyboard_generation");
  const failedJobs = getFailedJobsByType(payload, "storyboard_generation");

  // 检查剧本是否缺失
  const scriptDoc = getDocumentByType(payload, "script");
  const scriptVersion = getCurrentVersion(payload, scriptDoc?.id);
  const scriptMissing = !scriptDoc || !scriptVersion;

  const hasCurrentVersion = Boolean(doc?.currentVersionId);
  const content = currentVersion ? normalizeStoryboardContent(currentVersion.content) : undefined;
  const shotCount = content?.shots?.length ?? 0;

  let status: ProductionStageStatus;
  const blockers: ProductionBlocker[] = [];

  if (hasCurrentVersion && shotCount > 0) {
    status = "completed";
  } else if (scriptMissing) {
    status = "blocked";
    blockers.push({
      id: "storyboard:blocker:script_missing",
      stageKey: "storyboard",
      title: t("projectWorkspace.productionOverview.stages.storyboard.blockerScriptTitle" as Parameters<TranslateFn>[0]),
      detail: t("projectWorkspace.productionOverview.stages.storyboard.blockerScriptDetail" as Parameters<TranslateFn>[0]),
      navigation: { mode: "document", documentType: "script", subTab: "generate" },
    });
  } else if (activeJobs.length > 0) {
    status = "in_progress";
  } else if (failedJobs.length > 0 && shotCount === 0) {
    status = "needs_action";
  } else {
    status = "not_started";
  }

  const canGenerate = canGenerateDocuments(payload);
  const navigation: ProductionNavigationTarget = hasCurrentVersion && shotCount > 0
    ? { mode: "document", documentType: "storyboard", subTab: "view" }
    : canGenerate
      ? { mode: "document", documentType: "storyboard", subTab: "generate" }
      : { mode: "document", documentType: "storyboard", subTab: "view" };
  const primaryAction = (hasCurrentVersion && shotCount > 0) || !canGenerate
    ? viewStoryboardAction(t)
    : t("projectWorkspace.productionOverview.stages.storyboard.action" as Parameters<TranslateFn>[0]);

  return {
    key: "storyboard",
    status,
    title: t("projectWorkspace.productionOverview.stages.storyboard.title" as Parameters<TranslateFn>[0]),
    summary: t("projectWorkspace.productionOverview.stages.storyboard.summary" as Parameters<TranslateFn>[0]),
    detail: status === "completed"
      ? t("projectWorkspace.productionOverview.stages.storyboard.detailComplete" as Parameters<TranslateFn>[0], { shots: String(shotCount) })
      : storyboardJob?.status === "failed"
        ? t("projectWorkspace.productionOverview.stages.storyboard.detailFailed" as Parameters<TranslateFn>[0])
        : t("projectWorkspace.productionOverview.stages.storyboard.detailIncomplete" as Parameters<TranslateFn>[0]),
    primaryAction,
    navigation,
    blockers,
    metrics: [
      { label: t("projectWorkspace.productionOverview.stages.storyboard.metricShots" as Parameters<TranslateFn>[0]), value: String(shotCount) },
    ],
  };
}

// ---------- 6. image ----------

function buildImageStage(
  payload: ProjectWorkspacePayload,
  t: TranslateFn,
  stats: ShotProductionStats,
): ProductionStage {
  const activeImageJobs = getActiveJobsByType(payload, "image_generation");
  const failedImageJobs = getFailedJobsByType(payload, "image_generation");
  const storyboardDoc = getDocumentByType(payload, "storyboard");
  const storyboardMissing = !storyboardDoc || stats.shotCount === 0;

  let status: ProductionStageStatus;
  const blockers: ProductionBlocker[] = [];
  const canManageJobs = hasPermission(payload, "job.manage");

  if (storyboardMissing) {
    status = "blocked";
    blockers.push({
      id: "image:blocker:storyboard_missing",
      stageKey: "image",
      title: t("projectWorkspace.productionOverview.stages.image.blockerStoryboardTitle" as Parameters<TranslateFn>[0]),
      detail: t("projectWorkspace.productionOverview.stages.image.blockerStoryboardDetail" as Parameters<TranslateFn>[0]),
      navigation: { mode: "document", documentType: "storyboard", subTab: "generate" },
    });
  } else if (stats.imageReadyCount === stats.shotCount && stats.shotCount > 0) {
    status = "completed";
  } else if (activeImageJobs.length > 0 || (stats.imageReadyCount > 0 && stats.imageReadyCount < stats.shotCount)) {
    status = "in_progress";
  } else if (failedImageJobs.length > 0 || stats.imageReadyCount === 0) {
    status = "needs_action";
  } else {
    status = "not_started";
  }

  return {
    key: "image",
    status,
    title: t("projectWorkspace.productionOverview.stages.image.title" as Parameters<TranslateFn>[0]),
    summary: t("projectWorkspace.productionOverview.stages.image.summary" as Parameters<TranslateFn>[0]),
    detail: t("projectWorkspace.productionOverview.stages.image.detail" as Parameters<TranslateFn>[0], {
      ready: String(stats.imageReadyCount),
      total: String(stats.shotCount),
    }),
    primaryAction: canManageJobs
      ? t("projectWorkspace.productionOverview.stages.image.action" as Parameters<TranslateFn>[0])
      : viewStoryboardAction(t),
    navigation: { mode: "document", documentType: "storyboard", subTab: "view" },
    blockers,
    metrics: [
      { label: t("projectWorkspace.productionOverview.stages.image.metricReady" as Parameters<TranslateFn>[0]), value: `${stats.imageReadyCount}/${stats.shotCount}` },
    ],
  };
}

// ---------- 7. video ----------

function buildVideoStage(
  payload: ProjectWorkspacePayload,
  t: TranslateFn,
  stats: ShotProductionStats,
): ProductionStage {
  const activeVideoJobs = getActiveJobsByType(payload, "video_generation");
  const failedVideoJobs = getFailedJobsByType(payload, "video_generation");
  const storyboardDoc = getDocumentByType(payload, "storyboard");
  const storyboardMissing = !storyboardDoc || stats.shotCount === 0;

  let status: ProductionStageStatus;
  const blockers: ProductionBlocker[] = [];
  const canManageJobs = hasPermission(payload, "job.manage");

  if (storyboardMissing) {
    status = "blocked";
    blockers.push({
      id: "video:blocker:storyboard_missing",
      stageKey: "video",
      title: t("projectWorkspace.productionOverview.stages.video.blockerStoryboardTitle" as Parameters<TranslateFn>[0]),
      detail: t("projectWorkspace.productionOverview.stages.video.blockerStoryboardDetail" as Parameters<TranslateFn>[0]),
      navigation: { mode: "document", documentType: "storyboard", subTab: "generate" },
    });
  } else if (stats.videoReadyCount === stats.shotCount && stats.shotCount > 0) {
    status = "completed";
  } else if (activeVideoJobs.length > 0 || (stats.videoReadyCount > 0 && stats.videoReadyCount < stats.shotCount)) {
    status = "in_progress";
  } else if (failedVideoJobs.length > 0 || stats.videoReadyCount === 0) {
    status = "needs_action";
  } else {
    status = "not_started";
  }

  return {
    key: "video",
    status,
    title: t("projectWorkspace.productionOverview.stages.video.title" as Parameters<TranslateFn>[0]),
    summary: t("projectWorkspace.productionOverview.stages.video.summary" as Parameters<TranslateFn>[0]),
    detail: t("projectWorkspace.productionOverview.stages.video.detail" as Parameters<TranslateFn>[0], {
      ready: String(stats.videoReadyCount),
      total: String(stats.shotCount),
    }),
    primaryAction: canManageJobs
      ? t("projectWorkspace.productionOverview.stages.video.action" as Parameters<TranslateFn>[0])
      : viewStoryboardAction(t),
    navigation: { mode: "document", documentType: "storyboard", subTab: "view" },
    blockers,
    metrics: [
      { label: t("projectWorkspace.productionOverview.stages.video.metricReady" as Parameters<TranslateFn>[0]), value: `${stats.videoReadyCount}/${stats.shotCount}` },
    ],
  };
}

// ---------- 8. audio_subtitle ----------

function buildAudioSubtitleStage(
  payload: ProjectWorkspacePayload,
  t: TranslateFn,
  stats: ShotProductionStats,
): ProductionStage {
  const activeTtsJobs = getActiveJobsByType(payload, "tts_generation");
  const failedTtsJobs = getFailedJobsByType(payload, "tts_generation");

  let status: ProductionStageStatus;
  const blockers: ProductionBlocker[] = [];
  const canManageJobs = hasPermission(payload, "job.manage");
  if (stats.shotCount === 0) {
    status = "blocked";
    blockers.push({
      id: "audio_subtitle:blocker:storyboard_missing",
      stageKey: "audio_subtitle",
      title: t("projectWorkspace.productionOverview.stages.audioSubtitle.blockerStoryboardTitle" as Parameters<TranslateFn>[0]),
      detail: t("projectWorkspace.productionOverview.stages.audioSubtitle.blockerStoryboardDetail" as Parameters<TranslateFn>[0]),
      navigation: { mode: "document", documentType: "storyboard", subTab: "generate" },
    });
  } else if (stats.dialogueShotCount === 0) {
    // 没有含对白镜头 = completed（无需音频/字幕）
    status = "completed";
  } else if (
    stats.audioReadyCount === stats.dialogueShotCount &&
    stats.subtitleReadyCount === stats.dialogueShotCount
  ) {
    status = "completed";
  } else if (
    activeTtsJobs.length > 0 ||
    (stats.audioReadyCount > 0 && stats.audioReadyCount < stats.dialogueShotCount)
  ) {
    status = "in_progress";
  } else if (failedTtsJobs.length > 0 || (stats.audioReadyCount === 0 && stats.dialogueShotCount > 0)) {
    status = "needs_action";
  } else {
    status = "not_started";
  }

  return {
    key: "audio_subtitle",
    status,
    title: t("projectWorkspace.productionOverview.stages.audioSubtitle.title" as Parameters<TranslateFn>[0]),
    summary: t("projectWorkspace.productionOverview.stages.audioSubtitle.summary" as Parameters<TranslateFn>[0]),
    detail: t("projectWorkspace.productionOverview.stages.audioSubtitle.detail" as Parameters<TranslateFn>[0], {
      ready: String(stats.audioReadyCount),
      total: String(stats.dialogueShotCount),
    }),
    primaryAction: canManageJobs
      ? t("projectWorkspace.productionOverview.stages.audioSubtitle.action" as Parameters<TranslateFn>[0])
      : viewStoryboardAction(t),
    navigation: { mode: "document", documentType: "storyboard", subTab: "view" },
    blockers,
    metrics: [
      { label: t("projectWorkspace.productionOverview.stages.audioSubtitle.metricAudio" as Parameters<TranslateFn>[0]), value: `${stats.audioReadyCount}/${stats.dialogueShotCount}` },
      { label: t("projectWorkspace.productionOverview.stages.audioSubtitle.metricSubtitle" as Parameters<TranslateFn>[0]), value: `${stats.subtitleReadyCount}/${stats.dialogueShotCount}` },
    ],
  };
}

// ---------- 9. shot_composition ----------

function buildShotCompositionStage(
  payload: ProjectWorkspacePayload,
  t: TranslateFn,
  stats: ShotProductionStats,
): ProductionStage {
  const activeCompositionJobs = getActiveJobsByType(payload, "shot_composition");
  const failedCompositionJobs = getFailedJobsByType(payload, "shot_composition");
  const canManageJobs = hasPermission(payload, "job.manage");

  let status: ProductionStageStatus;
  const blockers: ProductionBlocker[] = [];

  // 没有视频资产 = blocked
  if (stats.videoReadyCount === 0) {
    status = "blocked";
    blockers.push({
      id: "shot_composition:blocker:video_missing",
      stageKey: "shot_composition",
      title: t("projectWorkspace.productionOverview.stages.shotComposition.blockerVideoTitle" as Parameters<TranslateFn>[0]),
      detail: t("projectWorkspace.productionOverview.stages.shotComposition.blockerVideoDetail" as Parameters<TranslateFn>[0]),
      navigation: { mode: "document", documentType: "storyboard", subTab: "view" },
    });
  } else if (failedCompositionJobs.length > 0 || stats.compositionNeedsActionCount > 0) {
    status = "needs_action";
  } else if (stats.compositionApprovedCount === stats.shotCount && stats.shotCount > 0) {
    status = "completed";
  } else if (
    activeCompositionJobs.length > 0 ||
    (stats.compositionApprovedCount > 0 && stats.compositionApprovedCount < stats.shotCount)
  ) {
    status = "in_progress";
  } else {
    status = "needs_action";
  }

  return {
    key: "shot_composition",
    status,
    title: t("projectWorkspace.productionOverview.stages.shotComposition.title" as Parameters<TranslateFn>[0]),
    summary: t("projectWorkspace.productionOverview.stages.shotComposition.summary" as Parameters<TranslateFn>[0]),
    detail: t("projectWorkspace.productionOverview.stages.shotComposition.detail" as Parameters<TranslateFn>[0], {
      approved: String(stats.compositionApprovedCount),
      review: String(stats.compositionReviewCount),
      total: String(stats.shotCount),
    }),
    primaryAction: canManageJobs
      ? t("projectWorkspace.productionOverview.stages.shotComposition.action" as Parameters<TranslateFn>[0])
      : viewStoryboardAction(t),
    navigation: { mode: "document", documentType: "storyboard", subTab: "view" },
    blockers,
    metrics: [
      { label: t("projectWorkspace.productionOverview.stages.shotComposition.metricApproved" as Parameters<TranslateFn>[0]), value: `${stats.compositionApprovedCount}/${stats.shotCount}` },
      { label: t("projectWorkspace.productionOverview.stages.shotComposition.metricReview" as Parameters<TranslateFn>[0]), value: String(stats.compositionReviewCount) },
    ],
  };
}

// ---------- 10. timeline_export ----------

function buildTimelineExportStage(
  payload: ProjectWorkspacePayload,
  t: TranslateFn,
  stats: ShotProductionStats,
): ProductionStage {
  const timeline = payload.timeline;
  const exports = payload.exports ?? [];
  const successfulExports = exports.filter((e) => e.status === "completed");
  const failedExports = exports.filter((e) => e.status === "failed");
  const activeExportJobs = getActiveJobsByType(payload, "export_video");

  const hasClips = Boolean(
    timeline?.tracks?.some((track) => track.clips?.length > 0),
  );

  const hasVideoAssets = stats.videoReadyCount > 0;
  const canEditTimeline = hasPermission(payload, "timeline.edit");
  const canCreateExport = hasPermission(payload, "export.create");

  let status: ProductionStageStatus;
  const blockers: ProductionBlocker[] = [];

  if (successfulExports.length > 0) {
    status = "completed";
  } else if (!hasVideoAssets) {
    status = "blocked";
    blockers.push({
      id: "timeline_export:blocker:video_assets_missing",
      stageKey: "timeline_export",
      title: t("projectWorkspace.productionOverview.stages.timelineExport.blockerVideoTitle" as Parameters<TranslateFn>[0]),
      detail: t("projectWorkspace.productionOverview.stages.timelineExport.blockerVideoDetail" as Parameters<TranslateFn>[0]),
      navigation: { mode: "document", documentType: "storyboard", subTab: "view" },
    });
  } else if (hasClips && successfulExports.length === 0) {
    if (failedExports.length > 0) {
      status = "needs_action";
    } else if (activeExportJobs.length > 0) {
      status = "in_progress";
    } else {
      status = "in_progress";
    }
  } else if (!hasClips && hasVideoAssets) {
    status = "not_started";
  } else {
    status = "not_started";
  }

  return {
    key: "timeline_export",
    status,
    title: t("projectWorkspace.productionOverview.stages.timelineExport.title" as Parameters<TranslateFn>[0]),
    summary: t("projectWorkspace.productionOverview.stages.timelineExport.summary" as Parameters<TranslateFn>[0]),
    detail: status === "completed"
      ? t("projectWorkspace.productionOverview.stages.timelineExport.detailComplete" as Parameters<TranslateFn>[0], { count: String(successfulExports.length) })
      : status === "needs_action"
        ? t("projectWorkspace.productionOverview.stages.timelineExport.detailFailed" as Parameters<TranslateFn>[0])
        : t("projectWorkspace.productionOverview.stages.timelineExport.detailIncomplete" as Parameters<TranslateFn>[0]),
    primaryAction: successfulExports.length > 0
      ? t("projectWorkspace.productionOverview.actions.viewExports" as Parameters<TranslateFn>[0])
      : (canEditTimeline || canCreateExport)
        ? t("projectWorkspace.productionOverview.stages.timelineExport.action" as Parameters<TranslateFn>[0])
        : t("projectWorkspace.productionOverview.actions.viewTimeline" as Parameters<TranslateFn>[0]),
    navigation: { mode: "timeline" },
    blockers,
    metrics: [
      { label: t("projectWorkspace.productionOverview.stages.timelineExport.metricExports" as Parameters<TranslateFn>[0]), value: String(successfulExports.length) },
      { label: t("projectWorkspace.productionOverview.stages.timelineExport.metricTracks" as Parameters<TranslateFn>[0]), value: String(timeline?.tracks?.length ?? 0) },
    ],
  };
}

// =============================================
// Summary 派生
// =============================================

function buildSummaryMetrics(
  payload: ProjectWorkspacePayload,
  stats: ShotProductionStats,
  t: TranslateFn,
): ProductionMetric[] {
  const activeJobs = payload.jobs.filter(
    (j) => j.status === "queued" || j.status === "running",
  );
  const failedJobs = payload.jobs.filter((j) => j.status === "failed");
  const successfulExports = (payload.exports ?? []).filter(
    (e) => e.status === "completed",
  );

  return [
    { label: t("projectWorkspace.productionOverview.summary.totalShots" as Parameters<TranslateFn>[0]), value: String(stats.shotCount) },
    { label: t("projectWorkspace.productionOverview.summary.imageReady" as Parameters<TranslateFn>[0]), value: String(stats.imageReadyCount) },
    { label: t("projectWorkspace.productionOverview.summary.videoReady" as Parameters<TranslateFn>[0]), value: String(stats.videoReadyCount) },
    { label: t("projectWorkspace.productionOverview.summary.activeJobs" as Parameters<TranslateFn>[0]), value: String(activeJobs.length) },
    { label: t("projectWorkspace.productionOverview.summary.failedJobs" as Parameters<TranslateFn>[0]), value: String(failedJobs.length) },
    { label: t("projectWorkspace.productionOverview.summary.successfulExports" as Parameters<TranslateFn>[0]), value: String(successfulExports.length) },
  ];
}

// =============================================
// 下一步选择
// =============================================

function pickNextStage(stages: ProductionStage[]): ProductionStage | null {
  // 1. 第一个 needs_action
  const needsAction = stages.find((s) => s.status === "needs_action");
  if (needsAction) return needsAction;

  // 2. 第一个 blocked
  const blocked = stages.find((s) => s.status === "blocked");
  if (blocked) return blocked;

  // 3. 第一个 not_started
  const notStarted = stages.find((s) => s.status === "not_started");
  if (notStarted) return notStarted;

  // 4. 第一个 in_progress
  const inProgress = stages.find((s) => s.status === "in_progress");
  if (inProgress) return inProgress;

  // 5. 全部完成时使用 timeline_export
  const timelineExport = stages.find((s) => s.key === "timeline_export");
  return timelineExport ?? null;
}

// =============================================
// Hook
// =============================================

export function buildProductionOverviewModel(
  payload: ProjectWorkspacePayload,
  t: TranslateFn,
): ProductionOverviewModel {
  const stats = computeShotProductionStats(payload);
  const stages = buildStages(payload, t, stats);
  const summaryMetrics = buildSummaryMetrics(payload, stats, t);
  const nextStage = pickNextStage(stages);
  const allBlockers = stages.flatMap((s) => s.blockers);

  return {
    stages,
    summaryMetrics,
    nextStage,
    blockers: allBlockers,
  };
}

/**
 * 从 ProjectWorkspacePayload 派生制作总览数据
 * @param payload - 项目工作区完整数据
 * @param t - 翻译函数
 * @returns 制作总览模型，包含阶段、摘要、下一步和阻塞项
 */
export function useProductionOverview(
  payload: ProjectWorkspacePayload,
  t: TranslateFn,
): ProductionOverviewModel {
  return useMemo(() => buildProductionOverviewModel(payload, t), [payload, t]);
}
