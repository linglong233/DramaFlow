# Novel Import Wizard Design

Date: 2026-05-20

## Context

DramaFlow already has a basic novel import mode inside the generation panel. It accepts pasted text or a TXT file, streams progress over SSE, extracts a world bible and synopsis, generates script scenes chunk by chunk, then writes approved versions immediately.

The next iteration should improve quality, large-text stability, and user control. The target experience is a three-step import wizard with refresh recovery, chunk-level retry, and explicit user confirmation before writing generated content into project documents.

## Goals

- Replace the current one-shot import UI with a three-step wizard inside the existing "novel import" generation mode.
- Persist import state on the backend so users can refresh the page and recover progress or results.
- Improve generated structure by using import options, an adaptation plan, world bible context, and a continuity summary chain.
- Support chunk-level retry. Retrying one chunk replaces that chunk and marks later completed chunks as stale; users can optionally rerun from that chunk through the end.
- Generate one script document for the full novel. Chunks are processing units, not separate output documents.
- Write generated world bible, synopsis, and script only after the user confirms. The written versions must be `draft` versions.

## Non-Goals

- Do not migrate runtime storage to Prisma or PostgreSQL.
- Do not replace the current worker polling architecture with Redis or BullMQ.
- Do not add DOCX, EPUB, PDF, URL, or cloud-drive import sources.
- Do not add advanced controls such as custom prompts, manual chunk editing, or tunable chunk sizes.
- Do not split the final output into episode documents.

## Confirmed Product Decisions

| Topic | Decision |
| --- | --- |
| UX shape | Three-step import wizard |
| Step 1 parameters | Novel text, target episode count, episode duration, genre/style, adaptation focus |
| Refresh recovery | Backend-persisted session can restore progress and preview after refresh |
| Retry granularity | Chunk-level retry |
| Retry behavior | Default retry replaces only the current chunk and marks following completed chunks stale |
| Follow-up retry option | User can rerun from a selected chunk through all following chunks |
| Output shape | One world bible draft, one synopsis draft, one full script draft |
| Write timing | User confirms first, then system writes draft versions |
| Source text storage | Store full source text in the development database for this iteration |

## Architecture

Use a two-layer model: a dedicated novel import session plus ordinary background jobs.

`NovelImportSession` is the authoritative state for an import. It stores the source text, options, chunks, generated world bible, generated synopsis, per-chunk scenes, retry state, preview content, and draft write result. It belongs to a project and can be loaded after refresh.

`JobRecord` remains the execution carrier. Jobs run actions against a session, such as generating the full session, retrying one chunk, or rerunning from a chunk. Jobs should update the session as they progress, then finish as completed or failed. The complex import state should not be squeezed into `job.input` or `job.result`.

The first implementation should add a `novel_import` job type and process it through the existing worker polling flow. This keeps long LLM work outside the HTTP request lifecycle and fits the current `internal/jobs` architecture.

## Data Model

Add shared domain types for the session.

```ts
export type NovelImportStatus =
  | "draft"
  | "queued"
  | "running"
  | "needs_review"
  | "failed"
  | "cancelled"
  | "written";

export type NovelImportStage =
  | "setup"
  | "chunking"
  | "adaptationPlan"
  | "worldBible"
  | "synopsis"
  | "script"
  | "review"
  | "write";

export type NovelImportChunkStatus =
  | "pending"
  | "running"
  | "completed"
  | "failed"
  | "stale";
```

`NovelImportSession` fields:

- `id`, `projectId`, `createdBy`, `createdAt`, `updatedAt`
- `status`, `stage`, `progress`
- `sourceText`
- `options`: target episode count, episode duration, genre/style, adaptation focus, `llmConfigSource`
- `chunks`: each chunk has `index`, optional `title`, `text`, `status`, optional `summary`, `continuityNotes`, `scenes`, `rawOutput`, `error`, `startedAt`, `completedAt`
- `adaptationPlan?`
- `worldBible?`
- `synopsis?`
- `scriptPreview?`
- `writeResult?`: `worldBibleVersionId`, `synopsisVersionId`, `scriptVersionId`, `writtenAt`
- `lastJobId?`
- `error?`

