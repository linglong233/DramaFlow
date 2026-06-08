import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const globalsCss = readFileSync(join(scriptDir, "../app/globals.css"), "utf8");
const messagesTs = readFileSync(join(scriptDir, "../lib/i18n/messages.ts"), "utf8");
const candidateGridTsx = readFileSync(join(scriptDir, "../components/project-workspace/candidate-thumbnail-grid.tsx"), "utf8");
const candidateLightboxTsx = readFileSync(join(scriptDir, "../components/project-workspace/candidate-lightbox.tsx"), "utf8");
const shotDetailModalTsx = readFileSync(join(scriptDir, "../components/project-workspace/shot-detail-modal.tsx"), "utf8");
const storyboardWorkbenchTsx = readFileSync(join(scriptDir, "../components/project-workspace/storyboard-workbench.tsx"), "utf8");
const imageConfigTs = readFileSync(join(scriptDir, "../lib/image-config.ts"), "utf8");
const providerEntryFormTsx = readFileSync(join(scriptDir, "../components/provider-entry-form.tsx"), "utf8");
const profileSettingsPanelTsx = readFileSync(join(scriptDir, "../components/profile-settings-panel.tsx"), "utf8");
const teamSettingsPanelTsx = readFileSync(join(scriptDir, "../components/team-settings-panel.tsx"), "utf8");
const dashboardOverviewTsx = readFileSync(join(scriptDir, "../components/dashboard-overview.tsx"), "utf8");
const unifiedWorkspaceTsx = readFileSync(join(scriptDir, "../components/unified-workspace.tsx"), "utf8");
const novelImportWorkbenchTsx = readFileSync(join(scriptDir, "../components/project-workspace/novel-import-workbench.tsx"), "utf8");
const productionOverviewTsx = readFileSync(join(scriptDir, "../components/project-workspace/production-overview.tsx"), "utf8");
const useProductionOverviewTs = readFileSync(join(scriptDir, "../lib/hooks/use-production-overview.ts"), "utf8");
const productionCockpitModelTs = readFileSync(join(scriptDir, "../lib/hooks/production-cockpit-model.ts"), "utf8");
const synopsisTs = readFileSync(join(scriptDir, "../components/project-workspace/generation/generators/synopsis.ts"), "utf8");
const scriptTs = readFileSync(join(scriptDir, "../components/project-workspace/generation/generators/script.ts"), "utf8");

import {
  buildProductionOverviewModel,
  type ProductionStage,
} from "../lib/hooks/use-production-overview";
import type { ProjectWorkspacePayload } from "@dramaflow/shared";
import type { TranslateFn } from "../lib/i18n";

function assertRuleContains(selector: string, declarations: string[]) {
  const selectorStart = globalsCss.indexOf(`${selector} {`);
  assert.notEqual(selectorStart, -1, `Expected CSS rule for ${selector}`);

  const bodyStart = globalsCss.indexOf("{", selectorStart) + 1;
  const bodyEnd = globalsCss.indexOf("}", bodyStart);
  assert.notEqual(bodyStart, 0, `Expected CSS body start for ${selector}`);
  assert.notEqual(bodyEnd, -1, `Expected CSS body end for ${selector}`);

  const body = globalsCss.slice(bodyStart, bodyEnd).replace(/\s+/g, " ");
  for (const declaration of declarations) {
    assert.ok(
      body.includes(declaration),
      `Expected ${selector} to include "${declaration}"`,
    );
  }
}

function assertFileContains(filename: string, content: string, expected: string) {
  assert.ok(
    content.includes(expected),
    `Expected ${filename} to include "${expected}"`,
  );
}

function assertFileDoesNotContain(filename: string, content: string, forbidden: string) {
  assert.ok(
    !content.includes(forbidden),
    `Expected ${filename} not to include "${forbidden}"`,
  );
}

