# DramaFlow

DramaFlow is a TypeScript monorepo for a director- and studio-facing short-drama workflow. The repository currently ships a runnable `web + api + worker + shared` stack for authentication, collaboration, AI-assisted writing, media generation, review and audit flows, TTS, timeline assembly, notifications, realtime updates, and dual storage backends.

## Overview

- Monorepo: `npm workspaces`
- Frontend: Next.js 15 + React 19 + App Router
- Backend: NestJS 11
- Worker: polling worker that claims jobs from the API through internal endpoints
- Shared contracts: `@dramaflow/shared`
- Auth model: JWT access token + opaque refresh token stored as an argon2 hash
- Runtime persistence: JSON files via `DevDatabaseService`
- Target production model: Prisma schema for PostgreSQL

## Current State

DramaFlow is development-ready, but it is not fully productionized yet.

- Runtime data access still uses the file-backed `DevDatabaseService`; Prisma is not wired into the live code path yet.
- Background jobs still use the simplified polling worker + internal API flow; Redis / BullMQ is a future direction, not a current dependency.
- The project workspace now uses split data loading: `GET /projects/:id` returns summary data, while versions, jobs, timeline, and exports refresh through dedicated endpoints.
- Realtime delivery is available through a NestJS + Socket.IO gateway for `job.updated`, `review.updated`, and `notification.created`, with polling kept as the fallback path.
- Text generation, image generation, video generation, and TTS can talk to configured providers, but mock fallback paths are still intentionally preserved so the product can run without external services.
- Video export now uses FFmpeg when available and can fall back to a mock export artifact when explicitly allowed.

## Architecture

### `apps/web`

The Next.js frontend includes:

- public routes for landing, login, forgot password, reset password, team invite acceptance, and project invite acceptance
- protected dashboard routes for projects, platform admin, team admin, team settings, profile settings, language settings, and notifications
- a unified project workspace at `/projects/[projectId]/workspace` with these modes:
  - `info`
  - `document`
  - `worldbible`
  - `generate`
  - `media`
  - `tasks`
  - `timeline`
- document version browsing, diffing, restore, and manual editing for script and storyboard content
- review actions, threaded comments, audit support, and AI rewrite tools
- SSE-based synopsis, script, storyboard, and rewrite generation
- per-shot and batch image/video creation, media candidates, and explicit candidate adoption
- world-bible character, location, style-guide, and character voice configuration UI with reference uploads and voice sample playback
- timeline auto-assembly, save, export submission, and websocket-aware polling fallback

### `apps/api`

The NestJS API includes:

- `/health` and Swagger docs at `/docs`
- auth flows for register, login, refresh, logout, forgot password, reset password, profile updates, and per-user model listing
- workspace flows for team CRUD, team members, team invite links, project CRUD, project invites, project invite acceptance, project members, document versions, threaded comments, review transitions, world-bible CRUD, audit configs, audit records, timeline save/auto-assemble, and export listing
- dedicated workspace data endpoints for summary, versions, jobs, timeline, and exports
- jobs for:
  - script generation
  - synopsis generation
  - storyboard generation
  - rewrite
  - image generation
  - video generation
  - TTS generation
  - export jobs
- batch image/video jobs and scene-level batch TTS jobs
- prompt preview endpoints
- notifications APIs and realtime websocket events
- storage APIs for direct upload targets and asset URLs

### `apps/worker`

The worker is intentionally lightweight:

- it polls `GET /internal/jobs/next`
- it triggers processing through `POST /internal/jobs/:id/process`
- it retries through `POST /internal/jobs/:id/retry`
- it does not contain generation business logic itself; execution remains in the API service layer

### `packages/shared`

The shared package is the contract layer across the stack:

- domain types and enums
- API contract types
- provider interfaces
- review, permission, job-management, timeline, and export business rules

## API Highlights

These are the most important workspace-facing surfaces right now:

- `GET /projects/:id`: workspace summary only
- `GET /projects/:id/versions`: document versions payload
- `GET /projects/:id/jobs`: task list payload
- `GET /projects/:id/timeline`: timeline payload
- `GET /projects/:id/exports`: export list payload
- `POST /project-invites/:id/accept`: accept a pending project invite
- `POST /scenes/:id/batch-tts-jobs`: generate TTS jobs for the shots in a scene
- websocket events:
  - `job.updated`
  - `review.updated`
  - `notification.created`

## Repository Layout

