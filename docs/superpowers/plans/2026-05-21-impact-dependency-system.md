# Impact Dependency System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a recoverable dependency graph and impact issue workflow so upstream generation or edit changes can be traced, reviewed, suggested, accepted as candidates, ignored, reopened, and resolved without overwriting adopted work.

**Architecture:** Add shared impact contracts, store impact records in the existing JSON `DevDatabaseService`, and add an API `ImpactService` that owns dependency recording, issue scanning, status transitions, suggestion storage, and candidate creation. Wire dependency metadata from existing workspace and jobs flows, then expose impact state in the project workspace through small focused React components and hooks.

**Tech Stack:** TypeScript, npm workspaces, NestJS 11, Next.js 15 App Router, React 19, TanStack Query, `DevDatabaseService` JSON persistence, existing polling worker/job execution.

---

## File Structure

- Create `packages/shared/src/impact-rules.ts`
  - Contains status transition helpers and active status constants for impact issues.

- Modify `packages/shared/src/domain.ts`
  - Adds `DependencyType`, `VersionDependencyRecord`, `ImpactIssueRecord`, `ImpactTargetRecord`, `ImpactSuggestionRecord`, and `ImpactIssueEventRecord`.
  - Adds `"impact_suggestion"` to `JobType`.

- Modify `packages/shared/src/api-contracts.ts`
  - Adds impact list, detail, summary, and mutation payload/response interfaces.
  - Adds `impactSummary?: VersionImpactSummary` to `ProjectWorkspacePayload`, `ProjectVersionsResponse`, and `VersionListResponse` version payloads.

- Modify `packages/shared/src/index.ts`
  - Exports `impact-rules`.

- Modify `packages/shared/scripts/test.ts`
  - Adds focused assertions for status transitions and active status checks.

- Modify `apps/api/src/common/database.types.ts`
  - Adds impact arrays to `DevDatabase`.

- Modify `apps/api/src/common/dev-database.service.ts`
  - Normalizes the new impact arrays on old JSON files.

- Create `apps/api/src/workspace/impact.service.ts`
  - Owns impact persistence, dependency recording, scan logic, state transitions, suggestion storage, and candidate version creation.

- Create `apps/api/src/workspace/impact.controller.ts`
  - Exposes read and non-job impact endpoints.

- Modify `apps/api/src/workspace/workspace.module.ts`
  - Registers and exports `ImpactService`.
  - Registers `ImpactController`.

- Modify `apps/api/src/workspace/workspace.service.ts`
  - Calls impact service after version creation and adoption.
  - Adds impact summary into returned version lists.
  - Keeps all persistence through `database.query` and `database.mutate`.

- Modify `apps/api/src/jobs/jobs.service.ts`
  - Records richer source metadata for text/storyboard/media generation.
  - Adds `impact_suggestion` processing.

- Modify `apps/api/src/jobs/jobs.controller.ts`
  - Adds `POST /impact-issues/:id/suggestions` because it creates a job.

- Modify `apps/web/lib/query-keys.ts`
  - Adds impact query keys.

- Create `apps/web/lib/hooks/use-impact-issues.ts`
  - Provides list/detail mutations for project impact issues.

- Create `apps/web/components/project-workspace/impact-issue-list.tsx`
  - Shared impact issue list for task panel and version detail.

- Create `apps/web/components/project-workspace/version-lineage-strip.tsx`
  - Shows source versions and impact counts on version details.

- Create `apps/web/components/project-workspace/generation/generation-impact-health.tsx`
  - Shows pre-generation upstream health warnings.

- Modify `apps/web/components/project-workspace/version-view.tsx`
  - Renders `VersionLineageStrip` above content.

- Modify `apps/web/components/project-workspace/version-management-panel.tsx`
  - Adds impact badges and an impact issue block for selected versions.

- Modify `apps/web/components/project-workspace/generation/quick-generator.tsx`
  - Renders generation impact health for selected source.

- Modify `apps/web/components/project-workspace/task-panel.tsx`
  - Adds an impact view beside job filters.

- Modify `apps/web/lib/i18n/messages.ts`
  - Adds Chinese and English strings for impact UI.

- Modify `apps/web/app/globals.css`
  - Adds compact impact strip, badges, and list styles.

- No README changes are required.

---

### Task 1: Add Shared Impact Contracts And Rules

**Files:**
- Create: `packages/shared/src/impact-rules.ts`
- Modify: `packages/shared/src/domain.ts`
- Modify: `packages/shared/src/api-contracts.ts`
- Modify: `packages/shared/src/index.ts`
- Modify: `packages/shared/scripts/test.ts`

- [ ] **Step 1: Add shared impact rules**

Create `packages/shared/src/impact-rules.ts`:

```ts
import type { ImpactIssueStatus } from "./domain";

export const ACTIVE_IMPACT_ISSUE_STATUSES: ImpactIssueStatus[] = [
  "open",
  "suggested",
  "accepted",
];

const IMPACT_STATUS_TRANSITIONS: Record<ImpactIssueStatus, ImpactIssueStatus[]> = {
  open: ["suggested", "ignored", "resolved"],
  suggested: ["accepted", "ignored", "resolved", "open"],
  accepted: ["resolved", "suggested", "open"],
  ignored: ["open"],
  resolved: ["open"],
};

export function canTransitionImpactIssueStatus(
  currentStatus: ImpactIssueStatus,
  nextStatus: ImpactIssueStatus,
): boolean {
  return IMPACT_STATUS_TRANSITIONS[currentStatus].includes(nextStatus);
}

export function isActiveImpactIssueStatus(status: ImpactIssueStatus): boolean {
  return ACTIVE_IMPACT_ISSUE_STATUSES.includes(status);
}
```

- [ ] **Step 2: Add domain types**

In `packages/shared/src/domain.ts`, add these types after `NotificationRecord` and before batch job types:

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

In the existing `JobType` union in the same file, add:

```ts
  | "impact_suggestion"
```

- [ ] **Step 3: Add API contracts**

In `packages/shared/src/api-contracts.ts`, extend the import list from `./domain` with:

```ts
  DependencyType,
  ImpactIssueEventRecord,
  ImpactIssueRecord,
  ImpactIssueStatus,
  ImpactSeverity,
  ImpactSuggestionRecord,
  ImpactTargetRecord,
  ImpactTargetType,
  VersionDependencyRecord,
```

Add these interfaces after `ProjectVersionsResponse`:

```ts
export interface VersionImpactSummary {
  versionId: string;
  dependencies: VersionDependencyRecord[];
  openCount: number;
  suggestedCount: number;
  acceptedCount: number;
  ignoredCount: number;
  resolvedCount: number;
  latestIssues: ImpactIssueSummary[];
}

export interface ImpactIssueSummary extends Pick<
  ImpactIssueRecord,
  | "id"
  | "projectId"
  | "dependencyType"
  | "status"
  | "severity"
  | "title"
  | "summary"
  | "assignedTo"
  | "changedSourceVersionId"
  | "targetDocumentId"
  | "targetVersionId"
  | "latestSuggestionId"
  | "acceptedSuggestionId"
  | "createdAt"
  | "updatedAt"
> {
  targets: ImpactTargetRecord[];
}

export interface ImpactIssueDetailResponse {
  issue: ImpactIssueRecord;
  targets: ImpactTargetRecord[];
  suggestions: ImpactSuggestionRecord[];
  events: ImpactIssueEventRecord[];
  dependencies: VersionDependencyRecord[];
}

export interface ProjectImpactIssuesResponse {
  issues: ImpactIssueSummary[];
  total: number;
}

export interface ProjectImpactIssuesQuery {
  status?: ImpactIssueStatus;
  severity?: ImpactSeverity;
  targetType?: ImpactTargetType;
  targetDocumentType?: string;
  assignedTo?: string;
  limit?: number;
  offset?: number;
}

export interface IgnoreImpactIssuePayload {
  reason?: string;
}

export interface ResolveImpactIssuePayload {
  note?: string;
}

export interface AssignImpactIssuePayload {
  assignedTo?: string;
}

export interface CreateImpactSuggestionPayload {
  instruction?: string;
}

export interface ImpactSuggestionJobResponse {
  job: Pick<JobRecord, "id" | "type" | "status" | "projectId" | "createdAt" | "updatedAt">;
}

export interface AcceptImpactSuggestionResponse {
  issue: ImpactIssueRecord;
  suggestion: ImpactSuggestionRecord;
  createdVersion?: Pick<VersionRecord, "id" | "documentId" | "versionNumber" | "status" | "title" | "createdAt">;
}
```

Then update the `ProjectWorkspacePayload.versions`, `ProjectVersionsResponse.versions`, and `VersionListResponse.versions` picks by adding an optional `impactSummary` intersection:

```ts
  versions: Array<Pick<VersionRecord, "id" | "documentId" | "versionNumber" | "status" | "title" | "content" | "metadata" | "parentVersionId" | "createdBy" | "createdAt"> & { impactSummary?: VersionImpactSummary }>;
```

```ts
  versions: Array<Pick<VersionRecord, "id" | "documentId" | "versionNumber" | "status" | "title" | "content" | "metadata" | "parentVersionId" | "createdBy" | "createdAt"> & { impactSummary?: VersionImpactSummary }>;
```

```ts
  versions: Array<Pick<VersionRecord, "id" | "documentId" | "versionNumber" | "status" | "title" | "content" | "metadata" | "parentVersionId" | "createdBy" | "createdAt"> & { impactSummary?: VersionImpactSummary }>;
```

- [ ] **Step 4: Export rules**

In `packages/shared/src/index.ts`, add:

```ts
export * from "./impact-rules";
```

- [ ] **Step 5: Add focused shared assertions**

In `packages/shared/scripts/test.ts`, extend the imports from `../src` with:

```ts
  canTransitionImpactIssueStatus,
  isActiveImpactIssueStatus,
```

Add these assertions near the existing business-rule assertions:

```ts
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
```

- [ ] **Step 6: Run shared checks**

Run:

```powershell
npm --workspace @dramaflow/shared run test
npm --workspace @dramaflow/shared run lint
```

Expected: both commands exit `0`.

- [ ] **Step 7: Commit shared contracts**

