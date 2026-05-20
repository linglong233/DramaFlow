# Novel Import Wizard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a persistent three-step novel import wizard with refresh recovery, chunk-level retry, and user-confirmed draft writes.

**Architecture:** Add a dedicated `NovelImportSession` domain model stored in the development database, and use existing `JobRecord` worker polling to execute session actions. Keep the current SSE import endpoint compiling during rollout, but route the UI to the new session APIs.

**Tech Stack:** TypeScript, npm workspaces, NestJS 11, Next.js 15, React 19, React Query, DevDatabase JSON storage, existing worker polling through `internal/jobs`.

---

## File Structure

Create or modify these files:

- Modify `packages/shared/src/domain.ts`
  - Add `novel_import` to `JobType`.
  - Add novel import session, options, chunk, write result, and job action types.
- Modify `packages/shared/src/api-contracts.ts`
  - Add payload and response contracts for session APIs.
- Modify `apps/api/src/common/database.types.ts`
  - Add `novelImportSessions` to `DevDatabase` and `createEmptyDatabase`.
- Modify `apps/api/src/common/dev-database.service.ts`
  - Normalize older JSON files that do not contain `novelImportSessions`.
- Modify `apps/api/src/common/database.types.test.ts`
  - Assert the new database array exists.
- Modify `packages/shared/scripts/test.ts`
  - Add compile/runtime assertions for the new shared constants and sample session shape.
- Modify `apps/api/src/jobs/novel-import.service.ts`
  - Add session CRUD, chunking, generation orchestration, retry/rerun/cancel, preview building, and draft writing.
  - Keep the existing `streamNovelImport` method available until cleanup.
- Modify `apps/api/src/jobs/jobs.service.ts`
  - Add public helpers to enqueue novel import action jobs.
  - Dispatch `novel_import` jobs to `NovelImportService`.
- Modify `apps/api/src/jobs/jobs.controller.ts`
  - Add REST endpoints for create/latest/get/start/cancel/retry/rerun/write.
- Modify `apps/api/src/jobs/jobs.module.ts`
  - Keep provider registration valid after constructor changes.
- Modify `apps/api/scripts/test.ts`
  - Add HTTP and direct worker-flow tests for session creation, recovery, retry, rerun, and draft writing.
- Modify `apps/web/lib/query-keys.ts`
  - Add novel import query keys.
- Modify `apps/web/lib/i18n/messages.ts`
  - Add Chinese and English labels for the wizard.
- Replace most of `apps/web/components/project-workspace/generation/novel-import-generator.tsx`
  - Implement the three-step wizard and polling-based recovery.
- Modify `apps/web/app/globals.css`
  - Add styles for the wizard, preflight chunk list, progress list, stale warnings, and review actions.

Do not update README files in this implementation unless the user explicitly asks for user-facing documentation.

---

### Task 1: Shared Domain Contracts and Database Shape

**Files:**
- Modify: `packages/shared/src/domain.ts`
- Modify: `packages/shared/src/api-contracts.ts`
- Modify: `apps/api/src/common/database.types.ts`
- Modify: `apps/api/src/common/dev-database.service.ts`
- Modify: `apps/api/src/common/database.types.test.ts`
- Modify: `packages/shared/scripts/test.ts`

- [ ] **Step 1: Add failing database and shared assertions**

In `apps/api/src/common/database.types.test.ts`, add these assertions near the existing `createEmptyDatabase` checks:

```ts
assert.equal(Array.isArray(db.novelImportSessions), true);
assert.equal(db.novelImportSessions.length, 0);
```

In `packages/shared/scripts/test.ts`, add this import to the existing import block:

```ts
import type { NovelImportSession, NovelImportJobInput } from "../src";
```

Then add this block before `console.log("shared tests passed");`:

```ts
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
    },
  ],
  createdAt: "2026-05-20T00:00:00.000Z",
  updatedAt: "2026-05-20T00:00:00.000Z",
};
assert.equal(sampleNovelImportSession.chunks[0]?.status, "pending");
```

- [ ] **Step 2: Run tests and verify they fail**

Run:

```powershell
npm --workspace @dramaflow/shared test
npm --workspace @dramaflow/api test
```

Expected:

- Shared test fails because `NovelImportSession` and `NovelImportJobInput` are not exported.
- API test fails because `novelImportSessions` does not exist on `DevDatabase`.

- [ ] **Step 3: Add shared domain types**

In `packages/shared/src/domain.ts`, update `JobType`:

```ts
export type JobType =
  | "script_generation"
  | "synopsis_generation"
  | "storyboard_generation"
  | "image_generation"
  | "video_generation"
  | "rewrite_segment"
  | "tts_generation"
  | "export_video"
  | "shot_regenerate"
  | "novel_import";
```

Add these types near the current `NovelImportInput` interface:

```ts
/** 小说导入状态 */
export type NovelImportStatus =
  | "draft"
  | "queued"
  | "running"
  | "needs_review"
  | "failed"
  | "cancelled"
  | "written";

/** 小说导入阶段 */
export type NovelImportStage =
  | "setup"
  | "chunking"
  | "adaptationPlan"
  | "worldBible"
  | "synopsis"
  | "script"
  | "review"
  | "write";

/** 小说导入分块状态 */
export type NovelImportChunkStatus =
  | "pending"
  | "running"
  | "completed"
  | "failed"
  | "stale";

/** 小说导入参数 */
export interface NovelImportOptions {
  targetEpisodeCount: number;
  episodeDurationMinutes: number;
  genreStyle: string;
  adaptationFocus: string;
  llmConfigSource?: LlmConfigSource;
}

/** 小说导入分块记录 */
export interface NovelImportChunkRecord {
  index: number;
  title?: string;
  text: string;
  status: NovelImportChunkStatus;
  summary?: string;
  continuityNotes?: string;
  scenes: ScriptScene[];
  rawOutput?: string;
  error?: string;
  startedAt?: string;
  completedAt?: string;
}

/** 小说导入写入结果 */
export interface NovelImportWriteResult {
  worldBibleDocumentId: string;
  worldBibleVersionId: string;
  synopsisDocumentId: string;
  synopsisVersionId: string;
  scriptDocumentId: string;
  scriptVersionId: string;
  writtenAt: string;
}

/** 小说导入会话 */
export interface NovelImportSession {
  id: string;
  projectId: string;
  createdBy: string;
  status: NovelImportStatus;
  stage: NovelImportStage;
  progress: number;
  sourceText: string;
  options: NovelImportOptions;
  chunks: NovelImportChunkRecord[];
  adaptationPlan?: string;
  worldBible?: WorldBibleContent;
  synopsis?: string;
  scriptPreview?: ScriptContent;
  writeResult?: NovelImportWriteResult;
  lastJobId?: string;
  error?: string;
  createdAt: string;
  updatedAt: string;
}

/** 小说导入后台任务输入 */
export type NovelImportJobInput =
  | { action: "runSession"; sessionId: string }
  | { action: "retryChunk"; sessionId: string; chunkIndex: number }
  | { action: "rerunFromChunk"; sessionId: string; chunkIndex: number };
```

- [ ] **Step 4: Add shared API contracts**

In `packages/shared/src/api-contracts.ts`, import the new domain types if they are not already imported:

```ts
import type {
  LlmConfigSource,
  NovelImportSession,
  NovelImportWriteResult,
  JobRecord,
} from "./domain";
```

If the file already has a domain import block, add only the missing names to that block. Then add these contracts near the existing novel import contracts:

```ts
/** 创建小说导入会话请求体 */
export interface CreateNovelImportSessionPayload {
  text: string;
  targetEpisodeCount: number;
  episodeDurationMinutes: number;
  genreStyle: string;
  adaptationFocus: string;
  llmConfigSource?: LlmConfigSource;
}

/** 小说导入会话响应 */
export interface NovelImportSessionResponse {
  session: NovelImportSession;
}

/** 最近小说导入会话响应 */
export interface LatestNovelImportSessionResponse {
  session: NovelImportSession | null;
}

/** 小说导入任务响应 */
export interface NovelImportJobResponse {
  session: NovelImportSession;
  job: JobRecord;
}

/** 小说导入写入草稿响应 */
export interface NovelImportWriteDraftsResponse {
  session: NovelImportSession;
  writeResult: NovelImportWriteResult;
}
```

- [ ] **Step 5: Add database storage and normalization**

In `apps/api/src/common/database.types.ts`, add `NovelImportSession` to the shared import list:

```ts
NovelImportSession,
```

Add this field to `DevDatabase`:

```ts
novelImportSessions: NovelImportSession[];
```

Add this field to `createEmptyDatabase()`:

```ts
novelImportSessions: [],
```

In `apps/api/src/common/dev-database.service.ts`, add the field to `arrayFields`:

```ts
"novelImportSessions",
```

- [ ] **Step 6: Run tests and verify they pass**

Run:

```powershell
npm --workspace @dramaflow/shared test
npm --workspace @dramaflow/api test
npm run lint
```

Expected:

- Shared test prints `shared tests passed`.
- API test prints existing pass lines and includes no TypeScript errors.
- `npm run lint` exits 0.

- [ ] **Step 7: Commit**

```powershell
git add packages/shared/src/domain.ts packages/shared/src/api-contracts.ts packages/shared/scripts/test.ts apps/api/src/common/database.types.ts apps/api/src/common/dev-database.service.ts apps/api/src/common/database.types.test.ts
git commit -m "feat(shared): add novel import session contracts"
```

---

### Task 2: Session Creation, Chunking, and Restore APIs

**Files:**
- Modify: `apps/api/src/jobs/novel-import.service.ts`
- Modify: `apps/api/src/jobs/jobs.controller.ts`
- Modify: `apps/api/scripts/test.ts`

- [ ] **Step 1: Add failing API test for session creation and latest restore**

In `apps/api/scripts/test.ts`, add this test case before the final `console.log` in `main()`:

```ts
await runCase("novel import session creation chunks text and latest restores it", async () => {
  await withHttpApp(async (baseUrl) => {
    const user = await registerUser(baseUrl, {
      email: "novel-import@example.com",
      displayName: "Novel Importer",
    });

    const teams = await listTeams(baseUrl, user.accessToken);
    const projectResponse = await originalFetch(`${baseUrl}/projects`, {
      method: "POST",
      headers: authHeaders(user.accessToken, true),
      body: JSON.stringify({
        teamId: teams[0]?.id,
        name: "Novel Project",
        genre: "都市悬疑",
      }),
    });
    assert.equal(projectResponse.status, 201);
    const project = await projectResponse.json() as { id: string };

    const createResponse = await originalFetch(`${baseUrl}/projects/${project.id}/novel-import-sessions`, {
      method: "POST",
      headers: authHeaders(user.accessToken, true),
      body: JSON.stringify({
        text: "第一章 门后\n她推开门。\n\n第二章 来电\n电话响了。",
        targetEpisodeCount: 12,
        episodeDurationMinutes: 2,
        genreStyle: "都市悬疑",
        adaptationFocus: "强化反转",
        llmConfigSource: "team",
      }),
    });
    assert.equal(createResponse.status, 201);
    const created = await createResponse.json() as {
      session: {
        id: string;
        status: string;
        stage: string;
        sourceText: string;
        chunks: Array<{ index: number; title?: string; text: string; status: string }>;
      };
    };
    assert.equal(created.session.status, "draft");
    assert.equal(created.session.stage, "setup");
    assert.equal(created.session.sourceText.includes("第一章"), true);
    assert.equal(created.session.chunks.length, 2);
    assert.equal(created.session.chunks[0]?.title, "第一章 门后");
    assert.equal(created.session.chunks[1]?.status, "pending");

    const latestResponse = await originalFetch(`${baseUrl}/projects/${project.id}/novel-import-sessions/latest`, {
      headers: authHeaders(user.accessToken),
    });
    assert.equal(latestResponse.status, 200);
    const latest = await latestResponse.json() as { session: { id: string } | null };
    assert.equal(latest.session?.id, created.session.id);

    const getResponse = await originalFetch(`${baseUrl}/novel-import-sessions/${created.session.id}`, {
      headers: authHeaders(user.accessToken),
    });
    assert.equal(getResponse.status, 200);
  });
});
```

- [ ] **Step 2: Run test and verify it fails**

Run:

```powershell
npm --workspace @dramaflow/api test
```

Expected: FAIL with HTTP 404 for `/novel-import-sessions`.

- [ ] **Step 3: Add session creation service methods**

In `apps/api/src/jobs/novel-import.service.ts`, extend imports:

```ts
import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException } from "@nestjs/common";
import type {
  CreateNovelImportSessionPayload,
  NovelImportSession,
  NovelImportChunkRecord,
  NovelImportOptions,
  NovelImportJobInput,
  ProjectMemberRecord,
} from "@dramaflow/shared";
import { createId } from "../common/id";
import { DevDatabaseService } from "../common/dev-database.service";
```

Update the class constructor while keeping the logger:

```ts
const MAX_NOVEL_IMPORT_CHARS = 500_000;

@Injectable()
export class NovelImportService {
  private readonly logger = new Logger(NovelImportService.name);

  constructor(
    @Inject(DevDatabaseService) private readonly database: DevDatabaseService,
    @Inject(WorkspaceService) private readonly workspaceService: WorkspaceService,
  ) {}
```

Add these helper methods inside `NovelImportService`:

```ts
  async createSession(userId: string, projectId: string, payload: CreateNovelImportSessionPayload) {
    const text = payload.text.trim();
    if (!text) {
      throw new BadRequestException("Novel text cannot be empty");
    }
    if (text.length > MAX_NOVEL_IMPORT_CHARS) {
      throw new BadRequestException(`Novel text cannot exceed ${MAX_NOVEL_IMPORT_CHARS} characters`);
    }
    const targetEpisodeCount = Number(payload.targetEpisodeCount);
    const episodeDurationMinutes = Number(payload.episodeDurationMinutes);
    if (!Number.isInteger(targetEpisodeCount) || targetEpisodeCount < 1 || targetEpisodeCount > 100) {
      throw new BadRequestException("Target episode count must be between 1 and 100");
    }
    if (!Number.isFinite(episodeDurationMinutes) || episodeDurationMinutes <= 0 || episodeDurationMinutes > 60) {
      throw new BadRequestException("Episode duration must be between 1 and 60 minutes");
    }

    await this.assertProjectEditable(userId, projectId);
    const now = new Date().toISOString();
    const options: NovelImportOptions = {
      targetEpisodeCount,
      episodeDurationMinutes,
      genreStyle: payload.genreStyle.trim(),
      adaptationFocus: payload.adaptationFocus.trim(),
      llmConfigSource: payload.llmConfigSource,
    };
    const chunks = this.chunkSourceText(text);
    if (chunks.length === 0) {
      throw new BadRequestException("Novel text could not be split into chunks");
    }

    const session: NovelImportSession = {
      id: createId("novel_import"),
      projectId,
      createdBy: userId,
      status: "draft",
      stage: "setup",
      progress: 0,
      sourceText: text,
      options,
      chunks,
      createdAt: now,
      updatedAt: now,
    };

    return this.database.mutate((db) => {
      db.novelImportSessions.push(session);
      return session;
    });
  }

  async getLatestSession(userId: string, projectId: string) {
    await this.assertProjectReadable(userId, projectId);
    return this.database.query((db) => {
      const sessions = db.novelImportSessions
        .filter((session) => session.projectId === projectId && session.createdBy === userId && session.status !== "written")
        .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
      return sessions[0] ?? null;
    });
  }

  async getSession(userId: string, sessionId: string) {
    const session = await this.database.query((db) => db.novelImportSessions.find((item) => item.id === sessionId));
    if (!session) {
      throw new NotFoundException("Novel import session not found");
    }
    await this.assertProjectReadable(userId, session.projectId);
    return session;
  }

  chunkSourceText(text: string): NovelImportChunkRecord[] {
    const normalized = text.replace(/\r\n/g, "\n").trim();
    const chapterPattern = /^(第[零一二三四五六七八九十百千万\d]+[章回节][^\n]*|Chapter\s+\d+[^\n]*|CHAPTER\s+\d+[^\n]*)/gim;
    const matches = [...normalized.matchAll(chapterPattern)];
    if (matches.length >= 2) {
      return matches.map((match, index) => {
        const start = match.index ?? 0;
        const end = index + 1 < matches.length ? matches[index + 1]!.index! : normalized.length;
        const chunkText = normalized.slice(start, end).trim();
        return {
          index,
          title: match[1]?.trim(),
          text: chunkText,
          status: "pending",
          scenes: [],
        };
      }).filter((chunk) => chunk.text);
    }

    const targetSize = 3000;
    const chunks: NovelImportChunkRecord[] = [];
    let pos = 0;
    while (pos < normalized.length) {
      let end = Math.min(pos + targetSize, normalized.length);
      if (end < normalized.length) {
        const nextBreak = normalized.indexOf("\n\n", end);
        if (nextBreak !== -1 && nextBreak < end + 600) {
          end = nextBreak + 2;
        }
      }
      const chunkText = normalized.slice(pos, end).trim();
      if (chunkText) {
        chunks.push({
          index: chunks.length,
          text: chunkText,
          status: "pending",
          scenes: [],
        });
      }
      pos = end;
    }
    return chunks;
  }
```

Add `assertProjectReadable` and `assertProjectEditable` using the existing project member model:

```ts
  private async assertProjectReadable(userId: string, projectId: string) {
    const allowed = await this.database.query((db) => {
      const project = db.projects.find((item) => item.id === projectId);
      if (!project) return false;
      return db.projectMembers.some((member) => member.projectId === projectId && member.userId === userId);
    });
    if (!allowed) {
      throw new ForbiddenException("You do not have permission to access this project");
    }
  }

  private async assertProjectEditable(userId: string, projectId: string) {
    const allowed = await this.database.query((db) => {
      const project = db.projects.find((item) => item.id === projectId);
      if (!project) return false;
      const member = db.projectMembers.find((item) => item.projectId === projectId && item.userId === userId);
      return Boolean(member && member.role !== "viewer");
    });
    if (!allowed) {
      throw new ForbiddenException("You do not have permission to edit this project");
    }
  }
```

- [ ] **Step 4: Add controller endpoints**

In `apps/api/src/jobs/jobs.controller.ts`, add the missing import types:

```ts
CreateNovelImportSessionPayload,
```

Add these methods near the existing novel import SSE endpoint:

```ts
  @Post("projects/:id/novel-import-sessions")
  async createNovelImportSession(
    @CurrentUser() user: { id: string },
    @Param("id") projectId: string,
    @Body() body: CreateNovelImportSessionPayload,
  ) {
    const session = await this.novelImportService.createSession(user.id, projectId, body);
    return { session };
  }

  @Get("projects/:id/novel-import-sessions/latest")
  async getLatestNovelImportSession(
    @CurrentUser() user: { id: string },
    @Param("id") projectId: string,
  ) {
    const session = await this.novelImportService.getLatestSession(user.id, projectId);
    return { session };
  }

  @Get("novel-import-sessions/:id")
  async getNovelImportSession(
    @CurrentUser() user: { id: string },
    @Param("id") sessionId: string,
  ) {
    const session = await this.novelImportService.getSession(user.id, sessionId);
    return { session };
  }
```

- [ ] **Step 5: Run test and lint**

Run:

```powershell
npm --workspace @dramaflow/api test
npm run lint
```

Expected: API tests pass, lint passes.

- [ ] **Step 6: Commit**

```powershell
git add apps/api/src/jobs/novel-import.service.ts apps/api/src/jobs/jobs.controller.ts apps/api/scripts/test.ts
git commit -m "feat(api): add novel import session creation"
```

---

### Task 3: Job Queue Integration and Session Actions

**Files:**
- Modify: `apps/api/src/jobs/jobs.service.ts`
- Modify: `apps/api/src/jobs/novel-import.service.ts`
- Modify: `apps/api/src/jobs/jobs.controller.ts`
- Modify: `apps/api/scripts/test.ts`

- [ ] **Step 1: Add failing test for start job and cancel**

In `apps/api/scripts/test.ts`, add this test after the session creation test:

```ts
await runCase("novel import session start queues a worker job and cancel marks session", async () => {
  await withHttpApp(async (baseUrl) => {
    const user = await registerUser(baseUrl, {
      email: "novel-start@example.com",
      displayName: "Novel Starter",
    });
    const teams = await listTeams(baseUrl, user.accessToken);
    const projectResponse = await originalFetch(`${baseUrl}/projects`, {
      method: "POST",
      headers: authHeaders(user.accessToken, true),
      body: JSON.stringify({ teamId: teams[0]?.id, name: "Queued Novel" }),
    });
    assert.equal(projectResponse.status, 201);
    const project = await projectResponse.json() as { id: string };

    const sessionResponse = await originalFetch(`${baseUrl}/projects/${project.id}/novel-import-sessions`, {
      method: "POST",
      headers: authHeaders(user.accessToken, true),
      body: JSON.stringify({
        text: "第一章\n她推开门。\n\n第二章\n电话响了。",
        targetEpisodeCount: 8,
        episodeDurationMinutes: 2,
        genreStyle: "悬疑",
        adaptationFocus: "保留核心反转",
      }),
    });
    assert.equal(sessionResponse.status, 201);
    const created = await sessionResponse.json() as { session: { id: string } };

    const startResponse = await originalFetch(`${baseUrl}/novel-import-sessions/${created.session.id}/start`, {
      method: "POST",
      headers: authHeaders(user.accessToken, true),
    });
    assert.equal(startResponse.status, 201);
    const started = await startResponse.json() as {
      session: { status: string; lastJobId?: string };
      job: { id: string; type: string; status: string; input: { action: string; sessionId: string } };
    };
    assert.equal(started.session.status, "queued");
    assert.equal(started.job.type, "novel_import");
    assert.equal(started.job.input.action, "runSession");
    assert.equal(started.job.input.sessionId, created.session.id);
    assert.equal(started.session.lastJobId, started.job.id);

    const cancelResponse = await originalFetch(`${baseUrl}/novel-import-sessions/${created.session.id}/cancel`, {
      method: "POST",
      headers: authHeaders(user.accessToken, true),
    });
    assert.equal(cancelResponse.status, 201);
    const cancelled = await cancelResponse.json() as { session: { status: string; stage: string } };
    assert.equal(cancelled.session.status, "cancelled");
  });
});
```

