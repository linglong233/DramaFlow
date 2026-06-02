import assert from "node:assert/strict";

import type {
  NovelImportSession,
  NovelImportJobInput,
  ProjectMemberPermissionsResponse,
  ProjectMemberSummary,
  SplitNovelImportChunkPayload,
  TeamPermissionTemplatesResponse,
  UpdateNovelImportChunkTitlePayload,
  UpdateProjectMemberPermissionsPayload,
  UpdateTeamPermissionTemplatesPayload,
} from "../src";
import {
  canTransitionVersionStatus,
  getSubmittedStatus,
  normalizeScriptContent,
  normalizeStoryboardContent,
  normalizeStoryboardShot,
  normalizeWorldBibleContent,
  resolveReviewRequired,
} from "../src";
import {
  canTransitionImpactIssueStatus,
  isActiveImpactIssueStatus,
} from "../src";
import {
  PROJECT_PERMISSIONS,
  getDefaultProjectRolePermissions,
  hasProjectPermission,
} from "../src";

assert.equal(resolveReviewRequired("required", "bypass"), false);
assert.equal(resolveReviewRequired("bypass", "required"), true);
assert.equal(resolveReviewRequired("required", "inherit"), true);
assert.equal(getSubmittedStatus(true), "submitted");
assert.equal(getSubmittedStatus(false), "approved");
assert.equal(canTransitionVersionStatus("pending_review", "approved"), true);
assert.equal(canTransitionVersionStatus("approved", "draft"), false);

// --- 影响依赖状态规则断言 ---

assert.equal(canTransitionImpactIssueStatus("open", "suggested"), true);
assert.equal(canTransitionImpactIssueStatus("ignored", "open"), true);
assert.equal(canTransitionImpactIssueStatus("resolved", "open"), true);
assert.equal(canTransitionImpactIssueStatus("ignored", "resolved"), false);
assert.equal(canTransitionImpactIssueStatus("accepted", "suggested"), true);
assert.equal(isActiveImpactIssueStatus("open"), true);
assert.equal(isActiveImpactIssueStatus("suggested"), true);
assert.equal(isActiveImpactIssueStatus("accepted"), true);
assert.equal(isActiveImpactIssueStatus("ignored"), false);
assert.equal(isActiveImpactIssueStatus("resolved"), false);

const normalizedLegacyShot = normalizeStoryboardShot({
  id: "shot-1",
  sceneId: "scene-1",
  shotLabel: "1A",
  framing: "Medium Shot",
  cameraMove: "push in",
  durationSeconds: 4,
  visualDescription: "A tense reveal at the apartment door.",
  dialogue: "Open the door.",
});

assert.equal(normalizedLegacyShot.framing, "MS");
assert.equal(normalizedLegacyShot.cameraMove, "dolly-in");

const normalizedRichShot = normalizeStoryboardShot({
  shotNumber: "2B",
  sceneNumber: 3,
  shotSize: "close-up",
  cameraMovement: "tilt down",
  duration: "5",
  visualDescription: "The detective studies the blood trail.",
  actionDescription: "She kneels and traces the stain with one gloved finger.",
  soundNote: "Distant siren and dripping water.",
  notes: "Hold for the reveal beat.",
});

assert.equal(normalizedRichShot.sceneId, "scene-3");
assert.equal(normalizedRichShot.shotLabel, "2B");
assert.equal(normalizedRichShot.framing, "CU");
assert.equal(normalizedRichShot.cameraMove, "tilt-down");
assert.equal(normalizedRichShot.actionDescription, "She kneels and traces the stain with one gloved finger.");
assert.equal(normalizedRichShot.notes, "Hold for the reveal beat.");

const normalizedContent = normalizeStoryboardContent({
  overview: "Storyboard overview",
  shots: [
    {
      shotLabel: "1A",
      sceneId: "scene-1",
      framing: "MS",
      cameraMove: "static",
      durationSeconds: 3,
      visualDescription: "Legacy shot",
    },
    {
      shotNumber: "1B",
      sceneNumber: 1,
      shotSize: "wide shot",
      cameraMovement: "tracking shot",
      duration: 6,
      visualDescription: "Richer shot",
      notes: "Match the storyboard frame.",
    },
  ],
});