const testT: TranslateFn = ((key, params) => {
  const keyText = String(key);
  if (keyText.endsWith(".actions.viewProject")) return "查看项目";
  if (keyText.endsWith(".actions.viewDocument")) return "查看文档";
  if (keyText.endsWith(".actions.viewStoryboard")) return "查看分镜";
  if (keyText.endsWith(".actions.viewTimeline")) return "查看时间线";
  if (keyText.endsWith(".actions.viewExports")) return "查看导出";
  let text = keyText;
  for (const [name, value] of Object.entries(params ?? {})) {
    text = text.replaceAll(`{${name}}`, String(value));
  }
  return text;
}) as TranslateFn;

function baseProductionPayload(
  overrides: Partial<ProjectWorkspacePayload> = {},
): ProjectWorkspacePayload {
  return {
    team: {
      id: "team-1",
      name: "制作团队",
      defaultReviewPolicy: "required",
    },
    project: {
      id: "project-1",
      name: "夜色追光",
      description: "都市悬疑短剧",
      genre: "悬疑",
      coverUrl: "",
      status: "draft",
      reviewPolicyMode: "inherit",
      createdAt: "2026-06-03T00:00:00.000Z",
      updatedAt: "2026-06-03T00:00:00.000Z",
    },
    members: [],
    invites: [],
    pendingReviews: [],
    documents: [],
    versions: [],
    jobs: [],
    currentUserPermissions: [
      "project.view",
      "project.edit",
      "job.manage",
      "timeline.edit",
      "export.create",
    ],
    ...overrides,
  };
}

function getStage(
  payload: ProjectWorkspacePayload,
  key: ProductionStage["key"],
): ProductionStage {
  const model = buildProductionOverviewModel(payload, testT);
  const stage = model.stages.find((item) => item.key === key);
  assert.ok(stage, `Expected production stage ${key}`);
  return stage;
}

function payloadWithOneVideoAndComposition(
  status: "submitted" | "pending_review" | "rejected" | "approved",
): ProjectWorkspacePayload {
  return baseProductionPayload({
    documents: [
      {
        id: "storyboard-doc",
        projectId: "project-1",
        type: "storyboard",
        title: "分镜",
        currentVersionId: "storyboard-version",
      },
      {
        id: "video-doc",
        projectId: "project-1",
        type: "video",
        title: "镜头视频",
        shotId: "shot-1",
        currentVersionId: "video-version",
      },
    ],
    versions: [
      {
        id: "storyboard-version",
        documentId: "storyboard-doc",
        versionNumber: 1,
        status: "approved",
        title: "分镜版本",
        content: {
          overview: "一集分镜",
          shots: [
            {
              id: "shot-1",
              sceneId: "scene-1",
              shotLabel: "1-1",
              framing: "MS",
              cameraMove: "static",
              durationSeconds: 3,
              visualDescription: "主角看向窗外",
            },
          ],
          mediaBindings: {},
        },
        metadata: {},
        createdBy: "user-1",
        createdAt: "2026-06-03T00:00:00.000Z",
      },
      {
        id: "video-version",
        documentId: "video-doc",
        versionNumber: 1,
        status: "approved",
        title: "视频素材",
        content: { assetUrl: "https://example.com/video.mp4" },
        metadata: {},
        createdBy: "user-1",
        createdAt: "2026-06-03T00:00:00.000Z",
      },
      {
        id: "composition-version",
        documentId: "video-doc",
        versionNumber: 2,
        status,
        title: "合成视频",
        content: { assetUrl: "https://example.com/composition.mp4" },
        metadata: { source: "shot_composition" },
        createdBy: "user-1",
        createdAt: "2026-06-03T00:00:00.000Z",
      },
    ],
  });
}

