# Enhanced Reference Image Generation v2 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Upgrade world-bible reference image generation with multi-candidate comparison, iterative refinement (img2img), LLM prompt enhancement, and a wider dual-panel dialog.

**Architecture:** Frontend orchestrates multiple parallel single-image API calls. Backend provides atomic operations: enhance prompt via LLM, generate single image (txt2img or img2img). New dual-panel dialog (960px) replaces the old 480px single-panel dialog.

**Tech Stack:** TypeScript, NestJS 11, Next.js 15 (React 19), TanStack React Query, Tailwind CSS, shared types via `@dramaflow/shared`

---

## File Structure

| File | Responsibility |
|------|---------------|
| `packages/shared/src/api-contracts.ts` | New `EnhanceReferencePromptRequest/Response`; extend `WorldBibleReferenceImageGenerateRequest/Response` |
| `apps/api/src/jobs/jobs.controller.ts` | New `enhanceReferencePrompt` endpoint; extend 3 existing endpoints |
| `apps/api/src/jobs/jobs.service.ts` | New `enhanceReferencePrompt()`; extend `generateImageFromPrompt()` and `generateWorldBibleReferenceImage()` |
| `apps/api/src/jobs/google-gemini-image.provider.ts` | Add img2img support via `referenceImageBuffer` param |
| `apps/api/src/jobs/sd-webui-image.provider.ts` | Add img2img path via `/sdapi/v1/img2img` |
| `apps/api/src/jobs/comfyui-image.provider.ts` | Add img2img support via workflow input node |
| `apps/api/src/jobs/media-generation.provider.ts` | Add fallback: append reference description to prompt |
| `apps/api/src/jobs/grok-media.provider.ts` | Add fallback: append reference description to prompt |
| `apps/web/components/project-workspace/world-bible-reference-image-dialog.tsx` | Full rewrite: dual-panel enhanced dialog with state machine |
| `apps/web/components/project-workspace/world-bible-editor.tsx` | Expand prompt builders; update dialog props |
| `apps/web/app/globals.css` | Add CSS for new dialog layout, image grid, skeleton |

---

### Task 1: Shared Types — Extend API Contracts

**Files:**
- Modify: `packages/shared/src/api-contracts.ts:451-461`

- [ ] **Step 1: Add `EnhanceReferencePromptRequest` and `EnhanceReferencePromptResponse`**

At the end of the file (or near the existing world-bible types around line 461), add:

```typescript
export interface EnhanceReferencePromptRequest {
  prompt: string;
  type: "character" | "location" | "styleGuide";
  configSource?: ImageConfigSource;
  providerId?: string;
}

export interface EnhanceReferencePromptResponse {
  enhancedPrompt: string;
  originalPrompt: string;
}
```

- [ ] **Step 2: Extend `WorldBibleReferenceImageGenerateRequest` (line 451)**

Add `referenceImageAssetId` and `negativePrompt` fields:

```typescript
export interface WorldBibleReferenceImageGenerateRequest {
  prompt: string;
  configSource?: ImageConfigSource;
  providerId?: string;
  referenceImageAssetId?: string;
  negativePrompt?: string;
}
```

- [ ] **Step 3: Extend `WorldBibleReferenceImageGenerateResponse` (line 459)**

Add `assetId` and `prompt` fields:

```typescript
export interface WorldBibleReferenceImageGenerateResponse {
  assetUrl: string;
  assetId: string;
  prompt: string;
}
```

- [ ] **Step 4: Commit**

```bash
git add packages/shared/src/api-contracts.ts
git commit -m "feat(shared): extend ref-image types for v2 (enhance, img2img, negativePrompt)"
```

---

### Task 2: Backend — Prompt Enhancement Endpoint

**Files:**
- Modify: `apps/api/src/jobs/jobs.controller.ts:82`
- Modify: `apps/api/src/jobs/jobs.service.ts:834`

- [ ] **Step 1: Add `enhanceReferencePrompt` method to `JobsService`**

In `apps/api/src/jobs/jobs.service.ts`, add a new method before `generateImageFromPrompt` (around line 834):