```text
.
|-- apps
|   |-- api
|   |-- web
|   `-- worker
|-- packages
|   `-- shared
|-- scripts
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

If PowerShell blocks `npm.ps1`, use:

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

### 3. Build the workspace

```bash
npm run build
```

### 4. Start the services

Recommended local validation path:

- use the root launcher, which copies `.env` if missing, checks ports, builds the workspace, launches API/Web/Worker, and waits for readiness

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

Development scripts also exist:

```bash
npm run dev:api
npm run dev:web
npm run dev:worker
```

### 5. Open the local URLs

- Web: `http://localhost:3000`
- Login: `http://localhost:3000/login`
- API health: `http://localhost:4000/health`
- Swagger: `http://localhost:4000/docs`

## Environment Variables

`.env.example` covers the main app, storage, OpenAI-compatible text/media settings, and Google Gemini image defaults. A few runtime variables are still code-level only, so treat the list below as the authoritative overview.

### Core app and auth

- `APP_URL`: frontend origin used by the API for CORS
- `API_URL`: backend origin used by the worker and startup scripts
- `NEXT_PUBLIC_API_URL`: backend origin used by the web app
- `PORT`: API or Web port override when starting services directly
- `JWT_ACCESS_SECRET`: access-token signing secret
- `JWT_REFRESH_SECRET`: startup-time production safety requirement
- `INTERNAL_API_KEY`: shared secret for worker-to-API internal job endpoints

### Persistence and storage

- `DATA_DIR`: directory for `dev-db.json`
- `UPLOADS_DIR`: local uploads directory
- `STORAGE_DRIVER`: `local` or `s3`
- `LOCAL_STORAGE_PUBLIC_URL`: public base URL for locally served files
- `S3_ENDPOINT`
- `S3_REGION`
- `S3_BUCKET`
- `S3_ACCESS_KEY`
- `S3_SECRET_KEY`

### Text and media generation providers

Image jobs can use either native Google Gemini image generation through the dedicated team/personal image config, or the legacy OpenAI-compatible fallback path when no explicit image config source is selected.

- `OPENAI_COMPAT_BASE_URL`
- `OPENAI_COMPAT_API_KEY`
- `OPENAI_TEXT_MODEL`
- `OPENAI_COMPAT_MOCK_FALLBACK`
- `GOOGLE_IMAGE_API_KEY`
- `GOOGLE_IMAGE_MODEL`
- `GOOGLE_IMAGE_BASE_URL`
- `MEDIA_IMAGE_MODEL`
- `MEDIA_VIDEO_MODEL`

### TTS

These are used by the API TTS adapter and may still need to be added to `.env.example` depending on your local branch state:

- `OPENAI_BASE_URL`
- `OPENAI_API_KEY`
- `OPENAI_TTS_MODEL`

### Export and worker overrides

These are also code-level runtime variables that may not yet be listed in `.env.example`:

- `FFMPEG_PATH`
- `EXPORT_KEEP_TEMP`
- `WORKER_POLL_INTERVAL_MS`
- `DRAMAFLOW_START_INLINE`
- `DRAMAFLOW_START_TIMEOUT_MS`

## Docker Compose

The repository includes a demo-oriented `docker-compose.yml` that starts:

- Web
- API
- Worker
- MinIO

Run:

```bash
docker compose up --build
```

Important caveats:

- Compose uses `npm run dev:*`, so it is aimed at development and demos, not hardened production deployment.
- The checked-in Compose file still sets `STORAGE_DRIVER=local` for API and worker, so MinIO is not the active storage backend by default.
- The checked-in Compose file passes only part of the provider configuration through by default. If you want live provider execution instead of mock fallback, pass the relevant provider variables to the API container as well.

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

- `npm run lint` currently fans out to workspace `tsc --noEmit` scripts; it is not an ESLint pass.
- `npm test` currently runs only packages that define a `test` script, which means API and shared, not web or worker.

## Development Notes

- All repository files must use UTF-8 without BOM.
- `packages/shared` is the source of truth for cross-stack domain types and business rules.
- Keep controllers thin and business logic in services.
- Keep Next.js `page.tsx` files light and move heavier UI logic into `components`.
- If a change affects API payloads, update shared contracts, API handlers, frontend callers, and worker behavior together.
- If a change affects review logic, status transitions, or permissions, inspect `packages/shared/src/business-rules.ts` first.
- If you update `README.md`, update `README_ZH.md` in the same change.

## Suggested Reading Order

If you are onboarding to the codebase, start here:

1. `README.md`
2. `README_ZH.md`
3. `package.json`
4. `tsconfig.base.json`
5. `packages/shared/src/domain.ts`
6. `packages/shared/src/business-rules.ts`
7. `apps/api/src/workspace/workspace.service.ts`
8. `apps/api/src/jobs/jobs.service.ts`
9. `apps/web/components/unified-workspace.tsx`
10. `apps/web/lib/api.ts`

## Official References

These were the most useful upstream references for verifying framework terminology and current provider guidance while updating the project documentation:

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