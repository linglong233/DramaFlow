# Conversation Wrapper Height Bridge Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete the conversation-only scroll fix by making the Generate sub-tab wrapper participate in the bounded height chain only when conversational generation is active.

**Architecture:** Keep the existing `gen-root--conversational` mode marker. Add an explicit `uw-generate-panel` class to the Generate sub-tab wrapper and add a scoped CSS bridge rule using `.uw-generate-panel:has(.gen-root--conversational)`.

**Tech Stack:** TypeScript, React 19, Next.js 15 App Router, global CSS in `apps/web/app/globals.css`.

---

## Scope Check

This is a narrow frontend layout correction for an already partially implemented conversation-only scroll fix. It does not change API contracts, provider logic, persistence, worker behavior, session state, conversation streaming, or message rendering.

## File Structure

- Modify: `apps/web/components/unified-workspace.tsx`
  - Responsibility: host the document Generate sub-tab wrapper.
- Modify: `apps/web/app/globals.css`
  - Responsibility: bridge height through the Generate sub-tab wrapper only when it contains `.gen-root--conversational`.
- Review only: `apps/web/components/project-workspace/generation/generator-host.tsx`
  - Responsibility: keep `className={\`gen-root gen-root--${mode}\`}` intact.
- Do not modify:
  - `apps/api/src/jobs/text-generation.provider.ts`
  - `apps/web/components/project-workspace/conversation-chat.tsx`
  - `apps/web/components/project-workspace/generation/conversational-generator.tsx`
  - `packages/shared`

## Current Worktree Warning

The repository currently contains unrelated staged changes and a partially implemented conversation-only scroll fix. Preserve unrelated changes. Do not run broad reset or checkout commands.

---

### Task 1: Confirm The Root Cause State

**Files:**
- Review: `apps/web/components/unified-workspace.tsx`
- Review: `apps/web/app/globals.css`
- Review: `apps/web/components/project-workspace/generation/generator-host.tsx`

- [ ] **Step 1: Inspect relevant diffs**

Run:

```powershell
git status --short --untracked-files=all
git diff -- apps\web\components\unified-workspace.tsx apps\web\app\globals.css apps\web\components\project-workspace\generation\generator-host.tsx
git diff --cached -- apps\web\components\unified-workspace.tsx apps\web\app\globals.css apps\web\components\project-workspace\generation\generator-host.tsx
```

Expected:

- `generator-host.tsx` already has or will get `className={\`gen-root gen-root--${mode}\`}`.
- `globals.css` already has or will get `.gen-root--conversational` scoped rules.
- `unified-workspace.tsx` still has a Generate sub-tab wrapper without `className="uw-generate-panel"`.

- [ ] **Step 2: Inspect the exact wrapper**

Run:

```powershell
$lines = Get-Content -Path "apps\web\components\unified-workspace.tsx" -Encoding utf8
$lines[908..918]
```

Expected current wrapper:

```tsx
{/* Generate sub-tab */}
<div
  style={{ display: mode === "document" && docSubTab === "generate" ? undefined : "none" }}
>
```

---

### Task 2: Add The Generate Wrapper Class

**Files:**
- Modify: `apps/web/components/unified-workspace.tsx`

- [ ] **Step 1: Add `uw-generate-panel` to the wrapper**

Change the Generate sub-tab wrapper opening tag to:

```tsx
{/* Generate sub-tab */}
<div
  className="uw-generate-panel"
  style={{ display: mode === "document" && docSubTab === "generate" ? undefined : "none" }}
>
```

Do not change any child rendering logic inside the wrapper.

- [ ] **Step 2: Verify the TSX diff**

Run:

```powershell
git diff -- apps\web\components\unified-workspace.tsx
```

Expected intended hunk:

```diff
 <div
+  className="uw-generate-panel"
   style={{ display: mode === "document" && docSubTab === "generate" ? undefined : "none" }}
 >
```

If unrelated hunks are already present in the file, preserve them and do not rewrite them.

---

### Task 3: Add The Scoped Wrapper Height Bridge

**Files:**
- Modify: `apps/web/app/globals.css`

- [ ] **Step 1: Locate the conversation-only CSS section**

Run:

```powershell
$lines = Get-Content -Path "apps\web\app\globals.css" -Encoding utf8
$lines[10399..10470]
```

Expected: the section includes:

```css
.uw-center-scroll--fill > .uw-center-inner:has(.gen-root--conversational) {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.uw-center-scroll--fill .gen-root {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}
```

- [ ] **Step 2: Add the wrapper bridge rule**

Insert this block after `.uw-center-scroll--fill > .uw-center-inner:has(.gen-root--conversational)` and before `.uw-center-scroll--fill .gen-root`:

```css
.uw-generate-panel:has(.gen-root--conversational) {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
```

This selector must include `:has(.gen-root--conversational)`. Do not add an unscoped `.uw-generate-panel` height rule.

- [ ] **Step 3: Verify no broad wrapper rule exists**

Run:

```powershell
Select-String -Path "apps\web\app\globals.css" -Pattern "\\.uw-generate-panel"
```

Expected: the only `.uw-generate-panel` rule is:

```css
.uw-generate-panel:has(.gen-root--conversational) {
```

There must not be a rule like:

```css
.uw-center-scroll--fill > .uw-center-inner > .uw-generate-panel {
```

- [ ] **Step 4: Verify no global body/workspace lock was added**

Run:

```powershell
Select-String -Path "apps\web\app\globals.css" -Pattern "html:has\\(.uw-root\\) body|body \\{\\s*overflow: hidden|\\.uw-root \\{"
```

Expected:

- No `html:has(.uw-root) body` rule.
- No global `body` overflow lock.
- The base `.uw-root` selector is not changed to `height: 100dvh` or `height: calc(...)`.
- The scoped `.uw-root:has(.gen-root--conversational)` rule remains the only conversation-specific workspace height rule.

---

### Task 4: Verify The Existing Mode Marker Remains Intact

**Files:**
- Review: `apps/web/components/project-workspace/generation/generator-host.tsx`

- [ ] **Step 1: Inspect `GeneratorHost` root**

Run:

```powershell
$lines = Get-Content -Path "apps\web\components\project-workspace\generation\generator-host.tsx" -Encoding utf8
$lines[32..38]
```

Expected:

```tsx
return (
  <div className={`gen-root gen-root--${mode}`}>
    <div className="gen-mode-bar">
```

If the mode marker is missing, add exactly that root class and do not change any other logic in `generator-host.tsx`.

---

### Task 5: Verification Commands

**Files:**
- Test: `apps/web/components/unified-workspace.tsx`
- Test: `apps/web/app/globals.css`
- Test: `apps/web/components/project-workspace/generation/generator-host.tsx`

- [ ] **Step 1: Run lint**

Run:

```powershell
npm run lint
```

Expected: exit code `0`.

- [ ] **Step 2: Run build**

Run:

```powershell
npm run build
```

Expected: exit code `0`; Next.js web build compiles successfully.

- [ ] **Step 3: Run tests if logic files changed beyond the wrapper class**

If changes are limited to `unified-workspace.tsx`, `globals.css`, and the existing `generator-host.tsx` mode class, this step may be skipped. If any conversation logic or API/provider files were changed, run:

```powershell
npm test
```

Expected: exit code `0`.

- [ ] **Step 4: Check UTF-8 without BOM**

Run:

```powershell
$paths = @(
  "apps\web\components\unified-workspace.tsx",
  "apps\web\app\globals.css",
  "apps\web\components\project-workspace\generation\generator-host.tsx"
)
foreach ($p in $paths) {
  $bytes = [System.IO.File]::ReadAllBytes((Resolve-Path $p))
  $hasBom = $bytes.Length -ge 3 -and $bytes[0] -eq 0xEF -and $bytes[1] -eq 0xBB -and $bytes[2] -eq 0xBF
  "$p`tBOM=$hasBom"
}
```

Expected:

```text
apps\web\components\unified-workspace.tsx	BOM=False
apps\web\app\globals.css	BOM=False
apps\web\components\project-workspace\generation\generator-host.tsx	BOM=False
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

- [ ] **Step 2: Verify the failing conversational case**

Open a project workspace, go to a synopsis or script document, open the Generate sub-tab, switch to conversational mode, and load or create a long conversation.

Expected:

- The browser page height no longer increases with the message count.
- The Generate sub-tab wrapper is bounded because `.uw-generate-panel:has(.gen-root--conversational)` matches.
- `.conv-chat__messages` scrolls internally.
- The chat input stays visible at the bottom of the chat panel.
- The right brief panel scrolls independently when it has enough content.

- [ ] **Step 3: Verify quick generation is not affected**

Switch to quick mode in the same Generate sub-tab.

Expected:

- `.uw-generate-panel:has(.gen-root--conversational)` no longer matches.
- Quick generation keeps the existing center scroll behavior.
- Long output is not clipped by the conversation wrapper bridge.

- [ ] **Step 4: Verify novel import is not affected**

Switch to novel import mode if available for the selected document.

Expected:

- `.uw-generate-panel:has(.gen-root--conversational)` does not match.
- Novel import content remains reachable with its existing scroll behavior.

---

### Task 7: Commit Only When Safe

**Files:**
- Modify: `apps/web/components/unified-workspace.tsx`
- Modify: `apps/web/app/globals.css`
- Possible existing modify: `apps/web/components/project-workspace/generation/generator-host.tsx`

- [ ] **Step 1: Inspect final diffs**

Run:

```powershell
git diff -- apps\web\components\unified-workspace.tsx apps\web\app\globals.css apps\web\components\project-workspace\generation\generator-host.tsx
git diff --cached -- apps\web\components\unified-workspace.tsx apps\web\app\globals.css apps\web\components\project-workspace\generation\generator-host.tsx
```

Expected:

- `unified-workspace.tsx` only adds `className="uw-generate-panel"` to the Generate wrapper.
- `globals.css` only adds the scoped `.uw-generate-panel:has(.gen-root--conversational)` bridge on top of the existing conversation-only scroll rules.
- `generator-host.tsx` only contains the existing mode marker if it was not already committed.
- No API/provider or conversation streaming hunks are included in this implementation commit.

- [ ] **Step 2: Commit only if touched files contain no unrelated staged hunks**

If the touched files contain only these scoped layout hunks, run:

```powershell
git add apps\web\components\unified-workspace.tsx apps\web\app\globals.css apps\web\components\project-workspace\generation\generator-host.tsx
git commit -m "fix(web): bridge conversation generate panel height"
```

If any touched file still contains unrelated staged hunks, do not commit. Report the exact file names and leave changes in the worktree for manual staging.

---

## Self-Review

- Spec coverage: Tasks 2-3 add the missing wrapper bridge and keep it scoped to `.gen-root--conversational`; Task 4 verifies the existing mode marker; Tasks 5-6 cover lint, build, optional tests, encoding, and manual browser behavior.
- Placeholder scan: no unresolved placeholders are present.
- Type consistency: the wrapper class is `uw-generate-panel`; the scoped CSS selector is `.uw-generate-panel:has(.gen-root--conversational)`; the mode marker remains `gen-root--conversational`.
