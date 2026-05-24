# Conversation-Only Scroll Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make long conversations scroll inside the conversational generation chat panel without changing scroll behavior on other DramaFlow pages or other generation modes.

**Architecture:** Expose the active generation mode as a modifier class on `GeneratorHost`, then scope height and overflow rules to `.gen-root--conversational`. Remove or neutralize the earlier broad generate-tab scroll bridge so quick generation, novel import, document view, edit, versions, tasks, timeline, and project info keep their existing scroll behavior.

**Tech Stack:** TypeScript, React 19, Next.js 15 App Router, global CSS in `apps/web/app/globals.css`.

---

## Scope Check

This is a narrow frontend layout fix. It does not change API contracts, provider logic, persistence, worker behavior, session state, or conversation data flow.

## File Structure

- Modify: `apps/web/components/project-workspace/generation/generator-host.tsx`
  - Responsibility: expose the active generation mode through a stable root class.
- Modify: `apps/web/app/globals.css`
  - Responsibility: apply viewport-bounded layout only when `.gen-root--conversational` is present.
- Review only: `apps/web/components/unified-workspace.tsx`
  - Responsibility: host document sub-tab content.
  - If the previous broad fix added `className="uw-generate-panel"`, remove it only if no remaining scoped CSS uses it.
- Do not modify:
  - `apps/api/src/jobs/text-generation.provider.ts`
  - `apps/web/components/project-workspace/conversation-chat.tsx`
  - `apps/web/components/project-workspace/generation/conversational-generator.tsx`
  - `packages/shared`

## Current Worktree Warning

The repository currently has unrelated staged changes and an earlier broad scroll attempt. Before editing, inspect both staged and unstaged diffs. Preserve unrelated changes. Do not run broad reset or checkout commands.

---

### Task 1: Inspect Current Scroll-Related State

**Files:**
- Review: `apps/web/app/globals.css`
- Review: `apps/web/components/unified-workspace.tsx`
- Review: `apps/web/components/project-workspace/generation/generator-host.tsx`

- [ ] **Step 1: Check staged and unstaged state**

Run:

```powershell
git status --short --untracked-files=all
git diff -- apps\web\app\globals.css apps\web\components\unified-workspace.tsx apps\web\components\project-workspace\generation\generator-host.tsx
git diff --cached -- apps\web\app\globals.css apps\web\components\unified-workspace.tsx apps\web\components\project-workspace\generation\generator-host.tsx
```

Expected:

- `apps/web/app/globals.css` may have staged and unstaged changes.
- `apps/web/components/unified-workspace.tsx` may have staged and unstaged changes.
- `apps/web/components/project-workspace/generation/generator-host.tsx` should be unchanged before this task unless another process already implemented the mode class.

- [ ] **Step 2: Locate broad generate-tab scroll hooks**

Run:

```powershell
Select-String -Path "apps\web\app\globals.css","apps\web\components\unified-workspace.tsx" -Pattern "uw-generate-panel|uw-center-scroll--fill > .uw-center-inner > .uw-generate-panel"
```

Expected:

- If `uw-generate-panel` exists, treat it as part of the previous broad generate-tab attempt.
- This plan replaces broad generate-tab targeting with conversation-mode targeting.

---

### Task 2: Expose The Active Generation Mode

**Files:**
- Modify: `apps/web/components/project-workspace/generation/generator-host.tsx`

- [ ] **Step 1: Inspect the current root element**

Run:

```powershell
$lines = Get-Content -Path "apps\web\components\project-workspace\generation\generator-host.tsx" -Encoding utf8
$lines[25..42]
```

Expected current root:

```tsx
return (
  <div className="gen-root">
    <div className="gen-mode-bar">
```

- [ ] **Step 2: Add the mode modifier class**

Change only the root `div` opening tag to:

```tsx
return (
  <div className={`gen-root gen-root--${mode}`}>
    <div className="gen-mode-bar">
```

Do not change generation mode state, mode switching, provider source switching, or rendered generator branches.

- [ ] **Step 3: Verify the diff**

Run:

```powershell
git diff -- apps\web\components\project-workspace\generation\generator-host.tsx
```

Expected: one hunk changing `className="gen-root"` to ``className={`gen-root gen-root--${mode}`}``.

---

### Task 3: Remove Broad Generate-Tab Targeting

**Files:**
- Modify: `apps/web/components/unified-workspace.tsx`
- Modify: `apps/web/app/globals.css`

- [ ] **Step 1: Remove the broad wrapper class if present**

If `apps/web/components/unified-workspace.tsx` contains:

```tsx
<div
  className="uw-generate-panel"
  style={{ display: mode === "document" && docSubTab === "generate" ? undefined : "none" }}
>
```

replace it with:

```tsx
<div style={{ display: mode === "document" && docSubTab === "generate" ? undefined : "none" }}>
```

If the file already has the one-line wrapper, leave it unchanged.

- [ ] **Step 2: Remove the broad CSS bridge if present**

If `apps/web/app/globals.css` contains this block:

```css
/* 生成面板参与 flex 高度链 */
.uw-center-scroll--fill > .uw-center-inner > .uw-generate-panel {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}
```

remove the whole block. This selector applies to every generation mode and is not scoped tightly enough.

- [ ] **Step 3: Verify broad targeting is gone**

Run:

```powershell
Select-String -Path "apps\web\app\globals.css","apps\web\components\unified-workspace.tsx" -Pattern "uw-generate-panel"
```

Expected: no matches.

---

### Task 4: Add Conversation-Only Height And Scroll Rules

**Files:**
- Modify: `apps/web/app/globals.css`

- [ ] **Step 1: Inspect existing workspace and conversation CSS**

Run:

```powershell
$lines = Get-Content -Path "apps\web\app\globals.css" -Encoding utf8
$lines[690..720]
$lines[7358..7570]
$lines[10390..10570]
```

Expected:

- `.app-main` uses `min-height: 100vh`.
- `.app-content--flush` is a flex column container.
- `.uw-root` is the workspace root.
- `.uw-center-scroll--fill`, `.gen-root`, `.conv-root`, `.conv-layout`, `.conv-chat`, and `.conv-chat__messages` exist.

- [ ] **Step 2: Add scoped parent constraints**

Place this block near the generate/conversation CSS section, after `.uw-center-scroll--fill > .uw-center-inner` and before `.uw-center-scroll--fill .gen-root`:

```css
.app-content--flush:has(.gen-root--conversational) {
  min-height: 0;
  overflow: hidden;
}

.uw-root:has(.gen-root--conversational) {
  height: calc(100dvh - var(--topbar-height));
  min-height: 0;
  overflow: hidden;
}

.uw-center-scroll--fill:has(.gen-root--conversational) {
  overflow: hidden;
}

.uw-center-scroll--fill > .uw-center-inner:has(.gen-root--conversational) {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
```

Do not add `html:has(.uw-root) body { overflow: hidden; }`. Do not change `.uw-root` globally.

- [ ] **Step 3: Add scoped generator and chat constraints**

Add this block after the existing `.uw-center-scroll--fill .gen-root` block:

```css
.uw-center-scroll--fill .gen-root--conversational {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

.gen-root--conversational .conv-root,
.gen-root--conversational .conv-layout,
.gen-root--conversational .conv-layout__chat,
.gen-root--conversational .conv-chat {
  min-height: 0;
}

.gen-root--conversational .conv-layout {
  overflow: hidden;
}

.gen-root--conversational .conv-chat__messages {
  min-height: 0;
  overflow-y: auto;
  overscroll-behavior: contain;
}

.gen-root--conversational .conv-chat__input-bar {
  flex-shrink: 0;
}
```

This may duplicate some properties already present on base `.conv-*` selectors. That is acceptable only if the scoped rule is the source of the behavior. If a previous broad attempt already added these properties to base selectors, either leave harmless base properties that do not affect other layouts, or move them into scoped selectors if they are part of the page-height behavior.

- [ ] **Step 4: Keep the brief panel independently scrollable**

Confirm this existing selector remains present:

```css
.conv-layout__brief {
  overflow-y: auto;
  min-height: 0;
}
```

If other properties are present in the selector, keep them.

- [ ] **Step 5: Verify no broad workspace lock was added**

Run:

```powershell
Select-String -Path "apps\web\app\globals.css" -Pattern "html:has\\(.uw-root\\) body|body \\{\\s*overflow: hidden|\\.uw-root \\{"
```

Expected:

- No `html:has(.uw-root) body` rule.
- No global `body` overflow lock.
- `.uw-root` base selector is not changed to `height: 100dvh` or `height: calc(...)`; the scoped `.uw-root:has(.gen-root--conversational)` selector owns the conversation-only height.

---

### Task 5: Verify Type Safety And Layout Scope

**Files:**
- Test: `apps/web/components/project-workspace/generation/generator-host.tsx`
- Test: `apps/web/app/globals.css`

- [ ] **Step 1: Run lint**

Run:

```powershell
npm run lint
```

Expected: exit code `0`.

