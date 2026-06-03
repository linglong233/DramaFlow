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

assertFileContains("use-production-overview.ts", useProductionOverviewTs, "ProductionStageKey");
assertFileContains("use-production-overview.ts", useProductionOverviewTs, "ProductionStageStatus");
assertFileContains("use-production-overview.ts", useProductionOverviewTs, '"project_info"');
assertFileContains("use-production-overview.ts", useProductionOverviewTs, '"world_bible"');
assertFileContains("use-production-overview.ts", useProductionOverviewTs, '"timeline_export"');
assertFileContains("use-production-overview.ts", useProductionOverviewTs, 'metadata?.source === "shot_composition"');
assertFileContains("use-production-overview.ts", useProductionOverviewTs, "normalizeStoryboardContent");
assertFileContains("use-production-overview.ts", useProductionOverviewTs, "normalizeWorldBibleContent");

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
assertFileContains("use-production-overview.ts", useProductionOverviewTs, "compositionNeedsActionCount");
assertFileContains("use-production-overview.ts", useProductionOverviewTs, 'status === "rejected"');
assertFileContains("use-production-overview.ts", useProductionOverviewTs, "count:");
assertFileContains("use-production-overview.ts", useProductionOverviewTs, "ready:");
assertFileContains("use-production-overview.ts", useProductionOverviewTs, "total:");
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

console.log("web tests passed");
