# DramaFlow

DramaFlow is a TypeScript monorepo for a director- and studio-facing short-drama production platform. The repository ships a runnable `web + api + worker + shared` stack covering authentication, team and project collaboration, AI-assisted writing, media generation, review workflows, TTS, timeline assembly, notifications, realtime updates, and dual storage backends.

## Overview

- Monorepo: `npm workspaces`
- Frontend: Next.js 15 + React 19 + App Router
- Backend: NestJS 11
- Worker: polling worker that claims jobs from the API through internal endpoints
- Shared contracts: `@dramaflow/shared`
- Auth model: JWT access token + opaque refresh token stored as an argon2 hash
- Runtime persistence: Prisma ORM with PostgreSQL

## Current State

DramaFlow is development-ready, but not fully productionized.

- Runtime data access uses Prisma ORM backed by PostgreSQL. A one-time migration script is available for importing legacy JSON data.
- Background jobs use a simplified polling worker + internal API flow; Redis / BullMQ is a future direction, not a current dependency.
- The project workspace uses split data loading: `GET /projects/:id` returns summary data, while versions, jobs, timeline, and exports refresh through dedicated endpoints.
- Realtime delivery is available through a NestJS + Socket.IO gateway for `job.updated`, `review.updated`, and `notification.created`, with polling as the fallback path.
- Text generation, image generation, video generation, and TTS can talk to configured providers, with mock fallback paths preserved for running without external services.
- Video export uses FFmpeg when available, with mock export fallback when explicitly allowed.

## Architecture

### `apps/web`

The Next.js frontend includes:

- Public routes: landing, login, forgot password, reset password, team invite acceptance, project invite acceptance
- Protected dashboard routes: projects, platform admin, team admin, team settings, profile settings, language settings, notifications
- A unified project workspace at `/projects/[projectId]/workspace` with these modes (switched via `?mode=` URL parameter):
  - `info` — project info panel
  - `document` — document mode with sub-tabs: view, edit, generate, versions (worldbible and media are mapped into this mode)
  - `tasks` — task panel
  - `timeline` — timeline editor
- Additional project routes: `/projects/:id/generate` (AI generation), `/projects/:id/review` (review panel), `/projects/:id/drafts` (draft management)
- Document version browsing, diffing, restore, and manual editing for script and storyboard content
- Review actions, threaded comments, audit support, and AI rewrite tools
- SSE-based synopsis, script, storyboard, and rewrite generation
- Conversational AI generation mode: QA dialogue with dimension tracking (core conflict, protagonist, supporting characters, tone, pacing, constraints), real-time editable brief panel, world bible context injection, two-step synopsis → script flow
- Synopsis document manual editing
- Inline character editing in script editors (hover-to-edit character name and profile)
- Paired draft sync between script and world bible characters with WebSocket-based real-time bidirectional synchronization
- Auto-refresh expired access tokens on 401 responses
- Per-shot and batch image/video creation, media candidates with thumbnail grid, lightbox preview, and explicit candidate adoption
- Shot detail modal with three-column layout:
  - Left: editable metadata, shot navigation, action buttons
  - Center: media workspace (tab-driven image/video preview, candidate thumbnails, generation controls)
  - Right: shot content, TTS with audio playback and subtitle preview, linked prompt preview
- Storyboard workbench with drag-and-drop reordering (dnd-kit), multi-select, animated drawer, and auto-display of bound media
- World-bible character, location, style-guide, and character voice configuration UI with reference uploads and voice sample playback
- AI reference image generation for characters, locations, and style guides
- Timeline auto-assembly, save, export submission, and websocket-aware polling fallback
- Provider selector for choosing personal or team image/video providers during generation
- Notification center with unread count, mark read, and mark all read

### `apps/api`

The NestJS API includes:

- `/health` health check and `/docs` Swagger documentation
- **Auth flows**: register, login (with IP-based rate limiting), refresh, logout, forgot password, reset password, profile updates (including LLM config, multi-provider config, default provider), per-user model listing
- **Team flows**: team CRUD, team members (add/remove/role change), team invite links (create/list/revoke/query/accept), team LLM model listing, team settings (LLM, image generation config)
- **Project flows**: project CRUD, project members (invite/add), project invite acceptance, pending invites, project review policy, workspace summary
- **Document & version flows**: version listing (with pagination), version creation, draft editing, deletion, submission, advance-to-review, approval, rejection, restoration, adoption, media binding updates, paired draft sync between script and world bible characters
- **Comment flows**: version-scoped comments with threaded replies (`parentId`)
- **World-bible flows**: full CRUD for characters (with costumes), locations, style guide, character voice config, AI reference image generation
- **Audit flows**: per-content-type audit config (review required, auto-approve roles), audit record listing (with type filtering and pagination)
- **Job types**:
  - Script generation (sync + SSE stream)
  - Synopsis generation (sync + SSE stream)
  - Storyboard generation (sync + SSE stream)
  - Rewrite (sync + SSE stream)
  - Conversational QA dialogue with dimension tracking and brief extraction (SSE stream)
  - Conversational synopsis/script generation from dialogue context (SSE stream)
  - Image generation (per-shot, batch)
  - Video generation (per-shot, batch)
  - TTS generation (per-shot, per-scene batch)
  - Export jobs
- **Prompt preview**: image and video prompt preview endpoints
- **Batch operations**: batch image/video jobs with batch status tracking
- **Export**: capability detection (FFmpeg availability), export job creation
- **Notifications**: listing (with unread filter and pagination), unread count, mark read, mark all read
- **Storage**: direct upload targets, direct file upload, asset URL retrieval, project asset registration
- **Realtime**: WebSocket events for `job.updated`, `review.updated`, `notification.created`
- **Internal endpoints** (worker-only, protected by API key): job claiming, processing, and system-level retry
- **Admin**: platform overview, team dashboard, team settings

### `apps/worker`

The worker is intentionally lightweight:

- Polls `GET /internal/jobs/next` (configurable interval)
- Triggers processing through `POST /internal/jobs/:id/process`
- Retries through `POST /internal/jobs/:id/retry`
- Does not contain generation business logic itself; execution remains in the API service layer

### `packages/shared`

The shared package is the contract layer across the stack:

- Domain types and enums (roles, document types, job types, version statuses, conversation session/brief/dimension types, etc.)
- API contract types (generation inputs, conversation payloads, timeline records, export records, etc.)
- Provider interfaces (LLM, image generation, video generation, TTS)
- Review, permission, job-management, timeline, and export business rules

## API Reference

### Auth

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/auth/register` | User registration |
| POST | `/auth/login` | Login (with IP rate limiting) |
| POST | `/auth/refresh` | Refresh access token |
| POST | `/auth/logout` | Logout |
| POST | `/auth/forgot-password` | Initiate password reset |
| POST | `/auth/reset-password` | Execute password reset |
| GET | `/auth/me` | Get current user profile |
| PATCH | `/auth/me` | Update profile (LLM config, providers, defaults) |
| POST | `/auth/me/llm-models` | List available LLM models |

### Teams

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/teams` | List user's teams |
| GET | `/teams/:id` | Get team details |
| POST | `/teams` | Create team |
| PATCH | `/teams/:id` | Update team |
| DELETE | `/teams/:id` | Delete team |
| POST | `/teams/:id/llm-models` | List team LLM models |
| POST | `/teams/:id/members` | Add team member |
| DELETE | `/teams/:teamId/members/:memberId` | Remove team member |
| PATCH | `/teams/:teamId/members/:memberId` | Change member role |
| POST | `/teams/:id/invite-links` | Create invite link |
| GET | `/teams/:id/invite-links` | List invite links |
| DELETE | `/teams/:teamId/invite-links/:linkId` | Revoke invite link |
| GET | `/invite-links/:token` | Get invite link info |
| POST | `/invite-links/:token/accept` | Accept team invite |

