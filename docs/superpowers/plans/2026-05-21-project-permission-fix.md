# Project Permission Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Repair the committed project permission implementation so `project.view` is enforced, team admin payload permissions match backend authorization, invalid permission input is rejected, the image prompt regression is fixed, and the repo verifies green.

**Architecture:** Keep `packages/shared/src/project-permissions.ts` as the permission contract layer. Add strict validation helpers for API input while leaving tolerant normalization in `DevDatabaseService`; centralize API actor permission resolution in `WorkspaceService` and reuse it from read guards and jobs reads. The frontend continues to trust `currentUserPermissions` and only gates controls; it does not rebuild role rules.

**Tech Stack:** TypeScript, npm workspaces, NestJS 11, Next.js 15 App Router, React 19, `DevDatabaseService` JSON persistence, Node test scripts.

---

## File Structure

- Modify `packages/shared/src/project-permissions.ts`
  - Add exported helpers that report invalid project permission values with field paths.
  - Keep `normalizeProjectPermissionList`, `normalizePermissionOverride`, and `normalizeProjectRolePermissionTemplates` tolerant for stored JSON cleanup.

- Modify `packages/shared/src/business-rules.test.ts`
  - Add focused unit tests for the new invalid-permission detectors.

- Modify `apps/api/src/workspace/workspace.service.ts`
  - Add one internal actor permission helper so `currentUserPermissions`, `assertProjectReadable`, and `assertProjectPermission` use the same high-trust/team-admin semantics.
  - Add strict input validation before normalizing team templates and member permission overrides.
  - Keep data access through `database.query` and `database.mutate`.

- Modify `apps/api/src/jobs/jobs.service.ts`
  - Replace the private membership-only read guard with the public workspace `project.view` permission assertion.
  - Keep create/action permission checks already using `WorkspaceService.assertProjectPermission`.

- Modify `apps/api/src/jobs/prompt-builder.service.ts`
  - Let shot lookup read storyboard `currentVersionId`, then `draftVersionId`, then newest storyboard version until it finds the requested shot.

- Modify `apps/api/scripts/test.ts`
  - Update permission endpoint tests to expect HTTP 400 for `bad.permission`.
  - Add project read enforcement tests for `GET /projects/:id`, `GET /projects/:id/versions`, `GET /documents/:id/versions`, and `GET /projects/:id/jobs`.
  - Add team admin `currentUserPermissions` coverage.
  - Preserve the existing image prompt assertion that checks shot `visualDescription` reaches the provider prompt.

- Modify `apps/web/components/project-workspace/project-info-panel.tsx`
  - Gate project name/description edit controls and full review-policy switcher with `project.edit`.

- Modify `apps/web/components/unified-workspace.tsx`
  - Gate the compact review-policy switcher with `project.edit`.

- No README changes are required.

---

### Task 1: Add Shared Strict Permission Detectors

**Files:**
- Modify: `packages/shared/src/project-permissions.ts`
- Modify: `packages/shared/src/business-rules.test.ts`

- [ ] **Step 1: Add failing shared tests**

In `packages/shared/src/business-rules.test.ts`, extend the project-permissions import:

```ts
import {
  PROJECT_PERMISSIONS,
  resolveProjectPermissions,
  hasProjectPermission,
  getDefaultProjectRolePermissions,
  normalizePermissionOverride,
  findInvalidPermissionOverrideValues,
  findInvalidProjectPermissionValues,
  findInvalidProjectRolePermissionTemplateValues,
} from "./project-permissions";
```

Add these tests after the existing `normalizePermissionOverride removes duplicates and invalid values` test:

```ts
test("findInvalidProjectPermissionValues reports invalid array entries with paths", () => {
  assert.deepEqual(findInvalidProjectPermissionValues(
    ["project.view", "bad.permission", 123],
    "templates.writer",
  ), [
    { path: "templates.writer[1]", value: "bad.permission" },
    { path: "templates.writer[2]", value: "123" },
  ]);
});

test("findInvalidProjectRolePermissionTemplateValues ignores locked project_admin and reports editable roles", () => {
  assert.deepEqual(findInvalidProjectRolePermissionTemplateValues({
    project_admin: ["bad.admin"],
    writer: ["project.view", "bad.permission"],
    viewer: "project.view",
  }), [
    { path: "templates.writer[1]", value: "bad.permission" },
    { path: "templates.viewer", value: "string" },
  ]);
});

test("findInvalidPermissionOverrideValues reports invalid allow and deny values", () => {
  assert.deepEqual(findInvalidPermissionOverrideValues({
    allow: ["job.manage", "bad.permission"],
    deny: ["version.review", false],
  }), [
    { path: "permissionOverride.allow[1]", value: "bad.permission" },
    { path: "permissionOverride.deny[1]", value: "false" },
  ]);
});
```

- [ ] **Step 2: Run shared tests and confirm they fail**

Run:

```bash
npm --workspace @dramaflow/shared run test
```

Expected: FAIL because `findInvalidPermissionOverrideValues`, `findInvalidProjectPermissionValues`, and `findInvalidProjectRolePermissionTemplateValues` are not exported.

- [ ] **Step 3: Add shared validation helpers**

In `packages/shared/src/project-permissions.ts`, after `isProjectRole`, add:

```ts
export interface InvalidProjectPermissionValue {
  path: string;
  value: string;
}

function describeInvalidPermissionValue(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }

  if (value === null) {
    return "null";
  }

  if (Array.isArray(value)) {
    return "array";
  }

  return typeof value;
}

export function findInvalidProjectPermissionValues(
  values: unknown,
  path: string,
): InvalidProjectPermissionValue[] {
  if (!Array.isArray(values)) {
    return values === undefined
      ? []
      : [{ path, value: describeInvalidPermissionValue(values) }];
  }

  return values
    .map((value, index) => ({ value, index }))
    .filter(({ value }) => !isProjectPermission(value))
    .map(({ value, index }) => ({
      path: `${path}[${index}]`,
      value: describeInvalidPermissionValue(value),
    }));
}

export function findInvalidPermissionOverrideValues(value: unknown): InvalidProjectPermissionValue[] {
  const record = value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};

  return [
    ...findInvalidProjectPermissionValues(record.allow, "permissionOverride.allow"),
    ...findInvalidProjectPermissionValues(record.deny, "permissionOverride.deny"),
  ];
}

export function findInvalidProjectRolePermissionTemplateValues(value: unknown): InvalidProjectPermissionValue[] {
  const record = value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
  const invalid: InvalidProjectPermissionValue[] = [];

  for (const role of PROJECT_ROLES) {
    if (role === "project_admin") {
      continue;
    }

    if (Object.prototype.hasOwnProperty.call(record, role)) {
      invalid.push(...findInvalidProjectPermissionValues(record[role], `templates.${role}`));
    }
  }

  return invalid;
}
```

Do not change the existing normalize functions in this task.

- [ ] **Step 4: Run shared tests and confirm they pass**

Run:

```bash
npm --workspace @dramaflow/shared run test
```

Expected: PASS.

- [ ] **Step 5: Commit shared validation helpers**

Run:

```bash
git add packages/shared/src/project-permissions.ts packages/shared/src/business-rules.test.ts
git commit -m "feat(shared): report invalid project permissions"
```

---

### Task 2: Add API Tests for Permission Contract Repair

**Files:**
- Modify: `apps/api/scripts/test.ts`

- [ ] **Step 1: Import shared permission constants**

At the top of `apps/api/scripts/test.ts`, add this import after the Express import:

```ts
import { PROJECT_PERMISSIONS } from "@dramaflow/shared";
```

- [ ] **Step 2: Update existing invalid permission endpoint expectations**

