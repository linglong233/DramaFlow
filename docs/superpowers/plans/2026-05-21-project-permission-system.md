# Project Permission System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace fixed project-role checks with assignable project permissions, default directors into version review, and expose effective permissions to the API and frontend.

**Architecture:** Add shared permission domain types and a resolver that combines system defaults, team role templates, and project member allow/deny overrides. Keep runtime persistence on the existing JSON `DevDatabaseService`; the Prisma schema is updated only as the target production model. Backend authorization flows through shared helpers, while the frontend consumes effective permission arrays from API payloads and never re-derives role rules.

**Tech Stack:** TypeScript, `@dramaflow/shared`, NestJS 11, Next.js 15, React 19, React Query, npm workspaces, Node `node:test` and existing package test scripts.

---

## File Structure

- Create `packages/shared/src/project-permissions.ts`
  - Owns permission constants, system role templates, runtime normalization, resolver helpers, and permission predicates.
- Modify `packages/shared/src/domain.ts`
  - Adds `ProjectPermission`, `PermissionOverride`, `ProjectRolePermissionTemplates`, project member context, and optional record fields.
- Modify `packages/shared/src/business-rules.ts`
  - Keeps existing helper names but maps project checks to `hasProjectPermission`.
- Modify `packages/shared/src/business-rules.test.ts`
  - Adds resolver coverage and updates the existing director review expectation.
- Modify `packages/shared/src/api-contracts.ts`
  - Adds permission-template and member-permission request/response contracts.
- Modify `packages/shared/src/index.ts`
  - Exports the new permission helper module.
- Modify `packages/shared/scripts/test.ts`
  - Adds lightweight runtime assertions for exported constants and contract shapes.
- Modify `apps/api/prisma/schema.prisma`
  - Adds JSON fields to the target `Team` and `ProjectMember` models.
- Modify `apps/api/src/common/dev-database.service.ts`
  - Normalizes old JSON files and rejects invalid permission strings at load time by pruning them.
- Modify `apps/api/src/common/database.types.test.ts`
  - Confirms empty databases remain compatible with missing permission fields.
- Modify `apps/api/src/workspace/workspace.controller.ts`
  - Adds permission template and project member override endpoints.
- Modify `apps/api/src/workspace/workspace.service.ts`
  - Builds actor contexts with effective permissions, adds endpoint methods, enriches workspace payloads, and replaces project permission checks.
- Modify `apps/api/src/jobs/jobs.service.ts`
  - Uses `WorkspaceService.assertProjectPermission` for job management and export creation.
- Modify `apps/api/scripts/test.ts`
  - Adds HTTP coverage for permission resolution, endpoint authorization, and backend enforcement.
- Modify `apps/web/lib/query-keys.ts`
  - Adds query keys for team templates and member permission details.
- Create `apps/web/lib/project-permissions.ts`
  - Provides UI-safe permission labels, grouping, and `hasProjectPermission`.
- Modify `apps/web/lib/i18n/messages.ts`
  - Adds Chinese and English permission labels and UI copy.
- Modify `apps/web/lib/i18n/labels.ts`
  - Adds `getProjectPermissionLabel`.
- Modify `apps/web/components/team-settings-panel.tsx`
  - Adds a compact team role template matrix with a separate save action.
- Create `apps/web/components/project-workspace/member-permission-dialog.tsx`
  - Shows inherited, allow, deny, and effective permissions for a project member.
- Modify `apps/web/components/project-workspace/project-info-panel.tsx`
  - Gates member management by `member.manage` and opens the member permission dialog by `permission.manage`.
- Modify `apps/web/components/project-workspace/right-context-panel.tsx`
  - Gates review controls by `version.review` and edit controls by `project.edit`.
- Modify `apps/web/components/project-workspace/task-panel.tsx`
  - Gates batch, cancel, and retry actions by `job.manage`.
- Modify `apps/web/components/project-workspace/timeline-editor.tsx`
  - Gates timeline save/auto-assemble by `timeline.edit` and export by `export.create`.
- Modify `apps/web/components/unified-workspace.tsx`
  - Passes `payload.currentUserPermissions` into workspace child panels. This file already has user changes; inspect the diff before editing and preserve existing edits.

---

### Task 1: Shared Permission Domain And Resolver

**Files:**
- Modify: `packages/shared/src/domain.ts`
- Create: `packages/shared/src/project-permissions.ts`
- Modify: `packages/shared/src/business-rules.ts`
- Modify: `packages/shared/src/index.ts`
- Test: `packages/shared/src/business-rules.test.ts`
- Test: `packages/shared/scripts/test.ts`

- [ ] **Step 1: Write the failing shared resolver tests**

Append these tests after the existing `canReviewProject` tests in `packages/shared/src/business-rules.test.ts`. Update the import list to include `PROJECT_PERMISSIONS`, `resolveProjectPermissions`, `hasProjectPermission`, `getDefaultProjectRolePermissions`, and `normalizePermissionOverride`.

```ts
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
```

Replace the old test named `canReviewProject: editor roles cannot review` with this narrower assertion:

```ts
test("canReviewProject: non-review editor roles cannot review", () => {
  for (const role of ["writer", "artist", "viewer"] as const) {
    const ctx: AccessContext = { userId: "u1", globalRole: "user", teamRoles: [], projectRoles: [role] };
    assert.equal(canReviewProject(ctx), false);
  }
});
```

- [ ] **Step 2: Run the shared tests and confirm the expected failure**

Run:

```bash
npm --workspace @dramaflow/shared run test
```

Expected: FAIL with TypeScript/runtime errors for missing exports such as `resolveProjectPermissions`, `PROJECT_PERMISSIONS`, and `normalizePermissionOverride`.

- [ ] **Step 3: Add shared domain types**

In `packages/shared/src/domain.ts`, add these definitions immediately after `ProjectRole`:

```ts
export type ProjectPermission =
  | "project.view"
  | "project.edit"
  | "version.review"
  | "job.manage"
  | "timeline.edit"
  | "export.create"
  | "member.manage"
  | "permission.manage";

export interface PermissionOverride {
  allow: ProjectPermission[];
  deny: ProjectPermission[];
}

export type ProjectRolePermissionTemplates = Partial<Record<ProjectRole, ProjectPermission[]>>;

export interface AccessProjectMemberContext {
  role: ProjectRole;
  permissionOverride?: PermissionOverride;
}
```

Add optional fields to `TeamRecord`:

```ts
  projectRolePermissionTemplates?: ProjectRolePermissionTemplates;
```

Add optional fields to `ProjectMemberRecord`:

```ts
  permissionOverride?: PermissionOverride;
```

Extend `AccessContext` while preserving existing required fields:

```ts
export interface AccessContext {
  userId: string;
  globalRole: GlobalRole;
  teamRoles: TeamRole[];
  projectRoles: ProjectRole[];
  projectMembers?: AccessProjectMemberContext[];
  projectRolePermissionTemplates?: ProjectRolePermissionTemplates;
}
```

- [ ] **Step 4: Add the resolver module**

Create `packages/shared/src/project-permissions.ts` with this implementation:

```ts
import type {
  AccessContext,
  AccessProjectMemberContext,
  PermissionOverride,
  ProjectPermission,
  ProjectRole,
  ProjectRolePermissionTemplates,
} from "./domain";

export const PROJECT_PERMISSIONS: ProjectPermission[] = [
  "project.view",
  "project.edit",
  "version.review",
  "job.manage",
  "timeline.edit",
  "export.create",
  "member.manage",
  "permission.manage",
];

export const PROJECT_ROLES: ProjectRole[] = [
  "project_admin",
  "director",
  "writer",
  "artist",
  "reviewer",
  "viewer",
];

export const SYSTEM_PROJECT_ROLE_PERMISSION_TEMPLATES: Record<ProjectRole, ProjectPermission[]> = {
  project_admin: PROJECT_PERMISSIONS,
  director: ["project.view", "project.edit", "version.review", "job.manage", "timeline.edit", "export.create"],
  writer: ["project.view", "project.edit"],
  artist: ["project.view", "project.edit"],
  reviewer: ["project.view", "version.review"],
  viewer: ["project.view"],
};

const PROJECT_PERMISSION_SET = new Set<ProjectPermission>(PROJECT_PERMISSIONS);
const PROJECT_ROLE_SET = new Set<ProjectRole>(PROJECT_ROLES);

export function isProjectPermission(value: unknown): value is ProjectPermission {
  return typeof value === "string" && PROJECT_PERMISSION_SET.has(value as ProjectPermission);
}

export function isProjectRole(value: unknown): value is ProjectRole {
  return typeof value === "string" && PROJECT_ROLE_SET.has(value as ProjectRole);
}

export function normalizeProjectPermissionList(values: unknown): ProjectPermission[] {
  if (!Array.isArray(values)) {
    return [];
  }

  const seen = new Set<ProjectPermission>();
  for (const value of values) {
    if (isProjectPermission(value)) {
      seen.add(value);
    }
  }

  return PROJECT_PERMISSIONS.filter((permission) => seen.has(permission));
}

export function normalizePermissionOverride(value: unknown): PermissionOverride {
  const record = value && typeof value === "object" ? value as Record<string, unknown> : {};
  return {
    allow: normalizeProjectPermissionList(record.allow),
    deny: normalizeProjectPermissionList(record.deny),
  };
}

export function normalizeProjectRolePermissionTemplates(value: unknown): ProjectRolePermissionTemplates {
  const record = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const templates: ProjectRolePermissionTemplates = {};

  for (const role of PROJECT_ROLES) {
    if (role === "project_admin") {
      continue;
    }

    if (Object.prototype.hasOwnProperty.call(record, role)) {
      templates[role] = normalizeProjectPermissionList(record[role]);
    }
  }

  return templates;
}

export function getDefaultProjectRolePermissions(role: ProjectRole): ProjectPermission[] {
  return [...SYSTEM_PROJECT_ROLE_PERMISSION_TEMPLATES[role]];
}

export function getProjectRoleTemplatePermissions(
  role: ProjectRole,
  templates?: ProjectRolePermissionTemplates,
): ProjectPermission[] {
  if (role === "project_admin") {
    return [...PROJECT_PERMISSIONS];
  }

  const teamTemplate = templates?.[role];
  return teamTemplate ? normalizeProjectPermissionList(teamTemplate) : getDefaultProjectRolePermissions(role);
}

function getContextProjectMembers(context: AccessContext): AccessProjectMemberContext[] {
  if (context.projectMembers?.length) {
    return context.projectMembers;
  }

  return context.projectRoles.map((role) => ({ role }));
}

export function resolveProjectPermissions(context: AccessContext): ProjectPermission[] {
  if (context.globalRole === "platform_super_admin") {
    return [...PROJECT_PERMISSIONS];
  }

  const projectMembers = getContextProjectMembers(context);
  if (projectMembers.some((member) => member.role === "project_admin")) {
    return [...PROJECT_PERMISSIONS];
  }

  const granted = new Set<ProjectPermission>();
  const denied = new Set<ProjectPermission>();

  for (const member of projectMembers) {
    const inherited = getProjectRoleTemplatePermissions(member.role, context.projectRolePermissionTemplates);
    for (const permission of inherited) {
      granted.add(permission);
    }

    const override = normalizePermissionOverride(member.permissionOverride);
    for (const permission of override.allow) {
      granted.add(permission);
    }
    for (const permission of override.deny) {
      denied.add(permission);
    }
  }

  return PROJECT_PERMISSIONS.filter((permission) => granted.has(permission) && !denied.has(permission));
}

export function hasProjectPermission(context: AccessContext, permission: ProjectPermission): boolean {
  return resolveProjectPermissions(context).includes(permission);
}
```

