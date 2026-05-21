# Impact Dependency System Design

Date: 2026-05-21

## Goal

Improve DramaFlow's generation linkage after AI generation or manual edits. The platform should not silently rewrite downstream work, but it must track provenance, detect affected downstream content, and give professional teams a recoverable workflow for handling impact.

Chosen approach: full dependency graph plus impact issue system.

## Current Problem

DramaFlow already orders the workspace as world bible, synopsis, script, storyboard, media candidates, and timeline. That order is useful, but it is still mostly document navigation.

The missing behavior is linkage after change:

- A new world bible version does not create traceable impact for synopsis, script, storyboard, or media.
- A new synopsis version does not identify script content that was based on the old synopsis.
- A new script version does not identify storyboard versions that are now based on old script content.
- Storyboard edits do not mark image, video, TTS, or subtitle candidates that were generated from old shot content.
- Generated outputs do not consistently expose the exact upstream versions, prompt, provider, model, and anchor data they came from.

## Product Principles

- System discovers impact; users decide what to do.
- No automatic overwrite of adopted versions.
- Accepting a suggestion creates a candidate version or candidate asset only.
- Ignored, accepted, and resolved impact issues are recoverable.
- Every state change keeps an audit trail.
- First implementation uses version-level and anchor-level checks. Deep semantic diff is out of scope.

## Domain Model

Add impact-related domain types to `packages/shared/src/domain.ts` and API payloads near existing workspace/job contracts.

### VersionDependency

Records that a target version or media candidate was produced from an upstream version or anchor snapshot.

Key fields:

```ts
export type DependencyType =
  | "world_bible_to_synopsis"
  | "world_bible_to_script"
  | "world_bible_to_storyboard"
  | "synopsis_to_script"
  | "script_to_storyboard"
  | "storyboard_to_media"
  | "manual_inherited"
  | "manual_unlinked";

export type DependencyAnchorType = "document" | "scene" | "shot" | "asset";

export interface VersionDependencyRecord {
  id: string;
  projectId: string;
  sourceDocumentId?: string;
  sourceVersionId?: string;
  sourceDocumentType?: DocumentType;
  targetDocumentId: string;
  targetVersionId: string;
  targetDocumentType: DocumentType;
  dependencyType: DependencyType;
  targetAnchorType?: DependencyAnchorType;
  targetAnchorId?: string;
  sourceSnapshotHash?: string;
  targetSnapshotHash?: string;
  promptSnapshot?: string;
  provider?: string;
  model?: string;
  configSource?: LlmConfigSource;
  createdBy: string;
  createdAt: string;
}
```

Notes:

- Generated versions should record direct upstream sources used in the prompt.
- Manual edits from an existing version inherit dependencies unless the user explicitly starts from current upstream versions.
- `manual_unlinked` is allowed when provenance is unknown; it does not block generation.

### ImpactIssue

Represents a trackable impact item caused by adopting or saving a newer upstream version.

```ts
export type ImpactIssueStatus =
  | "open"
  | "suggested"
  | "accepted"
  | "ignored"
  | "resolved";

export type ImpactSeverity = "low" | "medium" | "high";

export interface ImpactIssueRecord {
  id: string;
  projectId: string;
  dependencyId?: string;
  sourceDocumentId?: string;
  previousSourceVersionId?: string;
  changedSourceVersionId: string;
  targetDocumentId: string;
  targetVersionId: string;
  dependencyType: DependencyType;
  status: ImpactIssueStatus;
  severity: ImpactSeverity;
  title: string;
  summary: string;
  assignedTo?: string;
  latestSuggestionId?: string;
  acceptedSuggestionId?: string;
  ignoredBy?: string;
  ignoredAt?: string;
  ignoreReason?: string;
  resolvedBy?: string;
  resolvedAt?: string;
  resolveNote?: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}
```

### ImpactTarget

An issue may affect one version, one scene, one shot, one media candidate, or a group of anchors.

```ts
export type ImpactTargetType =
  | "version"
  | "scene"
  | "shot"
  | "media_candidate"
  | "timeline_clip";

export interface ImpactTargetRecord {
  id: string;
  issueId: string;
  projectId: string;
  targetType: ImpactTargetType;
  documentId?: string;
  versionId?: string;
  anchorId?: string;
  label?: string;
  createdAt: string;
}
```