Inside the existing `project permission endpoints resolve templates and member overrides` run case, replace the current `updateTemplatesResponse` block that expects status `200` for `bad.permission` with:

```ts
      const invalidTemplatesResponse = await readResponse(await originalFetch(`${baseUrl}/teams/${teamId}/permission-templates`, {
        method: "PUT",
        headers: ownerJsonHeaders,
        body: JSON.stringify({
          templates: {
            writer: ["project.view", "version.review", "bad.permission"],
          },
        }),
      }));
      assert.equal(invalidTemplatesResponse.status, 400);
      assert.equal(invalidTemplatesResponse.bodyText.includes("bad.permission"), true);
      assert.equal(invalidTemplatesResponse.bodyText.includes("templates.writer[2]"), true);

      const updateTemplatesResponse = await originalFetch(`${baseUrl}/teams/${teamId}/permission-templates`, {
        method: "PUT",
        headers: ownerJsonHeaders,
        body: JSON.stringify({
          templates: {
            writer: ["project.view", "version.review"],
          },
        }),
      });
      assert.equal(updateTemplatesResponse.status, 200);
      const updatedTemplates = await updateTemplatesResponse.json() as {
        templates: { writer: string[] };
        resolvedTemplates: Array<{ role: string; effectivePermissions: string[] }>;
      };
      assert.deepEqual(updatedTemplates.templates.writer, ["project.view", "version.review"]);
```

In the same run case, replace the `updateMemberPermissionsResponse` block that sends `allow: ["job.manage", "bad.permission"]` with:

```ts
      const invalidMemberPermissionsResponse = await readResponse(await originalFetch(`${baseUrl}/projects/${project.id}/members/${writerMember.id}/permissions`, {
        method: "PUT",
        headers: ownerJsonHeaders,
        body: JSON.stringify({
          permissionOverride: {
            allow: ["job.manage", "bad.permission"],
            deny: ["version.review"],
          },
        }),
      }));
      assert.equal(invalidMemberPermissionsResponse.status, 400);
      assert.equal(invalidMemberPermissionsResponse.bodyText.includes("bad.permission"), true);
      assert.equal(invalidMemberPermissionsResponse.bodyText.includes("permissionOverride.allow[1]"), true);

      const updateMemberPermissionsResponse = await originalFetch(`${baseUrl}/projects/${project.id}/members/${writerMember.id}/permissions`, {
        method: "PUT",
        headers: ownerJsonHeaders,
        body: JSON.stringify({
          permissionOverride: {
            allow: ["job.manage"],
            deny: ["version.review"],
          },
        }),
      });
      assert.equal(updateMemberPermissionsResponse.status, 200);
      const updatedMemberPermissions = await updateMemberPermissionsResponse.json() as {
        permissionOverride: { allow: string[]; deny: string[] };
        effectivePermissions: string[];
      };
      assert.deepEqual(updatedMemberPermissions.permissionOverride, {
        allow: ["job.manage"],
        deny: ["version.review"],
      });
      assert.equal(updatedMemberPermissions.effectivePermissions.includes("job.manage"), true);
      assert.equal(updatedMemberPermissions.effectivePermissions.includes("version.review"), false);
```

- [ ] **Step 3: Add read enforcement and team admin payload coverage**

Inside the existing `project permissions enforce review member job timeline and export actions` run case, add a tenant admin user after the viewer registration:

```ts
      const tenantAdmin = await registerUser(baseUrl, { email: "enforce-tenant-admin@example.com", displayName: "Enforce Tenant Admin" });
```

Add its team membership after `teamId` is resolved:

```ts
      const addTenantAdminResponse = await originalFetch(`${baseUrl}/teams/${teamId}/members`, {
        method: "POST",
        headers: ownerJsonHeaders,
        body: JSON.stringify({ email: tenantAdmin.user.email, role: "tenant_admin" }),
      });
      assert.equal(addTenantAdminResponse.status, 201);
```