```powershell
git add packages/shared/src/domain.ts packages/shared/src/api-contracts.ts packages/shared/src/index.ts packages/shared/src/impact-rules.ts packages/shared/scripts/test.ts
git commit -m "feat(shared): add impact dependency contracts"
```

---

### Task 2: Add Impact Persistence To Dev Database

**Files:**
- Modify: `apps/api/src/common/database.types.ts`
- Modify: `apps/api/src/common/dev-database.service.ts`

- [ ] **Step 1: Add database fields**

In `apps/api/src/common/database.types.ts`, extend the shared imports:

```ts
  ImpactIssueEventRecord,
  ImpactIssueRecord,
  ImpactSuggestionRecord,
  ImpactTargetRecord,
  VersionDependencyRecord,
```

Add fields to `DevDatabase` after `auditRecords`:

```ts
  versionDependencies: VersionDependencyRecord[];
  impactIssues: ImpactIssueRecord[];
  impactTargets: ImpactTargetRecord[];
  impactSuggestions: ImpactSuggestionRecord[];
  impactIssueEvents: ImpactIssueEventRecord[];
```

Add defaults to `createEmptyDatabase()` after `auditRecords: []`:

```ts
    versionDependencies: [],
    impactIssues: [],
    impactTargets: [],
    impactSuggestions: [],
    impactIssueEvents: [],
```

- [ ] **Step 2: Normalize old JSON files**

In `apps/api/src/common/dev-database.service.ts`, add the new arrays to `arrayFields` after `"auditRecords"`:

```ts
      "versionDependencies", "impactIssues", "impactTargets",
      "impactSuggestions", "impactIssueEvents",
```

- [ ] **Step 3: Run API type check**

Run:

```powershell
npm --workspace @dramaflow/api run lint
```

Expected: command exits `0`.

- [ ] **Step 4: Commit persistence fields**

```powershell
git add apps/api/src/common/database.types.ts apps/api/src/common/dev-database.service.ts
git commit -m "feat(api): add impact records to dev database"
```

---

### Task 3: Implement ImpactService Core Reads And State Transitions

**Files:**
- Create: `apps/api/src/workspace/impact.service.ts`
- Modify: `apps/api/src/workspace/workspace.module.ts`

- [ ] **Step 1: Create ImpactService skeleton and read methods**

Create `apps/api/src/workspace/impact.service.ts`:

```ts
import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { createHash } from "node:crypto";
import {
  canTransitionImpactIssueStatus,
  isActiveImpactIssueStatus,
  type DependencyType,
  type DocumentRecord,
  type DocumentType,
  type ImpactIssueDetailResponse,
  type ImpactIssueEventRecord,
  type ImpactIssueRecord,
  type ImpactIssueStatus,
  type ImpactSeverity,
  type ImpactSuggestionRecord,
  type ImpactTargetRecord,
  type ImpactTargetType,
  type ProjectImpactIssuesQuery,
  type ProjectImpactIssuesResponse,
  type VersionDependencyRecord,
  type VersionImpactSummary,
  type VersionRecord,
} from "@dramaflow/shared";

import { DevDatabaseService } from "../common/dev-database.service";
import type { DevDatabase } from "../common/database.types";
import { createId } from "../common/id";

interface CreateImpactInput {
  projectId: string;
  dependencyId?: string;
  sourceDocumentId?: string;
  previousSourceVersionId?: string;
  changedSourceVersionId: string;
  targetDocumentId: string;
  targetVersionId: string;
  dependencyType: DependencyType;
  severity: ImpactSeverity;
  title: string;
  summary: string;
  targets: Array<Omit<ImpactTargetRecord, "id" | "issueId" | "projectId" | "createdAt">>;
  actorId: string;
}

@Injectable()
export class ImpactService {
  constructor(
    @Inject(DevDatabaseService) private readonly database: DevDatabaseService,
  ) {}

  stableHash(value: unknown): string {
    return createHash("sha256")
      .update(this.stableStringify(value))
      .digest("hex")
      .slice(0, 16);
  }

  async listProjectIssues(
    projectId: string,
    query: ProjectImpactIssuesQuery = {},
  ): Promise<ProjectImpactIssuesResponse> {
    return this.database.query((db) => {
      let issues = db.impactIssues.filter((issue) => issue.projectId === projectId);

      if (query.status) issues = issues.filter((issue) => issue.status === query.status);
      if (query.severity) issues = issues.filter((issue) => issue.severity === query.severity);
      if (query.assignedTo) issues = issues.filter((issue) => issue.assignedTo === query.assignedTo);
      if (query.targetType) {
        const issueIds = new Set(
          db.impactTargets
            .filter((target) => target.projectId === projectId && target.targetType === query.targetType)
            .map((target) => target.issueId),
        );
        issues = issues.filter((issue) => issueIds.has(issue.id));
      }
      if (query.targetDocumentType) {
        const documentIds = new Set(
          db.documents
            .filter((document) => document.projectId === projectId && document.type === query.targetDocumentType)
            .map((document) => document.id),
        );
        issues = issues.filter((issue) => documentIds.has(issue.targetDocumentId));
      }

      issues = [...issues].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
      const total = issues.length;
      const offset = query.offset ?? 0;
      const limit = query.limit ?? 50;
      return {
        issues: issues.slice(offset, offset + limit).map((issue) => this.toIssueSummary(db, issue)),
        total,
      };
    });
  }

  async getIssueDetail(issueId: string): Promise<ImpactIssueDetailResponse> {
    return this.database.query((db) => {
      const issue = this.mustFindIssue(db, issueId);
      return this.buildIssueDetail(db, issue);
    });
  }

  async getVersionImpactSummary(versionId: string): Promise<VersionImpactSummary> {
    return this.database.query((db) => {
      this.mustFindVersionProjectId(db, versionId);
      return this.buildVersionImpactSummary(db, versionId);
    });
  }

  async getIssueProjectId(issueId: string): Promise<string> {
    return this.database.query((db) => this.mustFindIssue(db, issueId).projectId);
  }

  async getVersionProjectId(versionId: string): Promise<string> {
    return this.database.query((db) => this.mustFindVersionProjectId(db, versionId));
  }

  async getSuggestionProjectId(suggestionId: string): Promise<string> {
    return this.database.query((db) => {
      const suggestion = db.impactSuggestions.find((item) => item.id === suggestionId);
      if (!suggestion) throw new NotFoundException("Impact suggestion not found");
      return suggestion.projectId;
    });
  }
```

- [ ] **Step 2: Add status mutation methods**

Continue the same file with these methods inside the class:

```ts
  async ignoreIssue(issueId: string, actorId: string, reason?: string): Promise<ImpactIssueDetailResponse> {
    return this.transitionIssue(issueId, actorId, "ignored", "ignored", reason);
  }

  async reopenIssue(issueId: string, actorId: string): Promise<ImpactIssueDetailResponse> {
    return this.transitionIssue(issueId, actorId, "open", "reopened");
  }

  async resolveIssue(issueId: string, actorId: string, note?: string): Promise<ImpactIssueDetailResponse> {
    return this.transitionIssue(issueId, actorId, "resolved", "resolved", note);
  }

  async assignIssue(issueId: string, actorId: string, assignedTo?: string): Promise<ImpactIssueDetailResponse> {
    return this.database.mutate((db) => {
      const issue = this.mustFindIssue(db, issueId);
      issue.assignedTo = assignedTo?.trim() || undefined;
      issue.updatedAt = new Date().toISOString();
      this.appendEvent(db, issue, "assigned", actorId, assignedTo ? `Assigned to ${assignedTo}` : "Assignment cleared");
      return this.buildIssueDetail(db, issue);
    });
  }

  private async transitionIssue(
    issueId: string,
    actorId: string,
    nextStatus: ImpactIssueStatus,
    eventType: ImpactIssueEventRecord["type"],
    note?: string,
  ): Promise<ImpactIssueDetailResponse> {
    return this.database.mutate((db) => {
      const issue = this.mustFindIssue(db, issueId);
      if (!canTransitionImpactIssueStatus(issue.status, nextStatus)) {
        throw new BadRequestException(`Cannot move impact issue from ${issue.status} to ${nextStatus}`);
      }

      const now = new Date().toISOString();
      issue.status = nextStatus;
      issue.updatedAt = now;

      if (nextStatus === "ignored") {
        issue.ignoredBy = actorId;
        issue.ignoredAt = now;
        issue.ignoreReason = note?.trim() || undefined;
      }
      if (nextStatus === "resolved") {
        issue.resolvedBy = actorId;
        issue.resolvedAt = now;
        issue.resolveNote = note?.trim() || undefined;
      }
      if (nextStatus === "open") {
        issue.ignoredBy = undefined;
        issue.ignoredAt = undefined;
        issue.ignoreReason = undefined;
        issue.resolvedBy = undefined;
        issue.resolvedAt = undefined;
        issue.resolveNote = undefined;
        if (issue.acceptedSuggestionId) {
          const acceptedSuggestion = db.impactSuggestions.find((suggestion) => suggestion.id === issue.acceptedSuggestionId);
          if (acceptedSuggestion?.status === "accepted") {
            acceptedSuggestion.status = "acceptance_reverted";
            acceptedSuggestion.revertedBy = actorId;
            acceptedSuggestion.revertedAt = now;
          }
          issue.acceptedSuggestionId = undefined;
        }
      }

      this.appendEvent(db, issue, eventType, actorId, note);
      return this.buildIssueDetail(db, issue);
    });
  }
```

- [ ] **Step 3: Add summary, event, and helper methods**

Finish the class with:

```ts
  private toIssueSummary(db: DevDatabase, issue: ImpactIssueRecord) {
    return {
      id: issue.id,
      projectId: issue.projectId,
      dependencyType: issue.dependencyType,
      status: issue.status,
      severity: issue.severity,
      title: issue.title,
      summary: issue.summary,
      assignedTo: issue.assignedTo,
      changedSourceVersionId: issue.changedSourceVersionId,
      targetDocumentId: issue.targetDocumentId,
      targetVersionId: issue.targetVersionId,
      latestSuggestionId: issue.latestSuggestionId,
      acceptedSuggestionId: issue.acceptedSuggestionId,
      createdAt: issue.createdAt,
      updatedAt: issue.updatedAt,
      targets: db.impactTargets.filter((target) => target.issueId === issue.id),
    };
  }

  private buildIssueDetail(db: DevDatabase, issue: ImpactIssueRecord): ImpactIssueDetailResponse {
    return {
      issue,
      targets: db.impactTargets.filter((target) => target.issueId === issue.id),
      suggestions: db.impactSuggestions.filter((suggestion) => suggestion.issueId === issue.id),
      events: db.impactIssueEvents.filter((event) => event.issueId === issue.id),
      dependencies: db.versionDependencies.filter((dependency) => dependency.id === issue.dependencyId),
    };
  }

  buildVersionImpactSummary(db: DevDatabase, versionId: string): VersionImpactSummary {
    const issues = db.impactIssues.filter((issue) => issue.targetVersionId === versionId);
    return {
      versionId,
      dependencies: db.versionDependencies.filter((dependency) => dependency.targetVersionId === versionId),
      openCount: issues.filter((issue) => issue.status === "open").length,
      suggestedCount: issues.filter((issue) => issue.status === "suggested").length,
      acceptedCount: issues.filter((issue) => issue.status === "accepted").length,
      ignoredCount: issues.filter((issue) => issue.status === "ignored").length,
      resolvedCount: issues.filter((issue) => issue.status === "resolved").length,
      latestIssues: issues
        .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
        .slice(0, 5)
        .map((issue) => this.toIssueSummary(db, issue)),
    };
  }

  private appendEvent(
    db: DevDatabase,
    issue: ImpactIssueRecord,
    type: ImpactIssueEventRecord["type"],
    actorId: string,
    note?: string,
  ): void {
    db.impactIssueEvents.push({
      id: createId("impact_event"),
      issueId: issue.id,
      projectId: issue.projectId,
      type,
      actorId,
      note: note?.trim() || undefined,
      createdAt: new Date().toISOString(),
    });
  }

  private mustFindIssue(db: DevDatabase, issueId: string): ImpactIssueRecord {
    const issue = db.impactIssues.find((item) => item.id === issueId);
    if (!issue) {
      throw new NotFoundException("Impact issue not found");
    }
    return issue;
  }

  private mustFindVersionProjectId(db: DevDatabase, versionId: string): string {
    const version = db.versions.find((item) => item.id === versionId);
    if (!version) {
      throw new NotFoundException("Version not found");
    }
    const document = db.documents.find((item) => item.id === version.documentId);
    if (!document) {
      throw new NotFoundException("Version document not found");
    }
    return document.projectId;
  }

  private stableStringify(value: unknown): string {
    if (value === null || typeof value !== "object") {
      return JSON.stringify(value);
    }
    if (Array.isArray(value)) {
      return `[${value.map((item) => this.stableStringify(item)).join(",")}]`;
    }
    const object = value as Record<string, unknown>;
    return `{${Object.keys(object).sort().map((key) => `${JSON.stringify(key)}:${this.stableStringify(object[key])}`).join(",")}}`;
  }
}
```

- [ ] **Step 4: Register service in module**

In `apps/api/src/workspace/workspace.module.ts`, import:

```ts
import { ImpactService } from "./impact.service";
```

Change providers and exports:

```ts
  providers: [WorkspaceService, AuditService, ImpactService],
  exports: [WorkspaceService, AuditService, ImpactService],
```

- [ ] **Step 5: Run API type check**

Run:

```powershell
npm --workspace @dramaflow/api run lint
```

Expected: command exits `0`.

- [ ] **Step 6: Commit core service**

```powershell
git add apps/api/src/workspace/impact.service.ts apps/api/src/workspace/workspace.module.ts
git commit -m "feat(api): add impact service core"
```

---

### Task 4: Add Dependency Recording And Impact Scanning

**Files:**
- Modify: `apps/api/src/workspace/impact.service.ts`
- Modify: `apps/api/src/workspace/workspace.service.ts`

- [ ] **Step 1: Add dependency recording to ImpactService**

In `apps/api/src/workspace/impact.service.ts`, add this public method before the private helpers:

```ts
  async recordDependenciesForVersion(versionId: string): Promise<VersionDependencyRecord[]> {
    return this.database.mutate((db) => {
      const version = db.versions.find((item) => item.id === versionId);
      if (!version) return [];
      const document = db.documents.find((item) => item.id === version.documentId);
      if (!document) return [];

      db.versionDependencies = db.versionDependencies.filter((item) => item.targetVersionId !== versionId);

      const metadata = version.metadata ?? {};
      const created: VersionDependencyRecord[] = [];
      const add = (
        sourceVersionId: string | undefined,
        dependencyType: DependencyType,
        targetAnchorType?: VersionDependencyRecord["targetAnchorType"],
        targetAnchorId?: string,
        sourceSnapshotHash?: string,
        targetSnapshotHash?: string,
      ) => {
        if (!sourceVersionId) return;
        const sourceVersion = db.versions.find((item) => item.id === sourceVersionId);
        const sourceDocument = sourceVersion ? db.documents.find((item) => item.id === sourceVersion.documentId) : undefined;
        const now = new Date().toISOString();
        const dependency: VersionDependencyRecord = {
          id: createId("dependency"),
          projectId: document.projectId,
          sourceDocumentId: sourceDocument?.id,
          sourceVersionId,
          sourceDocumentType: sourceDocument?.type,
          targetDocumentId: document.id,
          targetVersionId: version.id,
          targetDocumentType: document.type,
          dependencyType,
          targetAnchorType,
          targetAnchorId,
          sourceSnapshotHash,
          targetSnapshotHash,
          promptSnapshot: typeof metadata.promptSnapshot === "string" ? metadata.promptSnapshot : undefined,
          provider: typeof metadata.provider === "string" ? metadata.provider : undefined,
          model: typeof metadata.model === "string" ? metadata.model : undefined,
          configSource: metadata.llmConfigSource === "team" || metadata.llmConfigSource === "personal" ? metadata.llmConfigSource : undefined,
          createdBy: version.createdBy,
          createdAt: now,
        };
        db.versionDependencies.push(dependency);
        created.push(dependency);
      };

      add(metadata.sourceWorldBibleVersionId as string | undefined, document.type === "synopsis" ? "world_bible_to_synopsis" : document.type === "script" ? "world_bible_to_script" : "world_bible_to_storyboard");
      add(metadata.sourceSynopsisVersionId as string | undefined, "synopsis_to_script");
      add(metadata.sourceScriptVersionId as string | undefined, "script_to_storyboard");
      add(
        metadata.sourceStoryboardVersionId as string | undefined,
        "storyboard_to_media",
        "shot",
        metadata.shotId as string | undefined,
        metadata.sourceShotHash as string | undefined,
        metadata.targetSnapshotHash as string | undefined,
      );

      if (created.length === 0 && metadata.source === "restore" && typeof metadata.restoredFromVersionId === "string") {
        const inherited = db.versionDependencies.filter((item) => item.targetVersionId === metadata.restoredFromVersionId);
        for (const dependency of inherited) {
          const copy: VersionDependencyRecord = {
            ...dependency,
            id: createId("dependency"),
            targetDocumentId: document.id,
            targetVersionId: version.id,
            targetDocumentType: document.type,
            dependencyType: "manual_inherited",
            createdBy: version.createdBy,
            createdAt: new Date().toISOString(),
          };
          db.versionDependencies.push(copy);
          created.push(copy);
        }
      }

      if (created.length === 0) {
        const dependency: VersionDependencyRecord = {
          id: createId("dependency"),
          projectId: document.projectId,
          targetDocumentId: document.id,
          targetVersionId: version.id,
          targetDocumentType: document.type,
          dependencyType: "manual_unlinked",
          createdBy: version.createdBy,
          createdAt: new Date().toISOString(),
        };
        db.versionDependencies.push(dependency);
        created.push(dependency);
      }

      return created;
    });
  }
```

- [ ] **Step 2: Add scan after adoption**

In the same file, add this public method:

```ts
  async scanAfterAdoption(input: {
    projectId: string;
    sourceDocumentId: string;
    previousSourceVersionId?: string;
    changedSourceVersionId: string;
    actorId: string;
  }): Promise<ImpactIssueRecord[]> {
    return this.database.mutate((db) => {
      const sourceDocument = db.documents.find((item) => item.id === input.sourceDocumentId);
      if (!sourceDocument) return [];

      const dependencies = db.versionDependencies.filter((dependency) =>
        dependency.projectId === input.projectId
        && dependency.sourceVersionId
        && dependency.sourceVersionId !== input.changedSourceVersionId
        && dependency.sourceDocumentId === input.sourceDocumentId,
      );

      const created: ImpactIssueRecord[] = [];
      for (const dependency of dependencies) {
        const targetVersion = db.versions.find((version) => version.id === dependency.targetVersionId);
        const targetDocument = db.documents.find((document) => document.id === dependency.targetDocumentId);
        if (!targetVersion || !targetDocument) continue;

        const activeTarget =
          targetDocument.currentVersionId === targetVersion.id
          || targetDocument.draftVersionId === targetVersion.id
          || targetDocument.type === "image"
          || targetDocument.type === "video"
          || targetDocument.type === "audio"
          || targetDocument.type === "subtitle";
        if (!activeTarget) continue;

        const title = this.buildIssueTitle(sourceDocument, targetDocument, targetVersion);
        const summary = `Current ${sourceDocument.type} version changed from ${dependency.sourceVersionId} to ${input.changedSourceVersionId}. ${targetDocument.title} V${targetVersion.versionNumber} was created from the older source.`;
        const issue = this.createOrUpdateImpactIssue(db, {
          projectId: input.projectId,
          dependencyId: dependency.id,
          sourceDocumentId: sourceDocument.id,
          previousSourceVersionId: dependency.sourceVersionId,
          changedSourceVersionId: input.changedSourceVersionId,
          targetDocumentId: targetDocument.id,
          targetVersionId: targetVersion.id,
          dependencyType: dependency.dependencyType,
          severity: this.resolveSeverity(dependency, targetDocument, targetVersion),
          title,
          summary,
          targets: [{
            targetType: dependency.targetAnchorType === "shot" ? "shot" : "version",
            documentId: targetDocument.id,
            versionId: targetVersion.id,
            anchorId: dependency.targetAnchorId,
            label: dependency.targetAnchorId ? `${targetDocument.title} / ${dependency.targetAnchorId}` : `${targetDocument.title} V${targetVersion.versionNumber}`,
          }],
          actorId: input.actorId,
        });
        created.push(issue);
      }
      return created;
    });
  }
```

