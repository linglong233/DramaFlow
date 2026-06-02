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
const synopsisTs = readFileSync(join(scriptDir, "../components/project-workspace/generation/generators/synopsis.ts"), "utf8");
const scriptTs = readFileSync(join(scriptDir, "../components/project-workspace/generation/generators/script.ts"), "utf8");

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
assertFileDoesNotContain("synopsis.ts", synopsisTs, '"novelImport"');
assertFileDoesNotContain("script.ts", scriptTs, '"novelImport"');

console.log("web tests passed");