- [ ] **Step 2: Run tests**

Run:

```powershell
npm test
```

Expected: exit code `0`. If failures are unrelated to the layout change, capture the failing test names and inspect the current staged diff before editing.

- [ ] **Step 3: Run build**

Run:

```powershell
npm run build
```

Expected: exit code `0`; Next.js web build compiles successfully.

- [ ] **Step 4: Check UTF-8 without BOM for touched files**

Run:

```powershell
$paths = @(
  "apps\web\components\project-workspace\generation\generator-host.tsx",
  "apps\web\app\globals.css"
)
foreach ($p in $paths) {
  $bytes = [System.IO.File]::ReadAllBytes((Resolve-Path $p))
  $hasBom = $bytes.Length -ge 3 -and $bytes[0] -eq 0xEF -and $bytes[1] -eq 0xBB -and $bytes[2] -eq 0xBF
  "$p`tBOM=$hasBom"
}
```

Expected:

```text
apps\web\components\project-workspace\generation\generator-host.tsx	BOM=False
apps\web\app\globals.css	BOM=False
```

---

### Task 6: Manual Browser Verification

**Files:**
- Test: browser behavior

- [ ] **Step 1: Start the web app**

Run:

```powershell
npm run dev:web
```

Expected: Next.js prints a local URL, usually `http://localhost:3000`. If another port is used, open the printed URL.

- [ ] **Step 2: Verify conversational generation**

Open a project workspace, go to a synopsis or script document, open the Generate sub-tab, switch to conversational mode, and load or create a long conversation.

Expected:

- The browser page height does not increase with the message count.
- The left chat card remains inside the workspace.
- `.conv-chat__messages` scrolls internally.
- The chat input stays visible at the bottom of the chat panel.
- The right brief panel scrolls independently when it has enough content.

- [ ] **Step 3: Verify quick generation is not affected**

In the same Generate sub-tab, switch to quick mode and use or simulate long output.

Expected:

- Quick generation does not inherit the conversation-only fixed-height chain.
- Existing workspace center scrolling still works.
- Output is not clipped by the conversation chat constraints.

- [ ] **Step 4: Verify novel import is not affected**

For synopsis or script generation, switch to novel import mode if available and inspect a long setup/review/progress view.

Expected:

- Novel import content scrolls according to its existing layout.
- It is not clipped by conversation-only rules.

- [ ] **Step 5: Verify non-generate workspace tabs**

Open document view, edit, versions, project info, tasks, and timeline pages where available.

Expected:

- Long content remains reachable.
- No page is clipped because of conversation-only rules.

---

### Task 7: Commit Only The Scoped Implementation When Safe

**Files:**
- Modify: `apps/web/components/project-workspace/generation/generator-host.tsx`
- Modify: `apps/web/app/globals.css`
- Possible cleanup: `apps/web/components/unified-workspace.tsx`

- [ ] **Step 1: Inspect final diff**

Run:

```powershell
git diff -- apps\web\components\project-workspace\generation\generator-host.tsx apps\web\app\globals.css apps\web\components\unified-workspace.tsx
git diff --cached -- apps\web\components\project-workspace\generation\generator-host.tsx apps\web\app\globals.css apps\web\components\unified-workspace.tsx
```

Expected:

- `generator-host.tsx` only adds the mode class.
- `globals.css` only adds conversation-scoped height/overflow selectors and removes broad `uw-generate-panel` targeting if present.
- `unified-workspace.tsx` only removes the broad `uw-generate-panel` class if it was part of the previous attempt.
- No unrelated API or conversation streaming logic changes are included in this implementation commit.

- [ ] **Step 2: Commit only if touched files do not contain unrelated staged hunks**

If the touched files contain only the scoped implementation hunks, run:

```powershell
git add apps\web\components\project-workspace\generation\generator-host.tsx apps\web\app\globals.css apps\web\components\unified-workspace.tsx
git commit -m "fix(web): scope conversation chat scrolling"
```

If any touched file still contains unrelated staged hunks, do not commit. Report the file names and leave the changes in the worktree for manual staging.

---

## Self-Review

- Spec coverage: Tasks 2-4 implement mode-specific classing, scoped height constraints, internal chat scrolling, and cleanup of broad generate-tab targeting. Tasks 5-6 cover lint, tests, build, encoding, conversational behavior, and non-conversational regression checks.
- Placeholder scan: no unresolved placeholders are present.
- Type consistency: the only new class name is `gen-root--${mode}`, with `gen-root--conversational` as the CSS trigger. This matches the existing `GenerationMode` union value `conversational`.
