# World Bible as Document Type - Design Spec

**Date:** 2026-04-10
**Status:** Approved

## Context

World Bible (世界观) is currently a standalone workspace mode in the unified workspace sidebar, using a card-based editing UI (`WorldBiblePanel`). It lacks version management, review workflow, and diff capabilities that other document types (scripts, storyboards) already have.

Moving World Bible into the Document mode as a proper document type gives it full version history, submission/approval flow, and text-based diff comparison. The editing experience shifts from card-based forms to structured rich text using Tiptap custom nodes, consistent with the script editor.

## Decision

- World Bible becomes a `world_bible` document type within the Document workspace mode
- Content is structured rich text with 4 custom Tiptap nodes
- Full version management (view/edit/diff/restore/review) is reused from existing infrastructure
- The standalone World Bible sidebar tab is removed (6 modes → 5)

## Tiptap Custom Nodes

All nodes follow the existing pattern established by `DialogueBlock` and `DirectorNote`: `Node.create` with `group: "block"`, `content: "inline*"`, `data-*` attributes, and `parseHTML`/`renderHTML` serialization.

### CharacterBlock (`tiptap/extensions/character-block.ts`)

A structured block for character profiles. Maps from `CharacterProfile` in `@dramaflow/shared`.

| Attribute | Storage | Type | Description |
|-----------|---------|------|-------------|
| id | `data-id` | string | Unique character ID |
| name | `data-name` | string | Character name |
| appearance | `data-appearance` | string | Appearance description |
| personality | `data-personality` | string | Personality traits (optional) |
| costumes | `data-costumes` | string | JSON-serialized `Record<string, string>` |
| tags | `data-tags` | string | JSON-serialized `string[]` |
| referenceImages | `data-references` | string | JSON-serialized URL array |
| sortOrder | `data-sort-order` | string | Numeric sort position |

- CSS class: `tiptap-character-block`
- Shortcut: `Mod-Alt-c`
- Commands: `setCharacterBlock(attrs)`, `toggleCharacterBlock()`

### LocationBlock (`tiptap/extensions/location-block.ts`)

A structured block for location profiles. Maps from `LocationProfile` in `@dramaflow/shared`.

| Attribute | Storage | Type | Description |
|-----------|---------|------|-------------|
| id | `data-id` | string | Unique location ID |
| name | `data-name` | string | Location name |
| description | `data-description` | string | Location description |
| lighting | `data-lighting` | string | Lighting details (optional) |
| timeOfDay | `data-time-of-day` | string | Time of day (optional) |
| referenceImages | `data-references` | string | JSON-serialized URL array |
| sortOrder | `data-sort-order` | string | Numeric sort position |

- CSS class: `tiptap-location-block`
- Shortcut: `Mod-Alt-l`
- Commands: `setLocationBlock(attrs)`, `toggleLocationBlock()`

### StyleGuideBlock (`tiptap/extensions/style-guide-block.ts`)

A block for style guidelines. Maps from `StyleGuideProfile` in `@dramaflow/shared`. Content text goes in the block body (inline*) for the visual style description.

| Attribute | Storage | Type | Description |
|-----------|---------|------|-------------|
| colorPalette | `data-color-palette` | string | Color palette description (optional) |
| compositionNote | `data-composition-note` | string | Composition guidelines (optional) |
| negativePrompt | `data-negative-prompt` | string | Negative prompt for generation (optional) |
| referenceImages | `data-references` | string | JSON-serialized URL array |

- CSS class: `tiptap-style-guide-block`
- Shortcut: `Mod-Alt-g`
- Commands: `setStyleGuideBlock(attrs)`, `toggleStyleGuideBlock()`

### VoiceConfigBlock (`tiptap/extensions/voice-config-block.ts`)

A block for character voice/TTS configuration. Maps from `CharacterVoiceConfig` in `@dramaflow/shared`. Supplementary notes in block body.

| Attribute | Storage | Type | Description |
|-----------|---------|------|-------------|
| characterId | `data-character-id` | string | Associated character ID |
| ttsProvider | `data-tts-provider` | string | TTS provider name |
| voiceId | `data-voice-id` | string | TTS voice ID |
| voiceName | `data-voice-name` | string | Human-readable voice name |
| sampleUrl | `data-sample-url` | string | Voice sample audio URL (optional) |
| speed | `data-speed` | string | Speed parameter (optional) |
| emotion | `data-emotion` | string | Emotion parameter (optional) |
| volume | `data-volume` | string | Volume parameter (optional) |

