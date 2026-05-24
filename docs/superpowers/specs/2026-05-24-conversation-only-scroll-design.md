# Conversation-Only Scroll Design

## Background

The previous conversation scroll fix made the chat message list an internal scroll container, but the page can still grow because the outer workspace height chain is not constrained. Reintroducing a global workspace or body height lock would risk affecting document view, edit, versions, quick generation, novel import, and other workspace pages.

The required behavior is narrower: only the conversational generation experience should keep a stable viewport-bounded height and route long message history into the chat message list.

## Goals

- Keep long AI/user conversations from increasing the overall page height.
- Apply the fixed-height behavior only while the active generation mode is conversational.
- Preserve existing scroll behavior for document view, edit, versions, quick generation, novel import, storyboard generation, tasks, timeline, and project info pages.
- Keep the chat input visible at the bottom of the left chat panel.
- Keep the right brief panel independently scrollable.
- Avoid global `body` scroll locking and avoid restoring broad workspace-wide height rules.

## Non-Goals

- No API, provider, persistence, worker, or shared-contract changes.
- No changes to conversation session loading, streaming, or message data.
- No visual redesign of the conversational generator.
- No broad refactor of `UnifiedWorkspace`.
- No global workspace height change that applies outside conversational generation mode.

## Recommended Approach

Add a mode-specific class to `GeneratorHost` so the DOM can distinguish quick, conversational, and novel import generation modes:

```tsx
<div className={`gen-root gen-root--${mode}`}>
```

Then scope all page-height constraints through selectors that only match when `.gen-root--conversational` is present. This keeps the fixed-height chain local to the conversational generation mode while leaving normal workspace scroll containers unchanged for other modes.

## Alternatives Considered

### Option A: Conversation Mode Class + Scoped CSS

`GeneratorHost` exposes the active generation mode through a class. CSS uses `.gen-root--conversational` and parent `:has()` selectors to constrain only the active conversational generator.

Trade-off: depends on modern `:has()` support, which is acceptable for the current browser baseline implied by a modern Next.js application.

### Option B: Lift Generation Mode State Into UnifiedWorkspace

`GeneratorHost` would notify `UnifiedWorkspace` when the active generation mode changes, and `UnifiedWorkspace` would add a class such as `uw-root--conversation-scroll`.

Trade-off: avoids `:has()` but increases component coupling and passes UI layout state upward only for CSS.

### Option C: Use A Fixed `max-height` On The Chat List

The chat list could use a viewport-based `max-height`.

Trade-off: simple but fragile. It would not account cleanly for the existing top bar, mode bars, sub-tabs, or responsive layout.

Option A is the preferred approach because it is small, explicit, and scoped to the exact active mode.

## Components

- `apps/web/components/project-workspace/generation/generator-host.tsx`
  - Add the active generation mode as a modifier class on `.gen-root`.
  - This is the only expected TSX change.
- `apps/web/app/globals.css`
  - Scope fixed-height and overflow rules to `.gen-root--conversational`.
  - Remove or narrow any previous broad generate-tab scroll bridge such as `.uw-generate-panel` if it applies to all generation modes.
- `apps/web/components/unified-workspace.tsx`
  - No new behavior is required.
  - If a previous attempted fix added `className="uw-generate-panel"` only to support broad generate-tab scrolling, remove it or leave it unused only if no CSS depends on it.

## Layout Rules

When `.gen-root--conversational` is present:

- The flush app content should stop growing with chat content and keep overflow inside the workspace.
- `.uw-root` should use the viewport height minus the top bar height, not `100dvh` for the whole page.
- `.uw-center-scroll--fill` and its active inner content should pass bounded height down to `.gen-root--conversational`.
- `.conv-layout`, `.conv-layout__chat`, and `.conv-chat` should pass bounded height down with `min-height: 0`.
- `.conv-chat__messages` should be the vertical scroll container for long conversations.
- `.conv-chat__input-bar` should not shrink.
- `.conv-layout__brief` should keep its own `overflow-y: auto`.

Outside conversational mode:

- `.uw-center-scroll` remains the normal workspace center scroll container.
- Quick generation, novel import, document view, edit, versions, project info, tasks, and timeline should not inherit the conversational fixed-height chain.

## Current Worktree Considerations

The current worktree already contains unrelated staged changes and an earlier broad scroll attempt. The implementation should preserve unrelated staged changes and avoid reverting user work. Any existing broad generate-tab fix must be reviewed and either scoped to `.gen-root--conversational` or removed if it affects all generation modes.

## Data Flow

No data flow changes are introduced. `GeneratorHost` already owns the active generation mode. The new class only exposes that mode to CSS. `ConversationalGenerator` and `ConversationChat` continue to receive messages, streaming state, and send handlers as before.

## Error Handling

No new runtime error path is introduced. Existing API and stream errors continue to render through the current feedback components. CSS-only layout behavior should not affect request cancellation, session switching, or generation completion.

## Responsive Behavior

Desktop keeps the current two-column conversational layout. Mobile keeps the existing single-column conversational layout. In both cases, long conversation history should scroll inside the chat message list without increasing the overall page height. The brief panel remains independently scrollable or naturally placed below the chat according to the existing responsive rules.

## Testing

- Run `npm run lint`.
- Run `npm test` if implementation touches anything beyond CSS and the `GeneratorHost` class.
- Run `npm run build` before final completion because this touches Next.js frontend files.
- Manually verify conversational generation with a long session:
  - The page height stays bounded.
  - The left chat message list scrolls internally.
  - The input stays visible.
  - The right brief panel scrolls independently.
- Manually verify non-conversational pages:
  - Quick generation still scrolls normally when its output is long.
  - Novel import still scrolls normally.
  - Document view, edit, versions, tasks, timeline, and project info are not clipped.
