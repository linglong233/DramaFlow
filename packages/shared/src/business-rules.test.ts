/**
 * @fileoverview 业务规则单元测试
 * @module shared/business-rules.test
 *
 * 验证审核策略解析、版本状态流转、权限判断等核心业务规则的正确性。
 */

import test from "node:test";
import assert from "node:assert/strict";

import type { AccessContext, AuditConfigRecord } from "./domain";
import {
  advanceToReview,
  canAdoptVersion,
  canAutoApprove,
  canChangeTeamMemberRole,
  canDeleteVersion,
  canEditProject,
  canEditTimeline,
  canExportProject,
  canManageJobs,
  canManageTenant,
  canRemoveTeamMember,
  canRestoreVersion,
  canReviewProject,
  canTransitionVersionStatus,
  getNextVersionNumber,
  getSubmittedStatus,
  resolveContentReviewRequired,
  resolveReviewRequired,
  validateVersionContent,
} from "./business-rules";
import {
  PROJECT_PERMISSIONS,
  resolveProjectPermissions,
  hasProjectPermission,
  getDefaultProjectRolePermissions,
  normalizePermissionOverride,
} from "./project-permissions";

// =============================================
// resolveReviewRequired
// =============================================

test("resolveReviewRequired respects project override", () => {
  assert.equal(resolveReviewRequired("required", "bypass"), false);
  assert.equal(resolveReviewRequired("bypass", "required"), true);
  assert.equal(resolveReviewRequired("required", "inherit"), true);
  assert.equal(resolveReviewRequired("bypass", "inherit"), false);
  assert.equal(resolveReviewRequired("required", "required"), true);
  assert.equal(resolveReviewRequired("bypass", "bypass"), false);
});

// =============================================
// getSubmittedStatus
// =============================================

test("getSubmittedStatus returns submitted when review required", () => {
  assert.equal(getSubmittedStatus(true), "submitted");
  assert.equal(getSubmittedStatus(false), "approved");
});

// =============================================
// advanceToReview
// =============================================

test("advanceToReview returns pending_review from submitted", () => {
  assert.equal(advanceToReview("submitted"), "pending_review");
});

test("advanceToReview returns null for non-submitted states", () => {
  assert.equal(advanceToReview("draft"), null);
  assert.equal(advanceToReview("pending_review"), null);
  assert.equal(advanceToReview("approved"), null);
  assert.equal(advanceToReview("rejected"), null);
});

// =============================================
// canTransitionVersionStatus — full matrix
// =============================================

test("version transition matrix: draft", () => {
  assert.equal(canTransitionVersionStatus("draft", "submitted"), true);
  assert.equal(canTransitionVersionStatus("draft", "pending_review"), true);
  assert.equal(canTransitionVersionStatus("draft", "approved"), true);
  assert.equal(canTransitionVersionStatus("draft", "rejected"), false);
  assert.equal(canTransitionVersionStatus("draft", "draft"), false);
});

test("version transition matrix: submitted", () => {
  assert.equal(canTransitionVersionStatus("submitted", "pending_review"), true);
  assert.equal(canTransitionVersionStatus("submitted", "approved"), true);
  assert.equal(canTransitionVersionStatus("submitted", "rejected"), true);
  assert.equal(canTransitionVersionStatus("submitted", "draft"), false);
  assert.equal(canTransitionVersionStatus("submitted", "submitted"), false);
});

test("version transition matrix: pending_review", () => {
  assert.equal(canTransitionVersionStatus("pending_review", "approved"), true);
  assert.equal(canTransitionVersionStatus("pending_review", "rejected"), true);
  assert.equal(canTransitionVersionStatus("pending_review", "draft"), false);
  assert.equal(canTransitionVersionStatus("pending_review", "submitted"), false);
  assert.equal(canTransitionVersionStatus("pending_review", "pending_review"), false);
});

test("version transition matrix: approved (terminal)", () => {
  assert.equal(canTransitionVersionStatus("approved", "draft"), false);
  assert.equal(canTransitionVersionStatus("approved", "submitted"), false);
  assert.equal(canTransitionVersionStatus("approved", "pending_review"), false);
  assert.equal(canTransitionVersionStatus("approved", "approved"), false);
  assert.equal(canTransitionVersionStatus("approved", "rejected"), false);
});

test("version transition matrix: rejected", () => {
  assert.equal(canTransitionVersionStatus("rejected", "draft"), true);
  assert.equal(canTransitionVersionStatus("rejected", "submitted"), true);
  assert.equal(canTransitionVersionStatus("rejected", "pending_review"), true);
  assert.equal(canTransitionVersionStatus("rejected", "approved"), false);
  assert.equal(canTransitionVersionStatus("rejected", "rejected"), false);
});

