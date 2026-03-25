# DramaFlow

DramaFlow is a short-drama generation platform for directors and studios, built with a full TypeScript stack. It includes a frontend workspace, backend API, async job worker, and shared cross-stack domain models and business rules.

The repository already contains a runnable monorepo scaffold with authentication, team and project management, script and storyboard generation jobs, image and video generation jobs, version management, threaded discussion, review flow, and dual storage abstraction.

## Features

- User registration, login, token refresh, logout, forgot password, and password reset
- Team / Project management
- Four document domains: script, storyboard, image, and video
- Immutable version snapshots with full history access
- Version discussion threads and basic review workflow
- OpenAI-compatible text generation integration
- Media generation provider abstraction for images and videos
- Dual storage implementation: local disk and S3-compatible object storage
- Platform admin, team admin, and director workspace UI

## Tech Stack

- Language: TypeScript
- Monorepo: `npm workspaces`
- Node.js: `>= 24`
- Frontend: Next.js 15 + React 19
- Backend: NestJS 11
- Shared types: `@dramaflow/shared`
- Auth: JWT + Refresh Token + `argon2`
- Storage:
  - Local disk for development and lightweight deployments
  - S3-compatible object storage for production-style deployments
- Async jobs: polling-based worker
- Target production data model: Prisma + PostgreSQL schema

## Repository Structure

```text
.
├─ apps
│  ├─ api        # NestJS API
│  ├─ web        # Next.js frontend workspace and admin dashboards
│  └─ worker     # Async job consumer
├─ packages
│  └─ shared     # Shared domain models, provider contracts, and business rules
├─ docker-compose.yml
├─ package.json
└─ tsconfig.base.json
```

## Directory Guide

### `apps/web`

The frontend app built with Next.js App Router. It currently includes:

- Landing page
- Login page
- Director dashboard
- Project workspace
- Platform admin dashboard
- Team admin dashboard

### `apps/api`

The backend app built with NestJS, split into focused modules:

- `auth`: user authentication
- `workspace`: teams, projects, documents, versions, comments, review flow
- `jobs`: script / storyboard / image / video job orchestration
- `storage`: uploads, asset URLs, local / S3 storage abstraction
- `admin`: platform and team admin endpoints
- `common`: development data store, auth guard, shared utilities

### `apps/worker`

The async worker responsible for:

- claiming queued jobs from the API
- processing script, storyboard, image, and video generation jobs
- writing results back through the API data layer

### `packages/shared`

The shared package that centralizes:

- domain types
- enums and status models
- permission / review / transition rules
- text and media provider interfaces
- storage provider interfaces

## Current Implementation Status

This repository is already runnable as a development starting point, but it is not fully productionized yet.

### What is already implemented

- Monorepo project structure
- Base frontend and backend flows
- File-backed development data store
- Text / media job model and worker flow
- Local / S3 dual storage abstraction
- Prisma production target schema

### What is still development-stage

- Runtime persistence still uses `DevDatabaseService`, not live Prisma-backed storage
- The worker is still polling-based, not BullMQ / Redis-based
- Video generation is still mock-first, with the real provider integration point reserved
- Admin panels and workspaces currently focus on core flows and scaffolding, not polished production UX

## Quick Start

### Recommended startup mode

At the moment, the most reliable local startup flow is:

1. `build`
2. `start`

The `dev` scripts still exist, but on Windows they can be unstable because of the current `tsx watch` / `next dev` runtime behavior. Use `build + start` when you want to test the product flow end to end.

### 1. Install dependencies

```bash
npm install
```

On Windows PowerShell, use `npm.cmd` if `npm` is blocked by execution policy:

```powershell
npm.cmd install
```

### 2. Configure environment variables

Copy the environment template:

```bash
cp .env.example .env
```

On Windows PowerShell:

```powershell
Copy-Item .env.example .env
```

### 3. Build the workspace

```bash
npm run build
```

On Windows PowerShell:

```powershell
npm.cmd run build
```

### 4. Start the services in separate terminals

Start the API:

```bash
npm --workspace @dramaflow/api run start
```

Start the frontend:

```bash
npm --workspace @dramaflow/web run start
```

Start the worker:

```bash
npm --workspace @dramaflow/worker run start
```

On Windows PowerShell:

```powershell
npm.cmd --workspace @dramaflow/api run start
npm.cmd --workspace @dramaflow/web run start
npm.cmd --workspace @dramaflow/worker run start
```

### 5. Open the local URLs

- Web: `http://localhost:3000`
- Login: `http://localhost:3000/login`
- API: `http://localhost:4000/health`
- Swagger: `http://localhost:4000/docs`

### One-click startup scripts

If you want a one-click local startup flow, use the scripts in the repository root:

Windows:

```bat
start-all.bat
```

macOS / Linux:

```bash
bash ./start-all.sh
```

What the scripts do:

- copy `.env.example` to `.env` if `.env` does not exist yet
- run `npm install` automatically when `node_modules` is missing
- run a full `npm run build`
- start API, Web, and Worker

Behavior difference:

- `start-all.bat` opens three separate terminal windows
- `start-all.sh` keeps the current terminal attached and stops all three services when you press `Ctrl+C`

## Common Commands

```bash
# Build the whole monorepo
npm run build

# Start the API
npm --workspace @dramaflow/api run start

# Start the frontend
npm --workspace @dramaflow/web run start

# Start the worker
npm --workspace @dramaflow/worker run start

# Development-only commands
npm run dev:api
npm run dev:web
npm run dev:worker

# Run type checks across the monorepo
npm run lint

# Run tests across the monorepo
npm test
```

## Local Run Notes