```typescript
async enhanceReferencePrompt(
  userId: string,
  projectId: string,
  prompt: string,
  type: "character" | "location" | "styleGuide",
  configSource: ImageConfigSource = "team",
  providerId?: string,
): Promise<EnhanceReferencePromptResponse> {
  const originalPrompt = prompt;
  const typeInstructions: Record<string, string> = {
    character:
      "You are an expert at writing image generation prompts for character portraits. Enhance the following description into a detailed, professional image generation prompt. Focus on: facial features, hair, body type, clothing, pose, expression, and artistic style. Output ONLY the enhanced prompt, no explanation.",
    location:
      "You are an expert at writing image generation prompts for scenic environments. Enhance the following description into a detailed, professional image generation prompt. Focus on: atmosphere, lighting, perspective, weather, time of day, and architectural details. Output ONLY the enhanced prompt, no explanation.",
    styleGuide:
      "You are an expert at writing image generation prompts that capture visual art styles. Enhance the following description into a detailed, professional image generation prompt. Focus on: color palette, brush strokes, composition, mood, and artistic techniques. Output ONLY the enhanced prompt, no explanation.",
  };

  const systemPrompt = typeInstructions[type] ?? typeInstructions.character;
  const entry = await this.resolveProviderEntry(userId, projectId, configSource, providerId, "text");
  const config = entry?.config;
  if (!config?.apiKey || !config?.baseUrl) {
    throw new BadRequestException("LLM provider not configured for prompt enhancement");
  }

  const model = entry.model || "gpt-4o";
  const response = await fetch(`${config.baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: prompt },
      ],
      temperature: 0.7,
      max_tokens: 1024,
    }),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new BadRequestException(`LLM enhancement failed: ${text.slice(0, 200)}`);
  }

  const data = await response.json();
  const enhancedPrompt = data.choices?.[0]?.message?.content?.trim() ?? originalPrompt;

  return { enhancedPrompt, originalPrompt };
}
```

Note: `resolveProviderEntry` is an existing private method on `JobsService` (around line 730). It accepts a 5th parameter `providerType` — pass `"text"` to resolve LLM providers. Verify this method exists and has the right signature before implementing; if `resolveProviderEntry` only resolves image providers, you may need to use the LLM config resolution logic from the workspace/chat module instead.

- [ ] **Step 2: Add controller endpoint**

In `apps/api/src/jobs/jobs.controller.ts`, add before the existing `generateCharacterRefImage` endpoint (around line 82):

```typescript
@Post("projects/:projectId/world-bible/enhance-reference-prompt")
enhanceReferencePrompt(
  @CurrentUser() user: { id: string },
  @Param("projectId") projectId: string,
  @Body() body: EnhanceReferencePromptRequest,
) {
  return this.jobsService.enhanceReferencePrompt(
    user.id, projectId, body.prompt, body.type,
    body.configSource ?? "team", body.providerId,
  );
}
```

Import `EnhanceReferencePromptRequest` and `EnhanceReferencePromptResponse` from `@dramaflow/shared`.

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/jobs/jobs.controller.ts apps/api/src/jobs/jobs.service.ts
git commit -m "feat(api): add enhance-reference-prompt endpoint for LLM prompt rewriting"
```

---

### Task 3: Backend — Extend Generate Endpoints for img2img & negativePrompt

**Files:**
- Modify: `apps/api/src/jobs/jobs.controller.ts:82-129`
- Modify: `apps/api/src/jobs/jobs.service.ts:834-994`

- [ ] **Step 1: Extend `generateImageFromPrompt` signature and body**

In `apps/api/src/jobs/jobs.service.ts`, modify the `generateImageFromPrompt` method (line 834). Add `referenceImageAssetId` and `negativePrompt` parameters:

```typescript
async generateImageFromPrompt(
  userId: string,
  projectId: string,
  prompt: string,
  configSource: ImageConfigSource,
  providerId?: string,
  referenceImageAssetId?: string,
  negativePrompt?: string,
): Promise<{ buffer: Buffer; mimeType: string; provider: string; model?: string }> {
```

Inside the method, after resolving the provider config and before dispatching to the provider, add reference image resolution:

```typescript
// Resolve reference image if provided
let referenceImageBuffer: Buffer | undefined;
if (referenceImageAssetId) {
  const assetStream = await this.storageService.getAsset(userId, { projectId, assetId: referenceImageAssetId });
  const chunks: Buffer[] = [];
  for await (const chunk of assetStream) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
  }
  referenceImageBuffer = Buffer.concat(chunks);
}
```

Then pass `referenceImageBuffer` and `negativePrompt` to each provider's `generateImage` call. For providers that don't support img2img, append a note to the prompt instead:

```typescript
let effectivePrompt = prompt;
if (referenceImageBuffer && !this.providerSupportsImg2Img(config.provider)) {
  effectivePrompt = `${prompt}\n\nReference: Use this image as a style and composition guide.`;
  referenceImageBuffer = undefined; // Don't pass buffer to unsupported providers
}
```

Add a helper method:

```typescript
private providerSupportsImg2Img(provider: string): boolean {
  return ["google-gemini", "stable-diffusion", "comfyui"].includes(provider);
}
```

Pass `referenceImageBuffer` and `negativePrompt` through to each provider dispatch.

- [ ] **Step 2: Extend `generateWorldBibleReferenceImage` to pass new params and return assetId**

Modify the private method (line 975):

```typescript
private async generateWorldBibleReferenceImage(
  userId: string,
  projectId: string,
  filenamePrefix: string,
  prompt: string,
  configSource: ImageConfigSource,
  providerId?: string,
  referenceImageAssetId?: string,
  negativePrompt?: string,
): Promise<WorldBibleReferenceImageGenerateResponse> {
  const result = await this.generateImageFromPrompt(
    userId, projectId, prompt, configSource, providerId,
    referenceImageAssetId, negativePrompt,
  );
  const filename = `${filenamePrefix}-${Date.now()}.${result.mimeType.split("/")[1] || "png"}`;
  const stored = await this.storageService.storeGeneratedAsset(userId, {
    projectId, filename, contentType: result.mimeType, body: result.buffer,
  });
  return {
    assetUrl: stored.url!,
    assetId: stored.id ?? stored.key ?? filename,
    prompt,
  };
}
```

- [ ] **Step 3: Extend the three service methods to pass new params**

