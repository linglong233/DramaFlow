# Project Permission System Design

Date: 2026-05-21

## Context

DramaFlow currently uses fixed role arrays in shared business rules to decide project actions. For example, version review is limited to `project_admin` and `reviewer`, while `director` can edit projects, manage jobs, edit timelines, and export, but cannot manually approve or reject versions.

The next UX direction is a professional shot review workspace. Before building it, the permission model should become assignable and explainable instead of adding one-off role exceptions. This design introduces a unified project permission system with team-level role templates and project-level member overrides.

## Goals

- Replace fixed project role checks with explicit project permissions.
- Give `director` default review authority.
- Let teams define their own project role permission templates.
- Let project-level managers allow or deny specific permissions for individual project members.
- Return effective permissions to the frontend so UI actions are driven by permissions, not role names.
- Preserve compatibility with existing development JSON data.

## Non-Goals

- Do not migrate runtime storage to Prisma or PostgreSQL.
- Do not introduce a full resource/action RBAC or ABAC engine in this iteration.
- Do not implement the shot review workspace in this spec.
- Do not add organization-wide billing, compliance, or audit policy controls.
- Do not remove existing project roles.

## Confirmed Product Decisions

| Topic | Decision |
| --- | --- |
| Approach | Permission resolver with team templates and project overrides |
| Template scope | Team role templates override system role defaults |
| Override scope | Project member overrides support explicit `allow` and `deny` |
| Deny behavior | `deny` wins over `allow` and inherited permissions |
| Default director permissions | Directors can review versions by default |
| First permission set | Eight core project permissions |
| Template management | Team owners, team admins, and platform super admins |
| Project override management | Users with `permission.manage`, team admins, and platform super admins |
| Implementation order | Permissions first, shot review workspace later |

## Permission Model