// =============================================
// canAdoptVersion
// =============================================

test("canAdoptVersion only allows approved", () => {
  assert.equal(canAdoptVersion("approved"), true);
  assert.equal(canAdoptVersion("draft"), false);
  assert.equal(canAdoptVersion("submitted"), false);
  assert.equal(canAdoptVersion("pending_review"), false);
  assert.equal(canAdoptVersion("rejected"), false);
});

// =============================================
// canRestoreVersion
// =============================================

test("canRestoreVersion allows non-draft", () => {
  assert.equal(canRestoreVersion("draft"), false);
  assert.equal(canRestoreVersion("submitted"), true);
  assert.equal(canRestoreVersion("pending_review"), true);
  assert.equal(canRestoreVersion("approved"), true);
  assert.equal(canRestoreVersion("rejected"), true);
});

// =============================================
// canDeleteVersion
// =============================================

test("canDeleteVersion only allows draft", () => {
  assert.equal(canDeleteVersion("draft"), true);
  assert.equal(canDeleteVersion("submitted"), false);
  assert.equal(canDeleteVersion("pending_review"), false);
  assert.equal(canDeleteVersion("approved"), false);
  assert.equal(canDeleteVersion("rejected"), false);
});

// =============================================
// validateVersionContent
// =============================================

test("validateVersionContent rejects null/undefined", () => {
  assert.equal(validateVersionContent("script", null), "Content is required");
  assert.equal(validateVersionContent("script", undefined), "Content is required");
});

test("validateVersionContent accepts valid script content", () => {
  assert.equal(validateVersionContent("script", { scenes: [] }), null);
});

test("validateVersionContent rejects script without scenes", () => {
  assert.equal(validateVersionContent("script", { logline: "test" }), "Script content must include a scenes array");
});

test("validateVersionContent accepts valid storyboard content", () => {
  assert.equal(validateVersionContent("storyboard", { shots: [] }), null);
});

test("validateVersionContent rejects storyboard without shots", () => {
  assert.equal(validateVersionContent("storyboard", { overview: "test" }), "Storyboard content must include a shots array");
});

test("validateVersionContent accepts any non-null content for other types", () => {
  assert.equal(validateVersionContent("world_bible", { characters: [] }), null);
  assert.equal(validateVersionContent("image", { prompt: "test" }), null);
});

// =============================================
// getNextVersionNumber
// =============================================

test("getNextVersionNumber returns 1 for empty list", () => {
  assert.equal(getNextVersionNumber([]), 1);
});

test("getNextVersionNumber increments from max", () => {
  assert.equal(getNextVersionNumber([{ versionNumber: 3 }, { versionNumber: 1 }, { versionNumber: 5 }]), 6);
});

test("getNextVersionNumber handles single version", () => {
  assert.equal(getNextVersionNumber([{ versionNumber: 2 }]), 3);
});

// =============================================
// canManageTenant
// =============================================

test("canManageTenant: super admin can manage", () => {
  const ctx: AccessContext = { userId: "u1", globalRole: "platform_super_admin", teamRoles: [], projectRoles: [] };
  assert.equal(canManageTenant(ctx), true);
});

test("canManageTenant: team admin can manage", () => {
  const ctx: AccessContext = { userId: "u1", globalRole: "user", teamRoles: ["tenant_admin"], projectRoles: [] };
  assert.equal(canManageTenant(ctx), true);
});

test("canManageTenant: regular member cannot manage", () => {
  const ctx: AccessContext = { userId: "u1", globalRole: "user", teamRoles: ["member"], projectRoles: [] };
  assert.equal(canManageTenant(ctx), false);
});

// =============================================
// canRemoveTeamMember
// =============================================

test("canRemoveTeamMember: owner cannot be removed by admin", () => {
  const ctx: AccessContext = { userId: "u1", globalRole: "user", teamRoles: ["tenant_admin"], projectRoles: [] };
  assert.equal(canRemoveTeamMember(ctx, "tenant_owner"), false);
});

test("canRemoveTeamMember: super admin can remove owner", () => {
  const ctx: AccessContext = { userId: "u1", globalRole: "platform_super_admin", teamRoles: [], projectRoles: [] };
  assert.equal(canRemoveTeamMember(ctx, "tenant_owner"), true);
});

test("canRemoveTeamMember: admin can remove member", () => {
  const ctx: AccessContext = { userId: "u1", globalRole: "user", teamRoles: ["tenant_admin"], projectRoles: [] };
  assert.equal(canRemoveTeamMember(ctx, "member"), true);
});