Update `generateCharacterReferenceImage` (line 910), `generateLocationReferenceImage` (line 934), `generateStyleGuideReferenceImage` (line 958) to accept and forward `referenceImageAssetId` and `negativePrompt`:

```typescript
async generateCharacterReferenceImage(
  userId: string, projectId: string, characterId: string,
  prompt: string, configSource: ImageConfigSource = "team",
  providerId?: string, referenceImageAssetId?: string, negativePrompt?: string,
): Promise<WorldBibleReferenceImageGenerateResponse> {
  // ... existing validation ...
  return this.generateWorldBibleReferenceImage(
    userId, projectId, `char-ref-${characterId}`, prompt,
    configSource, providerId, referenceImageAssetId, negativePrompt,
  );
}
```

Same pattern for location and style guide methods.

- [ ] **Step 4: Update controller endpoints to forward new fields**

In `jobs.controller.ts`, update all three endpoints to pass `body.referenceImageAssetId` and `body.negativePrompt`:

```typescript
return this.jobsService.generateCharacterReferenceImage(
  user.id, projectId, characterId, body.prompt,
  body.configSource ?? "team", body.providerId,
  body.referenceImageAssetId, body.negativePrompt,
);
```

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/jobs/jobs.controller.ts apps/api/src/jobs/jobs.service.ts
git commit -m "feat(api): extend ref-image endpoints with img2img and negativePrompt support"
```

---

### Task 4: Backend — Provider img2img Support

**Files:**
- Modify: `apps/api/src/jobs/google-gemini-image.provider.ts:37-103`
- Modify: `apps/api/src/jobs/sd-webui-image.provider.ts:54-146`
- Modify: `apps/api/src/jobs/comfyui-image.provider.ts:46-156`
- Modify: `apps/api/src/jobs/media-generation.provider.ts:32-82`
- Modify: `apps/api/src/jobs/grok-media.provider.ts:50-130`

Each provider's `generateImage` method needs to accept optional `referenceImageBuffer?: Buffer` and `negativePrompt?: string` in its input.

- [ ] **Step 1: Define a shared input extension type**

In `apps/api/src/jobs/`, each provider accepts `input: GenerateMediaInput & { prompt: string }`. Add the new fields to the input object when calling from `generateImageFromPrompt`:

```typescript
const providerInput = {
  ...existingInput,
  referenceImageBuffer,
  negativePrompt,
};
```

The types are duck-typed — each provider accesses what it needs from `input`.

- [ ] **Step 2: Google Gemini — wire referenceImageBuffer into inline_data**

In `google-gemini-image.provider.ts`, inside `generateImage`, after building the text prompt part, add:

```typescript
const parts: any[] = [{ text: input.prompt }];
if ((input as any).referenceImageBuffer) {
  parts.push({
    inlineData: {
      mimeType: "image/png",
      data: (input as any).referenceImageBuffer.toString("base64"),
    },
  });
}
```

Use `parts` instead of `[{ text: input.prompt }]` in the request body.

- [ ] **Step 3: SD WebUI — add img2img path**

In `sd-webui-image.provider.ts`, inside `generateImage`, branch on `referenceImageBuffer`:

```typescript
const isImg2Img = Boolean((input as any).referenceImageBuffer);
const endpoint = isImg2Img ? `${baseUrl}/sdapi/v1/img2img` : `${baseUrl}/sdapi/v1/txt2img`;
const body: any = {
  prompt: input.prompt,
  negative_prompt: (input as any).negativePrompt || sdConfig?.negativePrompt || "",
  // ... existing sampler, steps, cfg, etc.
  ...(isImg2Img
    ? {
        init_images: [(input as any).referenceImageBuffer.toString("base64")],
        denoising_strength: 0.6,
      }
    : {}),
};
const response = await fetch(endpoint, { method: "POST", ... });
```

- [ ] **Step 4: ComfyUI — add reference image input node**

In `comfyui-image.provider.ts`, inside `generateImage`, when building the default workflow (or injecting into custom workflow), add an input node if `referenceImageBuffer` exists:

```typescript
if ((input as any).referenceImageBuffer) {
  // Add LoadImage node that feeds into the pipeline
  const imgNodeId = "dramaflow-ref-image";
  workflow[imgNodeId] = {
    class_type: "LoadImage",
    inputs: {
      image: `ref_input_${Date.now()}.png`,
    },
  };
  // Upload reference image to ComfyUI input directory
  const uploadFormData = new FormData();
  uploadFormData.append("image", new Blob([(input as any).referenceImageBuffer]), `ref_input_${Date.now()}.png`);
  uploadFormData.append("overwrite", "true");
  await fetch(`${baseUrl}/upload/image`, { method: "POST", body: uploadFormData });
  // Wire imgNodeId.outputs.IMAGE into the pipeline (provider-specific, connect to first sampler)
}
```

Note: The exact workflow wiring depends on the default workflow structure in `buildDefaultWorkflow()`. Inspect that function to determine the correct connection point.

- [ ] **Step 5: OpenAI & Grok — no code change needed**

These providers already receive the effective prompt with reference description appended (handled in `generateImageFromPrompt`). No provider-level change required.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/jobs/google-gemini-image.provider.ts apps/api/src/jobs/sd-webui-image.provider.ts apps/api/src/jobs/comfyui-image.provider.ts
git commit -m "feat(api): add img2img support to Gemini, SD WebUI, ComfyUI providers"
```