assert.equal(normalizedContent.overview, "Storyboard overview");
assert.equal(normalizedContent.shots.length, 2);
assert.equal(normalizedContent.shots[1].framing, "LS");
assert.equal(normalizedContent.shots[1].cameraMove, "tracking");
assert.equal(normalizedContent.shots[1].notes, "Match the storyboard frame.");

const normalizedScript = normalizeScriptContent({
  logline: 42,
  premise: "A detective returns home.",
  characters: [{ name: "Lin", profile: "Lead", worldBibleCharId: 123 }, { foo: "bar" }],
  scenes: [
    {
      heading: "INT. APARTMENT - NIGHT",
      synopsis: "She enters the dark room.",
      characters: "Lin, Mother",
      dialogue: [{ speaker: "Lin", line: "Who's there?" }, "A distant crash"],
    },
    {
      id: "scene-2",
      title: "FLASHBACK",
      description: "A broken memory flashes.",
      dialogue: { bad: true },
    },
  ],
});

assert.equal(normalizedScript.logline, "42");
assert.equal(normalizedScript.characters.length, 1);
assert.deepEqual(normalizedScript.scenes[0].characters, ["Lin", "Mother"]);
assert.equal(normalizedScript.scenes[0].dialogue[1]?.line, "A distant crash");
assert.deepEqual(normalizedScript.scenes[1].dialogue, []);

const normalizedWorldBible = normalizeWorldBibleContent({
  characters: [
    {
      id: "char-1",
      name: "Lin",
      appearance: "Short hair",
      tags: "lead, detective",
      referenceImages: "https://example.com/a.png",
      costumes: { day: "coat", empty: "" },
    },
  ],
  locations: { invalid: true },
  voiceConfigs: [
    { characterId: "char-1", voiceId: "voice-1", voiceName: "Lead Voice", settings: { speed: "1.1" } },
    { voiceId: "missing-character" },
  ],
});

assert.deepEqual(normalizedWorldBible.characters[0]?.tags, ["lead", "detective"]);
assert.deepEqual(normalizedWorldBible.characters[0]?.referenceImages, ["https://example.com/a.png"]);
assert.equal(normalizedWorldBible.locations.length, 0);
assert.equal(normalizedWorldBible.voiceConfigs?.length, 1);
assert.equal(normalizedWorldBible.voiceConfigs?.[0]?.settings?.speed, 1.1);

// --- Label-based scene grouping tests ---

// Content-level grouping: 4 shots with unique sceneIds → regrouped by label prefix
const groupedContent = normalizeStoryboardContent({
  overview: "Group test",
  shots: [
    { sceneId: "scene-1", shotLabel: "1A", framing: "MS", cameraMove: "static", durationSeconds: 3, visualDescription: "A" },
    { sceneId: "scene-2", shotLabel: "1B", framing: "CU", cameraMove: "static", durationSeconds: 3, visualDescription: "B" },
    { sceneId: "scene-3", shotLabel: "2A", framing: "LS", cameraMove: "dolly-in", durationSeconds: 4, visualDescription: "C" },
    { sceneId: "scene-4", shotLabel: "2B", framing: "CU", cameraMove: "static", durationSeconds: 3, visualDescription: "D" },
  ],
});
assert.equal(groupedContent.shots[0].sceneId, "scene-1");
assert.equal(groupedContent.shots[1].sceneId, "scene-1");
assert.equal(groupedContent.shots[2].sceneId, "scene-2");
assert.equal(groupedContent.shots[3].sceneId, "scene-2");

// Backward compat: non-standard label with custom sceneId preserved
const customScene = normalizeStoryboardShot({
  sceneId: "kitchen-scene",
  framing: "MS",
  cameraMove: "static",
  durationSeconds: 3,
  visualDescription: "Custom scene",
}, 5);
assert.equal(customScene.sceneId, "kitchen-scene");

const sampleNovelImportJob: NovelImportJobInput = {
  action: "runSession",
  sessionId: "novel_session_1",
};
assert.equal(sampleNovelImportJob.action, "runSession");