### ImpactSuggestion

Stores AI-generated advice or a candidate update. Suggestions are not adopted automatically.

```ts
export type ImpactSuggestionStatus =
  | "generated"
  | "accepted"
  | "acceptance_reverted";

export interface ImpactSuggestionRecord {
  id: string;
  issueId: string;
  projectId: string;
  status: ImpactSuggestionStatus;
  summary: string;
  suggestedContent?: unknown;
  promptSnapshot?: string;
  provider?: string;
  model?: string;
  createdVersionId?: string;
  createdDocumentId?: string;
  createdJobId?: string;
  acceptedBy?: string;
  acceptedAt?: string;
  revertedBy?: string;
  revertedAt?: string;
  createdBy: string;
  createdAt: string;
}
```

### ImpactIssueEvent

Use a lightweight event log for recoverability and audit display.

```ts
export type ImpactIssueEventType =
  | "created"
  | "ignored"
  | "reopened"
  | "suggestion_created"
  | "suggestion_accepted"
  | "acceptance_reverted"
  | "resolved"
  | "assigned";

export interface ImpactIssueEventRecord {
  id: string;
  issueId: string;
  projectId: string;
  type: ImpactIssueEventType;
  actorId: string;
  note?: string;
  createdAt: string;
}
```

## State Flow

Primary flow:

```text
open -> suggested -> accepted -> resolved
```

Recovery and alternate flows:

```text
open -> ignored
suggested -> ignored
ignored -> open
resolved -> open
accepted -> suggested
accepted -> open
```

Behavior details:

- `ignored` never deletes the issue.
- Ignored issues appear under an "ignored" filter and can be reopened.
- Accepting a suggestion creates a candidate version or candidate asset only.
- Reverting acceptance does not delete audit history. If a candidate draft was created, the UI may offer deletion through existing draft/candidate actions.
- Resolving marks the item handled, but it can still be reopened.
- If a newer upstream version is adopted later, the system creates or updates impact based on that newer version. A previous ignore for V4 must not suppress a new V5 impact.

## Detection Rules

When a new version is created or adopted, `ImpactService.scanAfterAdoption` checks active downstream dependencies.

Active downstream targets are:

- Current adopted versions.
- Draft versions currently attached to a document.
- Media candidates still visible for a shot.
- Timeline clips only when their asset was created from an affected candidate.

Rules:

- World bible adoption checks dependencies from old world bible versions into synopsis, script, storyboard, and media where a direct dependency exists.
- Synopsis adoption checks dependencies into script versions.
- Script adoption checks dependencies into storyboard versions.
- Storyboard adoption checks media candidates by storyboard version and shot-level snapshot hash.
- Manual save of a new version can trigger the same scan when it changes the adopted baseline or active draft lineage.

Duplicate prevention:

```text
projectId + dependencyId + changedSourceVersionId + targetVersionId + targetAnchorType + targetAnchorId
```

The service should not create duplicate issues for the same impact key. If an existing open issue is superseded by a newer upstream version, append an event and update summary fields rather than creating noisy duplicates for the same target.

Severity heuristic for first implementation:

- `high`: synopsis to script, script to storyboard, or impact on an adopted/current target.
- `medium`: world bible to synopsis/script/storyboard, storyboard to media.
- `low`: unlinked/manual lineage warnings.

## API Design

Add endpoints to the workspace/impact area. They should use current JWT auth and project permission checks.

```text
GET  /projects/:id/impact-issues
GET  /impact-issues/:id
GET  /versions/:id/impact-summary
POST /impact-issues/:id/ignore
POST /impact-issues/:id/reopen
POST /impact-issues/:id/resolve
POST /impact-issues/:id/assign
POST /impact-issues/:id/suggestions
POST /impact-suggestions/:id/accept
POST /impact-suggestions/:id/revert-acceptance
```

Filters for `GET /projects/:id/impact-issues`:

- `status`
- `severity`
- `targetType`
- `targetDocumentType`
- `assignedTo`

Permissions:

- `project.view`: read impact issues and summaries.
- `project.edit`: ignore, reopen, resolve, assign, accept, and revert acceptance.
- `job.manage`: create AI suggestion jobs.
- Existing version review/adopt permissions remain authoritative for review and adoption actions.

## Service Design

