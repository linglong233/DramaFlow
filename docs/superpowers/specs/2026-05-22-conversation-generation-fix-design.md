# Conversation Generation Fix Design

## Context

DramaFlow already has a conversational generation mode for synopsis and script creation. The current implementation is present across shared contracts, the NestJS jobs module, the text provider, and the Next.js generation UI, but the runtime flow has several broken seams:

- The conversation SSE response sends final session state without `type: "done"`, so the web client ignores `sessionId`, brief updates, and dimension status.
- The API appends the user message after loading the session, then streams with the stale session object, so the LLM may not see the latest user message.
- Conversation endpoints do not consistently validate project permissions or verify that a session belongs to the requested project.
- Manual brief edits and dimension focus clicks are handled locally in the UI but are not persisted or sent as effective API inputs.
- The generation prompt advertises conversation history but only uses extracted brief and world bible context.
- The synopsis-to-script handoff button does not start script generation.

The fix should stabilize this existing feature without replacing the current DevDatabase runtime, worker polling model, or quick generation flow.

## Goals

- Make conversational QA sessions continuous and stateful across messages.
- Ensure every conversation SSE final event is shaped consistently for the existing `apiStreamFetch` client.
- Preserve and use user-authored brief edits during generation.
- Support focused dimension discussion through the existing `focusDimension` contract.
- Make generation use the latest brief, conversation history, and world bible context.
- Ensure generated synopsis/script versions are saved from provider output reliably.
- Enforce project permission boundaries on all conversation operations.
- Add focused tests for the conversation runtime behavior.

## Non-Goals

- Do not migrate conversation generation to Prisma.
- Do not introduce Redis, BullMQ, or a new queue for this fix.
- Do not redesign the generation page UI.
- Do not rewrite quick generation, novel import, media generation, or worker processing.
- Do not make a broad provider abstraction change beyond what is needed for conversation result handling.

## Architecture

The existing module boundaries remain:

- `packages/shared/src/api-contracts.ts` defines request/response shapes for conversation message and generation payloads.
- `apps/api/src/jobs/jobs.controller.ts` owns HTTP/SSE protocol concerns.
- `apps/api/src/jobs/conversation.service.ts` owns session state, brief/dimension updates, prompt construction, and project/session validation helpers.
- `apps/api/src/jobs/text-generation.provider.ts` continues to stream model chunks and structured/plain results.
- `apps/web/components/project-workspace/generation/conversational-generator.tsx` owns conversation UI state and API calls.
- `ConversationChat`, `ConversationBrief`, and `DimensionTracker` stay presentational.

The fix should make conversation endpoints follow the same event convention used by the working quick generation streams: incremental chunks use `type: "chunk"`, errors use `type: "error"`, and final structured state uses `type: "done"` with a `result` object.

## API Contract Changes

`ConversationMessagePayload` should continue to support:

- `sessionId?: string`
- `content: string`
- `targetDocType: "synopsis" | "script"`
- `focusDimension?: ConversationDimension`
- `llmConfigSource?: LlmConfigSource`

`ConversationGeneratePayload` should be extended to include:

- `sessionId: string`
- `targetDocType: "synopsis" | "script"`
- `brief?: ConversationBrief`
- `llmConfigSource?: LlmConfigSource`

The message SSE final event should be:

```ts
{
  type: "done",
  result: {
    sessionId: string;
    message: ConversationMessage;
    brief: ConversationBrief;
    dimensionStatus: Record<ConversationDimension, ConversationDimensionStatus>;
  };
}
```

The generation SSE final event should remain:

```ts
{
  type: "done",
  result: {
    documentId: string;
    versionId: string;
    content: unknown;
  };
}
```

## Message Flow

When the web client sends a message:

1. It sends the current `sessionId`, user `content`, `targetDocType`, selected `llmConfigSource`, and any pending `focusDimension`.
2. The API verifies the user has `project.view` on the URL project.
3. The API creates a new session or loads the existing session, ensuring it belongs to the URL project.
4. The API appends the user message.
5. The API reloads or constructs an updated session that includes the appended message.
6. `ConversationService` builds a QA system prompt with current dimension status, brief, world bible context, and the requested focus dimension.
7. The text provider streams model chunks.
8. The API parses the accumulated QA JSON, appends the natural AI reply to the session, updates brief and dimension status, then sends a final `done.result`.

The frontend updates state only from the final `done.result` for `sessionId`, brief, dimension status, and persisted AI message. It should not depend on client-side parsing of the streamed JSON to recover core state.

## Brief Editing Flow

The right-side brief panel remains locally editable while the user is shaping the story. When the user clicks generate, the current brief state is sent in `ConversationGeneratePayload.brief`.