---

### Task 5: Frontend — Expand Prompt Builders

**Files:**
- Modify: `apps/web/components/project-workspace/world-bible-editor.tsx:548-569`

- [ ] **Step 1: Update `buildCharacterReferencePrompt` (line 548)**

Change from using only `appearance` to including costumes, personality, and style guide:

```typescript
function buildCharacterReferencePrompt(
  character: CharacterProfile,
  styleGuide?: StyleGuideProfile,
) {
  return buildWorldBibleReferencePrompt([
    character.appearance,
    character.costumes ? Object.values(character.costumes).join(", ") : undefined,
    character.personality,
    styleGuide?.visualStyle,
    styleGuide?.colorPalette,
  ]);
}
```

- [ ] **Step 2: Update `buildLocationReferencePrompt` (line 554)**

Add style guide info:

```typescript
function buildLocationReferencePrompt(
  location: LocationProfile,
  styleGuide?: StyleGuideProfile,
) {
  return buildWorldBibleReferencePrompt([
    location.name,
    location.description,
    location.lighting,
    location.timeOfDay,
    styleGuide?.visualStyle,
    styleGuide?.colorPalette,
  ]);
}
```

- [ ] **Step 3: No change needed for `buildStyleGuideReferencePrompt`** — it already includes the relevant fields.

- [ ] **Step 4: Update dialog invocations to pass styleGuide**

In `CharacterForm` (line 714), `LocationForm` (line 817), `StyleGuideForm` (line 918), update `initialPrompt` to use the new signatures. The `styleGuide` is available from the parent `WorldBibleEditor` scope:

For CharacterForm and LocationForm, pass `styleGuide` from the parent scope where it's available. The dialog invocations will need `styleGuide` as an additional prop or accessed from context.

- [ ] **Step 5: Commit**

```bash
git add apps/web/components/project-workspace/world-bible-editor.tsx
git commit -m "feat(web): expand prompt builders with costumes, personality, style guide"
```

---

### Task 6: Frontend — CSS for Enhanced Dialog

**Files:**
- Modify: `apps/web/app/globals.css`

- [ ] **Step 1: Add CSS for the enhanced dialog layout**

Append to the existing `.dialog-content` related styles (after line ~15400):

```css
/* ─── Enhanced Reference Image Dialog ─── */

.dialog-content--ref-gen {
  width: 960px;
  max-width: 95vw;
  max-height: 90vh;
  display: flex;
  flex-direction: column;
}

.dialog-body--split {
  display: flex;
  flex: 1;
  overflow: hidden;
}

.ref-gen-panel-left {
  width: 380px;
  flex-shrink: 0;
  padding: var(--space-4) var(--space-5);
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
  overflow-y: auto;
  border-right: 1px solid var(--border-subtle);
}

.ref-gen-panel-right {
  flex: 1;
  padding: var(--space-4) var(--space-5);
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  overflow-y: auto;
}

.ref-gen-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: var(--space-3);
  flex: 1;
}

.ref-gen-cell {
  border-radius: var(--radius-md);
  aspect-ratio: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  position: relative;
  cursor: pointer;
  overflow: hidden;
  border: 2px solid var(--border-subtle);
  transition: border-color 0.15s, box-shadow 0.15s;
}

.ref-gen-cell:hover {
  border-color: var(--border-default);
}

.ref-gen-cell--selected {
  border-color: var(--accent);
  box-shadow: var(--shadow-glow);
}

.ref-gen-cell--loading {
  border-color: transparent;
}

.ref-gen-cell--queued {
  border-color: transparent;
  background: rgba(24, 24, 27, 0.5);
}

.ref-gen-cell--error {
  border-color: var(--danger-text);
}

.ref-gen-cell__actions {
  position: absolute;
  bottom: var(--space-2);
  left: var(--space-2);
  right: var(--space-2);
  display: flex;
  gap: var(--space-2);
  opacity: 0;
  transition: opacity 0.15s;
}

.ref-gen-cell:hover .ref-gen-cell__actions,
.ref-gen-cell--selected .ref-gen-cell__actions {
  opacity: 1;
}

.ref-gen-cell__check {
  position: absolute;
  top: var(--space-2);
  right: var(--space-2);
  width: 22px;
  height: 22px;
  border-radius: 50%;
  background: var(--accent);
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--bg-base);
}

.ref-gen-cell__actions .btn {
  flex: 1;
  padding: var(--space-1) var(--space-2);
  font-size: 11px;
}

/* Skeleton shimmer */
@keyframes ref-gen-shimmer {
  0% { background-position: 200% 0; }
  100% { background-position: -200% 0; }
}

.ref-gen-skeleton {
  position: absolute;
  inset: 0;
  background: linear-gradient(90deg, var(--bg-surface) 25%, var(--bg-elevated) 50%, var(--bg-surface) 75%);
  background-size: 200% 100%;
  animation: ref-gen-shimmer 1.5s infinite;
}

.ref-gen-empty {
  border: 2px dashed var(--border-subtle);
  border-radius: var(--radius-lg);
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: var(--space-2);
  color: var(--text-secondary);
  background: rgba(24, 24, 27, 0.3);
}

.ref-gen-history {
  display: flex;
  gap: var(--space-2);
  align-items: center;
}

.ref-gen-history-chip {
  width: 36px;
  height: 36px;
  border-radius: var(--radius-sm);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 10px;
  font-weight: 500;
  cursor: pointer;
  border: 1px solid var(--border-subtle);
  background: rgba(255, 255, 255, 0.05);
  color: var(--text-secondary);
  transition: all 0.15s;
}

.ref-gen-history-chip--active {
  background: var(--accent-subtle);
  border-color: rgba(56, 189, 248, 0.3);
  color: var(--accent);
}

.ref-gen-config {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  padding: var(--space-3) var(--space-4);
  border-radius: var(--radius-md);
  background: rgba(24, 24, 27, 0.6);
  border: 1px solid var(--border-subtle);
}

.ref-gen-config-row {
  display: flex;
  gap: var(--space-2);
  align-items: center;
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/web/app/globals.css
git commit -m "feat(web): add CSS for enhanced reference image generation dialog"
```