### Projects

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/projects` | List user's projects |
| POST | `/projects` | Create project |
| GET | `/projects/:id` | Workspace summary |
| PATCH | `/projects/:id` | Update project |
| DELETE | `/projects/:id` | Delete project |
| PATCH | `/projects/:id/review-policy` | Update review policy |
| POST | `/projects/:id/invites` | Invite project member |
| POST | `/projects/:id/members` | Add project member |
| GET | `/project-invites/pending` | List pending invites |
| POST | `/project-invites/:id/accept` | Accept project invite |

### Documents & Versions

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/projects/:id/versions` | List project versions (paginated) |
| GET | `/documents/:id/versions` | List document versions (paginated) |
| POST | `/documents/:id/versions` | Create version |
| PATCH | `/versions/:id` | Update draft version content |
| DELETE | `/versions/:id` | Delete draft version |
| POST | `/documents/:id/adopt-version` | Adopt version as baseline |
| POST | `/versions/:id/adopt` | Adopt version |
| POST | `/versions/:id/submit` | Submit version |
| POST | `/versions/:id/advance-to-review` | Advance to review |
| POST | `/versions/:id/approve` | Approve version |
| POST | `/versions/:id/reject` | Reject version |
| POST | `/versions/:id/restore` | Restore version |
| PATCH | `/versions/:id/media-binding` | Update draft media binding |

### Comments

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/versions/:id/comments` | List version comments |
| POST | `/versions/:id/comments` | Add comment (threaded) |

### World Bible

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/projects/:id/world-bible` | Get world bible |
| PATCH | `/projects/:id/world-bible` | Update world bible |
| POST | `/projects/:id/world-bible/characters` | Add character |
| PATCH | `/projects/:projectId/world-bible/characters/:characterId` | Update character |
| DELETE | `/projects/:projectId/world-bible/characters/:characterId` | Delete character |
| POST | `/projects/:id/world-bible/locations` | Add location |
| PATCH | `/projects/:projectId/world-bible/locations/:locationId` | Update location |
| DELETE | `/projects/:projectId/world-bible/locations/:locationId` | Delete location |
| PATCH | `/projects/:id/world-bible/style-guide` | Update style guide |
| PATCH | `/projects/:projectId/world-bible/characters/:characterId/voice` | Update character voice |

### Audit

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/projects/:id/audit-configs` | Get audit configs |
| PATCH | `/projects/:id/audit-configs/:contentType` | Upsert audit config |
| GET | `/projects/:id/audit-records` | List audit records (filterable, paginated) |
| GET | `/versions/:id/audit-records` | List version audit records |

### Generation Jobs

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/projects/:id/script-jobs` | Create script generation job |
| POST | `/projects/:id/script-jobs/stream` | SSE stream script generation |
| POST | `/projects/:id/synopsis-jobs` | Create synopsis generation job |
| POST | `/projects/:id/synopsis-jobs/stream` | SSE stream synopsis generation |
| POST | `/projects/:id/storyboard-jobs` | Create storyboard generation job |
| POST | `/projects/:id/storyboard-jobs/stream` | SSE stream storyboard generation |
| POST | `/projects/:id/rewrite-jobs` | Create rewrite job |
| POST | `/projects/:id/rewrite-jobs/stream` | SSE stream rewrite |
| POST | `/shots/:id/image-jobs` | Create image generation job |
| POST | `/shots/:id/video-jobs` | Create video generation job |
| POST | `/shots/:id/tts-jobs` | Create TTS job |
| POST | `/scenes/:id/batch-tts-jobs` | Batch TTS for scene shots |
| POST | `/projects/:id/batch-image-jobs` | Batch image generation |
| POST | `/projects/:id/batch-video-jobs` | Batch video generation |
| GET | `/batch-jobs/:batchId` | Get batch job status |
| POST | `/shots/:id/preview-prompt` | Preview image prompt |
| POST | `/shots/:id/preview-video-prompt` | Preview video prompt |

