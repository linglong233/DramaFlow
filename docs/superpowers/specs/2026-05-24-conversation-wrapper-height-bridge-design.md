# Conversation Wrapper Height Bridge Design

## Background

The conversation-only scroll implementation added `gen-root--conversational` and scoped CSS rules. The chat still grows the page because the direct Generate sub-tab wrapper in `UnifiedWorkspace` is not part of the bounded flex height chain.

Current structure:

```tsx
<div className="uw-center-scroll uw-center-scroll--fill">
  <div className="uw-center-inner">
    <div style={{ display: mode === "document" && docSubTab === "generate" ? undefined : "none" }}>
      <GeneratorHost />
    </div>
  </div>
</div>
```

The CSS constrains `.uw-center-inner:has(.gen-root--conversational)` and `.gen-root--conversational`, but the anonymous wrapper between them remains content-sized. That wrapper can still expand to fit the conversation content, so the page keeps growing.

## Goals

- Add the missing height bridge for the active Generate sub-tab wrapper.
- Keep the bridge scoped to conversational mode only.
- Keep quick generation, novel import, document view, edit, versions, project info, tasks, and timeline unaffected.
- Preserve the existing `gen-root--conversational` mode class and scoped conversation scroll rules.
- Avoid global `body` scroll locking and avoid broad workspace-wide height changes.

## Non-Goals

- No API, provider, persistence, worker, or shared-contract changes.
- No changes to conversation message rendering, streaming behavior, session loading, or generation logic.
- No redesign of the generator UI.
- No broad `.uw-generate-panel` rule that applies to every generation mode.

## Recommended Approach

Give the Generate sub-tab wrapper an explicit class and scope the bridge with `:has(.gen-root--conversational)`:

```tsx
<div
  className="uw-generate-panel"
  style={{ display: mode === "document" && docSubTab === "generate" ? undefined : "none" }}
>
```

```css
.uw-generate-panel:has(.gen-root--conversational) {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
```

This makes the previously anonymous wrapper participate in the height chain only when conversational generation is active. The existing inline `display: none` still hides inactive tabs. Quick generation and novel import do not match `:has(.gen-root--conversational)`, so they keep normal generate-tab behavior.

## Alternatives Considered

### Option A: Explicit Wrapper Class + Scoped `:has()`

Add `uw-generate-panel` to the wrapper and constrain only when it contains `.gen-root--conversational`.

Trade-off: one TSX line plus CSS. The result is readable and avoids brittle anonymous `div` targeting.

### Option B: Anonymous Direct Child Selector

Use:

```css
.uw-center-scroll--fill > .uw-center-inner > div:has(.gen-root--conversational) {
  ...
}
```

Trade-off: no TSX change, but the selector depends on the current child `div` structure and is harder to maintain.

### Option C: Restore Broad `.uw-generate-panel` Flex Rule

Use:

```css
.uw-center-scroll--fill > .uw-center-inner > .uw-generate-panel {
  ...
}
```

Trade-off: this affects every generation mode and can clip quick generation or novel import. It does not satisfy the requirement.

Option A is preferred because it is explicit and scoped to the failing conversational path.

## Components

- `apps/web/components/unified-workspace.tsx`
  - Add `className="uw-generate-panel"` to the Generate sub-tab wrapper.
  - Do not change routing, mode selection, document selection, or rendered generator branches.
- `apps/web/app/globals.css`
  - Add a scoped bridge rule for `.uw-generate-panel:has(.gen-root--conversational)`.
  - Ensure no unscoped `.uw-generate-panel` height rule exists.
- `apps/web/components/project-workspace/generation/generator-host.tsx`
  - Keep `className={\`gen-root gen-root--${mode}\`}`.
  - No additional changes expected.

## Layout Contract

When conversational generation is active:

1. `GeneratorHost` renders `.gen-root--conversational`.
2. `.uw-center-inner:has(.gen-root--conversational)` becomes a bounded flex column.
3. `.uw-generate-panel:has(.gen-root--conversational)` becomes a bounded flex column.
4. `.gen-root--conversational` and its conversation descendants receive `min-height: 0`.
5. `.conv-chat__messages` scrolls internally and the input bar stays visible.

When any other generation mode is active:

- `.uw-generate-panel` does not match the conversational selector.
- The Generate tab keeps normal center scrolling behavior.

## Current Worktree Considerations

The current worktree contains unrelated staged changes and the partially implemented conversation-only scroll fix. The implementation should preserve unrelated changes and only add the missing wrapper bridge. Do not revert API/provider changes or conversation streaming changes unless separately requested.

## Testing

- Run `npm run lint`.
- Run `npm run build` because this touches Next.js TSX and global CSS.
- Run `npm test` if the implementation touches anything beyond `unified-workspace.tsx` and `globals.css`.
- Manually verify long conversational sessions no longer increase browser page height.
- Manually verify quick generation and novel import are not clipped.
- Check touched files remain UTF-8 without BOM.