Change the viewer member capture to keep the member id:

```ts
      const addViewerResponse = await originalFetch(`${baseUrl}/projects/${project.id}/members`, {
        method: "POST",
        headers: ownerJsonHeaders,
        body: JSON.stringify({ email: viewer.user.email, role: "viewer" }),
      });
      assert.equal(addViewerResponse.status, 201);
      const viewerMember = await addViewerResponse.json() as { id: string };
```

After `scriptDocument` is found and before creating the first version, add:

```ts
      const viewerWorkspaceBeforeDenyResponse = await originalFetch(`${baseUrl}/projects/${project.id}`, {
        headers: authHeaders(viewer.accessToken),
      });
      assert.equal(viewerWorkspaceBeforeDenyResponse.status, 200);

      const viewerProjectVersionsBeforeDenyResponse = await originalFetch(`${baseUrl}/projects/${project.id}/versions`, {
        headers: authHeaders(viewer.accessToken),
      });
      assert.equal(viewerProjectVersionsBeforeDenyResponse.status, 200);

      const viewerDocumentVersionsBeforeDenyResponse = await originalFetch(`${baseUrl}/documents/${scriptDocument.id}/versions`, {
        headers: authHeaders(viewer.accessToken),
      });
      assert.equal(viewerDocumentVersionsBeforeDenyResponse.status, 200);

      const viewerJobsBeforeDenyResponse = await originalFetch(`${baseUrl}/projects/${project.id}/jobs`, {
        headers: authHeaders(viewer.accessToken),
      });
      assert.equal(viewerJobsBeforeDenyResponse.status, 200);

      const tenantAdminWorkspaceResponse = await originalFetch(`${baseUrl}/projects/${project.id}`, {
        headers: authHeaders(tenantAdmin.accessToken),
      });
      assert.equal(tenantAdminWorkspaceResponse.status, 200);
      const tenantAdminWorkspace = await tenantAdminWorkspaceResponse.json() as { currentUserPermissions: string[] };
      assert.deepEqual(tenantAdminWorkspace.currentUserPermissions, PROJECT_PERMISSIONS);

      const denyViewerReadResponse = await originalFetch(`${baseUrl}/projects/${project.id}/members/${viewerMember.id}/permissions`, {
        method: "PUT",
        headers: ownerJsonHeaders,
        body: JSON.stringify({ permissionOverride: { allow: [], deny: ["project.view"] } }),
      });
      assert.equal(denyViewerReadResponse.status, 200);

      const viewerWorkspaceAfterDenyResponse = await originalFetch(`${baseUrl}/projects/${project.id}`, {
        headers: authHeaders(viewer.accessToken),
      });
      assert.equal(viewerWorkspaceAfterDenyResponse.status, 403);

      const viewerProjectVersionsAfterDenyResponse = await originalFetch(`${baseUrl}/projects/${project.id}/versions`, {
        headers: authHeaders(viewer.accessToken),
      });
      assert.equal(viewerProjectVersionsAfterDenyResponse.status, 403);

      const viewerDocumentVersionsAfterDenyResponse = await originalFetch(`${baseUrl}/documents/${scriptDocument.id}/versions`, {
        headers: authHeaders(viewer.accessToken),
      });
      assert.equal(viewerDocumentVersionsAfterDenyResponse.status, 403);

      const viewerJobsAfterDenyResponse = await originalFetch(`${baseUrl}/projects/${project.id}/jobs`, {
        headers: authHeaders(viewer.accessToken),
      });
      assert.equal(viewerJobsAfterDenyResponse.status, 403);
```

- [ ] **Step 4: Run API tests and confirm the new contract tests fail**

Run:

```bash
npm --workspace @dramaflow/api run test
```

Expected: FAIL. The failure set should include at least one permission contract assertion:

- invalid `bad.permission` endpoint input returns `200` instead of `400`, or
- viewer read after deny returns `200` instead of `403`, or
- tenant admin `currentUserPermissions` is not `PROJECT_PERMISSIONS`.

The existing image prompt failure at `apps/api/scripts/test.ts:1436` may also still appear.

- [ ] **Step 5: Commit failing API tests**

Run:

```bash
git add apps/api/scripts/test.ts
git commit -m "test(api): capture project permission repair contract"
```

---

### Task 3: Implement WorkspaceService Permission Contract

**Files:**
- Modify: `apps/api/src/workspace/workspace.service.ts`

- [ ] **Step 1: Import strict permission detectors**

In the `@dramaflow/shared` import in `apps/api/src/workspace/workspace.service.ts`, add:

```ts
  findInvalidPermissionOverrideValues,
  findInvalidProjectRolePermissionTemplateValues,
```

- [ ] **Step 2: Add centralized actor permission helpers**

Add these private helpers near the existing `getActor` method:

```ts
  private buildProjectActorContext(db: DevDatabase, userId: string, projectId: string): ActorContext {
    const user = this.mustFindUser(db, userId);
    const project = this.mustFindProject(db, projectId);
    const team = this.mustFindTeam(db, project.teamId);
    const projectMembers = db.projectMembers.filter((member) => member.projectId === projectId && member.userId === userId);
    const teamRoles = db.teamMembers
      .filter((member) => member.teamId === project.teamId && member.userId === userId)
      .map((member) => member.role);

    return {
      userId,
      globalRole: user.globalRole,
      teamRoles,
      projectRoles: projectMembers.map((member) => member.role),
      projectMembers: projectMembers.map((member) => ({
        role: member.role,
        permissionOverride: normalizePermissionOverride(member.permissionOverride),
      })),
      projectRolePermissionTemplates: team.projectRolePermissionTemplates,
    };
  }

  private resolveActorProjectPermissions(actor: ActorContext): ProjectPermission[] {
    if (canManageTenant(actor)) {
      return [...PROJECT_PERMISSIONS];
    }

    return resolveProjectPermissions(actor);
  }

  private actorHasProjectPermission(actor: ActorContext, permission: ProjectPermission): boolean {
    return this.resolveActorProjectPermissions(actor).includes(permission);
  }

  private assertNoInvalidProjectPermissions(invalid: Array<{ path: string; value: string }>): void {
    if (invalid.length === 0) {
      return;
    }

    const details = invalid.map((entry) => `${entry.path}: ${entry.value}`).join(", ");
    throw new BadRequestException(`Invalid project permission value: ${details}`);
  }
```

- [ ] **Step 3: Reuse the project actor helper from `getActor`**

Replace the project branch inside `private async getActor(...)` with this structure:

```ts
  private async getActor(userId: string, projectId?: string, teamId?: string): Promise<ActorContext> {
    return this.database.query((db) => {
      if (projectId) {
        return this.buildProjectActorContext(db, userId, projectId);
      }

      const user = this.mustFindUser(db, userId);
      const team = teamId ? this.mustFindTeam(db, teamId) : undefined;

      return {
        userId,
        globalRole: user.globalRole,
        teamRoles: team
          ? db.teamMembers.filter((member) => member.teamId === team.id && member.userId === userId).map((member) => member.role)
          : [],
        projectRoles: [],
        projectMembers: [],
        projectRolePermissionTemplates: team?.projectRolePermissionTemplates,
      };
    });
  }
```

- [ ] **Step 4: Make `getProject` payload use the same resolved permissions**

Inside `getProject`, replace the current `currentUserPermissions` IIFE with:

```ts
      const currentUserPermissions = this.resolveActorProjectPermissions(
        this.buildProjectActorContext(db, userId, projectId),
      );
```

- [ ] **Step 5: Make read access require `project.view`**

Replace the body of private `assertProjectReadable` with:

```ts
  private assertProjectReadable(db: DevDatabase, projectId: string, userId: string) {
    const actor = this.buildProjectActorContext(db, userId, projectId);

    if (!this.actorHasProjectPermission(actor, "project.view")) {
      throw new ForbiddenException("You do not have access to this project");
    }
  }
```

- [ ] **Step 6: Make public permission assertions use the same high-trust model**

Replace `assertProjectPermission` with:

```ts
  async assertProjectPermission(
    userId: string,
    projectId: string,
    permission: ProjectPermission,
    message = "You do not have permission to perform this project action",
  ): Promise<void> {
    const actor = await this.getActor(userId, projectId);
    if (!this.actorHasProjectPermission(actor, permission)) {
      throw new ForbiddenException(message);
    }
  }
```

- [ ] **Step 7: Align direct permission checks in WorkspaceService**

Run this search to find every direct project permission condition:

```bash
rg -n "canEditProject\\(actor\\)|canReviewProject\\(actor\\)|canEditTimeline\\(actor\\)|hasProjectPermission\\(actor" apps/api/src/workspace/workspace.service.ts
```

Apply these exact condition replacements and keep the existing `ForbiddenException` messages:

```ts
// Before
if (!canEditProject(actor)) {

// After
if (!this.actorHasProjectPermission(actor, "project.edit")) {
```

```ts
// Before
if (!canReviewProject(actor)) {

// After
if (!this.actorHasProjectPermission(actor, "version.review")) {
```

```ts
// Before
if (!canEditTimeline(actor)) {

// After
if (!this.actorHasProjectPermission(actor, "timeline.edit")) {
```

```ts
// Before
if (!hasProjectPermission(actor, "member.manage") && !canManageTenant(actor)) {

// After
if (!this.actorHasProjectPermission(actor, "member.manage")) {
```

```ts
// Before
if (!hasProjectPermission(actor, "permission.manage") && !canManageTenant(actor)) {

// After
if (!this.actorHasProjectPermission(actor, "permission.manage")) {
```

Keep `deleteProject` unchanged unless there is an existing frontend delete control gated only by `currentUserPermissions`; the current backend rule is still “platform super admin or project admin”.

- [ ] **Step 8: Add strict API validation before normalization**

In `updateTeamPermissionTemplates`, validate before `database.mutate`:

```ts
    this.assertNoInvalidProjectPermissions(findInvalidProjectRolePermissionTemplateValues(input.templates));
```

In `updateProjectMemberPermissions`, validate before `database.mutate`:

```ts
    this.assertNoInvalidProjectPermissions(findInvalidPermissionOverrideValues(input.permissionOverride));
```

Do not change `DevDatabaseService`; it must keep tolerant load-time normalization.

- [ ] **Step 9: Run API tests and inspect remaining failures**

Run:

```bash
npm --workspace @dramaflow/api run test
```

Expected: permission endpoint, read enforcement, and team admin payload assertions pass. The image prompt assertion may still fail until Task 5.

- [ ] **Step 10: Run lint for API/shared type issues**

Run:

```bash
npm --workspace @dramaflow/api run lint
```

Expected: PASS. If TypeScript reports unused imports from `canEditProject`, `canReviewProject`, `canEditTimeline`, or `hasProjectPermission`, remove only the unused imports.

- [ ] **Step 11: Commit WorkspaceService repair**

Run:

```bash
git add apps/api/src/workspace/workspace.service.ts
git commit -m "fix(api): enforce effective project permissions"
```

---

### Task 4: Route JobsService Reads Through `project.view`

**Files:**
- Modify: `apps/api/src/jobs/jobs.service.ts`

- [ ] **Step 1: Replace the private read guard**

Replace the body of `private async assertProjectReadable(userId: string, projectId: string)` in `apps/api/src/jobs/jobs.service.ts` with:

```ts
  private async assertProjectReadable(userId: string, projectId: string) {
    await this.workspaceService.assertProjectPermission(
      userId,
      projectId,
      "project.view",
      "You do not have access to this project",
    );
  }
```