function completeProductionPayload(): ProjectWorkspacePayload {
  return baseProductionPayload({
    pendingReviews: [],
    documents: [
      {
        id: "world-doc",
        projectId: "project-1",
        type: "world_bible",
        title: "世界观",
        currentVersionId: "world-version",
      },
      {
        id: "synopsis-doc",
        projectId: "project-1",
        type: "synopsis",
        title: "大纲",
        currentVersionId: "synopsis-version",
      },
      {
        id: "script-doc",
        projectId: "project-1",
        type: "script",
        title: "剧本",
        currentVersionId: "script-version",
      },
      {
        id: "storyboard-doc",
        projectId: "project-1",
        type: "storyboard",
        title: "分镜",
        currentVersionId: "storyboard-version",
      },
      {
        id: "image-doc",
        projectId: "project-1",
        type: "image",
        title: "镜头图片",
        shotId: "shot-1",
        currentVersionId: "image-version",
      },
      {
        id: "video-doc",
        projectId: "project-1",
        type: "video",
        title: "镜头视频",
        shotId: "shot-1",
        currentVersionId: "composition-version",
      },
      {
        id: "audio-doc",
        projectId: "project-1",
        type: "audio",
        title: "镜头语音",
        shotId: "shot-1",
        currentVersionId: "audio-version",
      },
    ],
    versions: [
      {
        id: "world-version",
        documentId: "world-doc",
        versionNumber: 1,
        status: "approved",
        title: "世界观版本",
        content: {
          characters: [{ id: "char-1", name: "主角", appearance: "黑色风衣", tags: [], referenceImages: [], sortOrder: 0 }],
          locations: [{ id: "loc-1", name: "天台", description: "夜晚天台", referenceImages: [], sortOrder: 0 }],
          styleGuide: { visualStyle: "冷色电影感", referenceImages: [] },
        },
        metadata: {},
        createdBy: "user-1",
        createdAt: "2026-06-04T00:00:00.000Z",
      },
      {
        id: "synopsis-version",
        documentId: "synopsis-doc",
        versionNumber: 1,
        status: "approved",
        title: "大纲版本",
        content: { logline: "追光", premise: "主角追查真相", characters: [], scenes: [{ id: "scene-1", heading: "天台", synopsis: "对峙", characters: ["主角"], dialogue: [] }] },
        metadata: {},
        createdBy: "user-1",
        createdAt: "2026-06-04T00:00:00.000Z",
      },
      {
        id: "script-version",
        documentId: "script-doc",
        versionNumber: 1,
        status: "approved",
        title: "剧本版本",
        content: { logline: "追光", premise: "主角追查真相", characters: [], scenes: [{ id: "scene-1", heading: "天台", synopsis: "对峙", characters: ["主角"], dialogue: [{ speaker: "主角", line: "真相就在这里。" }] }] },
        metadata: {},
        createdBy: "user-1",
        createdAt: "2026-06-04T00:00:00.000Z",
      },
      {
        id: "storyboard-version",
        documentId: "storyboard-doc",
        versionNumber: 1,
        status: "approved",
        title: "分镜版本",
        content: {
          overview: "一集分镜",
          shots: [
            {
              id: "shot-1",
              sceneId: "scene-1",
              shotLabel: "1-1",
              framing: "MS",
              cameraMove: "static",
              durationSeconds: 5,
              visualDescription: "主角站在天台边缘",
              dialogue: "真相就在这里。",
              imagePrompt: "cinematic rooftop",
              videoPrompt: "slow push in",
              characterIds: ["char-1"],
            },
          ],
          mediaBindings: {
            "shot-1": {
              imageVersionId: "image-version",
              videoVersionId: "composition-version",
              audioVersionId: "audio-version",
              subtitle: "真相就在这里。",
            },
          },
        },
        metadata: {},
        createdBy: "user-1",
        createdAt: "2026-06-04T00:00:00.000Z",
      },
      {
        id: "image-version",
        documentId: "image-doc",
        versionNumber: 1,
        status: "approved",
        title: "图片素材",
        content: { assetUrl: "https://example.com/image.png" },
        metadata: {},
        createdBy: "user-1",
        createdAt: "2026-06-04T00:00:00.000Z",
      },
      {
        id: "video-version",
        documentId: "video-doc",
        versionNumber: 1,
        status: "approved",
        title: "视频素材",
        content: { assetUrl: "https://example.com/video.mp4" },
        metadata: {},
        createdBy: "user-1",
        createdAt: "2026-06-04T00:00:00.000Z",
      },
      {
        id: "composition-version",
        documentId: "video-doc",
        versionNumber: 2,
        status: "approved",
        title: "合成视频",
        content: { assetUrl: "https://example.com/composition.mp4" },
        metadata: { source: "shot_composition" },
        createdBy: "user-1",
        createdAt: "2026-06-04T00:00:00.000Z",
      },
      {
        id: "audio-version",
        documentId: "audio-doc",
        versionNumber: 1,
        status: "approved",
        title: "语音素材",
        content: { assetUrl: "https://example.com/audio.mp3" },
        metadata: {},
        createdBy: "user-1",
        createdAt: "2026-06-04T00:00:00.000Z",
      },
    ],
    timeline: {
      id: "timeline-1",
      projectId: "project-1",
      duration: 5,
      fps: 30,
      resolution: "1080x1920",
      tracks: [
        {
          id: "track-video",
          type: "video",
          name: "视频",
          sortOrder: 0,
          isMuted: false,
          volume: 1,
          clips: [
            {
              id: "clip-1",
              startTime: 0,
              duration: 5,
              inPoint: 0,
              assetUrl: "https://example.com/composition.mp4",
              label: "1-1",
              shotId: "shot-1",
              source: "shot_composition",
              sortOrder: 0,
            },
          ],
        },
      ],
      createdAt: "2026-06-04T00:00:00.000Z",
      updatedAt: "2026-06-04T00:00:00.000Z",
    },
    exports: [
      {
        id: "export-1",
        projectId: "project-1",
        taskId: "job-export-1",
        format: "mp4",
        resolution: "1080x1920",
        fps: 30,
        status: "completed",
        outputUrl: "https://example.com/export.mp4",
        createdBy: "user-1",
        createdAt: "2026-06-04T00:00:00.000Z",
        completedAt: "2026-06-04T00:00:00.000Z",
      },
    ],
  });
}