// =============================================
// canChangeTeamMemberRole
// =============================================

test("canChangeTeamMemberRole: only owner can change owner role", () => {
  const adminCtx: AccessContext = { userId: "u1", globalRole: "user", teamRoles: ["tenant_admin"], projectRoles: [] };
  assert.equal(canChangeTeamMemberRole(adminCtx, "member", "tenant_owner"), false);

  const ownerCtx: AccessContext = { userId: "u1", globalRole: "user", teamRoles: ["tenant_owner"], projectRoles: [] };
  assert.equal(canChangeTeamMemberRole(ownerCtx, "member", "tenant_owner"), true);
});

// =============================================
// canEditProject
// =============================================

test("canEditProject: editor roles can edit", () => {
  for (const role of ["project_admin", "director", "writer", "artist"] as const) {
    const ctx: AccessContext = { userId: "u1", globalRole: "user", teamRoles: [], projectRoles: [role] };
    assert.equal(canEditProject(ctx), true);
  }
});

test("canEditProject: reviewer and viewer cannot edit", () => {
  for (const role of ["reviewer", "viewer"] as const) {
    const ctx: AccessContext = { userId: "u1", globalRole: "user", teamRoles: [], projectRoles: [role] };
    assert.equal(canEditProject(ctx), false);
  }
});

test("canEditProject: super admin can edit", () => {
  const ctx: AccessContext = { userId: "u1", globalRole: "platform_super_admin", teamRoles: [], projectRoles: [] };
  assert.equal(canEditProject(ctx), true);
});

// =============================================
// canReviewProject
// =============================================

test("canReviewProject: reviewer roles can review", () => {
  for (const role of ["project_admin", "reviewer"] as const) {
    const ctx: AccessContext = { userId: "u1", globalRole: "user", teamRoles: [], projectRoles: [role] };
    assert.equal(canReviewProject(ctx), true);
  }
});

test("canReviewProject: non-review editor roles cannot review", () => {
  for (const role of ["writer", "artist", "viewer"] as const) {
    const ctx: AccessContext = { userId: "u1", globalRole: "user", teamRoles: [], projectRoles: [role] };
    assert.equal(canReviewProject(ctx), false);
  }
});

// =============================================
// resolveContentReviewRequired
// =============================================

test("resolveContentReviewRequired: config overrides project policy", () => {
  const configs: AuditConfigRecord[] = [{
    id: "1", projectId: "p1", contentType: "script",
    reviewRequired: false, autoApproveRoles: [],
    createdAt: "", updatedAt: "",
  }];
  assert.equal(resolveContentReviewRequired("required", "required", configs, "script"), false);
});

test("resolveContentReviewRequired: falls back to project policy without config", () => {
  assert.equal(resolveContentReviewRequired("required", "bypass", [], "script"), false);
  assert.equal(resolveContentReviewRequired("required", "required", [], "image"), true);
  assert.equal(resolveContentReviewRequired("required", "inherit", [], "storyboard"), true);
});

// =============================================
// canAutoApprove
// =============================================

test("canAutoApprove: matching role auto-approves", () => {
  const configs: AuditConfigRecord[] = [{
    id: "1", projectId: "p1", contentType: "script",
    reviewRequired: true, autoApproveRoles: ["director"],
    createdAt: "", updatedAt: "",
  }];
  assert.equal(canAutoApprove(configs, "script", ["director"]), true);
});

test("canAutoApprove: non-matching role does not auto-approve", () => {
  const configs: AuditConfigRecord[] = [{
    id: "1", projectId: "p1", contentType: "script",
    reviewRequired: true, autoApproveRoles: ["project_admin"],
    createdAt: "", updatedAt: "",
  }];
  assert.equal(canAutoApprove(configs, "script", ["writer"]), false);
});

test("canAutoApprove: no config returns false", () => {
  assert.equal(canAutoApprove([], "script", ["director"]), false);
});

test("canAutoApprove: empty autoApproveRoles returns false", () => {
  const configs: AuditConfigRecord[] = [{
    id: "1", projectId: "p1", contentType: "script",
    reviewRequired: true, autoApproveRoles: [],
    createdAt: "", updatedAt: "",
  }];
  assert.equal(canAutoApprove(configs, "script", ["director"]), false);
});

// =============================================
// canManageJobs
// =============================================