- [ ] **Step 2: Run test and verify it fails**

Run:

```powershell
npm --workspace @dramaflow/api test
```

Expected: FAIL with HTTP 404 for `/start`.

- [ ] **Step 3: Add queue helpers to JobsService**

In `apps/api/src/jobs/jobs.service.ts`, add `NovelImportService` import:

```ts
import { NovelImportService } from "./novel-import.service";
```

Add `NovelImportJobInput` to the shared import list.

Add constructor injection after `ExportService`:

```ts
    @Inject(NovelImportService) private readonly novelImportService: NovelImportService,
```

Add this public method near the other `create*Job` methods:

```ts
  async createNovelImportJob(
    userId: string,
    projectId: string,
    input: NovelImportJobInput,
  ) {
    await this.assertProjectReadable(userId, projectId);
    return this.enqueueJob(userId, {
      type: "novel_import",
      projectId,
      input,
    });
  }
```

In `processJob`, add this switch case:

```ts
        case "novel_import":
          return await this.processNovelImportJob(job as unknown as JobRecord<NovelImportJobInput>);
```

Add this method near other private processors:

```ts
  private async processNovelImportJob(job: JobRecord<NovelImportJobInput>) {
    const result = await this.novelImportService.processJob(
      job,
      (uid, pid, source) => this.resolveTextLlmConfig(uid, pid, source).then((config) => {
        if (!config) {
          throw new Error("LLM config is not available");
        }
        return config;
      }),
      (system, messages, config) => this.textProvider.streamChat(system, messages, config),
    );

    return this.completeJob(job.id, result);
  }
```

- [ ] **Step 4: Add service methods for queued state and cancel**

In `apps/api/src/jobs/novel-import.service.ts`, add:

```ts
  async attachJob(userId: string, sessionId: string, jobId: string) {
    const session = await this.getSession(userId, sessionId);
    return this.database.mutate((db) => {
      const live = this.mustFindSession(db, session.id);
      live.status = "queued";
      live.lastJobId = jobId;
      live.error = undefined;
      live.updatedAt = new Date().toISOString();
      return live;
    });
  }

  async cancelSession(userId: string, sessionId: string) {
    const session = await this.getSession(userId, sessionId);
    if (session.status === "written") {
      throw new BadRequestException("Written sessions cannot be cancelled");
    }
    return this.database.mutate((db) => {
      const live = this.mustFindSession(db, session.id);
      live.status = "cancelled";
      live.error = undefined;
      live.updatedAt = new Date().toISOString();
      return live;
    });
  }

  private mustFindSession(db: { novelImportSessions: NovelImportSession[] }, sessionId: string) {
    const session = db.novelImportSessions.find((item) => item.id === sessionId);
    if (!session) {
      throw new NotFoundException("Novel import session not found");
    }
    return session;
  }
```

Add a temporary `processJob` skeleton that makes Task 3 compile; Task 4 replaces the body:

```ts
  async processJob(
    job: JobRecord<NovelImportJobInput>,
    _resolveLlmConfig: (userId: string, projectId: string, source?: LlmConfigSource) => Promise<LlmProviderConfig>,
    _streamLlm: (systemPrompt: string, messages: Array<{ role: string; content: string }>, config?: LlmProviderConfig) => AsyncGenerator<StreamChunk>,
  ): Promise<Record<string, unknown>> {
    const session = await this.database.mutate((db) => {
      const live = this.mustFindSession(db, job.input.sessionId);
      if (live.status === "cancelled") {
        throw new Error("Novel import session was cancelled");
      }
      live.status = "running";
      live.updatedAt = new Date().toISOString();
      return live;
    });
    return { sessionId: session.id, action: job.input.action };
  }
```

- [ ] **Step 5: Add controller endpoints for start and cancel**

In `apps/api/src/jobs/jobs.controller.ts`, add:

```ts
  @Post("novel-import-sessions/:id/start")
  async startNovelImportSession(
    @CurrentUser() user: { id: string },
    @Param("id") sessionId: string,
  ) {
    const session = await this.novelImportService.getSession(user.id, sessionId);
    const job = await this.jobsService.createNovelImportJob(user.id, session.projectId, {
      action: "runSession",
      sessionId,
    });
    const updated = await this.novelImportService.attachJob(user.id, sessionId, job.id);
    return { session: updated, job };
  }

  @Post("novel-import-sessions/:id/cancel")
  async cancelNovelImportSession(
    @CurrentUser() user: { id: string },
    @Param("id") sessionId: string,
  ) {
    const session = await this.novelImportService.cancelSession(user.id, sessionId);
    return { session };
  }
```

- [ ] **Step 6: Run tests and lint**

Run:

```powershell
npm --workspace @dramaflow/api test
npm run lint
```

Expected: API tests pass, lint passes.

- [ ] **Step 7: Commit**

```powershell
git add apps/api/src/jobs/jobs.service.ts apps/api/src/jobs/novel-import.service.ts apps/api/src/jobs/jobs.controller.ts apps/api/scripts/test.ts
git commit -m "feat(api): queue novel import session jobs"
```

---

### Task 4: Generation Pipeline, Strict Parsing, and Preview Building

**Files:**
- Modify: `apps/api/src/jobs/novel-import.service.ts`
- Modify: `apps/api/scripts/test.ts`

- [ ] **Step 1: Add failing worker-flow test**

In `apps/api/scripts/test.ts`, add this test after the start/cancel test:

```ts
await runCase("novel import worker generates preview without writing drafts", async () => {
  process.env.OPENAI_COMPAT_API_KEY = "test-key";
  process.env.OPENAI_COMPAT_BASE_URL = "https://example.test/v1";
  process.env.OPENAI_TEXT_MODEL = "gpt-test";

  const replies = [
    "主要人物：林夏。核心冲突：她发现门后秘密。目标集数：8。",
    JSON.stringify({
      characters: [{ id: "char-1", name: "林夏", appearance: "短发，黑色风衣", personality: "冷静", tags: ["主角"], referenceImages: [], sortOrder: 0 }],
      locations: [{ id: "loc-1", name: "旧公寓", description: "昏暗狭窄", referenceImages: [], sortOrder: 0 }],
      styleGuide: { visualStyle: "冷峻都市悬疑" },
    }),
    "## 故事概览\n林夏在旧公寓发现秘密。\n\n## 分集大纲\n1. 门后秘密。",
    JSON.stringify({
      scenes: [{
        id: "scene-1",
        heading: "INT. 旧公寓 - 夜",
        synopsis: "林夏推开门。",
        characters: ["林夏"],
        dialogue: [{ speaker: "林夏", line: "谁在那里？" }],
        directorNote: "低光推进。",
      }],
      summary: "林夏进入旧公寓。",
      continuityNotes: "她还不知道来电者身份。",
    }),
    JSON.stringify({
      scenes: [{
        id: "scene-2",
        heading: "INT. 旧公寓 - 夜",
        synopsis: "电话响起。",
        characters: ["林夏"],
        dialogue: [{ speaker: "来电者", line: "别回头。" }],
        directorNote: "电话铃声压迫。",
      }],
      summary: "神秘来电警告林夏。",
      continuityNotes: "下一段揭示来电者。",
    }),
  ];

  globalThis.fetch = (async () => {
    const content = replies.shift() ?? "{}";
    const sseBody = [
      `data: ${JSON.stringify({ choices: [{ delta: { content } }] })}`,
      "data: [DONE]",
    ].join("\n\n");
    return new Response(sseBody, {
      status: 200,
      headers: { "content-type": "text/event-stream" },
    });
  }) as typeof fetch;

  await withHttpApp(async (baseUrl) => {
    const user = await registerUser(baseUrl, {
      email: "novel-worker@example.com",
      displayName: "Novel Worker",
    });
    const teams = await listTeams(baseUrl, user.accessToken);
    const projectResponse = await originalFetch(`${baseUrl}/projects`, {
      method: "POST",
      headers: authHeaders(user.accessToken, true),
      body: JSON.stringify({ teamId: teams[0]?.id, name: "Worker Novel" }),
    });
    assert.equal(projectResponse.status, 201);
    const project = await projectResponse.json() as { id: string };

    const sessionResponse = await originalFetch(`${baseUrl}/projects/${project.id}/novel-import-sessions`, {
      method: "POST",
      headers: authHeaders(user.accessToken, true),
      body: JSON.stringify({
        text: "第一章\n她推开门。\n\n第二章\n电话响了。",
        targetEpisodeCount: 8,
        episodeDurationMinutes: 2,
        genreStyle: "都市悬疑",
        adaptationFocus: "强化悬念",
        llmConfigSource: "personal",
      }),
    });
    const { session } = await sessionResponse.json() as { session: { id: string } };

    const startResponse = await originalFetch(`${baseUrl}/novel-import-sessions/${session.id}/start`, {
      method: "POST",
      headers: authHeaders(user.accessToken, true),
    });
    const { job } = await startResponse.json() as { job: { id: string } };

    const processResponse = await originalFetch(`${baseUrl}/internal/jobs/${job.id}/process`, {
      method: "POST",
      headers: { "x-internal-key": process.env.INTERNAL_API_KEY ?? "dramaflow-internal-key" },
    });
    assert.equal(processResponse.status, 201);

    const getResponse = await originalFetch(`${baseUrl}/novel-import-sessions/${session.id}`, {
      headers: authHeaders(user.accessToken),
    });
    const loaded = await getResponse.json() as {
      session: {
        status: string;
        stage: string;
        adaptationPlan?: string;
        worldBible?: { characters: Array<{ name: string }> };
        synopsis?: string;
        scriptPreview?: { scenes: Array<{ id: string }> };
        writeResult?: unknown;
      };
    };
    assert.equal(loaded.session.status, "needs_review");
    assert.equal(loaded.session.stage, "review");
    assert.equal(loaded.session.adaptationPlan?.includes("林夏"), true);
    assert.equal(loaded.session.worldBible?.characters[0]?.name, "林夏");
    assert.equal(loaded.session.synopsis?.includes("故事概览"), true);
    assert.equal(loaded.session.scriptPreview?.scenes.length, 2);
    assert.equal(loaded.session.writeResult, undefined);
  });
});
```

- [ ] **Step 2: Run test and verify it fails**

Run:

```powershell
npm --workspace @dramaflow/api test
```

Expected: FAIL because worker processing currently only marks the session running.

- [ ] **Step 3: Replace processJob skeleton with full orchestration**