The API merges the provided brief into the session before generating. Empty strings should be treated conservatively: the implementation should preserve intentional non-empty edits and avoid replacing useful existing fields with accidental empty values unless the UI explicitly sends a clear field action. For this fix, filtering empty strings out before merging is sufficient.

Dimension status should be recalculated or advanced only for non-empty brief fields. This keeps the "at least 3 confirmed dimensions" gate aligned with data that will actually reach the generator.

## Dimension Focus Flow

Clicking a dimension tag should not add a fake AI message by itself. Instead, the frontend records that dimension as pending focus. The next user message includes `focusDimension`.

The backend uses `focusDimension` to bias the QA prompt toward that dimension if it is not already confirmed. If the AI returns a non-empty brief update for that dimension, the status advances to `confirmed`. If the dimension is active but no update is extracted, the status can remain `pending` or move to `discussing`; the implementation should avoid marking it `confirmed` without extracted content.

## Generation Flow

When generating:

1. The web client requires a valid `sessionId`.
2. The API verifies `project.edit` for the URL project.
3. The API loads the session and verifies it belongs to the URL project.
4. The API merges any manual brief edits from the payload.
5. The target document type comes from the payload so a synopsis conversation can trigger script generation without losing the session history.
6. `ConversationService.buildGenerationPrompt` includes:
   - structured brief fields,
   - conversation history,
   - world bible context when present,
   - output instructions for either synopsis or script.
7. The provider streams chunks.
8. The API prefers the provider's final structured `done.result` when available. It falls back to accumulated text only when there is no usable result.
9. Script output is normalized with `normalizeScriptContent`; synopsis output remains text.
10. The API saves an approved version with metadata `{ source: "conversational", conversationSessionId }`.
11. The final SSE event returns `documentId`, `versionId`, and saved `content`.

After success, the frontend invalidates project and version caches so the newly saved document version is visible without a page refresh.

## Synopsis to Script Flow

The "Confirm & Generate Script" action in synopsis mode should start script generation from the same session, brief, and messages. It should not only clear the generated result panel.

This can be implemented by calling the same generation mutation with a target override of `"script"`. The existing conversation session remains the shared source of truth.

## Permissions

All conversation endpoints must verify permissions through `WorkspaceService.assertProjectPermission`:

- Send message: `project.view`
- Get session: `project.view`
- Generate document: `project.edit`
- Delete session: `project.edit`

Every session lookup used by a project route must verify that `session.projectId === projectId`. If it does not match, the API should return a not-found style error so other project data is not exposed.

Session ownership alone is not the access rule. Project permissions are authoritative, which keeps collaboration behavior consistent with the rest of DramaFlow.

## Dev Database Compatibility

`DevDatabaseService.normalize` should include `conversationSessions` in its array field normalization. This ensures older `dev-db.json` files created before the conversation feature can be read without crashing on `undefined.find`.

The repository-wide UTF-8 without BOM requirement remains unchanged.

## Error Handling

- Provider errors should continue to stream `{ type: "error", error }`.
- If QA JSON parsing fails, the API may append the raw accumulated text as the AI message, but it should not update brief or confirm dimensions.
- If generation produces no usable final result and mock fallback is disabled, the endpoint should stream an error instead of saving empty content.
- If a session is missing or belongs to another project, return `NotFoundException`.
- If permission is insufficient, return `ForbiddenException`.
- The frontend should keep using `conversation.messageFailed` and `conversation.generateFailed` for user-facing errors.

## Testing

Tests should follow the current repository pattern, primarily using API package TypeScript scripts and provider tests.

Required coverage:

- A conversation message stream emits final `type: "done"` with `result.sessionId`.
- A second message with the same `sessionId` reuses the existing session.
- The LLM context includes the user message that was just sent.
- AI `briefUpdates` persist to session brief and advance dimension status.
- Manual brief in the generate payload is merged into the generation prompt.
- Script generation saves normalized content from provider `done.result`.
- Unauthorized users cannot read, delete, or generate from sessions outside their project permissions.
- Old database data without `conversationSessions` normalizes safely.

Verification commands:

```bash
npm run lint
npm test
npm run build
```

## Rollout

This is a focused runtime fix. It can be delivered as one implementation pass because all changes are bounded to the existing conversation feature and its tests.

After implementation, manually verify:

- First user message creates a session and saves the session id in the UI.
- Second user message continues the same conversation.
- Brief fields update after AI extraction.
- Manual brief edits affect generation output.
- Synopsis generation saves a version and updates the workspace without refresh.
- "Confirm & Generate Script" creates a script version from the same conversation context.