- If PowerShell reports that `npm.ps1` cannot run, use `npm.cmd` instead of `npm`.
- The worker should log `idle` when there are no queued jobs. That is normal.
- If `3000` or `4000` is already occupied, stop the old process before starting the services again.
- For local manual testing, prefer `STORAGE_DRIVER=local` unless you are explicitly validating the S3-compatible mode.
- The one-click shell script writes logs to `api.log`, `web.log`, and `worker.log`.

## Environment Variables

See [.env.example](./.env.example) for the full template.

Important values include:

- `APP_URL`: frontend URL
- `API_URL`: backend URL
- `NEXT_PUBLIC_API_URL`: public API URL used by the frontend
- `DATA_DIR`: development data file directory
- `UPLOADS_DIR`: local upload directory
- `STORAGE_DRIVER`: storage driver, `local` or `s3`
- `LOCAL_STORAGE_PUBLIC_URL`: public URL base for local file access
- `JWT_ACCESS_SECRET`: access token secret
- `JWT_REFRESH_SECRET`: refresh token secret
- `OPENAI_COMPAT_BASE_URL`: base URL for OpenAI-compatible text APIs
- `OPENAI_COMPAT_API_KEY`: API key for text generation
- `OPENAI_TEXT_MODEL`: text model name
- `OPENAI_COMPAT_MOCK_FALLBACK`: whether script and storyboard generation should fall back to mock data when the live provider fails or returns unparseable output
- `MEDIA_IMAGE_MODEL`: image model name
- `MEDIA_VIDEO_MODEL`: video model name

`OPENAI_COMPAT_BASE_URL` should point at the API root, not the website homepage. The provider appends `/chat/completions` automatically, so OpenAI-compatible gateways usually need a `/v1` suffix.

When you are debugging a real gateway integration, set `OPENAI_COMPAT_MOCK_FALLBACK=false` so provider errors surface instead of being silently replaced with mock script or storyboard data.

## Storage Modes

### Local storage

Set:

```env
STORAGE_DRIVER=local
```

In this mode, generated assets and uploads are written to:

- `apps/api/uploads`

Best for:

- local development
- lightweight private deployment
- upload and media pipeline debugging

### S3-compatible object storage

Set:

```env
STORAGE_DRIVER=s3
```

And configure:

- `S3_ENDPOINT`
- `S3_REGION`
- `S3_BUCKET`
- `S3_ACCESS_KEY`
- `S3_SECRET_KEY`

Best for:

- production environments
- multi-instance deployments
- scenarios that need stronger scalability, backup, and CDN integration

## Docker Compose

The repository includes a basic `docker-compose.yml` for quickly bringing up:

- Web
- API
- Worker
- MinIO

Run:

```bash
docker compose up --build
```

Notes:

- The current Compose setup is aimed more at development and demos
- For production use, you should separately harden image builds, environment setup, database strategy, and queue infrastructure

## API and Data Layer Notes

### Runtime data layer

In development mode, the API currently reads and writes JSON files via `apps/api/src/common/dev-database.service.ts`, so the project can boot quickly without a real database.

### Target production data layer

`apps/api/prisma/schema.prisma` defines the intended PostgreSQL / Prisma model, including:

- users
- teams
- projects
- documents
- versions
- comments
- jobs
- assets

If you want to continue productionizing the project, the next recommended steps are:

1. replace `DevDatabaseService` with Prisma-backed repositories
2. move the worker from polling to Redis / BullMQ
3. integrate real image / video providers

## AI Capability Notes

### Text generation

Text generation is currently wired through an OpenAI-compatible provider abstraction for:

- script generation
- storyboard generation

If no real API key is configured, it falls back to mock data for local development.

The provider posts to `{OPENAI_COMPAT_BASE_URL}/chat/completions`, requests `response_format: { type: "json_object" }`, and now accepts both regular JSON responses and `text/event-stream` chat completion responses.

For the validated `https://new-api.ms-egde.de5.net` gateway, use `https://new-api.ms-egde.de5.net/v1` as `OPENAI_COMPAT_BASE_URL`. For a quick smoke test, prefer `moonshotai/kimi-k2-instruct` instead of the repo default `gpt-4.1-mini`, and set `OPENAI_COMPAT_MOCK_FALLBACK=false` if you want real provider errors instead of mock output.

### Image generation

Image generation currently supports:

- a real provider integration point
- mock SVG output when no live provider is configured

### Video generation

Video generation currently defaults to a mock manifest result so the end-to-end workflow can be exercised before a real provider is connected.

## Suggested Reading Order

If you plan to continue development, start with:

1. `README.md`
2. `README_ZH.md`
3. `package.json`
4. `packages/shared/src/domain.ts`
5. `packages/shared/src/business-rules.ts`
6. `apps/api/src/workspace/workspace.service.ts`
7. `apps/api/src/jobs/jobs.service.ts`
8. `apps/web/components/project-workspace.tsx`
9. `apps/web/lib/api.ts`

## Development Conventions

- All repository files must use UTF-8 encoding without BOM
- Add new cross-stack models to `packages/shared` first
- Keep controllers thin and business logic in services
- Keep Next.js page files light; move complex UI into `components`
- When changing permission, review, or version-transition logic, inspect the shared rules layer first
- When updating `README.md`, update `README_ZH.md` in the same change, and vice versa

## Recommended Next Steps

If you want to move this project toward a production-ready state, the highest-value next steps are:

1. real Prisma + PostgreSQL runtime integration
2. Redis / BullMQ queue infrastructure
3. fuller membership and invite flows
4. real upload and media-generation production pipelines
5. more detailed admin tools and audit logging

## License

This repository does not currently declare a standalone license. If you plan to open-source or commercially distribute it, add an explicit license file.