Add these private helpers:

```ts
  private createOrUpdateImpactIssue(db: DevDatabase, input: CreateImpactInput): ImpactIssueRecord {
    const target = input.targets[0];
    const existing = db.impactIssues.find((issue) =>
      issue.projectId === input.projectId
      && issue.dependencyId === input.dependencyId
      && issue.changedSourceVersionId === input.changedSourceVersionId
      && issue.targetVersionId === input.targetVersionId
      && db.impactTargets.some((item) =>
        item.issueId === issue.id
        && item.targetType === target.targetType
        && item.anchorId === target.anchorId,
      ),
    );

    const now = new Date().toISOString();
    if (existing) {
      existing.title = input.title;
      existing.summary = input.summary;
      existing.severity = input.severity;
      existing.updatedAt = now;
      if (!isActiveImpactIssueStatus(existing.status) && existing.status !== "ignored") {
        existing.status = "open";
      }
      this.appendEvent(db, existing, "created", input.actorId, "Impact refreshed for current source change");
      return existing;
    }

    const issue: ImpactIssueRecord = {
      id: createId("impact"),
      projectId: input.projectId,
      dependencyId: input.dependencyId,
      sourceDocumentId: input.sourceDocumentId,
      previousSourceVersionId: input.previousSourceVersionId,
      changedSourceVersionId: input.changedSourceVersionId,
      targetDocumentId: input.targetDocumentId,
      targetVersionId: input.targetVersionId,
      dependencyType: input.dependencyType,
      status: "open",
      severity: input.severity,
      title: input.title,
      summary: input.summary,
      createdBy: input.actorId,
      createdAt: now,
      updatedAt: now,
    };
    db.impactIssues.push(issue);

    for (const targetInput of input.targets) {
      db.impactTargets.push({
        id: createId("impact_target"),
        issueId: issue.id,
        projectId: input.projectId,
        targetType: targetInput.targetType,
        documentId: targetInput.documentId,
        versionId: targetInput.versionId,
        anchorId: targetInput.anchorId,
        label: targetInput.label,
        createdAt: now,
      });
    }

    this.appendEvent(db, issue, "created", input.actorId, input.summary);
    return issue;
  }

  private resolveSeverity(
    dependency: VersionDependencyRecord,
    targetDocument: DocumentRecord,
    targetVersion: VersionRecord,
  ): ImpactSeverity {
    if (targetDocument.currentVersionId === targetVersion.id) return "high";
    if (dependency.dependencyType === "synopsis_to_script" || dependency.dependencyType === "script_to_storyboard") return "high";
    if (dependency.dependencyType === "manual_unlinked") return "low";
    return "medium";
  }

  private buildIssueTitle(sourceDocument: DocumentRecord, targetDocument: DocumentRecord, targetVersion: VersionRecord): string {
    return `${targetDocument.title} V${targetVersion.versionNumber} may be affected by updated ${sourceDocument.type}`;
  }
```

- [ ] **Step 3: Inject ImpactService into WorkspaceService**

In `apps/api/src/workspace/workspace.service.ts`, import:

```ts
import { ImpactService } from "./impact.service";
```

Add it to the constructor:

```ts
    @Inject(ImpactService) private readonly impactService: ImpactService,
```

- [ ] **Step 4: Record dependencies from createVersionForDocument**

At the end of `createVersionForDocument`, before `return result.version;`, add:

```ts
    await this.impactService.recordDependenciesForVersion(result.version.id);
```

- [ ] **Step 5: Scan impact after adoption**

In `adoptDocumentVersion`, capture previous current version inside the mutate block:

```ts
    const result = await this.database.mutate((db) => {
      const liveDocument = this.mustFindDocument(db, documentId);
      const liveVersion = this.mustFindVersion(db, versionId);
      if (liveVersion.documentId !== liveDocument.id) {
        throw new BadRequestException("Version does not belong to the target document");
      }

      const previousCurrentVersionId = liveDocument.currentVersionId;
      liveDocument.currentVersionId = liveVersion.id;
      liveDocument.updatedAt = new Date().toISOString();
      return { document: liveDocument, previousCurrentVersionId };
    });
```

After audit recording and before returning, add:

```ts
    await this.impactService.scanAfterAdoption({
      projectId: document.projectId,
      sourceDocumentId: documentId,
      previousSourceVersionId: result.previousCurrentVersionId,
      changedSourceVersionId: versionId,
      actorId: userId,
    });

    return result.document;
```

Remove the older `return result;` from the method.

- [ ] **Step 6: Add impact summaries to version lists**

In `listProjectVersions`, after sorting and before return, map versions:

```ts
      const versionsWithImpact = all.map((version) => ({
        ...version,
        impactSummary: this.impactService.buildVersionImpactSummary(db, version.id),
      }));

      return {
        versions: applyPagination(versionsWithImpact, limit, offset),
        total: all.length,
      };
```

In `listVersions`, use the same pattern for that document's versions.

- [ ] **Step 7: Run API type check**

Run:

```powershell
npm --workspace @dramaflow/api run lint
```

Expected: command exits `0`.

- [ ] **Step 8: Commit dependency scanning**

```powershell
git add apps/api/src/workspace/impact.service.ts apps/api/src/workspace/workspace.service.ts
git commit -m "feat(api): record version dependencies and scan impacts"
```

---

### Task 5: Expose Impact REST API

**Files:**
- Create: `apps/api/src/workspace/impact.controller.ts`
- Modify: `apps/api/src/workspace/workspace.module.ts`

- [ ] **Step 1: Create ImpactController**

Create `apps/api/src/workspace/impact.controller.ts`:

```ts
import {
  Body,
  Controller,
  Get,
  Inject,
  Param,
  Post,
  Query,
  UseGuards,
} from "@nestjs/common";
import type {
  AssignImpactIssuePayload,
  IgnoreImpactIssuePayload,
  ImpactIssueStatus,
  ImpactSeverity,
  ImpactTargetType,
  ResolveImpactIssuePayload,
} from "@dramaflow/shared";

import { AuthGuard } from "../common/auth.guard";
import { CurrentUser } from "../common/current-user.decorator";
import { ImpactService } from "./impact.service";
import { WorkspaceService } from "./workspace.service";

@Controller()
@UseGuards(AuthGuard)
export class ImpactController {
  constructor(
    @Inject(ImpactService) private readonly impactService: ImpactService,
    @Inject(WorkspaceService) private readonly workspaceService: WorkspaceService,
  ) {}

  @Get("projects/:id/impact-issues")
  async listProjectIssues(
    @CurrentUser() user: { id: string },
    @Param("id") projectId: string,
    @Query("status") status?: ImpactIssueStatus,
    @Query("severity") severity?: ImpactSeverity,
    @Query("targetType") targetType?: ImpactTargetType,
    @Query("targetDocumentType") targetDocumentType?: string,
    @Query("assignedTo") assignedTo?: string,
    @Query("limit") limit?: string,
    @Query("offset") offset?: string,
  ) {
    await this.workspaceService.assertProjectPermission(user.id, projectId, "project.view", "You do not have permission to view project impacts");
    return this.impactService.listProjectIssues(projectId, {
      status,
      severity,
      targetType,
      targetDocumentType,
      assignedTo,
      limit: limit ? Number(limit) : undefined,
      offset: offset ? Number(offset) : undefined,
    });
  }

  @Get("impact-issues/:id")
  async getIssue(@CurrentUser() user: { id: string }, @Param("id") issueId: string) {
    const projectId = await this.impactService.getIssueProjectId(issueId);
    await this.workspaceService.assertProjectPermission(user.id, projectId, "project.view", "You do not have permission to view this impact issue");
    return this.impactService.getIssueDetail(issueId);
  }

  @Get("versions/:id/impact-summary")
  async getVersionSummary(@CurrentUser() user: { id: string }, @Param("id") versionId: string) {
    const projectId = await this.impactService.getVersionProjectId(versionId);
    await this.workspaceService.assertProjectPermission(user.id, projectId, "project.view", "You do not have permission to view this version impact summary");
    return this.impactService.getVersionImpactSummary(versionId);
  }

  @Post("impact-issues/:id/ignore")
  async ignoreIssue(
    @CurrentUser() user: { id: string },
    @Param("id") issueId: string,
    @Body() body: IgnoreImpactIssuePayload,
  ) {
    const projectId = await this.impactService.getIssueProjectId(issueId);
    await this.workspaceService.assertProjectPermission(user.id, projectId, "project.edit", "You do not have permission to ignore impact issues");
    return this.impactService.ignoreIssue(issueId, user.id, body.reason);
  }

  @Post("impact-issues/:id/reopen")
  async reopenIssue(@CurrentUser() user: { id: string }, @Param("id") issueId: string) {
    const projectId = await this.impactService.getIssueProjectId(issueId);
    await this.workspaceService.assertProjectPermission(user.id, projectId, "project.edit", "You do not have permission to reopen impact issues");
    return this.impactService.reopenIssue(issueId, user.id);
  }

  @Post("impact-issues/:id/resolve")
  async resolveIssue(
    @CurrentUser() user: { id: string },
    @Param("id") issueId: string,
    @Body() body: ResolveImpactIssuePayload,
  ) {
    const projectId = await this.impactService.getIssueProjectId(issueId);
    await this.workspaceService.assertProjectPermission(user.id, projectId, "project.edit", "You do not have permission to resolve impact issues");
    return this.impactService.resolveIssue(issueId, user.id, body.note);
  }

  @Post("impact-issues/:id/assign")
  async assignIssue(
    @CurrentUser() user: { id: string },
    @Param("id") issueId: string,
    @Body() body: AssignImpactIssuePayload,
  ) {
    const projectId = await this.impactService.getIssueProjectId(issueId);
    await this.workspaceService.assertProjectPermission(user.id, projectId, "project.edit", "You do not have permission to assign impact issues");
    return this.impactService.assignIssue(issueId, user.id, body.assignedTo);
  }
}
```

- [ ] **Step 2: Register controller**

In `apps/api/src/workspace/workspace.module.ts`, import:

```ts
import { ImpactController } from "./impact.controller";
```