---

### Task 7: Frontend — Rewrite Reference Image Dialog

**Files:**
- Rewrite: `apps/web/components/project-workspace/world-bible-reference-image-dialog.tsx`

This is the largest task. The component is completely rewritten with:
- Dual-panel layout (left: editing, right: image grid)
- State machine: editing → enhancing → generating → reviewing → iterating → accepted
- Multi-candidate support (configurable 1-4)
- Iteration history (max 3 rounds)
- AI prompt enhancement
- img2img via reference image upload or selecting a candidate

- [ ] **Step 1: Rewrite the full component**

Replace the entire file content of `world-bible-reference-image-dialog.tsx`. Key structure:

```typescript
"use client";

import { useState, useCallback } from "react";
import type {
  EnhanceReferencePromptRequest,
  EnhanceReferencePromptResponse,
  ImageConfigSource,
  WorldBibleReferenceImageGenerateRequest,
  WorldBibleReferenceImageGenerateResponse,
} from "@dramaflow/shared";
import { apiFetch } from "../../lib/api";
import { useI18n } from "../../lib/i18n";
import { ProviderSelector, useProviderEntries } from "./provider-selector";

// Types
type DialogStatus =
  | "editing"
  | "enhancing"
  | "generating"
  | "reviewing"
  | "iterating"
  | "error";

interface GeneratedImage {
  assetUrl: string;
  assetId: string;
  prompt: string;
  status: "loading" | "done" | "error";
  error?: string;
}

interface GenerationRound {
  id: number;
  images: GeneratedImage[];
  referenceImageAssetId?: string;
}

interface Props {
  generatePath: string;
  enhancePath: string;
  initialPrompt: string;
  onImageGenerated: (assetUrl: string) => void;
  onClose: () => void;
  teamId?: string;
  worldBibleType: "character" | "location" | "styleGuide";
}

export function WorldBibleReferenceImageDialog({
  generatePath,
  enhancePath,
  initialPrompt,
  onImageGenerated,
  onClose,
  teamId,
  worldBibleType,
}: Props) {
  const { t } = useI18n();

  // Editing state
  const [prompt, setPrompt] = useState("");
  const [negativePrompt, setNegativePrompt] = useState("");
  const [hasEditedPrompt, setHasEditedPrompt] = useState(false);

  // Config state
  const [llmConfigSource, setLlmConfigSource] = useState<ImageConfigSource>("team");
  const [imageConfigSource, setImageConfigSource] = useState<ImageConfigSource>("team");
  const [selectedLlmProvider, setSelectedLlmProvider] = useState<string | undefined>();
  const [selectedImageProvider, setSelectedImageProvider] = useState<string | undefined>();
  const [genCount, setGenCount] = useState(4);
  const [referenceImageAssetId, setReferenceImageAssetId] = useState<string | undefined>();

  // Workflow state
  const [status, setStatus] = useState<DialogStatus>("editing");
  const [rounds, setRounds] = useState<GenerationRound[]>([]);
  const [activeRoundId, setActiveRoundId] = useState(0);
  const [selectedImageIndex, setSelectedImageIndex] = useState<number | null>(null);

  // Provider data
  const llmProviders = useProviderEntries(llmConfigSource, teamId);
  const imageProviders = useProviderEntries(imageConfigSource, teamId);

  // Initialize prompt only when empty
  if (initialPrompt && !hasEditedPrompt && !prompt) {
    setPrompt(initialPrompt);
  }

  const activeRound = rounds.find((r) => r.id === activeRoundId);

  // --- Handlers ---

  const handleEnhancePrompt = useCallback(async () => {
    if (!prompt.trim()) return;
    setStatus("enhancing");
    try {
      const body: EnhanceReferencePromptRequest = {
        prompt: prompt.trim(),
        type: worldBibleType,
        configSource: llmConfigSource,
        providerId: selectedLlmProvider,
      };
      const data = await apiFetch<EnhanceReferencePromptResponse>(
        enhancePath.startsWith("/") ? enhancePath : `/${enhancePath}`,
        { method: "POST", body },
      );
      setPrompt(data.enhancedPrompt);
      setHasEditedPrompt(true);
    } catch {
      // Fallback: keep original prompt, show toast
    } finally {
      setStatus("editing");
    }
  }, [prompt, worldBibleType, llmConfigSource, selectedLlmProvider, enhancePath]);

  const handleGenerate = useCallback(async () => {
    if (!prompt.trim()) return;

    const roundId = (rounds[rounds.length - 1]?.id ?? 0) + 1;
    const images: GeneratedImage[] = Array.from({ length: genCount }, () => ({
      assetUrl: "",
      assetId: "",
      prompt: prompt.trim(),
      status: "loading",
    }));
    const newRound: GenerationRound = {
      id: roundId,
      images,
      referenceImageAssetId,
    };

    // Keep only last 3 rounds
    const updatedRounds = [...rounds, newRound].slice(-3);
    setRounds(updatedRounds);
    setActiveRoundId(roundId);
    setSelectedImageIndex(null);
    setStatus("generating");

    // Fire N parallel requests
    const resolvedPath = generatePath.startsWith("/") ? generatePath : `/${generatePath}`;
    await Promise.allSettled(
      images.map(async (_, index) => {
        try {
          const body: WorldBibleReferenceImageGenerateRequest = {
            prompt: prompt.trim(),
            configSource: imageConfigSource,
            providerId: selectedImageProvider,
            referenceImageAssetId,
            negativePrompt: negativePrompt.trim() || undefined,
          };
          const data = await apiFetch<WorldBibleReferenceImageGenerateResponse>(resolvedPath, {
            method: "POST",
            body,
          });
          setRounds((prev) =>
            prev.map((r) =>
              r.id === roundId
                ? {
                    ...r,
                    images: r.images.map((img, i) =>
                      i === index
                        ? { ...img, assetUrl: data.assetUrl, assetId: data.assetId, status: "done" as const, prompt: data.prompt }
                        : img,
                    ),
                  }
                : r,
            ),
          );
        } catch (err) {
          setRounds((prev) =>
            prev.map((r) =>
              r.id === roundId
                ? {
                    ...r,
                    images: r.images.map((img, i) =>
                      i === index
                        ? { ...img, status: "error" as const, error: err instanceof Error ? err.message : "Failed" }
                        : img,
                    ),
                  }
                : r,
            ),
          );
        }
      }),
    );

    setStatus("reviewing");
  }, [
    prompt, genCount, rounds, generatePath, imageConfigSource,
    selectedImageProvider, referenceImageAssetId, negativePrompt,
  ]);

  const handleUseImage = useCallback(
    (imageUrl: string) => {
      onImageGenerated(imageUrl);
      onClose();
    },
    [onImageGenerated, onClose],
  );

  const handleIterate = useCallback(
    (image: GeneratedImage) => {
      setReferenceImageAssetId(image.assetId);
      setStatus("iterating");
      // User can edit prompt, then hit Generate again
    },
    [],
  );

  const isGenerating = status === "generating" || status === "enhancing";

  // --- Render ---
  return (
    <div
      className="dialog-overlay"
      onClick={(e) => e.target === e.currentTarget && !isGenerating && onClose()}
    >
      <div className="dialog-content dialog-content--ref-gen">
        {/* Header */}
        <div className="dialog-header">
          <h3 className="dialog-title">{t("worldBible.generateRefImageTitle")}</h3>
          {!isGenerating && (
            <button className="dialog-close" onClick={onClose}>
              ×
            </button>
          )}
        </div>

        {/* Split body */}
        <div className="dialog-body--split">
          {/* LEFT: Editing panel */}
          <div className="ref-gen-panel-left">
            {/* Prompt */}
            <div>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
                <label className="wb-form__label">Prompt</label>
                <div style={{ display: "flex", gap: 6 }}>
                  <button
                    className="btn btn-primary"
                    style={{ padding: "3px 10px", fontSize: 11 }}
                    onClick={handleEnhancePrompt}
                    disabled={isGenerating || !prompt.trim()}
                  >
                    AI 增强
                  </button>
                  <button
                    className="btn btn-secondary"
                    style={{ padding: "3px 10px", fontSize: 11 }}
                    onClick={() => { setPrompt(initialPrompt); setHasEditedPrompt(false); }}
                    disabled={isGenerating}
                  >
                    重置
                  </button>
                </div>
              </div>
              <textarea
                className="input wb-form__textarea"
                value={prompt}
                onChange={(e) => { setPrompt(e.target.value); setHasEditedPrompt(true); }}
                rows={3}
                disabled={isGenerating}
              />
              {/* Negative prompt (collapsible) */}
              <details style={{ marginTop: 2 }}>
                <summary className="wb-form__label" style={{ cursor: "pointer" }}>
                  负面 Prompt（可选）
                </summary>
                <textarea
                  className="input wb-form__textarea"
                  value={negativePrompt}
                  onChange={(e) => setNegativePrompt(e.target.value)}
                  rows={2}
                  placeholder="不希望出现的元素..."
                  disabled={isGenerating}
                  style={{ marginTop: 4 }}
                />
              </details>
            </div>

            {/* Config */}
            <div className="ref-gen-config">
              {/* LLM */}
              <div className="ref-gen-config-row">
                <label className="wb-form__label" style={{ minWidth: 52 }}>LLM</label>
                <select
                  className="input"
                  style={{ width: 72, height: 36, fontSize: 12, padding: "0 8px" }}
                  value={llmConfigSource}
                  onChange={(e) => setLlmConfigSource(e.target.value as ImageConfigSource)}
                  disabled={isGenerating}
                >
                  <option value="team">团队</option>
                  <option value="personal">个人</option>
                </select>
                <ProviderSelector
                  type="text"
                  providers={llmProviders.textProviders ?? []}
                  defaultProviderId={undefined}
                  value={selectedLlmProvider}
                  onChange={setSelectedLlmProvider}
                />
              </div>
              {/* Image */}
              <div className="ref-gen-config-row">
                <label className="wb-form__label" style={{ minWidth: 52 }}>图片</label>
                <select
                  className="input"
                  style={{ width: 72, height: 36, fontSize: 12, padding: "0 8px" }}
                  value={imageConfigSource}
                  onChange={(e) => setImageConfigSource(e.target.value as ImageConfigSource)}
                  disabled={isGenerating}
                >
                  <option value="team">团队</option>
                  <option value="personal">个人</option>
                </select>
                <ProviderSelector
                  type="image"
                  providers={imageProviders.imageProviders}
                  defaultProviderId={imageProviders.defaultImageProvider}
                  value={selectedImageProvider}
                  onChange={setSelectedImageProvider}
                />
              </div>
              {/* Count + Reference */}
              <div style={{ borderTop: "1px solid var(--border-subtle)", paddingTop: 8, display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                  <label className="wb-form__label">数量</label>
                  <select
                    className="input"
                    style={{ width: 48, height: 36, fontSize: 12, padding: "0 8px" }}
                    value={genCount}
                    onChange={(e) => setGenCount(Number(e.target.value))}
                    disabled={isGenerating}
                  >
                    <option value={1}>1</option>
                    <option value={2}>2</option>
                    <option value={4}>4</option>
                  </select>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <label className="wb-form__label">参考图</label>
                  <button className="btn btn-secondary" style={{ padding: "3px 10px", fontSize: 11 }} disabled={isGenerating}>
                    上传
                  </button>
                  <span style={{ fontSize: 11, color: "var(--text-tertiary)" }}>
                    {referenceImageAssetId ? "已选择" : "未选择"}
                  </span>
                </div>
              </div>
            </div>

            {/* History */}
            {rounds.length > 0 && (
              <div className="ref-gen-history">
                <span className="wb-form__label">历史</span>
                {rounds.map((round) => (
                  <button
                    key={round.id}
                    className={`ref-gen-history-chip ${round.id === activeRoundId ? "ref-gen-history-chip--active" : ""}`}
                    onClick={() => setActiveRoundId(round.id)}
                  >
                    R{round.id}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* RIGHT: Image grid panel */}
          <div className="ref-gen-panel-right">
            {/* Grid header */}
            {activeRound && (
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span className="wb-form__label">
                  候选图 ({activeRound.images.filter((i) => i.status === "done").length}/{activeRound.images.length})
                </span>
                <span style={{ fontSize: 11, color: "var(--text-tertiary)" }}>点击选择 · 双击放大</span>
              </div>
            )}

            {/* Grid */}
            {activeRound ? (
              <div className="ref-gen-grid">
                {activeRound.images.map((image, index) => (
                  <div
                    key={index}
                    className={`ref-gen-cell ${
                      image.status === "loading"
                        ? "ref-gen-cell--loading"
                        : image.status === "error"
                        ? "ref-gen-cell--error"
                        : selectedImageIndex === index
                        ? "ref-gen-cell--selected"
                        : ""
                    }`}
                    onClick={() => image.status === "done" && setSelectedImageIndex(index)}
                  >
                    {image.status === "loading" && (
                      <>
                        <div className="ref-gen-skeleton" />
                        <svg
                          width="24" height="24" viewBox="0 0 24 24"
                          fill="none" stroke="rgba(255,255,255,0.2)" strokeWidth="2"
                          style={{ position: "relative", zIndex: 1, animation: "ref-gen-spin 1s linear infinite" }}
                        >
                          <path d="M21 12a9 9 0 1 1-6.219-8.56" />
                        </svg>
                      </>
                    )}
                    {image.status === "error" && (
                      <div style={{ textAlign: "center", color: "var(--danger-text)", fontSize: 12 }}>
                        <div>生成失败</div>
                        <button className="btn btn-secondary" style={{ fontSize: 10, padding: "2px 8px", marginTop: 4 }}>
                          重试
                        </button>
                      </div>
                    )}
                    {image.status === "done" && (
                      <>
                        <img
                          src={image.assetUrl}
                          alt={`Candidate ${index + 1}`}
                          style={{ width: "100%", height: "100%", objectFit: "cover" }}
                        />
                        {selectedImageIndex === index && (
                          <div className="ref-gen-cell__check">
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--bg-base)" strokeWidth="3">
                              <polyline points="20 6 9 17 4 12" />
                            </svg>
                          </div>
                        )}
                        <div className="ref-gen-cell__actions">
                          <button className="btn btn-primary" onClick={(e) => { e.stopPropagation(); handleUseImage(image.assetUrl); }}>
                            使用
                          </button>
                          <button className="btn btn-secondary" onClick={(e) => { e.stopPropagation(); handleIterate(image); }}>
                            迭代
                          </button>
                        </div>
                      </>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <div className="ref-gen-empty">
                <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.15)" strokeWidth="1.5">
                  <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                  <circle cx="8.5" cy="8.5" r="1.5" />
                  <polyline points="21 15 16 10 5 21" />
                </svg>
                <div>点击下方「生成」开始创建参考图</div>
                <div style={{ fontSize: 12, color: "rgba(255,255,255,0.25)" }}>支持多张候选 · 选择后可迭代优化</div>
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="dialog-footer">
          <button className="btn btn-secondary" onClick={onClose} disabled={isGenerating}>
            {t("common.cancel")}
          </button>
          {activeRound && status === "reviewing" && (
            <button className="btn btn-secondary" onClick={handleGenerate} disabled={isGenerating}>
              重新生成
            </button>
          )}
          {activeRound && selectedImageIndex !== null && status === "reviewing" && (
            <button className="btn btn-primary" onClick={() => handleUseImage(activeRound.images[selectedImageIndex].assetUrl)}>
              使用选中
            </button>
          )}
          {(status === "editing" || status === "iterating" || status === "error") && (
            <button className="btn btn-primary" onClick={handleGenerate} disabled={isGenerating || !prompt.trim()}>
              {isGenerating ? "生成中..." : "生成"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
```

