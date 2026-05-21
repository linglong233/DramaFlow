# Project Permission Fix Design

Date: 2026-05-21

## Context

Claude Code implemented the assignable project permission system from the previous plan. The implementation added the shared resolver, team permission templates, project member overrides, effective permissions in the project workspace payload, and frontend permission-driven controls.

Review found the implementation is structurally close, but not ready to accept:

- `project.view` is exposed as a permission but is not enforced by project read APIs.
- Team admins can pass some backend permission checks through `canManageTenant`, but `currentUserPermissions` may be empty for those same users, so the frontend can hide actions the API allows.
- API updates silently normalize invalid permission strings instead of rejecting them.
- `npm --workspace @dramaflow/api run test` currently fails in the existing image generation prompt test at `apps/api/scripts/test.ts:1436`.

This fix should make the permission system contract real and return the whole repo to green verification.

## Goals

- Enforce `project.view` on project resource reads.
- Keep backend authorization and `currentUserPermissions` consistent for team owners and team admins.
- Reject invalid permission strings in API endpoint input with HTTP 400.
- Preserve tolerant normalization for old JSON data loaded by `DevDatabaseService`.
- Fix the current image generation API test failure without deleting useful prompt coverage.
- End with `npm run lint`, `npm test`, and `npm run build` passing.

## Non-Goals

- Do not redesign the full permission system.
- Do not add new permissions beyond the existing eight project permissions.
- Do not migrate runtime storage to Prisma.
- Do not change the shot review product scope.
- Do not remove the existing project roles.

## Confirmed Approach

Use a contract-first repair.

The shared resolver remains the source of truth for project roles, templates, overrides, and deny-wins behavior. The API should add focused helpers around that resolver so read checks and payload permissions use the same computed context. The frontend should continue consuming `currentUserPermissions`; it should not duplicate role rules.

## Required Behavior

### Project Read Permission

`project.view` must be enforced for project-scoped read access.

Allowed read paths:

- `platform_super_admin` can read all projects.
- `tenant_owner` and `tenant_admin` can read projects in their team.
- Project members can read only when their effective permissions include `project.view`.

Denied path:

- A project member with `deny: ["project.view"]` cannot read the project workspace or project-scoped resources, even if their role normally includes `project.view`.

The implementation should replace membership-only read checks with permission-aware read checks. This applies at least to:

- `GET /projects/:id`
- `GET /projects/:id/versions`
- version/comment reads that resolve to a project
- project jobs reads
- timeline reads
- export reads

### Team Admin Effective Permissions

Backend checks currently treat team owners and team admins as trusted managers for team projects. `currentUserPermissions` must reflect that behavior.

For a team owner or team admin viewing a project in their team, `currentUserPermissions` should include at least:

- `project.view`
- `member.manage`
- `permission.manage`

It may include all project permissions if the implementation chooses a simpler high-trust model for team admins. The choice must be consistent between backend authorization and frontend visibility.

### Strict API Permission Validation

API endpoint input should reject unknown permission values.

Affected endpoints:

- `PUT /teams/:id/permission-templates`
- `PUT /projects/:projectId/members/:memberId/permissions`

Behavior:

- Unknown permission value returns 400.
- Error message includes the invalid permission value and the input field path.
- Duplicates may still be normalized after validation.
- `project_admin` templates remain locked and cannot be overwritten by team templates.

Development JSON compatibility remains tolerant:

- Old or dirty stored JSON can be normalized on load.
- Load-time normalization may drop invalid stored values.
- Runtime endpoint input must not silently drop invalid values.

### Image Prompt Regression

The existing API test named `image generation settings persist and image jobs honor config source` currently fails because the provider prompt does not include the storyboard shot visual description expected by the test.

The fix should investigate the actual prompt-building path and repair the implementation or the fixture setup so the test proves this behavior:

- A shot's `visualDescription` is included in the provider prompt when generating image jobs for that shot.
- The negative prompt section remains present.
- The fallback generic prompt text is not used when storyboard shot context exists.

Do not delete this assertion without replacing it with equivalent coverage.

## API Design Notes

Prefer adding internal helpers in `WorkspaceService` rather than spreading permission construction across methods.

Expected helper responsibilities:

- Build an `ActorContext` from a `DevDatabase`, `userId`, and `projectId`.
- Resolve effective project permissions for a user in a project.
- Assert read access by checking `project.view` plus high-trust platform/team admin paths.
- Assert action permissions by using the same actor construction.

The existing `getActor` method can be reused or split if the resulting code is clearer.

The public `assertProjectPermission` method used by `JobsService` should stay available, but it should match the same high-trust/team-admin semantics used by the workspace payload.

## Frontend Design Notes

Frontend action visibility should continue to use `payload.currentUserPermissions`.

The fix should align controls that still appear without permission checks:

- Project name and description edit controls should require `project.edit`.
- Review policy controls should require `project.edit` or another backend-equivalent permission already used for that endpoint.
- Permission and member controls should continue to require `permission.manage` and `member.manage`.

If team admins are allowed by backend policy, the API must include the needed permissions in `currentUserPermissions` so these controls appear naturally.

## Testing Requirements

Add or update API tests for:

- A project member can read a project before `project.view` is denied.
- After `deny: ["project.view"]`, that member gets 403 from `GET /projects/:id`.
- The same denied member gets 403 from `GET /projects/:id/versions`.
- The same denied member gets 403 from `GET /projects/:id/jobs` or another project job read endpoint.
- A `tenant_admin` who is not a project member receives a workspace payload whose `currentUserPermissions` contains `project.view`, `member.manage`, and `permission.manage`.
- `PUT /teams/:id/permission-templates` returns 400 for `bad.permission`.
- `PUT /projects/:projectId/members/:memberId/permissions` returns 400 for `bad.permission`.
- The image generation prompt test passes while still proving shot `visualDescription` reaches the provider prompt.

Run final verification:

```bash
npm run lint
npm test
npm run build
```

All three commands must pass before the repair is considered complete.

## Rollout Notes

This is a repair pass on a committed implementation. Claude Code should keep changes narrow and preserve the existing architecture:

- Shared permission resolver remains the contract layer.
- API uses `DevDatabaseService` and `query/mutate`.
- Frontend consumes effective permissions instead of role names.
- No README update is required because this is not user-facing documentation yet.

## Spec Self-Review

- Incomplete-marker scan: no open markers are intentionally left in this spec.
- Scope check: this is one repair project focused on permissions consistency and the current red test.
- Consistency check: backend authorization, `currentUserPermissions`, and frontend visibility are required to use the same effective permission semantics.
- Ambiguity check: API input is strict, stored JSON normalization is tolerant.