### Conversational Generation

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/projects/:id/conversation-jobs/message` | Send message, SSE stream AI reply with brief updates |
| POST | `/projects/:id/conversation-jobs/generate` | Generate synopsis/script from conversation, SSE stream |
| GET | `/projects/:id/conversation-jobs/:sessionId` | Get conversation session state |
| POST | `/projects/:id/conversation-jobs/:sessionId/delete` | Delete conversation session |

### World Bible Reference Image Generation

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/projects/:projectId/world-bible/characters/:characterId/generate-reference-image` | Generate character reference image |
| POST | `/projects/:projectId/world-bible/locations/:locationId/generate-reference-image` | Generate location reference image |
| POST | `/projects/:projectId/world-bible/style-guide/generate-reference-image` | Generate style guide reference image |

### Job Management

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/projects/:id/jobs` | List project jobs (filterable, paginated) |
| GET | `/jobs/:id` | Get job details |
| POST | `/jobs/:id/cancel` | Cancel job |
| POST | `/jobs/:id/retry` | Retry failed job |

### Timeline & Export

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/projects/:id/timeline` | Get timeline |
| PUT | `/projects/:id/timeline` | Save timeline |
| POST | `/projects/:id/timeline/auto-assemble` | Auto-assemble timeline |
| GET | `/export/capabilities` | Check export capabilities (FFmpeg) |
| POST | `/projects/:id/export-jobs` | Create export job |
| GET | `/projects/:id/exports` | List export records |

### TTS

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/tts/voices` | List available TTS voices |

### Storage

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/uploads` | Create upload target |
| PUT | `/uploads/direct/:key` | Direct file upload |
| GET | `/assets/:id/url` | Get asset URL |
| POST | `/projects/:id/assets` | Register project asset |

### Notifications

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/notifications` | List notifications (filterable, paginated) |
| GET | `/notifications/unread-count` | Get unread count |
| PATCH | `/notifications/:id/read` | Mark as read |
| POST | `/notifications/mark-all-read` | Mark all as read |

### Admin

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/admin/platform/overview` | Platform overview metrics |
| GET | `/admin/teams/:id/overview` | Team dashboard |
| GET | `/admin/teams/:id/settings` | Team settings |

### WebSocket Events

- `job.updated`
- `review.updated`
- `notification.created`
- `draft.character.synced`

### Internal (Worker)

These endpoints are protected by `InternalApiKeyGuard` and not exposed publicly.

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/internal/jobs/next` | Claim next pending job (priority-sorted) |
| POST | `/internal/jobs/:id/process` | Execute job |
| POST | `/internal/jobs/:id/retry` | System-level retry |

## Repository Layout

```text
.
|-- apps
|   |-- api          # NestJS backend
|   |-- web          # Next.js frontend
|   `-- worker       # Polling job worker
|-- packages
|   `-- shared       # Cross-stack types and business rules
|-- scripts
|-- tests
|-- .env.example
|-- AGENTS.md
|-- README.md
|-- README_ZH.md
|-- package.json
`-- tsconfig.base.json
```

## Quick Start

### Requirements

- Node.js `>=24`
- npm

### 1. Install dependencies

```bash
npm install
```

If PowerShell blocks `npm.ps1`:

```powershell
npm.cmd install
```

### 2. Create `.env`

```bash
cp .env.example .env
```

PowerShell:

```powershell
Copy-Item .env.example .env
```

At minimum, set secure values for:

- `JWT_ACCESS_SECRET`
- `JWT_REFRESH_SECRET`
- `INTERNAL_API_KEY`

### 3. Set up the database

**Option A: Docker Compose** (recommended for development)
```bash
docker compose up postgres -d
```

**Option B: Local PostgreSQL**
Ensure PostgreSQL 17+ is running and `DATABASE_URL` in `.env` points to it.

Then apply migrations:
```bash
npm --workspace @dramaflow/api run prisma:migrate:deploy
```

### 4. Build the workspace