Add `ImpactService` under the API workspace area. It should follow the existing `DevDatabaseService.query / mutate` pattern and should not introduce Prisma runtime usage.

Responsibilities:

- `recordDependenciesForVersion(...)`
  Writes dependency records after generation, manual save, restore, or media candidate creation.

- `scanAfterAdoption(...)`
  Scans active downstream dependencies after a source version becomes current.

- `createOrUpdateImpactIssue(...)`
  Applies duplicate prevention and event logging.

- `createSuggestionJob(...)`
  Creates a job for AI suggestion generation.

- `completeSuggestionJob(...)`
  Stores structured suggestion output.

- `acceptSuggestion(...)`
  Creates a candidate version or candidate media job without changing the adopted baseline.

- `revertAcceptance(...)`
  Moves the issue back to a processable state and records audit history.

Suggested new job type:

```ts
export type JobType = ... | "impact_suggestion";
```

The worker stays lightweight. Processing remains in API service logic, consistent with existing job behavior.

## Integration Points

Update these existing flows to record dependencies or scan impact:

- `WorkspaceService.createVersion`
- `WorkspaceService.adoptVersion`
- `WorkspaceService.restoreVersion`
- Text generation completion for synopsis and script
- Storyboard generation completion
- Image, video, and TTS job completion
- Storyboard inline edit creating or updating a draft
- Candidate adoption and media binding update where applicable

Generation dependency examples:

- Synopsis generation records direct world bible dependency when world bible context is injected.
- Script generation records direct world bible and synopsis dependencies.
- Storyboard generation records direct script dependency and direct world bible dependency if world bible context is injected.
- Image/video/TTS generation records storyboard dependency plus `shotId` and shot snapshot hash.

## Frontend Design

### Version Lineage Strip

Add a compact "source and impact" strip near version details:

- Based on: world bible V3, synopsis V5.
- Current upstream: world bible V4, synopsis V5.
- Status: 2 open impact issues.
- Actions: view issues, generate suggestion, mark resolved, reopen when applicable.

### Version Management

Add impact badges in the version list:

- affected
- suggested
- accepted
- ignored
- resolved

The selected-version preview should include:

- Source versions.
- Active impact issues.
- Issue event history.
- Suggestion links and candidate versions created from suggestions.

### Generate Panel

Before generation, show input health:

- Whether selected upstream versions are current adopted versions.
- Whether unresolved impact issues exist for the selected source.
- Warning does not block generation.

### Task Panel

Add an impact-focused view alongside AI jobs:

- all
- open
- suggested
- accepted
- ignored
- resolved

Each row should show:

- Source change, such as world bible V3 -> V4.
- Target, such as script V8 scene 3 or shot 12 media candidate.
- Severity.
- Assignee.
- Status.
- Actions allowed by permission.

Recovery actions:

- Reopen ignored issue.
- Revert accepted suggestion.
- Reopen resolved issue.

## Error Handling

- Missing upstream version: keep issue readable and show "source version unavailable" instead of failing.
- Missing target version: mark issue resolved only if the target was deleted through an explicit version action.
- Suggestion generation failure: leave issue `open` and attach failed job details.
- Accept suggestion failure: leave suggestion `generated` and show API error.
- Reopen after stale data: refetch issue before mutation and apply latest status rules.

## Implementation Boundaries

In scope:

- Dependency records.
- Impact issue records.
- Impact target records.
- Suggestion records and issue event logs.
- Version-level and anchor-level impact checks.
- Recoverable ignore, accept, resolve, and reopen flows.
- Candidate creation from accepted suggestions.

Out of scope:

- Deep semantic diff.
- Automatic overwrite of adopted versions.
- New queue framework.
- Prisma runtime migration.
- Replacing the existing comment system.
- Hard-blocking generation when impact exists.
- Full production dashboard or global production control view.

## Verification Boundary

The user will perform product and business-flow testing.

Implementation handoff should ensure:

- TypeScript compile/type checks pass through `npm run lint`.
- Full build passes for substantial UI/API changes through `npm run build`.
- Code paths are reviewed for duplicate issue prevention, recoverable state transitions, permission checks, and no automatic overwrite.
- Focused script tests may be added only where they are cheap and directly protect status transitions or dependency scanning, but user acceptance testing is not part of the developer-side requirement.