test("canManageJobs: project_admin and director can manage", () => {
  for (const role of ["project_admin", "director"] as const) {
    const ctx: AccessContext = { userId: "u1", globalRole: "user", teamRoles: [], projectRoles: [role] };
    assert.equal(canManageJobs(ctx), true);
  }
});

test("canManageJobs: other roles cannot manage", () => {
  for (const role of ["writer", "artist", "reviewer", "viewer"] as const) {
    const ctx: AccessContext = { userId: "u1", globalRole: "user", teamRoles: [], projectRoles: [role] };
    assert.equal(canManageJobs(ctx), false);
  }
});

// =============================================
// canEditTimeline
// =============================================

test("canEditTimeline: project_admin and director can edit", () => {
  for (const role of ["project_admin", "director"] as const) {
    const ctx: AccessContext = { userId: "u1", globalRole: "user", teamRoles: [], projectRoles: [role] };
    assert.equal(canEditTimeline(ctx), true);
  }
});

test("canEditTimeline: other roles cannot edit", () => {
  const ctx: AccessContext = { userId: "u1", globalRole: "user", teamRoles: [], projectRoles: ["viewer"] };
  assert.equal(canEditTimeline(ctx), false);
});

// =============================================
// canExportProject
// =============================================

test("canExportProject: same as timeline editors", () => {
  for (const role of ["project_admin", "director"] as const) {
    const ctx: AccessContext = { userId: "u1", globalRole: "user", teamRoles: [], projectRoles: [role] };
    assert.equal(canExportProject(ctx), true);
  }
  const ctx: AccessContext = { userId: "u1", globalRole: "user", teamRoles: [], projectRoles: ["viewer"] };
  assert.equal(canExportProject(ctx), false);
});

// =============================================
// resolveProjectPermissions
// =============================================

test("canReviewProject: director can review by default", () => {
  const ctx: AccessContext = { userId: "u1", globalRole: "user", teamRoles: [], projectRoles: ["director"] };
  assert.equal(canReviewProject(ctx), true);
});

test("resolveProjectPermissions: director default includes version review", () => {
  const ctx: AccessContext = { userId: "u1", globalRole: "user", teamRoles: [], projectRoles: ["director"] };
  assert.deepEqual(resolveProjectPermissions(ctx), [
    "project.view",
    "project.edit",
    "version.review",
    "job.manage",
    "timeline.edit",
    "export.create",
  ]);
});

test("resolveProjectPermissions: team templates replace system defaults for a role", () => {
  const ctx: AccessContext = {
    userId: "u1",
    globalRole: "user",
    teamRoles: [],
    projectRoles: ["writer"],
    projectRolePermissionTemplates: {
      writer: ["project.view", "version.review"],
    },
  };

  assert.equal(hasProjectPermission(ctx, "project.edit"), false);
  assert.equal(hasProjectPermission(ctx, "version.review"), true);
});

test("resolveProjectPermissions: project allow and deny overrides are applied with deny winning", () => {
  const ctx: AccessContext = {
    userId: "u1",
    globalRole: "user",
    teamRoles: [],
    projectRoles: ["writer"],
    projectMembers: [{
      role: "writer",
      permissionOverride: {
        allow: ["version.review", "job.manage"],
        deny: ["project.edit", "job.manage"],
      },
    }],
  };

  assert.equal(hasProjectPermission(ctx, "project.view"), true);
  assert.equal(hasProjectPermission(ctx, "project.edit"), false);
  assert.equal(hasProjectPermission(ctx, "version.review"), true);
  assert.equal(hasProjectPermission(ctx, "job.manage"), false);
});

test("resolveProjectPermissions: high-trust roles cannot be weakened", () => {
  const projectAdmin: AccessContext = {
    userId: "u1",
    globalRole: "user",
    teamRoles: [],
    projectRoles: ["project_admin"],
    projectMembers: [{
      role: "project_admin",
      permissionOverride: { allow: [], deny: ["project.edit", "permission.manage"] },
    }],
  };
  const superAdmin: AccessContext = {
    userId: "u2",
    globalRole: "platform_super_admin",
    teamRoles: [],
    projectRoles: [],
  };

  assert.deepEqual(resolveProjectPermissions(projectAdmin), PROJECT_PERMISSIONS);
  assert.deepEqual(resolveProjectPermissions(superAdmin), PROJECT_PERMISSIONS);
});

test("normalizePermissionOverride removes duplicates and invalid values", () => {
  assert.deepEqual(normalizePermissionOverride({
    allow: ["project.view", "project.view", "bad.permission"],
    deny: ["version.review", "bad.permission"],
  }), {
    allow: ["project.view"],
    deny: ["version.review"],
  });
});