**Note:** The `ProviderSelector` currently accepts `type="image"`. For LLM providers, verify whether `useProviderEntries` returns `textProviders` or if the hook needs adjustment. Check the hook return type in `provider-selector.tsx` — if it only returns `imageProviders`/`videoProviders`, you may need to extend it or create a separate hook for LLM providers.

- [ ] **Step 2: Commit**

```bash
git add apps/web/components/project-workspace/world-bible-reference-image-dialog.tsx
git commit -m "feat(web): rewrite ref-image dialog with dual-panel, multi-candidate, iteration"
```

---

### Task 8: Frontend — Wire Up Dialog in World Bible Editor

**Files:**
- Modify: `apps/web/components/project-workspace/world-bible-editor.tsx:714-725,817-828,918-929`

- [ ] **Step 1: Update dialog invocations with new props**

In `CharacterForm` (around line 714), update the dialog:

```tsx
{showImageGen && (
  <WorldBibleReferenceImageDialog
    generatePath={`/projects/${projectId}/world-bible/characters/${char.id}/generate-reference-image`}
    enhancePath={`/projects/${projectId}/world-bible/enhance-reference-prompt`}
    initialPrompt={buildCharacterReferencePrompt(char, styleGuide)}
    onImageGenerated={(assetUrl) => {
      onUpdate(char.id, {
        referenceImages: [...char.referenceImages, assetUrl],
      });
    }}
    onClose={() => setShowImageGen(false)}
    teamId={teamId}
    worldBibleType="character"
  />
)}
```