In `apps/api/src/jobs/novel-import.service.ts`, replace the temporary `processJob` with:

```ts
  async processJob(
    job: JobRecord<NovelImportJobInput>,
    resolveLlmConfig: (userId: string, projectId: string, source?: LlmConfigSource) => Promise<LlmProviderConfig>,
    streamLlm: (systemPrompt: string, messages: Array<{ role: string; content: string }>, config?: LlmProviderConfig) => AsyncGenerator<StreamChunk>,
  ): Promise<Record<string, unknown>> {
    if (job.input.action === "runSession") {
      const session = await this.runSession(job.createdBy, job.input.sessionId, resolveLlmConfig, streamLlm);
      return { sessionId: session.id, status: session.status, stage: session.stage };
    }
    if (job.input.action === "retryChunk") {
      const session = await this.retryChunk(job.createdBy, job.input.sessionId, job.input.chunkIndex, resolveLlmConfig, streamLlm);
      return { sessionId: session.id, status: session.status, chunkIndex: job.input.chunkIndex };
    }
    const session = await this.rerunFromChunk(job.createdBy, job.input.sessionId, job.input.chunkIndex, resolveLlmConfig, streamLlm);
    return { sessionId: session.id, status: session.status, chunkIndex: job.input.chunkIndex };
  }
```

Add `runSession`:

```ts
  private async runSession(
    userId: string,
    sessionId: string,
    resolveLlmConfig: (userId: string, projectId: string, source?: LlmConfigSource) => Promise<LlmProviderConfig>,
    streamLlm: (systemPrompt: string, messages: Array<{ role: string; content: string }>, config?: LlmProviderConfig) => AsyncGenerator<StreamChunk>,
  ) {
    let session = await this.markSessionRunning(userId, sessionId, "adaptationPlan", 5);
    const config = await resolveLlmConfig(userId, session.projectId, session.options.llmConfigSource);

    if (!session.adaptationPlan) {
      const adaptationPlan = await this.generateAdaptationPlan(session, config, streamLlm);
      session = await this.updateSession(session.id, (live) => {
        live.adaptationPlan = adaptationPlan;
        live.stage = "worldBible";
        live.progress = 20;
      });
    }

    if (!session.worldBible) {
      const worldBible = await this.generateWorldBible(session, config, streamLlm);
      session = await this.updateSession(session.id, (live) => {
        live.worldBible = worldBible;
        live.stage = "synopsis";
        live.progress = 35;
      });
    }

    if (!session.synopsis) {
      const synopsis = await this.generateSynopsisForSession(session, config, streamLlm);
      session = await this.updateSession(session.id, (live) => {
        live.synopsis = synopsis;
        live.stage = "script";
        live.progress = 45;
      });
    }

    const startIndex = session.chunks.find((chunk) => chunk.status !== "completed" && chunk.status !== "stale")?.index ?? 0;
    session = await this.generateChunksFrom(session.id, startIndex, config, streamLlm, false);
    return this.updateSession(session.id, (live) => {
      live.status = "needs_review";
      live.stage = "review";
      live.progress = 100;
      live.scriptPreview = this.buildPreview(live);
      live.error = undefined;
    });
  }
```

- [ ] **Step 4: Add session update and cancellation helpers**

Add:

```ts
  private async markSessionRunning(userId: string, sessionId: string, stage: NovelImportStage, progress: number) {
    const session = await this.getSession(userId, sessionId);
    if (session.status === "written") {
      throw new BadRequestException("Written sessions cannot be regenerated");
    }
    return this.updateSession(session.id, (live) => {
      if (live.status === "cancelled") {
        throw new Error("Novel import session was cancelled");
      }
      live.status = "running";
      live.stage = stage;
      live.progress = progress;
      live.error = undefined;
    });
  }

  private async updateSession(sessionId: string, mutate: (session: NovelImportSession) => void) {
    return this.database.mutate((db) => {
      const live = this.mustFindSession(db, sessionId);
      mutate(live);
      live.updatedAt = new Date().toISOString();
      return live;
    });
  }

  private async assertNotCancelled(sessionId: string) {
    const status = await this.database.query((db) => this.mustFindSession(db, sessionId).status);
    if (status === "cancelled") {
      throw new Error("Novel import session was cancelled");
    }
  }
```

- [ ] **Step 5: Add LLM prompt helpers and JSON parsing**

Add:

```ts
  private async collectText(
    system: string,
    user: string,
    config: LlmProviderConfig,
    streamLlm: (systemPrompt: string, messages: Array<{ role: string; content: string }>, config?: LlmProviderConfig) => AsyncGenerator<StreamChunk>,
  ) {
    let full = "";
    for await (const chunk of streamLlm(system, [{ role: "user", content: user }], config)) {
      if (chunk.type === "error") {
        throw new Error(chunk.error ?? "LLM request failed");
      }
      if (chunk.type === "chunk" && chunk.content) {
        full += chunk.content;
      }
      if (chunk.type === "done" && typeof chunk.result === "string" && !full) {
        full = chunk.result;
      }
    }
    return full.trim();
  }

  private parseStrictJson<T>(raw: string): T {
    const cleaned = raw.trim().replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/```\s*$/i, "").trim();
    return JSON.parse(cleaned) as T;
  }

  private async generateAdaptationPlan(
    session: NovelImportSession,
    config: LlmProviderConfig,
    streamLlm: (systemPrompt: string, messages: Array<{ role: string; content: string }>, config?: LlmProviderConfig) => AsyncGenerator<StreamChunk>,
  ) {
    return this.collectText(
      "You are a short drama adaptation planner. Write concise Chinese planning notes.",
      [
        "请为小说改编短剧制定轻量改编计划。",
        `目标集数：${session.options.targetEpisodeCount}`,
        `单集时长：${session.options.episodeDurationMinutes} 分钟`,
        `剧种/风格：${session.options.genreStyle}`,
        `改编侧重点：${session.options.adaptationFocus}`,
        "必须包含：主要人物、核心冲突、目标集数结构、类型基调、全书剧情弧线。",
        `\n小说片段：\n${session.sourceText.slice(0, 12000)}`,
      ].join("\n"),
      config,
      streamLlm,
    );
  }
```

Add world bible, synopsis, and chunk generation:

```ts
  private async generateWorldBible(
    session: NovelImportSession,
    config: LlmProviderConfig,
    streamLlm: (systemPrompt: string, messages: Array<{ role: string; content: string }>, config?: LlmProviderConfig) => AsyncGenerator<StreamChunk>,
  ) {
    const raw = await this.collectText(
      "You are a story analyst. Always return strict JSON.",
      [
        "从小说和改编计划中提取世界观。",
        'Return JSON with shape: { "characters": [{ "id": "char-N", "name": "...", "appearance": "...", "personality": "...", "tags": [], "referenceImages": [], "sortOrder": N }], "locations": [{ "id": "loc-N", "name": "...", "description": "...", "referenceImages": [], "sortOrder": N }], "styleGuide": { "visualStyle": "..." } }',
        `\n改编计划：\n${session.adaptationPlan ?? ""}`,
        `\n小说片段：\n${session.sourceText.slice(0, 16000)}`,
      ].join("\n"),
      config,
      streamLlm,
    );
    try {
      return normalizeWorldBibleContent(this.parseStrictJson(raw));
    } catch (error) {
      await this.updateSession(session.id, (live) => {
        live.status = "failed";
        live.stage = "worldBible";
        live.error = `World bible JSON parse failed: ${error instanceof Error ? error.message : "Unknown error"}`;
      });
      throw error;
    }
  }

  private async generateSynopsisForSession(
    session: NovelImportSession,
    config: LlmProviderConfig,
    streamLlm: (systemPrompt: string, messages: Array<{ role: string; content: string }>, config?: LlmProviderConfig) => AsyncGenerator<StreamChunk>,
  ) {
    return this.collectText(
      "You are a screenplay development assistant. Write Chinese markdown.",
      [
        "基于小说、改编计划和世界观，生成结构化短剧大纲。",
        "必须包含：故事概览、人物介绍、分集/节拍大纲。",
        `\n改编计划：\n${session.adaptationPlan ?? ""}`,
        `\n世界观：\n${JSON.stringify(session.worldBible ?? {}, null, 2)}`,
        `\n小说片段：\n${session.sourceText.slice(0, 16000)}`,
      ].join("\n"),
      config,
      streamLlm,
    );
  }
```

For chunks:

```ts
  private async generateChunkScenes(
    session: NovelImportSession,
    chunkIndex: number,
    previousSummary: string,
    config: LlmProviderConfig,
    streamLlm: (systemPrompt: string, messages: Array<{ role: string; content: string }>, config?: LlmProviderConfig) => AsyncGenerator<StreamChunk>,
  ): Promise<{ scenes: ScriptScene[]; summary: string; continuityNotes: string; rawOutput: string }> {
    const chunk = session.chunks[chunkIndex];
    if (!chunk) {
      throw new BadRequestException(`Chunk ${chunkIndex} does not exist`);
    }
    const futureHints = session.chunks
      .slice(chunkIndex + 1, chunkIndex + 3)
      .map((item) => item.summary ? `后续块 ${item.index + 1}: ${item.summary}` : "")
      .filter(Boolean)
      .join("\n");
    const raw = await this.collectText(
      "You are a screenplay development assistant. Always return strict JSON.",
      [
        "把当前小说分块改编成短剧剧本场景。",
        'Return JSON: { "scenes": [{ "id": "scene-N", "heading": "...", "synopsis": "...", "characters": ["name"], "dialogue": [{ "speaker": "...", "line": "..." }], "directorNote": "..." }], "summary": "2-3 sentence summary", "continuityNotes": "notes for following chunks" }',
        `\n改编计划：\n${session.adaptationPlan ?? ""}`,
        `\n世界观：\n${this.formatWorldBibleContext(session.worldBible)}`,
        previousSummary ? `\n上一块摘要：\n${previousSummary}` : "",
        futureHints ? `\n后续参考：\n${futureHints}` : "",
        `\n当前分块：\n${chunk.text}`,
      ].filter(Boolean).join("\n"),
      config,
      streamLlm,
    );
    const parsed = this.parseStrictJson<{ scenes?: unknown[]; summary?: unknown; continuityNotes?: unknown }>(raw);
    return {
      scenes: (parsed.scenes ?? []).map((scene, index) => normalizeScriptScene(scene, index + chunkIndex * 100)),
      summary: typeof parsed.summary === "string" ? parsed.summary : "",
      continuityNotes: typeof parsed.continuityNotes === "string" ? parsed.continuityNotes : "",
      rawOutput: raw,
    };
  }

  private formatWorldBibleContext(worldBible?: WorldBibleContent) {
    if (!worldBible) return "";
    const characters = worldBible.characters.map((item) => `${item.name}: ${item.appearance}`).join("；");
    const locations = worldBible.locations.map((item) => `${item.name}: ${item.description}`).join("；");
    return [`角色：${characters}`, `场景：${locations}`, worldBible.styleGuide?.visualStyle ? `风格：${worldBible.styleGuide.visualStyle}` : ""]
      .filter(Boolean)
      .join("\n");
  }