```bash
npm run build
```

### 5. Start the services

Recommended: use the root launcher, which copies `.env` if missing, checks ports, builds the workspace, launches API/Web/Worker, and waits for readiness.

Windows:

```bat
start-all.bat
```

macOS / Linux:

```bash
bash ./start-all.sh
```

Or start each service manually:

```bash
npm --workspace @dramaflow/api run start
npm --workspace @dramaflow/web run start
npm --workspace @dramaflow/worker run start
```

Development scripts:

```bash
npm run dev:api
npm run dev:web
npm run dev:worker
```

### 6. Open the local URLs

- Web: `http://localhost:3000`
- Login: `http://localhost:3000/login`
- API health: `http://localhost:4000/health`
- Swagger: `http://localhost:4000/docs`

## Environment Variables

`.env.example` covers the core app, storage, and provider settings. Some runtime variables are code-level only; the list below is the authoritative overview.

### Core app and auth

| Variable | Description |
|----------|-------------|
| `APP_URL` | Frontend origin for CORS |
| `API_URL` | Backend origin for worker and startup scripts |
| `NEXT_PUBLIC_API_URL` | Backend origin for the web app |
| `PORT` | Override API or Web port |
| `JWT_ACCESS_SECRET` | Access token signing secret |
| `JWT_REFRESH_SECRET` | Refresh token secret |
| `INTERNAL_API_KEY` | Shared secret for worker-to-API internal endpoints |

### Persistence and storage

| Variable | Description |
|----------|-------------|
| `DATABASE_URL` | PostgreSQL connection string (e.g. `postgresql://user:pass@host:5432/db`) |
| `TEST_DATABASE_URL` | PostgreSQL connection string for API test reset and integration tests; use a database name containing `test` |
| `LEGACY_DEV_DB_PATH` | Path to legacy `dev-db.json` for one-time import (optional) |
| `UPLOADS_DIR` | Local uploads directory |
| `STORAGE_DRIVER` | `local` or `s3` |
| `LOCAL_STORAGE_PUBLIC_URL` | Public base URL for locally served files |
| `S3_ENDPOINT` | S3 endpoint URL |
| `S3_REGION` | S3 region |
| `S3_BUCKET` | S3 bucket name |
| `S3_ACCESS_KEY` | S3 access key |
| `S3_SECRET_KEY` | S3 secret key |

### Text generation

| Variable | Description |
|----------|-------------|
| `OPENAI_COMPAT_BASE_URL` | OpenAI-compatible API base URL |
| `OPENAI_COMPAT_API_KEY` | OpenAI-compatible API key |
| `OPENAI_TEXT_MODEL` | Text generation model name |
| `OPENAI_COMPAT_MOCK_FALLBACK` | Fall back to mock if provider fails (`true`/`false`) |

### Image generation

| Variable | Description |
|----------|-------------|
| `GOOGLE_IMAGE_API_KEY` | Google Gemini image API key |
| `GOOGLE_IMAGE_MODEL` | Gemini image model name |
| `GOOGLE_IMAGE_BASE_URL` | Gemini API base URL |
| `MEDIA_IMAGE_MODEL` | Default image generation model |
| `SD_WEBUI_BASE_URL` | Stable Diffusion WebUI base URL |
| `SD_WEBUI_API_KEY` | Stable Diffusion WebUI API key |
| `COMFYUI_BASE_URL` | ComfyUI base URL |
| `COMFYUI_API_KEY` | ComfyUI API key |

### Video generation

| Variable | Description |
|----------|-------------|
| `MEDIA_VIDEO_MODEL` | Default video generation model |

### TTS

| Variable | Description |
|----------|-------------|
| `OPENAI_BASE_URL` | OpenAI API base URL for TTS |
| `OPENAI_API_KEY` | OpenAI API key for TTS |
| `OPENAI_TTS_MODEL` | TTS model name |

### Export and worker overrides