Add a shared `ProjectPermission` type:

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
```

Add a shared override shape:

```ts
export interface PermissionOverride {
  allow: ProjectPermission[];
  deny: ProjectPermission[];
}
```

The system resolves permissions from three layers:

1. System default role template.
2. Team role permission template, if configured for the role.
3. Project member override with `allow[]` and `deny[]`.

Final calculation:

```text
base = teamRoleTemplate[projectRole] ?? systemDefaultTemplate[projectRole]
effective = (base + member.allow) - member.deny
```

`project_admin` always has all project permissions. `platform_super_admin` always has all permissions. These two high-trust paths cannot be weakened by project member overrides.

## Default Role Template

System defaults:

| Project Role | Default Permissions |
| --- | --- |
| `project_admin` | All project permissions |
| `director` | `project.view`, `project.edit`, `version.review`, `job.manage`, `timeline.edit`, `export.create` |
| `writer` | `project.view`, `project.edit` |
| `artist` | `project.view`, `project.edit` |
| `reviewer` | `project.view`, `version.review` |
| `viewer` | `project.view` |

This intentionally changes the current behavior: directors can approve and reject reviewable versions by default. Directors still do not manage members or permissions unless granted by a team template or project override.

## Data Model

Keep the current `DevDatabaseService` JSON runtime storage.

Add optional team-level role templates to the team record:

```ts
projectRolePermissionTemplates?: Partial<Record<ProjectRole, ProjectPermission[]>>;
```

Add optional project member overrides:

```ts
permissionOverride?: PermissionOverride;
```

Database compatibility:

- New teams omit `projectRolePermissionTemplates` until a template is saved.
- New project members omit `permissionOverride` until an override is saved.
- Loading old JSON files must tolerate missing `projectRolePermissionTemplates`.
- Loading old project members must treat missing `permissionOverride` as `{ allow: [], deny: [] }`.

## Shared Rules

Add shared helpers in `packages/shared/src/business-rules.ts` or a focused permission helper module exported from `packages/shared/src/index.ts`:

- `getDefaultProjectRolePermissions(role)`
- `resolveProjectPermissions(context)`
- `hasProjectPermission(context, permission)`
- compatibility wrappers for existing behavior:
  - `canEditProject(context)` maps to `project.edit`
  - `canReviewProject(context)` maps to `version.review`
  - `canManageJobs(context)` maps to `job.manage`
  - `canEditTimeline(context)` maps to `timeline.edit`
  - `canExportProject(context)` maps to `export.create`

Existing call sites can migrate incrementally by keeping these wrapper names while changing their internals.

## API Design

Add team template endpoints:

| Method | Endpoint | Purpose |
| --- | --- | --- |
| `GET` | `/teams/:id/permission-templates` | Return system defaults, team templates, and resolved role templates |
| `PUT` | `/teams/:id/permission-templates` | Replace team role permission templates |

Add project member permission endpoints:

| Method | Endpoint | Purpose |
| --- | --- | --- |
| `GET` | `/projects/:id/members/:memberId/permissions` | Return role, inherited template permissions, project override, and effective permissions |
| `PUT` | `/projects/:id/members/:memberId/permissions` | Replace the member `allow[]` and `deny[]` override |

Project workspace payloads should include the current user's effective project permissions. Project member listings should include each member's `permissionOverride`, inherited template permissions, and effective permissions so the management UI can explain permission sources without extra lookups for the initial list.

Endpoint authorization:

- Team permission templates can be changed by `tenant_owner`, `tenant_admin`, and `platform_super_admin`.
- Project member permission overrides can be changed by users with `permission.manage`, team admins, and platform super admins.
- Member management remains controlled by `member.manage`.

## Frontend Design

### Team Settings

Add a "Project Role Permission Templates" section to the existing team settings area.

Use a compact permission matrix:

- Rows: `director`, `writer`, `artist`, `reviewer`, `viewer`.
- Columns: the eight project permissions.
- Cells: checkbox or switch.
- `project_admin` is shown as all permissions and locked.

Each permission should have a concise label and help text, such as "Review versions" for `version.review`.

### Project Members

In the project info panel's member list, add a permission action for users who can manage permissions.

The permission dialog shows:

- Member name and role.
- Inherited permissions from system/team template.
- Project-level `allow` overrides.
- Project-level `deny` overrides.
- Final effective permissions.

Users edit only `allow` and `deny`, not the final calculated permissions. This keeps inheritance explainable and prevents the UI from hiding why a permission is active.

### Workspace Actions

The frontend should not duplicate permission rules. It should consume effective permissions from the API and use them for action visibility:

- `version.review`: approve and reject.
- `job.manage`: cancel, retry, and batch task actions.
- `timeline.edit`: save and auto-assemble timeline.
- `export.create`: export actions.
- `member.manage`: add, remove, and change project members.
- `permission.manage`: open project member permission controls.

## Backend Integration

The backend should introduce a single effective-permission builder near existing access-context construction. Services should call shared permission helpers instead of role arrays.

Migration sequence:

1. Add shared permission types, templates, resolver, and tests.
2. Add database fields and load-time compatibility.
3. Add API service methods and endpoints for team templates and member overrides.
4. Include current user effective permissions in project workspace payloads.
5. Replace version review, job management, timeline editing, export, member management, and permission management checks with permission-based checks.
6. Update frontend action visibility and management UI.

## Safety Rules

- `project_admin` always has all project permissions.
- `platform_super_admin` always has all permissions.
- A user cannot remove their own last path to `permission.manage` when they are the final project-level permission manager.
- Team templates cannot be edited by ordinary project members.
- Project overrides cannot modify team templates.
- `deny` wins over inherited and explicitly allowed permissions.
- Invalid permission strings are rejected by API validation.

## Testing

Shared tests should cover:

- `director` defaults include `version.review`.
- Team templates override system defaults.
- Project `allow` grants a permission absent from the template.
- Project `deny` removes a permission present in the template.
- `deny` wins over `allow`.
- `project_admin` and `platform_super_admin` always resolve to all permissions.

API tests should cover:

- Directors can approve and reject versions by default.
- A director denied `version.review` cannot approve or reject.
- A writer allowed `version.review` can approve or reject.
- Users without `permission.manage` cannot update project member overrides.
- Team admins can update team permission templates.
- Non-team-admin project members cannot update team templates.

Frontend verification should cover:

- Team template matrix loads, saves, and refreshes.
- Project permission dialog displays inherited, allow, deny, and effective permissions.
- Review, job, timeline, export, member, and permission controls follow effective permissions.
- Existing projects and members without new fields still render normally.

## Rollout Notes

Implement the permission system before the shot review workspace. The shot review workspace should then depend on `version.review` for first-version approval actions, or on a later `shot.review` permission if the permission set is expanded.

README files do not need updates unless the permission system is promoted as user-facing documentation. If one README is changed later, update `README.md` and `README_ZH.md` together.