- [ ] **Step 5: Export the module and remap compatibility wrappers**

In `packages/shared/src/index.ts`, add:

```ts
export * from "./project-permissions";
```

In `packages/shared/src/business-rules.ts`, import `hasProjectPermission`:

```ts
import { hasProjectPermission } from "./project-permissions";
```

Remove `PROJECT_EDITOR_ROLES`, `PROJECT_REVIEW_ROLES`, `JOB_MANAGEMENT_ROLES`, and `TIMELINE_EDITOR_ROLES`. Replace the project permission wrappers with:

```ts
export function canEditProject(context: AccessContext): boolean {
  return hasProjectPermission(context, "project.edit");
}

export function canReviewProject(context: AccessContext): boolean {
  return hasProjectPermission(context, "version.review");
}

export function canManageJobs(context: AccessContext): boolean {
  return hasProjectPermission(context, "job.manage");
}

export function canEditTimeline(context: AccessContext): boolean {
  return hasProjectPermission(context, "timeline.edit");
}

export function canExportProject(context: AccessContext): boolean {
  return hasProjectPermission(context, "export.create");
}
```

- [ ] **Step 6: Add script-level export assertions**

In `packages/shared/scripts/test.ts`, extend the existing import from `../src`:

```ts
  PROJECT_PERMISSIONS,
  getDefaultProjectRolePermissions,
  hasProjectPermission,
```

Add these assertions after the existing permission assertions:

```ts
assert.equal(PROJECT_PERMISSIONS.includes("version.review"), true);
assert.equal(getDefaultProjectRolePermissions("director").includes("version.review"), true);
assert.equal(hasProjectPermission({
  userId: "director-1",
  globalRole: "user",
  teamRoles: [],
  projectRoles: ["director"],
}, "version.review"), true);
```

- [ ] **Step 7: Run shared verification**

Run:

```bash
npm --workspace @dramaflow/shared run test
npm --workspace @dramaflow/shared run lint
```

Expected: both PASS. `canReviewProject` now returns true for `director`.

- [ ] **Step 8: Commit shared resolver changes**

```bash
git add packages/shared/src/domain.ts packages/shared/src/project-permissions.ts packages/shared/src/business-rules.ts packages/shared/src/business-rules.test.ts packages/shared/src/index.ts packages/shared/scripts/test.ts
git commit -m "feat(shared): add project permission resolver"
```

---

### Task 2: API Contracts And Persistence Compatibility

**Files:**
- Modify: `packages/shared/src/api-contracts.ts`
- Modify: `packages/shared/scripts/test.ts`
- Modify: `apps/api/prisma/schema.prisma`
- Modify: `apps/api/src/common/dev-database.service.ts`
- Modify: `apps/api/src/common/database.types.test.ts`

- [ ] **Step 1: Write failing type-contract assertions**

In `packages/shared/scripts/test.ts`, import these types from `../src`:

```ts
import type {
  ProjectMemberPermissionsResponse,
  ProjectMemberSummary,
  TeamPermissionTemplatesResponse,
  UpdateProjectMemberPermissionsPayload,
  UpdateTeamPermissionTemplatesPayload,
} from "../src";
```

Add these compile-time contract samples before `console.log("shared tests passed");`:

```ts
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
```

- [ ] **Step 2: Run the shared lint and confirm missing contract errors**

Run:

```bash
npm --workspace @dramaflow/shared run lint
```

Expected: FAIL because `ProjectMemberPermissionsResponse`, `TeamPermissionTemplatesResponse`, `UpdateProjectMemberPermissionsPayload`, and `UpdateTeamPermissionTemplatesPayload` do not exist, and `ProjectMemberSummary` does not contain permission fields.

- [ ] **Step 3: Add API contract types**

In `packages/shared/src/api-contracts.ts`, add `PermissionOverride`, `ProjectPermission`, and `ProjectRolePermissionTemplates` to the `import type` list from `./domain`.

Replace `ProjectMemberSummary` with:

```ts
export interface ProjectMemberSummary extends Pick<ProjectMemberRecord, "id" | "userId" | "role" | "createdAt"> {
  displayName: string;
  email: string;
  inheritedPermissions: ProjectPermission[];
  permissionOverride: PermissionOverride;
  effectivePermissions: ProjectPermission[];
}
```

Add these interfaces near the team/project contract section:

```ts
export interface ProjectRolePermissionTemplateSummary {
  role: ProjectRole;
  systemPermissions: ProjectPermission[];
  teamPermissions?: ProjectPermission[];
  effectivePermissions: ProjectPermission[];
  locked: boolean;
}

export interface TeamPermissionTemplatesResponse {
  systemDefaults: Record<ProjectRole, ProjectPermission[]>;
  templates: ProjectRolePermissionTemplates;
  resolvedTemplates: ProjectRolePermissionTemplateSummary[];
}

export interface UpdateTeamPermissionTemplatesPayload {
  templates: ProjectRolePermissionTemplates;
}

export interface ProjectMemberPermissionsResponse {
  memberId: string;
  userId: string;
  role: ProjectRole;
  inheritedPermissions: ProjectPermission[];
  permissionOverride: PermissionOverride;
  effectivePermissions: ProjectPermission[];
}

export interface UpdateProjectMemberPermissionsPayload {
  permissionOverride: PermissionOverride;
}
```

Add `permissionTemplates` to `TeamSettingsResponse`:

```ts
  permissionTemplates?: TeamPermissionTemplatesResponse;
```

Add `currentUserPermissions` to `ProjectWorkspacePayload`:

```ts
  currentUserPermissions: ProjectPermission[];
```

- [ ] **Step 4: Update target Prisma schema**

In `apps/api/prisma/schema.prisma`, add this field to `model Team`:

```prisma
  projectRolePermissionTemplates Json?
```

Add this field to `model ProjectMember`:

```prisma
  permissionOverride Json?
```

- [ ] **Step 5: Normalize permission fields in the JSON database service**

In `apps/api/src/common/dev-database.service.ts`, extend the shared import:

```ts
import {
  normalizePermissionOverride,
  normalizeProjectRolePermissionTemplates,
  type ImageGenerationConfig,
  type ProviderEntry,
} from "@dramaflow/shared";
```

Inside `normalize`, after the existing team provider migration loop, add:

```ts
    for (const team of db.teams) {
      const normalizedTemplates = normalizeProjectRolePermissionTemplates(team.projectRolePermissionTemplates);
      if (JSON.stringify(normalizedTemplates) !== JSON.stringify(team.projectRolePermissionTemplates ?? {})) {
        team.projectRolePermissionTemplates = Object.keys(normalizedTemplates).length > 0 ? normalizedTemplates : undefined;
        team.updatedAt = new Date().toISOString();
        changed = true;
      }
    }

    for (const member of db.projectMembers) {
      if (member.permissionOverride === undefined) {
        continue;
      }

      const normalizedOverride = normalizePermissionOverride(member.permissionOverride);
      if (JSON.stringify(normalizedOverride) !== JSON.stringify(member.permissionOverride)) {
        member.permissionOverride = normalizedOverride;
        changed = true;
      }
    }
```

- [ ] **Step 6: Add empty database compatibility assertions**

In `apps/api/src/common/database.types.test.ts`, add:

```ts
test("createEmptyDatabase is compatible with permission fields being absent", () => {
  const db = createEmptyDatabase();

  assert.deepEqual(db.teams.map((team) => team.projectRolePermissionTemplates), []);
  assert.deepEqual(db.projectMembers.map((member) => member.permissionOverride), []);
});
```

- [ ] **Step 7: Run contract and API common verification**

Run:

```bash
npm --workspace @dramaflow/shared run lint
npm --workspace @dramaflow/shared run test
npm --workspace @dramaflow/api exec tsx --test src/common/database.types.test.ts
```

Expected: all PASS.

- [ ] **Step 8: Commit contracts and persistence compatibility**

```bash
git add packages/shared/src/api-contracts.ts packages/shared/scripts/test.ts apps/api/prisma/schema.prisma apps/api/src/common/dev-database.service.ts apps/api/src/common/database.types.test.ts
git commit -m "feat(api): add permission contracts and storage fields"
```

---

### Task 3: Permission Template And Member Override Endpoints

**Files:**
- Modify: `apps/api/src/workspace/workspace.controller.ts`
- Modify: `apps/api/src/workspace/workspace.service.ts`
- Modify: `apps/api/scripts/test.ts`

- [ ] **Step 1: Add failing HTTP tests for template and override endpoints**

In `apps/api/scripts/test.ts`, add this `runCase` near the existing collaboration and audit tests:

```ts
  await runCase("project permission endpoints resolve templates and member overrides", async () => {
    await withHttpApp(async (baseUrl) => {
      const owner = await registerUser(baseUrl, {
        email: "permission-owner@example.com",
        displayName: "Permission Owner",
      });
      const writer = await registerUser(baseUrl, {
        email: "permission-writer@example.com",
        displayName: "Permission Writer",
      });
      const ownerJsonHeaders = authHeaders(owner.accessToken, true);
      const writerJsonHeaders = authHeaders(writer.accessToken, true);
      const teams = await listTeams(baseUrl, owner.accessToken);
      const teamId = teams[0].id;

      const projectResponse = await originalFetch(`${baseUrl}/projects`, {
        method: "POST",
        headers: ownerJsonHeaders,
        body: JSON.stringify({ teamId, name: "Permission Endpoint Project" }),
      });
      assert.equal(projectResponse.status, 201);
      const project = await projectResponse.json() as { id: string };

      const addWriterResponse = await originalFetch(`${baseUrl}/projects/${project.id}/members`, {
        method: "POST",
        headers: ownerJsonHeaders,
        body: JSON.stringify({ email: writer.user.email, role: "writer" }),
      });
      assert.equal(addWriterResponse.status, 201);
      const writerMember = await addWriterResponse.json() as { id: string; effectivePermissions: string[] };
      assert.equal(writerMember.effectivePermissions.includes("project.edit"), true);

      const getTemplatesResponse = await originalFetch(`${baseUrl}/teams/${teamId}/permission-templates`, {
        headers: authHeaders(owner.accessToken),
      });
      assert.equal(getTemplatesResponse.status, 200);
      const defaultTemplates = await getTemplatesResponse.json() as {
        resolvedTemplates: Array<{ role: string; effectivePermissions: string[]; locked: boolean }>;
      };
      const directorTemplate = defaultTemplates.resolvedTemplates.find((item) => item.role === "director");
      assert.equal(directorTemplate?.effectivePermissions.includes("version.review"), true);

      const updateTemplatesResponse = await originalFetch(`${baseUrl}/teams/${teamId}/permission-templates`, {
        method: "PUT",
        headers: ownerJsonHeaders,
        body: JSON.stringify({
          templates: {
            writer: ["project.view", "version.review", "bad.permission"],
          },
        }),
      });
      assert.equal(updateTemplatesResponse.status, 200);
      const updatedTemplates = await updateTemplatesResponse.json() as {
        templates: { writer: string[] };
        resolvedTemplates: Array<{ role: string; effectivePermissions: string[] }>;
      };
      assert.deepEqual(updatedTemplates.templates.writer, ["project.view", "version.review"]);

      const deniedTemplateResponse = await originalFetch(`${baseUrl}/teams/${teamId}/permission-templates`, {
        method: "PUT",
        headers: writerJsonHeaders,
        body: JSON.stringify({ templates: { viewer: ["project.view", "project.edit"] } }),
      });
      assert.equal(deniedTemplateResponse.status, 403);

      const getMemberPermissionsResponse = await originalFetch(`${baseUrl}/projects/${project.id}/members/${writerMember.id}/permissions`, {
        headers: authHeaders(owner.accessToken),
      });
      assert.equal(getMemberPermissionsResponse.status, 200);
      const memberPermissions = await getMemberPermissionsResponse.json() as {
        inheritedPermissions: string[];
        permissionOverride: { allow: string[]; deny: string[] };
        effectivePermissions: string[];
      };
      assert.deepEqual(memberPermissions.inheritedPermissions, ["project.view", "version.review"]);
      assert.deepEqual(memberPermissions.permissionOverride, { allow: [], deny: [] });

      const updateMemberPermissionsResponse = await originalFetch(`${baseUrl}/projects/${project.id}/members/${writerMember.id}/permissions`, {
        method: "PUT",
        headers: ownerJsonHeaders,
        body: JSON.stringify({
          permissionOverride: {
            allow: ["job.manage", "bad.permission"],
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
    });
  });
```

- [ ] **Step 2: Run the API tests and confirm the expected failure**

Run:

```bash
npm --workspace @dramaflow/api run test
```

Expected: FAIL with 404 responses for `/teams/:id/permission-templates` and `/projects/:id/members/:memberId/permissions`.

- [ ] **Step 3: Add controller routes**

In `apps/api/src/workspace/workspace.controller.ts`, extend the shared type import:

```ts
import type {
  AuditContentType,
  DocumentType,
  ExportFormat,
  ProjectRole,
  TimelineTrackRecord,
  UpdateProjectMemberPermissionsPayload,
  UpdateTeamPermissionTemplatesPayload,
} from "@dramaflow/shared";
```

Add these methods after `listTeamLlmModels`:

```ts
  @Get("teams/:id/permission-templates")
  getTeamPermissionTemplates(
    @CurrentUser() user: { id: string },
    @Param("id") teamId: string,
  ) {
    return this.workspaceService.getTeamPermissionTemplates(user.id, teamId);
  }

  @Put("teams/:id/permission-templates")
  updateTeamPermissionTemplates(
    @CurrentUser() user: { id: string },
    @Param("id") teamId: string,
    @Body() body: UpdateTeamPermissionTemplatesPayload,
  ) {
    return this.workspaceService.updateTeamPermissionTemplates(user.id, teamId, body);
  }
```

Add these methods after `addProjectMember`:

```ts
  @Get("projects/:projectId/members/:memberId/permissions")
  getProjectMemberPermissions(
    @CurrentUser() user: { id: string },
    @Param("projectId") projectId: string,
    @Param("memberId") memberId: string,
  ) {
    return this.workspaceService.getProjectMemberPermissions(user.id, projectId, memberId);
  }

  @Put("projects/:projectId/members/:memberId/permissions")
  updateProjectMemberPermissions(
    @CurrentUser() user: { id: string },
    @Param("projectId") projectId: string,
    @Param("memberId") memberId: string,
    @Body() body: UpdateProjectMemberPermissionsPayload,
  ) {
    return this.workspaceService.updateProjectMemberPermissions(user.id, projectId, memberId, body);
  }
```

- [ ] **Step 4: Add service imports and actor enrichment**

In `apps/api/src/workspace/workspace.service.ts`, extend imports from `@dramaflow/shared`:

```ts
  PROJECT_PERMISSIONS,
  PROJECT_ROLES,
  SYSTEM_PROJECT_ROLE_PERMISSION_TEMPLATES,
  getProjectRoleTemplatePermissions,
  hasProjectPermission,
  normalizePermissionOverride,
  normalizeProjectRolePermissionTemplates,
  resolveProjectPermissions,
  type AccessContext,
  type PermissionOverride,
  type ProjectMemberPermissionsResponse,
  type ProjectPermission,
  type ProjectRolePermissionTemplateSummary,
  type ProjectRolePermissionTemplates,
  type TeamPermissionTemplatesResponse,
  type UpdateProjectMemberPermissionsPayload,
  type UpdateTeamPermissionTemplatesPayload,
```

Replace the local `ActorContext` with:

```ts
interface ActorContext extends AccessContext {}
```

Update `getActor` to keep project member records aligned with roles:

```ts
  private async getActor(userId: string, projectId?: string, teamId?: string): Promise<ActorContext> {
    return this.database.query((db) => {
      const user = this.mustFindUser(db, userId);
      const resolvedProjectId = projectId;
      const resolvedTeamId = teamId ?? (resolvedProjectId ? this.mustFindProject(db, resolvedProjectId).teamId : undefined);
      const projectMembers = resolvedProjectId
        ? db.projectMembers.filter((member) => member.projectId === resolvedProjectId && member.userId === userId)
        : [];
      const team = resolvedTeamId ? this.mustFindTeam(db, resolvedTeamId) : undefined;

      return {
        userId,
        globalRole: user.globalRole,
        teamRoles: resolvedTeamId
          ? db.teamMembers.filter((member) => member.teamId === resolvedTeamId && member.userId === userId).map((member) => member.role)
          : [],
        projectRoles: projectMembers.map((member) => member.role),
        projectMembers: projectMembers.map((member) => ({
          role: member.role,
          permissionOverride: normalizePermissionOverride(member.permissionOverride),
        })),
        projectRolePermissionTemplates: team?.projectRolePermissionTemplates,
      };
    });
  }
```