const sampleNovelImportSession: NovelImportSession = {
  id: "novel_session_1",
  projectId: "project_1",
  createdBy: "user_1",
  status: "draft",
  stage: "setup",
  progress: 0,
  sourceText: "第一章\n她推开门。",
  options: {
    targetEpisodeCount: 12,
    episodeDurationMinutes: 2,
    genreStyle: "都市悬疑",
    adaptationFocus: "强化反转",
    llmConfigSource: "team",
  },
  chunks: [
    {
      index: 0,
      title: "第一章",
      text: "第一章\n她推开门。",
      status: "pending",
      scenes: [],
      confirmedAt: "2026-06-02T00:00:00.000Z",
      adjustedAt: "2026-06-02T00:00:00.000Z",
    },
  ],
  createdAt: "2026-05-20T00:00:00.000Z",
  updatedAt: "2026-05-20T00:00:00.000Z",
};
assert.equal(sampleNovelImportSession.chunks[0]?.status, "pending");

const sampleUpdateChunkTitlePayload: UpdateNovelImportChunkTitlePayload = {
  title: "第一章·修订",
};
assert.equal(sampleUpdateChunkTitlePayload.title, "第一章·修订");

const sampleSplitChunkPayload: SplitNovelImportChunkPayload = {
  splitAt: 12,
  nextTitle: "第二章",
};
assert.equal(sampleSplitChunkPayload.splitAt, 12);

// --- 权限解析导出断言 ---

assert.equal(PROJECT_PERMISSIONS.includes("version.review"), true);
assert.equal(getDefaultProjectRolePermissions("director").includes("version.review"), true);
assert.equal(hasProjectPermission({
  userId: "director-1",
  globalRole: "user",
  teamRoles: [],
  projectRoles: ["director"],
}, "version.review"), true);

// --- 权限契约类型断言 ---

const sampleMemberSummary: ProjectMemberSummary = {
  id: "pm_1",
  userId: "user_1",
  role: "writer",
  createdAt: "2026-05-21T00:00:00.000Z",
  displayName: "Writer",
  email: "writer@example.com",
  inheritedPermissions: ["project.view", "project.edit"],
  permissionOverride: { allow: ["version.review"], deny: [] },
  effectivePermissions: ["project.view", "project.edit", "version.review"],
};
assert.equal(sampleMemberSummary.effectivePermissions.includes("version.review"), true);

const sampleTemplatesPayload: UpdateTeamPermissionTemplatesPayload = {
  templates: {
    director: ["project.view", "version.review"],
    writer: ["project.view"],
  },
};
assert.equal(sampleTemplatesPayload.templates.writer?.[0], "project.view");

const sampleTemplatesResponse: TeamPermissionTemplatesResponse = {
  systemDefaults: {
    project_admin: PROJECT_PERMISSIONS,
    director: ["project.view", "project.edit", "version.review", "job.manage", "timeline.edit", "export.create"],
    writer: ["project.view", "project.edit"],
    artist: ["project.view", "project.edit"],
    reviewer: ["project.view", "version.review"],
    viewer: ["project.view"],
  },
  templates: sampleTemplatesPayload.templates,
  resolvedTemplates: [
    {
      role: "director",
      systemPermissions: ["project.view", "project.edit", "version.review", "job.manage", "timeline.edit", "export.create"],
      teamPermissions: ["project.view", "version.review"],
      effectivePermissions: ["project.view", "version.review"],
      locked: false,
    },
  ],
};
assert.equal(sampleTemplatesResponse.resolvedTemplates[0]?.role, "director");

const sampleOverridePayload: UpdateProjectMemberPermissionsPayload = {
  permissionOverride: { allow: ["job.manage"], deny: ["project.edit"] },
};
assert.equal(sampleOverridePayload.permissionOverride.deny[0], "project.edit");

const sampleMemberPermissions: ProjectMemberPermissionsResponse = {
  memberId: "pm_1",
  userId: "user_1",
  role: "writer",
  inheritedPermissions: ["project.view"],
  permissionOverride: sampleOverridePayload.permissionOverride,
  effectivePermissions: ["project.view", "job.manage"],
};
assert.equal(sampleMemberPermissions.memberId, "pm_1");

console.log("shared tests passed");