| Variable | Description |
|----------|-------------|
| `FFMPEG_PATH` | Path to FFmpeg binary |
| `EXPORT_KEEP_TEMP` | Keep temporary export files |
| `WORKER_POLL_INTERVAL_MS` | Worker polling interval |
| `DRAMAFLOW_START_INLINE` | Start services inline (no background) |
| `DRAMAFLOW_START_TIMEOUT_MS` | Startup readiness timeout |

## Docker Compose

The repository includes a demo-oriented `docker-compose.yml` that starts:

- PostgreSQL 17
- Web
- API
- Worker
- MinIO

```bash
docker compose up --build
```

Notes:

- Compose uses `npm run dev:*`, aimed at development and demos, not hardened production deployment.
- The Compose file sets `STORAGE_DRIVER=local`, so MinIO is not the active storage backend by default.
- Only partial provider configuration is passed through by default. For live provider execution, pass the relevant provider variables to the API container.
- The API container runs `prisma migrate deploy` on startup to apply pending migrations.

## Migrating from Legacy JSON

If you have a legacy `dev-db.json` file from the previous file-based database:

```bash
cd apps/api
DATABASE_URL="postgresql://..." LEGACY_DEV_DB_PATH="/path/to/dev-db.json" npx tsx scripts/migrate-legacy-json.ts
```

The target PostgreSQL database must be empty (the script will refuse to import into a non-empty database).

## Common Commands

```bash
# Build all packages
npm run build

# Start individual services
npm --workspace @dramaflow/api run start
npm --workspace @dramaflow/web run start
npm --workspace @dramaflow/worker run start

# Development mode
npm run dev:api
npm run dev:web
npm run dev:worker

# Workspace type checks
npm run lint

# Workspace tests
npm test
```

Notes:

- `npm run lint` fans out to workspace `tsc --noEmit` scripts; it is not an ESLint pass.
- `npm test` only runs packages that define a `test` script, which means API and shared, not web or worker.

## Development Notes

- All repository files must use UTF-8 without BOM.
- `packages/shared` is the source of truth for cross-stack domain types and business rules.
- Keep controllers thin and business logic in services.
- Keep Next.js `page.tsx` files light and move heavier UI logic into `components`.
- If a change affects API payloads, update shared contracts, API handlers, frontend callers, and worker behavior together.
- If a change affects review logic, status transitions, or permissions, inspect `packages/shared/src/business-rules.ts` first.
- If you update `README.md`, update `README_ZH.md` in the same change.

## Suggested Reading Order

1. `README.md` / `README_ZH.md`
2. `AGENTS.md`
3. `package.json`
4. `tsconfig.base.json`
5. `packages/shared/src/domain.ts`
6. `packages/shared/src/business-rules.ts`
7. `apps/api/src/workspace/workspace.service.ts`
8. `apps/api/src/jobs/jobs.service.ts`
9. `apps/web/components/unified-workspace.tsx`
10. `apps/web/lib/api.ts`

## Official References

- Next.js App Router: <https://nextjs.org/docs/app>
- React 19: <https://react.dev/blog/2024/12/05/react-19>
- NestJS docs: <https://docs.nestjs.com>
- NestJS WebSocket gateways: <https://docs.nestjs.com/websockets/gateways>
- Socket.IO client options and auth: <https://socket.io/docs/v4/client-options/>
- npm workspaces: <https://docs.npmjs.com/cli/using-npm/workspaces/>
- Prisma schema overview: <https://www.prisma.io/docs/orm/prisma-schema/overview>
- Google Gemini image generation: <https://ai.google.dev/gemini-api/docs/image-generation>
- Google Gemini OpenAI compatibility: <https://ai.google.dev/gemini-api/docs/openai>
- OpenAI image generation: <https://developers.openai.com/api/docs/guides/image-generation>
- OpenAI text-to-speech: <https://developers.openai.com/api/docs/guides/text-to-speech>

## License

This repository does not currently declare a standalone license. Add an explicit license file before open-sourcing or distributing it commercially.