`DevDatabase` gets `novelImportSessions: NovelImportSession[]`. `createEmptyDatabase` initializes it to an empty array. The database loading path must preserve compatibility with existing JSON files that do not have this field yet.

Store the full source text for this iteration. Add a backend input limit, defaulting to 500,000 characters. Text longer than the limit should fail validation with a clear message rather than silently starting an oversized import.

## API Design

Add API contracts in `packages/shared/src/api-contracts.ts` and expose controller methods under `apps/api/src/jobs`.

### Create Session

`POST /projects/:id/novel-import-sessions`

Input:

```ts
interface CreateNovelImportSessionPayload {
  text: string;
  targetEpisodeCount: number;
  episodeDurationMinutes: number;
  genreStyle: string;
  adaptationFocus: string;
  llmConfigSource?: LlmConfigSource;
}
```

Behavior:

- Validate project access and non-empty text.
- Validate max source length.
- Split text into chunks.
- Save a `draft` session with `stage: "setup"`.
- Return the session, including chunk metadata for preflight review.

### Restore Latest

`GET /projects/:id/novel-import-sessions/latest`

Returns the latest not-written session for the current user and project, or `null` if none exists. This powers refresh recovery when the user opens the wizard.

### Get Session

`GET /novel-import-sessions/:id`

Returns the full session state. The frontend can poll this endpoint while a session is queued or running.

### Start Generation

`POST /novel-import-sessions/:id/start`

Creates a `novel_import` job with an action like:

```ts
{ action: "runSession", sessionId: string }
```

The session moves to `queued`, records `lastJobId`, and later becomes `running` when the worker processes it. Starting a `failed` or `cancelled` session should continue from the first incomplete stage or failed chunk, preserving completed work.

### Cancel

`POST /novel-import-sessions/:id/cancel`

Marks the session `cancelled`. The running job checks this state between stages and chunks, then exits without writing documents.

### Retry One Chunk

`POST /novel-import-sessions/:id/chunks/:index/retry`

Creates a `novel_import` job with:

```ts
{ action: "retryChunk", sessionId: string, chunkIndex: number }
```

On success, the selected chunk is replaced. Following chunks that were already completed are marked `stale`, because their scenes may still depend on the old summary chain.

### Rerun From Chunk

`POST /novel-import-sessions/:id/chunks/:index/rerun-following`

Creates a `novel_import` job with:

```ts
{ action: "rerunFromChunk", sessionId: string, chunkIndex: number }
```

The worker regenerates the selected chunk and every following chunk in order.

### Write Drafts

`POST /novel-import-sessions/:id/write-drafts`

Writes three draft versions only after user confirmation:

- world bible document draft
- synopsis document draft
- script document draft

If `writeResult` already exists, the endpoint returns the existing version ids and does not create duplicate drafts.

## Generation Flow

### Chunking

Prefer chapter-title boundaries. Match Chinese chapter headings such as `第十章`, `第1章`, `第十二回`, and English headings such as `Chapter 10`. When headings are not found, split by target length and paragraph boundaries.

Each chunk stores text, title if available, index, and status. The frontend should show chunk count and basic metadata before generation starts.

### Adaptation Plan

Before world bible and synopsis generation, create a lightweight adaptation plan from the full text sample and user options. It should include:

- major characters
- core conflict
- target episode structure
- genre and tone interpretation
- adaptation focus
- story arc

The adaptation plan is carried into world bible extraction, synopsis generation, and chunk scene generation.

### World Bible

Generate structured `WorldBibleContent` with characters, locations, and style guide. Do not silently return empty content on parse failure. Store raw output and parsing error on the session if strict JSON parsing fails, then mark the stage failed.

### Synopsis

Generate a structured Chinese synopsis using the adaptation plan and world bible. Store the generated markdown text on the session.

### Script Chunks

Generate chunks sequentially. Each chunk prompt includes:

- adaptation plan
- world bible summary
- previous chunk summary
- selected future context when retrying a stale middle chunk
- current chunk source text

Each chunk returns:

- `scenes: ScriptScene[]`
- `summary`
- `continuityNotes`

The service merges completed chunk scenes into `scriptPreview`. The final preview is one `ScriptContent` with all generated scenes in chunk order.

## Error Handling

Parsing failures should be visible and recoverable. Store raw LLM output and parse errors on the failed stage or chunk. Mark the failed chunk as `failed` and expose a retry action.

Global stage failures keep completed previous stages. Restarting generation should continue from the failed stage or first failed chunk instead of throwing away successful work.

Cancelling does not delete the session. A cancelled session remains loadable. The user can either start a new session or resume the cancelled session from the first incomplete stage.

Stale chunks are warnings, not blockers. The user may write drafts with stale chunks, but the review step must clearly show that later chunks may be inconsistent and offer "rerun from this chunk".

## Frontend Design

Replace the current single-screen `NovelImportGenerator` with a wizard inside the existing generation panel. Do not add a new route.

### Step 1: Import Setup

Controls:

- paste text area
- TXT upload
- target episode count
- episode duration
- genre/style
- adaptation focus
- create session button

After session creation, show the preflight result: chunk count, chunk titles, and approximate text length per chunk.

### Step 2: Generation Progress

Show:

- overall status and progress
- current stage
- world bible status
- synopsis status
- chunk list with status, title, scene count, and error summary

Actions:

- cancel running session
- retry failed chunk
- retry completed chunk
- rerun from selected chunk through following chunks

On mount, the component calls the latest-session endpoint. If a recoverable session exists, it restores the wizard to the relevant step.

### Step 3: Result Review

Show tabs:

- World Bible
- Synopsis
- Script

Use existing `WorldBibleView`, markdown rendering, and `ScriptView` for preview. If any chunk is stale, show a warning near the write button.

The primary action is "confirm and write drafts". After success, show the created draft version ids or links using the existing document/version navigation patterns.

## Backend Implementation Boundaries

Add the novel import session logic to `apps/api/src/jobs/novel-import.service.ts`, but split the service into clear responsibilities:

- `createSession`
- `getLatestSession`
- `getSession`
- `startSessionJob`
- `runSession`
- `retryChunk`
- `rerunFromChunk`
- `cancelSession`
- `writeDrafts`
- `buildPreview`

Keep controller methods thin. Business state changes should live in the service and use `DevDatabaseService.query/mutate`.

When `writeDrafts` creates versions, use `workspaceService.ensureDocumentForProject` and `workspaceService.createVersionForDocument` with `status: "draft"`. Do not call adopt or approve APIs.

## Shared Contract Changes

Update `packages/shared/src/domain.ts` for:

- `JobType` includes `"novel_import"`
- novel import status, stage, chunk status, chunk record, options, write result, and session record

Update `packages/shared/src/api-contracts.ts` for:

- create session payload
- session response types
- start/cancel/retry/write response types

Avoid duplicating domain shapes in the frontend or API. Both sides should import the shared types.

## Testing

Run `npm run lint`, `npm test`, and `npm run build` after implementation.

Focused API tests should cover:

- creating a session saves source text, options, and chunks
- latest-session lookup restores an unfinished session
- start creates a `novel_import` job and updates session state
- failed JSON parsing stores raw output and marks the stage or chunk failed
- retrying one chunk replaces only that chunk and marks following completed chunks stale
- rerunning from a chunk refreshes that chunk and all following chunks
- writing drafts creates only `draft` versions
- repeated write calls return the existing write result and do not duplicate versions

Frontend verification should cover:

- wizard step transitions
- latest session restore on mount
- chunk retry actions
- stale warning display
- final write-drafts action

## Rollout Notes

Keep the existing novel import endpoint until the new wizard is wired and verified, then remove or stop using the old SSE path in a focused cleanup. This avoids breaking the current import mode mid-implementation.

README files do not need updates unless the feature is promoted as user-facing documentation. If either README is changed later, update both `README.md` and `README_ZH.md` together.
