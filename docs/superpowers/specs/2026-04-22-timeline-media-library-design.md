# Timeline Media Library Design

**Date:** 2026-04-22
**Status:** Draft

## Context

The timeline editor currently has no way to manually browse or add materials (assets) to timeline tracks. The only way to populate the timeline is through "auto-assemble," which pulls from all shot-level video/audio documents at once. Users need the ability to browse existing project assets, preview them, and drag individual assets onto specific timeline tracks. They also need to upload local files as new assets.

## Design

### 1. Layout

A collapsible side panel on the left side of the timeline editor. The timeline editor currently takes full width; adding the panel creates a two-column layout:

```
┌──────────────┬─────────────────────────────────┐
│  MediaLibrary│                                 │
│              │       Timeline Editor            │
│  [Video]     │       ─────────────             │
│  [Audio]     │       ─────────────             │
│  [Subtitle]  │       ─────────────             │
│  [Image]     │                                 │
│              │                                 │
│  ┌────────┐  │                                 │
│  │thumb   │  │                                 │
│  │+name   │  │                                 │
│  │+dur.   │  │                                 │
│  └────────┘  │                                 │
│              │                                 │
│  [Preview]   │                                 │
│              │                                 │
│  [Upload]    │                                 │
└──────────────┴─────────────────────────────────┘
```

The panel is resizable (drag the divider) and collapsible (toggle button in the timeline toolbar).

### 2. Type Tabs

Four tabs at the top of the panel: Video, Audio, Subtitle, Image. Each tab shows only assets of that type. The active tab is highlighted.

### 3. Asset Cards

Each asset is displayed as a card in a vertical list or compact grid:

- **Thumbnail**: Video/image → first frame; Audio → waveform icon; Subtitle → text snippet
- **Name**: File name or document title (e.g., "Shot 1-1 preview video")
- **Duration**: Format as MM:SS (e.g., "00:15") for video/audio; character count for subtitles; dimensions for images
- **Source badge**: "AI" for generated assets, "Upload" for user-uploaded assets

Cards are draggable — drag from card onto a timeline track to add a clip.

### 4. Preview

Clicking (not dragging) an asset card expands a preview area at the bottom of the panel:

- **Video**: Small embedded video player with play/pause
- **Audio**: Audio player with waveform visualization
- **Subtitle**: Text content display
- **Image**: Full image preview

Only one preview is shown at a time. Clicking another card switches the preview. Clicking the same card collapses it.

### 5. Upload

An "Upload" button at the bottom of each tab. Clicking it opens a file picker filtered to the relevant type:

- Video tab: accepts video files (mp4, mov, webm)
- Audio tab: accepts audio files (mp3, wav, ogg)
- Subtitle tab: accepts text/srt files
- Image tab: accepts image files (png, jpg, webp)

Upload flow:
1. User selects file(s)
2. File is uploaded via `POST /projects/:id/assets/upload`
3. Backend stores file via StorageService, creates a document record
4. Asset appears in the library after upload completes

### 6. Asset Types vs. Existing Document Types

Current document types in the system: `script`, `storyboard`, `video`, `audio`, `world_bible`. There are no `subtitle` or `image` document types yet.

- **Video tab**: Populated from existing `video` documents (AI-generated per shot) + uploads
- **Audio tab**: Populated from existing `audio` documents (AI-generated per shot) + uploads
- **Subtitle tab**: Upload-only — no existing project assets. Uploaded SRT/text files stored as new `subtitle` document type
- **Image tab**: Upload-only — no existing project assets. Uploaded images stored as new `image` document type

Adding `subtitle` and `image` to the `DocumentType` union and Prisma schema is part of this change.

### 7. Drag and Drop

When a card is dragged onto a timeline track:
- A new `TimelineClip` is created at the drop position
- The clip's `assetUrl` is set from the document version's asset URL
- The clip's `duration` defaults to the asset's duration
- Video assets can only be dropped on video/d subtitle tracks; audio on audio tracks; etc.
- The timeline auto-saves after drop (using existing save API)

## Data Sources

### Existing Project Assets

Read from `payload.documents` (which contains ALL document types, not filtered):
- Documents with `type === "video"` → Video tab
- Documents with `type === "audio"` → Audio tab
- Each document's adopted version (via `currentVersionId`) provides the `assetUrl`

### Upload API (New)

New endpoint: `POST /projects/:id/assets/upload`
- Accepts multipart file upload
- Parameters: `file`, `type` (video/audio/subtitle/image)
- Uses existing `StorageService` for file storage
- Creates a document record in the database
- Returns the created document with its version

## New Files

| File | Purpose |
|------|---------|
| `apps/web/components/project-workspace/media-library.tsx` | MediaLibrary component (tabs, cards, preview, upload, drag source) |

## Modified Files

| File | Change |
|------|--------|
| `apps/web/components/project-workspace/timeline-editor.tsx` | Add side panel layout, integrate MediaLibrary, handle drop events |
| `apps/api/src/workspace/workspace.controller.ts` | Add upload endpoint |
| `apps/api/src/workspace/workspace.service.ts` | Add upload method |
| `packages/shared/src/domain.ts` | Add `subtitle` and `image` to `DocumentType` |
| `apps/api/prisma/schema.prisma` | Add `subtitle` and `image` to document type enum |

## Verification

1. MediaLibrary panel shows in timeline mode with four type tabs
2. Video tab lists all project video documents with thumbnails and durations
3. Audio tab lists all project audio documents
4. Clicking a card shows preview (video plays, audio plays)
5. Dragging a video card onto the video track creates a new clip
6. Upload button accepts files and they appear in the library after upload
7. Panel can be collapsed and resized
8. Existing timeline features (auto-assemble, export, playback) still work