- [ ] **Step 2: Run API tests**

Run:

```bash
npm --workspace @dramaflow/api run test
```

Expected: `GET /projects/:id/jobs` returns `403` for a member whose effective permissions deny `project.view`. The image prompt assertion may still fail until Task 5.

- [ ] **Step 3: Run API lint**

Run:

```bash
npm --workspace @dramaflow/api run lint
```

Expected: PASS. If `ForbiddenException` or `NotFoundException` imports are now unused in `jobs.service.ts`, remove only the unused imports.

- [ ] **Step 4: Commit JobsService read guard**

Run:

```bash
git add apps/api/src/jobs/jobs.service.ts
git commit -m "fix(api): enforce project view on job reads"
```

---

### Task 5: Fix Storyboard Shot Lookup for Image Prompt Generation

**Files:**
- Modify: `apps/api/src/jobs/prompt-builder.service.ts`

- [ ] **Step 1: Add deterministic version ordering helper**

In `PromptBuilderService`, before `findShotInVersions`, add:

```ts
  private getStoryboardVersionCandidates(
    db: import("../common/database.types").DevDatabase,
    documentId: string,
    currentVersionId?: string,
    draftVersionId?: string,
  ) {
    const candidateIds = [currentVersionId, draftVersionId].filter((id): id is string => Boolean(id));
    const versions = candidateIds
      .map((id) => db.versions.find((version) => version.id === id && version.documentId === documentId))
      .filter((version): version is NonNullable<typeof version> => Boolean(version));
    const seen = new Set(versions.map((version) => version.id));

    const newestVersions = db.versions
      .filter((version) => version.documentId === documentId && !seen.has(version.id))
      .sort((left, right) => right.versionNumber - left.versionNumber);

    return [...versions, ...newestVersions];
  }
```

- [ ] **Step 2: Update `findShotInVersions` to use current, draft, and newest storyboard versions**

Replace the loop body inside `findShotInVersions` with:

```ts
    for (const doc of storyboardDocs) {
      const versions = this.getStoryboardVersionCandidates(
        db,
        doc.id,
        doc.currentVersionId,
        doc.draftVersionId,
      );

      for (const version of versions) {
        if (!version.content || typeof version.content !== "object") continue;

        const content = version.content as { shots?: StoryboardShot[] };
        if (!Array.isArray(content.shots)) continue;

        const found = content.shots.find((s) => s.id === shotId);
        if (found) return found;
      }
    }
```

- [ ] **Step 3: Run API tests**

Run:

```bash
npm --workspace @dramaflow/api run test
```

Expected: PASS, including the assertion that provider prompt text includes `A lone director on a rainy rooftop`, includes `Negative prompt:`, and does not include `shot-team cinematic image`.

- [ ] **Step 4: Commit prompt regression fix**

Run:

```bash
git add apps/api/src/jobs/prompt-builder.service.ts
git commit -m "fix(api): find draft storyboard shots for prompts"
```

---

### Task 6: Gate Frontend Project Edit Controls by `project.edit`

**Files:**
- Modify: `apps/web/components/project-workspace/project-info-panel.tsx`
- Modify: `apps/web/components/unified-workspace.tsx`

- [ ] **Step 1: Add `canEditProject` to ProjectInfoPanel**

In `apps/web/components/project-workspace/project-info-panel.tsx`, after `canManagePermissions`, add:

```tsx
  const canEditProject = hasProjectPermission(permissions, "project.edit");
```

- [ ] **Step 2: Gate name and description edit buttons**

Wrap both `pip-edit-btn` buttons with `canEditProject`:

```tsx
                  {canEditProject && (
                    <button
                      className="pip-edit-btn"
                      type="button"
                      onClick={() => startEdit("name")}
                      aria-label={t("projectWorkspace.overview.editName")}
                    >
                      <PencilIcon />
                      {t("common.edit")}
                    </button>
                  )}
```