Same pattern for `LocationForm` (line 817, use `worldBibleType="location"`) and `StyleGuideForm` (line 918, use `worldBibleType="styleGuide"`).

- [ ] **Step 2: Ensure `styleGuide` is available in CharacterForm and LocationForm**

The `styleGuide` is part of the world bible content. In the parent `WorldBibleEditor`, destructure it from the world bible state and pass it down as a prop to `CharacterForm` and `LocationForm`, or access it from the parent scope where these forms are defined inline.

- [ ] **Step 3: Commit**

```bash
git add apps/web/components/project-workspace/world-bible-editor.tsx
git commit -m "feat(web): wire enhanced ref-image dialog in CharacterForm, LocationForm, StyleGuideForm"
```

---

### Task 9: Verification & Integration Test

- [ ] **Step 1: Start dev servers**

```bash
cd E:/DramaFlow && npm run dev
```

- [ ] **Step 2: Test empty state**
1. Open a project → World Bible → Edit a character
2. Click the generate reference image button
3. Verify the dialog opens at 960px with dual panels
4. Verify prompt is auto-filled from appearance + costumes + style guide
5. Verify left panel has: Prompt, AI 增强, 负面 Prompt, LLM/图片 config, 数量, 参考图上传

- [ ] **Step 3: Test AI enhance**
1. Click「AI 增强」
2. Verify prompt gets rewritten (requires LLM provider configured)
3. Verify fallback if LLM fails

- [ ] **Step 4: Test multi-candidate generation**
1. Set count to 4, click「生成」
2. Verify 4 skeleton cells appear, each loads independently
3. Verify images fill in as they complete
4. Verify cyan highlight on click
5. Verify「使用」and「迭代」buttons on hover

- [ ] **Step 5: Test iteration**
1. Select an image, click「迭代」
2. Verify reference image is set
3. Click「生成」again
4. Verify new round appears in history bar
5. Verify can switch between R1 and R2

- [ ] **Step 6: Test img2img**
1. Upload an external reference image
2. Click「生成」
3. Verify images reflect the reference style

- [ ] **Step 7: Test error states**
1. Disconnect network, click「生成」
2. Verify individual cells show error state with retry button
3. Verify dialog remains usable

- [ ] **Step 8: Final commit**

```bash
git add -A
git commit -m "feat: complete enhanced reference image generation v2"
```