- [ ] **Step 5: Add permission response builders**

In `WorkspaceService`, add these private methods near `buildTeamSettingsResponse`:

```ts
  private buildTeamPermissionTemplatesResponse(team: DevDatabase["teams"][number]): TeamPermissionTemplatesResponse {
    const templates = normalizeProjectRolePermissionTemplates(team.projectRolePermissionTemplates);
    const resolvedTemplates: ProjectRolePermissionTemplateSummary[] = PROJECT_ROLES.map((role) => {
      const teamPermissions = templates[role];
      return {
        role,
        systemPermissions: [...SYSTEM_PROJECT_ROLE_PERMISSION_TEMPLATES[role]],
        ...(teamPermissions ? { teamPermissions } : {}),
        effectivePermissions: getProjectRoleTemplatePermissions(role, templates),
        locked: role === "project_admin",
      };
    });

    return {
      systemDefaults: SYSTEM_PROJECT_ROLE_PERMISSION_TEMPLATES,
      templates,
      resolvedTemplates,
    };
  }

  private buildMemberPermissionsResponse(
    db: DevDatabase,
    project: DevDatabase["projects"][number],
    member: ProjectMemberRecord,
  ): ProjectMemberPermissionsResponse {
    const team = this.mustFindTeam(db, project.teamId);
    const permissionOverride = normalizePermissionOverride(member.permissionOverride);
    const inheritedPermissions = getProjectRoleTemplatePermissions(member.role, team.projectRolePermissionTemplates);
    const effectivePermissions = resolveProjectPermissions({
      userId: member.userId,
      globalRole: this.mustFindUser(db, member.userId).globalRole,
      teamRoles: db.teamMembers.filter((item) => item.teamId === project.teamId && item.userId === member.userId).map((item) => item.role),
      projectRoles: [member.role],
      projectMembers: [{ role: member.role, permissionOverride }],
      projectRolePermissionTemplates: team.projectRolePermissionTemplates,
    });

    return {
      memberId: member.id,
      userId: member.userId,
      role: member.role,
      inheritedPermissions,
      permissionOverride,
      effectivePermissions,
    };
  }
```

Update `buildTeamSettingsResponse` to include templates:

```ts
      permissionTemplates: this.buildTeamPermissionTemplatesResponse(team),
```

Update `buildProjectMemberSummary` to include permission fields:

```ts
    const project = this.mustFindProject(db, member.projectId);
    const permissions = this.buildMemberPermissionsResponse(db, project, member);
    return {
      id: member.id,
      userId: member.userId,
      role: member.role,
      createdAt: member.createdAt,
      displayName: user.displayName,
      email: user.email,
      inheritedPermissions: permissions.inheritedPermissions,
      permissionOverride: permissions.permissionOverride,
      effectivePermissions: permissions.effectivePermissions,
    };
```

- [ ] **Step 6: Add endpoint service methods**

Add these public methods to `WorkspaceService` near `getTeamSettings`:

```ts
  async getTeamPermissionTemplates(userId: string, teamId: string): Promise<TeamPermissionTemplatesResponse> {
    const actor = await this.getActor(userId, undefined, teamId);
    if (!canManageTenant(actor)) {
      throw new ForbiddenException("You do not have permission to view team permission templates");
    }

    return this.database.query((db) => this.buildTeamPermissionTemplatesResponse(this.mustFindTeam(db, teamId)));
  }

  async updateTeamPermissionTemplates(
    userId: string,
    teamId: string,
    input: UpdateTeamPermissionTemplatesPayload,
  ): Promise<TeamPermissionTemplatesResponse> {
    const actor = await this.getActor(userId, undefined, teamId);
    if (!canManageTenant(actor)) {
      throw new ForbiddenException("Only team admins can update permission templates");
    }

    return this.database.mutate((db) => {
      const team = this.mustFindTeam(db, teamId);
      team.projectRolePermissionTemplates = normalizeProjectRolePermissionTemplates(input.templates);
      team.updatedAt = new Date().toISOString();
      return this.buildTeamPermissionTemplatesResponse(team);
    });
  }
```

Add these methods near `addProjectMember`:

```ts
  async getProjectMemberPermissions(
    userId: string,
    projectId: string,
    memberId: string,
  ): Promise<ProjectMemberPermissionsResponse> {
    const actor = await this.getActor(userId, projectId);
    if (!hasProjectPermission(actor, "permission.manage") && !canManageTenant(actor)) {
      throw new ForbiddenException("You do not have permission to view project member permissions");
    }

    return this.database.query((db) => {
      const project = this.mustFindProject(db, projectId);
      const member = this.mustFindProjectMember(db, projectId, memberId);
      return this.buildMemberPermissionsResponse(db, project, member);
    });
  }

  async updateProjectMemberPermissions(
    userId: string,
    projectId: string,
    memberId: string,
    input: UpdateProjectMemberPermissionsPayload,
  ): Promise<ProjectMemberPermissionsResponse> {
    const actor = await this.getActor(userId, projectId);
    if (!hasProjectPermission(actor, "permission.manage") && !canManageTenant(actor)) {
      throw new ForbiddenException("You do not have permission to update project member permissions");
    }

    return this.database.mutate((db) => {
      const project = this.mustFindProject(db, projectId);
      const member = this.mustFindProjectMember(db, projectId, memberId);
      const nextOverride = normalizePermissionOverride(input.permissionOverride);

      if (this.removesOwnLastPermissionManager(db, project, member, userId, nextOverride)) {
        throw new BadRequestException("You cannot remove your own last permission management path");
      }

      member.permissionOverride = nextOverride;
      return this.buildMemberPermissionsResponse(db, project, member);
    });
  }
```

Add these private helpers near `mustFindProject`:

```ts
  private mustFindProjectMember(db: DevDatabase, projectId: string, memberId: string): ProjectMemberRecord {
    const member = db.projectMembers.find((item) => item.id === memberId && item.projectId === projectId);
    if (!member) {
      throw new NotFoundException("Project member not found");
    }
    return member;
  }

  private removesOwnLastPermissionManager(
    db: DevDatabase,
    project: DevDatabase["projects"][number],
    member: ProjectMemberRecord,
    actorUserId: string,
    nextOverride: PermissionOverride,
  ): boolean {
    if (member.userId !== actorUserId) {
      return false;
    }

    const members = db.projectMembers.filter((item) => item.projectId === project.id);
    const hasPermissionManage = (item: ProjectMemberRecord) => this.buildMemberPermissionsResponse(db, project, item)
      .effectivePermissions.includes("permission.manage");
    const managersBefore = members.filter(hasPermissionManage);

    if (managersBefore.length !== 1 || managersBefore[0]?.id !== member.id) {
      return false;
    }

    const nextMember = { ...member, permissionOverride: nextOverride };
    return !members
      .map((item) => item.id === member.id ? nextMember : item)
      .some(hasPermissionManage);
  }
```

- [ ] **Step 7: Run endpoint tests**

Run:

```bash
npm --workspace @dramaflow/api run test
```

Expected: PASS for the new permission endpoint test and all existing API tests.

- [ ] **Step 8: Commit endpoint changes**

```bash
git add apps/api/src/workspace/workspace.controller.ts apps/api/src/workspace/workspace.service.ts apps/api/scripts/test.ts
git commit -m "feat(api): expose project permission endpoints"
```

---

### Task 4: Permission-Based Backend Enforcement

**Files:**
- Modify: `apps/api/src/workspace/workspace.service.ts`
- Modify: `apps/api/src/jobs/jobs.service.ts`
- Modify: `apps/api/scripts/test.ts`

- [ ] **Step 1: Add failing enforcement tests**

Add this `runCase` to `apps/api/scripts/test.ts` after the endpoint test from Task 3:

```ts
  await runCase("project permissions enforce review member job timeline and export actions", async () => {
    await withHttpApp(async (baseUrl) => {
      const owner = await registerUser(baseUrl, { email: "enforce-owner@example.com", displayName: "Enforce Owner" });
      const director = await registerUser(baseUrl, { email: "enforce-director@example.com", displayName: "Enforce Director" });
      const writer = await registerUser(baseUrl, { email: "enforce-writer@example.com", displayName: "Enforce Writer" });
      const viewer = await registerUser(baseUrl, { email: "enforce-viewer@example.com", displayName: "Enforce Viewer" });
      const ownerJsonHeaders = authHeaders(owner.accessToken, true);
      const directorJsonHeaders = authHeaders(director.accessToken, true);
      const writerJsonHeaders = authHeaders(writer.accessToken, true);
      const viewerJsonHeaders = authHeaders(viewer.accessToken, true);

      const teams = await listTeams(baseUrl, owner.accessToken);
      const teamId = teams[0].id;
      const projectResponse = await originalFetch(`${baseUrl}/projects`, {
        method: "POST",
        headers: ownerJsonHeaders,
        body: JSON.stringify({ teamId, name: "Enforcement Project", reviewPolicyMode: "required" }),
      });
      assert.equal(projectResponse.status, 201);
      const project = await projectResponse.json() as { id: string };

      const addDirectorResponse = await originalFetch(`${baseUrl}/projects/${project.id}/members`, {
        method: "POST",
        headers: ownerJsonHeaders,
        body: JSON.stringify({ email: director.user.email, role: "director" }),
      });
      assert.equal(addDirectorResponse.status, 201);
      const directorMember = await addDirectorResponse.json() as { id: string };

      const addWriterResponse = await originalFetch(`${baseUrl}/projects/${project.id}/members`, {
        method: "POST",
        headers: ownerJsonHeaders,
        body: JSON.stringify({ email: writer.user.email, role: "writer" }),
      });
      assert.equal(addWriterResponse.status, 201);
      const writerMember = await addWriterResponse.json() as { id: string };

      const addViewerResponse = await originalFetch(`${baseUrl}/projects/${project.id}/members`, {
        method: "POST",
        headers: ownerJsonHeaders,
        body: JSON.stringify({ email: viewer.user.email, role: "viewer" }),
      });
      assert.equal(addViewerResponse.status, 201);

      const projectPayloadResponse = await originalFetch(`${baseUrl}/projects/${project.id}`, {
        headers: authHeaders(owner.accessToken),
      });
      assert.equal(projectPayloadResponse.status, 200);
      const projectPayload = await projectPayloadResponse.json() as {
        documents: Array<{ id: string; type: string }>;
      };
      const scriptDocument = projectPayload.documents.find((document) => document.type === "script");
      assert.ok(scriptDocument);

      const versionResponse = await originalFetch(`${baseUrl}/documents/${scriptDocument.id}/versions`, {
        method: "POST",
        headers: ownerJsonHeaders,
        body: JSON.stringify({
          title: "Manual Review",
          content: { logline: "Permission review", premise: "A test.", characters: [], scenes: [] },
        }),
      });
      assert.equal(versionResponse.status, 201);
      const version = await versionResponse.json() as { id: string };

      const submitResponse = await originalFetch(`${baseUrl}/versions/${version.id}/submit`, {
        method: "POST",
        headers: authHeaders(owner.accessToken),
      });
      assert.equal(submitResponse.status, 201);

      const directorApproveResponse = await originalFetch(`${baseUrl}/versions/${version.id}/approve`, {
        method: "POST",
        headers: directorJsonHeaders,
        body: JSON.stringify({ comment: "Director approved." }),
      });
      assert.equal(directorApproveResponse.status, 201);

      const deniedOverrideResponse = await originalFetch(`${baseUrl}/projects/${project.id}/members/${directorMember.id}/permissions`, {
        method: "PUT",
        headers: ownerJsonHeaders,
        body: JSON.stringify({ permissionOverride: { allow: [], deny: ["version.review"] } }),
      });
      assert.equal(deniedOverrideResponse.status, 200);

      const secondVersionResponse = await originalFetch(`${baseUrl}/documents/${scriptDocument.id}/versions`, {
        method: "POST",
        headers: ownerJsonHeaders,
        body: JSON.stringify({
          title: "Denied Review",
          content: { logline: "Denied", premise: "A test.", characters: [], scenes: [] },
        }),
      });
      assert.equal(secondVersionResponse.status, 201);
      const secondVersion = await secondVersionResponse.json() as { id: string };
      await originalFetch(`${baseUrl}/versions/${secondVersion.id}/submit`, {
        method: "POST",
        headers: authHeaders(owner.accessToken),
      });

      const deniedDirectorApproveResponse = await originalFetch(`${baseUrl}/versions/${secondVersion.id}/approve`, {
        method: "POST",
        headers: directorJsonHeaders,
        body: JSON.stringify({ comment: "Should fail." }),
      });
      assert.equal(deniedDirectorApproveResponse.status, 403);

      const allowWriterReviewResponse = await originalFetch(`${baseUrl}/projects/${project.id}/members/${writerMember.id}/permissions`, {
        method: "PUT",
        headers: ownerJsonHeaders,
        body: JSON.stringify({ permissionOverride: { allow: ["version.review"], deny: [] } }),
      });
      assert.equal(allowWriterReviewResponse.status, 200);

      const writerApproveResponse = await originalFetch(`${baseUrl}/versions/${secondVersion.id}/approve`, {
        method: "POST",
        headers: writerJsonHeaders,
        body: JSON.stringify({ comment: "Writer approved by override." }),
      });
      assert.equal(writerApproveResponse.status, 201);

      const viewerAddMemberResponse = await originalFetch(`${baseUrl}/projects/${project.id}/members`, {
        method: "POST",
        headers: viewerJsonHeaders,
        body: JSON.stringify({ email: "nobody@example.com", role: "viewer" }),
      });
      assert.equal(viewerAddMemberResponse.status, 403);

      const viewerBatchResponse = await originalFetch(`${baseUrl}/projects/${project.id}/batch-image-jobs`, {
        method: "POST",
        headers: viewerJsonHeaders,
        body: JSON.stringify({ shotIds: ["shot-permission-1"] }),
      });
      assert.equal(viewerBatchResponse.status, 403);

      const viewerExportResponse = await originalFetch(`${baseUrl}/projects/${project.id}/export-jobs`, {
        method: "POST",
        headers: viewerJsonHeaders,
        body: JSON.stringify({ resolution: "1080x1920", fps: 30, format: "mp4" }),
      });
      assert.equal(viewerExportResponse.status, 403);

      const ownerWorkspaceResponse = await originalFetch(`${baseUrl}/projects/${project.id}`, {
        headers: authHeaders(owner.accessToken),
      });
      assert.equal(ownerWorkspaceResponse.status, 200);
      const ownerWorkspace = await ownerWorkspaceResponse.json() as { currentUserPermissions: string[] };
      assert.equal(ownerWorkspace.currentUserPermissions.includes("permission.manage"), true);
    });
  });
```

- [ ] **Step 2: Run the API tests and confirm enforcement failures**

Run:

```bash
npm --workspace @dramaflow/api run test
```

Expected: FAIL because viewer batch and export endpoints still allow readable project users, and the workspace payload does not yet include `currentUserPermissions`.

- [ ] **Step 3: Add a public project permission assertion to WorkspaceService**

In `apps/api/src/workspace/workspace.service.ts`, add this public method near `getProject`:

```ts
  async assertProjectPermission(
    userId: string,
    projectId: string,
    permission: ProjectPermission,
    message = "You do not have permission to perform this project action",
  ): Promise<void> {
    const actor = await this.getActor(userId, projectId);
    if (!hasProjectPermission(actor, permission) && !canManageTenant(actor)) {
      throw new ForbiddenException(message);
    }
  }
```

- [ ] **Step 4: Add current user effective permissions to workspace payloads**

In `getProject`, compute permissions after `team` is loaded:

```ts
      const actorContext: ActorContext = {
        userId,
        globalRole: this.mustFindUser(db, userId).globalRole,
        teamRoles: db.teamMembers.filter((member) => member.teamId === team.id && member.userId === userId).map((member) => member.role),
        projectRoles: db.projectMembers.filter((member) => member.projectId === projectId && member.userId === userId).map((member) => member.role),
        projectMembers: db.projectMembers
          .filter((member) => member.projectId === projectId && member.userId === userId)
          .map((member) => ({ role: member.role, permissionOverride: normalizePermissionOverride(member.permissionOverride) })),
        projectRolePermissionTemplates: team.projectRolePermissionTemplates,
      };
```

Add this property to the returned payload:

```ts
        currentUserPermissions: resolveProjectPermissions(actorContext),
```

- [ ] **Step 5: Replace member-management checks**

In `inviteProjectMember` and `addProjectMember`, replace `canEditProject(actor)` with:

```ts
    if (!hasProjectPermission(actor, "member.manage") && !canManageTenant(actor)) {
      throw new ForbiddenException("Only project member managers can assign collaborators");
    }
```

Use the same message for both methods so tests can rely on status rather than exact text.

- [ ] **Step 6: Keep existing wrappers but route all project checks through effective permissions**

Confirm these methods still call shared wrappers that now use `hasProjectPermission`:

```ts
canEditProject(actor);
canReviewProject(actor);
canEditTimeline(actor);
canExportProject(actor);
```

Do not convert `deleteProject`; keep its existing `platform_super_admin` or `project_admin` check because project deletion is not in the first eight-permission set.

- [ ] **Step 7: Enforce job and export permissions in JobsService**

In `apps/api/src/jobs/jobs.service.ts`, replace the readable-only guard in `cancelJob` after the job lookup:

```ts
    await this.workspaceService.assertProjectPermission(
      userId,
      job.projectId,
      "job.manage",
      "You do not have permission to manage project jobs",
    );
```

Make the same replacement in `retryJob`.

At the beginning of `createBatchImageJobs` and `createBatchVideoJobs`, replace `await this.assertProjectReadable(userId, projectId);` with:

```ts
    await this.workspaceService.assertProjectPermission(
      userId,
      projectId,
      "job.manage",
      "You do not have permission to manage project jobs",
    );
```

At the beginning of `createExportJob`, replace `await this.assertProjectReadable(userId, projectId);` with:

```ts
    await this.workspaceService.assertProjectPermission(
      userId,
      projectId,
      "export.create",
      "You do not have permission to export this project",
    );
```

- [ ] **Step 8: Run backend verification**

Run:

```bash
npm --workspace @dramaflow/api run test
npm --workspace @dramaflow/api run lint
```

Expected: both PASS.

- [ ] **Step 9: Commit backend enforcement**

```bash
git add apps/api/src/workspace/workspace.service.ts apps/api/src/jobs/jobs.service.ts apps/api/scripts/test.ts
git commit -m "feat(api): enforce effective project permissions"
```

---

### Task 5: Frontend Permission Utilities And Labels