function completeProductionPayloadWithPermissions(
  currentUserPermissions: ProjectWorkspacePayload["currentUserPermissions"],
): ProjectWorkspacePayload {
  return {
    ...completeProductionPayload(),
    currentUserPermissions,
  };
}

assertRuleContains(".app-main:has(.gen-root--conversational)", [
  "height: 100dvh;",
  "min-height: 0;",
  "overflow: hidden;",
]);

assertRuleContains(".gen-root--conversational .conv-layout", [
  "grid-template-rows: minmax(0, 1fr);",
  "overflow: hidden;",
]);

// Media terminology contract tests
assertFileContains("messages.ts", messagesTs, "useForShot");
assertFileContains("messages.ts", messagesTs, "inUse");
assertFileContains("messages.ts", messagesTs, "candidateStatus");
assertFileContains("messages.ts", messagesTs, "adoptAsBaseline");
assertFileContains("messages.ts", messagesTs, "setForShotSuccess");
assertFileContains("messages.ts", messagesTs, "baselineAdopted");

assertFileContains("candidate-thumbnail-grid.tsx", candidateGridTsx, "useI18n");
assertFileContains("candidate-thumbnail-grid.tsx", candidateGridTsx, "currentUseVersionId");
assertFileContains("candidate-thumbnail-grid.tsx", candidateGridTsx, "baselineVersionId");
assertFileContains("candidate-thumbnail-grid.tsx", candidateGridTsx, "useForShot");
assertFileContains("candidate-thumbnail-grid.tsx", candidateGridTsx, "adoptAsBaseline");
assertFileDoesNotContain("candidate-thumbnail-grid.tsx", candidateGridTsx, ">Select<");
assertFileDoesNotContain("candidate-thumbnail-grid.tsx", candidateGridTsx, ">Adopt<");

assertFileContains("candidate-lightbox.tsx", candidateLightboxTsx, "currentUseVersionId");
assertFileContains("candidate-lightbox.tsx", candidateLightboxTsx, "baselineVersionId");
assertFileContains("candidate-lightbox.tsx", candidateLightboxTsx, "useForShot");
assertFileContains("candidate-lightbox.tsx", candidateLightboxTsx, "adoptAsBaseline");

