# Conversation Scroll Design

## Background

The conversational generation view can grow with the number of AI and user messages. The desired behavior is for the page and workspace layout to keep a stable height while only the left chat message area scrolls.

## Goals

- Keep the document generation page from expanding as conversation content grows.
- Keep the chat input pinned at the bottom of the left chat panel.
- Make the AI/user message list scroll inside the chat panel.
- Preserve the existing right-side brief panel behavior, including its own internal scrolling.
- Avoid API, persistence, session state, or streaming logic changes.

## Non-Goals

- No change to conversation data contracts.
- No change to the conversation generation API.
- No redesign of the conversational generation UI.
- No replacement of the existing workspace layout.

## Recommended Approach

Use the existing CSS layout chain and make the active generate tab content fill the available center-column height. The wrapper around `GeneratorHost`, `.gen-root`, `.conv-root`, `.conv-layout`, `.conv-layout__chat`, and `.conv-chat` should pass height down with flex/grid sizing and `min-height: 0`. The actual scroll container remains `.conv-chat__messages`.

This keeps the change small and aligned with the current `uw-*`, `gen-*`, and `conv-*` CSS structure.

## Components

- `apps/web/components/unified-workspace.tsx`
  - No behavioral change is expected.
  - Its generate-tab content wrapper may need a class or style-compatible selector if CSS cannot target it cleanly.
- `apps/web/components/project-workspace/generation/conversational-generator.tsx`
  - No state or request logic change is expected.
- `apps/web/components/project-workspace/conversation-chat.tsx`
  - No message rendering change is expected.
- `apps/web/app/globals.css`
  - Primary change location.
  - Ensure the generate tab height chain is stable and `.conv-chat__messages` is the only chat scroll region.

## Data Flow

Conversation messages continue to flow through the existing state in `ConversationalGenerator` and render through `ConversationChat`. Streaming text still updates the same message list. The layout change only affects where overflow is handled in the browser.

## Error Handling

No new runtime error path is introduced. Existing message send and generation errors continue to render through the current feedback notices. Layout-only CSS changes should not alter request cancellation, failed streams, or session loading behavior.

## Responsive Behavior

Desktop keeps the two-column conversational layout. Mobile keeps the existing single-column layout, but the chat area should still scroll internally instead of increasing the whole page height. The existing right-side brief panel can remain below the chat in the mobile flow.

## Testing

- Run `npm run lint` after implementation.
- Verify manually that a long conversation scrolls inside the left chat message area.
- Verify the chat input stays visible at the bottom of the chat panel.
- Verify the workspace page height does not grow with additional messages.
- Verify the right brief panel still scrolls when its content is long.