**Files:**
- Create: `apps/web/lib/project-permissions.ts`
- Modify: `apps/web/lib/i18n/messages.ts`
- Modify: `apps/web/lib/i18n/labels.ts`
- Modify: `apps/web/lib/query-keys.ts`

- [ ] **Step 1: Add a failing frontend type check target**

Create references to missing permission helpers in a new file `apps/web/lib/project-permissions.ts` by adding the file with these exports in Step 3. Before Step 3, run:

```bash
npm --workspace @dramaflow/web run lint
```

Expected: PASS before changes. This establishes the baseline.

- [ ] **Step 2: Add query keys**

In `apps/web/lib/query-keys.ts`, add:

```ts
  teamPermissionTemplates: (teamId: string) => ["team-permission-templates", teamId] as const,
  projectMemberPermissions: (projectId: string, memberId: string) => ["project-member-permissions", projectId, memberId] as const,
```

- [ ] **Step 3: Create the UI permission helper**

Create `apps/web/lib/project-permissions.ts`:

```ts
import {
  PROJECT_PERMISSIONS,
  type ProjectPermission,
  type ProjectRole,
} from "@dramaflow/shared";

import type { TranslateFn, TranslationKey } from "./i18n";

export const EDITABLE_PROJECT_ROLES: ProjectRole[] = [
  "director",
  "writer",
  "artist",
  "reviewer",
  "viewer",
];

export const PROJECT_PERMISSION_GROUPS: Array<{
  id: string;
  permissions: ProjectPermission[];
}> = [
  { id: "core", permissions: ["project.view", "project.edit"] },
  { id: "review", permissions: ["version.review"] },
  { id: "production", permissions: ["job.manage", "timeline.edit", "export.create"] },
  { id: "admin", permissions: ["member.manage", "permission.manage"] },
];

export function getProjectPermissionLabel(t: TranslateFn, permission: ProjectPermission) {
  return t(`enums.projectPermission.${permission}.label` as TranslationKey);
}

export function getProjectPermissionHelp(t: TranslateFn, permission: ProjectPermission) {
  return t(`enums.projectPermission.${permission}.help` as TranslationKey);
}

export function hasProjectPermission(permissions: readonly ProjectPermission[] | undefined, permission: ProjectPermission) {
  return Boolean(permissions?.includes(permission));
}

export function emptyPermissionState(): Record<ProjectPermission, boolean> {
  return Object.fromEntries(PROJECT_PERMISSIONS.map((permission) => [permission, false])) as Record<ProjectPermission, boolean>;
}
```

- [ ] **Step 4: Add labels in both locales**

In `apps/web/lib/i18n/messages.ts`, under each locale's `enums` object, add:

```ts
    projectPermission: {
      "project.view": { label: "View project", help: "Open the project workspace and read project content." },
      "project.edit": { label: "Edit project", help: "Edit project details, documents, versions, and world bible content." },
      "version.review": { label: "Review versions", help: "Approve or reject submitted versions." },
      "job.manage": { label: "Manage jobs", help: "Start batch jobs, cancel queued jobs, and retry failed jobs." },
      "timeline.edit": { label: "Edit timeline", help: "Save timeline edits and auto-assemble a cut." },
      "export.create": { label: "Create exports", help: "Create rendered export jobs from the timeline." },
      "member.manage": { label: "Manage members", help: "Invite or assign project collaborators." },
      "permission.manage": { label: "Manage permissions", help: "Edit project member permission overrides." },
    },
```

For the Chinese locale, use:

```ts
    projectPermission: {
      "project.view": { label: "查看项目", help: "进入项目工作区并查看项目内容。" },
      "project.edit": { label: "编辑项目", help: "编辑项目信息、文档、版本和世界观内容。" },
      "version.review": { label: "审核版本", help: "批准或拒绝已提交的版本。" },
      "job.manage": { label: "管理任务", help: "启动批量任务、取消排队任务并重试失败任务。" },
      "timeline.edit": { label: "编辑时间线", help: "保存时间线修改并自动组装成片。" },
      "export.create": { label: "创建导出", help: "基于时间线创建渲染导出任务。" },
      "member.manage": { label: "管理成员", help: "邀请或分配项目协作者。" },
      "permission.manage": { label: "管理权限", help: "编辑项目成员的权限覆盖规则。" },
    },
```

Add UI copy keys for team settings and member dialog in both locale objects:

```ts
permissionTemplatesTitle: "Project role permission templates",
permissionTemplatesDescription: "Set default permissions for each project role in this team.",
permissionTemplatesSave: "Save permission templates",
permissionTemplatesSaved: "Permission templates saved.",
permissionTemplatesSaveFailed: "Failed to save permission templates.",
permissionLocked: "Locked",
permissionsAction: "Permissions",
permissionsDialogTitle: "Project member permissions",
permissionsInherited: "Inherited",
permissionsAllow: "Allow",
permissionsDeny: "Deny",
permissionsEffective: "Effective",
permissionsSaved: "Project member permissions saved.",
permissionsSaveFailed: "Failed to save project member permissions.",
permissionsNoAccess: "You do not have permission to manage project permissions.",
```

For Chinese:

```ts
permissionTemplatesTitle: "项目角色权限模板",
permissionTemplatesDescription: "设置该团队内各项目角色的默认权限。",
permissionTemplatesSave: "保存权限模板",
permissionTemplatesSaved: "权限模板已保存。",
permissionTemplatesSaveFailed: "权限模板保存失败。",
permissionLocked: "已锁定",
permissionsAction: "权限",
permissionsDialogTitle: "项目成员权限",
permissionsInherited: "继承权限",
permissionsAllow: "允许",
permissionsDeny: "拒绝",
permissionsEffective: "最终权限",
permissionsSaved: "项目成员权限已保存。",
permissionsSaveFailed: "项目成员权限保存失败。",
permissionsNoAccess: "你没有管理项目权限的权限。",
```

- [ ] **Step 5: Add label wrapper**

In `apps/web/lib/i18n/labels.ts`, add `ProjectPermission` to the type import and add:

```ts
export function getProjectPermissionLabel(t: TranslateFn, value: ProjectPermission) {
  return t(`enums.projectPermission.${value}.label` as TranslationKey);
}
```

- [ ] **Step 6: Run frontend type verification**

Run:

```bash
npm --workspace @dramaflow/web run lint
```

Expected: PASS.

- [ ] **Step 7: Commit frontend permission utilities**

```bash
git add apps/web/lib/project-permissions.ts apps/web/lib/i18n/messages.ts apps/web/lib/i18n/labels.ts apps/web/lib/query-keys.ts
git commit -m "feat(web): add project permission labels"
```

---

### Task 6: Team Role Template Matrix UI

**Files:**
- Modify: `apps/web/components/team-settings-panel.tsx`
- Modify: `apps/web/lib/query-keys.ts`

- [ ] **Step 1: Add imports and state for team permission templates**

In `apps/web/components/team-settings-panel.tsx`, extend shared imports:

```ts
  PROJECT_PERMISSIONS,
  type ProjectPermission,
  type ProjectRolePermissionTemplates,
  type TeamPermissionTemplatesResponse,
  type UpdateTeamPermissionTemplatesPayload,
```

Add imports:

```ts
import {
  EDITABLE_PROJECT_ROLES,
  getProjectPermissionHelp,
  getProjectPermissionLabel,
} from "../lib/project-permissions";
```

Add state near other team settings state:

```ts
  const [permissionTemplates, setPermissionTemplates] = useState<ProjectRolePermissionTemplates>({});
```

- [ ] **Step 2: Add query and mutation**

Add a React Query call after `teamQuery`:

```ts
  const permissionTemplatesQuery = useQuery({
    queryKey: queryKeys.teamPermissionTemplates(selectedTeamId),
    queryFn: () => apiFetch<TeamPermissionTemplatesResponse>(`/teams/${selectedTeamId}/permission-templates`),
    enabled: Boolean(selectedTeamId),
  });
```

Add this effect:

```ts
  useEffect(() => {
    if (permissionTemplatesQuery.data) {
      setPermissionTemplates(permissionTemplatesQuery.data.templates);
    }
  }, [permissionTemplatesQuery.data]);
```

Add this mutation near `updateMutation`:

```ts
  const updatePermissionTemplatesMutation = useMutation({
    mutationFn: () => apiFetch<TeamPermissionTemplatesResponse>(`/teams/${selectedTeamId}/permission-templates`, {
      method: "PUT",
      body: { templates: permissionTemplates } satisfies UpdateTeamPermissionTemplatesPayload,
    }),
    onSuccess: async () => {
      setFeedback({ message: t("settingsPages.teamSettings.permissionTemplatesSaved"), error: null });
      await queryClient.invalidateQueries({ queryKey: queryKeys.teamPermissionTemplates(selectedTeamId) });
      await queryClient.invalidateQueries({ queryKey: queryKeys.teamSettings(selectedTeamId) });
    },
    onError: (error) => setFeedback({
      message: null,
      error: formatApiError(error, t, "settingsPages.teamSettings.permissionTemplatesSaveFailed"),
    }),
  });
```

- [ ] **Step 3: Add template update helpers**

Add these functions inside `TeamSettingsPanel` before the render returns:

```ts
  function isTemplatePermissionEnabled(role: ProjectRole, permission: ProjectPermission) {
    const template = permissionTemplates[role]
      ?? permissionTemplatesQuery.data?.resolvedTemplates.find((item) => item.role === role)?.effectivePermissions
      ?? [];
    return template.includes(permission);
  }

  function toggleTemplatePermission(role: ProjectRole, permission: ProjectPermission) {
    setPermissionTemplates((current) => {
      const currentPermissions = current[role]
        ?? permissionTemplatesQuery.data?.resolvedTemplates.find((item) => item.role === role)?.effectivePermissions
        ?? [];
      const nextSet = new Set(currentPermissions);
      if (nextSet.has(permission)) {
        nextSet.delete(permission);
      } else {
        nextSet.add(permission);
      }
      return {
        ...current,
        [role]: PROJECT_PERMISSIONS.filter((item) => nextSet.has(item)),
      };
    });
  }
```

- [ ] **Step 4: Render the matrix**

Insert this section after the basic team information section and before the LLM section:

```tsx
          <section className="team-section">
            <div className="team-section-header">
              <h2 className="team-section-title">
                {t("settingsPages.teamSettings.permissionTemplatesTitle")}
              </h2>
              <p className="team-section-desc">
                {t("settingsPages.teamSettings.permissionTemplatesDescription")}
              </p>
            </div>

            <div className="team-form-card">
              {permissionTemplatesQuery.isPending ? (
                <LoadingSkeleton rows={4} />
              ) : permissionTemplatesQuery.error ? (
                <InlineFeedback message={null} error={formatApiError(permissionTemplatesQuery.error, t, "settingsPages.teamSettings.permissionTemplatesSaveFailed")} />
              ) : (
                <div className="permission-matrix">
                  <div className="permission-matrix__header">
                    <span />
                    {PROJECT_PERMISSIONS.map((permission) => (
                      <span key={permission} title={getProjectPermissionHelp(t, permission)}>
                        {getProjectPermissionLabel(t, permission)}
                      </span>
                    ))}
                  </div>
                  <div className="permission-matrix__row permission-matrix__row--locked">
                    <strong>{getProjectRoleLabel(t, "project_admin")}</strong>
                    {PROJECT_PERMISSIONS.map((permission) => (
                      <span key={permission} className="permission-matrix__locked">{t("settingsPages.teamSettings.permissionLocked")}</span>
                    ))}
                  </div>
                  {EDITABLE_PROJECT_ROLES.map((role) => (
                    <div key={role} className="permission-matrix__row">
                      <strong>{getProjectRoleLabel(t, role)}</strong>
                      {PROJECT_PERMISSIONS.map((permission) => (
                        <label key={permission} className="permission-matrix__cell" title={getProjectPermissionHelp(t, permission)}>
                          <input
                            type="checkbox"
                            checked={isTemplatePermissionEnabled(role, permission)}
                            onChange={() => toggleTemplatePermission(role, permission)}
                          />
                        </label>
                      ))}
                    </div>
                  ))}
                  <div className="form-actions">
                    <button
                      className="btn btn-secondary"
                      type="button"
                      onClick={() => updatePermissionTemplatesMutation.mutate()}
                      disabled={updatePermissionTemplatesMutation.isPending}
                    >
                      {updatePermissionTemplatesMutation.isPending ? t("common.submitting") : t("settingsPages.teamSettings.permissionTemplatesSave")}
                    </button>
                  </div>
                </div>
              )}
            </div>
          </section>
```

- [ ] **Step 5: Add responsive CSS**

In `apps/web/app/globals.css`, add:

```css
.permission-matrix {
  display: grid;
  gap: var(--space-2);
  overflow-x: auto;
}

.permission-matrix__header,
.permission-matrix__row {
  display: grid;
  grid-template-columns: minmax(120px, 180px) repeat(8, minmax(92px, 1fr));
  align-items: center;
  gap: var(--space-2);
  min-width: 900px;
}

.permission-matrix__header {
  color: var(--text-tertiary);
  font-size: 12px;
  font-weight: 600;
}

.permission-matrix__row {
  min-height: 44px;
  border-top: 1px solid var(--border-subtle);
}

.permission-matrix__cell {
  display: flex;
  justify-content: center;
}

.permission-matrix__locked {
  color: var(--text-tertiary);
  font-size: 12px;
  text-align: center;
}
```

- [ ] **Step 6: Run frontend verification**

Run:

```bash
npm --workspace @dramaflow/web run lint
```

Expected: PASS.

- [ ] **Step 7: Commit team settings UI**

```bash
git add apps/web/components/team-settings-panel.tsx apps/web/app/globals.css apps/web/lib/query-keys.ts
git commit -m "feat(web): add team permission template matrix"
```

---

### Task 7: Project Member Permission Dialog And Action Visibility

**Files:**
- Create: `apps/web/components/project-workspace/member-permission-dialog.tsx`
- Modify: `apps/web/components/project-workspace/project-info-panel.tsx`
- Modify: `apps/web/components/project-workspace/right-context-panel.tsx`
- Modify: `apps/web/components/project-workspace/task-panel.tsx`
- Modify: `apps/web/components/project-workspace/timeline-editor.tsx`
- Modify: `apps/web/components/unified-workspace.tsx`

- [ ] **Step 1: Inspect the existing user change in unified workspace**

Run:

```bash
git diff -- apps/web/components/unified-workspace.tsx
```

Expected: review the current uncommitted user changes. During this task, edit only prop plumbing and do not revert unrelated diff hunks.

- [ ] **Step 2: Create the member permission dialog**

Create `apps/web/components/project-workspace/member-permission-dialog.tsx`:

```tsx
"use client";

import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  PROJECT_PERMISSIONS,
  type PermissionOverride,
  type ProjectMemberPermissionsResponse,
  type ProjectMemberSummary,
  type ProjectPermission,
  type UpdateProjectMemberPermissionsPayload,
} from "@dramaflow/shared";

import { apiFetch, formatApiError } from "../../lib/api";
import { useFeedback } from "../../lib/hooks";
import { useI18n, getProjectRoleLabel } from "../../lib/i18n";
import { getProjectPermissionHelp, getProjectPermissionLabel } from "../../lib/project-permissions";
import { queryKeys } from "../../lib/query-keys";
import { InlineFeedback } from "../inline-feedback";

interface Props {
  projectId: string;
  member: ProjectMemberSummary;
  onClose: () => void;
}

function togglePermission(list: ProjectPermission[], permission: ProjectPermission) {
  const next = new Set(list);
  if (next.has(permission)) {
    next.delete(permission);
  } else {
    next.add(permission);
  }
  return PROJECT_PERMISSIONS.filter((item) => next.has(item));
}

export function MemberPermissionDialog({ projectId, member, onClose }: Props) {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const { feedback, setFeedback } = useFeedback();
  const [override, setOverride] = useState<PermissionOverride>(member.permissionOverride);

  const permissionsQuery = useQuery({
    queryKey: queryKeys.projectMemberPermissions(projectId, member.id),
    queryFn: () => apiFetch<ProjectMemberPermissionsResponse>(`/projects/${projectId}/members/${member.id}/permissions`),
  });

  useEffect(() => {
    if (permissionsQuery.data) {
      setOverride(permissionsQuery.data.permissionOverride);
    }
  }, [permissionsQuery.data]);

  const saveMutation = useMutation({
    mutationFn: () => apiFetch<ProjectMemberPermissionsResponse>(`/projects/${projectId}/members/${member.id}/permissions`, {
      method: "PUT",
      body: { permissionOverride: override } satisfies UpdateProjectMemberPermissionsPayload,
    }),
    onSuccess: async () => {
      setFeedback({ message: t("projectWorkspace.collaboration.permissionsSaved"), error: null });
      await queryClient.invalidateQueries({ queryKey: queryKeys.project(projectId) });
      await queryClient.invalidateQueries({ queryKey: queryKeys.projectMemberPermissions(projectId, member.id) });
      onClose();
    },
    onError: (error) => setFeedback({
      message: null,
      error: formatApiError(error, t, "projectWorkspace.collaboration.permissionsSaveFailed"),
    }),
  });

  const source = permissionsQuery.data ?? {
    inheritedPermissions: member.inheritedPermissions,
    permissionOverride: member.permissionOverride,
    effectivePermissions: member.effectivePermissions,
  };

  return (
    <div className="modal-backdrop" role="presentation" onClick={onClose}>
      <div className="modal permission-dialog" role="dialog" aria-modal="true" onClick={(event) => event.stopPropagation()}>
        <div className="modal-header">
          <div>
            <h3>{t("projectWorkspace.collaboration.permissionsDialogTitle")}</h3>
            <p>{member.displayName} · {getProjectRoleLabel(t, member.role)}</p>
          </div>
          <button className="btn btn-ghost btn-sm" type="button" onClick={onClose}>{t("common.cancel")}</button>
        </div>
        <InlineFeedback message={feedback.message} error={feedback.error} />
        <div className="permission-dialog__grid">
          {PROJECT_PERMISSIONS.map((permission) => (
            <div key={permission} className="permission-dialog__row">
              <div>
                <strong>{getProjectPermissionLabel(t, permission)}</strong>
                <span>{getProjectPermissionHelp(t, permission)}</span>
              </div>
              <span>{source.inheritedPermissions.includes(permission) ? t("projectWorkspace.collaboration.permissionsInherited") : "-"}</span>
              <label>
                <input
                  type="checkbox"
                  checked={override.allow.includes(permission)}
                  onChange={() => setOverride((current) => ({ ...current, allow: togglePermission(current.allow, permission) }))}
                />
                {t("projectWorkspace.collaboration.permissionsAllow")}
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={override.deny.includes(permission)}
                  onChange={() => setOverride((current) => ({ ...current, deny: togglePermission(current.deny, permission) }))}
                />
                {t("projectWorkspace.collaboration.permissionsDeny")}
              </label>
              <span>{source.effectivePermissions.includes(permission) ? t("projectWorkspace.collaboration.permissionsEffective") : "-"}</span>
            </div>
          ))}
        </div>
        <div className="form-actions">
          <button className="btn btn-primary" type="button" onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending}>
            {saveMutation.isPending ? t("common.submitting") : t("common.save")}
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Gate project member controls**

In `project-info-panel.tsx`, import:

```ts
import { type ProjectPermission } from "@dramaflow/shared";
import { hasProjectPermission } from "../../lib/project-permissions";
import { MemberPermissionDialog } from "./member-permission-dialog";
```

Add local state:

```ts
  const [permissionMember, setPermissionMember] = useState<ProjectWorkspacePayload["members"][number] | null>(null);
  const permissions = payload.currentUserPermissions as ProjectPermission[];
  const canManageMembers = hasProjectPermission(permissions, "member.manage");
  const canManagePermissions = hasProjectPermission(permissions, "permission.manage");