Change controllers:

```ts
  controllers: [WorkspaceController, ImpactController],
```

- [ ] **Step 3: Run API type check**

Run:

```powershell
npm --workspace @dramaflow/api run lint
```

Expected: command exits `0`.

- [ ] **Step 4: Commit impact endpoints**

```powershell
git add apps/api/src/workspace/impact.controller.ts apps/api/src/workspace/workspace.module.ts
git commit -m "feat(api): expose impact issue endpoints"
```

---

### Task 6: Add Impact Suggestion Jobs And Candidate Acceptance

**Files:**
- Modify: `apps/api/src/workspace/impact.service.ts`
- Modify: `apps/api/src/jobs/jobs.service.ts`
- Modify: `apps/api/src/jobs/jobs.controller.ts`

- [ ] **Step 1: Add suggestion job creation and storage to ImpactService**

In `ImpactService`, add:

```ts
  async createSuggestionJob(issueId: string, actorId: string, instruction?: string) {
    return this.database.mutate((db) => {
      const issue = this.mustFindIssue(db, issueId);
      const now = new Date().toISOString();
      const job = {
        id: createId("job"),
        type: "impact_suggestion" as const,
        status: "queued" as const,
        projectId: issue.projectId,
        documentId: issue.targetDocumentId,
        input: { issueId, instruction: instruction?.trim() || undefined },
        createdBy: actorId,
        createdAt: now,
        updatedAt: now,
      };
      db.jobs.push(job);
      return job;
    });
  }

  async buildSuggestionPrompt(issueId: string): Promise<{ system: string; prompt: string; projectId: string }> {
    return this.database.query((db) => {
      const issue = this.mustFindIssue(db, issueId);
      const targetVersion = db.versions.find((version) => version.id === issue.targetVersionId);
      const previousSource = issue.previousSourceVersionId ? db.versions.find((version) => version.id === issue.previousSourceVersionId) : undefined;
      const changedSource = db.versions.find((version) => version.id === issue.changedSourceVersionId);
      const targets = db.impactTargets.filter((target) => target.issueId === issue.id);
      return {
        projectId: issue.projectId,
        system: "You are a professional film production script supervisor. Analyze upstream changes and propose a safe candidate update. Return JSON with summary and suggestedContent.",
        prompt: [
          `Impact issue: ${issue.title}`,
          issue.summary,
          "",
          "Previous source version:",
          JSON.stringify(previousSource?.content ?? null, null, 2).slice(0, 5000),
          "",
          "Changed source version:",
          JSON.stringify(changedSource?.content ?? null, null, 2).slice(0, 5000),
          "",
          "Target content:",
          JSON.stringify(targetVersion?.content ?? null, null, 2).slice(0, 8000),
          "",
          "Targets:",
          JSON.stringify(targets, null, 2),
          "",
          "Return JSON: { \"summary\": string, \"suggestedContent\": any }.",
        ].join("\n"),
      };
    });
  }

  async storeSuggestion(input: {
    issueId: string;
    actorId: string;
    summary: string;
    suggestedContent?: unknown;
    promptSnapshot?: string;
    provider?: string;
    model?: string;
    createdJobId?: string;
  }): Promise<ImpactSuggestionRecord> {
    return this.database.mutate((db) => {
      const issue = this.mustFindIssue(db, input.issueId);
      const suggestion: ImpactSuggestionRecord = {
        id: createId("impact_suggestion"),
        issueId: issue.id,
        projectId: issue.projectId,
        status: "generated",
        summary: input.summary,
        suggestedContent: input.suggestedContent,
        promptSnapshot: input.promptSnapshot,
        provider: input.provider,
        model: input.model,
        createdJobId: input.createdJobId,
        createdBy: input.actorId,
        createdAt: new Date().toISOString(),
      };
      db.impactSuggestions.push(suggestion);
      issue.status = "suggested";
      issue.latestSuggestionId = suggestion.id;
      issue.updatedAt = new Date().toISOString();
      this.appendEvent(db, issue, "suggestion_created", input.actorId, input.summary);
      return suggestion;
    });
  }
```

- [ ] **Step 2: Add accept and revert methods**

In `ImpactService`, add:

```ts
  async acceptSuggestion(suggestionId: string, actorId: string) {
    return this.database.mutate((db) => {
      const suggestion = db.impactSuggestions.find((item) => item.id === suggestionId);
      if (!suggestion) throw new NotFoundException("Impact suggestion not found");
      const issue = this.mustFindIssue(db, suggestion.issueId);
      if (suggestion.status !== "generated") {
        throw new BadRequestException("Only generated suggestions can be accepted");
      }
      if (!canTransitionImpactIssueStatus(issue.status, "accepted")) {
        throw new BadRequestException(`Cannot accept suggestion while impact issue is ${issue.status}`);
      }

      const targetDocument = db.documents.find((document) => document.id === issue.targetDocumentId);
      const targetVersion = db.versions.find((version) => version.id === issue.targetVersionId);
      if (!targetDocument || !targetVersion) {
        throw new NotFoundException("Suggestion target is not available");
      }

      const siblingVersions = db.versions.filter((version) => version.documentId === targetDocument.id);
      const nextVersionNumber = siblingVersions.reduce((max, version) => Math.max(max, version.versionNumber), 0) + 1;
      const now = new Date().toISOString();
      const createdVersion: VersionRecord = {
        id: createId("version"),
        documentId: targetDocument.id,
        versionNumber: nextVersionNumber,
        status: "draft",
        title: `${targetVersion.title} - Impact candidate`,
        content: suggestion.suggestedContent ?? targetVersion.content,
        metadata: {
          ...(targetVersion.metadata ?? {}),
          source: "impact-suggestion",
          impactIssueId: issue.id,
          impactSuggestionId: suggestion.id,
        },
        parentVersionId: targetVersion.id,
        createdBy: actorId,
        createdAt: now,
      };
      db.versions.push(createdVersion);
      for (const dependency of db.versionDependencies.filter((item) => item.targetVersionId === targetVersion.id)) {
        db.versionDependencies.push({
          ...dependency,
          id: createId("dependency"),
          targetDocumentId: targetDocument.id,
          targetVersionId: createdVersion.id,
          targetDocumentType: targetDocument.type,
          dependencyType: "manual_inherited",
          createdBy: actorId,
          createdAt: now,
        });
      }
      targetDocument.draftVersionId = createdVersion.id;
      targetDocument.updatedAt = now;

      suggestion.status = "accepted";
      suggestion.createdVersionId = createdVersion.id;
      suggestion.createdDocumentId = targetDocument.id;
      suggestion.acceptedBy = actorId;
      suggestion.acceptedAt = now;
      issue.status = "accepted";
      issue.acceptedSuggestionId = suggestion.id;
      issue.updatedAt = now;
      this.appendEvent(db, issue, "suggestion_accepted", actorId, `Created candidate version V${createdVersion.versionNumber}`);
      return { issue, suggestion, createdVersion };
    });
  }

  async revertSuggestionAcceptance(suggestionId: string, actorId: string) {
    return this.database.mutate((db) => {
      const suggestion = db.impactSuggestions.find((item) => item.id === suggestionId);
      if (!suggestion) throw new NotFoundException("Impact suggestion not found");
      const issue = this.mustFindIssue(db, suggestion.issueId);
      if (suggestion.status !== "accepted") {
        throw new BadRequestException("Only accepted suggestions can be reverted");
      }

      const now = new Date().toISOString();
      suggestion.status = "acceptance_reverted";
      suggestion.revertedBy = actorId;
      suggestion.revertedAt = now;
      issue.status = "suggested";
      issue.acceptedSuggestionId = undefined;
      issue.updatedAt = now;
      this.appendEvent(db, issue, "acceptance_reverted", actorId, "Suggestion acceptance reverted");
      return this.buildIssueDetail(db, issue);
    });
  }
```

- [ ] **Step 3: Inject ImpactService into JobsService**

In `apps/api/src/jobs/jobs.service.ts`, import:

```ts
import { ImpactService } from "../workspace/impact.service";
```

Add it to the constructor:

```ts
    @Inject(ImpactService) private readonly impactService: ImpactService,
```

Add a public method:

```ts
  async createImpactSuggestionJob(userId: string, issueId: string, instruction?: string) {
    const projectId = await this.impactService.getIssueProjectId(issueId);
    await this.workspaceService.assertProjectPermission(
      userId,
      projectId,
      "job.manage",
      "You do not have permission to create impact suggestion jobs",
    );
    const job = await this.impactService.createSuggestionJob(issueId, userId, instruction);
    this.emitJobUpdated(job);
    return job;
  }
```

- [ ] **Step 4: Process impact suggestion jobs**

In `processJob`, add a switch case:

```ts
        case "impact_suggestion":
          return await this.processImpactSuggestionJob(job as unknown as JobRecord<{ issueId: string; instruction?: string }>);
```

Add the private method near other text job processors:

```ts
  private async processImpactSuggestionJob(job: JobRecord<{ issueId: string; instruction?: string }>) {
    const promptData = await this.impactService.buildSuggestionPrompt(job.input.issueId);
    const config = await this.resolveTextLlmConfig(job.createdBy, promptData.projectId);
    const model = this.resolveTextModel(config);
    const response = await this.textProvider.rewriteSegment({
      documentId: job.documentId ?? "",
      originalText: `${promptData.system}\n\n${promptData.prompt}`,
      instruction: job.input.instruction || "Create a safe candidate update for this impact issue.",
    }, config);

    let parsed: { summary?: string; suggestedContent?: unknown };
    try {
      const cleaned = response.trim().replace(/^```(?:json)?\s*\n?/i, "").replace(/\n?```\s*$/i, "");
      parsed = JSON.parse(cleaned) as { summary?: string; suggestedContent?: unknown };
    } catch {
      parsed = { summary: response, suggestedContent: undefined };
    }

    const suggestion = await this.impactService.storeSuggestion({
      issueId: job.input.issueId,
      actorId: job.createdBy,
      summary: parsed.summary?.trim() || "Impact suggestion generated",
      suggestedContent: parsed.suggestedContent,
      promptSnapshot: `${promptData.system}\n\n${promptData.prompt}`,
      provider: "openai-completions",
      model,
      createdJobId: job.id,
    });

    return this.completeJob(job.id, {
      issueId: job.input.issueId,
      suggestionId: suggestion.id,
      summary: suggestion.summary,
      model,
    });
  }
```

- [ ] **Step 5: Add suggestion endpoints to JobsController**

In `apps/api/src/jobs/jobs.controller.ts`, add shared imports:

```ts
import type { CreateImpactSuggestionPayload } from "@dramaflow/shared";
```

Add endpoint methods:

```ts
  @Post("impact-issues/:id/suggestions")
  createImpactSuggestion(
    @CurrentUser() user: { id: string },
    @Param("id") issueId: string,
    @Body() body: CreateImpactSuggestionPayload,
  ) {
    return this.jobsService.createImpactSuggestionJob(user.id, issueId, body.instruction);
  }
```

If the controller already imports `Post`, `Body`, and `Param`, reuse those imports instead of duplicating them.

- [ ] **Step 6: Add accept endpoints to ImpactController**

In `apps/api/src/workspace/impact.controller.ts`, add these endpoints. They must check permission before calling the mutating service methods:

```ts
  @Post("impact-suggestions/:id/accept")
  async acceptSuggestion(@CurrentUser() user: { id: string }, @Param("id") suggestionId: string) {
    const projectId = await this.impactService.getSuggestionProjectId(suggestionId);
    await this.workspaceService.assertProjectPermission(user.id, projectId, "project.edit", "You do not have permission to accept impact suggestions");
    return this.impactService.acceptSuggestion(suggestionId, user.id);
  }

  @Post("impact-suggestions/:id/revert-acceptance")
  async revertSuggestionAcceptance(@CurrentUser() user: { id: string }, @Param("id") suggestionId: string) {
    const projectId = await this.impactService.getSuggestionProjectId(suggestionId);
    await this.workspaceService.assertProjectPermission(user.id, projectId, "project.edit", "You do not have permission to revert impact suggestions");
    return this.impactService.revertSuggestionAcceptance(suggestionId, user.id);
  }
```

- [ ] **Step 7: Run API type check**

Run:

```powershell
npm --workspace @dramaflow/api run lint
```

Expected: command exits `0`.

- [ ] **Step 8: Commit suggestion workflow**

```powershell
git add apps/api/src/workspace/impact.service.ts apps/api/src/workspace/impact.controller.ts apps/api/src/jobs/jobs.service.ts apps/api/src/jobs/jobs.controller.ts
git commit -m "feat(api): add impact suggestion workflow"
```

---

### Task 7: Wire Generation Metadata Into Dependencies

**Files:**
- Modify: `apps/api/src/jobs/jobs.service.ts`

- [ ] **Step 1: Add helper to find current document version**

In `JobsService`, add this private helper near `resolveTTSVoice`:

```ts
  private async getCurrentVersionReference(projectId: string, type: DocumentType) {
    return this.database.query((db) => {
      const document = db.documents.find((item) => item.projectId === projectId && item.type === type);
      const version = document?.currentVersionId
        ? db.versions.find((item) => item.id === document.currentVersionId)
        : undefined;
      return document && version ? { document, version } : null;
    });
  }
```

Also add `DocumentType` to the `@dramaflow/shared` type import list.

- [ ] **Step 2: Record world bible source for synopsis jobs**

In `processSynopsisJob`, after `const worldBible = await this.getWorldBible(...)`, add:

```ts
    const worldBibleRef = await this.getCurrentVersionReference(job.projectId, "world_bible");
```

In the `metadata` object for the created synopsis version, add:

```ts
        ...(worldBibleRef?.version.id ? { sourceWorldBibleVersionId: worldBibleRef.version.id } : {}),
        promptSnapshot: JSON.stringify(enrichedInput),
```

Make the same metadata addition in `streamSynopsisJob`.

- [ ] **Step 3: Record world bible and synopsis sources for script jobs**

In `processScriptJob`, add:

```ts
    const worldBibleRef = await this.getCurrentVersionReference(job.projectId, "world_bible");
```

In script version metadata, add:

```ts
        ...(worldBibleRef?.version.id ? { sourceWorldBibleVersionId: worldBibleRef.version.id } : {}),
        ...(job.input.sourceSynopsisVersionId ? { sourceSynopsisVersionId: job.input.sourceSynopsisVersionId } : {}),
        promptSnapshot: JSON.stringify(enrichedInput),
```

Make the same metadata addition in `streamScriptJob`.

- [ ] **Step 4: Record script and world bible sources for storyboard jobs**

In `processStoryboardJob`, add:

```ts
    const worldBibleRef = await this.getCurrentVersionReference(job.projectId, "world_bible");
```

In storyboard version metadata, add:

```ts
        sourceScriptVersionId: job.input.versionId,
        ...(worldBibleRef?.version.id ? { sourceWorldBibleVersionId: worldBibleRef.version.id } : {}),
        promptSnapshot: JSON.stringify({ ...enrichedStoryboardInput, script }),
```

Make the same metadata addition in `streamStoryboardJob`.

- [ ] **Step 5: Record storyboard and shot source for media jobs**

In `finalizeMediaJob`, before `createVersionForDocument`, add:

```ts
    const storyboardRef = await this.database.query((db) => {
      const storyboardDocument = db.documents.find((item) => item.projectId === job.projectId && item.type === "storyboard");
      const storyboardVersion = storyboardDocument?.currentVersionId
        ? db.versions.find((item) => item.id === storyboardDocument.currentVersionId)
        : undefined;
      const storyboardContent = storyboardVersion?.content as StoryboardContent | undefined;
      const sourceShot = storyboardContent?.shots?.find((shot) => shot.id === job.shotId);
      return {
        versionId: storyboardVersion?.id,
        shotHash: sourceShot ? this.impactService.stableHash(sourceShot) : undefined,
      };
    });
```

In media version metadata, add:

```ts
        ...(storyboardRef.versionId ? { sourceStoryboardVersionId: storyboardRef.versionId } : {}),
        ...(storyboardRef.shotHash ? { sourceShotHash: storyboardRef.shotHash, targetSnapshotHash: storyboardRef.shotHash } : {}),
        promptSnapshot: prompt,
```

- [ ] **Step 6: Run API type check**

Run:

```powershell
npm --workspace @dramaflow/api run lint
```

Expected: command exits `0`.

- [ ] **Step 7: Commit generation metadata wiring**

```powershell
git add apps/api/src/jobs/jobs.service.ts
git commit -m "feat(api): record generation source metadata"
```

---

### Task 8: Add Frontend Impact Hooks And Shared UI Components

**Files:**
- Modify: `apps/web/lib/query-keys.ts`
- Create: `apps/web/lib/hooks/use-impact-issues.ts`
- Modify: `apps/web/lib/hooks/index.ts`
- Create: `apps/web/components/project-workspace/impact-issue-list.tsx`
- Create: `apps/web/components/project-workspace/version-lineage-strip.tsx`
- Create: `apps/web/components/project-workspace/generation/generation-impact-health.tsx`

- [ ] **Step 1: Add query keys**

In `apps/web/lib/query-keys.ts`, add:

```ts
  projectImpactIssues: (projectId: string, status?: string) => ["project-impact-issues", projectId, status ?? "all"] as const,
  impactIssue: (issueId: string) => ["impact-issue", issueId] as const,
  versionImpactSummary: (versionId: string) => ["version-impact-summary", versionId] as const,
```

- [ ] **Step 2: Add impact hook**

Create `apps/web/lib/hooks/use-impact-issues.ts`:

```ts
"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  ImpactIssueDetailResponse,
  ImpactIssueStatus,
  ProjectImpactIssuesResponse,
  VersionImpactSummary,
} from "@dramaflow/shared";

import { apiFetch } from "../api";
import { queryKeys } from "../query-keys";

export function useProjectImpactIssues(projectId: string, status?: ImpactIssueStatus, enabled = true) {
  return useQuery({
    queryKey: queryKeys.projectImpactIssues(projectId, status),
    queryFn: () => apiFetch<ProjectImpactIssuesResponse>(
      `/projects/${projectId}/impact-issues${status ? `?status=${status}` : ""}`,
    ),
    enabled: Boolean(projectId) && enabled,
  });
}

export function useImpactIssue(issueId: string | null) {
  return useQuery({
    queryKey: issueId ? queryKeys.impactIssue(issueId) : ["impact-issue", "none"],
    queryFn: () => apiFetch<ImpactIssueDetailResponse>(`/impact-issues/${issueId}`),
    enabled: Boolean(issueId),
  });
}

export function useVersionImpactSummary(versionId: string | null) {
  return useQuery({
    queryKey: versionId ? queryKeys.versionImpactSummary(versionId) : ["version-impact-summary", "none"],
    queryFn: () => apiFetch<VersionImpactSummary>(`/versions/${versionId}/impact-summary`),
    enabled: Boolean(versionId),
  });
}

export function useImpactMutations(projectId: string) {
  const queryClient = useQueryClient();

  async function invalidateImpact() {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["project-impact-issues", projectId] }),
      queryClient.invalidateQueries({ queryKey: queryKeys.projectVersions(projectId) }),
      queryClient.invalidateQueries({ queryKey: queryKeys.project(projectId) }),
    ]);
  }

  const ignore = useMutation({
    mutationFn: (vars: { issueId: string; reason?: string }) =>
      apiFetch(`/impact-issues/${vars.issueId}/ignore`, { method: "POST", body: { reason: vars.reason } }),
    onSuccess: invalidateImpact,
  });

  const reopen = useMutation({
    mutationFn: (issueId: string) => apiFetch(`/impact-issues/${issueId}/reopen`, { method: "POST" }),
    onSuccess: invalidateImpact,
  });

  const resolve = useMutation({
    mutationFn: (vars: { issueId: string; note?: string }) =>
      apiFetch(`/impact-issues/${vars.issueId}/resolve`, { method: "POST", body: { note: vars.note } }),
    onSuccess: invalidateImpact,
  });

  const createSuggestion = useMutation({
    mutationFn: (vars: { issueId: string; instruction?: string }) =>
      apiFetch(`/impact-issues/${vars.issueId}/suggestions`, { method: "POST", body: { instruction: vars.instruction } }),
    onSuccess: invalidateImpact,
  });

  const acceptSuggestion = useMutation({
    mutationFn: (suggestionId: string) => apiFetch(`/impact-suggestions/${suggestionId}/accept`, { method: "POST" }),
    onSuccess: invalidateImpact,
  });

  const revertAcceptance = useMutation({
    mutationFn: (suggestionId: string) => apiFetch(`/impact-suggestions/${suggestionId}/revert-acceptance`, { method: "POST" }),
    onSuccess: invalidateImpact,
  });

  return { ignore, reopen, resolve, createSuggestion, acceptSuggestion, revertAcceptance };
}
```

In `apps/web/lib/hooks/index.ts`, add:

```ts
export { useImpactIssue, useImpactMutations, useProjectImpactIssues, useVersionImpactSummary } from "./use-impact-issues";
```

- [ ] **Step 3: Add ImpactIssueList component**

Create `apps/web/components/project-workspace/impact-issue-list.tsx`:

```tsx
"use client";

import type { ImpactIssueSummary } from "@dramaflow/shared";
import { useI18n } from "../../lib/i18n";

interface Props {
  issues: ImpactIssueSummary[];
  activeIssueId?: string;
  onSelectIssue?: (issueId: string) => void;
  onIgnore?: (issueId: string) => void;
  onReopen?: (issueId: string) => void;
  onResolve?: (issueId: string) => void;
  onSuggest?: (issueId: string) => void;
  isMutating?: boolean;
}

export function ImpactIssueList({
  issues,
  activeIssueId,
  onSelectIssue,
  onIgnore,
  onReopen,
  onResolve,
  onSuggest,
  isMutating,
}: Props) {
  const { t } = useI18n();

  if (issues.length === 0) {
    return <div className="impact-empty">{t("impact.empty")}</div>;
  }

  return (
    <div className="impact-list">
      {issues.map((issue) => (
        <div
          key={issue.id}
          className={`impact-row${activeIssueId === issue.id ? " impact-row--active" : ""}`}
          role={onSelectIssue ? "button" : undefined}
          tabIndex={onSelectIssue ? 0 : undefined}
          onClick={() => onSelectIssue?.(issue.id)}
          onKeyDown={(event) => {
            if (!onSelectIssue) return;
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              onSelectIssue(issue.id);
            }
          }}
        >
          <div className="impact-row__main">
            <span className={`impact-badge impact-badge--${issue.status}`}>
              {t(`impact.status.${issue.status}` as any)}
            </span>
            <span className={`impact-severity impact-severity--${issue.severity}`}>
              {t(`impact.severity.${issue.severity}` as any)}
            </span>
            <strong className="impact-row__title">{issue.title}</strong>
            <span className="impact-row__summary">{issue.summary}</span>
          </div>
          <div className="impact-row__actions" onClick={(event) => event.stopPropagation()}>
            {(issue.status === "ignored" || issue.status === "resolved") && onReopen ? (
              <button className="btn btn-secondary btn-sm" type="button" disabled={isMutating} onClick={() => onReopen(issue.id)}>
                {t("impact.actions.reopen")}
              </button>
            ) : null}
            {(issue.status === "open" || issue.status === "suggested") && onSuggest ? (
              <button className="btn btn-secondary btn-sm" type="button" disabled={isMutating} onClick={() => onSuggest(issue.id)}>
                {t("impact.actions.suggest")}
              </button>
            ) : null}
            {(issue.status === "open" || issue.status === "suggested") && onIgnore ? (
              <button className="btn btn-ghost btn-sm" type="button" disabled={isMutating} onClick={() => onIgnore(issue.id)}>
                {t("impact.actions.ignore")}
              </button>
            ) : null}
            {issue.status !== "resolved" && issue.status !== "ignored" && onResolve ? (
              <button className="btn btn-primary btn-sm" type="button" disabled={isMutating} onClick={() => onResolve(issue.id)}>
                {t("impact.actions.resolve")}
              </button>
            ) : null}
          </div>
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 4: Add VersionLineageStrip component**

Create `apps/web/components/project-workspace/version-lineage-strip.tsx`:

```tsx
"use client";

import type { VersionImpactSummary } from "@dramaflow/shared";
import { useI18n } from "../../lib/i18n";

interface Props {
  summary?: VersionImpactSummary;
  onViewIssues?: () => void;
}

export function VersionLineageStrip({ summary, onViewIssues }: Props) {
  const { t } = useI18n();
  if (!summary) return null;

  const activeCount = summary.openCount + summary.suggestedCount + summary.acceptedCount;
  const dependencyLabels = summary.dependencies
    .filter((dependency) => dependency.sourceVersionId)
    .map((dependency) => `${dependency.sourceDocumentType ?? "source"} ${dependency.sourceVersionId?.slice(0, 8)}`);

  return (
    <div className={`lineage-strip${activeCount > 0 ? " lineage-strip--warning" : ""}`}>
      <div className="lineage-strip__main">
        <span className="lineage-strip__label">{t("impact.lineage.basedOn")}</span>
        <span className="lineage-strip__sources">
          {dependencyLabels.length > 0 ? dependencyLabels.join(" · ") : t("impact.lineage.unlinked")}
        </span>
      </div>
      <div className="lineage-strip__meta">
        <span>{t("impact.lineage.activeCount", { count: activeCount })}</span>
        {summary.ignoredCount > 0 ? <span>{t("impact.lineage.ignoredCount", { count: summary.ignoredCount })}</span> : null}
        {onViewIssues && activeCount > 0 ? (
          <button className="btn btn-secondary btn-sm" type="button" onClick={onViewIssues}>
            {t("impact.actions.view")}
          </button>
        ) : null}
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Add GenerationImpactHealth component**

Create `apps/web/components/project-workspace/generation/generation-impact-health.tsx`:

```tsx
"use client";

import type { ProjectWorkspacePayload } from "@dramaflow/shared";
import { useI18n } from "../../../lib/i18n";

interface Props {
  project: ProjectWorkspacePayload;
  sourceVersionId?: string;
}

export function GenerationImpactHealth({ project, sourceVersionId }: Props) {
  const { t } = useI18n();
  const sourceVersion = sourceVersionId
    ? project.versions.find((version) => version.id === sourceVersionId)
    : null;
  const impactSummary = sourceVersion?.impactSummary;
  const activeCount = impactSummary
    ? impactSummary.openCount + impactSummary.suggestedCount + impactSummary.acceptedCount
    : 0;

  if (!sourceVersion || activeCount === 0) {
    return (
      <div className="impact-health impact-health--ok">
        {t("impact.health.ok")}
      </div>
    );
  }

  return (
    <div className="impact-health impact-health--warning">
      {t("impact.health.warning", {
        version: `V${sourceVersion.versionNumber}`,
        count: activeCount,
      })}
    </div>
  );
}
```

- [ ] **Step 6: Run web type check**

Run:

```powershell
npm --workspace @dramaflow/web run lint
```

Expected: command exits `0` or fails only because the new i18n/CSS keys are not added yet. If it fails for missing keys, keep moving to Task 9 before final verification.

- [ ] **Step 7: Commit hooks and components**

```powershell
git add apps/web/lib/query-keys.ts apps/web/lib/hooks/use-impact-issues.ts apps/web/lib/hooks/index.ts apps/web/components/project-workspace/impact-issue-list.tsx apps/web/components/project-workspace/version-lineage-strip.tsx apps/web/components/project-workspace/generation/generation-impact-health.tsx
git commit -m "feat(web): add impact data hooks and components"
```

---

### Task 9: Integrate Impact UI Into Workspace

**Files:**
- Modify: `apps/web/components/project-workspace/version-view.tsx`
- Modify: `apps/web/components/project-workspace/version-management-panel.tsx`
- Modify: `apps/web/components/project-workspace/generation/quick-generator.tsx`
- Modify: `apps/web/components/project-workspace/task-panel.tsx`

- [ ] **Step 1: Add lineage strip to VersionView**

In `version-view.tsx`, import:

```ts
import { VersionLineageStrip } from "./version-lineage-strip";
```

Update the local `Version` interface:

```ts
interface Version {
  id: string;
  title: string;
  versionNumber: number;
  status: string;
  content: unknown;
  metadata?: Record<string, unknown>;
  impactSummary?: ProjectWorkspacePayload["versions"][number]["impactSummary"];
  createdAt: string;
}
```

Render the strip after the `vv-header` block:

```tsx
      <VersionLineageStrip summary={currentVersion.impactSummary} />
```

- [ ] **Step 2: Add impact badges to VersionManagementPanel list**

In `version-management-panel.tsx`, extend the version pick type with `impactSummary?: VersionImpactSummary` by importing `VersionImpactSummary`:

```ts
import type { VersionImpactSummary, VersionRecord } from "@dramaflow/shared";
```

Add helper near status styling:

```ts
function getImpactBadge(summary?: VersionImpactSummary): { labelKey: string; tone: string } | null {
  if (!summary) return null;
  if (summary.openCount > 0) return { labelKey: "impact.status.open", tone: "warning" };
  if (summary.suggestedCount > 0) return { labelKey: "impact.status.suggested", tone: "info" };
  if (summary.acceptedCount > 0) return { labelKey: "impact.status.accepted", tone: "success" };
  if (summary.ignoredCount > 0) return { labelKey: "impact.status.ignored", tone: "neutral" };
  return null;
}
```

Inside the version row render, after the status badge, add:

```tsx
                  {getImpactBadge(version.impactSummary) ? (
                    <span className={`vmp-impact-badge vmp-impact-badge--${getImpactBadge(version.impactSummary)!.tone}`}>
                      {t(getImpactBadge(version.impactSummary)!.labelKey as any)}
                    </span>
                  ) : null}
```

Inside `renderSingleView`, after the preview header, add:

```tsx
        {selectedVersion.impactSummary ? (
          <div className="vmp-impact-panel">
            <VersionLineageStrip summary={selectedVersion.impactSummary} />
            {selectedVersion.impactSummary.latestIssues.length > 0 ? (
              <ImpactIssueList issues={selectedVersion.impactSummary.latestIssues} />
            ) : null}
          </div>
        ) : null}
```

Import:

```ts
import { ImpactIssueList } from "./impact-issue-list";
import { VersionLineageStrip } from "./version-lineage-strip";
```

- [ ] **Step 3: Add generation health to QuickGenerator**

In `quick-generator.tsx`, import:

```ts
import { GenerationImpactHealth } from "./generation-impact-health";
```

Render after `WorldBibleIndicator`:

```tsx
            <GenerationImpactHealth project={project} sourceVersionId={sourceVersionId} />
```

- [ ] **Step 4: Add impact view to TaskPanel**

In `task-panel.tsx`, import:

```ts
import type { ImpactIssueStatus } from "@dramaflow/shared";
import { useImpactMutations, useProjectImpactIssues } from "../../lib/hooks";
import { ImpactIssueList } from "./impact-issue-list";
```

Change filter state:

```ts
type PanelView = "jobs" | "impacts";
const [panelView, setPanelView] = useState<PanelView>("jobs");
const [impactStatus, setImpactStatus] = useState<ImpactIssueStatus | undefined>(undefined);
const impactQuery = useProjectImpactIssues(projectId, impactStatus, panelView === "impacts");
const impactMutations = useImpactMutations(projectId);
```

Add view tabs below feedback:

```tsx
      <div className="task-panel__filters">
        <button
          className={`task-panel__filter${panelView === "jobs" ? " task-panel__filter--active" : ""}`}
          type="button"
          onClick={() => setPanelView("jobs")}
        >
          {t("taskPanel.jobsView")}
        </button>
        <button
          className={`task-panel__filter${panelView === "impacts" ? " task-panel__filter--active" : ""}`}
          type="button"
          onClick={() => setPanelView("impacts")}
        >
          {t("impact.title")}
        </button>
      </div>
```

Wrap the existing job filters and job list with:

```tsx
      {panelView === "jobs" && (
        <>
          {/* existing job filter tabs and job list stay here */}
        </>
      )}
```

Add the impact branch after the job branch:

```tsx
      {panelView === "impacts" && (
        <div className="task-panel__list">
          <div className="task-panel__filters">
            {([undefined, "open", "suggested", "accepted", "ignored", "resolved"] as Array<ImpactIssueStatus | undefined>).map((status) => (
              <button
                key={status ?? "all"}
                className={`task-panel__filter${impactStatus === status ? " task-panel__filter--active" : ""}`}
                type="button"
                onClick={() => setImpactStatus(status)}
              >
                {status ? t(`impact.status.${status}` as any) : t("taskPanel.filterAll")}
              </button>
            ))}
          </div>
          {impactQuery.isPending ? (
            <div className="task-panel__empty">{t("taskPanel.loading")}</div>
          ) : (
            <ImpactIssueList
              issues={impactQuery.data?.issues ?? []}
              onIgnore={(issueId) => impactMutations.ignore.mutate({ issueId })}
              onReopen={(issueId) => impactMutations.reopen.mutate(issueId)}
              onResolve={(issueId) => impactMutations.resolve.mutate({ issueId })}
              onSuggest={(issueId) => impactMutations.createSuggestion.mutate({ issueId })}
              isMutating={
                impactMutations.ignore.isPending
                || impactMutations.reopen.isPending
                || impactMutations.resolve.isPending
                || impactMutations.createSuggestion.isPending
              }
            />
          )}
        </div>
      )}
```

- [ ] **Step 5: Run web type check**

Run:

```powershell
npm --workspace @dramaflow/web run lint
```

Expected: command exits `0` or fails only for i18n/CSS keys added in Task 10.

- [ ] **Step 6: Commit UI integration**

```powershell
git add apps/web/components/project-workspace/version-view.tsx apps/web/components/project-workspace/version-management-panel.tsx apps/web/components/project-workspace/generation/quick-generator.tsx apps/web/components/project-workspace/task-panel.tsx
git commit -m "feat(web): surface impact issues in workspace"
```

---

### Task 10: Add Impact I18n, Styles, And Final Verification

**Files:**
- Modify: `apps/web/lib/i18n/messages.ts`
- Modify: `apps/web/app/globals.css`

- [ ] **Step 1: Add Chinese messages**

In the Chinese message object in `messages.ts`, add:

```ts
  impact: {
    title: "影响事项",
    empty: "暂无影响事项",
    status: {
      open: "未处理",
      suggested: "已有建议",
      accepted: "已接受",
      ignored: "已忽略",
      resolved: "已解决",
    },
    severity: {
      low: "低",
      medium: "中",
      high: "高",
    },
    actions: {
      view: "查看影响",
      suggest: "生成建议",
      ignore: "忽略",
      reopen: "重新打开",
      resolve: "标记解决",
    },
    lineage: {
      basedOn: "基于",
      unlinked: "未记录来源",
      activeCount: "{count} 条待处理",
      ignoredCount: "{count} 条已忽略",
    },
    health: {
      ok: "当前生成输入没有未处理影响。",
      warning: "来源 {version} 有 {count} 条未处理影响，建议生成前先检查。",
    },
  },
```

Add `jobsView: "任务"` under the existing `taskPanel` messages.

Add `impact_suggestion: "影响建议"` inside `taskPanel.jobTypes`.

- [ ] **Step 2: Add English messages**

In the English message object, add:

```ts
  impact: {
    title: "Impact Issues",
    empty: "No impact issues",
    status: {
      open: "Open",
      suggested: "Suggested",
      accepted: "Accepted",
      ignored: "Ignored",
      resolved: "Resolved",
    },
    severity: {
      low: "Low",
      medium: "Medium",
      high: "High",
    },
    actions: {
      view: "View",
      suggest: "Generate suggestion",
      ignore: "Ignore",
      reopen: "Reopen",
      resolve: "Resolve",
    },
    lineage: {
      basedOn: "Based on",
      unlinked: "Unlinked",
      activeCount: "{count} active",
      ignoredCount: "{count} ignored",
    },
    health: {
      ok: "The selected generation input has no active impact issues.",
      warning: "Source {version} has {count} active impact issues. Review them before generating.",
    },
  },
```

Add `jobsView: "Jobs"` under the existing English `taskPanel` messages.

Add `impact_suggestion: "Impact suggestion"` inside English `taskPanel.jobTypes`.

- [ ] **Step 3: Add CSS**

Append to `apps/web/app/globals.css`:

```css
.lineage-strip,
.impact-health {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-3);
  padding: var(--space-3);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-md);
  background: var(--bg-surface);
  font-size: 0.875rem;
}

.lineage-strip--warning,
.impact-health--warning {
  border-color: rgba(234, 179, 8, 0.32);
  background: var(--warning-bg);
}

.impact-health--ok {
  color: var(--text-secondary);
}

.lineage-strip__main,
.lineage-strip__meta {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  min-width: 0;
}

.lineage-strip__label {
  color: var(--text-tertiary);
  flex-shrink: 0;
}

.lineage-strip__sources {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.impact-list {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}

.impact-empty {
  color: var(--text-tertiary);
  font-size: 0.875rem;
  padding: var(--space-4);
  text-align: center;
}

.impact-row {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--space-3);
  padding: var(--space-3);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-md);
  background: var(--bg-surface);
}

.impact-row--active {
  border-color: var(--accent);
}

.impact-row__main {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-2);
  min-width: 0;
}

.impact-row__title {
  width: 100%;
}

.impact-row__summary {
  color: var(--text-secondary);
  font-size: 0.8125rem;
  line-height: 1.5;
}

.impact-row__actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: var(--space-2);
  flex-shrink: 0;
}

.impact-badge,
.impact-severity,
.vmp-impact-badge {
  display: inline-flex;
  align-items: center;
  min-height: 22px;
  padding: 0 var(--space-2);
  border-radius: var(--radius-sm);
  font-size: 0.75rem;
  font-weight: 600;
}

.impact-badge--open,
.vmp-impact-badge--warning {
  color: var(--warning-text);
  background: var(--warning-bg);
}

.impact-badge--suggested,
.vmp-impact-badge--info {
  color: var(--info-text);
  background: var(--info-bg);
}

.impact-badge--accepted,
.vmp-impact-badge--success {
  color: var(--success-text);
  background: var(--success-bg);
}

.impact-badge--ignored,
.impact-badge--resolved,
.vmp-impact-badge--neutral {
  color: var(--text-secondary);
  background: var(--bg-elevated);
}

.impact-severity--high {
  color: var(--danger-text);
  background: var(--danger-bg);
}

.impact-severity--medium {
  color: var(--warning-text);
  background: var(--warning-bg);
}

.impact-severity--low {
  color: var(--text-secondary);
  background: var(--bg-elevated);
}

.vmp-impact-panel {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  margin: var(--space-3) 0;
}
```

- [ ] **Step 4: Run full verification**

Run:

```powershell
npm run lint
npm run build
```

Expected: both commands exit `0`.

- [ ] **Step 5: Inspect git status**

Run:

```powershell
git status --short
```

Expected: only intended files are modified.

- [ ] **Step 6: Commit final UI polish**

```powershell
git add apps/web/lib/i18n/messages.ts apps/web/app/globals.css
git commit -m "feat(web): polish impact issue UI"
```

---

## Self-Review Checklist

- Spec coverage:
  - Dependency records: Tasks 1, 2, 4, 7.
  - Impact issues and targets: Tasks 1, 2, 3, 4, 5.
  - Recoverable status changes: Tasks 1, 3, 5, 8, 9.
  - Suggestion generation and candidate creation: Task 6.
  - Frontend version, generation, and task panel entry points: Tasks 8, 9, 10.
  - No automatic overwrite: Task 6 creates draft candidate versions only.
  - Safe recovery from accidental ignore/resolve/accept: Tasks 3 and 6 provide reopen and revert-acceptance paths with audit events.
  - User-owned business testing boundary: Task 10 verifies compile/build only.

- Type consistency:
  - `ImpactIssueStatus`, `DependencyType`, and API payload names match the shared contracts in Task 1.
  - `ImpactService` methods used from controllers and jobs are defined before use.
  - `impactSummary` is optional on version payloads, so older UI code can render during partial rollout.
  - Read and mutation controllers resolve project IDs first and check permissions before returning details or mutating records.

- Verification:
  - Shared checks: `npm --workspace @dramaflow/shared run test` and `npm --workspace @dramaflow/shared run lint`.
  - API checks: `npm --workspace @dramaflow/api run lint`.
  - Web checks: `npm --workspace @dramaflow/web run lint`.
  - Final full checks: `npm run lint` and `npm run build`.