assertFileContains("shot-detail-modal.tsx", shotDetailModalTsx, "currentUseVersionId");
assertFileContains("shot-detail-modal.tsx", shotDetailModalTsx, "baselineVersionId");
assertFileContains("shot-detail-modal.tsx", shotDetailModalTsx, "onUseMediaVersionForShot");

assertFileContains("storyboard-workbench.tsx", storyboardWorkbenchTsx, "useMediaVersionForShot");
assertFileContains("storyboard-workbench.tsx", storyboardWorkbenchTsx, "setForShotSuccess");

// Video provider discovery tests
for (const provider of ["minimax", "volcengine", "vidu", "ali"]) {
  assertFileContains("image-config.ts", imageConfigTs, `"${provider}"`);
}

assertFileContains("image-config.ts", imageConfigTs, "getDefaultVideoProviderModel");
assertFileContains("image-config.ts", imageConfigTs, `case "minimax": return "video-01";`);
assertFileContains("image-config.ts", imageConfigTs, `case "volcengine": return "doubao-seedance-1-5-pro-251215";`);
assertFileContains("image-config.ts", imageConfigTs, `case "vidu": return "viduq3-turbo";`);
assertFileContains("image-config.ts", imageConfigTs, `case "ali": return "wan2.6-i2v-flash";`);

// Provider form model reset tests
assertFileContains("provider-entry-form.tsx", providerEntryFormTsx, "getDefaultImageProviderModel");
assertFileContains("provider-entry-form.tsx", providerEntryFormTsx, "getDefaultVideoProviderModel");
assertFileContains("provider-entry-form.tsx", providerEntryFormTsx, "model: type === \"video\"");
assertFileDoesNotContain("provider-entry-form.tsx", providerEntryFormTsx, "model: \"\",");

// Explicit add-video-provider type selection tests
assertFileContains("profile-settings-panel.tsx", profileSettingsPanelTsx, "selectedVideoProviderType");
assertFileContains("profile-settings-panel.tsx", profileSettingsPanelTsx, "createVideoProviderDraft(selectedVideoProviderType)");
assertFileContains("profile-settings-panel.tsx", profileSettingsPanelTsx, "VIDEO_PROVIDER_LABELS");

assertFileContains("team-settings-panel.tsx", teamSettingsPanelTsx, "selectedVideoProviderType");
assertFileContains("team-settings-panel.tsx", teamSettingsPanelTsx, "createVideoProviderDraft(selectedVideoProviderType)");
assertFileContains("team-settings-panel.tsx", teamSettingsPanelTsx, "VIDEO_PROVIDER_LABELS");

// Team API key masking behavior tests
assertFileContains("team-settings-panel.tsx", teamSettingsPanelTsx, "maskedApiKey={Boolean(draft.apiKey)}");
assertFileDoesNotContain("team-settings-panel.tsx", teamSettingsPanelTsx, "maskedApiKey\n                        />");

// Registration no longer creates teams automatically; dashboard must expose explicit team setup
assertFileContains("dashboard-overview.tsx", dashboardOverviewTsx, "apiFetch<TeamSummary[]>(\"/teams\")");
assertFileContains("dashboard-overview.tsx", dashboardOverviewTsx, "apiFetch<CreatedTeamPayload>(\"/teams\"");
assertFileContains("dashboard-overview.tsx", dashboardOverviewTsx, "dashboard.teamsOverview.inviteHint");
assertFileContains("dashboard-overview.tsx", dashboardOverviewTsx, "dashboard.noTeamProjectBlocked");
assertFileContains("messages.ts", messagesTs, "inviteHint");
assertFileContains("messages.ts", messagesTs, "如果你是加入已有团队");
assertFileContains("messages.ts", messagesTs, "If you are joining an existing team");