```

Render the add button only when `canManageMembers`:

```tsx
            {canManageMembers && (
              <button
                className="pip-inline-action"
                type="button"
                onClick={() => setShowAddMember(!showAddMember)}
              >
                {showAddMember ? t("common.cancel") : t("projectWorkspace.collaboration.addTitle")}
              </button>
            )}
```

Render the add form only when `showAddMember && canManageMembers`.

Inside each member row, add:

```tsx
                {canManagePermissions && (
                  <button className="btn btn-ghost btn-sm" type="button" onClick={() => setPermissionMember(m)}>
                    {t("projectWorkspace.collaboration.permissionsAction")}
                  </button>
                )}
```

Before the closing root `</div>`, render:

```tsx
      {permissionMember && (
        <MemberPermissionDialog
          projectId={projectId}
          member={permissionMember}
          onClose={() => setPermissionMember(null)}
        />
      )}
```

- [ ] **Step 4: Gate right-context review and edit actions**

In `right-context-panel.tsx`, add `ProjectPermission` to imports and add a prop:

```ts
  permissions: ProjectPermission[];
```

Destructure `permissions` and compute:

```ts
  const canEditProject = permissions.includes("project.edit");
  const canReviewVersion = permissions.includes("version.review");
```

Change:

```ts
  const canReview = selectedVersion?.status === "pending_review" || selectedVersion?.status === "submitted";
```

to:

```ts
  const canReview = canReviewVersion && (selectedVersion?.status === "pending_review" || selectedVersion?.status === "submitted");
```

Change the edit action condition from:

```tsx
          {selectedVersion && !isEditing && (
```

to:

```tsx
          {selectedVersion && !isEditing && canEditProject && (
```

- [ ] **Step 5: Gate task actions**

In `task-panel.tsx`, add prop:

```ts
  canManageJobs?: boolean;
```

Change the function signature:

```ts
export function TaskPanel({ projectId, shotIds, imageConfigSource, selectedImageProvider, selectedVideoProvider, canManageJobs = false }: TaskPanelProps) {
```

Wrap the existing batch action block by changing its opening lines to:

```tsx
        {canManageJobs && (
          <div className="task-panel__actions">
```

Add these closing lines immediately after the existing `</div>` that closes `task-panel__actions`:

```tsx
        )}
```

Pass `canManageJobs` to every `JobRow` call:

```tsx
                canManageJobs={canManageJobs}
```

Extend `JobRow` props:

```ts
  canManageJobs: boolean;
```

Render cancel/retry buttons only when it is true by wrapping the existing row action block with:

```tsx
      {canManageJobs && (
        <div className="task-panel__row-actions">
        </div>
      )}
```

- [ ] **Step 6: Gate timeline and export controls**

In `timeline-editor.tsx`, add props:

```ts
  canEditTimeline?: boolean;
  canCreateExport?: boolean;
```

Default them to false in the component signature:

```ts
export function TimelineEditor({ projectId, data, onRefresh, canEditTimeline = false, canCreateExport = false }: TimelineEditorProps) {
```

Disable save/auto-assemble buttons when `!canEditTimeline`:

```tsx
disabled={saveMutation.isPending || !timeline || !canEditTimeline}
```

```tsx
disabled={autoAssembleMutation.isPending || !canEditTimeline}
```

Disable export buttons when `!canCreateExport`:

```tsx
disabled={exportMutation.isPending || totalDuration <= 0 || !canCreateExport}
```

- [ ] **Step 7: Pass permissions from unified workspace**

In `unified-workspace.tsx`, compute:

```ts
  const currentUserPermissions = payload.currentUserPermissions ?? [];
  const canManageJobs = currentUserPermissions.includes("job.manage");
  const canEditTimeline = currentUserPermissions.includes("timeline.edit");
  const canCreateExport = currentUserPermissions.includes("export.create");
```

Pass props:

```tsx
            <TaskPanel
              projectId={projectId}
              shotIds={storyboardShots.map((shot) => shot.id)}
              canManageJobs={canManageJobs}
            />
```

```tsx
            <TimelineEditor
              projectId={projectId}
              data={payload}
              canEditTimeline={canEditTimeline}
              canCreateExport={canCreateExport}
              onRefresh={() => {
                void queryClient.invalidateQueries({ queryKey: queryKeys.project(projectId) });
                void queryClient.invalidateQueries({ queryKey: queryKeys.timeline(projectId) });
                void queryClient.invalidateQueries({ queryKey: queryKeys.exports(projectId) });
                void queryClient.invalidateQueries({ queryKey: queryKeys.projectJobs(projectId) });
              }}
            />
```

Pass `permissions={currentUserPermissions}` to both `RightContextPanel` render sites.

- [ ] **Step 8: Add dialog CSS**

In `apps/web/app/globals.css`, add:

```css
.permission-dialog {
  width: min(920px, calc(100vw - 32px));
}

.permission-dialog__grid {
  display: grid;
  gap: var(--space-2);
  max-height: min(60vh, 560px);
  overflow: auto;
}

.permission-dialog__row {
  display: grid;
  grid-template-columns: minmax(180px, 1.5fr) 90px 110px 110px 90px;
  align-items: center;
  gap: var(--space-3);
  border-top: 1px solid var(--border-subtle);
  padding: var(--space-3) 0;
}

.permission-dialog__row strong,
.permission-dialog__row span {
  display: block;
}

.permission-dialog__row span {
  color: var(--text-tertiary);
  font-size: 12px;
}

@media (max-width: 720px) {
  .permission-dialog__row {
    grid-template-columns: 1fr;
    align-items: flex-start;
  }
}
```

- [ ] **Step 9: Run frontend verification**

Run:

```bash
npm --workspace @dramaflow/web run lint
npm run build
```

Expected: both PASS. The build is required because the workspace payload type changed and Next can catch route/component issues that package lint can miss.

- [ ] **Step 10: Commit frontend permission UI**

```bash
git add apps/web/components/project-workspace/member-permission-dialog.tsx apps/web/components/project-workspace/project-info-panel.tsx apps/web/components/project-workspace/right-context-panel.tsx apps/web/components/project-workspace/task-panel.tsx apps/web/components/project-workspace/timeline-editor.tsx apps/web/components/unified-workspace.tsx apps/web/app/globals.css
git commit -m "feat(web): drive workspace actions from permissions"
```

---

### Task 8: Full Verification And Runtime Smoke Test

**Files:**
- No planned source edits.

- [ ] **Step 1: Run full lint**

Run:

```bash
npm run lint
```

Expected: PASS for all workspaces.

- [ ] **Step 2: Run full tests**

Run:

```bash
npm test
```

Expected: PASS for shared and API test scripts.

- [ ] **Step 3: Run full build**

Run:

```bash
npm run build
```

Expected: PASS for shared, API, worker, and web build targets.

- [ ] **Step 4: Start local services for manual smoke**

Use two terminals:

```bash
npm run dev:api
```

```bash
npm run dev:web
```

Expected:
- API starts on its configured local port.
- Web starts on its configured local port.
- Logging in as a team owner shows the team permission matrix.
- A project owner sees `currentUserPermissions` include `permission.manage`.
- A director can approve a pending review version by default.
- After denying `version.review` to that director, the approve/reject controls disappear and API approval returns 403.
- A writer granted `version.review` can approve a pending review version.

- [ ] **Step 5: Final git status check**

Run:

```bash
git status --short
```

Expected: only intentionally uncommitted local environment files or pre-existing user edits remain. If `apps/web/components/unified-workspace.tsx` still has user changes outside the permission prop plumbing, preserve them.

---

## Self-Review

- Spec coverage: The plan adds the eight project permissions, default director review, team role templates, project member allow/deny overrides, deny-wins resolution, high-trust super admin and project admin behavior, effective permissions in workspace payloads, template endpoints, member override endpoints, backend authorization, and frontend permission-driven controls.
- Compatibility: The plan keeps runtime storage on `DevDatabaseService` and uses `query/mutate`. Existing `canEditProject`, `canReviewProject`, `canManageJobs`, `canEditTimeline`, and `canExportProject` call sites continue to compile through wrappers.
- Safety: The plan rejects invalid permission strings through normalization, locks `project_admin`, prevents self-removal of the final project-level `permission.manage` path, and keeps project deletion on the existing project admin/platform super admin rule because deletion is outside the first permission set.
- Verification: Each implementation task has a failing check first, a passing verification command, and a focused commit. Final verification runs `npm run lint`, `npm test`, and `npm run build`.
