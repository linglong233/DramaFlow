# Media Current Usage Semantics Design

## Context

The shot detail media workflow currently exposes two user-facing actions for generated media candidates:

- `Select` updates the storyboard draft `mediaBindings` for one shot.
- `Adopt` updates the media document `currentVersionId`.
- The UI label `Current` is ambiguous because preview resolution prefers shot media bindings, then document current version, then draft version.

This makes users unsure whether a candidate is merely previewed, used by the shot, or adopted as a document baseline.

## Decision

In shot production surfaces, the primary concept is the media version used by the shot. Version baseline management remains available, but it is not the main action.

Use these terms:

- `Candidate`: a media version that exists but is not the effective media for the shot.
- `Use for this shot`: primary action that writes the media version into the shot's storyboard draft binding.
- `In use`: status for the media version that is effectively used by this shot's preview, video reference, and assembly flow.
- `Adopt as baseline`: secondary document-level action that updates the media document's current version.

Chinese labels:

- `候选`
- `设为当前使用`
- `当前使用`
- `采纳为基线`
- `已设为当前使用`

English labels:

- `Candidate`
- `Use for this shot`
- `In use`
- `Adopt as baseline`
- `Set for this shot`

## Scope

Update the shot media candidate UX without changing backend behavior.

Frontend changes:

- `CandidateThumbnailGrid` must stop hardcoding `Select` and `Adopt`; all visible labels must use i18n.
- `CandidateLightbox` must use the same terminology as the thumbnail grid.
- `ShotDetailModal` preview and candidate areas must refer to the effective bound media as `当前使用`, not `已采纳`.
- Feedback after media binding should say the media was set as the current shot use.
- Existing document version adoption remains available as a secondary action labeled `采纳为基线`.

Backend changes:

- No backend behavior change is required for this step.
- `PATCH /versions/:id/media-binding` remains the API for setting shot media use.
- `POST /documents/:id/adopt-version` remains the API for adopting a document baseline.

Out of scope:

- Merging `Select` and `Adopt` into one backend operation.
- Changing version approval rules.
- Changing media binding persistence shape.
- Redesigning the full task panel or storyboard workbench.

## Interaction Rules

For each image or video candidate:

1. If the candidate is the effective media version for the shot, show `当前使用` and disable the primary action.
2. If the candidate is not currently used by the shot, show the primary action `设为当前使用`.
3. Show `采纳为基线` as a secondary action only when the user can mutate the project and the candidate belongs to a media document.
4. If a version is both currently used by the shot and the document baseline, still prefer the visible status `当前使用` in shot production surfaces.
5. Document-level version panels may continue to use baseline language such as `采纳为基线`.

## Data Flow

The effective media version for a shot is resolved in the storyboard workbench from:

1. `storyboard.content.mediaBindings[shotId].<mediaType>VersionId`
2. media document `currentVersionId`
3. media document `draftVersionId`

The UI should compare candidates against this effective version ID, not only the document `currentVersionId`, when deciding whether to show `当前使用`.

When the user clicks `设为当前使用`:

1. Call `PATCH /versions/:storyboardDraftVersionId/media-binding`.
2. Optimistically update local `mediaBindings`.
3. Invalidate workspace data.
4. Show a success message that says the media is now used by the shot.

When the user clicks `采纳为基线`:

1. Call `POST /documents/:documentId/adopt-version`.
2. Invalidate workspace data.
3. Show a baseline-specific success message.

## Error Handling

- If no storyboard draft version exists, keep the current error path and do not expose a broken primary action.
- If setting current use fails, roll back optimistic binding state.
- If baseline adoption fails, keep it isolated from shot media binding state.
- Disabled states must distinguish pending media binding from pending baseline adoption when practical.

## Testing

Minimum verification:

- Run `npm run lint`.
- Run `npm test` if shared types or API behavior change.

Focused manual checks:

- Image candidate grid uses Chinese labels in Chinese UI and no hardcoded `Select` or `Adopt`.
- Lightbox labels match the thumbnail grid.
- Clicking `设为当前使用` changes the preview media for the shot.
- Clicking `采纳为基线` does not break the currently bound media.
- A candidate bound through `mediaBindings` is marked `当前使用` even if it is not the document `currentVersionId`.