// 小说导入工作台集成检查
assertFileContains("unified-workspace.tsx", unifiedWorkspaceTsx, '"novelImport"');
assertFileContains("unified-workspace.tsx", unifiedWorkspaceTsx, "modeNovelImport");
assertFileContains("novel-import-workbench.tsx", novelImportWorkbenchTsx, "queryKeys.novelImportLatest");
assertFileContains("novel-import-workbench.tsx", novelImportWorkbenchTsx, "confirm-all");
assertFileContains("novel-import-workbench.tsx", novelImportWorkbenchTsx, "ignoredLatestSessionId");
assertFileContains("novel-import-workbench.tsx", novelImportWorkbenchTsx, "setIgnoredLatestSessionId(session.id)");
assertFileContains("novel-import-workbench.tsx", novelImportWorkbenchTsx, "session.id === ignoredLatestSessionId");
assertFileDoesNotContain("synopsis.ts", synopsisTs, '"novelImport"');
assertFileDoesNotContain("script.ts", scriptTs, '"novelImport"');

// 制作总览集成检查
assertFileContains("unified-workspace.tsx", unifiedWorkspaceTsx, '"overview" | "document" | "info" | "tasks" | "timeline"');
assertFileContains("unified-workspace.tsx", unifiedWorkspaceTsx, "modeOverview");
assertFileContains("unified-workspace.tsx", unifiedWorkspaceTsx, "ProductionOverview");
assertFileContains("unified-workspace.tsx", unifiedWorkspaceTsx, "handleProductionNavigate");
assertFileContains("unified-workspace.tsx", unifiedWorkspaceTsx, 'mode === "timeline" || mode === "overview"');

assertFileContains("production-cockpit-model.ts", productionCockpitModelTs, "ProductionStageKey");
assertFileContains("production-cockpit-model.ts", productionCockpitModelTs, "ProductionStageStatus");
assertFileContains("production-cockpit-model.ts", productionCockpitModelTs, '"project_info"');
assertFileContains("production-cockpit-model.ts", productionCockpitModelTs, '"world_bible"');
assertFileContains("production-cockpit-model.ts", productionCockpitModelTs, '"timeline_export"');
assertFileContains("production-cockpit-model.ts", productionCockpitModelTs, 'metadata?.source === "shot_composition"');
assertFileContains("production-cockpit-model.ts", productionCockpitModelTs, "normalizeStoryboardContent");
assertFileContains("production-cockpit-model.ts", productionCockpitModelTs, "normalizeWorldBibleContent");

// 驾驶舱模型文件检查
assertFileContains("production-cockpit-model.ts", productionCockpitModelTs, "ProductionHealth");
assertFileContains("production-cockpit-model.ts", productionCockpitModelTs, "ProductionRisk");
assertFileContains("production-cockpit-model.ts", productionCockpitModelTs, "ProductionShotRow");
assertFileContains("production-cockpit-model.ts", productionCockpitModelTs, "ProductionAction");
assertFileContains("production-cockpit-model.ts", productionCockpitModelTs, "buildProductionOverviewModel");

assertFileContains("production-overview.tsx", productionOverviewTsx, "useProductionOverview");
assertFileContains("production-overview.tsx", productionOverviewTsx, "onNavigate");
assertFileContains("production-overview.tsx", productionOverviewTsx, "production-overview__pipeline");

assertFileContains("messages.ts", messagesTs, "modeOverview");
assertFileContains("messages.ts", messagesTs, "productionOverview");
assertFileContains("messages.ts", messagesTs, "制作总览");
assertFileContains("messages.ts", messagesTs, "Production");