Use the same pattern for the description edit button with `startEdit("description")` and `projectWorkspace.overview.editDescription`.

- [ ] **Step 3: Gate the full review policy switcher**

Replace the unconditional `pip-policy-row` block with:

```tsx
        {canEditProject && (
          <div className="pip-policy-row">
            <ReviewPolicySwitcher
              projectId={projectId}
              currentMode={project?.reviewPolicyMode ?? "inherit"}
              teamId={payload.team.id}
            />
          </div>
        )}
```

- [ ] **Step 4: Gate compact review policy switcher in UnifiedWorkspace**

In `apps/web/components/unified-workspace.tsx`, after `canCreateExport`, add:

```tsx
  const canEditProject = currentUserPermissions.includes("project.edit");
```

Inside the `showThreeColumnLayout && !isDocumentMode` fragment, wrap only the compact `ReviewPolicySwitcher`:

```tsx
              {canEditProject && (
                <ReviewPolicySwitcher
                  projectId={projectId}
                  currentMode={payload.project.reviewPolicyMode}
                  variant="compact"
                />
              )}
```

Keep the right-panel toggle visible.

- [ ] **Step 5: Run web lint**

Run:

```bash
npm --workspace @dramaflow/web run lint
```

Expected: PASS.

- [ ] **Step 6: Commit frontend gating**

Run:

```bash
git add apps/web/components/project-workspace/project-info-panel.tsx apps/web/components/unified-workspace.tsx
git commit -m "fix(web): gate project edit controls by permission"
```

---

### Task 7: Full Verification and Final Repair Commit Check

**Files:**
- Verify all files changed in previous tasks.

- [ ] **Step 1: Check working tree**

Run:

```bash
git status --short
```

Expected: no uncommitted source changes. If a previous task intentionally left changes staged or unstaged, commit them before continuing.

- [ ] **Step 2: Run full lint**

Run:

```bash
npm run lint
```

Expected: PASS for all workspaces.

- [ ] **Step 3: Run full tests**

Run:

```bash
npm test
```

Expected: PASS for all workspaces.

- [ ] **Step 4: Run full build**

Run:

```bash
npm run build
```

Expected: PASS for all workspaces, including Next.js build.

- [ ] **Step 5: Inspect final diff against the repair scope**

Run:

```bash
git log --oneline -8
git status --short
```

Expected: the recent commits match the repair tasks, and the working tree is clean.

---

## Acceptance Criteria

- `GET /projects/:id`, `GET /projects/:id/versions`, `GET /documents/:id/versions`, and `GET /projects/:id/jobs` return `403` when a project member has effective `deny: ["project.view"]`.
- Team owners and tenant admins viewing a project in their team receive `currentUserPermissions` equal to `PROJECT_PERMISSIONS`.
- API input for team permission templates and member overrides returns `400` for `bad.permission`, and the response text includes both the value and field path.
- `DevDatabaseService` still uses tolerant normalization on loaded JSON.
- The existing image generation test still checks that storyboard shot `visualDescription` reaches the provider prompt.
- Project edit and review-policy controls are hidden when `currentUserPermissions` lacks `project.edit`.
- Final commands pass:

```bash
npm run lint
npm test
npm run build
```

## Plan Self-Review

- Spec coverage: every requirement in `docs/superpowers/specs/2026-05-21-project-permission-fix-design.md` maps to Tasks 1-7.
- Type consistency: `ProjectPermission`, `ProjectRolePermissionTemplates`, `PermissionOverride`, and `ActorContext` stay sourced from `@dramaflow/shared`.
- Persistence consistency: runtime writes still use `DevDatabaseService.query` and `DevDatabaseService.mutate`; no Prisma wiring is introduced.
- Scope check: this plan repairs the committed permission system and one prompt regression; it does not redesign roles, review scope, queue infrastructure, or storage.
