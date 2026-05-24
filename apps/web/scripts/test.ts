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

console.log("web tests passed");