// 制作总览验收 - 静态断言
assertFileContains("globals.css", globalsCss, ".production-overview__title");
assertFileContains("globals.css", globalsCss, ".production-overview__stage-title");
assertFileContains("globals.css", globalsCss, ".production-overview__stage-metrics");
assertFileContains("globals.css", globalsCss, ".production-overview__blocker");
assertFileDoesNotContain("globals.css", globalsCss, ".production-overview__header-title");
assertFileDoesNotContain("globals.css", globalsCss, ".production-overview__stage-name");
assertFileDoesNotContain("globals.css", globalsCss, ".production-overview__blocker-item");
assertFileContains("production-overview.tsx", productionOverviewTsx, "stage.metrics.map");
assertFileContains("production-cockpit-model.ts", productionCockpitModelTs, "compositionNeedsActionCount");
assertFileContains("production-cockpit-model.ts", productionCockpitModelTs, 'status === "rejected"');
assertFileContains("production-cockpit-model.ts", productionCockpitModelTs, "count:");
assertFileContains("production-cockpit-model.ts", productionCockpitModelTs, "ready:");
assertFileContains("production-cockpit-model.ts", productionCockpitModelTs, "total:");
assertFileContains("messages.ts", messagesTs, "viewProject");
assertFileContains("messages.ts", messagesTs, "viewDocument");
assertFileContains("messages.ts", messagesTs, "viewStoryboard");
assertFileContains("messages.ts", messagesTs, "viewTimeline");
assertFileContains("messages.ts", messagesTs, "viewExports");

// 制作总览验收 - 模型计算断言
for (const status of ["submitted", "pending_review", "rejected"] as const) {
  const stage = getStage(payloadWithOneVideoAndComposition(status), "shot_composition");
  assert.equal(stage.status, "needs_action", `Expected ${status} composition to need action`);
}

const readOnlyWorldBibleStage = getStage(
  baseProductionPayload({
    currentUserPermissions: ["project.view"],
    documents: [
      {
        id: "world-doc",
        projectId: "project-1",
        type: "world_bible",
        title: "世界观",
        currentVersionId: "world-version",
      },
    ],
    versions: [
      {
        id: "world-version",
        documentId: "world-doc",
        versionNumber: 1,
        status: "approved",
        title: "世界观版本",
        content: {
          characters: [{ id: "char-1", name: "主角" }],
          locations: [],
          rules: [],
          tone: "",
          visualStyle: "",
        },
        metadata: {},
        createdBy: "user-1",
        createdAt: "2026-06-03T00:00:00.000Z",
      },
    ],
  }),
  "world_bible",
);
assert.equal(readOnlyWorldBibleStage.primaryAction, "查看文档");
assert.deepEqual(readOnlyWorldBibleStage.navigation, {
  mode: "document",
  documentType: "world_bible",
  subTab: "view",
});

const noJobManageImageStage = getStage(
  baseProductionPayload({
    currentUserPermissions: ["project.view", "project.edit"],
    documents: payloadWithOneVideoAndComposition("approved").documents,
    versions: payloadWithOneVideoAndComposition("approved").versions,
  }),
  "image",
);
assert.equal(noJobManageImageStage.primaryAction, "查看分镜");

const readOnlyTimelineStage = getStage(
  baseProductionPayload({
    currentUserPermissions: ["project.view"],
    documents: payloadWithOneVideoAndComposition("approved").documents,
    versions: payloadWithOneVideoAndComposition("approved").versions,
  }),
  "timeline_export",
);
assert.equal(readOnlyTimelineStage.primaryAction, "查看时间线");

// 驾驶舱模型计算断言
const emptyCockpit = buildProductionOverviewModel(baseProductionPayload(), testT);
assert.ok(emptyCockpit.health.score < 50, "Expected empty project health below 50");
assert.ok(emptyCockpit.readinessChecks.length >= 8, "Expected readiness checks");
assert.ok(emptyCockpit.risks.length > 0, "Expected empty project risks");
assert.equal(emptyCockpit.shotRows.length, 0);

const completeCockpit = buildProductionOverviewModel(completeProductionPayload(), testT);
assert.equal(completeCockpit.health.score, 100);
assert.equal(completeCockpit.health.status, "done");
assert.equal(completeCockpit.shotRows.length, 1);
assert.equal(completeCockpit.shotRows[0]?.image.state, "ready");
assert.equal(completeCockpit.shotRows[0]?.video.state, "ready");
assert.equal(completeCockpit.shotRows[0]?.audio.state, "ready");
assert.equal(completeCockpit.shotRows[0]?.subtitle.state, "ready");
assert.equal(completeCockpit.shotRows[0]?.composition.state, "ready");