- CSS class: `tiptap-voice-config-block`
- Shortcut: `Mod-Alt-v`
- Commands: `setVoiceConfigBlock(attrs)`, `toggleVoiceConfigBlock()`

## Converter (`converters/world-bible.ts`)

Bidirectional conversion between world bible domain content and Tiptap JSON.

- `worldBibleContentToTiptap(content)` — Converts `WorldBibleContent` (from `@dramaflow/shared`) to Tiptap doc JSON using the 4 custom node types
- `tiptapToWorldBibleContent(json)` — Converts Tiptap doc JSON back to `WorldBibleContent`
- Reuses `normalizeWorldBibleContent` from shared package for input normalization

Mapping:
- `characters[]` → array of `characterBlock` nodes (one per `CharacterProfile`)
- `locations[]` → array of `locationBlock` nodes (one per `LocationProfile`)
- `styleGuide` → single `styleGuideBlock` node (maps from `StyleGuideProfile`, body text = `visualStyle`)
- `voiceConfigs[]` → array of `voiceConfigBlock` nodes (one per `CharacterVoiceConfig`)

## WorldBibleEditor (`world-bible-editor.tsx`)

New component following the `rich-script-editor.tsx` pattern.

**Editor setup:**
- Extensions: `StarterKit` (heading disabled), `Placeholder`, `CharacterBlock`, `LocationBlock`, `StyleGuideBlock`, `VoiceConfigBlock`
- Toolbar with 4 buttons to insert each block type
- Each custom node renders as a collapsible card with labeled fields

**Props:**
```typescript
interface Props {
  initialContent?: WorldBibleContent | null;
  onSave: (title: string, content: WorldBibleContent) => void;
  onCancel: () => void;
  isSaving: boolean;
}
```

**Reference images:** Upload via existing Storage API, store resulting URL in node attribute.

## Unified Workspace Integration

### Editor dispatch (edit sub-tab)

In `unified-workspace.tsx`, the edit sub-tab checks `selectedDoc.type`:
- `"script"` → render `RichScriptEditor` (existing)
- `"world_bible"` → render `WorldBibleEditor` (new)

### Read-only view (view sub-tab)

When `selectedDoc.type === "world_bible"`:
- Render a read-only Tiptap editor with the 4 custom extensions
- Cards display in collapsed mode with key fields visible

### Version management

No changes needed to version infrastructure. World bible documents use the same:
- `VersionList` component
- `VersionDiffView` with Tiptap text diff
- Version status transitions (draft → submitted → pending_review → approved/rejected)
- Review policy enforcement
- Restore operation

### Sidebar changes

- Remove `{ key: "worldbible", ... }` from workspace modes array
- Remove `isWorldBibleMode` variable
- Remove `<WorldBiblePanel>` rendering block
- Update `WorkspaceMode` type: `"document" | "media" | "info" | "tasks" | "timeline"` (5 modes)
- Update mode mapping to remove `worldbible` entry

## Files to Create

| File | Purpose |
|------|---------|
| `apps/web/components/project-workspace/tiptap/extensions/character-block.ts` | CharacterBlock Tiptap node |
| `apps/web/components/project-workspace/tiptap/extensions/location-block.ts` | LocationBlock Tiptap node |
| `apps/web/components/project-workspace/tiptap/extensions/style-guide-block.ts` | StyleGuideBlock Tiptap node |
| `apps/web/components/project-workspace/tiptap/extensions/voice-config-block.ts` | VoiceConfigBlock Tiptap node |
| `apps/web/components/project-workspace/tiptap/converters/world-bible.ts` | World bible ↔ Tiptap converter |
| `apps/web/components/project-workspace/world-bible-editor.tsx` | World bible document editor |

## Files to Modify

| File | Change |
|------|--------|
| `apps/web/components/unified-workspace.tsx` | Remove worldbible mode, add editor dispatch for world_bible doc type |
| `apps/web/app/globals.css` | Add CSS for 4 new tiptap node classes |
| `packages/shared/src/document-content.ts` | Add world bible content normalization utilities |

## Verification

1. Create a `world_bible` document via API → appears in document selector
2. Edit sub-tab renders WorldBibleEditor with toolbar
3. Insert each block type via toolbar buttons and keyboard shortcuts
4. Save creates a new version → visible in version list
5. View sub-tab renders read-only content
6. Diff view compares two versions with text diff
7. Sidebar shows 5 modes (no worldbible tab)
8. Existing world_bible documents created through the old WorldBiblePanel can be loaded and edited