```

- [ ] **Step 6: Add chunk generation and preview merge**

Add:

```ts
  private async generateChunksFrom(
    sessionId: string,
    startIndex: number,
    config: LlmProviderConfig,
    streamLlm: (systemPrompt: string, messages: Array<{ role: string; content: string }>, config?: LlmProviderConfig) => AsyncGenerator<StreamChunk>,
    includeFollowing: boolean,
  ) {
    let session = await this.database.query((db) => this.mustFindSession(db, sessionId));
    let previousSummary = startIndex > 0 ? session.chunks[startIndex - 1]?.summary ?? "" : "";
    const endExclusive = includeFollowing ? session.chunks.length : Math.min(startIndex + 1, session.chunks.length);

    for (let index = startIndex; index < endExclusive; index++) {
      await this.assertNotCancelled(sessionId);
      session = await this.updateSession(sessionId, (live) => {
        live.status = "running";
        live.stage = "script";
        live.progress = Math.min(95, 45 + Math.round((index / Math.max(1, live.chunks.length)) * 50));
        const chunk = live.chunks[index];
        if (chunk) {
          chunk.status = "running";
          chunk.error = undefined;
          chunk.startedAt = new Date().toISOString();
        }
      });

      try {
        const result = await this.generateChunkScenes(session, index, previousSummary, config, streamLlm);
        previousSummary = result.summary;
        session = await this.updateSession(sessionId, (live) => {
          const chunk = live.chunks[index]!;
          chunk.status = "completed";
          chunk.scenes = result.scenes;
          chunk.summary = result.summary;
          chunk.continuityNotes = result.continuityNotes;
          chunk.rawOutput = result.rawOutput;
          chunk.error = undefined;
          chunk.completedAt = new Date().toISOString();
          live.scriptPreview = this.buildPreview(live);
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unknown error";
        await this.updateSession(sessionId, (live) => {
          const chunk = live.chunks[index];
          if (chunk) {
            chunk.status = "failed";
            chunk.error = message;
            chunk.completedAt = new Date().toISOString();
          }
          live.status = "failed";
          live.error = message;
        });
        throw error;
      }
    }

    return this.database.query((db) => this.mustFindSession(db, sessionId));
  }

  private buildPreview(session: NovelImportSession): ScriptContent {
    const characters = (session.worldBible?.characters ?? []).map((character) => ({
      name: character.name,
      profile: character.summary || character.appearance || character.personality || "",
      worldBibleCharId: character.id,
    }));
    return normalizeScriptContent({
      logline: session.synopsis?.split(/\r?\n/).find((line) => line.trim()) ?? "",
      premise: session.adaptationPlan ?? "",
      characters,
      scenes: session.chunks.flatMap((chunk) => chunk.scenes),
    });
  }
```

Ensure the file imports:

```ts
normalizeScriptContent,
normalizeScriptScene,
normalizeWorldBibleContent,
```

- [ ] **Step 7: Run tests and lint**

Run:

```powershell
npm --workspace @dramaflow/api test
npm run lint
```

Expected: API tests pass, lint passes.

- [ ] **Step 8: Commit**

```powershell
git add apps/api/src/jobs/novel-import.service.ts apps/api/scripts/test.ts
git commit -m "feat(api): generate novel import session previews"
```

---

### Task 5: Chunk Retry, Rerun Following, and Draft Writes

**Files:**
- Modify: `apps/api/src/jobs/novel-import.service.ts`
- Modify: `apps/api/src/jobs/jobs.controller.ts`
- Modify: `apps/api/scripts/test.ts`

- [ ] **Step 1: Add failing test for retry, rerun, and idempotent draft write**

In `apps/api/scripts/test.ts`, add this test after the worker preview test:

```ts
await runCase("novel import retry rerun and write drafts are recoverable", async () => {
  process.env.OPENAI_COMPAT_API_KEY = "test-key";
  process.env.OPENAI_COMPAT_BASE_URL = "https://example.test/v1";
  process.env.OPENAI_TEXT_MODEL = "gpt-test";

  const replies = [
    "主要人物：林夏。核心冲突：她发现门后秘密。目标集数：8。",
    JSON.stringify({
      characters: [{ id: "char-1", name: "林夏", appearance: "短发，黑色风衣", personality: "冷静", tags: ["主角"], referenceImages: [], sortOrder: 0 }],
      locations: [{ id: "loc-1", name: "旧公寓", description: "昏暗狭窄", referenceImages: [], sortOrder: 0 }],
      styleGuide: { visualStyle: "冷峻都市悬疑" },
    }),
    "## 故事概览\n林夏发现门后秘密。",
    JSON.stringify({
      scenes: [{ id: "scene-1", heading: "INT. 旧公寓 - 夜", synopsis: "林夏进门。", characters: ["林夏"], dialogue: [], directorNote: "压低环境声。" }],
      summary: "第一块初稿。",
      continuityNotes: "电话即将响起。",
    }),
    JSON.stringify({
      scenes: [{ id: "scene-2", heading: "INT. 旧公寓 - 夜", synopsis: "电话响起。", characters: ["林夏"], dialogue: [], directorNote: "电话铃声突出。" }],
      summary: "第二块初稿。",
      continuityNotes: "秘密升级。",
    }),
    JSON.stringify({
      scenes: [{ id: "scene-1r", heading: "INT. 旧公寓 - 夜", synopsis: "林夏发现门缝血迹。", characters: ["林夏"], dialogue: [], directorNote: "特写门缝。" }],
      summary: "重试后的第一块。",
      continuityNotes: "后续必须接血迹线索。",
    }),
    JSON.stringify({
      scenes: [{ id: "scene-1rr", heading: "INT. 旧公寓 - 夜", synopsis: "林夏确认血迹。", characters: ["林夏"], dialogue: [], directorNote: "手持镜头。" }],
      summary: "重跑后的第一块。",
      continuityNotes: "电话接血迹线索。",
    }),
    JSON.stringify({
      scenes: [{ id: "scene-2rr", heading: "INT. 旧公寓 - 夜", synopsis: "来电者提到血迹。", characters: ["林夏"], dialogue: [{ speaker: "来电者", line: "你已经看见了。" }], directorNote: "铃声戛然而止。" }],
      summary: "重跑后的第二块。",
      continuityNotes: "进入下一幕追查。",
    }),
  ];

  globalThis.fetch = (async () => {
    const content = replies.shift() ?? "{}";
    const sseBody = [
      `data: ${JSON.stringify({ choices: [{ delta: { content } }] })}`,
      "data: [DONE]",
    ].join("\n\n");
    return new Response(sseBody, {
      status: 200,
      headers: { "content-type": "text/event-stream" },
    });
  }) as typeof fetch;

  await withHttpApp(async (baseUrl) => {
    const processInternalJob = async (jobId: string) => {
      const response = await originalFetch(`${baseUrl}/internal/jobs/${jobId}/process`, {
        method: "POST",
        headers: { "x-internal-key": process.env.INTERNAL_API_KEY ?? "dramaflow-internal-key" },
      });
      assert.equal(response.status, 201);
      return response.json() as Promise<{ id: string; status: string }>;
    };

    const loadSession = async (accessToken: string, sessionId: string) => {
      const response = await originalFetch(`${baseUrl}/novel-import-sessions/${sessionId}`, {
        headers: authHeaders(accessToken),
      });
      assert.equal(response.status, 200);
      return response.json() as Promise<{
        session: {
          id: string;
          chunks: Array<{ index: number; status: string; summary?: string }>;
          writeResult?: {
            worldBibleVersionId: string;
            synopsisVersionId: string;
            scriptVersionId: string;
          };
        };
      }>;
    };

    const user = await registerUser(baseUrl, {
      email: "novel-retry@example.com",
      displayName: "Novel Retry",
    });
    const teams = await listTeams(baseUrl, user.accessToken);
    const projectResponse = await originalFetch(`${baseUrl}/projects`, {
      method: "POST",
      headers: authHeaders(user.accessToken, true),
      body: JSON.stringify({ teamId: teams[0]?.id, name: "Retry Novel" }),
    });
    assert.equal(projectResponse.status, 201);
    const project = await projectResponse.json() as { id: string };

    const sessionResponse = await originalFetch(`${baseUrl}/projects/${project.id}/novel-import-sessions`, {
      method: "POST",
      headers: authHeaders(user.accessToken, true),
      body: JSON.stringify({
        text: "第一章\n她推开门。\n\n第二章\n电话响了。",
        targetEpisodeCount: 8,
        episodeDurationMinutes: 2,
        genreStyle: "都市悬疑",
        adaptationFocus: "强化悬念",
        llmConfigSource: "personal",
      }),
    });
    assert.equal(sessionResponse.status, 201);
    const created = await sessionResponse.json() as { session: { id: string } };

    const startResponse = await originalFetch(`${baseUrl}/novel-import-sessions/${created.session.id}/start`, {
      method: "POST",
      headers: authHeaders(user.accessToken, true),
    });
    assert.equal(startResponse.status, 201);
    const started = await startResponse.json() as { job: { id: string } };
    await processInternalJob(started.job.id);

    const retryResponse = await originalFetch(`${baseUrl}/novel-import-sessions/${created.session.id}/chunks/0/retry`, {
      method: "POST",
      headers: authHeaders(user.accessToken, true),
    });
    assert.equal(retryResponse.status, 201);
    const retry = await retryResponse.json() as { job: { id: string } };
    await processInternalJob(retry.job.id);
    const afterRetry = await loadSession(user.accessToken, created.session.id);
    assert.equal(afterRetry.session.chunks[0]?.summary, "重试后的第一块。");
    assert.equal(afterRetry.session.chunks[1]?.status, "stale");

    const rerunResponse = await originalFetch(`${baseUrl}/novel-import-sessions/${created.session.id}/chunks/0/rerun-following`, {
      method: "POST",
      headers: authHeaders(user.accessToken, true),
    });
    assert.equal(rerunResponse.status, 201);
    const rerun = await rerunResponse.json() as { job: { id: string } };
    await processInternalJob(rerun.job.id);
    const afterRerun = await loadSession(user.accessToken, created.session.id);
    assert.equal(afterRerun.session.chunks.every((chunk) => chunk.status === "completed"), true);

    const writeResponse = await originalFetch(`${baseUrl}/novel-import-sessions/${created.session.id}/write-drafts`, {
      method: "POST",
      headers: authHeaders(user.accessToken, true),
    });
    assert.equal(writeResponse.status, 201);
    const writeResult = await writeResponse.json() as {
      writeResult: { worldBibleVersionId: string; synopsisVersionId: string; scriptVersionId: string };
    };

    const duplicateWriteResponse = await originalFetch(`${baseUrl}/novel-import-sessions/${created.session.id}/write-drafts`, {
      method: "POST",
      headers: authHeaders(user.accessToken, true),
    });
    assert.equal(duplicateWriteResponse.status, 201);
    const duplicateWrite = await duplicateWriteResponse.json() as {
      writeResult: { worldBibleVersionId: string; synopsisVersionId: string; scriptVersionId: string };
    };
    assert.equal(writeResult.writeResult.scriptVersionId, duplicateWrite.writeResult.scriptVersionId);

    const versions = await listProjectVersions<{ id: string; status: string }>(baseUrl, user.accessToken, project.id);
    const scriptVersion = versions.find((version) => version.id === writeResult.writeResult.scriptVersionId);
    const worldBibleVersion = versions.find((version) => version.id === writeResult.writeResult.worldBibleVersionId);
    const synopsisVersion = versions.find((version) => version.id === writeResult.writeResult.synopsisVersionId);
    assert.equal(scriptVersion?.status, "draft");
    assert.equal(worldBibleVersion?.status, "draft");
    assert.equal(synopsisVersion?.status, "draft");
  });
});
```

- [ ] **Step 2: Run test and verify it fails**

Run:

```powershell
npm --workspace @dramaflow/api test
```

Expected: FAIL with HTTP 404 for retry or write endpoints.

- [ ] **Step 3: Implement retry and rerun service methods**

In `apps/api/src/jobs/novel-import.service.ts`, add:

```ts
  private async retryChunk(
    userId: string,
    sessionId: string,
    chunkIndex: number,
    resolveLlmConfig: (userId: string, projectId: string, source?: LlmConfigSource) => Promise<LlmProviderConfig>,
    streamLlm: (systemPrompt: string, messages: Array<{ role: string; content: string }>, config?: LlmProviderConfig) => AsyncGenerator<StreamChunk>,
  ) {
    const session = await this.getSession(userId, sessionId);
    if (!session.chunks[chunkIndex]) {
      throw new BadRequestException(`Chunk ${chunkIndex} does not exist`);
    }
    const config = await resolveLlmConfig(userId, session.projectId, session.options.llmConfigSource);
    const updated = await this.generateChunksFrom(session.id, chunkIndex, config, streamLlm, false);
    return this.updateSession(updated.id, (live) => {
      for (const chunk of live.chunks.slice(chunkIndex + 1)) {
        if (chunk.status === "completed") {
          chunk.status = "stale";
        }
      }
      live.status = "needs_review";
      live.stage = "review";
      live.progress = 100;
      live.scriptPreview = this.buildPreview(live);
      live.error = undefined;
    });
  }

  private async rerunFromChunk(
    userId: string,
    sessionId: string,
    chunkIndex: number,
    resolveLlmConfig: (userId: string, projectId: string, source?: LlmConfigSource) => Promise<LlmProviderConfig>,
    streamLlm: (systemPrompt: string, messages: Array<{ role: string; content: string }>, config?: LlmProviderConfig) => AsyncGenerator<StreamChunk>,
  ) {
    const session = await this.getSession(userId, sessionId);
    if (!session.chunks[chunkIndex]) {
      throw new BadRequestException(`Chunk ${chunkIndex} does not exist`);
    }
    const config = await resolveLlmConfig(userId, session.projectId, session.options.llmConfigSource);
    const updated = await this.generateChunksFrom(session.id, chunkIndex, config, streamLlm, true);
    return this.updateSession(updated.id, (live) => {
      live.status = "needs_review";
      live.stage = "review";
      live.progress = 100;
      live.scriptPreview = this.buildPreview(live);
      live.error = undefined;
    });
  }
```

- [ ] **Step 4: Implement writeDrafts**

Add:

```ts
  async writeDrafts(userId: string, sessionId: string) {
    const session = await this.getSession(userId, sessionId);
    if (session.writeResult) {
      return { session, writeResult: session.writeResult };
    }
    if (!session.worldBible || !session.synopsis || !session.scriptPreview) {
      throw new BadRequestException("Novel import session is not ready to write drafts");
    }

    const wbDoc = await this.workspaceService.ensureDocumentForProject({
      projectId: session.projectId,
      type: "world_bible",
      title: "AI 世界观",
      createdBy: userId,
    });
    const wbVersion = await this.workspaceService.createVersionForDocument({
      documentId: wbDoc.id,
      title: "小说导入世界观草稿",
      content: session.worldBible,
      metadata: { source: "novel_import", novelImportSessionId: session.id },
      createdBy: userId,
      status: "draft",
    });

    const synopsisDoc = await this.workspaceService.ensureDocumentForProject({
      projectId: session.projectId,
      type: "synopsis",
      title: "AI 大纲",
      createdBy: userId,
    });
    const synopsisVersion = await this.workspaceService.createVersionForDocument({
      documentId: synopsisDoc.id,
      title: "小说导入大纲草稿",
      content: session.synopsis,
      metadata: { source: "novel_import", novelImportSessionId: session.id },
      createdBy: userId,
      status: "draft",
    });

    const scriptDoc = await this.workspaceService.ensureDocumentForProject({
      projectId: session.projectId,
      type: "script",
      title: "AI 剧本",
      createdBy: userId,
    });
    const scriptVersion = await this.workspaceService.createVersionForDocument({
      documentId: scriptDoc.id,
      title: "小说导入剧本草稿",
      content: session.scriptPreview,
      metadata: { source: "novel_import", novelImportSessionId: session.id },
      createdBy: userId,
      status: "draft",
    });

    const writeResult: NovelImportWriteResult = {
      worldBibleDocumentId: wbDoc.id,
      worldBibleVersionId: wbVersion.id,
      synopsisDocumentId: synopsisDoc.id,
      synopsisVersionId: synopsisVersion.id,
      scriptDocumentId: scriptDoc.id,
      scriptVersionId: scriptVersion.id,
      writtenAt: new Date().toISOString(),
    };

    const updated = await this.updateSession(session.id, (live) => {
      live.status = "written";
      live.stage = "write";
      live.progress = 100;
      live.writeResult = writeResult;
      live.error = undefined;
    });
    return { session: updated, writeResult };
  }
```

- [ ] **Step 5: Add controller endpoints for retry, rerun, and write**

In `apps/api/src/jobs/jobs.controller.ts`, add:

```ts
  @Post("novel-import-sessions/:id/chunks/:index/retry")
  async retryNovelImportChunk(
    @CurrentUser() user: { id: string },
    @Param("id") sessionId: string,
    @Param("index") index: string,
  ) {
    const session = await this.novelImportService.getSession(user.id, sessionId);
    const job = await this.jobsService.createNovelImportJob(user.id, session.projectId, {
      action: "retryChunk",
      sessionId,
      chunkIndex: Number(index),
    });
    const updated = await this.novelImportService.attachJob(user.id, sessionId, job.id);
    return { session: updated, job };
  }

  @Post("novel-import-sessions/:id/chunks/:index/rerun-following")
  async rerunNovelImportFollowingChunks(
    @CurrentUser() user: { id: string },
    @Param("id") sessionId: string,
    @Param("index") index: string,
  ) {
    const session = await this.novelImportService.getSession(user.id, sessionId);
    const job = await this.jobsService.createNovelImportJob(user.id, session.projectId, {
      action: "rerunFromChunk",
      sessionId,
      chunkIndex: Number(index),
    });
    const updated = await this.novelImportService.attachJob(user.id, sessionId, job.id);
    return { session: updated, job };
  }

  @Post("novel-import-sessions/:id/write-drafts")
  async writeNovelImportDrafts(
    @CurrentUser() user: { id: string },
    @Param("id") sessionId: string,
  ) {
    return this.novelImportService.writeDrafts(user.id, sessionId);
  }
```

- [ ] **Step 6: Run tests and lint**

Run:

```powershell
npm --workspace @dramaflow/api test
npm run lint
```

Expected: API tests pass, lint passes.

- [ ] **Step 7: Commit**

```powershell
git add apps/api/src/jobs/novel-import.service.ts apps/api/src/jobs/jobs.controller.ts apps/api/scripts/test.ts
git commit -m "feat(api): support novel import retry and draft writes"
```

---

### Task 6: Frontend Contracts, Query Keys, and i18n

**Files:**
- Modify: `apps/web/lib/query-keys.ts`
- Modify: `apps/web/lib/i18n/messages.ts`
- Modify: `apps/web/components/project-workspace/generation/novel-import-generator.tsx`

- [ ] **Step 1: Add query keys**

In `apps/web/lib/query-keys.ts`, add:

```ts
  novelImportLatest: (projectId: string) => ["novel-import-latest", projectId] as const,
  novelImportSession: (sessionId: string) => ["novel-import-session", sessionId] as const,
```

- [ ] **Step 2: Add i18n messages**

In `apps/web/lib/i18n/messages.ts`, add a `novelImport` object to both the Chinese and English message trees.

Chinese block:

```ts
  novelImport: {
    modeLabel: "小说导入",
    stepSetup: "导入设置",
    stepProgress: "生成进度",
    stepReview: "结果确认",
    pastePlaceholder: "粘贴小说文本到此处...",
    uploadTxt: "上传 TXT",
    readingFile: "读取中...",
    targetEpisodeCount: "目标集数",
    episodeDurationMinutes: "单集时长（分钟）",
    genreStyle: "剧种/风格",
    genreStylePlaceholder: "例如：都市悬疑、甜宠、逆袭爽剧",
    adaptationFocus: "改编侧重点",
    adaptationFocusPlaceholder: "例如：强化反转，保留原作人物关系",
    createSession: "创建导入会话",
    startGeneration: "开始生成",
    cancel: "取消导入",
    retryChunk: "重试此块",
    rerunFollowing: "从此处重跑后续",
    writeDrafts: "确认写入草稿",
    newImport: "新建导入",
    chunkCount: "{count} 个分块",
    charCount: "{count} 字",
    scenesCount: "{count} 场景",
    staleWarning: "存在过期分块，后续剧情可能仍沿用旧上下文。",
    restoreNotice: "已恢复未完成的小说导入会话。",
    emptyLatest: "暂无可恢复的小说导入。",
    createFailed: "创建导入会话失败。",
    actionFailed: "导入操作失败。",
    writeSuccess: "草稿写入完成。",
    statusDraft: "待开始",
    statusQueued: "排队中",
    statusRunning: "生成中",
    statusNeedsReview: "待确认",
    statusFailed: "失败",
    statusCancelled: "已取消",
    statusWritten: "已写入",
  },
```

English block:

```ts
  novelImport: {
    modeLabel: "Novel Import",
    stepSetup: "Import Setup",
    stepProgress: "Generation Progress",
    stepReview: "Review Results",
    pastePlaceholder: "Paste novel text here...",
    uploadTxt: "Upload TXT",
    readingFile: "Reading...",
    targetEpisodeCount: "Target episodes",
    episodeDurationMinutes: "Episode duration (minutes)",
    genreStyle: "Genre / style",
    genreStylePlaceholder: "Urban suspense, romance, comeback drama",
    adaptationFocus: "Adaptation focus",
    adaptationFocusPlaceholder: "Emphasize twists and preserve character relationships",
    createSession: "Create Import Session",
    startGeneration: "Start Generation",
    cancel: "Cancel Import",
    retryChunk: "Retry Chunk",
    rerunFollowing: "Rerun From Here",
    writeDrafts: "Write Drafts",
    newImport: "New Import",
    chunkCount: "{count} chunks",
    charCount: "{count} chars",
    scenesCount: "{count} scenes",
    staleWarning: "Some chunks are stale. Later story beats may still use older context.",
    restoreNotice: "Restored an unfinished novel import session.",
    emptyLatest: "No recoverable novel import session.",
    createFailed: "Failed to create import session.",
    actionFailed: "Novel import action failed.",
    writeSuccess: "Drafts written.",
    statusDraft: "Ready",
    statusQueued: "Queued",
    statusRunning: "Running",
    statusNeedsReview: "Needs review",
    statusFailed: "Failed",
    statusCancelled: "Cancelled",
    statusWritten: "Written",
  },
```

- [ ] **Step 3: Update mode label**

In `apps/web/components/project-workspace/generation/generator-host.tsx`, replace the hard-coded `"小说导入"` with:

```tsx
: t("novelImport.modeLabel")}
```

- [ ] **Step 4: Run lint**

Run:

```powershell
npm --workspace @dramaflow/web run lint
```

Expected: web TypeScript check passes.

- [ ] **Step 5: Commit**

```powershell
git add apps/web/lib/query-keys.ts apps/web/lib/i18n/messages.ts apps/web/components/project-workspace/generation/generator-host.tsx
git commit -m "feat(web): add novel import wizard labels"
```

---

### Task 7: Replace NovelImportGenerator with Three-Step Wizard

**Files:**
- Modify: `apps/web/components/project-workspace/generation/novel-import-generator.tsx`
- Modify: `apps/web/app/globals.css`

- [ ] **Step 1: Replace component state and imports**

In `apps/web/components/project-workspace/generation/novel-import-generator.tsx`, replace imports with:

```tsx
"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import ReactMarkdown from "react-markdown";
import type {
  CreateNovelImportSessionPayload,
  LatestNovelImportSessionResponse,
  LlmConfigSource,
  NovelImportJobResponse,
  NovelImportSession,
  NovelImportSessionResponse,
  NovelImportWriteDraftsResponse,
  ProjectWorkspacePayload,
} from "@dramaflow/shared";
import { normalizeScriptContent, normalizeWorldBibleContent } from "@dramaflow/shared";

import { apiFetch, formatApiError } from "../../../lib/api";
import { queryKeys } from "../../../lib/query-keys";
import { useFeedback } from "../../../lib/hooks";
import { useI18n } from "../../../lib/i18n";
import type { GeneratorConfig } from "./generator-registry";
import { ScriptView, WorldBibleView } from "../version-view";
```

Add local types:

```tsx
type WizardStep = "setup" | "progress" | "review";
type PreviewTab = "worldBible" | "synopsis" | "script";

interface SetupDraft {
  text: string;
  targetEpisodeCount: number;
  episodeDurationMinutes: number;
  genreStyle: string;
  adaptationFocus: string;
}
```

- [ ] **Step 2: Add API mutations and polling query**

Inside `NovelImportGenerator`, add:

```tsx
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const { feedback, setFeedback } = useFeedback();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [step, setStep] = useState<WizardStep>("setup");
  const [previewTab, setPreviewTab] = useState<PreviewTab>("worldBible");
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [draft, setDraft] = useState<SetupDraft>({
    text: "",
    targetEpisodeCount: 12,
    episodeDurationMinutes: 2,
    genreStyle: "",
    adaptationFocus: "",
  });

  const latestQuery = useQuery({
    queryKey: queryKeys.novelImportLatest(projectId),
    queryFn: () => apiFetch<LatestNovelImportSessionResponse>(`/projects/${projectId}/novel-import-sessions/latest`),
  });

  useEffect(() => {
    const session = latestQuery.data?.session;
    if (!session || activeSessionId) return;
    setActiveSessionId(session.id);
    setStep(session.status === "needs_review" || session.status === "written" ? "review" : session.status === "draft" ? "setup" : "progress");
  }, [activeSessionId, latestQuery.data?.session]);

  const sessionQuery = useQuery({
    queryKey: activeSessionId ? queryKeys.novelImportSession(activeSessionId) : ["novel-import-session", "none"],
    enabled: Boolean(activeSessionId),
    queryFn: () => apiFetch<NovelImportSessionResponse>(`/novel-import-sessions/${activeSessionId}`),
    refetchInterval: (query) => {
      const status = query.state.data?.session.status;
      return status === "queued" || status === "running" ? 2500 : false;
    },
  });

  const session = sessionQuery.data?.session ?? latestQuery.data?.session ?? null;
```

Add mutations:

```tsx
  const createSessionMutation = useMutation({
    mutationFn: (payload: CreateNovelImportSessionPayload) =>
      apiFetch<NovelImportSessionResponse>(`/projects/${projectId}/novel-import-sessions`, {
        method: "POST",
        body: payload,
      }),
    onSuccess: (payload) => {
      setActiveSessionId(payload.session.id);
      setStep("setup");
      queryClient.setQueryData(queryKeys.novelImportSession(payload.session.id), payload);
      queryClient.invalidateQueries({ queryKey: queryKeys.novelImportLatest(projectId) });
    },
    onError: (error) => setFeedback({ message: null, error: formatApiError(error, t, "novelImport.createFailed") }),
  });

  const actionMutation = useMutation({
    mutationFn: (path: string) => apiFetch<NovelImportJobResponse>(path, { method: "POST" }),
    onSuccess: (payload) => {
      setActiveSessionId(payload.session.id);
      setStep("progress");
      queryClient.invalidateQueries({ queryKey: queryKeys.novelImportSession(payload.session.id) });
      queryClient.invalidateQueries({ queryKey: queryKeys.projectJobs(projectId) });
    },
    onError: (error) => setFeedback({ message: null, error: formatApiError(error, t, "novelImport.actionFailed") }),
  });

  const writeMutation = useMutation({
    mutationFn: (sessionId: string) =>
      apiFetch<NovelImportWriteDraftsResponse>(`/novel-import-sessions/${sessionId}/write-drafts`, { method: "POST" }),
    onSuccess: (payload) => {
      setStep("review");
      setFeedback({ message: t("novelImport.writeSuccess"), error: null });
      queryClient.setQueryData(queryKeys.novelImportSession(payload.session.id), { session: payload.session });
      queryClient.invalidateQueries({ queryKey: queryKeys.project(projectId) });
      queryClient.invalidateQueries({ queryKey: queryKeys.projectVersions(projectId) });
    },
    onError: (error) => setFeedback({ message: null, error: formatApiError(error, t, "novelImport.actionFailed") }),
  });
```

- [ ] **Step 3: Add handlers**

Add:

```tsx
  const handleFileUpload = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (readerEvent) => {
      const text = readerEvent.target?.result;
      if (typeof text === "string") {
        setDraft((current) => ({ ...current, text }));
      }
    };
    reader.onerror = () => setFeedback({ message: null, error: "文件读取失败" });
    reader.readAsText(file, "utf-8");
    event.target.value = "";
  }, [setFeedback]);

  const handleCreateSession = useCallback(() => {
    createSessionMutation.mutate({
      text: draft.text,
      targetEpisodeCount: draft.targetEpisodeCount,
      episodeDurationMinutes: draft.episodeDurationMinutes,
      genreStyle: draft.genreStyle,
      adaptationFocus: draft.adaptationFocus,
      llmConfigSource,
    });
  }, [createSessionMutation, draft, llmConfigSource]);

  const handleStart = useCallback(() => {
    if (!session) return;
    actionMutation.mutate(`/novel-import-sessions/${session.id}/start`);
  }, [actionMutation, session]);

  const handleCancel = useCallback(() => {
    if (!session) return;
    actionMutation.mutate(`/novel-import-sessions/${session.id}/cancel`);
  }, [actionMutation, session]);

  const handleRetryChunk = useCallback((index: number) => {
    if (!session) return;
    actionMutation.mutate(`/novel-import-sessions/${session.id}/chunks/${index}/retry`);
  }, [actionMutation, session]);

  const handleRerunFollowing = useCallback((index: number) => {
    if (!session) return;
    actionMutation.mutate(`/novel-import-sessions/${session.id}/chunks/${index}/rerun-following`);
  }, [actionMutation, session]);

  const handleNewImport = useCallback(() => {
    setActiveSessionId(null);
    setStep("setup");
    setPreviewTab("worldBible");
    setDraft({
      text: "",
      targetEpisodeCount: 12,
      episodeDurationMinutes: 2,
      genreStyle: "",
      adaptationFocus: "",
    });
  }, []);