const failedJobCockpit = buildProductionOverviewModel(
  baseProductionPayload({
    jobs: [
      {
        id: "job-failed",
        type: "image_generation",
        status: "failed",
        shotId: "shot-1",
        updatedAt: "2026-06-04T00:00:00.000Z",
        error: "provider failed",
      },
    ],
  }),
  testT,
);
assert.ok(failedJobCockpit.risks.some((risk) => risk.jobId === "job-failed" && risk.action.type === "retry_job"));
assert.equal(failedJobCockpit.health.status, "attention");

const missingImagePayload = completeProductionPayload();
missingImagePayload.documents = missingImagePayload.documents.filter((document) => document.id !== "image-doc");
missingImagePayload.versions = missingImagePayload.versions.filter((version) => version.documentId !== "image-doc");
const missingImageCockpit = buildProductionOverviewModel(missingImagePayload, testT);
assert.equal(missingImageCockpit.shotRows[0]?.image.state, "missing");
assert.ok(missingImageCockpit.actionQueue.some((action) => action.type === "batch_image" && action.shotIds?.includes("shot-1")));

const missingVideoPayload = completeProductionPayload();
missingVideoPayload.documents = missingVideoPayload.documents.filter((document) => document.id !== "video-doc");
missingVideoPayload.versions = missingVideoPayload.versions.filter((version) => version.documentId !== "video-doc");
const missingVideoCockpit = buildProductionOverviewModel(missingVideoPayload, testT);
assert.equal(missingVideoCockpit.shotRows[0]?.video.state, "missing");
assert.ok(missingVideoCockpit.actionQueue.some((action) => action.type === "batch_video" && action.shotIds?.includes("shot-1")));

const readOnlyCockpit = buildProductionOverviewModel(
  completeProductionPayloadWithPermissions(["project.view"]),
  testT,
);
assert.ok(readOnlyCockpit.actionQueue.every((action) => action.type === "navigate" || action.disabledReason));

// ── 组件结构断言 ──

// 驾驶舱组件结构断言
assertFileContains("production-overview.tsx", productionOverviewTsx, "projectId");
assertFileContains("production-overview.tsx", productionOverviewTsx, "useMutation");
assertFileContains("production-overview.tsx", productionOverviewTsx, "batch-image-jobs");
assertFileContains("production-overview.tsx", productionOverviewTsx, "batch-video-jobs");
assertFileContains("production-overview.tsx", productionOverviewTsx, "retry");
assertFileContains("production-overview.tsx", productionOverviewTsx, "production-overview__risk-queue");
assertFileContains("production-overview.tsx", productionOverviewTsx, "production-overview__matrix");
assertFileContains("production-overview.tsx", productionOverviewTsx, "production-overview__action-bar");

// UnifiedWorkspace 断言
assertFileContains("unified-workspace.tsx", unifiedWorkspaceTsx, "projectId={projectId}");
assertFileContains("unified-workspace.tsx", unifiedWorkspaceTsx, "onFeedback={setFeedback}");

// i18n 断言
assertFileContains("messages.ts", messagesTs, "health:");
assertFileContains("messages.ts", messagesTs, "risk:");
assertFileContains("messages.ts", messagesTs, "matrix:");
assertFileContains("messages.ts", messagesTs, "batchImages");
assertFileContains("messages.ts", messagesTs, "missing_video");

// CSS 断言
assertFileContains("globals.css", globalsCss, ".production-overview__health");
assertFileContains("globals.css", globalsCss, ".production-overview__risk-queue");
assertFileContains("globals.css", globalsCss, ".production-overview__matrix");
assertFileContains("globals.css", globalsCss, ".production-overview__action-bar");
assertFileContains("globals.css", globalsCss, ".production-overview__cell--ready");

console.log("web tests passed");