```

- [ ] **Step 4: Add render helpers**

Add helpers before `return`:

```tsx
  const hasStaleChunks = Boolean(session?.chunks.some((chunk) => chunk.status === "stale"));
  const canCreate = draft.text.trim().length > 0 && draft.targetEpisodeCount > 0 && draft.episodeDurationMinutes > 0;
  const isBusy = session?.status === "queued" || session?.status === "running";

  const statusLabel = (status: NovelImportSession["status"]) => {
    const key = `novelImport.status${status === "needs_review" ? "NeedsReview" : status.charAt(0).toUpperCase() + status.slice(1)}` as const;
    return t(key as never);
  };

  const progressWidth = `${Math.max(0, Math.min(100, session?.progress ?? 0))}%`;
```

- [ ] **Step 5: Replace JSX with wizard**

Replace the old return body with:

```tsx
  return (
    <div className="novel-import novel-import-wizard">
      <div className="novel-import-wizard__steps">
        {(["setup", "progress", "review"] as WizardStep[]).map((item) => (
          <button
            key={item}
            className={`novel-import-wizard__step${step === item ? " novel-import-wizard__step--on" : ""}`}
            type="button"
            onClick={() => setStep(item)}
            disabled={item !== "setup" && !session}
          >
            {item === "setup" ? t("novelImport.stepSetup") : item === "progress" ? t("novelImport.stepProgress") : t("novelImport.stepReview")}
          </button>
        ))}
      </div>

      {feedback.message && <div className="gen-notice gen-notice--ok" role="status">{feedback.message}</div>}
      {feedback.error && <div className="gen-notice gen-notice--err" role="alert">{feedback.error}</div>}

      {step === "setup" && (
        <section className="novel-import-wizard__panel">
          <textarea
            className="input novel-import__textarea"
            rows={10}
            placeholder={t("novelImport.pastePlaceholder")}
            value={session?.sourceText ?? draft.text}
            onChange={(event) => setDraft((current) => ({ ...current, text: event.target.value }))}
            disabled={Boolean(session)}
          />
          <div className="novel-import__input-footer">
            <span className="novel-import__char-count">{t("novelImport.charCount", { count: (session?.sourceText.length ?? draft.text.length).toLocaleString() })}</span>
            <div className="novel-import__actions">
              <button className="btn btn-secondary btn-sm" type="button" onClick={() => fileInputRef.current?.click()} disabled={Boolean(session)}>
                {t("novelImport.uploadTxt")}
              </button>
              <input ref={fileInputRef} type="file" accept=".txt" onChange={handleFileUpload} hidden />
              {!session ? (
                <button className="btn btn-primary btn-sm" type="button" onClick={handleCreateSession} disabled={!canCreate || createSessionMutation.isPending}>
                  {t("novelImport.createSession")}
                </button>
              ) : (
                <button className="btn btn-primary btn-sm" type="button" onClick={handleStart} disabled={isBusy}>
                  {t("novelImport.startGeneration")}
                </button>
              )}
            </div>
          </div>

          {!session && (
            <div className="novel-import-wizard__fields">
              <label>
                <span>{t("novelImport.targetEpisodeCount")}</span>
                <input className="input" type="number" min={1} max={100} value={draft.targetEpisodeCount} onChange={(event) => setDraft((current) => ({ ...current, targetEpisodeCount: Number(event.target.value) }))} />
              </label>
              <label>
                <span>{t("novelImport.episodeDurationMinutes")}</span>
                <input className="input" type="number" min={1} max={60} value={draft.episodeDurationMinutes} onChange={(event) => setDraft((current) => ({ ...current, episodeDurationMinutes: Number(event.target.value) }))} />
              </label>
              <label>
                <span>{t("novelImport.genreStyle")}</span>
                <input className="input" value={draft.genreStyle} placeholder={t("novelImport.genreStylePlaceholder")} onChange={(event) => setDraft((current) => ({ ...current, genreStyle: event.target.value }))} />
              </label>
              <label>
                <span>{t("novelImport.adaptationFocus")}</span>
                <input className="input" value={draft.adaptationFocus} placeholder={t("novelImport.adaptationFocusPlaceholder")} onChange={(event) => setDraft((current) => ({ ...current, adaptationFocus: event.target.value }))} />
              </label>
            </div>
          )}

          {session && (
            <div className="novel-import-wizard__chunks">
              <strong>{t("novelImport.chunkCount", { count: session.chunks.length })}</strong>
              {session.chunks.map((chunk) => (
                <div key={chunk.index} className="novel-import-wizard__chunk-row">
                  <span>{chunk.index + 1}. {chunk.title ?? t("novelImport.stepSetup")}</span>
                  <span>{t("novelImport.charCount", { count: chunk.text.length.toLocaleString() })}</span>
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      {step === "progress" && session && (
        <section className="novel-import-wizard__panel">
          <div className="novel-import__progress">
            <div className="novel-import__progress-bar"><div className="novel-import__progress-fill" style={{ width: progressWidth }} /></div>
            <div className="novel-import__progress-text">{statusLabel(session.status)} · {session.stage} · {session.progress}%</div>
          </div>
          <div className="novel-import__actions">
            {isBusy && <button className="btn btn-secondary btn-sm" type="button" onClick={handleCancel}>{t("novelImport.cancel")}</button>}
            <button className="btn btn-secondary btn-sm" type="button" onClick={handleNewImport}>{t("novelImport.newImport")}</button>
          </div>
          <div className="novel-import-wizard__chunk-list">
            {session.chunks.map((chunk) => (
              <div key={chunk.index} className={`novel-import-wizard__chunk-card novel-import-wizard__chunk-card--${chunk.status}`}>
                <div>
                  <strong>{chunk.index + 1}. {chunk.title ?? `Chunk ${chunk.index + 1}`}</strong>
                  <span>{chunk.status} · {t("novelImport.scenesCount", { count: chunk.scenes.length })}</span>
                  {chunk.error && <span className="novel-import-wizard__error">{chunk.error}</span>}
                </div>
                <div className="novel-import__actions">
                  {(chunk.status === "failed" || chunk.status === "completed" || chunk.status === "stale") && (
                    <button className="btn btn-secondary btn-sm" type="button" onClick={() => handleRetryChunk(chunk.index)} disabled={actionMutation.isPending}>
                      {t("novelImport.retryChunk")}
                    </button>
                  )}
                  {(chunk.status === "completed" || chunk.status === "stale") && (
                    <button className="btn btn-secondary btn-sm" type="button" onClick={() => handleRerunFollowing(chunk.index)} disabled={actionMutation.isPending}>
                      {t("novelImport.rerunFollowing")}
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {step === "review" && session && (
        <section className="novel-import-wizard__panel">
          {hasStaleChunks && <div className="gen-notice gen-notice--err">{t("novelImport.staleWarning")}</div>}
          <div className="novel-import__preview-tabs">
            <button className={`novel-import__tab${previewTab === "worldBible" ? " novel-import__tab--on" : ""}`} type="button" onClick={() => setPreviewTab("worldBible")}>World Bible</button>
            <button className={`novel-import__tab${previewTab === "synopsis" ? " novel-import__tab--on" : ""}`} type="button" onClick={() => setPreviewTab("synopsis")}>Synopsis</button>
            <button className={`novel-import__tab${previewTab === "script" ? " novel-import__tab--on" : ""}`} type="button" onClick={() => setPreviewTab("script")}>Script</button>
          </div>
          <div className="novel-import__preview-content">
            {previewTab === "worldBible" && session.worldBible && <WorldBibleView content={normalizeWorldBibleContent(session.worldBible)} />}
            {previewTab === "synopsis" && session.synopsis && <div className="vv-markdown"><ReactMarkdown>{session.synopsis}</ReactMarkdown></div>}
            {previewTab === "script" && session.scriptPreview && <ScriptView content={normalizeScriptContent(session.scriptPreview)} />}
          </div>
          <div className="novel-import__actions">
            <button className="btn btn-secondary btn-sm" type="button" onClick={handleNewImport}>{t("novelImport.newImport")}</button>
            <button className="btn btn-primary btn-sm" type="button" onClick={() => session && writeMutation.mutate(session.id)} disabled={!session.scriptPreview || writeMutation.isPending || Boolean(session.writeResult)}>
              {session.writeResult ? t("novelImport.statusWritten") : t("novelImport.writeDrafts")}
            </button>
          </div>
        </section>
      )}
    </div>
  );
```

- [ ] **Step 6: Add CSS**

In `apps/web/app/globals.css`, append after existing `.novel-import__preview-content`:

```css
.novel-import-wizard__steps {
  display: flex;
  gap: var(--space-2);
  border-bottom: 1px solid var(--border-subtle);
  padding-bottom: var(--space-2);
}

.novel-import-wizard__step {
  border: 1px solid var(--border-subtle);
  background: rgba(255, 255, 255, 0.03);
  color: var(--text-secondary);
  border-radius: var(--radius-md);
  padding: 8px 12px;
  font-size: 13px;
  cursor: pointer;
}

.novel-import-wizard__step--on {
  color: var(--accent);
  border-color: var(--accent);
}

.novel-import-wizard__panel {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}

.novel-import-wizard__fields {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: var(--space-3);
}

.novel-import-wizard__fields label {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
  font-size: 12px;
  color: var(--text-secondary);
}

.novel-import-wizard__chunks,
.novel-import-wizard__chunk-list {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}

.novel-import-wizard__chunk-row,
.novel-import-wizard__chunk-card {
  display: flex;
  justify-content: space-between;
  gap: var(--space-3);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-md);
  padding: var(--space-2) var(--space-3);
  background: rgba(255, 255, 255, 0.03);
  font-size: 12px;
}

.novel-import-wizard__chunk-card > div:first-child {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}

.novel-import-wizard__chunk-card--failed {
  border-color: rgba(248, 113, 113, 0.35);
}

.novel-import-wizard__chunk-card--stale {
  border-color: rgba(251, 191, 36, 0.35);
}

.novel-import-wizard__error {
  color: var(--color-error);
  overflow-wrap: anywhere;
}

@media (max-width: 720px) {
  .novel-import-wizard__fields {
    grid-template-columns: 1fr;
  }

  .novel-import-wizard__chunk-card {
    flex-direction: column;
  }
}
```

- [ ] **Step 7: Run web lint**

Run:

```powershell
npm --workspace @dramaflow/web run lint
```

Expected: web TypeScript check passes.

- [ ] **Step 8: Commit**

```powershell
git add apps/web/components/project-workspace/generation/novel-import-generator.tsx apps/web/app/globals.css
git commit -m "feat(web): replace novel import with recoverable wizard"
```

---

### Task 8: End-to-End Verification and Rollout Cleanup

**Files:**
- Review: `apps/api/src/jobs/novel-import.service.ts`
- Review: `apps/web/components/project-workspace/generation/novel-import-generator.tsx`
- Review: `apps/web/app/globals.css`

- [ ] **Step 1: Run full verification**

Run:

```powershell
npm run lint
npm test
npm run build
```

Expected:

- All workspace TypeScript checks pass.
- API and shared tests pass.
- Build completes for shared, API, worker, and web.

- [ ] **Step 2: Manually verify the wizard with local services**

Start services in separate terminals:

```powershell
npm run dev:api
npm run dev:worker
npm run dev:web
```

Open the web app and verify:

1. Open a project workspace.
2. Switch script or synopsis generation mode to novel import.
3. Paste a two-chapter sample.
4. Enter target episode count, episode duration, genre/style, and focus.
5. Create session and confirm chunk preflight appears.
6. Start generation.
7. Refresh the browser while queued or running.
8. Confirm the same session restores.
9. Retry a completed chunk.
10. Confirm following completed chunks become stale.
11. Rerun from the retried chunk.
12. Confirm stale warnings clear after rerun.
13. Write drafts.
14. Confirm world bible, synopsis, and script draft versions exist and are not approved.

- [ ] **Step 3: Inspect git diff for accidental README or unrelated changes**

Run:

```powershell
git status --short
git diff --stat
```

Expected:

- No README files changed.
- Only files from this plan changed.

- [ ] **Step 4: Commit verification fixes if any were needed**

If Step 1 or Step 2 required fixes in the listed implementation files, commit only those fixes:

```powershell
git add apps/api/src/jobs/novel-import.service.ts apps/web/components/project-workspace/generation/novel-import-generator.tsx apps/web/app/globals.css
git commit -m "fix: stabilize novel import wizard"
```

If no fixes were needed, do not create an empty commit.

---

## Self-Review Checklist

- Spec coverage:
  - Three-step wizard: Task 7.
  - Persistent backend session: Tasks 1 and 2.
  - Worker-based execution: Tasks 3 and 4.
  - Adaptation plan and continuity chain: Task 4.
  - Chunk-level retry and rerun following: Task 5.
  - Confirm-before-write draft versions: Task 5.
  - Refresh recovery: Tasks 2 and 7.
  - Existing SSE kept compiling during rollout: Tasks 2 through 8 do not remove the legacy endpoint.
- Placeholder scan:
  - No placeholder markers or unspecified implementation steps are present.
- Type consistency:
  - `NovelImportSession`, `NovelImportJobInput`, `NovelImportWriteResult`, and API response names match Tasks 1 through 7.
  - Endpoint paths match across API and frontend tasks.
